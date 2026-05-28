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
            configured=bool(
                settings.docusign_account_id
                and settings.docusign_integration_key
                and settings.docusign_user_id
                and settings.docusign_rsa_private_key
            ),
            label="DocuSign",
            purpose="Lease signature envelopes and signed lease retention",
            unconfigured_detail=(
                "Set DOCUSIGN_ACCOUNT_ID, DOCUSIGN_INTEGRATION_KEY, "
                "DOCUSIGN_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY on the API service "
                "before sending lease envelopes."
            ),
            configured_detail=(
                "Configured for envelope creation and completed signed-document "
                "retention."
                if settings.docusign_webhook_secret
                else (
                    "Credentials are set; add DOCUSIGN_WEBHOOK_SECRET before live "
                    "Connect testing so completed envelopes can be verified."
                )
            ),
            webhook_url=_webhook_url(
                settings,
                "/api/v1/tenant-onboarding/webhooks/docusign",
            ),
        ),
    )


def _status(
    *,
    configured: bool,
    label: str,
    purpose: str,
    unconfigured_detail: str,
    configured_detail: str | None = None,
    webhook_url: str | None = None,
) -> ProviderStatus:
    return ProviderStatus(
        configured=configured,
        label=label,
        purpose=purpose,
        detail=(
            configured_detail
            or "Configured. Provider sends still require explicit reviewed actions."
            if configured
            else unconfigured_detail
        ),
        webhook_url=webhook_url,
    )


def _webhook_url(settings: Settings, path: str) -> str | None:
    base_url = settings.public_api_url.strip().rstrip("/")
    if not base_url:
        return None
    return f"{base_url}{path}"
