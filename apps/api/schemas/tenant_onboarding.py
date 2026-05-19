"""Schemas for tenant onboarding links and submissions."""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field
from stewart.core.models import TenantOnboardingStatus

from apps.api.schemas.common import ApiModel


class TenantOnboardingCreate(BaseModel):
    lease_id: UUID
    due_date: date | None = None
    expires_at: datetime | None = None


class TenantOnboardingCancel(BaseModel):
    reason: str | None = None


class TenantOnboardingReview(BaseModel):
    approved: bool = True
    notes: str | None = None


class TenantOnboardingReminderRunRead(BaseModel):
    checked: int
    sent: int
    skipped: int
    onboarding_ids: list[UUID] = Field(default_factory=list)


class TenantOnboardingRead(ApiModel):
    id: UUID
    entity_id: UUID
    lease_id: UUID
    tenant_id: UUID
    token: str
    status: TenantOnboardingStatus
    due_date: date | None
    expires_at: datetime | None
    last_sent_at: datetime | None
    resent_at: datetime | None
    cancel_reason: str | None
    onboarding_url: str = ""
    submitted_data: dict[str, Any] = Field(default_factory=dict)
    submitted_at: datetime | None
    review_data: dict[str, Any] = Field(default_factory=dict)
    delivery_data: dict[str, Any] = Field(default_factory=dict)
    reviewed_at: datetime | None
    reviewed_by_user_id: UUID | None
    applied_at: datetime | None
    applied_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class TenantOnboardingPublicRead(BaseModel):
    token: str
    status: TenantOnboardingStatus
    tenant_legal_name: str
    tenant_trading_name: str | None
    property_name: str
    property_address: str | None
    unit_label: str
    contact_name: str | None
    contact_email: str | None
    contact_phone: str | None
    billing_email: str | None
    lease_commencement_date: date | None
    lease_expiry_date: date | None
    due_date: date | None
    expires_at: datetime | None
    submitted_at: datetime | None


class TenantOnboardingSubmit(BaseModel):
    legal_name: str
    trading_name: str | None = None
    abn: str | None = None
    contact_name: str
    contact_email: str
    contact_phone: str | None = None
    billing_email: str | None = None
    insurance_confirmed: bool = False
    insurance_expiry_date: date | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    notes: str | None = None
    accepted: bool
