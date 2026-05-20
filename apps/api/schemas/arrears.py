"""Arrears and credit control request and response schemas."""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field
from stewart.core.models import (
    ArrearsCaseStatus,
    ArrearsDisputeStatus,
    ArrearsEscalationStatus,
)

from apps.api.schemas.common import ApiModel


class ArrearsCaseCreate(BaseModel):
    entity_id: UUID
    tenant_id: UUID
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    lease_id: UUID | None = None
    status: ArrearsCaseStatus = ArrearsCaseStatus.active
    currency: str = "AUD"
    as_of: date = Field(default_factory=date.today)
    balance_current_cents: int = 0
    balance_1_30_cents: int = 0
    balance_31_60_cents: int = 0
    balance_61_90_cents: int = 0
    balance_90_plus_cents: int = 0
    total_balance_cents: int = 0
    oldest_unpaid_invoice_date: date | None = None
    last_invoice_date: date | None = None
    source_reference: str | None = None
    reminder_stage: int = 0
    reminder_frequency_days: int | None = Field(default=None, ge=1)
    next_reminder_on: date | None = None
    last_reminder_at: datetime | None = None
    reminder_paused_until: date | None = None
    dispute_status: ArrearsDisputeStatus = ArrearsDisputeStatus.none
    dispute_notes: str | None = None
    promise_to_pay_date: date | None = None
    promise_to_pay_amount_cents: int | None = Field(default=None, ge=0)
    promise_to_pay_notes: str | None = None
    escalation_status: ArrearsEscalationStatus = ArrearsEscalationStatus.none
    escalation_queue: str | None = None
    escalated_at: datetime | None = None
    assigned_user_id: UUID | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ArrearsCaseUpdate(BaseModel):
    tenant_id: UUID | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    lease_id: UUID | None = None
    status: ArrearsCaseStatus | None = None
    currency: str | None = None
    as_of: date | None = None
    balance_current_cents: int | None = None
    balance_1_30_cents: int | None = None
    balance_31_60_cents: int | None = None
    balance_61_90_cents: int | None = None
    balance_90_plus_cents: int | None = None
    total_balance_cents: int | None = None
    oldest_unpaid_invoice_date: date | None = None
    last_invoice_date: date | None = None
    source_reference: str | None = None
    reminder_stage: int | None = None
    reminder_frequency_days: int | None = Field(default=None, ge=1)
    next_reminder_on: date | None = None
    last_reminder_at: datetime | None = None
    reminder_paused_until: date | None = None
    dispute_status: ArrearsDisputeStatus | None = None
    dispute_notes: str | None = None
    promise_to_pay_date: date | None = None
    promise_to_pay_amount_cents: int | None = Field(default=None, ge=0)
    promise_to_pay_notes: str | None = None
    escalation_status: ArrearsEscalationStatus | None = None
    escalation_queue: str | None = None
    escalated_at: datetime | None = None
    assigned_user_id: UUID | None = None
    notes: str | None = None
    metadata: dict[str, Any] | None = None


class ArrearsCaseRead(ApiModel):
    id: UUID
    entity_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    tenant_id: UUID
    lease_id: UUID | None
    status: ArrearsCaseStatus
    currency: str
    as_of: date
    balance_current_cents: int
    balance_1_30_cents: int
    balance_31_60_cents: int
    balance_61_90_cents: int
    balance_90_plus_cents: int
    total_balance_cents: int
    oldest_unpaid_invoice_date: date | None
    last_invoice_date: date | None
    source_reference: str | None
    reminder_stage: int
    reminder_frequency_days: int | None
    next_reminder_on: date | None
    last_reminder_at: datetime | None
    reminder_paused_until: date | None
    dispute_status: ArrearsDisputeStatus
    dispute_notes: str | None
    promise_to_pay_date: date | None
    promise_to_pay_amount_cents: int | None
    promise_to_pay_notes: str | None
    escalation_status: ArrearsEscalationStatus
    escalation_queue: str | None
    escalated_at: datetime | None
    assigned_user_id: UUID | None
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("arrears_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
