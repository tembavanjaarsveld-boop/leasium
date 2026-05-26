"""Schemas for the tenant-facing portal."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator
from stewart.core.models import DocumentCategory, MaintenancePriority


class TenantPortalInvitePreviewRead(BaseModel):
    """Minimum-viable, unauthenticated context for the claim gate.

    Returned by GET /api/v1/tenant-portal/invites/{token}/preview. Holds
    only the fields a tenant needs to confirm they're in the right place
    before authenticating: who the invite is for, which property, the
    sign-in email the property manager already entered, and the link expiry.
    Never includes financial data or documents.
    """

    property_name: str
    property_address: str | None = None
    tenant_display_name: str
    tenant_email: str | None = None
    expires_at: datetime | None = None
    claimable: bool


class TenantPortalAccountClaimCreate(BaseModel):
    portal_token: str

    @field_validator("portal_token", mode="before")
    @classmethod
    def _required_token(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Portal token is required.")
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Portal token is required.")
        return cleaned


class TenantPortalAccountLifecycleRead(BaseModel):
    status: Literal["unlinked", "active", "revoked"]
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    email: str | None = None
    linked_at: datetime | None = None
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    recovery_action: str | None = None
    recovery_at: datetime | None = None
    recovery_hint: str


class TenantPortalAuthRead(BaseModel):
    mode: Literal[
        "tenant_portal_token",
        "tenant_portal_token_dev_fallback",
        "tenant_portal_account",
        "operator_preview",
    ]
    token_source: Literal["header", "query", "form", "bearer"]
    tenant_auth_configured: bool = False
    dev_fallback: bool
    boundary: str
    detail: str


class TenantPortalTenantRead(BaseModel):
    id: UUID
    legal_name: str
    trading_name: str | None
    contact_name: str | None
    contact_email: str | None
    contact_phone: str | None
    billing_email: str | None


class TenantPortalLeaseRead(BaseModel):
    lease_id: UUID
    status: str
    property_name: str
    property_address: str | None
    unit_label: str
    commencement_date: date | None
    expiry_date: date | None
    next_review_date: date | None


class TenantPortalOnboardingRead(BaseModel):
    id: UUID
    status: str
    due_date: date | None
    expires_at: datetime | None
    submitted_at: datetime | None
    last_sent_at: datetime | None
    document_count: int
    submitted_data: dict[str, Any] | None = None
    portal_invite_sent_at: datetime | None = None


class TenantPortalLeaseQuestionCreate(BaseModel):
    question: str
    clause_reference: str | None = None

    @field_validator("question", mode="before")
    @classmethod
    def _required_question(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Question is required.")
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Question is required.")
        return cleaned

    @field_validator("clause_reference", mode="before")
    @classmethod
    def _optional_reference(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Reference must be text.")
        cleaned = value.strip()
        return cleaned or None


class TenantPortalLeaseAgreementSignCreate(BaseModel):
    accepted: bool = True


class TenantPortalLeaseQuestionRead(BaseModel):
    id: str
    question: str
    clause_reference: str | None = None
    status: Literal["open", "answered", "resolved", "needs_revision", "legal_review"]
    answer: str | None = None
    asked_at: datetime | None = None
    asked_by_actor: str | None = None
    answered_at: datetime | None = None
    answered_by_actor: str | None = None
    answered_by_user_id: UUID | None = None
    resolved_at: datetime | None = None


class TenantPortalLeaseAgreementRead(BaseModel):
    status: Literal["not_ready", "questions_open", "ready_to_sign", "signed"]
    open_question_count: int
    questions: list[TenantPortalLeaseQuestionRead] = Field(default_factory=list)
    signed_at: datetime | None = None
    signed_by_actor: str | None = None
    signing_locked_reason: str | None = None


class TenantPortalDocumentRead(BaseModel):
    id: UUID
    lease_id: UUID | None = None
    tenant_onboarding_id: UUID | None = None
    filename: str
    content_type: str | None
    byte_size: int
    category: DocumentCategory
    notes: str | None
    source: str
    created_at: datetime


class TenantPortalComplianceItemRead(BaseModel):
    key: str
    label: str
    status: Literal["missing", "received", "expired", "not_on_file"]
    document_count: int
    latest_document: TenantPortalDocumentRead | None = None
    due_date: date | None = None


class TenantPortalComplianceRead(BaseModel):
    uploads_enabled: bool = True
    accepted_categories: list[DocumentCategory]
    items: list[TenantPortalComplianceItemRead]
    uploaded_documents: list[TenantPortalDocumentRead]


class TenantPortalInvoiceLineRead(BaseModel):
    id: UUID
    description: str
    amount_cents: int
    gst_cents: int
    currency: str


class TenantPortalInvoiceRead(BaseModel):
    id: UUID
    invoice_number: str | None
    title: str
    status: str
    issue_date: date | None
    due_date: date | None
    currency: str
    subtotal_cents: int
    gst_cents: int
    total_cents: int
    paid_cents: int
    outstanding_cents: int
    payment_status: str
    pdf_document_id: UUID | None
    lines: list[TenantPortalInvoiceLineRead] = Field(default_factory=list)


class TenantPortalPaymentSummaryRead(BaseModel):
    invoice_count: int
    total_cents: int
    paid_cents: int
    outstanding_cents: int
    overdue_count: int
    next_due_date: date | None
    status: Literal["no_invoices", "paid", "unpaid", "overdue"]
    manual_only: bool = True


class TenantPortalNotificationPreferencesRead(BaseModel):
    email_enabled: bool
    sms_enabled: bool
    billing_email_enabled: bool
    compliance_reminders_enabled: bool
    preferred_channel: Literal["email", "sms", "both", "none"]
    updated_at: datetime | None = None


class TenantPortalNotificationPreferencesUpdate(BaseModel):
    email_enabled: bool | None = None
    sms_enabled: bool | None = None
    billing_email_enabled: bool | None = None
    compliance_reminders_enabled: bool | None = None


class TenantPortalContactChangeRequestCreate(BaseModel):
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    billing_email: str | None = None
    notes: str | None = None

    @field_validator(
        "contact_name",
        "contact_email",
        "contact_phone",
        "billing_email",
        "notes",
        mode="before",
    )
    @classmethod
    def _optional_text(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Value must be text.")
        cleaned = value.strip()
        return cleaned or None


class TenantPortalContactChangeFieldRead(BaseModel):
    field: str
    label: str
    before: Any = None
    after: Any = None


class TenantPortalContactChangeRequestRead(BaseModel):
    id: str
    status: str
    submitted_at: datetime | None = None
    applied_at: datetime | None = None
    dismissed_at: datetime | None = None
    notes: str | None = None
    changes: list[TenantPortalContactChangeFieldRead] = Field(default_factory=list)


class TenantPortalMaintenanceRequestCreate(BaseModel):
    title: str
    description: str
    priority: MaintenancePriority = MaintenancePriority.normal
    source_reference: str | None = None
    document_ids: list[UUID] = Field(default_factory=list)
    photo_document_ids: list[UUID] = Field(default_factory=list)

    @field_validator("title", "description", mode="before")
    @classmethod
    def _required_text(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Value is required.")
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Value cannot be blank.")
        return cleaned

    @field_validator("source_reference", mode="before")
    @classmethod
    def _optional_text(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Value must be text.")
        cleaned = value.strip()
        return cleaned or None


class TenantPortalMaintenanceHistoryItemRead(BaseModel):
    timestamp: datetime
    event: str
    summary: str
    status: str | None = None


class TenantPortalMaintenanceRequestRead(BaseModel):
    id: UUID
    title: str
    description: str | None
    status: str
    priority: str
    requested_at: datetime
    source_reference: str | None
    due_date: date | None
    completed_at: datetime | None
    document_ids: list[UUID]
    photo_document_ids: list[UUID]
    history: list[TenantPortalMaintenanceHistoryItemRead] = Field(default_factory=list)
    created_at: datetime


class TenantPortalRead(BaseModel):
    auth: TenantPortalAuthRead
    tenant: TenantPortalTenantRead
    lease: TenantPortalLeaseRead
    onboarding: TenantPortalOnboardingRead
    lease_agreement: TenantPortalLeaseAgreementRead
    compliance: TenantPortalComplianceRead
    invoices: list[TenantPortalInvoiceRead]
    payment_summary: TenantPortalPaymentSummaryRead
    maintenance_requests: list[TenantPortalMaintenanceRequestRead]
    notification_preferences: TenantPortalNotificationPreferencesRead
    contact_change_requests: list[TenantPortalContactChangeRequestRead] = Field(
        default_factory=list
    )
    guardrails: list[str]
