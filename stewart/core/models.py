"""Phase 0 SQLAlchemy models."""

import enum
from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    ARRAY,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, TypeDecorator

from stewart.core.db import Base, utcnow
from stewart.core.ids import uuid7


class JsonbCompat(TypeDecorator[dict[str, Any]]):
    """Use PostgreSQL JSONB in production and JSON elsewhere for tests."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect: Any) -> Any:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB)
        return dialect.type_descriptor(JSON)


class IntArrayCompat(TypeDecorator[list[int]]):
    """Use PostgreSQL integer arrays in production and JSON elsewhere for tests."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect: Any) -> Any:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(ARRAY(Integer))
        return dialect.type_descriptor(JSON)


class UserRole(enum.StrEnum):
    owner = "owner"
    admin = "admin"
    finance = "finance"
    ops = "ops"
    viewer = "viewer"
    agent = "agent"


class OperatorInviteStatus(enum.StrEnum):
    not_sent = "not_sent"
    sent = "sent"
    accepted = "accepted"
    expired = "expired"
    revoked = "revoked"
    failed = "failed"
    skipped = "skipped"


class PropertyType(enum.StrEnum):
    commercial_office = "commercial_office"
    commercial_retail = "commercial_retail"
    commercial_industrial = "commercial_industrial"
    mixed_use = "mixed_use"
    vacant_land = "vacant_land"
    childcare = "childcare"
    hospitality = "hospitality"
    other = "other"


class LeaseStatus(enum.StrEnum):
    pending = "pending"
    active = "active"
    holding_over = "holding_over"
    expired = "expired"
    terminated = "terminated"


class RentFrequency(enum.StrEnum):
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"
    annual = "annual"


class RentChargeType(enum.StrEnum):
    base_rent = "base_rent"
    outgoings = "outgoings"
    promotion_levy = "promotion_levy"
    utilities = "utilities"
    parking = "parking"
    storage = "storage"
    other = "other"


class GstTreatment(enum.StrEnum):
    taxable = "taxable"
    gst_free = "gst_free"
    input_taxed = "input_taxed"
    out_of_scope = "out_of_scope"


class ObligationCategory(enum.StrEnum):
    lease_expiry = "lease_expiry"
    rent_review = "rent_review"
    option_notice = "option_notice"
    insurance = "insurance"
    bank_guarantee = "bank_guarantee"
    make_good = "make_good"
    compliance = "compliance"
    maintenance = "maintenance"
    other = "other"


class ObligationStatus(enum.StrEnum):
    upcoming = "upcoming"
    due_soon = "due_soon"
    overdue = "overdue"
    completed = "completed"
    waived = "waived"
    disputed = "disputed"


class LeaseIntakeStatus(enum.StrEnum):
    uploaded = "uploaded"
    extracting = "extracting"
    extracted = "extracted"
    extraction_failed = "extraction_failed"
    applied = "applied"
    apply_failed = "apply_failed"


class TenantOnboardingStatus(enum.StrEnum):
    draft = "draft"
    sent = "sent"
    submitted = "submitted"
    reviewed = "reviewed"
    applied = "applied"
    cancelled = "cancelled"


class DocumentCategory(enum.StrEnum):
    lease = "lease"
    insurance = "insurance"
    bank_guarantee = "bank_guarantee"
    onboarding = "onboarding"
    invoice = "invoice"
    other = "other"


class DocumentIntakeStatus(enum.StrEnum):
    uploaded = "uploaded"
    reading = "reading"
    ready_for_review = "ready_for_review"
    needs_attention = "needs_attention"
    applied = "applied"
    failed = "failed"


class BillingDraftStatus(enum.StrEnum):
    draft = "draft"
    needs_review = "needs_review"
    approved = "approved"
    void = "void"


class InvoiceDraftStatus(enum.StrEnum):
    draft = "draft"
    ready_for_approval = "ready_for_approval"
    approved = "approved"
    void = "void"


class AuditOutcome(enum.StrEnum):
    success = "success"
    error = "error"
    blocked = "blocked"
    rejected = "rejected"


class Organisation(Base):
    __tablename__ = "organisation"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="AU")
    timezone: Mapped[str] = mapped_column(Text, nullable=False, default="Australia/Brisbane")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    entities: Mapped[list["Entity"]] = relationship(back_populates="organisation")


class Entity(Base):
    __tablename__ = "entity"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    organisation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organisation.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    abn: Mapped[str | None] = mapped_column(Text)
    gst_registered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    xero_tenant_id: Mapped[str | None] = mapped_column(Text)
    xero_connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    xero_last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    organisation: Mapped[Organisation] = relationship(back_populates="entities")
    properties: Mapped[list["Property"]] = relationship(back_populates="entity")
    tenants: Mapped[list["Tenant"]] = relationship(back_populates="entity")
    obligations: Mapped[list["Obligation"]] = relationship(back_populates="entity")
    lease_intakes: Mapped[list["LeaseIntake"]] = relationship(back_populates="entity")
    tenant_onboardings: Mapped[list["TenantOnboarding"]] = relationship(back_populates="entity")
    documents: Mapped[list["StoredDocument"]] = relationship(back_populates="entity")
    document_intakes: Mapped[list["DocumentIntake"]] = relationship(back_populates="entity")
    billing_drafts: Mapped[list["BillingDraft"]] = relationship(back_populates="entity")
    invoice_drafts: Mapped[list["InvoiceDraft"]] = relationship(back_populates="entity")


Index("entity_org_idx", Entity.organisation_id, postgresql_where=Entity.deleted_at.is_(None))


class AppUser(Base):
    __tablename__ = "app_user"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    organisation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organisation.id"), nullable=False
    )
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    auth_provider_id: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    invite_status: Mapped[OperatorInviteStatus] = mapped_column(
        Enum(OperatorInviteStatus, name="operator_invite_status"),
        nullable=False,
        default=OperatorInviteStatus.not_sent,
    )
    invite_token_hash: Mapped[str | None] = mapped_column(Text)
    invite_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invite_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invite_last_error: Mapped[str | None] = mapped_column(Text)
    invite_provider_message_id: Mapped[str | None] = mapped_column(Text)
    invited_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("app_user.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


Index(
    "app_user_auth_provider_id_idx",
    AppUser.auth_provider_id,
    unique=True,
    postgresql_where=AppUser.auth_provider_id.is_not(None),
)
Index(
    "app_user_invite_token_hash_idx",
    AppUser.invite_token_hash,
    unique=True,
    postgresql_where=AppUser.invite_token_hash.is_not(None),
)


class UserEntityRole(Base):
    __tablename__ = "user_entity_role"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("app_user.id"), primary_key=True
    )
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), primary_key=True
    )
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Property(Base):
    __tablename__ = "property"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    street_address: Mapped[str] = mapped_column(Text, nullable=False)
    suburb: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(Text)
    postcode: Mapped[str | None] = mapped_column(Text)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="AU")
    property_type: Mapped[PropertyType] = mapped_column(
        Enum(PropertyType, name="property_type"), nullable=False
    )
    parcel_id: Mapped[str | None] = mapped_column(Text)
    land_sqm: Mapped[float | None]
    building_sqm: Mapped[float | None]
    parking_spaces: Mapped[int | None]
    has_solar_pv: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ownership_structure: Mapped[str | None] = mapped_column(Text)
    owner_legal_name: Mapped[str | None] = mapped_column(Text)
    owner_abn: Mapped[str | None] = mapped_column(Text)
    trustee_name: Mapped[str | None] = mapped_column(Text)
    trust_name: Mapped[str | None] = mapped_column(Text)
    invoice_issuer_name: Mapped[str | None] = mapped_column(Text)
    billing_contact_name: Mapped[str | None] = mapped_column(Text)
    billing_email: Mapped[str | None] = mapped_column(Text)
    invoice_reference: Mapped[str | None] = mapped_column(Text)
    ownership_split: Mapped[str | None] = mapped_column(Text)
    owner_gst_registered: Mapped[bool | None] = mapped_column(Boolean)
    xero_contact_id: Mapped[str | None] = mapped_column(Text)
    xero_tracking_category: Mapped[str | None] = mapped_column(Text)
    property_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="properties")
    tenancy_units: Mapped[list["TenancyUnit"]] = relationship(back_populates="property")
    obligations: Mapped[list["Obligation"]] = relationship(back_populates="property")
    documents: Mapped[list["StoredDocument"]] = relationship(back_populates="property")


Index("property_entity_idx", Property.entity_id, postgresql_where=Property.deleted_at.is_(None))


class TenancyUnit(Base):
    __tablename__ = "tenancy_unit"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    property_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("property.id"), nullable=False
    )
    unit_label: Mapped[str] = mapped_column(Text, nullable=False)
    sqm: Mapped[float | None]
    parking_spaces: Mapped[int | None]
    unit_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    property: Mapped[Property] = relationship(back_populates="tenancy_units")
    leases: Mapped[list["Lease"]] = relationship(back_populates="tenancy_unit")
    obligations: Mapped[list["Obligation"]] = relationship(back_populates="tenancy_unit")


Index(
    "tenancy_unit_property_idx",
    TenancyUnit.property_id,
    postgresql_where=TenancyUnit.deleted_at.is_(None),
)


class Tenant(Base):
    __tablename__ = "tenant"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    legal_name: Mapped[str] = mapped_column(Text, nullable=False)
    trading_name: Mapped[str | None] = mapped_column(Text)
    abn: Mapped[str | None] = mapped_column(Text)
    contact_name: Mapped[str | None] = mapped_column(Text)
    contact_email: Mapped[str | None] = mapped_column(Text)
    contact_phone: Mapped[str | None] = mapped_column(Text)
    billing_email: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    tenant_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="tenants")
    leases: Mapped[list["Lease"]] = relationship(back_populates="tenant")
    tenant_onboardings: Mapped[list["TenantOnboarding"]] = relationship(back_populates="tenant")
    documents: Mapped[list["StoredDocument"]] = relationship(back_populates="tenant")


Index("tenant_entity_idx", Tenant.entity_id, postgresql_where=Tenant.deleted_at.is_(None))


class Lease(Base):
    __tablename__ = "lease"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    tenancy_unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenancy_unit.id"), nullable=False
    )
    tenant_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenant.id"), nullable=False
    )
    status: Mapped[LeaseStatus] = mapped_column(
        Enum(LeaseStatus, name="lease_status"), nullable=False, default=LeaseStatus.pending
    )
    commencement_date: Mapped[date | None] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    annual_rent_cents: Mapped[int | None]
    rent_frequency: Mapped[RentFrequency | None] = mapped_column(
        Enum(RentFrequency, name="rent_frequency")
    )
    outgoings_recoverable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    next_review_date: Mapped[date | None] = mapped_column(Date)
    option_summary: Mapped[str | None] = mapped_column(Text)
    security_summary: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    lease_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    tenancy_unit: Mapped[TenancyUnit] = relationship(back_populates="leases")
    tenant: Mapped[Tenant] = relationship(back_populates="leases")
    charge_rules: Mapped[list["RentChargeRule"]] = relationship(back_populates="lease")
    obligations: Mapped[list["Obligation"]] = relationship(back_populates="lease")
    tenant_onboardings: Mapped[list["TenantOnboarding"]] = relationship(back_populates="lease")
    documents: Mapped[list["StoredDocument"]] = relationship(back_populates="lease")


Index("lease_tenancy_unit_idx", Lease.tenancy_unit_id, postgresql_where=Lease.deleted_at.is_(None))
Index("lease_tenant_idx", Lease.tenant_id, postgresql_where=Lease.deleted_at.is_(None))


class RentChargeRule(Base):
    __tablename__ = "rent_charge_rule"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    lease_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("lease.id"), nullable=False
    )
    charge_type: Mapped[RentChargeType] = mapped_column(
        Enum(RentChargeType, name="rent_charge_type"), nullable=False
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    frequency: Mapped[RentFrequency] = mapped_column(
        Enum(RentFrequency, name="rent_frequency"), nullable=False
    )
    gst_treatment: Mapped[GstTreatment] = mapped_column(
        Enum(GstTreatment, name="gst_treatment"), nullable=False, default=GstTreatment.taxable
    )
    xero_account_code: Mapped[str | None] = mapped_column(Text)
    xero_tax_type: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    next_due_date: Mapped[date | None] = mapped_column(Date)
    arrears_or_advance: Mapped[str] = mapped_column(Text, nullable=False, default="advance")
    charge_rule_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lease: Mapped[Lease] = relationship(back_populates="charge_rules")


Index(
    "rent_charge_rule_lease_idx",
    RentChargeRule.lease_id,
    postgresql_where=RentChargeRule.deleted_at.is_(None),
)
Index(
    "rent_charge_rule_next_due_idx",
    RentChargeRule.next_due_date,
    postgresql_where=RentChargeRule.deleted_at.is_(None),
)


class Obligation(Base):
    __tablename__ = "obligation"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    property_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("property.id"))
    tenancy_unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenancy_unit.id")
    )
    lease_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("lease.id"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[ObligationCategory] = mapped_column(
        Enum(ObligationCategory, name="obligation_category"),
        nullable=False,
        default=ObligationCategory.other,
    )
    status: Mapped[ObligationStatus] = mapped_column(
        Enum(ObligationStatus, name="obligation_status"),
        nullable=False,
        default=ObligationStatus.upcoming,
    )
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    owner_role: Mapped[UserRole | None] = mapped_column(Enum(UserRole, name="user_role"))
    notes: Mapped[str | None] = mapped_column(Text)
    obligation_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="obligations")
    property: Mapped[Property | None] = relationship(back_populates="obligations")
    tenancy_unit: Mapped[TenancyUnit | None] = relationship(back_populates="obligations")
    lease: Mapped[Lease | None] = relationship(back_populates="obligations")


Index(
    "obligation_entity_idx",
    Obligation.entity_id,
    postgresql_where=Obligation.deleted_at.is_(None),
)
Index(
    "obligation_property_idx",
    Obligation.property_id,
    postgresql_where=Obligation.deleted_at.is_(None),
)
Index(
    "obligation_tenancy_unit_idx",
    Obligation.tenancy_unit_id,
    postgresql_where=Obligation.deleted_at.is_(None),
)
Index("obligation_lease_idx", Obligation.lease_id, postgresql_where=Obligation.deleted_at.is_(None))
Index(
    "obligation_due_date_idx",
    Obligation.due_date,
    postgresql_where=Obligation.deleted_at.is_(None),
)


class LeaseIntake(Base):
    __tablename__ = "lease_intake"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(Text)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    file_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    status: Mapped[LeaseIntakeStatus] = mapped_column(
        Enum(LeaseIntakeStatus, name="lease_intake_status"),
        nullable=False,
        default=LeaseIntakeStatus.uploaded,
    )
    extracted_data: Mapped[dict[str, Any]] = mapped_column(
        JsonbCompat, nullable=False, default=dict
    )
    openai_response_id: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    applied_lease_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("lease.id")
    )
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="lease_intakes")


Index(
    "lease_intake_entity_idx",
    LeaseIntake.entity_id,
    postgresql_where=LeaseIntake.deleted_at.is_(None),
)
Index("lease_intake_status_idx", LeaseIntake.status)


class TenantOnboarding(Base):
    __tablename__ = "tenant_onboarding"
    __table_args__ = (UniqueConstraint("token", name="uq_tenant_onboarding_token"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    lease_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("lease.id"), nullable=False
    )
    tenant_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenant.id"), nullable=False
    )
    token: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[TenantOnboardingStatus] = mapped_column(
        Enum(TenantOnboardingStatus, name="tenant_onboarding_status"),
        nullable=False,
        default=TenantOnboardingStatus.draft,
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    submitted_data: Mapped[dict[str, Any]] = mapped_column(
        JsonbCompat, nullable=False, default=dict
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_data: Mapped[dict[str, Any]] = mapped_column(JsonbCompat, nullable=False, default=dict)
    delivery_data: Mapped[dict[str, Any]] = mapped_column(JsonbCompat, nullable=False, default=dict)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("app_user.id")
    )
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("app_user.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="tenant_onboardings")
    lease: Mapped[Lease] = relationship(back_populates="tenant_onboardings")
    tenant: Mapped[Tenant] = relationship(back_populates="tenant_onboardings")
    documents: Mapped[list["StoredDocument"]] = relationship(back_populates="tenant_onboarding")


Index(
    "tenant_onboarding_entity_idx",
    TenantOnboarding.entity_id,
    postgresql_where=TenantOnboarding.deleted_at.is_(None),
)
Index(
    "tenant_onboarding_lease_idx",
    TenantOnboarding.lease_id,
    postgresql_where=TenantOnboarding.deleted_at.is_(None),
)
Index(
    "tenant_onboarding_tenant_idx",
    TenantOnboarding.tenant_id,
    postgresql_where=TenantOnboarding.deleted_at.is_(None),
)
Index("tenant_onboarding_token_idx", TenantOnboarding.token, unique=True)


class StoredDocument(Base):
    __tablename__ = "stored_document"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    property_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("property.id"))
    tenancy_unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenancy_unit.id")
    )
    tenant_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenant.id"))
    lease_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("lease.id"))
    tenant_onboarding_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenant_onboarding.id")
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(Text)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    file_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    category: Mapped[DocumentCategory] = mapped_column(
        Enum(DocumentCategory, name="document_category"),
        nullable=False,
        default=DocumentCategory.other,
    )
    notes: Mapped[str | None] = mapped_column(Text)
    document_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="documents")
    property: Mapped[Property | None] = relationship(back_populates="documents")
    tenancy_unit: Mapped[TenancyUnit | None] = relationship()
    tenant: Mapped[Tenant | None] = relationship(back_populates="documents")
    lease: Mapped[Lease | None] = relationship(back_populates="documents")
    tenant_onboarding: Mapped[TenantOnboarding | None] = relationship(back_populates="documents")
    document_intake: Mapped["DocumentIntake | None"] = relationship(
        back_populates="document", uselist=False
    )
    billing_drafts: Mapped[list["BillingDraft"]] = relationship(back_populates="document")


Index(
    "stored_document_entity_idx",
    StoredDocument.entity_id,
    postgresql_where=StoredDocument.deleted_at.is_(None),
)
Index(
    "stored_document_property_idx",
    StoredDocument.property_id,
    postgresql_where=StoredDocument.deleted_at.is_(None),
)
Index(
    "stored_document_tenant_idx",
    StoredDocument.tenant_id,
    postgresql_where=StoredDocument.deleted_at.is_(None),
)
Index(
    "stored_document_lease_idx",
    StoredDocument.lease_id,
    postgresql_where=StoredDocument.deleted_at.is_(None),
)
Index("stored_document_category_idx", StoredDocument.category)


class DocumentIntake(Base):
    __tablename__ = "document_intake"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    document_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("stored_document.id"), nullable=False, unique=True
    )
    status: Mapped[DocumentIntakeStatus] = mapped_column(
        Enum(DocumentIntakeStatus, name="document_intake_status"),
        nullable=False,
        default=DocumentIntakeStatus.uploaded,
    )
    document_type: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None]
    extracted_data: Mapped[dict[str, Any]] = mapped_column(
        JsonbCompat, nullable=False, default=dict
    )
    review_data: Mapped[dict[str, Any]] = mapped_column(JsonbCompat, nullable=False, default=dict)
    openai_response_id: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("app_user.id")
    )
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("app_user.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="document_intakes")
    document: Mapped[StoredDocument] = relationship(back_populates="document_intake")
    billing_drafts: Mapped[list["BillingDraft"]] = relationship(back_populates="document_intake")


Index(
    "document_intake_entity_idx",
    DocumentIntake.entity_id,
    postgresql_where=DocumentIntake.deleted_at.is_(None),
)
Index("document_intake_document_idx", DocumentIntake.document_id)
Index("document_intake_status_idx", DocumentIntake.status)


class BillingDraft(Base):
    __tablename__ = "billing_draft"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    property_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("property.id"))
    tenancy_unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenancy_unit.id")
    )
    tenant_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenant.id"))
    lease_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("lease.id"))
    document_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("stored_document.id"), nullable=False
    )
    document_intake_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("document_intake.id")
    )
    status: Mapped[BillingDraftStatus] = mapped_column(
        Enum(BillingDraftStatus, name="billing_draft_status"),
        nullable=False,
        default=BillingDraftStatus.draft,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AUD")
    issue_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    billing_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="billing_drafts")
    property: Mapped[Property | None] = relationship()
    tenancy_unit: Mapped[TenancyUnit | None] = relationship()
    tenant: Mapped[Tenant | None] = relationship()
    lease: Mapped[Lease | None] = relationship()
    document: Mapped[StoredDocument] = relationship(back_populates="billing_drafts")
    document_intake: Mapped[DocumentIntake | None] = relationship(back_populates="billing_drafts")
    lines: Mapped[list["BillingDraftLine"]] = relationship(
        back_populates="billing_draft",
        order_by="BillingDraftLine.created_at",
    )
    invoice_drafts: Mapped[list["InvoiceDraft"]] = relationship(back_populates="billing_draft")


Index(
    "billing_draft_entity_idx",
    BillingDraft.entity_id,
    postgresql_where=BillingDraft.deleted_at.is_(None),
)
Index(
    "billing_draft_document_intake_idx",
    BillingDraft.document_intake_id,
    postgresql_where=BillingDraft.deleted_at.is_(None),
)
Index(
    "billing_draft_status_idx",
    BillingDraft.status,
    postgresql_where=BillingDraft.deleted_at.is_(None),
)
Index(
    "billing_draft_due_date_idx",
    BillingDraft.due_date,
    postgresql_where=BillingDraft.deleted_at.is_(None),
)


class BillingDraftLine(Base):
    __tablename__ = "billing_draft_line"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    billing_draft_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("billing_draft.id"), nullable=False
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AUD")
    source_hint: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None]
    line_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    billing_draft: Mapped[BillingDraft] = relationship(back_populates="lines")


Index(
    "billing_draft_line_draft_idx",
    BillingDraftLine.billing_draft_id,
    postgresql_where=BillingDraftLine.deleted_at.is_(None),
)


class InvoiceDraft(Base):
    __tablename__ = "invoice_draft"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    entity_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("entity.id"), nullable=False
    )
    billing_draft_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("billing_draft.id"), nullable=False
    )
    property_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("property.id"))
    tenancy_unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenancy_unit.id")
    )
    tenant_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenant.id"))
    lease_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("lease.id"))
    document_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("stored_document.id"), nullable=False
    )
    document_intake_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("document_intake.id")
    )
    status: Mapped[InvoiceDraftStatus] = mapped_column(
        Enum(InvoiceDraftStatus, name="invoice_draft_status"),
        nullable=False,
        default=InvoiceDraftStatus.draft,
    )
    invoice_number: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AUD")
    issue_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    subtotal_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    gst_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    issuer_name: Mapped[str | None] = mapped_column(Text)
    issuer_abn: Mapped[str | None] = mapped_column(Text)
    recipient_name: Mapped[str | None] = mapped_column(Text)
    recipient_email: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    invoice_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(back_populates="invoice_drafts")
    billing_draft: Mapped[BillingDraft] = relationship(back_populates="invoice_drafts")
    property: Mapped[Property | None] = relationship()
    tenancy_unit: Mapped[TenancyUnit | None] = relationship()
    tenant: Mapped[Tenant | None] = relationship()
    lease: Mapped[Lease | None] = relationship()
    document: Mapped[StoredDocument] = relationship()
    document_intake: Mapped[DocumentIntake | None] = relationship()
    lines: Mapped[list["InvoiceDraftLine"]] = relationship(
        back_populates="invoice_draft",
        order_by="InvoiceDraftLine.created_at",
    )


Index(
    "invoice_draft_entity_idx",
    InvoiceDraft.entity_id,
    postgresql_where=InvoiceDraft.deleted_at.is_(None),
)
Index(
    "invoice_draft_billing_draft_idx",
    InvoiceDraft.billing_draft_id,
    postgresql_where=InvoiceDraft.deleted_at.is_(None),
)
Index(
    "invoice_draft_status_idx",
    InvoiceDraft.status,
    postgresql_where=InvoiceDraft.deleted_at.is_(None),
)
Index(
    "invoice_draft_due_date_idx",
    InvoiceDraft.due_date,
    postgresql_where=InvoiceDraft.deleted_at.is_(None),
)


class InvoiceDraftLine(Base):
    __tablename__ = "invoice_draft_line"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    invoice_draft_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("invoice_draft.id"), nullable=False
    )
    billing_draft_line_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("billing_draft_line.id")
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    gst_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AUD")
    source_hint: Mapped[str | None] = mapped_column(Text)
    line_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JsonbCompat, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    invoice_draft: Mapped[InvoiceDraft] = relationship(back_populates="lines")
    billing_draft_line: Mapped[BillingDraftLine | None] = relationship()


Index(
    "invoice_draft_line_draft_idx",
    InvoiceDraftLine.invoice_draft_id,
    postgresql_where=InvoiceDraftLine.deleted_at.is_(None),
)


class AuditAction(Base):
    __tablename__ = "audit_action"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid7)
    request_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("app_user.id"))
    entity_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("entity.id"))
    target_table: Mapped[str | None] = mapped_column(Text)
    target_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    action: Mapped[str] = mapped_column(Text, nullable=False)
    tool_name: Mapped[str | None] = mapped_column(Text)
    tool_input: Mapped[dict[str, Any] | None] = mapped_column(JsonbCompat)
    tool_output_summary: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None]
    outcome: Mapped[AuditOutcome] = mapped_column(
        Enum(AuditOutcome, name="audit_outcome"), nullable=False
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    data_classification: Mapped[str] = mapped_column(Text, nullable=False, default="internal")
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


Index("audit_action_actor_time_idx", AuditAction.actor, AuditAction.occurred_at.desc())
Index(
    "audit_action_target_idx",
    AuditAction.target_table,
    AuditAction.target_id,
    postgresql_where=AuditAction.target_id.is_not(None),
)
