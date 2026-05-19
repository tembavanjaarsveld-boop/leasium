"""Outbound communications through Twilio SendGrid and Messaging."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from html import escape
from typing import Literal
from uuid import UUID

import httpx

from stewart.core.db import utcnow
from stewart.core.settings import Settings

DeliveryChannel = Literal["email", "sms"]
DeliveryStatus = Literal["queued", "skipped", "failed"]


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

    def to_dict(self) -> dict[str, str | None]:
        return {
            "channel": self.channel,
            "status": self.status,
            "provider": self.provider,
            "attempted_at": self.attempted_at,
            "recipient": self.recipient,
            "provider_message_id": self.provider_message_id,
            "error": self.error,
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


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _date_label(value: date | datetime | None) -> str:
    if value is None:
        return "No due date set"
    return value.strftime("%d %b %Y")


def _email_subject(invite: TenantOnboardingInvite) -> str:
    return f"Complete tenant onboarding for {invite.property_name}"


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
        <div style="font-weight:700;font-size:20px;margin-bottom:18px;">Leasium</div>
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


def _sms_body(invite: TenantOnboardingInvite) -> str:
    due = _date_label(invite.due_date)
    return (
        f"Leasium: please complete tenant onboarding for {invite.property_name} "
        f"({invite.unit_label}) by {due}: {invite.onboarding_url}"
    )


def _send_email(invite: TenantOnboardingInvite, settings: Settings) -> DeliveryResult:
    recipient = _clean(invite.contact_email)
    if not settings.tenant_onboarding_email_enabled:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            recipient=recipient,
            error="Email disabled.",
        )
    if recipient is None:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            error="No email recipient.",
        )
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        return DeliveryResult(
            channel="email",
            status="skipped",
            provider="sendgrid",
            recipient=recipient,
            error="SendGrid is not configured.",
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
        "categories": ["tenant_onboarding"],
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
            )
        return DeliveryResult(
            channel="email",
            status="failed",
            provider="sendgrid",
            recipient=recipient,
            error=f"SendGrid returned {response.status_code}.",
        )
    except httpx.HTTPError as exc:
        return DeliveryResult(
            channel="email",
            status="failed",
            provider="sendgrid",
            recipient=recipient,
            error=str(exc),
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
        )
    if recipient is None:
        return DeliveryResult(
            channel="sms",
            status="skipped",
            provider="twilio",
            error="No SMS recipient.",
        )
    if not recipient.startswith("+"):
        return DeliveryResult(
            channel="sms",
            status="skipped",
            provider="twilio",
            recipient=recipient,
            error="SMS recipient must be in E.164 format.",
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
        )

    data = {
        "To": recipient,
        "Body": _sms_body(invite),
    }
    if settings.twilio_messaging_service_sid:
        data["MessagingServiceSid"] = settings.twilio_messaging_service_sid
    else:
        data["From"] = settings.twilio_from_phone

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
            )
        return DeliveryResult(
            channel="sms",
            status="failed",
            provider="twilio",
            recipient=recipient,
            error=f"Twilio returned {response.status_code}.",
        )
    except (httpx.HTTPError, ValueError) as exc:
        return DeliveryResult(
            channel="sms",
            status="failed",
            provider="twilio",
            recipient=recipient,
            error=str(exc),
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
