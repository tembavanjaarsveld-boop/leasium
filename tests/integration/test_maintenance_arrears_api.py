"""Maintenance work order and arrears API integration tests."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AppUser, AuditAction, Entity, MaintenanceWorkOrder, Organisation
from stewart.core.settings import get_settings
from stewart.integrations.communications import DeliveryResult


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _organisation_id(session: Session) -> str:
    organisation = session.scalar(select(Organisation).where(Organisation.name == "SKJ Capital"))
    assert organisation is not None
    return str(organisation.id)


def _lease_context(client: TestClient, session: Session) -> dict[str, str]:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Maintenance Plaza",
            "street_address": "44 Service Lane",
            "suburb": "Newstead",
            "state": "QLD",
            "postcode": "4006",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 3", "sqm": 85},
    )
    assert unit_response.status_code == 201
    tenancy_unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Maintenance Tenant Pty Ltd",
            "trading_name": "Maintenance Tenant",
            "billing_email": "billing@maintenant.example",
        },
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": tenancy_unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "annual_rent_cents": 9600000,
            "rent_frequency": "annual",
        },
    )
    assert lease_response.status_code == 201

    return {
        "entity_id": entity_id,
        "property_id": property_id,
        "tenancy_unit_id": tenancy_unit_id,
        "tenant_id": tenant_id,
        "lease_id": lease_response.json()["id"],
    }


def _upload_document(
    client: TestClient,
    *,
    entity_id: str,
    tenant_id: str | None = None,
    filename: str = "evidence.txt",
) -> str:
    data: dict[str, str] = {"entity_id": entity_id, "category": "other"}
    if tenant_id is not None:
        data["tenant_id"] = tenant_id
    response = client.post(
        "/api/v1/documents",
        data=data,
        files={"file": (filename, b"maintenance evidence", "text/plain")},
    )
    assert response.status_code == 201
    return str(response.json()["id"])


def test_maintenance_work_order_tracks_documents_assignment_and_approval(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)
    evidence_document_id = _upload_document(
        client,
        entity_id=context["entity_id"],
        tenant_id=context["tenant_id"],
        filename="tenant-request-photo.txt",
    )

    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Leaking air-conditioning unit",
            "description": "Tenant reported water pooling near the front counter.",
            "priority": "high",
            "status": "requested",
            "approval_required": True,
            "approval_status": "pending",
            "approval_limit_cents": 150000,
            "quote_amount_cents": 132500,
            "source_document_id": evidence_document_id,
            "document_ids": [evidence_document_id],
            "photo_document_ids": [evidence_document_id],
            "invoice_reference": "CON-4471",
            "invoice_amount_cents": 132500,
            "source_reference": "tenant-portal-req-72",
            "due_date": "2026-05-27",
            "metadata": {"intake": "tenant_request"},
        },
    )
    assert create_response.status_code == 201
    body = create_response.json()
    work_order_id = body["id"]
    assert body["property_id"] == context["property_id"]
    assert body["tenancy_unit_id"] == context["tenancy_unit_id"]
    assert body["tenant_id"] == context["tenant_id"]
    assert body["document_ids"] == [evidence_document_id]
    assert body["photo_document_ids"] == [evidence_document_id]
    assert body["metadata"]["intake"] == "tenant_request"
    assert body["metadata"]["activity_history"][0]["event"] == "created"
    assert body["metadata"]["activity_history"][0]["source"] == "operator_api"
    assert body["metadata"]["activity_history"][0]["status"] == "requested"

    update_response = client.patch(
        f"/api/v1/maintenance/work-orders/{work_order_id}",
        json={
            "status": "assigned",
            "contractor_name": "Rapid HVAC Pty Ltd",
            "contractor_email": "dispatch@rapidhvac.example",
            "contractor_assigned_at": "2026-05-20T10:30:00Z",
            "approval_status": "approved",
            "approved_by_user_id": str(get_settings().dev_user_id),
            "approved_at": "2026-05-20T10:45:00Z",
            "approval_notes": "Approved under emergency maintenance threshold.",
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["status"] == "assigned"
    assert updated["contractor_name"] == "Rapid HVAC Pty Ltd"
    assert updated["approval_status"] == "approved"
    assert updated["metadata"]["intake"] == "tenant_request"
    history = updated["metadata"]["activity_history"]
    assert [entry["event"] for entry in history] == ["created", "updated"]
    assert history[1]["source"] == "operator_api"
    assert history[1]["status"] == "assigned"
    assert history[1]["summary"] == (
        "Updated status, contractor, contractor email, contractor assigned date, "
        "approval status, and approval notes."
    )

    comment_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/comments",
        json={
            "body": "Contractor confirmed they can attend tomorrow morning.",
            "visibility": "contractor",
        },
    )
    assert comment_response.status_code == 200
    commented = comment_response.json()
    assert commented["metadata"]["comments"] == [
        {
            "timestamp": commented["metadata"]["comments"][0]["timestamp"],
            "actor": f"user:{get_settings().dev_user_email}",
            "visibility": "contractor",
            "body": "Contractor confirmed they can attend tomorrow morning.",
        }
    ]
    assert [entry["event"] for entry in commented["metadata"]["activity_history"]] == [
        "created",
        "updated",
        "comment_added",
    ]
    assert commented["metadata"]["activity_history"][2]["summary"] == (
        "Contractor confirmed they can attend tomorrow morning."
    )
    blank_comment_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/comments",
        json={"body": "   "},
    )
    assert blank_comment_response.status_code == 422

    list_response = client.get(
        "/api/v1/maintenance/work-orders",
        params={
            "entity_id": context["entity_id"],
            "property_id": context["property_id"],
            "status": "assigned",
        },
    )
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [work_order_id]

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "maintenance_work_order")
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update", "update"]


def test_maintenance_work_order_rejects_cross_entity_document_links(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)
    other_entity_response = client.post(
        "/api/v1/entities",
        json={"organisation_id": _organisation_id(session), "name": "Other Maintenance Entity"},
    )
    assert other_entity_response.status_code == 201
    other_document_id = _upload_document(
        client,
        entity_id=other_entity_response.json()["id"],
        filename="other-entity-evidence.txt",
    )

    response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Cross-entity evidence should fail",
            "source_document_id": other_document_id,
        },
    )
    assert response.status_code == 404


def test_maintenance_work_order_reopen_and_basic_edits_are_audited(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Completed water leak",
            "description": "Original closeout.",
            "priority": "normal",
            "status": "completed",
            "completed_at": "2026-05-20T08:00:00Z",
            "contractor_name": "Rapid Plumbing",
            "notes": "Closed after contractor attended.",
            "metadata": {
                "closeout": {
                    "note": "No further leak visible.",
                    "completed_at": "2026-05-20T08:00:00Z",
                }
            },
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    reopen_response = client.patch(
        f"/api/v1/maintenance/work-orders/{work_order_id}",
        json={
            "title": "Reopened water leak",
            "description": "Owner reported the leak returned after rain.",
            "status": "in_progress",
            "completed_at": None,
            "metadata": {
                "reopen_history": [
                    {
                        "reopened_at": "2026-05-21T01:00:00Z",
                        "reopened_from": "completed",
                        "previous_completed_at": "2026-05-20T08:00:00Z",
                        "reason": "Reopened from work-order detail.",
                    }
                ]
            },
        },
    )
    assert reopen_response.status_code == 200
    reopened = reopen_response.json()
    assert reopened["title"] == "Reopened water leak"
    assert reopened["description"] == "Owner reported the leak returned after rain."
    assert reopened["status"] == "in_progress"
    assert reopened["completed_at"] is None
    assert reopened["metadata"]["closeout"]["note"] == "No further leak visible."
    assert reopened["metadata"]["reopen_history"][0]["reopened_from"] == "completed"
    history = reopened["metadata"]["activity_history"]
    assert [entry["event"] for entry in history] == ["created", "updated"]
    assert history[1]["status"] == "in_progress"
    assert history[1]["summary"] == (
        "Updated title, description, status, and completed date."
    )

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "maintenance_work_order")
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update"]


def test_maintenance_work_order_sends_contractor_email_and_records_receipt(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    context = _lease_context(client, session)
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Replace shopfront lock",
            "description": "Tenant reported the rear lock is sticking.",
            "priority": "normal",
            "contractor_name": "Rapid Locksmiths",
            "contractor_email": "dispatch@rapidlocks.example",
            "status": "assigned",
            "due_date": "2026-05-28",
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    attempts: list[str] = []

    def fake_send_contractor_work_order_email(invite: Any, settings: Any) -> DeliveryResult:
        assert invite.contractor_email == "dispatch@rapidlocks.example"
        assert invite.subject == "Attendance window request"
        assert invite.body == "Please confirm your first available attendance window."
        assert settings.contractor_email_template_key == "maintenance_contractor_update"
        attempts.append(str(invite.work_order_id))
        if len(attempts) == 1:
            return DeliveryResult(
                channel="email",
                status="failed",
                provider="sendgrid",
                recipient=invite.contractor_email,
                provider_message_id="sg-maintenance-failed",
                error="SendGrid returned 500.",
            )
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            recipient=invite.contractor_email,
            provider_message_id="sg-maintenance-123",
        )

    monkeypatch.setattr(
        "apps.api.routers.maintenance.send_contractor_work_order_email",
        fake_send_contractor_work_order_email,
    )
    send_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/contractor-delivery/send-email",
        json={
            "subject": "Attendance window request",
            "body": "Please confirm your first available attendance window.",
        },
    )
    assert send_response.status_code == 200
    failed = send_response.json()
    failed_email_delivery = failed["metadata"]["contractor_delivery"]["email"]
    assert failed_email_delivery["send"]["status"] == "failed"
    assert failed_email_delivery["send"]["retry_count"] == 1
    assert failed_email_delivery["send"]["template_key"] == (
        "maintenance_contractor_update"
    )
    assert failed_email_delivery["send"]["template_version"] == "v1"
    assert failed_email_delivery["receipts"][0]["status"] == "failed"
    assert failed_email_delivery["receipts"][0]["retry_count"] == 1
    assert failed_email_delivery["receipts"][0]["template_key"] == (
        "maintenance_contractor_update"
    )
    assert failed_email_delivery["history"][0]["template_version"] == "v1"
    assert failed["metadata"].get("comments", []) == []

    retry_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/contractor-delivery/send-email",
        json={
            "subject": "Attendance window request",
            "body": "Please confirm your first available attendance window.",
        },
    )
    assert retry_response.status_code == 200
    sent = retry_response.json()
    email_delivery = sent["metadata"]["contractor_delivery"]["email"]
    assert email_delivery["send"]["status"] == "queued"
    assert email_delivery["send"]["provider"] == "sendgrid"
    assert email_delivery["send"]["provider_message_id"] == "sg-maintenance-123"
    assert email_delivery["send"]["retry_count"] == 2
    assert email_delivery["receipts"][0]["status"] == "queued"
    assert email_delivery["receipts"][0]["retry_count"] == 2
    assert email_delivery["receipts"][0]["template_version"] == "v1"
    assert email_delivery["receipts"][1]["status"] == "failed"
    assert email_delivery["receipts"][1]["retry_count"] == 1
    assert email_delivery["history"][1]["template_key"] == (
        "maintenance_contractor_update"
    )
    assert sent["metadata"]["comments"][-1]["visibility"] == "contractor"
    assert sent["metadata"]["comments"][-1]["body"] == (
        "Please confirm your first available attendance window."
    )
    assert sent["metadata"]["activity_history"][-1]["event"] == "contractor_email_attempted"

    receipt_response = client.post(
        "/api/v1/maintenance/work-orders/webhooks/sendgrid-events",
        json=[
            {
                "maintenance_work_order_id": work_order_id,
                "sg_message_id": "sg-maintenance-123",
                "event": "delivered",
                "email": "dispatch@rapidlocks.example",
            }
        ],
    )
    assert receipt_response.status_code == 204
    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    email_delivery = work_order.work_order_metadata["contractor_delivery"]["email"]
    assert email_delivery["send"]["status"] == "delivered"
    assert email_delivery["receipts"][0]["event"] == "delivered"
    assert email_delivery["receipts"][0]["retry_count"] == 2
    assert work_order.work_order_metadata["activity_history"][-1]["event"] == (
        "contractor_email_receipt"
    )


def test_maintenance_work_order_sends_assignment_notification_and_records_provider_attempt(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    context = _lease_context(client, session)
    settings = get_settings()
    assignment_metadata = {
        "work_assignment": {
            "assigned_user_id": str(settings.dev_user_id),
            "assigned_user_name": settings.dev_user_name,
            "assigned_user_email": settings.dev_user_email,
            "assigned_role": "owner",
            "assigned_at": "2026-05-20T00:00:00Z",
            "assigned_by_user_id": str(settings.dev_user_id),
            "assigned_by_name": settings.dev_user_name,
            "work_title": "Replace shopfront lock",
            "work_kind": "Maintenance",
            "notification": {
                "channel": "in_app",
                "provider": "leasium",
                "status": "ready",
                "recipient_email": settings.dev_user_email,
                "template_key": "work_assignment_notification",
                "template_version": "v1",
            },
            "history": [
                {
                    "event": "assigned",
                    "at": "2026-05-20T00:00:00Z",
                    "actor_name": settings.dev_user_name,
                    "assigned_user_name": settings.dev_user_name,
                    "assigned_user_email": settings.dev_user_email,
                    "notification_status": "ready",
                    "summary": "Maintenance assigned to Temba van Jaarsveld.",
                }
            ],
        }
    }
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Replace shopfront lock",
            "description": "Tenant reported the rear lock is sticking.",
            "priority": "normal",
            "status": "assigned",
            "due_date": "2026-05-28",
            "metadata": assignment_metadata,
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    attempts: list[str] = []

    def fake_send_work_assignment_email(invite: Any, settings_arg: Any) -> DeliveryResult:
        assert str(invite.target_id) == work_order_id
        assert invite.target_type == "maintenance_work_order"
        assert invite.entity_id == UUID(context["entity_id"])
        assert invite.work_kind == "Maintenance"
        assert invite.title == "Replace shopfront lock"
        assert invite.assignee_email == settings.dev_user_email
        assert invite.template_key == "work_assignment_notification"
        assert settings_arg.work_assignment_email_template_key == (
            "work_assignment_notification"
        )
        assert invite.work_url is None or invite.work_url.endswith(
            f"/operations/maintenance/{work_order_id}"
        )
        attempts.append(str(invite.target_id))
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            attempted_at="2026-05-20T01:15:00+00:00",
            recipient=invite.assignee_email,
            provider_message_id="sg-assignment-123",
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
            },
        )

    monkeypatch.setattr(
        "apps.api.routers.maintenance.send_work_assignment_email",
        fake_send_work_assignment_email,
    )

    send_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/assignment-notification/send-email"
    )
    assert send_response.status_code == 200
    assert attempts == [work_order_id]
    sent = send_response.json()
    assignment = sent["metadata"]["work_assignment"]
    notification = assignment["notification"]
    assert notification["status"] == "queued"
    assert notification["provider"] == "sendgrid"
    assert notification["provider_message_id"] == "sg-assignment-123"
    assert notification["recipient_email"] == settings.dev_user_email
    assert notification["template_key"] == "work_assignment_notification"
    assert notification["provider_history"][0]["event"] == (
        "provider_notification_attempted"
    )
    assert assignment["history"][0]["event"] == "provider_notification_attempted"
    assert assignment["history"][0]["notification_status"] == "queued"

    receipt_response = client.post(
        "/api/v1/work-assignments/webhooks/sendgrid-events",
        json=[
            {
                "work_assignment_target_id": work_order_id,
                "work_assignment_target_type": "maintenance_work_order",
                "sg_message_id": "sg-assignment-123",
                "event": "delivered",
                "email": settings.dev_user_email,
            }
        ],
    )
    assert receipt_response.status_code == 204
    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    assignment = work_order.work_order_metadata["work_assignment"]
    notification = assignment["notification"]
    assert notification["status"] == "delivered"
    assert notification["last_event"] == "delivered"
    assert notification["provider_history"][0]["event"] == (
        "provider_notification_receipt"
    )
    assert assignment["history"][0]["event"] == "provider_notification_receipt"
    assert assignment["history"][0]["notification_status"] == "delivered"

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "maintenance_work_order")
    ).all()
    assert [row.action for row in audit_rows[-2:]] == ["deliver", "receipt"]
    assert [row.tool_name for row in audit_rows[-2:]] == [
        "sendgrid.work_assignment",
        "sendgrid.work_assignment_event_webhook",
    ]


def test_maintenance_assignment_notification_respects_operator_email_preference(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    context = _lease_context(client, session)
    settings = get_settings()
    assignee = session.get(AppUser, settings.dev_user_id)
    assert assignee is not None
    assignee.notification_preferences = {"work_assignment_email_enabled": False}
    session.commit()

    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Preference blocked notice",
            "status": "assigned",
            "metadata": {
                "work_assignment": {
                    "assigned_user_id": str(settings.dev_user_id),
                    "assigned_user_name": settings.dev_user_name,
                    "assigned_user_email": settings.dev_user_email,
                    "work_title": "Preference blocked notice",
                    "work_kind": "Maintenance",
                    "notification": {
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
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    def fake_send_work_assignment_email(invite: Any, settings_arg: Any) -> DeliveryResult:
        raise AssertionError("Work assignment email should respect disabled preference.")

    monkeypatch.setattr(
        "apps.api.routers.maintenance.send_work_assignment_email",
        fake_send_work_assignment_email,
    )

    send_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/assignment-notification/send-email"
    )
    assert send_response.status_code == 200
    notification = send_response.json()["metadata"]["work_assignment"]["notification"]
    assert notification["status"] == "skipped"
    assert notification["error"] == "Assignment email disabled by operator preference."


def test_arrears_case_tracks_aged_balances_reminders_and_escalation(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)

    create_payload: dict[str, Any] = {
        "entity_id": context["entity_id"],
        "lease_id": context["lease_id"],
        "tenant_id": context["tenant_id"],
        "as_of": "2026-05-20",
        "balance_current_cents": 120000,
        "balance_1_30_cents": 45000,
        "balance_31_60_cents": 25000,
        "balance_61_90_cents": 10000,
        "reminder_stage": 2,
        "reminder_frequency_days": 7,
        "next_reminder_on": "2026-05-22",
        "dispute_status": "raised",
        "dispute_notes": "Tenant queried May outgoings.",
        "promise_to_pay_date": "2026-05-31",
        "promise_to_pay_amount_cents": 80000,
        "promise_to_pay_notes": "Tenant promised partial payment after payroll.",
        "escalation_status": "queued",
        "escalation_queue": "finance_review",
        "source_reference": "xero-aged-receivables-2026-05-20",
        "metadata": {"source": "manual_import"},
    }
    create_response = client.post("/api/v1/arrears/cases", json=create_payload)
    assert create_response.status_code == 201
    body = create_response.json()
    arrears_case_id = body["id"]
    assert body["property_id"] == context["property_id"]
    assert body["tenancy_unit_id"] == context["tenancy_unit_id"]
    assert body["total_balance_cents"] == 200000
    assert body["dispute_status"] == "raised"
    assert body["escalation_status"] == "queued"

    update_response = client.patch(
        f"/api/v1/arrears/cases/{arrears_case_id}",
        json={
            "balance_1_30_cents": 25000,
            "dispute_status": "under_review",
            "escalation_status": "in_progress",
            "assigned_user_id": str(get_settings().dev_user_id),
            "notes": "Finance reviewing after tenant supplied remittance advice.",
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["balance_1_30_cents"] == 25000
    assert updated["total_balance_cents"] == 180000
    assert updated["dispute_status"] == "under_review"
    assert updated["escalation_status"] == "in_progress"

    list_response = client.get(
        "/api/v1/arrears/cases",
        params={
            "entity_id": context["entity_id"],
            "tenant_id": context["tenant_id"],
            "escalation_status": "in_progress",
        },
    )
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [arrears_case_id]

    delete_response = client.delete(f"/api/v1/arrears/cases/{arrears_case_id}")
    assert delete_response.status_code == 204
    filtered_response = client.get(
        "/api/v1/arrears/cases",
        params={"entity_id": context["entity_id"], "tenant_id": context["tenant_id"]},
    )
    assert filtered_response.status_code == 200
    assert filtered_response.json() == []

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "arrears_case")
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update", "delete"]
