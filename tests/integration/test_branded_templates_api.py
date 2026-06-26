"""Branded communication template API tests (reads, CRUD, versioning, preview)."""

from datetime import date
from uuid import UUID, uuid4

from apps.api.routers.branded_templates import seed_system_branded_templates
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditAction,
    BrandedCommunicationTemplate,
    Entity,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import get_settings
from stewart.integrations.communications import (
    WorkAssignmentEmail,
    render_template_string,
    render_work_assignment_email_preview,
    work_assignment_email_context,
)


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
    subject_template: str | None = "New Relby work assigned",
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


SYSTEM_SEED_KEYS = {
    "work_assignment_notification",
    "work_assignment_follow_up",
    "work_assignment_digest",
    "work_assignment_digest_owner_review",
}


def test_seeded_system_templates_exist_for_demo_entity(
    client: TestClient,
    session: Session,
) -> None:
    entity_id_str = _entity_id(session)
    entity_id = UUID(entity_id_str)

    created = seed_system_branded_templates(session, entity_id)
    session.commit()
    assert {template.key for template in created} == SYSTEM_SEED_KEYS

    # Insert-if-missing: a second run seeds nothing.
    assert seed_system_branded_templates(session, entity_id) == []
    session.commit()

    response = client.get(BASE, params={"entity_id": entity_id_str})
    assert response.status_code == 200
    seeded = [row for row in response.json() if row["key"] in SYSTEM_SEED_KEYS]
    assert {row["key"] for row in seeded} == SYSTEM_SEED_KEYS
    for row in seeded:
        assert row["version"] == "v1"
        assert row["channel"] == "email"
        assert row["provider"] == "sendgrid"
        assert row["is_system"] is True
        assert row["is_active"] is True
        assert "{{" in row["body_template"]


def test_seeded_notice_template_renders_identical_to_managed_default(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = UUID(_entity_id(session))
    seed_system_branded_templates(session, entity_id)
    session.commit()

    seeded = session.scalar(
        select(BrandedCommunicationTemplate).where(
            BrandedCommunicationTemplate.entity_id == entity_id,
            BrandedCommunicationTemplate.key == "work_assignment_notification",
            BrandedCommunicationTemplate.version == "v1",
        )
    )
    assert seeded is not None
    assert seeded.subject_template is not None

    invite = WorkAssignmentEmail(
        target_id=uuid4(),
        target_type="maintenance_work_order",
        entity_id=entity_id,
        work_kind="Maintenance",
        title="Replace shopfront lock",
        description="Rear lock is sticking.",
        due_date=date(2026, 6, 12),
        assignee_name="Avery Operator",
        assignee_email="avery.operator@example.com",
        assigned_by_name="Temba van Jaarsveld",
        work_url="https://relby.ai/operations/maintenance/test",
        template_key="work_assignment_notification",
        template_version="v1",
    )
    managed = render_work_assignment_email_preview(invite)
    context = work_assignment_email_context(invite)

    assert render_template_string(seeded.subject_template, context) == managed.subject
    assert render_template_string(seeded.body_template, context) == managed.body_text


def test_save_version_creates_new_active_version_and_deactivates_prior(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    created = client.post(BASE, json=_create_payload(entity_id)).json()

    response = client.post(
        f"{BASE}/{created['id']}/versions",
        json={"body_template": "Updated body copy for v2.", "notes": "Second pass."},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["version"] == "v2"
    assert body["key"] == created["key"]
    assert body["is_active"] is True
    assert body["is_system"] is False
    assert body["body_template"] == "Updated body copy for v2."
    assert body["notes"] == "Second pass."
    # Omitted fields inherit the source row.
    assert body["subject_template"] == created["subject_template"]
    assert body["name"] == created["name"]
    assert body["created_by_user_id"]
    assert body["updated_by_user_id"]

    prior = client.get(f"{BASE}/{created['id']}").json()
    assert prior["is_active"] is False
    assert prior["deleted_at"] is None
    assert prior["updated_by_user_id"]

    active = client.get(BASE, params={"entity_id": entity_id}).json()
    active_versions = [row["version"] for row in active if row["key"] == created["key"]]
    assert active_versions == ["v2"]

    audit = session.scalar(
        select(AuditAction).where(AuditAction.tool_name == "branded_template.save_version")
    )
    assert audit is not None
    assert "does not send any message" in (audit.tool_output_summary or "")


def test_save_version_preserves_full_history_via_include_inactive(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    created = client.post(BASE, json=_create_payload(entity_id)).json()

    second = client.post(
        f"{BASE}/{created['id']}/versions",
        json={"body_template": "Body copy v2."},
    )
    assert second.status_code == 201, second.text
    third = client.post(
        f"{BASE}/{second.json()['id']}/versions",
        json={"body_template": "Body copy v3."},
    )
    assert third.status_code == 201, third.text
    assert third.json()["version"] == "v3"

    history = client.get(
        BASE,
        params={"entity_id": entity_id, "include_inactive": True},
    ).json()
    versions = sorted(row["version"] for row in history if row["key"] == created["key"])
    assert versions == ["v1", "v2", "v3"]

    active = client.get(BASE, params={"entity_id": entity_id}).json()
    active_versions = [row["version"] for row in active if row["key"] == created["key"]]
    assert active_versions == ["v3"]


def test_save_version_on_system_template_creates_operator_row_and_keeps_system_row(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = UUID(_entity_id(session))
    system = _seed_template(session, entity_id=entity_id, is_system=True)

    response = client.post(
        f"{BASE}/{system.id}/versions",
        json={"body_template": "Operator-edited body."},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["version"] == "v2"
    assert body["is_system"] is False
    assert body["is_active"] is True

    session.refresh(system)
    assert system.is_system is True
    assert system.is_active is False
    assert system.deleted_at is None


def test_save_version_requires_entity_write_role(
    client: TestClient,
    session: Session,
) -> None:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    settings = get_settings()
    viewer_entity = Entity(
        organisation_id=entity.organisation_id, name="Viewer Only Pty Ltd"
    )
    session.add(viewer_entity)
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=viewer_entity.id,
            role=UserRole.viewer,
        )
    )
    session.commit()
    template = _seed_template(
        session, entity_id=viewer_entity.id, key="invoice_delivery", is_system=False
    )

    response = client.post(
        f"{BASE}/{template.id}/versions",
        json={"body_template": "Viewer should not be able to save versions."},
    )

    assert response.status_code == 403


def test_render_preview_returns_sample_rendered_subject_body(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    response = client.post(
        f"{BASE}/render-preview",
        json={
            "entity_id": entity_id,
            "key": "work_assignment_notification",
            "channel": "email",
            "subject_template": "Notice: {{title}}",
            "body_template": (
                "Hi {{assignee_name}}, due {{due_date}}. {{unknown_token}} stays."
            ),
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["subject"] == "Notice: Replace shopfront lock"
    assert body["body"] == "Hi Avery Operator, due 12 Jun 2026. {{unknown_token}} stays."
    assert body["guardrails"][0].startswith("Render preview is review-only")


def test_render_preview_is_review_only_persists_nothing(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    template_count_before = session.scalar(
        select(func.count()).select_from(BrandedCommunicationTemplate)
    )
    audit_count_before = session.scalar(select(func.count()).select_from(AuditAction))

    response = client.post(
        f"{BASE}/render-preview",
        json={
            "entity_id": entity_id,
            "key": "work_assignment_digest",
            "channel": "email",
            "body_template": "Hi {{assignee_name}},\n\n{{items_block}}",
        },
    )

    assert response.status_code == 200, response.text
    assert "Replace shopfront lock" in response.json()["body"]
    template_count_after = session.scalar(
        select(func.count()).select_from(BrandedCommunicationTemplate)
    )
    audit_count_after = session.scalar(select(func.count()).select_from(AuditAction))
    assert template_count_after == template_count_before
    assert audit_count_after == audit_count_before


def test_render_preview_requires_entity_read_role(
    client: TestClient,
    session: Session,
) -> None:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    other = Entity(organisation_id=entity.organisation_id, name="No Read Access Pty Ltd")
    session.add(other)
    session.commit()

    response = client.post(
        f"{BASE}/render-preview",
        json={
            "entity_id": str(other.id),
            "key": "work_assignment_notification",
            "channel": "email",
            "body_template": "Hi {{assignee_name}}.",
        },
    )

    assert response.status_code == 403
