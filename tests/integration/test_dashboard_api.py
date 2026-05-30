"""Dashboard overview API integration tests."""

from datetime import date
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    DocumentCategory,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    StoredDocument,
    TenantOnboarding,
    TenantOnboardingStatus,
)


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def test_dashboard_overview_returns_first_paint_summary(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Dashboard Plaza",
            "street_address": "10 Dashboard Street",
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
        json={"property_id": property_id, "unit_label": "Suite 1"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    vacant_unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Suite 2"},
    )
    assert vacant_unit_response.status_code == 201

    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Dashboard Tenant Pty Ltd",
            "billing_email": "tenant@example.com",
        },
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2026-07-31",
            "annual_rent_cents": 1200000,
            "rent_frequency": "monthly",
            "next_review_date": "2026-06-15",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    charge_response = client.post(
        "/api/v1/charge-rules",
        json={
            "lease_id": lease_id,
            "charge_type": "base_rent",
            "amount_cents": 100000,
            "frequency": "monthly",
            "gst_treatment": "taxable",
            "next_due_date": "2026-06-01",
        },
    )
    assert charge_response.status_code == 201

    obligation_response = client.post(
        "/api/v1/obligations",
        json={
            "entity_id": entity_id,
            "property_id": property_id,
            "tenancy_unit_id": unit_id,
            "lease_id": lease_id,
            "title": "Review make good obligations",
            "category": "make_good",
            "status": "due_soon",
            "due_date": "2026-06-10",
            "priority": 1,
        },
    )
    assert obligation_response.status_code == 201

    document = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        filename="dashboard-lease.pdf",
        content_type="application/pdf",
        byte_size=16,
        file_data=b"dashboard lease",
        category=DocumentCategory.lease,
    )
    session.add(document)
    session.flush()
    session.add(
        DocumentIntake(
            entity_id=UUID(entity_id),
            document_id=document.id,
            status=DocumentIntakeStatus.ready_for_review,
            document_type="lease",
            summary="Lease ready for review.",
            confidence=0.9,
        )
    )
    session.add(
        TenantOnboarding(
            entity_id=UUID(entity_id),
            lease_id=UUID(lease_id),
            tenant_id=UUID(tenant_id),
            token="dashboard-token",
            status=TenantOnboardingStatus.submitted,
            due_date=date(2026, 6, 5),
            submitted_data={"contact_name": "Ada"},
        )
    )
    session.commit()

    response = client.get(f"/api/v1/dashboard/overview?entity_id={entity_id}&as_of=2026-05-30")

    assert response.status_code == 200
    body = response.json()
    assert body["entity"] == {"id": entity_id, "name": "SKJ Property Pty Ltd"}
    assert body["counts"] == {
        "property_count": 1,
        "tenant_count": 1,
        "open_obligation_count": 1,
        "overdue_obligation_count": 0,
        "due_soon_obligation_count": 1,
    }
    assert body["rent_roll"] == {
        "unit_count": 2,
        "occupied_unit_count": 1,
        "vacant_unit_count": 1,
        "active_lease_count": 1,
        "annual_rent_cents": 1200000,
        "charge_rules_total_cents": 100000,
        "ready_to_bill_count": 0,
        "blocked_row_count": 2,
    }
    assert body["intake"]["document_counts"]["ready_for_review"] == 1
    assert body["intake"]["document_waiting_count"] == 1
    assert body["intake"]["onboarding_counts"]["submitted"] == 1
    assert body["intake"]["onboarding_waiting_count"] == 1

    event_kinds = [event["kind"] for event in body["upcoming_lease_events"]]
    assert event_kinds == ["tenant_onboarding", "obligation", "rent_review", "lease_expiry"]
    assert body["upcoming_lease_events"][0]["tenant_name"] == "Dashboard Tenant Pty Ltd"
