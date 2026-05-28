"""Schemas for owner-grouped statements.

The owner concept is derived from existing Property fields (`owner_legal_name`,
`trustee_name`, `trust_name`, `invoice_issuer_name`) — no dedicated owner
table exists. The v1 statements endpoint groups properties by an identity
tuple computed from those fields and rolls up invoice totals per month.
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
