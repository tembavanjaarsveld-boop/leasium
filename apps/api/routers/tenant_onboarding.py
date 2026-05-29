"""Tenant onboarding link routes."""

import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import parse_qs, quote
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    DocumentCategory,
    Lease,
    LeaseStatus,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    UserRole,
)
from stewart.core.settings import get_settings
from stewart.integrations.communications import (
    DeliveryResult,
    TenantOnboardingInvite,
    send_tenant_lease_pack_invite,
    send_tenant_onboarding_invite,
    send_tenant_portal_invite,
)
from stewart.integrations.docusign import (
    LeaseSignatureRequest,
    download_signed_lease_document,
    send_lease_for_signature,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.tenants import (
    append_tenant_reviewed_change_history,
    tenant_submission_changes,
)
from apps.api.schemas.documents import DocumentRead
from apps.api.schemas.tenant_onboarding import (
    TenantLeaseQuestionResponse,
    TenantOnboardingCancel,
    TenantOnboardingCreate,
    TenantOnboardingFreshLink,
    TenantOnboardingPublicRead,
    TenantOnboardingRead,
    TenantOnboardingReminderRunRead,
    TenantOnboardingReminderSectionUpdate,
    TenantOnboardingReminderUpdate,
    TenantOnboardingReview,
    TenantOnboardingSubmit,
)
from apps.api.tenant_lease_agreement import (
    blocking_lease_question_count,
    lease_agreement_exists,
    lease_agreement_read,
    lease_agreement_section,
    mark_lease_agreement_signed,
    respond_to_lease_question,
    set_lease_agreement_section,
)

router = APIRouter(prefix="/tenant-onboarding", tags=["tenant-onboarding"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

REMINDER_STEPS = (
    ("first", "First reminder", 2),
    ("second", "Second reminder", 5),
    ("final", "Final reminder", 10),
)
EXPIRY_REMINDER_STEPS = (
    ("expires_soon", "Expiry reminder", 1),
)
ACTIVE_DELIVERY_STATUSES = {"queued", "sent", "delivered", "opened"}
ACTIVE_DOCUSIGN_SIGNING_STATUSES = {"queued", "sent", "delivered"}


def _onboarding_url(token: str) -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/onboarding/{token}"


def _portal_url(token: str) -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/tenant-portal/{token}"


def _account_lease_signing_url() -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/tenant-portal/lease"


def _read(row: TenantOnboarding) -> TenantOnboardingRead:
    response = TenantOnboardingRead.model_validate(row)
    response.onboarding_url = _onboarding_url(row.token)
    response.portal_url = _portal_url(row.token)
    if lease_agreement_exists(row):
        delivery_data = dict(response.delivery_data or {})
        delivery_data["lease_agreement"] = lease_agreement_read(row)
        response.delivery_data = delivery_data
    return response


def _template_metadata(invite: TenantOnboardingInvite) -> dict[str, object]:
    return {
        "key": invite.template_key,
        "version": invite.template_version,
        "brand_name": invite.brand_name,
        "from_name": get_settings().sendgrid_from_name,
        "email_subject": f"Set up your tenant portal for {invite.property_name}",
        "sms_sender": invite.brand_name,
    }


def _recovery_hint(
    channel: str,
    status_value: object,
    error_value: object,
) -> dict[str, str] | None:
    status_text = str(status_value or "")
    error = str(error_value or "")
    lowered = error.lower()
    if status_text in ACTIVE_DELIVERY_STATUSES:
        return None
    label = "email address" if channel == "email" else "mobile number"
    if "no email recipient" in lowered:
        return {
            "channel": channel,
            "type": "contact",
            "field": "contact_email",
            "message": "Add a tenant email address, then resend.",
        }
    if "no sms recipient" in lowered:
        return {
            "channel": channel,
            "type": "contact",
            "field": "contact_phone",
            "message": "Add a tenant mobile number, then resend.",
        }
    if "e.164" in lowered:
        return {
            "channel": channel,
            "type": "contact",
            "field": "contact_phone",
            "message": "Fix the tenant mobile number format, then resend.",
        }
    if "not configured" in lowered or "disabled" in lowered:
        return {
            "channel": channel,
            "type": "configuration",
            "field": channel,
            "message": f"Enable {channel} delivery, then resend.",
        }
    if status_text == "failed":
        return {
            "channel": channel,
            "type": "contact",
            "field": "contact_email" if channel == "email" else "contact_phone",
            "message": f"Check the tenant {label}, then resend.",
        }
    if status_text == "attention":
        return {
            "channel": channel,
            "type": "provider_status",
            "field": channel,
            "message": f"Check the {channel} provider status before resending.",
        }
    return None


def _delivery_recovery_data(
    channels: dict[str, Any],
    checked_at: str,
) -> dict[str, object]:
    hints = []
    has_active_channel = False
    for channel, channel_data in channels.items():
        if not isinstance(channel_data, dict):
            continue
        status_value = channel_data.get("status")
        has_active_channel = has_active_channel or status_value in ACTIVE_DELIVERY_STATUSES
        hint = _recovery_hint(channel, status_value, channel_data.get("error"))
        if hint is not None:
            hints.append(hint)
    needs_contact_fix = any(hint["type"] == "contact" for hint in hints)
    needed = bool(hints)
    next_action = None
    if needs_contact_fix:
        next_action = "fix_contact_and_resend"
    elif needed:
        next_action = "resolve_delivery_and_resend"
    message = None
    if hints:
        contact_hints = [hint["message"] for hint in hints if hint["type"] == "contact"]
        message = contact_hints[0] if contact_hints else hints[0]["message"]
    return {
        "needed": needed,
        "needs_contact_fix": needs_contact_fix,
        "blocking_delivery": needed and not has_active_channel,
        "next_action": next_action,
        "message": message,
        "channels": hints,
        "last_checked_at": checked_at,
    }


def _pause_reason_for_results(results: list[DeliveryResult]) -> str | None:
    if not _channel_results_need_attention(results):
        return None
    checked_at = utcnow().isoformat()
    channels = {result.channel: result.to_dict() for result in results}
    recovery = _delivery_recovery_data(channels, checked_at)
    if recovery.get("needs_contact_fix") is True:
        return "contact_issue"
    if recovery.get("needed") is True:
        return "delivery_unavailable"
    return "delivery_attention"


def _delivery_data(
    current: dict[str, object],
    results: list[DeliveryResult],
    reason: str,
    template: dict[str, object],
) -> dict[str, object]:
    attempted_at = utcnow().isoformat()
    channels = {result.channel: result.to_dict() for result in results}
    history = current.get("history", [])
    if not isinstance(history, list):
        history = []
    recovery = _delivery_recovery_data(channels, attempted_at)
    return {
        **current,
        "last_attempted_at": attempted_at,
        "last_reason": reason,
        "channels": channels,
        "template": template,
        "contact_recovery": recovery,
        "history": [
            {
                "attempted_at": attempted_at,
                "reason": reason,
                "channels": channels,
                "template": template,
                "contact_recovery": recovery,
            },
            *history[:9],
        ],
    }


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _normalise_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _channel_results_need_attention(results: list[DeliveryResult]) -> bool:
    return bool(results) and not any(
        result.status in ACTIVE_DELIVERY_STATUSES for result in results
    )


def _reset_reminders(
    current: dict[str, object],
    sent_at: datetime,
    results: list[DeliveryResult],
    expires_at: datetime | None,
) -> dict[str, object]:
    base = _normalise_datetime(sent_at)
    paused = _channel_results_need_attention(results)
    paused_reason = _pause_reason_for_results(results) if paused else None
    schedule = [
        {
            "key": key,
            "label": label,
            "after_days": days,
            "scheduled_at": (base + timedelta(days=days)).isoformat(),
            "status": "paused" if paused else "scheduled",
            "sent_at": None,
        }
        for key, label, days in REMINDER_STEPS
    ]
    expiry_schedule = _expiry_reminder_schedule(expires_at, paused)
    return {
        **current,
        "reminders": {
            "enabled": True,
            "paused": paused,
            "paused_reason": paused_reason,
            "schedule": schedule,
            "next_reminder_at": None if paused else schedule[0]["scheduled_at"],
            "last_reminder_sent_at": None,
            "completed_at": None,
        },
        "expiry_reminders": {
            "enabled": bool(expiry_schedule),
            "paused": paused,
            "paused_reason": paused_reason,
            "schedule": expiry_schedule,
            "next_reminder_at": (
                None if paused or not expiry_schedule else expiry_schedule[0]["scheduled_at"]
            ),
            "last_reminder_sent_at": None,
            "completed_at": None,
        },
    }


def _reminder_state(current: dict[str, object]) -> dict[str, Any]:
    reminders = current.get("reminders", {})
    return reminders if isinstance(reminders, dict) else {}


def _expiry_reminder_state(current: dict[str, object]) -> dict[str, Any]:
    reminders = current.get("expiry_reminders", {})
    return reminders if isinstance(reminders, dict) else {}


def _reminder_schedule(reminders: dict[str, Any]) -> list[dict[str, Any]]:
    schedule = reminders.get("schedule", [])
    return schedule if isinstance(schedule, list) else []


def _expiry_reminder_schedule(
    expires_at: datetime | None,
    paused: bool,
) -> list[dict[str, Any]]:
    if expires_at is None:
        return []
    expiry = _normalise_datetime(expires_at)
    now = utcnow()
    schedule = []
    for key, label, days_before in EXPIRY_REMINDER_STEPS:
        scheduled_at = expiry - timedelta(days=days_before)
        if scheduled_at <= now:
            continue
        schedule.append(
            {
                "key": key,
                "label": label,
                "before_expiry_days": days_before,
                "scheduled_at": scheduled_at.isoformat(),
                "status": "paused" if paused else "scheduled",
                "sent_at": None,
            }
        )
    return schedule


def _mark_reminder_attempt(
    current: dict[str, object],
    reminder_key: str,
    results: list[DeliveryResult],
    section_key: str,
) -> dict[str, object]:
    now = utcnow().isoformat()
    reminders = (
        _expiry_reminder_state(current)
        if section_key == "expiry_reminders"
        else _reminder_state(current)
    )
    schedule = []
    any_active = not _channel_results_need_attention(results)
    for step in _reminder_schedule(reminders):
        if not isinstance(step, dict):
            continue
        next_step = {**step}
        if next_step.get("key") == reminder_key:
            next_step["status"] = "sent" if any_active else "needs_attention"
            next_step["sent_at"] = now
            next_step["channels"] = {result.channel: result.to_dict() for result in results}
        schedule.append(next_step)

    next_reminder_at = None
    paused = not any_active
    paused_reason = _pause_reason_for_results(results) if paused else None
    if not paused:
        for step in schedule:
            if step.get("status") == "scheduled":
                next_reminder_at = step.get("scheduled_at")
                break

    return {
        **current,
        section_key: {
            **reminders,
            "enabled": True,
            "paused": paused,
            "paused_reason": paused_reason,
            "schedule": schedule,
            "next_reminder_at": next_reminder_at,
            "last_reminder_sent_at": now,
        },
    }


def _complete_reminders(current: dict[str, object], reason: str) -> dict[str, object]:
    reminders = _reminder_state(current)
    expiry_reminders = _expiry_reminder_state(current)
    if not reminders and not expiry_reminders:
        return current
    completed_at = utcnow().isoformat()
    next_data = {**current}
    if reminders:
        next_data["reminders"] = {
            **reminders,
            "enabled": False,
            "paused": False,
            "paused_reason": None,
            "completed_at": completed_at,
            "completed_reason": reason,
            "next_reminder_at": None,
        }
    if expiry_reminders:
        next_data["expiry_reminders"] = {
            **expiry_reminders,
            "enabled": False,
            "paused": False,
            "paused_reason": None,
            "completed_at": completed_at,
            "completed_reason": reason,
            "next_reminder_at": None,
        }
    return next_data


def _next_due_reminder_section(
    reminders: dict[str, Any],
    now: datetime,
) -> str | None:
    if reminders.get("enabled") is False or reminders.get("paused") is True:
        return None
    next_at = _parse_datetime(reminders.get("next_reminder_at"))
    if next_at is None or next_at > now:
        return None
    for step in _reminder_schedule(reminders):
        if step.get("scheduled_at") == reminders.get("next_reminder_at"):
            return str(step.get("key"))
    return None


def _next_reminder_at(reminders: dict[str, Any]) -> str | None:
    candidates = []
    for step in _reminder_schedule(reminders):
        if step.get("status") != "scheduled":
            continue
        scheduled_at = _parse_datetime(step.get("scheduled_at"))
        if scheduled_at is not None:
            candidates.append((scheduled_at, step.get("scheduled_at")))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    return str(candidates[0][1])


def _normalise_reminder_section(
    current: dict[str, Any],
    update: TenantOnboardingReminderSectionUpdate,
    user_id: UUID,
) -> dict[str, Any]:
    section = {**current}
    if update.enabled is not None:
        section["enabled"] = update.enabled
    if update.paused is not None:
        section["paused"] = update.paused
        if not update.paused:
            section["paused_reason"] = None
    if update.paused_reason is not None or update.paused:
        section["paused_reason"] = update.paused_reason
    if update.schedule is not None:
        existing_by_key = {
            str(step.get("key")): step
            for step in _reminder_schedule(section)
            if isinstance(step, dict) and step.get("key") is not None
        }
        schedule = []
        for incoming in update.schedule:
            existing = existing_by_key.get(incoming.key, {})
            step = {**existing, "key": incoming.key}
            if incoming.label is not None:
                step["label"] = incoming.label
            if incoming.after_days is not None:
                step["after_days"] = incoming.after_days
            if incoming.scheduled_at is not None:
                step["scheduled_at"] = _normalise_datetime(incoming.scheduled_at).isoformat()
            if incoming.status is not None:
                step["status"] = incoming.status
            elif not step.get("status"):
                step["status"] = "scheduled"
            schedule.append(step)
        section["schedule"] = schedule
    if section.get("paused") is True or section.get("enabled") is False:
        section["next_reminder_at"] = None
    else:
        section["next_reminder_at"] = _next_reminder_at(section)
    section["updated_at"] = utcnow().isoformat()
    section["updated_by_user_id"] = str(user_id)
    section["manual_edit"] = True
    return section


def _apply_reminder_update(
    current: dict[str, object],
    payload: TenantOnboardingReminderUpdate,
    user_id: UUID,
) -> dict[str, object]:
    next_data = {**current}
    if payload.reminders is not None:
        next_data["reminders"] = _normalise_reminder_section(
            _reminder_state(next_data),
            payload.reminders,
            user_id,
        )
    if payload.expiry_reminders is not None:
        next_data["expiry_reminders"] = _normalise_reminder_section(
            _expiry_reminder_state(next_data),
            payload.expiry_reminders,
            user_id,
        )
    return {
        **next_data,
        "reminder_edit": {
            "updated_at": utcnow().isoformat(),
            "updated_by_user_id": str(user_id),
        },
    }


def _next_due_reminder(row: TenantOnboarding, now: datetime) -> tuple[str, str] | None:
    data = row.delivery_data or {}
    reminder_key = _next_due_reminder_section(_reminder_state(data), now)
    if reminder_key is not None:
        return ("reminders", reminder_key)
    expiry_key = _next_due_reminder_section(_expiry_reminder_state(data), now)
    if expiry_key is not None:
        return ("expiry_reminders", expiry_key)
    return None


def _ensure_reminder_plan(row: TenantOnboarding) -> None:
    data = row.delivery_data or {}
    if _reminder_state(data) and (_expiry_reminder_state(data) or row.expires_at is None):
        return
    if row.last_sent_at is None:
        return
    row.delivery_data = _reset_reminders(data, row.last_sent_at, [], row.expires_at)


def _receipt_status(channel: str, raw_status: str) -> str:
    value = raw_status.lower()
    if channel == "sms":
        if value in {"accepted", "queued", "sending"}:
            return "queued"
        if value == "sent":
            return "sent"
        if value == "delivered":
            return "delivered"
        if value in {"undelivered", "failed"}:
            return "failed"
        return "attention"
    if value in {"processed", "deferred"}:
        return "sent" if value == "processed" else "attention"
    if value == "delivered":
        return "delivered"
    if value in {"open", "click"}:
        return "opened"
    if value in {"bounce", "dropped", "spamreport", "unsubscribe", "group_unsubscribe"}:
        return "failed"
    return "attention"


def _apply_delivery_receipt(
    onboarding: TenantOnboarding,
    channel: str,
    raw_status: str,
    provider_message_id: str | None,
    event: dict[str, Any],
) -> None:
    now = utcnow().isoformat()
    data = onboarding.delivery_data or {}
    channels = data.get("channels", {})
    if not isinstance(channels, dict):
        channels = {}
    channel_data = channels.get(channel, {})
    if not isinstance(channel_data, dict):
        channel_data = {}
    status_value = _receipt_status(channel, raw_status)
    next_channel = {
        **channel_data,
        "channel": channel,
        "status": status_value,
        "provider_message_id": provider_message_id or channel_data.get("provider_message_id"),
        "receipt_at": now,
        "last_event": raw_status,
    }
    if status_value == "failed":
        next_channel["error"] = (
            str(
                event.get("ErrorCode")
                or event.get("reason")
                or event.get("response")
                or raw_status
            )
        )
    channels[channel] = next_channel
    receipts = data.get("receipts", [])
    if not isinstance(receipts, list):
        receipts = []
    onboarding.delivery_data = {
        **data,
        "channels": channels,
        "last_receipt_at": now,
        "receipts": [
            {
                "received_at": now,
                "channel": channel,
                "status": status_value,
                "event": raw_status,
                "provider_message_id": provider_message_id,
            },
            *receipts[:19],
        ],
    }


def _find_onboarding_by_message_id(
    session: Session,
    channel: str,
    provider_message_id: str,
) -> TenantOnboarding | None:
    rows = session.scalars(
        select(TenantOnboarding).where(TenantOnboarding.deleted_at.is_(None))
    ).all()
    for row in rows:
        data = row.delivery_data or {}
        channels = data.get("channels", {})
        if isinstance(channels, dict):
            current = channels.get(channel, {})
            if (
                isinstance(current, dict)
                and current.get("provider_message_id") == provider_message_id
            ):
                return row
        history = data.get("history", [])
        if isinstance(history, list):
            for attempt in history:
                if not isinstance(attempt, dict):
                    continue
                attempt_channels = attempt.get("channels", {})
                if not isinstance(attempt_channels, dict):
                    continue
                current = attempt_channels.get(channel, {})
                if (
                    isinstance(current, dict)
                    and current.get("provider_message_id") == provider_message_id
                ):
                    return row
    return None


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


def _assert_docusign_webhook_secret(request: Request) -> None:
    secret = get_settings().docusign_webhook_secret
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DocuSign webhook secret is not configured.",
        )
    provided = (
        request.headers.get("x-docusign-webhook-secret")
        or request.headers.get("x-leasium-webhook-secret")
        or request.query_params.get("token")
    )
    if not provided or not secrets.compare_digest(provided, secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook token.",
        )


def _docusign_event_section(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    return data if isinstance(data, dict) else {}


def _docusign_envelope_summary(payload: dict[str, Any]) -> dict[str, Any]:
    data = _docusign_event_section(payload)
    summary = data.get("envelopeSummary") or payload.get("envelopeSummary")
    return summary if isinstance(summary, dict) else {}


def _docusign_payload_value(payload: dict[str, Any], *keys: str) -> str | None:
    sections = (payload, _docusign_event_section(payload), _docusign_envelope_summary(payload))
    for section in sections:
        for key in keys:
            value = section.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def _docusign_event(payload: dict[str, Any]) -> str | None:
    return _docusign_payload_value(payload, "event", "eventName", "event_name")


def _docusign_envelope_id(payload: dict[str, Any]) -> str | None:
    return _docusign_payload_value(payload, "envelopeId", "envelope_id")


def _docusign_status(payload: dict[str, Any]) -> str | None:
    status_value = _docusign_payload_value(payload, "status", "envelopeStatus")
    if status_value:
        return status_value.lower()
    event_value = _docusign_event(payload)
    if event_value and "completed" in event_value.lower():
        return "completed"
    return None


def _docusign_custom_fields(payload: dict[str, Any]) -> dict[str, str]:
    fields: dict[str, str] = {}
    sections = (payload, _docusign_event_section(payload), _docusign_envelope_summary(payload))
    for section in sections:
        custom_fields = section.get("customFields")
        if not isinstance(custom_fields, dict):
            continue
        text_fields = custom_fields.get("textCustomFields")
        if not isinstance(text_fields, list):
            continue
        for field in text_fields:
            if not isinstance(field, dict):
                continue
            name = field.get("name")
            value = field.get("value")
            if isinstance(name, str) and isinstance(value, str) and value:
                fields[name] = value
    return fields


def _docusign_custom_fields_match(
    onboarding: TenantOnboarding,
    signing_data: dict[str, Any],
    payload: dict[str, Any],
) -> bool:
    fields = _docusign_custom_fields(payload)
    expected = {
        "tenant_onboarding_id": str(onboarding.id),
        "lease_id": str(onboarding.lease_id),
        "document_id": signing_data.get("document_id"),
        "entity_id": str(onboarding.entity_id),
    }
    for name, expected_value in expected.items():
        actual_value = fields.get(name)
        if actual_value and isinstance(expected_value, str) and actual_value != expected_value:
            return False
    return True


def _docusign_webhook_event_allowed(
    signing_data: dict[str, Any],
    envelope_id: str,
    event_status: str,
) -> bool:
    if signing_data.get("provider") != "docusign":
        return False
    if signing_data.get("envelope_id") != envelope_id:
        return False
    current_status = signing_data.get("status")
    if event_status == "completed":
        if current_status == "completed" and signing_data.get("signed_at"):
            return False
        return current_status in ACTIVE_DOCUSIGN_SIGNING_STATUSES
    return not (current_status == "completed" and signing_data.get("signed_at"))


def _find_onboarding_by_docusign_envelope_id(
    session: Session,
    envelope_id: str,
) -> TenantOnboarding | None:
    rows = session.scalars(
        select(TenantOnboarding).where(TenantOnboarding.deleted_at.is_(None))
    ).all()
    for row in rows:
        signing = lease_agreement_section(row).get("signing")
        if isinstance(signing, dict) and signing.get("envelope_id") == envelope_id:
            return row
    return None


def _apply_docusign_webhook_event(
    onboarding: TenantOnboarding,
    payload: dict[str, Any],
    envelope_id: str,
    event_status: str,
    session: Session,
) -> None:
    event_name = _docusign_event(payload)
    signing = lease_agreement_section(onboarding).get("signing")
    signing_data = dict(signing) if isinstance(signing, dict) else {}
    if not _docusign_webhook_event_allowed(signing_data, envelope_id, event_status):
        return
    if not _docusign_custom_fields_match(onboarding, signing_data, payload):
        return
    events = signing_data.get("provider_events")
    provider_events = (
        [item for item in events if isinstance(item, dict)] if isinstance(events, list) else []
    )
    received_at = utcnow().isoformat()
    provider_event = {
        "received_at": received_at,
        "event": event_name,
        "status": event_status,
        "envelope_id": envelope_id,
    }
    signing_updates: dict[str, object] = {
        "provider": "docusign",
        "status": event_status,
        "envelope_id": envelope_id,
        "last_event": event_name,
        "last_event_at": received_at,
        "provider_events": [provider_event, *provider_events[:9]],
    }
    if event_status == "completed":
        signing_updates.update(
            _retain_docusign_signed_document(onboarding, envelope_id, session, signing_data)
        )
        signing_updates["lease_activation_review"] = _lease_activation_review_data(
            onboarding,
            session,
            signing_updates,
        )
        mark_lease_agreement_signed(
            onboarding,
            actor="provider:docusign",
            source="docusign_webhook",
            signing_updates=signing_updates,
        )
        return
    section = lease_agreement_section(onboarding)
    signing_data.update(signing_updates)
    section["signing"] = signing_data
    section["last_activity_at"] = received_at
    set_lease_agreement_section(onboarding, section)


def _retain_docusign_signed_document(
    onboarding: TenantOnboarding,
    envelope_id: str,
    session: Session,
    signing_data: dict[str, object],
) -> dict[str, object]:
    existing_document_id = signing_data.get("signed_document_id")
    if isinstance(existing_document_id, str) and existing_document_id:
        return {}

    result = download_signed_lease_document(envelope_id, get_settings())
    retention: dict[str, object] = {
        "status": result.status,
        "provider": result.provider,
        "attempted_at": utcnow().isoformat(),
        "error": result.error,
    }
    if result.status != "downloaded" or result.file_data is None:
        return {"signed_document_retention": retention}

    original_document_id = (
        str(signing_data["document_id"])
        if isinstance(signing_data.get("document_id"), str)
        else None
    )
    document = StoredDocument(
        entity_id=onboarding.entity_id,
        tenant_id=onboarding.tenant_id,
        lease_id=onboarding.lease_id,
        tenant_onboarding_id=onboarding.id,
        filename=result.filename or f"signed-lease-{envelope_id}.pdf",
        content_type=result.content_type or "application/pdf",
        byte_size=len(result.file_data),
        file_data=result.file_data,
        category=DocumentCategory.lease,
        document_metadata={
            "source": "docusign_signed_lease",
            "docusign_envelope_id": envelope_id,
            "original_lease_document_id": original_document_id,
            "retained_at": retention["attempted_at"],
        },
    )
    session.add(document)
    session.flush()
    retention["document_id"] = str(document.id)
    return {
        "signed_document_id": str(document.id),
        "signed_document_retention": retention,
    }


def _lease_activation_review_data(
    onboarding: TenantOnboarding,
    session: Session,
    signing_updates: dict[str, object],
) -> dict[str, object]:
    lease = session.get(Lease, onboarding.lease_id)
    current_status = lease.status.value if lease is not None else None
    signed_document_id = signing_updates.get("signed_document_id")
    already_active = current_status in {LeaseStatus.active.value, LeaseStatus.holding_over.value}
    return {
        "status": "already_active" if already_active else "ready_for_review",
        "current_lease_status": current_status,
        "recommended_status": LeaseStatus.active.value,
        "signed_document_id": signed_document_id if isinstance(signed_document_id, str) else None,
        "updated_at": utcnow().isoformat(),
        "guardrail": (
            "DocuSign completion does not activate a lease automatically; "
            "review and activate explicitly."
        ),
    }


def _activate_signed_onboarding_lease(
    onboarding: TenantOnboarding,
    lease: Lease,
    user: CurrentUser,
) -> None:
    signing = lease_agreement_section(onboarding).get("signing")
    signing_data = dict(signing) if isinstance(signing, dict) else {}
    if not isinstance(signing_data.get("signed_at"), str):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complete lease signing before activation.",
        )
    if lease.status != LeaseStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only pending leases can be activated from onboarding.",
        )

    activated_at = utcnow().isoformat()
    signing_source = (
        "tenant_uploaded_lease_match"
        if signing_data.get("source") == "tenant_uploaded_lease_match"
        or signing_data.get("provider") == "tenant_upload"
        else "tenant_onboarding_docusign"
    )
    lease.status = LeaseStatus.active
    lease.lease_metadata = {
        **(lease.lease_metadata or {}),
        "activation": {
            "source": signing_source,
            "tenant_onboarding_id": str(onboarding.id),
            "signed_document_id": signing_data.get("signed_document_id"),
            "activated_at": activated_at,
            "activated_by_user_id": str(user.id),
        },
    }
    signing_data["lease_activation_review"] = {
        **(
            signing_data.get("lease_activation_review")
            if isinstance(signing_data.get("lease_activation_review"), dict)
            else {}
        ),
        "status": "activated",
        "current_lease_status": LeaseStatus.active.value,
        "recommended_status": LeaseStatus.active.value,
        "activated_at": activated_at,
        "activated_by_user_id": str(user.id),
        "guardrail": "Lease activated only after explicit operator approval.",
    }
    section = lease_agreement_section(onboarding)
    section["signing"] = signing_data
    section["last_activity_at"] = activated_at
    onboarding.delivery_data = {
        **(onboarding.delivery_data or {}),
        "lease_agreement": section,
    }


def _masked_recipient(value: str | None) -> str | None:
    if not value:
        return None
    if "@" in value:
        name, domain = value.split("@", 1)
        return f"{name[:2]}***@{domain}"
    return f"{value[:4]}***{value[-2:]}" if len(value) > 6 else "***"


def _deliver_onboarding_link(
    onboarding: TenantOnboarding,
    lease: Lease,
    prop: Property,
    tenant: Tenant,
    user: CurrentUser,
    session: Session,
    reason: str,
) -> None:
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        return
    settings = get_settings()
    invite = TenantOnboardingInvite(
        onboarding_id=onboarding.id,
        entity_id=onboarding.entity_id,
        tenant_name=tenant.trading_name or tenant.legal_name,
        contact_name=tenant.contact_name,
        contact_email=tenant.contact_email or tenant.billing_email,
        contact_phone=tenant.contact_phone,
        property_name=prop.name,
        property_address=_property_address(prop),
        unit_label=unit.unit_label,
        onboarding_url=_onboarding_url(onboarding.token),
        due_date=onboarding.due_date,
        expires_at=onboarding.expires_at,
        brand_name=settings.tenant_onboarding_brand_name,
        template_key=settings.tenant_onboarding_template_key,
        template_version=settings.tenant_onboarding_template_version,
    )
    results = send_tenant_onboarding_invite(invite, settings)
    next_delivery_data = _delivery_data(
        onboarding.delivery_data or {},
        results,
        reason,
        _template_metadata(invite),
    )
    if reason in {"send", "resend", "fresh_link"}:
        next_delivery_data = _reset_reminders(
            next_delivery_data,
            onboarding.last_sent_at or utcnow(),
            results,
            onboarding.expires_at,
        )
    elif reason.startswith("reminder:"):
        _prefix, section_key, reminder_key = reason.split(":", 2)
        next_delivery_data = _mark_reminder_attempt(
            next_delivery_data,
            reminder_key,
            results,
            section_key,
        )
    onboarding.delivery_data = next_delivery_data
    for result in results:
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=onboarding.entity_id,
            action="deliver",
            target_table="tenant_onboarding",
            target_id=onboarding.id,
            tool_name=f"twilio.{result.provider}",
            tool_input={
                "channel": result.channel,
                "recipient": _masked_recipient(result.recipient),
                "reason": reason,
            },
            tool_output_summary=f"{result.channel} {result.status}",
            outcome=(AuditOutcome.error if result.status == "failed" else AuditOutcome.success),
            error_message=result.error if result.status == "failed" else None,
            data_classification="confidential",
        )


def _deliver_portal_invite(
    onboarding: TenantOnboarding,
    lease: Lease,
    prop: Property,
    tenant: Tenant,
    user: CurrentUser,
    session: Session,
) -> list[DeliveryResult]:
    """Send a portal-account claim invite tied to this onboarding row.

    The portal invite is a separate operator action from the onboarding link.
    It uses its own SendGrid template and a URL pointing at the tenant portal
    (where the tenant signs in via Clerk and the existing portal-account claim
    flow links them to this onboarding). Delivery receipts are recorded under
    ``delivery_data['portal_invite']`` so the tenant dashboard and operator
    surface can both show when the link was last sent.
    """

    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        return []
    settings = get_settings()
    invite = TenantOnboardingInvite(
        onboarding_id=onboarding.id,
        entity_id=onboarding.entity_id,
        tenant_name=tenant.trading_name or tenant.legal_name,
        contact_name=tenant.contact_name,
        contact_email=tenant.contact_email or tenant.billing_email,
        contact_phone=tenant.contact_phone,
        property_name=prop.name,
        property_address=_property_address(prop),
        unit_label=unit.unit_label,
        onboarding_url=_portal_url(onboarding.token),
        due_date=onboarding.due_date,
        expires_at=onboarding.expires_at,
        brand_name=settings.tenant_onboarding_brand_name,
        template_key=settings.tenant_portal_invite_template_key,
        template_version=settings.tenant_portal_invite_template_version,
    )
    results = send_tenant_portal_invite(invite, settings)
    now = utcnow()
    delivery = dict(onboarding.delivery_data or {})
    previous_sent_at = onboarding.last_sent_at
    receipts = []
    for result in results:
        receipts.append(
            {
                "channel": result.channel,
                "status": result.status,
                "provider": result.provider,
                "recipient": _masked_recipient(result.recipient),
                "provider_message_id": result.provider_message_id,
                "error": result.error,
                "metadata": result.metadata,
            }
        )
    delivery["portal_invite"] = {
        "sent_at": now.isoformat(),
        "sent_by_user_id": str(user.id),
        "template_key": invite.template_key,
        "template_version": invite.template_version,
        "receipts": receipts,
    }
    delivery = _reset_reminders(delivery, now, results, onboarding.expires_at)
    history_raw = delivery.get("portal_invite_history")
    history = (
        [item for item in history_raw if isinstance(item, dict)]
        if isinstance(history_raw, list)
        else []
    )
    history.append(delivery["portal_invite"])
    delivery["portal_invite_history"] = history[-5:]
    onboarding.last_sent_at = now
    if previous_sent_at is not None:
        onboarding.resent_at = now
    onboarding.delivery_data = delivery
    for result in results:
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=onboarding.entity_id,
            action="portal_invite",
            target_table="tenant_onboarding",
            target_id=onboarding.id,
            tool_name=f"twilio.{result.provider}"
            if result.channel == "sms"
            else f"sendgrid.{result.provider}",
            tool_input={
                "channel": result.channel,
                "recipient": _masked_recipient(result.recipient),
            },
            tool_output_summary=f"portal_invite {result.channel} {result.status}",
            outcome=(AuditOutcome.error if result.status == "failed" else AuditOutcome.success),
            error_message=result.error if result.status == "failed" else None,
            data_classification="confidential",
        )
    return results


def _deliver_lease_pack(
    onboarding: TenantOnboarding,
    lease: Lease,
    prop: Property,
    tenant: Tenant,
    lease_document: StoredDocument,
    user: CurrentUser,
    session: Session,
) -> list[DeliveryResult]:
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        return []
    settings = get_settings()
    invite = TenantOnboardingInvite(
        onboarding_id=onboarding.id,
        entity_id=onboarding.entity_id,
        tenant_name=tenant.trading_name or tenant.legal_name,
        contact_name=tenant.contact_name,
        contact_email=tenant.contact_email or tenant.billing_email,
        contact_phone=tenant.contact_phone,
        property_name=prop.name,
        property_address=_property_address(prop),
        unit_label=unit.unit_label,
        onboarding_url=_account_lease_signing_url(),
        due_date=onboarding.due_date,
        expires_at=None,
        brand_name=settings.tenant_onboarding_brand_name,
        template_key=settings.tenant_lease_pack_template_key,
        template_version=settings.tenant_lease_pack_template_version,
    )
    signature_result = send_lease_for_signature(
        LeaseSignatureRequest(
            lease_id=lease.id,
            tenant_onboarding_id=onboarding.id,
            document_id=lease_document.id,
            entity_id=onboarding.entity_id,
            tenant_name=tenant.trading_name or tenant.legal_name,
            signer_name=tenant.contact_name,
            signer_email=tenant.contact_email or tenant.billing_email,
            property_name=prop.name,
            unit_label=unit.unit_label,
            document_filename=lease_document.filename,
            document_bytes=lease_document.file_data,
            redirect_url=_account_lease_signing_url(),
        ),
        settings,
    )
    results = send_tenant_lease_pack_invite(invite, settings)
    now = utcnow()
    delivery = dict(onboarding.delivery_data or {})
    receipts = []
    for result in results:
        receipts.append(
            {
                "channel": result.channel,
                "status": result.status,
                "provider": result.provider,
                "recipient": _masked_recipient(result.recipient),
                "provider_message_id": result.provider_message_id,
                "error": result.error,
                "metadata": result.metadata,
            }
        )
    docusign_receipt = {
        "status": signature_result.status,
        "provider": signature_result.provider,
        "envelope_id": signature_result.envelope_id,
        "signer_email": _masked_recipient(signature_result.signer_email),
        "document_id": str(lease_document.id),
        "error": signature_result.error,
    }
    delivery["lease_pack"] = {
        "sent_at": now.isoformat(),
        "sent_by_user_id": str(user.id),
        "template_key": invite.template_key,
        "template_version": invite.template_version,
        "receipts": receipts,
        "docusign": docusign_receipt,
    }
    if signature_result.status in {"queued", "sent"}:
        lease_agreement = delivery.get("lease_agreement")
        lease_agreement_data = dict(lease_agreement) if isinstance(lease_agreement, dict) else {}
        lease_agreement_data["signing"] = {
            "provider": signature_result.provider,
            "status": signature_result.status,
            "envelope_id": signature_result.envelope_id,
            "signer_email": _masked_recipient(signature_result.signer_email),
            "document_id": str(lease_document.id),
            "sent_at": now.isoformat(),
            "sent_by_user_id": str(user.id),
        }
        lease_agreement_data["last_activity_at"] = now.isoformat()
        delivery["lease_agreement"] = lease_agreement_data
    history_raw = delivery.get("lease_pack_history")
    history = (
        [item for item in history_raw if isinstance(item, dict)]
        if isinstance(history_raw, list)
        else []
    )
    history.append(delivery["lease_pack"])
    delivery["lease_pack_history"] = history[-5:]
    onboarding.delivery_data = delivery
    for result in results:
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=onboarding.entity_id,
            action="send_lease_pack",
            target_table="tenant_onboarding",
            target_id=onboarding.id,
            tool_name=f"twilio.{result.provider}"
            if result.channel == "sms"
            else f"sendgrid.{result.provider}",
            tool_input={
                "channel": result.channel,
                "recipient": _masked_recipient(result.recipient),
            },
            tool_output_summary=f"lease_pack {result.channel} {result.status}",
            outcome=(AuditOutcome.error if result.status == "failed" else AuditOutcome.success),
            error_message=result.error if result.status == "failed" else None,
            data_classification="confidential",
        )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="send_lease_for_signature",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        tool_name="docusign.envelopes.create",
        tool_input={
            "document_id": str(lease_document.id),
            "recipient": _masked_recipient(signature_result.signer_email),
        },
        tool_output_summary=f"docusign envelope {signature_result.status}",
        outcome=AuditOutcome.error if signature_result.error else AuditOutcome.success,
        error_message=signature_result.error,
        data_classification="confidential",
    )
    return results


def _is_expired(row: TenantOnboarding) -> bool:
    if row.expires_at is None:
        return False
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= utcnow()


def _assert_public_onboarding_editable(onboarding: TenantOnboarding) -> None:
    if onboarding.status != TenantOnboardingStatus.sent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only sent onboarding can be changed from the public link.",
        )


def _property_address(prop: Property) -> str | None:
    parts = [
        prop.street_address,
        prop.suburb,
        prop.state,
        prop.postcode,
    ]
    address = ", ".join(part for part in parts if part)
    return address or None


def _apply_submission(onboarding: TenantOnboarding, tenant: Tenant) -> None:
    data = onboarding.submitted_data
    tenant.legal_name = data["legal_name"]
    tenant.trading_name = data.get("trading_name")
    tenant.abn = data.get("abn")
    tenant.contact_name = data["contact_name"]
    tenant.contact_email = data["contact_email"]
    tenant.contact_phone = data.get("contact_phone")
    tenant.billing_email = data.get("billing_email") or data["contact_email"]
    tenant.tenant_metadata = {
        **tenant.tenant_metadata,
        "tenant_onboarding_id": str(onboarding.id),
        "insurance_confirmed": data.get("insurance_confirmed", False),
        "insurance_expiry_date": data.get("insurance_expiry_date"),
        "emergency_contact_name": data.get("emergency_contact_name"),
        "emergency_contact_phone": data.get("emergency_contact_phone"),
    }


def _lease_scope(
    lease_id: UUID,
    session: Session,
) -> tuple[Lease, Property, Tenant]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lease not found.")
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    tenant = session.get(Tenant, lease.tenant_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenancy unit not found.")
    prop = session.get(Property, unit.property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    if tenant.entity_id != prop.entity_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease links tenant and unit across different entities.",
        )
    return lease, prop, tenant


def _latest_lease_document(
    onboarding: TenantOnboarding,
    session: Session,
) -> StoredDocument | None:
    return session.scalar(
        select(StoredDocument)
        .where(
            StoredDocument.entity_id == onboarding.entity_id,
            StoredDocument.tenant_onboarding_id == onboarding.id,
            StoredDocument.lease_id == onboarding.lease_id,
            StoredDocument.tenant_id == onboarding.tenant_id,
            StoredDocument.category == DocumentCategory.lease,
            StoredDocument.deleted_at.is_(None),
        )
        .order_by(StoredDocument.created_at.desc())
    )


def _new_token(session: Session) -> str:
    while True:
        token = secrets.token_urlsafe(24)
        exists = session.scalar(select(TenantOnboarding.id).where(TenantOnboarding.token == token))
        if exists is None:
            return token


def _get_onboarding_for_user(
    onboarding_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> TenantOnboarding:
    onboarding = session.get(TenantOnboarding, onboarding_id)
    if onboarding is None or onboarding.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    assert_entity_role(session, user, onboarding.entity_id, roles)
    return onboarding


def _get_public_onboarding(token: str, session: Session) -> TenantOnboarding:
    onboarding = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.token == token,
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    if (
        onboarding is None
        or onboarding.status == TenantOnboardingStatus.cancelled
        or _is_expired(onboarding)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    return onboarding


def _public_document(
    token: str,
    document_id: UUID,
    session: Session,
) -> tuple[TenantOnboarding, StoredDocument]:
    onboarding = _get_public_onboarding(token, session)
    document = session.get(StoredDocument, document_id)
    if (
        document is None
        or document.deleted_at is not None
        or document.tenant_onboarding_id != onboarding.id
        or document.tenant_id != onboarding.tenant_id
        or document.entity_id != onboarding.entity_id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return onboarding, document


@router.get("", response_model=list[TenantOnboardingRead])
def list_tenant_onboardings(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID,
) -> list[TenantOnboardingRead]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    rows = session.scalars(
        select(TenantOnboarding)
        .where(TenantOnboarding.entity_id == entity_id, TenantOnboarding.deleted_at.is_(None))
        .order_by(TenantOnboarding.created_at.desc())
    ).all()
    return [_read(row) for row in rows]


@router.post("", response_model=TenantOnboardingRead, status_code=status.HTTP_201_CREATED)
def create_tenant_onboarding(
    payload: TenantOnboardingCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    lease, prop, tenant = _lease_scope(payload.lease_id, session)
    assert_entity_role(session, user, prop.entity_id, WRITE_ROLES)

    existing = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.lease_id == lease.id,
            TenantOnboarding.tenant_id == tenant.id,
            TenantOnboarding.status != TenantOnboardingStatus.cancelled,
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    if existing is not None:
        return _read(existing)

    sent_at = utcnow() if payload.send_initial_invite else None
    onboarding = TenantOnboarding(
        entity_id=prop.entity_id,
        lease_id=lease.id,
        tenant_id=tenant.id,
        token=_new_token(session),
        status=TenantOnboardingStatus.sent,
        due_date=payload.due_date,
        expires_at=payload.expires_at,
        last_sent_at=sent_at,
        submitted_data={},
        review_data={},
        delivery_data={},
    )
    session.add(onboarding)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="create",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    if payload.send_initial_invite:
        _deliver_onboarding_link(onboarding, lease, prop, tenant, user, session, "send")
        session.commit()
        session.refresh(onboarding)
    return _read(onboarding)


@router.post("/reminders/run", response_model=TenantOnboardingReminderRunRead)
def run_tenant_onboarding_reminders(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID,
) -> TenantOnboardingReminderRunRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    now = utcnow()
    rows = session.scalars(
        select(TenantOnboarding)
        .where(
            TenantOnboarding.entity_id == entity_id,
            TenantOnboarding.status == TenantOnboardingStatus.sent,
            TenantOnboarding.deleted_at.is_(None),
        )
        .order_by(TenantOnboarding.created_at.asc())
    ).all()
    checked = 0
    sent = 0
    skipped = 0
    onboarding_ids: list[UUID] = []
    for onboarding in rows:
        checked += 1
        if _is_expired(onboarding):
            skipped += 1
            continue
        _ensure_reminder_plan(onboarding)
        reminder_key = _next_due_reminder(onboarding, now)
        if reminder_key is None:
            skipped += 1
            continue
        lease, prop, tenant = _lease_scope(onboarding.lease_id, session)
        _deliver_onboarding_link(
            onboarding,
            lease,
            prop,
            tenant,
            user,
            session,
            f"reminder:{reminder_key[0]}:{reminder_key[1]}",
        )
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=entity_id,
            action="reminder",
            target_table="tenant_onboarding",
            target_id=onboarding.id,
            tool_input={"reminder_section": reminder_key[0], "reminder_key": reminder_key[1]},
            outcome=AuditOutcome.success,
        )
        sent += 1
        onboarding_ids.append(onboarding.id)
    session.commit()
    return TenantOnboardingReminderRunRead(
        checked=checked,
        sent=sent,
        skipped=skipped,
        onboarding_ids=onboarding_ids,
    )


@router.post("/webhooks/twilio-status", status_code=status.HTTP_204_NO_CONTENT)
async def record_twilio_delivery_status(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    _assert_webhook_secret(request)
    body = (await request.body()).decode()
    payload = {key: values[0] for key, values in parse_qs(body).items() if values}
    message_sid = payload.get("MessageSid") or payload.get("SmsSid")
    message_status = payload.get("MessageStatus") or payload.get("SmsStatus")
    if not message_sid or not message_status:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    onboarding = _find_onboarding_by_message_id(session, "sms", message_sid)
    if onboarding is not None:
        _apply_delivery_receipt(onboarding, "sms", message_status, message_sid, payload)
        audit_log(
            session,
            actor="provider:twilio",
            entity_id=onboarding.entity_id,
            action="receipt",
            target_table="tenant_onboarding",
            target_id=onboarding.id,
            tool_name="twilio.status_callback",
            tool_input={"channel": "sms", "status": message_status},
            outcome=AuditOutcome.success,
            data_classification="confidential",
        )
        session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/webhooks/sendgrid-events", status_code=status.HTTP_204_NO_CONTENT)
async def record_sendgrid_delivery_events(
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
        onboarding = None
        onboarding_id = event.get("tenant_onboarding_id")
        if isinstance(onboarding_id, str):
            try:
                onboarding = session.get(TenantOnboarding, UUID(onboarding_id))
            except ValueError:
                onboarding = None
        message_id = event.get("sg_message_id") or event.get("sg-message-id")
        if onboarding is None and isinstance(message_id, str):
            onboarding = _find_onboarding_by_message_id(session, "email", message_id)
        if onboarding is None or onboarding.deleted_at is not None:
            continue
        _apply_delivery_receipt(
            onboarding,
            "email",
            raw_status,
            str(message_id) if message_id else None,
            event,
        )
        audit_log(
            session,
            actor="provider:sendgrid",
            entity_id=onboarding.entity_id,
            action="receipt",
            target_table="tenant_onboarding",
            target_id=onboarding.id,
            tool_name="sendgrid.event_webhook",
            tool_input={"channel": "email", "status": raw_status},
            outcome=AuditOutcome.success,
            data_classification="confidential",
        )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/webhooks/docusign", status_code=status.HTTP_204_NO_CONTENT)
async def record_docusign_envelope_event(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    _assert_docusign_webhook_secret(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    envelope_id = _docusign_envelope_id(payload)
    event_status = _docusign_status(payload)
    if not envelope_id or not event_status:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    onboarding = _find_onboarding_by_docusign_envelope_id(session, envelope_id)
    if onboarding is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    _apply_docusign_webhook_event(onboarding, payload, envelope_id, event_status, session)
    audit_log(
        session,
        actor="provider:docusign",
        entity_id=onboarding.entity_id,
        action="signature_receipt",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        tool_name="docusign.connect_webhook",
        tool_input={
            "status": event_status,
            "event": _docusign_event(payload),
            "envelope_id": envelope_id,
        },
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{onboarding_id}/reminders", response_model=TenantOnboardingRead)
def update_tenant_onboarding_reminders(
    onboarding_id: UUID,
    payload: TenantOnboardingReminderUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status != TenantOnboardingStatus.sent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only sent onboarding reminders can be edited.",
        )
    onboarding.delivery_data = _apply_reminder_update(
        onboarding.delivery_data or {},
        payload,
        user.id,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="update",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        tool_name="tenant_onboarding.reminders",
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary="Updated tenant onboarding reminder schedule.",
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/cancel", response_model=TenantOnboardingRead)
def cancel_tenant_onboarding(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    payload: TenantOnboardingCancel | None = None,
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status in {
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submitted onboarding cannot be cancelled.",
        )
    onboarding.status = TenantOnboardingStatus.cancelled
    if payload is not None:
        onboarding.cancel_reason = payload.reason
    onboarding.delivery_data = _complete_reminders(onboarding.delivery_data or {}, "cancelled")
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="cancel",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/resend", response_model=TenantOnboardingRead)
def resend_tenant_onboarding(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status in {
        TenantOnboardingStatus.cancelled,
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only sent onboarding links can be resent.",
        )
    if _is_expired(onboarding):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Expired onboarding links cannot be resent.",
        )

    now = utcnow()
    onboarding.status = TenantOnboardingStatus.sent
    onboarding.last_sent_at = now
    onboarding.resent_at = now
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="resend",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    lease, prop, tenant = _lease_scope(onboarding.lease_id, session)
    _deliver_onboarding_link(onboarding, lease, prop, tenant, user, session, "resend")
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/send-portal-invite", response_model=TenantOnboardingRead)
def send_tenant_onboarding_portal_invite(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    """Send the tenant a portal-account claim link.

    Operator-triggered. Builds an invite pointing at the tenant portal (where
    the tenant signs in with Clerk and the existing claim flow links them to
    this onboarding row). Never mutates the tenant record. The onboarding row
    must be live (``sent`` and not expired).
    """

    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status != TenantOnboardingStatus.sent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only sent onboarding rows can receive a portal invite.",
        )
    if _is_expired(onboarding):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Expired onboarding links cannot send portal invites.",
        )
    lease, prop, tenant = _lease_scope(onboarding.lease_id, session)
    if onboarding.token_consumed_at is not None:
        onboarding.token = _new_token(session)
        onboarding.token_consumed_at = None
        onboarding.resent_at = utcnow()
        session.flush()
    _deliver_portal_invite(onboarding, lease, prop, tenant, user, session)
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/send-lease-pack", response_model=TenantOnboardingRead)
def send_tenant_onboarding_lease_pack(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status != TenantOnboardingStatus.applied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only applied onboarding rows can receive a lease pack.",
        )
    if blocking_lease_question_count(onboarding):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resolve lease agreement questions before sending the lease pack.",
        )
    lease_agreement = lease_agreement_read(onboarding)
    if lease_agreement.get("status") == "signed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease agreement is already signed.",
        )
    signing = lease_agreement_section(onboarding).get("signing")
    signing_data = dict(signing) if isinstance(signing, dict) else {}
    if (
        signing_data.get("provider") == "docusign"
        and signing_data.get("status") in ACTIVE_DOCUSIGN_SIGNING_STATUSES
        and not signing_data.get("signed_at")
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A DocuSign envelope is already waiting for completion.",
        )
    lease, prop, tenant = _lease_scope(onboarding.lease_id, session)
    lease_document = _latest_lease_document(onboarding, session)
    if lease_document is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attach a lease document before sending the lease pack.",
        )
    _deliver_lease_pack(onboarding, lease, prop, tenant, lease_document, user, session)
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/activate-lease", response_model=TenantOnboardingRead)
def activate_tenant_onboarding_lease(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status != TenantOnboardingStatus.applied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only applied onboarding rows can activate a lease.",
        )
    lease, _, _ = _lease_scope(onboarding.lease_id, session)
    _activate_signed_onboarding_lease(onboarding, lease, user)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="activate_lease",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        tool_input={
            "lease_id": str(lease.id),
            "source": lease.lease_metadata.get("activation", {}).get(
                "source",
                "tenant_onboarding_docusign",
            ),
        },
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="activate",
        target_table="lease",
        target_id=lease.id,
        tool_input={"tenant_onboarding_id": str(onboarding.id)},
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/fresh-link", response_model=TenantOnboardingRead)
def refresh_tenant_onboarding_link(
    onboarding_id: UUID,
    payload: TenantOnboardingFreshLink,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status != TenantOnboardingStatus.sent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only sent onboarding links can receive a fresh link.",
        )

    lease, prop, tenant = _lease_scope(onboarding.lease_id, session)
    now = utcnow()
    previous_expires_at = onboarding.expires_at
    previous_token_consumed_at = onboarding.token_consumed_at
    refreshed_expires_at = now + timedelta(days=payload.expires_in_days)
    onboarding.token = _new_token(session)
    onboarding.token_consumed_at = None
    onboarding.expires_at = refreshed_expires_at
    onboarding.status = TenantOnboardingStatus.sent
    onboarding.last_sent_at = now
    onboarding.resent_at = now
    delivery_data = dict(onboarding.delivery_data or {})
    receipt = {
        "refreshed_at": now.isoformat(),
        "refreshed_by_user_id": str(user.id),
        "reason": payload.reason,
        "expires_in_days": payload.expires_in_days,
        "expires_at": refreshed_expires_at.isoformat(),
        "previous_expires_at": (
            previous_expires_at.isoformat() if previous_expires_at is not None else None
        ),
        "previous_token_consumed_at": (
            previous_token_consumed_at.isoformat()
            if previous_token_consumed_at is not None
            else None
        ),
    }
    history = delivery_data.get("fresh_link_history")
    next_history = (
        [item for item in history if isinstance(item, dict)]
        if isinstance(history, list)
        else []
    )
    next_history.append(receipt)
    delivery_data["fresh_link"] = receipt
    delivery_data["fresh_link_history"] = next_history[-5:]
    onboarding.delivery_data = delivery_data
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="refresh_link",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        tool_name="tenant_onboarding.fresh_link",
        tool_input={
            "reason": payload.reason,
            "expires_in_days": payload.expires_in_days,
        },
        tool_output_summary="Rotated tenant onboarding token and prepared a fresh portal link.",
        data_classification="confidential",
    )
    session.flush()
    _deliver_onboarding_link(onboarding, lease, prop, tenant, user, session, "fresh_link")
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/review", response_model=TenantOnboardingRead)
def review_tenant_onboarding(
    onboarding_id: UUID,
    payload: TenantOnboardingReview,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status not in {TenantOnboardingStatus.submitted, TenantOnboardingStatus.reviewed}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only submitted onboarding can be reviewed.",
        )
    tenant = session.get(Tenant, onboarding.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    changes = tenant_submission_changes(tenant, onboarding.submitted_data)
    onboarding.review_data = {
        **payload.model_dump(mode="json"),
        "changes": changes,
        "change_count": len(changes),
    }
    onboarding.reviewed_at = utcnow()
    onboarding.reviewed_by_user_id = user.id
    if payload.approved:
        onboarding.status = TenantOnboardingStatus.reviewed
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="review",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post(
    "/{onboarding_id}/lease-questions/{question_id}/respond",
    response_model=TenantOnboardingRead,
)
def respond_tenant_onboarding_lease_question(
    onboarding_id: UUID,
    question_id: str,
    payload: TenantLeaseQuestionResponse,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status not in {
        TenantOnboardingStatus.sent,
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease agreement questions can only be answered before signing.",
        )
    if payload.status in {"answered", "resolved"} and not payload.answer:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="An answer is required before sending a lease agreement response.",
        )
    updated = respond_to_lease_question(
        onboarding,
        question_id=question_id,
        answer=payload.answer,
        response_status=payload.status,
        actor=user.actor,
        user_id=user.id,
    )
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lease agreement question not found.",
        )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="respond_lease_question",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        tool_name="tenant_onboarding.lease_question_response",
        tool_input={"question_id": question_id, "status": payload.status},
        tool_output_summary="Answered tenant lease agreement question.",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/apply", response_model=TenantOnboardingRead)
def apply_tenant_onboarding(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status not in {
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only submitted onboarding can be applied.",
        )
    tenant = session.get(Tenant, onboarding.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    if blocking_lease_question_count(onboarding):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resolve lease agreement questions before applying onboarding.",
        )
    changes = []
    if isinstance(onboarding.review_data, dict) and isinstance(
        onboarding.review_data.get("changes"), list
    ):
        changes = list(onboarding.review_data.get("changes") or [])
    if not changes:
        changes = tenant_submission_changes(tenant, onboarding.submitted_data)
    _apply_submission(onboarding, tenant)
    onboarding.status = TenantOnboardingStatus.applied
    onboarding.applied_at = utcnow()
    onboarding.applied_by_user_id = user.id
    onboarding.delivery_data = _complete_reminders(onboarding.delivery_data or {}, "applied")
    append_tenant_reviewed_change_history(tenant, onboarding, changes)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="apply",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.get("/public/{token}", response_model=TenantOnboardingPublicRead)
def get_public_tenant_onboarding(
    token: str,
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingPublicRead:
    onboarding = _get_public_onboarding(token, session)
    lease, prop, tenant = _lease_scope(onboarding.lease_id, session)
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    return TenantOnboardingPublicRead(
        token=onboarding.token,
        status=onboarding.status,
        tenant_legal_name=tenant.legal_name,
        tenant_trading_name=tenant.trading_name,
        property_name=prop.name,
        property_address=_property_address(prop),
        unit_label=unit.unit_label,
        contact_name=tenant.contact_name,
        contact_email=tenant.contact_email,
        contact_phone=tenant.contact_phone,
        billing_email=tenant.billing_email,
        lease_commencement_date=lease.commencement_date,
        lease_expiry_date=lease.expiry_date,
        due_date=onboarding.due_date,
        expires_at=onboarding.expires_at,
        submitted_at=onboarding.submitted_at,
    )


@router.get("/public/{token}/documents", response_model=list[DocumentRead])
def list_public_onboarding_documents(
    token: str,
    session: Annotated[Session, Depends(get_session)],
) -> list[StoredDocument]:
    onboarding = _get_public_onboarding(token, session)
    rows = session.scalars(
        select(StoredDocument)
        .where(
            StoredDocument.entity_id == onboarding.entity_id,
            StoredDocument.tenant_id == onboarding.tenant_id,
            StoredDocument.tenant_onboarding_id == onboarding.id,
            StoredDocument.deleted_at.is_(None),
        )
        .order_by(StoredDocument.created_at.desc())
    ).all()
    return list(rows)


@router.post(
    "/public/{token}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_public_onboarding_document(
    token: str,
    session: Annotated[Session, Depends(get_session)],
    file: Annotated[UploadFile, File()],
    category: Annotated[DocumentCategory, Form()] = DocumentCategory.onboarding,
    notes: Annotated[str | None, Form()] = None,
) -> StoredDocument:
    onboarding = _get_public_onboarding(token, session)
    _assert_public_onboarding_editable(onboarding)
    lease, prop, _tenant = _lease_scope(onboarding.lease_id, session)
    data = await file.read()
    max_bytes = get_settings().document_max_bytes
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty.")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Document is too large. Max size is {max_bytes // 1_000_000}MB.",
        )

    document = StoredDocument(
        entity_id=onboarding.entity_id,
        property_id=prop.id,
        tenancy_unit_id=lease.tenancy_unit_id,
        tenant_id=onboarding.tenant_id,
        lease_id=onboarding.lease_id,
        tenant_onboarding_id=onboarding.id,
        filename=Path(file.filename or "document").name,
        content_type=file.content_type,
        byte_size=len(data),
        file_data=data,
        category=category,
        notes=notes.strip() if notes and notes.strip() else None,
        document_metadata={"source": "tenant_onboarding"},
    )
    session.add(document)
    session.flush()
    audit_log(
        session,
        actor=f"tenant-onboarding:{token[:8]}",
        entity_id=onboarding.entity_id,
        action="upload",
        target_table="stored_document",
        target_id=document.id,
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(document)
    return document


@router.get("/public/{token}/documents/{document_id}/download")
def download_public_onboarding_document(
    token: str,
    document_id: UUID,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    _onboarding, document = _public_document(token, document_id, session)
    return Response(
        content=document.file_data,
        media_type=document.content_type or "application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(document.filename)}"},
    )


@router.delete("/public/{token}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_public_onboarding_document(
    token: str,
    document_id: UUID,
    session: Annotated[Session, Depends(get_session)],
) -> None:
    onboarding, document = _public_document(token, document_id, session)
    _assert_public_onboarding_editable(onboarding)
    document.deleted_at = utcnow()
    audit_log(
        session,
        actor=f"tenant-onboarding:{token[:8]}",
        entity_id=onboarding.entity_id,
        action="delete",
        target_table="stored_document",
        target_id=document.id,
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()


@router.post("/public/{token}/submit", response_model=TenantOnboardingPublicRead)
def submit_public_tenant_onboarding(
    token: str,
    payload: TenantOnboardingSubmit,
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingPublicRead:
    onboarding = _get_public_onboarding(token, session)
    _assert_public_onboarding_editable(onboarding)
    if not payload.accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Acceptance is required.",
        )
    tenant = session.get(Tenant, onboarding.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    data = payload.model_dump(mode="json")
    onboarding.status = TenantOnboardingStatus.submitted
    onboarding.submitted_data = data
    onboarding.submitted_at = utcnow()
    onboarding.delivery_data = _complete_reminders(onboarding.delivery_data or {}, "submitted")
    audit_log(
        session,
        actor=f"tenant-onboarding:{token[:8]}",
        entity_id=onboarding.entity_id,
        action="submit",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    return get_public_tenant_onboarding(token, session)
