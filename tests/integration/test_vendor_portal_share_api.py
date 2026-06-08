"""Operator controls for vendor portal work-order visibility."""

from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AuditAction,
    Contractor,
    Entity,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    PropertyType,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _seed_share_target(
    session: Session,
    *,
    status: MaintenanceWorkOrderStatus = MaintenanceWorkOrderStatus.assigned,
) -> tuple[MaintenanceWorkOrder, Contractor]:
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
        notes="Operator-only contractor note.",
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
    session.add_all([contractor, prop])
    session.flush()
    work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Private Tenant Pty Ltd boardroom HVAC failure",
        description="Tenant says their directors are arriving at 10am.",
        status=status,
        priority=MaintenancePriority.urgent,
        requested_at=datetime(2026, 6, 1, 1, 30, tzinfo=UTC),
        contractor_name="Copied contact only",
        contractor_email="copied-contact@example.test",
        due_date=date(2026, 6, 7),
        notes="Internal escalation: do not show this to the vendor.",
        work_order_metadata={
            "comments": [
                {
                    "visibility": "internal",
                    "body": "Internal-only note must stay private.",
                }
            ],
            "contractor_delivery": {
                "email": {
                    "send": {
                        "provider": "sendgrid",
                        "provider_message_id": "sendgrid-secret",
                        "body": "provider-only body",
                    }
                }
            },
        },
    )
    session.add(work_order)
    session.commit()
    return work_order, contractor


def test_operator_can_share_work_order_to_vendor_portal_with_safe_projection(
    client: TestClient,
    session: Session,
) -> None:
    work_order, contractor = _seed_share_target(session)

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order.id}/vendor-portal/share",
        json={
            "contractor_id": str(contractor.id),
            "title": "Repair air conditioning",
            "comment": "Please attend before trading opens.",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    metadata = body["metadata"]
    assert metadata["vendor_portal_visible"] is True
    assert metadata["vendor_portal_contractor_id"] == str(contractor.id)
    assert metadata["vendor_portal_title"] == "Repair air conditioning"
    assert metadata["vendor_portal_shared_by_user_id"]
    assert metadata["comments"][-1]["visibility"] == "contractor"
    assert metadata["comments"][-1]["body"] == "Please attend before trading opens."
    assert metadata["activity_history"][-1]["event"] == "vendor_portal_shared"
    assert metadata["contractor_delivery"]["email"]["send"]["provider_message_id"] == (
        "sendgrid-secret"
    )
    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "maintenance_work_order",
            AuditAction.target_id == work_order.id,
            AuditAction.tool_name == "maintenance.vendor_portal.share",
        )
    )
    assert audit is not None
    assert audit.action == "update"
    assert audit.data_classification == "confidential"
    assert audit.tool_input == {
        "maintenance_work_order_id": str(work_order.id),
        "contractor_id": str(contractor.id),
    }
    assert "Repair air conditioning" not in str(audit.tool_input)
    assert "Private Tenant Pty Ltd" not in str(audit.tool_input)

    portal_response = client.get(f"/api/v1/vendor-portal/{contractor.id}")
    assert portal_response.status_code == 200, portal_response.text
    portal_text = portal_response.text
    portal_body = portal_response.json()
    item = portal_body["work_orders"]["items"][0]
    assert item["id"] == str(work_order.id)
    assert item["title"] == "Repair air conditioning"
    assert item["comments"] == [
        {
            "body": "Please attend before trading opens.",
            "timestamp": metadata["comments"][-1]["timestamp"],
            "author": "property_team",
            "author_label": "Property team",
        }
    ]
    forbidden_fragments = [
        "Private Tenant Pty Ltd",
        "Tenant says their directors",
        "Internal escalation",
        "Internal-only note",
        "copied-contact@example.test",
        "sendgrid-secret",
        "provider-only body",
        "contractor_delivery",
    ]
    for fragment in forbidden_fragments:
        assert fragment not in portal_text


def test_operator_can_hide_work_order_from_vendor_portal(
    client: TestClient,
    session: Session,
) -> None:
    work_order, contractor = _seed_share_target(session)
    share_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order.id}/vendor-portal/share",
        json={"contractor_id": str(contractor.id), "title": "Repair air conditioning"},
    )
    assert share_response.status_code == 200, share_response.text

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order.id}/vendor-portal/unshare",
    )

    assert response.status_code == 200, response.text
    metadata = response.json()["metadata"]
    assert metadata["vendor_portal_visible"] is False
    assert "vendor_portal_contractor_id" not in metadata
    assert "vendor_portal_title" not in metadata
    assert "vendor_portal_shared_at" not in metadata
    assert "vendor_portal_shared_by_user_id" not in metadata
    assert "vendor_portal_shared_by_actor" not in metadata
    assert metadata["activity_history"][-1]["event"] == "vendor_portal_hidden"
    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "maintenance_work_order",
            AuditAction.target_id == work_order.id,
            AuditAction.tool_name == "maintenance.vendor_portal.unshare",
        )
    )
    assert audit is not None
    assert audit.action == "update"
    assert audit.data_classification == "confidential"

    portal_response = client.get(f"/api/v1/vendor-portal/{contractor.id}")
    assert portal_response.status_code == 200, portal_response.text
    assert portal_response.json()["work_orders"]["items"] == []


def test_vendor_portal_share_requires_explicit_safe_title(
    client: TestClient,
    session: Session,
) -> None:
    work_order, contractor = _seed_share_target(session)

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order.id}/vendor-portal/share",
        json={"contractor_id": str(contractor.id), "title": "   "},
    )

    assert response.status_code == 422
    refreshed = session.get(MaintenanceWorkOrder, work_order.id)
    assert refreshed is not None
    assert refreshed.work_order_metadata.get("vendor_portal_visible") is not True


def test_vendor_portal_share_rejects_wrong_entity_contractors(
    client: TestClient,
    session: Session,
) -> None:
    work_order, _contractor = _seed_share_target(session)
    entity = _entity(session)
    other_entity = Entity(
        organisation_id=entity.organisation_id,
        name="Other Property Pty Ltd",
    )
    session.add(other_entity)
    session.flush()
    other_contractor = Contractor(entity_id=other_entity.id, name="Wrong Entity HVAC")
    session.add(other_contractor)
    session.commit()

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order.id}/vendor-portal/share",
        json={
            "contractor_id": str(other_contractor.id),
            "title": "Repair air conditioning",
        },
    )

    assert response.status_code == 404
    refreshed = session.get(MaintenanceWorkOrder, work_order.id)
    assert refreshed is not None
    assert refreshed.work_order_metadata.get("vendor_portal_visible") is not True


def test_vendor_portal_share_rejects_closed_work_orders(
    client: TestClient,
    session: Session,
) -> None:
    completed_work_order, contractor = _seed_share_target(
        session,
        status=MaintenanceWorkOrderStatus.completed,
    )

    completed_response = client.post(
        f"/api/v1/maintenance/work-orders/{completed_work_order.id}/vendor-portal/share",
        json={
            "contractor_id": str(contractor.id),
            "title": "Repair air conditioning",
        },
    )
    assert completed_response.status_code == 409

    cancelled_work_order, cancelled_contractor = _seed_share_target(
        session,
        status=MaintenanceWorkOrderStatus.cancelled,
    )
    cancelled_response = client.post(
        f"/api/v1/maintenance/work-orders/{cancelled_work_order.id}/vendor-portal/share",
        json={
            "contractor_id": str(cancelled_contractor.id),
            "title": "Repair air conditioning",
        },
    )
    assert cancelled_response.status_code == 409


def test_vendor_portal_share_rejects_unknown_contractors(
    client: TestClient,
    session: Session,
) -> None:
    work_order, _contractor = _seed_share_target(session)

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order.id}/vendor-portal/share",
        json={"contractor_id": str(uuid4()), "title": "Repair air conditioning"},
    )

    assert response.status_code == 404
    refreshed = session.get(MaintenanceWorkOrder, UUID(str(work_order.id)))
    assert refreshed is not None
    assert refreshed.work_order_metadata.get("vendor_portal_visible") is not True
