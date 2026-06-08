"""Insights overview and shareable snapshot routes."""

import hashlib
import secrets
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    ArrearsDisputeStatus,
    ArrearsEscalationStatus,
    AuditAction,
    BillingDraft,
    ComplianceCheck,
    ComplianceCheckStatus,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    InsightsSnapshot,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationCategory,
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
    ArrearsSnapshotItemRead,
    ArrearsSnapshotRead,
    AutomationActivityRead,
    BillingRiskRead,
    ComplianceRiskItemRead,
    ComplianceSnapshotRead,
    FinanceSnapshotRead,
    InsightsEntityRead,
    InsightsOverviewRead,
    InsightsSnapshotCreate,
    InsightsSnapshotCreateRead,
    InsightsSnapshotPublicRead,
    InsightsSnapshotRead,
    InsightTargetRead,
    InvoiceStatusItemRead,
    InvoiceStatusSnapshotRead,
    LeaseEventRead,
    LeaseEventSnapshotRead,
    LiveExceptionRead,
    MaintenanceAgingItemRead,
    MaintenanceSnapshotRead,
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
COMPLIANCE_OBLIGATION_CATEGORIES = {
    ObligationCategory.insurance,
    ObligationCategory.bank_guarantee,
    ObligationCategory.make_good,
    ObligationCategory.compliance,
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
    ArrearsCaseStatus.active,
    ArrearsCaseStatus.monitoring,
}
ACTIVE_ARREARS_DISPUTE_STATUSES = {
    ArrearsDisputeStatus.raised,
    ArrearsDisputeStatus.under_review,
    ArrearsDisputeStatus.escalated,
}
ACTIVE_ARREARS_ESCALATION_STATUSES = {
    ArrearsEscalationStatus.queued,
    ArrearsEscalationStatus.in_progress,
    ArrearsEscalationStatus.referred,
}


def _status_label(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw).replace("_", " ")


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


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


def _metadata_list(metadata: dict[str, object], key: str) -> list[object]:
    value = metadata.get(key)
    return value if isinstance(value, list) else []


def _metadata_string(metadata: dict[str, object], *keys: str) -> str | None:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


# A recurring-register completion counts as "recent" for the snapshot roll-up
# when its operator approval landed within this many days of the as-of date.
RECENT_COMPLETION_DAYS = 90


def _parse_iso_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


class _RegisterCompletion:
    """Read-only projection of a recurring ComplianceCheck's latest operator
    approval, keyed by the check's current (rolled-forward) obligation."""

    __slots__ = ("check_id", "completed_at", "completed_by", "operator_approved_evidence")

    def __init__(self, check: ComplianceCheck) -> None:
        self.check_id = check.id
        metadata = check.check_metadata if isinstance(check.check_metadata, dict) else {}
        history = [
            entry
            for entry in _metadata_list(metadata, "completion_history")
            if isinstance(entry, dict)
        ]
        latest = history[-1] if history else {}
        self.completed_at = _parse_iso_datetime(
            latest.get("approved_at") or latest.get("completed_at")
        )
        approved_by = latest.get("approved_by") or latest.get("actor")
        self.completed_by = approved_by if isinstance(approved_by, str) and approved_by else None
        operator_approved = latest.get("operator_approved") is True
        has_evidence = bool(
            latest.get("source_document_id") or check.source_document_id is not None
        )
        self.operator_approved_evidence = operator_approved and has_evidence


def _register_completions_by_obligation(
    checks: list[ComplianceCheck],
) -> dict[UUID, _RegisterCompletion]:
    completions: dict[UUID, _RegisterCompletion] = {}
    for check in checks:
        if check.current_obligation_id is None:
            continue
        completions[check.current_obligation_id] = _RegisterCompletion(check)
    return completions


def _is_fire_safety_obligation(obligation: Obligation, metadata: dict[str, object]) -> bool:
    haystack = " ".join(
        part
        for part in [
            obligation.title,
            _metadata_string(metadata, "compliance_type", "inspection_type", "document_type"),
        ]
        if part
    ).lower()
    return "fire_safety" in haystack or "fire safety" in haystack


def _build_compliance_snapshot(
    obligations: list[Obligation],
    *,
    as_of: date,
    due_soon_until: date,
    properties_by_id: dict[UUID, Property],
    units_by_id: dict[UUID, TenancyUnit],
    tenants_by_id: dict[UUID, Tenant],
    leases_by_id: dict[UUID, Lease],
    register_completions: dict[UUID, _RegisterCompletion] | None = None,
) -> ComplianceSnapshotRead:
    register_completions = register_completions or {}
    open_items = [
        item
        for item in obligations
        if item.status in OPEN_OBLIGATION_STATUSES
        and item.category in COMPLIANCE_OBLIGATION_CATEGORIES
    ]
    rows: list[ComplianceRiskItemRead] = []
    evidence_linked_count = 0
    missing_evidence_count = 0
    fire_safety_count = 0
    inspection_report_count = 0
    tracked_check_count = 0
    operator_approved_evidence_count = 0
    recently_completed_count = 0
    recent_completion_floor = as_of - timedelta(days=RECENT_COMPLETION_DAYS)

    for obligation in open_items:
        metadata = obligation.obligation_metadata or {}
        evidence_ids = _metadata_list(metadata, "evidence_document_ids")
        evidence_history = [
            item for item in _metadata_list(metadata, "evidence_history") if isinstance(item, dict)
        ]
        latest_evidence = evidence_history[-1] if evidence_history else {}
        evidence_count = len(evidence_ids)
        has_evidence = evidence_count > 0
        evidence_linked_count += 1 if has_evidence else 0
        missing_evidence_count += 0 if has_evidence else 1

        inspection_type = _metadata_string(
            metadata,
            "compliance_type",
            "inspection_type",
            "document_type",
        )
        if _is_fire_safety_obligation(obligation, metadata):
            fire_safety_count += 1
        if _metadata_string(metadata, "document_type") == "inspection_report":
            inspection_report_count += 1

        completion = register_completions.get(obligation.id)
        register_check_id = completion.check_id if completion else None
        last_completed_at = completion.completed_at if completion else None
        last_completed_by = completion.completed_by if completion else None
        operator_approved_evidence = (
            completion.operator_approved_evidence if completion else False
        )
        if completion is not None:
            tracked_check_count += 1
        if operator_approved_evidence:
            operator_approved_evidence_count += 1
        if (
            last_completed_at is not None
            and last_completed_at.date() >= recent_completion_floor
        ):
            recently_completed_count += 1

        prop = properties_by_id.get(obligation.property_id) if obligation.property_id else None
        unit = units_by_id.get(obligation.tenancy_unit_id) if obligation.tenancy_unit_id else None
        lease = leases_by_id.get(obligation.lease_id) if obligation.lease_id else None
        tenant = tenants_by_id.get(lease.tenant_id) if lease else None
        days = _days_until(obligation.due_date, as_of)
        rows.append(
            ComplianceRiskItemRead(
                id=obligation.id,
                title=obligation.title,
                category=_enum_value(obligation.category),
                status=_enum_value(obligation.status),
                due_date=obligation.due_date,
                chip=_date_chip(obligation.due_date, as_of),
                href="/tasks",
                property_id=obligation.property_id,
                property_name=prop.name if prop else None,
                tenancy_unit_id=obligation.tenancy_unit_id,
                unit_label=unit.unit_label if unit else None,
                lease_id=obligation.lease_id,
                tenant_id=tenant.id if tenant else None,
                tenant_name=tenant.legal_name if tenant else None,
                owner_role=_enum_value(obligation.owner_role)
                if obligation.owner_role is not None
                else None,
                evidence_count=evidence_count,
                evidence_event_count=len(evidence_history),
                latest_evidence_at=latest_evidence.get("linked_at"),
                latest_evidence_actor=latest_evidence.get("actor"),
                inspection_type=inspection_type,
                register_check_id=register_check_id,
                last_completed_at=last_completed_at,
                last_completed_by=last_completed_by,
                operator_approved_evidence=operator_approved_evidence,
                rank=days,
            )
        )

    rows.sort(key=lambda item: (item.rank, item.category, item.title))
    return ComplianceSnapshotRead(
        open_count=len(open_items),
        overdue_count=sum(1 for item in open_items if item.due_date < as_of),
        due_soon_count=sum(
            1 for item in open_items if as_of <= item.due_date <= due_soon_until
        ),
        missing_evidence_count=missing_evidence_count,
        evidence_linked_count=evidence_linked_count,
        delegated_owner_count=sum(1 for item in open_items if item.owner_role is not None),
        fire_safety_count=fire_safety_count,
        inspection_report_count=inspection_report_count,
        tracked_check_count=tracked_check_count,
        operator_approved_evidence_count=operator_approved_evidence_count,
        recently_completed_count=recently_completed_count,
        category_counts=dict(Counter(_enum_value(item.category) for item in open_items)),
        status_counts=dict(Counter(_enum_value(item.status) for item in open_items)),
        next_items=rows[:10],
    )


def _build_maintenance_snapshot(
    work_orders: list[MaintenanceWorkOrder],
    *,
    as_of: date,
    properties_by_id: dict[UUID, Property],
    units_by_id: dict[UUID, TenancyUnit],
    tenants_by_id: dict[UUID, Tenant],
) -> MaintenanceSnapshotRead:
    open_items = [item for item in work_orders if item.status in OPEN_MAINTENANCE_STATUSES]
    rows: list[MaintenanceAgingItemRead] = []
    oldest_age_days = 0

    for work_order in open_items:
        requested_date = work_order.requested_at.date()
        age_days = max((as_of - requested_date).days, 0)
        oldest_age_days = max(oldest_age_days, age_days)
        prop = (
            properties_by_id.get(work_order.property_id)
            if work_order.property_id is not None
            else None
        )
        unit = (
            units_by_id.get(work_order.tenancy_unit_id)
            if work_order.tenancy_unit_id is not None
            else None
        )
        tenant = (
            tenants_by_id.get(work_order.tenant_id)
            if work_order.tenant_id is not None
            else None
        )
        due_days = _days_until(work_order.due_date, as_of)
        rank = min(due_days, 30) - age_days
        rows.append(
            MaintenanceAgingItemRead(
                id=work_order.id,
                title=work_order.title,
                status=_enum_value(work_order.status),
                priority=_enum_value(work_order.priority),
                requested_at=work_order.requested_at,
                age_days=age_days,
                due_date=work_order.due_date,
                chip=_date_chip(work_order.due_date, as_of),
                href=f"/operations/maintenance/{work_order.id}",
                property_id=work_order.property_id,
                property_name=prop.name if prop else None,
                tenancy_unit_id=work_order.tenancy_unit_id,
                unit_label=unit.unit_label if unit else None,
                lease_id=work_order.lease_id,
                tenant_id=work_order.tenant_id,
                tenant_name=tenant.legal_name if tenant else None,
                contractor_name=work_order.contractor_name,
                approval_status=_enum_value(work_order.approval_status),
                quote_amount_cents=work_order.quote_amount_cents,
                rank=rank,
            )
        )

    rows.sort(key=lambda item: (item.rank, -item.age_days, item.title))
    return MaintenanceSnapshotRead(
        open_count=len(open_items),
        urgent_count=sum(1 for item in open_items if item.priority == MaintenancePriority.urgent),
        overdue_count=sum(
            1
            for item in open_items
            if item.due_date is not None and item.due_date < as_of
        ),
        awaiting_approval_count=sum(
            1 for item in open_items if item.status == MaintenanceWorkOrderStatus.awaiting_approval
        ),
        contractor_assigned_count=sum(1 for item in open_items if item.contractor_name),
        aged_14_day_count=sum(
            1 for item in rows if item.age_days >= 14
        ),
        oldest_age_days=oldest_age_days,
        status_counts=dict(Counter(_enum_value(item.status) for item in open_items)),
        priority_counts=dict(Counter(_enum_value(item.priority) for item in open_items)),
        next_items=rows[:10],
    )


def _build_arrears_snapshot(
    arrears_cases: list[ArrearsCase],
    *,
    as_of: date,
    properties_by_id: dict[UUID, Property],
    units_by_id: dict[UUID, TenancyUnit],
    tenants_by_id: dict[UUID, Tenant],
) -> ArrearsSnapshotRead:
    open_items = [item for item in arrears_cases if item.status in OPEN_ARREARS_STATUSES]
    rows: list[ArrearsSnapshotItemRead] = []
    oldest_age_days = 0

    for arrears_case in open_items:
        age_days = (
            max((as_of - arrears_case.oldest_unpaid_invoice_date).days, 0)
            if arrears_case.oldest_unpaid_invoice_date is not None
            else 0
        )
        oldest_age_days = max(oldest_age_days, age_days)
        prop = (
            properties_by_id.get(arrears_case.property_id)
            if arrears_case.property_id is not None
            else None
        )
        unit = (
            units_by_id.get(arrears_case.tenancy_unit_id)
            if arrears_case.tenancy_unit_id is not None
            else None
        )
        tenant = tenants_by_id.get(arrears_case.tenant_id)
        reminder_days = min(_days_until(arrears_case.next_reminder_on, as_of), 30)
        rank = (reminder_days * 10) - min(age_days, 90)
        title = f"{tenant.legal_name if tenant else 'Tenant'} arrears"
        rows.append(
            ArrearsSnapshotItemRead(
                id=arrears_case.id,
                title=title,
                status=_enum_value(arrears_case.status),
                currency=arrears_case.currency,
                as_of=arrears_case.as_of,
                total_balance_cents=arrears_case.total_balance_cents,
                balance_1_30_cents=arrears_case.balance_1_30_cents,
                balance_31_60_cents=arrears_case.balance_31_60_cents,
                balance_61_90_cents=arrears_case.balance_61_90_cents,
                balance_90_plus_cents=arrears_case.balance_90_plus_cents,
                oldest_unpaid_invoice_date=arrears_case.oldest_unpaid_invoice_date,
                age_days=age_days,
                next_reminder_on=arrears_case.next_reminder_on,
                chip=_date_chip(arrears_case.next_reminder_on, as_of),
                href=f"/operations?tab=arrears&case_id={arrears_case.id}",
                property_id=arrears_case.property_id,
                property_name=prop.name if prop else None,
                tenancy_unit_id=arrears_case.tenancy_unit_id,
                unit_label=unit.unit_label if unit else None,
                lease_id=arrears_case.lease_id,
                tenant_id=arrears_case.tenant_id,
                tenant_name=tenant.legal_name if tenant else None,
                dispute_status=_enum_value(arrears_case.dispute_status),
                escalation_status=_enum_value(arrears_case.escalation_status),
                escalation_queue=arrears_case.escalation_queue,
                promise_to_pay_date=arrears_case.promise_to_pay_date,
                promise_to_pay_amount_cents=arrears_case.promise_to_pay_amount_cents,
                reminder_stage=arrears_case.reminder_stage,
                rank=rank,
            )
        )

    rows.sort(key=lambda item: (item.rank, -item.total_balance_cents, item.title))
    return ArrearsSnapshotRead(
        open_count=len(open_items),
        total_balance_cents=sum(item.total_balance_cents for item in open_items),
        overdue_reminder_count=sum(
            1
            for item in open_items
            if item.next_reminder_on is not None and item.next_reminder_on < as_of
        ),
        disputed_count=sum(
            1 for item in open_items if item.dispute_status in ACTIVE_ARREARS_DISPUTE_STATUSES
        ),
        escalated_count=sum(
            1
            for item in open_items
            if item.escalation_status in ACTIVE_ARREARS_ESCALATION_STATUSES
        ),
        promise_to_pay_count=sum(1 for item in open_items if item.promise_to_pay_date),
        aged_30_day_count=sum(1 for item in rows if item.age_days >= 30),
        aged_90_day_count=sum(1 for item in rows if item.age_days >= 90),
        oldest_age_days=oldest_age_days,
        status_counts=dict(Counter(_enum_value(item.status) for item in open_items)),
        dispute_counts=dict(Counter(_enum_value(item.dispute_status) for item in open_items)),
        escalation_counts=dict(
            Counter(_enum_value(item.escalation_status) for item in open_items)
        ),
        next_items=rows[:10],
    )


def _metadata_dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _metadata_text_value(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _metadata_int_value(value: object, default: int = 0) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def _invoice_payment_status(
    draft: InvoiceDraft,
    payment_metadata: dict[str, object],
) -> tuple[str, int, int]:
    paid_cents = min(
        max(_metadata_int_value(payment_metadata.get("paid_cents")), 0),
        draft.total_cents,
    )
    outstanding_cents = _metadata_int_value(
        payment_metadata.get("outstanding_cents"),
        max(draft.total_cents - paid_cents, 0),
    )
    outstanding_cents = max(outstanding_cents, 0)
    recorded_status = _metadata_text_value(payment_metadata.get("status"))
    if outstanding_cents == 0:
        return "paid", paid_cents, outstanding_cents
    if paid_cents > 0:
        return "partially_paid", paid_cents, outstanding_cents
    return recorded_status or "unpaid", paid_cents, outstanding_cents


def _invoice_delivery_status(metadata: dict[str, object]) -> str:
    delivery_state = _metadata_dict(metadata.get("delivery_state"))
    delivery_email = _metadata_dict(metadata.get("delivery_email"))
    send_state = _metadata_dict(delivery_email.get("send"))
    send_status = _metadata_text_value(send_state.get("status"))
    if delivery_state.get("tenant_email_sent") is True or send_status in {
        "queued",
        "sent",
        "delivered",
        "opened",
    }:
        return "sent"
    if send_status in {"blocked", "bounced", "failed"}:
        return "blocked"
    if delivery_state.get("delivery_ready") is True:
        return "ready"
    return "not_ready"


def _invoice_posting_status(draft: InvoiceDraft, metadata: dict[str, object]) -> str:
    delivery_state = _metadata_dict(metadata.get("delivery_state"))
    posting_preparation = _metadata_dict(metadata.get("posting_preparation"))
    xero_sync = _metadata_dict(metadata.get("xero_sync"))
    approval = _metadata_dict(metadata.get("xero_posting_approval"))
    provider_dispatch = _metadata_dict(metadata.get("provider_dispatch"))
    xero_dispatch = _metadata_dict(provider_dispatch.get("xero"))
    external_status = (
        _metadata_text_value(posting_preparation.get("external_posting_status"))
        or _metadata_text_value(xero_dispatch.get("external_posting_status"))
        or _metadata_text_value(xero_sync.get("external_posting_status"))
    )
    provider_status = _metadata_text_value(xero_dispatch.get("status"))
    xero_synced = (
        delivery_state.get("xero_synced") is True
        or posting_preparation.get("xero_synced") is True
        or xero_sync.get("xero_synced") is True
    )
    if xero_synced or external_status == "draft_created":
        return "xero_synced"
    if external_status == "provider_failed" or provider_status == "failed":
        return "provider_failed"
    if external_status in {"approved_not_synced", "approved_pending_xero_draft"}:
        return "approved_not_synced"
    if (
        draft.status == InvoiceDraftStatus.approved
        and (approval.get("approved") is True or approval.get("state") == "approved")
    ):
        return "approved_not_synced"
    if draft.status == InvoiceDraftStatus.approved:
        return "not_approved"
    if draft.status == InvoiceDraftStatus.ready_for_approval:
        return "awaiting_approval"
    return "not_ready"


def _invoice_status_filter(
    *,
    payment_status: str,
    delivery_status: str,
    posting_status: str,
) -> str:
    if posting_status == "provider_failed" or delivery_status == "blocked":
        return "needs_action"
    if delivery_status == "ready" or posting_status == "approved_not_synced":
        return "ready_dispatch"
    if payment_status != "paid":
        return "unpaid"
    return "all"


def _build_invoice_status_snapshot(
    invoice_drafts: list[InvoiceDraft],
    *,
    as_of: date,
    properties_by_id: dict[UUID, Property],
    units_by_id: dict[UUID, TenancyUnit],
    tenants_by_id: dict[UUID, Tenant],
) -> InvoiceStatusSnapshotRead:
    rows: list[InvoiceStatusItemRead] = []

    for draft in invoice_drafts:
        metadata = _metadata_dict(draft.invoice_metadata)
        payment_status, paid_cents, outstanding_cents = _invoice_payment_status(
            draft,
            _metadata_dict(metadata.get("payment_status")),
        )
        delivery_status = _invoice_delivery_status(metadata)
        posting_status = _invoice_posting_status(draft, metadata)
        due_days = _days_until(draft.due_date, as_of)
        rank = min(due_days, 60)
        if posting_status == "provider_failed":
            rank -= 50
        elif posting_status == "approved_not_synced":
            rank -= 25
        if delivery_status == "ready":
            rank -= 10
        if payment_status != "paid":
            rank -= 5

        prop = properties_by_id.get(draft.property_id) if draft.property_id else None
        unit = units_by_id.get(draft.tenancy_unit_id) if draft.tenancy_unit_id else None
        tenant = tenants_by_id.get(draft.tenant_id) if draft.tenant_id else None
        filter_value = _invoice_status_filter(
            payment_status=payment_status,
            delivery_status=delivery_status,
            posting_status=posting_status,
        )
        rows.append(
            InvoiceStatusItemRead(
                id=draft.id,
                title=draft.title,
                invoice_number=draft.invoice_number,
                status=_enum_value(draft.status),
                currency=draft.currency,
                issue_date=draft.issue_date,
                due_date=draft.due_date,
                total_cents=draft.total_cents,
                paid_cents=paid_cents,
                outstanding_cents=outstanding_cents,
                payment_status=payment_status,
                delivery_status=delivery_status,
                posting_status=posting_status,
                chip=_date_chip(draft.due_date, as_of),
                href=(
                    "/billing-readiness?tab=delivery"
                    f"&filter={filter_value}&invoice_id={draft.id}"
                ),
                property_id=draft.property_id,
                property_name=prop.name if prop else None,
                tenancy_unit_id=draft.tenancy_unit_id,
                unit_label=unit.unit_label if unit else None,
                lease_id=draft.lease_id,
                tenant_id=draft.tenant_id,
                tenant_name=tenant.legal_name if tenant else None,
                recipient_name=draft.recipient_name,
                recipient_email=draft.recipient_email,
                rank=rank,
            )
        )

    rows.sort(key=lambda item: (item.rank, -item.outstanding_cents, item.title))
    return InvoiceStatusSnapshotRead(
        total_invoice_count=len(invoice_drafts),
        approved_count=sum(
            1 for item in invoice_drafts if item.status == InvoiceDraftStatus.approved
        ),
        approved_unsynced_count=sum(
            1
            for item in rows
            if item.status == InvoiceDraftStatus.approved.value
            and item.posting_status != "xero_synced"
        ),
        ready_to_send_count=sum(1 for item in rows if item.delivery_status == "ready"),
        sent_count=sum(1 for item in rows if item.delivery_status == "sent"),
        unpaid_count=sum(
            1
            for item in rows
            if item.payment_status != "paid" and item.outstanding_cents > 0
        ),
        overdue_count=sum(
            1
            for item in rows
            if item.outstanding_cents > 0
            and item.due_date is not None
            and item.due_date < as_of
        ),
        xero_failed_count=sum(1 for item in rows if item.posting_status == "provider_failed"),
        total_cents=sum(item.total_cents for item in rows),
        outstanding_cents=sum(item.outstanding_cents for item in rows),
        status_counts=dict(Counter(_enum_value(item.status) for item in invoice_drafts)),
        payment_status_counts=dict(Counter(item.payment_status for item in rows)),
        delivery_status_counts=dict(Counter(item.delivery_status for item in rows)),
        posting_status_counts=dict(Counter(item.posting_status for item in rows)),
        next_items=rows[:10],
    )


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
    leases_by_id = {lease.id: lease for lease in active_leases}

    obligations = list(
        session.scalars(
            select(Obligation)
            .where(Obligation.entity_id == entity_id, Obligation.deleted_at.is_(None))
            .order_by(Obligation.due_date, Obligation.priority, Obligation.created_at)
        )
    )
    open_obligations = [item for item in obligations if item.status in OPEN_OBLIGATION_STATUSES]
    missing_lease_ids = {
        item.lease_id
        for item in obligations
        if item.lease_id is not None and item.lease_id not in leases_by_id
    }
    if missing_lease_ids:
        leases_by_id.update(
            {
                lease.id: lease
                for lease in session.scalars(
                    select(Lease).where(
                        Lease.id.in_(missing_lease_ids),
                        Lease.deleted_at.is_(None),
                    )
                )
            }
        )
    overdue_obligations = [item for item in open_obligations if item.due_date < as_of]
    due_soon_obligations = [
        item for item in open_obligations if as_of <= item.due_date <= due_soon_until
    ]
    compliance_checks = list(
        session.scalars(
            select(ComplianceCheck).where(
                ComplianceCheck.entity_id == entity_id,
                ComplianceCheck.deleted_at.is_(None),
                ComplianceCheck.status != ComplianceCheckStatus.archived,
            )
        )
    )
    register_completions = _register_completions_by_obligation(compliance_checks)
    compliance_snapshot = _build_compliance_snapshot(
        obligations,
        as_of=as_of,
        due_soon_until=due_soon_until,
        properties_by_id=properties_by_id,
        units_by_id=units_by_id,
        tenants_by_id=tenants_by_id,
        leases_by_id=leases_by_id,
        register_completions=register_completions,
    )

    maintenance_work_orders = list(
        session.scalars(
            select(MaintenanceWorkOrder)
            .where(
                MaintenanceWorkOrder.entity_id == entity_id,
                MaintenanceWorkOrder.deleted_at.is_(None),
            )
            .order_by(
                MaintenanceWorkOrder.due_date,
                MaintenanceWorkOrder.priority,
                MaintenanceWorkOrder.requested_at,
            )
        )
    )
    maintenance_snapshot = _build_maintenance_snapshot(
        maintenance_work_orders,
        as_of=as_of,
        properties_by_id=properties_by_id,
        units_by_id=units_by_id,
        tenants_by_id=tenants_by_id,
    )

    arrears_cases = list(
        session.scalars(
            select(ArrearsCase)
            .where(
                ArrearsCase.entity_id == entity_id,
                ArrearsCase.deleted_at.is_(None),
            )
            .order_by(
                ArrearsCase.next_reminder_on,
                ArrearsCase.oldest_unpaid_invoice_date,
                ArrearsCase.total_balance_cents.desc(),
            )
        )
    )
    arrears_snapshot = _build_arrears_snapshot(
        arrears_cases,
        as_of=as_of,
        properties_by_id=properties_by_id,
        units_by_id=units_by_id,
        tenants_by_id=tenants_by_id,
    )

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
            select(InvoiceDraft)
            .where(
                InvoiceDraft.entity_id == entity_id,
                InvoiceDraft.deleted_at.is_(None),
            )
            .order_by(InvoiceDraft.due_date, InvoiceDraft.created_at)
        )
    )
    invoice_status_snapshot = _build_invoice_status_snapshot(
        invoice_drafts,
        as_of=as_of,
        properties_by_id=properties_by_id,
        units_by_id=units_by_id,
        tenants_by_id=tenants_by_id,
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
        compliance_snapshot=compliance_snapshot,
        maintenance_snapshot=maintenance_snapshot,
        arrears_snapshot=arrears_snapshot,
        invoice_status_snapshot=invoice_status_snapshot,
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
