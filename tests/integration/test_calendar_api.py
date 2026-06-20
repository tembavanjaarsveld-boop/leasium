"""Unified operations calendar API integration tests."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AuditAction,
    ComplianceCheck,
    Entity,
    Lease,
    LeaseStatus,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    PropertyType,
    TenancyUnit,
    Tenant,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import get_settings


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _lease_scope(session: Session, entity: Entity) -> tuple[Property, TenancyUnit, Tenant, Lease]:
    prop = Property(
        entity_id=entity.id,
        name="Calendar Plaza",
        street_address="9 Calendar Circuit",
        property_type=PropertyType.commercial_office,
    )
    tenant = Tenant(entity_id=entity.id, legal_name="Calendar Tenant Pty Ltd")
    session.add_all([prop, tenant])
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Suite 4")
    session.add(unit)
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date(2026, 1, 1),
        expiry_date=date(2026, 7, 10),
    )
    session.add(lease)
    session.flush()
    return prop, unit, tenant, lease


def test_calendar_events_returns_read_only_union_with_window_and_entity_scope(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    prop, unit, tenant, lease = _lease_scope(session, entity)
    work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        lease_id=lease.id,
        title="Repair fire exit light",
        due_date=date(2026, 7, 12),
    )
    compliance_check = ComplianceCheck(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        lease_id=lease.id,
        title="Annual fire safety statement",
        next_due_date=date(2026, 7, 15),
    )
    out_of_window_work = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="August roof clean",
        due_date=date(2026, 8, 3),
    )
    closed_work = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Completed July clean",
        status=MaintenanceWorkOrderStatus.completed,
        due_date=date(2026, 7, 18),
    )
    session.add_all([work_order, compliance_check, out_of_window_work, closed_work])
    session.commit()
    audit_count_before = session.scalar(select(func.count()).select_from(AuditAction))

    response = client.get(
        "/api/v1/calendar/events",
        params={
            "from": "2026-07-01",
            "to": "2026-07-31",
            "entity_id": str(entity.id),
        },
    )

    assert response.status_code == 200
    events = response.json()
    assert [event["type"] for event in events] == [
        "lease_expiry",
        "maintenance_due",
        "compliance_due",
    ]
    assert {event["title"] for event in events} == {
        "Calendar Plaza Suite 4 lease expiry",
        "Repair fire exit light",
        "Annual fire safety statement",
    }
    assert all(event["entity_id"] == str(entity.id) for event in events)
    assert events[0]["date"] == "2026-07-10"
    assert events[0]["severity"] == "warning"
    assert events[0]["source"] == {"table": "lease", "id": str(lease.id)}
    assert events[0]["link"].startswith("/properties?")
    assert events[1]["source"] == {"table": "maintenance_work_order", "id": str(work_order.id)}
    assert events[1]["link"] == f"/operations/maintenance/{work_order.id}"
    assert events[2]["source"] == {"table": "compliance_check", "id": str(compliance_check.id)}
    assert events[2]["link"] == f"/operations?tab=compliance#compliance-check-{compliance_check.id}"
    assert "August roof clean" not in {event["title"] for event in events}
    assert "Completed July clean" not in {event["title"] for event in events}
    assert session.scalar(select(func.count()).select_from(AuditAction)) == audit_count_before


def test_calendar_events_explicit_entity_scope_requires_entity_role(
    client: TestClient,
    session: Session,
) -> None:
    seeded = _entity(session)
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Calendar Trust")
    session.add(hidden)
    session.commit()

    response = client.get(
        "/api/v1/calendar/events",
        params={
            "from": "2026-07-01",
            "to": "2026-07-31",
            "entity_id": str(hidden.id),
        },
    )

    assert response.status_code == 403


def test_calendar_events_org_wide_scope_only_returns_readable_entities(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = _entity(session)
    accessible = Entity(organisation_id=seeded.organisation_id, name="Accessible Calendar Trust")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Calendar Trust")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    visible_prop, _, _, visible_lease = _lease_scope(session, accessible)
    hidden_prop, _, _, hidden_lease = _lease_scope(session, hidden)
    visible_lease.expiry_date = date(2026, 7, 20)
    hidden_lease.expiry_date = date(2026, 7, 21)
    visible_prop.name = "Visible Calendar Plaza"
    hidden_prop.name = "Hidden Calendar Plaza"
    session.commit()

    response = client.get(
        "/api/v1/calendar/events",
        params={"from": "2026-07-01", "to": "2026-07-31"},
    )

    assert response.status_code == 200
    titles = {event["title"] for event in response.json()}
    assert "Visible Calendar Plaza Suite 4 lease expiry" in titles
    assert "Hidden Calendar Plaza Suite 4 lease expiry" not in titles
