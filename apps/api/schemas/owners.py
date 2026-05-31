"""Schemas for owner-grouped statements.

Owner statements group properties through first-class `Owner` /
`PropertyOwner` links. Legacy Property owner fields remain as the backfill
source for Owner records, while unlinked properties roll into the
operator-facing `Unattributed` fallback bucket.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class OwnerInvoiceEvidenceLine(BaseModel):
    """Local invoice evidence behind an owner/property total."""

    invoice_draft_id: UUID
    invoice_number: str | None = None
    title: str
    issue_date: date | None = None
    due_date: date | None = None
    total_cents: int
    paid_cents: int
    outstanding_cents: int
    payment_status: str
    xero_invoice_id: str | None = None
    reconciliation_reference: str | None = None
    reconciliation_match_confidence: str | None = None
    reconciliation_bank_transaction_id: str | None = None


class OwnerPropertyLine(BaseModel):
    """One property line on an owner's monthly statement."""

    property_id: UUID
    property_name: str
    invoiced_cents: int
    paid_cents: int
    outstanding_cents: int
    invoice_count: int
    invoices: list[OwnerInvoiceEvidenceLine] = Field(default_factory=list)


class OwnerStatementRead(BaseModel):
    """A single owner's monthly statement."""

    owner_id: UUID | None = None
    owner_identity: str
    owner_legal_name: str | None = None
    trustee_name: str | None = None
    trust_name: str | None = None
    invoice_issuer_name: str | None = None
    billing_contact_name: str | None = None
    billing_email: str | None = None
    property_count: int
    properties: list[OwnerPropertyLine]
    invoiced_cents: int
    paid_cents: int
    outstanding_cents: int
    invoice_count: int


class OwnerStatementsRead(BaseModel):
    """Read response for ``GET /api/v1/owners/statements``."""

    entity_id: UUID
    month: str  # YYYY-MM
    month_start: date
    month_end: date
    owners: list[OwnerStatementRead]
    generated_at: datetime


class OwnerStatementDispatchRequest(BaseModel):
    """Explicit per-owner statement send request.

    ``approve`` must be true — it is the operator's explicit per-owner
    approval for a real provider email. ``resend`` allows a fresh attempt
    after a prior live receipt for the same owner + month.
    """

    owner_identity: str
    month: str = ""
    approve: bool = False
    resend: bool = False


class OwnerStatementDispatchReceipt(BaseModel):
    """Receipt for one reviewed owner-statement send attempt."""

    id: UUID
    entity_id: UUID
    owner_identity: str
    month: str
    channel: str
    provider: str | None = None
    status: str
    recipient_email: str | None = None
    subject: str | None = None
    provider_message_id: str | None = None
    error: str | None = None
    invoice_count: int
    invoiced_cents: int
    outstanding_cents: int
    created_by_user_id: UUID | None = None
    created_at: datetime


class OwnerStatementDispatchListRead(BaseModel):
    """Read response for ``GET /api/v1/owners/statements/dispatch``."""

    entity_id: UUID
    month: str
    receipts: list[OwnerStatementDispatchReceipt] = Field(default_factory=list)
    guardrail: str
    generated_at: datetime
