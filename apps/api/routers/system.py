"""System status surface for the Settings integrations health card.

This intentionally returns only booleans about whether each external provider
is configured — no API keys, webhook secrets, account IDs, or other identifying
metadata leak through this endpoint.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from apps.api.deps import CurrentUser, get_current_user
from apps.api.schemas.system import IntegrationStatusRead, ProviderStatus
from stewart.core.settings import Settings, get_settings

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/integration-status", response_model=IntegrationStatusRead)
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
    )


def _status(
    *,
    configured: bool,
    label: str,
    purpose: str,
    unconfigured_detail: str,
) -> ProviderStatus:
    return ProviderStatus(
        configured=configured,
        label=label,
        purpose=purpose,
        detail=(
            "Configured. Provider sends still require explicit reviewed actions."
            if configured
            else unconfigured_detail
        ),
    )
