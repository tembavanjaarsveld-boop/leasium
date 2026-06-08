"""Schemas for recurring compliance checks."""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field
from stewart.core.models import (
    ComplianceCheckKind,
    ComplianceCheckStatus,
    ComplianceRecurrenceUnit,
    UserRole,
)

from apps.api.schemas.common import ApiModel


class ComplianceCheckCreate(BaseModel):
    entity_id: UUID
    title: str
    kind: ComplianceCheckKind = ComplianceCheckKind.other
    status: ComplianceCheckStatus = ComplianceCheckStatus.active
    jurisdiction: str | None = None
    authority: str | None = None
    recurrence_interval: int = Field(default=1, ge=1, le=120)
    recurrence_unit: ComplianceRecurrenceUnit = ComplianceRecurrenceUnit.years
    last_checked_at: datetime | None = None
    next_due_date: date
    certificate_expires_on: date | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    assigned_user_id: UUID | None = None
    source_document_id: UUID | None = None
    current_obligation_id: UUID | None = None
    owner_role: UserRole | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ComplianceCheckUpdate(BaseModel):
    title: str | None = None
    kind: ComplianceCheckKind | None = None
    status: ComplianceCheckStatus | None = None
    jurisdiction: str | None = None
    authority: str | None = None
    recurrence_interval: int | None = Field(default=None, ge=1, le=120)
    recurrence_unit: ComplianceRecurrenceUnit | None = None
    last_checked_at: datetime | None = None
    next_due_date: date | None = None
    certificate_expires_on: date | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    assigned_user_id: UUID | None = None
    source_document_id: UUID | None = None
    current_obligation_id: UUID | None = None
    owner_role: UserRole | None = None
    notes: str | None = None
    metadata: dict[str, Any] | None = None


class ComplianceCheckComplete(BaseModel):
    # Review-first guardrail: completion is operator-approved by design. The
    # caller must affirm the approval so a completion (which marks the current
    # obligation done and rolls the check forward) cannot fire as a silent
    # side-effect of any write-role request.
    operator_approved: bool = False
    source_document_id: UUID | None = None
    completed_at: datetime | None = None
    next_due_date: date | None = None
    certificate_expires_on: date | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ComplianceCheckEvidenceLink(BaseModel):
    source_document_id: UUID
    certificate_expires_on: date | None = None
    notes: str | None = None


class ComplianceCheckRead(ApiModel):
    id: UUID
    entity_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    tenant_id: UUID | None
    lease_id: UUID | None
    assigned_user_id: UUID | None
    source_document_id: UUID | None
    current_obligation_id: UUID | None
    title: str
    kind: ComplianceCheckKind
    status: ComplianceCheckStatus
    jurisdiction: str | None
    authority: str | None
    recurrence_interval: int
    recurrence_unit: ComplianceRecurrenceUnit
    last_checked_at: datetime | None
    next_due_date: date
    certificate_expires_on: date | None
    owner_role: UserRole | None
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("check_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
