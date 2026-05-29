"""Tenant onboarding link API tests."""

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from uuid import UUID

from apps.api.routers import tenant_onboarding as tenant_onboarding_router
from apps.api.tenant_lease_agreement import set_lease_agreement_section
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditAction,
    AuditOutcome,
    DocumentCategory,
    Entity,
    Lease,
    LeaseStatus,
    StoredDocument,
    Tenant,
    TenantOnboarding,
)
from stewart.integrations.communications import DeliveryResult
from stewart.integrations.docusign import LeaseSignatureResult, SignedLeaseDocumentResult


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _twilio_signature(url: str, data: dict[str, str], auth_token: str) -> str:
    payload = url + "".join(f"{key}{data[key]}" for key in sorted(data))
    digest = hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def _docusign_webhook_headers(monkeypatch) -> dict[str, str]:  # noqa: ANN001
    original_get_settings = tenant_onboarding_router.get_settings
    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: original_get_settings().model_copy(
            update={"docusign_webhook_secret": "docu-secret"}
        ),
    )
    return {"x-docusign-webhook-secret": "docu-secret"}


def _lease_id(client: TestClient, session: Session) -> str:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Onboarding Plaza",
            "street_address": "4 Welcome Street",
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
        json={"entity_id": entity_id, "legal_name": "Onboarding Tenant Pty Ltd"},
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


def _create_submitted_onboarding(client: TestClient, session: Session) -> dict[str, str]:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    body = create_response.json()
    submit_response = client.post(
        f"/api/v1/tenant-onboarding/public/{body['token']}/submit",
        json={
            "legal_name": "Lease Pack Tenant Pty Ltd",
            "contact_name": "Lee Signer",
            "contact_email": "lee@example.com",
            "accepted": True,
        },
    )
    assert submit_response.status_code == 200
    return body


def _create_applied_onboarding(client: TestClient, session: Session) -> dict[str, str]:
    body = _create_submitted_onboarding(client, session)
    apply_response = client.post(f"/api/v1/tenant-onboarding/{body['id']}/apply")
    assert apply_response.status_code == 200
    return body


def _attach_lease_document(session: Session, onboarding_id: str) -> StoredDocument:
    onboarding = session.get(TenantOnboarding, UUID(onboarding_id))
    assert onboarding is not None
    document = StoredDocument(
        entity_id=onboarding.entity_id,
        tenant_id=onboarding.tenant_id,
        lease_id=onboarding.lease_id,
        tenant_onboarding_id=onboarding.id,
        filename="lease-pack.txt",
        content_type="text/plain",
        byte_size=len(b"lease pack"),
        file_data=b"lease pack",
        category=DocumentCategory.lease,
        document_metadata={"source": "operator_upload"},
    )
    session.add(document)
    session.commit()
    return document


def test_tenant_onboarding_link_public_submit_waits_for_review_before_apply(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    expires_at = datetime.now(UTC) + timedelta(days=14)
    create_response = client.post(
        "/api/v1/tenant-onboarding",
        json={
            "lease_id": lease_id,
            "due_date": "2026-08-15",
            "expires_at": expires_at.isoformat(),
        },
    )
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["status"] == "sent"
    assert body["due_date"] == "2026-08-15"
    assert body["expires_at"] is not None
    assert body["last_sent_at"] is not None
    assert body["resent_at"] is None
    assert "/onboarding/" in body["onboarding_url"]
    assert body["delivery_data"]["channels"]["email"]["status"] == "skipped"
    assert body["delivery_data"]["channels"]["sms"]["status"] == "skipped"

    token = body["token"]
    public_response = client.get(f"/api/v1/tenant-onboarding/public/{token}")
    assert public_response.status_code == 200
    assert public_response.json()["tenant_legal_name"] == "Onboarding Tenant Pty Ltd"
    assert public_response.json()["property_name"] == "Onboarding Plaza"
    assert (
        public_response.json()["property_address"] == "4 Welcome Street, Brisbane City, QLD, 4000"
    )
    assert public_response.json()["unit_label"] == "Suite 2"
    assert public_response.json()["due_date"] == "2026-08-15"

    submit_response = client.post(
        f"/api/v1/tenant-onboarding/public/{token}/submit",
        json={
            "legal_name": "Submitted Tenant Pty Ltd",
            "trading_name": "Submitted Tenant",
            "abn": "11 222 333 444",
            "contact_name": "Jamie Tenant",
            "contact_email": "jamie@exampletenant.com.au",
            "contact_phone": "+61 7 3000 0000",
            "billing_email": "accounts@exampletenant.com.au",
            "insurance_confirmed": True,
            "insurance_expiry_date": "2027-08-01",
            "emergency_contact_name": "Morgan",
            "emergency_contact_phone": "+61 400 000 000",
            "accepted": True,
        },
    )
    assert submit_response.status_code == 200
    assert submit_response.json()["status"] == "submitted"
    onboarding_after_submit = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding_after_submit is not None
    assert onboarding_after_submit.delivery_data["reminders"]["completed_reason"] == "submitted"

    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    tenant = session.get(Tenant, onboarding.tenant_id)
    assert tenant is not None
    assert tenant.legal_name == "Onboarding Tenant Pty Ltd"

    apply_response = client.post(f"/api/v1/tenant-onboarding/{body['id']}/apply")
    assert apply_response.status_code == 200
    session.refresh(tenant)
    assert tenant.legal_name == "Submitted Tenant Pty Ltd"
    assert tenant.billing_email == "accounts@exampletenant.com.au"
    assert tenant.tenant_metadata["insurance_confirmed"] is True


def test_public_onboarding_uploads_documents_for_staff_review(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding_id = create_response.json()["id"]
    token = create_response.json()["token"]
    tenant_id = create_response.json()["tenant_id"]

    upload_response = client.post(
        f"/api/v1/tenant-onboarding/public/{token}/documents",
        data={"category": "insurance", "notes": "Certificate of currency."},
        files={"file": ("certificate.txt", b"insurance bytes", "text/plain")},
    )
    assert upload_response.status_code == 201
    document_body = upload_response.json()
    assert document_body["tenant_id"] == tenant_id
    assert document_body["lease_id"] == lease_id
    assert document_body["tenant_onboarding_id"] == onboarding_id
    assert document_body["category"] == "insurance"

    public_list_response = client.get(f"/api/v1/tenant-onboarding/public/{token}/documents")
    assert public_list_response.status_code == 200
    assert [item["id"] for item in public_list_response.json()] == [document_body["id"]]

    staff_list_response = client.get(
        "/api/v1/documents",
        params={"entity_id": _entity_id(session), "tenant_onboarding_id": onboarding_id},
    )
    assert staff_list_response.status_code == 200
    assert [item["id"] for item in staff_list_response.json()] == [document_body["id"]]

    download_response = client.get(
        f"/api/v1/tenant-onboarding/public/{token}/documents/{document_body['id']}/download"
    )
    assert download_response.status_code == 200
    assert download_response.content == b"insurance bytes"

    delete_response = client.delete(
        f"/api/v1/tenant-onboarding/public/{token}/documents/{document_body['id']}"
    )
    assert delete_response.status_code == 204
    document = session.get(StoredDocument, UUID(document_body["id"]))
    assert document is not None
    assert document.deleted_at is not None


def test_tenant_onboarding_resend_review_and_apply_workflow(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding_id = create_response.json()["id"]
    token = create_response.json()["token"]

    resend_response = client.post(f"/api/v1/tenant-onboarding/{onboarding_id}/resend")
    assert resend_response.status_code == 200
    assert resend_response.json()["status"] == "sent"
    assert resend_response.json()["resent_at"] is not None
    assert resend_response.json()["last_sent_at"] == resend_response.json()["resent_at"]
    assert resend_response.json()["delivery_data"]["last_reason"] == "resend"

    submit_response = client.post(
        f"/api/v1/tenant-onboarding/public/{token}/submit",
        json={
            "legal_name": "Workflow Tenant Pty Ltd",
            "contact_name": "Alex Workflow",
            "contact_email": "alex@exampletenant.com.au",
            "accepted": True,
        },
    )
    assert submit_response.status_code == 200
    assert submit_response.json()["status"] == "submitted"

    review_response = client.post(
        f"/api/v1/tenant-onboarding/{onboarding_id}/review",
        json={"approved": True, "notes": "Looks complete."},
    )
    assert review_response.status_code == 200
    assert review_response.json()["status"] == "reviewed"
    assert review_response.json()["review_data"]["notes"] == "Looks complete."
    assert review_response.json()["reviewed_at"] is not None

    apply_response = client.post(f"/api/v1/tenant-onboarding/{onboarding_id}/apply")
    assert apply_response.status_code == 200
    assert apply_response.json()["status"] == "applied"
    assert apply_response.json()["applied_at"] is not None

    onboarding = session.get(TenantOnboarding, UUID(onboarding_id))
    assert onboarding is not None
    tenant = session.get(Tenant, onboarding.tenant_id)
    assert tenant is not None
    assert tenant.legal_name == "Workflow Tenant Pty Ltd"


def test_tenant_onboarding_cancel_blocks_public_link_and_allows_recreate(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding_id = create_response.json()["id"]
    token = create_response.json()["token"]

    cancel_response = client.post(
        f"/api/v1/tenant-onboarding/{onboarding_id}/cancel",
        json={"reason": "Tenant requested a fresh link."},
    )
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "cancelled"
    assert cancel_response.json()["cancel_reason"] == "Tenant requested a fresh link."

    public_response = client.get(f"/api/v1/tenant-onboarding/public/{token}")
    assert public_response.status_code == 404

    recreate_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert recreate_response.status_code == 201
    assert recreate_response.json()["status"] == "sent"
    assert recreate_response.json()["id"] != onboarding_id


def test_tenant_onboarding_expired_link_blocks_public_access(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    expires_at = datetime.now(UTC) - timedelta(minutes=1)
    create_response = client.post(
        "/api/v1/tenant-onboarding",
        json={"lease_id": lease_id, "expires_at": expires_at.isoformat()},
    )
    assert create_response.status_code == 201

    token = create_response.json()["token"]
    public_response = client.get(f"/api/v1/tenant-onboarding/public/{token}")
    assert public_response.status_code == 404

    submit_response = client.post(
        f"/api/v1/tenant-onboarding/public/{token}/submit",
        json={
            "legal_name": "Expired Tenant Pty Ltd",
            "contact_name": "Pat Expired",
            "contact_email": "pat@exampletenant.com.au",
            "accepted": True,
        },
    )
    assert submit_response.status_code == 404


def test_tenant_onboarding_fresh_link_rotates_expired_token(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    sent_urls: list[str] = []

    def fake_send(invite, settings):  # noqa: ANN001, ARG001
        sent_urls.append(invite.onboarding_url)
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id=f"email-{len(sent_urls)}",
            )
        ]

    monkeypatch.setattr(tenant_onboarding_router, "send_tenant_onboarding_invite", fake_send)
    lease_id = _lease_id(client, session)
    expires_at = datetime.now(UTC) - timedelta(minutes=1)
    create_response = client.post(
        "/api/v1/tenant-onboarding",
        json={"lease_id": lease_id, "expires_at": expires_at.isoformat()},
    )
    assert create_response.status_code == 201
    old_token = create_response.json()["token"]
    onboarding_id = create_response.json()["id"]
    onboarding = session.get(TenantOnboarding, UUID(onboarding_id))
    assert onboarding is not None
    onboarding.token_consumed_at = utcnow()
    session.commit()
    sent_urls.clear()

    fresh_response = client.post(
        f"/api/v1/tenant-onboarding/{onboarding_id}/fresh-link",
        json={"reason": "Tenant lost the original link.", "expires_in_days": 21},
    )

    assert fresh_response.status_code == 200
    body = fresh_response.json()
    assert body["token"] != old_token
    assert body["status"] == "sent"
    assert body["expires_at"] is not None
    assert body["resent_at"] is not None
    assert body["onboarding_url"].endswith(body["token"])
    assert body["portal_url"].endswith(body["token"])
    session.refresh(onboarding)
    assert onboarding.token_consumed_at is None
    assert sent_urls == [body["onboarding_url"]]

    old_public_response = client.get(f"/api/v1/tenant-onboarding/public/{old_token}")
    assert old_public_response.status_code == 404
    new_public_response = client.get(f"/api/v1/tenant-onboarding/public/{body['token']}")
    assert new_public_response.status_code == 200

    onboarding = session.get(TenantOnboarding, UUID(onboarding_id))
    assert onboarding is not None
    fresh_link = onboarding.delivery_data["fresh_link"]
    assert fresh_link["reason"] == "Tenant lost the original link."
    assert fresh_link["expires_in_days"] == 21
    assert "token" not in fresh_link
    assert onboarding.delivery_data["reminders"]["next_reminder_at"] is not None
    assert onboarding.delivery_data["expiry_reminders"]["next_reminder_at"] is not None


def test_public_onboarding_cannot_submit_again_after_review(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    token = create_response.json()["token"]
    onboarding_id = create_response.json()["id"]

    first_submit_response = client.post(
        f"/api/v1/tenant-onboarding/public/{token}/submit",
        json={
            "legal_name": "Reviewed Tenant Pty Ltd",
            "contact_name": "Pat Reviewed",
            "contact_email": "pat.reviewed@exampletenant.com.au",
            "accepted": True,
        },
    )
    assert first_submit_response.status_code == 200

    review_response = client.post(
        f"/api/v1/tenant-onboarding/{onboarding_id}/review",
        json={"approved": True},
    )
    assert review_response.status_code == 200

    second_submit_response = client.post(
        f"/api/v1/tenant-onboarding/public/{token}/submit",
        json={
            "legal_name": "Changed Tenant Pty Ltd",
            "contact_name": "Pat Changed",
            "contact_email": "pat.changed@exampletenant.com.au",
            "accepted": True,
        },
    )
    assert second_submit_response.status_code == 409
    assert second_submit_response.json()["detail"] == (
        "Only sent onboarding can be changed from the public link."
    )


def test_tenant_onboarding_sendgrid_receipt_updates_delivery_data(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding_id = create_response.json()["id"]

    receipt_response = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
        json=[
            {
                "tenant_onboarding_id": onboarding_id,
                "sg_message_id": "sendgrid-message-1",
                "event": "delivered",
                "email": "tenant@example.com",
            }
        ],
    )
    assert receipt_response.status_code == 204

    onboarding = session.get(TenantOnboarding, UUID(onboarding_id))
    assert onboarding is not None
    assert onboarding.delivery_data["channels"]["email"]["status"] == "delivered"
    assert onboarding.delivery_data["channels"]["email"]["last_event"] == "delivered"
    assert onboarding.delivery_data["receipts"][0]["status"] == "delivered"


def test_tenant_onboarding_sendgrid_receipt_requires_configured_secret(
    client: TestClient,
    monkeypatch,
) -> None:
    settings = tenant_onboarding_router.get_settings()
    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: settings.model_copy(update={"communications_webhook_secret": "sg-secret"}),
    )

    missing_response = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
        json=[],
    )
    assert missing_response.status_code == 401
    assert missing_response.json()["detail"] == "Invalid webhook token."

    accepted_response = client.post(
        "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
        headers={"x-leasium-webhook-secret": "sg-secret"},
        json=[],
    )
    assert accepted_response.status_code == 204


def test_tenant_onboarding_reminder_run_is_due_and_idempotent(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    sends: list[str] = []

    def fake_send(invite, settings):  # noqa: ANN001, ARG001
        sends.append(str(invite.onboarding_id))
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id=f"email-{len(sends)}",
            ),
            DeliveryResult(channel="sms", status="skipped", provider="twilio"),
        ]

    monkeypatch.setattr(tenant_onboarding_router, "send_tenant_onboarding_invite", fake_send)
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    entity_id = _entity_id(session)
    onboarding_id = create_response.json()["id"]
    onboarding = session.get(TenantOnboarding, UUID(onboarding_id))
    assert onboarding is not None
    reminder_due_at = (utcnow() - timedelta(minutes=1)).isoformat()
    delivery_data = onboarding.delivery_data
    reminders = delivery_data["reminders"]
    schedule = list(reminders["schedule"])
    schedule[0] = {**schedule[0], "scheduled_at": reminder_due_at}
    onboarding.delivery_data = {
        **delivery_data,
        "reminders": {
            **reminders,
            "next_reminder_at": reminder_due_at,
            "schedule": schedule,
        },
    }
    session.commit()
    sends.clear()

    run_response = client.post(
        "/api/v1/tenant-onboarding/reminders/run",
        params={"entity_id": entity_id},
    )
    assert run_response.status_code == 200
    assert run_response.json()["sent"] == 1
    assert sends == [onboarding_id]

    second_run_response = client.post(
        "/api/v1/tenant-onboarding/reminders/run",
        params={"entity_id": entity_id},
    )
    assert second_run_response.status_code == 200
    assert second_run_response.json()["sent"] == 0

    session.refresh(onboarding)
    reminders = onboarding.delivery_data["reminders"]
    assert reminders["schedule"][0]["status"] == "sent"
    assert reminders["next_reminder_at"] == reminders["schedule"][1]["scheduled_at"]


def test_tenant_onboarding_send_portal_invite_records_delivery_and_audits(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    sends: list[str] = []

    def fake_portal_send(invite, settings):  # noqa: ANN001, ARG001
        sends.append(invite.template_key)
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id="portal-invite-1",
                metadata={"template_key": invite.template_key},
            ),
            DeliveryResult(
                channel="sms",
                status="skipped",
                provider="twilio",
                error="No SMS recipient.",
            ),
        ]

    monkeypatch.setattr(tenant_onboarding_router, "send_tenant_portal_invite", fake_portal_send)
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding_id = create_response.json()["id"]

    invite_response = client.post(
        f"/api/v1/tenant-onboarding/{onboarding_id}/send-portal-invite",
    )
    assert invite_response.status_code == 200
    body = invite_response.json()
    assert body["status"] == "sent"
    portal_invite = body["delivery_data"]["portal_invite"]
    assert portal_invite["template_key"] == "tenant_portal_invite"
    assert {receipt["channel"] for receipt in portal_invite["receipts"]} == {"email", "sms"}
    assert sends == ["tenant_portal_invite"]
    history = body["delivery_data"].get("portal_invite_history") or []
    assert len(history) == 1


def test_tenant_onboarding_twilio_status_rejects_unsigned_when_token_configured(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Configured Twilio tenant status callbacks must be signed before receipts move."""

    from stewart.core.settings import Settings

    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: Settings(twilio_auth_token="twilio-secret"),
    )
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
                "provider_message_id": "SM-tenant-status-1",
            }
        },
        "receipts": [],
    }
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/twilio-status",
        data={
            "MessageSid": "SM-tenant-status-1",
            "MessageStatus": "delivered",
            "To": "+61400111222",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid Twilio webhook signature."
    session.refresh(onboarding)
    sms_channel = onboarding.delivery_data["channels"]["sms"]
    assert sms_channel["status"] == "queued"
    assert onboarding.delivery_data["receipts"] == []


def test_tenant_onboarding_twilio_status_accepts_public_api_url_signature(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Production proxy URLs can validate signed Twilio tenant status callbacks."""

    from stewart.core.settings import Settings

    auth_token = "twilio-secret"
    public_api_url = "https://api.leasium.test"
    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: Settings(public_api_url=public_api_url, twilio_auth_token=auth_token),
    )
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
                "provider_message_id": "SM-tenant-status-2",
            }
        },
        "receipts": [],
    }
    session.commit()
    data = {
        "MessageSid": "SM-tenant-status-2",
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
    sms_channel = onboarding.delivery_data["channels"]["sms"]
    assert sms_channel["status"] == "delivered"
    assert onboarding.delivery_data["receipts"][0]["provider_message_id"] == (
        "SM-tenant-status-2"
    )


def test_tenant_onboarding_can_skip_initial_link_for_portal_invite_flow(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    onboarding_sends: list[str] = []
    portal_sends: list[str] = []

    def fake_onboarding_send(invite, settings):  # noqa: ANN001, ARG001
        onboarding_sends.append(invite.template_key)
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
            )
        ]

    def fake_portal_send(invite, settings):  # noqa: ANN001, ARG001
        portal_sends.append(invite.template_key)
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id="portal-invite-only",
            )
        ]

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_tenant_onboarding_invite",
        fake_onboarding_send,
    )
    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_tenant_portal_invite",
        fake_portal_send,
    )

    lease_id = _lease_id(client, session)
    create_response = client.post(
        "/api/v1/tenant-onboarding",
        json={"lease_id": lease_id, "send_initial_invite": False},
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["status"] == "sent"
    assert created["last_sent_at"] is None
    assert created["delivery_data"] == {}
    assert onboarding_sends == []

    invite_response = client.post(
        f"/api/v1/tenant-onboarding/{created['id']}/send-portal-invite",
    )

    assert invite_response.status_code == 200
    body = invite_response.json()
    assert body["last_sent_at"] is not None
    assert body["resent_at"] is None
    assert body["delivery_data"]["portal_invite"]["template_key"] == (
        "tenant_portal_invite"
    )
    assert body["delivery_data"]["reminders"]["enabled"] is True
    assert portal_sends == ["tenant_portal_invite"]
    assert onboarding_sends == []


def test_tenant_onboarding_send_portal_invite_rejects_submitted_or_expired(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding_id = create_response.json()["id"]
    token = create_response.json()["token"]

    submit_response = client.post(
        f"/api/v1/tenant-onboarding/public/{token}/submit",
        json={
            "legal_name": "Submitted Tenant Pty Ltd",
            "contact_name": "Sam Submitted",
            "contact_email": "sam@example.com",
            "accepted": True,
        },
    )
    assert submit_response.status_code == 200

    reject_response = client.post(
        f"/api/v1/tenant-onboarding/{onboarding_id}/send-portal-invite",
    )
    assert reject_response.status_code == 409


def test_tenant_onboarding_send_lease_pack_after_apply_records_delivery(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    sends: list[tuple[str, str, object]] = []

    def fake_lease_pack_send(invite, settings):  # noqa: ANN001, ARG001
        sends.append((invite.template_key, invite.onboarding_url, invite.expires_at))
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id="lease-pack-1",
                metadata={"template_key": invite.template_key},
            ),
            DeliveryResult(
                channel="sms",
                status="skipped",
                provider="twilio",
                error="No SMS recipient.",
            ),
        ]

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_tenant_lease_pack_invite",
        fake_lease_pack_send,
    )
    docusign_requests = []

    def fake_signature_send(request, settings):  # noqa: ANN001, ARG001
        docusign_requests.append(request)
        return LeaseSignatureResult(
            status="queued",
            signer_email=request.signer_email,
            envelope_id="envelope-lease-pack-1",
        )

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_lease_for_signature",
        fake_signature_send,
    )
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding_id = create_response.json()["id"]
    token = create_response.json()["token"]

    submit_response = client.post(
        f"/api/v1/tenant-onboarding/public/{token}/submit",
        json={
            "legal_name": "Lease Pack Tenant Pty Ltd",
            "contact_name": "Lee Signer",
            "contact_email": "lee@example.com",
            "accepted": True,
        },
    )
    assert submit_response.status_code == 200
    apply_response = client.post(f"/api/v1/tenant-onboarding/{onboarding_id}/apply")
    assert apply_response.status_code == 200
    lease_document = _attach_lease_document(session, onboarding_id)

    lease_pack_response = client.post(
        f"/api/v1/tenant-onboarding/{onboarding_id}/send-lease-pack",
    )
    assert lease_pack_response.status_code == 200
    body = lease_pack_response.json()
    lease_pack = body["delivery_data"]["lease_pack"]
    assert lease_pack["template_key"] == "tenant_lease_pack"
    assert {receipt["channel"] for receipt in lease_pack["receipts"]} == {"email", "sms"}
    assert sends[0][0] == "tenant_lease_pack"
    assert sends[0][1].endswith("/tenant-portal/lease")
    assert f"/tenant-portal/{token}/lease" not in sends[0][1]
    assert sends[0][2] is None
    assert docusign_requests[0].document_filename == "lease-pack.txt"
    assert docusign_requests[0].document_bytes == b"lease pack"
    assert str(docusign_requests[0].tenant_onboarding_id) == onboarding_id
    assert docusign_requests[0].document_id == lease_document.id
    assert str(docusign_requests[0].lease_id) == lease_id
    assert lease_pack["docusign"]["status"] == "queued"
    assert lease_pack["docusign"]["envelope_id"] == "envelope-lease-pack-1"
    assert lease_pack["docusign"]["document_id"] == str(lease_document.id)
    signing = body["delivery_data"]["lease_agreement"]["signing"]
    assert signing["provider"] == "docusign"
    assert signing["status"] == "queued"
    assert signing["envelope_id"] == "envelope-lease-pack-1"
    history = body["delivery_data"].get("lease_pack_history") or []
    assert len(history) == 1


def test_tenant_onboarding_send_lease_pack_audits_skipped_docusign_as_error(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    def fake_lease_pack_send(invite, settings):  # noqa: ANN001, ARG001
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id="lease-pack-skipped-docusign",
                metadata={"template_key": invite.template_key},
            )
        ]

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_tenant_lease_pack_invite",
        fake_lease_pack_send,
    )

    def fake_signature_send(request, settings):  # noqa: ANN001, ARG001
        return LeaseSignatureResult(
            status="skipped",
            signer_email=request.signer_email,
            error=(
                "DocuSign production endpoints are not configured. Set "
                "DOCUSIGN_BASE_URL=https://www.docusign.net/restapi and "
                "DOCUSIGN_AUTH_BASE_URL=https://account.docusign.com before "
                "sending live lease envelopes."
            ),
        )

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_lease_for_signature",
        fake_signature_send,
    )
    body = _create_applied_onboarding(client, session)
    lease_document = _attach_lease_document(session, body["id"])

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 200
    lease_pack = response.json()["delivery_data"]["lease_pack"]
    assert lease_pack["docusign"]["status"] == "skipped"
    assert lease_pack["docusign"]["document_id"] == str(lease_document.id)
    signing = response.json()["delivery_data"]["lease_agreement"]["signing"]
    assert signing["provider"] == "docusign"
    assert signing["status"] == "skipped"
    assert signing["document_id"] == str(lease_document.id)
    assert signing["error"] == lease_pack["docusign"]["error"]
    assert signing["sent_at"] is not None
    audit = session.scalar(
        select(AuditAction)
        .where(
            AuditAction.action == "send_lease_for_signature",
            AuditAction.target_id == UUID(body["id"]),
        )
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit is not None
    assert audit.outcome == AuditOutcome.error
    assert audit.error_message == lease_pack["docusign"]["error"]
    queue_response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": _entity_id(session)},
    )
    assert queue_response.status_code == 200
    lifecycle_candidates = [
        candidate
        for candidate in queue_response.json()["candidates"]
        if candidate["kind"] == "tenant_lifecycle_stall"
    ]
    assert len(lifecycle_candidates) == 1
    assert "DocuSign setup needed" in lifecycle_candidates[0]["subject"]
    assert "DOCUSIGN_BASE_URL" in (lifecycle_candidates[0]["detail"] or "")


def test_tenant_onboarding_failed_docusign_send_enters_lifecycle_queue(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    def fake_lease_pack_send(invite, settings):  # noqa: ANN001, ARG001
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id="lease-pack-failed-docusign",
                metadata={"template_key": invite.template_key},
            )
        ]

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_tenant_lease_pack_invite",
        fake_lease_pack_send,
    )

    def fake_signature_send(request, settings):  # noqa: ANN001, ARG001
        return LeaseSignatureResult(
            status="failed",
            signer_email=request.signer_email,
            error="DocuSign envelope create failed: timeout",
        )

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_lease_for_signature",
        fake_signature_send,
    )
    body = _create_applied_onboarding(client, session)
    lease_document = _attach_lease_document(session, body["id"])

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 200
    lease_pack = response.json()["delivery_data"]["lease_pack"]
    assert lease_pack["docusign"]["status"] == "failed"
    signing = response.json()["delivery_data"]["lease_agreement"]["signing"]
    assert signing["provider"] == "docusign"
    assert signing["status"] == "failed"
    assert signing["document_id"] == str(lease_document.id)
    assert signing["error"] == "DocuSign envelope create failed: timeout"
    queue_response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": _entity_id(session)},
    )
    assert queue_response.status_code == 200
    lifecycle_candidates = [
        candidate
        for candidate in queue_response.json()["candidates"]
        if candidate["kind"] == "tenant_lifecycle_stall"
    ]
    assert len(lifecycle_candidates) == 1
    assert "DocuSign retry needed" in lifecycle_candidates[0]["subject"]
    assert "DocuSign envelope create failed: timeout" in (
        lifecycle_candidates[0]["detail"] or ""
    )


def test_tenant_onboarding_send_lease_pack_retries_after_declined_docusign(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    def fake_lease_pack_send(invite, settings):  # noqa: ANN001, ARG001
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id="lease-pack-retry",
                metadata={"template_key": invite.template_key},
            )
        ]

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_tenant_lease_pack_invite",
        fake_lease_pack_send,
    )

    def fake_signature_send(request, settings):  # noqa: ANN001, ARG001
        return LeaseSignatureResult(
            status="queued",
            signer_email=request.signer_email,
            envelope_id="envelope-retry-1",
        )

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_lease_for_signature",
        fake_signature_send,
    )
    body = _create_applied_onboarding(client, session)
    lease_document = _attach_lease_document(session, body["id"])
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    prior_pack = {
        "sent_at": "2026-05-21T00:20:00+00:00",
        "docusign": {
            "status": "queued",
            "provider": "docusign",
            "envelope_id": "envelope-declined-1",
            "document_id": str(lease_document.id),
        },
    }
    onboarding.delivery_data = {
        "lease_pack": prior_pack,
        "lease_pack_history": [prior_pack],
        "lease_agreement": {
            "signing": {
                "provider": "docusign",
                "status": "declined",
                "envelope_id": "envelope-declined-1",
                "document_id": str(lease_document.id),
                "last_event": "envelope-declined",
            }
        },
    }
    session.commit()

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 200
    delivery_data = response.json()["delivery_data"]
    lease_pack = delivery_data["lease_pack"]
    assert lease_pack["docusign"]["status"] == "queued"
    assert lease_pack["docusign"]["envelope_id"] == "envelope-retry-1"
    assert lease_pack["docusign"]["document_id"] == str(lease_document.id)
    signing = delivery_data["lease_agreement"]["signing"]
    assert signing["provider"] == "docusign"
    assert signing["status"] == "queued"
    assert signing["envelope_id"] == "envelope-retry-1"
    assert "signed_at" not in signing
    history = delivery_data["lease_pack_history"]
    assert len(history) == 2
    assert history[0]["docusign"]["envelope_id"] == "envelope-declined-1"
    assert history[1]["docusign"]["envelope_id"] == "envelope-retry-1"


def test_tenant_onboarding_send_lease_pack_rejects_active_docusign_envelope(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    docusign_requests: list[object] = []

    def fake_signature_send(request, settings):  # noqa: ANN001, ARG001
        docusign_requests.append(request)
        return LeaseSignatureResult(
            status="queued",
            signer_email=request.signer_email,
            envelope_id="duplicate-envelope",
        )

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_lease_for_signature",
        fake_signature_send,
    )
    body = _create_applied_onboarding(client, session)
    _attach_lease_document(session, body["id"])
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "queued",
                "envelope_id": "active-envelope-1",
                "sent_at": utcnow().isoformat(),
            }
        },
    )
    session.commit()

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "A DocuSign envelope is already waiting for completion."
    )
    assert docusign_requests == []


def test_tenant_onboarding_docusign_webhook_marks_lease_signed(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    downloads: list[str] = []
    webhook_headers = _docusign_webhook_headers(monkeypatch)

    def fake_download(envelope_id, settings):  # noqa: ANN001, ARG001
        downloads.append(envelope_id)
        return SignedLeaseDocumentResult(
            status="downloaded",
            filename=f"signed-{envelope_id}.pdf",
            content_type="application/pdf",
            file_data=b"%PDF signed lease",
        )

    monkeypatch.setattr(
        tenant_onboarding_router,
        "download_signed_lease_document",
        fake_download,
    )
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    lease = session.get(Lease, onboarding.lease_id)
    assert lease is not None
    lease.status = LeaseStatus.pending
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "sent",
                "envelope_id": "envelope-complete-1",
                "document_id": "document-1",
                "sent_at": utcnow().isoformat(),
            },
        },
    )
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        headers=webhook_headers,
        json={
            "event": "envelope-completed",
            "data": {
                "envelopeId": "envelope-complete-1",
                "envelopeSummary": {"status": "completed"},
            },
        },
    )

    assert response.status_code == 204
    session.refresh(onboarding)
    signing = onboarding.delivery_data["lease_agreement"]["signing"]
    assert signing["provider"] == "docusign"
    assert signing["status"] == "completed"
    assert signing["envelope_id"] == "envelope-complete-1"
    assert signing["signed_at"] is not None
    assert signing["signed_by_actor"] == "provider:docusign"
    assert signing["source"] == "docusign_webhook"
    assert signing["last_event"] == "envelope-completed"
    assert signing["signed_document_retention"]["status"] == "downloaded"
    assert signing["lease_activation_review"]["status"] == "ready_for_review"
    assert signing["lease_activation_review"]["current_lease_status"] == "pending"
    assert signing["lease_activation_review"]["recommended_status"] == "active"
    assert signing["lease_activation_review"]["guardrail"] == (
        "DocuSign completion does not activate a lease automatically; "
        "review and activate explicitly."
    )
    session.refresh(lease)
    assert lease.status == LeaseStatus.pending
    signed_document_id = signing["signed_document_id"]
    signed_document = session.get(StoredDocument, UUID(signed_document_id))
    assert signed_document is not None
    assert signed_document.filename == "signed-envelope-complete-1.pdf"
    assert signed_document.content_type == "application/pdf"
    assert signed_document.file_data == b"%PDF signed lease"
    assert signed_document.category == DocumentCategory.lease
    assert signed_document.tenant_id == onboarding.tenant_id
    assert signed_document.tenant_onboarding_id == onboarding.id
    assert signed_document.document_metadata["source"] == "docusign_signed_lease"
    assert signed_document.document_metadata["docusign_envelope_id"] == "envelope-complete-1"
    assert signed_document.document_metadata["original_lease_document_id"] == "document-1"
    webhook_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.action == "signature_receipt",
            AuditAction.target_table == "tenant_onboarding",
            AuditAction.target_id == onboarding.id,
        )
    )
    assert webhook_audit is not None
    assert webhook_audit.tool_input == {
        "status": "completed",
        "event": "envelope-completed",
        "envelope_id": "envelope-complete-1",
        "tenant_onboarding_id": str(onboarding.id),
        "lease_id": str(lease.id),
        "document_id": "document-1",
        "signed_document_id": signed_document_id,
        "applied": True,
    }

    replay_response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        headers=webhook_headers,
        json={
            "envelopeId": "envelope-complete-1",
            "status": "completed",
            "event": "envelope-completed",
        },
    )

    assert replay_response.status_code == 204
    session.refresh(onboarding)
    assert onboarding.delivery_data["lease_agreement"]["signing"]["signed_at"] == signing[
        "signed_at"
    ]
    assert onboarding.delivery_data["lease_agreement"]["signing"]["signed_document_id"] == (
        signed_document_id
    )
    signed_documents = [
        document
        for document in session.scalars(
            select(StoredDocument).where(
                StoredDocument.tenant_onboarding_id == onboarding.id,
                StoredDocument.category == DocumentCategory.lease,
            )
        ).all()
        if document.document_metadata.get("source") == "docusign_signed_lease"
    ]
    assert len(signed_documents) == 1
    assert downloads == ["envelope-complete-1"]


def test_tenant_onboarding_docusign_webhook_rejects_unconfigured_secret(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "sent",
                "envelope_id": "envelope-no-secret-1",
            },
        },
    )
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        json={"envelopeId": "envelope-no-secret-1", "status": "completed"},
    )

    assert response.status_code == 401
    session.refresh(onboarding)
    signing = onboarding.delivery_data["lease_agreement"]["signing"]
    assert "signed_at" not in signing


def test_tenant_onboarding_docusign_webhook_ignores_unknown_envelope(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    webhook_headers = _docusign_webhook_headers(monkeypatch)
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {"signing": {"provider": "docusign", "envelope_id": "known-envelope"}},
    )
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        headers=webhook_headers,
        json={"envelopeId": "unknown-envelope", "status": "completed"},
    )

    assert response.status_code == 204
    session.refresh(onboarding)
    assert "signed_at" not in onboarding.delivery_data["lease_agreement"]["signing"]


def test_tenant_onboarding_docusign_webhook_ignores_completed_after_declined(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    webhook_headers = _docusign_webhook_headers(monkeypatch)
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "declined",
                "envelope_id": "envelope-declined-then-complete-1",
                "last_event": "envelope-declined",
            },
        },
    )
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        headers=webhook_headers,
        json={
            "event": "envelope-completed",
            "data": {
                "envelopeId": "envelope-declined-then-complete-1",
                "envelopeSummary": {"status": "completed"},
            },
        },
    )

    assert response.status_code == 204
    session.refresh(onboarding)
    signing = onboarding.delivery_data["lease_agreement"]["signing"]
    assert signing["status"] == "declined"
    assert signing["last_event"] == "envelope-declined"
    assert "signed_at" not in signing
    assert "lease_activation_review" not in signing
    webhook_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.action == "signature_receipt",
            AuditAction.target_table == "tenant_onboarding",
            AuditAction.target_id == onboarding.id,
        )
    )
    assert webhook_audit is not None
    assert webhook_audit.tool_input == {
        "status": "completed",
        "event": "envelope-completed",
        "envelope_id": "envelope-declined-then-complete-1",
        "tenant_onboarding_id": str(onboarding.id),
        "lease_id": str(onboarding.lease_id),
        "applied": False,
        "ignored_reason": "event_not_allowed",
        "current_signing_status": "declined",
        "current_last_event": "envelope-declined",
    }


def test_tenant_onboarding_docusign_webhook_ignores_mismatched_custom_fields(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    downloads: list[str] = []
    webhook_headers = _docusign_webhook_headers(monkeypatch)

    def fake_download(envelope_id, settings):  # noqa: ANN001, ARG001
        downloads.append(envelope_id)
        return SignedLeaseDocumentResult(
            status="downloaded",
            filename=f"signed-{envelope_id}.pdf",
            content_type="application/pdf",
            file_data=b"%PDF signed lease",
        )

    monkeypatch.setattr(
        tenant_onboarding_router,
        "download_signed_lease_document",
        fake_download,
    )
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "sent",
                "envelope_id": "envelope-custom-field-mismatch-1",
                "document_id": "document-1",
                "sent_at": utcnow().isoformat(),
            },
        },
    )
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        headers=webhook_headers,
        json={
            "event": "envelope-completed",
            "data": {
                "envelopeId": "envelope-custom-field-mismatch-1",
                "envelopeSummary": {
                    "status": "completed",
                    "customFields": {
                        "textCustomFields": [
                            {
                                "name": "tenant_onboarding_id",
                                "value": str(UUID(int=0)),
                            },
                            {"name": "lease_id", "value": str(onboarding.lease_id)},
                            {"name": "document_id", "value": "document-1"},
                        ]
                    },
                },
            },
        },
    )

    assert response.status_code == 204
    session.refresh(onboarding)
    signing = onboarding.delivery_data["lease_agreement"]["signing"]
    assert signing["status"] == "sent"
    assert "signed_at" not in signing
    assert "lease_activation_review" not in signing
    assert downloads == []
    webhook_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.action == "signature_receipt",
            AuditAction.target_table == "tenant_onboarding",
            AuditAction.target_id == onboarding.id,
        )
    )
    assert webhook_audit is not None
    assert webhook_audit.tool_input == {
        "status": "completed",
        "event": "envelope-completed",
        "envelope_id": "envelope-custom-field-mismatch-1",
        "tenant_onboarding_id": str(onboarding.id),
        "lease_id": str(onboarding.lease_id),
        "document_id": "document-1",
        "applied": False,
        "ignored_reason": "custom_fields_mismatch",
    }


def test_tenant_onboarding_docusign_webhook_records_declined_envelope(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    downloads: list[str] = []
    webhook_headers = _docusign_webhook_headers(monkeypatch)

    def fake_download(envelope_id, settings):  # noqa: ANN001, ARG001
        downloads.append(envelope_id)
        return SignedLeaseDocumentResult(
            status="downloaded",
            filename=f"signed-{envelope_id}.pdf",
            content_type="application/pdf",
            file_data=b"%PDF signed lease",
        )

    monkeypatch.setattr(
        tenant_onboarding_router,
        "download_signed_lease_document",
        fake_download,
    )
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "sent",
                "envelope_id": "envelope-declined-1",
                "document_id": "document-1",
                "sent_at": utcnow().isoformat(),
            },
        },
    )
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        headers=webhook_headers,
        json={
            "event": "envelope-declined",
            "data": {
                "envelopeId": "envelope-declined-1",
                "envelopeSummary": {"status": "declined"},
            },
        },
    )

    assert response.status_code == 204
    session.refresh(onboarding)
    signing = onboarding.delivery_data["lease_agreement"]["signing"]
    assert signing["provider"] == "docusign"
    assert signing["status"] == "declined"
    assert signing["envelope_id"] == "envelope-declined-1"
    assert signing["last_event"] == "envelope-declined"
    assert signing["last_event_at"] is not None
    assert signing["provider_events"][0]["status"] == "declined"
    assert "signed_at" not in signing
    assert "signed_document_id" not in signing
    assert "lease_activation_review" not in signing
    assert downloads == []
    webhook_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.action == "signature_receipt",
            AuditAction.target_table == "tenant_onboarding",
            AuditAction.target_id == onboarding.id,
        )
    )
    assert webhook_audit is not None
    assert webhook_audit.tool_input == {
        "status": "declined",
        "event": "envelope-declined",
        "envelope_id": "envelope-declined-1",
        "tenant_onboarding_id": str(onboarding.id),
        "lease_id": str(onboarding.lease_id),
        "document_id": "document-1",
        "applied": True,
    }


def test_tenant_onboarding_activate_lease_after_docusign_completion(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    lease = session.get(Lease, onboarding.lease_id)
    assert lease is not None
    lease.status = LeaseStatus.pending
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "completed",
                "envelope_id": "envelope-activate-1",
                "signed_at": utcnow().isoformat(),
                "signed_by_actor": "provider:docusign",
                "source": "docusign_webhook",
                "signed_document_id": "document-signed-1",
                "lease_activation_review": {
                    "status": "ready_for_review",
                    "current_lease_status": "pending",
                    "recommended_status": "active",
                },
            },
        },
    )
    session.commit()

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/activate-lease",
    )

    assert response.status_code == 200
    session.refresh(lease)
    session.refresh(onboarding)
    assert lease.status == LeaseStatus.active
    activation = lease.lease_metadata["activation"]
    assert activation["source"] == "tenant_onboarding_docusign"
    assert activation["tenant_onboarding_id"] == body["id"]
    assert activation["signed_document_id"] == "document-signed-1"
    assert activation["envelope_id"] == "envelope-activate-1"
    signing = onboarding.delivery_data["lease_agreement"]["signing"]
    assert signing["lease_activation_review"]["status"] == "activated"
    assert signing["lease_activation_review"]["current_lease_status"] == "active"
    assert signing["lease_activation_review"]["activated_at"] is not None
    onboarding_activation_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.action == "activate_lease",
            AuditAction.target_table == "tenant_onboarding",
            AuditAction.target_id == onboarding.id,
        )
    )
    assert onboarding_activation_audit is not None
    assert onboarding_activation_audit.tool_input == {
        "lease_id": str(lease.id),
        "source": "tenant_onboarding_docusign",
        "signed_document_id": "document-signed-1",
        "envelope_id": "envelope-activate-1",
    }
    lease_activation_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.action == "activate",
            AuditAction.target_table == "lease",
            AuditAction.target_id == lease.id,
        )
    )
    assert lease_activation_audit is not None
    assert lease_activation_audit.tool_input == {
        "tenant_onboarding_id": body["id"],
        "source": "tenant_onboarding_docusign",
        "signed_document_id": "document-signed-1",
        "envelope_id": "envelope-activate-1",
    }


def test_tenant_onboarding_activate_lease_rejects_unsigned_agreement(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_applied_onboarding(client, session)

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/activate-lease",
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Complete lease signing before activation."


def test_tenant_onboarding_activate_lease_rejects_missing_signed_document(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    lease = session.get(Lease, onboarding.lease_id)
    assert lease is not None
    lease.status = LeaseStatus.pending
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "completed",
                "envelope_id": "envelope-missing-document-1",
                "signed_at": utcnow().isoformat(),
                "signed_by_actor": "provider:docusign",
                "source": "docusign_webhook",
                "signed_document_retention": {
                    "status": "skipped",
                    "provider": "docusign",
                    "error": "DocuSign download is not configured.",
                },
                "lease_activation_review": {
                    "status": "ready_for_review",
                    "current_lease_status": "pending",
                    "recommended_status": "active",
                },
            },
        },
    )
    session.commit()

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/activate-lease",
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Retain the signed lease document before activation."
    )
    session.refresh(lease)
    assert lease.status == LeaseStatus.pending


def test_tenant_onboarding_activate_lease_rejects_missing_activation_review(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    lease = session.get(Lease, onboarding.lease_id)
    assert lease is not None
    lease.status = LeaseStatus.pending
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "provider": "docusign",
                "status": "completed",
                "envelope_id": "envelope-no-review-1",
                "signed_at": utcnow().isoformat(),
                "signed_by_actor": "provider:docusign",
                "source": "docusign_webhook",
                "signed_document_id": "document-signed-1",
            },
        },
    )
    session.commit()

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/activate-lease",
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Review signed lease activation before activating."
    )
    session.refresh(lease)
    assert lease.status == LeaseStatus.pending


def test_tenant_onboarding_docusign_webhook_rejects_invalid_secret(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    original_get_settings = tenant_onboarding_router.get_settings
    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: original_get_settings().model_copy(
            update={"docusign_webhook_secret": "docu-secret"}
        ),
    )
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {"signing": {"provider": "docusign", "envelope_id": "envelope-secret-1"}},
    )
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        headers={"x-docusign-webhook-secret": "wrong"},
        json={"envelopeId": "envelope-secret-1", "status": "completed"},
    )

    assert response.status_code == 401


def test_tenant_onboarding_docusign_webhook_accepts_shared_secret_header(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    original_get_settings = tenant_onboarding_router.get_settings
    monkeypatch.setattr(
        tenant_onboarding_router,
        "get_settings",
        lambda: original_get_settings().model_copy(
            update={"docusign_webhook_secret": "docu-secret"}
        ),
    )
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {"signing": {"provider": "docusign", "envelope_id": "envelope-shared-1"}},
    )
    session.commit()

    response = client.post(
        "/api/v1/tenant-onboarding/webhooks/docusign",
        headers={"x-leasium-webhook-secret": "docu-secret"},
        json={"envelopeId": "envelope-shared-1", "status": "declined"},
    )

    assert response.status_code == 204
    session.refresh(onboarding)
    signing = onboarding.delivery_data["lease_agreement"]["signing"]
    assert signing["status"] == "declined"
    assert signing["envelope_id"] == "envelope-shared-1"


def test_tenant_onboarding_send_lease_pack_rejects_before_apply(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_submitted_onboarding(client, session)

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 409
    assert response.json()["detail"] == ("Only applied onboarding rows can receive a lease pack.")


def test_tenant_onboarding_send_lease_pack_requires_attached_lease_document(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_applied_onboarding(client, session)

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Attach a lease document before sending the lease pack."


def test_tenant_onboarding_send_lease_pack_uses_account_route_after_invite_expiry(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    sends: list[str] = []

    def fake_lease_pack_send(invite, settings):  # noqa: ANN001, ARG001
        sends.append(invite.onboarding_url)
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id="lease-pack-expired-invite",
                metadata={"template_key": invite.template_key},
            )
        ]

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_tenant_lease_pack_invite",
        fake_lease_pack_send,
    )
    body = _create_applied_onboarding(client, session)
    _attach_lease_document(session, body["id"])
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    onboarding.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    session.commit()

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 200
    assert sends[0].endswith("/tenant-portal/lease")


def test_tenant_onboarding_send_lease_pack_rejects_open_lease_questions(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {
            "questions": [
                {
                    "id": "question-1",
                    "question": "Can we confirm the outgoings clause?",
                    "status": "open",
                }
            ],
        },
    )
    session.commit()

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Resolve lease agreement questions before sending the lease pack."
    )


def test_tenant_onboarding_send_lease_pack_rejects_signed_lease(
    client: TestClient,
    session: Session,
) -> None:
    body = _create_applied_onboarding(client, session)
    onboarding = session.get(TenantOnboarding, UUID(body["id"]))
    assert onboarding is not None
    set_lease_agreement_section(
        onboarding,
        {
            "signing": {
                "signed_at": utcnow().isoformat(),
                "signed_by_actor": "tenant-portal-account:test",
            },
        },
    )
    session.commit()

    response = client.post(
        f"/api/v1/tenant-onboarding/{body['id']}/send-lease-pack",
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Lease agreement is already signed."
