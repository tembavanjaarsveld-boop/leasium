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


class FinanceSnapshotRead(BaseModel):
    configured_charges_cents: int
    ready_to_bill_count: int
    blocked_row_count: int
    approved_unsynced_invoice_count: int
    unpaid_invoice_count: int
    billing_draft_counts: dict[str, int]
    invoice_draft_counts: dict[str, int]


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
