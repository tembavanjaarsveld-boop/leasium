"""Schemas for operator-entered tenant payment instructions (display-only)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

_TEXT_FIELDS = (
    "account_name",
    "bsb",
    "account_number",
    "payid",
    "payid_name",
    "bpay_biller_code",
    "instructions",
)


class PaymentInstructionUpdate(BaseModel):
    """Operator upsert for an entity's tenant payment instructions."""

    account_name: str | None = None
    bsb: str | None = None
    account_number: str | None = None
    payid: str | None = None
    payid_name: str | None = None
    bpay_biller_code: str | None = None
    instructions: str | None = Field(default=None, max_length=2000)

    @field_validator(*_TEXT_FIELDS, mode="before")
    @classmethod
    def _optional_text(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Value must be text.")
        cleaned = value.strip()
        return cleaned or None


class PaymentInstructionRead(BaseModel):
    """Operator view of an entity's payment instructions."""

    entity_id: UUID
    account_name: str | None = None
    bsb: str | None = None
    account_number: str | None = None
    payid: str | None = None
    payid_name: str | None = None
    bpay_biller_code: str | None = None
    instructions: str | None = None
    configured: bool = False
    methods: list[str] = Field(default_factory=list)
    updated_at: datetime | None = None
    guardrails: list[str] = Field(default_factory=list)
