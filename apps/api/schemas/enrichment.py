"""Schemas for review-first public record enrichment."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

EnrichmentTargetType = Literal["property", "tenant"]


class EnrichmentSource(BaseModel):
    source_hint: str = Field(min_length=1)
    citation: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    url: str | None = None


class EnrichmentSuggestion(BaseModel):
    field: str = Field(min_length=1)
    label: str
    value: str = Field(min_length=1)
    source: EnrichmentSource
    confidence: float = Field(ge=0, le=1)
    notes: str | None = None


class EnrichmentTargetRead(BaseModel):
    target_type: EnrichmentTargetType
    target_id: UUID
    entity_id: UUID
    display_name: str
    missing_fields: list[str]


class EnrichmentPreviewRequest(BaseModel):
    target_type: EnrichmentTargetType
    target_id: UUID
    requested_fields: list[str] | None = None


class EnrichmentPreviewRead(BaseModel):
    target: EnrichmentTargetRead
    suggestions: list[EnrichmentSuggestion]
    warnings: list[str] = Field(default_factory=list)
    openai_response_id: str | None = None


class EnrichmentApplyRequest(BaseModel):
    target_type: EnrichmentTargetType
    target_id: UUID
    suggestions: list[EnrichmentSuggestion] = Field(min_length=1)


class EnrichmentAppliedChange(BaseModel):
    field: str
    label: str
    before: Any
    after: Any
    source: EnrichmentSource
    storage: Literal["record_field", "metadata"]


class EnrichmentSkippedSuggestion(BaseModel):
    field: str
    value: str | None = None
    reason: str


class EnrichmentApplyRead(BaseModel):
    target: EnrichmentTargetRead
    applied: list[EnrichmentAppliedChange]
    skipped: list[EnrichmentSkippedSuggestion]


class PropertyImageCandidate(BaseModel):
    title: str = Field(min_length=1)
    image_url: str = Field(min_length=1)
    page_url: str | None = None
    source: EnrichmentSource
    confidence: float = Field(ge=0, le=1)
    notes: str | None = None


class PropertyImagePreviewRequest(BaseModel):
    property_id: UUID
    requested_count: int = Field(default=4, ge=1, le=6)


class PropertyImagePreviewRead(BaseModel):
    target: EnrichmentTargetRead
    candidates: list[PropertyImageCandidate]
    warnings: list[str] = Field(default_factory=list)
    openai_response_id: str | None = None


class PropertyImageApplyRequest(BaseModel):
    property_id: UUID
    candidate: PropertyImageCandidate


class PropertyImageApplyRead(BaseModel):
    target: EnrichmentTargetRead
    selected_image: PropertyImageCandidate
    document_id: UUID
    warnings: list[str] = Field(default_factory=list)
