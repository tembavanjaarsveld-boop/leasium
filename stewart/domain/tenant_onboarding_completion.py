"""Completion helpers for tenant onboarding rows backed by executed leases."""

from datetime import datetime
from uuid import UUID

from stewart.core.db import utcnow
from stewart.core.models import Lease, LeaseStatus, TenantOnboarding, TenantOnboardingStatus

PRE_APPLIED_ONBOARDING_STATUSES = {
    TenantOnboardingStatus.draft,
    TenantOnboardingStatus.sent,
    TenantOnboardingStatus.submitted,
    TenantOnboardingStatus.reviewed,
}
EXECUTED_LEASE_STATUSES = {LeaseStatus.active, LeaseStatus.holding_over}


def _lease_agreement_signed(onboarding: TenantOnboarding) -> bool:
    delivery_data = onboarding.delivery_data if isinstance(onboarding.delivery_data, dict) else {}
    section = delivery_data.get("lease_agreement")
    section_data = section if isinstance(section, dict) else {}
    signing = section_data.get("signing")
    signing_data = signing if isinstance(signing, dict) else {}
    signed_at = signing_data.get("signed_at")
    return isinstance(signed_at, str) and bool(signed_at.strip())


def onboarding_lease_is_signed_or_active(onboarding: TenantOnboarding, lease: Lease) -> bool:
    """True when the persisted lease/onboarding state proves execution."""

    return _lease_agreement_signed(onboarding) or lease.status in EXECUTED_LEASE_STATUSES


def _complete_reminder_sections(
    current: dict[str, object],
    *,
    reason: str,
    completed_at: datetime,
) -> dict[str, object]:
    next_data = {**current}
    timestamp = completed_at.isoformat()
    for key in ("reminders", "expiry_reminders"):
        section = next_data.get(key)
        if not isinstance(section, dict):
            continue
        next_data[key] = {
            **section,
            "enabled": False,
            "paused": False,
            "paused_reason": None,
            "completed_at": timestamp,
            "completed_reason": reason,
            "next_reminder_at": None,
        }
    return next_data


def complete_onboarding_for_signed_or_active_lease(
    onboarding: TenantOnboarding,
    lease: Lease,
    *,
    reason: str,
    user_id: UUID | None = None,
    completed_at: datetime | None = None,
) -> bool:
    """Advance a pre-complete onboarding when its lease is already executed.

    Returns ``True`` when it mutated the row. Re-running after completion is a
    no-op, which keeps webhook replays and backfill reruns safe.
    """

    if onboarding.deleted_at is not None:
        return False
    if onboarding.status not in PRE_APPLIED_ONBOARDING_STATUSES:
        return False
    if not onboarding_lease_is_signed_or_active(onboarding, lease):
        return False

    now = completed_at or utcnow()
    previous_status = onboarding.status
    review_data = dict(onboarding.review_data or {})
    history = review_data.get("completion_history")
    history_rows = (
        [item for item in history if isinstance(item, dict)]
        if isinstance(history, list)
        else []
    )
    entry: dict[str, object] = {
        "reason": reason,
        "completed_at": now.isoformat(),
        "previous_status": previous_status.value,
        "lease_id": str(lease.id),
    }
    if user_id is not None:
        entry["user_id"] = str(user_id)
    review_data["completion_reason"] = reason
    review_data["completion_history"] = [entry, *history_rows[:9]]

    onboarding.status = TenantOnboardingStatus.applied
    onboarding.submitted_at = onboarding.submitted_at or now
    onboarding.reviewed_at = onboarding.reviewed_at or now
    if user_id is not None and onboarding.reviewed_by_user_id is None:
        onboarding.reviewed_by_user_id = user_id
    onboarding.applied_at = onboarding.applied_at or now
    if user_id is not None and onboarding.applied_by_user_id is None:
        onboarding.applied_by_user_id = user_id
    onboarding.review_data = review_data
    onboarding.delivery_data = _complete_reminder_sections(
        dict(onboarding.delivery_data or {}),
        reason=reason,
        completed_at=now,
    )
    return True
