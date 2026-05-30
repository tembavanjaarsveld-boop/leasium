"""Schemas for Basiq (AU) bank-feed reconciliation surfaces.

The response shape reuses the Xero payment reconciliation read schemas
verbatim -- they already carry every bank-feed field (bank_transaction_id,
statement_date, statement_amount_cents, counterparty, reference,
match_confidence/method, amount_delta, guardrail_flags). We alias the row
read and wrap the summary so Billing Readiness / owner statements read the
same metadata regardless of which reconciliation path wrote it.
"""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from apps.api.schemas.xero import (
    XeroPaymentReconciliationResultRead as BasiqReconciliationResultRead,
)

__all__ = [
    "BasiqImportedTransaction",
    "BasiqReconciliationRequest",
    "BasiqReconciliationResultRead",
    "BasiqReconciliationRead",
]


class BasiqImportedTransaction(BaseModel):
    """An operator-supplied bank-feed transaction for reconciliation review.

    Used for source="imported" (paste/upload a statement row). Maps onto the
    shared reconciliation engine's item shape. Amounts are in cents.
    """

    model_config = ConfigDict(extra="forbid")

    transaction_id: str = Field(min_length=1, max_length=120)
    amount_cents: int = Field(ge=0)
    posted_date: date | None = None
    description: str | None = Field(default=None, min_length=1, max_length=500)
    reference: str | None = Field(default=None, min_length=1, max_length=200)
    counterparty: str | None = Field(default=None, min_length=1, max_length=200)
    account_name: str | None = Field(default=None, min_length=1, max_length=120)
    invoice_draft_id: UUID | None = None


class BasiqReconciliationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["imported", "provider"] = "imported"
    transactions: list[BasiqImportedTransaction] = Field(
        default_factory=list, max_length=100
    )
    approved_idempotency_keys: list[str] = Field(default_factory=list, max_length=100)


class BasiqReconciliationRead(BaseModel):
    entity_id: UUID
    source: Literal["imported", "provider"]
    basiq_configured: bool
    checked_transactions: int
    ready_count: int
    applied_count: int
    skipped_count: int
    blocked_count: int
    results: list[BasiqReconciliationResultRead]
    reconciled_at: datetime
    guardrails: list[str]
