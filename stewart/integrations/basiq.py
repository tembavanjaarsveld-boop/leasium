"""Basiq (AU) bank-feed provider boundary.

Mirrors the DocuSign adapter's soft-skip contract: the helper returns a
``skipped`` result with a clear setup error when credentials are missing and
never raises or performs HTTP from that path. Basiq OAuth (user consent +
connection establishment) is a deferred slice, so even when credentials are
configured this v1 returns an empty ``ok`` result rather than calling the
real API. No real money or bank record is ever touched here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from stewart.core.settings import Settings

BasiqFetchStatus = Literal["ok", "skipped", "failed"]


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


def fetch_transactions(
    settings: Settings,
    *,
    account_id: str | None = None,  # noqa: ARG001 - reserved for the OAuth slice
) -> BasiqFetchResult:
    """Fetch bank-feed transactions for reconciliation review.

    When Basiq is not configured, return a ``skipped`` result with a clear
    setup error for the operator receipt -- never raise, never perform HTTP.
    When configured, real fetching still depends on a Basiq OAuth connection
    (user consent), which is a deferred slice; until that lands this returns
    an empty ``ok`` result so the surface stays inert without surprises.
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
    # Configured but no live connection yet: Basiq OAuth/user-consent is a
    # deferred slice. Return an empty ok result rather than calling the API.
    return BasiqFetchResult(status="ok", transactions=[])
