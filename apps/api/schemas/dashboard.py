"""Schemas for the dashboard first-paint overview."""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class DashboardEntityRead(BaseModel):
    id: UUID
    name: str


class DashboardCountsRead(BaseModel):
    property_count: int
    tenant_count: int
    open_obligation_count: int
    overdue_obligation_count: int
    due_soon_obligation_count: int


class DashboardRentRollRead(BaseModel):
    unit_count: int
    occupied_unit_count: int
    vacant_unit_count: int
    active_lease_count: int
    annual_rent_cents: int
    charge_rules_total_cents: int
    ready_to_bill_count: int
    blocked_row_count: int


class DashboardIntakeRead(BaseModel):
    document_counts: dict[str, int] = Field(default_factory=dict)
    document_waiting_count: int
    onboarding_counts: dict[str, int] = Field(default_factory=dict)
    onboarding_waiting_count: int


class DashboardLeaseEventRead(BaseModel):
    id: str
    kind: Literal["tenant_onboarding", "obligation", "rent_review", "lease_expiry"]
    date: date | None
    lease_id: UUID | None = None
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    property_id: UUID | None = None
    property_name: str | None = None
    tenancy_unit_id: UUID | None = None
    unit_label: str | None = None
    title: str


class DashboardOverviewRead(BaseModel):
    entity: DashboardEntityRead
    as_of: date
    counts: DashboardCountsRead
    rent_roll: DashboardRentRollRead
    intake: DashboardIntakeRead
    upcoming_lease_events: list[DashboardLeaseEventRead] = Field(default_factory=list)
