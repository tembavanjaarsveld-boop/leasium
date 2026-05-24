"""Tenant onboarding link API tests."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from apps.api.routers import tenant_onboarding as tenant_onboarding_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import Entity, StoredDocument, Tenant, TenantOnboarding
from stewart.integrations.communications import DeliveryResult


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


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
