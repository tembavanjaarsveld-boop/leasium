"""Schemas for stored document records."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import AliasChoices, Field
from stewart.core.models import DocumentCategory

from apps.api.schemas.common import ApiModel


class DocumentRead(ApiModel):
    id: UUID
    entity_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    tenant_id: UUID | None
    lease_id: UUID | None
    tenant_onboarding_id: UUID | None
    filename: str
    content_type: str | None
    byte_size: int
    category: DocumentCategory
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("document_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    deleted_at: datetime | None
