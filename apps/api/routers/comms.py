"""Operator comms queue router.

Foundation for the scheduled comms loop described in
``docs/automation-strategy-2026-05-23.md`` (priority 1). The queue surfaces
draft communications the operator can review and approve. v1 covers arrears
reminders only; document-chase and lease-event drafts land in follow-up
slices, then approve/dispatch wires the queue into the existing SendGrid +
Twilio pipes under the provider-mutation guardrail.

Read-only — this endpoint never mutates anything, never sends a provider
message. It derives candidates from existing arrears/tenant/lease/property
records on each call.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from stewart.ai.document_intake import DocumentExtractionError, extract_document_file
from stewart.ai.inbox import INBOX_KINDS, InboxTriageError, triage_inbox
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    AuditAction,
    AuditOutcome,
    Contractor,
    DocumentCategory,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    InboundMessage,
    Lease,
    LeaseStatus,
    MaintenanceWorkOrder,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    UserRole,
)
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.comms import (
    CommsCandidate,
    CommsContractorCorrespondenceRead,
    CommsCorrespondenceEvent,
    CommsDismissCreate,
    CommsDismissRead,
    CommsDispatchCreate,
    CommsDispatchRead,
    CommsMaintenanceWorkOrderCorrespondenceRead,
    CommsOutboundLogRead,
    CommsQueueCountsRead,
    CommsQueueRead,
    CommsTenantCorrespondenceRead,
)
from apps.api.webhook_auth import twilio_signature_valid

router = APIRouter(prefix="/comms", tags=["comms"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}

WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

DEFAULT_DISMISS_DAYS = 7
DISMISS_METADATA_KEY = "comms_dismiss"
SENDGRID_INBOUND_SECRET_DETAIL = "SendGrid inbound secret is invalid."


@dataclass(frozen=True)
class _CommsEmailResult:
    """Outcome of a SendGrid send for an operator-approved comms draft."""

    status: str
    provider: str
    recipient: str | None
    provider_message_id: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class _CommsSmsResult:
    """Outcome of a Twilio Messaging send for an operator-approved comms draft."""

    status: str
    provider: str
    recipient: str | None
    provider_message_id: str | None = None
    error: str | None = None


def _send_comms_email(
    *,
    recipient_email: str | None,
    subject: str,
    body: str,
    entity_id: UUID,
    candidate_id: str,
    kind: str,
    settings: Settings,
) -> _CommsEmailResult:
    """Send an operator-drafted comms email through SendGrid.

    Mirrors the pattern in ``stewart/integrations/communications.py`` but is
    intentionally local to this module — comms drafts are ad-hoc and don't
    fit the template-keyed typed-send pattern used for invites and notices.
    Soft-fails (returns ``skipped``) when the channel is not configured;
    real errors return ``failed`` so the operator surface can show a
    receipt either way.
    """

    cleaned = (recipient_email or "").strip() or None
    if cleaned is None:
        return _CommsEmailResult(
            status="skipped",
            provider="sendgrid",
            recipient=None,
            error="No email recipient.",
        )
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        return _CommsEmailResult(
            status="skipped",
            provider="sendgrid",
            recipient=cleaned,
            error="SendGrid is not configured.",
        )
    payload: dict[str, object] = {
        "personalizations": [
            {
                "to": [{"email": cleaned}],
                "subject": subject,
                "custom_args": {
                    "entity_id": str(entity_id),
                    "candidate_id": candidate_id,
                    "kind": kind,
                },
            }
        ],
        "from": {
            "email": settings.sendgrid_from_email,
            "name": settings.sendgrid_from_name,
        },
        "content": [
            {"type": "text/plain", "value": body},
        ],
        "categories": ["comms_draft", kind],
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
            return _CommsEmailResult(
                status="queued",
                provider="sendgrid",
                recipient=cleaned,
                provider_message_id=response.headers.get("x-message-id"),
            )
        return _CommsEmailResult(
            status="failed",
            provider="sendgrid",
            recipient=cleaned,
            error=f"SendGrid returned {response.status_code}.",
        )
    except httpx.HTTPError as exc:
        return _CommsEmailResult(
            status="failed",
            provider="sendgrid",
            recipient=cleaned,
            error=str(exc),
        )


def _send_comms_sms(
    *,
    recipient_phone: str | None,
    body: str,
    entity_id: UUID,
    candidate_id: str,
    kind: str,
    settings: Settings,
) -> _CommsSmsResult:
    """Send an operator-drafted comms SMS through Twilio Messaging.

    Mirrors ``_send_comms_email`` shape. Soft-fails (returns ``skipped``)
    when Twilio is not configured or when the recipient phone isn't in
    E.164 format (Twilio rejects everything else). Real errors return
    ``failed`` so the operator surface can show a receipt either way.
    """

    cleaned = (recipient_phone or "").strip() or None
    if cleaned is None:
        return _CommsSmsResult(
            status="skipped",
            provider="twilio",
            recipient=None,
            error="No SMS recipient.",
        )
    if not cleaned.startswith("+"):
        return _CommsSmsResult(
            status="skipped",
            provider="twilio",
            recipient=cleaned,
            error="SMS recipient must be in E.164 format (start with +).",
        )
    if (
        not settings.twilio_account_sid
        or not settings.twilio_auth_token
        or not (
            settings.twilio_messaging_service_sid or settings.twilio_from_phone
        )
    ):
        return _CommsSmsResult(
            status="skipped",
            provider="twilio",
            recipient=cleaned,
            error="Twilio Messaging is not configured.",
        )

    data: dict[str, str] = {"To": cleaned, "Body": body}
    if settings.twilio_messaging_service_sid:
        data["MessagingServiceSid"] = settings.twilio_messaging_service_sid
    else:
        data["From"] = settings.twilio_from_phone
    # Custom args travel via Twilio's `Tags` (no per-message audit-args
    # equivalent to SendGrid custom_args). We embed candidate_id + kind in
    # the audit log instead so the trail is still complete.

    url = (
        f"{settings.twilio_api_base_url.rstrip('/')}/2010-04-01/Accounts/"
        f"{settings.twilio_account_sid}/Messages.json"
    )
    try:
        with httpx.Client(
            timeout=settings.communications_timeout_seconds
        ) as client:
            response = client.post(
                url,
                data=data,
                auth=(
                    settings.twilio_account_sid,
                    settings.twilio_auth_token,
                ),
            )
        if 200 <= response.status_code < 300:
            payload = response.json()
            return _CommsSmsResult(
                status="queued",
                provider="twilio",
                recipient=cleaned,
                provider_message_id=str(payload.get("sid") or "") or None,
            )
        return _CommsSmsResult(
            status="failed",
            provider="twilio",
            recipient=cleaned,
            error=f"Twilio returned {response.status_code}.",
        )
    except httpx.HTTPError as exc:
        return _CommsSmsResult(
            status="failed",
            provider="twilio",
            recipient=cleaned,
            error=str(exc),
        )


def _format_amount(cents: int, currency: str) -> str:
    """Render cents as a short currency string (e.g. ``$1,234.50 AUD``)."""

    if cents < 0:
        # Negative balances mean credit; treat as zero for messaging purposes.
        cents = 0
    whole = cents // 100
    frac = cents % 100
    return f"${whole:,}.{frac:02d} {currency}"


def _arrears_severity(case: ArrearsCase, today: date) -> str:
    """Pick the queue-row severity for an arrears case.

    Tiers map roughly to operator urgency rather than aging buckets — 90+
    days outstanding, or a paused/escalated case, is the strongest signal.
    """

    if case.balance_90_plus_cents > 0:
        return "danger"
    if case.escalation_status.value != "none":
        return "danger"
    if case.oldest_unpaid_invoice_date is not None:
        days_overdue = (today - case.oldest_unpaid_invoice_date).days
        if days_overdue >= 60:
            return "danger"
        if days_overdue >= 30:
            return "warning"
    if case.balance_61_90_cents > 0:
        return "warning"
    if case.balance_31_60_cents > 0:
        return "warning"
    return "info"


def _arrears_subject(
    case: ArrearsCase,
    property_name: str | None,
    unit_label: str | None,
    severity: str,
) -> str:
    """Templated subject line for an arrears reminder draft."""

    location = " - ".join(part for part in (property_name, unit_label) if part)
    if severity == "danger":
        prefix = "Urgent: outstanding rent"
    elif severity == "warning":
        prefix = "Reminder: outstanding rent"
    else:
        prefix = "Outstanding rent on your tenancy"
    return f"{prefix} at {location}" if location else prefix


def _arrears_body(
    case: ArrearsCase,
    tenant_name: str,
    contact_name: str | None,
    property_name: str | None,
    unit_label: str | None,
    severity: str,
) -> str:
    """Templated body for an arrears reminder draft.

    Deterministic — no AI dependency in v1. A future v2 wires this into
    OpenAI for tonally-tuned drafts; the operator approval step stays the
    same either way.
    """

    greeting = f"Hi {contact_name}," if contact_name else f"Hi {tenant_name},"
    location_parts = [part for part in (property_name, unit_label) if part]
    location = " ".join(location_parts) if location_parts else "your tenancy"
    amount = _format_amount(case.total_balance_cents, case.currency)
    as_of = case.as_of.strftime("%d %b %Y")

    if severity == "danger":
        ask = (
            "This balance is now significantly overdue and requires immediate "
            "attention. Please reply today with a payment plan or a date by "
            "which the balance will be cleared."
        )
    elif severity == "warning":
        ask = (
            "Could you let us know when we can expect payment, or reply with "
            "a payment plan if there is a temporary hardship we should know "
            "about."
        )
    else:
        ask = (
            "Could you confirm payment is in progress, or let us know if "
            "anything is preventing it from clearing."
        )

    return (
        f"{greeting}\n\n"
        f"Our records show an outstanding balance of {amount} on {location} "
        f"as of {as_of}.\n\n"
        f"{ask}\n\n"
        "If payment has been made in the last few days, please reply with "
        "the date and reference and we will reconcile it.\n\n"
        "Thanks,\nThe property team"
    )


def _arrears_detail(case: ArrearsCase, today: date) -> str:
    """Plain-English explainer for the operator on why this is in the queue."""

    parts = [_format_amount(case.total_balance_cents, case.currency)]
    if case.oldest_unpaid_invoice_date is not None:
        days = (today - case.oldest_unpaid_invoice_date).days
        if days > 0:
            parts.append(f"{days} days overdue")
    if case.reminder_stage:
        parts.append(f"reminder stage {case.reminder_stage}")
    if case.next_reminder_on is not None and case.next_reminder_on <= today:
        parts.append("scheduled reminder due")
    if case.escalation_status.value != "none":
        parts.append(f"escalation {case.escalation_status.value}")
    return ", ".join(parts)


def _tenant_display_name(tenant: Tenant) -> str:
    return tenant.trading_name or tenant.legal_name


def _maintenance_activity_audience(entry: dict[str, Any]) -> str:
    visibility = entry.get("visibility")
    source = entry.get("source")
    actor = entry.get("actor")
    event = entry.get("event") or entry.get("action")
    normalized = " ".join(
        str(value).lower()
        for value in (visibility, source, actor, event)
        if value is not None
    )
    if visibility == "tenant" or "tenant_portal" in normalized:
        return "tenant"
    if visibility == "contractor":
        return "contractor"
    return "internal"


def _latest_maintenance_activity(
    work_order: MaintenanceWorkOrder,
    audience: str,
) -> tuple[datetime, str] | None:
    metadata = work_order.work_order_metadata
    if not isinstance(metadata, dict):
        return None
    raw_history = metadata.get("activity_history")
    if not isinstance(raw_history, list):
        return None
    rows: list[tuple[datetime, str]] = []
    for entry in raw_history:
        if not isinstance(entry, dict):
            continue
        if _maintenance_activity_audience(entry) != audience:
            continue
        timestamp = (
            _parse_iso_datetime(entry.get("timestamp") or entry.get("at"))
            or work_order.updated_at
            or work_order.requested_at
        )
        summary = entry.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            summary = "Maintenance activity updated."
        rows.append((timestamp, summary.strip()))
    if not rows:
        return None
    return sorted(rows, key=lambda row: row[0], reverse=True)[0]


def _maintenance_forwarding_candidates(
    entity_id: UUID, session: Session, *, summary_only: bool = False
) -> list[CommsCandidate]:
    today = date.today()
    rows = list(
        session.scalars(
            select(MaintenanceWorkOrder)
            .where(
                MaintenanceWorkOrder.entity_id == entity_id,
                MaintenanceWorkOrder.deleted_at.is_(None),
            )
            .order_by(MaintenanceWorkOrder.requested_at.desc())
        ).all()
    )
    candidates: list[CommsCandidate] = []
    now = utcnow()
    for work_order in rows:
        metadata = (
            work_order.work_order_metadata
            if isinstance(work_order.work_order_metadata, dict)
            else {}
        )
        tenant_name: str | None = None
        tenant_recipient_email: str | None = None
        tenant_recipient_phone: str | None = None
        property_name: str | None = None
        unit_label: str | None = None
        if not summary_only:
            tenant = (
                session.get(Tenant, work_order.tenant_id)
                if work_order.tenant_id is not None
                else None
            )
            tenant_name = _tenant_display_name(tenant) if tenant is not None else None
            tenant_recipient_email = (
                (tenant.contact_email or tenant.billing_email)
                if tenant is not None
                else None
            )
            tenant_recipient_phone = (
                tenant.contact_phone if tenant is not None else None
            )
            if work_order.property_id is not None:
                prop = session.get(Property, work_order.property_id)
                if prop is not None and prop.deleted_at is None:
                    property_name = prop.name
            if work_order.tenancy_unit_id is not None:
                unit = session.get(TenancyUnit, work_order.tenancy_unit_id)
                if unit is not None and unit.deleted_at is None:
                    unit_label = unit.unit_label

        tenant_activity = _latest_maintenance_activity(work_order, "tenant")
        if tenant_activity is not None and not _comms_kind_deferred(
            metadata,
            "maintenance_contractor_forward",
            today,
        ):
            subject = ""
            body = ""
            if not summary_only:
                _, tenant_summary = tenant_activity
                contractor_label = work_order.contractor_name or "the contractor"
                subject = f"Maintenance forward: {work_order.title}"
                body = "\n".join(
                    [
                        f"Hi {contractor_label},",
                        "",
                        (
                            "Please note the latest tenant-facing update for "
                            f"{work_order.title}:"
                        ),
                        tenant_summary,
                        "",
                        (
                            "Please confirm the next action or timing before "
                            "we send anything further."
                        ),
                    ]
                )
            candidates.append(
                CommsCandidate(
                    id=(
                        "maintenance_contractor_forward:"
                        f"maintenance_work_order:{work_order.id}"
                    ),
                    kind="maintenance_contractor_forward",
                    target_kind="maintenance_work_order",
                    target_id=work_order.id,
                    tenant_id=work_order.tenant_id,
                    tenant_name=tenant_name,
                    property_name=property_name,
                    unit_label=unit_label,
                    recipient_email=work_order.contractor_email,
                    recipient_phone=work_order.contractor_phone,
                    subject=subject,
                    body=body,
                    severity="warning",
                    due_at=work_order.due_date,
                    detail="reviewed forward to contractor from latest tenant-visible activity",
                    generated_at=now,
                )
            )

        contractor_activity = _latest_maintenance_activity(work_order, "contractor")
        if contractor_activity is not None and not _comms_kind_deferred(
            metadata,
            "maintenance_tenant_forward",
            today,
        ):
            subject = ""
            body = ""
            if not summary_only:
                _, contractor_summary = contractor_activity
                tenant_label = tenant_name or "there"
                contractor_label = work_order.contractor_name or "the contractor"
                subject = f"Maintenance update: {work_order.title}"
                body = "\n".join(
                    [
                        f"Hi {tenant_label},",
                        "",
                        f"Update from {contractor_label} on {work_order.title}:",
                        contractor_summary,
                        "",
                        (
                            "We will keep this with Operations until the "
                            "message is reviewed."
                        ),
                    ]
                )
            candidates.append(
                CommsCandidate(
                    id=(
                        "maintenance_tenant_forward:"
                        f"maintenance_work_order:{work_order.id}"
                    ),
                    kind="maintenance_tenant_forward",
                    target_kind="maintenance_work_order",
                    target_id=work_order.id,
                    tenant_id=work_order.tenant_id,
                    tenant_name=tenant_name,
                    property_name=property_name,
                    unit_label=unit_label,
                    recipient_email=tenant_recipient_email,
                    recipient_phone=tenant_recipient_phone,
                    subject=subject,
                    body=body,
                    severity="warning",
                    due_at=work_order.due_date,
                    detail="reviewed forward to tenant from latest contractor-visible activity",
                    generated_at=now,
                )
            )
    return candidates


def _arrears_candidates(
    entity_id: UUID, session: Session, *, summary_only: bool = False
) -> list[CommsCandidate]:
    """Build arrears reminder candidates for ``entity_id``.

    Selects active arrears cases with a positive balance that are either due
    for their next reminder or have never had one scheduled. Paused or
    resolved cases are skipped — the operator has already chosen to stop
    chasing them.
    """

    today = date.today()
    rows = list(
        session.scalars(
            select(ArrearsCase)
            .where(
                ArrearsCase.entity_id == entity_id,
                ArrearsCase.deleted_at.is_(None),
                ArrearsCase.status == ArrearsCaseStatus.active,
                ArrearsCase.total_balance_cents > 0,
            )
            .order_by(ArrearsCase.total_balance_cents.desc())
        ).all()
    )

    candidates: list[CommsCandidate] = []
    now = utcnow()
    for case in rows:
        if case.reminder_paused_until is not None and case.reminder_paused_until > today:
            continue
        if case.next_reminder_on is not None and case.next_reminder_on > today:
            # Reminder not due yet; the operator has already decided when to ping.
            continue
        tenant = session.get(Tenant, case.tenant_id)
        if tenant is None or tenant.deleted_at is not None:
            continue
        severity = _arrears_severity(case, today)
        due_at = case.next_reminder_on or case.oldest_unpaid_invoice_date
        property_name: str | None = None
        unit_label: str | None = None
        tenant_name: str | None = None
        subject = ""
        body = ""
        detail: str | None = None
        if not summary_only:
            if case.property_id is not None:
                prop = session.get(Property, case.property_id)
                if prop is not None and prop.deleted_at is None:
                    property_name = prop.name
            if case.tenancy_unit_id is not None:
                unit = session.get(TenancyUnit, case.tenancy_unit_id)
                if unit is not None and unit.deleted_at is None:
                    unit_label = unit.unit_label
            # If a lease is attached and the case has no property/unit, fall
            # back to the lease's relations so the draft still locates the
            # tenancy.
            if (
                property_name is None or unit_label is None
            ) and case.lease_id is not None:
                lease = session.get(Lease, case.lease_id)
                if lease is not None and lease.deleted_at is None:
                    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
                    if unit is not None and unit.deleted_at is None:
                        if unit_label is None:
                            unit_label = unit.unit_label
                        if property_name is None:
                            prop = session.get(Property, unit.property_id)
                            if prop is not None and prop.deleted_at is None:
                                property_name = prop.name
            tenant_name = _tenant_display_name(tenant)
            subject = _arrears_subject(case, property_name, unit_label, severity)
            body = _arrears_body(
                case,
                tenant_name,
                tenant.contact_name,
                property_name,
                unit_label,
                severity,
            )
            detail = _arrears_detail(case, today)
        candidates.append(
            CommsCandidate(
                id=f"arrears_reminder:arrears_case:{case.id}",
                kind="arrears_reminder",
                target_kind="arrears_case",
                target_id=case.id,
                tenant_id=tenant.id,
                tenant_name=tenant_name,
                property_name=property_name,
                unit_label=unit_label,
                recipient_email=tenant.contact_email or tenant.billing_email,
                recipient_phone=tenant.contact_phone,
                subject=subject,
                body=body,
                severity=severity,  # type: ignore[arg-type]
                due_at=due_at,
                detail=detail,
                generated_at=now,
            )
        )
    return candidates


def _parse_iso_date(value: object) -> date | None:
    """Tolerantly parse an ISO date from JSONB metadata.

    Tenant insurance expiry lives on ``tenant_metadata['insurance_expiry_date']``
    as a string. Parse defensively so a malformed value doesn't crash the
    whole queue.
    """

    if value is None or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except (TypeError, ValueError):
        return None


def _parse_iso_datetime(value: object) -> datetime | None:
    """Tolerantly parse an ISO datetime from JSONB metadata."""

    if value is None or not isinstance(value, str):
        return None
    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"
    try:
        return datetime.fromisoformat(cleaned)
    except (TypeError, ValueError):
        parsed_date = _parse_iso_date(cleaned)
        if parsed_date is None:
            return None
        return datetime.combine(parsed_date, datetime.min.time())


def _comms_kind_deferred(metadata: dict[str, Any], kind: str, today: date) -> bool:
    dismiss = metadata.get(DISMISS_METADATA_KEY)
    if not isinstance(dismiss, dict):
        return False
    entry = dismiss.get(kind)
    if not isinstance(entry, dict):
        return False
    deferred_until = _parse_iso_date(
        entry.get("deferred_until") or entry.get("next_eligible_on")
    )
    return deferred_until is not None and deferred_until > today


def _insurance_candidates(
    entity_id: UUID, session: Session, *, summary_only: bool = False
) -> list[CommsCandidate]:
    """Build insurance-expiry reminder candidates for ``entity_id``.

    Scans every tenant in the entity that has an `insurance_expiry_date` in
    their `tenant_metadata`. Surfaces a reminder for any tenant whose policy
    expires within the next 45 days, or has already expired. Tenants with no
    insurance metadata are silently skipped — operators surface those via
    the onboarding/compliance workflows, not the comms queue.
    """

    today = date.today()
    cutoff = today + timedelta(days=45)
    candidates: list[CommsCandidate] = []
    now = utcnow()
    tenants = list(
        session.scalars(
            select(Tenant).where(
                Tenant.entity_id == entity_id,
                Tenant.deleted_at.is_(None),
            )
        ).all()
    )
    for tenant in tenants:
        metadata = tenant.tenant_metadata or {}
        expiry = _parse_iso_date(metadata.get("insurance_expiry_date"))
        if expiry is None:
            continue
        if expiry > cutoff:
            continue

        days_until = (expiry - today).days
        if days_until < 0:
            severity: str = "danger"
        elif days_until <= 14:
            severity = "warning"
        else:
            severity = "info"

        property_name: str | None = None
        unit_label: str | None = None
        tenant_name: str | None = None
        subject = ""
        body = ""
        detail: str | None = None
        if not summary_only:
            # We have not yet read the resolved property/unit for context —
            # pick the most recent active lease's property/unit so the
            # reminder names the location the policy covers.
            lease = session.scalar(
                select(Lease)
                .where(
                    Lease.tenant_id == tenant.id,
                    Lease.deleted_at.is_(None),
                    Lease.status.in_(
                        (LeaseStatus.active, LeaseStatus.holding_over)
                    ),
                )
                .order_by(Lease.commencement_date.desc().nulls_last())
                .limit(1)
            )
            if lease is not None:
                unit = session.get(TenancyUnit, lease.tenancy_unit_id)
                if unit is not None and unit.deleted_at is None:
                    unit_label = unit.unit_label
                    prop = session.get(Property, unit.property_id)
                    if prop is not None and prop.deleted_at is None:
                        property_name = prop.name

            if days_until < 0:
                ask = (
                    "Your insurance policy on file expired on "
                    f"{expiry.strftime('%d %b %Y')}. Please send a current "
                    "certificate of currency as soon as possible — operating "
                    "without cover may breach your lease."
                )
                subject_prefix = "Insurance has expired"
            elif days_until <= 14:
                ask = (
                    f"Your insurance policy on file expires on "
                    f"{expiry.strftime('%d %b %Y')} ({days_until} days). Please "
                    "send a renewal certificate so we can update your record."
                )
                subject_prefix = "Insurance expires soon"
            else:
                ask = (
                    f"Your insurance policy on file expires on "
                    f"{expiry.strftime('%d %b %Y')}. When the renewal lands, "
                    "please forward the certificate so we can update your record."
                )
                subject_prefix = "Upcoming insurance renewal"

            location_parts = [part for part in (property_name, unit_label) if part]
            location = " ".join(location_parts) if location_parts else "your tenancy"
            tenant_name = _tenant_display_name(tenant)
            greeting = (
                f"Hi {tenant.contact_name},"
                if tenant.contact_name
                else f"Hi {tenant_name},"
            )
            body = (
                f"{greeting}\n\n"
                f"{ask}\n\n"
                "If you have any questions or would like a recommendation for a "
                "broker, let us know.\n\n"
                "Thanks,\nThe property team"
            )

            subject = (
                f"{subject_prefix} for {location}"
                if location_parts
                else subject_prefix
            )
            detail_parts: list[str] = [f"Expires {expiry.strftime('%d %b %Y')}"]
            if days_until < 0:
                detail_parts.append(f"expired {abs(days_until)} days ago")
            else:
                detail_parts.append(f"{days_until} days remaining")
            detail = ", ".join(detail_parts)

        candidates.append(
            CommsCandidate(
                id=f"insurance_expiry:tenant:{tenant.id}",
                kind="insurance_expiry",
                target_kind="tenant",
                target_id=tenant.id,
                tenant_id=tenant.id,
                tenant_name=tenant_name,
                property_name=property_name,
                unit_label=unit_label,
                recipient_email=tenant.contact_email or tenant.billing_email,
                recipient_phone=tenant.contact_phone,
                subject=subject,
                body=body,
                severity=severity,  # type: ignore[arg-type]
                due_at=expiry,
                detail=detail,
                generated_at=now,
            )
        )
    return candidates


def _format_amount_int(cents: int, currency: str = "AUD") -> str:
    """Render a cents integer as ``$N,NNN AUD`` (no decimal noise for round
    annual rents). Falls back to ``$N,NNN.NN`` when there's a fractional
    part, since not every lease will be at clean dollar amounts.
    """

    if cents % 100 == 0:
        return f"${cents // 100:,} {currency}"
    whole = cents // 100
    frac = cents % 100
    return f"${whole:,}.{frac:02d} {currency}"


def _rent_review_calculation(
    current_cents: int | None, review_config: dict[str, object] | None
) -> tuple[int | None, str | None]:
    """Compute the new rent + a plain-English formula description.

    Returns (new_rent_cents, formula_label). When the config is missing or
    unsupported, returns (None, None) so the operator surface can show "set
    increase rule" without a calculated number.
    """

    if current_cents is None or not isinstance(review_config, dict):
        return None, None
    kind = review_config.get("kind")
    if kind == "fixed_pct":
        raw_pct = review_config.get("increase_pct")
        try:
            pct = float(raw_pct)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None, None
        if pct <= 0:
            return None, None
        # Apply optional cap.
        cap_raw = review_config.get("cap_pct")
        try:
            cap = float(cap_raw) if cap_raw is not None else None
        except (TypeError, ValueError):
            cap = None
        applied_pct = min(pct, cap) if cap is not None else pct
        new_cents = int(round(current_cents * (1 + applied_pct / 100)))
        # Round to nearest dollar to keep notices clean.
        new_cents = (new_cents // 100) * 100
        label = f"+{applied_pct:g}% fixed increase"
        if cap is not None and pct > cap:
            label += f" (capped from {pct:g}%)"
        return new_cents, label
    # Future: kind == "cpi" needs an external rate feed; kind == "market"
    # needs comps data. Both return None until the data source is wired.
    return None, None


def _rent_review_candidates(
    entity_id: UUID, session: Session, *, summary_only: bool = False
) -> list[CommsCandidate]:
    """Surface leases due for rent review within 60 days.

    The increase formula lives on ``lease.lease_metadata['rent_review']`` —
    audit done 2026-05-23, no schema change needed. v1 supports the
    ``fixed_pct`` kind only (with optional ``cap_pct``); CPI and market kinds
    return no calculated rent so the operator can see the lease in the queue
    and either set a formula or compute the new rent manually before
    dispatch.

    Severity:
      - danger:  next_review_date is overdue
      - warning: next_review_date within 30 days
      - info:    next_review_date within 60 days
    """

    today = date.today()
    cutoff = today + timedelta(days=60)
    candidates: list[CommsCandidate] = []
    now = utcnow()

    leases = list(
        session.scalars(
            select(Lease).where(
                Lease.deleted_at.is_(None),
                Lease.status == LeaseStatus.active,
                Lease.next_review_date.is_not(None),
                Lease.next_review_date <= cutoff,
            )
        ).all()
    )
    for lease in leases:
        if lease.next_review_date is None:
            continue
        if _comms_kind_deferred(lease.lease_metadata or {}, "rent_review", today):
            continue
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        if unit is None or unit.deleted_at is not None:
            continue
        prop = session.get(Property, unit.property_id)
        if prop is None or prop.deleted_at is not None or prop.entity_id != entity_id:
            continue
        tenant = session.get(Tenant, lease.tenant_id)
        if tenant is None or tenant.deleted_at is not None:
            continue

        days_until = (lease.next_review_date - today).days
        if days_until < 0:
            severity = "danger"
            subject_prefix = "Rent review overdue"
        elif days_until <= 30:
            severity = "warning"
            subject_prefix = "Rent review due soon"
        else:
            severity = "info"
            subject_prefix = "Upcoming rent review"

        tenant_name: str | None = None
        subject = ""
        body = ""
        detail: str | None = None
        if not summary_only:
            review_metadata = (lease.lease_metadata or {}).get("rent_review")
            if not isinstance(review_metadata, dict):
                review_metadata = None
            new_rent_cents, formula_label = _rent_review_calculation(
                lease.annual_rent_cents, review_metadata
            )

            tenant_name = _tenant_display_name(tenant)
            location_parts = [part for part in (prop.name, unit.unit_label) if part]
            location = " ".join(location_parts) if location_parts else "your tenancy"
            greeting = (
                f"Hi {tenant.contact_name},"
                if tenant.contact_name
                else f"Hi {tenant_name},"
            )

            review_date_text = lease.next_review_date.strftime("%d %b %Y")
            current_rent_text = (
                _format_amount_int(lease.annual_rent_cents, "AUD")
                if lease.annual_rent_cents is not None
                else "(current rent not on file)"
            )

            if new_rent_cents is not None:
                new_rent_text = _format_amount_int(new_rent_cents, "AUD")
                body = (
                    f"{greeting}\n\n"
                    f"Your lease at {location} is scheduled for a rent review on "
                    f"{review_date_text}.\n\n"
                    f"Current annual rent: {current_rent_text}\n"
                    f"Proposed new annual rent: {new_rent_text} ({formula_label})\n\n"
                    "Please reply to confirm the adjustment or get in touch if "
                    "you'd like to discuss before we issue the formal notice.\n\n"
                    "Thanks,\nThe property team"
                )
                detail_parts = [
                    f"current {current_rent_text}",
                    f"new {new_rent_text}",
                    formula_label or "no formula",
                    f"review {review_date_text}",
                ]
            else:
                body = (
                    f"{greeting}\n\n"
                    f"Your lease at {location} is scheduled for a rent review on "
                    f"{review_date_text}.\n\n"
                    f"Current annual rent: {current_rent_text}.\n\n"
                    "We'll be in touch shortly with the proposed adjustment. If "
                    "you'd like to discuss in advance, please reply to this email.\n\n"
                    "Thanks,\nThe property team"
                )
                detail_parts = [
                    f"current {current_rent_text}",
                    "needs increase rule",
                    f"review {review_date_text}",
                ]
            if days_until < 0:
                detail_parts.append(f"overdue {abs(days_until)} days")
            else:
                detail_parts.append(f"in {days_until} days")
            detail = ", ".join(detail_parts)

            subject = (
                f"{subject_prefix} ({prop.name})" if prop.name else subject_prefix
            )

        candidates.append(
            CommsCandidate(
                id=f"rent_review:lease:{lease.id}",
                kind="rent_review",
                target_kind="lease",
                target_id=lease.id,
                tenant_id=tenant.id,
                tenant_name=tenant_name,
                property_name=prop.name if not summary_only else None,
                unit_label=unit.unit_label if not summary_only else None,
                recipient_email=tenant.contact_email or tenant.billing_email,
                recipient_phone=tenant.contact_phone,
                subject=subject,
                body=body,
                severity=severity,  # type: ignore[arg-type]
                due_at=lease.next_review_date,
                detail=detail,
                generated_at=now,
            )
        )
    return candidates


ACTIVE_DOCUSIGN_SIGNING_STATUSES = {"queued", "sent", "delivered"}
RETRY_DOCUSIGN_SIGNING_STATUSES = {
    "declined",
    "failed",
    "skipped",
    "voided",
    "deleted",
}
DOCUSIGN_WAITING_DAYS = 7


def _tenant_lifecycle_stall_candidates(
    entity_id: UUID, session: Session, *, summary_only: bool = False
) -> list[CommsCandidate]:
    """Surface tenant lifecycle stalls that need operator review.

    Source of truth is the onboarding delivery_data lease agreement signing
    metadata. The queue remains review-first: this scanner only creates draft
    candidates, and provider sends still require an explicit /comms/dispatch.
    """

    today = date.today()
    now = utcnow()
    candidates: list[CommsCandidate] = []
    rows = list(
        session.scalars(
            select(TenantOnboarding)
            .where(
                TenantOnboarding.entity_id == entity_id,
                TenantOnboarding.deleted_at.is_(None),
            )
            .order_by(TenantOnboarding.updated_at.desc())
        ).all()
    )
    for onboarding in rows:
        delivery_data = onboarding.delivery_data or {}
        if _comms_kind_deferred(delivery_data, "tenant_lifecycle_stall", today):
            continue
        lease_agreement = delivery_data.get("lease_agreement")
        if not isinstance(lease_agreement, dict):
            continue
        signing = lease_agreement.get("signing")
        if not isinstance(signing, dict):
            continue
        signing_provider = signing.get("provider")
        if signing_provider not in {"docusign", "tenant_upload"}:
            continue

        tenant = session.get(Tenant, onboarding.tenant_id)
        if tenant is None or tenant.deleted_at is not None:
            continue
        recipient_email = tenant.contact_email or tenant.billing_email
        if not recipient_email:
            continue

        lease = session.get(Lease, onboarding.lease_id)
        if lease is None or lease.deleted_at is not None:
            continue
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        if unit is None or unit.deleted_at is not None:
            continue
        prop = session.get(Property, unit.property_id)
        if prop is None or prop.deleted_at is not None or prop.entity_id != entity_id:
            continue

        raw_status = signing.get("status")
        signing_status = raw_status if isinstance(raw_status, str) else ""
        provider_label = (
            "DocuSign" if signing_provider == "docusign" else "tenant upload"
        )
        envelope_id = signing.get("envelope_id")
        envelope_label = envelope_id if isinstance(envelope_id, str) else "unknown"
        tenant_name = _tenant_display_name(tenant) if not summary_only else None
        greeting = (
            f"Hi {tenant.contact_name},"
            if tenant.contact_name
            else f"Hi {tenant_name},"
        )
        location_parts = [part for part in (prop.name, unit.unit_label) if part]
        location = " ".join(location_parts) if location_parts else "your tenancy"

        # In summary mode we still run the qualification branches below (they
        # set severity and apply the waiting-window / status filters), but the
        # human-readable subject/body are presentation-only. Setting both to ""
        # keeps the trailing "if subject is None or body is None" gate honest:
        # a qualifying row still produces non-None strings, a non-qualifying
        # row leaves both None and is skipped — identical inclusion either way.
        subject: str | None = None
        body: str | None = None
        detail_parts: list[str] = [
            f"{provider_label} {signing_status or 'unknown'}",
        ]
        if signing_provider == "docusign":
            detail_parts.append(f"envelope {envelope_label}")
        else:
            signed_document_id = signing.get("signed_document_id")
            if isinstance(signed_document_id, str):
                detail_parts.append(f"document {signed_document_id}")
        severity = "warning"
        due_at: date | None = None

        if (
            signing_provider == "docusign"
            and signing_status in ACTIVE_DOCUSIGN_SIGNING_STATUSES
            and not signing.get("signed_at")
        ):
            sent_at = _parse_iso_datetime(
                signing.get("sent_at") or signing.get("last_event_at")
            )
            if sent_at is None:
                continue
            days_waiting = (today - sent_at.date()).days
            if days_waiting < DOCUSIGN_WAITING_DAYS:
                continue
            due_at = sent_at.date()
            detail_parts.append(f"waiting {days_waiting} days")
            if summary_only:
                subject = ""
                body = ""
            else:
                subject = f"DocuSign envelope waiting ({prop.name})"
                body = (
                    f"{greeting}\n\n"
                    f"The DocuSign envelope for your lease at {location} is still "
                    "waiting for completion.\n\n"
                    "Please review the DocuSign email and complete signing, or reply "
                    "if you need the request resent or have questions about the lease "
                    "pack.\n\n"
                    "Thanks,\nThe property team"
                )
        elif (
            signing_provider == "docusign"
            and signing_status in RETRY_DOCUSIGN_SIGNING_STATUSES
        ):
            event_at = _parse_iso_datetime(
                signing.get("last_event_at") or signing.get("sent_at")
            )
            due_at = event_at.date() if event_at is not None else today
            severity = "danger"
            last_event = signing.get("last_event")
            if isinstance(last_event, str):
                detail_parts.append(last_event)
            provider_error = signing.get("error")
            if isinstance(provider_error, str):
                detail_parts.append(provider_error)
            if summary_only:
                subject = ""
                body = ""
            elif signing_status == "skipped":
                subject = f"DocuSign setup needed ({prop.name})"
                body = (
                    f"{greeting}\n\n"
                    f"The DocuSign signing request for your lease at {location} "
                    "could not be sent because provider setup needs attention."
                    "\n\n"
                    "We are fixing the signing setup before sending a fresh "
                    "lease pack. Please reply if there is anything we should "
                    "correct before we resend it.\n\n"
                    "Thanks,\nThe property team"
                )
            else:
                subject = f"DocuSign retry needed ({prop.name})"
                body = (
                    f"{greeting}\n\n"
                    f"The DocuSign signing request for your lease at {location} "
                    f"was marked {signing_status}.\n\n"
                    "We are reviewing the lease pack before sending a fresh signing "
                    "request. Please reply if there is anything we should correct "
                    "before we resend it.\n\n"
                    "Thanks,\nThe property team"
                )
        elif signing_status == "completed" and signing.get("signed_at"):
            activation_review = signing.get("lease_activation_review")
            if not isinstance(activation_review, dict):
                continue
            review_status = activation_review.get("status")
            if review_status != "ready_for_review":
                continue
            current_status = activation_review.get("current_lease_status")
            recommended_status = activation_review.get("recommended_status")
            if current_status == recommended_status:
                continue
            signed_at = _parse_iso_datetime(signing.get("signed_at"))
            due_at = signed_at.date() if signed_at is not None else today
            severity = "danger"
            detail_parts.extend(
                [
                    f"activation {review_status}",
                    f"lease {current_status or 'unknown'} -> {recommended_status or 'active'}",
                ]
            )
            if summary_only:
                subject = ""
                body = ""
            else:
                subject = f"Lease activation review ({prop.name})"
                body = (
                    f"{greeting}\n\n"
                    f"Thank you for completing the lease signing for {location}. "
                    "The property team is completing the final activation review "
                    "before the lease is marked active in our system.\n\n"
                    "We will confirm once that review is complete.\n\n"
                    "Thanks,\nThe property team"
                )

        if subject is None or body is None:
            continue

        candidates.append(
            CommsCandidate(
                id=f"tenant_lifecycle_stall:tenant_onboarding:{onboarding.id}",
                kind="tenant_lifecycle_stall",
                target_kind="tenant_onboarding",
                target_id=onboarding.id,
                tenant_id=tenant.id,
                tenant_name=tenant_name,
                property_name=prop.name,
                unit_label=unit.unit_label,
                recipient_email=recipient_email,
                recipient_phone=tenant.contact_phone,
                subject=subject,
                body=body,
                severity=severity,  # type: ignore[arg-type]
                due_at=due_at,
                detail=", ".join(detail_parts),
                generated_at=now,
            )
        )
    return candidates


def _lease_renewal_candidates(
    entity_id: UUID, session: Session, *, summary_only: bool = False
) -> list[CommsCandidate]:
    """Build lease-renewal-discussion candidates.

    Scans active leases with an `expiry_date` within 120 days. Drafts a
    renewal-discussion email referencing the property/unit and the expiry
    date. Severity tier mirrors the urgency window: ≤30 days = danger,
    ≤60 days = warning, otherwise info.
    """

    today = date.today()
    cutoff = today + timedelta(days=120)
    candidates: list[CommsCandidate] = []
    now = utcnow()
    leases = list(
        session.scalars(
            select(Lease).where(
                Lease.deleted_at.is_(None),
                Lease.status == LeaseStatus.active,
                Lease.expiry_date.is_not(None),
            )
        ).all()
    )
    for lease in leases:
        if lease.expiry_date is None:
            continue
        # Filter by entity through the property hop — leases don't carry
        # entity_id directly. Skip if the property is missing or out-of-scope.
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        if unit is None or unit.deleted_at is not None:
            continue
        prop = session.get(Property, unit.property_id)
        if prop is None or prop.deleted_at is not None or prop.entity_id != entity_id:
            continue
        if lease.expiry_date > cutoff:
            continue
        tenant = session.get(Tenant, lease.tenant_id)
        if tenant is None or tenant.deleted_at is not None:
            continue

        days_until = (lease.expiry_date - today).days
        if days_until <= 30:
            severity = "danger"
        elif days_until <= 60:
            severity = "warning"
        else:
            severity = "info"

        tenant_name: str | None = None
        subject = ""
        body = ""
        detail: str | None = None
        if not summary_only:
            if days_until <= 30:
                tone = (
                    "Your lease term is winding down. Could we set up a quick "
                    "call this week to lock in the renewal terms or plan a "
                    "smooth handover."
                )
                subject_prefix = "Lease ending soon — let's talk"
            elif days_until <= 60:
                tone = (
                    "Your current term is closing in. We would like to start "
                    "the renewal discussion — could you let us know whether "
                    "you intend to renew, and any changes you would like us "
                    "to consider."
                )
                subject_prefix = "Lease renewal — your intentions"
            else:
                tone = (
                    "We are opening the renewal window for your tenancy. "
                    "Could you share whether you intend to renew, and we can "
                    "schedule a discussion before the formal notice period."
                )
                subject_prefix = "Lease renewal — opening the conversation"

            tenant_name = _tenant_display_name(tenant)
            greeting = (
                f"Hi {tenant.contact_name},"
                if tenant.contact_name
                else f"Hi {tenant_name},"
            )
            location_parts = [part for part in (prop.name, unit.unit_label) if part]
            location = " ".join(location_parts) if location_parts else "your tenancy"
            body = (
                f"{greeting}\n\n"
                f"Your lease at {location} is scheduled to expire on "
                f"{lease.expiry_date.strftime('%d %b %Y')} "
                f"({days_until} days from today).\n\n"
                f"{tone}\n\n"
                "Thanks,\nThe property team"
            )
            subject = (
                f"{subject_prefix} ({prop.name})" if prop.name else subject_prefix
            )
            detail = (
                f"Expires {lease.expiry_date.strftime('%d %b %Y')}, "
                f"{days_until} days remaining"
            )

        candidates.append(
            CommsCandidate(
                id=f"lease_renewal:lease:{lease.id}",
                kind="lease_renewal",
                target_kind="lease",
                target_id=lease.id,
                tenant_id=tenant.id,
                tenant_name=tenant_name,
                property_name=prop.name if not summary_only else None,
                unit_label=unit.unit_label if not summary_only else None,
                recipient_email=tenant.contact_email or tenant.billing_email,
                recipient_phone=tenant.contact_phone,
                subject=subject,
                body=body,
                severity=severity,  # type: ignore[arg-type]
                due_at=lease.expiry_date,
                detail=detail,
                generated_at=now,
            )
        )
    return candidates


COMPLIANCE_CATEGORIES = (
    ObligationCategory.insurance,
    ObligationCategory.bank_guarantee,
    ObligationCategory.compliance,
    ObligationCategory.make_good,
)

# Statuses that mean the obligation still needs operator attention.
COMPLIANCE_OPEN_STATUSES = (
    ObligationStatus.upcoming,
    ObligationStatus.due_soon,
    ObligationStatus.overdue,
)


def _compliance_candidates(
    entity_id: UUID, session: Session, *, summary_only: bool = False
) -> list[CommsCandidate]:
    """Surface compliance Obligation rows due in the next 45 days (or overdue).

    The Obligation table already covers compliance (insurance, bank guarantee,
    make-good, generic compliance) with a due_date + status lifecycle, so the
    comms queue piggybacks on that rather than introducing a new table. Each
    candidate drafts a tenant-facing reminder when the obligation is tied to a
    lease/tenant; obligations attached to a property without a lease (e.g. a
    fire-safety certificate on a vacant unit) still appear with no recipient
    so the operator can route them manually.
    """

    today = date.today()
    cutoff = today + timedelta(days=45)
    candidates: list[CommsCandidate] = []
    now = utcnow()
    rows = list(
        session.scalars(
            select(Obligation)
            .where(
                Obligation.entity_id == entity_id,
                Obligation.deleted_at.is_(None),
                Obligation.category.in_(COMPLIANCE_CATEGORIES),
                Obligation.status.in_(COMPLIANCE_OPEN_STATUSES),
                Obligation.due_date <= cutoff,
            )
            .order_by(Obligation.due_date.asc())
        ).all()
    )
    for obligation in rows:
        if _comms_kind_deferred(
            obligation.obligation_metadata or {},
            "compliance_obligation",
            today,
        ):
            continue
        days_until = (obligation.due_date - today).days
        if obligation.status == ObligationStatus.overdue or days_until < 0:
            severity: str = "danger"
            subject_prefix = "Overdue compliance item"
        elif obligation.status == ObligationStatus.due_soon or days_until <= 14:
            severity = "warning"
            subject_prefix = "Compliance item due soon"
        else:
            severity = "info"
            subject_prefix = "Upcoming compliance reminder"

        tenant: Tenant | None = None
        property_name: str | None = None
        unit_label: str | None = None
        tenant_name: str | None = None
        subject = ""
        body = ""
        detail: str | None = None
        if not summary_only:
            if obligation.lease_id is not None:
                lease = session.get(Lease, obligation.lease_id)
                if lease is not None and lease.deleted_at is None:
                    t = session.get(Tenant, lease.tenant_id)
                    if t is not None and t.deleted_at is None:
                        tenant = t
            if obligation.property_id is not None:
                prop = session.get(Property, obligation.property_id)
                if prop is not None and prop.deleted_at is None:
                    property_name = prop.name
            if obligation.tenancy_unit_id is not None:
                unit = session.get(TenancyUnit, obligation.tenancy_unit_id)
                if unit is not None and unit.deleted_at is None:
                    unit_label = unit.unit_label

            location_parts = [part for part in (property_name, unit_label) if part]
            location = " ".join(location_parts) if location_parts else "your tenancy"
            tenant_name = _tenant_display_name(tenant) if tenant is not None else None
            greeting = (
                f"Hi {tenant.contact_name},"
                if tenant is not None and tenant.contact_name
                else (f"Hi {tenant_name}," if tenant_name else "Hello,")
            )
            body = (
                f"{greeting}\n\n"
                f"We have an upcoming compliance item for {location}: "
                f"\"{obligation.title}\" is due on "
                f"{obligation.due_date.strftime('%d %b %Y')}.\n\n"
                "Please send through any documentation that demonstrates this is "
                "in place. If something has already been completed, reply with the "
                "evidence and we will close it out.\n\n"
                "Thanks,\nThe property team"
            )
            subject = (
                f"{subject_prefix}: {obligation.title}"
                if obligation.title
                else subject_prefix
            )
            detail_parts: list[str] = [
                obligation.category.value.replace("_", " "),
                f"due {obligation.due_date.strftime('%d %b %Y')}",
            ]
            if days_until < 0:
                detail_parts.append(f"overdue {abs(days_until)} days")
            else:
                detail_parts.append(f"in {days_until} days")
            detail = ", ".join(detail_parts)

        candidates.append(
            CommsCandidate(
                id=f"compliance_obligation:obligation:{obligation.id}",
                kind="compliance_obligation",
                target_kind="obligation",
                target_id=obligation.id,
                tenant_id=tenant.id if tenant is not None else None,
                tenant_name=tenant_name,
                property_name=property_name,
                unit_label=unit_label,
                recipient_email=(
                    tenant.contact_email or tenant.billing_email
                    if tenant is not None
                    else None
                ),
                recipient_phone=tenant.contact_phone if tenant is not None else None,
                subject=subject,
                body=body,
                severity=severity,  # type: ignore[arg-type]
                due_at=obligation.due_date,
                detail=detail,
                generated_at=now,
            )
        )
    return candidates


def _inbound_email_candidates(
    entity_id: UUID, session: Session, *, summary_only: bool = False
) -> list[CommsCandidate]:
    """Surface unprocessed inbound emails + SMS as queue candidates.

    Each pending `inbound_message` row becomes a queue candidate. The kind
    is `inbound_email` or `inbound_sms` based on the row's channel. Email
    drafts use "Re: <original>" subjects + a multi-paragraph body; SMS
    drafts use a concise plain-text body since SMS lacks subjects and is
    length-constrained. Attribution is best-effort.
    """

    candidates: list[CommsCandidate] = []
    now = utcnow()
    rows = list(
        session.scalars(
            select(InboundMessage)
            .where(
                InboundMessage.entity_id == entity_id,
                InboundMessage.deleted_at.is_(None),
                InboundMessage.processed_at.is_(None),
                InboundMessage.archived_at.is_(None),
            )
            .order_by(InboundMessage.created_at.desc())
        ).all()
    )
    for message in rows:
        is_sms = message.channel == "sms"
        kind: str = "inbound_sms" if is_sms else "inbound_email"
        target_kind = "inbound_message"
        # Severity reflects classification urgency when present, otherwise info.
        severity: str = "info"
        if message.classification_kind == "payment_or_arrears":
            severity = "danger"
        elif message.classification_kind == "maintenance_request":
            severity = "warning"
        elif message.classification_kind == "spam_or_noise":
            severity = "info"

        tenant: Tenant | None = None
        tenant_name: str | None = None
        recipient_email: str | None = None
        recipient_phone: str | None = None
        subject = ""
        body = ""
        detail: str | None = None
        if not summary_only:
            if message.attributed_tenant_id is not None:
                tenant = session.get(Tenant, message.attributed_tenant_id)
                if tenant is not None and tenant.deleted_at is not None:
                    tenant = None
            tenant_name = _tenant_display_name(tenant) if tenant is not None else None
            contact_name = (
                tenant.contact_name if tenant and tenant.contact_name else "there"
            )
            snippet = (message.body_text or "")[:240]
            if snippet and len(message.body_text or "") > 240:
                snippet += "…"

            if is_sms:
                # SMS reply: short, no subject, no quoted original.
                subject = "SMS reply"
                body = (
                    f"Hi {contact_name}, thanks for your message — we've got it "
                    "and will follow up shortly. Reply with any updates."
                )
                recipient_phone = message.from_address
                detail_parts: list[str] = [
                    f"SMS from {message.from_address or 'unknown'}"
                ]
            else:
                subject = (
                    f"Re: {message.subject}"
                    if message.subject
                    else "Re: your message"
                )
                body = (
                    f"Hi {contact_name},\n\n"
                    "Thanks for your message — we've received it and will follow "
                    "up shortly. Please let us know if anything in this thread "
                    "has changed in the meantime.\n\n"
                    f"Original message:\n{snippet or '(no body)'}\n\n"
                    "Thanks,\nThe property team"
                )
                recipient_email = message.from_address
                detail_parts = [f"from {message.from_address or 'unknown'}"]

            if tenant is None:
                detail_parts.append("tenant not attributed")
            metadata = (
                message.inbound_metadata
                if isinstance(message.inbound_metadata, dict)
                else {}
            )
            attachment_count = metadata.get("attachment_intake_count")
            if isinstance(attachment_count, int) and attachment_count > 0:
                noun = "attachment" if attachment_count == 1 else "attachments"
                detail_parts.append(
                    f"{attachment_count} {noun} routed to Smart Intake"
                )
            if message.classification_kind:
                label = message.classification_kind.replace("_", " ")
                confidence = message.classification_confidence
                if confidence is not None:
                    detail_parts.append(
                        f"AI: {label} ({int(round(float(confidence) * 100))}%)"
                    )
                else:
                    detail_parts.append(f"AI: {label}")
            detail = ", ".join(detail_parts)

        candidates.append(
            CommsCandidate(
                id=f"{kind}:{target_kind}:{message.id}",
                kind=kind,  # type: ignore[arg-type]
                target_kind=target_kind,
                target_id=message.id,
                tenant_id=tenant.id if tenant is not None else None,
                tenant_name=tenant_name,
                property_name=None,
                unit_label=None,
                recipient_email=recipient_email,
                recipient_phone=recipient_phone,
                subject=subject,
                body=body,
                severity=severity,  # type: ignore[arg-type]
                due_at=None,
                detail=detail,
                generated_at=now,
            )
        )
    return candidates


@router.get("/queue", response_model=CommsQueueRead)
def get_comms_queue(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CommsQueueRead:
    """Return draft communications the operator should review.

    Read-only — never mutates, never sends. v2 returns three kinds:
    arrears reminders, insurance expiry reminders, and lease renewal
    discussions. Future kinds (compliance certificate expiry, bond
    renewal, etc.) follow the same shape.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    candidates = (
        _inbound_email_candidates(entity_id, session)
        + _arrears_candidates(entity_id, session)
        + _compliance_candidates(entity_id, session)
        + _insurance_candidates(entity_id, session)
        + _lease_renewal_candidates(entity_id, session)
        + _rent_review_candidates(entity_id, session)
        + _tenant_lifecycle_stall_candidates(entity_id, session)
        + _maintenance_forwarding_candidates(entity_id, session)
    )
    return CommsQueueRead(
        entity_id=entity_id,
        candidates=candidates,
        generated_at=utcnow(),
    )


# Short-lived per-entity cache for the sidebar badge counts. The counts
# endpoint runs the full set of queue scanners (the same scan as ``/queue``),
# so calling it on every navigation across an operator team repeats expensive
# work for a number that barely changes minute to minute. Caching the computed
# counts per entity for a short window keeps the badge correct — it is the same
# value a fresh scan would produce — while removing the repeated full-scan cost.
# Local state only: no provider calls, no mutation, and the role check below
# still runs on every request before the cache is consulted.
_QUEUE_COUNTS_TTL_SECONDS = 45.0
_queue_counts_cache: dict[UUID, tuple[float, CommsQueueCountsRead]] = {}


@router.get("/queue/counts", response_model=CommsQueueCountsRead)
def get_comms_queue_counts(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CommsQueueCountsRead:
    """Queue counts for the sidebar nav badge.

    Reuses the same scanners as ``/queue`` so a candidate that surfaces in
    the queue is reflected in the counts. Results are cached per entity for
    ``_QUEUE_COUNTS_TTL_SECONDS`` so the badge can be requested on every page
    load without re-running the full queue scan each time.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    cached = _queue_counts_cache.get(entity_id)
    if cached is not None and time.monotonic() - cached[0] < _QUEUE_COUNTS_TTL_SECONDS:
        return cached[1]
    # Counts only reads each candidate's ``kind`` and ``severity``, so the
    # scanners run in summary mode: same query + inclusion logic as ``/queue``,
    # but skipping the per-row property/unit/lease ``session.get`` lookups and
    # subject/body string building that only the full queue surface needs.
    candidates = (
        _inbound_email_candidates(entity_id, session, summary_only=True)
        + _arrears_candidates(entity_id, session, summary_only=True)
        + _compliance_candidates(entity_id, session, summary_only=True)
        + _insurance_candidates(entity_id, session, summary_only=True)
        + _lease_renewal_candidates(entity_id, session, summary_only=True)
        + _rent_review_candidates(entity_id, session, summary_only=True)
        + _tenant_lifecycle_stall_candidates(entity_id, session, summary_only=True)
        + _maintenance_forwarding_candidates(entity_id, session, summary_only=True)
    )
    by_kind: dict[str, int] = {
        "arrears_reminder": 0,
        "insurance_expiry": 0,
        "lease_renewal": 0,
        "inbound_email": 0,
        "inbound_sms": 0,
        "compliance_obligation": 0,
        "rent_review": 0,
        "tenant_lifecycle_stall": 0,
        "maintenance_contractor_forward": 0,
        "maintenance_tenant_forward": 0,
    }
    urgent = 0
    for candidate in candidates:
        by_kind[candidate.kind] = by_kind.get(candidate.kind, 0) + 1
        if candidate.severity == "danger":
            urgent += 1
    result = CommsQueueCountsRead(
        entity_id=entity_id,
        total=len(candidates),
        urgent=urgent,
        by_kind=by_kind,  # type: ignore[arg-type]
        generated_at=utcnow(),
    )
    _queue_counts_cache[entity_id] = (time.monotonic(), result)
    return result


def _body_preview(value: str | None, *, limit: int = 180) -> str | None:
    text = " ".join((value or "").split())
    if not text:
        return None
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def _primitive_metadata(
    value: dict[str, Any] | None,
) -> dict[str, str | int | float | bool | None]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, str | int | float | bool | None] = {}
    for key, item in value.items():
        if isinstance(item, str | int | float | bool) or item is None:
            result[str(key)] = item
    return result


def _is_comms_correspondence_audit(row: AuditAction) -> bool:
    if row.action == "dispatch":
        provider = row.tool_name.split(".", 1)[0] if row.tool_name else None
        if provider not in {"sendgrid", "twilio"}:
            return False
    elif row.action == "dismiss":
        if row.tool_name not in {"comms.dismiss", "comms.queue"}:
            return False
    else:
        return False
    tool_input = _primitive_metadata(row.tool_input)
    candidate_id = tool_input.get("candidate_id")
    kind = tool_input.get("kind")
    if not isinstance(candidate_id, str) or not isinstance(kind, str):
        return False
    if not row.target_table or row.target_id is None:
        return False
    return candidate_id == f"{kind}:{row.target_table}:{row.target_id}"


def _tenant_correspondence_target_ids(
    tenant: Tenant,
    session: Session,
) -> dict[str, set[UUID]]:
    lease_ids = set(
        session.scalars(
            select(Lease.id).where(
                Lease.tenant_id == tenant.id,
                Lease.deleted_at.is_(None),
            )
        )
    )
    inbound_ids = set(
        session.scalars(
            select(InboundMessage.id).where(
                InboundMessage.entity_id == tenant.entity_id,
                InboundMessage.attributed_tenant_id == tenant.id,
                InboundMessage.deleted_at.is_(None),
            )
        )
    )
    arrears_ids = set(
        session.scalars(
            select(ArrearsCase.id).where(
                ArrearsCase.entity_id == tenant.entity_id,
                ArrearsCase.tenant_id == tenant.id,
                ArrearsCase.deleted_at.is_(None),
            )
        )
    )
    onboarding_ids = set(
        session.scalars(
            select(TenantOnboarding.id).where(
                TenantOnboarding.entity_id == tenant.entity_id,
                TenantOnboarding.tenant_id == tenant.id,
                TenantOnboarding.deleted_at.is_(None),
            )
        )
    )
    work_order_criteria = [MaintenanceWorkOrder.tenant_id == tenant.id]
    if lease_ids:
        work_order_criteria.append(MaintenanceWorkOrder.lease_id.in_(lease_ids))
    work_order_ids = set(
        session.scalars(
            select(MaintenanceWorkOrder.id).where(
                MaintenanceWorkOrder.entity_id == tenant.entity_id,
                or_(*work_order_criteria),
                MaintenanceWorkOrder.deleted_at.is_(None),
            )
        )
    )
    obligation_ids: set[UUID] = set()
    if lease_ids:
        obligation_ids = set(
            session.scalars(
                select(Obligation.id).where(
                    Obligation.entity_id == tenant.entity_id,
                    Obligation.lease_id.in_(lease_ids),
                    Obligation.deleted_at.is_(None),
                )
            )
        )
    return {
        "tenant": {tenant.id},
        "lease": lease_ids,
        "inbound_message": inbound_ids,
        "arrears_case": arrears_ids,
        "tenant_onboarding": onboarding_ids,
        "maintenance_work_order": work_order_ids,
        "obligation": obligation_ids,
    }


def _audit_target_metadata(
    row: AuditAction,
    session: Session | None,
) -> dict[str, str]:
    if session is None or row.target_id is None:
        return {}
    tenant_id: UUID | None = None
    if row.target_table == "tenant":
        tenant_id = row.target_id
    elif row.target_table == "lease":
        lease = session.get(Lease, row.target_id)
        if lease is not None:
            tenant_id = lease.tenant_id
    elif row.target_table == "tenant_onboarding":
        onboarding = session.get(TenantOnboarding, row.target_id)
        if onboarding is not None:
            tenant_id = onboarding.tenant_id
    elif row.target_table == "obligation":
        obligation = session.get(Obligation, row.target_id)
        if obligation is not None and obligation.lease_id is not None:
            lease = session.get(Lease, obligation.lease_id)
            if lease is not None:
                tenant_id = lease.tenant_id
    elif row.target_table == "arrears_case":
        case = session.get(ArrearsCase, row.target_id)
        if case is not None:
            tenant_id = case.tenant_id
    elif row.target_table == "maintenance_work_order":
        work_order = session.get(MaintenanceWorkOrder, row.target_id)
        if work_order is not None:
            tenant_id = work_order.tenant_id
    return {"tenant_id": str(tenant_id)} if tenant_id is not None else {}


def _audit_correspondence_event(
    row: AuditAction,
    session: Session | None = None,
) -> CommsCorrespondenceEvent:
    tool_input = _primitive_metadata(row.tool_input)
    channel = tool_input.get("channel")
    kind = tool_input.get("kind")
    recipient = tool_input.get("recipient")
    provider = None
    if row.tool_name:
        provider = row.tool_name.split(".", 1)[0]
    direction = "outbound" if row.action == "dispatch" else "internal"
    metadata = {
        **tool_input,
        "kind": str(kind) if kind else None,
    }
    if row.error_message:
        metadata["error"] = row.error_message
    metadata.update(_audit_target_metadata(row, session))
    return CommsCorrespondenceEvent(
        id=str(row.id),
        source="comms_audit",
        direction=direction,
        event_type=row.action,
        channel=str(channel) if channel else None,
        provider=provider,
        recipient=str(recipient) if recipient else None,
        summary=row.tool_output_summary or row.action,
        target_kind=row.target_table,
        target_id=row.target_id,
        status=row.outcome.value,
        occurred_at=row.occurred_at,
        metadata=metadata,
    )


def _inbound_correspondence_event(
    message: InboundMessage,
) -> CommsCorrespondenceEvent:
    metadata = _primitive_metadata(message.inbound_metadata)
    if message.classification_kind:
        metadata["classification_kind"] = message.classification_kind
    if message.classification_confidence is not None:
        metadata["classification_confidence"] = float(message.classification_confidence)
    return CommsCorrespondenceEvent(
        id=str(message.id),
        source="inbound_message",
        direction="inbound",
        event_type=f"inbound_{message.channel}",
        channel=message.channel,
        provider=message.provider,
        from_address=message.from_address,
        to_address=message.to_address,
        subject=message.subject,
        summary=message.classification_summary
        or message.subject
        or f"Inbound {message.channel} received",
        body_preview=_body_preview(message.body_text),
        target_kind="inbound_message",
        target_id=message.id,
        status="processed" if message.processed_at else "pending",
        occurred_at=message.created_at,
        metadata=metadata,
    )


@router.get(
    "/correspondence/tenants/{tenant_id}",
    response_model=CommsTenantCorrespondenceRead,
)
def get_tenant_correspondence(
    tenant_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CommsTenantCorrespondenceRead:
    """Return a read-only tenant-linked communications timeline.

    This does not send providers, regenerate drafts, mutate queue state, or
    expose unmatched tenant correspondence. It only projects already stored
    inbound message rows and comms dispatch/dismiss audit receipts.
    """

    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found.",
        )
    assert_entity_role(session, user, tenant.entity_id, READ_ROLES)

    inbound_messages = session.scalars(
        select(InboundMessage)
        .where(
            InboundMessage.entity_id == tenant.entity_id,
            InboundMessage.attributed_tenant_id == tenant.id,
            InboundMessage.deleted_at.is_(None),
        )
        .order_by(InboundMessage.created_at.desc())
    ).all()
    target_ids = _tenant_correspondence_target_ids(tenant, session)
    audit_rows = session.scalars(
        select(AuditAction)
        .where(
            AuditAction.entity_id == tenant.entity_id,
            AuditAction.action.in_(("dispatch", "dismiss")),
            AuditAction.target_id.is_not(None),
        )
        .order_by(AuditAction.occurred_at.desc())
    ).all()
    audit_events = [
        _audit_correspondence_event(row, session)
        for row in audit_rows
        if _is_comms_correspondence_audit(row)
        and row.target_table in target_ids
        and row.target_id in target_ids.get(row.target_table or "", set())
    ]
    events = [
        *(_inbound_correspondence_event(message) for message in inbound_messages),
        *audit_events,
    ]
    events.sort(
        key=lambda event: (
            event.occurred_at
            if event.occurred_at.tzinfo is not None
            else event.occurred_at.replace(tzinfo=UTC)
        ).timestamp(),
        reverse=True,
    )
    return CommsTenantCorrespondenceRead(
        entity_id=tenant.entity_id,
        tenant_id=tenant.id,
        tenant_name=_tenant_display_name(tenant),
        events=events,
        guardrails=[
            (
                "This timeline is read-only and uses already stored inbound "
                "messages and comms audit receipts."
            ),
            (
                "Opening it does not send email, send SMS, change queue state, "
                "refresh providers, or mutate tenant data."
            ),
        ],
        generated_at=utcnow(),
    )


MAINTENANCE_CORRESPONDENCE_KINDS = {
    "maintenance_contractor_forward",
    "maintenance_tenant_forward",
}
CONTRACTOR_CORRESPONDENCE_KINDS = {"maintenance_contractor_forward"}


def _is_maintenance_correspondence_audit(row: AuditAction) -> bool:
    if not _is_comms_correspondence_audit(row):
        return False
    tool_input = _primitive_metadata(row.tool_input)
    return tool_input.get("kind") in MAINTENANCE_CORRESPONDENCE_KINDS


def _normalised_text(value: str | None) -> str | None:
    cleaned = (value or "").strip().casefold()
    return cleaned or None


def _normalised_phone(value: str | None) -> str | None:
    cleaned = "".join(
        char for char in (value or "").strip() if char.isdigit() or char == "+"
    )
    return cleaned or None


def _contractor_correspondence_work_order_ids(
    contractor: Contractor,
    session: Session,
) -> set[UUID]:
    contractor_email = _normalised_text(contractor.email)
    contractor_phone = _normalised_phone(contractor.phone)
    work_orders = session.scalars(
        select(MaintenanceWorkOrder).where(
            MaintenanceWorkOrder.entity_id == contractor.entity_id,
            MaintenanceWorkOrder.deleted_at.is_(None),
        )
    ).all()
    matched_ids: set[UUID] = set()
    for work_order in work_orders:
        metadata = _primitive_metadata(work_order.work_order_metadata)
        if metadata.get("vendor_portal_contractor_id") == str(contractor.id):
            matched_ids.add(work_order.id)
            continue
        if (
            contractor_email is not None
            and _normalised_text(work_order.contractor_email) == contractor_email
        ):
            matched_ids.add(work_order.id)
            continue
        if (
            contractor_phone is not None
            and _normalised_phone(work_order.contractor_phone) == contractor_phone
        ):
            matched_ids.add(work_order.id)
            continue
    return matched_ids


def _contractor_correspondence_recipient_matches(
    row: AuditAction,
    contractor: Contractor,
) -> bool:
    tool_input = _primitive_metadata(row.tool_input)
    recipient = tool_input.get("recipient")
    if not isinstance(recipient, str) or not recipient.strip():
        return False
    contractor_email = _normalised_text(contractor.email)
    if (
        contractor_email is not None
        and _normalised_text(recipient) == contractor_email
    ):
        return True
    contractor_phone = _normalised_phone(contractor.phone)
    return (
        contractor_phone is not None
        and _normalised_phone(recipient) == contractor_phone
    )


def _is_contractor_correspondence_audit(
    row: AuditAction,
    contractor: Contractor,
    work_order_ids: set[UUID],
) -> bool:
    if not _is_comms_correspondence_audit(row):
        return False
    tool_input = _primitive_metadata(row.tool_input)
    if tool_input.get("kind") not in CONTRACTOR_CORRESPONDENCE_KINDS:
        return False
    if row.target_table == "contractor":
        return row.target_id == contractor.id
    if row.target_table == "maintenance_work_order":
        return row.target_id in work_order_ids and (
            _contractor_correspondence_recipient_matches(row, contractor)
        )
    return False


@router.get(
    "/correspondence/maintenance-work-orders/{work_order_id}",
    response_model=CommsMaintenanceWorkOrderCorrespondenceRead,
)
def get_maintenance_work_order_correspondence(
    work_order_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CommsMaintenanceWorkOrderCorrespondenceRead:
    """Return stored comms receipts linked to one maintenance work order.

    This is read-only. It only projects already stored comms dispatch/dismiss
    audit receipts and never sends providers, regenerates drafts, changes queue
    state, or mutates the maintenance record.
    """

    work_order = session.get(MaintenanceWorkOrder, work_order_id)
    if work_order is None or work_order.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance work order not found.",
        )
    assert_entity_role(session, user, work_order.entity_id, READ_ROLES)
    audit_rows = session.scalars(
        select(AuditAction)
        .where(
            AuditAction.entity_id == work_order.entity_id,
            AuditAction.action.in_(("dispatch", "dismiss")),
            AuditAction.target_table == "maintenance_work_order",
            AuditAction.target_id == work_order.id,
        )
        .order_by(AuditAction.occurred_at.desc())
    ).all()
    events = [
        _audit_correspondence_event(row, session)
        for row in audit_rows
        if _is_maintenance_correspondence_audit(row)
    ]
    return CommsMaintenanceWorkOrderCorrespondenceRead(
        entity_id=work_order.entity_id,
        work_order_id=work_order.id,
        work_order_title=work_order.title,
        events=events,
        guardrails=[
            (
                "This work-order correspondence is read-only and uses already "
                "stored comms audit receipts."
            ),
            (
                "Opening this panel does not send email, send SMS, change "
                "queue state, refresh providers, or mutate maintenance records."
            ),
        ],
        generated_at=utcnow(),
    )


@router.get(
    "/correspondence/contractors/{contractor_id}",
    response_model=CommsContractorCorrespondenceRead,
)
def get_contractor_correspondence(
    contractor_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CommsContractorCorrespondenceRead:
    """Return stored contractor-facing comms receipts for one vendor.

    This is read-only. It projects already stored comms dispatch/dismiss audit
    receipts linked to work orders assigned or explicitly shared to the
    contractor, and never sends providers, regenerates drafts, changes queue
    state, or mutates vendor/maintenance records.
    """

    contractor = session.get(Contractor, contractor_id)
    if contractor is None or contractor.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contractor not found.",
        )
    assert_entity_role(session, user, contractor.entity_id, READ_ROLES)

    work_order_ids = _contractor_correspondence_work_order_ids(contractor, session)
    audit_rows = session.scalars(
        select(AuditAction)
        .where(
            AuditAction.entity_id == contractor.entity_id,
            AuditAction.action.in_(("dispatch", "dismiss")),
            AuditAction.target_id.is_not(None),
        )
        .order_by(AuditAction.occurred_at.desc())
    ).all()
    events = [
        _audit_correspondence_event(row, session)
        for row in audit_rows
        if _is_contractor_correspondence_audit(row, contractor, work_order_ids)
    ]
    return CommsContractorCorrespondenceRead(
        entity_id=contractor.entity_id,
        contractor_id=contractor.id,
        contractor_name=contractor.name,
        events=events,
        guardrails=[
            (
                "This vendor correspondence is read-only and uses already "
                "stored comms audit receipts."
            ),
            (
                "Opening this panel does not send email, send SMS, change "
                "queue state, refresh providers, mutate vendor records, or "
                "mutate maintenance records."
            ),
        ],
        generated_at=utcnow(),
    )


@router.get("/outbound-log", response_model=CommsOutboundLogRead)
def get_comms_outbound_log(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    limit: int = 20,
) -> CommsOutboundLogRead:
    """Return recent stored comms dispatch receipts for the Comms hub.

    This is read-only. It only projects existing audit rows and never sends
    providers, regenerates drafts, dismisses candidates, or mutates queue state.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    normalized_limit = max(0, min(limit, 50))
    audit_rows = session.scalars(
        select(AuditAction)
        .where(
            AuditAction.entity_id == entity_id,
            AuditAction.action == "dispatch",
            AuditAction.target_id.is_not(None),
        )
        .order_by(AuditAction.occurred_at.desc())
    ).all()
    events = [
        _audit_correspondence_event(row, session)
        for row in audit_rows
        if _is_comms_correspondence_audit(row)
    ][:normalized_limit]
    return CommsOutboundLogRead(
        entity_id=entity_id,
        events=events,
        guardrails=[
            (
                "This log is read-only and uses already stored comms "
                "dispatch audit receipts."
            ),
            (
                "Opening this log does not send email, send SMS, change queue "
                "state, refresh providers, or mutate tenant data."
            ),
        ],
        generated_at=utcnow(),
    )


def _resolve_dispatch_entity_id(
    payload: CommsDispatchCreate, session: Session
) -> tuple[
    UUID,
    ArrearsCase
    | Tenant
    | Lease
    | InboundMessage
    | Obligation
    | TenantOnboarding
    | MaintenanceWorkOrder,
]:
    """Look up the entity_id for a dispatch target and return the source row.

    Each kind is scoped to a different table — the target_kind tells us where
    to look. We reject dispatches whose payload references a target the user
    cannot resolve, before checking entity-level access.
    """

    if (
        payload.kind in ("inbound_email", "inbound_sms")
        and payload.target_kind == "inbound_message"
    ):
        message = session.get(InboundMessage, payload.target_id)
        if message is None or message.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Inbound message not found.",
            )
        return message.entity_id, message
    if (
        payload.kind == "compliance_obligation"
        and payload.target_kind == "obligation"
    ):
        obligation = session.get(Obligation, payload.target_id)
        if obligation is None or obligation.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Obligation not found.",
            )
        return obligation.entity_id, obligation
    if payload.kind == "arrears_reminder" and payload.target_kind == "arrears_case":
        case = session.get(ArrearsCase, payload.target_id)
        if case is None or case.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Arrears case not found.",
            )
        return case.entity_id, case
    if payload.kind == "insurance_expiry" and payload.target_kind == "tenant":
        tenant = session.get(Tenant, payload.target_id)
        if tenant is None or tenant.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found.",
            )
        return tenant.entity_id, tenant
    if (
        payload.kind in ("lease_renewal", "rent_review")
        and payload.target_kind == "lease"
    ):
        lease = session.get(Lease, payload.target_id)
        if lease is None or lease.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Lease not found.",
            )
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        if unit is None or unit.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Lease scope is inconsistent.",
            )
        prop = session.get(Property, unit.property_id)
        if prop is None or prop.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Lease scope is inconsistent.",
            )
        return prop.entity_id, lease
    if (
        payload.kind == "tenant_lifecycle_stall"
        and payload.target_kind == "tenant_onboarding"
    ):
        onboarding = session.get(TenantOnboarding, payload.target_id)
        if onboarding is None or onboarding.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant onboarding not found.",
            )
        return onboarding.entity_id, onboarding
    if (
        payload.kind
        in ("maintenance_contractor_forward", "maintenance_tenant_forward")
        and payload.target_kind == "maintenance_work_order"
    ):
        work_order = session.get(MaintenanceWorkOrder, payload.target_id)
        if work_order is None or work_order.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Maintenance work order not found.",
            )
        return work_order.entity_id, work_order
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="Unsupported comms target.",
    )


def _update_source_after_dispatch(
    source: ArrearsCase
    | Tenant
    | Lease
    | InboundMessage
    | Obligation
    | TenantOnboarding
    | MaintenanceWorkOrder,
    kind: str,
    *,
    channel: str | None = None,
    status: str | None = None,
    provider: str | None = None,
    recipient: str | None = None,
    provider_message_id: str | None = None,
    error: str | None = None,
) -> None:
    """Bookkeeping after a draft is dispatched so the candidate doesn't
    re-appear in the queue immediately.

    For arrears: bump reminder_stage and clock the next reminder a week out.
    For insurance / lease renewal: stamp a metadata snooze keyed by kind so
    the next queue scan can choose to filter on it (a future refinement —
    today the queue scan does not yet honour the metadata snooze, so the
    operator's dismiss is the primary deferral surface; this stamp keeps the
    audit trail consistent).
    """

    today = date.today()
    if isinstance(source, InboundMessage):
        source.processed_at = utcnow()
        return
    if isinstance(source, ArrearsCase):
        source.last_reminder_at = utcnow()
        source.reminder_stage = (source.reminder_stage or 0) + 1
        source.next_reminder_on = today + timedelta(days=DEFAULT_DISMISS_DAYS)
    elif isinstance(source, Tenant):
        metadata = dict(source.tenant_metadata or {})
        dismiss = dict(metadata.get(DISMISS_METADATA_KEY) or {})
        dismiss[kind] = {
            "dispatched_at": utcnow().isoformat(),
            "next_eligible_on": (today + timedelta(days=DEFAULT_DISMISS_DAYS)).isoformat(),
        }
        metadata[DISMISS_METADATA_KEY] = dismiss
        source.tenant_metadata = metadata
    elif isinstance(source, Lease):
        metadata = dict(source.lease_metadata or {})
        dismiss = dict(metadata.get(DISMISS_METADATA_KEY) or {})
        dismiss[kind] = {
            "dispatched_at": utcnow().isoformat(),
            "next_eligible_on": (today + timedelta(days=DEFAULT_DISMISS_DAYS)).isoformat(),
        }
        metadata[DISMISS_METADATA_KEY] = dismiss
        source.lease_metadata = metadata
    elif isinstance(source, Obligation):
        metadata = dict(source.obligation_metadata or {})
        dismiss = dict(metadata.get(DISMISS_METADATA_KEY) or {})
        dismiss[kind] = {
            "dispatched_at": utcnow().isoformat(),
            "next_eligible_on": (today + timedelta(days=DEFAULT_DISMISS_DAYS)).isoformat(),
        }
        metadata[DISMISS_METADATA_KEY] = dismiss
        source.obligation_metadata = metadata
    elif isinstance(source, TenantOnboarding):
        delivery_data = dict(source.delivery_data or {})
        dismiss = dict(delivery_data.get(DISMISS_METADATA_KEY) or {})
        dismiss[kind] = {
            "dispatched_at": utcnow().isoformat(),
            "next_eligible_on": (today + timedelta(days=DEFAULT_DISMISS_DAYS)).isoformat(),
        }
        delivery_data[DISMISS_METADATA_KEY] = dismiss
        source.delivery_data = delivery_data
    elif isinstance(source, MaintenanceWorkOrder):
        metadata = dict(source.work_order_metadata or {})
        dispatched_at = utcnow().isoformat()
        forwarding = dict(metadata.get("maintenance_forwarding_comms") or {})
        forwarding[kind] = {
            "dispatched_at": dispatched_at,
            "channel": channel,
            "status": status,
            "provider": provider,
            "recipient": recipient,
            "provider_message_id": provider_message_id,
            "error": error,
        }
        metadata["maintenance_forwarding_comms"] = forwarding
        dismiss = dict(metadata.get(DISMISS_METADATA_KEY) or {})
        dismiss[kind] = {
            "dispatched_at": dispatched_at,
            "next_eligible_on": (
                today + timedelta(days=DEFAULT_DISMISS_DAYS)
            ).isoformat(),
        }
        metadata[DISMISS_METADATA_KEY] = dismiss
        source.work_order_metadata = metadata


@router.post(
    "/dispatch",
    response_model=CommsDispatchRead,
    status_code=status.HTTP_201_CREATED,
)
def dispatch_comms_draft(
    payload: CommsDispatchCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CommsDispatchRead:
    """Send an operator-approved comms draft.

    The click on the Approve button is the explicit operator approval that
    satisfies the provider-mutation guardrail. Sends the supplied subject
    and body via SendGrid (no AI re-draft, no template substitution at
    dispatch time) and records the outcome in the audit log. Returns a
    receipt so the operator surface can show queued/failed inline.
    """

    entity_id, source = _resolve_dispatch_entity_id(payload, session)
    assert_entity_role(session, user, entity_id, WRITE_ROLES)

    settings = get_settings()
    candidate_id = f"{payload.kind}:{payload.target_kind}:{payload.target_id}"

    # Channel branches by candidate kind. inbound_sms replies route through
    # Twilio Messaging; everything else (arrears reminders, insurance
    # expiries, lease renewals, inbound_email replies, compliance reminders)
    # routes through SendGrid. The operator's Approve click is the explicit
    # provider-mutation approval on either path.
    channel: str
    result_status: str
    result_provider: str
    result_recipient: str | None
    result_provider_message_id: str | None
    result_error: str | None
    if payload.kind == "inbound_sms":
        channel = "sms"
        sms_result = _send_comms_sms(
            recipient_phone=payload.recipient_phone,
            body=payload.body,
            entity_id=entity_id,
            candidate_id=candidate_id,
            kind=payload.kind,
            settings=settings,
        )
        result_status = sms_result.status
        result_provider = sms_result.provider
        result_recipient = sms_result.recipient
        result_provider_message_id = sms_result.provider_message_id
        result_error = sms_result.error
        tool_name = f"twilio.{sms_result.provider}"
        summary = f"comms draft sms {sms_result.status}"
    else:
        channel = "email"
        email_result = _send_comms_email(
            recipient_email=payload.recipient_email,
            subject=payload.subject,
            body=payload.body,
            entity_id=entity_id,
            candidate_id=candidate_id,
            kind=payload.kind,
            settings=settings,
        )
        result_status = email_result.status
        result_provider = email_result.provider
        result_recipient = email_result.recipient
        result_provider_message_id = email_result.provider_message_id
        result_error = email_result.error
        tool_name = f"sendgrid.{email_result.provider}"
        summary = f"comms draft email {email_result.status}"

    if result_status not in {"failed", "skipped"}:
        _update_source_after_dispatch(
            source,
            payload.kind,
            channel=channel,
            status=result_status,
            provider=result_provider,
            recipient=result_recipient,
            provider_message_id=result_provider_message_id,
            error=result_error,
        )

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="dispatch",
        target_table=payload.target_kind,
        target_id=payload.target_id,
        tool_name=tool_name,
        tool_input={
            "candidate_id": candidate_id,
            "kind": payload.kind,
            "channel": channel,
            "recipient": result_recipient,
        },
        tool_output_summary=summary,
        outcome=(
            AuditOutcome.error
            if result_status == "failed"
            else AuditOutcome.success
        ),
        error_message=result_error if result_status == "failed" else None,
        data_classification="confidential",
    )

    session.commit()

    return CommsDispatchRead(
        candidate_id=candidate_id,
        kind=payload.kind,
        target_kind=payload.target_kind,
        target_id=payload.target_id,
        channel=channel,
        status=result_status,
        provider=result_provider,
        recipient=result_recipient,
        provider_message_id=result_provider_message_id,
        error=result_error,
        sent_at=utcnow(),
    )


def _resolve_dismiss_entity_id(
    payload: CommsDismissCreate, session: Session
) -> tuple[
    UUID,
    ArrearsCase
    | Tenant
    | Lease
    | InboundMessage
    | Obligation
    | TenantOnboarding
    | MaintenanceWorkOrder,
]:
    """Same resolution as dispatch, but for the dismiss verb."""

    if (
        payload.kind in ("inbound_email", "inbound_sms")
        and payload.target_kind == "inbound_message"
    ):
        message = session.get(InboundMessage, payload.target_id)
        if message is None or message.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Inbound message not found.",
            )
        return message.entity_id, message
    if (
        payload.kind == "compliance_obligation"
        and payload.target_kind == "obligation"
    ):
        obligation = session.get(Obligation, payload.target_id)
        if obligation is None or obligation.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Obligation not found.",
            )
        return obligation.entity_id, obligation
    if payload.kind == "arrears_reminder" and payload.target_kind == "arrears_case":
        case = session.get(ArrearsCase, payload.target_id)
        if case is None or case.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Arrears case not found.",
            )
        return case.entity_id, case
    if payload.kind == "insurance_expiry" and payload.target_kind == "tenant":
        tenant = session.get(Tenant, payload.target_id)
        if tenant is None or tenant.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found.",
            )
        return tenant.entity_id, tenant
    if (
        payload.kind in ("lease_renewal", "rent_review")
        and payload.target_kind == "lease"
    ):
        lease = session.get(Lease, payload.target_id)
        if lease is None or lease.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Lease not found.",
            )
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        if unit is None or unit.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Lease scope is inconsistent.",
            )
        prop = session.get(Property, unit.property_id)
        if prop is None or prop.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Lease scope is inconsistent.",
            )
        return prop.entity_id, lease
    if (
        payload.kind == "tenant_lifecycle_stall"
        and payload.target_kind == "tenant_onboarding"
    ):
        onboarding = session.get(TenantOnboarding, payload.target_id)
        if onboarding is None or onboarding.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant onboarding not found.",
            )
        return onboarding.entity_id, onboarding
    if (
        payload.kind
        in ("maintenance_contractor_forward", "maintenance_tenant_forward")
        and payload.target_kind == "maintenance_work_order"
    ):
        work_order = session.get(MaintenanceWorkOrder, payload.target_id)
        if work_order is None or work_order.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Maintenance work order not found.",
            )
        return work_order.entity_id, work_order
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="Unsupported comms target.",
    )


@router.post(
    "/dismiss",
    response_model=CommsDismissRead,
    status_code=status.HTTP_201_CREATED,
)
def dismiss_comms_candidate(
    payload: CommsDismissCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CommsDismissRead:
    """Record the operator's choice to defer a candidate.

    For arrears we move ``reminder_paused_until`` so the queue scanner
    already respects the deferral. For tenant- and lease-scoped candidates
    we stamp a metadata snooze keyed by kind; a future queue-scanner
    refinement will honour the stamp, but the operator surface treats the
    candidate as dismissed for the session either way.
    """

    entity_id, source = _resolve_dismiss_entity_id(payload, session)
    assert_entity_role(session, user, entity_id, WRITE_ROLES)

    deferred_until = payload.until or (
        date.today() + timedelta(days=DEFAULT_DISMISS_DAYS)
    )
    candidate_id = f"{payload.kind}:{payload.target_kind}:{payload.target_id}"
    if isinstance(source, InboundMessage):
        source.archived_at = utcnow()
    elif isinstance(source, ArrearsCase):
        source.reminder_paused_until = deferred_until
    elif isinstance(source, Tenant):
        metadata = dict(source.tenant_metadata or {})
        dismiss = dict(metadata.get(DISMISS_METADATA_KEY) or {})
        dismiss[payload.kind] = {
            "dismissed_at": utcnow().isoformat(),
            "deferred_until": deferred_until.isoformat(),
            "reason": payload.reason,
        }
        metadata[DISMISS_METADATA_KEY] = dismiss
        source.tenant_metadata = metadata
    elif isinstance(source, Lease):
        metadata = dict(source.lease_metadata or {})
        dismiss = dict(metadata.get(DISMISS_METADATA_KEY) or {})
        dismiss[payload.kind] = {
            "dismissed_at": utcnow().isoformat(),
            "deferred_until": deferred_until.isoformat(),
            "reason": payload.reason,
        }
        metadata[DISMISS_METADATA_KEY] = dismiss
        source.lease_metadata = metadata
    elif isinstance(source, Obligation):
        metadata = dict(source.obligation_metadata or {})
        dismiss = dict(metadata.get(DISMISS_METADATA_KEY) or {})
        dismiss[payload.kind] = {
            "dismissed_at": utcnow().isoformat(),
            "deferred_until": deferred_until.isoformat(),
            "reason": payload.reason,
        }
        metadata[DISMISS_METADATA_KEY] = dismiss
        source.obligation_metadata = metadata
    elif isinstance(source, TenantOnboarding):
        delivery_data = dict(source.delivery_data or {})
        dismiss = dict(delivery_data.get(DISMISS_METADATA_KEY) or {})
        dismiss[payload.kind] = {
            "dismissed_at": utcnow().isoformat(),
            "deferred_until": deferred_until.isoformat(),
            "reason": payload.reason,
        }
        delivery_data[DISMISS_METADATA_KEY] = dismiss
        source.delivery_data = delivery_data
    elif isinstance(source, MaintenanceWorkOrder):
        metadata = dict(source.work_order_metadata or {})
        dismiss = dict(metadata.get(DISMISS_METADATA_KEY) or {})
        dismiss[payload.kind] = {
            "dismissed_at": utcnow().isoformat(),
            "deferred_until": deferred_until.isoformat(),
            "reason": payload.reason,
        }
        metadata[DISMISS_METADATA_KEY] = dismiss
        source.work_order_metadata = metadata

    audit_tool_input = {
        "candidate_id": candidate_id,
        "kind": payload.kind,
        "deferred_until": deferred_until.isoformat(),
        "reason": payload.reason,
    }
    if (
        isinstance(source, MaintenanceWorkOrder)
        and payload.kind == "maintenance_contractor_forward"
    ):
        audit_tool_input["recipient"] = (
            source.contractor_email or source.contractor_phone
        )

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="dismiss",
        target_table=payload.target_kind,
        target_id=payload.target_id,
        tool_name="comms.dismiss",
        tool_input=audit_tool_input,
        tool_output_summary=f"comms candidate dismissed until {deferred_until.isoformat()}",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )

    session.commit()

    return CommsDismissRead(
        candidate_id=candidate_id,
        kind=payload.kind,
        target_kind=payload.target_kind,
        target_id=payload.target_id,
        deferred_until=deferred_until,
        reason=payload.reason,
        dismissed_at=utcnow(),
    )


def _attribute_inbound_tenant(
    entity_id: UUID, from_address: str | None, session: Session
) -> Tenant | None:
    """Best-effort tenant attribution from an inbound from-address.

    Matches the address against the entity's tenants' contact_email or
    billing_email. Returns the first match, or None if none. Operators
    re-attribute manually from the comms queue when the match is ambiguous.
    """

    cleaned = (from_address or "").strip().lower()
    if not cleaned:
        return None
    tenants = list(
        session.scalars(
            select(Tenant).where(
                Tenant.entity_id == entity_id,
                Tenant.deleted_at.is_(None),
            )
        ).all()
    )
    for tenant in tenants:
        contact = (tenant.contact_email or "").strip().lower()
        billing = (tenant.billing_email or "").strip().lower()
        if contact == cleaned or billing == cleaned:
            return tenant
    return None


def _verify_sendgrid_inbound_secret(request: Request, settings: Settings) -> None:
    expected = settings.sendgrid_inbound_secret.strip()
    if not expected:
        return
    supplied = (
        request.headers.get("x-leasium-sendgrid-inbound-secret")
        or request.headers.get("x-sendgrid-inbound-secret")
        or request.query_params.get("token")
        or request.query_params.get("secret")
        or ""
    ).strip()
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=SENDGRID_INBOUND_SECRET_DETAIL,
        )


def _inbound_attachment_confidence(value: Any) -> float | None:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, confidence))


def _inbound_attachment_status_for_extraction(
    extracted: dict[str, Any],
) -> DocumentIntakeStatus:
    if extracted.get("document_type") == "unknown":
        return DocumentIntakeStatus.needs_attention
    if extracted.get("warnings") or extracted.get("missing_information"):
        return DocumentIntakeStatus.needs_attention
    return DocumentIntakeStatus.ready_for_review


def _inbound_attachment_document_category(document_type: str) -> DocumentCategory:
    if document_type == "lease":
        return DocumentCategory.lease
    if document_type == "insurance_certificate":
        return DocumentCategory.insurance
    if document_type == "bank_guarantee":
        return DocumentCategory.bank_guarantee
    if document_type == "invoice":
        return DocumentCategory.invoice
    return DocumentCategory.other


def _extract_inbound_attachment_intake(
    intake: DocumentIntake,
    *,
    settings: Settings,
    session: Session,
) -> None:
    document = intake.document
    intake.status = DocumentIntakeStatus.reading
    intake.error_message = None
    session.flush()
    try:
        extracted, response_id = extract_document_file(
            file_data=document.file_data,
            filename=document.filename,
            content_type=document.content_type,
            settings=settings,
        )
    except DocumentExtractionError as exc:
        intake.status = DocumentIntakeStatus.failed
        intake.error_message = str(exc)
        document.document_metadata = {
            **(document.document_metadata or {}),
            "smart_intake_auto_extract_failed": True,
            "smart_intake_auto_extract_error": str(exc),
        }
        audit_log(
            session,
            actor="sendgrid.inbound_parse",
            entity_id=intake.entity_id,
            action="extract",
            target_table="document_intake",
            target_id=intake.id,
            tool_name="openai.responses",
            tool_input={
                "document_id": str(document.id),
                "document_intake_id": str(intake.id),
                "filename": document.filename,
                "source": "sendgrid_inbound_parse",
                "status": intake.status.value,
            },
            outcome=AuditOutcome.error,
            error_message=str(exc),
            data_classification="confidential",
        )
        return

    document_type = str(extracted.get("document_type") or "unknown")
    summary = str(extracted.get("summary") or "").strip() or None
    intake.status = _inbound_attachment_status_for_extraction(extracted)
    intake.document_type = document_type
    intake.summary = summary
    intake.confidence = _inbound_attachment_confidence(extracted.get("confidence"))
    intake.extracted_data = extracted
    intake.openai_response_id = response_id
    proposed_category = _inbound_attachment_document_category(document_type)
    document.document_metadata = {
        **(document.document_metadata or {}),
        "smart_intake_auto_extracted": True,
        "smart_intake_auto_extracted_at": utcnow().isoformat(),
        "document_type": document_type,
        "proposed_document_category": proposed_category.value,
    }
    audit_log(
        session,
        actor="sendgrid.inbound_parse",
        entity_id=intake.entity_id,
        action="extract",
        target_table="document_intake",
        target_id=intake.id,
        tool_name="openai.responses",
        tool_input={
            "document_id": str(document.id),
            "document_intake_id": str(intake.id),
            "filename": document.filename,
            "source": "sendgrid_inbound_parse",
            "document_type": document_type,
            "openai_response_id": response_id,
            "proposed_document_category": proposed_category.value,
            "status": intake.status.value,
        },
        tool_output_summary="SendGrid inbound attachment extracted into Smart Intake review.",
        data_classification="confidential",
    )


async def _promote_sendgrid_attachments_to_intake(
    *,
    form: Any | None,
    message: InboundMessage,
    tenant: Tenant | None,
    session: Session,
    max_bytes: int,
    settings: Settings,
) -> list[DocumentIntake]:
    promoted: list[DocumentIntake] = []
    if form is None:
        return promoted
    items = form.multi_items() if hasattr(form, "multi_items") else form.items()
    for field_name, value in items:
        filename = getattr(value, "filename", None)
        read = getattr(value, "read", None)
        if not filename or not callable(read):
            continue
        data = await read(max_bytes + 1)
        if not data or len(data) > max_bytes:
            continue
        safe_filename = Path(str(filename)).name or "sendgrid-attachment"
        content_type = getattr(value, "content_type", None)
        document = StoredDocument(
            entity_id=message.entity_id,
            tenant_id=tenant.id if tenant is not None else None,
            filename=safe_filename,
            content_type=content_type if isinstance(content_type, str) else None,
            byte_size=len(data),
            file_data=data,
            category=DocumentCategory.other,
            notes="SendGrid inbound email attachment",
            document_metadata={
                "source": "sendgrid_inbound_parse",
                "inbound_message_id": str(message.id),
                "inbound_attachment_field": str(field_name),
                "original_filename": safe_filename,
            },
        )
        session.add(document)
        session.flush()
        review_data: dict[str, Any] = {
            "source": "sendgrid_inbound_parse",
            "candidate": "inbound_email_attachment",
            "inbound_message_id": str(message.id),
            "inbound_subject": message.subject,
            "inbound_sender": message.from_address,
            "inbound_received_at": (
                message.created_at.isoformat() if message.created_at else None
            ),
            "guardrail": (
                "No tenant data, lease data, provider action, or payment record "
                "is changed until an operator applies the Smart Intake review."
            ),
        }
        if tenant is not None:
            review_data["tenant_id"] = str(tenant.id)
        intake = DocumentIntake(
            entity_id=message.entity_id,
            document_id=document.id,
            status=DocumentIntakeStatus.uploaded,
            extracted_data={},
            review_data=review_data,
        )
        session.add(intake)
        session.flush()
        document.document_metadata = {
            **(document.document_metadata or {}),
            "smart_intake_id": str(intake.id),
            "smart_intake_promoted": True,
            "smart_intake_promoted_at": utcnow().isoformat(),
        }
        audit_log(
            session,
            actor="sendgrid.inbound_parse",
            entity_id=message.entity_id,
            action="promote",
            target_table="document_intake",
            target_id=intake.id,
            tool_input={
                "document_id": str(document.id),
                "document_intake_id": str(intake.id),
                "inbound_message_id": str(message.id),
                "filename": safe_filename,
                "source": "sendgrid_inbound_parse",
                "candidate": "inbound_email_attachment",
                "tenant_id": str(tenant.id) if tenant is not None else None,
                "attachment_field": str(field_name),
            },
            tool_output_summary=(
                "SendGrid inbound attachment promoted to Smart Intake review queue."
            ),
            outcome=AuditOutcome.success,
            data_classification="confidential",
        )
        if settings.openai_api_key:
            _extract_inbound_attachment_intake(
                intake,
                settings=settings,
                session=session,
            )
        promoted.append(intake)
    return promoted


@router.post(
    "/webhooks/sendgrid-inbound",
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive_sendgrid_inbound(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID,
    from_address: Annotated[str | None, Form(alias="from")] = None,
    to: str | None = Form(default=None),
    subject: str | None = Form(default=None),
    text: str | None = Form(default=None),
    html: str | None = Form(default=None),
) -> dict[str, object]:
    """Receive a parsed inbound email from SendGrid Inbound Parse.

    Reads the SendGrid form payload, attributes to a tenant by matching the
    from-address against existing tenant contacts, persists an
    ``inbound_message`` row, then runs AI inbox classification when the
    provider key is configured. Returns 202 so SendGrid stops retrying once
    the row is persisted, even if no tenant was attributed.

    Auth: the inbound endpoint is webhook-only and not session-protected.
    When ``SENDGRID_INBOUND_SECRET`` is configured, the request must include
    the matching shared secret header or query token before anything is
    persisted.
    """

    # Validate the entity exists before persisting anything.
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entity not found.",
        )

    cleaned_from = (from_address or "").strip()
    cleaned_to = (to or "").strip()
    cleaned_subject = (subject or "").strip() or None
    cleaned_text = (text or "").strip() or None
    cleaned_html = (html or "").strip() or None

    tenant = _attribute_inbound_tenant(entity_id, cleaned_from, session)
    settings = get_settings()
    _verify_sendgrid_inbound_secret(request, settings)

    # Capture remaining form fields for later debugging without dragging
    # them into structured columns. We never log the body in audit metadata
    # because it can contain confidential tenant detail.
    form: Any | None = None
    try:
        form = await request.form()
        raw_payload: dict[str, Any] = {
            key: str(value)[:2000] for key, value in form.items()
        }
    except Exception:  # pragma: no cover - defensive against odd payloads
        raw_payload = {}

    message = InboundMessage(
        entity_id=entity_id,
        channel="email",
        provider="sendgrid",
        from_address=cleaned_from or None,
        to_address=cleaned_to or None,
        subject=cleaned_subject,
        body_text=cleaned_text,
        body_html=cleaned_html,
        attributed_tenant_id=tenant.id if tenant is not None else None,
        raw_payload=raw_payload,
        inbound_metadata={"received_via": "sendgrid_inbound_parse"},
    )
    session.add(message)
    session.flush()
    attachment_intakes = await _promote_sendgrid_attachments_to_intake(
        form=form,
        message=message,
        tenant=tenant,
        session=session,
        max_bytes=settings.document_max_bytes,
        settings=settings,
    )
    message.inbound_metadata = {
        **(message.inbound_metadata or {}),
        "attachment_intake_count": len(attachment_intakes),
        "attachment_document_ids": [
            str(intake.document_id) for intake in attachment_intakes
        ],
        "attachment_intake_ids": [str(intake.id) for intake in attachment_intakes],
    }
    # Best-effort AI classification. Soft-fails: if OPENAI_API_KEY is missing
    # or the call errors, the row is still persisted and the operator can
    # classify manually from the comms queue. The body itself is never
    # audited — only kind + confidence — so the inbound classifier matches
    # the existing /ai/triage guardrail.
    classification_summary: str | None = None
    if cleaned_text and settings.openai_api_key:
        try:
            result, _ = triage_inbox(body=cleaned_text, settings=settings)
        except InboxTriageError:
            result = None
        if result is not None:
            raw_kind = result.get("kind")
            if isinstance(raw_kind, str) and raw_kind in INBOX_KINDS:
                message.classification_kind = raw_kind
            raw_conf = result.get("confidence")
            try:
                confidence = float(raw_conf)  # type: ignore[arg-type]
                message.classification_confidence = max(0.0, min(1.0, confidence))
            except (TypeError, ValueError):
                pass
            raw_summary = result.get("summary")
            if isinstance(raw_summary, str):
                classification_summary = raw_summary.strip()[:400] or None
                message.classification_summary = classification_summary
            raw_target = result.get("suggested_target_kind")
            if isinstance(raw_target, str):
                message.classification_target_kind = raw_target[:60]
    audit_log(
        session,
        actor="sendgrid.inbound_parse",
        entity_id=entity_id,
        action="receive",
        target_table="inbound_message",
        target_id=message.id,
        tool_name="sendgrid.inbound_parse",
        tool_input={
            "from_domain": cleaned_from.split("@")[-1] if "@" in cleaned_from else None,
            "attributed_tenant_id": str(tenant.id) if tenant is not None else None,
            "classification_kind": message.classification_kind,
        },
        tool_output_summary=(
            f"inbound email received and classified as {message.classification_kind}"
            if message.classification_kind
            else "inbound email received"
        ),
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    return {
        "id": str(message.id),
        "attributed_tenant_id": str(tenant.id) if tenant is not None else None,
        "attachment_intake_count": len(attachment_intakes),
    }


def _attribute_inbound_tenant_by_phone(
    entity_id: UUID, from_phone: str | None, session: Session
) -> Tenant | None:
    """Best-effort tenant attribution from an inbound SMS From phone number.

    Twilio sends From numbers in E.164 (e.g. ``+61400111222``). Tenant
    contact_phone values can be stored in many formats. For AU mobiles the
    domestic format ``0400 111 222`` shares only the last 9 digits with the
    E.164 ``+61400111222`` (the leading ``0`` is the trunk prefix that gets
    swapped for the country code). To make all three formats match the same
    tenant — ``+61400111222``, ``0400111222``, ``+61 400 111 222`` — we
    compare on the last 9 digits.
    """

    def last_n(value: str) -> str:
        digits = "".join(ch for ch in value if ch.isdigit())
        return digits[-9:] if len(digits) >= 9 else digits

    needle = last_n(from_phone or "")
    if not needle or len(needle) < 9:
        return None
    tenants = list(
        session.scalars(
            select(Tenant).where(
                Tenant.entity_id == entity_id,
                Tenant.deleted_at.is_(None),
                Tenant.contact_phone.is_not(None),
            )
        ).all()
    )
    for tenant in tenants:
        candidate = last_n(tenant.contact_phone or "")
        if candidate and candidate == needle:
            return tenant
    return None


def _assert_twilio_webhook_signature(
    request: Request,
    form_payload: dict[str, Any],
    settings: Settings,
) -> None:
    """Validate Twilio's signed webhook when an auth token is configured."""

    auth_token = settings.twilio_auth_token.strip()
    if not auth_token:
        return

    if twilio_signature_valid(
        request,
        form_payload,
        auth_token,
        settings.public_api_url,
    ):
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Invalid Twilio webhook signature.",
    )


@router.post(
    "/webhooks/twilio-inbound",
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive_twilio_inbound(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID,
    from_phone: Annotated[str | None, Form(alias="From")] = None,
    to_phone: Annotated[str | None, Form(alias="To")] = None,
    body: Annotated[str | None, Form(alias="Body")] = None,
    message_sid: Annotated[str | None, Form(alias="MessageSid")] = None,
    from_country: Annotated[str | None, Form(alias="FromCountry")] = None,
) -> dict[str, object]:
    """Receive an inbound SMS from Twilio.

    Twilio POSTs ``application/x-www-form-urlencoded`` with PascalCase keys
    (``From``, ``To``, ``Body``, ``MessageSid``, etc). We persist the
    structured fields on the ``inbound_message`` table with ``channel="sms"``
    and ``provider="twilio"``, attempt tenant attribution by digits-only
    phone-number suffix match, then run the existing /ai/triage classifier
    when ``OPENAI_API_KEY`` is set.

    When ``TWILIO_AUTH_TOKEN`` is configured, validates Twilio's
    ``X-Twilio-Signature`` before persisting anything. Local/dev setups with
    no token keep accepting the provider-only webhook while credentials are
    being provisioned.
    """

    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entity not found.",
        )

    settings = get_settings()
    try:
        form = await request.form()
        signature_payload: dict[str, Any] = {
            key: str(value) for key, value in form.items()
        }
        raw_payload: dict[str, Any] = {
            key: value[:2000] for key, value in signature_payload.items()
        }
    except Exception:  # pragma: no cover - defensive
        signature_payload = {}
        raw_payload = {}
    _assert_twilio_webhook_signature(request, signature_payload, settings)

    cleaned_from = (from_phone or "").strip()
    cleaned_to = (to_phone or "").strip()
    cleaned_body = (body or "").strip() or None

    tenant = _attribute_inbound_tenant_by_phone(entity_id, cleaned_from, session)

    message = InboundMessage(
        entity_id=entity_id,
        channel="sms",
        provider="twilio",
        from_address=cleaned_from or None,
        to_address=cleaned_to or None,
        subject=None,
        body_text=cleaned_body,
        body_html=None,
        attributed_tenant_id=tenant.id if tenant is not None else None,
        raw_payload=raw_payload,
        inbound_metadata={
            "received_via": "twilio_messaging_webhook",
            "from_country": from_country or None,
            "message_sid": message_sid or None,
        },
    )
    session.add(message)
    session.flush()

    # Best-effort AI classification — same shape as the SendGrid webhook.
    # SMS bodies are short by nature; the classifier handles them the same
    # way it handles pasted email snippets.
    if cleaned_body and settings.openai_api_key:
        try:
            result, _ = triage_inbox(body=cleaned_body, settings=settings)
        except InboxTriageError:
            result = None
        if result is not None:
            raw_kind = result.get("kind")
            if isinstance(raw_kind, str) and raw_kind in INBOX_KINDS:
                message.classification_kind = raw_kind
            raw_conf = result.get("confidence")
            try:
                confidence = float(raw_conf)  # type: ignore[arg-type]
                message.classification_confidence = max(0.0, min(1.0, confidence))
            except (TypeError, ValueError):
                pass
            raw_summary = result.get("summary")
            if isinstance(raw_summary, str):
                message.classification_summary = raw_summary.strip()[:400] or None
            raw_target = result.get("suggested_target_kind")
            if isinstance(raw_target, str):
                message.classification_target_kind = raw_target[:60]

    audit_log(
        session,
        actor="twilio.messaging_webhook",
        entity_id=entity_id,
        action="receive",
        target_table="inbound_message",
        target_id=message.id,
        tool_name="twilio.messaging_webhook",
        tool_input={
            "from_country": from_country,
            "attributed_tenant_id": str(tenant.id) if tenant is not None else None,
            "classification_kind": message.classification_kind,
        },
        tool_output_summary=(
            f"inbound sms received and classified as {message.classification_kind}"
            if message.classification_kind
            else "inbound sms received"
        ),
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    return {
        "id": str(message.id),
        "attributed_tenant_id": str(tenant.id) if tenant is not None else None,
    }
