"""DocuSign eSignature provider boundary.

The helper soft-skips when credentials are missing, performs JWT grant and
envelope creation when configured, and can download the completed envelope PDF
for retention after a Connect completion webhook.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path
from time import time
from typing import Literal
from uuid import UUID

import httpx
import jwt

from stewart.core.settings import Settings

LeaseSignatureStatus = Literal["queued", "sent", "skipped", "failed"]
SignedLeaseDocumentStatus = Literal["downloaded", "skipped", "failed"]


@dataclass(frozen=True)
class LeaseSignatureRequest:
    """Context for sending a lease document out for signature.

    Mirrors the data the existing tenant onboarding invite uses so call
    sites can build this dataclass from the same lease + tenant context
    they already have on hand.
    """

    lease_id: UUID
    tenant_onboarding_id: UUID
    document_id: UUID
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


@dataclass(frozen=True)
class SignedLeaseDocumentResult:
    """Downloaded signed lease document payload from DocuSign."""

    status: SignedLeaseDocumentStatus
    provider: str = "docusign"
    filename: str | None = None
    content_type: str | None = None
    file_data: bytes | None = None
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


def download_signed_lease_document(
    envelope_id: str,
    settings: Settings,
) -> SignedLeaseDocumentResult:
    """Download DocuSign's combined completed-envelope PDF for retention."""

    if not is_configured(settings):
        return SignedLeaseDocumentResult(
            status="skipped",
            error=(
                "DocuSign is not configured. Set DOCUSIGN_ACCOUNT_ID, "
                "DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, and "
                "DOCUSIGN_RSA_PRIVATE_KEY on the API service to enable "
                "signed-document retention."
            ),
        )
    if not envelope_id:
        return SignedLeaseDocumentResult(
            status="skipped",
            error="DocuSign envelope id is required before downloading signed documents.",
        )

    try:
        with httpx.Client(timeout=20.0) as client:
            token_result = _request_access_token(settings, client)
            if token_result.status != "sent":
                return SignedLeaseDocumentResult(status="failed", error=token_result.error)
            return _download_combined_document(
                envelope_id,
                settings,
                client,
                access_token=token_result.envelope_id or "",
            )
    except Exception as exc:  # pragma: no cover - defensive provider boundary
        return SignedLeaseDocumentResult(
            status="failed",
            error=f"DocuSign signed document download failed: {exc}",
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
    if not request.signer_email:
        return LeaseSignatureResult(
            status="skipped",
            signer_email=request.signer_email,
            error="Tenant signer email is required before sending to DocuSign.",
        )

    try:
        with httpx.Client(timeout=20.0) as client:
            token_result = _request_access_token(settings, client)
            if token_result.status != "sent":
                return LeaseSignatureResult(
                    status="failed",
                    signer_email=request.signer_email,
                    error=token_result.error,
                )
            envelope_result = _create_envelope(
                request,
                settings,
                client,
                access_token=token_result.envelope_id or "",
            )
            return envelope_result
    except Exception as exc:  # pragma: no cover - defensive provider boundary
        return LeaseSignatureResult(
            status="failed",
            signer_email=request.signer_email,
            error=f"DocuSign request failed: {exc}",
        )


def _request_access_token(settings: Settings, client: httpx.Client) -> LeaseSignatureResult:
    now = int(time())
    audience = settings.docusign_auth_base_url.removeprefix("https://").removeprefix("http://")
    assertion = jwt.encode(
        {
            "iss": settings.docusign_integration_key,
            "sub": settings.docusign_user_id,
            "aud": audience.rstrip("/"),
            "iat": now,
            "exp": now + 3600,
            "scope": "signature impersonation",
        },
        settings.docusign_rsa_private_key,
        algorithm="RS256",
    )
    response = client.post(
        f"{settings.docusign_auth_base_url.rstrip('/')}/oauth/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        },
    )
    if response.status_code >= 400:
        return LeaseSignatureResult(
            status="failed",
            error=f"DocuSign token request failed: {response.text}",
        )
    access_token = response.json().get("access_token")
    if not isinstance(access_token, str) or not access_token:
        return LeaseSignatureResult(
            status="failed",
            error="DocuSign token response did not include an access token.",
        )
    return LeaseSignatureResult(status="sent", envelope_id=access_token)


def _create_envelope(
    request: LeaseSignatureRequest,
    settings: Settings,
    client: httpx.Client,
    *,
    access_token: str,
) -> LeaseSignatureResult:
    response = client.post(
        (
            f"{settings.docusign_base_url.rstrip('/')}/v2.1/accounts/"
            f"{settings.docusign_account_id}/envelopes"
        ),
        headers={"Authorization": f"Bearer {access_token}"},
        json=_envelope_payload(request),
    )
    if response.status_code >= 400:
        return LeaseSignatureResult(
            status="failed",
            signer_email=request.signer_email,
            error=f"DocuSign envelope create failed: {response.text}",
        )
    body = response.json()
    envelope_id = body.get("envelopeId")
    return LeaseSignatureResult(
        status="sent",
        signer_email=request.signer_email,
        envelope_id=str(envelope_id) if envelope_id else None,
    )


def _download_combined_document(
    envelope_id: str,
    settings: Settings,
    client: httpx.Client,
    *,
    access_token: str,
) -> SignedLeaseDocumentResult:
    response = client.get(
        (
            f"{settings.docusign_base_url.rstrip('/')}/v2.1/accounts/"
            f"{settings.docusign_account_id}/envelopes/{envelope_id}/documents/combined"
        ),
        headers={"Authorization": f"Bearer {access_token}"},
        params={"certificate": "true"},
    )
    if response.status_code >= 400:
        return SignedLeaseDocumentResult(
            status="failed",
            error=f"DocuSign signed document download failed: {response.text}",
        )
    content = response.content
    if not content:
        return SignedLeaseDocumentResult(
            status="failed",
            error="DocuSign signed document download returned no content.",
        )
    return SignedLeaseDocumentResult(
        status="downloaded",
        filename=f"signed-lease-{envelope_id}.pdf",
        content_type=response.headers.get("content-type") or "application/pdf",
        file_data=content,
    )


def _envelope_payload(request: LeaseSignatureRequest) -> dict[str, object]:
    extension = Path(request.document_filename).suffix.lower().lstrip(".") or "pdf"
    signer_name = request.signer_name or request.tenant_name
    signer: dict[str, object] = {
        "email": request.signer_email,
        "name": signer_name,
        "recipientId": "1",
        "routingOrder": "1",
        "tabs": {
            "signHereTabs": [
                {
                    "anchorString": "/sn1/",
                    "anchorUnits": "pixels",
                    "anchorXOffset": "20",
                    "anchorYOffset": "10",
                }
            ]
        },
    }
    return {
        "emailSubject": f"Please sign the lease for {request.property_name}",
        "status": "sent",
        "documents": [
            {
                "documentBase64": base64.b64encode(request.document_bytes).decode(),
                "documentId": "1",
                "fileExtension": extension,
                "name": request.document_filename,
            }
        ],
        "recipients": {"signers": [signer]},
        "customFields": {
            "textCustomFields": [
                {"name": "lease_id", "value": str(request.lease_id), "show": "false"},
                {
                    "name": "tenant_onboarding_id",
                    "value": str(request.tenant_onboarding_id),
                    "show": "false",
                },
                {"name": "document_id", "value": str(request.document_id), "show": "false"},
                {"name": "entity_id", "value": str(request.entity_id), "show": "false"},
                {"name": "property_name", "value": request.property_name, "show": "false"},
                {
                    "name": "unit_label",
                    "value": request.unit_label or "",
                    "show": "false",
                },
            ]
        },
    }
