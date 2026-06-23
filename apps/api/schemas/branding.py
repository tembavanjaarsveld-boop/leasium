"""Per-entity invoice branding schemas (local config; no provider calls)."""

from pydantic import BaseModel, ConfigDict


class EntityBrandingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    accent_color: str | None = None
    business_address: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    payment_payid: str | None = None
    payment_bpay_biller: str | None = None
    payment_bpay_reference: str | None = None
    payment_bank_bsb: str | None = None
    payment_bank_account: str | None = None
    footer_terms: str | None = None


class EntityBrandingUpdate(BaseModel):
    accent_color: str | None = None
    business_address: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    payment_payid: str | None = None
    payment_bpay_biller: str | None = None
    payment_bpay_reference: str | None = None
    payment_bank_bsb: str | None = None
    payment_bank_account: str | None = None
    footer_terms: str | None = None
