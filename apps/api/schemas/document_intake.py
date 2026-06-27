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
    thread_id: UUID | None = None
    target_entity_id: UUID | None = None
    create_entity_name: str | None = None
    approve_high_confidence: bool = False


class DocumentIntakePropertyCandidateRead(ApiModel):
    property_id: UUID
    score: float
    reason: str
    duplicate: bool
    name: str | None = None
    street_address: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None


class DocumentIntakeTenantCandidateRead(ApiModel):
    tenant_id: UUID
    score: float
    reason: str
    duplicate: bool
    legal_name: str | None = None
    trading_name: str | None = None
    abn: str | None = None


class DocumentIntakeDocumentDuplicateRead(ApiModel):
    document_id: UUID
    intake_id: UUID | None = None
    filename: str
    reason: str
    processed_at: datetime | None = None


class DocumentIntakeMatchCandidatesRead(ApiModel):
    property_candidates: list[DocumentIntakePropertyCandidateRead] = Field(default_factory=list)
    tenant_candidates: list[DocumentIntakeTenantCandidateRead] = Field(default_factory=list)
    document_duplicate: DocumentIntakeDocumentDuplicateRead | None = None


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
    suggested_entity_id: UUID | None = None
