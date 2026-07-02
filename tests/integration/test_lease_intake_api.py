"""Lease intake API tests with OpenAI extraction monkeypatched."""

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    Entity,
    Lease,
    LeaseIntake,
    Obligation,
    Property,
    TenancyUnit,
    Tenant,
)
from stewart.core.settings import Settings


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _fake_extraction() -> dict[str, Any]:
    future_obligation_due = (date.today() + timedelta(days=30)).isoformat()
    return {
        "property": {
            "name": "AI House",
            "street_address": "5 Machine Lane",
            "suburb": "Fortitude Valley",
            "state": "QLD",
            "postcode": "4006",
            "country_code": "AU",
            "property_type": "commercial_office",
            "parcel_id": None,
            "land_sqm": None,
            "building_sqm": 900,
            "parking_spaces": 12,
            "ownership_structure": "trust",
            "owner_legal_name": "AI House Property Trust",
            "owner_abn": "22 333 444 555",
            "trustee_name": "AI House Trustee Pty Ltd",
            "trust_name": "AI House Property Trust",
            "invoice_issuer_name": "AI House Trustee Pty Ltd",
            "billing_contact_name": "AI Accounts",
            "billing_email": "accounts@aihouse.example",
            "invoice_reference": "AIH-",
            "ownership_split": "100% AI House Property Trust",
            "owner_gst_registered": True,
            "xero_contact_id": "xero-ai-house",
            "xero_tracking_category": "AI House",
        },
        "tenancy_unit": {"unit_label": "Suite 8", "sqm": 180, "parking_spaces": 4},
        "tenant": {
            "legal_name": "Lease AI Pty Ltd",
            "trading_name": "Lease AI",
            "abn": "12 345 678 901",
            "contact_name": "Casey Morgan",
            "contact_email": "casey@exampletenant.com.au",
            "contact_phone": None,
            "billing_email": "accounts@exampletenant.com.au",
        },
        "lease": {
            "status": "active",
            "commencement_date": "2026-07-01",
            "expiry_date": "2029-06-30",
            "annual_rent_cents": 24000000,
            "rent_frequency": "annual",
            "outgoings_recoverable": True,
            "next_review_date": "2027-07-01",
            "option_summary": "One 3-year option.",
            "security_summary": "Bank guarantee equal to 3 months rent.",
            "notes": "Extracted from lease intake.",
        },
        "obligations": [
            {
                "title": "Bank guarantee review",
                "category": "bank_guarantee",
                "due_date": future_obligation_due,
                "priority": 1,
                "owner_role": "finance",
                "notes": "Confirm guarantee is held before commencement.",
            }
        ],
        "warnings": [],
    }


def _create_existing_lease_parts(client: TestClient, entity_id: str) -> tuple[str, str, str]:
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Existing Intake Property",
            "street_address": "8 Existing Lane",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_office",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Existing Suite", "sqm": 122},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Existing Tenant Pty Ltd",
            "billing_email": "accounts@existing.example",
        },
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]
    return property_id, unit_id, tenant_id


def test_lease_intake_upload_extract_get_list_and_apply(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    def fake_extract_lease_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        assert file_data == b"%PDF-1.4 lease"
        assert filename == "lease.pdf"
        assert content_type == "application/pdf"
        return _fake_extraction(), "resp_test_123"

    monkeypatch.setattr(
        "apps.api.routers.lease_intakes.extract_lease_file", fake_extract_lease_file
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/lease-intakes",
        data={"entity_id": entity_id},
        files={"file": ("lease.pdf", b"%PDF-1.4 lease", "application/pdf")},
    )
    assert create_response.status_code == 201
    intake_body = create_response.json()
    intake_id = intake_body["id"]
    assert intake_body["status"] == "uploaded"

    list_response = client.get(f"/api/v1/lease-intakes?entity_id={entity_id}")
    assert list_response.status_code == 200
    assert [row["id"] for row in list_response.json()] == [intake_id]

    get_response = client.get(f"/api/v1/lease-intakes/{intake_id}")
    assert get_response.status_code == 200
    get_body = get_response.json()
    assert get_body["filename"] == "lease.pdf"
    assert get_body["status"] == "extracted"
    assert get_body["openai_response_id"] == "resp_test_123"
    assert get_body["extracted_data"]["tenant"]["legal_name"] == "Lease AI Pty Ltd"

    reviewed = _fake_extraction()
    reviewed["tenant"]["legal_name"] = "Reviewed Lease AI Pty Ltd"
    reviewed["lease"]["annual_rent_cents"] = 25000000
    apply_response = client.post(
        f"/api/v1/lease-intakes/{intake_id}/apply",
        json={"reviewed_data": reviewed},
    )
    assert apply_response.status_code == 200
    applied_body = apply_response.json()
    assert applied_body["status"] == "applied"
    assert applied_body["applied_lease_id"] is not None

    intake = session.get(LeaseIntake, UUID(intake_id))
    assert intake is not None
    assert intake.applied_lease_id is not None
    lease = session.get(Lease, intake.applied_lease_id)
    assert lease is not None
    assert lease.annual_rent_cents == 25000000
    prop = session.scalar(select(Property).where(Property.name == "AI House"))
    assert prop is not None
    assert prop.ownership_structure == "trust"
    assert prop.trustee_name == "AI House Trustee Pty Ltd"
    assert prop.xero_contact_id == "xero-ai-house"
    assert (
        session.scalar(select(Tenant).where(Tenant.legal_name == "Reviewed Lease AI Pty Ltd"))
        is not None
    )
    obligations = session.scalars(select(Obligation).where(Obligation.lease_id == lease.id)).all()
    assert {obligation.title for obligation in obligations} >= {"Bank guarantee review"}


def test_lease_intake_can_upload_then_extract_later(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    def fake_extract_lease_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return _fake_extraction(), "resp_test_later"

    monkeypatch.setattr(
        "apps.api.routers.lease_intakes.extract_lease_file", fake_extract_lease_file
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/lease-intakes",
        data={"entity_id": entity_id, "extract": "false"},
        files={"file": ("lease.txt", b"plain text lease", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    assert create_response.json()["status"] == "uploaded"

    extract_response = client.post(f"/api/v1/lease-intakes/{intake_id}/extract")
    assert extract_response.status_code == 200
    assert extract_response.json()["status"] == "extracted"
    assert extract_response.json()["openai_response_id"] == "resp_test_later"


def test_lease_intake_apply_reuses_selected_register_records(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    entity_id = _entity_id(session)
    property_id, unit_id, tenant_id = _create_existing_lease_parts(client, entity_id)

    def fake_extract_lease_file(**_: object) -> tuple[dict[str, Any], str]:
        extracted = _fake_extraction()
        extracted["property"]["name"] = "Different Extracted Property"
        extracted["tenancy_unit"]["unit_label"] = "Different Extracted Unit"
        extracted["tenant"]["legal_name"] = "Different Extracted Tenant Pty Ltd"
        return extracted, "resp_reuse"

    monkeypatch.setattr(
        "apps.api.routers.lease_intakes.extract_lease_file", fake_extract_lease_file
    )

    create_response = client.post(
        "/api/v1/lease-intakes",
        data={"entity_id": entity_id},
        files={"file": ("reuse.txt", b"lease text", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    get_response = client.get(f"/api/v1/lease-intakes/{intake_id}")
    assert get_response.status_code == 200

    apply_response = client.post(
        f"/api/v1/lease-intakes/{intake_id}/apply",
        json={
            "property_id": property_id,
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "reviewed_data": get_response.json()["extracted_data"],
        },
    )
    assert apply_response.status_code == 200
    lease_id = apply_response.json()["applied_lease_id"]

    lease = session.get(Lease, UUID(lease_id))
    assert lease is not None
    assert str(lease.tenancy_unit_id) == unit_id
    assert str(lease.tenant_id) == tenant_id
    assert session.scalar(
        select(Property).where(Property.name == "Different Extracted Property")
    ) is None
    assert session.scalar(
        select(TenancyUnit).where(TenancyUnit.unit_label == "Different Extracted Unit")
    ) is None
    assert session.scalar(
        select(Tenant).where(Tenant.legal_name == "Different Extracted Tenant Pty Ltd")
    ) is None


def test_lease_intake_apply_rejects_missing_review_fields(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    def fake_extract_lease_file(**_: object) -> tuple[dict[str, Any], str]:
        return {
            "property": {},
            "tenancy_unit": {},
            "tenant": {},
            "lease": {},
            "obligations": [],
            "warnings": [],
        }, "resp_missing"

    monkeypatch.setattr(
        "apps.api.routers.lease_intakes.extract_lease_file", fake_extract_lease_file
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/lease-intakes",
        data={"entity_id": entity_id},
        files={"file": ("missing.txt", b"lease text", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    get_response = client.get(f"/api/v1/lease-intakes/{intake_id}")
    assert get_response.status_code == 200

    apply_response = client.post(f"/api/v1/lease-intakes/{intake_id}/apply", json={})
    assert apply_response.status_code == 422
    assert "Choose an existing property" in apply_response.json()["detail"][0]


def test_lease_intake_apply_rejects_overlapping_unit_lease(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    entity_id = _entity_id(session)
    property_id, unit_id, tenant_id = _create_existing_lease_parts(client, entity_id)
    existing_lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2026-12-31",
            "annual_rent_cents": 12000000,
            "rent_frequency": "annual",
        },
    )
    assert existing_lease_response.status_code == 201

    def fake_extract_lease_file(**_: object) -> tuple[dict[str, Any], str]:
        extracted = _fake_extraction()
        extracted["lease"]["commencement_date"] = "2026-07-01"
        extracted["lease"]["expiry_date"] = "2027-06-30"
        return extracted, "resp_overlap"

    monkeypatch.setattr(
        "apps.api.routers.lease_intakes.extract_lease_file", fake_extract_lease_file
    )

    create_response = client.post(
        "/api/v1/lease-intakes",
        data={"entity_id": entity_id},
        files={"file": ("overlap.txt", b"lease text", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    get_response = client.get(f"/api/v1/lease-intakes/{intake_id}")
    assert get_response.status_code == 200

    apply_response = client.post(
        f"/api/v1/lease-intakes/{intake_id}/apply",
        json={
            "property_id": property_id,
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "reviewed_data": get_response.json()["extracted_data"],
        },
    )
    assert apply_response.status_code == 409
    assert "overlapping" in apply_response.json()["detail"]
