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
from stewart.integrations.communications import (
    DeliveryResult,
    WorkAssignmentEmail,
    WorkAssignmentSms,
)

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


def _metadata_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _provider_attempt_count(history: list[Any]) -> int:
    attempt_counts: list[int] = []
    attempted_events = 0
    for raw_entry in history:
        entry = _metadata_record(raw_entry)
        if _metadata_text(entry.get("event")) != "provider_notification_attempted":
            continue
        attempted_events += 1
        count = _metadata_int(entry.get("delivery_attempt_count"))
        if count is not None:
            attempt_counts.append(count)
    return max(attempt_counts) if attempt_counts else attempted_events


def work_assignment_record(metadata: dict[str, Any] | None) -> dict[str, Any]:
    return _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))


def _assigned_user_preferences(
    assignment: dict[str, Any],
    session: Session | None,
) -> dict[str, Any]:
    if session is None:
        return {}
    assigned_user_id = _metadata_uuid(assignment.get("assigned_user_id"))
    if assigned_user_id is None:
        return {}
    app_user = session.get(AppUser, assigned_user_id)
    if app_user is None:
        return {}
    return _metadata_record(app_user.notification_preferences)


def _template_key(
    settings: Settings,
    assignment: dict[str, Any],
    session: Session | None,
) -> str:
    notification = _metadata_record(assignment.get("notification"))
    preferences = _assigned_user_preferences(assignment, session)
    return (
        _metadata_text(preferences.get("work_assignment_notice_template_key"))
        or _metadata_text(notification.get("template_key"))
        or settings.work_assignment_email_template_key
    )


def _template_version(
    settings: Settings,
    assignment: dict[str, Any],
    session: Session | None,
) -> str:
    notification = _metadata_record(assignment.get("notification"))
    preferences = _assigned_user_preferences(assignment, session)
    return (
        _metadata_text(preferences.get("work_assignment_notice_template_version"))
        or _metadata_text(notification.get("template_version"))
        or settings.work_assignment_email_template_version
    )


def assignment_notification_sent(metadata: dict[str, Any] | None) -> bool:
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    notification = _metadata_record(assignment.get("notification"))
    return (
        _metadata_text(notification.get("provider")) == "sendgrid"
        and _metadata_text(notification.get("status")) in PROVIDER_SUCCESS_STATUSES
    )


def assigned_work_assignment_user(
    metadata: dict[str, Any] | None,
    session: Session | None,
) -> AppUser | None:
    if session is None:
        return None
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    assigned_user_id = _metadata_uuid(assignment.get("assigned_user_id"))
    if assigned_user_id is None:
        return None
    return session.get(AppUser, assigned_user_id)


def assignment_notification_sent_for_channel(
    metadata: dict[str, Any] | None,
    *,
    channel: str,
    provider: str,
) -> bool:
    if channel == "email" and provider == "sendgrid":
        return assignment_notification_sent(metadata)
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    notification = _metadata_record(assignment.get("notification"))
    channels = _metadata_record(notification.get("channels"))
    channel_record = _metadata_record(channels.get(channel))
    return (
        _metadata_text(channel_record.get("provider")) == provider
        and _metadata_text(channel_record.get("status")) in PROVIDER_SUCCESS_STATUSES
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
    session: Session | None = None,
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
        template_key=_template_key(settings, assignment, session),
        template_version=_template_version(settings, assignment, session),
    )


def work_assignment_sms_invite(
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
    session: Session | None = None,
) -> WorkAssignmentSms:
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Assign this work before sending an assignment SMS.",
        )

    normalised_due_date = due_date.date() if isinstance(due_date, datetime) else due_date
    app_user = assigned_work_assignment_user(metadata, session)
    return WorkAssignmentSms(
        target_id=target_id,
        target_type=target_type,
        entity_id=entity_id,
        work_kind=work_kind,
        title=title,
        description=description,
        due_date=normalised_due_date,
        assignee_name=_metadata_text(assignment.get("assigned_user_name")),
        assignee_phone=work_assignment_sms_recipient(app_user),
        assigned_by_name=_metadata_text(assignment.get("assigned_by_name")),
        work_url=work_url,
        template_key=_template_key(settings, assignment, session),
        template_version=_template_version(settings, assignment, session),
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


def work_assignment_sms_preference_enabled(app_user: AppUser | None) -> bool:
    if app_user is None:
        return False
    preferences = _metadata_record(app_user.notification_preferences)
    enabled = preferences.get("work_assignment_sms_enabled")
    return enabled if isinstance(enabled, bool) else False


def work_assignment_sms_recipient(app_user: AppUser | None) -> str | None:
    if app_user is None or not work_assignment_sms_preference_enabled(app_user):
        return None
    preferences = _metadata_record(app_user.notification_preferences)
    return _metadata_text(preferences.get("work_assignment_sms_phone"))


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


def work_assignment_sms_preference_skipped_result(
    invite: WorkAssignmentSms,
) -> DeliveryResult:
    return DeliveryResult(
        channel="sms",
        status="skipped",
        provider="twilio",
        recipient=invite.assignee_phone,
        error="Assignment SMS disabled or no reviewed operator phone.",
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

    provider_history = _metadata_list(notification.get("provider_history"))
    previous_attempt_count = _metadata_int(notification.get("attempt_count"))
    if previous_attempt_count is None:
        previous_attempt_count = _provider_attempt_count(provider_history)
    attempt_count = previous_attempt_count + 1

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
        "delivery_attempt_count": attempt_count,
    }

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
            "attempt_count": attempt_count,
            "delivery_attempt_count": attempt_count,
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


def record_work_assignment_sms_delivery(
    metadata: dict[str, Any] | None,
    *,
    result: DeliveryResult,
    user: CurrentUser,
    delivery_trigger: str,
) -> dict[str, Any]:
    next_metadata = dict(metadata or {})
    assignment = _metadata_record(next_metadata.get(WORK_ASSIGNMENT_KEY))
    notification = _metadata_record(assignment.get("notification"))
    channels = _metadata_record(notification.get("channels"))
    sms_record = _metadata_record(channels.get("sms"))
    result_dict = result.to_dict()
    result_metadata = _metadata_record(result_dict.get("metadata"))
    status_value = str(result_dict.get("status") or "failed")
    provider = str(result_dict.get("provider") or "twilio")
    recorded_at = str(result_dict.get("attempted_at") or utcnow().isoformat())
    delivered = status_value in PROVIDER_SUCCESS_STATUSES
    previous_attempt_count = _metadata_int(sms_record.get("attempt_count")) or 0
    attempt_count = previous_attempt_count + 1
    detail = (
        "Assignment SMS was queued by Twilio."
        if delivered
        else str(result_dict.get("error") or "Assignment SMS was not sent.")
    )

    receipt = {
        "event": "provider_notification_attempted",
        "channel": "sms",
        "status": status_value,
        "provider": provider,
        "attempted_at": recorded_at,
        "sent_at": recorded_at if delivered else None,
        "sent_by_user_id": str(user.id),
        "sent_by_name": user.display_name,
        "recipient_phone": result_dict.get("recipient"),
        "provider_message_id": result_dict.get("provider_message_id"),
        "error": result_dict.get("error"),
        "template_key": result_metadata.get("template_key"),
        "template_version": result_metadata.get("template_version"),
        "delivery_trigger": delivery_trigger,
        "delivery_attempt_count": attempt_count,
    }

    provider_history = _metadata_list(sms_record.get("provider_history"))
    channels["sms"] = {
        **sms_record,
        "channel": "sms",
        "provider": provider,
        "status": status_value,
        "recipient_phone": result_dict.get("recipient"),
        "provider_message_id": result_dict.get("provider_message_id"),
        "attempted_at": recorded_at,
        "sent_at": recorded_at if delivered else None,
        "sent_by_user_id": str(user.id),
        "sent_by_name": user.display_name,
        "error": result_dict.get("error"),
        "template_key": result_metadata.get("template_key"),
        "template_version": result_metadata.get("template_version"),
        "detail": detail,
        "delivery_trigger": delivery_trigger,
        "attempt_count": attempt_count,
        "provider_history": [receipt, *provider_history][:10],
    }
    notification["channels"] = channels

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
            "Assignment notification SMS was queued."
            if delivered
            else f"Assignment notification SMS {status_value}."
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


def assignment_notification_sms_message_matches(
    metadata: dict[str, Any] | None,
    provider_message_id: str,
) -> bool:
    assignment = _metadata_record((metadata or {}).get(WORK_ASSIGNMENT_KEY))
    notification = _metadata_record(assignment.get("notification"))
    channels = _metadata_record(notification.get("channels"))
    sms_record = _metadata_record(channels.get("sms"))
    if _metadata_text(sms_record.get("provider_message_id")) == provider_message_id:
        return True
    for receipt in _metadata_list(sms_record.get("provider_history")):
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


def work_assignment_sms_receipt_status(raw_status: str) -> str:
    value = raw_status.lower()
    if value in {"accepted", "queued", "sending"}:
        return "queued"
    if value == "sent":
        return "sent"
    if value == "delivered":
        return "delivered"
    if value in {"undelivered", "failed"}:
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
    provider_history = _metadata_list(notification.get("provider_history"))
    attempt_count = _metadata_int(notification.get("attempt_count"))
    if attempt_count is None:
        attempt_count = _provider_attempt_count(provider_history)

    notification.update(
        {
            "channel": "email",
            "provider": "sendgrid",
            "status": status_value,
            "provider_message_id": message_id,
            "receipt_at": now,
            "last_event": raw_status,
            "attempt_count": attempt_count,
            "delivery_attempt_count": attempt_count,
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
        "delivery_attempt_count": attempt_count,
    }
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


def apply_work_assignment_sms_delivery_receipt(
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
    channels = _metadata_record(notification.get("channels"))
    sms_record = _metadata_record(channels.get("sms"))
    if _metadata_text(sms_record.get("provider")) != "twilio":
        return None
    if (
        provider_message_id
        and not assignment_notification_sms_message_matches(metadata, provider_message_id)
    ):
        return None

    next_metadata = dict(metadata or {})
    now = utcnow().isoformat()
    status_value = work_assignment_sms_receipt_status(raw_status)
    recipient_value = event.get("To") or event.get("to") or sms_record.get("recipient_phone")
    recipient = str(recipient_value) if recipient_value else None
    message_id = provider_message_id or _metadata_text(sms_record.get("provider_message_id"))
    sms_record.update(
        {
            "channel": "sms",
            "provider": "twilio",
            "status": status_value,
            "provider_message_id": message_id,
            "receipt_at": now,
            "last_event": raw_status,
            "detail": (
                "Assignment SMS delivery was confirmed by Twilio."
                if status_value in {"sent", "delivered"}
                else f"Assignment SMS receipt {status_value}."
            ),
        }
    )
    if recipient:
        sms_record["recipient_phone"] = recipient
    if status_value in {"sent", "delivered"} and not sms_record.get("sent_at"):
        sms_record["sent_at"] = now
    if status_value == "failed":
        sms_record["error"] = str(
            event.get("ErrorCode") or event.get("error") or event.get("MessageStatus") or raw_status
        )

    receipt = {
        "event": "provider_notification_receipt",
        "channel": "sms",
        "status": status_value,
        "raw_event": raw_status,
        "provider": "twilio",
        "received_at": now,
        "recipient_phone": recipient,
        "provider_message_id": message_id,
        "error": sms_record.get("error") if status_value == "failed" else None,
        "template_key": sms_record.get("template_key"),
        "template_version": sms_record.get("template_version"),
        "delivery_trigger": sms_record.get("delivery_trigger"),
        "delivery_attempt_count": sms_record.get("attempt_count"),
    }
    provider_history = _metadata_list(sms_record.get("provider_history"))
    sms_record["provider_history"] = [receipt, *provider_history][:10]
    channels["sms"] = sms_record
    notification["channels"] = channels

    history_entry = {
        "event": "provider_notification_receipt",
        "at": now,
        "actor_name": "Twilio",
        "assigned_user_id": _metadata_text(assignment.get("assigned_user_id")),
        "assigned_user_name": _metadata_text(assignment.get("assigned_user_name")),
        "assigned_user_email": _metadata_text(assignment.get("assigned_user_email")),
        "notification_status": status_value,
        "summary": f"Assignment SMS receipt {status_value}.",
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
