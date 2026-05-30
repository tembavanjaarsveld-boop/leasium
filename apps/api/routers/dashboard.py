"""Dashboard overview routes."""

from collections import Counter
from datetime import date, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from stewart.core.models import (
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    Lease,
    Obligation,
    ObligationStatus,
    Property,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.charge_rules import rent_roll
from apps.api.schemas.dashboard import (
    DashboardCountsRead,
    DashboardEntityRead,
    DashboardIntakeRead,
    DashboardLeaseEventRead,
    DashboardOverviewRead,
    DashboardRentRollRead,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
OPEN_OBLIGATION_STATUSES = {
    ObligationStatus.upcoming,
    ObligationStatus.due_soon,
    ObligationStatus.overdue,
    ObligationStatus.disputed,
}
WAITING_DOCUMENT_STATUSES = {
    DocumentIntakeStatus.uploaded,
    DocumentIntakeStatus.reading,
    DocumentIntakeStatus.ready_for_review,
    DocumentIntakeStatus.needs_attention,
    DocumentIntakeStatus.failed,
}
WAITING_ONBOARDING_STATUSES = {
    TenantOnboardingStatus.sent,
    TenantOnboardingStatus.submitted,
}


def _active_lease_filter(as_of: date) -> list[Any]:
    return [
        Lease.deleted_at.is_(None),
        or_(Lease.commencement_date.is_(None), Lease.commencement_date <= as_of),
        or_(Lease.expiry_date.is_(None), Lease.expiry_date >= as_of),
    ]


def _days_until(value: date | None, as_of: date) -> int:
    if value is None:
        return 9999
    return (value - as_of).days


def _rent_row_blockers(row: object) -> list[str]:
    return [
        *getattr(row, "gst_readiness_blockers", []),
        *getattr(row, "xero_readiness_blockers", []),
        *getattr(row, "invoice_readiness_blockers", []),
    ]


def _lease_event_context(
    lease: Lease,
    units_by_id: dict[UUID, TenancyUnit],
    properties_by_id: dict[UUID, Property],
    tenants_by_id: dict[UUID, Tenant],
) -> tuple[Tenant | None, TenancyUnit | None, Property | None]:
    tenant = tenants_by_id.get(lease.tenant_id)
    unit = units_by_id.get(lease.tenancy_unit_id)
    prop = properties_by_id.get(unit.property_id) if unit is not None else None
    return tenant, unit, prop


@router.get("/overview", response_model=DashboardOverviewRead)
def dashboard_overview(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    as_of: date | None = None,
) -> DashboardOverviewRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    as_of = as_of or date.today()
    due_soon_until = as_of + timedelta(days=30)
    lease_event_until = as_of + timedelta(days=120)

    properties = list(
        session.scalars(
            select(Property)
            .where(Property.entity_id == entity_id, Property.deleted_at.is_(None))
            .order_by(Property.name)
        )
    )
    property_ids = [prop.id for prop in properties]
    tenants = list(
        session.scalars(
            select(Tenant)
            .where(Tenant.entity_id == entity_id, Tenant.deleted_at.is_(None))
            .order_by(Tenant.legal_name)
        )
    )
    units = (
        list(
            session.scalars(
                select(TenancyUnit)
                .where(
                    TenancyUnit.property_id.in_(property_ids),
                    TenancyUnit.deleted_at.is_(None),
                )
                .order_by(TenancyUnit.unit_label)
            )
        )
        if property_ids
        else []
    )
    active_leases = (
        list(
            session.scalars(
                select(Lease)
                .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
                .join(Property, Property.id == TenancyUnit.property_id)
                .where(
                    Property.entity_id == entity_id,
                    Property.deleted_at.is_(None),
                    TenancyUnit.deleted_at.is_(None),
                    *_active_lease_filter(as_of),
                )
                .order_by(Lease.expiry_date, Lease.created_at)
            )
        )
        if property_ids
        else []
    )

    obligations = list(
        session.scalars(
            select(Obligation)
            .where(Obligation.entity_id == entity_id, Obligation.deleted_at.is_(None))
            .order_by(Obligation.due_date, Obligation.priority, Obligation.created_at)
        )
    )
    open_obligations = [
        obligation for obligation in obligations if obligation.status in OPEN_OBLIGATION_STATUSES
    ]
    overdue_obligation_count = sum(1 for item in open_obligations if item.due_date < as_of)
    due_soon_obligation_count = sum(
        1 for item in open_obligations if as_of <= item.due_date <= due_soon_until
    )

    document_intakes = list(
        session.scalars(
            select(DocumentIntake).where(
                DocumentIntake.entity_id == entity_id,
                DocumentIntake.deleted_at.is_(None),
            )
        )
    )
    onboardings = list(
        session.scalars(
            select(TenantOnboarding)
            .where(
                TenantOnboarding.entity_id == entity_id,
                TenantOnboarding.deleted_at.is_(None),
            )
            .order_by(TenantOnboarding.due_date, TenantOnboarding.created_at)
        )
    )

    rent_rows = rent_roll(user, session, entity_id, None, as_of)
    ready_to_bill_count = sum(
        1 for row in rent_rows if row.lease_id is not None and not _rent_row_blockers(row)
    )
    blocked_row_count = sum(1 for row in rent_rows if _rent_row_blockers(row))
    occupied_unit_ids = {row.tenancy_unit_id for row in rent_rows if row.lease_id is not None}

    properties_by_id = {prop.id: prop for prop in properties}
    units_by_id = {unit.id: unit for unit in units}
    tenants_by_id = {tenant.id: tenant for tenant in tenants}
    lease_events: list[tuple[int, str, DashboardLeaseEventRead]] = []

    for onboarding in onboardings:
        if onboarding.status not in WAITING_ONBOARDING_STATUSES:
            continue
        tenant = tenants_by_id.get(onboarding.tenant_id)
        lease_events.append(
            (
                -2
                if onboarding.status == TenantOnboardingStatus.submitted
                else _days_until(onboarding.due_date, as_of),
                "tenant_onboarding",
                DashboardLeaseEventRead(
                    id=f"tenant-onboarding-{onboarding.id}",
                    kind="tenant_onboarding",
                    date=onboarding.due_date,
                    lease_id=onboarding.lease_id,
                    tenant_id=onboarding.tenant_id,
                    tenant_name=tenant.legal_name if tenant is not None else None,
                    title=(
                        "Tenant onboarding ready for review"
                        if onboarding.status == TenantOnboardingStatus.submitted
                        else "Tenant onboarding waiting"
                    ),
                ),
            )
        )

    for obligation in open_obligations:
        if obligation.due_date > due_soon_until:
            continue
        lease_events.append(
            (
                _days_until(obligation.due_date, as_of),
                "obligation",
                DashboardLeaseEventRead(
                    id=f"obligation-{obligation.id}",
                    kind="obligation",
                    date=obligation.due_date,
                    lease_id=obligation.lease_id,
                    property_id=obligation.property_id,
                    tenancy_unit_id=obligation.tenancy_unit_id,
                    title=obligation.title,
                ),
            )
        )

    for lease in active_leases:
        tenant, unit, prop = _lease_event_context(
            lease, units_by_id, properties_by_id, tenants_by_id
        )
        if lease.next_review_date and as_of <= lease.next_review_date <= lease_event_until:
            lease_events.append(
                (
                    _days_until(lease.next_review_date, as_of),
                    "rent_review",
                    DashboardLeaseEventRead(
                        id=f"rent-review-{lease.id}",
                        kind="rent_review",
                        date=lease.next_review_date,
                        lease_id=lease.id,
                        tenant_id=lease.tenant_id,
                        tenant_name=tenant.legal_name if tenant is not None else None,
                        property_id=prop.id if prop is not None else None,
                        property_name=prop.name if prop is not None else None,
                        tenancy_unit_id=lease.tenancy_unit_id,
                        unit_label=unit.unit_label if unit is not None else None,
                        title="Rent review",
                    ),
                )
            )
        if lease.expiry_date and as_of <= lease.expiry_date <= lease_event_until:
            lease_events.append(
                (
                    _days_until(lease.expiry_date, as_of),
                    "lease_expiry",
                    DashboardLeaseEventRead(
                        id=f"lease-expiry-{lease.id}",
                        kind="lease_expiry",
                        date=lease.expiry_date,
                        lease_id=lease.id,
                        tenant_id=lease.tenant_id,
                        tenant_name=tenant.legal_name if tenant is not None else None,
                        property_id=prop.id if prop is not None else None,
                        property_name=prop.name if prop is not None else None,
                        tenancy_unit_id=lease.tenancy_unit_id,
                        unit_label=unit.unit_label if unit is not None else None,
                        title="Lease expiry",
                    ),
                )
            )

    lease_events.sort(key=lambda item: (item[0], item[1], item[2].title))
    document_counts = Counter(intake.status.value for intake in document_intakes)
    onboarding_counts = Counter(onboarding.status.value for onboarding in onboardings)

    return DashboardOverviewRead(
        entity=DashboardEntityRead(id=entity.id, name=entity.name),
        as_of=as_of,
        counts=DashboardCountsRead(
            property_count=len(properties),
            tenant_count=len(tenants),
            open_obligation_count=len(open_obligations),
            overdue_obligation_count=overdue_obligation_count,
            due_soon_obligation_count=due_soon_obligation_count,
        ),
        rent_roll=DashboardRentRollRead(
            unit_count=len(units),
            occupied_unit_count=len(occupied_unit_ids),
            vacant_unit_count=max(len(units) - len(occupied_unit_ids), 0),
            active_lease_count=len(active_leases),
            annual_rent_cents=sum(row.annual_rent_cents or 0 for row in rent_rows),
            charge_rules_total_cents=sum(row.charge_rules_total_cents for row in rent_rows),
            ready_to_bill_count=ready_to_bill_count,
            blocked_row_count=blocked_row_count,
        ),
        intake=DashboardIntakeRead(
            document_counts=dict(document_counts),
            document_waiting_count=sum(
                1 for intake in document_intakes if intake.status in WAITING_DOCUMENT_STATUSES
            ),
            onboarding_counts=dict(onboarding_counts),
            onboarding_waiting_count=sum(
                1 for onboarding in onboardings if onboarding.status in WAITING_ONBOARDING_STATUSES
            ),
        ),
        upcoming_lease_events=[item[2] for item in lease_events[:8]],
    )
