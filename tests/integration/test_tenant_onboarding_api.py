"""Tenant onboarding link API tests."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, StoredDocument, Tenant, TenantOnboarding


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
