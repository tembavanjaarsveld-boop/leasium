"""Maintenance work order request and response schemas."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field
from stewart.core.models import (
    MaintenanceApprovalStatus,
    MaintenancePriority,
    MaintenanceWorkOrderStatus,
)

from apps.api.schemas.common import ApiModel

MaintenanceCommentVisibility = Literal["internal", "contractor", "tenant"]


class MaintenanceWorkOrderCreate(BaseModel):
    entity_id: UUID
    title: str
    description: str | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    status: MaintenanceWorkOrderStatus = MaintenanceWorkOrderStatus.requested
    priority: MaintenancePriority = MaintenancePriority.normal
    requested_at: datetime | None = None
    contractor_name: str | None = None
    contractor_email: str | None = None
    contractor_phone: str | None = None
    contractor_assigned_at: datetime | None = None
    approval_required: bool = False
    approval_status: MaintenanceApprovalStatus = MaintenanceApprovalStatus.not_required
    approval_limit_cents: int | None = Field(default=None, ge=0)
    quote_amount_cents: int | None = Field(default=None, ge=0)
    approved_by_user_id: UUID | None = None
    approved_at: datetime | None = None
    approval_notes: str | None = None
    source_document_id: UUID | None = None
    invoice_draft_id: UUID | None = None
    invoice_reference: str | None = None
    invoice_amount_cents: int | None = Field(default=None, ge=0)
    source_reference: str | None = None
    due_date: date | None = None
    completed_at: datetime | None = None
    notes: str | None = None
    document_ids: list[UUID] = Field(default_factory=list)
    photo_document_ids: list[UUID] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MaintenanceWorkOrderUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    status: MaintenanceWorkOrderStatus | None = None
    priority: MaintenancePriority | None = None
    requested_at: datetime | None = None
    contractor_name: str | None = None
    contractor_email: str | None = None
    contractor_phone: str | None = None
    contractor_assigned_at: datetime | None = None
    approval_required: bool | None = None
    approval_status: MaintenanceApprovalStatus | None = None
    approval_limit_cents: int | None = Field(default=None, ge=0)
    quote_amount_cents: int | None = Field(default=None, ge=0)
    approved_by_user_id: UUID | None = None
    approved_at: datetime | None = None
    approval_notes: str | None = None
    source_document_id: UUID | None = None
    invoice_draft_id: UUID | None = None
    invoice_reference: str | None = None
    invoice_amount_cents: int | None = Field(default=None, ge=0)
    source_reference: str | None = None
    due_date: date | None = None
    completed_at: datetime | None = None
    notes: str | None = None
    document_ids: list[UUID] | None = None
    photo_document_ids: list[UUID] | None = None
    metadata: dict[str, Any] | None = None


class MaintenanceWorkOrderCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    visibility: MaintenanceCommentVisibility = "internal"


class MaintenanceWorkOrderRead(ApiModel):
    id: UUID
    entity_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    tenant_id: UUID | None
    lease_id: UUID | None
    title: str
    description: str | None
    status: MaintenanceWorkOrderStatus
    priority: MaintenancePriority
    requested_at: datetime
    contractor_name: str | None
    contractor_email: str | None
    contractor_phone: str | None
    contractor_assigned_at: datetime | None
    approval_required: bool
    approval_status: MaintenanceApprovalStatus
    approval_limit_cents: int | None
    quote_amount_cents: int | None
    approved_by_user_id: UUID | None
    approved_at: datetime | None
    approval_notes: str | None
    source_document_id: UUID | None
    invoice_draft_id: UUID | None
    invoice_reference: str | None
    invoice_amount_cents: int | None
    source_reference: str | None
    due_date: date | None
    completed_at: datetime | None
    notes: str | None
    document_ids: list[UUID]
    photo_document_ids: list[UUID]
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("work_order_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
