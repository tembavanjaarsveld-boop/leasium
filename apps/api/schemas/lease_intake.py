"""Schemas for AI lease intake upload, extraction, and apply flows."""

from datetime import datetime
from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, Field, model_validator
from stewart.core.models import LeaseIntakeStatus

from apps.api.schemas.common import ApiModel


class LeaseIntakeApplyRequest(BaseModel):
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    reviewed_data: dict[str, Any] | None = None


class LeaseIntakeRead(ApiModel):
    id: UUID
    entity_id: UUID
    filename: str
    file_name: str | None = None
    content_type: str | None
    byte_size: int
    status: LeaseIntakeStatus
    extracted_data: dict[str, Any] = Field(default_factory=dict)
    extracted: dict[str, Any] | None = None
    openai_response_id: str | None
    error_message: str | None
    error: str | None = None
    applied_lease_id: UUID | None
    applied_at: datetime | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None

    @model_validator(mode="after")
    def add_frontend_aliases(self) -> Self:
        self.file_name = self.filename
        self.extracted = self.extracted_data
        self.error = self.error_message
        return self


class LeaseIntakeApplyRead(BaseModel):
    intake: LeaseIntakeRead
    property_id: UUID
    tenancy_unit_id: UUID
    tenant_id: UUID
    lease_id: UUID
    obligation_ids: list[UUID]
