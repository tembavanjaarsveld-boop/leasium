"""Owner-grouped statements router.

v1 of the owner monthly statements feature from the automation strategy
(`docs/automation-strategy-2026-05-23.md`). Backend-only — exposes a
read endpoint that groups properties by first-class `Owner` / `PropertyOwner`
links and rolls up invoice totals for a month. Legacy `Property` owner fields
remain only as the backfill source for Owner records. v2 wires a frontend
statements page; v3 adds PDF generation; v4 dispatches drafts through the
comms queue.

Read-only — never mutates, never sends.
"""

from __future__ import annotations

import calendar
import re
import textwrap
import zipfile
from datetime import date
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from io import BytesIO
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    OperatingMode,
    Organisation,
    Owner,
    OwnerDistribution,
    OwnerStatementDispatch,
    Property,
    PropertyOwner,
    UserRole,
)
from stewart.core.settings import get_settings
from stewart.integrations.communications import (
    OwnerStatementEmail,
    send_owner_statement_email,
)
from stewart.services.owner_distributions import compute_owner_distributions

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.owners import (
    OwnerDistributionDispatchDraft,
    OwnerDistributionDispatchReviewRead,
    OwnerDistributionHistoryRead,
    OwnerDistributionHistoryRecord,
    OwnerDistributionLine,
    OwnerDistributionReviewRequest,
    OwnerDistributionsRead,
    OwnerInvoiceEvidenceLine,
    OwnerPropertyLine,
    OwnerStatementDispatchListRead,
    OwnerStatementDispatchReceipt,
    OwnerStatementDispatchRequest,
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

# Sending owner statements is a money-adjacent provider email, so it is
# restricted to finance-capable roles rather than the broader read set.
DISPATCH_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
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
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must be in YYYY-MM format.",
        ) from exc


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


def _owner_entity_label(owner: Owner) -> str:
    if owner.trust_name and owner.trustee_name:
        return f"{owner.trust_name.strip()} (Trustee: {owner.trustee_name.strip()})"
    if owner.trust_name:
        return owner.trust_name.strip()
    if owner.trustee_name:
        return owner.trustee_name.strip()
    if owner.legal_name:
        return owner.legal_name.strip()
    if owner.invoice_issuer_name:
        return owner.invoice_issuer_name.strip()
    return "Unattributed"


def _invoice_paid_cents(invoice: InvoiceDraft) -> int:
    """Read paid_cents from local invoice metadata.

    Current payment status lives under ``payment_status``. Older local
    metadata may have a top-level ``paid_cents`` value, so keep that as a
    read-only fallback for existing invoices.
    """

    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        paid_cents = _metadata_int(payment.get("paid_cents"))
        if paid_cents is not None:
            return max(0, paid_cents)

    paid_cents = _metadata_int(metadata.get("paid_cents"))
    return max(0, paid_cents or 0)


def _metadata_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _metadata_text(record: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = record.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _metadata_record(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _invoice_payment_status(invoice: InvoiceDraft, paid_cents: int) -> str:
    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        status_value = payment.get("status")
        if isinstance(status_value, str) and status_value.strip():
            return status_value.strip()
    if paid_cents >= invoice.total_cents and invoice.total_cents > 0:
        return "paid"
    if paid_cents > 0:
        return "partially_paid"
    return "unpaid"


def _invoice_outstanding_cents(invoice: InvoiceDraft, paid_cents: int) -> int:
    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        outstanding_cents = _metadata_int(payment.get("outstanding_cents"))
        if outstanding_cents is not None:
            return max(0, outstanding_cents)
    return max(0, invoice.total_cents - paid_cents)


def _invoice_xero_invoice_id(invoice: InvoiceDraft) -> str | None:
    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    direct_id = _metadata_text(metadata, "xero_invoice_id", "InvoiceID")
    if direct_id:
        return direct_id
    sync_state = _metadata_record(metadata.get("xero_sync"))
    sync_id = _metadata_text(sync_state, "xero_invoice_id", "InvoiceID")
    if sync_id:
        return sync_id
    posting_state = _metadata_record(metadata.get("posting_preparation"))
    return _metadata_text(posting_state, "xero_invoice_id", "InvoiceID")


def _invoice_reconciliation_record(invoice: InvoiceDraft) -> dict[str, Any]:
    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    current = _metadata_record(metadata.get("xero_payment_reconciliation"))
    if current:
        return current
    history = metadata.get("xero_payment_reconciliation_history")
    if isinstance(history, list) and history:
        return _metadata_record(history[-1])
    return {}


def _invoice_evidence_line(invoice: InvoiceDraft) -> OwnerInvoiceEvidenceLine:
    paid_cents = _invoice_paid_cents(invoice)
    reconciliation = _invoice_reconciliation_record(invoice)
    return OwnerInvoiceEvidenceLine(
        invoice_draft_id=invoice.id,
        invoice_number=invoice.invoice_number,
        title=invoice.title,
        issue_date=invoice.issue_date,
        due_date=invoice.due_date,
        total_cents=invoice.total_cents,
        paid_cents=paid_cents,
        outstanding_cents=_invoice_outstanding_cents(invoice, paid_cents),
        payment_status=_invoice_payment_status(invoice, paid_cents),
        xero_invoice_id=_invoice_xero_invoice_id(invoice),
        reconciliation_reference=_metadata_text(reconciliation, "reference"),
        reconciliation_match_confidence=_metadata_text(
            reconciliation,
            "match_confidence",
        ),
        reconciliation_bank_transaction_id=_metadata_text(
            reconciliation,
            "bank_transaction_id",
        ),
    )


def _allocated_cents_by_split(
    cents: int,
    entries: list[dict[str, Any]],
    *,
    caps: dict[UUID | str, int] | None = None,
) -> dict[UUID | str, int]:
    """Allocate cents across linked owners without creating or losing residue."""

    rows: list[tuple[UUID | str, int, Decimal]] = []
    split_total = sum(Decimal(str(entry["split_pct"])) for entry in entries)
    denominator = split_total if split_total > Decimal("100") else Decimal("100")
    floor_total = 0
    for entry in entries:
        split_pct = Decimal(str(entry["split_pct"]))
        raw_share = Decimal(cents) * split_pct / denominator
        floor_share = int(raw_share.to_integral_value(rounding=ROUND_FLOOR))
        if caps is not None:
            floor_share = min(floor_share, caps[entry["bucket_key"]])
        rows.append((entry["bucket_key"], floor_share, raw_share - floor_share))
        floor_total += floor_share

    target_basis = min(split_total, Decimal("100"))
    target_total = int(
        (Decimal(cents) * target_basis / Decimal("100")).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    )
    if caps is not None:
        target_total = min(target_total, sum(caps.values()))
    allocations = {key: floor_share for key, floor_share, _fraction in rows}
    residue = target_total - floor_total
    if residue > 0:
        for key, _floor_share, _fraction in sorted(
            rows,
            key=lambda item: (-item[2], str(item[0])),
        ):
            if residue <= 0:
                break
            if caps is not None and allocations[key] >= caps[key]:
                continue
            allocations[key] += 1
            residue -= 1
    elif residue < 0:
        for key, _floor_share, _fraction in sorted(
            rows,
            key=lambda item: (item[2], str(item[0])),
        ):
            if residue >= 0:
                break
            if allocations[key] > 0:
                allocations[key] -= 1
                residue += 1
    return allocations


def _allocated_invoice_evidence_line(
    line: OwnerInvoiceEvidenceLine,
    entry: dict[str, Any],
    entries: list[dict[str, Any]],
) -> OwnerInvoiceEvidenceLine:
    if len(entries) == 1 and float(entry["split_pct"]) == 100:
        return line
    bucket_key = entry["bucket_key"]
    total_allocations = _allocated_cents_by_split(
        line.total_cents,
        entries,
    )
    total_cents = total_allocations[bucket_key]
    paid_cents = _allocated_cents_by_split(
        line.paid_cents,
        entries,
        caps=total_allocations,
    )[bucket_key]
    if line.paid_cents + line.outstanding_cents == line.total_cents:
        outstanding_cents = max(0, total_cents - paid_cents)
    else:
        outstanding_cents = _allocated_cents_by_split(
            line.outstanding_cents,
            entries,
        )[bucket_key]
    return line.model_copy(
        update={
            "total_cents": total_cents,
            "paid_cents": paid_cents,
            "outstanding_cents": outstanding_cents,
        }
    )


def _build_owner_statements(
    entity_id: UUID,
    session: Session,
    month: str,
) -> OwnerStatementsRead:
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

    # Group properties by the first-class Owner model. Legacy Property owner
    # fields are now only a backfill source; unlinked properties stay visible
    # in a single operator-facing fallback bucket.
    properties_by_id = {prop.id: prop for prop in properties}
    property_ids = list(properties_by_id)
    owners_by_identity: dict[UUID | str, dict[str, Any]] = {}
    property_entries_by_property: dict[UUID, list[dict[str, Any]]] = {}
    linked_property_ids: set[UUID] = set()
    if property_ids:
        owner_links = session.execute(
            select(PropertyOwner.property_id, PropertyOwner.split_pct, Owner)
            .join(Owner, PropertyOwner.owner_id == Owner.id)
            .where(
                PropertyOwner.property_id.in_(property_ids),
                Owner.entity_id == entity_id,
                Owner.deleted_at.is_(None),
            )
        ).all()
        for property_id, split_pct, owner in owner_links:
            prop = properties_by_id.get(property_id)
            if prop is None:
                continue
            bucket = owners_by_identity.setdefault(
                owner.id,
                {
                    "label": _owner_entity_label(owner),
                    "owner": owner,
                    "properties": [],
                },
            )
            entry = {
                "bucket_key": owner.id,
                "property": prop,
                "split_pct": float(split_pct),
            }
            bucket["properties"].append(entry)
            property_entries_by_property.setdefault(property_id, []).append(entry)
            linked_property_ids.add(property_id)

    unattributed = owners_by_identity.setdefault(
        "unattributed",
        {
            "label": "Unattributed",
            "owner": None,
            "properties": [],
        },
    )
    for prop in properties:
        if prop.id not in linked_property_ids:
            entry = {
                "bucket_key": "unattributed",
                "property": prop,
                "split_pct": 100.0,
            }
            unattributed["properties"].append(entry)
            property_entries_by_property.setdefault(prop.id, []).append(entry)
    if not unattributed["properties"]:
        owners_by_identity.pop("unattributed", None)

    label_counts: dict[str, int] = {}
    for bucket in owners_by_identity.values():
        label_key = bucket["label"].casefold()
        label_counts[label_key] = label_counts.get(label_key, 0) + 1
    used_identity_labels: set[str] = set()
    for bucket in owners_by_identity.values():
        owner: Owner | None = bucket["owner"]
        label = bucket["label"]
        if owner is not None and label_counts[label.casefold()] > 1:
            owner_name = owner.legal_name.strip() if owner.legal_name else ""
            if owner_name and owner_name.casefold() not in label.casefold():
                label = f"{label} ({owner_name})"
            if label.casefold() in used_identity_labels:
                label = f"{bucket['label']} ({str(owner.id)[:8]})"
            bucket["label"] = label
        used_identity_labels.add(bucket["label"].casefold())

    statements: list[OwnerStatementRead] = []
    for bucket in owners_by_identity.values():
        owner: Owner | None = bucket["owner"]
        props: list[dict[str, Any]] = bucket["properties"]

        property_lines: list[OwnerPropertyLine] = []
        owner_invoiced = 0
        owner_paid = 0
        owner_outstanding = 0
        owner_count = 0
        for entry in props:
            prop: Property = entry["property"]
            prop_invoices = invoices_by_property.get(prop.id, [])
            split_entries = property_entries_by_property.get(prop.id, [entry])
            invoice_lines = [
                _allocated_invoice_evidence_line(
                    _invoice_evidence_line(inv),
                    entry,
                    split_entries,
                )
                for inv in prop_invoices
            ]
            invoice_lines.sort(
                key=lambda line: (
                    line.issue_date or date.min,
                    line.invoice_number or line.title,
                )
            )
            invoiced = sum(line.total_cents for line in invoice_lines)
            paid = sum(line.paid_cents for line in invoice_lines)
            outstanding = sum(line.outstanding_cents for line in invoice_lines)
            owner_invoiced += invoiced
            owner_paid += paid
            owner_outstanding += outstanding
            owner_count += len(prop_invoices)
            property_lines.append(
                OwnerPropertyLine(
                    property_id=prop.id,
                    property_name=prop.name,
                    invoiced_cents=invoiced,
                    paid_cents=paid,
                    outstanding_cents=outstanding,
                    invoice_count=len(prop_invoices),
                    invoices=invoice_lines,
                )
            )

        # Sort properties by invoiced amount descending so the largest
        # contributors land at the top of the statement.
        property_lines.sort(
            key=lambda line: (-line.invoiced_cents, line.property_name)
        )

        statements.append(
            OwnerStatementRead(
                owner_id=owner.id if owner else None,
                owner_identity=bucket["label"],
                owner_legal_name=owner.legal_name if owner else None,
                trustee_name=owner.trustee_name if owner else None,
                trust_name=owner.trust_name if owner else None,
                invoice_issuer_name=owner.invoice_issuer_name if owner else None,
                billing_contact_name=owner.billing_contact_name if owner else None,
                billing_email=owner.billing_email if owner else None,
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


def _format_money(cents: int) -> str:
    dollars = cents / 100
    return f"${dollars:,.0f}"


def _pdf_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .encode("latin-1", "replace")
        .decode("latin-1")
    )


PDF_LINE_WIDTH = 88
PDF_LINES_PER_PAGE = 48


def _wrap_pdf_lines(lines: list[str]) -> list[str]:
    wrapped: list[str] = []
    for line in lines:
        if not line:
            wrapped.append("")
            continue
        wrapped.extend(
            textwrap.wrap(
                line,
                width=PDF_LINE_WIDTH,
                break_long_words=True,
                break_on_hyphens=False,
                subsequent_indent="  ",
            )
            or [""]
        )
    return wrapped


def _is_self_managed_statement_export(operating_mode: str) -> bool:
    return operating_mode == OperatingMode.self_managed_owner.value


def _statement_export_operating_mode(
    session: Session,
    user: CurrentUser,
) -> str:
    organisation = session.scalar(
        select(Organisation).where(Organisation.id == user.organisation_id)
    )
    if organisation is None:
        return OperatingMode.self_managed_owner.value
    return organisation.operating_mode


def _statement_pdf_bytes(
    statement: OwnerStatementRead,
    month: str,
    operating_mode: str,
) -> bytes:
    """Render a compact text PDF without introducing a new provider dependency."""

    if _is_self_managed_statement_export(operating_mode):
        title = "LEASIUM ENTITY STATEMENT"
        review_line = "Review-only local entity-reporting export."
        identity_label = "Entity"
        final_note = (
            "Review only. This PDF is a local entity-reporting export and does "
            "not post to Xero or update provider history."
        )
    else:
        title = "LEASIUM OWNER STATEMENT"
        review_line = "Review-only export. Not sent to owner."
        identity_label = "Owner"
        final_note = (
            "Review only. This PDF does not send owner email, post to Xero, "
            "or update provider history."
        )

    lines = [
        title,
        review_line,
        "",
        f"{identity_label}: {statement.owner_identity}",
        f"Month: {month}",
        "",
        "Billing",
        f"Billing contact: {statement.billing_contact_name or 'Not recorded'}",
        f"Billing email: {statement.billing_email or 'Not recorded'}",
        "",
        "Summary",
        f"Invoiced: {_format_money(statement.invoiced_cents)}",
        f"Paid: {_format_money(statement.paid_cents)}",
        f"Outstanding: {_format_money(statement.outstanding_cents)}",
        f"Properties: {statement.property_count}",
        f"Invoices: {statement.invoice_count}",
        "",
        "Property breakdown",
        "Property | Invoiced | Paid | Outstanding | Invoices",
    ]
    for prop in statement.properties:
        lines.extend(
            [
                (
                    f"{prop.property_name} | {_format_money(prop.invoiced_cents)} | "
                    f"{_format_money(prop.paid_cents)} | "
                    f"{_format_money(prop.outstanding_cents)} | {prop.invoice_count}"
                ),
            ]
        )
    invoice_lines = [
        (prop.property_name, invoice)
        for prop in statement.properties
        for invoice in prop.invoices
    ]
    if invoice_lines:
        lines.extend(
            [
                "",
                "Invoice evidence",
                (
                    "Property | Invoice | Issue | Due | Status | Total | Paid | "
                    "Outstanding | Xero invoice | Bank reference | Match | Bank txn"
                ),
            ]
        )
        for property_name, invoice in invoice_lines:
            lines.append(
                f"{property_name} | {invoice.invoice_number or invoice.title} | "
                f"{invoice.issue_date or ''} | {invoice.due_date or ''} | "
                f"{invoice.payment_status} | {_format_money(invoice.total_cents)} | "
                f"{_format_money(invoice.paid_cents)} | "
                f"{_format_money(invoice.outstanding_cents)} | "
                f"{invoice.xero_invoice_id or ''} | "
                f"{invoice.reconciliation_reference or ''} | "
                f"{invoice.reconciliation_match_confidence or ''} | "
                f"{invoice.reconciliation_bank_transaction_id or ''}"
            )
    lines.extend(
        [
            "",
            final_note,
        ]
    )

    return _render_pdf_lines(lines)


def _render_pdf_lines(lines: list[str]) -> bytes:
    """Render text lines into a minimal multi-page PDF (no provider dependency)."""

    wrapped_lines = _wrap_pdf_lines(lines)
    page_chunks = [
        wrapped_lines[index : index + PDF_LINES_PER_PAGE]
        for index in range(0, len(wrapped_lines), PDF_LINES_PER_PAGE)
    ] or [[]]
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",  # Filled after pages are known.
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    page_refs: list[str] = []
    for chunk in page_chunks:
        content_lines = ["BT", "/F1 11 Tf", "14 TL", "50 790 Td"]
        for line in chunk:
            content_lines.append(f"({_pdf_text(line)}) Tj")
            content_lines.append("T*")
        content_lines.append("ET")
        stream = "\n".join(content_lines).encode("latin-1")
        content_obj = (
            f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1")
            + stream
            + b"\nendstream"
        )
        page_number = len(objects) + 1
        content_number = len(objects) + 2
        page_refs.append(f"{page_number} 0 R")
        objects.append(
            (
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_number} 0 R >>"
            ).encode("latin-1")
        )
        objects.append(content_obj)
    objects[1] = (
        f"<< /Type /Pages /Kids [{' '.join(page_refs)}] /Count {len(page_refs)} >>"
    ).encode("latin-1")

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("latin-1"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    output.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )
    return bytes(output)


def _statement_filename(owner_identity: str, month: str, operating_mode: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", owner_identity).strip("-").lower()
    if _is_self_managed_statement_export(operating_mode):
        return f"entity-statement-{month}-{slug or 'entity'}.pdf"
    return f"owner-statement-{month}-{slug or 'owner'}.pdf"


def _statement_pack_filename(month: str, operating_mode: str) -> str:
    if _is_self_managed_statement_export(operating_mode):
        return f"entity-statement-pack-{month}.zip"
    return f"owner-statement-pack-{month}.zip"


def _csv_cell(value: object) -> str:
    text = "" if value is None else str(value)
    safe_text = f"'{text}" if re.match(r"\s*[=+\-@]", text) else text
    return '"' + safe_text.replace('"', '""') + '"'


def _statement_pack_manifest_csv(
    statements: OwnerStatementsRead,
    operating_mode: str,
) -> str:
    self_managed = _is_self_managed_statement_export(operating_mode)
    if self_managed:
        rows: list[list[object]] = [
            [
                "entity_identity",
                "property_count",
                "invoice_count",
                "invoiced_cents",
                "paid_cents",
                "outstanding_cents",
                "review_status",
            ]
        ]
    else:
        rows = [
            [
                "owner_identity",
                "billing_email",
                "recipient_ready",
                "property_count",
                "invoice_count",
                "invoiced_cents",
                "paid_cents",
                "outstanding_cents",
                "review_status",
            ]
        ]
    for statement in statements.owners:
        if statement.invoice_count <= 0:
            continue
        common_cells = [
            statement.owner_identity,
            statement.property_count,
            statement.invoice_count,
            statement.invoiced_cents,
            statement.paid_cents,
            statement.outstanding_cents,
            "payment_review" if statement.outstanding_cents > 0 else "ready",
        ]
        if self_managed:
            rows.append(common_cells)
        else:
            rows.append(
                [
                    statement.owner_identity,
                    statement.billing_email or "",
                    "yes" if statement.billing_email else "no",
                    *common_cells[1:],
                ]
            )
    return "\n".join(",".join(_csv_cell(cell) for cell in row) for row in rows) + "\n"


def _statement_pack_invoice_evidence_csv(
    statements: OwnerStatementsRead,
    operating_mode: str,
) -> str:
    identity_header = (
        "entity_identity"
        if _is_self_managed_statement_export(operating_mode)
        else "owner_identity"
    )
    rows: list[list[object]] = [
        [
            identity_header,
            "property_name",
            "invoice_draft_id",
            "invoice_number",
            "title",
            "issue_date",
            "due_date",
            "total_cents",
            "paid_cents",
            "outstanding_cents",
            "payment_status",
            "xero_invoice_id",
            "reconciliation_reference",
            "reconciliation_match_confidence",
            "reconciliation_bank_transaction_id",
        ]
    ]
    for statement in statements.owners:
        for prop in statement.properties:
            for invoice in prop.invoices:
                rows.append(
                    [
                        statement.owner_identity,
                        prop.property_name,
                        invoice.invoice_draft_id,
                        invoice.invoice_number or "",
                        invoice.title,
                        invoice.issue_date or "",
                        invoice.due_date or "",
                        invoice.total_cents,
                        invoice.paid_cents,
                        invoice.outstanding_cents,
                        invoice.payment_status,
                        invoice.xero_invoice_id or "",
                        invoice.reconciliation_reference or "",
                        invoice.reconciliation_match_confidence or "",
                        invoice.reconciliation_bank_transaction_id or "",
                    ]
                )
    return "\n".join(",".join(_csv_cell(cell) for cell in row) for row in rows) + "\n"


def _statement_pack_zip_bytes(
    statements: OwnerStatementsRead,
    operating_mode: str,
) -> bytes:
    included = [statement for statement in statements.owners if statement.invoice_count > 0]
    total_invoiced = sum(statement.invoiced_cents for statement in included)
    total_paid = sum(statement.paid_cents for statement in included)
    total_outstanding = sum(statement.outstanding_cents for statement in included)
    missing_recipients = sum(1 for statement in included if not statement.billing_email)
    self_managed = _is_self_managed_statement_export(operating_mode)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for statement in included:
            archive.writestr(
                _statement_filename(
                    statement.owner_identity,
                    statements.month,
                    operating_mode,
                ),
                _statement_pdf_bytes(statement, statements.month, operating_mode),
            )
        archive.writestr(
            f"MANIFEST-{statements.month}.csv",
            _statement_pack_manifest_csv(statements, operating_mode),
        )
        archive.writestr(
            f"INVOICE-EVIDENCE-{statements.month}.csv",
            _statement_pack_invoice_evidence_csv(statements, operating_mode),
        )
        if self_managed:
            readme = (
                "Review-only entity statement pack generated by Leasium.\n"
                f"Month: {statements.month}\n"
                f"Entities included: {len(included)}\n"
                f"Invoiced cents: {total_invoiced}\n"
                f"Paid cents: {total_paid}\n"
                f"Outstanding cents: {total_outstanding}\n"
                "Use MANIFEST CSV for local entity-reporting review.\n"
                "Use INVOICE-EVIDENCE CSV to review the invoice-level source "
                "data behind local entity-reporting totals.\n"
                "No Xero posting, payment reconciliation, or provider delivery "
                "history mutation was performed.\n"
            )
        else:
            readme = (
                "Review-only owner statement pack generated by Leasium.\n"
                f"Month: {statements.month}\n"
                f"Owners included: {len(included)}\n"
                f"Invoiced cents: {total_invoiced}\n"
                f"Paid cents: {total_paid}\n"
                f"Outstanding cents: {total_outstanding}\n"
                f"Missing owner billing emails: {missing_recipients}\n"
                "Use MANIFEST CSV for accountant review and recipient readiness.\n"
                "Use INVOICE-EVIDENCE CSV to review the invoice-level source "
                "data behind owner totals.\n"
                "No owner email, Xero posting, payment reconciliation, or provider "
                "delivery history mutation was performed.\n"
            )
        archive.writestr(
            f"README-{statements.month}.txt",
            readme,
        )
    return buffer.getvalue()


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

    Groups properties by Owner/PropertyOwner links, then for each owner sums
    the InvoiceDraft totals whose `issue_date` falls in the target month.
    Unlinked properties remain visible in an Unattributed bucket. Paid totals
    come from `invoice_metadata.paid_cents` (written by Xero reconciliation).
    Outstanding = invoiced - paid, floored at zero so a payment overshoot
    doesn't show negative.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    return _build_owner_statements(entity_id, session, month)


@router.get("/statements/pdf")
def get_owner_statement_pdf(
    entity_id: UUID,
    owner_identity: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> Response:
    """Return a review-only PDF for one owner statement."""

    assert_entity_role(session, user, entity_id, READ_ROLES)
    statements = _build_owner_statements(entity_id, session, month)
    statement = next(
        (
            item
            for item in statements.owners
            if item.owner_identity.casefold() == owner_identity.casefold()
        ),
        None,
    )
    if statement is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner statement not found for this month.",
        )
    operating_mode = _statement_export_operating_mode(session, user)
    filename = _statement_filename(
        statement.owner_identity,
        statements.month,
        operating_mode,
    )
    return Response(
        content=_statement_pdf_bytes(statement, statements.month, operating_mode),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/statements/pdf-pack")
def get_owner_statement_pdf_pack(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> Response:
    """Return a review-only ZIP of every owner statement PDF for a month."""

    assert_entity_role(session, user, entity_id, READ_ROLES)
    statements = _build_owner_statements(entity_id, session, month)
    if not any(statement.invoice_count > 0 for statement in statements.owners):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No owner statements found for this month.",
        )
    operating_mode = _statement_export_operating_mode(session, user)
    filename = _statement_pack_filename(statements.month, operating_mode)
    return Response(
        content=_statement_pack_zip_bytes(statements, operating_mode),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_DISPATCH_GUARDRAIL = (
    "Owner statement dispatch only. Sending does not post to Xero, reconcile "
    "payments, dispatch invoices, or message tenants."
)


def _resolve_statement_month(month: str) -> str:
    """Resolve the canonical YYYY-MM, defaulting to the previous month."""

    if not month:
        today = date.today()
        if today.month == 1:
            target_year, target_month = today.year - 1, 12
        else:
            target_year, target_month = today.year, today.month - 1
        month = f"{target_year:04d}-{target_month:02d}"
    _, _, canonical_month = _parse_month(month)
    return canonical_month


def _dispatch_receipt(row: OwnerStatementDispatch) -> OwnerStatementDispatchReceipt:
    return OwnerStatementDispatchReceipt(
        id=row.id,
        entity_id=row.entity_id,
        owner_identity=row.owner_identity,
        month=row.month,
        channel=row.channel,
        provider=row.provider,
        status=row.status,
        recipient_email=row.recipient_email,
        subject=row.subject,
        provider_message_id=row.provider_message_id,
        error=row.error,
        invoice_count=row.invoice_count,
        invoiced_cents=row.invoiced_cents,
        outstanding_cents=row.outstanding_cents,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
    )


def _assert_owner_statement_dispatch_mode(session: Session, user: CurrentUser) -> None:
    organisation = session.scalar(
        select(Organisation).where(Organisation.id == user.organisation_id)
    )
    operating_mode = (
        organisation.operating_mode
        if organisation is not None
        else OperatingMode.self_managed_owner.value
    )
    if operating_mode not in {
        OperatingMode.managing_agent.value,
        OperatingMode.hybrid.value,
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Owner statement email dispatch is available only for "
                "managing-agent or hybrid accounts."
            ),
        )


@router.get("/statements/dispatch", response_model=OwnerStatementDispatchListRead)
def list_owner_statement_dispatch(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> OwnerStatementDispatchListRead:
    """Return owner-statement dispatch receipts for a month (read-only)."""

    assert_entity_role(session, user, entity_id, READ_ROLES)
    _assert_owner_statement_dispatch_mode(session, user)
    canonical_month = _resolve_statement_month(month)
    rows = list(
        session.scalars(
            select(OwnerStatementDispatch)
            .where(
                OwnerStatementDispatch.entity_id == entity_id,
                OwnerStatementDispatch.month == canonical_month,
            )
            .order_by(OwnerStatementDispatch.created_at.desc())
        ).all()
    )
    return OwnerStatementDispatchListRead(
        entity_id=entity_id,
        month=canonical_month,
        receipts=[_dispatch_receipt(row) for row in rows],
        guardrail=_DISPATCH_GUARDRAIL,
        generated_at=utcnow(),
    )


@router.post("/statements/send", response_model=OwnerStatementDispatchReceipt)
def send_owner_statement(
    entity_id: UUID,
    payload: OwnerStatementDispatchRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnerStatementDispatchReceipt:
    """Send one reviewed owner statement via SendGrid after explicit approval.

    Review-first guardrail: ``approve`` must be true (the operator's explicit
    per-owner approval for a real provider email). A statement that already
    has a live (queued / sent / delivered) receipt for the same owner + month
    is returned as-is unless ``resend`` is set, so accidental double-sends are
    blocked. Sending here never posts to Xero, reconciles payments, dispatches
    invoices, or messages tenants.
    """

    assert_entity_role(session, user, entity_id, DISPATCH_ROLES)
    _assert_owner_statement_dispatch_mode(session, user)
    if not payload.approve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explicit per-owner approval (approve=true) is required to send.",
        )

    statements = _build_owner_statements(entity_id, session, payload.month)
    statement = next(
        (
            item
            for item in statements.owners
            if item.owner_identity.casefold() == payload.owner_identity.casefold()
        ),
        None,
    )
    if statement is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner statement not found for this month.",
        )

    owner_key = statement.owner_identity.casefold()
    existing = session.scalars(
        select(OwnerStatementDispatch)
        .where(
            OwnerStatementDispatch.entity_id == entity_id,
            OwnerStatementDispatch.owner_identity_key == owner_key,
            OwnerStatementDispatch.month == statements.month,
            OwnerStatementDispatch.status.in_(("queued", "sent", "delivered")),
        )
        .order_by(OwnerStatementDispatch.created_at.desc())
    ).first()
    if existing is not None and not payload.resend:
        return _dispatch_receipt(existing)

    settings = get_settings()
    operating_mode = _statement_export_operating_mode(session, user)
    invite = OwnerStatementEmail(
        entity_id=entity_id,
        owner_identity=statement.owner_identity,
        month=statements.month,
        recipient_name=statement.billing_contact_name,
        recipient_email=statement.billing_email,
        invoiced_label=_format_money(statement.invoiced_cents),
        paid_label=_format_money(statement.paid_cents),
        outstanding_label=_format_money(statement.outstanding_cents),
        property_count=statement.property_count,
        invoice_count=statement.invoice_count,
        pdf_filename=_statement_filename(
            statement.owner_identity,
            statements.month,
            operating_mode,
        ),
        pdf_content=_statement_pdf_bytes(statement, statements.month, operating_mode),
        template_key=settings.owner_statement_email_template_key,
        template_version=settings.owner_statement_email_template_version,
    )
    result = send_owner_statement_email(invite, settings)

    row = OwnerStatementDispatch(
        entity_id=entity_id,
        owner_identity=statement.owner_identity,
        owner_identity_key=owner_key,
        month=statements.month,
        channel=result.channel,
        provider=result.provider,
        status=result.status,
        recipient_email=result.recipient or statement.billing_email,
        subject=result.metadata.get("subject"),
        provider_message_id=result.provider_message_id,
        error=result.error,
        invoice_count=statement.invoice_count,
        invoiced_cents=statement.invoiced_cents,
        outstanding_cents=statement.outstanding_cents,
        dispatch_metadata={
            "template_key": invite.template_key,
            "template_version": invite.template_version,
            "resend": payload.resend,
        },
        created_by_user_id=user.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _dispatch_receipt(row)


_DISTRIBUTION_GUARDRAIL = (
    "Owner distributions are review-only. Reviewing a distribution records the "
    "computed snapshot but moves no money, posts nothing to Xero, and makes no "
    "bank, payment-rail, or provider call. Payment execution is not available "
    "in this version."
)


def _assert_distribution_mode(session: Session, user: CurrentUser) -> None:
    organisation = session.scalar(
        select(Organisation).where(Organisation.id == user.organisation_id)
    )
    operating_mode = (
        organisation.operating_mode
        if organisation is not None
        else OperatingMode.self_managed_owner.value
    )
    if operating_mode not in {
        OperatingMode.managing_agent.value,
        OperatingMode.hybrid.value,
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Owner distributions are available only for managing-agent or "
                "hybrid accounts."
            ),
        )


def _entity_gst_registered(entity_id: UUID, session: Session) -> bool:
    entity = session.get(Entity, entity_id)
    # The managing agent (entity) is the supplier of the management service, so
    # GST on the fee follows the agent's registration. Default to registered to
    # match the Entity model default.
    return bool(entity.gst_registered) if entity is not None else True


def _owners_by_id(entity_id: UUID, session: Session) -> dict[UUID, Owner]:
    owners = session.scalars(
        select(Owner).where(
            Owner.entity_id == entity_id,
            Owner.deleted_at.is_(None),
        )
    ).all()
    return {owner.id: owner for owner in owners}


def _build_distribution_lines(
    entity_id: UUID,
    session: Session,
    month: str,
) -> tuple[OwnerStatementsRead, list[OwnerDistributionLine], bool]:
    statements = _build_owner_statements(entity_id, session, month)
    owners_by_id = _owners_by_id(entity_id, session)
    entity_gst_registered = _entity_gst_registered(entity_id, session)
    lines = compute_owner_distributions(
        statements, owners_by_id, entity_gst_registered
    )
    return statements, lines, entity_gst_registered


def _format_pct(value: float | None) -> str:
    if value is None:
        return "Not set"
    return f"{value:g}%"


def _distribution_pdf_bytes(
    month: str,
    entity_gst_registered: bool,
    lines: list[OwnerDistributionLine],
) -> bytes:
    """Render a review-only distribution summary PDF (no provider dependency).

    Mirrors ``_statement_pdf_bytes`` line/PDF infra. One row per owner with the
    management-fee breakdown and net distribution, plus totals and the period.
    """

    total_rent = sum(line.rent_collected_cents for line in lines)
    total_fee_ex_gst = sum(line.fee_ex_gst_cents for line in lines)
    total_gst = sum(line.fee_gst_cents for line in lines)
    total_fee_inc_gst = sum(line.fee_inc_gst_cents for line in lines)
    total_net = sum(line.net_distribution_cents for line in lines)
    needs_attention = sum(1 for line in lines if line.needs_attention)

    pdf_lines = [
        "LEASIUM OWNER DISTRIBUTIONS",
        "Review-only export. No payment made.",
        "",
        f"Month: {month}",
        f"GST: {'Registered' if entity_gst_registered else 'Not registered'}",
        f"Owners: {len(lines)}",
        f"Need attention: {needs_attention}",
        "",
        "Distribution breakdown",
        "Owner | Rent collected | Fee % | Fee ex-GST | GST | Fee inc-GST | Net distribution",
    ]
    for line in lines:
        pdf_lines.append(
            f"{line.owner_identity} | "
            f"{_format_money(line.rent_collected_cents)} | "
            f"{_format_pct(line.management_fee_pct)} | "
            f"{_format_money(line.fee_ex_gst_cents)} | "
            f"{_format_money(line.fee_gst_cents)} | "
            f"{_format_money(line.fee_inc_gst_cents)} | "
            f"{_format_money(line.net_distribution_cents)}"
            + (" | NEEDS ATTENTION (no fee set)" if line.needs_attention else "")
        )
    pdf_lines.extend(
        [
            "",
            "Totals",
            f"Rent collected: {_format_money(total_rent)}",
            f"Fee ex-GST: {_format_money(total_fee_ex_gst)}",
            f"GST: {_format_money(total_gst)}",
            f"Fee inc-GST: {_format_money(total_fee_inc_gst)}",
            f"Net to owners: {_format_money(total_net)}",
            "",
            (
                "Review only. This PDF moves no money, posts nothing to Xero, and "
                "makes no bank, payment-rail, or provider call. Payment execution "
                "is not available in this version."
            ),
        ]
    )
    return _render_pdf_lines(pdf_lines)


def _distribution_pdf_filename(month: str) -> str:
    return f"owner-distributions-{month}.pdf"


@router.get("/distributions/pdf")
def get_owner_distribution_pdf(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> Response:
    """Return a review-only PDF of the month's owner distribution summary.

    Managing-agent / hybrid only. Generates the document for operator review or
    download — it sends no email, posts nothing to Xero, and moves no money.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    _assert_distribution_mode(session, user)
    statements, lines, entity_gst_registered = _build_distribution_lines(
        entity_id, session, month
    )
    filename = _distribution_pdf_filename(statements.month)
    return Response(
        content=_distribution_pdf_bytes(
            statements.month, entity_gst_registered, lines
        ),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/distributions", response_model=OwnerDistributionsRead)
def get_owner_distributions(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> OwnerDistributionsRead:
    """Compute per-owner distributions for a month (read-only, no money moved)."""

    assert_entity_role(session, user, entity_id, READ_ROLES)
    _assert_distribution_mode(session, user)
    statements, lines, entity_gst_registered = _build_distribution_lines(
        entity_id, session, month
    )
    return OwnerDistributionsRead(
        entity_id=entity_id,
        month=statements.month,
        entity_gst_registered=entity_gst_registered,
        lines=lines,
        guardrail=_DISTRIBUTION_GUARDRAIL,
        generated_at=utcnow(),
    )


_DISTRIBUTION_DISPATCH_GUARDRAIL = (
    "Review-only distribution dispatch draft. Nothing is sent: this drafts an "
    "owner-facing summary for the operator to read, edit, or copy. It makes no "
    "SendGrid email, SMS, Xero, bank, or payment-rail call and moves no money. "
    "Per-owner sending is not available in this version."
)


def _build_distribution_dispatch_draft(
    line: OwnerDistributionLine,
    statement: OwnerStatementRead | None,
    month: str,
) -> OwnerDistributionDispatchDraft:
    """Build one review-only owner-facing dispatch draft (no send).

    Recipient readiness comes from the owner's ``billing_email`` (the same
    source the statement dispatch-review panel uses). The subject + body are a
    plain owner-facing summary of the net distribution for the period; they are
    never transmitted here.
    """

    recipient_email = statement.billing_email if statement else None
    recipient_name = statement.billing_contact_name if statement else None
    ready = bool(recipient_email)
    blocked_reason = (
        None
        if ready
        else "No owner billing email on record — add one before any send."
    )

    greeting = recipient_name or line.owner_identity
    subject = f"Your distribution for {month}"
    body_lines = [
        f"Hi {greeting},",
        "",
        f"Here is a summary of your distribution for {month}.",
        "",
        f"Rent collected: {_format_money(line.rent_collected_cents)}",
        (
            f"Management fee (inc GST): {_format_money(line.fee_inc_gst_cents)}"
            f" ({_format_pct(line.management_fee_pct)})"
        ),
        f"Net distribution: {_format_money(line.net_distribution_cents)}",
        "",
        "This is a draft for review only and has not been sent.",
    ]
    body = "\n".join(body_lines)

    return OwnerDistributionDispatchDraft(
        owner_id=line.owner_id,
        owner_identity=line.owner_identity,
        recipient_name=recipient_name,
        recipient_email=recipient_email,
        ready=ready,
        blocked_reason=blocked_reason,
        subject=subject,
        body=body,
        net_distribution_cents=line.net_distribution_cents,
        fee_inc_gst_cents=line.fee_inc_gst_cents,
        needs_attention=line.needs_attention,
    )


@router.get(
    "/distributions/dispatch-review",
    response_model=OwnerDistributionDispatchReviewRead,
)
def get_owner_distribution_dispatch_review(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
    owner_id: Annotated[
        UUID | None,
        Query(description="Optionally restrict the draft to one owner."),
    ] = None,
) -> OwnerDistributionDispatchReviewRead:
    """Draft a review-only owner-facing distribution dispatch per owner.

    Managing-agent / hybrid only. Mirrors the statement dispatch-review panel:
    it reports recipient readiness from the owner billing email and builds an
    owner-facing subject + body summarising the net distribution. It is a pure
    read/compute path — it sends nothing, writes nothing, and makes no provider,
    bank, or payment-rail call.

    Future explicit-send hook: an operator-approved
    ``POST /owners/distributions/dispatch`` (with ``approve=true`` per owner)
    would attach here to transmit a reviewed draft and persist a receipt. That
    send is deliberately not built in this version.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    _assert_distribution_mode(session, user)
    statements, lines, entity_gst_registered = _build_distribution_lines(
        entity_id, session, month
    )
    statements_by_owner = {
        item.owner_identity.casefold(): item for item in statements.owners
    }
    drafts = [
        _build_distribution_dispatch_draft(
            line,
            statements_by_owner.get(line.owner_identity.casefold()),
            statements.month,
        )
        for line in lines
        if owner_id is None or line.owner_id == owner_id
    ]
    return OwnerDistributionDispatchReviewRead(
        entity_id=entity_id,
        month=statements.month,
        entity_gst_registered=entity_gst_registered,
        drafts=drafts,
        guardrail=_DISTRIBUTION_DISPATCH_GUARDRAIL,
        generated_at=utcnow(),
    )


def _distribution_history_record(
    row: OwnerDistribution,
) -> OwnerDistributionHistoryRecord:
    return OwnerDistributionHistoryRecord(
        id=row.id,
        owner_id=row.owner_id,
        owner_identity=row.owner_identity,
        month=row.month,
        status=row.status,
        rent_collected_cents=row.rent_collected_cents,
        management_fee_pct=(
            float(row.management_fee_pct)
            if row.management_fee_pct is not None
            else None
        ),
        fee_ex_gst_cents=row.fee_ex_gst_cents,
        fee_gst_cents=row.fee_gst_cents,
        fee_inc_gst_cents=row.fee_inc_gst_cents,
        net_distribution_cents=row.net_distribution_cents,
        reviewed_by_user_id=row.reviewed_by_user_id,
        reviewed_at=row.reviewed_at,
        created_at=row.created_at,
    )


@router.get("/distributions/history", response_model=OwnerDistributionHistoryRead)
def list_owner_distribution_history(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    owner_id: Annotated[
        UUID | None,
        Query(description="Filter to one owner's reviewed distributions."),
    ] = None,
    month: Annotated[
        str,
        Query(description="Filter to a single YYYY-MM month."),
    ] = "",
) -> OwnerDistributionHistoryRead:
    """Return persisted (reviewed) owner-distribution records, newest first."""

    assert_entity_role(session, user, entity_id, READ_ROLES)
    _assert_distribution_mode(session, user)
    query = select(OwnerDistribution).where(
        OwnerDistribution.entity_id == entity_id
    )
    if owner_id is not None:
        query = query.where(OwnerDistribution.owner_id == owner_id)
    if month:
        _, _, canonical_month = _parse_month(month)
        query = query.where(OwnerDistribution.month == canonical_month)
    rows = list(
        session.scalars(
            query.order_by(OwnerDistribution.created_at.desc())
        ).all()
    )
    return OwnerDistributionHistoryRead(
        entity_id=entity_id,
        records=[_distribution_history_record(row) for row in rows],
        guardrail=_DISTRIBUTION_GUARDRAIL,
        generated_at=utcnow(),
    )


@router.post("/distributions/review", response_model=OwnerDistributionsRead)
def review_owner_distribution(
    entity_id: UUID,
    payload: OwnerDistributionReviewRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> OwnerDistributionsRead:
    """Freeze one owner's computed distribution as a reviewed record.

    Review-first guardrail: ``approve`` must be true (the operator's explicit
    per-owner approval). Reviewing records the computed snapshot with
    ``status=reviewed`` and moves no money. A future
    ``POST /owners/distributions/{id}/pay`` would call
    ``configured_rail(settings)`` to disburse the net amount; that is
    deliberately not built here.
    """

    assert_entity_role(session, user, entity_id, DISPATCH_ROLES)
    _assert_distribution_mode(session, user)
    if not payload.approve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Explicit per-owner approval (approve=true) is required to "
                "record a reviewed distribution."
            ),
        )

    statements, lines, entity_gst_registered = _build_distribution_lines(
        entity_id, session, month
    )
    line = next(
        (
            item
            for item in lines
            if item.owner_identity.casefold() == payload.owner_identity.casefold()
        ),
        None,
    )
    if line is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner distribution not found for this month.",
        )

    owner_key = line.owner_identity.casefold()
    existing = session.scalars(
        select(OwnerDistribution)
        .where(
            OwnerDistribution.entity_id == entity_id,
            OwnerDistribution.owner_identity_key == owner_key,
            OwnerDistribution.month == statements.month,
        )
        .order_by(OwnerDistribution.created_at.desc())
    ).first()

    now = utcnow()
    fee_pct = (
        Decimal(str(line.management_fee_pct))
        if line.management_fee_pct is not None
        else None
    )
    if existing is None:
        # NOTE: no rail / Xero / bank / provider call here — review only.
        existing = OwnerDistribution(
            entity_id=entity_id,
            owner_id=line.owner_id,
            owner_identity=line.owner_identity,
            owner_identity_key=owner_key,
            month=statements.month,
            status="reviewed",
            rent_collected_cents=line.rent_collected_cents,
            management_fee_pct=fee_pct,
            fee_ex_gst_cents=line.fee_ex_gst_cents,
            fee_gst_cents=line.fee_gst_cents,
            fee_inc_gst_cents=line.fee_inc_gst_cents,
            net_distribution_cents=line.net_distribution_cents,
            distribution_metadata={
                "entity_gst_registered": entity_gst_registered,
                "needs_attention": line.needs_attention,
            },
            created_by_user_id=user.id,
            reviewed_by_user_id=user.id,
            reviewed_at=now,
        )
        session.add(existing)
    else:
        # Idempotent re-review: refresh the frozen snapshot in place rather than
        # appending a second reviewed row for the same owner + month.
        existing.owner_id = line.owner_id
        existing.owner_identity = line.owner_identity
        existing.status = "reviewed"
        existing.rent_collected_cents = line.rent_collected_cents
        existing.management_fee_pct = fee_pct
        existing.fee_ex_gst_cents = line.fee_ex_gst_cents
        existing.fee_gst_cents = line.fee_gst_cents
        existing.fee_inc_gst_cents = line.fee_inc_gst_cents
        existing.net_distribution_cents = line.net_distribution_cents
        existing.distribution_metadata = {
            "entity_gst_registered": entity_gst_registered,
            "needs_attention": line.needs_attention,
        }
        existing.reviewed_by_user_id = user.id
        existing.reviewed_at = now
    session.commit()

    return OwnerDistributionsRead(
        entity_id=entity_id,
        month=statements.month,
        entity_gst_registered=entity_gst_registered,
        lines=lines,
        guardrail=_DISTRIBUTION_GUARDRAIL,
        generated_at=utcnow(),
    )
