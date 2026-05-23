"""DocuSign integration scaffold.

Skeleton for the upcoming e-signature path described in
``docs/automation-strategy-2026-05-23.md`` (medium-term backlog). When the
operator has the DocuSign developer account provisioned and the four
``docusign_*`` env vars populated, callers can drive lease-send-for-signature
through this module. Until then, ``send_lease_for_signature`` returns a
``LeaseSignatureResult`` with ``status="skipped"`` and an explicit
``not_configured`` error so calling code can soft-fail without hardcoding
provider details.

This module deliberately does no network I/O yet. The shape is in place so
the next slice can drop in the actual envelope-create + Connect-webhook
plumbing without touching call sites.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from stewart.core.settings import Settings

LeaseSignatureStatus = Literal["queued", "sent", "skipped", "failed"]


@dataclass(frozen=True)
class LeaseSignatureRequest:
    """Context for sending a lease document out for signature.

    Mirrors the data the existing tenant onboarding invite uses so call
    sites can build this dataclass from the same lease + tenant context
    they already have on hand.
    """

    lease_id: UUID
    entity_id: UUID
    tenant_name: str
    signer_name: str | None
    signer_email: str | None
    property_name: str
    unit_label: str | None
    document_filename: str
    document_bytes: bytes
    redirect_url: str | None = None


@dataclass(frozen=True)
class LeaseSignatureResult:
    """Outcome of a DocuSign envelope-create attempt.

    Mirrors ``DeliveryResult`` from communications.py so the operator
    surface can render the same kind of receipt strip (status + error +
    provider_message_id) regardless of which channel fired.
    """

    status: LeaseSignatureStatus
    provider: str = "docusign"
    envelope_id: str | None = None
    signer_email: str | None = None
    error: str | None = None


def is_configured(settings: Settings) -> bool:
    """Return True when all the credentials needed for a real call are set.

    Operators see the surface explanation of what's missing through the
    deployment doc; this helper is the canonical "can we attempt a real
    send right now" check the operator-facing endpoints rely on.
    """

    return bool(
        settings.docusign_account_id
        and settings.docusign_integration_key
        and settings.docusign_user_id
        and settings.docusign_rsa_private_key
    )


def send_lease_for_signature(
    request: LeaseSignatureRequest, settings: Settings
) -> LeaseSignatureResult:
    """Send a lease document to DocuSign for signature.

    Scaffold v1: when DocuSign is not yet configured (the common case
    until the operator provisions a developer account), the helper
    returns a ``skipped`` result with a ``not_configured`` error so the
    operator surface can render a clear receipt. The actual envelope
    create + recipient routing lands in the next slice once credentials
    are in hand.
    """

    if not is_configured(settings):
        return LeaseSignatureResult(
            status="skipped",
            signer_email=request.signer_email,
            error=(
                "DocuSign is not configured. Set DOCUSIGN_ACCOUNT_ID, "
                "DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, and "
                "DOCUSIGN_RSA_PRIVATE_KEY on the API service to enable "
                "lease-send-for-signature. See docs/deployment.md for the "
                "JWT grant setup."
            ),
        )

    # Real envelope-create call lands in the next slice. Until then we
    # mark the request "queued" with no envelope id so call sites can
    # surface a stub receipt during development.
    return LeaseSignatureResult(
        status="queued",
        signer_email=request.signer_email,
        envelope_id=None,
        error=(
            "DocuSign integration is scaffolded; envelope create + Connect "
            "webhook plumbing has not landed yet. Treat the queued status "
            "as a stub until the integration slice ships."
        ),
    )
