"""Xero OAuth and Accounting API helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

from stewart.core.settings import Settings


class XeroIntegrationError(RuntimeError):
    """Raised when Xero provider calls or credential handling fail."""


def xero_redirect_uri(settings: Settings) -> str:
    if settings.xero_redirect_uri.strip():
        return settings.xero_redirect_uri.strip()
    base_url = settings.public_api_url.strip() or f"http://localhost:{settings.api_port}"
    return f"{base_url.rstrip('/')}/api/v1/xero/oauth/callback"


def xero_scopes(settings: Settings) -> list[str]:
    return [scope.strip() for scope in settings.xero_default_scopes.split() if scope.strip()]


def xero_missing_config(settings: Settings) -> list[str]:
    missing: list[str] = []
    if not settings.xero_client_id.strip():
        missing.append("XERO_CLIENT_ID")
    if not settings.xero_client_secret.strip():
        missing.append("XERO_CLIENT_SECRET")
    if not xero_redirect_uri(settings):
        missing.append("XERO_REDIRECT_URI")
    if not settings.xero_token_encryption_key.strip():
        missing.append("XERO_TOKEN_ENCRYPTION_KEY")
    return missing


def xero_provider_configured(settings: Settings) -> bool:
    return not xero_missing_config(settings)


def xero_authorization_url(settings: Settings, state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": settings.xero_client_id,
        "redirect_uri": xero_redirect_uri(settings),
        "scope": " ".join(xero_scopes(settings)),
        "state": state,
    }
    return f"{settings.xero_authorize_url}?{urlencode(params)}"


def _fernet(settings: Settings) -> Fernet:
    key = settings.xero_token_encryption_key.strip()
    if not key:
        raise XeroIntegrationError("Xero token encryption key is not configured.")
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as exc:  # pragma: no cover - Fernet validates key format
        raise XeroIntegrationError("Xero token encryption key is invalid.") from exc


def encrypt_xero_token(token: str, settings: Settings) -> str:
    return _fernet(settings).encrypt(token.encode("utf-8")).decode("utf-8")


def decrypt_xero_token(ciphertext: str, settings: Settings) -> str:
    try:
        return _fernet(settings).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise XeroIntegrationError("Stored Xero token could not be decrypted.") from exc


def _token_expiry(payload: dict[str, Any]) -> datetime | None:
    expires_in = payload.get("expires_in")
    if isinstance(expires_in, int | float) and expires_in > 0:
        return datetime.now(UTC) + timedelta(seconds=int(expires_in))
    return None


def exchange_code_for_tokens(code: str, settings: Settings) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=settings.xero_http_timeout_seconds) as client:
            response = client.post(
                settings.xero_token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": xero_redirect_uri(settings),
                },
                auth=(settings.xero_client_id, settings.xero_client_secret),
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise XeroIntegrationError("Could not exchange the Xero authorization code.") from exc


def refresh_xero_tokens(refresh_token: str, settings: Settings) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=settings.xero_http_timeout_seconds) as client:
            response = client.post(
                settings.xero_token_url,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
                auth=(settings.xero_client_id, settings.xero_client_secret),
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise XeroIntegrationError("Could not refresh the Xero connection.") from exc


def fetch_xero_connections(access_token: str, settings: Settings) -> list[dict[str, Any]]:
    try:
        with httpx.Client(timeout=settings.xero_http_timeout_seconds) as client:
            response = client.get(
                settings.xero_connections_url,
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {access_token}",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise XeroIntegrationError("Could not read Xero organisation connections.") from exc
    if not isinstance(payload, list):
        raise XeroIntegrationError("Xero returned an unexpected connections response.")
    return [item for item in payload if isinstance(item, dict)]


def fetch_xero_contacts(
    access_token: str,
    xero_tenant_id: str,
    settings: Settings,
) -> list[dict[str, Any]]:
    try:
        with httpx.Client(timeout=settings.xero_http_timeout_seconds) as client:
            response = client.get(
                f"{settings.xero_api_base_url.rstrip('/')}/Contacts",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {access_token}",
                    "xero-tenant-id": xero_tenant_id,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise XeroIntegrationError("Could not read Xero contacts.") from exc
    contacts = payload.get("Contacts") if isinstance(payload, dict) else None
    if not isinstance(contacts, list):
        raise XeroIntegrationError("Xero returned an unexpected contacts response.")
    return [contact for contact in contacts if isinstance(contact, dict)]


def fetch_xero_accounts(
    access_token: str,
    xero_tenant_id: str,
    settings: Settings,
) -> list[dict[str, Any]]:
    try:
        with httpx.Client(timeout=settings.xero_http_timeout_seconds) as client:
            response = client.get(
                f"{settings.xero_api_base_url.rstrip('/')}/Accounts",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {access_token}",
                    "xero-tenant-id": xero_tenant_id,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise XeroIntegrationError("Could not read Xero accounts.") from exc
    accounts = payload.get("Accounts") if isinstance(payload, dict) else None
    if not isinstance(accounts, list):
        raise XeroIntegrationError("Xero returned an unexpected accounts response.")
    return [account for account in accounts if isinstance(account, dict)]


def fetch_xero_tax_rates(
    access_token: str,
    xero_tenant_id: str,
    settings: Settings,
) -> list[dict[str, Any]]:
    try:
        with httpx.Client(timeout=settings.xero_http_timeout_seconds) as client:
            response = client.get(
                f"{settings.xero_api_base_url.rstrip('/')}/TaxRates",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {access_token}",
                    "xero-tenant-id": xero_tenant_id,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise XeroIntegrationError("Could not read Xero tax rates.") from exc
    tax_rates = payload.get("TaxRates") if isinstance(payload, dict) else None
    if not isinstance(tax_rates, list):
        raise XeroIntegrationError("Xero returned an unexpected tax rates response.")
    return [tax_rate for tax_rate in tax_rates if isinstance(tax_rate, dict)]


def token_expiry_from_payload(payload: dict[str, Any]) -> datetime | None:
    return _token_expiry(payload)
