"""Tenant onboarding link API tests."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, Tenant, TenantOnboarding


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


def test_tenant_onboarding_link_public_submit_updates_tenant(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["status"] == "sent"
    assert "/onboarding/" in body["onboarding_url"]

    token = body["token"]
    public_response = client.get(f"/api/v1/tenant-onboarding/public/{token}")
    assert public_response.status_code == 200
    assert public_response.json()["tenant_legal_name"] == "Onboarding Tenant Pty Ltd"

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
    assert tenant.legal_name == "Submitted Tenant Pty Ltd"
    assert tenant.billing_email == "accounts@exampletenant.com.au"
    assert tenant.tenant_metadata["insurance_confirmed"] is True


def test_tenant_onboarding_cancel_blocks_public_link_and_allows_recreate(
    client: TestClient,
    session: Session,
) -> None:
    lease_id = _lease_id(client, session)
    create_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert create_response.status_code == 201
    onboarding_id = create_response.json()["id"]
    token = create_response.json()["token"]

    cancel_response = client.post(f"/api/v1/tenant-onboarding/{onboarding_id}/cancel")
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "cancelled"

    public_response = client.get(f"/api/v1/tenant-onboarding/public/{token}")
    assert public_response.status_code == 404

    recreate_response = client.post("/api/v1/tenant-onboarding", json={"lease_id": lease_id})
    assert recreate_response.status_code == 201
    assert recreate_response.json()["status"] == "sent"
    assert recreate_response.json()["id"] != onboarding_id
