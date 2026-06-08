"""Provider webhook hardening tests: SendGrid Event Webhook + Twilio status.

Covers the inbound receipt path only — these webhooks RECORD provider events
and must never trigger an outbound SendGrid/Twilio send. The real provider
payload shapes are exercised here:

- SendGrid: the event array (each event carries ``email``, ``event``,
  ``sg_message_id``, ``sg_event_id``, ``timestamp``, and ``reason`` for
  bounce/dropped), plus the ECDSA Signed Event Webhook signature headers.
- Twilio: the form-encoded status callback keyed on ``MessageSid`` with
  ``MessageStatus`` transitions and ``ErrorCode`` on failure.

Signature shapes confirmed against Twilio docs (mcp twilio__search):
- Twilio SMS StatusCallback fields MessageStatus/ErrorCode:
  https://www.twilio.com/docs/messaging/api/message-resource
- SendGrid Signed Event Webhook uses ECDSA (P-256) over timestamp+payload,
  header ``X-Twilio-Email-Event-Webhook-Signature`` /
  ``X-Twilio-Email-Event-Webhook-Timestamp``:
  https://www.twilio.com/en-us/changelog/signed-event-webhook-requests-and-oauth-for-event-webhook-genera
"""

import base64
import hashlib
import hmac
import json
from uuid import UUID

from apps.api import webhook_auth
from apps.api.routers import tenant_onboarding as tenant_onboarding_router
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, TenantOnboarding


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _twilio_signature(url: str, data: dict[str, str], auth_token: str) -> str:
    payload = url + "".join(f"{key}{data[key]}" for key in sorted(data))
    digest = hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def _sendgrid_keypair() -> tuple[ec.EllipticCurvePrivateKey, str]:
    """Return an ECDSA P-256 private key and the base64 DER public key.

    SendGrid hands you the public key as base64 DER (the same encoding our
    verifier loads). We generate a matching keypair so the test can sign a
    payload exactly the way SendGrid would.
    """

    private_key = ec.generate_private_key(ec.SECP256R1())
    der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_key, base64.b64encode(der).decode()


def _sendgrid_signature_headers(
    private_key: ec.EllipticCurvePrivateKey,
    timestamp: str,
    body: bytes,
) -> dict[str, str]:
    signature = private_key.sign(timestamp.encode() + body, ec.ECDSA(hashes.SHA256()))
    return {
        "X-Twilio-Email-Event-Webhook-Timestamp": timestamp,
        "X-Twilio-Email-Event-Webhook-Signature": base64.b64encode(signature).decode(),
        "Content-Type": "application/json",
    }


def _lease_id(client: TestClient, session: Session) -> str:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Webhook Plaza",
            "street_address": "9 Receipt Road",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_office",
        },
    )
    assert property_response.status_code == 201
    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_response.json()["id"], "unit_label": "Suite 2"},
    )
    assert unit_response.status_code == 201
    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Receipt Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_response.json()["id"],
            "tenant_id": tenant_response.json()["id"],
            "status": "active",
            "commencement_date": "2026-08-01",
            "expiry_date": "2029-07-31",
        },
    )
    assert lease_response.status_code == 201
    return str(lease_response.json()["id"])


def _onboarding_with_email_channel(client: TestClient, session: Session) -> TenantOnboarding:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding = session.get(TenantOnboarding, UUID(create_response.json()["id"]))
    assert onboarding is not None
    onboarding.delivery_data = {
        **(onboarding.delivery_data or {}),
        "channels": {
            "email": {
                "channel": "email",
                "status": "queued",
                "provider_message_id": "sg-message-1",
            }
        },
        "receipts": [],
    }
    session.commit()
    return onboarding


# --- SendGrid event webhook ------------------------------------------------


def test_sendgrid_delivered_then_bounce_updates_receipt(
    client: TestClient,
    session: Session,
) -> None:
    onboarding = _onboarding_with_email_channel(client, session)
    onboarding_id = str(onboarding.id)

    delivered = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
        json=[
            {
                "email": "tenant@example.com",
                "event": "delivered",
                "sg_message_id": "sg-message-1",
                "sg_event_id": "evt-delivered-1",
                "timestamp": 1700000000,
                "tenant_onboarding_id": onboarding_id,
            }
        ],
    )
    assert delivered.status_code == 204
    session.refresh(onboarding)
    assert onboarding.delivery_data["channels"]["email"]["status"] == "delivered"

    bounce = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
        json=[
            {
                "email": "tenant@example.com",
                "event": "bounce",
                "sg_message_id": "sg-message-1",
                "sg_event_id": "evt-bounce-1",
                "timestamp": 1700000100,
                "reason": "550 5.1.1 user unknown",
                "tenant_onboarding_id": onboarding_id,
            }
        ],
    )
    assert bounce.status_code == 204
    session.refresh(onboarding)
    email_channel = onboarding.delivery_data["channels"]["email"]
    assert email_channel["status"] == "failed"
    assert email_channel["last_event"] == "bounce"
    assert "550" in email_channel["error"]


def test_sendgrid_duplicate_event_is_idempotent(
    client: TestClient,
    session: Session,
) -> None:
    onboarding = _onboarding_with_email_channel(client, session)
    onboarding_id = str(onboarding.id)
    event = {
        "email": "tenant@example.com",
        "event": "delivered",
        "sg_message_id": "sg-message-1",
        "sg_event_id": "evt-dup-1",
        "timestamp": 1700000000,
        "tenant_onboarding_id": onboarding_id,
    }

    first = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events", json=[event]
    )
    assert first.status_code == 204
    session.refresh(onboarding)
    assert len(onboarding.delivery_data["receipts"]) == 1

    # Redelivery of the exact same sg_event_id must not add a second receipt.
    second = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events", json=[event]
    )
    assert second.status_code == 204
    session.refresh(onboarding)
    assert len(onboarding.delivery_data["receipts"]) == 1
    assert onboarding.delivery_data["processed_event_ids"] == ["evt-dup-1"]


def test_sendgrid_bad_signature_returns_403(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """A configured signing key rejects events without a valid signature."""

    from stewart.core.settings import Settings

    _, public_key_b64 = _sendgrid_keypair()
    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: Settings(sendgrid_event_webhook_signing_key=public_key_b64),
    )
    onboarding = _onboarding_with_email_channel(client, session)

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
        content=json.dumps(
            [{"event": "delivered", "sg_message_id": "sg-message-1"}]
        ),
        headers={
            "Content-Type": "application/json",
            "X-Twilio-Email-Event-Webhook-Timestamp": "1700000000",
            "X-Twilio-Email-Event-Webhook-Signature": base64.b64encode(b"wrong").decode(),
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid SendGrid event signature."
    session.refresh(onboarding)
    assert onboarding.delivery_data["channels"]["email"]["status"] == "queued"


def test_sendgrid_valid_signature_returns_204(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """A correctly signed payload passes verification and records the receipt."""

    from stewart.core.settings import Settings

    private_key, public_key_b64 = _sendgrid_keypair()
    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: Settings(sendgrid_event_webhook_signing_key=public_key_b64),
    )
    onboarding = _onboarding_with_email_channel(client, session)
    onboarding_id = str(onboarding.id)

    body = json.dumps(
        [
            {
                "email": "tenant@example.com",
                "event": "delivered",
                "sg_message_id": "sg-message-1",
                "sg_event_id": "evt-signed-1",
                "tenant_onboarding_id": onboarding_id,
            }
        ]
    ).encode()
    headers = _sendgrid_signature_headers(private_key, "1700000000", body)

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
        content=body,
        headers=headers,
    )
    assert response.status_code == 204
    session.refresh(onboarding)
    assert onboarding.delivery_data["channels"]["email"]["status"] == "delivered"


# --- Twilio status callback ------------------------------------------------


def _onboarding_with_sms_channel(
    client: TestClient, session: Session, message_sid: str
) -> TenantOnboarding:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding = session.get(TenantOnboarding, UUID(create_response.json()["id"]))
    assert onboarding is not None
    onboarding.delivery_data = {
        "channels": {
            "sms": {
                "channel": "sms",
                "status": "queued",
                "provider_message_id": message_sid,
            }
        },
        "receipts": [],
    }
    session.commit()
    return onboarding


def test_twilio_delivered_status_updates_receipt(
    client: TestClient,
    session: Session,
) -> None:
    onboarding = _onboarding_with_sms_channel(client, session, "SM-delivered-1")

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/twilio-status",
        data={
            "MessageSid": "SM-delivered-1",
            "MessageStatus": "delivered",
            "To": "+61400111222",
        },
    )
    assert response.status_code == 204
    session.refresh(onboarding)
    assert onboarding.delivery_data["channels"]["sms"]["status"] == "delivered"
    assert len(onboarding.delivery_data["receipts"]) == 1


def test_twilio_failed_status_captures_error_code(
    client: TestClient,
    session: Session,
) -> None:
    onboarding = _onboarding_with_sms_channel(client, session, "SM-failed-1")

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/twilio-status",
        data={
            "MessageSid": "SM-failed-1",
            "MessageStatus": "failed",
            "ErrorCode": "30008",
            "To": "+61400111222",
        },
    )
    assert response.status_code == 204
    session.refresh(onboarding)
    sms_channel = onboarding.delivery_data["channels"]["sms"]
    assert sms_channel["status"] == "failed"
    assert sms_channel["error"] == "30008"


def test_twilio_duplicate_status_is_idempotent(
    client: TestClient,
    session: Session,
) -> None:
    onboarding = _onboarding_with_sms_channel(client, session, "SM-dup-1")
    data = {
        "MessageSid": "SM-dup-1",
        "MessageStatus": "delivered",
        "To": "+61400111222",
    }

    first = client.post(
        "/api/v1/tenant-onboarding/webhooks/twilio-status", data=data
    )
    assert first.status_code == 204
    session.refresh(onboarding)
    assert len(onboarding.delivery_data["receipts"]) == 1

    second = client.post(
        "/api/v1/tenant-onboarding/webhooks/twilio-status", data=data
    )
    assert second.status_code == 204
    session.refresh(onboarding)
    assert len(onboarding.delivery_data["receipts"]) == 1


def test_twilio_bad_signature_returns_403_when_token_configured(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: Settings(twilio_auth_token="twilio-secret"),
    )
    onboarding = _onboarding_with_sms_channel(client, session, "SM-unsigned-1")

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/twilio-status",
        data={
            "MessageSid": "SM-unsigned-1",
            "MessageStatus": "delivered",
            "To": "+61400111222",
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid Twilio webhook signature."
    session.refresh(onboarding)
    assert onboarding.delivery_data["channels"]["sms"]["status"] == "queued"


def test_twilio_valid_signature_returns_204(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    from stewart.core.settings import Settings

    auth_token = "twilio-secret"
    public_api_url = "https://api.leasium.test"
    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: Settings(public_api_url=public_api_url, twilio_auth_token=auth_token),
    )
    onboarding = _onboarding_with_sms_channel(client, session, "SM-signed-1")
    data = {
        "MessageSid": "SM-signed-1",
        "MessageStatus": "delivered",
        "To": "+61400111222",
    }
    url = f"{public_api_url}/api/v1/tenant-onboarding/webhooks/twilio-status"
    signature = _twilio_signature(url, data, auth_token)

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/twilio-status",
        data=data,
        headers={"X-Twilio-Signature": signature},
    )
    assert response.status_code == 204
    session.refresh(onboarding)
    assert onboarding.delivery_data["channels"]["sms"]["status"] == "delivered"


# --- Guardrail: webhooks never send -----------------------------------------


def test_provider_webhooks_trigger_no_outbound_send(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """The inbound receipt path must never call an outbound provider.

    We assert at the httpx boundary: a webhook receipt may read and write the
    DB, but it must not open an HTTP client to SendGrid/Twilio. Any such call
    fails the test loudly.
    """

    import httpx

    # Explode only on outbound calls to an external provider host. The Starlette
    # TestClient is itself built on httpx.Client and dispatches the webhook
    # request through the same .request method, so a blanket patch would trip on
    # the test's own call. We guard the boundary that matters: any request to an
    # absolute external URL (SendGrid/Twilio) during webhook processing.
    original_request = httpx.Client.request

    def _guarded_request(self, method, url, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        target = str(url)
        if target.startswith(("http://", "https://")) and "testserver" not in target:
            raise AssertionError(
                "Webhook receipt path attempted an outbound HTTP call to "
                f"{target}."
            )
        return original_request(self, method, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "request", _guarded_request)

    onboarding = _onboarding_with_email_channel(client, session)
    onboarding_id = str(onboarding.id)

    sg_response = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
        json=[
            {
                "email": "tenant@example.com",
                "event": "delivered",
                "sg_message_id": "sg-message-1",
                "sg_event_id": "evt-guard-1",
                "tenant_onboarding_id": onboarding_id,
            }
        ],
    )
    assert sg_response.status_code == 204

    onboarding.delivery_data = {
        **onboarding.delivery_data,
        "channels": {
            **onboarding.delivery_data["channels"],
            "sms": {
                "channel": "sms",
                "status": "queued",
                "provider_message_id": "SM-guard-1",
            },
        },
    }
    session.commit()
    twilio_response = client.post(
        "/api/v1/tenant-onboarding/webhooks/twilio-status",
        data={
            "MessageSid": "SM-guard-1",
            "MessageStatus": "delivered",
            "To": "+61400111222",
        },
    )
    assert twilio_response.status_code == 204


def test_sendgrid_event_signature_helper_rejects_unsigned() -> None:
    """Unit check: the verifier returns False when headers are absent."""

    class _Req:
        headers: dict[str, str] = {}

    assert (
        webhook_auth.sendgrid_event_signature_valid(_Req(), b"[]", "key-b64") is False
    )
