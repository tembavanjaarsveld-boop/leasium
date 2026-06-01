"""Read-only vendor portal API tests."""

from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    Contractor,
    Entity,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    PropertyType,
    Tenant,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _seed_vendor_portal_data(session: Session) -> Contractor:
    entity = _entity(session)
    contractor = Contractor(
        entity_id=entity.id,
        name="Rapid HVAC",
        company_name="Rapid HVAC Pty Ltd",
        categories=["hvac", "urgent"],
        email="dispatch@rapid.example",
        phone="+61 400 111 222",
        service_radius_km=25,
        priority=1,
        notes="Operator-only contractor notes.",
    )
    other_contractor = Contractor(
        entity_id=entity.id,
        name="Wrong Contractor",
        company_name="Wrong Contractor Pty Ltd",
        categories=["hvac"],
        email="wrong@example.test",
        phone="+61 400 999 999",
    )
    prop = Property(
        entity_id=entity.id,
        name="Queen Street Retail Centre",
        street_address="101 Queen Street",
        suburb="Brisbane",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
    )
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Private Tenant Pty Ltd",
        contact_name="Private Tenant Contact",
        contact_email="private-tenant@example.test",
    )
    session.add_all([contractor, other_contractor, prop, tenant])
    session.flush()

    visible = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        tenant_id=tenant.id,
        title="Private Tenant Pty Ltd air conditioning failure",
        description="Tenant says boardroom is unusable.",
        status=MaintenanceWorkOrderStatus.assigned,
        priority=MaintenancePriority.urgent,
        requested_at=datetime(2026, 6, 1, 1, 30, tzinfo=UTC),
        contractor_name="Rapid HVAC",
        contractor_email="dispatch@rapid.example",
        contractor_phone="+61 400 111 222",
        contractor_assigned_at=datetime(2026, 6, 1, 2, 0, tzinfo=UTC),
        quote_amount_cents=125_000,
        due_date=date(2026, 6, 7),
        notes="Internal-only note must stay private.",
        work_order_metadata={
            "vendor_portal_visible": True,
            "vendor_portal_contractor_id": str(contractor.id),
            "vendor_portal_title": "Repair air conditioning",
            "comments": [
                {
                    "visibility": "contractor",
                    "body": "Please attend before trading opens.",
                    "timestamp": "2026-06-01T03:00:00Z",
                },
                {
                    "visibility": "internal",
                    "body": "Internal-only comment must stay private.",
                },
                {
                    "visibility": "tenant",
                    "body": "Tenant-only comment must stay private.",
                },
            ],
            "contractor_delivery": {
                "email": {
                    "provider": "sendgrid",
                    "provider_message_id": "sendgrid-secret",
                    "body": "provider-only email body",
                }
            },
            "tenant_snapshot": {
                "legal_name": "Private Tenant Pty Ltd",
                "email": "private-tenant@example.test",
            },
        },
    )
    hidden = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Hidden same-contractor job",
        status=MaintenanceWorkOrderStatus.assigned,
        priority=MaintenancePriority.normal,
        contractor_email="dispatch@rapid.example",
        work_order_metadata={"vendor_portal_visible": False},
    )
    contact_only = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Contact-only visible job should be hidden",
        status=MaintenanceWorkOrderStatus.assigned,
        priority=MaintenancePriority.high,
        contractor_name="Rapid HVAC",
        contractor_email="dispatch@rapid.example",
        contractor_phone="+61 400 111 222",
        work_order_metadata={
            "vendor_portal_visible": True,
            "vendor_portal_title": "Copied contact assignment should stay hidden",
        },
    )
    wrong_contractor = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Wrong contractor visible job",
        status=MaintenanceWorkOrderStatus.assigned,
        priority=MaintenancePriority.high,
        contractor_email=other_contractor.email,
        work_order_metadata={
            "vendor_portal_visible": True,
            "vendor_portal_contractor_id": str(other_contractor.id),
            "vendor_portal_title": "Wrong contractor only",
        },
    )
    completed = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Completed contractor job",
        status=MaintenanceWorkOrderStatus.completed,
        priority=MaintenancePriority.high,
        contractor_email="dispatch@rapid.example",
        work_order_metadata={
            "vendor_portal_visible": True,
            "vendor_portal_contractor_id": str(contractor.id),
            "vendor_portal_title": "Completed job should be hidden",
        },
    )
    deleted = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Deleted contractor job",
        status=MaintenanceWorkOrderStatus.assigned,
        priority=MaintenancePriority.high,
        contractor_email="dispatch@rapid.example",
        deleted_at=datetime(2026, 6, 1, 4, 0, tzinfo=UTC),
        work_order_metadata={
            "vendor_portal_visible": True,
            "vendor_portal_contractor_id": str(contractor.id),
            "vendor_portal_title": "Deleted job should be hidden",
        },
    )
    session.add_all(
        [visible, hidden, contact_only, wrong_contractor, completed, deleted]
    )
    session.commit()
    return contractor


def test_vendor_portal_preview_returns_only_contractor_safe_visible_work(
    client: TestClient,
    session: Session,
) -> None:
    contractor = _seed_vendor_portal_data(session)

    response = client.get(f"/api/v1/vendor-portal/{contractor.id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["auth"] == {
        "mode": "operator_preview",
        "token_source": "bearer",
        "vendor_auth_configured": False,
        "boundary": "operator_session",
        "detail": (
            "Read-only operator preview scoped by entity role; no vendor portal "
            "account is created."
        ),
    }
    assert body["vendor"]["id"] == str(contractor.id)
    assert body["vendor"]["name"] == "Rapid HVAC"
    assert body["vendor"]["company_name"] == "Rapid HVAC Pty Ltd"
    assert body["vendor"]["categories"] == ["hvac", "urgent"]
    assert body["vendor"]["service_radius_km"] == 25
    assert body["vendor"]["priority"] == 1
    assert body["work_orders"]["open_count"] == 1
    assert body["work_orders"]["urgent_count"] == 1
    assert len(body["work_orders"]["items"]) == 1
    item = body["work_orders"]["items"][0]
    assert item["property_name"] == "Queen Street Retail Centre"
    assert item["title"] == "Repair air conditioning"
    assert item["status"] == "assigned"
    assert item["priority"] == "urgent"
    assert item["due_date"] == "2026-06-07"
    assert item["quote_amount_cents"] == 125000
    assert item["comments"] == [
        {
            "body": "Please attend before trading opens.",
            "timestamp": "2026-06-01T03:00:00Z",
        }
    ]
    assert "Read-only vendor portal" in body["guardrails"][0]

    response_text = response.text
    forbidden_fragments = [
        "Private Tenant Pty Ltd",
        "Private Tenant Contact",
        "private-tenant@example.test",
        "Tenant says boardroom",
        "Internal-only note",
        "Internal-only comment",
        "Tenant-only comment",
        "sendgrid-secret",
        "provider-only email body",
        "Hidden same-contractor job",
        "Contact-only visible job should be hidden",
        "Copied contact assignment should stay hidden",
        "Wrong contractor only",
        "Completed job should be hidden",
        "Deleted job should be hidden",
        "tenant_id",
        "lease_id",
        "invoice_draft_id",
        "source_document_id",
        "contractor_delivery",
        "Operator-only contractor notes",
    ]
    for fragment in forbidden_fragments:
        assert fragment not in response_text


def test_vendor_portal_preview_404_for_deleted_or_unknown_contractor(
    client: TestClient,
    session: Session,
) -> None:
    contractor = _seed_vendor_portal_data(session)
    contractor.deleted_at = datetime(2026, 6, 1, 5, 0, tzinfo=UTC)
    session.commit()

    deleted_response = client.get(f"/api/v1/vendor-portal/{contractor.id}")
    assert deleted_response.status_code == 404

    unknown_response = client.get(f"/api/v1/vendor-portal/{uuid4()}")
    assert unknown_response.status_code == 404


def test_vendor_portal_preview_requires_entity_access(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    other_entity = Entity(
        organisation_id=entity.organisation_id,
        name="Other Property Pty Ltd",
    )
    session.add(other_entity)
    session.flush()
    contractor = Contractor(
        entity_id=other_entity.id,
        name="Other Entity Contractor",
        email="other-contractor@example.test",
    )
    session.add(contractor)
    session.commit()

    response = client.get(f"/api/v1/vendor-portal/{contractor.id}")

    assert response.status_code == 403
