"""System status surface for the Settings integrations health card.

This intentionally returns only booleans about whether each external provider
is configured — no API keys, webhook secrets, account IDs, or other identifying
metadata leak through this endpoint.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, require_platform_admin
from apps.api.schemas.system import IntegrationStatusRead, ProviderStatus

router = APIRouter(prefix="/system", tags=["system"])


@router.get(
    "/integration-status",
    response_model=IntegrationStatusRead,
    response_model_exclude_none=True,
)
def get_integration_status(
    user: Annotated[CurrentUser, Depends(require_platform_admin)],  # noqa: ARG001
    settings: Annotated[Settings, Depends(get_settings)],
) -> IntegrationStatusRead:
    return IntegrationStatusRead(
        serpapi=_status(
            configured=bool(settings.serpapi_api_key),
            label="SerpAPI Google Images",
            purpose="Property image candidate search (Properties > Property images)",
            unconfigured_detail=(
                "Set SERPAPI_API_KEY on the API service to enable property image"
                " preview/apply. Without it the route returns 503 and no records mutate."
            ),
        ),
        openai=_status(
            configured=bool(settings.openai_api_key),
            label="OpenAI",
            purpose="Public field enrichment (Properties/Tenants > Suggest missing values)",
            unconfigured_detail=(
                "Set OPENAI_API_KEY on the API service to enable enrichment previews."
            ),
        ),
        sendgrid=_status(
            configured=bool(settings.sendgrid_api_key and settings.sendgrid_from_email),
            label="SendGrid",
            purpose="Email delivery (invoice, contractor, Work notifications, digests)",
            unconfigured_detail=(
                "Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL on the API service to"
                " enable provider sends. Without them, provider attempts are recorded"
                " as skipped."
            ),
        ),
        twilio=_status(
            configured=bool(
                settings.twilio_account_sid
                and settings.twilio_auth_token
                and settings.twilio_messaging_service_sid
            ),
            label="Twilio Messaging",
            purpose="SMS delivery (Work notifications, contractor SMS)",
            unconfigured_detail=(
                "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and"
                " TWILIO_MESSAGING_SERVICE_SID on the API service to enable SMS sends."
            ),
        ),
        xero=_status(
            configured=bool(
                settings.xero_client_id and settings.xero_client_secret
            ),
            label="Xero",
            purpose="Accounting sync (contact, chart/tax, invoice posting, payments)",
            unconfigured_detail=(
                "Set XERO_CLIENT_ID and XERO_CLIENT_SECRET on the API service and"
                " complete the per-entity OAuth flow before posting invoices."
            ),
        ),
        opensign=_status(
            configured=_opensign_configured(settings),
            live_ready=_opensign_live_ready(settings),
            label="OpenSign",
            purpose="Lease e-signature requests and signed lease retention",
            unconfigured_detail=(
                "Set OPENSIGN_API_TOKEN on the API service before sending lease "
                "e-signature requests."
            ),
            configured_detail=(
                _opensign_configured_detail(settings)
            ),
            webhook_url=_webhook_url(
                settings,
                "/api/v1/tenant-onboarding/webhooks/opensign",
            ),
            missing_config=_missing_opensign_config(settings),
        ),
    )


def _status(
    *,
    configured: bool,
    live_ready: bool | None = None,
    label: str,
    purpose: str,
    unconfigured_detail: str,
    configured_detail: str | None = None,
    webhook_url: str | None = None,
    missing_config: list[str] | None = None,
) -> ProviderStatus:
    return ProviderStatus(
        configured=configured,
        live_ready=configured if live_ready is None else live_ready,
        label=label,
        purpose=purpose,
        detail=(
            configured_detail
            or "Configured. Provider sends still require explicit reviewed actions."
            if configured
            else unconfigured_detail
        ),
        missing_config=missing_config or [],
        webhook_url=webhook_url,
    )


def _webhook_url(settings: Settings, path: str) -> str | None:
    base_url = settings.public_api_url.strip().rstrip("/")
    if not base_url:
        return None
    return f"{base_url}{path}"


def _opensign_configured(settings: Settings) -> bool:
    return bool(settings.opensign_api_token)


def _opensign_production_endpoint_configured(settings: Settings) -> bool:
    return (
        settings.opensign_base_url.strip().rstrip("/")
        == "https://app.opensignlabs.com/api/v1.2"
    )


def _opensign_live_ready(settings: Settings) -> bool:
    return _opensign_configured(settings) and not _missing_opensign_config(settings)


def _opensign_configured_detail(settings: Settings) -> str:
    if not settings.opensign_webhook_secret:
        return (
            "API token is set; add OPENSIGN_WEBHOOK_SECRET before live testing so "
            "completed signing webhooks can be verified."
        )
    if not _opensign_production_endpoint_configured(settings):
        return (
            "Token and webhook secret are set; switch OPENSIGN_BASE_URL to the "
            "production endpoint before live signing."
        )
    if not settings.public_api_url.strip():
        return (
            "Token, webhook secret, and production endpoint are set; add "
            "PUBLIC_API_URL so OpenSign can reach the Relby webhook."
        )
    return "Configured for signature requests and completed signed-document retention."


def _missing_opensign_config(settings: Settings) -> list[str]:
    missing: list[str] = []
    if not settings.opensign_api_token:
        missing.append("OPENSIGN_API_TOKEN")
    if not settings.opensign_webhook_secret:
        missing.append("OPENSIGN_WEBHOOK_SECRET")
    if not settings.public_api_url.strip():
        missing.append("PUBLIC_API_URL")
    if _opensign_configured(settings) and not _opensign_production_endpoint_configured(
        settings
    ):
        missing.append("OPENSIGN_BASE_URL")
    return missing
