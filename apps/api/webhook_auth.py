"""Shared webhook authentication helpers for provider callbacks."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_der_public_key
from fastapi import HTTPException, Request, status


def webhook_secret_valid(
    request: Request,
    secret: str,
    *,
    header_names: tuple[str, ...] = ("x-leasium-webhook-secret",),
) -> bool:
    supplied = ""
    for header_name in header_names:
        supplied = request.headers.get(header_name, "").strip()
        if supplied:
            break
    supplied = supplied or (request.query_params.get("token") or "").strip()
    return bool(supplied) and secrets.compare_digest(supplied, secret)


def assert_webhook_secret(
    request: Request,
    secret: str,
    *,
    header_names: tuple[str, ...] = ("x-leasium-webhook-secret",),
) -> None:
    if not webhook_secret_valid(request, secret, header_names=header_names):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook token.",
        )


SENDGRID_SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature"
SENDGRID_TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp"


def sendgrid_event_signature_valid(
    request: Request,
    body: bytes,
    verification_key: str,
) -> bool:
    """Verify a SendGrid Signed Event Webhook request.

    SendGrid signs the raw POST body using ECDSA (Elliptic Curve Digital
    Signature Algorithm, NIST P-256 / prime256v1) over ``timestamp + payload``.
    The signature travels base64-encoded in ``X-Twilio-Email-Event-Webhook-
    Signature`` and the timestamp in ``X-Twilio-Email-Event-Webhook-Timestamp``.
    ``verification_key`` is the base64 DER public key shown in the SendGrid UI.

    Returns ``False`` on any missing header, malformed key, or verification
    failure. ``cryptography`` is a transitive dependency (via ``pyjwt[crypto]``)
    so the module-level import is always available.
    """

    signature_b64 = request.headers.get(SENDGRID_SIGNATURE_HEADER, "").strip()
    timestamp = request.headers.get(SENDGRID_TIMESTAMP_HEADER, "").strip()
    if not signature_b64 or not timestamp or not verification_key.strip():
        return False
    try:
        der = base64.b64decode(verification_key.strip())
        public_key = load_der_public_key(der)
    except (ValueError, TypeError):
        return False
    if not isinstance(public_key, ec.EllipticCurvePublicKey):
        return False
    try:
        signature = base64.b64decode(signature_b64)
    except (ValueError, TypeError):
        return False
    signed_payload = timestamp.encode() + body
    try:
        public_key.verify(signature, signed_payload, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        return False
    except Exception:  # noqa: BLE001 - any verify error is a rejection
        return False
    return True


def assert_sendgrid_event_webhook_auth(
    request: Request,
    body: bytes,
    *,
    signing_key: str,
    secret: str,
) -> None:
    """Authenticate an inbound SendGrid Event Webhook request.

    When a Signed Event Webhook ``signing_key`` is configured it is the
    strongest check: a valid ECDSA signature passes, anything else is 403.
    A configured shared ``secret`` is the fallback (and the only check when no
    signing key is set), matching the existing shared-secret behaviour:
    mismatch is 401. With neither configured the endpoint stays open so the
    provider-only webhook keeps working before credentials are pasted in.
    """

    if signing_key.strip():
        if sendgrid_event_signature_valid(request, body, signing_key):
            return
        if secret.strip() and webhook_secret_valid(request, secret):
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid SendGrid event signature.",
        )
    if secret.strip():
        assert_webhook_secret(request, secret)


def sendgrid_event_already_processed(
    processed_ids: list[Any] | None,
    event_id: str | None,
) -> bool:
    """Return ``True`` when ``event_id`` is already in ``processed_ids``.

    SendGrid stamps each event with a unique ``sg_event_id``; replays carry the
    same id. Callers persist the returned id (see ``record_processed_event_id``)
    so a redelivered batch is a no-op rather than double-counting receipts.
    """

    if not event_id:
        return False
    return event_id in {str(value) for value in (processed_ids or [])}


def record_processed_event_id(
    processed_ids: list[Any] | None,
    event_id: str | None,
    *,
    limit: int = 200,
) -> list[str]:
    """Return a capped, de-duplicated list with ``event_id`` recorded first."""

    existing = [str(value) for value in (processed_ids or []) if value]
    if not event_id:
        return existing[:limit]
    if event_id in existing:
        return existing[:limit]
    return [event_id, *existing][:limit]


def twilio_signature_valid(
    request: Request,
    payload: dict[str, Any],
    auth_token: str,
    public_api_url: str,
) -> bool:
    supplied = request.headers.get("x-twilio-signature", "").strip()
    if not supplied:
        return False

    values = "".join(f"{key}{str(payload[key])}" for key in sorted(payload))
    urls = [str(request.url)]
    base_url = public_api_url.strip().rstrip("/")
    if base_url:
        query = f"?{request.url.query}" if request.url.query else ""
        urls.append(f"{base_url}{request.url.path}{query}")

    for url in urls:
        digest = hmac.new(
            auth_token.encode(),
            f"{url}{values}".encode(),
            hashlib.sha1,
        ).digest()
        if secrets.compare_digest(supplied, base64.b64encode(digest).decode()):
            return True
    return False


def opensign_signature_valid(
    request: Request,
    body: bytes,
    secret: str,
) -> bool:
    """Verify an OpenSign webhook request.

    OpenSign signs the raw request body with HMAC-SHA256 using the webhook
    security key and sends the hex digest in the ``x-webhook-signature``
    header. Uses the raw body bytes (not a re-serialised payload) so the
    digest matches what OpenSign computed. Returns ``False`` on any missing
    header, missing secret, or mismatch.
    """

    supplied = request.headers.get("x-webhook-signature", "").strip()
    if not supplied or not secret.strip():
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(supplied, expected)
