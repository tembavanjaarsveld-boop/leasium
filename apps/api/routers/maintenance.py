"""Maintenance work order routes."""

from datetime import date, datetime
from enum import Enum
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AppUser,
    InvoiceDraft,
    Lease,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
    UserEntityRole,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.maintenance import (
    MaintenanceWorkOrderCommentCreate,
    MaintenanceWorkOrderCreate,
    MaintenanceWorkOrderRead,
    MaintenanceWorkOrderUpdate,
)

router = APIRouter(prefix="/maintenance/work-orders", tags=["maintenance"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

ACTIVITY_HISTORY_KEY = "activity_history"
COMMENTS_KEY = "comments"
ACTIVITY_TRACKED_FIELDS = (
    "status",
    "priority",
    "contractor_name",
    "contractor_email",
    "contractor_phone",
    "contractor_assigned_at",
    "quote_amount_cents",
    "approval_status",
    "approval_notes",
    "invoice_draft_id",
    "invoice_reference",
    "invoice_amount_cents",
    "due_date",
    "completed_at",
    "notes",
)
ACTIVITY_FIELD_LABELS = {
    "status": "status",
    "priority": "priority",
    "contractor_name": "contractor",
    "contractor_email": "contractor email",
    "contractor_phone": "contractor phone",
    "contractor_assigned_at": "contractor assigned date",
    "quote_amount_cents": "quote amount",
    "approval_status": "approval status",
    "approval_notes": "approval notes",
    "invoice_draft_id": "invoice link",
    "invoice_reference": "invoice reference",
    "invoice_amount_cents": "invoice amount",
    "due_date": "due date",
    "completed_at": "completed date",
    "notes": "notes",
}


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{name} not found.")


def _activity_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def _activity_summary(changed_fields: list[str]) -> str:
    labels = [ACTIVITY_FIELD_LABELS[field] for field in changed_fields]
    if len(labels) == 1:
        return f"Updated {labels[0]}."
    if len(labels) == 2:
        return f"Updated {labels[0]} and {labels[1]}."
    return f"Updated {', '.join(labels[:-1])}, and {labels[-1]}."


def _activity_entry(
    *,
    actor: str,
    source: str,
    event: str,
    summary: str,
    status_value: Any | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "timestamp": utcnow().isoformat(),
        "actor": actor,
        "source": source,
        "event": event,
        "summary": summary,
    }
    if status_value is not None:
        entry["status"] = _activity_value(status_value)
    return entry


def _append_activity_history(
    metadata: dict[str, Any] | None,
    entry: dict[str, Any],
) -> dict[str, Any]:
    next_metadata = dict(metadata or {})
    current_history = next_metadata.get(ACTIVITY_HISTORY_KEY)
    history = list(current_history) if isinstance(current_history, list) else []
    history.append(entry)
    next_metadata[ACTIVITY_HISTORY_KEY] = history
    return next_metadata


def _append_comment(
    metadata: dict[str, Any] | None,
    *,
    actor: str,
    body: str,
    visibility: str,
) -> dict[str, Any]:
    next_metadata = dict(metadata or {})
    existing_comments = next_metadata.get(COMMENTS_KEY)
    comments = list(existing_comments) if isinstance(existing_comments, list) else []
    timestamp = utcnow().isoformat()
    comment = {
        "timestamp": timestamp,
        "actor": actor,
        "visibility": visibility,
        "body": body.strip(),
    }
    comments.append(comment)
    next_metadata[COMMENTS_KEY] = comments
    return _append_activity_history(
        next_metadata,
        {
            **comment,
            "source": "operator_api",
            "event": "comment_added",
            "summary": body.strip(),
        },
    )


def _tracked_activity_changes(
    work_order: MaintenanceWorkOrder,
    data: dict[str, Any],
) -> list[str]:
    changed: list[str] = []
    for field in ACTIVITY_TRACKED_FIELDS:
        if field not in data:
            continue
        if _activity_value(getattr(work_order, field)) != _activity_value(data[field]):
            changed.append(field)
    return changed


def _property_for_entity(property_id: UUID, entity_id: UUID, session: Session) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None or prop.entity_id != entity_id:
        raise _not_found("Property")
    return prop


def _unit_for_entity(
    tenancy_unit_id: UUID, entity_id: UUID, session: Session
) -> tuple[TenancyUnit, Property]:
    unit = session.get(TenancyUnit, tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise _not_found("Tenancy unit")
    prop = _property_for_entity(unit.property_id, entity_id, session)
    return unit, prop


def _tenant_for_entity(tenant_id: UUID, entity_id: UUID, session: Session) -> Tenant:
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None or tenant.entity_id != entity_id:
        raise _not_found("Tenant")
    return tenant


def _lease_for_entity(
    lease_id: UUID, entity_id: UUID, session: Session
) -> tuple[Lease, TenancyUnit, Property, Tenant]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise _not_found("Lease")
    unit, prop = _unit_for_entity(lease.tenancy_unit_id, entity_id, session)
    tenant = _tenant_for_entity(lease.tenant_id, entity_id, session)
    if prop.entity_id != tenant.entity_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease links tenant and unit across different entities.",
        )
    return lease, unit, prop, tenant


def _user_for_entity(user_id: UUID, entity_id: UUID, session: Session) -> AppUser:
    app_user = session.get(AppUser, user_id)
    if app_user is None or not app_user.is_active:
        raise _not_found("User")
    role = session.scalar(
        select(UserEntityRole).where(
            UserEntityRole.user_id == user_id,
            UserEntityRole.entity_id == entity_id,
        )
    )
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="User must have access to the work order entity.",
        )
    return app_user


def _validate_scope(
    *,
    entity_id: UUID,
    property_id: UUID | None,
    tenancy_unit_id: UUID | None,
    tenant_id: UUID | None,
    lease_id: UUID | None,
    session: Session,
) -> tuple[UUID | None, UUID | None, UUID | None, UUID | None]:
    if property_id is not None:
        _property_for_entity(property_id, entity_id, session)

    if tenancy_unit_id is not None:
        unit, prop = _unit_for_entity(tenancy_unit_id, entity_id, session)
        if property_id is not None and property_id != prop.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Tenancy unit must belong to the work order property.",
            )
        property_id = prop.id
        tenancy_unit_id = unit.id

    if tenant_id is not None:
        tenant = _tenant_for_entity(tenant_id, entity_id, session)
        tenant_id = tenant.id

    if lease_id is not None:
        lease, unit, prop, tenant = _lease_for_entity(lease_id, entity_id, session)
        if tenancy_unit_id is not None and tenancy_unit_id != lease.tenancy_unit_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the work order tenancy unit.",
            )
        if property_id is not None and property_id != prop.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the work order property.",
            )
        if tenant_id is not None and tenant_id != lease.tenant_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the work order tenant.",
            )
        property_id = prop.id
        tenancy_unit_id = unit.id
        tenant_id = tenant.id
        lease_id = lease.id

    return property_id, tenancy_unit_id, tenant_id, lease_id


def _document_for_entity(document_id: UUID, entity_id: UUID, session: Session) -> StoredDocument:
    document = session.get(StoredDocument, document_id)
    if document is None or document.deleted_at is not None or document.entity_id != entity_id:
        raise _not_found("Document")
    return document


def _document_id_strings(
    document_ids: list[UUID], entity_id: UUID, session: Session
) -> list[str]:
    validated: list[str] = []
    seen: set[UUID] = set()
    for document_id in document_ids:
        if document_id in seen:
            continue
        seen.add(document_id)
        validated.append(str(_document_for_entity(document_id, entity_id, session).id))
    return validated


def _invoice_draft_for_entity(
    invoice_draft_id: UUID, entity_id: UUID, session: Session
) -> InvoiceDraft:
    draft = session.get(InvoiceDraft, invoice_draft_id)
    if draft is None or draft.deleted_at is not None or draft.entity_id != entity_id:
        raise _not_found("Invoice draft")
    return draft


def _attachments_from_payload(
    data: dict[str, Any],
    current: dict[str, Any],
    entity_id: UUID,
    session: Session,
) -> dict[str, Any]:
    attachments = dict(current or {})
    if "document_ids" in data:
        attachments["document_ids"] = _document_id_strings(
            data.pop("document_ids") or [], entity_id, session
        )
    if "photo_document_ids" in data:
        attachments["photo_document_ids"] = _document_id_strings(
            data.pop("photo_document_ids") or [], entity_id, session
        )
    return attachments


def _validate_linked_records(data: dict[str, Any], entity_id: UUID, session: Session) -> None:
    source_document_id = data.get("source_document_id")
    if source_document_id is not None:
        _document_for_entity(source_document_id, entity_id, session)
    invoice_draft_id = data.get("invoice_draft_id")
    if invoice_draft_id is not None:
        _invoice_draft_for_entity(invoice_draft_id, entity_id, session)
    approved_by_user_id = data.get("approved_by_user_id")
    if approved_by_user_id is not None:
        _user_for_entity(approved_by_user_id, entity_id, session)


def _work_order_for_user(
    work_order_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> MaintenanceWorkOrder:
    work_order = session.get(MaintenanceWorkOrder, work_order_id)
    if work_order is None or work_order.deleted_at is not None:
        raise _not_found("Maintenance work order")
    assert_entity_role(session, user, work_order.entity_id, roles)
    return work_order


@router.get("", response_model=list[MaintenanceWorkOrderRead])
def list_work_orders(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    property_id: UUID | None = None,
    tenant_id: UUID | None = None,
    status_filter: Annotated[MaintenanceWorkOrderStatus | None, Query(alias="status")] = None,
    priority: MaintenancePriority | None = None,
    include_deleted: bool = False,
) -> list[MaintenanceWorkOrder]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = select(MaintenanceWorkOrder).where(MaintenanceWorkOrder.entity_id == entity_id)
    if property_id is not None:
        _property_for_entity(property_id, entity_id, session)
        statement = statement.where(MaintenanceWorkOrder.property_id == property_id)
    if tenant_id is not None:
        _tenant_for_entity(tenant_id, entity_id, session)
        statement = statement.where(MaintenanceWorkOrder.tenant_id == tenant_id)
    if status_filter is not None:
        statement = statement.where(MaintenanceWorkOrder.status == status_filter)
    if priority is not None:
        statement = statement.where(MaintenanceWorkOrder.priority == priority)
    if not include_deleted:
        statement = statement.where(MaintenanceWorkOrder.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(MaintenanceWorkOrder.created_at.desc())))


@router.post(
    "",
    response_model=MaintenanceWorkOrderRead,
    status_code=status.HTTP_201_CREATED,
)
def create_work_order(
    payload: MaintenanceWorkOrderCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> MaintenanceWorkOrder:
    data = payload.model_dump()
    entity_id = data["entity_id"]
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    property_id, tenancy_unit_id, tenant_id, lease_id = _validate_scope(
        entity_id=entity_id,
        property_id=data["property_id"],
        tenancy_unit_id=data["tenancy_unit_id"],
        tenant_id=data["tenant_id"],
        lease_id=data["lease_id"],
        session=session,
    )
    data["property_id"] = property_id
    data["tenancy_unit_id"] = tenancy_unit_id
    data["tenant_id"] = tenant_id
    data["lease_id"] = lease_id
    if data["requested_at"] is None:
        data.pop("requested_at")
    data["attachments"] = _attachments_from_payload(data, {}, entity_id, session)
    metadata = data.pop("metadata")
    data["work_order_metadata"] = _append_activity_history(
        metadata,
        _activity_entry(
            actor=user.actor,
            source="operator_api",
            event="created",
            summary="Work order created.",
            status_value=data["status"],
        ),
    )
    _validate_linked_records(data, entity_id, session)

    work_order = MaintenanceWorkOrder(**data)
    session.add(work_order)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=work_order.entity_id,
        action="create",
        target_table="maintenance_work_order",
        target_id=work_order.id,
    )
    session.commit()
    session.refresh(work_order)
    return work_order


@router.post("/{work_order_id}/comments", response_model=MaintenanceWorkOrderRead)
def add_work_order_comment(
    work_order_id: UUID,
    payload: MaintenanceWorkOrderCommentCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> MaintenanceWorkOrder:
    work_order = _work_order_for_user(work_order_id, user, session, WRITE_ROLES)
    body = payload.body.strip()
    if not body:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Comment cannot be blank.",
        )
    work_order.work_order_metadata = _append_comment(
        work_order.work_order_metadata,
        actor=user.actor,
        body=body,
        visibility=payload.visibility,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=work_order.entity_id,
        action="update",
        target_table="maintenance_work_order",
        target_id=work_order.id,
    )
    session.commit()
    session.refresh(work_order)
    return work_order


@router.get("/{work_order_id}", response_model=MaintenanceWorkOrderRead)
def get_work_order(
    work_order_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> MaintenanceWorkOrder:
    return _work_order_for_user(work_order_id, user, session, READ_ROLES)


@router.patch("/{work_order_id}", response_model=MaintenanceWorkOrderRead)
def update_work_order(
    work_order_id: UUID,
    payload: MaintenanceWorkOrderUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> MaintenanceWorkOrder:
    work_order = _work_order_for_user(work_order_id, user, session, WRITE_ROLES)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    property_id, tenancy_unit_id, tenant_id, lease_id = _validate_scope(
        entity_id=work_order.entity_id,
        property_id=data.get("property_id", work_order.property_id),
        tenancy_unit_id=data.get("tenancy_unit_id", work_order.tenancy_unit_id),
        tenant_id=data.get("tenant_id", work_order.tenant_id),
        lease_id=data.get("lease_id", work_order.lease_id),
        session=session,
    )
    data["property_id"] = property_id
    data["tenancy_unit_id"] = tenancy_unit_id
    data["tenant_id"] = tenant_id
    data["lease_id"] = lease_id
    if "document_ids" in data or "photo_document_ids" in data:
        data["attachments"] = _attachments_from_payload(
            data, work_order.attachments or {}, work_order.entity_id, session
        )
    payload_metadata = data.pop("metadata", None) if "metadata" in data else None
    _validate_linked_records(data, work_order.entity_id, session)

    changed_fields = _tracked_activity_changes(work_order, data)
    if payload_metadata is not None:
        work_order.work_order_metadata = {
            **(work_order.work_order_metadata or {}),
            **payload_metadata,
        }
    if changed_fields:
        work_order.work_order_metadata = _append_activity_history(
            work_order.work_order_metadata,
            _activity_entry(
                actor=user.actor,
                source="operator_api",
                event="updated",
                summary=_activity_summary(changed_fields),
                status_value=data.get("status", work_order.status),
            ),
        )
    for key, value in data.items():
        setattr(work_order, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=work_order.entity_id,
        action="update",
        target_table="maintenance_work_order",
        target_id=work_order.id,
    )
    session.commit()
    session.refresh(work_order)
    return work_order


@router.delete("/{work_order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_work_order(
    work_order_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    work_order = _work_order_for_user(work_order_id, user, session, WRITE_ROLES)
    work_order.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=work_order.entity_id,
        action="delete",
        target_table="maintenance_work_order",
        target_id=work_order.id,
    )
    session.commit()
