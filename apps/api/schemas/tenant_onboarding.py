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


class TenantOnboardingRead(ApiModel):
    id: UUID
    entity_id: UUID
    lease_id: UUID
    tenant_id: UUID
    token: str
    status: TenantOnboardingStatus
    due_date: date | None
    onboarding_url: str = ""
    submitted_data: dict[str, Any] = Field(default_factory=dict)
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class TenantOnboardingPublicRead(BaseModel):
    token: str
    status: TenantOnboardingStatus
    tenant_legal_name: str
    tenant_trading_name: str | None
    contact_name: str | None
    contact_email: str | None
    contact_phone: str | None
    billing_email: str | None
    lease_commencement_date: date | None
    lease_expiry_date: date | None
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
