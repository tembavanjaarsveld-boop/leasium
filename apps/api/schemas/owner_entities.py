"""Schemas for the first-class Owner entity (DoorLoop benchmark P0).

Distinct from owner *statements* (``schemas/owners.py``, which derives owners
from ``Property`` fields). These back the Owner CRUD API and the People hub
Owners directory.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OwnerBase(BaseModel):
    legal_name: str | None = None
    abn: str | None = None
    trustee_name: str | None = None
    trust_name: str | None = None
    invoice_issuer_name: str | None = None
    billing_contact_name: str | None = None
    billing_email: str | None = None
    invoice_reference: str | None = None
    gst_registered: bool | None = None
    xero_contact_id: str | None = None


class OwnerCreate(OwnerBase):
    entity_id: UUID


class OwnerUpdate(BaseModel):
    """Partial update — every field optional so a PATCH only touches supplied keys."""

    legal_name: str | None = None
    abn: str | None = None
    trustee_name: str | None = None
    trust_name: str | None = None
    invoice_issuer_name: str | None = None
    billing_contact_name: str | None = None
    billing_email: str | None = None
    invoice_reference: str | None = None
    gst_registered: bool | None = None
    xero_contact_id: str | None = None


class OwnerPropertyLinkRead(BaseModel):
    property_id: UUID
    property_name: str
    split_pct: float


class OwnerRead(OwnerBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_id: UUID
    created_at: datetime
    updated_at: datetime
    property_count: int = 0
    properties: list[OwnerPropertyLinkRead] = Field(default_factory=list)


class OwnerPropertyLinkCreate(BaseModel):
    """Attach (or re-split) a property on an owner."""

    property_id: UUID
    split_pct: float = 100
