"""Schemas for Smart Intake document review records."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field
from stewart.core.models import DocumentCategory, DocumentIntakeStatus

from apps.api.schemas.common import ApiModel


class DocumentIntakeReviewRequest(ApiModel):
    review_data: dict[str, Any]


AiOpportunityDecision = Literal["pending", "answered", "accepted_for_review", "ignored"]


class DocumentIntakeAiOpportunityAnswerRequest(ApiModel):
    question_id: str
    question: str
    answer: str
    structured_facts: dict[str, Any] = Field(default_factory=dict)


class DocumentIntakeAiOpportunityDecisionRequest(ApiModel):
    opportunity_id: str
    decision: AiOpportunityDecision = "pending"
    title: str | None = None
    summary: str | None = None
    notes: str | None = None


class DocumentIntakeAiOpportunityOutputRowRequest(ApiModel):
    label: str
    value: str
    source: str | None = None


class DocumentIntakeAiOpportunityOutputRequest(ApiModel):
    kind: str
    title: str
    summary: str
    rows: list[DocumentIntakeAiOpportunityOutputRowRequest] = Field(default_factory=list)
    guardrail: str


class DocumentIntakeAiOpportunitySessionRequest(ApiModel):
    review_data: dict[str, Any] | None = None
    selected_opportunity_id: str | None = None
    answers: list[DocumentIntakeAiOpportunityAnswerRequest] = Field(default_factory=list)
    proposed_output: DocumentIntakeAiOpportunityOutputRequest | None = None
    decisions: list[DocumentIntakeAiOpportunityDecisionRequest] = Field(default_factory=list)
    status: Literal["open", "reviewed"] = "open"
    notes: str | None = Field(default=None, max_length=2000)


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
