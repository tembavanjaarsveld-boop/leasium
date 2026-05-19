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
    send_tenant_onboarding_invite,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.documents import DocumentRead
from apps.api.schemas.tenant_onboarding import (
    TenantOnboardingCancel,
    TenantOnboardingCreate,
    TenantOnboardingPublicRead,
    TenantOnboardingRead,
    TenantOnboardingReminderRunRead,
    TenantOnboardingReview,
    TenantOnboardingSubmit,
)

router = APIRouter(prefix="/tenant-onboarding", tags=["tenant-onboarding"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

REMINDER_STEPS = (
    ("first", "First reminder", 2),
    ("second", "Second reminder", 5),
    ("final", "Final reminder", 10),
)
ACTIVE_DELIVERY_STATUSES = {"queued", "sent", "delivered", "opened"}


def _onboarding_url(token: str) -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/onboarding/{token}"


def _read(row: TenantOnboarding) -> TenantOnboardingRead:
    response = TenantOnboardingRead.model_validate(row)
    response.onboarding_url = _onboarding_url(row.token)
    return response


def _delivery_data(
    current: dict[str, object],
    results: list[DeliveryResult],
    reason: str,
) -> dict[str, object]:
    attempted_at = utcnow().isoformat()
    channels = {result.channel: result.to_dict() for result in results}
    history = current.get("history", [])
    if not isinstance(history, list):
        history = []
    return {
        **current,
        "last_attempted_at": attempted_at,
        "last_reason": reason,
        "channels": channels,
        "history": [
            {
                "attempted_at": attempted_at,
                "reason": reason,
                "channels": channels,
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
    return not any(result.status in ACTIVE_DELIVERY_STATUSES for result in results)


def _reset_reminders(
    current: dict[str, object],
    sent_at: datetime,
    results: list[DeliveryResult],
) -> dict[str, object]:
    base = _normalise_datetime(sent_at)
    paused = _channel_results_need_attention(results)
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
    return {
        **current,
        "reminders": {
            "enabled": True,
            "paused": paused,
            "paused_reason": "contact_issue" if paused else None,
            "schedule": schedule,
            "next_reminder_at": None if paused else schedule[0]["scheduled_at"],
            "last_reminder_sent_at": None,
            "completed_at": None,
        },
    }


def _reminder_state(current: dict[str, object]) -> dict[str, Any]:
    reminders = current.get("reminders", {})
    return reminders if isinstance(reminders, dict) else {}


def _reminder_schedule(reminders: dict[str, Any]) -> list[dict[str, Any]]:
    schedule = reminders.get("schedule", [])
    return schedule if isinstance(schedule, list) else []


def _mark_reminder_attempt(
    current: dict[str, object],
    reminder_key: str,
    results: list[DeliveryResult],
) -> dict[str, object]:
    now = utcnow().isoformat()
    reminders = _reminder_state(current)
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
    if not paused:
        for step in schedule:
            if step.get("status") == "scheduled":
                next_reminder_at = step.get("scheduled_at")
                break

    return {
        **current,
        "reminders": {
            **reminders,
            "enabled": True,
            "paused": paused,
            "paused_reason": "contact_issue" if paused else None,
            "schedule": schedule,
            "next_reminder_at": next_reminder_at,
            "last_reminder_sent_at": now,
        },
    }


def _complete_reminders(current: dict[str, object], reason: str) -> dict[str, object]:
    reminders = _reminder_state(current)
    if not reminders:
        return current
    return {
        **current,
        "reminders": {
            **reminders,
            "enabled": False,
            "paused": False,
            "paused_reason": None,
            "completed_at": utcnow().isoformat(),
            "completed_reason": reason,
            "next_reminder_at": None,
        },
    }


def _next_due_reminder(row: TenantOnboarding, now: datetime) -> str | None:
    reminders = _reminder_state(row.delivery_data or {})
    if reminders.get("enabled") is False or reminders.get("paused") is True:
        return None
    next_at = _parse_datetime(reminders.get("next_reminder_at"))
    if next_at is None or next_at > now:
        return None
    for step in _reminder_schedule(reminders):
        if step.get("scheduled_at") == reminders.get("next_reminder_at"):
            return str(step.get("key"))
    return None


def _ensure_reminder_plan(row: TenantOnboarding) -> None:
    if _reminder_state(row.delivery_data or {}) or row.last_sent_at is None:
        return
    row.delivery_data = _reset_reminders(row.delivery_data or {}, row.last_sent_at, [])


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
    )
    results = send_tenant_onboarding_invite(invite, settings)
    next_delivery_data = _delivery_data(onboarding.delivery_data or {}, results, reason)
    if reason in {"send", "resend"}:
        next_delivery_data = _reset_reminders(
            next_delivery_data,
            onboarding.last_sent_at or utcnow(),
            results,
        )
    elif reason.startswith("reminder:"):
        next_delivery_data = _mark_reminder_attempt(
            next_delivery_data,
            reason.split(":", 1)[1],
            results,
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


def _is_expired(row: TenantOnboarding) -> bool:
    if row.expires_at is None:
        return False
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= utcnow()


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

    onboarding = TenantOnboarding(
        entity_id=prop.entity_id,
        lease_id=lease.id,
        tenant_id=tenant.id,
        token=_new_token(session),
        status=TenantOnboardingStatus.sent,
        due_date=payload.due_date,
        expires_at=payload.expires_at,
        last_sent_at=utcnow(),
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
            f"reminder:{reminder_key}",
        )
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=entity_id,
            action="reminder",
            target_table="tenant_onboarding",
            target_id=onboarding.id,
            tool_input={"reminder_key": reminder_key},
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

    onboarding.review_data = payload.model_dump(mode="json")
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

    _apply_submission(onboarding, tenant)
    onboarding.status = TenantOnboardingStatus.applied
    onboarding.applied_at = utcnow()
    onboarding.applied_by_user_id = user.id
    onboarding.delivery_data = _complete_reminders(onboarding.delivery_data or {}, "applied")
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
    if onboarding.status in {
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submitted onboarding documents cannot be changed.",
        )
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
    if onboarding.status in {
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submitted onboarding documents cannot be changed.",
        )
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
