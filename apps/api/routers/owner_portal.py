"""Read-only owner portal preview routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Owner, Property, PropertyOwner, UserRole

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.owners import _build_owner_statements
from apps.api.schemas.owner_portal import (
    OwnerPortalAuthRead,
    OwnerPortalOwnerRead,
    OwnerPortalPropertyRead,
    OwnerPortalRead,
    OwnerPortalStatementPropertyRead,
    OwnerPortalStatementRead,
)
from apps.api.schemas.owners import OwnerStatementRead

router = APIRouter(prefix="/owner-portal", tags=["owner-portal"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}

OWNER_PORTAL_GUARDRAILS = [
    (
        "Read-only owner portal preview: viewing this page does not send owner "
        "email, download or send PDFs, write Xero data, reconcile payments, "
        "dispatch invoices, refresh providers, or mutate provider history."
    )
]


def _owner_display_name(owner: Owner) -> str:
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
    return "Unnamed owner"


def _owner_read(owner: Owner) -> OwnerPortalOwnerRead:
    return OwnerPortalOwnerRead(
        id=owner.id,
        entity_id=owner.entity_id,
        display_name=_owner_display_name(owner),
        legal_name=owner.legal_name,
        abn=owner.abn,
        trustee_name=owner.trustee_name,
        trust_name=owner.trust_name,
        invoice_issuer_name=owner.invoice_issuer_name,
        billing_contact_name=owner.billing_contact_name,
        billing_email=owner.billing_email,
        invoice_reference=owner.invoice_reference,
        gst_registered=owner.gst_registered,
    )


def _linked_properties(owner: Owner, session: Session) -> list[OwnerPortalPropertyRead]:
    rows = session.execute(
        select(PropertyOwner.property_id, Property.name, PropertyOwner.split_pct)
        .join(Property, Property.id == PropertyOwner.property_id)
        .where(
            PropertyOwner.owner_id == owner.id,
            Property.entity_id == owner.entity_id,
            Property.deleted_at.is_(None),
        )
        .order_by(Property.name.asc())
    ).all()
    return [
        OwnerPortalPropertyRead(
            property_id=property_id,
            property_name=property_name,
            split_pct=float(split_pct),
        )
        for property_id, property_name, split_pct in rows
    ]


def _statement_matches_owner(
    owner: Owner,
    statement: OwnerStatementRead,
    property_ids: set[UUID],
) -> bool:
    statement_property_ids = {line.property_id for line in statement.properties}
    if statement_property_ids != property_ids:
        return False
    if statement.owner_identity == _owner_display_name(owner):
        return True
    return (
        statement.owner_legal_name == owner.legal_name
        and statement.trustee_name == owner.trustee_name
        and statement.trust_name == owner.trust_name
        and statement.invoice_issuer_name == owner.invoice_issuer_name
    )


def _statement_read(
    owner: Owner,
    statements: list[OwnerStatementRead],
    month: str,
    property_ids: set[UUID],
) -> OwnerPortalStatementRead | None:
    if not property_ids:
        return None
    for statement in statements:
        if _statement_matches_owner(owner, statement, property_ids):
            return OwnerPortalStatementRead(
                month=month,
                owner_identity=statement.owner_identity,
                property_count=statement.property_count,
                properties=[
                    OwnerPortalStatementPropertyRead(
                        property_id=line.property_id,
                        property_name=line.property_name,
                        invoiced_cents=line.invoiced_cents,
                        paid_cents=line.paid_cents,
                        outstanding_cents=line.outstanding_cents,
                        invoice_count=line.invoice_count,
                    )
                    for line in statement.properties
                ],
                invoiced_cents=statement.invoiced_cents,
                paid_cents=statement.paid_cents,
                outstanding_cents=statement.outstanding_cents,
                invoice_count=statement.invoice_count,
            )
    return None


@router.get("/{owner_id}", response_model=OwnerPortalRead)
def get_owner_portal_preview(
    owner_id: UUID,
    month: Annotated[
        str,
        Query(
            pattern=r"^\d{4}-\d{2}$",
            description="Statement month in YYYY-MM format.",
        ),
    ],
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnerPortalRead:
    """Return a read-only operator preview of one owner's portal."""

    owner = session.get(Owner, owner_id)
    if owner is None or owner.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Owner not found."
        )
    assert_entity_role(session, user, owner.entity_id, READ_ROLES)

    properties = _linked_properties(owner, session)
    property_ids = {row.property_id for row in properties}
    owner_statements = _build_owner_statements(owner.entity_id, session, month)
    statement = _statement_read(
        owner=owner,
        statements=owner_statements.owners,
        month=owner_statements.month,
        property_ids=property_ids,
    )
    return OwnerPortalRead(
        auth=OwnerPortalAuthRead(
            mode="operator_preview",
            boundary="operator_session",
            detail=(
                "Read-only operator preview scoped by entity role; no owner "
                "portal account is created."
            ),
        ),
        owner=_owner_read(owner),
        properties=properties,
        statement=statement,
        guardrails=OWNER_PORTAL_GUARDRAILS,
        generated_at=owner_statements.generated_at,
    )
