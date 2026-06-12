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
    "property_update",
    "compliance_or_insurance",
    "task_or_reminder",
    "owner_or_entity_admin",
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


class InboxTriageMatch(BaseModel):
    """An entity-scoped record the AI matched the message to."""

    id: UUID
    label: str


class InboxTriageRead(BaseModel):
    kind: InboxKind
    confidence: float
    summary: str
    suggested_action: str
    suggested_target_kind: InboxTargetKind
    suggested_target_href: str | None = None
    suggested_property: InboxTriageMatch | None = None
    suggested_tenant: InboxTriageMatch | None = None
    suggested_lease: InboxTriageMatch | None = None
    suggested_contractor: InboxTriageMatch | None = None
    key_facts: list[InboxKeyFact] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    response_id: str | None = None


# Promote — v2 of the inbox processor. The operator reviews the AI
# classification, confirms or overrides the matched property/tenant/lease,
# and clicks Promote. The backend creates a draft in the appropriate
# Leasium surface (no provider mutation; the draft sits in its initial
# review state until the operator approves the next step from inside that
# surface).
InboxPromoteKind = Literal[
    "maintenance_request",
    "payment_or_arrears",
    "lease_change",
    "tenant_contact",
    "vendor_or_contractor",
    "property_update",
    "compliance_or_insurance",
    "task_or_reminder",
    "owner_or_entity_admin",
]


InboxPromoteTargetKind = Literal[
    "maintenance_work_order",
    "arrears_case",
    "document_intake",
    "tenant",
    "contractor",
]

TenantContactField = Literal[
    "contact_name",
    "contact_email",
    "contact_phone",
    "billing_email",
]


class InboxTenantContactPreviewRequest(BaseModel):
    entity_id: UUID
    tenant_id: UUID
    body: str = Field(min_length=10, max_length=8000)


class InboxTenantContactFieldProposal(BaseModel):
    field: TenantContactField
    label: str
    current_value: str | None = None
    proposed_value: str
    selected_by_default: bool = True


class InboxTenantContactPreviewRead(BaseModel):
    tenant: InboxTriageMatch
    summary: str
    confidence: float | None = None
    proposed_updates: list[InboxTenantContactFieldProposal] = Field(
        default_factory=list
    )
    warnings: list[str] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    response_id: str | None = None


class InboxPromoteRequest(BaseModel):
    entity_id: UUID
    kind: InboxPromoteKind
    summary: str = Field(min_length=1, max_length=400)
    body: str = Field(min_length=10, max_length=8000)
    inbound_message_id: UUID | None = None
    property_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    contractor_id: UUID | None = None
    tenant_contact_updates: dict[str, str | None] = Field(default_factory=dict)


class InboxPromoteRead(BaseModel):
    target_kind: InboxPromoteTargetKind
    target_id: UUID
    target_href: str
    target_label: str
