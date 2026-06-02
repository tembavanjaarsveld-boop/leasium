"""Branded communication template read-only API tests."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import BrandedCommunicationTemplate, Entity


def _entity_id(session: Session) -> str:
    entity = session.scalar(
        select(Entity).where(Entity.name == "SKJ Property Pty Ltd")
    )
    assert entity is not None
    return str(entity.id)


def _seed_template(
    session: Session,
    *,
    entity_id: UUID,
    key: str = "work_assignment_notification",
    version: str = "v1",
    channel: str = "email",
    provider: str = "sendgrid",
    name: str = "Standard assignment notice",
    body_template: str = "Hi {{assignee_name}}, you have a new work item.",
    subject_template: str | None = "New Leasium work assigned",
    is_active: bool = True,
    is_system: bool = True,
) -> BrandedCommunicationTemplate:
    template = BrandedCommunicationTemplate(
        entity_id=entity_id,
        key=key,
        version=version,
        channel=channel,
        provider=provider,
        name=name,
        body_template=body_template,
        subject_template=subject_template,
        is_active=is_active,
        is_system=is_system,
        created_at=utcnow(),
        updated_at=utcnow(),
        template_metadata={},
    )
    session.add(template)
    session.commit()
    session.refresh(template)
    return template


def test_branded_templates_list_returns_active_entries_for_entity(
    client: TestClient,
    session: Session,
) -> None:
    entity_id_str = _entity_id(session)
    entity_id = UUID(entity_id_str)
    active = _seed_template(session, entity_id=entity_id, name="Active template")
    inactive = _seed_template(
        session,
        entity_id=entity_id,
        key="invoice_delivery",
        version="v1",
        name="Disabled template",
        is_active=False,
    )

    response = client.get(
        "/api/v1/branded-communication-templates",
        params={"entity_id": entity_id_str},
    )
    assert response.status_code == 200
    body = response.json()
    ids = {row["id"] for row in body}
    assert str(active.id) in ids
    # Inactive templates are excluded by default
    assert str(inactive.id) not in ids

    # Including inactive returns both
    include_response = client.get(
        "/api/v1/branded-communication-templates",
        params={"entity_id": entity_id_str, "include_inactive": True},
    )
    assert include_response.status_code == 200
    include_ids = {row["id"] for row in include_response.json()}
    assert str(active.id) in include_ids
    assert str(inactive.id) in include_ids


def test_branded_template_detail_returns_full_payload(
    client: TestClient,
    session: Session,
) -> None:
    entity_id_str = _entity_id(session)
    entity_id = UUID(entity_id_str)
    template = _seed_template(
        session,
        entity_id=entity_id,
        key="maintenance_contractor_update",
        version="v1",
        channel="email",
        provider="sendgrid",
        name="Contractor update",
        subject_template="Maintenance update for {{property_name}}",
        body_template="Hi {{contractor_name}}, please update us on the job.",
    )

    response = client.get(
        f"/api/v1/branded-communication-templates/{template.id}"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(template.id)
    assert body["key"] == "maintenance_contractor_update"
    assert body["subject_template"] == (
        "Maintenance update for {{property_name}}"
    )
    assert body["body_template"].startswith("Hi {{contractor_name}}")
    assert body["channel"] == "email"
    assert body["provider"] == "sendgrid"
    assert body["is_system"] is True
    assert body["metadata"] == {}


def test_branded_template_detail_returns_404_for_missing(
    client: TestClient,
    session: Session,
) -> None:
    # An arbitrary UUID that does not exist
    response = client.get(
        "/api/v1/branded-communication-templates/00000000-0000-0000-0000-000000000000"
    )
    assert response.status_code == 404


BASE = "/api/v1/branded-communication-templates"


def _create_payload(entity_id: str, **overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "entity_id": entity_id,
        "key": "invoice_delivery",
        "version": "v1",
        "channel": "email",
        "provider": "sendgrid",
        "name": "Invoice delivery",
        "subject_template": "Your invoice {{invoice_number}}",
        "body_template": "Hi {{tenant_name}}, your invoice is attached.",
        "notes": "Operator override.",
    }
    base.update(overrides)
    return base


def test_operator_can_create_and_list_branded_template(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    resp = client.post(BASE, json=_create_payload(entity_id))

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["key"] == "invoice_delivery"
    assert body["channel"] == "email"
    assert body["is_system"] is False
    assert body["created_by_user_id"]
    assert body["body_template"].startswith("Hi ")

    listed = client.get(BASE, params={"entity_id": entity_id})
    assert listed.status_code == 200, listed.text
    assert any(item["id"] == body["id"] for item in listed.json())


def test_branded_template_duplicate_active_conflicts(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    first = client.post(BASE, json=_create_payload(entity_id))
    assert first.status_code == 201, first.text

    duplicate = client.post(BASE, json=_create_payload(entity_id))
    assert duplicate.status_code == 409

    other_version = client.post(BASE, json=_create_payload(entity_id, version="v2"))
    assert other_version.status_code == 201, other_version.text


def test_branded_template_update_persists_edits(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    created = client.post(BASE, json=_create_payload(entity_id)).json()

    patched = client.patch(
        f"{BASE}/{created['id']}",
        json={"name": "Updated invoice delivery", "body_template": "New body copy."},
    )

    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["name"] == "Updated invoice delivery"
    assert body["body_template"] == "New body copy."


def test_branded_template_delete_soft_and_system_block(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    created = client.post(BASE, json=_create_payload(entity_id)).json()

    deleted = client.delete(f"{BASE}/{created['id']}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted_at"] is not None

    listed = client.get(BASE, params={"entity_id": entity_id})
    assert all(item["id"] != created["id"] for item in listed.json())

    system = _seed_template(
        session,
        entity_id=UUID(entity_id),
        key="system_only_template",
        is_system=True,
    )
    blocked = client.delete(f"{BASE}/{system.id}")
    assert blocked.status_code == 409


def test_branded_template_writes_require_entity_access(
    client: TestClient,
    session: Session,
) -> None:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    other = Entity(organisation_id=entity.organisation_id, name="No Access Pty Ltd")
    session.add(other)
    session.commit()

    create = client.post(BASE, json=_create_payload(str(other.id)))
    assert create.status_code == 403

    foreign = _seed_template(session, entity_id=other.id, key="invoice_delivery")
    patch = client.patch(f"{BASE}/{foreign.id}", json={"name": "nope"})
    assert patch.status_code == 403
