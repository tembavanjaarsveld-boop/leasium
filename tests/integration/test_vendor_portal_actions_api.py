"""Authenticated vendor portal action tests (accept / comment / photo)."""

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
    AuditAction,
    Contractor,
    Entity,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    PropertyType,
    StoredDocument,
    Tenant,
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
    with_secrets: bool = False,
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
    metadata: dict[str, object] = {
        "vendor_portal_visible": True,
        "vendor_portal_contractor_id": str(contractor.id),
        "vendor_portal_title": "Repair air conditioning",
    }
    kwargs: dict[str, object] = {}
    if with_secrets:
        tenant = Tenant(
            entity_id=entity.id,
            legal_name="Private Tenant Pty Ltd",
            contact_email="private-tenant@example.test",
        )
        session.add(tenant)
        session.flush()
        kwargs["tenant_id"] = tenant.id
        metadata["contractor_delivery"] = {
            "email": {"provider_message_id": "sendgrid-secret"}
        }
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
        work_order_metadata=metadata,
        **kwargs,
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
    with_secrets: bool = False,
) -> tuple[Contractor, MaintenanceWorkOrder]:
    app.dependency_overrides[get_settings] = _vendor_account_settings
    contractor = _seed_contractor(session)
    work_order = _seed_shared_work_order(
        session, contractor, status=status, with_secrets=with_secrets
    )
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


def test_accept_advances_assigned_job_to_in_progress(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(client, session, monkeypatch)

    response = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/accept",
        headers=BEARER,
    )

    assert response.status_code == 200, response.text
    item = response.json()["work_orders"]["items"][0]
    assert item["id"] == str(work_order.id)
    assert item["status"] == "in_progress"

    session.expire_all()
    refreshed = session.get(MaintenanceWorkOrder, work_order.id)
    assert refreshed is not None
    assert refreshed.status == MaintenanceWorkOrderStatus.in_progress
    metadata = refreshed.work_order_metadata
    assert metadata["vendor_portal_accepted_at"]
    assert metadata["comments"][-1]["visibility"] == "contractor"
    assert metadata["comments"][-1]["body"] == "Contractor accepted the job."
    assert metadata["activity_history"][-1]["event"] == "vendor_accepted"

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "maintenance_work_order",
            AuditAction.target_id == work_order.id,
            AuditAction.tool_name == "vendor_portal.account.accept",
        )
    )
    assert audit is not None
    assert audit.data_classification == "confidential"


def test_accept_on_awaiting_approval_records_without_status_change(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(
        client, session, monkeypatch, status=MaintenanceWorkOrderStatus.awaiting_approval
    )

    response = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/accept",
        headers=BEARER,
    )

    assert response.status_code == 200, response.text
    session.expire_all()
    refreshed = session.get(MaintenanceWorkOrder, work_order.id)
    assert refreshed is not None
    assert refreshed.status == MaintenanceWorkOrderStatus.awaiting_approval
    assert refreshed.work_order_metadata["vendor_portal_accepted_at"]


def test_accept_on_completed_job_returns_409(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(
        client, session, monkeypatch, status=MaintenanceWorkOrderStatus.completed
    )

    response = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/accept",
        headers=BEARER,
    )

    assert response.status_code == 409
    assert "completed or cancelled" in response.json()["detail"]


def test_comment_appends_contractor_visible_update(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(client, session, monkeypatch)

    response = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/comment",
        headers=BEARER,
        json={"body": "On my way, ETA 30 minutes."},
    )

    assert response.status_code == 200, response.text
    item = response.json()["work_orders"]["items"][0]
    last_comment = item["comments"][-1]
    assert last_comment["body"] == "On my way, ETA 30 minutes."
    assert last_comment["timestamp"]

    session.expire_all()
    refreshed = session.get(MaintenanceWorkOrder, work_order.id)
    assert refreshed is not None
    last_comment = refreshed.work_order_metadata["comments"][-1]
    assert last_comment["visibility"] == "contractor"
    assert last_comment["body"] == "On my way, ETA 30 minutes."
    assert refreshed.work_order_metadata["activity_history"][-1]["event"] == "vendor_comment"


def test_photo_upload_links_photo_and_rejects_non_image(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(client, session, monkeypatch)

    bad = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/photo",
        headers=BEARER,
        files={"file": ("note.txt", b"not an image", "text/plain")},
    )
    assert bad.status_code == 415

    response = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/photo",
        headers=BEARER,
        files={"file": ("job.jpg", b"\xff\xd8\xff\xe0 binary jpeg", "image/jpeg")},
    )

    assert response.status_code == 200, response.text
    item = response.json()["work_orders"]["items"][0]
    assert item["photo_count"] == 1

    session.expire_all()
    refreshed = session.get(MaintenanceWorkOrder, work_order.id)
    assert refreshed is not None
    assert len(refreshed.photo_document_ids) == 1
    document = session.scalar(
        select(StoredDocument).where(
            StoredDocument.entity_id == refreshed.entity_id,
            StoredDocument.property_id == refreshed.property_id,
        )
    )
    assert document is not None
    assert document.document_metadata["source"] == "vendor_portal_photo"
    assert document.content_type == "image/jpeg"
    assert refreshed.work_order_metadata["activity_history"][-1]["event"] == "vendor_photo_added"


def test_actions_reject_work_orders_not_shared_to_contractor(
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

    foreign = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{foreign_work_order.id}/accept",
        headers=BEARER,
    )
    assert foreign.status_code == 404

    unknown = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{uuid4()}/comment",
        headers=BEARER,
        json={"body": "Should not work."},
    )
    assert unknown.status_code == 404


def test_actions_require_bearer_token(
    client: TestClient,
    session: Session,
) -> None:
    response = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{uuid4()}/accept",
    )
    assert response.status_code == 401


def test_action_response_hides_tenant_and_provider_detail(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    _contractor, work_order = _setup_account(
        client, session, monkeypatch, with_secrets=True
    )

    response = client.post(
        f"/api/v1/vendor-portal/account/work-orders/{work_order.id}/accept",
        headers=BEARER,
    )

    assert response.status_code == 200, response.text
    text = response.text
    for fragment in [
        "Private Tenant Pty Ltd",
        "private-tenant@example.test",
        "Tenant says their directors",
        "Internal escalation note",
        "sendgrid-secret",
        "contractor_delivery",
        "tenant_id",
    ]:
        assert fragment not in text
