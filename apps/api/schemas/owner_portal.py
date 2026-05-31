"""Schemas for the read-only owner portal preview."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class OwnerPortalAuthRead(BaseModel):
    """Auth boundary presented to the owner portal UI."""

    mode: str
    boundary: str
    detail: str


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
