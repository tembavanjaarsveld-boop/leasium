"""Tenant payment-rail boundary (review-first, provider-agnostic scaffold).

No AU rail provider is wired yet, so this module never moves money: it produces
a review-only payment-intent preview describing how a tenant would pay an
invoice (amount, reference, available manual methods) and reports that online
payment is not enabled. A future provider adapter (Monoova / Zai / Stripe AU)
plugs in behind ``configured_rail`` / ``build_payment_intent_preview`` without
changing call sites. Mirrors the soft-skip pattern of the DocuSign / Basiq
adapters: inert until explicitly configured, and even then creating a real
charge stays an explicit, reviewed step — never automatic here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from stewart.core.settings import Settings

PaymentRailStatus = Literal["manual_only", "ready"]

# AU rails we expect to support once one is chosen and credentialed.
SUPPORTED_RAIL_PROVIDERS = ("monoova", "zai", "stripe_au")

_MANUAL_MESSAGE = (
    "Online payment is not enabled yet. Pay using the displayed payment "
    "instructions and quote the payment reference."
)


@dataclass(frozen=True)
class PaymentIntentPreview:
    """Review-only description of how a tenant would pay an invoice.

    ``status`` is ``manual_only`` whenever no rail provider is configured, which
    is always the case today. No money is moved and no provider is called when
    building this preview.
    """

    status: PaymentRailStatus
    amount_cents: int
    currency: str
    reference: str | None = None
    available_methods: list[str] = field(default_factory=list)
    provider: str | None = None
    online_payment_enabled: bool = False
    message: str = _MANUAL_MESSAGE


def configured_rail(settings: Settings) -> str | None:
    """Return the configured AU rail provider, or None when online pay is off."""

    provider = (settings.payment_rail_provider or "").strip().lower()
    return provider if provider in SUPPORTED_RAIL_PROVIDERS else None


def build_payment_intent_preview(
    *,
    amount_cents: int,
    currency: str,
    reference: str | None,
    available_methods: list[str],
    settings: Settings,
) -> PaymentIntentPreview:
    """Build a review-only payment-intent preview. Never moves money."""

    provider = configured_rail(settings)
    if provider is None:
        return PaymentIntentPreview(
            status="manual_only",
            amount_cents=amount_cents,
            currency=currency,
            reference=reference,
            available_methods=list(available_methods),
            provider=None,
            online_payment_enabled=False,
            message=_MANUAL_MESSAGE,
        )
    return PaymentIntentPreview(
        status="ready",
        amount_cents=amount_cents,
        currency=currency,
        reference=reference,
        available_methods=list(available_methods),
        provider=provider,
        online_payment_enabled=True,
        message=(
            f"Online payment via {provider} is configured. Creating a payment "
            "intent stays an explicit, reviewed action; no charge is made here."
        ),
    )
