"""Schemas for the read-only vendor portal preview."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field
from stewart.core.models import MaintenancePriority, MaintenanceWorkOrderStatus


class VendorPortalAuthRead(BaseModel):
    """Auth boundary presented to the vendor portal UI."""

    mode: Literal["operator_preview"]
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
