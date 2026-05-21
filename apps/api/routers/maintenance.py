"""Maintenance work order routes."""

import secrets
from datetime import date, datetime
from enum import Enum
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
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
from stewart.core.settings import get_settings
from stewart.integrations.communications import (
    ContractorWorkOrderEmail,
    DeliveryResult,
    send_contractor_work_order_email,
    send_work_assignment_email,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.maintenance import (
    MaintenanceWorkOrderCommentCreate,
    MaintenanceWorkOrderContractorEmailSend,
    MaintenanceWorkOrderCreate,
    MaintenanceWorkOrderRead,
    MaintenanceWorkOrderUpdate,
)
from apps.api.work_assignments import (
    assignment_notification_sent,
    record_work_assignment_delivery,
    work_assignment_email_invite,
    work_url,
)

router = APIRouter(prefix="/maintenance/work-orders", tags=["maintenance"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

ACTIVITY_HISTORY_KEY = "activity_history"
COMMENTS_KEY = "comments"
CONTRACTOR_DELIVERY_KEY = "contractor_delivery"
ACTIVITY_TRACKED_FIELDS = (
    "title",
    "description",
    "property_id",
    "tenancy_unit_id",
    "tenant_id",
    "lease_id",
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
    "title": "title",
    "description": "description",
    "property_id": "property link",
    "tenancy_unit_id": "unit link",
    "tenant_id": "tenant link",
    "lease_id": "lease link",
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


def _delivery_dict(value: object) -> dict[str, object]:
    return dict(cast(dict[str, object], value)) if isinstance(value, dict) else {}


def _delivery_list(value: object) -> list[object]:
    return list(cast(list[object], value)) if isinstance(value, list) else []


def _contractor_email_default_subject(work_order: MaintenanceWorkOrder) -> str:
    return f"Maintenance update: {work_order.title}"


def _property_address(prop: Property | None) -> str | None:
    if prop is None:
        return None
    parts = [prop.street_address, prop.suburb, prop.state, prop.postcode]
    return ", ".join(part for part in parts if part)


def _contractor_work_order_email(
    work_order: MaintenanceWorkOrder,
    payload: MaintenanceWorkOrderContractorEmailSend,
    session: Session,
) -> ContractorWorkOrderEmail:
    settings = get_settings()
    prop = session.get(Property, work_order.property_id) if work_order.property_id else None
    unit = (
        session.get(TenancyUnit, work_order.tenancy_unit_id) if work_order.tenancy_unit_id else None
    )
    tenant = session.get(Tenant, work_order.tenant_id) if work_order.tenant_id else None
    tenant_name = None
    if tenant is not None:
        tenant_name = tenant.trading_name or tenant.legal_name
    return ContractorWorkOrderEmail(
        work_order_id=work_order.id,
        entity_id=work_order.entity_id,
        title=work_order.title,
        description=work_order.description,
        priority=str(_activity_value(work_order.priority)),
        status=str(_activity_value(work_order.status)),
        property_name=prop.name if prop is not None else "Portfolio",
        property_address=_property_address(prop),
        unit_label=unit.unit_label if unit is not None else None,
        tenant_name=tenant_name,
        contractor_name=work_order.contractor_name,
        contractor_email=work_order.contractor_email,
        due_date=work_order.due_date,
        subject=payload.subject.strip()
        if payload.subject and payload.subject.strip()
        else _contractor_email_default_subject(work_order),
        body=payload.body.strip(),
        template_key=settings.contractor_email_template_key,
        template_version=settings.contractor_email_template_version,
    )


def _record_contractor_provider_delivery(
    work_order: MaintenanceWorkOrder,
    metadata: dict[str, Any] | None,
    *,
    invite: ContractorWorkOrderEmail,
    result: DeliveryResult,
    user: CurrentUser,
) -> dict[str, Any]:
    result_dict = result.to_dict()
    status_value = str(result_dict.get("status") or "failed")
    recorded_at = str(result_dict.get("attempted_at") or utcnow().isoformat())
    delivery_metadata = dict(metadata or {})
    contractor_delivery = _delivery_dict(delivery_metadata.get(CONTRACTOR_DELIVERY_KEY))
    email_delivery = _delivery_dict(contractor_delivery.get("email"))
    delivered = status_value in {"queued", "sent", "delivered", "opened"}
    history = _delivery_list(email_delivery.get("history"))
    retry_count = (
        sum(
            1
            for entry in history
            if isinstance(entry, dict) and entry.get("event") == "provider_delivery_attempted"
        )
        + 1
    )

    email_delivery["send"] = {
        "status": status_value,
        "provider": result_dict.get("provider") or "sendgrid",
        "attempted_at": recorded_at,
        "sent_at": recorded_at if delivered else None,
        "sent_by_user_id": str(user.id),
        "provider_message_id": result_dict.get("provider_message_id"),
        "recipient_email": result_dict.get("recipient") or work_order.contractor_email,
        "subject": invite.subject,
        "body": invite.body,
        "error": result_dict.get("error"),
        "template_key": invite.template_key,
        "template_version": invite.template_version,
        "retry_count": retry_count,
    }
    receipts = _delivery_list(email_delivery.get("receipts"))
    receipts.insert(
        0,
        {
            "received_at": recorded_at,
            "channel": "email",
            "status": status_value,
            "provider": result_dict.get("provider") or "sendgrid",
            "recipient_email": result_dict.get("recipient") or work_order.contractor_email,
            "provider_message_id": result_dict.get("provider_message_id"),
            "error": result_dict.get("error"),
            "subject": invite.subject,
            "template_key": invite.template_key,
            "template_version": invite.template_version,
            "retry_count": retry_count,
        },
    )
    history.append(
        {
            "event": "provider_delivery_attempted",
            "at": recorded_at,
            "user_id": str(user.id),
            "provider": result_dict.get("provider") or "sendgrid",
            "status": status_value,
            "recipient_email": result_dict.get("recipient") or work_order.contractor_email,
            "provider_message_id": result_dict.get("provider_message_id"),
            "error": result_dict.get("error"),
            "subject": invite.subject,
            "template_key": invite.template_key,
            "template_version": invite.template_version,
            "retry_count": retry_count,
        }
    )
    email_delivery["receipts"] = receipts[:20]
    email_delivery["history"] = history
    contractor_delivery["email"] = email_delivery
    delivery_metadata[CONTRACTOR_DELIVERY_KEY] = contractor_delivery
    return _append_activity_history(
        delivery_metadata,
        _activity_entry(
            actor=user.actor,
            source="operator_api",
            event="contractor_email_attempted",
            summary=f"Contractor email {status_value}.",
            status_value=work_order.status,
        ),
    )


def _assert_webhook_secret(request: Request) -> None:
    secret = get_settings().communications_webhook_secret
    if not secret:
        return
    provided = request.headers.get("x-leasium-webhook-secret") or request.query_params.get("token")
    if not provided or not secrets.compare_digest(provided, secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook token.",
        )


def _contractor_email_receipt_status(raw_status: str) -> str:
    value = raw_status.lower()
    if value in {"processed", "deferred"}:
        return "sent" if value == "processed" else "attention"
    if value == "delivered":
        return "delivered"
    if value in {"open", "click"}:
        return "opened"
    if value in {"bounce", "dropped", "spamreport", "unsubscribe", "group_unsubscribe"}:
        return "failed"
    return "attention"


def _find_work_order_by_message_id(
    session: Session,
    provider_message_id: str,
) -> MaintenanceWorkOrder | None:
    rows = session.scalars(
        select(MaintenanceWorkOrder).where(MaintenanceWorkOrder.deleted_at.is_(None))
    ).all()
    for work_order in rows:
        metadata = work_order.work_order_metadata or {}
        contractor_delivery = metadata.get(CONTRACTOR_DELIVERY_KEY)
        email_delivery = (
            contractor_delivery.get("email") if isinstance(contractor_delivery, dict) else None
        )
        send_state = email_delivery.get("send") if isinstance(email_delivery, dict) else None
        if (
            isinstance(send_state, dict)
            and send_state.get("provider_message_id") == provider_message_id
        ):
            return work_order
        receipts = email_delivery.get("receipts") if isinstance(email_delivery, dict) else None
        if not isinstance(receipts, list):
            continue
        for receipt in receipts:
            if (
                isinstance(receipt, dict)
                and receipt.get("provider_message_id") == provider_message_id
            ):
                return work_order
    return None


def _apply_contractor_email_receipt(
    work_order: MaintenanceWorkOrder,
    raw_status: str,
    provider_message_id: str | None,
    event: dict[str, object],
) -> None:
    now = utcnow().isoformat()
    status_value = _contractor_email_receipt_status(raw_status)
    metadata = dict(work_order.work_order_metadata or {})
    contractor_delivery = _delivery_dict(metadata.get(CONTRACTOR_DELIVERY_KEY))
    email_delivery = _delivery_dict(contractor_delivery.get("email"))
    send_state = _delivery_dict(email_delivery.get("send"))
    retry_count = (
        send_state.get("retry_count") if isinstance(send_state.get("retry_count"), int) else None
    )
    send_state.update(
        {
            "status": status_value,
            "provider": "sendgrid",
            "provider_message_id": provider_message_id or send_state.get("provider_message_id"),
            "receipt_at": now,
            "last_event": raw_status,
        }
    )
    if status_value in {"sent", "delivered", "opened"} and not send_state.get("sent_at"):
        send_state["sent_at"] = now
    if status_value == "failed":
        send_state["error"] = str(
            event.get("reason") or event.get("response") or event.get("event") or raw_status
        )
    email_delivery["send"] = send_state
    receipts = _delivery_list(email_delivery.get("receipts"))
    receipts.insert(
        0,
        {
            "received_at": now,
            "channel": "email",
            "status": status_value,
            "event": raw_status,
            "provider": "sendgrid",
            "recipient_email": event.get("email") or work_order.contractor_email,
            "provider_message_id": provider_message_id,
            "retry_count": retry_count,
        },
    )
    history = _delivery_list(email_delivery.get("history"))
    history.append(
        {
            "event": "provider_delivery_receipt",
            "at": now,
            "provider": "sendgrid",
            "status": status_value,
            "raw_event": raw_status,
            "provider_message_id": provider_message_id,
            "retry_count": retry_count,
        }
    )
    email_delivery["receipts"] = receipts[:20]
    email_delivery["history"] = history
    contractor_delivery["email"] = email_delivery
    metadata[CONTRACTOR_DELIVERY_KEY] = contractor_delivery
    work_order.work_order_metadata = _append_activity_history(
        metadata,
        _activity_entry(
            actor="provider:sendgrid",
            source="sendgrid_webhook",
            event="contractor_email_receipt",
            summary=f"Contractor email receipt {status_value}.",
            status_value=work_order.status,
        ),
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


def _document_id_strings(document_ids: list[UUID], entity_id: UUID, session: Session) -> list[str]:
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


@router.post(
    "/{work_order_id}/contractor-delivery/send-email",
    response_model=MaintenanceWorkOrderRead,
)
def send_work_order_contractor_email(
    work_order_id: UUID,
    payload: MaintenanceWorkOrderContractorEmailSend,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> MaintenanceWorkOrder:
    work_order = _work_order_for_user(work_order_id, user, session, WRITE_ROLES)
    body = payload.body.strip()
    if not body:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Contractor email body cannot be blank.",
        )

    invite = _contractor_work_order_email(work_order, payload, session)
    settings = get_settings()
    result = send_contractor_work_order_email(invite, settings)
    metadata = dict(work_order.work_order_metadata or {})
    if payload.include_comment and result.status in {"queued", "sent", "delivered", "opened"}:
        metadata = _append_comment(
            metadata,
            actor=user.actor,
            body=body,
            visibility="contractor",
        )
    work_order.work_order_metadata = _record_contractor_provider_delivery(
        work_order,
        metadata,
        invite=invite,
        result=result,
        user=user,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=work_order.entity_id,
        action="deliver",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name="sendgrid.maintenance_contractor",
        tool_input={
            "maintenance_work_order_id": str(work_order.id),
            "recipient_email": work_order.contractor_email,
            "provider": result.provider,
            "status": result.status,
        },
        tool_output_summary=(
            f"Attempted contractor email delivery via {result.provider}: {result.status}."
        ),
    )
    session.commit()
    session.refresh(work_order)
    return work_order


@router.post(
    "/{work_order_id}/assignment-notification/send-email",
    response_model=MaintenanceWorkOrderRead,
)
def send_work_order_assignment_notification_email(
    work_order_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> MaintenanceWorkOrder:
    work_order = _work_order_for_user(work_order_id, user, session, WRITE_ROLES)
    metadata = dict(work_order.work_order_metadata or {})
    if assignment_notification_sent(metadata):
        return work_order

    settings = get_settings()
    result = send_work_assignment_email(
        work_assignment_email_invite(
            metadata,
            target_id=work_order.id,
            target_type="maintenance_work_order",
            entity_id=work_order.entity_id,
            work_kind="Maintenance",
            title=work_order.title,
            description=work_order.description,
            due_date=work_order.due_date,
            work_url=work_url(settings, f"/operations/maintenance/{work_order.id}"),
            settings=settings,
        ),
        settings,
    )
    work_order.work_order_metadata = record_work_assignment_delivery(
        metadata,
        result=result,
        user=user,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=work_order.entity_id,
        action="deliver",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name="sendgrid.work_assignment",
        tool_input={
            "maintenance_work_order_id": str(work_order.id),
            "recipient_email": result.recipient,
            "provider": result.provider,
            "status": result.status,
        },
        tool_output_summary=(
            f"Attempted assignment notification delivery via {result.provider}: "
            f"{result.status}."
        ),
    )
    session.commit()
    session.refresh(work_order)
    return work_order


@router.post("/webhooks/sendgrid-events", status_code=status.HTTP_204_NO_CONTENT)
async def record_maintenance_sendgrid_delivery_events(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    _assert_webhook_secret(request)
    payload = await request.json()
    events = payload if isinstance(payload, list) else [payload]
    for event in events:
        if not isinstance(event, dict):
            continue
        raw_status = str(event.get("event") or "")
        if not raw_status:
            continue
        work_order = None
        work_order_id = event.get("maintenance_work_order_id")
        if isinstance(work_order_id, str):
            try:
                work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
            except ValueError:
                work_order = None
        message_id = event.get("sg_message_id") or event.get("sg-message-id")
        if work_order is None and isinstance(message_id, str):
            work_order = _find_work_order_by_message_id(session, message_id)
        if work_order is None or work_order.deleted_at is not None:
            continue
        _apply_contractor_email_receipt(
            work_order,
            raw_status,
            str(message_id) if message_id else None,
            event,
        )
        audit_log(
            session,
            actor="provider:sendgrid",
            entity_id=work_order.entity_id,
            action="receipt",
            target_table="maintenance_work_order",
            target_id=work_order.id,
            tool_name="sendgrid.maintenance_contractor_event_webhook",
            tool_input={"channel": "email", "status": raw_status},
            tool_output_summary="Recorded SendGrid contractor email receipt.",
            data_classification="confidential",
        )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
