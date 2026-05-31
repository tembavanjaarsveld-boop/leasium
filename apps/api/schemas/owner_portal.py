"""Schemas for the read-only owner portal preview."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


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


class OwnerPortalRead(BaseModel):
    """Read response for an operator-previewed owner portal."""

    auth: OwnerPortalAuthRead
    owner: OwnerPortalOwnerRead
    properties: list[OwnerPortalPropertyRead] = Field(default_factory=list)
    statement: OwnerPortalStatementRead | None = None
    guardrails: list[str] = Field(default_factory=list)
    generated_at: datetime
