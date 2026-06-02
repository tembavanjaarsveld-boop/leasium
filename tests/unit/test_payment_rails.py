"""PaymentRail boundary tests — review-first scaffold, no money movement."""

from __future__ import annotations

from stewart.core.settings import Settings, get_settings
from stewart.integrations.payment_rails import (
    build_payment_intent_preview,
    configured_rail,
)


def _settings(provider: str = "") -> Settings:
    return get_settings().model_copy(update={"payment_rail_provider": provider})


def test_configured_rail_is_none_without_a_supported_provider() -> None:
    assert configured_rail(_settings()) is None
    assert configured_rail(_settings("not-a-provider")) is None


def test_configured_rail_accepts_supported_providers_case_insensitively() -> None:
    assert configured_rail(_settings("monoova")) == "monoova"
    assert configured_rail(_settings("Zai")) == "zai"
    assert configured_rail(_settings(" stripe_au ")) == "stripe_au"


def test_payment_intent_preview_is_manual_only_without_a_provider() -> None:
    preview = build_payment_intent_preview(
        amount_cents=880000,
        currency="AUD",
        reference="INV-1001",
        available_methods=["eft", "payid"],
        settings=_settings(),
    )
    assert preview.status == "manual_only"
    assert preview.online_payment_enabled is False
    assert preview.provider is None
    assert preview.amount_cents == 880000
    assert preview.reference == "INV-1001"
    assert preview.available_methods == ["eft", "payid"]
    assert "not enabled" in preview.message


def test_payment_intent_preview_ready_when_provider_configured_but_no_charge() -> None:
    preview = build_payment_intent_preview(
        amount_cents=1000,
        currency="AUD",
        reference=None,
        available_methods=[],
        settings=_settings("monoova"),
    )
    assert preview.status == "ready"
    assert preview.online_payment_enabled is True
    assert preview.provider == "monoova"
    assert "no charge is made here" in preview.message
