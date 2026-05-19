"""Schemas for the read-only Insights overview."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


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
    due_date: date | None = None
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


class InsightsOverviewRead(BaseModel):
    entity: InsightsEntityRead
    as_of: date
    portfolio_health: PortfolioHealthRead
    live_exceptions: list[LiveExceptionRead]
    automation_activity: list[AutomationActivityRead]
    billing_risk: BillingRiskRead
    owner_entity_snapshot: OwnerEntitySnapshotRead
    guardrails: list[str]
