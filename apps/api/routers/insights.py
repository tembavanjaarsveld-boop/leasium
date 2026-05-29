"""Insights overview and shareable snapshot routes."""

import hashlib
import secrets
from collections import Counter
from datetime import date, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditAction,
    BillingDraft,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    InsightsSnapshot,
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
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.charge_rules import rent_roll
from apps.api.routers.xero import xero_status
from apps.api.schemas.insights import (
    AccountingReadinessSnapshotRead,
    AutomationActivityRead,
    BillingRiskRead,
    FinanceSnapshotRead,
    InsightsEntityRead,
    InsightsOverviewRead,
    InsightsSnapshotCreate,
    InsightsSnapshotCreateRead,
    InsightsSnapshotPublicRead,
    InsightsSnapshotRead,
    InsightTargetRead,
    LeaseEventRead,
    LeaseEventSnapshotRead,
    LiveExceptionRead,
    OwnerEntitySnapshotRead,
    PortfolioHealthRead,
)

router = APIRouter(prefix="/insights", tags=["insights"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

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


def _snapshot_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _snapshot_share_url(token: str, settings: Settings) -> str:
    return f"{settings.frontend_url.rstrip('/')}/snapshots/{token}"


def _is_expired(value: object, now: object) -> bool:
    if value is None:
        return False
    expires_at = value
    compare_now = now
    if (
        getattr(expires_at, "tzinfo", None) is None
        and getattr(compare_now, "tzinfo", None) is not None
    ):
        compare_now = compare_now.replace(tzinfo=None)
    return expires_at <= compare_now


def _snapshot_payload(snapshot: InsightsSnapshot) -> InsightsOverviewRead:
    return InsightsOverviewRead.model_validate(snapshot.payload)


def _snapshot_read(
    snapshot: InsightsSnapshot,
    *,
    token: str | None = None,
    settings: Settings | None = None,
) -> InsightsSnapshotRead | InsightsSnapshotCreateRead:
    share_url = _snapshot_share_url(token, settings) if token and settings else None
    data = {
        "id": snapshot.id,
        "entity_id": snapshot.entity_id,
        "snapshot_type": snapshot.snapshot_type,
        "as_of": snapshot.as_of,
        "created_at": snapshot.created_at,
        "expires_at": snapshot.expires_at,
        "revoked_at": snapshot.revoked_at,
        "payload": _snapshot_payload(snapshot),
        "share_url": share_url,
    }
    if token and share_url:
        return InsightsSnapshotCreateRead(**data, token=token)
    return InsightsSnapshotRead(**data)


def _lease_event_title(
    lease: Lease,
    units_by_id: dict[UUID, TenancyUnit],
    properties_by_id: dict[UUID, Property],
    tenants_by_id: dict[UUID, Tenant],
    suffix: str,
) -> str:
    tenant = tenants_by_id.get(lease.tenant_id)
    unit = units_by_id.get(lease.tenancy_unit_id)
    prop = properties_by_id.get(unit.property_id) if unit else None
    label = tenant.legal_name if tenant else "Lease"
    context = f" - {prop.name}, {unit.unit_label}" if prop and unit else ""
    return f"{label} {suffix}{context}"


def _build_insights_overview(
    user: CurrentUser,
    session: Session,
    entity_id: UUID,
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
    properties_by_id = {prop.id: prop for prop in properties}
    units_by_id = {unit.id: unit for unit in units}
    tenants_by_id = {tenant.id: tenant for tenant in tenants}

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
    xero = xero_status(user, session, get_settings(), entity_id)
    xero_blocker_count = sum(1 for issue in xero.issues if issue.severity == "blocker")
    accounting_readiness = AccountingReadinessSnapshotRead(
        generated_at=xero.accounting_freshness.generated_at,
        source=xero.accounting_freshness.source,
        status=xero.accounting_freshness.status,
        summary=xero.accounting_freshness.summary,
        stale_after_days=xero.accounting_freshness.stale_after_days,
        contact_ready=xero.contact_mapping.ready,
        contact_missing=xero.contact_mapping.missing,
        chart_ready=xero.chart_mapping.ready,
        chart_missing=xero.chart_mapping.missing,
        tax_ready=xero.tax_mapping.ready,
        tax_missing=xero.tax_mapping.missing,
        readiness_issue_count=xero.accounting_freshness.readiness_issue_count,
        readiness_blocker_count=xero.accounting_freshness.readiness_blocker_count,
        readiness_warning_count=xero.accounting_freshness.readiness_warning_count,
        approved_unsynced_invoice_count=xero.invoice_sync.approved_unsynced,
        unpaid_invoice_count=xero.payment_reconciliation.unpaid,
        stale_reconciliation=xero.accounting_freshness.stale_reconciliation,
        xero_linked_open_invoice_count=(
            xero.accounting_freshness.xero_linked_open_invoice_count
        ),
        last_contact_sync_at=xero.accounting_freshness.last_contact_sync_at,
        last_chart_tax_validation_at=(
            xero.accounting_freshness.last_chart_tax_validation_at
        ),
        last_invoice_posting_preview_at=(
            xero.accounting_freshness.last_invoice_posting_preview_at
        ),
        last_invoice_draft_create_at=xero.accounting_freshness.last_invoice_draft_create_at,
        last_invoice_provider_dispatch_at=(
            xero.accounting_freshness.last_invoice_provider_dispatch_at
        ),
        last_payment_reconciliation_preview_at=(
            xero.accounting_freshness.last_payment_reconciliation_preview_at
        ),
        last_payment_reconciliation_apply_at=(
            xero.accounting_freshness.last_payment_reconciliation_apply_at
        ),
        last_payment_reconciliation_at=(
            xero.accounting_freshness.last_payment_reconciliation_at
        ),
        last_payment_reconciliation_source=(
            xero.accounting_freshness.last_payment_reconciliation_source
        ),
        last_payment_reconciliation_mode=(
            xero.accounting_freshness.last_payment_reconciliation_mode
        ),
        guardrails=xero.accounting_freshness.guardrails,
    )

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
                href=f"/intake?entity_id={entity_id}&review={intake.id}",
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

    lease_event_until = as_of + timedelta(days=120)
    lease_events: list[LeaseEventRead] = []
    next_review_count = 0
    next_expiry_count = 0
    for lease in active_leases:
        if lease.next_review_date and as_of <= lease.next_review_date <= lease_event_until:
            next_review_count += 1
            lease_events.append(
                LeaseEventRead(
                    id=f"rent-review-{lease.id}",
                    kind="rent_review",
                    title=_lease_event_title(
                        lease,
                        units_by_id,
                        properties_by_id,
                        tenants_by_id,
                        "rent review",
                    ),
                    date=lease.next_review_date,
                    chip=_date_chip(lease.next_review_date, as_of),
                    href="/properties",
                    target=InsightTargetRead(
                        property_id=units_by_id.get(lease.tenancy_unit_id).property_id
                        if units_by_id.get(lease.tenancy_unit_id)
                        else None,
                        tenancy_unit_id=lease.tenancy_unit_id,
                        lease_id=lease.id,
                        tenant_id=lease.tenant_id,
                    ),
                    rank=_days_until(lease.next_review_date, as_of),
                )
            )
        if lease.expiry_date and as_of <= lease.expiry_date <= lease_event_until:
            next_expiry_count += 1
            lease_events.append(
                LeaseEventRead(
                    id=f"lease-expiry-{lease.id}",
                    kind="lease_expiry",
                    title=_lease_event_title(
                        lease,
                        units_by_id,
                        properties_by_id,
                        tenants_by_id,
                        "lease expiry",
                    ),
                    date=lease.expiry_date,
                    chip=_date_chip(lease.expiry_date, as_of),
                    href="/properties",
                    target=InsightTargetRead(
                        property_id=units_by_id.get(lease.tenancy_unit_id).property_id
                        if units_by_id.get(lease.tenancy_unit_id)
                        else None,
                        tenancy_unit_id=lease.tenancy_unit_id,
                        lease_id=lease.id,
                        tenant_id=lease.tenant_id,
                    ),
                    rank=_days_until(lease.expiry_date, as_of),
                )
            )
    for obligation in [item for item in open_obligations if item.due_date <= due_soon_until]:
        lease_events.append(
            LeaseEventRead(
                id=f"obligation-{obligation.id}",
                kind="obligation",
                title=obligation.title,
                date=obligation.due_date,
                chip=_date_chip(obligation.due_date, as_of),
                href="/tasks",
                target=InsightTargetRead(
                    property_id=obligation.property_id,
                    tenancy_unit_id=obligation.tenancy_unit_id,
                    lease_id=obligation.lease_id,
                    obligation_id=obligation.id,
                ),
                rank=_days_until(obligation.due_date, as_of),
            )
        )
    for onboarding in waiting_onboardings:
        tenant = tenants_by_id.get(onboarding.tenant_id)
        lease_events.append(
            LeaseEventRead(
                id=f"tenant-onboarding-{onboarding.id}",
                kind="tenant_onboarding",
                title=f"Tenant onboarding - {tenant.legal_name if tenant else 'Tenant'}",
                date=onboarding.due_date,
                chip=(
                    "Needs review"
                    if onboarding.status == TenantOnboardingStatus.submitted
                    else _date_chip(onboarding.due_date, as_of)
                ),
                href="/tenants",
                target=InsightTargetRead(
                    lease_id=onboarding.lease_id,
                    tenant_id=onboarding.tenant_id,
                ),
                rank=-2
                if onboarding.status == TenantOnboardingStatus.submitted
                else _days_until(onboarding.due_date, as_of),
            )
        )
    lease_events.sort(key=lambda item: (item.rank, item.kind, item.title))

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
        finance_snapshot=FinanceSnapshotRead(
            configured_charges_cents=configured_charges_cents,
            ready_to_bill_count=len(ready_rows),
            blocked_row_count=len(blocked_rows),
            approved_unsynced_invoice_count=xero.invoice_sync.approved_unsynced,
            unpaid_invoice_count=xero.payment_reconciliation.unpaid,
            billing_draft_counts=dict(billing_draft_status_counts),
            invoice_draft_counts=dict(invoice_draft_status_counts),
            accounting_readiness=accounting_readiness,
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
            accounting_readiness=accounting_readiness,
        ),
        lease_event_snapshot=LeaseEventSnapshotRead(
            active_lease_count=len(active_leases),
            next_review_count=next_review_count,
            next_expiry_count=next_expiry_count,
            overdue_obligation_count=len(overdue_obligations),
            due_soon_obligation_count=len(due_soon_obligations),
            tenant_onboarding_waiting_count=len(waiting_onboardings),
            next_events=lease_events[:8],
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

@router.get("/overview", response_model=InsightsOverviewRead)
def insights_overview(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    as_of: date | None = None,
) -> InsightsOverviewRead:
    return _build_insights_overview(user, session, entity_id, as_of)


@router.post(
    "/snapshots",
    response_model=InsightsSnapshotCreateRead,
    status_code=status.HTTP_201_CREATED,
)
def create_insights_snapshot(
    payload: InsightsSnapshotCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InsightsSnapshotCreateRead:
    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    as_of = payload.as_of or date.today()
    overview = _build_insights_overview(user, session, payload.entity_id, as_of)
    token = secrets.token_urlsafe(32)
    snapshot = InsightsSnapshot(
        entity_id=payload.entity_id,
        created_by_user_id=user.id,
        snapshot_type=payload.snapshot_type,
        token_hash=_snapshot_token_hash(token),
        as_of=as_of,
        payload=overview.model_dump(mode="json"),
        expires_at=utcnow() + timedelta(days=payload.expires_in_days),
    )
    session.add(snapshot)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=payload.entity_id,
        action="create_share_link",
        target_table="insights_snapshot",
        target_id=snapshot.id,
        tool_name="insights_snapshot",
        tool_input={
            "snapshot_type": payload.snapshot_type,
            "as_of": as_of.isoformat(),
            "expires_in_days": payload.expires_in_days,
        },
        tool_output_summary=f"Created {payload.snapshot_type} Insights snapshot.",
        data_classification="internal",
    )
    session.commit()
    session.refresh(snapshot)
    return _snapshot_read(snapshot, token=token, settings=settings)


@router.get("/snapshots/public/{token}", response_model=InsightsSnapshotPublicRead)
def get_public_insights_snapshot(
    token: str,
    session: Annotated[Session, Depends(get_session)],
) -> InsightsSnapshotPublicRead:
    snapshot = session.scalar(
        select(InsightsSnapshot).where(
            InsightsSnapshot.token_hash == _snapshot_token_hash(token),
            InsightsSnapshot.deleted_at.is_(None),
        )
    )
    now = utcnow()
    if (
        snapshot is None
        or snapshot.revoked_at is not None
        or _is_expired(snapshot.expires_at, now)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insights snapshot not found.",
        )
    return InsightsSnapshotPublicRead(
        id=snapshot.id,
        snapshot_type=snapshot.snapshot_type,
        as_of=snapshot.as_of,
        created_at=snapshot.created_at,
        expires_at=snapshot.expires_at,
        payload=_snapshot_payload(snapshot),
        guardrails=[
            "This is a frozen snapshot, not a live portfolio connection.",
            "The public link cannot mutate Leasium records.",
        ],
    )


@router.get("/snapshots", response_model=list[InsightsSnapshotRead])
def list_insights_snapshots(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[InsightsSnapshotRead]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    rows = session.scalars(
        select(InsightsSnapshot)
        .where(
            InsightsSnapshot.entity_id == entity_id,
            InsightsSnapshot.deleted_at.is_(None),
        )
        .order_by(InsightsSnapshot.created_at.desc())
        .limit(limit)
    )
    return [_snapshot_read(row) for row in rows]


@router.get("/snapshots/{snapshot_id}", response_model=InsightsSnapshotRead)
def get_insights_snapshot(
    snapshot_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InsightsSnapshotRead:
    snapshot = session.get(InsightsSnapshot, snapshot_id)
    if snapshot is None or snapshot.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insights snapshot not found.",
        )
    assert_entity_role(session, user, snapshot.entity_id, READ_ROLES)
    return _snapshot_read(snapshot)


@router.post("/snapshots/{snapshot_id}/revoke", response_model=InsightsSnapshotRead)
def revoke_insights_snapshot(
    snapshot_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InsightsSnapshotRead:
    snapshot = session.get(InsightsSnapshot, snapshot_id)
    if snapshot is None or snapshot.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insights snapshot not found.",
        )
    assert_entity_role(session, user, snapshot.entity_id, WRITE_ROLES)
    if snapshot.revoked_at is None:
        snapshot.revoked_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=snapshot.entity_id,
        action="revoke_share_link",
        target_table="insights_snapshot",
        target_id=snapshot.id,
        tool_name="insights_snapshot",
        tool_input={"snapshot_type": snapshot.snapshot_type},
        tool_output_summary=f"Revoked {snapshot.snapshot_type} Insights snapshot.",
        data_classification="internal",
    )
    session.commit()
    session.refresh(snapshot)
    return _snapshot_read(snapshot)
