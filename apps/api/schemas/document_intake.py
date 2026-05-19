"""Schemas for Smart Intake document review records."""

from datetime import datetime
from typing import Any
from uuid import UUID

from stewart.core.models import DocumentCategory, DocumentIntakeStatus

from apps.api.schemas.common import ApiModel


class DocumentIntakeReviewRequest(ApiModel):
    review_data: dict[str, Any]


class DocumentIntakeApplyRequest(ApiModel):
    review_data: dict[str, Any] | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None


class DocumentIntakeRead(ApiModel):
    id: UUID
    entity_id: UUID
    document_id: UUID
    status: DocumentIntakeStatus
    document_type: str | None
    summary: str | None
    confidence: float | None
    extracted_data: dict[str, Any]
    review_data: dict[str, Any]
    openai_response_id: str | None
    error_message: str | None
    reviewed_at: datetime | None
    reviewed_by_user_id: UUID | None
    applied_at: datetime | None
    applied_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime
    filename: str
    content_type: str | None
    byte_size: int
    category: DocumentCategory
