"""Sentry helpers for production observability."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

FILTERED = "[Filtered]"

_SENSITIVE_EXACT_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-api-token",
    "api_key",
    "api_token",
    "access_token",
    "refresh_token",
    "id_token",
    "password",
    "secret",
    "token",
}
_SENSITIVE_KEY_PARTS = (
    "abn",
    "account",
    "bank",
    "billing_email",
    "contact_email",
    "email",
    "name",
    "owner",
    "phone",
    "recipient",
    "tenant",
    "xero",
    "basiq",
    "sendgrid",
    "twilio",
)


def _is_sensitive_key(key: object) -> bool:
    if not isinstance(key, str):
        return False
    normalized = key.replace("-", "_").lower()
    return normalized in _SENSITIVE_EXACT_KEYS or any(
        part in normalized for part in _SENSITIVE_KEY_PARTS
    )


def _scrub_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: FILTERED if _is_sensitive_key(key) else _scrub_value(child)
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [_scrub_value(child) for child in value]
    if isinstance(value, tuple):
        return tuple(_scrub_value(child) for child in value)
    return value


def scrub_sentry_event(
    event: dict[str, Any],
    hint: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Strip tenant, owner, provider, and auth PII before Sentry receives events."""

    scrubbed = _scrub_value(event)
    if not isinstance(scrubbed, dict):
        return event

    user = scrubbed.get("user")
    if isinstance(user, dict):
        safe_user: dict[str, Any] = {}
        if user_id := user.get("id"):
            safe_user["id"] = user_id
        scrubbed["user"] = safe_user
    return scrubbed
