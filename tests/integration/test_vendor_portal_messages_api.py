"""Vendor portal messaging tests (author attribution + bearer-scoped thread)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from apps.api.main import app
from apps.api.routers import vendor_portal as vendor_portal_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.auth import ClerkIdentity
from stewart.core.models import (
    Contractor,
    Entity,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    PropertyType,
)
from stewart.core.settings import Settings, get_settings

BEARER = {"Authorization": "Bearer vendor-subject-one"}


def _vendor_account_settings() -> Settings:
    return get_settings().model_copy(update={"clerk_allow_legacy_token_mapping": True})


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _seed_contractor(session: Session) -> Contractor:
    contractor = Contractor(
        entity_id=_entity(session).id,
        name="Rapid HVAC",
        company_name="Rapid HVAC Pty Ltd",
        categories=["hvac"],
        email="contractor@example.test",
        phone="+61 400 111 222",
        priority=1,
    )
    session.add(contractor)
    session.commit()
    return contractor


def _seed_shared_work_order(
    session: Session,
    contractor: Contractor,
    *,
    status: MaintenanceWorkOrderStatus = MaintenanceWorkOrderStatus.assigned,
) -> MaintenanceWorkOrder:
    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Queen Street Retail Centre",
        street_address="101 Queen Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Private Tenant Pty Ltd boardroom HVAC failure",
        description="Tenant says their directors are arriving at 10am.",
        status=status,
        priority=MaintenancePriority.urgent,
        requested_at=datetime(2026, 6, 1, 1, 30, tzinfo=UTC),
        contractor_email="contractor@example.test",
        due_date=date(2026, 6, 7),
        notes="Internal escalation note must stay private.",
        work_order_metadata={
            "vendor_portal_visible": True,
            "vendor_portal_contractor_id": str(contractor.id),
            "vendor_portal_title": "Repair air conditioning",
        },
    )
    session.add(work_order)
    session.commit()
    return work_order


def _setup_account(
    client: TestClient,
    session: Session,
    monkeypatch,
    *,
    status: MaintenanceWorkOrderStatus = MaintenanceWorkOrderStatus.assigned,
) -> tuple[Contractor, MaintenanceWorkOrder]:
    app.dependency_overrides[get_settings] = _vendor_account_settings
    contractor = _seed_contractor(session)
    work_order = _seed_shared_work_order(session, contractor, status=status)
    invite = client.post(f"/api/v1/vendor-portal/{contractor.id}/invite")
    assert invite.status_code == 201, invite.text

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        return ClerkIdentity(
            provider_id="vendor-subject-one",
            verified_email="contractor@example.test",
        )

    monkeypatch.setattr(vendor_portal_router, "_vendor_portal_identity", fake_identity)
    claim = client.post(
        "/api/v1/vendor-portal/account/claim",
        headers=BEARER,
        json={"portal_token": invite.json()["portal_token"]},
    )
    assert claim.status_code == 200, claim.text
    return contractor, work_order


def _operator_comment(
    client: TestClient,
    work_order: MaintenanceWorkOrder,
    body: str,
    *,
    visibility: str = "contractor",
) -> None:
    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order.id}/comments",
        json={"body": body, "visibility": visibility},
    )
    assert response.status_code == 200, response.text


def _contractor_comment(
    client: TestClient,
    work_order: MaintenanceWorkOrder,
    body: str,
) -> None:
    response = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/comment",
        headers=BEARER,
        json={"body": body},
    )
    assert response.status_code == 200, response.text


def test_session_thread_attributes_messages_to_contractor_and_property_team(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(client, session, monkeypatch)
    _operator_comment(client, work_order, "Tenant has confirmed access for tomorrow.")
    _contractor_comment(client, work_order, "On my way, ETA 30 minutes.")

    response = client.get("/api/v1/vendor-portal/account/session", headers=BEARER)

    assert response.status_code == 200, response.text
    item = response.json()["work_orders"]["items"][0]
    assert item["id"] == str(work_order.id)
    comments = item["comments"]
    assert [comment["body"] for comment in comments] == [
        "Tenant has confirmed access for tomorrow.",
        "On my way, ETA 30 minutes.",
    ]
    assert comments[0]["author"] == "property_team"
    assert comments[0]["author_label"] == "Property team"
    assert comments[1]["author"] == "contractor"
    assert comments[1]["author_label"] == "Rapid HVAC Pty Ltd"


def test_session_thread_never_leaks_operator_actor_identity(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(client, session, monkeypatch)
    _operator_comment(client, work_order, "Tenant has confirmed access for tomorrow.")

    response = client.get("/api/v1/vendor-portal/account/session", headers=BEARER)

    assert response.status_code == 200, response.text
    operator_email = get_settings().dev_user_email
    assert operator_email not in response.text
    assert f"user:{operator_email}" not in response.text


def test_internal_and_tenant_comments_stay_out_of_contractor_thread(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(client, session, monkeypatch)
    _operator_comment(
        client, work_order, "Internal: quote looks padded.", visibility="internal"
    )
    _operator_comment(
        client, work_order, "Tenant note: please keep the dog inside.", visibility="tenant"
    )
    _operator_comment(client, work_order, "Contractor: gate code is 4421.")

    response = client.get("/api/v1/vendor-portal/account/session", headers=BEARER)

    assert response.status_code == 200, response.text
    item = response.json()["work_orders"]["items"][0]
    assert [comment["body"] for comment in item["comments"]] == [
        "Contractor: gate code is 4421."
    ]
    assert "Internal: quote looks padded." not in response.text
    assert "Tenant note: please keep the dog inside." not in response.text


def test_get_messages_returns_thread_for_shared_work_order(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(client, session, monkeypatch)
    _operator_comment(client, work_order, "Tenant has confirmed access for tomorrow.")
    _contractor_comment(client, work_order, "On my way, ETA 30 minutes.")

    response = client.get(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/messages",
        headers=BEARER,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["work_order_id"] == str(work_order.id)
    assert payload["title"] == "Repair air conditioning"
    assert payload["generated_at"]
    messages = payload["messages"]
    assert [message["body"] for message in messages] == [
        "Tenant has confirmed access for tomorrow.",
        "On my way, ETA 30 minutes.",
    ]
    assert messages[0]["author"] == "property_team"
    assert messages[0]["author_label"] == "Property team"
    assert messages[0]["timestamp"]
    assert messages[1]["author"] == "contractor"
    assert messages[1]["author_label"] == "Rapid HVAC Pty Ltd"
    assert messages[1]["timestamp"]
    assert any("no email or SMS" in guardrail for guardrail in payload["guardrails"])


def test_get_messages_returns_404_for_unshared_or_unknown_work_order(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, _work_order = _setup_account(client, session, monkeypatch)
    entity = _entity(session)
    prop = session.scalar(select(Property).where(Property.entity_id == entity.id))
    assert prop is not None
    other_contractor_id = uuid4()
    foreign_work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Job for a different contractor",
        status=MaintenanceWorkOrderStatus.assigned,
        priority=MaintenancePriority.normal,
        work_order_metadata={
            "vendor_portal_visible": True,
            "vendor_portal_contractor_id": str(other_contractor_id),
            "vendor_portal_title": "Not yours",
        },
    )
    session.add(foreign_work_order)
    session.commit()

    foreign = client.get(
        f"/api/v1/vendor-portal/account/work-orders/{foreign_work_order.id}/messages",
        headers=BEARER,
    )
    assert foreign.status_code == 404

    unknown = client.get(
        f"/api/v1/vendor-portal/account/work-orders/{uuid4()}/messages",
        headers=BEARER,
    )
    assert unknown.status_code == 404


def test_get_messages_requires_bearer_token(
    client: TestClient,
    session: Session,
) -> None:
    response = client.get(
        f"/api/v1/vendor-portal/account/work-orders/{uuid4()}/messages",
    )
    assert response.status_code == 401
