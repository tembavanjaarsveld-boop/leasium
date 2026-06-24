"""Helpers for migrating already-onboarded tenants into the portal.

A migrated tenant's details already live on the tenant record (imported from
their existing lease), so their onboarding row is created directly in
``applied`` state with a migration provenance marker. The tenant then skips the
confirm-details wizard and lands straight in the working portal once they claim
their login. Building the row is provider-inert; sending the login link stays a
separate, explicit operator action.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from stewart.core.models import TenantOnboarding, TenantOnboardingStatus

MIGRATION_ORIGIN = "migration"


def is_migration_onboarding(row: TenantOnboarding) -> bool:
    """True when the row was created already-applied from existing-lease data."""

    review = row.review_data
    return isinstance(review, dict) and review.get("origin") == MIGRATION_ORIGIN


def generate_onboarding_token(session: Session) -> str:
    """Return a token not already used by an onboarding row."""

    while True:
        token = secrets.token_urlsafe(24)
        exists = session.scalar(
            select(TenantOnboarding.id).where(TenantOnboarding.token == token)
        )
        if exists is None:
            return token


def find_active_onboarding(
    session: Session, lease_id: UUID, tenant_id: UUID
) -> TenantOnboarding | None:
    """Return the live (non-cancelled) onboarding for this lease+tenant, if any."""

    return session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.lease_id == lease_id,
            TenantOnboarding.tenant_id == tenant_id,
            TenantOnboarding.status != TenantOnboardingStatus.cancelled,
            TenantOnboarding.deleted_at.is_(None),
        )
    )


def build_migrated_onboarding(
    *,
    entity_id: UUID,
    lease_id: UUID,
    tenant_id: UUID,
    token: str,
    now: datetime,
    user_id: UUID | None,
    due_date: date | None = None,
    expires_at: datetime | None = None,
) -> TenantOnboarding:
    """Construct an applied, migration-marked onboarding row (caller adds it).

    The tenant record is the source of record at migration, so ``submitted_data``
    stays empty and the tenant table is never mutated here.
    """

    return TenantOnboarding(
        entity_id=entity_id,
        lease_id=lease_id,
        tenant_id=tenant_id,
        token=token,
        status=TenantOnboardingStatus.applied,
        due_date=due_date,
        expires_at=expires_at,
        submitted_data={},
        submitted_at=now,
        review_data={
            "origin": MIGRATION_ORIGIN,
            "migrated_by_user_id": str(user_id) if user_id else None,
            "note": (
                "Confirmed from the existing lease at migration; "
                "tenant confirmation not required."
            ),
        },
        delivery_data={},
        reviewed_at=now,
        reviewed_by_user_id=user_id,
        applied_at=now,
        applied_by_user_id=user_id,
    )
