"""Ask Leasium AI Q&A + inbox triage schemas."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

AskCitationKind = Literal[
    "property",
    "lease",
    "tenant",
    "obligation",
    "maintenance_work_order",
    "arrears_case",
]


class AskRequest(BaseModel):
    entity_id: UUID
    question: str = Field(min_length=1, max_length=600)


class AskCitation(BaseModel):
    kind: AskCitationKind
    target_id: UUID
    label: str
    href: str | None = None


class AskRead(BaseModel):
    answer: str
    citations: list[AskCitation] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    response_id: str | None = None


InboxKind = Literal[
    "maintenance_request",
    "payment_or_arrears",
    "lease_change",
    "tenant_contact",
    "vendor_or_contractor",
    "general",
    "spam_or_noise",
]


InboxTargetKind = Literal[
    "maintenance_work_order",
    "arrears_case",
    "tenant",
    "lease",
    "property",
    "smart_intake",
    "none",
]


class InboxTriageRequest(BaseModel):
    entity_id: UUID
    body: str = Field(min_length=10, max_length=8000)


class InboxKeyFact(BaseModel):
    label: str
    value: str


class InboxTriageRead(BaseModel):
    kind: InboxKind
    confidence: float
    summary: str
    suggested_action: str
    suggested_target_kind: InboxTargetKind
    suggested_target_href: str | None = None
    key_facts: list[InboxKeyFact] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    response_id: str | None = None
