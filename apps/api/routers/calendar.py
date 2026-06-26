"""Read-only unified operations calendar routes."""

from datetime import date, timedelta
from typing import Annotated
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    BillingDraft,
    BillingDraftStatus,
    ComplianceCheck,
    ComplianceCheckStatus,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationStatus,
    Property,
    RentChargeRule,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    UserRole,
)

from apps.api.deps import (
    CurrentUser,
    assert_entity_role,
    get_current_user,
    get_session,
    readable_entity_ids,
)
from apps.api.schemas.calendar import (
    CalendarEventRead,
    CalendarEventSourceRead,
    CalendarEventType,
)

router = APIRouter(prefix="/calendar", tags=["calendar"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
OPEN_OBLIGATION_STATUSES = {
    ObligationStatus.upcoming,
    ObligationStatus.due_soon,
    ObligationStatus.overdue,
    ObligationStatus.disputed,
}
OPEN_MAINTENANCE_STATUSES = {
    MaintenanceWorkOrderStatus.requested,
    MaintenanceWorkOrderStatus.triaged,
    MaintenanceWorkOrderStatus.assigned,
    MaintenanceWorkOrderStatus.awaiting_approval,
    MaintenanceWorkOrderStatus.approved,
    MaintenanceWorkOrderStatus.in_progress,
}
OPEN_ARREARS_STATUSES = {
    ArrearsCaseStatus.monitoring,
    ArrearsCaseStatus.active,
}
WAITING_ONBOARDING_STATUSES = {
    TenantOnboardingStatus.sent,
    TenantOnboardingStatus.submitted,
}


def _entity_ids(
    *,
    session: Session,
    user: CurrentUser,
    entity_id: UUID | None,
) -> list[UUID]:
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        return [entity_id]
    return readable_entity_ids(session, user, READ_ROLES)


def _in_window(value: date | None, from_date: date, to_date: date) -> bool:
    return value is not None and from_date <= value <= to_date


def _severity_for_date(value: date, as_of: date):
    if value < as_of:
        return "danger"
    if value <= as_of + timedelta(days=30):
        return "warning"
    return "neutral"


def _enum_label(value: object) -> str:
    return str(getattr(value, "value", value)).replace("_", " ")


def _property_link(entity_id: UUID, property_id: UUID | None) -> str:
    params: dict[str, str] = {"entity_id": str(entity_id)}
    if property_id is not None:
        params["property_id"] = str(property_id)
    return f"/properties?{urlencode(params)}"


def _event(
    *,
    event_type: CalendarEventType,
    record_id: UUID,
    source_table: str,
    title: str,
    event_date: date,
    entity_id: UUID,
    link: str,
    as_of: date,
    property_id: UUID | None = None,
    tenancy_unit_id: UUID | None = None,
    tenant_id: UUID | None = None,
    lease_id: UUID | None = None,
    chip: str | None = None,
    description: str | None = None,
    severity: str | None = None,
) -> CalendarEventRead:
    return CalendarEventRead(
        id=f"{event_type}-{record_id}",
        type=event_type,
        title=title,
        date=event_date,
        severity=severity or _severity_for_date(event_date, as_of),
        entity_id=entity_id,
        property_id=property_id,
        tenancy_unit_id=tenancy_unit_id,
        tenant_id=tenant_id,
        lease_id=lease_id,
        source=CalendarEventSourceRead(table=source_table, id=record_id),
        link=link,
        chip=chip,
        description=description,
    )


@router.get("/events", response_model=list[CalendarEventRead])
def list_calendar_events(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    from_date: Annotated[date, Query(alias="from")],
    to_date: Annotated[date, Query(alias="to")],
    entity_id: Annotated[UUID | None, Query()] = None,
) -> list[CalendarEventRead]:
    if to_date < from_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Calendar end date must be on or after start date.",
        )

    scoped_entity_ids = _entity_ids(session=session, user=user, entity_id=entity_id)
    if not scoped_entity_ids:
        return []

    as_of = date.today()
    events: list[CalendarEventRead] = []

    lease_rows = session.execute(
        select(Lease, TenancyUnit, Property, Tenant)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
        .join(Tenant, Tenant.id == Lease.tenant_id)
        .where(
            Property.entity_id.in_(scoped_entity_ids),
            Property.deleted_at.is_(None),
            TenancyUnit.deleted_at.is_(None),
            Tenant.deleted_at.is_(None),
            Lease.deleted_at.is_(None),
        )
    ).all()
    for lease, unit, prop, tenant in lease_rows:
        link = _property_link(prop.entity_id, prop.id)
        if _in_window(lease.next_review_date, from_date, to_date):
            events.append(
                _event(
                    event_type="rent_review",
                    record_id=lease.id,
                    source_table="lease",
                    title=f"{prop.name} {unit.unit_label} rent review",
                    event_date=lease.next_review_date,
                    entity_id=prop.entity_id,
                    property_id=prop.id,
                    tenancy_unit_id=unit.id,
                    tenant_id=tenant.id,
                    lease_id=lease.id,
                    link=link,
                    chip=tenant.legal_name,
                    as_of=as_of,
                )
            )
        if _in_window(lease.expiry_date, from_date, to_date):
            events.append(
                _event(
                    event_type="lease_expiry",
                    record_id=lease.id,
                    source_table="lease",
                    title=f"{prop.name} {unit.unit_label} lease expiry",
                    event_date=lease.expiry_date,
                    entity_id=prop.entity_id,
                    property_id=prop.id,
                    tenancy_unit_id=unit.id,
                    tenant_id=tenant.id,
                    lease_id=lease.id,
                    link=link,
                    chip=tenant.legal_name,
                    as_of=as_of,
                )
            )

    for work_order in session.scalars(
        select(MaintenanceWorkOrder)
        .where(
            MaintenanceWorkOrder.entity_id.in_(scoped_entity_ids),
            MaintenanceWorkOrder.deleted_at.is_(None),
            MaintenanceWorkOrder.status.in_(OPEN_MAINTENANCE_STATUSES),
            MaintenanceWorkOrder.due_date.is_not(None),
            MaintenanceWorkOrder.due_date >= from_date,
            MaintenanceWorkOrder.due_date <= to_date,
        )
        .order_by(MaintenanceWorkOrder.due_date, MaintenanceWorkOrder.created_at)
    ):
        severity = None
        if work_order.priority in {MaintenancePriority.high, MaintenancePriority.urgent}:
            severity = (
                "danger"
                if work_order.priority == MaintenancePriority.urgent
                else "warning"
            )
        events.append(
            _event(
                event_type="maintenance_due",
                record_id=work_order.id,
                source_table="maintenance_work_order",
                title=work_order.title,
                event_date=work_order.due_date,
                entity_id=work_order.entity_id,
                property_id=work_order.property_id,
                tenancy_unit_id=work_order.tenancy_unit_id,
                tenant_id=work_order.tenant_id,
                lease_id=work_order.lease_id,
                link=f"/operations/maintenance/{work_order.id}",
                chip=_enum_label(work_order.status),
                as_of=as_of,
                severity=severity,
            )
        )

    for check in session.scalars(
        select(ComplianceCheck)
        .where(
            ComplianceCheck.entity_id.in_(scoped_entity_ids),
            ComplianceCheck.deleted_at.is_(None),
            ComplianceCheck.status != ComplianceCheckStatus.archived,
            ComplianceCheck.next_due_date >= from_date,
            ComplianceCheck.next_due_date <= to_date,
        )
        .order_by(ComplianceCheck.next_due_date, ComplianceCheck.created_at)
    ):
        events.append(
            _event(
                event_type="compliance_due",
                record_id=check.id,
                source_table="compliance_check",
                title=check.title,
                event_date=check.next_due_date,
                entity_id=check.entity_id,
                property_id=check.property_id,
                tenancy_unit_id=check.tenancy_unit_id,
                tenant_id=check.tenant_id,
                lease_id=check.lease_id,
                link=f"/operations?tab=compliance#compliance-check-{check.id}",
                chip=_enum_label(check.kind),
                as_of=as_of,
            )
        )

    for obligation in session.scalars(
        select(Obligation)
        .where(
            Obligation.entity_id.in_(scoped_entity_ids),
            Obligation.deleted_at.is_(None),
            Obligation.status.in_(OPEN_OBLIGATION_STATUSES),
            Obligation.due_date >= from_date,
            Obligation.due_date <= to_date,
        )
        .order_by(Obligation.due_date, Obligation.priority, Obligation.created_at)
    ):
        anchor = (
            f"#compliance-obligation-{obligation.id}"
            if _enum_label(obligation.category) == "compliance"
            else ""
        )
        events.append(
            _event(
                event_type="obligation",
                record_id=obligation.id,
                source_table="obligation",
                title=obligation.title,
                event_date=obligation.due_date,
                entity_id=obligation.entity_id,
                property_id=obligation.property_id,
                tenancy_unit_id=obligation.tenancy_unit_id,
                lease_id=obligation.lease_id,
                link=f"/operations?tab=compliance{anchor}",
                chip=_enum_label(obligation.category),
                as_of=as_of,
            )
        )

    charge_rows = session.execute(
        select(RentChargeRule, Lease, TenancyUnit, Property, Tenant)
        .join(Lease, Lease.id == RentChargeRule.lease_id)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
        .join(Tenant, Tenant.id == Lease.tenant_id)
        .where(
            Property.entity_id.in_(scoped_entity_ids),
            Property.deleted_at.is_(None),
            TenancyUnit.deleted_at.is_(None),
            Tenant.deleted_at.is_(None),
            Lease.deleted_at.is_(None),
            RentChargeRule.deleted_at.is_(None),
            RentChargeRule.next_due_date.is_not(None),
            RentChargeRule.next_due_date >= from_date,
            RentChargeRule.next_due_date <= to_date,
        )
        .order_by(RentChargeRule.next_due_date, RentChargeRule.created_at)
    ).all()
    for charge_rule, lease, unit, prop, tenant in charge_rows:
        events.append(
            _event(
                event_type="charge_due",
                record_id=charge_rule.id,
                source_table="rent_charge_rule",
                title=f"{prop.name} {unit.unit_label} {_enum_label(charge_rule.charge_type)} due",
                event_date=charge_rule.next_due_date,
                entity_id=prop.entity_id,
                property_id=prop.id,
                tenancy_unit_id=unit.id,
                tenant_id=tenant.id,
                lease_id=lease.id,
                link=_property_link(prop.entity_id, prop.id),
                chip=_enum_label(charge_rule.frequency),
                as_of=as_of,
            )
        )

    for draft in session.scalars(
        select(BillingDraft)
        .where(
            BillingDraft.entity_id.in_(scoped_entity_ids),
            BillingDraft.deleted_at.is_(None),
            BillingDraft.status != BillingDraftStatus.void,
            BillingDraft.due_date.is_not(None),
            BillingDraft.due_date >= from_date,
            BillingDraft.due_date <= to_date,
        )
        .order_by(BillingDraft.due_date, BillingDraft.created_at)
    ):
        events.append(
            _event(
                event_type="billing_due",
                record_id=draft.id,
                source_table="billing_draft",
                title=draft.title,
                event_date=draft.due_date,
                entity_id=draft.entity_id,
                property_id=draft.property_id,
                tenancy_unit_id=draft.tenancy_unit_id,
                tenant_id=draft.tenant_id,
                lease_id=draft.lease_id,
                link="/money",
                chip=_enum_label(draft.status),
                as_of=as_of,
            )
        )

    for draft in session.scalars(
        select(InvoiceDraft)
        .where(
            InvoiceDraft.entity_id.in_(scoped_entity_ids),
            InvoiceDraft.deleted_at.is_(None),
            InvoiceDraft.status != InvoiceDraftStatus.void,
            InvoiceDraft.due_date.is_not(None),
            InvoiceDraft.due_date >= from_date,
            InvoiceDraft.due_date <= to_date,
        )
        .order_by(InvoiceDraft.due_date, InvoiceDraft.created_at)
    ):
        events.append(
            _event(
                event_type="invoice_due",
                record_id=draft.id,
                source_table="invoice_draft",
                title=draft.title,
                event_date=draft.due_date,
                entity_id=draft.entity_id,
                property_id=draft.property_id,
                tenancy_unit_id=draft.tenancy_unit_id,
                tenant_id=draft.tenant_id,
                lease_id=draft.lease_id,
                link="/money",
                chip=_enum_label(draft.status),
                as_of=as_of,
            )
        )

    for arrears_case in session.scalars(
        select(ArrearsCase)
        .where(
            ArrearsCase.entity_id.in_(scoped_entity_ids),
            ArrearsCase.deleted_at.is_(None),
            ArrearsCase.status.in_(OPEN_ARREARS_STATUSES),
        )
        .order_by(ArrearsCase.next_reminder_on, ArrearsCase.created_at)
    ):
        if _in_window(arrears_case.next_reminder_on, from_date, to_date):
            events.append(
                _event(
                    event_type="arrears_reminder",
                    record_id=arrears_case.id,
                    source_table="arrears_case",
                    title="Arrears reminder",
                    event_date=arrears_case.next_reminder_on,
                    entity_id=arrears_case.entity_id,
                    property_id=arrears_case.property_id,
                    tenancy_unit_id=arrears_case.tenancy_unit_id,
                    tenant_id=arrears_case.tenant_id,
                    lease_id=arrears_case.lease_id,
                    link="/operations?tab=arrears",
                    chip=_enum_label(arrears_case.status),
                    as_of=as_of,
                )
            )
        if _in_window(arrears_case.promise_to_pay_date, from_date, to_date):
            events.append(
                _event(
                    event_type="promise_to_pay",
                    record_id=arrears_case.id,
                    source_table="arrears_case",
                    title="Promise to pay",
                    event_date=arrears_case.promise_to_pay_date,
                    entity_id=arrears_case.entity_id,
                    property_id=arrears_case.property_id,
                    tenancy_unit_id=arrears_case.tenancy_unit_id,
                    tenant_id=arrears_case.tenant_id,
                    lease_id=arrears_case.lease_id,
                    link="/operations?tab=arrears",
                    chip=arrears_case.currency,
                    as_of=as_of,
                )
            )

    for onboarding in session.scalars(
        select(TenantOnboarding)
        .where(
            TenantOnboarding.entity_id.in_(scoped_entity_ids),
            TenantOnboarding.deleted_at.is_(None),
            TenantOnboarding.status.in_(WAITING_ONBOARDING_STATUSES),
            TenantOnboarding.due_date.is_not(None),
            TenantOnboarding.due_date >= from_date,
            TenantOnboarding.due_date <= to_date,
        )
        .order_by(TenantOnboarding.due_date, TenantOnboarding.created_at)
    ):
        events.append(
            _event(
                event_type="tenant_onboarding",
                record_id=onboarding.id,
                source_table="tenant_onboarding",
                title="Tenant onboarding",
                event_date=onboarding.due_date,
                entity_id=onboarding.entity_id,
                tenant_id=onboarding.tenant_id,
                lease_id=onboarding.lease_id,
                link="/tenants",
                chip=_enum_label(onboarding.status),
                as_of=as_of,
                severity=(
                    "primary"
                    if onboarding.status == TenantOnboardingStatus.submitted
                    else None
                ),
            )
        )

    severity_rank = {
        "danger": 0,
        "warning": 1,
        "primary": 2,
        "neutral": 3,
        "success": 4,
    }
    return sorted(
        events,
        key=lambda event: (
            event.date,
            severity_rank[event.severity],
            event.type,
            event.title,
            str(event.source.id),
        ),
    )
