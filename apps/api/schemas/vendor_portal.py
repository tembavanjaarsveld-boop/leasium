"""Schemas for the read-only vendor portal preview."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field
from stewart.core.models import MaintenancePriority, MaintenanceWorkOrderStatus


class VendorPortalAuthRead(BaseModel):
    """Auth boundary presented to the vendor portal UI."""

    mode: Literal["operator_preview", "vendor_portal_account"]
    token_source: Literal["bearer"]
    vendor_auth_configured: bool
    boundary: str
    detail: str


class VendorPortalVendorRead(BaseModel):
    """Portal-safe vendor identity projection."""

    id: UUID
    entity_id: UUID
    name: str
    company_name: str | None = None
    categories: list[str] = Field(default_factory=list)
    email: str | None = None
    phone: str | None = None
    service_radius_km: int | None = None
    priority: int


class VendorPortalCommentRead(BaseModel):
    """Contractor-visible work order comment."""

    body: str
    timestamp: str | None = None
    author: Literal["contractor", "property_team"] = "property_team"
    author_label: str = "Property team"


class VendorPortalWorkOrderItemRead(BaseModel):
    """Vendor-safe work order without tenant, provider, or payment detail."""

    id: UUID
    property_id: UUID
    property_name: str
    title: str
    status: MaintenanceWorkOrderStatus
    priority: MaintenancePriority
    requested_at: datetime
    due_date: date | None = None
    contractor_assigned_at: datetime | None = None
    quote_amount_cents: int | None = None
    photo_count: int = 0
    comments: list[VendorPortalCommentRead] = Field(default_factory=list)


class VendorPortalWorkOrdersRead(BaseModel):
    """Open vendor-visible work order snapshot."""

    open_count: int
    urgent_count: int
    overdue_count: int
    items: list[VendorPortalWorkOrderItemRead] = Field(default_factory=list)


class VendorPortalRead(BaseModel):
    """Read response for an operator-previewed vendor portal."""

    auth: VendorPortalAuthRead
    vendor: VendorPortalVendorRead
    work_orders: VendorPortalWorkOrdersRead = Field(
        default_factory=lambda: VendorPortalWorkOrdersRead(
            open_count=0,
            urgent_count=0,
            overdue_count=0,
            items=[],
        )
    )
    guardrails: list[str] = Field(default_factory=list)
    generated_at: datetime


class VendorPortalWorkOrderMessagesRead(BaseModel):
    """Message thread for one work order shared to the signed-in contractor."""

    work_order_id: UUID
    title: str
    messages: list[VendorPortalCommentRead] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    generated_at: datetime


class VendorPortalInviteRead(BaseModel):
    """Local one-time vendor portal claim link (no email is sent)."""

    contractor_id: UUID
    vendor_display_name: str
    claim_email: str
    portal_token: str
    claim_url: str
    expires_at: datetime
    guardrails: list[str] = Field(default_factory=list)


class VendorPortalInvitePreviewRead(BaseModel):
    """Safe context for the public vendor account claim gate."""

    vendor_display_name: str
    claim_email: str
    expires_at: datetime
    claimable: bool


class VendorPortalAccountClaimCreate(BaseModel):
    """Body for a Clerk-bearer vendor portal account claim."""

    portal_token: str = Field(min_length=1)


class VendorPortalAccountLifecycleRead(BaseModel):
    """Lifecycle/recovery state for a signed-in vendor portal account."""

    status: Literal["active", "revoked", "unlinked"]
    contractor_id: UUID | None = None
    vendor_name: str | None = None
    email: str | None = None
    linked_at: datetime | None = None
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    recovery_hint: str | None = None


class VendorPortalCommentCreate(BaseModel):
    """A contractor-posted update on a shared work order."""

    body: str = Field(min_length=1, max_length=2000)
