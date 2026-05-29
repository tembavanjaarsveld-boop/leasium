"""System status surface for the Settings integrations health card.

This intentionally returns only booleans about whether each external provider
is configured — no API keys, webhook secrets, account IDs, or other identifying
metadata leak through this endpoint.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, get_current_user
from apps.api.schemas.system import IntegrationStatusRead, ProviderStatus

router = APIRouter(prefix="/system", tags=["system"])


@router.get(
    "/integration-status",
    response_model=IntegrationStatusRead,
    response_model_exclude_none=True,
)
def get_integration_status(
    user: Annotated[CurrentUser, Depends(get_current_user)],  # noqa: ARG001
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
        docusign=_status(
            configured=_docusign_credentials_configured(settings),
            live_ready=_docusign_live_ready(settings),
            label="DocuSign",
            purpose="Lease signature envelopes and signed lease retention",
            unconfigured_detail=(
                "Set DOCUSIGN_ACCOUNT_ID, DOCUSIGN_INTEGRATION_KEY, "
                "DOCUSIGN_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY on the API service "
                "before sending lease envelopes."
            ),
            configured_detail=(
                _docusign_configured_detail(settings)
            ),
            webhook_url=_webhook_url(
                settings,
                "/api/v1/tenant-onboarding/webhooks/docusign",
            ),
            missing_config=_missing_docusign_config(settings),
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


def _docusign_credentials_configured(settings: Settings) -> bool:
    return bool(
        settings.docusign_account_id
        and settings.docusign_integration_key
        and settings.docusign_user_id
        and settings.docusign_rsa_private_key
    )


def _docusign_live_ready(settings: Settings) -> bool:
    return _docusign_credentials_configured(settings) and not _missing_docusign_config(
        settings
    )


def _docusign_configured_detail(settings: Settings) -> str:
    if not settings.docusign_webhook_secret:
        return (
            "Credentials are set; add DOCUSIGN_WEBHOOK_SECRET before live "
            "Connect testing so completed envelopes can be verified."
        )
    if not _docusign_production_endpoints_configured(settings):
        return (
            "Credentials and webhook are set; switch DocuSign REST and auth URLs "
            "to production before live envelope testing."
        )
    if not settings.public_api_url.strip():
        return (
            "Credentials, webhook secret, and production DocuSign endpoints are set; "
            "add PUBLIC_API_URL so Connect can reach the Leasium webhook."
        )
    return "Configured for envelope creation and completed signed-document retention."


def _docusign_production_endpoints_configured(settings: Settings) -> bool:
    return (
        settings.docusign_base_url.strip().rstrip("/")
        == "https://www.docusign.net/restapi"
        and settings.docusign_auth_base_url.strip().rstrip("/")
        == "https://account.docusign.com"
    )


def _missing_docusign_config(settings: Settings) -> list[str]:
    missing: list[str] = []
    if not settings.docusign_account_id:
        missing.append("DOCUSIGN_ACCOUNT_ID")
    if not settings.docusign_integration_key:
        missing.append("DOCUSIGN_INTEGRATION_KEY")
    if not settings.docusign_user_id:
        missing.append("DOCUSIGN_USER_ID")
    if not settings.docusign_rsa_private_key:
        missing.append("DOCUSIGN_RSA_PRIVATE_KEY")
    if not settings.docusign_webhook_secret:
        missing.append("DOCUSIGN_WEBHOOK_SECRET")
    if not settings.public_api_url.strip():
        missing.append("PUBLIC_API_URL")
    if _docusign_credentials_configured(settings):
        if (
            settings.docusign_base_url.strip().rstrip("/")
            != "https://www.docusign.net/restapi"
        ):
            missing.append("DOCUSIGN_BASE_URL")
        if (
            settings.docusign_auth_base_url.strip().rstrip("/")
            != "https://account.docusign.com"
        ):
            missing.append("DOCUSIGN_AUTH_BASE_URL")
    return missing
