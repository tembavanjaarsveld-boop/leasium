"""Provider receipt webhooks for assignment notifications."""

import secrets
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import ArrearsCase, MaintenanceWorkOrder, Obligation
from stewart.core.settings import get_settings

from apps.api.deps import get_session
from apps.api.work_assignments import (
    apply_work_assignment_delivery_receipt,
    assignment_notification_message_matches,
)

router = APIRouter(prefix="/work-assignments", tags=["work-assignments"])

ASSIGNMENT_TARGET_TYPES = {
    "maintenance": "maintenance_work_order",
    "maintenance_work_order": "maintenance_work_order",
    "work_order": "maintenance_work_order",
    "arrears": "arrears_case",
    "arrears_case": "arrears_case",
    "critical date": "obligation",
    "critical_date": "obligation",
    "obligation": "obligation",
}

WorkAssignmentTarget = MaintenanceWorkOrder | ArrearsCase | Obligation


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


def _target_type_from_event(event: dict[str, object]) -> str | None:
    raw = (
        event.get("work_assignment_target_type")
        or event.get("target_type")
        or event.get("work_kind")
    )
    if not isinstance(raw, str):
        return None
    return ASSIGNMENT_TARGET_TYPES.get(raw.strip().lower())


def _target_metadata(target: WorkAssignmentTarget) -> dict[str, Any] | None:
    if isinstance(target, MaintenanceWorkOrder):
        return target.work_order_metadata
    if isinstance(target, ArrearsCase):
        return target.arrears_metadata
    return target.obligation_metadata


def _set_target_metadata(target: WorkAssignmentTarget, metadata: dict[str, Any]) -> None:
    if isinstance(target, MaintenanceWorkOrder):
        target.work_order_metadata = metadata
    elif isinstance(target, ArrearsCase):
        target.arrears_metadata = metadata
    else:
        target.obligation_metadata = metadata


def _target_table(target: WorkAssignmentTarget) -> str:
    if isinstance(target, MaintenanceWorkOrder):
        return "maintenance_work_order"
    if isinstance(target, ArrearsCase):
        return "arrears_case"
    return "obligation"


def _get_target_by_id(
    session: Session,
    target_id: UUID,
    target_type: str | None,
) -> WorkAssignmentTarget | None:
    if target_type == "maintenance_work_order":
        return session.get(MaintenanceWorkOrder, target_id)
    if target_type == "arrears_case":
        return session.get(ArrearsCase, target_id)
    if target_type == "obligation":
        return session.get(Obligation, target_id)
    return (
        session.get(MaintenanceWorkOrder, target_id)
        or session.get(ArrearsCase, target_id)
        or session.get(Obligation, target_id)
    )


def _find_target_by_message_id(
    session: Session,
    provider_message_id: str,
) -> WorkAssignmentTarget | None:
    target_sets = (
        session.scalars(
            select(MaintenanceWorkOrder).where(MaintenanceWorkOrder.deleted_at.is_(None))
        ).all(),
        session.scalars(select(ArrearsCase).where(ArrearsCase.deleted_at.is_(None))).all(),
        session.scalars(select(Obligation).where(Obligation.deleted_at.is_(None))).all(),
    )
    for targets in target_sets:
        for target in targets:
            if assignment_notification_message_matches(
                _target_metadata(target),
                provider_message_id,
            ):
                return target
    return None


def _target_from_event(
    session: Session,
    event: dict[str, object],
    provider_message_id: str | None,
) -> WorkAssignmentTarget | None:
    target = None
    target_id = event.get("work_assignment_target_id") or event.get("target_id")
    if isinstance(target_id, str):
        try:
            target = _get_target_by_id(
                session,
                UUID(target_id),
                _target_type_from_event(event),
            )
        except ValueError:
            target = None
    if target is None and provider_message_id:
        target = _find_target_by_message_id(session, provider_message_id)
    if target is None or target.deleted_at is not None:
        return None
    return target


@router.post("/webhooks/sendgrid-events", status_code=status.HTTP_204_NO_CONTENT)
async def record_work_assignment_sendgrid_delivery_events(
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
        message_id = event.get("sg_message_id") or event.get("sg-message-id")
        provider_message_id = str(message_id) if message_id else None
        target = _target_from_event(session, event, provider_message_id)
        if target is None:
            continue
        metadata = apply_work_assignment_delivery_receipt(
            _target_metadata(target),
            raw_status=raw_status,
            provider_message_id=provider_message_id,
            event=event,
        )
        if metadata is None:
            continue
        _set_target_metadata(target, metadata)
        audit_log(
            session,
            actor="provider:sendgrid",
            entity_id=target.entity_id,
            action="receipt",
            target_table=_target_table(target),
            target_id=target.id,
            tool_name="sendgrid.work_assignment_event_webhook",
            tool_input={"channel": "email", "status": raw_status},
            tool_output_summary="Recorded SendGrid assignment notification receipt.",
            data_classification="confidential",
        )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
