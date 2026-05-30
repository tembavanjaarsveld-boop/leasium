"""Basiq (AU) bank-feed provider boundary.

Mirrors the Xero adapter's posture: this module is the ONLY place that talks
to Basiq over HTTP, and it is strictly read-only -- it never moves money and
never writes to a bank. ``fetch_transactions`` re-mints a short-lived server
token (60-min TTL, never persisted) and issues GET requests only.

Soft-skip contract: when credentials are missing, ``fetch_transactions``
returns a ``skipped`` result with a clear setup error and performs no HTTP.
When configured but no Basiq consent connection exists yet (``basiq_user_id``
is None), it returns an empty ``ok`` result so the surface stays inert. The
consent-link / user-creation calls live in dedicated helpers used only by the
explicit, operator-approved connect-start route -- never on the fetch path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

import httpx

from stewart.core.settings import Settings

BasiqFetchStatus = Literal["ok", "skipped", "failed"]

# Defensive cap on transaction pagination so a misbehaving links.next loop
# can never spin forever on the read path.
_MAX_TRANSACTION_PAGES = 20
_TRANSACTION_PAGE_LIMIT = 500


class BasiqIntegrationError(RuntimeError):
    """Raised when a real Basiq API call fails. Carries no secret material."""


@dataclass(frozen=True)
class BasiqTransaction:
    """A single bank-feed transaction surfaced for reconciliation review.

    Amounts are stored in cents to match the Leasium invoice money model so
    call sites can map straight onto the existing reconciliation item schema.
    """

    transaction_id: str
    amount_cents: int
    posted_date: date | None = None
    description: str | None = None
    reference: str | None = None
    counterparty: str | None = None
    account_name: str | None = None


@dataclass(frozen=True)
class BasiqFetchResult:
    """Outcome of a Basiq bank-feed fetch attempt.

    ``skipped`` mirrors the DocuSign soft-skip: credentials missing, nothing
    fetched, no error surfaced to the operator beyond the setup hint.
    ``failed`` carries a provider/network error for a 502 surface.
    """

    status: BasiqFetchStatus
    transactions: list[BasiqTransaction] = field(default_factory=list)
    error: str | None = None


def is_configured(settings: Settings) -> bool:
    """Return True only when a real Basiq call could be attempted.

    Both the feature flag and an API key must be present. This is the
    canonical "can we attempt a real fetch right now" check the
    operator-facing reconciliation endpoints rely on.
    """

    return bool(settings.basiq_enabled and settings.basiq_api_key)


def _api_base(settings: Settings) -> str:
    return settings.basiq_api_base_url.rstrip("/")


def basiq_server_token(settings: Settings) -> str:
    """Mint a short-lived (60-min) Basiq server access token.

    The token is returned to the caller and used immediately; it is never
    persisted (no token-cache columns exist by design). Raises
    :class:`BasiqIntegrationError` on any failure.
    """

    try:
        with httpx.Client(timeout=settings.basiq_http_timeout_seconds) as client:
            response = client.post(
                f"{_api_base(settings)}/token",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Basic {settings.basiq_api_key}",
                    "basiq-version": "3.0",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                content="scope=SERVER_ACCESS",
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise BasiqIntegrationError("Could not obtain a Basiq access token.") from exc
    access_token = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(access_token, str) or not access_token:
        raise BasiqIntegrationError("Basiq returned an unexpected token response.")
    return access_token


def create_basiq_user(settings: Settings, token: str, email: str) -> str:
    """Create a Basiq user for the given email and return its id.

    Only ever called from the explicit, operator-approved connect-start route.
    Never on the read/fetch path.
    """

    try:
        with httpx.Client(timeout=settings.basiq_http_timeout_seconds) as client:
            response = client.post(
                f"{_api_base(settings)}/users",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"email": email},
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise BasiqIntegrationError("Could not create the Basiq user.") from exc
    user_id = payload.get("id") if isinstance(payload, dict) else None
    if not isinstance(user_id, str) or not user_id:
        raise BasiqIntegrationError("Basiq returned an unexpected user response.")
    return user_id


def create_basiq_auth_link(
    settings: Settings,
    token: str,
    basiq_user_id: str,
) -> tuple[str, datetime | None]:
    """Create a consent auth link for the Basiq user.

    Returns ``(public_consent_url, expires_at)``. Only ever called from the
    explicit, operator-approved connect-start route. Never on the fetch path.
    """

    try:
        with httpx.Client(timeout=settings.basiq_http_timeout_seconds) as client:
            response = client.post(
                f"{_api_base(settings)}/users/{basiq_user_id}/auth_link",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {token}",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise BasiqIntegrationError("Could not create the Basiq consent link.") from exc
    links = payload.get("links") if isinstance(payload, dict) else None
    public_url = links.get("public") if isinstance(links, dict) else None
    if not isinstance(public_url, str) or not public_url:
        raise BasiqIntegrationError("Basiq returned an unexpected consent-link response.")
    return public_url, _parse_basiq_datetime(payload.get("expiresAt"))


def fetch_basiq_accounts(
    token: str,
    basiq_user_id: str,
    settings: Settings,
) -> list[dict[str, Any]]:
    """Read the Basiq accounts for a user (read-only)."""

    try:
        with httpx.Client(timeout=settings.basiq_http_timeout_seconds) as client:
            response = client.get(
                f"{_api_base(settings)}/users/{basiq_user_id}/accounts",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {token}",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise BasiqIntegrationError("Could not read Basiq accounts.") from exc
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []
    return [account for account in data if isinstance(account, dict)]


def fetch_basiq_transactions(
    token: str,
    basiq_user_id: str,
    settings: Settings,
    *,
    account_id: str | None = None,
) -> list[dict[str, Any]]:
    """Read posted credit transactions for a Basiq user (read-only).

    Filters to credits with ``posted`` status server-side and paginates via
    ``links.next`` (a full URL), with a defensive page cap. ``account_id`` is
    applied as a client-side guard once rows are read.
    """

    base_filter = "transaction.direction.eq('credit'),transaction.status.eq('posted')"
    url: str | None = f"{_api_base(settings)}/users/{basiq_user_id}/transactions"
    params: dict[str, Any] | None = {
        "limit": _TRANSACTION_PAGE_LIMIT,
        "filter": base_filter,
    }
    rows: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=settings.basiq_http_timeout_seconds) as client:
            for _ in range(_MAX_TRANSACTION_PAGES):
                if url is None:
                    break
                response = client.get(
                    url,
                    params=params,
                    headers={
                        "Accept": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                response.raise_for_status()
                payload = response.json()
                data = payload.get("data") if isinstance(payload, dict) else None
                if isinstance(data, list):
                    rows.extend(row for row in data if isinstance(row, dict))
                links = payload.get("links") if isinstance(payload, dict) else None
                next_url = links.get("next") if isinstance(links, dict) else None
                # links.next is a fully-qualified URL with its own query string.
                url = next_url if isinstance(next_url, str) and next_url else None
                params = None
    except httpx.HTTPError as exc:
        raise BasiqIntegrationError("Could not read Basiq transactions.") from exc
    if account_id is not None:
        rows = [row for row in rows if _row_account_id(row) == account_id]
    return rows


def _parse_basiq_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _clean_text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _row_account_id(raw: dict[str, Any]) -> str | None:
    account = raw.get("account")
    return str(account) if isinstance(account, str | int) and str(account).strip() else None


def _account_name(account: dict[str, Any]) -> str | None:
    for key in ("name", "displayName", "accountNo"):
        value = account.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _counterparty(raw: dict[str, Any]) -> str | None:
    enrich = raw.get("enrich")
    if not isinstance(enrich, dict):
        return None
    merchant = enrich.get("merchant")
    if not isinstance(merchant, dict):
        return None
    business_name = merchant.get("businessName")
    if isinstance(business_name, str) and business_name.strip():
        return business_name.strip()
    return None


def _to_basiq_transaction(
    raw: dict[str, Any],
    accounts_by_id: dict[str, str],
) -> BasiqTransaction | None:
    """Map a raw Basiq transaction row to a ``BasiqTransaction``.

    Returns None for any row that is not an incoming, settled AUD credit, so
    the reconciliation surface only ever sees money that actually landed.
    """

    if raw.get("direction") != "credit" or raw.get("status") != "posted":
        return None
    if raw.get("currency") != "AUD":
        return None
    transaction_id = raw.get("id")
    if not isinstance(transaction_id, str) or not transaction_id:
        return None
    amount_raw = raw.get("amount")
    try:
        amount_cents = int(round(Decimal(str(amount_raw)) * 100))
    except (InvalidOperation, ValueError, TypeError):
        return None

    posted_date: date | None = None
    parsed_post = _parse_basiq_datetime(raw.get("postDate"))
    if parsed_post is not None:
        posted_date = parsed_post.date()

    account_id = _row_account_id(raw)
    account_name = accounts_by_id.get(account_id) if account_id is not None else None

    return BasiqTransaction(
        transaction_id=transaction_id,
        amount_cents=amount_cents,
        posted_date=posted_date,
        description=_clean_text(raw.get("description")),
        reference=_clean_text(raw.get("reference")),
        counterparty=_counterparty(raw),
        account_name=account_name,
    )


def fetch_transactions(
    settings: Settings,
    *,
    basiq_user_id: str | None = None,
    account_id: str | None = None,
) -> BasiqFetchResult:
    """Fetch posted credit transactions for reconciliation review (read-only).

    - Unconfigured -> ``skipped`` with a setup hint; performs no HTTP.
    - Configured but no live connection (``basiq_user_id`` is None) -> empty
      ``ok`` result so the surface stays inert.
    - Configured + a connection -> mint a server token, read accounts +
      transactions, map them, and return ``ok`` with rows. Any provider error
      becomes ``failed`` (surfaced as a 502 upstream).

    This path uses ONLY ``POST /token`` and GET requests. It never creates a
    Basiq user, never creates an auth link, and never issues a DELETE.
    """

    if not is_configured(settings):
        return BasiqFetchResult(
            status="skipped",
            error=(
                "Basiq is not configured. Set BASIQ_ENABLED=true and "
                "BASIQ_API_KEY on the API service to enable bank-feed "
                "reconciliation. See docs/deployment.md for the Basiq setup."
            ),
        )
    # Configured but no live consent connection yet: stay inert (no HTTP).
    if basiq_user_id is None:
        return BasiqFetchResult(status="ok", transactions=[])

    try:
        token = basiq_server_token(settings)
        accounts = fetch_basiq_accounts(token, basiq_user_id, settings)
        accounts_by_id = {
            str(account.get("id")): name
            for account in accounts
            if isinstance(account.get("id"), str) and (name := _account_name(account))
        }
        raw_transactions = fetch_basiq_transactions(
            token,
            basiq_user_id,
            settings,
            account_id=account_id,
        )
    except BasiqIntegrationError as exc:
        return BasiqFetchResult(status="failed", error=str(exc))

    transactions = [
        mapped
        for raw in raw_transactions
        if (mapped := _to_basiq_transaction(raw, accounts_by_id)) is not None
    ]
    return BasiqFetchResult(status="ok", transactions=transactions)
