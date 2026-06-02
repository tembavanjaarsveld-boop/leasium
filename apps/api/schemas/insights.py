"""Schemas for the read-only Insights overview."""

from __future__ import annotations

from datetime import date as Date
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

InsightsSnapshotType = Literal["owner", "finance", "lease_events"]


class InsightsEntityRead(BaseModel):
    id: UUID
    name: str
    gst_registered: bool
    xero_connected: bool
    xero_last_sync_at: datetime | None


class PortfolioHealthRead(BaseModel):
    property_count: int
    tenant_count: int
    unit_count: int
    active_lease_count: int
    vacant_unit_count: int
    overdue_obligation_count: int
    due_soon_obligation_count: int
    open_obligation_count: int
    smart_intake_waiting_count: int
    tenant_onboarding_waiting_count: int


class InsightTargetRead(BaseModel):
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    lease_id: UUID | None = None
    tenant_id: UUID | None = None
    document_intake_id: UUID | None = None
    obligation_id: UUID | None = None
    billing_draft_id: UUID | None = None
    invoice_draft_id: UUID | None = None


class LiveExceptionRead(BaseModel):
    id: str
    kind: Literal[
        "obligation",
        "tenant_onboarding",
        "smart_intake",
        "billing_readiness",
        "xero_readiness",
    ]
    severity: Literal["danger", "warning", "primary", "neutral"]
    title: str
    detail: str
    chip: str
    due_date: Date | None = None
    source: str
    href: str
    target: InsightTargetRead = Field(default_factory=InsightTargetRead)
    rank: int = 0


class AutomationActivityRead(BaseModel):
    id: UUID
    occurred_at: datetime
    kind: str
    label: str
    detail: str | None = None
    source: str
    target_table: str | None = None
    target_id: UUID | None = None
    outcome: str


class BillingRiskRead(BaseModel):
    ready_to_bill_count: int
    blocked_row_count: int
    blocker_count: int
    configured_charges_cents: int
    billing_draft_counts: dict[str, int]
    invoice_draft_counts: dict[str, int]
    xero_issue_count: int
    xero_blocker_count: int
    approved_unsynced_invoice_count: int
    unpaid_invoice_count: int


class AccountingReadinessSnapshotRead(BaseModel):
    generated_at: datetime | None = None
    source: str | None = None
    status: str
    summary: str
    stale_after_days: int | None = None
    contact_ready: int
    contact_missing: int
    chart_ready: int
    chart_missing: int
    tax_ready: int
    tax_missing: int
    readiness_issue_count: int = 0
    readiness_blocker_count: int = 0
    readiness_warning_count: int = 0
    approved_unsynced_invoice_count: int
    unpaid_invoice_count: int
    stale_reconciliation: bool
    xero_linked_open_invoice_count: int
    last_contact_sync_at: datetime | None
    last_chart_tax_validation_at: datetime | None
    last_invoice_posting_preview_at: datetime | None = None
    last_invoice_draft_create_at: datetime | None = None
    last_invoice_provider_dispatch_at: datetime | None = None
    last_payment_reconciliation_preview_at: datetime | None = None
    last_payment_reconciliation_apply_at: datetime | None = None
    last_payment_reconciliation_at: datetime | None
    last_payment_reconciliation_source: str | None = None
    last_payment_reconciliation_mode: str | None = None
    guardrails: list[str]


class FinanceSnapshotRead(BaseModel):
    configured_charges_cents: int
    ready_to_bill_count: int
    blocked_row_count: int
    approved_unsynced_invoice_count: int
    unpaid_invoice_count: int
    billing_draft_counts: dict[str, int]
    invoice_draft_counts: dict[str, int]
    accounting_readiness: AccountingReadinessSnapshotRead | None = None


class OwnerEntitySnapshotRead(BaseModel):
    ownership_profile_counts: dict[str, int]
    missing_invoice_issuer_count: int
    missing_owner_abn_count: int
    missing_trustee_count: int
    missing_ownership_split_count: int
    missing_xero_contact_count: int
    entity_gst_registered: bool
    xero_connected: bool
    xero_last_sync_at: datetime | None
    accounting_readiness: AccountingReadinessSnapshotRead | None = None


class LeaseEventRead(BaseModel):
    id: str
    kind: Literal["rent_review", "lease_expiry", "obligation", "tenant_onboarding"]
    title: str
    date: Date | None = None
    chip: str
    href: str
    target: InsightTargetRead = Field(default_factory=InsightTargetRead)
    rank: int = 0


class LeaseEventSnapshotRead(BaseModel):
    active_lease_count: int
    next_review_count: int
    next_expiry_count: int
    overdue_obligation_count: int
    due_soon_obligation_count: int
    tenant_onboarding_waiting_count: int
    next_events: list[LeaseEventRead] = Field(default_factory=list)


class ComplianceRiskItemRead(BaseModel):
    id: UUID
    title: str
    category: str
    status: str
    due_date: Date
    chip: str
    href: str
    property_id: UUID | None = None
    property_name: str | None = None
    tenancy_unit_id: UUID | None = None
    unit_label: str | None = None
    lease_id: UUID | None = None
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    owner_role: str | None = None
    evidence_count: int = 0
    evidence_event_count: int = 0
    latest_evidence_at: datetime | None = None
    latest_evidence_actor: str | None = None
    inspection_type: str | None = None
    rank: int = 0


class ComplianceSnapshotRead(BaseModel):
    open_count: int = 0
    overdue_count: int = 0
    due_soon_count: int = 0
    missing_evidence_count: int = 0
    evidence_linked_count: int = 0
    delegated_owner_count: int = 0
    fire_safety_count: int = 0
    inspection_report_count: int = 0
    category_counts: dict[str, int] = Field(default_factory=dict)
    status_counts: dict[str, int] = Field(default_factory=dict)
    next_items: list[ComplianceRiskItemRead] = Field(default_factory=list)


class MaintenanceAgingItemRead(BaseModel):
    id: UUID
    title: str
    status: str
    priority: str
    requested_at: datetime
    age_days: int
    due_date: Date | None = None
    chip: str
    href: str
    property_id: UUID | None = None
    property_name: str | None = None
    tenancy_unit_id: UUID | None = None
    unit_label: str | None = None
    lease_id: UUID | None = None
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    contractor_name: str | None = None
    approval_status: str | None = None
    quote_amount_cents: int | None = None
    rank: int = 0


class MaintenanceSnapshotRead(BaseModel):
    open_count: int = 0
    urgent_count: int = 0
    overdue_count: int = 0
    awaiting_approval_count: int = 0
    contractor_assigned_count: int = 0
    aged_14_day_count: int = 0
    oldest_age_days: int = 0
    status_counts: dict[str, int] = Field(default_factory=dict)
    priority_counts: dict[str, int] = Field(default_factory=dict)
    next_items: list[MaintenanceAgingItemRead] = Field(default_factory=list)


class InsightsOverviewRead(BaseModel):
    entity: InsightsEntityRead
    as_of: Date
    portfolio_health: PortfolioHealthRead
    live_exceptions: list[LiveExceptionRead]
    automation_activity: list[AutomationActivityRead]
    billing_risk: BillingRiskRead
    finance_snapshot: FinanceSnapshotRead
    owner_entity_snapshot: OwnerEntitySnapshotRead
    lease_event_snapshot: LeaseEventSnapshotRead
    compliance_snapshot: ComplianceSnapshotRead = Field(default_factory=ComplianceSnapshotRead)
    maintenance_snapshot: MaintenanceSnapshotRead = Field(default_factory=MaintenanceSnapshotRead)
    guardrails: list[str]


class InsightsSnapshotCreate(BaseModel):
    entity_id: UUID
    snapshot_type: InsightsSnapshotType = "owner"
    as_of: Date | None = None
    expires_in_days: int = Field(default=30, ge=1, le=180)


class InsightsSnapshotRead(BaseModel):
    id: UUID
    entity_id: UUID
    snapshot_type: InsightsSnapshotType
    as_of: Date
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    payload: InsightsOverviewRead
    share_url: str | None = None


class InsightsSnapshotCreateRead(InsightsSnapshotRead):
    token: str
    share_url: str


class InsightsSnapshotPublicRead(BaseModel):
    id: UUID
    snapshot_type: InsightsSnapshotType
    as_of: Date
    created_at: datetime
    expires_at: datetime | None
    payload: InsightsOverviewRead
    guardrails: list[str] = Field(default_factory=list)
