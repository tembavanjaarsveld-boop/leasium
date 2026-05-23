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

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    AuditOutcome,
    Entity,
    InboundMessage,
    Lease,
    LeaseStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    TenancyUnit,
    Tenant,
    UserRole,
)
from stewart.ai.inbox import INBOX_KINDS, InboxTriageError, triage_inbox
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.comms import (
    CommsCandidate,
    CommsDismissCreate,
    CommsDismissRead,
    CommsDispatchCreate,
    CommsDispatchRead,
    CommsQueueRead,
)

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


@dataclass(frozen=True)
class _CommsEmailResult:
    """Outcome of a SendGrid send for an operator-approved comms draft."""

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


def _arrears_candidates(
    entity_id: UUID, session: Session
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
        property_name = None
        if case.property_id is not None:
            prop = session.get(Property, case.property_id)
            if prop is not None and prop.deleted_at is None:
                property_name = prop.name
        unit_label = None
        if case.tenancy_unit_id is not None:
            unit = session.get(TenancyUnit, case.tenancy_unit_id)
            if unit is not None and unit.deleted_at is None:
                unit_label = unit.unit_label
        # If a lease is attached and the case has no property/unit, fall back
        # to the lease's relations so the draft still locates the tenancy.
        if (property_name is None or unit_label is None) and case.lease_id is not None:
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

        severity = _arrears_severity(case, today)
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
        due_at = case.next_reminder_on or case.oldest_unpaid_invoice_date
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


def _insurance_candidates(
    entity_id: UUID, session: Session
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
        # We have not yet read the resolved property/unit for context — pick
        # the most recent active lease's property/unit so the reminder names
        # the location the policy covers.
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
        property_name: str | None = None
        unit_label: str | None = None
        if lease is not None:
            unit = session.get(TenancyUnit, lease.tenancy_unit_id)
            if unit is not None and unit.deleted_at is None:
                unit_label = unit.unit_label
                prop = session.get(Property, unit.property_id)
                if prop is not None and prop.deleted_at is None:
                    property_name = prop.name

        days_until = (expiry - today).days
        if days_until < 0:
            severity: str = "danger"
            ask = (
                "Your insurance policy on file expired on "
                f"{expiry.strftime('%d %b %Y')}. Please send a current "
                "certificate of currency as soon as possible — operating "
                "without cover may breach your lease."
            )
            subject_prefix = "Insurance has expired"
        elif days_until <= 14:
            severity = "warning"
            ask = (
                f"Your insurance policy on file expires on "
                f"{expiry.strftime('%d %b %Y')} ({days_until} days). Please "
                "send a renewal certificate so we can update your record."
            )
            subject_prefix = "Insurance expires soon"
        else:
            severity = "info"
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
            f"{subject_prefix} for {location}" if location_parts else subject_prefix
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


def _lease_renewal_candidates(
    entity_id: UUID, session: Session
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
            tone = (
                "Your lease term is winding down. Could we set up a quick "
                "call this week to lock in the renewal terms or plan a "
                "smooth handover."
            )
            subject_prefix = "Lease ending soon — let's talk"
        elif days_until <= 60:
            severity = "warning"
            tone = (
                "Your current term is closing in. We would like to start "
                "the renewal discussion — could you let us know whether "
                "you intend to renew, and any changes you would like us "
                "to consider."
            )
            subject_prefix = "Lease renewal — your intentions"
        else:
            severity = "info"
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
                property_name=prop.name,
                unit_label=unit.unit_label,
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
    entity_id: UUID, session: Session
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
        tenant: Tenant | None = None
        property_name: str | None = None
        unit_label: str | None = None
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
    entity_id: UUID, session: Session
) -> list[CommsCandidate]:
    """Surface unprocessed inbound emails as queue candidates.

    Each pending inbound message becomes an `inbound_email` candidate. The
    draft subject is "Re: <original>"; the draft body opens with a short
    placeholder for the operator to fill in. Attribution is best-effort and
    can be empty if the from-address didn't match any tenant.
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
        tenant: Tenant | None = None
        if message.attributed_tenant_id is not None:
            tenant = session.get(Tenant, message.attributed_tenant_id)
            if tenant is not None and tenant.deleted_at is not None:
                tenant = None
        tenant_name = _tenant_display_name(tenant) if tenant is not None else None
        recipient_email = message.from_address
        subject = (
            f"Re: {message.subject}"
            if message.subject
            else "Re: your message"
        )
        snippet = (message.body_text or "")[:240]
        if snippet and len(message.body_text or "") > 240:
            snippet += "…"
        body = (
            f"Hi {tenant.contact_name if tenant and tenant.contact_name else 'there'},\n\n"
            "Thanks for your message — we've received it and will follow up "
            "shortly. Please let us know if anything in this thread has "
            "changed in the meantime.\n\n"
            f"Original message:\n{snippet or '(no body)'}\n\n"
            "Thanks,\nThe property team"
        )
        detail_parts: list[str] = [f"from {message.from_address or 'unknown'}"]
        if tenant is None:
            detail_parts.append("tenant not attributed")
        if message.classification_kind:
            label = message.classification_kind.replace("_", " ")
            confidence = message.classification_confidence
            if confidence is not None:
                detail_parts.append(
                    f"AI: {label} ({int(round(float(confidence) * 100))}%)"
                )
            else:
                detail_parts.append(f"AI: {label}")
        # Severity reflects classification urgency when present, otherwise info.
        severity: str = "info"
        if message.classification_kind == "payment_or_arrears":
            severity = "danger"
        elif message.classification_kind == "maintenance_request":
            severity = "warning"
        elif message.classification_kind == "spam_or_noise":
            severity = "info"

        candidates.append(
            CommsCandidate(
                id=f"inbound_email:inbound_message:{message.id}",
                kind="inbound_email",
                target_kind="inbound_message",
                target_id=message.id,
                tenant_id=tenant.id if tenant is not None else None,
                tenant_name=tenant_name,
                property_name=None,
                unit_label=None,
                recipient_email=recipient_email,
                recipient_phone=None,
                subject=subject,
                body=body,
                severity=severity,  # type: ignore[arg-type]
                due_at=None,
                detail=", ".join(detail_parts),
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
    )
    return CommsQueueRead(
        entity_id=entity_id,
        candidates=candidates,
        generated_at=utcnow(),
    )


def _resolve_dispatch_entity_id(
    payload: CommsDispatchCreate, session: Session
) -> tuple[UUID, ArrearsCase | Tenant | Lease | InboundMessage | Obligation]:
    """Look up the entity_id for a dispatch target and return the source row.

    Each kind is scoped to a different table — the target_kind tells us where
    to look. We reject dispatches whose payload references a target the user
    cannot resolve, before checking entity-level access.
    """

    if payload.kind == "inbound_email" and payload.target_kind == "inbound_message":
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
    if payload.kind == "lease_renewal" and payload.target_kind == "lease":
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
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="Unsupported comms target.",
    )


def _update_source_after_dispatch(
    source: ArrearsCase | Tenant | Lease | InboundMessage | Obligation, kind: str
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
    recipient_email = payload.recipient_email
    result = _send_comms_email(
        recipient_email=recipient_email,
        subject=payload.subject,
        body=payload.body,
        entity_id=entity_id,
        candidate_id=candidate_id,
        kind=payload.kind,
        settings=settings,
    )

    if result.status not in {"failed", "skipped"}:
        _update_source_after_dispatch(source, payload.kind)

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="dispatch",
        target_table=payload.target_kind,
        target_id=payload.target_id,
        tool_name=f"sendgrid.{result.provider}",
        tool_input={
            "candidate_id": candidate_id,
            "kind": payload.kind,
            "recipient": result.recipient,
        },
        tool_output_summary=f"comms draft email {result.status}",
        outcome=(
            AuditOutcome.error
            if result.status == "failed"
            else AuditOutcome.success
        ),
        error_message=result.error if result.status == "failed" else None,
        data_classification="confidential",
    )

    session.commit()

    return CommsDispatchRead(
        candidate_id=candidate_id,
        kind=payload.kind,
        target_kind=payload.target_kind,
        target_id=payload.target_id,
        channel="email",
        status=result.status,
        provider=result.provider,
        recipient=result.recipient,
        provider_message_id=result.provider_message_id,
        error=result.error,
        sent_at=utcnow(),
    )


def _resolve_dismiss_entity_id(
    payload: CommsDismissCreate, session: Session
) -> tuple[UUID, ArrearsCase | Tenant | Lease | InboundMessage | Obligation]:
    """Same resolution as dispatch, but for the dismiss verb."""

    if payload.kind == "inbound_email" and payload.target_kind == "inbound_message":
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
    if payload.kind == "lease_renewal" and payload.target_kind == "lease":
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

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="dismiss",
        target_table=payload.target_kind,
        target_id=payload.target_id,
        tool_name="comms.dismiss",
        tool_input={
            "candidate_id": candidate_id,
            "kind": payload.kind,
            "deferred_until": deferred_until.isoformat(),
            "reason": payload.reason,
        },
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
    from-address against existing tenant contacts, and persists an
    ``inbound_message`` row. Classification is deferred — a follow-up slice
    wires this into the existing /ai/triage classifier under the same
    guardrail. Returns 202 so SendGrid stops retrying once the row is
    persisted, even if no tenant was attributed.

    Auth: the inbound endpoint is webhook-only and not session-protected;
    SendGrid signs requests via a shared secret configured in the
    provider console. v1 trusts the entity_id passed in the query because
    SendGrid Inbound Parse is configured per-MX-domain and each route is
    only reachable by the provider. A future hardening pass should verify
    the shared signature header.
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

    # Capture remaining form fields for later debugging without dragging
    # them into structured columns. We never log the body in audit metadata
    # because it can contain confidential tenant detail.
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
    # Best-effort AI classification. Soft-fails: if OPENAI_API_KEY is missing
    # or the call errors, the row is still persisted and the operator can
    # classify manually from the comms queue. The body itself is never
    # audited — only kind + confidence — so the inbound classifier matches
    # the existing /ai/triage guardrail.
    settings = get_settings()
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
    }
