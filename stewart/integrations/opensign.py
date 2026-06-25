"""OpenSign eSignature provider boundary.

Cloud OpenSign (default ``https://sandbox.opensignlabs.com/api/v1.2``; set
``OPENSIGN_BASE_URL`` to ``https://app.opensignlabs.com/api/v1.2`` for live).
The helper soft-skips when the API token is missing, creates a
signature-request document via ``POST /createdocument`` with the completion
certificate merged into the signed PDF, and downloads the completed PDF from
the presigned URL the completion webhook hands back, for retention.

Review-first (CLAUDE.md §2.1): ``send_lease_for_signature`` only runs on an
explicit operator action; this module never auto-sends.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from io import BytesIO
from typing import Literal
from uuid import UUID

import httpx
from pypdf import PdfReader

from stewart.core.settings import Settings

LeaseSignatureStatus = Literal["queued", "sent", "skipped", "failed"]
SignedLeaseDocumentStatus = Literal["downloaded", "skipped", "failed"]

# OpenSign positions widgets by absolute page coordinates (PDF points) rather
# than DocuSign-style anchor text. v1 drops a single signature widget near the
# bottom of the lease's last page. These coordinates are a starting point:
# calibrate against the real lease pack with OpenSign's Debug UI
# (https://app.opensignlabs.com/debugpdf) and confirm with a sandbox send
# before going live.
_SIGNATURE_WIDGET_X = 72
_SIGNATURE_WIDGET_Y = 690
_SIGNATURE_WIDGET_W = 160
_SIGNATURE_WIDGET_H = 44


@dataclass(frozen=True)
class LeaseSignatureRequest:
    """Context for sending a lease document out for signature.

    Mirrors the data the tenant onboarding invite already has on hand so
    call sites build this from the same lease + tenant context.
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
    """Outcome of an OpenSign create-document attempt.

    ``envelope_id`` carries the OpenSign document ``objectId`` (the provider
    reference id we match completion webhooks against). The field keeps its
    name so the persisted signing state and operator receipt strip stay
    provider-neutral.
    """

    status: LeaseSignatureStatus
    provider: str = "opensign"
    envelope_id: str | None = None
    signer_email: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class SignedLeaseDocumentResult:
    """Downloaded signed (certificate-merged) lease document payload."""

    status: SignedLeaseDocumentStatus
    provider: str = "opensign"
    filename: str | None = None
    content_type: str | None = None
    file_data: bytes | None = None
    error: str | None = None


def is_configured(settings: Settings) -> bool:
    """Return True when a real ``/createdocument`` call can be attempted."""

    return bool(settings.opensign_api_token and settings.opensign_base_url)


def _headers(settings: Settings) -> dict[str, str]:
    return {
        "x-api-token": settings.opensign_api_token,
        "accept": "application/json",
    }


def send_lease_for_signature(
    request: LeaseSignatureRequest, settings: Settings
) -> LeaseSignatureResult:
    """Send a lease document to OpenSign for signature.

    When OpenSign is not configured, return a ``skipped`` result with a clear
    setup error for the operator receipt. When configured, create the
    signature-request document with the attached lease PDF and a single
    signature widget, and return the provider ``objectId`` for downstream
    audit state.
    """

    if not is_configured(settings):
        return LeaseSignatureResult(
            status="skipped",
            signer_email=request.signer_email,
            error=(
                "OpenSign is not configured. Set OPENSIGN_API_TOKEN (and "
                "OPENSIGN_BASE_URL) on the API service to enable "
                "lease-send-for-signature. See docs/deployment.md."
            ),
        )
    if not request.signer_email:
        return LeaseSignatureResult(
            status="skipped",
            signer_email=request.signer_email,
            error="Tenant signer email is required before sending to OpenSign.",
        )

    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                f"{settings.opensign_base_url.rstrip('/')}/createdocument",
                headers=_headers(settings),
                json=_create_document_payload(request),
            )
        if response.status_code >= 400:
            return LeaseSignatureResult(
                status="failed",
                signer_email=request.signer_email,
                error=f"OpenSign document create failed: {response.text}",
            )
        body = response.json()
        object_id = body.get("objectId") if isinstance(body, dict) else None
        if not isinstance(object_id, str) or not object_id:
            return LeaseSignatureResult(
                status="failed",
                signer_email=request.signer_email,
                error="OpenSign create response did not include an objectId.",
            )
        return LeaseSignatureResult(
            status="sent",
            signer_email=request.signer_email,
            envelope_id=object_id,
        )
    except Exception as exc:  # pragma: no cover - defensive provider boundary
        return LeaseSignatureResult(
            status="failed",
            signer_email=request.signer_email,
            error=f"OpenSign request failed: {exc}",
        )


def download_signed_lease_document(
    signed_file_url: str,
    settings: Settings,
) -> SignedLeaseDocumentResult:
    """Download the completed signed PDF from its presigned URL.

    OpenSign's completion webhook hands back a short-lived presigned ``file``
    URL for the signed (certificate-merged) PDF, so retention is a direct GET
    of that URL rather than a token-authenticated provider call. ``settings``
    is accepted for interface parity and future use.
    """

    if not signed_file_url:
        return SignedLeaseDocumentResult(
            status="skipped",
            error="OpenSign signed file URL is required before downloading signed documents.",
        )

    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(signed_file_url)
        if response.status_code >= 400:
            return SignedLeaseDocumentResult(
                status="failed",
                error=f"OpenSign signed document download failed: {response.text}",
            )
        content = response.content
        if not content:
            return SignedLeaseDocumentResult(
                status="failed",
                error="OpenSign signed document download returned no content.",
            )
        return SignedLeaseDocumentResult(
            status="downloaded",
            content_type=response.headers.get("content-type") or "application/pdf",
            file_data=content,
        )
    except Exception as exc:  # pragma: no cover - defensive provider boundary
        return SignedLeaseDocumentResult(
            status="failed",
            error=f"OpenSign signed document download failed: {exc}",
        )


def _last_page(document_bytes: bytes) -> int:
    """Best-effort page count for placing the signature on the last page."""

    try:
        reader = PdfReader(BytesIO(document_bytes))
        return max(len(reader.pages), 1)
    except Exception:  # noqa: BLE001 - placement falls back to the first page
        return 1


def _create_document_payload(request: LeaseSignatureRequest) -> dict[str, object]:
    signer_name = request.signer_name or request.tenant_name
    title = f"Lease agreement – {request.property_name}"
    if request.unit_label:
        title = f"{title} ({request.unit_label})"
    signature_widget = {
        "type": "signature",
        "page": _last_page(request.document_bytes),
        "x": _SIGNATURE_WIDGET_X,
        "y": _SIGNATURE_WIDGET_Y,
        "w": _SIGNATURE_WIDGET_W,
        "h": _SIGNATURE_WIDGET_H,
    }
    payload: dict[str, object] = {
        "file": base64.b64encode(request.document_bytes).decode(),
        "title": title,
        "note": f"Please review and sign your lease for {request.property_name}.",
        "send_email": True,
        "merge_certificate": True,
        "signers": [
            {
                "name": signer_name,
                "email": request.signer_email,
                "signer_role": "signer",
                "widgets": [signature_widget],
            }
        ],
    }
    if request.redirect_url:
        payload["redirect_url"] = request.redirect_url
    return payload
