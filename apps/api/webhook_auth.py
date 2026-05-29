"""Shared webhook authentication helpers for provider callbacks."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from typing import Any

from fastapi import HTTPException, Request, status


def webhook_secret_valid(request: Request, secret: str) -> bool:
    supplied = (
        request.headers.get("x-leasium-webhook-secret")
        or request.query_params.get("token")
        or ""
    ).strip()
    return bool(supplied) and secrets.compare_digest(supplied, secret)


def assert_webhook_secret(request: Request, secret: str) -> None:
    if not webhook_secret_valid(request, secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook token.",
        )


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
