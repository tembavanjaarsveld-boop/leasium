"""Provider receipt webhooks for assignment notifications."""

import secrets
from datetime import date, datetime
from typing import Annotated, Any
from urllib.parse import parse_qs
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AppUser,
    ArrearsCase,
    ArrearsCaseStatus,
    Entity,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationStatus,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.communications import (
    DeliveryResult,
    RenderedMessagePreview,
    WorkAssignmentDigestEmail,
    WorkAssignmentDigestEmailItem,
    render_work_assignment_digest_email_preview,
    render_work_assignment_email_preview,
    render_work_assignment_sms_preview,
    send_work_assignment_digest_email,
    send_work_assignment_email,
    send_work_assignment_sms,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.work_assignments import (
    WorkAssignmentDigestCadence,
    WorkAssignmentDigestDueCadence,
    WorkAssignmentDigestDueRunRead,
    WorkAssignmentDigestItemRead,
    WorkAssignmentDigestRead,
    WorkAssignmentDigestRun,
    WorkAssignmentDigestRunRead,
    WorkAssignmentNoticeChannelReceiptRead,
    WorkAssignmentNoticeEmailSend,
    WorkAssignmentNoticeEmailSendRead,
    WorkAssignmentNoticeGroup,
    WorkAssignmentNoticeSmsSend,
    WorkAssignmentNoticeSmsSendRead,
    WorkAssignmentNotificationCenterDigestRead,
    WorkAssignmentNotificationCenterItemRead,
    WorkAssignmentNotificationCenterRead,
    WorkAssignmentNotificationCenterReadState,
    WorkAssignmentNotificationChannelRead,
    WorkAssignmentNotificationSetupCheckRead,
    WorkAssignmentNotificationTemplateCatalogRead,
    WorkAssignmentNotificationTemplateRead,
    WorkAssignmentProviderHistoryRead,
    WorkAssignmentRenderedMessagePreviewRead,
)
from apps.api.webhook_auth import twilio_signature_valid, webhook_secret_valid
from apps.api.work_assignments import (
    apply_work_assignment_delivery_receipt,
    apply_work_assignment_sms_delivery_receipt,
    assigned_work_assignment_user,
    assignment_notification_message_matches,
    assignment_notification_sent,
    assignment_notification_sent_for_channel,
    assignment_notification_sms_message_matches,
    record_work_assignment_delivery,
    record_work_assignment_sms_delivery,
    work_assignment_email_invite,
    work_assignment_email_preference_enabled,
    work_assignment_email_preference_skipped_result,
    work_assignment_receipt_status,
    work_assignment_record,
    work_assignment_sms_invite,
    work_assignment_sms_preference_skipped_result,
    work_assignment_sms_recipient,
    work_url,
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

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
DIGEST_GUARDRAILS = [
    "Digest generation is review-only; it does not send email, SMS, or push notifications.",
    "Only active operators whose Work digest cadence matches this run are included.",
    (
        "Generated items come from currently assigned open maintenance, arrears, "
        "and critical-date work."
    ),
]
DIGEST_DELIVERY_GUARDRAILS = [
    "Digest email delivery only runs when send_email_approved is explicitly true.",
    "Only active operators whose Work digest cadence matches this run are included.",
    "SendGrid failures and preference skips are stored as receipt history for review.",
]
DUE_DIGEST_GUARDRAILS = [
    "Due digest runs are review-only; they do not send email, SMS, or push notifications.",
    "Cron callers do not need entity IDs; active entities are scanned for matching assigned work.",
    "Only active operators whose digest cadence matches the run are included.",
]
DUE_DIGEST_DELIVERY_GUARDRAILS = [
    "Due digest email delivery only runs when send_email_approved is explicitly true.",
    "Cron callers do not need entity IDs; active entities are scanned for matching assigned work.",
    "SendGrid failures and preference skips are stored as receipt history for review.",
]
NOTIFICATION_CENTER_GUARDRAILS = [
    "Notification center is read-only; sending still requires explicit operator action.",
    "Digest receipts are preview receipts unless message_sent is true.",
]
NOTIFICATION_TEMPLATE_GUARDRAILS = [
    "Template choices only set reviewed SendGrid metadata; they do not send messages.",
    "Operator email and digest sends still require the existing explicit approval actions.",
]
NOTIFICATION_CENTER_READ_KEY = "work_assignment_notification_center_read_at"

SYSTEM_NOTICE_TEMPLATES = [
    WorkAssignmentNotificationTemplateRead(
        kind="assignment_notice",
        key="work_assignment_notification",
        name="Standard assignment notice",
        default_version="v1",
        subject_preview="New Leasium work assigned",
        content_summary=(
            "Includes the work title, due date, source workspace, and a link back to Leasium."
        ),
        recovery_summary="Use for normal assignment sends and retries from Work.",
    ),
    WorkAssignmentNotificationTemplateRead(
        kind="assignment_notice",
        key="work_assignment_follow_up",
        name="Follow-up assignment notice",
        default_version="v1",
        subject_preview="Leasium work follow-up needed",
        content_summary=(
            "Emphasises due reminders, escalation watch dates, and the assigned operator."
        ),
        recovery_summary="Use when reminder or escalation cues are the reason for the send.",
    ),
]
SYSTEM_DIGEST_TEMPLATES = [
    WorkAssignmentNotificationTemplateRead(
        kind="digest",
        key="work_assignment_digest",
        name="Standard work digest",
        default_version="v1",
        subject_preview="Leasium daily or weekly Work digest",
        content_summary="Groups assigned work by urgency, follow-up status, and source workspace.",
        recovery_summary="Use for normal daily and weekly digest previews, sends, and retries.",
    ),
    WorkAssignmentNotificationTemplateRead(
        kind="digest",
        key="work_assignment_digest_owner_review",
        name="Owner review digest",
        default_version="v1",
        subject_preview="Leasium owner review digest",
        content_summary=(
            "Highlights owner-facing review items, approvals, blockers, and overdue follow-ups."
        ),
        recovery_summary="Use for operators who need a higher-level review summary.",
    ),
]


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


def _assert_twilio_status_webhook_auth(
    request: Request,
    payload: dict[str, Any],
) -> None:
    settings = get_settings()
    secret = settings.communications_webhook_secret.strip()
    if secret and webhook_secret_valid(request, secret):
        return

    auth_token = settings.twilio_auth_token.strip()
    if auth_token and twilio_signature_valid(
        request,
        payload,
        auth_token,
        settings.public_api_url,
    ):
        return

    if auth_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid Twilio webhook signature.",
        )
    if secret:
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


def _metadata_record(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _metadata_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _metadata_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = _metadata_text(value)
    if text is None:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _metadata_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = _metadata_text(value)
    if text is None:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _metadata_uuid(value: Any) -> UUID | None:
    text = _metadata_text(value)
    if text is None:
        return None
    try:
        return UUID(text)
    except ValueError:
        return None


def _digest_preference(member: AppUser) -> str:
    preferences = _metadata_record(member.notification_preferences)
    cadence = preferences.get("work_assignment_digest_cadence")
    return cadence if cadence in {"off", "daily", "weekly"} else "daily"


def _metadata_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _metadata_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _template_catalog_with_configured_defaults(
    settings: Settings,
) -> WorkAssignmentNotificationTemplateCatalogRead:
    notice_templates = list(SYSTEM_NOTICE_TEMPLATES)
    configured_notice_key = _metadata_text(settings.work_assignment_email_template_key)
    configured_notice_version = (
        _metadata_text(settings.work_assignment_email_template_version) or "v1"
    )
    if configured_notice_key and all(
        template.key != configured_notice_key for template in notice_templates
    ):
        notice_templates.insert(
            0,
            WorkAssignmentNotificationTemplateRead(
                kind="assignment_notice",
                key=configured_notice_key,
                name="Configured assignment notice",
                default_version=configured_notice_version,
                subject_preview="New Leasium work assigned",
                content_summary=(
                    "Uses the configured default assignment notice key from the API environment."
                ),
                recovery_summary="Use when this environment has a custom SendGrid category.",
                is_system=False,
            ),
        )

    return WorkAssignmentNotificationTemplateCatalogRead(
        guardrails=NOTIFICATION_TEMPLATE_GUARDRAILS,
        notice_templates=notice_templates,
        digest_templates=list(SYSTEM_DIGEST_TEMPLATES),
    )


@router.get(
    "/notification-templates",
    response_model=WorkAssignmentNotificationTemplateCatalogRead,
)
def list_work_assignment_notification_templates(
    _user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentNotificationTemplateCatalogRead:
    return _template_catalog_with_configured_defaults(get_settings())


def _provider_history_records(value: Any) -> list[WorkAssignmentProviderHistoryRead]:
    records: list[WorkAssignmentProviderHistoryRead] = []
    for entry in _metadata_list(value)[:5]:
        record = _metadata_record(entry)
        records.append(
            WorkAssignmentProviderHistoryRead(
                event=_metadata_text(record.get("event")),
                channel=_metadata_text(record.get("channel")),
                status=_metadata_text(record.get("status")),
                raw_event=_metadata_text(record.get("raw_event")),
                provider=_metadata_text(record.get("provider")),
                attempted_at=_metadata_text(record.get("attempted_at")),
                received_at=_metadata_text(record.get("received_at")),
                recipient_email=_metadata_text(record.get("recipient_email")),
                recipient_phone=_metadata_text(record.get("recipient_phone")),
                provider_message_id=_metadata_text(record.get("provider_message_id")),
                error=_metadata_text(record.get("error")),
                template_key=_metadata_text(record.get("template_key")),
                template_version=_metadata_text(record.get("template_version")),
                delivery_trigger=_metadata_text(record.get("delivery_trigger")),
                recovery_of_generated_at=_metadata_text(record.get("recovery_of_generated_at")),
                delivery_attempt_count=_metadata_int(record.get("delivery_attempt_count")),
            )
        )
    return records


def _rendered_message_preview_payload(
    preview: RenderedMessagePreview,
) -> dict[str, str | None]:
    return {
        "channel": preview.channel,
        "provider": preview.provider,
        "recipient": preview.recipient,
        "subject": preview.subject,
        "body_text": preview.body_text,
        "template_key": preview.template_key,
        "template_version": preview.template_version,
        "action_label": preview.action_label,
        "action_url": preview.action_url,
    }


def _rendered_message_preview_read(
    value: RenderedMessagePreview | dict[str, Any] | None,
) -> WorkAssignmentRenderedMessagePreviewRead | None:
    if value is None:
        return None
    record = (
        _rendered_message_preview_payload(value)
        if isinstance(value, RenderedMessagePreview)
        else _metadata_record(value)
    )
    channel = _metadata_text(record.get("channel"))
    provider = _metadata_text(record.get("provider"))
    body_text = _metadata_text(record.get("body_text"))
    if channel not in {"email", "sms"} or provider is None or body_text is None:
        return None
    recipient = _metadata_text(record.get("recipient"))
    return WorkAssignmentRenderedMessagePreviewRead(
        channel=channel,  # type: ignore[arg-type]
        provider=provider,
        recipient_email=recipient if channel == "email" else None,
        recipient_phone=recipient if channel == "sms" else None,
        subject=_metadata_text(record.get("subject")),
        body_text=body_text,
        template_key=_metadata_text(record.get("template_key")),
        template_version=_metadata_text(record.get("template_version")),
        action_label=_metadata_text(record.get("action_label")),
        action_url=_metadata_text(record.get("action_url")),
    )


def _public_api_endpoint(settings: Settings, path: str) -> str | None:
    base_url = settings.public_api_url.strip().rstrip("/")
    if not base_url:
        return None
    return f"{base_url}{path}"


def _setup_check(
    *,
    key: str,
    label: str,
    ready: bool,
    ready_detail: str,
    missing_detail: str,
    value: str | None = None,
) -> WorkAssignmentNotificationSetupCheckRead:
    return WorkAssignmentNotificationSetupCheckRead(
        key=key,
        label=label,
        status="ready" if ready else "missing",
        detail=ready_detail if ready else missing_detail,
        value=value if ready else None,
    )


def _setup_review_check(
    *,
    key: str,
    label: str,
    ready: bool,
    ready_detail: str,
    missing_detail: str,
    value: str | None = None,
) -> WorkAssignmentNotificationSetupCheckRead:
    return WorkAssignmentNotificationSetupCheckRead(
        key=key,
        label=label,
        status="review" if ready else "missing",
        detail=ready_detail if ready else missing_detail,
        value=value if ready else None,
    )


def _email_setup_checks(
    settings: Settings,
) -> list[WorkAssignmentNotificationSetupCheckRead]:
    webhook_url = _public_api_endpoint(
        settings,
        "/api/v1/work-assignments/webhooks/sendgrid-events",
    )
    return [
        _setup_check(
            key="work_assignment_email_enabled",
            label="Work email toggle",
            ready=settings.work_assignment_email_enabled,
            ready_detail="Work assignment email delivery is enabled.",
            missing_detail="Enable Work assignment email before provider delivery can queue.",
        ),
        _setup_check(
            key="sendgrid_sender",
            label="SendGrid sender",
            ready=bool(settings.sendgrid_api_key and settings.sendgrid_from_email),
            ready_detail="SendGrid API key and sender email are configured.",
            missing_detail="Add SendGrid API key and sender email environment variables.",
            value=settings.sendgrid_from_email or None,
        ),
        _setup_review_check(
            key="sendgrid_event_webhook",
            label="SendGrid event webhook",
            ready=bool(webhook_url and settings.communications_webhook_secret),
            ready_detail=(
                "Use this endpoint in SendGrid Event Webhook and configure the shared "
                "webhook secret outside Leasium."
            ),
            missing_detail=(
                "Set PUBLIC_API_URL and COMMUNICATIONS_WEBHOOK_SECRET before configuring "
                "the SendGrid event endpoint."
            ),
            value=webhook_url,
        ),
    ]


def _sms_setup_checks(
    settings: Settings,
    *,
    sms_prepared_count: int,
) -> list[WorkAssignmentNotificationSetupCheckRead]:
    callback_url = _public_api_endpoint(
        settings,
        "/api/v1/work-assignments/webhooks/twilio-status",
    )
    sms_recipient_label = "recipient" if sms_prepared_count == 1 else "recipients"
    return [
        _setup_check(
            key="operator_sms_preferences",
            label="Operator SMS preferences",
            ready=sms_prepared_count > 0,
            ready_detail=(
                f"{sms_prepared_count} active operator SMS {sms_recipient_label} configured."
            ),
            missing_detail="Add reviewed operator SMS preferences before sending Work SMS.",
        ),
        _setup_check(
            key="twilio_messaging",
            label="Twilio Messaging",
            ready=bool(
                settings.twilio_account_sid
                and settings.twilio_auth_token
                and (settings.twilio_messaging_service_sid or settings.twilio_from_phone)
            ),
            ready_detail="Twilio credentials and sender or messaging service are configured.",
            missing_detail="Add Twilio credentials and a sender number or messaging service.",
        ),
        _setup_review_check(
            key="twilio_status_callback",
            label="Twilio status callback",
            ready=bool(callback_url and settings.communications_webhook_secret),
            ready_detail=(
                "Use this endpoint for Work SMS status callbacks and configure the shared "
                "webhook secret outside Leasium."
            ),
            missing_detail=(
                "Set PUBLIC_API_URL and COMMUNICATIONS_WEBHOOK_SECRET before configuring "
                "the Twilio status callback endpoint."
            ),
            value=callback_url,
        ),
    ]


def _notification_center_channels(
    settings: Settings,
    members: list[AppUser],
) -> list[WorkAssignmentNotificationChannelRead]:
    email_configured = bool(
        settings.work_assignment_email_enabled
        and settings.sendgrid_api_key
        and settings.sendgrid_from_email
    )
    sms_configured = bool(
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and (settings.twilio_messaging_service_sid or settings.twilio_from_phone)
    )
    sms_prepared_count = sum(
        1 for member in members if work_assignment_sms_recipient(member) is not None
    )
    email_setup_checks = _email_setup_checks(settings)
    sms_setup_checks = _sms_setup_checks(settings, sms_prepared_count=sms_prepared_count)
    if sms_prepared_count == 0:
        sms_readiness = "blocked"
        sms_reason = "no_operator_phone"
        sms_detail = "No active operator has SMS enabled with a reviewed phone number."
        sms_next_action = "Add reviewed operator phone/preferences before sending SMS notices."
        sms_action_available = False
    elif not sms_configured:
        sms_readiness = "actionable"
        sms_reason = "twilio_not_configured"
        sms_detail = "SMS actions are available, but Twilio is not fully configured."
        sms_next_action = "Configure Twilio to queue provider SMS instead of skipped receipts."
        sms_action_available = True
    else:
        sms_readiness = "actionable"
        sms_reason = None
        sms_detail = "Work notice SMS sends and retries use Twilio."
        sms_next_action = None
        sms_action_available = True
    return [
        WorkAssignmentNotificationChannelRead(
            channel="email",
            provider="sendgrid",
            label="Email",
            readiness="actionable",
            reason_code=None if email_configured else "sendgrid_not_configured",
            configured=email_configured,
            action_available=True,
            detail=(
                "Work notice sends and retries use SendGrid email."
                if email_configured
                else "Email actions are available, but SendGrid is not fully configured."
            ),
            next_action=None
            if email_configured
            else "Configure SendGrid to queue provider emails instead of skipped receipts.",
            setup_checks=email_setup_checks,
        ),
        WorkAssignmentNotificationChannelRead(
            channel="sms",
            provider="twilio",
            label="SMS",
            readiness=sms_readiness,  # type: ignore[arg-type]
            reason_code=sms_reason,
            configured=sms_configured,
            action_available=sms_action_available,
            detail=sms_detail,
            next_action=sms_next_action,
            setup_checks=sms_setup_checks,
        ),
        WorkAssignmentNotificationChannelRead(
            channel="in_app",
            provider="leasium",
            label="In-app",
            readiness="read_only",
            reason_code="in_app_read_only",
            configured=True,
            action_available=False,
            detail=(
                "In-app assignment receipts are recorded on work items and shown read-only here."
            ),
            next_action="Use Work assignment controls to update ownership and follow-up state.",
            setup_checks=[
                WorkAssignmentNotificationSetupCheckRead(
                    key="leasium_receipts",
                    label="Leasium receipts",
                    status="ready",
                    detail="In-app assignment receipts are stored in Leasium work metadata.",
                )
            ],
        ),
    ]


def _notice_group(
    notification_status: str | None,
    assigned_email: str | None,
) -> WorkAssignmentNoticeGroup | None:
    if notification_status == "ready" and assigned_email:
        return "ready"
    if notification_status in {"failed", "skipped"}:
        return "attention"
    if notification_status in {"queued", "sent"}:
        return "in_flight"
    if notification_status in {"delivered", "opened"}:
        return "done"
    return None


def _notice_message_sent(status_value: str | None) -> bool:
    return status_value in {"queued", "sent", "delivered", "opened"}


def _notice_delivery_attempt_count(record: dict[str, Any]) -> int:
    attempt_count = _metadata_int(record.get("attempt_count"))
    if attempt_count is not None:
        return attempt_count
    delivery_attempt_count = _metadata_int(record.get("delivery_attempt_count"))
    if delivery_attempt_count is not None:
        return delivery_attempt_count
    history = [_metadata_record(entry) for entry in _metadata_list(record.get("provider_history"))]
    attempted_history = [
        entry
        for entry in history
        if _metadata_text(entry.get("event")) == "provider_notification_attempted"
    ]
    history_counts = [
        count
        for entry in attempted_history
        if (count := _metadata_int(entry.get("delivery_attempt_count"))) is not None
    ]
    return max(history_counts) if history_counts else len(attempted_history)


def _notice_channel_receipt_read(
    *,
    channel: str,
    label: str,
    record: dict[str, Any],
    action_available: bool,
    rendered_message_preview: RenderedMessagePreview | None = None,
) -> WorkAssignmentNoticeChannelReceiptRead | None:
    status_value = _metadata_text(record.get("status"))
    if status_value is None and not action_available:
        return None
    return WorkAssignmentNoticeChannelReceiptRead(
        channel=channel,  # type: ignore[arg-type]
        label=label,
        provider=_metadata_text(record.get("provider")),
        status=status_value,
        detail=_metadata_text(record.get("detail")) or _metadata_text(record.get("error")),
        recipient_email=_metadata_text(record.get("recipient_email")),
        recipient_phone=_metadata_text(record.get("recipient_phone")),
        provider_message_id=_metadata_text(record.get("provider_message_id")),
        template_key=_metadata_text(record.get("template_key")),
        template_version=_metadata_text(record.get("template_version")),
        attempted_at=_metadata_text(record.get("attempted_at")),
        sent_at=_metadata_text(record.get("sent_at")),
        receipt_at=_metadata_text(record.get("receipt_at")),
        last_event=_metadata_text(record.get("last_event")),
        delivery_trigger=_metadata_text(record.get("delivery_trigger")),
        delivery_attempt_count=_notice_delivery_attempt_count(record),
        message_sent=_notice_message_sent(status_value),
        action_available=action_available,
        provider_history=_provider_history_records(record.get("provider_history")),
        rendered_message_preview=_rendered_message_preview_read(rendered_message_preview),
    )


def _follow_up_due(assignment: dict[str, Any], today: date) -> bool:
    reminder = _metadata_record(assignment.get("reminder"))
    escalation = _metadata_record(assignment.get("escalation"))
    reminder_status = _metadata_text(reminder.get("status"))
    escalation_status = _metadata_text(escalation.get("status"))
    reminder_due = _metadata_date(reminder.get("due_on"))
    escalation_due = _metadata_date(escalation.get("due_on"))
    if reminder_status == "due":
        return True
    if reminder_due and reminder_due <= today and reminder_status not in {"logged", "skipped"}:
        return True
    return bool(
        escalation_due
        and escalation_due <= today
        and escalation_status not in {"queued", "skipped", "resolved"}
    )


def _target_title(target: WorkAssignmentTarget) -> str:
    if isinstance(target, MaintenanceWorkOrder):
        return target.title
    if isinstance(target, ArrearsCase):
        return _metadata_text((target.arrears_metadata or {}).get("tenant_name")) or "Arrears case"
    return target.title


def _target_description(target: WorkAssignmentTarget) -> str | None:
    if isinstance(target, MaintenanceWorkOrder):
        return target.description
    if isinstance(target, ArrearsCase):
        return target.source_reference or target.notes
    return target.notes


def _target_due_date(target: WorkAssignmentTarget) -> date | None:
    if isinstance(target, MaintenanceWorkOrder):
        return target.due_date
    if isinstance(target, ArrearsCase):
        return target.next_reminder_on
    return target.due_date


def _target_status(target: WorkAssignmentTarget) -> str:
    return str(target.status.value if hasattr(target.status, "value") else target.status)


def _target_priority(target: WorkAssignmentTarget) -> str | None:
    if isinstance(target, MaintenanceWorkOrder):
        return target.priority.value
    if isinstance(target, ArrearsCase):
        return "arrears"
    return str(target.priority)


def _target_work_kind(target: WorkAssignmentTarget) -> str:
    if isinstance(target, MaintenanceWorkOrder):
        return "Maintenance"
    if isinstance(target, ArrearsCase):
        return "Arrears"
    return "Critical date"


def _target_url(target: WorkAssignmentTarget) -> str:
    if isinstance(target, MaintenanceWorkOrder):
        return f"/operations/maintenance/{target.id}"
    return "/operations"


def _digest_item(
    target: WorkAssignmentTarget,
    settings_base: str | None,
    today: date,
) -> WorkAssignmentDigestItemRead | None:
    assignment = work_assignment_record(_target_metadata(target))
    assigned_user_id = _metadata_uuid(assignment.get("assigned_user_id"))
    if assigned_user_id is None:
        return None
    notification = _metadata_record(assignment.get("notification"))
    reminder = _metadata_record(assignment.get("reminder"))
    escalation = _metadata_record(assignment.get("escalation"))
    status_value = _metadata_text(notification.get("status"))
    assigned_email = _metadata_text(assignment.get("assigned_user_email"))
    group = _notice_group(status_value, assigned_email)
    path = _target_url(target)
    return WorkAssignmentDigestItemRead(
        target_id=target.id,
        target_type=_target_table(target),  # type: ignore[arg-type]
        title=_target_title(target),
        description=_target_description(target),
        due_date=_target_due_date(target),
        status=_target_status(target),
        priority=_target_priority(target),
        notification_status=status_value,
        notification_group=group,
        notification_detail=_metadata_text(notification.get("detail"))
        or _metadata_text(notification.get("error")),
        reminder_due_on=_metadata_date(reminder.get("due_on")),
        escalation_due_on=_metadata_date(escalation.get("due_on")),
        follow_up_due=_follow_up_due(assignment, today),
        work_url=f"{settings_base}{path}" if settings_base else path,
    )


def _latest_assignment_event_at(assignment: dict[str, Any]) -> datetime | None:
    for entry in _metadata_list(assignment.get("history")):
        record = _metadata_record(entry)
        event_at = _metadata_datetime(record.get("at"))
        if event_at is not None:
            return event_at
    notification = _metadata_record(assignment.get("notification"))
    return (
        _metadata_datetime(notification.get("receipt_at"))
        or _metadata_datetime(notification.get("attempted_at"))
        or _metadata_datetime(notification.get("sent_at"))
        or _metadata_datetime(assignment.get("assigned_at"))
    )


def _notification_center_item(
    target: WorkAssignmentTarget,
    settings_base: str | None,
    today: date,
    session: Session | None = None,
) -> WorkAssignmentNotificationCenterItemRead | None:
    assignment = work_assignment_record(_target_metadata(target))
    assigned_user_id = _metadata_uuid(assignment.get("assigned_user_id"))
    assigned_name = _metadata_text(assignment.get("assigned_user_name"))
    if assigned_user_id is None and assigned_name is None:
        return None
    notification = _metadata_record(assignment.get("notification"))
    channels = _metadata_record(notification.get("channels"))
    sms_channel = _metadata_record(channels.get("sms"))
    status_value = _metadata_text(notification.get("status"))
    assigned_email = _metadata_text(assignment.get("assigned_user_email"))
    group = _notice_group(status_value, assigned_email)
    if group is None or status_value is None:
        return None
    latest_history = _metadata_record(
        _metadata_list(assignment.get("history"))[0]
        if _metadata_list(assignment.get("history"))
        else {}
    )
    assigned_app_user = assigned_work_assignment_user(_target_metadata(target), session)
    sms_action_available = work_assignment_sms_recipient(assigned_app_user) is not None
    email_action_available = group == "ready" or status_value in {"failed", "skipped"}
    sms_status = _metadata_text(sms_channel.get("status"))
    sms_receipt_action_available = sms_action_available and not _notice_message_sent(sms_status)
    settings = get_settings()
    path = _target_url(target)
    preview_work_url = work_url(settings, path)
    email_preview: RenderedMessagePreview | None = None
    sms_preview: RenderedMessagePreview | None = None
    try:
        email_preview = render_work_assignment_email_preview(
            work_assignment_email_invite(
                _target_metadata(target),
                target_id=target.id,
                target_type=_target_table(target),
                entity_id=target.entity_id,
                work_kind=_target_work_kind(target),
                title=_target_title(target),
                description=_target_description(target),
                due_date=_target_due_date(target),
                work_url=preview_work_url,
                settings=settings,
                session=session,
            )
        )
    except HTTPException:
        email_preview = None
    if sms_action_available or sms_status is not None:
        try:
            sms_preview = render_work_assignment_sms_preview(
                work_assignment_sms_invite(
                    _target_metadata(target),
                    target_id=target.id,
                    target_type=_target_table(target),
                    entity_id=target.entity_id,
                    work_kind=_target_work_kind(target),
                    title=_target_title(target),
                    description=_target_description(target),
                    due_date=_target_due_date(target),
                    work_url=preview_work_url,
                    settings=settings,
                    session=session,
                )
            )
        except HTTPException:
            sms_preview = None
    channel_receipts = [
        receipt
        for receipt in [
            _notice_channel_receipt_read(
                channel="email",
                label="Email",
                record=notification,
                action_available=email_action_available,
                rendered_message_preview=email_preview,
            ),
            _notice_channel_receipt_read(
                channel="sms",
                label="SMS",
                record=sms_channel,
                action_available=sms_receipt_action_available,
                rendered_message_preview=sms_preview,
            ),
        ]
        if receipt is not None
    ]
    return WorkAssignmentNotificationCenterItemRead(
        target_id=target.id,
        target_type=_target_table(target),  # type: ignore[arg-type]
        title=_target_title(target),
        summary=_metadata_text(latest_history.get("summary"))
        or _metadata_text(notification.get("detail"))
        or _metadata_text(notification.get("error")),
        assignee_user_id=assigned_user_id,
        assignee_name=assigned_name,
        assignee_email=assigned_email,
        group=group,
        notification_status=status_value,
        notification_detail=_metadata_text(notification.get("detail"))
        or _metadata_text(notification.get("error")),
        channel=_metadata_text(notification.get("channel")),
        provider=_metadata_text(notification.get("provider")),
        template_key=_metadata_text(notification.get("template_key")),
        template_version=_metadata_text(notification.get("template_version")),
        due_date=_target_due_date(target),
        event_at=_latest_assignment_event_at(assignment),
        follow_up_due=_follow_up_due(assignment, today),
        work_url=f"{settings_base}{path}" if settings_base else path,
        provider_history=_provider_history_records(notification.get("provider_history")),
        sms_action_available=sms_action_available,
        sms_status=sms_status,
        sms_detail=_metadata_text(sms_channel.get("detail"))
        or _metadata_text(sms_channel.get("error")),
        sms_provider=_metadata_text(sms_channel.get("provider")),
        sms_recipient_phone=_metadata_text(sms_channel.get("recipient_phone")),
        sms_provider_message_id=_metadata_text(sms_channel.get("provider_message_id")),
        sms_attempt_count=_metadata_int(sms_channel.get("attempt_count")) or 0,
        sms_provider_history=_provider_history_records(sms_channel.get("provider_history")),
        channel_receipts=channel_receipts,
    )


def _assigned_user_id(metadata: dict[str, Any] | None) -> UUID | None:
    return _metadata_uuid(work_assignment_record(metadata).get("assigned_user_id"))


def _open_assignment_targets(session: Session, entity_id: UUID) -> list[WorkAssignmentTarget]:
    targets: list[WorkAssignmentTarget] = []
    targets.extend(
        session.scalars(
            select(MaintenanceWorkOrder).where(
                MaintenanceWorkOrder.entity_id == entity_id,
                MaintenanceWorkOrder.deleted_at.is_(None),
                MaintenanceWorkOrder.status.not_in(
                    [MaintenanceWorkOrderStatus.completed, MaintenanceWorkOrderStatus.cancelled]
                ),
            )
        ).all()
    )
    targets.extend(
        session.scalars(
            select(ArrearsCase).where(
                ArrearsCase.entity_id == entity_id,
                ArrearsCase.deleted_at.is_(None),
                ArrearsCase.status.not_in(
                    [
                        ArrearsCaseStatus.resolved,
                        ArrearsCaseStatus.written_off,
                        ArrearsCaseStatus.closed,
                    ]
                ),
            )
        ).all()
    )
    targets.extend(
        session.scalars(
            select(Obligation).where(
                Obligation.entity_id == entity_id,
                Obligation.deleted_at.is_(None),
                Obligation.completed_at.is_(None),
                Obligation.status.not_in([ObligationStatus.completed, ObligationStatus.waived]),
            )
        ).all()
    )
    return [target for target in targets if _assigned_user_id(_target_metadata(target)) is not None]


def _group_count(
    items: list[WorkAssignmentDigestItemRead],
    group: WorkAssignmentNoticeGroup,
) -> int:
    return sum(1 for item in items if item.notification_group == group)


def _digest_message_sent(status_value: str) -> bool:
    return status_value in {"queued", "sent", "delivered", "opened"}


def _digest_delivery_detail(result: DeliveryResult | None) -> str | None:
    if result is None:
        return None
    if result.status in {"queued", "sent", "delivered", "opened"}:
        return "Digest email was queued by SendGrid."
    return result.error or "Digest email was not sent."


def _digest_email_preference_enabled(member: AppUser) -> bool:
    preferences = _metadata_record(member.notification_preferences)
    enabled = preferences.get("work_assignment_email_enabled")
    return enabled if isinstance(enabled, bool) else True


def _digest_template_key(member: AppUser) -> str:
    preferences = _metadata_record(member.notification_preferences)
    return (
        _metadata_text(preferences.get("work_assignment_digest_template_key"))
        or "work_assignment_digest"
    )


def _digest_template_version(member: AppUser) -> str:
    preferences = _metadata_record(member.notification_preferences)
    return _metadata_text(preferences.get("work_assignment_digest_template_version")) or "v1"


def _digest_email_preference_skipped_result(
    digest: WorkAssignmentDigestRead,
    member: AppUser,
    *,
    entity_id: UUID,
    generated_at: datetime,
) -> DeliveryResult:
    return DeliveryResult(
        channel="email",
        status="skipped",
        provider="sendgrid",
        recipient=digest.assignee_email,
        error="Assignment email disabled by operator preference.",
        metadata={
            "template_key": _digest_template_key(member),
            "template_version": _digest_template_version(member),
            "entity_id": str(entity_id),
            "assignee_user_id": str(digest.assignee_user_id),
            "cadence": digest.cadence,
            "generated_at": generated_at.isoformat(),
        },
    )


def _digest_delivery_attempt_count(
    history: list[Any],
    *,
    entity_id: UUID,
    cadence: WorkAssignmentDigestCadence,
    delivery_result: DeliveryResult | None,
) -> int:
    count = 0
    for item in history:
        receipt = _metadata_record(item)
        if _metadata_uuid(receipt.get("entity_id")) != entity_id:
            continue
        if _metadata_text(receipt.get("cadence")) != cadence:
            continue
        status_value = _metadata_text(receipt.get("delivery_status"))
        if status_value and status_value != "previewed":
            count += 1
    return count + (1 if delivery_result is not None else 0)


def _digest_work_kind(item: WorkAssignmentDigestItemRead) -> str:
    if item.target_type == "maintenance_work_order":
        return "Maintenance"
    if item.target_type == "arrears_case":
        return "Arrears"
    return "Critical date"


def _digest_email_invite(
    digest: WorkAssignmentDigestRead,
    member: AppUser,
    *,
    entity_id: UUID,
    generated_at: datetime,
) -> WorkAssignmentDigestEmail:
    return WorkAssignmentDigestEmail(
        entity_id=entity_id,
        assignee_user_id=digest.assignee_user_id,
        assignee_name=digest.assignee_name,
        assignee_email=digest.assignee_email,
        cadence=digest.cadence,
        generated_at=generated_at,
        item_count=digest.item_count,
        follow_up_due_count=digest.follow_up_due_count,
        ready_count=digest.ready_count,
        attention_count=digest.attention_count,
        in_flight_count=digest.in_flight_count,
        done_count=digest.done_count,
        items=[
            WorkAssignmentDigestEmailItem(
                title=item.title,
                work_kind=_digest_work_kind(item),
                due_date=item.due_date,
                status=item.status,
                priority=item.priority,
                follow_up_due=item.follow_up_due,
                work_url=item.work_url,
            )
            for item in digest.items
        ],
        template_key=_digest_template_key(member),
        template_version=_digest_template_version(member),
    )


def _record_digest_receipt(
    member: AppUser,
    *,
    digest: WorkAssignmentDigestRead,
    entity_id: UUID,
    generated_at: datetime,
    payload: WorkAssignmentDigestRun,
    delivery_result: DeliveryResult | None = None,
) -> dict[str, Any]:
    preferences = _metadata_record(member.notification_preferences)
    raw_history = preferences.get("work_assignment_digest_history")
    history = list(raw_history) if isinstance(raw_history, list) else []
    result_dict = delivery_result.to_dict() if delivery_result is not None else {}
    delivery_status = str(result_dict.get("status") or "previewed")
    delivery_detail = _digest_delivery_detail(delivery_result)
    delivery_trigger = payload.delivery_trigger if delivery_result is not None else "preview"
    result_metadata = _metadata_record(result_dict.get("metadata"))
    recovery_of = (
        payload.recovery_of_generated_at.isoformat()
        if payload.recovery_of_generated_at is not None
        else None
    )
    delivery_attempt_count = _digest_delivery_attempt_count(
        history,
        entity_id=entity_id,
        cadence=digest.cadence,
        delivery_result=delivery_result,
    )
    rendered_message_preview = _rendered_message_preview_payload(
        render_work_assignment_digest_email_preview(
            _digest_email_invite(
                digest,
                member,
                entity_id=entity_id,
                generated_at=generated_at,
            )
        )
    )
    provider_history = []
    if delivery_result is not None:
        provider_history.append(
            {
                "event": "digest_delivery_attempted",
                "channel": result_dict.get("channel"),
                "status": delivery_status,
                "provider": result_dict.get("provider"),
                "attempted_at": result_dict.get("attempted_at"),
                "recipient_email": result_dict.get("recipient"),
                "provider_message_id": result_dict.get("provider_message_id"),
                "error": result_dict.get("error"),
                "template_key": result_metadata.get("template_key"),
                "template_version": result_metadata.get("template_version"),
                "delivery_trigger": delivery_trigger,
                "recovery_of_generated_at": recovery_of,
                "delivery_attempt_count": delivery_attempt_count,
            }
        )
    receipt = {
        "event": "digest_generated",
        "generated_at": generated_at.isoformat(),
        "entity_id": str(entity_id),
        "cadence": digest.cadence,
        "item_count": digest.item_count,
        "ready_count": digest.ready_count,
        "attention_count": digest.attention_count,
        "in_flight_count": digest.in_flight_count,
        "done_count": digest.done_count,
        "follow_up_due_count": digest.follow_up_due_count,
        "delivery_status": delivery_status,
        "message_sent": _digest_message_sent(delivery_status),
        "delivery_detail": delivery_detail,
        "delivery_trigger": delivery_trigger,
        "recovery_of_generated_at": recovery_of,
        "delivery_attempt_count": delivery_attempt_count,
        "delivery_channel": result_dict.get("channel"),
        "provider": result_dict.get("provider"),
        "provider_message_id": result_dict.get("provider_message_id"),
        "recipient_email": result_dict.get("recipient"),
        "template_key": result_metadata.get("template_key") or _digest_template_key(member),
        "template_version": result_metadata.get("template_version")
        or _digest_template_version(member),
        "rendered_message_preview": rendered_message_preview,
        "delivery_attempted_at": result_dict.get("attempted_at"),
        "provider_history": provider_history,
    }
    preferences["work_assignment_digest_last_generated_at"] = receipt["generated_at"]
    preferences["work_assignment_digest_last_item_count"] = digest.item_count
    preferences["work_assignment_digest_history"] = [receipt, *history][:10]
    member.notification_preferences = preferences
    return receipt


def _digest_channel_receipts(
    *,
    member: AppUser,
    record: dict[str, Any],
    provider: str | None,
    delivery_status: str,
    message_sent: bool,
    template_key: str,
    template_version: str,
    attempt_count: int,
    provider_history: list[WorkAssignmentProviderHistoryRead],
    rendered_preview: WorkAssignmentRenderedMessagePreviewRead | None,
) -> list[WorkAssignmentNoticeChannelReceiptRead]:
    """Project a single Email channel receipt for a Work digest record.

    Digests are currently email-only, so the projection always returns at most
    one entry. The legacy top-level digest fields stay populated for backward
    compatibility; this list lets the Notifications UI render the same
    normalized channel-receipt cards used for Work notice rows.
    """
    recipient_email = _metadata_text(record.get("recipient_email")) or member.email
    detail = _metadata_text(record.get("delivery_detail"))
    return [
        WorkAssignmentNoticeChannelReceiptRead(
            channel="email",
            label="Work digest email",
            provider=provider,
            status=delivery_status,
            detail=detail,
            recipient_email=recipient_email,
            recipient_phone=None,
            provider_message_id=_metadata_text(record.get("provider_message_id")),
            template_key=template_key,
            template_version=template_version,
            attempted_at=_metadata_text(record.get("attempted_at")),
            sent_at=_metadata_text(record.get("sent_at")),
            receipt_at=_metadata_text(record.get("receipt_at")),
            last_event=_metadata_text(record.get("last_event")),
            delivery_trigger=_metadata_text(record.get("delivery_trigger")),
            delivery_attempt_count=attempt_count,
            message_sent=message_sent,
            action_available=False,
            provider_history=provider_history,
            rendered_message_preview=rendered_preview,
        )
    ]


def _notification_center_digest_receipts(
    members: list[AppUser],
    entity_id: UUID,
) -> list[WorkAssignmentNotificationCenterDigestRead]:
    receipts: list[WorkAssignmentNotificationCenterDigestRead] = []
    for member in members:
        preferences = _metadata_record(member.notification_preferences)
        for receipt in _metadata_list(preferences.get("work_assignment_digest_history")):
            record = _metadata_record(receipt)
            if _metadata_uuid(record.get("entity_id")) != entity_id:
                continue
            generated_at = _metadata_datetime(record.get("generated_at"))
            cadence = _metadata_text(record.get("cadence"))
            if generated_at is None or cadence not in {"daily", "weekly"}:
                continue
            item_count = record.get("item_count")
            follow_up_due_count = record.get("follow_up_due_count")
            message_sent = record.get("message_sent")
            attempt_count = record.get("delivery_attempt_count")
            delivery_channel = _metadata_text(record.get("delivery_channel"))
            provider = _metadata_text(record.get("provider"))
            normalised_item_count = (
                item_count
                if isinstance(item_count, int) and not isinstance(item_count, bool)
                else 0
            )
            normalised_follow_up_due_count = (
                follow_up_due_count
                if isinstance(follow_up_due_count, int)
                and not isinstance(follow_up_due_count, bool)
                else 0
            )
            normalised_delivery_status = (
                _metadata_text(record.get("delivery_status")) or "previewed"
            )
            normalised_message_sent = (
                message_sent if isinstance(message_sent, bool) else False
            )
            normalised_template_key = (
                _metadata_text(record.get("template_key")) or "work_assignment_digest"
            )
            normalised_template_version = (
                _metadata_text(record.get("template_version")) or "v1"
            )
            normalised_attempt_count = (
                attempt_count
                if isinstance(attempt_count, int) and not isinstance(attempt_count, bool)
                else 0
            )
            digest_provider_history = _provider_history_records(
                record.get("provider_history")
            )
            digest_rendered_preview = _rendered_message_preview_read(
                record.get("rendered_message_preview")
            )
            digest_channel_receipts = _digest_channel_receipts(
                member=member,
                record=record,
                provider=provider,
                delivery_status=normalised_delivery_status,
                message_sent=normalised_message_sent,
                template_key=normalised_template_key,
                template_version=normalised_template_version,
                attempt_count=normalised_attempt_count,
                provider_history=digest_provider_history,
                rendered_preview=digest_rendered_preview,
            )
            receipts.append(
                WorkAssignmentNotificationCenterDigestRead(
                    assignee_user_id=member.id,
                    assignee_name=member.display_name,
                    assignee_email=member.email,
                    generated_at=generated_at,
                    cadence=cadence,  # type: ignore[arg-type]
                    item_count=normalised_item_count,
                    follow_up_due_count=normalised_follow_up_due_count,
                    delivery_status=normalised_delivery_status,
                    message_sent=normalised_message_sent,
                    delivery_detail=_metadata_text(record.get("delivery_detail")),
                    delivery_channel=delivery_channel,
                    provider=provider,
                    provider_message_id=_metadata_text(record.get("provider_message_id")),
                    template_key=normalised_template_key,
                    template_version=normalised_template_version,
                    delivery_trigger=_metadata_text(record.get("delivery_trigger")),
                    recovery_of_generated_at=_metadata_datetime(
                        record.get("recovery_of_generated_at")
                    ),
                    delivery_attempt_count=normalised_attempt_count,
                    provider_history=digest_provider_history,
                    rendered_message_preview=digest_rendered_preview,
                    channel_receipts=digest_channel_receipts,
                )
            )
    receipts.sort(key=lambda receipt: receipt.generated_at, reverse=True)
    return receipts[:20]


def _apply_digest_delivery_receipt(
    session: Session,
    *,
    event: dict[str, object],
    provider_message_id: str | None,
    raw_status: str,
) -> bool:
    raw_assignee_id = event.get("work_assignment_digest_assignee_user_id")
    if not isinstance(raw_assignee_id, str):
        return False
    try:
        assignee_id = UUID(raw_assignee_id)
    except ValueError:
        return False
    member = session.get(AppUser, assignee_id)
    if member is None:
        return False

    raw_entity_id = event.get("work_assignment_digest_entity_id")
    entity_id = _metadata_uuid(raw_entity_id) if isinstance(raw_entity_id, str) else None
    raw_generated_at = event.get("work_assignment_digest_generated_at")
    generated_at = (
        _metadata_datetime(raw_generated_at) if isinstance(raw_generated_at, str) else None
    )

    preferences = _metadata_record(member.notification_preferences)
    history = [
        _metadata_record(receipt)
        for receipt in _metadata_list(preferences.get("work_assignment_digest_history"))
    ]
    match_index: int | None = None
    for index, receipt in enumerate(history):
        if (
            provider_message_id
            and _metadata_text(receipt.get("provider_message_id")) == provider_message_id
        ):
            match_index = index
            break
        if (
            entity_id is not None
            and _metadata_uuid(receipt.get("entity_id")) == entity_id
            and generated_at is not None
            and _metadata_datetime(receipt.get("generated_at")) == generated_at
        ):
            match_index = index
            break
    if match_index is None:
        return False

    now = utcnow().isoformat()
    status_value = work_assignment_receipt_status(raw_status)
    receipt = history[match_index]
    recipient_value = event.get("email") or receipt.get("recipient_email")
    recipient = str(recipient_value) if recipient_value else None
    if provider_message_id:
        receipt["provider_message_id"] = provider_message_id
    if recipient:
        receipt["recipient_email"] = recipient
    receipt["delivery_status"] = status_value
    receipt["message_sent"] = bool(receipt.get("message_sent")) or _digest_message_sent(
        status_value
    )
    receipt["last_event"] = raw_status
    receipt["receipt_at"] = now
    if status_value == "failed":
        receipt["delivery_detail"] = str(
            event.get("reason") or event.get("response") or event.get("event") or raw_status
        )
    elif status_value in {"sent", "delivered", "opened"}:
        receipt["delivery_detail"] = f"Digest email {status_value}."

    provider_history = [
        {
            "event": "digest_provider_receipt",
            "channel": "email",
            "status": status_value,
            "raw_event": raw_status,
            "provider": "sendgrid",
            "received_at": now,
            "recipient_email": recipient,
            "provider_message_id": receipt.get("provider_message_id"),
            "error": receipt.get("delivery_detail") if status_value == "failed" else None,
            "delivery_trigger": receipt.get("delivery_trigger"),
            "recovery_of_generated_at": receipt.get("recovery_of_generated_at"),
            "delivery_attempt_count": receipt.get("delivery_attempt_count"),
        },
        *_metadata_list(receipt.get("provider_history")),
    ]
    receipt["provider_history"] = provider_history[:10]
    history[match_index] = receipt
    preferences["work_assignment_digest_history"] = history[:10]
    member.notification_preferences = preferences
    audit_log(
        session,
        actor="provider:sendgrid",
        user_id=member.id,
        entity_id=entity_id,
        action="receipt",
        target_table="app_user",
        target_id=member.id,
        tool_name="sendgrid.work_assignment_digest_event_webhook",
        tool_input={"channel": "email", "status": raw_status},
        tool_output_summary="Recorded SendGrid Work digest receipt.",
        data_classification="confidential",
    )
    return True


def _entity_assignment_members(
    session: Session,
    *,
    organisation_id: UUID,
    entity_id: UUID,
) -> list[AppUser]:
    return session.scalars(
        select(AppUser)
        .join(UserEntityRole, UserEntityRole.user_id == AppUser.id)
        .where(
            AppUser.organisation_id == organisation_id,
            AppUser.is_active.is_(True),
            UserEntityRole.entity_id == entity_id,
        )
    ).all()


def _digest_cadences_for_filter(
    cadence_filter: WorkAssignmentDigestDueCadence,
) -> list[WorkAssignmentDigestCadence]:
    if cadence_filter == "all":
        return ["daily", "weekly"]
    return [cadence_filter]


def _has_assigned_digest_work(
    session: Session,
    *,
    entity_id: UUID,
    member_ids: set[UUID],
) -> bool:
    if not member_ids:
        return False
    for target in _open_assignment_targets(session, entity_id):
        assignee_id = _assigned_user_id(_target_metadata(target))
        if assignee_id in member_ids:
            return True
    return False


def _notification_center_read_at(member: AppUser | None, entity_id: UUID) -> datetime | None:
    if member is None:
        return None
    preferences = _metadata_record(member.notification_preferences)
    read_map = _metadata_record(preferences.get(NOTIFICATION_CENTER_READ_KEY))
    return _metadata_datetime(read_map.get(str(entity_id)))


def _notification_center_unread_count(
    notices: list[WorkAssignmentNotificationCenterItemRead],
    digest_receipts: list[WorkAssignmentNotificationCenterDigestRead],
    last_read_at: datetime | None,
) -> int:
    if last_read_at is None:
        return len(notices) + len(digest_receipts)
    return sum(
        1 for item in notices if item.event_at is not None and item.event_at > last_read_at
    ) + sum(1 for receipt in digest_receipts if receipt.generated_at > last_read_at)


def _latest_notification_center_activity_at(
    notices: list[WorkAssignmentNotificationCenterItemRead],
    digest_receipts: list[WorkAssignmentNotificationCenterDigestRead],
) -> datetime | None:
    activity = [
        timestamp
        for timestamp in [
            *(item.event_at for item in notices),
            *(receipt.generated_at for receipt in digest_receipts),
        ]
        if timestamp is not None
    ]
    return max(activity) if activity else None


@router.get("/notification-center", response_model=WorkAssignmentNotificationCenterRead)
def get_work_assignment_notification_center(
    entity_id: Annotated[UUID, Query()],
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentNotificationCenterRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    settings = get_settings()
    frontend_base = settings.frontend_url.strip().rstrip("/") or None
    today = utcnow().date()
    notices = [
        item
        for target in _open_assignment_targets(session, entity_id)
        if (item := _notification_center_item(target, frontend_base, today, session)) is not None
    ]
    group_rank = {"attention": 0, "ready": 1, "in_flight": 2, "done": 3}
    notices.sort(
        key=lambda item: (
            group_rank[item.group],
            0 if item.follow_up_due else 1,
            -(item.event_at.timestamp() if item.event_at is not None else 0),
            item.due_date or date.max,
            item.title,
        )
    )
    members = _entity_assignment_members(
        session,
        organisation_id=user.organisation_id,
        entity_id=entity_id,
    )
    digest_receipts = _notification_center_digest_receipts(members, entity_id)
    current_member = session.get(AppUser, user.id)
    last_read_at = _notification_center_read_at(current_member, entity_id)
    return WorkAssignmentNotificationCenterRead(
        entity_id=entity_id,
        generated_at=utcnow(),
        last_read_at=last_read_at,
        unread_count=_notification_center_unread_count(
            notices,
            digest_receipts,
            last_read_at,
        ),
        notice_count=len(notices),
        attention_count=sum(1 for item in notices if item.group == "attention"),
        ready_count=sum(1 for item in notices if item.group == "ready"),
        in_flight_count=sum(1 for item in notices if item.group == "in_flight"),
        done_count=sum(1 for item in notices if item.group == "done"),
        digest_receipt_count=len(digest_receipts),
        guardrails=NOTIFICATION_CENTER_GUARDRAILS,
        channels=_notification_center_channels(settings, members),
        notices=notices[:50],
        digest_receipts=digest_receipts,
    )


@router.post(
    "/notification-center/mark-read",
    response_model=WorkAssignmentNotificationCenterReadState,
)
def mark_work_assignment_notification_center_read(
    entity_id: Annotated[UUID, Query()],
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentNotificationCenterReadState:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    member = session.get(AppUser, user.id)
    if member is None or member.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operator not found.")
    settings = get_settings()
    frontend_base = settings.frontend_url.strip().rstrip("/") or None
    today = utcnow().date()
    notices = [
        item
        for target in _open_assignment_targets(session, entity_id)
        if (item := _notification_center_item(target, frontend_base, today, session)) is not None
    ]
    members = _entity_assignment_members(
        session,
        organisation_id=user.organisation_id,
        entity_id=entity_id,
    )
    digest_receipts = _notification_center_digest_receipts(members, entity_id)
    now = utcnow()
    latest_activity_at = _latest_notification_center_activity_at(notices, digest_receipts)
    read_at = max(now, latest_activity_at) if latest_activity_at is not None else now
    preferences = _metadata_record(member.notification_preferences)
    read_map = _metadata_record(preferences.get(NOTIFICATION_CENTER_READ_KEY))
    read_map[str(entity_id)] = read_at.isoformat()
    preferences[NOTIFICATION_CENTER_READ_KEY] = read_map
    member.notification_preferences = preferences
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="update",
        target_table="app_user",
        target_id=member.id,
        tool_name="work_assignment.notification_center_mark_read",
        tool_input={"entity_id": str(entity_id)},
        tool_output_summary="Marked Work notification center reviewed for this entity.",
        data_classification="internal",
    )
    session.commit()
    return WorkAssignmentNotificationCenterReadState(
        entity_id=entity_id,
        read_at=read_at,
        unread_count=0,
    )


def _generate_work_assignment_digest(
    payload: WorkAssignmentDigestRun,
    *,
    session: Session,
    organisation_id: UUID,
    actor: str,
    user_id: UUID | None,
    tool_name: str,
) -> WorkAssignmentDigestRunRead:
    members = _entity_assignment_members(
        session,
        organisation_id=organisation_id,
        entity_id=payload.entity_id,
    )
    members_by_id = {
        member.id: member for member in members if _digest_preference(member) == payload.cadence
    }
    settings = get_settings()
    frontend_base = settings.frontend_url.strip().rstrip("/") or None
    today = utcnow().date()
    items_by_user: dict[UUID, list[WorkAssignmentDigestItemRead]] = {
        member_id: [] for member_id in members_by_id
    }
    for target in _open_assignment_targets(session, payload.entity_id):
        assignee_id = _assigned_user_id(_target_metadata(target))
        if assignee_id is None or assignee_id not in members_by_id:
            continue
        item = _digest_item(target, frontend_base, today)
        if item is not None:
            items_by_user[assignee_id].append(item)

    group_rank = {"attention": 0, "ready": 1, "in_flight": 2, "done": 3, None: 4}
    digests: list[WorkAssignmentDigestRead] = []
    for member_id, items in items_by_user.items():
        if not items:
            continue
        items.sort(
            key=lambda item: (
                0 if item.follow_up_due else 1,
                group_rank[item.notification_group],
                item.due_date or date.max,
                item.title,
            )
        )
        member = members_by_id[member_id]
        digests.append(
            WorkAssignmentDigestRead(
                assignee_user_id=member.id,
                assignee_name=member.display_name,
                assignee_email=member.email,
                cadence=payload.cadence,
                item_count=len(items),
                ready_count=_group_count(items, "ready"),
                attention_count=_group_count(items, "attention"),
                in_flight_count=_group_count(items, "in_flight"),
                done_count=_group_count(items, "done"),
                follow_up_due_count=sum(1 for item in items if item.follow_up_due),
                items=items[:20],
            )
        )
    digests.sort(
        key=lambda digest: (
            -digest.follow_up_due_count,
            -digest.item_count,
            digest.assignee_name,
        )
    )
    generated_at = utcnow()
    for digest in digests:
        delivery_result: DeliveryResult | None = None
        if payload.send_email_approved:
            member = members_by_id[digest.assignee_user_id]
            delivery_result = (
                send_work_assignment_digest_email(
                    _digest_email_invite(
                        digest,
                        member,
                        entity_id=payload.entity_id,
                        generated_at=generated_at,
                    ),
                    settings,
                )
                if _digest_email_preference_enabled(member)
                else _digest_email_preference_skipped_result(
                    digest,
                    member,
                    entity_id=payload.entity_id,
                    generated_at=generated_at,
                )
            )
            digest.delivery_status = delivery_result.status
            digest.message_sent = _digest_message_sent(delivery_result.status)
            digest.delivery_detail = _digest_delivery_detail(delivery_result)
            digest.provider_message_id = delivery_result.provider_message_id
        receipt = _record_digest_receipt(
            members_by_id[digest.assignee_user_id],
            digest=digest,
            entity_id=payload.entity_id,
            generated_at=generated_at,
            payload=payload,
            delivery_result=delivery_result,
        )
        digest.delivery_trigger = _metadata_text(receipt.get("delivery_trigger"))
        digest.recovery_of_generated_at = _metadata_datetime(
            receipt.get("recovery_of_generated_at")
        )
        attempt_count = receipt.get("delivery_attempt_count")
        digest.delivery_attempt_count = attempt_count if isinstance(attempt_count, int) else 0
        digest.rendered_message_preview = _rendered_message_preview_read(
            receipt.get("rendered_message_preview")
        )
    work_item_count = sum(digest.item_count for digest in digests)
    sent_count = sum(1 for digest in digests if digest.message_sent)
    delivery_summary = (
        f"attempted digest email delivery for {len(digests)} operators; {sent_count} queued/sent."
        if payload.send_email_approved
        else "no messages sent."
    )
    audit_log(
        session,
        actor=actor,
        user_id=user_id,
        entity_id=payload.entity_id,
        action="generate",
        target_table="work_assignment_digest",
        tool_name=tool_name,
        tool_input=payload.model_dump(mode="json"),
        tool_output_summary=(
            f"Generated {payload.cadence} Work assignment digest for "
            f"{len(digests)} operators and {work_item_count} items; {delivery_summary}"
        ),
        data_classification="confidential",
    )
    session.commit()
    return WorkAssignmentDigestRunRead(
        entity_id=payload.entity_id,
        cadence=payload.cadence,
        generated_at=generated_at,
        operator_count=len(digests),
        work_item_count=work_item_count,
        guardrails=(
            DIGEST_DELIVERY_GUARDRAILS if payload.send_email_approved else DIGEST_GUARDRAILS
        ),
        digests=digests,
    )


@router.post("/digests/run", response_model=WorkAssignmentDigestRunRead)
def run_work_assignment_digest(
    payload: WorkAssignmentDigestRun,
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentDigestRunRead:
    assert_entity_role(session, user, payload.entity_id, READ_ROLES)
    return _generate_work_assignment_digest(
        payload,
        session=session,
        organisation_id=user.organisation_id,
        actor=user.actor,
        user_id=user.id,
        tool_name="work_assignment.digest_generate",
    )


@router.post("/digests/run-scheduled", response_model=WorkAssignmentDigestRunRead)
def run_scheduled_work_assignment_digest(
    payload: WorkAssignmentDigestRun,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> WorkAssignmentDigestRunRead:
    _assert_webhook_secret(request)
    entity = session.get(Entity, payload.entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    if payload.send_email_approved and payload.delivery_trigger == "manual":
        payload = payload.model_copy(update={"delivery_trigger": "scheduled"})
    return _generate_work_assignment_digest(
        payload,
        session=session,
        organisation_id=entity.organisation_id,
        actor="cron:work_assignment_digest",
        user_id=None,
        tool_name="work_assignment.digest_generate_scheduled",
    )


@router.post("/digests/run-due", response_model=WorkAssignmentDigestDueRunRead)
def run_due_work_assignment_digests(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    cadence: Annotated[WorkAssignmentDigestDueCadence, Query()] = "daily",
    send_email_approved: Annotated[bool, Query()] = False,
) -> WorkAssignmentDigestDueRunRead:
    _assert_webhook_secret(request)
    entities = session.scalars(
        select(Entity).where(Entity.deleted_at.is_(None)).order_by(Entity.name)
    ).all()
    cadences = _digest_cadences_for_filter(cadence)
    runs: list[WorkAssignmentDigestRunRead] = []
    for entity in entities:
        members = _entity_assignment_members(
            session,
            organisation_id=entity.organisation_id,
            entity_id=entity.id,
        )
        for digest_cadence in cadences:
            eligible_member_ids = {
                member.id for member in members if _digest_preference(member) == digest_cadence
            }
            if not _has_assigned_digest_work(
                session,
                entity_id=entity.id,
                member_ids=eligible_member_ids,
            ):
                continue
            runs.append(
                _generate_work_assignment_digest(
                    WorkAssignmentDigestRun(
                        entity_id=entity.id,
                        cadence=digest_cadence,
                        send_email_approved=send_email_approved,
                        delivery_trigger="scheduled" if send_email_approved else "manual",
                    ),
                    session=session,
                    organisation_id=entity.organisation_id,
                    actor="cron:work_assignment_digest_due",
                    user_id=None,
                    tool_name="work_assignment.digest_generate_due",
                )
            )
    return WorkAssignmentDigestDueRunRead(
        generated_at=utcnow(),
        cadence_filter=cadence,
        entity_count=len(entities),
        run_count=len(runs),
        operator_count=sum(run.operator_count for run in runs),
        work_item_count=sum(run.work_item_count for run in runs),
        guardrails=(
            DUE_DIGEST_DELIVERY_GUARDRAILS if send_email_approved else DUE_DIGEST_GUARDRAILS
        ),
        runs=runs,
    )


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


@router.post(
    "/notification-center/notices/send-email",
    response_model=WorkAssignmentNoticeEmailSendRead,
)
def send_work_assignment_notice_email_from_notification_center(
    payload: WorkAssignmentNoticeEmailSend,
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentNoticeEmailSendRead:
    target = _get_target_by_id(session, payload.target_id, payload.target_type)
    if target is None or target.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assigned work not found.",
        )
    if target.entity_id != payload.entity_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assigned work not found.",
        )
    assert_entity_role(session, user, target.entity_id, WRITE_ROLES)

    metadata = _metadata_record(_target_metadata(target))
    settings = get_settings()
    delivery_status = "already_sent"
    message_sent = True
    recipient_email: str | None = None
    provider: str | None = None
    provider_message_id: str | None = None
    detail = "Assignment notification email has already been sent."
    template_key: str | None = None
    template_version: str | None = None
    attempted_at: str | None = None
    delivery_trigger = payload.delivery_trigger

    notification = _metadata_record(work_assignment_record(metadata).get("notification"))
    if assignment_notification_sent(metadata):
        recipient_email = _metadata_text(notification.get("recipient_email"))
        provider = _metadata_text(notification.get("provider"))
        provider_message_id = _metadata_text(notification.get("provider_message_id"))
        template_key = _metadata_text(notification.get("template_key"))
        template_version = _metadata_text(notification.get("template_version"))
        attempted_at = _metadata_text(notification.get("attempted_at"))
    else:
        path = _target_url(target)
        invite = work_assignment_email_invite(
            metadata,
            target_id=target.id,
            target_type=_target_table(target),
            entity_id=target.entity_id,
            work_kind=_target_work_kind(target),
            title=_target_title(target),
            description=_target_description(target),
            due_date=_target_due_date(target),
            work_url=work_url(settings, path),
            settings=settings,
            session=session,
        )
        result = (
            send_work_assignment_email(invite, settings)
            if work_assignment_email_preference_enabled(metadata, session)
            else work_assignment_email_preference_skipped_result(invite)
        )
        next_metadata = record_work_assignment_delivery(
            metadata,
            result=result,
            user=user,
        )
        result_dict = result.to_dict()
        delivery_status = result.status
        message_sent = result.status in {"queued", "sent", "delivered", "opened"}
        recipient_email = result.recipient
        provider = result.provider
        provider_message_id = result.provider_message_id
        detail = result.error or (
            "Assignment email was queued by SendGrid."
            if message_sent
            else "Assignment email was not sent."
        )
        result_metadata = _metadata_record(result_dict.get("metadata"))
        template_key = _metadata_text(result_metadata.get("template_key"))
        template_version = _metadata_text(result_metadata.get("template_version"))
        attempted_at = _metadata_text(result_dict.get("attempted_at"))
        _set_target_metadata(target, next_metadata)
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=target.entity_id,
            action="deliver",
            target_table=_target_table(target),
            target_id=target.id,
            tool_name="sendgrid.work_assignment.notification_center",
            tool_input={
                "target_id": str(target.id),
                "target_type": _target_table(target),
                "recipient_email": result.recipient,
                "provider": result.provider,
                "status": result.status,
            },
            tool_output_summary=(
                f"Attempted assignment notification delivery via "
                f"{result.provider}: {result.status}."
            ),
            data_classification="confidential",
        )
        session.commit()
        session.refresh(target)

    frontend_base = settings.frontend_url.strip().rstrip("/") or None
    item = _notification_center_item(target, frontend_base, utcnow().date(), session)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Assignment notice is not ready to send.",
        )
    return WorkAssignmentNoticeEmailSendRead(
        entity_id=target.entity_id,
        target_type=_target_table(target),  # type: ignore[arg-type]
        target_id=target.id,
        status=delivery_status,
        message_sent=message_sent,
        recipient_email=recipient_email,
        provider=provider,
        provider_message_id=provider_message_id,
        detail=detail,
        template_key=template_key,
        template_version=template_version,
        attempted_at=attempted_at,
        delivery_trigger=delivery_trigger,
        notice=item,
    )


@router.post(
    "/notification-center/notices/send-sms",
    response_model=WorkAssignmentNoticeSmsSendRead,
)
def send_work_assignment_notice_sms_from_notification_center(
    payload: WorkAssignmentNoticeSmsSend,
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentNoticeSmsSendRead:
    target = _get_target_by_id(session, payload.target_id, payload.target_type)
    if target is None or target.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assigned work not found.",
        )
    if target.entity_id != payload.entity_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assigned work not found.",
        )
    assert_entity_role(session, user, target.entity_id, WRITE_ROLES)

    metadata = _metadata_record(_target_metadata(target))
    settings = get_settings()
    delivery_status = "already_sent"
    message_sent = True
    recipient_phone: str | None = None
    provider: str | None = None
    provider_message_id: str | None = None
    detail = "Assignment notification SMS has already been sent."
    template_key: str | None = None
    template_version: str | None = None
    attempted_at: str | None = None
    delivery_trigger = payload.delivery_trigger

    notification = _metadata_record(work_assignment_record(metadata).get("notification"))
    channels = _metadata_record(notification.get("channels"))
    sms_channel = _metadata_record(channels.get("sms"))
    if assignment_notification_sent_for_channel(
        metadata,
        channel="sms",
        provider="twilio",
    ):
        recipient_phone = _metadata_text(sms_channel.get("recipient_phone"))
        provider = _metadata_text(sms_channel.get("provider"))
        provider_message_id = _metadata_text(sms_channel.get("provider_message_id"))
        template_key = _metadata_text(sms_channel.get("template_key"))
        template_version = _metadata_text(sms_channel.get("template_version"))
        attempted_at = _metadata_text(sms_channel.get("attempted_at"))
        delivery_trigger = "already_sent"
    else:
        path = _target_url(target)
        invite = work_assignment_sms_invite(
            metadata,
            target_id=target.id,
            target_type=_target_table(target),
            entity_id=target.entity_id,
            work_kind=_target_work_kind(target),
            title=_target_title(target),
            description=_target_description(target),
            due_date=_target_due_date(target),
            work_url=work_url(settings, path),
            settings=settings,
            session=session,
        )
        result = (
            send_work_assignment_sms(invite, settings)
            if invite.assignee_phone is not None
            else work_assignment_sms_preference_skipped_result(invite)
        )
        next_metadata = record_work_assignment_sms_delivery(
            metadata,
            result=result,
            user=user,
            delivery_trigger=payload.delivery_trigger,
        )
        result_dict = result.to_dict()
        delivery_status = result.status
        message_sent = result.status in {"queued", "sent", "delivered", "opened"}
        recipient_phone = result.recipient
        provider = result.provider
        provider_message_id = result.provider_message_id
        detail = result.error or (
            "Assignment SMS was queued by Twilio."
            if message_sent
            else "Assignment SMS was not sent."
        )
        result_metadata = _metadata_record(result_dict.get("metadata"))
        template_key = _metadata_text(result_metadata.get("template_key"))
        template_version = _metadata_text(result_metadata.get("template_version"))
        attempted_at = _metadata_text(result_dict.get("attempted_at"))
        _set_target_metadata(target, next_metadata)
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=target.entity_id,
            action="deliver",
            target_table=_target_table(target),
            target_id=target.id,
            tool_name="twilio.work_assignment.notification_center",
            tool_input={
                "target_id": str(target.id),
                "target_type": _target_table(target),
                "recipient_phone": result.recipient,
                "provider": result.provider,
                "status": result.status,
            },
            tool_output_summary=(
                f"Attempted assignment notification SMS via "
                f"{result.provider}: {result.status}."
            ),
            data_classification="confidential",
        )
        session.commit()
        session.refresh(target)

    frontend_base = settings.frontend_url.strip().rstrip("/") or None
    item = _notification_center_item(target, frontend_base, utcnow().date(), session)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Assignment notice is not ready to send SMS.",
        )
    return WorkAssignmentNoticeSmsSendRead(
        entity_id=target.entity_id,
        target_type=_target_table(target),  # type: ignore[arg-type]
        target_id=target.id,
        status=delivery_status,
        message_sent=message_sent,
        recipient_phone=recipient_phone,
        provider=provider,
        provider_message_id=provider_message_id,
        detail=detail,
        template_key=template_key,
        template_version=template_version,
        attempted_at=attempted_at,
        delivery_trigger=delivery_trigger,
        notice=item,
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


def _find_target_by_sms_message_id(
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
            if assignment_notification_sms_message_matches(
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


@router.post("/webhooks/twilio-status", status_code=status.HTTP_204_NO_CONTENT)
async def record_work_assignment_twilio_delivery_status(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    body = (await request.body()).decode()
    payload = {key: values[0] for key, values in parse_qs(body).items() if values}
    _assert_twilio_status_webhook_auth(request, payload)
    message_sid = payload.get("MessageSid") or payload.get("SmsSid")
    message_status = payload.get("MessageStatus") or payload.get("SmsStatus")
    if not message_sid or not message_status:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    target = _find_target_by_sms_message_id(session, message_sid)
    if target is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    metadata = apply_work_assignment_sms_delivery_receipt(
        _target_metadata(target),
        raw_status=message_status,
        provider_message_id=message_sid,
        event=payload,
    )
    if metadata is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    _set_target_metadata(target, metadata)
    audit_log(
        session,
        actor="provider:twilio",
        entity_id=target.entity_id,
        action="receipt",
        target_table=_target_table(target),
        target_id=target.id,
        tool_name="twilio.work_assignment_status_callback",
        tool_input={"channel": "sms", "status": message_status},
        tool_output_summary="Recorded Twilio assignment notification receipt.",
        data_classification="confidential",
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
        if _apply_digest_delivery_receipt(
            session,
            event=event,
            provider_message_id=provider_message_id,
            raw_status=raw_status,
        ):
            continue
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
