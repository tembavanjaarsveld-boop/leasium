"""Schemas for organisation, entity, property, and tenancy unit registers."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field
from stewart.core.models import (
    BillingDraftStatus,
    EntityType,
    GstTreatment,
    InvoiceDraftStatus,
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
    entity_type: EntityType | None = None
    is_managing_entity: bool | None = None
    notes: str | None = None


class EntityUpdate(BaseModel):
    name: str | None = None
    abn: str | None = None
    gst_registered: bool | None = None
    entity_type: EntityType | None = None
    is_managing_entity: bool | None = None
    notes: str | None = None


class EntityRead(ApiModel):
    id: UUID
    organisation_id: UUID
    name: str
    abn: str | None
    gst_registered: bool
    entity_type: EntityType | None
    is_managing_entity: bool | None
    xero_tenant_id: str | None
    xero_connected_at: datetime | None
    xero_last_sync_at: datetime | None
    notes: str | None
    created_at: datetime
    deleted_at: datetime | None


EntityXeroStatus = Literal["connected", "token_expired", "manual", "not_connected"]


class EntityXeroStatusRead(ApiModel):
    id: UUID
    name: str
    entity_type: EntityType | None
    is_managing_entity: bool | None
    property_count: int
    xero_status: EntityXeroStatus
    tenant_name: str | None
    last_sync_at: datetime | None
    token_expires_at: datetime | None


class EntityXeroOverviewSummary(ApiModel):
    total: int
    connected: int
    token_expired: int
    manual: int
    not_connected: int


class EntityXeroOverviewRead(ApiModel):
    summary: EntityXeroOverviewSummary
    entities: list[EntityXeroStatusRead]


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


class TenantContactChangeRequestAction(BaseModel):
    notes: str | None = None


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


class TenantLeaseContextRead(BaseModel):
    lease_id: UUID
    status: LeaseStatus
    property_id: UUID
    property_name: str
    property_address: str | None
    property_type: PropertyType
    tenancy_unit_id: UUID
    unit_label: str
    commencement_date: date | None
    expiry_date: date | None
    annual_rent_cents: int | None
    rent_frequency: RentFrequency | None
    outgoings_recoverable: bool
    next_review_date: date | None


class TenantActivityItemRead(BaseModel):
    occurred_at: datetime
    kind: str
    label: str
    detail: str | None = None
    source: str
    related_id: UUID | None = None
    tone: str = "neutral"


class TenantReviewedFieldChangeRead(BaseModel):
    field: str
    label: str
    before: Any = None
    after: Any = None


class TenantReviewedChangeRead(BaseModel):
    occurred_at: datetime
    source: str
    source_label: str
    source_id: UUID | None = None
    status: str
    notes: str | None = None
    changes: list[TenantReviewedFieldChangeRead] = Field(default_factory=list)


class TenantPortalAccountRead(BaseModel):
    id: UUID
    tenant_id: UUID
    tenant_onboarding_id: UUID | None = None
    auth_provider: str
    auth_provider_id: str
    email: str | None = None
    status: str
    linked_at: datetime
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    deleted_at: datetime | None = None
    recovery_action: str | None = None
    recovery_reason: str | None = None
    recovery_at: datetime | None = None


class TenantPortalAccountAction(BaseModel):
    reason: str | None = None


class TenantDetailRead(BaseModel):
    tenant: TenantRead
    leases: list[TenantLeaseContextRead] = Field(default_factory=list)
    activity: list[TenantActivityItemRead] = Field(default_factory=list)
    reviewed_changes: list[TenantReviewedChangeRead] = Field(default_factory=list)


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
    next_review_date: date | None
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


class BillingDraftFromChargeRulesCreate(BaseModel):
    entity_id: UUID
    lease_ids: list[UUID] | None = None
    as_of: date | None = None


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


class BillingDraftBatchSkippedRead(BaseModel):
    lease_id: UUID | None = None
    tenant_name: str | None = None
    property_name: str | None = None
    unit_label: str | None = None
    reason: str


class BillingDraftBatchRead(BaseModel):
    created: int
    existing: int
    skipped: int
    drafts: list[BillingDraftRead]
    skipped_rows: list[BillingDraftBatchSkippedRead]


class InvoiceDraftLineRead(ApiModel):
    id: UUID
    invoice_draft_id: UUID
    billing_draft_line_id: UUID | None
    description: str
    amount_cents: int
    gst_cents: int
    currency: str
    source_hint: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("line_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    deleted_at: datetime | None


class InvoiceDraftUpdate(BaseModel):
    status: InvoiceDraftStatus | None = None
    notes: str | None = None


class InvoiceDraftDeliverySendRecord(BaseModel):
    method: Literal["manual"] = "manual"
    sent_at: datetime | None = None
    notes: str | None = None


class InvoiceDraftPaymentStatusUpdate(BaseModel):
    status: Literal["unpaid", "partially_paid", "paid"]
    paid_cents: int | None = Field(default=None, ge=0)
    paid_at: datetime | None = None
    notes: str | None = None


class InvoiceDraftRead(ApiModel):
    id: UUID
    entity_id: UUID
    billing_draft_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    tenant_id: UUID | None
    lease_id: UUID | None
    document_id: UUID
    document_intake_id: UUID | None
    status: InvoiceDraftStatus
    invoice_number: str | None
    title: str
    currency: str
    issue_date: date | None
    due_date: date | None
    subtotal_cents: int
    gst_cents: int
    total_cents: int
    issuer_name: str | None
    issuer_abn: str | None
    recipient_name: str | None
    recipient_email: str | None
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("invoice_metadata", "metadata"),
        serialization_alias="metadata",
    )
    lines: list[InvoiceDraftLineRead]
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


class LeaseEventFollowUpRunCreate(BaseModel):
    entity_id: UUID
    property_ids: list[UUID] = Field(default_factory=list)
    as_of: date | None = None
    horizon_days: int = Field(default=90, ge=1, le=365)


class LeaseEventFollowUpSkippedRead(BaseModel):
    lease_id: UUID
    property_id: UUID
    tenancy_unit_id: UUID
    category: ObligationCategory
    due_date: date
    reason: Literal["existing_obligation"]
    obligation_id: UUID


class LeaseEventFollowUpRunRead(BaseModel):
    entity_id: UUID
    as_of: date
    horizon_days: int
    property_ids: list[UUID] = Field(default_factory=list)
    created_count: int
    skipped_count: int
    guardrails: list[str] = Field(default_factory=list)
    created: list[ObligationRead] = Field(default_factory=list)
    skipped: list[LeaseEventFollowUpSkippedRead] = Field(default_factory=list)
