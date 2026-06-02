"""Schemas for the read-only owner portal preview."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator
from stewart.core.models import (
    ComplianceCheckKind,
    ComplianceCheckStatus,
    DocumentCategory,
    MaintenanceApprovalStatus,
    MaintenancePriority,
    MaintenanceWorkOrderStatus,
)


class OwnerPortalAuthRead(BaseModel):
    """Auth boundary presented to the owner portal UI."""

    mode: Literal["operator_preview", "owner_portal_account"]
    token_source: Literal["bearer"]
    owner_auth_configured: bool
    boundary: str
    detail: str


class OwnerPortalInviteRead(BaseModel):
    """Operator-created owner portal claim link.

    The raw token is returned once so the operator can copy the link. Only a
    hash is stored server-side.
    """

    owner_id: UUID
    owner_display_name: str
    claim_email: str
    portal_token: str
    claim_url: str
    expires_at: datetime
    guardrails: list[str] = Field(default_factory=list)


class OwnerPortalInvitePreviewRead(BaseModel):
    """Public, minimum-viable owner context for the claim gate."""

    owner_display_name: str
    claim_email: str
    expires_at: datetime
    claimable: bool


class OwnerPortalAccountClaimCreate(BaseModel):
    portal_token: str

    @field_validator("portal_token", mode="before")
    @classmethod
    def _required_token(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Owner portal token is required.")
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Owner portal token is required.")
        return cleaned


class OwnerPortalAccountLifecycleRead(BaseModel):
    status: Literal["unlinked", "active", "revoked"]
    owner_id: UUID | None = None
    owner_name: str | None = None
    email: str | None = None
    linked_at: datetime | None = None
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    recovery_hint: str


class OwnerPortalOwnerRead(BaseModel):
    """Portal-safe owner identity projection."""

    id: UUID
    entity_id: UUID
    display_name: str
    legal_name: str | None = None
    abn: str | None = None
    trustee_name: str | None = None
    trust_name: str | None = None
    invoice_issuer_name: str | None = None
    billing_contact_name: str | None = None
    billing_email: str | None = None
    invoice_reference: str | None = None
    gst_registered: bool | None = None


class OwnerPortalPropertyRead(BaseModel):
    """Linked property shown in the owner portal."""

    property_id: UUID
    property_name: str
    split_pct: float


class OwnerPortalStatementPropertyRead(BaseModel):
    """Portal-safe statement line without provider evidence identifiers."""

    property_id: UUID
    property_name: str
    invoiced_cents: int
    paid_cents: int
    outstanding_cents: int
    invoice_count: int


class OwnerPortalStatementRead(BaseModel):
    """Monthly owner statement projection for the portal."""

    month: str
    owner_identity: str
    property_count: int
    properties: list[OwnerPortalStatementPropertyRead] = Field(default_factory=list)
    invoiced_cents: int
    paid_cents: int
    outstanding_cents: int
    invoice_count: int


class OwnerPortalDocumentRead(BaseModel):
    """Owner-visible property document metadata without raw file bytes."""

    id: UUID
    property_id: UUID
    property_name: str
    filename: str
    content_type: str | None
    byte_size: int
    category: DocumentCategory
    notes: str | None
    source_label: str
    created_at: datetime


class OwnerPortalMaintenanceItemRead(BaseModel):
    """Owner-safe maintenance item without tenant, contractor, or provider detail."""

    id: UUID
    property_id: UUID
    property_name: str
    title: str
    status: MaintenanceWorkOrderStatus
    priority: MaintenancePriority
    requested_at: datetime
    due_date: date | None = None
    completed_at: datetime | None = None
    approval_required: bool
    approval_status: MaintenanceApprovalStatus
    quote_amount_cents: int | None = None


class OwnerPortalMaintenanceRead(BaseModel):
    """Open maintenance snapshot for linked owner properties."""

    open_count: int
    urgent_count: int
    awaiting_approval_count: int
    items: list[OwnerPortalMaintenanceItemRead] = Field(default_factory=list)


class OwnerPortalLeaseEventRead(BaseModel):
    """Owner-safe lease event without tenant identity or lease notes."""

    lease_id: UUID
    property_id: UUID
    property_name: str
    unit_label: str
    event_kind: Literal["rent_review", "lease_expiry"]
    event_date: date
    lease_status: str
    annual_rent_cents: int | None = None


class OwnerPortalLeaseEventsRead(BaseModel):
    """Upcoming rent-review and expiry snapshot for linked owner properties."""

    upcoming_count: int
    rent_review_count: int
    expiry_count: int
    events: list[OwnerPortalLeaseEventRead] = Field(default_factory=list)


class OwnerPortalComplianceItemRead(BaseModel):
    """Owner-safe compliance item without tenant, source document, or operator detail."""

    id: UUID
    property_id: UUID
    property_name: str
    title: str
    kind: ComplianceCheckKind
    status: ComplianceCheckStatus
    due_status: Literal["overdue", "due_soon", "upcoming"]
    next_due_date: date
    certificate_expires_on: date | None = None
    last_checked_at: datetime | None = None
    evidence_status: Literal["linked", "missing"]


class OwnerPortalComplianceRead(BaseModel):
    """Owner-safe compliance snapshot for linked owner properties."""

    open_count: int
    overdue_count: int
    due_soon_count: int
    missing_evidence_count: int
    items: list[OwnerPortalComplianceItemRead] = Field(default_factory=list)


class OwnerPortalRead(BaseModel):
    """Read response for an operator-previewed owner portal."""

    auth: OwnerPortalAuthRead
    owner: OwnerPortalOwnerRead
    properties: list[OwnerPortalPropertyRead] = Field(default_factory=list)
    statement: OwnerPortalStatementRead | None = None
    documents: list[OwnerPortalDocumentRead] = Field(default_factory=list)
    maintenance: OwnerPortalMaintenanceRead = Field(
        default_factory=lambda: OwnerPortalMaintenanceRead(
            open_count=0,
            urgent_count=0,
            awaiting_approval_count=0,
            items=[],
        )
    )
    lease_events: OwnerPortalLeaseEventsRead = Field(
        default_factory=lambda: OwnerPortalLeaseEventsRead(
            upcoming_count=0,
            rent_review_count=0,
            expiry_count=0,
            events=[],
        )
    )
    compliance: OwnerPortalComplianceRead = Field(
        default_factory=lambda: OwnerPortalComplianceRead(
            open_count=0,
            overdue_count=0,
            due_soon_count=0,
            missing_evidence_count=0,
            items=[],
        )
    )
    guardrails: list[str] = Field(default_factory=list)
    generated_at: datetime
