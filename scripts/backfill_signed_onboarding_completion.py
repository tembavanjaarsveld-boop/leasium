"""Self-heal tenant onboardings whose leases are already signed/executed.

Dry-run by default. Pass ``--apply`` only after reviewing the planned rows. This
script is provider-inert: it updates local onboarding state only and sends no
email, SMS, Xero, payment, or reconciliation call.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import SessionLocal
from stewart.core.models import Lease, TenantOnboarding
from stewart.domain.tenant_onboarding_completion import (
    complete_onboarding_for_signed_or_active_lease,
    onboarding_lease_is_signed_or_active,
)

SELF_HEAL_REASON = "self_heal_pre_signed_lease"


@dataclass(frozen=True)
class SignedOnboardingSelfHealChange:
    onboarding_id: UUID
    lease_id: UUID
    previous_status: str
    reason: str


def plan_signed_onboarding_completion_self_heal(
    session: Session,
    *,
    apply_changes: bool,
) -> list[SignedOnboardingSelfHealChange]:
    """Plan or apply onboarding completion for already executed leases."""

    changes: list[SignedOnboardingSelfHealChange] = []
    rows = session.scalars(
        select(TenantOnboarding).where(TenantOnboarding.deleted_at.is_(None))
    ).all()
    for onboarding in rows:
        lease = session.get(Lease, onboarding.lease_id)
        if lease is None or lease.deleted_at is not None:
            continue
        if not onboarding_lease_is_signed_or_active(onboarding, lease):
            continue
        previous_status = onboarding.status.value
        if apply_changes:
            changed = complete_onboarding_for_signed_or_active_lease(
                onboarding,
                lease,
                reason=SELF_HEAL_REASON,
            )
            if not changed:
                continue
        elif onboarding.status.value == "applied" or onboarding.status.value == "cancelled":
            continue
        changes.append(
            SignedOnboardingSelfHealChange(
                onboarding_id=onboarding.id,
                lease_id=lease.id,
                previous_status=previous_status,
                reason=SELF_HEAL_REASON,
            )
        )
    if apply_changes:
        session.flush()
    return changes


def format_changes(
    changes: list[SignedOnboardingSelfHealChange],
    *,
    apply_changes: bool,
) -> str:
    mode = "APPLY" if apply_changes else "DRY RUN"
    lines = [
        f"Signed lease onboarding self-heal ({mode})",
        f"Planned onboarding completions: {len(changes)}",
    ]
    for change in changes:
        lines.append(
            "- tenant_onboarding "
            f"{change.onboarding_id} lease={change.lease_id} "
            f"{change.previous_status}->applied reason={change.reason}"
        )
    if apply_changes:
        lines.append("Applied and committed.")
    else:
        lines.append("No records were changed. Re-run with --apply only after review.")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Review and optionally complete signed/executed lease onboardings."
    )
    parser.add_argument("--apply", action="store_true", help="commit changes (default: dry run)")
    args = parser.parse_args()

    with SessionLocal() as session:
        changes = plan_signed_onboarding_completion_self_heal(
            session,
            apply_changes=args.apply,
        )
        if args.apply:
            session.commit()
        else:
            session.rollback()
        print(format_changes(changes, apply_changes=args.apply))


if __name__ == "__main__":
    main()
