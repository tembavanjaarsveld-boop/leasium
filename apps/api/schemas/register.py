"""Schemas for organisation, entity, property, and tenancy unit registers."""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field
from stewart.core.models import (
    BillingDraftStatus,
    GstTreatment,
    LeaseStatus,
    ObligationCategory,
    ObligationStatus,
    PropertyType,
    RentChargeType,
    RentFrequency,
    UserRole,
)

from apps.api.schemas.common import ApiModel


class OrganisationCreate(BaseModel):
    name: str
    country_code: str = "AU"
    timezone: str = "Australia/Brisbane"


class OrganisationUpdate(BaseModel):
    name: str | None = None
    country_code: str | None = None
    timezone: str | None = None


class OrganisationRead(ApiModel):
    id: UUID
    name: str
    country_code: str
    timezone: str
    created_at: datetime


class EntityCreate(BaseModel):
    organisation_id: UUID
    name: str
    abn: str | None = None
    gst_registered: bool = True
    notes: str | None = None


class EntityUpdate(BaseModel):
    name: str | None = None
    abn: str | None = None
    gst_registered: bool | None = None
    notes: str | None = None


class EntityRead(ApiModel):
    id: UUID
    organisation_id: UUID
    name: str
    abn: str | None
    gst_registered: bool
    xero_tenant_id: str | None
    xero_connected_at: datetime | None
    xero_last_sync_at: datetime | None
    notes: str | None
    created_at: datetime
    deleted_at: datetime | None


class PropertyCreate(BaseModel):
    entity_id: UUID
    name: str
    street_address: str
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    country_code: str = "AU"
    property_type: PropertyType
    parcel_id: str | None = None
    land_sqm: float | None = None
    building_sqm: float | None = None
    parking_spaces: int | None = None
    has_solar_pv: bool = False
    ownership_structure: str | None = None
    owner_legal_name: str | None = None
    owner_abn: str | None = None
    trustee_name: str | None = None
    trust_name: str | None = None
    invoice_issuer_name: str | None = None
    billing_contact_name: str | None = None
    billing_email: str | None = None
    invoice_reference: str | None = None
    ownership_split: str | None = None
    owner_gst_registered: bool | None = None
    xero_contact_id: str | None = None
    xero_tracking_category: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PropertyUpdate(BaseModel):
    name: str | None = None
    street_address: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    country_code: str | None = None
    property_type: PropertyType | None = None
    parcel_id: str | None = None
    land_sqm: float | None = None
    building_sqm: float | None = None
    parking_spaces: int | None = None
    has_solar_pv: bool | None = None
    ownership_structure: str | None = None
    owner_legal_name: str | None = None
    owner_abn: str | None = None
    trustee_name: str | None = None
    trust_name: str | None = None
    invoice_issuer_name: str | None = None
    billing_contact_name: str | None = None
    billing_email: str | None = None
    invoice_reference: str | None = None
    ownership_split: str | None = None
    owner_gst_registered: bool | None = None
    xero_contact_id: str | None = None
    xero_tracking_category: str | None = None
    metadata: dict[str, Any] | None = None


class PropertyRead(ApiModel):
    id: UUID
    entity_id: UUID
    name: str
    street_address: str
    suburb: str | None
    state: str | None
    postcode: str | None
    country_code: str
    property_type: PropertyType
    parcel_id: str | None
    land_sqm: float | None
    building_sqm: float | None
    parking_spaces: int | None
    has_solar_pv: bool
    ownership_structure: str | None
    owner_legal_name: str | None
    owner_abn: str | None
    trustee_name: str | None
    trust_name: str | None
    invoice_issuer_name: str | None
    billing_contact_name: str | None
    billing_email: str | None
    invoice_reference: str | None
    ownership_split: str | None
    owner_gst_registered: bool | None
    xero_contact_id: str | None
    xero_tracking_category: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("property_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class TenancyUnitCreate(BaseModel):
    property_id: UUID
    unit_label: str
    sqm: float | None = None
    parking_spaces: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TenancyUnitUpdate(BaseModel):
    unit_label: str | None = None
    sqm: float | None = None
    parking_spaces: int | None = None
    metadata: dict[str, Any] | None = None


class TenancyUnitRead(ApiModel):
    id: UUID
    property_id: UUID
    unit_label: str
    sqm: float | None
    parking_spaces: int | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("unit_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    deleted_at: datetime | None


class TenantCreate(BaseModel):
    entity_id: UUID
    legal_name: str
    trading_name: str | None = None
    abn: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    billing_email: str | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TenantUpdate(BaseModel):
    legal_name: str | None = None
    trading_name: str | None = None
    abn: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    billing_email: str | None = None
    notes: str | None = None
    metadata: dict[str, Any] | None = None


class TenantRead(ApiModel):
    id: UUID
    entity_id: UUID
    legal_name: str
    trading_name: str | None
    abn: str | None
    contact_name: str | None
    contact_email: str | None
    contact_phone: str | None
    billing_email: str | None
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("tenant_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class LeaseCreate(BaseModel):
    tenancy_unit_id: UUID
    tenant_id: UUID
    status: LeaseStatus = LeaseStatus.pending
    commencement_date: date | None = None
    expiry_date: date | None = None
    annual_rent_cents: int | None = None
    rent_frequency: RentFrequency | None = None
    outgoings_recoverable: bool = True
    next_review_date: date | None = None
    option_summary: str | None = None
    security_summary: str | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LeaseUpdate(BaseModel):
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    status: LeaseStatus | None = None
    commencement_date: date | None = None
    expiry_date: date | None = None
    annual_rent_cents: int | None = None
    rent_frequency: RentFrequency | None = None
    outgoings_recoverable: bool | None = None
    next_review_date: date | None = None
    option_summary: str | None = None
    security_summary: str | None = None
    notes: str | None = None
    metadata: dict[str, Any] | None = None


class LeaseRead(ApiModel):
    id: UUID
    tenancy_unit_id: UUID
    tenant_id: UUID
    status: LeaseStatus
    commencement_date: date | None
    expiry_date: date | None
    annual_rent_cents: int | None
    rent_frequency: RentFrequency | None
    outgoings_recoverable: bool
    next_review_date: date | None
    option_summary: str | None
    security_summary: str | None
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("lease_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class RentChargeRuleCreate(BaseModel):
    lease_id: UUID
    charge_type: RentChargeType
    amount_cents: int
    frequency: RentFrequency
    gst_treatment: GstTreatment = GstTreatment.taxable
    xero_account_code: str | None = None
    xero_tax_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    next_due_date: date | None = None
    arrears_or_advance: str = "advance"
    metadata: dict[str, Any] = Field(default_factory=dict)


class RentChargeRuleUpdate(BaseModel):
    charge_type: RentChargeType | None = None
    amount_cents: int | None = None
    frequency: RentFrequency | None = None
    gst_treatment: GstTreatment | None = None
    xero_account_code: str | None = None
    xero_tax_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    next_due_date: date | None = None
    arrears_or_advance: str | None = None
    metadata: dict[str, Any] | None = None


class RentChargeRuleRead(ApiModel):
    id: UUID
    lease_id: UUID
    charge_type: RentChargeType
    amount_cents: int
    frequency: RentFrequency
    gst_treatment: GstTreatment
    xero_account_code: str | None
    xero_tax_type: str | None
    start_date: date | None
    end_date: date | None
    next_due_date: date | None
    arrears_or_advance: str
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("charge_rule_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class RentRollChargeRuleRead(ApiModel):
    id: UUID
    charge_type: RentChargeType
    amount_cents: int
    frequency: RentFrequency
    gst_treatment: GstTreatment
    xero_account_code: str | None
    xero_tax_type: str | None
    start_date: date | None
    end_date: date | None
    next_due_date: date | None
    arrears_or_advance: str


class RentRollRowRead(BaseModel):
    entity_id: UUID
    entity_name: str
    property_id: UUID
    property_name: str
    tenancy_unit_id: UUID
    unit_label: str
    lease_id: UUID | None
    tenant_id: UUID | None
    tenant_name: str | None
    lease_status: LeaseStatus | None
    commencement_date: date | None
    expiry_date: date | None
    tenant_billing_email: str | None
    annual_rent_cents: int | None
    rent_frequency: RentFrequency | None
    charge_rules: list[RentRollChargeRuleRead]
    charge_rules_total_cents: int
    next_due_date: date | None
    gst_readiness_blockers: list[str]
    xero_readiness_blockers: list[str]
    invoice_readiness_blockers: list[str]
    readiness_blockers: list[str]


class BillingDraftLineRead(ApiModel):
    id: UUID
    billing_draft_id: UUID
    description: str
    amount_cents: int
    currency: str
    source_hint: str | None
    confidence: float | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("line_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    deleted_at: datetime | None


class BillingDraftUpdate(BaseModel):
    status: BillingDraftStatus | None = None
    notes: str | None = None


class BillingDraftRead(ApiModel):
    id: UUID
    entity_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    tenant_id: UUID | None
    lease_id: UUID | None
    document_id: UUID
    document_intake_id: UUID | None
    status: BillingDraftStatus
    title: str
    currency: str
    issue_date: date | None
    due_date: date | None
    total_cents: int
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("billing_metadata", "metadata"),
        serialization_alias="metadata",
    )
    lines: list[BillingDraftLineRead]
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class ObligationCreate(BaseModel):
    entity_id: UUID
    title: str
    category: ObligationCategory = ObligationCategory.other
    status: ObligationStatus = ObligationStatus.upcoming
    due_date: date
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    lease_id: UUID | None = None
    completed_at: datetime | None = None
    priority: int = 2
    owner_role: UserRole | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ObligationUpdate(BaseModel):
    entity_id: UUID | None = None
    title: str | None = None
    category: ObligationCategory | None = None
    status: ObligationStatus | None = None
    due_date: date | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    lease_id: UUID | None = None
    completed_at: datetime | None = None
    priority: int | None = None
    owner_role: UserRole | None = None
    notes: str | None = None
    metadata: dict[str, Any] | None = None


class ObligationRead(ApiModel):
    id: UUID
    entity_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    lease_id: UUID | None
    title: str
    category: ObligationCategory
    status: ObligationStatus
    due_date: date
    completed_at: datetime | None
    priority: int
    owner_role: UserRole | None
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("obligation_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
