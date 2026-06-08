"""Work notification custom branded-template resolution tests.

Covers ticket 5 of editable comms templates v1: active custom branded template
rows change how Work notice and digest messages render (body + version) while
all review-first send guardrails stay untouched.
"""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import AppUser, BrandedCommunicationTemplate, Entity
from stewart.core.settings import get_settings


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _seed_custom_template(
    session: Session,
    *,
    entity_id: UUID,
    key: str,
    version: str = "v2",
    channel: str = "email",
    provider: str = "sendgrid",
    name: str = "Operator custom template",
    subject_template: str | None = None,
    body_template: str = "Hello {{assignee_name}}.",
) -> BrandedCommunicationTemplate:
    template = BrandedCommunicationTemplate(
        entity_id=entity_id,
        key=key,
        version=version,
        channel=channel,
        provider=provider,
        name=name,
        subject_template=subject_template,
        body_template=body_template,
        is_active=True,
        is_system=False,
        created_at=utcnow(),
        updated_at=utcnow(),
        template_metadata={},
    )
    session.add(template)
    session.commit()
    session.refresh(template)
    return template


def _create_assigned_work_order(
    client: TestClient,
    *,
    entity_id: str,
    title: str,
) -> str:
    settings = get_settings()
    response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": entity_id,
            "title": title,
            "status": "assigned",
            "due_date": "2026-06-12",
            "metadata": {
                "work_assignment": {
                    "assigned_user_id": str(settings.dev_user_id),
                    "assigned_user_name": settings.dev_user_name,
                    "assigned_user_email": settings.dev_user_email,
                    "notification": {
                        "channel": "in_app",
                        "provider": "leasium",
                        "status": "ready",
                        "recipient_email": settings.dev_user_email,
                        "template_key": "work_assignment_notification",
                        "template_version": "v1",
                    },
                    "history": [],
                }
            },
        },
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _notification_center_email_preview(
    client: TestClient,
    *,
    entity_id: str,
    work_order_id: str,
) -> dict[str, object]:
    response = client.get(
        "/api/v1/work-assignments/notification-center",
        params={"entity_id": entity_id},
    )
    assert response.status_code == 200, response.text
    notice = next(
        notice
        for notice in response.json()["notices"]
        if notice["target_id"] == work_order_id
    )
    email_receipt = next(
        receipt for receipt in notice["channel_receipts"] if receipt["channel"] == "email"
    )
    preview = email_receipt["rendered_message_preview"]
    assert preview is not None
    return preview


def test_notification_center_preview_uses_active_custom_template_body_and_version(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    settings = get_settings()
    _seed_custom_template(
        session,
        entity_id=UUID(entity_id),
        key="work_assignment_notification",
        version="v2",
        subject_template="Custom notice: {{title}}",
        body_template="Hello {{assignee_name}}, custom body for {{title}}.",
    )
    work_order_id = _create_assigned_work_order(
        client, entity_id=entity_id, title="Custom template notice job"
    )

    preview = _notification_center_email_preview(
        client, entity_id=entity_id, work_order_id=work_order_id
    )

    assert preview["subject"] == "Custom notice: Custom template notice job"
    assert preview["body_text"] == (
        f"Hello {settings.dev_user_name}, custom body for Custom template notice job."
    )
    assert preview["template_key"] == "work_assignment_notification"
    assert preview["template_version"] == "v2"


def test_notification_center_preview_falls_back_to_managed_default_without_custom_row(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    work_order_id = _create_assigned_work_order(
        client, entity_id=entity_id, title="Managed default notice job"
    )

    preview = _notification_center_email_preview(
        client, entity_id=entity_id, work_order_id=work_order_id
    )

    assert preview["subject"] == "Leasium work assigned: Managed default notice job"
    assert "Maintenance has been assigned to you in Leasium." in str(
        preview["body_text"]
    )
    assert preview["template_key"] == "work_assignment_notification"
    assert preview["template_version"] == "v1"


def test_digest_run_receipt_preview_uses_custom_digest_template(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    settings = get_settings()
    assignee = session.get(AppUser, settings.dev_user_id)
    assert assignee is not None
    assignee.notification_preferences = {
        "work_assignment_email_enabled": True,
        "work_assignment_digest_cadence": "daily",
    }
    session.commit()
    _seed_custom_template(
        session,
        entity_id=UUID(entity_id),
        key="work_assignment_digest",
        version="v2",
        subject_template="Custom digest for {{assignee_name}}: {{item_count}} items",
        body_template="Hi {{assignee_name}},\n\n{{items_block}}\n\nLeasium",
    )
    _create_assigned_work_order(
        client, entity_id=entity_id, title="Custom digest maintenance job"
    )

    response = client.post(
        "/api/v1/work-assignments/digests/run",
        json={"entity_id": entity_id, "cadence": "daily"},
    )

    assert response.status_code == 200, response.text
    run = response.json()
    assert run["operator_count"] == 1
    assert run["guardrails"][0].startswith("Digest generation is review-only")
    digest = run["digests"][0]
    assert digest["delivery_status"] == "previewed"
    assert digest["message_sent"] is False
    preview = digest["rendered_message_preview"]
    assert preview["subject"] == (
        f"Custom digest for {settings.dev_user_name}: 1 items"
    )
    assert preview["body_text"].startswith(f"Hi {settings.dev_user_name},")
    assert "- Custom digest maintenance job" in preview["body_text"]
    assert "  Type: Maintenance" in preview["body_text"]
    assert preview["template_key"] == "work_assignment_digest"
    assert preview["template_version"] == "v2"


def test_custom_template_does_not_bypass_send_guardrails(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    entity_id = _entity_id(session)
    settings = get_settings()
    assignee = session.get(AppUser, settings.dev_user_id)
    assert assignee is not None
    assignee.notification_preferences = {
        "work_assignment_email_enabled": True,
        "work_assignment_digest_cadence": "daily",
    }
    session.commit()
    _seed_custom_template(
        session,
        entity_id=UUID(entity_id),
        key="work_assignment_notification",
        version="v2",
        subject_template="Custom notice: {{title}}",
        body_template="Hello {{assignee_name}}, custom body.",
    )
    _seed_custom_template(
        session,
        entity_id=UUID(entity_id),
        key="work_assignment_digest",
        version="v2",
        body_template="Hi {{assignee_name}},\n\n{{items_block}}",
    )
    work_order_id = _create_assigned_work_order(
        client, entity_id=entity_id, title="Guardrail check job"
    )

    # Digest runs without explicit approval must never call the provider, even
    # with a custom template row resolved.
    def _fail_digest_send(invite: object, settings_arg: object) -> None:
        raise AssertionError("Digest email must not send without explicit approval.")

    monkeypatch.setattr(
        "apps.api.routers.work_assignment_notifications.send_work_assignment_digest_email",
        _fail_digest_send,
    )
    digest_response = client.post(
        "/api/v1/work-assignments/digests/run",
        json={"entity_id": entity_id, "cadence": "daily"},
    )
    assert digest_response.status_code == 200, digest_response.text
    digest = digest_response.json()["digests"][0]
    assert digest["delivery_status"] == "previewed"
    assert digest["message_sent"] is False
    assert digest["rendered_message_preview"]["template_version"] == "v2"

    # An explicit notice send with SendGrid unconfigured stays a skipped
    # receipt; the custom row only changes rendering metadata.
    send_response = client.post(
        "/api/v1/work-assignments/notification-center/notices/send-email",
        json={
            "entity_id": entity_id,
            "target_id": work_order_id,
            "target_type": "maintenance_work_order",
        },
    )
    assert send_response.status_code == 200, send_response.text
    body = send_response.json()
    assert body["status"] == "skipped"
    assert body["message_sent"] is False
    assert body["detail"] == "SendGrid is not configured."
    assert body["template_key"] == "work_assignment_notification"
    assert body["template_version"] == "v2"
