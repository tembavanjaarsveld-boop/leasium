"""Read-only Insights overview routes."""

from collections import Counter
from datetime import date, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AuditAction,
    BillingDraft,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    InvoiceDraft,
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
from apps.api.routers.xero import xero_status
from apps.api.schemas.insights import (
    AutomationActivityRead,
    BillingRiskRead,
    InsightsEntityRead,
    InsightsOverviewRead,
    InsightTargetRead,
    LiveExceptionRead,
    OwnerEntitySnapshotRead,
    PortfolioHealthRead,
)

router = APIRouter(prefix="/insights", tags=["insights"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}

OPEN_OBLIGATION_STATUSES = {
    ObligationStatus.upcoming,
    ObligationStatus.due_soon,
    ObligationStatus.overdue,
    ObligationStatus.disputed,
}
WAITING_INTAKE_STATUSES = {
    DocumentIntakeStatus.uploaded,
    DocumentIntakeStatus.reading,
    DocumentIntakeStatus.ready_for_review,
    DocumentIntakeStatus.needs_attention,
    DocumentIntakeStatus.failed,
}
OWNER_BILLING_STRUCTURES = {"property_owner", "trust", "split"}


def _status_label(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw).replace("_", " ")


def _days_until(value: date | None, as_of: date) -> int:
    if value is None:
        return 9999
    return (value - as_of).days


def _date_chip(value: date | None, as_of: date) -> str:
    days = _days_until(value, as_of)
    if days == 9999:
        return "No date"
    if days < 0:
        return f"{abs(days)}d overdue"
    if days == 0:
        return "Today"
    if days == 1:
        return "Tomorrow"
    if days <= 30:
        return f"In {days}d"
    return value.isoformat()


def _active_lease_filter(as_of: date) -> list[object]:
    return [
        Lease.deleted_at.is_(None),
        or_(Lease.commencement_date.is_(None), Lease.commencement_date <= as_of),
        or_(Lease.expiry_date.is_(None), Lease.expiry_date >= as_of),
    ]


def _billing_blockers(row: object) -> list[str]:
    return [
        *getattr(row, "invoice_readiness_blockers", []),
        *getattr(row, "xero_readiness_blockers", []),
        *getattr(row, "gst_readiness_blockers", []),
    ]


def _property_needs_owner_profile(prop: Property) -> bool:
    return (prop.ownership_structure or "current_entity") in OWNER_BILLING_STRUCTURES


def _activity_label(action: AuditAction) -> tuple[str, str]:
    table = (action.target_table or "record").replace("_", " ")
    verb = action.action.replace("_", " ")
    if action.tool_name:
        return action.tool_name.replace("_", " "), f"{verb.title()} {table}"
    return table, f"{verb.title()} {table}"


@router.get("/overview", response_model=InsightsOverviewRead)
def insights_overview(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    as_of: date | None = None,
) -> InsightsOverviewRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    as_of = as_of or date.today()
    due_soon_until = as_of + timedelta(days=30)

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
                .where(Property.entity_id == entity_id, *_active_lease_filter(as_of))
            )
        )
        if property_ids
        else []
    )
    occupied_unit_ids = {lease.tenancy_unit_id for lease in active_leases}

    obligations = list(
        session.scalars(
            select(Obligation)
            .where(Obligation.entity_id == entity_id, Obligation.deleted_at.is_(None))
            .order_by(Obligation.due_date, Obligation.priority, Obligation.created_at)
        )
    )
    open_obligations = [item for item in obligations if item.status in OPEN_OBLIGATION_STATUSES]
    overdue_obligations = [item for item in open_obligations if item.due_date < as_of]
    due_soon_obligations = [
        item for item in open_obligations if as_of <= item.due_date <= due_soon_until
    ]

    onboardings = list(
        session.scalars(
            select(TenantOnboarding)
            .where(
                TenantOnboarding.entity_id == entity_id,
                TenantOnboarding.deleted_at.is_(None),
            )
            .order_by(TenantOnboarding.due_date, TenantOnboarding.created_at.desc())
        )
    )
    waiting_onboardings = [
        item
        for item in onboardings
        if item.status in {TenantOnboardingStatus.sent, TenantOnboardingStatus.submitted}
    ]

    intakes = list(
        session.scalars(
            select(DocumentIntake)
            .where(DocumentIntake.entity_id == entity_id, DocumentIntake.deleted_at.is_(None))
            .order_by(DocumentIntake.updated_at.desc())
        )
    )
    waiting_intakes = [item for item in intakes if item.status in WAITING_INTAKE_STATUSES]

    rent_rows = rent_roll(user, session, entity_id, None, as_of)
    ready_rows = [
        row for row in rent_rows if row.lease_id is not None and not _billing_blockers(row)
    ]
    blocked_rows = [row for row in rent_rows if _billing_blockers(row)]
    blocker_count = sum(len(_billing_blockers(row)) for row in blocked_rows)
    configured_charges_cents = sum(
        row.charge_rules_total_cents or row.annual_rent_cents or 0 for row in rent_rows
    )

    billing_drafts = list(
        session.scalars(
            select(BillingDraft).where(
                BillingDraft.entity_id == entity_id,
                BillingDraft.deleted_at.is_(None),
            )
        )
    )
    invoice_drafts = list(
        session.scalars(
            select(InvoiceDraft).where(
                InvoiceDraft.entity_id == entity_id,
                InvoiceDraft.deleted_at.is_(None),
            )
        )
    )
    xero = xero_status(user, session, entity_id)
    xero_blocker_count = sum(1 for issue in xero.issues if issue.severity == "blocker")

    live_exceptions: list[LiveExceptionRead] = []
    for obligation in open_obligations:
        days = _days_until(obligation.due_date, as_of)
        if days > 30:
            continue
        live_exceptions.append(
            LiveExceptionRead(
                id=f"obligation-{obligation.id}",
                kind="obligation",
                severity="danger" if days < 0 else "warning",
                title=obligation.title,
                detail=(
                    f"{_status_label(obligation.category).title()} obligation due "
                    f"{obligation.due_date.isoformat()}."
                ),
                chip=_date_chip(obligation.due_date, as_of),
                due_date=obligation.due_date,
                source="Tasks",
                href="/tasks",
                target=InsightTargetRead(
                    property_id=obligation.property_id,
                    tenancy_unit_id=obligation.tenancy_unit_id,
                    lease_id=obligation.lease_id,
                    obligation_id=obligation.id,
                ),
                rank=days,
            )
        )
    for onboarding in waiting_onboardings:
        submitted = onboarding.status == TenantOnboardingStatus.submitted
        days = _days_until(onboarding.due_date, as_of)
        live_exceptions.append(
            LiveExceptionRead(
                id=f"tenant-onboarding-{onboarding.id}",
                kind="tenant_onboarding",
                severity="primary" if submitted else "danger" if days < 0 else "warning",
                title=(
                    "Tenant onboarding ready for review"
                    if submitted
                    else "Tenant onboarding waiting"
                ),
                detail=(
                    "Review submitted tenant details and documents before applying."
                    if submitted
                    else f"Follow up the tenant link due {onboarding.due_date or 'soon'}."
                ),
                chip="Needs review" if submitted else _date_chip(onboarding.due_date, as_of),
                due_date=onboarding.due_date,
                source="Tenants",
                href="/tenants",
                target=InsightTargetRead(
                    lease_id=onboarding.lease_id,
                    tenant_id=onboarding.tenant_id,
                ),
                rank=-2 if submitted else days,
            )
        )
    for intake in waiting_intakes:
        severity = "danger" if intake.status == DocumentIntakeStatus.failed else (
            "warning" if intake.status == DocumentIntakeStatus.needs_attention else "primary"
        )
        live_exceptions.append(
            LiveExceptionRead(
                id=f"smart-intake-{intake.id}",
                kind="smart_intake",
                severity=severity,
                title=intake.document.filename,
                detail=intake.summary or "Smart Intake document is waiting for review.",
                chip=_status_label(intake.status).title(),
                source="Smart Intake",
                href=f"/intake?review={intake.id}",
                target=InsightTargetRead(document_intake_id=intake.id),
                rank=-1 if intake.status == DocumentIntakeStatus.ready_for_review else 20,
            )
        )
    for row in blocked_rows:
        row_blockers = _billing_blockers(row)
        live_exceptions.append(
            LiveExceptionRead(
                id=f"billing-{row.tenancy_unit_id}",
                kind="billing_readiness",
                severity="danger",
                title=row.tenant_name or row.unit_label,
                detail=" ".join(row_blockers[:2]),
                chip=f"{len(row_blockers)} blocker{'s' if len(row_blockers) != 1 else ''}",
                source="Billing Readiness",
                href="/billing-readiness",
                target=InsightTargetRead(
                    property_id=row.property_id,
                    tenancy_unit_id=row.tenancy_unit_id,
                    lease_id=row.lease_id,
                    tenant_id=row.tenant_id,
                ),
                rank=0,
            )
        )
    for issue in xero.issues[:6]:
        if issue.severity not in {"blocker", "warning"}:
            continue
        live_exceptions.append(
            LiveExceptionRead(
                id=f"xero-{issue.id}",
                kind="xero_readiness",
                severity="danger" if issue.severity == "blocker" else "warning",
                title=issue.label,
                detail=issue.detail,
                chip="Blocker" if issue.severity == "blocker" else "Warning",
                source="Xero Readiness",
                href="/settings",
                target=InsightTargetRead(
                    property_id=issue.property_id,
                    tenancy_unit_id=issue.tenancy_unit_id,
                    lease_id=issue.lease_id,
                    tenant_id=issue.tenant_id,
                ),
                rank=1 if issue.severity == "blocker" else 12,
            )
        )
    live_exceptions.sort(key=lambda item: (item.rank, item.kind, item.title))

    audit_rows = list(
        session.scalars(
            select(AuditAction)
            .where(AuditAction.entity_id == entity_id)
            .order_by(AuditAction.occurred_at.desc())
            .limit(10)
        )
    )
    automation_activity = []
    for action in audit_rows:
        kind, label = _activity_label(action)
        automation_activity.append(
            AutomationActivityRead(
                id=action.id,
                occurred_at=action.occurred_at,
                kind=kind,
                label=label,
                detail=action.tool_output_summary,
                source=action.tool_name or "audit_log",
                target_table=action.target_table,
                target_id=action.target_id,
                outcome=action.outcome.value,
            )
        )

    owned_properties = [prop for prop in properties if _property_needs_owner_profile(prop)]
    ownership_counter = Counter(prop.ownership_structure or "current_entity" for prop in properties)
    invoice_draft_status_counts = Counter(draft.status.value for draft in invoice_drafts)
    billing_draft_status_counts = Counter(draft.status.value for draft in billing_drafts)

    return InsightsOverviewRead(
        entity=InsightsEntityRead(
            id=entity.id,
            name=entity.name,
            gst_registered=entity.gst_registered,
            xero_connected=bool(entity.xero_tenant_id),
            xero_last_sync_at=entity.xero_last_sync_at,
        ),
        as_of=as_of,
        portfolio_health=PortfolioHealthRead(
            property_count=len(properties),
            tenant_count=len(tenants),
            unit_count=len(units),
            active_lease_count=len(active_leases),
            vacant_unit_count=max(len(units) - len(occupied_unit_ids), 0),
            overdue_obligation_count=len(overdue_obligations),
            due_soon_obligation_count=len(due_soon_obligations),
            open_obligation_count=len(open_obligations),
            smart_intake_waiting_count=len(waiting_intakes),
            tenant_onboarding_waiting_count=len(waiting_onboardings),
        ),
        live_exceptions=live_exceptions[:12],
        automation_activity=automation_activity,
        billing_risk=BillingRiskRead(
            ready_to_bill_count=len(ready_rows),
            blocked_row_count=len(blocked_rows),
            blocker_count=blocker_count,
            configured_charges_cents=configured_charges_cents,
            billing_draft_counts=dict(billing_draft_status_counts),
            invoice_draft_counts=dict(invoice_draft_status_counts),
            xero_issue_count=len(xero.issues),
            xero_blocker_count=xero_blocker_count,
            approved_unsynced_invoice_count=xero.invoice_sync.approved_unsynced,
            unpaid_invoice_count=xero.payment_reconciliation.unpaid,
        ),
        owner_entity_snapshot=OwnerEntitySnapshotRead(
            ownership_profile_counts=dict(ownership_counter),
            missing_invoice_issuer_count=sum(
                1
                for prop in owned_properties
                if not (prop.invoice_issuer_name or prop.owner_legal_name)
            ),
            missing_owner_abn_count=sum(1 for prop in owned_properties if not prop.owner_abn),
            missing_trustee_count=sum(
                1
                for prop in properties
                if (prop.ownership_structure or "current_entity") == "trust"
                and not prop.trustee_name
            ),
            missing_ownership_split_count=sum(
                1
                for prop in properties
                if (prop.ownership_structure or "current_entity") == "split"
                and not prop.ownership_split
            ),
            missing_xero_contact_count=sum(
                1 for prop in owned_properties if not prop.xero_contact_id
            ),
            entity_gst_registered=entity.gst_registered,
            xero_connected=bool(entity.xero_tenant_id),
            xero_last_sync_at=entity.xero_last_sync_at,
        ),
        guardrails=[
            "Insights is read-only and does not mutate portfolio records.",
            (
                "Billing and Xero risk counts come from readiness checks; "
                "no invoice posting or sync runs here."
            ),
            "Automation activity is summarized from audit logs without exposing tool inputs.",
        ],
    )
