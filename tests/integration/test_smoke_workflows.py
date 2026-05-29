"""Smoke tests for the core Leasium workflows used by the web app."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity
from stewart.core.settings import Settings


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _document_extraction() -> dict[str, Any]:
    return {
        "document_type": "insurance_certificate",
        "summary": "Public liability certificate for tenant onboarding.",
        "confidence": 0.92,
        "parties": [],
        "dates": [],
        "money": [],
        "obligations": [],
        "warnings": [],
    }


def test_healthcheck_smoke(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["app"] == "Leasium"
    assert body["release"] == {
        "commit": "unknown",
        "source": "local",
    }


def test_healthcheck_reports_deployed_commit(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RENDER_GIT_COMMIT", "abc123def456")

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["release"] == {
        "commit": "abc123def456",
        "source": "render",
    }


def test_billing_readiness_smoke_surfaces_actionable_blockers(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Smoke Billing Centre",
            "street_address": "10 Smoke Street",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 1"},
    )
    assert unit_response.status_code == 201

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Smoke Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_response.json()["id"],
            "tenant_id": tenant_response.json()["id"],
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "annual_rent_cents": 18000000,
            "rent_frequency": "annual",
        },
    )
    assert lease_response.status_code == 201

    rent_roll_response = client.get(
        "/api/v1/rent-roll",
        params={
            "entity_id": entity_id,
            "property_id": property_id,
            "as_of": "2026-05-19",
        },
    )

    assert rent_roll_response.status_code == 200
    rows = rent_roll_response.json()
    assert len(rows) == 1
    assert rows[0]["tenant_name"] == "Smoke Tenant Pty Ltd"
    assert rows[0]["invoice_readiness_blockers"] == [
        "Lease has no charge rules.",
        "Tenant is missing a billing email.",
    ]
    assert rows[0]["xero_readiness_blockers"] == ["Entity is not connected to Xero."]


def test_billing_readiness_surfaces_property_ownership_blockers(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Trust Billing Centre",
            "street_address": "20 Trust Street",
            "property_type": "commercial_retail",
            "ownership_structure": "trust",
            "trust_name": "Trust Billing Property Trust",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 2"},
    )
    assert unit_response.status_code == 201

    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Trust Tenant Pty Ltd",
            "billing_email": "accounts@trusttenant.example",
        },
    )
    assert tenant_response.status_code == 201

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_response.json()["id"],
            "tenant_id": tenant_response.json()["id"],
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "annual_rent_cents": 18000000,
            "rent_frequency": "annual",
        },
    )
    assert lease_response.status_code == 201

    charge_response = client.post(
        "/api/v1/charge-rules",
        json={
            "lease_id": lease_response.json()["id"],
            "charge_type": "base_rent",
            "amount_cents": 1500000,
            "frequency": "monthly",
            "gst_treatment": "taxable",
            "xero_account_code": "200",
            "xero_tax_type": "OUTPUT",
            "next_due_date": "2026-06-01",
        },
    )
    assert charge_response.status_code == 201

    rent_roll_response = client.get(
        "/api/v1/rent-roll",
        params={
            "entity_id": entity_id,
            "property_id": property_id,
            "as_of": "2026-05-19",
        },
    )

    assert rent_roll_response.status_code == 200
    rows = rent_roll_response.json()
    assert rows[0]["invoice_readiness_blockers"] == [
        "Invoice issuer missing.",
        "ABN missing for property owner.",
        "Trustee missing.",
    ]
    assert rows[0]["xero_readiness_blockers"] == [
        "Entity is not connected to Xero.",
        "Xero issuer mapping missing.",
    ]


def test_tenant_document_can_be_promoted_to_smart_intake_once(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        assert file_data == b"certificate bytes"
        assert filename == "certificate.txt"
        assert content_type == "text/plain"
        assert settings.app_name == "Leasium"
        return _document_extraction(), "resp_smoke_document"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Smoke Review Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201

    upload_response = client.post(
        "/api/v1/documents",
        data={
            "entity_id": entity_id,
            "tenant_id": tenant_response.json()["id"],
            "category": "insurance",
            "notes": "Needs review before tenant profile updates.",
        },
        files={"file": ("certificate.txt", b"certificate bytes", "text/plain")},
    )
    assert upload_response.status_code == 201
    document_id = upload_response.json()["id"]

    create_response = client.post(f"/api/v1/document-intakes/from-document/{document_id}")
    assert create_response.status_code == 200
    intake_id = create_response.json()["id"]

    get_response = client.get(f"/api/v1/document-intakes/{intake_id}")
    assert get_response.status_code == 200
    intake_body = get_response.json()
    assert intake_body["document_id"] == document_id
    assert intake_body["status"] == "ready_for_review"
    assert intake_body["document_type"] == "insurance_certificate"
    assert intake_body["openai_response_id"] == "resp_smoke_document"

    create_again_response = client.post(f"/api/v1/document-intakes/from-document/{document_id}")
    assert create_again_response.status_code == 200
    assert create_again_response.json()["id"] == intake_id

    list_response = client.get("/api/v1/document-intakes", params={"entity_id": entity_id})
    assert list_response.status_code == 200
    assert [row["id"] for row in list_response.json()] == [intake_id]
