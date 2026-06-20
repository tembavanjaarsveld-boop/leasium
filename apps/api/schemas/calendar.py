"""Schemas for the unified operations calendar."""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

CalendarEventType = Literal[
    "lease_expiry",
    "rent_review",
    "maintenance_due",
    "compliance_due",
    "obligation",
    "charge_due",
    "billing_due",
    "invoice_due",
    "arrears_reminder",
    "promise_to_pay",
    "tenant_onboarding",
]
CalendarSeverity = Literal["danger", "warning", "primary", "neutral", "success"]


class CalendarEventSourceRead(BaseModel):
    table: str
    id: UUID


class CalendarEventRead(BaseModel):
    id: str
    type: CalendarEventType
    title: str
    date: date
    severity: CalendarSeverity
    entity_id: UUID
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    source: CalendarEventSourceRead
    link: str
    chip: str | None = None
    description: str | None = None
