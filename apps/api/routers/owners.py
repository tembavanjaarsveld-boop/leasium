"""Owner-grouped statements router.

v1 of the owner monthly statements feature from the automation strategy
(`docs/automation-strategy-2026-05-23.md`). Backend-only — exposes a
read endpoint that groups properties by owner identity (derived from
existing `Property` columns; no `owner` table) and rolls up invoice totals
for a month. v2 wires a frontend statements page; v3 adds PDF generation;
v4 dispatches drafts through the comms queue.

Read-only — never mutates, never sends.
"""

from __future__ import annotations

import calendar
from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    InvoiceDraft,
    InvoiceDraftStatus,
    Property,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.owners import (
    OwnerPropertyLine,
    OwnerStatementRead,
    OwnerStatementsRead,
)

router = APIRouter(prefix="/owners", tags=["owners"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}


def _parse_month(value: str) -> tuple[date, date, str]:
    """Parse YYYY-MM into (first_day, last_day, canonical_string).

    Defensive — the endpoint is operator-facing and a malformed month
    should yield a 422, not crash.
    """

    try:
        year_str, month_str = value.split("-")
        year = int(year_str)
        month = int(month_str)
        first = date(year, month, 1)
        last_day = calendar.monthrange(year, month)[1]
        last = date(year, month, last_day)
        canonical = f"{year:04d}-{month:02d}"
        return first, last, canonical
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must be in YYYY-MM format.",
        )


def _owner_identity_tuple(
    prop: Property,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Build the identity tuple used to group properties by owner.

    The tuple keys are (owner_legal_name, trustee_name, trust_name,
    invoice_issuer_name) — case- and whitespace-normalised. Properties
    that share all four resolve to the same statement.

    Properties with no identifying owner fields fall into a single
    "Unattributed" bucket so the operator still sees their financials.
    """

    def norm(value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned.casefold() if cleaned else None

    return (
        norm(prop.owner_legal_name),
        norm(prop.trustee_name),
        norm(prop.trust_name),
        norm(prop.invoice_issuer_name),
    )


def _identity_label(prop: Property) -> str:
    """Pick the most descriptive label for the owner identity.

    Prefer trust_name + trustee_name when both are set ("XYZ Trust
    (Trustee: ABC Pty Ltd)"); otherwise trust_name alone; otherwise
    trustee_name; otherwise owner_legal_name; otherwise
    invoice_issuer_name; otherwise "Unattributed".
    """

    if prop.trust_name and prop.trustee_name:
        return f"{prop.trust_name.strip()} (Trustee: {prop.trustee_name.strip()})"
    if prop.trust_name:
        return prop.trust_name.strip()
    if prop.trustee_name:
        return prop.trustee_name.strip()
    if prop.owner_legal_name:
        return prop.owner_legal_name.strip()
    if prop.invoice_issuer_name:
        return prop.invoice_issuer_name.strip()
    return "Unattributed"


def _invoice_paid_cents(invoice: InvoiceDraft) -> int:
    """Read paid_cents from invoice_metadata.

    Xero reconciliation writes payment totals onto `invoice_metadata`. We
    tolerate string or int values defensively because JSONB serialisation
    can vary.
    """

    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    raw = metadata.get("paid_cents")
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return 0


@router.get("/statements", response_model=OwnerStatementsRead)
def get_owner_statements(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> OwnerStatementsRead:
    """Return per-owner monthly statements for `entity_id`.

    Groups properties by owner identity tuple, then for each owner sums
    the InvoiceDraft totals whose `issue_date` falls in the target month.
    Paid totals come from `invoice_metadata.paid_cents` (written by Xero
    reconciliation). Outstanding = invoiced - paid, floored at zero so a
    payment overshoot doesn't show negative.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)

    # Default to previous calendar month when month is not supplied.
    if not month:
        today = date.today()
        if today.month == 1:
            target_year, target_month = today.year - 1, 12
        else:
            target_year, target_month = today.year, today.month - 1
        month = f"{target_year:04d}-{target_month:02d}"

    month_start, month_end, canonical_month = _parse_month(month)

    properties = list(
        session.scalars(
            select(Property).where(
                Property.entity_id == entity_id,
                Property.deleted_at.is_(None),
            )
        ).all()
    )
    invoices = list(
        session.scalars(
            select(InvoiceDraft).where(
                InvoiceDraft.entity_id == entity_id,
                InvoiceDraft.deleted_at.is_(None),
                InvoiceDraft.property_id.is_not(None),
                InvoiceDraft.issue_date.is_not(None),
                InvoiceDraft.issue_date >= month_start,
                InvoiceDraft.issue_date <= month_end,
                InvoiceDraft.status == InvoiceDraftStatus.approved,
            )
        ).all()
    )

    # Bucket invoices by property.
    invoices_by_property: dict[UUID, list[InvoiceDraft]] = {}
    for invoice in invoices:
        assert invoice.property_id is not None  # filtered above
        invoices_by_property.setdefault(invoice.property_id, []).append(invoice)

    # Group properties by owner identity.
    owners_by_identity: dict[
        tuple[str | None, str | None, str | None, str | None],
        dict[str, Any],
    ] = {}
    for prop in properties:
        identity = _owner_identity_tuple(prop)
        bucket = owners_by_identity.setdefault(
            identity,
            {
                "label": _identity_label(prop),
                "sample": prop,
                "properties": [],
            },
        )
        # Prefer a richer label as more properties roll in (e.g., one
        # property has trust_name set, another doesn't — use the
        # trust-named property's label).
        if (
            bucket["label"] == "Unattributed"
            and _identity_label(prop) != "Unattributed"
        ):
            bucket["label"] = _identity_label(prop)
            bucket["sample"] = prop
        bucket["properties"].append(prop)

    statements: list[OwnerStatementRead] = []
    for identity, bucket in owners_by_identity.items():
        sample: Property = bucket["sample"]
        props: list[Property] = bucket["properties"]

        property_lines: list[OwnerPropertyLine] = []
        owner_invoiced = 0
        owner_paid = 0
        owner_count = 0
        for prop in props:
            prop_invoices = invoices_by_property.get(prop.id, [])
            invoiced = sum(inv.total_cents for inv in prop_invoices)
            paid = sum(_invoice_paid_cents(inv) for inv in prop_invoices)
            outstanding = max(0, invoiced - paid)
            owner_invoiced += invoiced
            owner_paid += paid
            owner_count += len(prop_invoices)
            property_lines.append(
                OwnerPropertyLine(
                    property_id=prop.id,
                    property_name=prop.name,
                    invoiced_cents=invoiced,
                    paid_cents=paid,
                    outstanding_cents=outstanding,
                    invoice_count=len(prop_invoices),
                )
            )

        # Sort properties by invoiced amount descending so the largest
        # contributors land at the top of the statement.
        property_lines.sort(
            key=lambda line: (-line.invoiced_cents, line.property_name)
        )

        owner_outstanding = max(0, owner_invoiced - owner_paid)
        statements.append(
            OwnerStatementRead(
                owner_identity=bucket["label"],
                owner_legal_name=sample.owner_legal_name,
                trustee_name=sample.trustee_name,
                trust_name=sample.trust_name,
                invoice_issuer_name=sample.invoice_issuer_name,
                billing_contact_name=sample.billing_contact_name,
                billing_email=sample.billing_email,
                property_count=len(props),
                properties=property_lines,
                invoiced_cents=owner_invoiced,
                paid_cents=owner_paid,
                outstanding_cents=owner_outstanding,
                invoice_count=owner_count,
            )
        )

    # Sort owners by invoiced amount descending.
    statements.sort(key=lambda s: (-s.invoiced_cents, s.owner_identity))

    return OwnerStatementsRead(
        entity_id=entity_id,
        month=canonical_month,
        month_start=month_start,
        month_end=month_end,
        owners=statements,
        generated_at=utcnow(),
    )
