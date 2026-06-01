"""Read-only vendor portal preview routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    Contractor,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.vendor_portal import (
    VendorPortalAuthRead,
    VendorPortalCommentRead,
    VendorPortalRead,
    VendorPortalVendorRead,
    VendorPortalWorkOrderItemRead,
    VendorPortalWorkOrdersRead,
)

router = APIRouter(prefix="/vendor-portal", tags=["vendor-portal"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}

VENDOR_PORTAL_GUARDRAILS = [
    (
        "Read-only vendor portal: opening this page does not send contractor "
        "email or SMS, dispatch work, refresh providers, write Xero data, "
        "reconcile payments, or mutate provider history."
    ),
    (
        "Work orders are shown only when explicitly marked vendor-visible; "
        "tenant identity, internal notes, provider evidence, and payment "
        "identifiers stay inside the operator workspace."
    ),
]

VENDOR_PORTAL_VISIBLE_KEY = "vendor_portal_visible"
VENDOR_PORTAL_CONTRACTOR_ID_KEY = "vendor_portal_contractor_id"
VENDOR_PORTAL_TITLE_KEY = "vendor_portal_title"
VENDOR_PORTAL_OPEN_STATUSES = {
    MaintenanceWorkOrderStatus.requested,
    MaintenanceWorkOrderStatus.triaged,
    MaintenanceWorkOrderStatus.assigned,
    MaintenanceWorkOrderStatus.awaiting_approval,
    MaintenanceWorkOrderStatus.approved,
    MaintenanceWorkOrderStatus.in_progress,
}


def _metadata_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _metadata_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _normalise_text(value: str | None) -> str:
    return (value or "").strip().casefold()


def _vendor_portal_title(metadata: dict[str, object]) -> str:
    return _metadata_text(metadata.get(VENDOR_PORTAL_TITLE_KEY)) or "Maintenance item"


def _matches_contractor(
    contractor: Contractor,
    metadata: dict[str, object],
) -> bool:
    return str(metadata.get(VENDOR_PORTAL_CONTRACTOR_ID_KEY) or "") == str(contractor.id)


def _vendor_comments(metadata: dict[str, object]) -> list[VendorPortalCommentRead]:
    comments = metadata.get("comments")
    if not isinstance(comments, list):
        return []

    safe_comments: list[VendorPortalCommentRead] = []
    for comment in comments:
        if not isinstance(comment, dict):
            continue
        if _normalise_text(comment.get("visibility")) not in {"contractor", "vendor"}:
            continue
        body = _metadata_text(comment.get("body"))
        if body is None:
            continue
        safe_comments.append(
            VendorPortalCommentRead(
                body=body,
                timestamp=_metadata_text(comment.get("timestamp")),
            )
        )
    return safe_comments


def _vendor_work_orders(
    contractor: Contractor,
    session: Session,
) -> VendorPortalWorkOrdersRead:
    rows = list(
        session.scalars(
            select(MaintenanceWorkOrder)
            .join(Property, Property.id == MaintenanceWorkOrder.property_id)
            .where(
                MaintenanceWorkOrder.entity_id == contractor.entity_id,
                MaintenanceWorkOrder.status.in_(VENDOR_PORTAL_OPEN_STATUSES),
                MaintenanceWorkOrder.deleted_at.is_(None),
                Property.entity_id == contractor.entity_id,
                Property.deleted_at.is_(None),
            )
            .order_by(
                MaintenanceWorkOrder.due_date.asc().nullslast(),
                MaintenanceWorkOrder.requested_at.desc(),
            )
        ).all()
    )

    items: list[VendorPortalWorkOrderItemRead] = []
    for row in rows:
        metadata = _metadata_dict(row.work_order_metadata)
        if metadata.get(VENDOR_PORTAL_VISIBLE_KEY) is not True:
            continue
        if not _matches_contractor(contractor, metadata):
            continue
        if row.property_id is None or row.property is None:
            continue
        items.append(
            VendorPortalWorkOrderItemRead(
                id=row.id,
                property_id=row.property_id,
                property_name=row.property.name,
                title=_vendor_portal_title(metadata),
                status=row.status,
                priority=row.priority,
                requested_at=row.requested_at,
                due_date=row.due_date,
                contractor_assigned_at=row.contractor_assigned_at,
                quote_amount_cents=row.quote_amount_cents,
                comments=_vendor_comments(metadata),
            )
        )

    today = utcnow().date()
    return VendorPortalWorkOrdersRead(
        open_count=len(items),
        urgent_count=sum(1 for item in items if item.priority == MaintenancePriority.urgent),
        overdue_count=sum(1 for item in items if item.due_date and item.due_date < today),
        items=items,
    )


def _get_contractor_for_user(
    contractor_id: UUID,
    user: CurrentUser,
    session: Session,
) -> Contractor:
    contractor = session.get(Contractor, contractor_id)
    if contractor is None or contractor.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor portal not found.",
        )
    assert_entity_role(session, user, contractor.entity_id, READ_ROLES)
    return contractor


@router.get("/{contractor_id}", response_model=VendorPortalRead)
def get_vendor_portal(
    contractor_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> VendorPortalRead:
    """Return a contractor-safe, read-only operator preview."""

    contractor = _get_contractor_for_user(contractor_id, user, session)
    return VendorPortalRead(
        auth=VendorPortalAuthRead(
            mode="operator_preview",
            token_source="bearer",
            vendor_auth_configured=False,
            boundary="operator_session",
            detail=(
                "Read-only operator preview scoped by entity role; no vendor portal "
                "account is created."
            ),
        ),
        vendor=VendorPortalVendorRead(
            id=contractor.id,
            entity_id=contractor.entity_id,
            name=contractor.name,
            company_name=contractor.company_name,
            categories=list(contractor.categories or []),
            email=contractor.email,
            phone=contractor.phone,
            service_radius_km=contractor.service_radius_km,
            priority=contractor.priority,
        ),
        work_orders=_vendor_work_orders(contractor, session),
        guardrails=VENDOR_PORTAL_GUARDRAILS,
        generated_at=utcnow(),
    )
