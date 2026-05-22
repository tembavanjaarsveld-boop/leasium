"""Ask Leasium AI Q&A schemas."""

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
