"""Schemas for recurring compliance checks."""

from datetime import date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field, computed_field
from stewart.core.models import (
    ComplianceCheckKind,
    ComplianceCheckStatus,
    ComplianceRecurrenceUnit,
    UserRole,
)

from apps.api.schemas.common import ApiModel

# Days-before-expiry that count as "due soon". Mirrors the obligation due-soon
# window in apps/api/routers/compliance.py::_obligation_status so the read-only
# certificate projection stays consistent with the rest of the compliance code.
CERTIFICATE_DUE_SOON_DAYS = 30

CertificateExpiryStatus = Literal["expired", "due_soon", "ok", "none"]


class ComplianceCheckCreate(BaseModel):
    entity_id: UUID
    title: str
    kind: ComplianceCheckKind = ComplianceCheckKind.other
    status: ComplianceCheckStatus = ComplianceCheckStatus.active
    jurisdiction: str | None = None
    authority: str | None = None
    recurrence_interval: int = Field(default=1, ge=1, le=120)
    recurrence_unit: ComplianceRecurrenceUnit = ComplianceRecurrenceUnit.years
    last_checked_at: datetime | None = None
    next_due_date: date
    certificate_expires_on: date | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    assigned_user_id: UUID | None = None
    source_document_id: UUID | None = None
    current_obligation_id: UUID | None = None
    owner_role: UserRole | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ComplianceCheckUpdate(BaseModel):
    title: str | None = None
    kind: ComplianceCheckKind | None = None
    status: ComplianceCheckStatus | None = None
    jurisdiction: str | None = None
    authority: str | None = None
    recurrence_interval: int | None = Field(default=None, ge=1, le=120)
    recurrence_unit: ComplianceRecurrenceUnit | None = None
    last_checked_at: datetime | None = None
    next_due_date: date | None = None
    certificate_expires_on: date | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    assigned_user_id: UUID | None = None
    source_document_id: UUID | None = None
    current_obligation_id: UUID | None = None
    owner_role: UserRole | None = None
    notes: str | None = None
    metadata: dict[str, Any] | None = None


class ComplianceCheckComplete(BaseModel):
    # Review-first guardrail: completion is operator-approved by design. The
    # caller must affirm the approval so a completion (which marks the current
    # obligation done and rolls the check forward) cannot fire as a silent
    # side-effect of any write-role request.
    operator_approved: bool = False
    source_document_id: UUID | None = None
    completed_at: datetime | None = None
    next_due_date: date | None = None
    certificate_expires_on: date | None = None
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ComplianceCheckEvidenceLink(BaseModel):
    source_document_id: UUID
    certificate_expires_on: date | None = None
    notes: str | None = None


class ComplianceCheckRead(ApiModel):
    id: UUID
    entity_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    tenant_id: UUID | None
    lease_id: UUID | None
    assigned_user_id: UUID | None
    source_document_id: UUID | None
    current_obligation_id: UUID | None
    title: str
    kind: ComplianceCheckKind
    status: ComplianceCheckStatus
    jurisdiction: str | None
    authority: str | None
    recurrence_interval: int
    recurrence_unit: ComplianceRecurrenceUnit
    last_checked_at: datetime | None
    next_due_date: date
    certificate_expires_on: date | None
    owner_role: UserRole | None
    notes: str | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("check_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def days_until_certificate_expiry(self) -> int | None:
        """Whole days from today until the certificate expires.

        Read-only projection. Negative when the certificate has already
        expired; ``None`` when no certificate expiry is recorded. Uses the same
        ``date.today()`` clock as the compliance router's obligation status.
        """
        if self.certificate_expires_on is None:
            return None
        return (self.certificate_expires_on - date.today()).days

    @computed_field  # type: ignore[prop-decorator]
    @property
    def certificate_expiry_status(self) -> CertificateExpiryStatus:
        """Bucket the certificate against the due-soon window.

        Pure projection over ``certificate_expires_on`` — no DB write, no
        mutation, no provider call. ``due_soon`` matches the obligation
        ``_obligation_status`` 30-day window for consistency.
        """
        if self.certificate_expires_on is None:
            return "none"
        today = date.today()
        if self.certificate_expires_on < today:
            return "expired"
        if self.certificate_expires_on <= today + timedelta(days=CERTIFICATE_DUE_SOON_DAYS):
            return "due_soon"
        return "ok"
