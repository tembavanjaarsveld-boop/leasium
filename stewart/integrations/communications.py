"""Outbound communications through Twilio SendGrid and Messaging."""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from datetime import date, datetime
from html import escape
from typing import Literal
from urllib.parse import urlencode
from uuid import UUID

import httpx

from stewart.core.db import utcnow
from stewart.core.settings import Settings

DeliveryChannel = Literal["email", "sms"]
DeliveryStatus = Literal["queued", "sent", "delivered", "opened", "skipped", "failed", "attention"]


@dataclass(frozen=True)
class DeliveryResult:
    """Result of one outbound channel attempt."""

    channel: DeliveryChannel
    status: DeliveryStatus
    provider: str
    attempted_at: str = field(default_factory=lambda: utcnow().isoformat())
    recipient: str | None = None
    provider_message_id: str | None = None
    error: str | None = None
    metadata: dict[str, str | None] = field(default_factory=dict)

    def to_dict(self) -> dict[str, str | dict[str, str | None] | None]:
        return {
            "channel": self.channel,
            "status": self.status,
            "provider": self.provider,
            "attempted_at": self.attempted_at,
            "recipient": self.recipient,
            "provider_message_id": self.provider_message_id,
            "error": self.error,
            "metadata": self.metadata,
        }


@dataclass(frozen=True)
class TenantOnboardingInvite:
    """Context needed to send an onboarding invite."""

    onboarding_id: UUID
    entity_id: UUID
    tenant_name: str
    contact_name: str | None
    contact_email: str | None
    contact_phone: str | None
    property_name: str
    property_address: str | None
    unit_label: str
    onboarding_url: str
    due_date: date | None
    expires_at: datetime | None
    brand_name: str
    template_key: str
    template_version: str


@dataclass(frozen=True)
class OperatorInviteEmail:
    """Context needed to send an operator invite."""

    user_id: UUID
    organisation_name: str
    invited_by_name: str
    display_name: str
    email: str
    accept_url: str
    expires_at: datetime
    template_key: str
    template_version: str


@dataclass(frozen=True)
class InvoiceDeliveryEmail:
    """Context needed to send an approved invoice email."""

    invoice_draft_id: UUID
    entity_id: UUID
    invoice_number: str | None
    title: str
    issuer_name: str | None
    recipient_name: str | None
    recipient_email: str | None
    preview_url: str | None
    total_label: str
    due_label: str
    pdf_document_id: UUID | None
    pdf_filename: str | None
    pdf_content: bytes | None
    template_key: str
    template_version: str


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _categories(*values: str | None) -> list[str]:
    categories: list[str] = []
    seen: set[str] = set()
    for value in values:
        category = _clean(value)
        if category is None or category in seen:
            continue
        categories.append(category)
        seen.add(category)
    return categories


def _sendgrid_error(response: httpx.Response) -> str:
    detail: str | None = None
    try:
        body = response.json()
    except ValueError:
        detail = _clean(response.text)
    else:
        if isinstance(body, dict):
            errors = body.get("errors")
            messages: list[str] = []
            if isinstance(errors, list):
                for item in errors:
                    if not isinstance(item, dict):
                        continue
                    message = item.get("message")
                    if isinstance(message, str):
                        cleaned = _clean(message)
                        if cleaned and cleaned not in messages:
                            messages.append(cleaned)
            if messages:
                detail = "; ".join(messages)
            else:
                message = body.get("message")
                if isinstance(message, str):
                    detail = _clean(message)
    if detail:
        return f"SendGrid returned {response.status_code}: {detail}"
    return f"SendGrid returned {response.status_code}."


def _date_label(value: date | datetime | None) -> str:
    if value is None:
        return "No due date set"
    return value.strftime("%d %b %Y")


def _email_subject(invite: TenantOnboardingInvite) -> str:
    return f"Complete tenant onboarding for {invite.property_name}"


def _operator_invite_subject(invite: OperatorInviteEmail) -> str:
    return f"Join {invite.organisation_name} on Leasium"


def _email_text(invite: TenantOnboardingInvite) -> str:
    greeting = f"Hi {invite.contact_name}," if invite.contact_name else "Hi,"
    due = _date_label(invite.due_date)
    return "\n".join(
        [
            greeting,
            "",
            "Please review and complete your tenant onboarding details in Leasium.",
            "",
            f"Property: {invite.property_name}",
            f"Area: {invite.unit_label}",
            f"Due: {due}",
            "",
            invite.onboarding_url,
            "",
            "Nothing is applied to the tenant profile until the property team reviews it.",
            "",
            invite.brand_name,
        ]
    )


def _operator_invite_text(invite: OperatorInviteEmail) -> str:
    greeting = f"Hi {invite.display_name}," if invite.display_name else "Hi,"
    return "\n".join(
        [
            greeting,
            "",
            f"{invite.invited_by_name} invited you to join {invite.organisation_name} on Leasium.",
            "",
            "Accept the invite and sign in with Clerk to link this operator account:",
            invite.accept_url,
            "",
            f"This invite expires on {_date_label(invite.expires_at)}.",
            "",
            "Leasium",
        ]
    )


def _email_html(invite: TenantOnboardingInvite) -> str:
    greeting = f"Hi {escape(invite.contact_name)}," if invite.contact_name else "Hi,"
    shell_style = (
        "background:#F6F8FB;padding:28px;font-family:Inter,Arial,sans-serif;color:#101828;"
    )
    card_style = (
        "max-width:560px;margin:0 auto;background:#FFFFFF;"
        "border:1px solid #E4E7EC;border-radius:16px;padding:28px;"
    )
    button_style = (
        "display:inline-block;background:#245BFF;color:#FFFFFF;"
        "text-decoration:none;border-radius:12px;padding:12px 18px;font-weight:700;"
    )
    address = (
        f'<p style="margin:0;color:#475467;">{escape(invite.property_address)}</p>'
        if invite.property_address
        else ""
    )
    return f"""
    <div style="{shell_style}">
      <div style="{card_style}">
        <div style="font-weight:700;font-size:20px;margin-bottom:18px;">
          {escape(invite.brand_name)}
        </div>
        <p style="margin:0 0 14px;">{greeting}</p>
        <p style="margin:0 0 18px;color:#475467;line-height:1.55;">
          Please review and complete your tenant onboarding details.
        </p>
        <div style="border:1px solid #E4E7EC;border-radius:12px;padding:16px;margin-bottom:20px;">
          <p style="margin:0 0 4px;font-weight:700;">{escape(invite.property_name)}</p>
          {address}
          <p style="margin:12px 0 0;color:#475467;">Area: {escape(invite.unit_label)}</p>
          <p style="margin:4px 0 0;color:#475467;">Due: {escape(_date_label(invite.due_date))}</p>
        </div>
        <a href="{escape(invite.onboarding_url)}" style="{button_style}">
          Complete onboarding
        </a>
        <p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.45;">
          Nothing is applied to the tenant profile until the property team reviews it.
        </p>
      </div>
    </div>
    """


def _operator_invite_html(invite: OperatorInviteEmail) -> str:
    greeting = f"Hi {escape(invite.display_name)}," if invite.display_name else "Hi,"
    shell_style = (
        "background:#F6F8FB;padding:28px;font-family:Inter,Arial,sans-serif;color:#101828;"
    )
    card_style = (
        "max-width:560px;margin:0 auto;background:#FFFFFF;"
        "border:1px solid #E4E7EC;border-radius:16px;padding:28px;"
    )
    button_style = (
        "display:inline-block;background:#245BFF;color:#FFFFFF;"
        "text-decoration:none;border-radius:12px;padding:12px 18px;font-weight:700;"
    )
    return f"""
    <div style="{shell_style}">
      <div style="{card_style}">
        <div style="font-weight:700;font-size:20px;margin-bottom:18px;">Leasium</div>
        <p style="margin:0 0 14px;">{greeting}</p>
        <p style="margin:0 0 18px;color:#475467;line-height:1.55;">
          {escape(invite.invited_by_name)} invited you to join
          {escape(invite.organisation_name)} on Leasium.
        </p>
        <a href="{escape(invite.accept_url)}" style="{button_style}">
          Accept invite
        </a>
        <p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.45;">
          This invite expires on {escape(_date_label(invite.expires_at))}.
        </p>
      </div>
    </div>
    """


def _sms_body(invite: TenantOnboardingInvite) -> str:
    due = _date_label(invite.due_date)
    return (
        f"{invite.brand_name}: please complete tenant onboarding for {invite.property_name} "
        f"({invite.unit_label}) by {due}: {invite.onboarding_url}"
    )


def _twilio_status_callback_url(settings: Settings) -> str | None:
    if not settings.public_api_url:
        return None
    url = f"{settings.public_api_url.rstrip('/')}/api/v1/tenant-onboarding/webhooks/twilio-status"
    if settings.communications_webhook_secret:
        return f"{url}?{urlencode({'token': settings.communications_webhook_secret})}"
    return url


def _send_email(invite: TenantOnboardingInvite, settings: Settings) -> DeliveryResult:
    recipient = _clean(invite.contact_email)
    metadata: dict[str, str | None] = {
        "template_key": invite.template_key,
        "template_version": invite.template_version,
        "brand_name": invite.brand_name,
        "subject": _email_subject(invite),
    }
    if not settings.tenant_onboarding_email_enabled:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            recipient=recipient,
            error="Email disabled.",
            metadata=metadata,
        )
    if recipient is None:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            error="No email recipient.",
            metadata=metadata,
        )
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            recipient=recipient,
            error="SendGrid is not configured.",
            metadata=metadata,
        )

    payload = {
        "personalizations": [
            {
                "to": [
                    {
                        "email": recipient,
                        **({"name": invite.contact_name} if invite.contact_name else {}),
                    }
                ],
                "subject": _email_subject(invite),
                "custom_args": {
                    "tenant_onboarding_id": str(invite.onboarding_id),
                    "entity_id": str(invite.entity_id),
                    "template_key": invite.template_key,
                    "template_version": invite.template_version,
                    "brand_name": invite.brand_name,
                },
            }
        ],
        "from": {
            "email": settings.sendgrid_from_email,
            "name": settings.sendgrid_from_name,
        },
        "content": [
            {"type": "text/plain", "value": _email_text(invite)},
            {"type": "text/html", "value": _email_html(invite)},
        ],
        "categories": _categories("tenant_onboarding", invite.template_key),
    }
    try:
        with httpx.Client(timeout=settings.communications_timeout_seconds) as client:
            response = client.post(
                settings.sendgrid_mail_send_url,
                headers={
                    "Authorization": f"Bearer {settings.sendgrid_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if 200 <= response.status_code < 300:
            return DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient=recipient,
                provider_message_id=response.headers.get("x-message-id"),
                metadata=metadata,
            )
        return DeliveryResult(
            channel="email",
            status="failed",
            provider="sendgrid",
            recipient=recipient,
            error=_sendgrid_error(response),
            metadata=metadata,
        )
    except httpx.HTTPError as exc:
        return DeliveryResult(
            channel="email",
            status="failed",
            provider="sendgrid",
            recipient=recipient,
            error=str(exc),
            metadata=metadata,
        )


def send_operator_invite_email(
    invite: OperatorInviteEmail,
    settings: Settings,
) -> DeliveryResult:
    """Send an operator invitation email where provider credentials allow."""

    recipient = _clean(invite.email)
    metadata: dict[str, str | None] = {
        "template_key": invite.template_key,
        "template_version": invite.template_version,
        "organisation_name": invite.organisation_name,
        "subject": _operator_invite_subject(invite),
    }
    if not settings.operator_invite_email_enabled:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            recipient=recipient,
            error="Operator invite email disabled.",
            metadata=metadata,
        )
    if recipient is None:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            error="No operator email recipient.",
            metadata=metadata,
        )
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            recipient=recipient,
            error="SendGrid is not configured.",
            metadata=metadata,
        )

    payload = {
        "personalizations": [
            {
                "to": [{"email": recipient, "name": invite.display_name}],
                "subject": _operator_invite_subject(invite),
                "custom_args": {
                    "operator_user_id": str(invite.user_id),
                    "template_key": invite.template_key,
                    "template_version": invite.template_version,
                    "organisation_name": invite.organisation_name,
                },
            }
        ],
        "from": {
            "email": settings.sendgrid_from_email,
            "name": settings.sendgrid_from_name,
        },
        "content": [
            {"type": "text/plain", "value": _operator_invite_text(invite)},
            {"type": "text/html", "value": _operator_invite_html(invite)},
        ],
        "categories": _categories("operator_invite", invite.template_key),
    }
    try:
        with httpx.Client(timeout=settings.communications_timeout_seconds) as client:
            response = client.post(
                settings.sendgrid_mail_send_url,
                headers={
                    "Authorization": f"Bearer {settings.sendgrid_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if 200 <= response.status_code < 300:
            return DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient=recipient,
                provider_message_id=response.headers.get("x-message-id"),
                metadata=metadata,
            )
        return DeliveryResult(
            channel="email",
            status="failed",
            provider="sendgrid",
            recipient=recipient,
            error=_sendgrid_error(response),
            metadata=metadata,
        )
    except httpx.HTTPError as exc:
        return DeliveryResult(
            channel="email",
            status="failed",
            provider="sendgrid",
            recipient=recipient,
            error=str(exc),
            metadata=metadata,
        )


def _invoice_email_subject(invite: InvoiceDeliveryEmail) -> str:
    reference = invite.invoice_number or invite.title
    return f"Invoice {reference} from {invite.issuer_name or 'Leasium'}"


def _invoice_email_text(invite: InvoiceDeliveryEmail) -> str:
    greeting = f"Hi {invite.recipient_name}," if invite.recipient_name else "Hello,"
    preview = f"\nPreview: {invite.preview_url}" if invite.preview_url else ""
    return (
        f"{greeting}\n\n"
        f"An invoice has been prepared for {invite.total_label}. "
        f"It is due {invite.due_label}.\n\n"
        f"Reference: {invite.invoice_number or invite.title}{preview}\n\n"
        "Please reply to this email if anything looks incorrect.\n\n"
        "Regards,\n"
        f"{invite.issuer_name or 'Leasium'}"
    )


def _invoice_email_html(invite: InvoiceDeliveryEmail) -> str:
    preview_link = (
        f'<p><a href="{escape(invite.preview_url)}">View invoice preview</a></p>'
        if invite.preview_url
        else ""
    )
    greeting = (
        f"Hi {escape(invite.recipient_name)},"
        if invite.recipient_name
        else "Hello,"
    )
    return f"""
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.55;color:#172033">
      <p>{greeting}</p>
      <p>An invoice has been prepared for <strong>{escape(invite.total_label)}</strong>.</p>
      <p>Due date: <strong>{escape(invite.due_label)}</strong></p>
      <p>Reference: {escape(invite.invoice_number or invite.title)}</p>
      {preview_link}
      <p>Please reply to this email if anything looks incorrect.</p>
      <p>Regards,<br>{escape(invite.issuer_name or 'Leasium')}</p>
    </div>
    """


def send_invoice_delivery_email(
    invite: InvoiceDeliveryEmail,
    settings: Settings,
) -> DeliveryResult:
    """Send an approved invoice email where provider credentials allow."""

    recipient = _clean(invite.recipient_email)
    metadata: dict[str, str | None] = {
        "template_key": invite.template_key,
        "template_version": invite.template_version,
        "invoice_draft_id": str(invite.invoice_draft_id),
        "entity_id": str(invite.entity_id),
        "invoice_number": invite.invoice_number,
        "subject": _invoice_email_subject(invite),
        "pdf_document_id": str(invite.pdf_document_id) if invite.pdf_document_id else None,
        "pdf_filename": invite.pdf_filename,
    }
    if not settings.invoice_email_enabled:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            recipient=recipient,
            error="Invoice email disabled.",
            metadata=metadata,
        )
    if recipient is None:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            error="No invoice email recipient.",
            metadata=metadata,
        )
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            recipient=recipient,
            error="SendGrid is not configured.",
            metadata=metadata,
        )

    payload = {
        "personalizations": [
            {
                "to": [
                    {
                        "email": recipient,
                        **({"name": invite.recipient_name} if invite.recipient_name else {}),
                    }
                ],
                "subject": _invoice_email_subject(invite),
                "custom_args": {
                    "invoice_draft_id": str(invite.invoice_draft_id),
                    "entity_id": str(invite.entity_id),
                    "template_key": invite.template_key,
                    "template_version": invite.template_version,
                },
            }
        ],
        "from": {
            "email": settings.sendgrid_from_email,
            "name": settings.sendgrid_from_name,
        },
        "content": [
            {"type": "text/plain", "value": _invoice_email_text(invite)},
            {"type": "text/html", "value": _invoice_email_html(invite)},
        ],
        "categories": _categories("invoice_delivery", invite.template_key),
    }
    if invite.pdf_filename and invite.pdf_content:
        payload["attachments"] = [
            {
                "content": base64.b64encode(invite.pdf_content).decode("ascii"),
                "type": "application/pdf",
                "filename": invite.pdf_filename,
                "disposition": "attachment",
            }
        ]
    try:
        with httpx.Client(timeout=settings.communications_timeout_seconds) as client:
            response = client.post(
                settings.sendgrid_mail_send_url,
                headers={
                    "Authorization": f"Bearer {settings.sendgrid_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if 200 <= response.status_code < 300:
            return DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient=recipient,
                provider_message_id=response.headers.get("x-message-id"),
                metadata=metadata,
            )
        return DeliveryResult(
            channel="email",
            status="failed",
            provider="sendgrid",
            recipient=recipient,
            error=_sendgrid_error(response),
            metadata=metadata,
        )
    except httpx.HTTPError as exc:
        return DeliveryResult(
            channel="email",
            status="failed",
            provider="sendgrid",
            recipient=recipient,
            error=str(exc),
            metadata=metadata,
        )


def _send_sms(invite: TenantOnboardingInvite, settings: Settings) -> DeliveryResult:
    recipient = _clean(invite.contact_phone)
    if not settings.tenant_onboarding_sms_enabled:
        return DeliveryResult(
            channel="sms",
            status="skipped",
            provider="twilio",
            recipient=recipient,
            error="SMS disabled.",
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
                "brand_name": invite.brand_name,
            },
        )
    if recipient is None:
        return DeliveryResult(
            channel="sms",
            status="skipped",
            provider="twilio",
            error="No SMS recipient.",
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
                "brand_name": invite.brand_name,
            },
        )
    if not recipient.startswith("+"):
        return DeliveryResult(
            channel="sms",
            status="skipped",
            provider="twilio",
            recipient=recipient,
            error="SMS recipient must be in E.164 format.",
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
                "brand_name": invite.brand_name,
            },
        )
    if (
        not settings.twilio_account_sid
        or not settings.twilio_auth_token
        or not (settings.twilio_messaging_service_sid or settings.twilio_from_phone)
    ):
        return DeliveryResult(
            channel="sms",
            status="skipped",
            provider="twilio",
            recipient=recipient,
            error="Twilio Messaging is not configured.",
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
                "brand_name": invite.brand_name,
            },
        )

    data = {
        "To": recipient,
        "Body": _sms_body(invite),
    }
    if settings.twilio_messaging_service_sid:
        data["MessagingServiceSid"] = settings.twilio_messaging_service_sid
    else:
        data["From"] = settings.twilio_from_phone
    status_callback_url = _twilio_status_callback_url(settings)
    if status_callback_url:
        data["StatusCallback"] = status_callback_url

    url = (
        f"{settings.twilio_api_base_url.rstrip('/')}/2010-04-01/Accounts/"
        f"{settings.twilio_account_sid}/Messages.json"
    )
    try:
        with httpx.Client(timeout=settings.communications_timeout_seconds) as client:
            response = client.post(
                url,
                data=data,
                auth=(settings.twilio_account_sid, settings.twilio_auth_token),
            )
        if 200 <= response.status_code < 300:
            body = response.json()
            return DeliveryResult(
                channel="sms",
                status="queued",
                provider="twilio",
                recipient=recipient,
                provider_message_id=body.get("sid"),
                metadata={
                    "template_key": invite.template_key,
                    "template_version": invite.template_version,
                    "brand_name": invite.brand_name,
                },
            )
        return DeliveryResult(
            channel="sms",
            status="failed",
            provider="twilio",
            recipient=recipient,
            error=f"Twilio returned {response.status_code}.",
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
                "brand_name": invite.brand_name,
            },
        )
    except (httpx.HTTPError, ValueError) as exc:
        return DeliveryResult(
            channel="sms",
            status="failed",
            provider="twilio",
            recipient=recipient,
            error=str(exc),
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
                "brand_name": invite.brand_name,
            },
        )


def send_tenant_onboarding_invite(
    invite: TenantOnboardingInvite,
    settings: Settings,
) -> list[DeliveryResult]:
    """Send onboarding by email and SMS where contact details and credentials allow."""

    return [
        _send_email(invite, settings),
        _send_sms(invite, settings),
    ]
