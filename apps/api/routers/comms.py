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

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    Lease,
    Property,
    TenancyUnit,
    Tenant,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.comms import CommsCandidate, CommsQueueRead

router = APIRouter(prefix="/comms", tags=["comms"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}


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


@router.get("/queue", response_model=CommsQueueRead)
def get_comms_queue(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CommsQueueRead:
    """Return draft communications the operator should review.

    Read-only — never mutates, never sends. v1 returns arrears reminders
    only; future slices extend to document-chase and lease-event drafts.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    candidates = _arrears_candidates(entity_id, session)
    return CommsQueueRead(
        entity_id=entity_id,
        candidates=candidates,
        generated_at=utcnow(),
    )
