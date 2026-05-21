"""Helpers for assignment notification metadata and provider delivery."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import AppUser
from stewart.core.settings import Settings
from stewart.integrations.communications import DeliveryResult, WorkAssignmentEmail

from apps.api.deps import CurrentUser

WORK_ASSIGNMENT_KEY = "work_assignment"
PROVIDER_SUCCESS_STATUSES = {"queued", "sent", "delivered", "opened"}


def _metadata_record(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _metadata_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _metadata_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _metadata_uuid(value: Any) -> UUID | None:
    text = _metadata_text(value)
    if text is None:
        return None
    try:
        return UUID(text)
    except ValueError:
        return None


def _template_key(settings: Settings, assignment: dict[str, Any]) -> str:
    notification = _metadata_record(assignment.get("notification"))
    return (
        _metadata_text(notification.get("template_key"))
        or settings.work_assignment_email_template_key
    )


def _template_version(settings: Settings, assignment: dict[str, Any]) -> str:
    notification = _metadata_record(assignment.get("notification"))
    return (
        _metadata_text(notification.get("template_version"))
        or settings.work_assignment_email_template_version
    )


def assignment_notification_sent(metadata: dict[str, Any] | None) -> bool:
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    notification = _metadata_record(assignment.get("notification"))
    return (
        _metadata_text(notification.get("provider")) == "sendgrid"
        and _metadata_text(notification.get("status")) in PROVIDER_SUCCESS_STATUSES
    )


def work_assignment_email_invite(
    metadata: dict[str, Any] | None,
    *,
    target_id: UUID,
    target_type: str,
    entity_id: UUID,
    work_kind: str,
    title: str,
    description: str | None,
    due_date: date | datetime | None,
    work_url: str | None,
    settings: Settings,
) -> WorkAssignmentEmail:
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Assign this work before sending an assignment notice.",
        )

    recipient = _metadata_text(assignment.get("assigned_user_email"))
    if recipient is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Assigned operator email is missing.",
        )

    normalised_due_date = due_date.date() if isinstance(due_date, datetime) else due_date
    return WorkAssignmentEmail(
        target_id=target_id,
        target_type=target_type,
        entity_id=entity_id,
        work_kind=work_kind,
        title=title,
        description=description,
        due_date=normalised_due_date,
        assignee_name=_metadata_text(assignment.get("assigned_user_name")),
        assignee_email=recipient,
        assigned_by_name=_metadata_text(assignment.get("assigned_by_name")),
        work_url=work_url,
        template_key=_template_key(settings, assignment),
        template_version=_template_version(settings, assignment),
    )


def work_assignment_email_preference_enabled(
    metadata: dict[str, Any] | None,
    session: Session,
) -> bool:
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    assigned_user_id = _metadata_uuid(assignment.get("assigned_user_id"))
    if assigned_user_id is None:
        return True
    app_user = session.get(AppUser, assigned_user_id)
    if app_user is None:
        return True
    preferences = _metadata_record(app_user.notification_preferences)
    enabled = preferences.get("work_assignment_email_enabled")
    return enabled if isinstance(enabled, bool) else True


def work_assignment_email_preference_skipped_result(
    invite: WorkAssignmentEmail,
) -> DeliveryResult:
    return DeliveryResult(
        channel="email",
        status="skipped",
        provider="sendgrid",
        recipient=invite.assignee_email,
        error="Assignment email disabled by operator preference.",
        metadata={
            "template_key": invite.template_key,
            "template_version": invite.template_version,
            "target_id": str(invite.target_id),
            "target_type": invite.target_type,
            "entity_id": str(invite.entity_id),
            "work_kind": invite.work_kind,
        },
    )


def record_work_assignment_delivery(
    metadata: dict[str, Any] | None,
    *,
    result: DeliveryResult,
    user: CurrentUser,
) -> dict[str, Any]:
    next_metadata = dict(metadata or {})
    assignment = _metadata_record(next_metadata.get(WORK_ASSIGNMENT_KEY))
    notification = _metadata_record(assignment.get("notification"))
    result_dict = result.to_dict()
    status_value = str(result_dict.get("status") or "failed")
    provider = str(result_dict.get("provider") or "sendgrid")
    recorded_at = str(result_dict.get("attempted_at") or utcnow().isoformat())
    delivered = status_value in PROVIDER_SUCCESS_STATUSES

    receipt = {
        "event": "provider_notification_attempted",
        "channel": "email",
        "status": status_value,
        "provider": provider,
        "attempted_at": recorded_at,
        "sent_at": recorded_at if delivered else None,
        "sent_by_user_id": str(user.id),
        "sent_by_name": user.display_name,
        "recipient_email": result_dict.get("recipient"),
        "provider_message_id": result_dict.get("provider_message_id"),
        "error": result_dict.get("error"),
        "template_key": result.metadata.get("template_key"),
        "template_version": result.metadata.get("template_version"),
    }

    provider_history = _metadata_list(notification.get("provider_history"))
    notification.update(
        {
            "channel": "email",
            "provider": provider,
            "status": status_value,
            "recipient_email": result_dict.get("recipient"),
            "provider_message_id": result_dict.get("provider_message_id"),
            "attempted_at": recorded_at,
            "sent_at": recorded_at if delivered else None,
            "sent_by_user_id": str(user.id),
            "sent_by_name": user.display_name,
            "error": result_dict.get("error"),
            "template_key": result.metadata.get("template_key"),
            "template_version": result.metadata.get("template_version"),
            "detail": (
                "Assignment email was queued by SendGrid."
                if delivered
                else str(result_dict.get("error") or "Assignment email was not sent.")
            ),
            "provider_history": [receipt, *provider_history][:10],
        }
    )

    existing_history = _metadata_list(assignment.get("history"))
    history_entry = {
        "event": "provider_notification_attempted",
        "at": recorded_at,
        "actor_user_id": str(user.id),
        "actor_name": user.display_name,
        "assigned_user_id": str(_metadata_uuid(assignment.get("assigned_user_id")))
        if _metadata_uuid(assignment.get("assigned_user_id"))
        else None,
        "assigned_user_name": _metadata_text(assignment.get("assigned_user_name")),
        "assigned_user_email": _metadata_text(assignment.get("assigned_user_email")),
        "notification_status": status_value,
        "summary": (
            "Assignment notification email was queued."
            if delivered
            else f"Assignment notification email {status_value}."
        ),
    }

    assignment["notification"] = notification
    assignment["history"] = [history_entry, *existing_history][:10]
    next_metadata[WORK_ASSIGNMENT_KEY] = assignment
    return next_metadata


def assignment_notification_message_matches(
    metadata: dict[str, Any] | None,
    provider_message_id: str,
) -> bool:
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    notification = _metadata_record(assignment.get("notification"))
    if _metadata_text(notification.get("provider_message_id")) == provider_message_id:
        return True
    for receipt in _metadata_list(notification.get("provider_history")):
        receipt_record = _metadata_record(receipt)
        if _metadata_text(receipt_record.get("provider_message_id")) == provider_message_id:
            return True
    return False


def work_assignment_receipt_status(raw_status: str) -> str:
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


def apply_work_assignment_delivery_receipt(
    metadata: dict[str, Any] | None,
    *,
    raw_status: str,
    provider_message_id: str | None,
    event: dict[str, object],
) -> dict[str, Any] | None:
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    if not assignment:
        return None
    notification = _metadata_record(assignment.get("notification"))
    if _metadata_text(notification.get("provider")) != "sendgrid":
        return None

    next_metadata = dict(metadata or {})
    now = utcnow().isoformat()
    status_value = work_assignment_receipt_status(raw_status)
    recipient_value = event.get("email") or notification.get("recipient_email")
    recipient = str(recipient_value) if recipient_value else None
    message_id = provider_message_id or _metadata_text(notification.get("provider_message_id"))
    notification.update(
        {
            "channel": "email",
            "provider": "sendgrid",
            "status": status_value,
            "provider_message_id": message_id,
            "receipt_at": now,
            "last_event": raw_status,
        }
    )
    if recipient:
        notification["recipient_email"] = recipient
    if status_value in {"sent", "delivered", "opened"} and not notification.get("sent_at"):
        notification["sent_at"] = now
    if status_value == "failed":
        notification["error"] = str(
            event.get("reason") or event.get("response") or event.get("event") or raw_status
        )

    receipt = {
        "event": "provider_notification_receipt",
        "channel": "email",
        "status": status_value,
        "raw_event": raw_status,
        "provider": "sendgrid",
        "received_at": now,
        "recipient_email": recipient,
        "provider_message_id": message_id,
        "error": notification.get("error") if status_value == "failed" else None,
        "template_key": notification.get("template_key"),
        "template_version": notification.get("template_version"),
    }
    provider_history = _metadata_list(notification.get("provider_history"))
    notification["provider_history"] = [receipt, *provider_history][:10]

    history_entry = {
        "event": "provider_notification_receipt",
        "at": now,
        "actor_name": "SendGrid",
        "assigned_user_id": _metadata_text(assignment.get("assigned_user_id")),
        "assigned_user_name": _metadata_text(assignment.get("assigned_user_name")),
        "assigned_user_email": _metadata_text(assignment.get("assigned_user_email")),
        "notification_status": status_value,
        "summary": f"Assignment notification receipt {status_value}.",
    }
    assignment["notification"] = notification
    assignment["history"] = [history_entry, *_metadata_list(assignment.get("history"))][:10]
    next_metadata[WORK_ASSIGNMENT_KEY] = assignment
    return next_metadata


def work_url(settings: Settings, path: str) -> str | None:
    base_url = settings.frontend_url.strip().rstrip("/")
    if not base_url:
        return None
    return f"{base_url}{path}"
