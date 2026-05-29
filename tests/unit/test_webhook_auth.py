import base64
import hashlib
import hmac
from typing import Any

import pytest
from apps.api.webhook_auth import (
    assert_webhook_secret,
    twilio_signature_valid,
    webhook_secret_valid,
)
from fastapi import HTTPException
from starlette.requests import Request


def _request(
    path: str,
    *,
    query_string: str = "",
    headers: dict[str, str] | None = None,
) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "server": ("testserver", 80),
            "path": path,
            "query_string": query_string.encode(),
            "headers": [
                (key.lower().encode(), value.encode())
                for key, value in (headers or {}).items()
            ],
        }
    )


def _twilio_signature(url: str, payload: dict[str, Any], auth_token: str) -> str:
    values = "".join(f"{key}{str(payload[key])}" for key in sorted(payload))
    digest = hmac.new(
        auth_token.encode(),
        f"{url}{values}".encode(),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode()


def test_webhook_secret_valid_accepts_header_or_query_token() -> None:
    secret = "shared-secret"

    assert webhook_secret_valid(
        _request(
            "/api/v1/work-assignments/webhooks/twilio-status",
            headers={"x-leasium-webhook-secret": secret},
        ),
        secret,
    )
    assert webhook_secret_valid(
        _request(
            "/api/v1/work-assignments/webhooks/twilio-status",
            query_string=f"token={secret}",
        ),
        secret,
    )
    assert not webhook_secret_valid(
        _request(
            "/api/v1/work-assignments/webhooks/twilio-status",
            headers={"x-leasium-webhook-secret": "wrong-secret"},
        ),
        secret,
    )


def test_assert_webhook_secret_rejects_missing_or_wrong_secret() -> None:
    assert_webhook_secret(
        _request(
            "/api/v1/work-assignments/webhooks/sendgrid-events",
            headers={"x-leasium-webhook-secret": "shared-secret"},
        ),
        "shared-secret",
    )

    with pytest.raises(HTTPException) as missing_error:
        assert_webhook_secret(
            _request("/api/v1/work-assignments/webhooks/sendgrid-events"),
            "shared-secret",
        )
    assert missing_error.value.status_code == 401
    assert missing_error.value.detail == "Invalid webhook token."

    with pytest.raises(HTTPException) as wrong_error:
        assert_webhook_secret(
            _request(
                "/api/v1/work-assignments/webhooks/sendgrid-events",
                headers={"x-leasium-webhook-secret": "wrong-secret"},
            ),
            "shared-secret",
        )
    assert wrong_error.value.status_code == 401
    assert wrong_error.value.detail == "Invalid webhook token."


def test_twilio_signature_valid_accepts_public_api_url_signature() -> None:
    payload = {"MessageSid": "SM123", "MessageStatus": "delivered"}
    auth_token = "twilio-token"
    public_url = "https://api.leasium.ai"
    path = "/api/v1/tenant-onboarding/webhooks/twilio-status"
    query = "tenant_onboarding_id=abc"
    signature = _twilio_signature(
        f"{public_url}{path}?{query}",
        payload,
        auth_token,
    )

    assert twilio_signature_valid(
        _request(path, query_string=query, headers={"x-twilio-signature": signature}),
        payload,
        auth_token,
        public_url,
    )
    assert not twilio_signature_valid(
        _request(path, query_string=query),
        payload,
        auth_token,
        public_url,
    )
