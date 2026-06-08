"""Maintenance work order and arrears API integration tests."""

import base64
import hashlib
import hmac
from typing import Any
from uuid import UUID

from apps.api.routers import maintenance as maintenance_router
from apps.api.routers import work_assignment_notifications as work_assignment_router
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


def _twilio_signature(url: str, data: dict[str, str], auth_token: str) -> str:
    payload = url + "".join(f"{key}{data[key]}" for key in sorted(data))
    digest = hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


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
    assert history[1]["summary"] == ("Updated title, description, status, and completed date.")

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
    assert failed_email_delivery["send"]["template_key"] == ("maintenance_contractor_update")
    assert failed_email_delivery["send"]["template_version"] == "v1"
    assert failed_email_delivery["receipts"][0]["status"] == "failed"
    assert failed_email_delivery["receipts"][0]["retry_count"] == 1
    assert failed_email_delivery["receipts"][0]["template_key"] == ("maintenance_contractor_update")
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
    assert email_delivery["history"][1]["template_key"] == ("maintenance_contractor_update")
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


def test_maintenance_sendgrid_receipt_requires_configured_secret(
    client: TestClient,
    monkeypatch,
) -> None:
    settings = maintenance_router.get_settings()
    monkeypatch.setattr(
        maintenance_router,
        "get_settings",
        lambda: settings.model_copy(update={"communications_webhook_secret": "sg-secret"}),
    )

    missing_response = client.post(
        "/api/v1/maintenance/work-orders/webhooks/sendgrid-events",
        json=[],
    )
    assert missing_response.status_code == 401
    assert missing_response.json()["detail"] == "Invalid webhook token."

    accepted_response = client.post(
        "/api/v1/maintenance/work-orders/webhooks/sendgrid-events",
        headers={"x-leasium-webhook-secret": "sg-secret"},
        json=[],
    )
    assert accepted_response.status_code == 204


def test_maintenance_work_order_sends_contractor_sms_and_records_receipt(
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
            "contractor_phone": "+61400111222",
            "status": "assigned",
            "due_date": "2026-05-28",
            "metadata": {
                "contractor_delivery": {
                    "email": {
                        "send": {
                            "status": "queued",
                            "provider": "sendgrid",
                            "recipient_email": "dispatch@rapidlocks.example",
                        }
                    }
                }
            },
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    attempts: list[str] = []

    def fake_send_contractor_work_order_sms(invite: Any, settings: Any) -> DeliveryResult:
        assert invite.contractor_phone == "+61400111222"
        assert invite.body == "Please text back your first available attendance window."
        assert invite.template_key == "maintenance_contractor_sms"
        assert settings.contractor_sms_template_key == "maintenance_contractor_sms"
        attempts.append(str(invite.work_order_id))
        if len(attempts) == 1:
            return DeliveryResult(
                channel="sms",
                status="failed",
                provider="twilio",
                recipient=invite.contractor_phone,
                provider_message_id="SM-maintenance-failed",
                error="Twilio returned 500.",
            )
        return DeliveryResult(
            channel="sms",
            status="queued",
            provider="twilio",
            recipient=invite.contractor_phone,
            provider_message_id="SM-maintenance-123",
        )

    monkeypatch.setattr(
        "apps.api.routers.maintenance.send_contractor_work_order_sms",
        fake_send_contractor_work_order_sms,
    )
    send_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/contractor-delivery/send-sms",
        json={"body": "Please text back your first available attendance window."},
    )
    assert send_response.status_code == 200
    failed = send_response.json()
    contractor_delivery = failed["metadata"]["contractor_delivery"]
    assert contractor_delivery["email"]["send"]["status"] == "queued"
    failed_sms_delivery = contractor_delivery["sms"]
    assert failed_sms_delivery["send"]["status"] == "failed"
    assert failed_sms_delivery["send"]["retry_count"] == 1
    assert failed_sms_delivery["send"]["template_key"] == "maintenance_contractor_sms"
    assert failed_sms_delivery["send"]["template_version"] == "v1"
    assert failed_sms_delivery["receipts"][0]["status"] == "failed"
    assert failed_sms_delivery["receipts"][0]["retry_count"] == 1
    assert failed["metadata"].get("comments", []) == []

    retry_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/contractor-delivery/send-sms",
        json={"body": "Please text back your first available attendance window."},
    )
    assert retry_response.status_code == 200
    sent = retry_response.json()
    sms_delivery = sent["metadata"]["contractor_delivery"]["sms"]
    assert sms_delivery["send"]["status"] == "queued"
    assert sms_delivery["send"]["provider"] == "twilio"
    assert sms_delivery["send"]["provider_message_id"] == "SM-maintenance-123"
    assert sms_delivery["send"]["retry_count"] == 2
    assert sms_delivery["receipts"][0]["status"] == "queued"
    assert sms_delivery["receipts"][0]["retry_count"] == 2
    assert sms_delivery["receipts"][0]["template_version"] == "v1"
    assert sms_delivery["receipts"][1]["status"] == "failed"
    assert sms_delivery["history"][1]["template_key"] == "maintenance_contractor_sms"
    assert sent["metadata"]["comments"][-1]["visibility"] == "contractor"
    assert sent["metadata"]["comments"][-1]["body"] == (
        "Please text back your first available attendance window."
    )
    assert sent["metadata"]["activity_history"][-1]["event"] == "contractor_sms_attempted"

    receipt_response = client.post(
        "/api/v1/maintenance/work-orders/webhooks/twilio-status",
        data={
            "MessageSid": "SM-maintenance-123",
            "MessageStatus": "delivered",
            "To": "+61400111222",
        },
    )
    assert receipt_response.status_code == 204
    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    sms_delivery = work_order.work_order_metadata["contractor_delivery"]["sms"]
    assert sms_delivery["send"]["status"] == "delivered"
    assert sms_delivery["receipts"][0]["event"] == "delivered"
    assert sms_delivery["receipts"][0]["retry_count"] == 2
    assert work_order.work_order_metadata["contractor_delivery"]["email"]["send"]["status"] == (
        "queued"
    )
    assert work_order.work_order_metadata["activity_history"][-1]["event"] == (
        "contractor_sms_receipt"
    )

    # MaintenanceWorkOrderRead exposes a normalised channel_receipts projection
    # over the contractor_delivery metadata so the work-order detail UI can
    # render the same per-channel evidence pattern that Work notices use.
    work_order_response = client.get(
        f"/api/v1/maintenance/work-orders/{work_order_id}",
    )
    assert work_order_response.status_code == 200
    work_order_body = work_order_response.json()
    channel_receipts = work_order_body["channel_receipts"]
    by_channel = {receipt["channel"]: receipt for receipt in channel_receipts}
    assert set(by_channel.keys()) == {"email", "sms"}

    email_receipt = by_channel["email"]
    assert email_receipt["label"] == "Contractor email"
    assert email_receipt["provider"] == "sendgrid"
    assert email_receipt["recipient_email"] == "dispatch@rapidlocks.example"
    assert email_receipt["template_key"] == "maintenance_contractor_update"
    assert email_receipt["template_version"] == "v1"
    assert email_receipt["delivery_attempt_count"] >= 1
    assert email_receipt["message_sent"] is True
    assert email_receipt["action_available"] is False
    assert any(
        entry.get("event") in {"provider_delivery_attempted", "contractor_email_attempted"}
        for entry in email_receipt["provider_history"]
    )

    sms_receipt = by_channel["sms"]
    assert sms_receipt["label"] == "Contractor SMS"
    assert sms_receipt["provider"] == "twilio"
    assert sms_receipt["recipient_phone"] == "+61400111222"
    assert sms_receipt["template_key"] == "maintenance_contractor_sms"
    assert sms_receipt["template_version"] == "v1"
    assert sms_receipt["delivery_attempt_count"] >= 1
    assert sms_receipt["message_sent"] is True
    assert sms_receipt["action_available"] is False


def test_maintenance_twilio_status_rejects_unsigned_when_token_configured(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Configured maintenance SMS callbacks must be signed before receipts move."""

    from apps.api.routers import maintenance as maintenance_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        maintenance_router,
        "get_settings",
        lambda: Settings(twilio_auth_token="twilio-secret"),
    )
    context = _lease_context(client, session)
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Unsigned contractor receipt",
            "status": "assigned",
            "metadata": {
                "contractor_delivery": {
                    "sms": {
                        "send": {
                            "status": "queued",
                            "provider": "twilio",
                            "provider_message_id": "SM-maintenance-unsigned",
                        },
                        "receipts": [],
                    }
                }
            },
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    response = client.post(
        "/api/v1/maintenance/work-orders/webhooks/twilio-status",
        data={
            "MessageSid": "SM-maintenance-unsigned",
            "MessageStatus": "delivered",
            "To": "+61400111222",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid Twilio webhook signature."
    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    sms_delivery = work_order.work_order_metadata["contractor_delivery"]["sms"]
    assert sms_delivery["send"]["status"] == "queued"
    assert sms_delivery["receipts"] == []


def test_maintenance_twilio_status_accepts_public_api_url_signature(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Production proxy URLs can validate signed maintenance SMS callbacks."""

    from apps.api.routers import maintenance as maintenance_router
    from stewart.core.settings import Settings

    auth_token = "twilio-secret"
    public_api_url = "https://api.leasium.test"
    monkeypatch.setattr(
        maintenance_router,
        "get_settings",
        lambda: Settings(public_api_url=public_api_url, twilio_auth_token=auth_token),
    )
    context = _lease_context(client, session)
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Signed contractor receipt",
            "status": "assigned",
            "metadata": {
                "contractor_delivery": {
                    "sms": {
                        "send": {
                            "status": "queued",
                            "provider": "twilio",
                            "provider_message_id": "SM-maintenance-signed",
                        },
                        "receipts": [],
                    }
                }
            },
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]
    data = {
        "MessageSid": "SM-maintenance-signed",
        "MessageStatus": "delivered",
        "To": "+61400111222",
    }
    url = f"{public_api_url}/api/v1/maintenance/work-orders/webhooks/twilio-status"
    signature = _twilio_signature(url, data, auth_token)

    response = client.post(
        "/api/v1/maintenance/work-orders/webhooks/twilio-status",
        data=data,
        headers={"X-Twilio-Signature": signature},
    )

    assert response.status_code == 204
    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    sms_delivery = work_order.work_order_metadata["contractor_delivery"]["sms"]
    assert sms_delivery["send"]["status"] == "delivered"
    assert sms_delivery["receipts"][0]["provider_message_id"] == "SM-maintenance-signed"


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
    assignee = session.get(AppUser, settings.dev_user_id)
    assert assignee is not None
    assignee.notification_preferences = {
        "work_assignment_email_enabled": True,
        "work_assignment_notice_template_key": "custom_work_notice",
        "work_assignment_notice_template_version": "v2",
        "work_assignment_digest_cadence": "daily",
    }
    session.commit()
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
        assert invite.template_key == "custom_work_notice"
        assert invite.template_version == "v2"
        assert settings_arg.work_assignment_email_template_key == ("work_assignment_notification")
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
    assert notification["template_key"] == "custom_work_notice"
    assert notification["template_version"] == "v2"
    assert notification["attempt_count"] == 1
    assert notification["delivery_attempt_count"] == 1
    assert notification["provider_history"][0]["event"] == ("provider_notification_attempted")
    assert notification["provider_history"][0]["delivery_attempt_count"] == 1
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
    assert notification["attempt_count"] == 1
    assert notification["delivery_attempt_count"] == 1
    assert notification["provider_history"][0]["event"] == ("provider_notification_receipt")
    assert notification["provider_history"][0]["delivery_attempt_count"] == 1
    assert assignment["history"][0]["event"] == "provider_notification_receipt"
    assert assignment["history"][0]["notification_status"] == "delivered"

    center_response = client.get(
        "/api/v1/work-assignments/notification-center",
        params={"entity_id": context["entity_id"]},
    )
    assert center_response.status_code == 200
    notice = next(
        notice
        for notice in center_response.json()["notices"]
        if notice["target_id"] == work_order_id
    )
    email_receipt = next(
        receipt for receipt in notice["channel_receipts"] if receipt["channel"] == "email"
    )
    assert email_receipt["status"] == "delivered"
    assert email_receipt["last_event"] == "delivered"
    assert email_receipt["receipt_at"] is not None
    assert email_receipt["delivery_attempt_count"] == 1
    assert email_receipt["provider_history"][0]["event"] == "provider_notification_receipt"
    preview = email_receipt["rendered_message_preview"]
    assert preview["channel"] == "email"
    assert preview["provider"] == "sendgrid"
    assert preview["recipient_email"] == settings.dev_user_email
    assert preview["subject"] == "Leasium work assigned: Replace shopfront lock"
    assert "Maintenance has been assigned to you in Leasium." in preview["body_text"]
    assert "Work: Replace shopfront lock" in preview["body_text"]
    assert preview["template_key"] == "custom_work_notice"
    assert preview["template_version"] == "v2"

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "maintenance_work_order")
    ).all()
    assert [row.action for row in audit_rows[-2:]] == ["deliver", "receipt"]
    assert [row.tool_name for row in audit_rows[-2:]] == [
        "sendgrid.work_assignment",
        "sendgrid.work_assignment_event_webhook",
    ]


def test_work_assignment_sendgrid_receipt_requires_configured_secret(
    client: TestClient,
    monkeypatch,
) -> None:
    settings = work_assignment_router.get_settings()
    monkeypatch.setattr(
        work_assignment_router,
        "get_settings",
        lambda: settings.model_copy(update={"communications_webhook_secret": "sg-secret"}),
    )

    missing_response = client.post(
        "/api/v1/work-assignments/webhooks/sendgrid-events",
        json=[],
    )
    assert missing_response.status_code == 401
    assert missing_response.json()["detail"] == "Invalid webhook token."

    accepted_response = client.post(
        "/api/v1/work-assignments/webhooks/sendgrid-events",
        headers={"x-leasium-webhook-secret": "sg-secret"},
        json=[],
    )
    assert accepted_response.status_code == 204


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


def test_notification_center_can_retry_assignment_notice_email(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    context = _lease_context(client, session)
    settings = get_settings()
    assignee = session.get(AppUser, settings.dev_user_id)
    assert assignee is not None
    assignee.notification_preferences = {
        "work_assignment_email_enabled": True,
        "work_assignment_notice_template_key": "custom_work_notice",
        "work_assignment_notice_template_version": "v2",
    }
    session.commit()

    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Retryable notice job",
            "status": "assigned",
            "metadata": {
                "work_assignment": {
                    "assigned_user_id": str(settings.dev_user_id),
                    "assigned_user_name": settings.dev_user_name,
                    "assigned_user_email": settings.dev_user_email,
                    "notification": {
                        "channel": "email",
                        "provider": "sendgrid",
                        "status": "failed",
                        "recipient_email": settings.dev_user_email,
                        "template_key": "work_assignment_notification",
                        "template_version": "v1",
                        "provider_history": [
                            {
                                "event": "provider_notification_attempted",
                                "status": "failed",
                                "provider": "sendgrid",
                            }
                        ],
                    },
                    "history": [],
                }
            },
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]
    attempts: list[str] = []

    def fake_send_work_assignment_email(invite: Any, settings_arg: Any) -> DeliveryResult:
        assert str(invite.target_id) == work_order_id
        assert invite.target_type == "maintenance_work_order"
        assert invite.template_key == "custom_work_notice"
        assert invite.template_version == "v2"
        attempts.append(str(invite.target_id))
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            attempted_at="2026-05-21T10:10:00+00:00",
            recipient=invite.assignee_email,
            provider_message_id="sg-notification-center-1",
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
            },
        )

    monkeypatch.setattr(
        "apps.api.routers.work_assignment_notifications.send_work_assignment_email",
        fake_send_work_assignment_email,
    )

    payload = {
        "entity_id": context["entity_id"],
        "target_id": work_order_id,
        "target_type": "maintenance_work_order",
        "delivery_trigger": "retry",
    }
    send_response = client.post(
        "/api/v1/work-assignments/notification-center/notices/send-email",
        json=payload,
    )

    assert send_response.status_code == 200
    body = send_response.json()
    assert body["status"] == "queued"
    assert body["message_sent"] is True
    assert body["provider_message_id"] == "sg-notification-center-1"
    assert body["template_key"] == "custom_work_notice"
    assert body["notice"]["notification_status"] == "queued"
    assert body["notice"]["group"] == "in_flight"
    assert attempts == [work_order_id]

    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    notification = work_order.work_order_metadata["work_assignment"]["notification"]
    assert notification["provider_history"][0]["status"] == "queued"
    assert notification["provider_history"][1]["status"] == "failed"

    second_response = client.post(
        "/api/v1/work-assignments/notification-center/notices/send-email",
        json=payload,
    )
    assert second_response.status_code == 200
    assert second_response.json()["status"] == "already_sent"
    assert attempts == [work_order_id]

    wrong_entity_response = client.post(
        "/api/v1/work-assignments/notification-center/notices/send-email",
        json={
            **payload,
            "entity_id": "00000000-0000-7000-8000-000000099999",
        },
    )
    assert wrong_entity_response.status_code == 404

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.tool_name == "sendgrid.work_assignment.notification_center"
        )
    )
    assert audit is not None
    assert audit.action == "deliver"


def test_notification_center_can_send_assignment_notice_sms_without_clobbering_email(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    context = _lease_context(client, session)
    settings = get_settings()
    assignee = session.get(AppUser, settings.dev_user_id)
    assert assignee is not None
    assignee.notification_preferences = {
        "work_assignment_email_enabled": True,
        "work_assignment_sms_enabled": True,
        "work_assignment_sms_phone": "+61400111222",
    }
    session.commit()

    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "SMS-ready notice job",
            "status": "assigned",
            "metadata": {
                "work_assignment": {
                    "assigned_user_id": str(settings.dev_user_id),
                    "assigned_user_name": settings.dev_user_name,
                    "assigned_user_email": settings.dev_user_email,
                    "notification": {
                        "channel": "email",
                        "provider": "sendgrid",
                        "status": "queued",
                        "recipient_email": settings.dev_user_email,
                        "provider_message_id": "sg-existing-email",
                        "template_key": "work_assignment_notification",
                        "template_version": "v1",
                        "provider_history": [
                            {
                                "event": "provider_notification_attempted",
                                "channel": "email",
                                "status": "queued",
                                "provider": "sendgrid",
                                "provider_message_id": "sg-existing-email",
                            }
                        ],
                    },
                    "history": [],
                }
            },
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]
    attempts: list[str] = []

    def fake_send_work_assignment_sms(invite: Any, settings_arg: Any) -> DeliveryResult:
        assert str(invite.target_id) == work_order_id
        assert invite.target_type == "maintenance_work_order"
        assert invite.assignee_phone == "+61400111222"
        attempts.append(str(invite.target_id))
        return DeliveryResult(
            channel="sms",
            status="queued",
            provider="twilio",
            attempted_at="2026-05-21T10:12:00+00:00",
            recipient=invite.assignee_phone,
            provider_message_id="SM-notification-center-1",
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
            },
        )

    monkeypatch.setattr(
        "apps.api.routers.work_assignment_notifications.send_work_assignment_sms",
        fake_send_work_assignment_sms,
    )

    payload = {
        "entity_id": context["entity_id"],
        "target_id": work_order_id,
        "target_type": "maintenance_work_order",
        "delivery_trigger": "manual",
    }
    send_response = client.post(
        "/api/v1/work-assignments/notification-center/notices/send-sms",
        json=payload,
    )

    assert send_response.status_code == 200
    body = send_response.json()
    assert body["status"] == "queued"
    assert body["message_sent"] is True
    assert body["recipient_phone"] == "+61400111222"
    assert body["provider_message_id"] == "SM-notification-center-1"
    assert body["notice"]["notification_status"] == "queued"
    assert body["notice"]["group"] == "in_flight"
    assert body["notice"]["sms_status"] == "queued"
    channel_receipts = {
        receipt["channel"]: receipt for receipt in body["notice"]["channel_receipts"]
    }
    assert channel_receipts["email"]["status"] == "queued"
    assert channel_receipts["email"]["provider"] == "sendgrid"
    assert channel_receipts["sms"]["status"] == "queued"
    assert channel_receipts["sms"]["provider"] == "twilio"
    assert channel_receipts["sms"]["recipient_phone"] == "+61400111222"
    assert channel_receipts["sms"]["message_sent"] is True
    sms_preview = channel_receipts["sms"]["rendered_message_preview"]
    assert sms_preview["channel"] == "sms"
    assert sms_preview["provider"] == "twilio"
    assert sms_preview["recipient_phone"] == "+61400111222"
    assert sms_preview["subject"] is None
    assert "Leasium: Maintenance assigned" in sms_preview["body_text"]
    assert "SMS-ready notice job" in sms_preview["body_text"]
    assert attempts == [work_order_id]

    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    notification = work_order.work_order_metadata["work_assignment"]["notification"]
    assert notification["channel"] == "email"
    assert notification["provider"] == "sendgrid"
    assert notification["status"] == "queued"
    assert notification["provider_message_id"] == "sg-existing-email"
    assert notification["provider_history"][0]["channel"] == "email"
    sms_channel = notification["channels"]["sms"]
    assert sms_channel["status"] == "queued"
    assert sms_channel["provider"] == "twilio"
    assert sms_channel["provider_message_id"] == "SM-notification-center-1"
    assert sms_channel["provider_history"][0]["channel"] == "sms"
    assert sms_channel["provider_history"][0]["delivery_attempt_count"] == 1

    second_response = client.post(
        "/api/v1/work-assignments/notification-center/notices/send-sms",
        json=payload,
    )
    assert second_response.status_code == 200
    assert second_response.json()["status"] == "already_sent"
    assert attempts == [work_order_id]

    receipt_response = client.post(
        "/api/v1/work-assignments/webhooks/twilio-status",
        data={
            "MessageSid": "SM-notification-center-1",
            "MessageStatus": "delivered",
            "To": "+61400111222",
        },
    )
    assert receipt_response.status_code == 204
    session.refresh(work_order)
    notification = work_order.work_order_metadata["work_assignment"]["notification"]
    assert notification["status"] == "queued"
    assert notification["provider_message_id"] == "sg-existing-email"
    sms_channel = notification["channels"]["sms"]
    assert sms_channel["status"] == "delivered"
    assert sms_channel["last_event"] == "delivered"
    assert sms_channel["provider_history"][0]["event"] == "provider_notification_receipt"

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.tool_name == "twilio.work_assignment.notification_center"
        )
    )
    assert audit is not None
    assert audit.action == "deliver"


def test_work_assignment_twilio_status_rejects_unsigned_when_token_configured(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Configured Work SMS callbacks must be signed before receipts move."""

    from apps.api.routers import work_assignment_notifications as work_notifications
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        work_notifications,
        "get_settings",
        lambda: Settings(twilio_auth_token="twilio-secret"),
    )
    context = _lease_context(client, session)
    settings = get_settings()
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Unsigned Work receipt",
            "status": "assigned",
            "metadata": {
                "work_assignment": {
                    "assigned_user_id": str(settings.dev_user_id),
                    "assigned_user_name": settings.dev_user_name,
                    "assigned_user_email": settings.dev_user_email,
                    "notification": {
                        "channels": {
                            "sms": {
                                "channel": "sms",
                                "provider": "twilio",
                                "status": "queued",
                                "provider_message_id": "SM-work-unsigned",
                                "provider_history": [],
                            }
                        }
                    },
                    "history": [],
                }
            },
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    response = client.post(
        "/api/v1/work-assignments/webhooks/twilio-status",
        data={
            "MessageSid": "SM-work-unsigned",
            "MessageStatus": "delivered",
            "To": "+61400111222",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid Twilio webhook signature."
    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    sms_channel = work_order.work_order_metadata["work_assignment"]["notification"][
        "channels"
    ]["sms"]
    assert sms_channel["status"] == "queued"
    assert sms_channel["provider_history"] == []


def test_work_assignment_twilio_status_accepts_public_api_url_signature(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Production proxy URLs can validate signed Work SMS callbacks."""

    from apps.api.routers import work_assignment_notifications as work_notifications
    from stewart.core.settings import Settings

    auth_token = "twilio-secret"
    public_api_url = "https://api.leasium.test"
    monkeypatch.setattr(
        work_notifications,
        "get_settings",
        lambda: Settings(public_api_url=public_api_url, twilio_auth_token=auth_token),
    )
    context = _lease_context(client, session)
    settings = get_settings()
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Signed Work receipt",
            "status": "assigned",
            "metadata": {
                "work_assignment": {
                    "assigned_user_id": str(settings.dev_user_id),
                    "assigned_user_name": settings.dev_user_name,
                    "assigned_user_email": settings.dev_user_email,
                    "notification": {
                        "channels": {
                            "sms": {
                                "channel": "sms",
                                "provider": "twilio",
                                "status": "queued",
                                "provider_message_id": "SM-work-signed",
                                "provider_history": [],
                            }
                        }
                    },
                    "history": [],
                }
            },
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]
    data = {
        "MessageSid": "SM-work-signed",
        "MessageStatus": "delivered",
        "To": "+61400111222",
    }
    url = f"{public_api_url}/api/v1/work-assignments/webhooks/twilio-status"
    signature = _twilio_signature(url, data, auth_token)

    response = client.post(
        "/api/v1/work-assignments/webhooks/twilio-status",
        data=data,
        headers={"X-Twilio-Signature": signature},
    )

    assert response.status_code == 204
    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    sms_channel = work_order.work_order_metadata["work_assignment"]["notification"][
        "channels"
    ]["sms"]
    assert sms_channel["status"] == "delivered"
    assert sms_channel["provider_history"][0]["provider_message_id"] == "SM-work-signed"


def test_work_assignment_digest_runner_generates_review_only_operator_digest(
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
        "work_assignment_digest_template_key": "custom_work_digest",
        "work_assignment_digest_template_version": "v3",
    }
    session.commit()

    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": entity_id,
            "title": "Digest-ready maintenance job",
            "description": "Air conditioning follow-up needs owner attention.",
            "priority": "urgent",
            "status": "requested",
            "due_date": "2026-05-21",
            "metadata": {
                "work_assignment": {
                    "assigned_user_id": str(assignee.id),
                    "assigned_user_name": assignee.display_name,
                    "assigned_user_email": assignee.email,
                    "assigned_at": "2026-05-21T08:00:00Z",
                    "reminder": {
                        "status": "due",
                        "due_on": "2026-05-21",
                    },
                    "escalation": {
                        "status": "watching",
                        "due_on": "2026-05-22",
                    },
                    "notification": {
                        "status": "ready",
                        "detail": "Assignment notice is ready.",
                    },
                }
            },
        },
    )
    assert create_response.status_code == 201

    digest_response = client.post(
        "/api/v1/work-assignments/digests/run",
        json={"entity_id": entity_id, "cadence": "daily"},
    )

    assert digest_response.status_code == 200
    digest = digest_response.json()
    assert digest["operator_count"] == 1
    assert digest["work_item_count"] == 1
    assert digest["guardrails"][0].startswith("Digest generation is review-only")
    operator_digest = digest["digests"][0]
    assert operator_digest["assignee_user_id"] == str(assignee.id)
    assert operator_digest["ready_count"] == 1
    assert operator_digest["follow_up_due_count"] == 1
    operator_preview = operator_digest["rendered_message_preview"]
    assert operator_preview["channel"] == "email"
    assert operator_preview["provider"] == "sendgrid"
    assert operator_preview["recipient_email"] == assignee.email
    assert operator_preview["subject"] == "Leasium Daily Work digest: 1 items"
    assert "Digest-ready maintenance job" in operator_preview["body_text"]
    assert operator_preview["template_key"] == "custom_work_digest"
    assert operator_preview["template_version"] == "v3"
    item = operator_digest["items"][0]
    assert item["title"] == "Digest-ready maintenance job"
    assert item["target_type"] == "maintenance_work_order"
    assert item["notification_group"] == "ready"
    assert item["follow_up_due"] is True
    assert "/operations/maintenance/" in item["work_url"]

    session.refresh(assignee)
    receipt = assignee.notification_preferences["work_assignment_digest_history"][0]
    assert receipt["event"] == "digest_generated"
    assert receipt["delivery_status"] == "previewed"
    assert receipt["message_sent"] is False
    assert receipt["item_count"] == 1

    audit = session.scalar(
        select(AuditAction).where(AuditAction.tool_name == "work_assignment.digest_generate")
    )
    assert audit is not None
    assert audit.tool_output_summary is not None
    assert "no messages sent" in audit.tool_output_summary

    scheduled_response = client.post(
        "/api/v1/work-assignments/digests/run-scheduled",
        json={"entity_id": entity_id, "cadence": "daily"},
    )
    assert scheduled_response.status_code == 200
    scheduled_digest = scheduled_response.json()
    assert scheduled_digest["operator_count"] == 1
    assert scheduled_digest["work_item_count"] == 1

    session.refresh(assignee)
    assert len(assignee.notification_preferences["work_assignment_digest_history"]) == 2
    scheduled_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.tool_name == "work_assignment.digest_generate_scheduled"
        )
    )
    assert scheduled_audit is not None
    assert scheduled_audit.actor == "cron:work_assignment_digest"
    assert scheduled_audit.user_id is None

    due_response = client.post(
        "/api/v1/work-assignments/digests/run-due",
        params={"cadence": "daily"},
    )
    assert due_response.status_code == 200
    due_digest = due_response.json()
    assert due_digest["cadence_filter"] == "daily"
    assert due_digest["entity_count"] == 1
    assert due_digest["run_count"] == 1
    assert due_digest["operator_count"] == 1
    assert due_digest["work_item_count"] == 1
    assert due_digest["guardrails"][0].startswith("Due digest runs are review-only")
    assert due_digest["runs"][0]["cadence"] == "daily"
    session.refresh(assignee)
    assert len(assignee.notification_preferences["work_assignment_digest_history"]) == 3
    due_audit = session.scalar(
        select(AuditAction).where(AuditAction.tool_name == "work_assignment.digest_generate_due")
    )
    assert due_audit is not None
    assert due_audit.actor == "cron:work_assignment_digest_due"
    assert due_audit.user_id is None

    center_response = client.get(
        "/api/v1/work-assignments/notification-center",
        params={"entity_id": entity_id},
    )
    assert center_response.status_code == 200
    center = center_response.json()
    assert center["notice_count"] == 1
    assert center["unread_count"] == 4
    assert center["last_read_at"] is None
    assert center["ready_count"] == 1
    assert center["digest_receipt_count"] == 3
    assert center["notices"][0]["title"] == "Digest-ready maintenance job"
    assert center["notices"][0]["group"] == "ready"
    assert center["notices"][0]["assignee_user_id"] == str(assignee.id)
    assert center["digest_receipts"][0]["delivery_status"] == "previewed"
    assert center["digest_receipts"][0]["delivery_channel"] is None
    assert center["digest_receipts"][0]["template_key"] == "custom_work_digest"
    assert center["digest_receipts"][0]["template_version"] == "v3"
    assert center["digest_receipts"][0]["provider_history"] == []
    digest_preview = center["digest_receipts"][0]["rendered_message_preview"]
    assert digest_preview["channel"] == "email"
    assert digest_preview["provider"] == "sendgrid"
    assert digest_preview["recipient_email"] == assignee.email
    assert digest_preview["subject"] == "Leasium Daily Work digest: 1 items"
    assert "Digest-ready maintenance job" in digest_preview["body_text"]
    assert digest_preview["template_key"] == "custom_work_digest"
    assert digest_preview["template_version"] == "v3"
    digest_channel_receipts = center["digest_receipts"][0]["channel_receipts"]
    assert len(digest_channel_receipts) == 1
    digest_email_receipt = digest_channel_receipts[0]
    assert digest_email_receipt["channel"] == "email"
    assert digest_email_receipt["label"] == "Work digest email"
    assert digest_email_receipt["status"] == "previewed"
    assert digest_email_receipt["template_key"] == "custom_work_digest"
    assert digest_email_receipt["template_version"] == "v3"
    assert digest_email_receipt["recipient_email"] == assignee.email
    assert digest_email_receipt["message_sent"] is False
    assert digest_email_receipt["action_available"] is False
    assert digest_email_receipt["delivery_attempt_count"] == 0
    assert digest_email_receipt["provider_history"] == []
    assert digest_email_receipt["rendered_message_preview"]["channel"] == "email"
    assert center["guardrails"][0].startswith("Notification center is read-only")
    assert center["channels"][0]["channel"] == "email"
    assert center["channels"][0]["readiness"] == "actionable"
    assert center["channels"][0]["reason_code"] == "sendgrid_not_configured"
    assert center["channels"][0]["action_available"] is True
    email_checks = {check["key"]: check for check in center["channels"][0]["setup_checks"]}
    assert email_checks["work_assignment_email_enabled"]["status"] == "ready"
    assert email_checks["sendgrid_sender"]["status"] == "missing"
    assert email_checks["sendgrid_event_webhook"]["status"] == "missing"
    assert email_checks["sendgrid_event_webhook"]["value"] is None
    assert center["channels"][1]["channel"] == "sms"
    assert center["channels"][1]["readiness"] == "blocked"
    assert center["channels"][1]["reason_code"] == "no_operator_phone"
    assert center["channels"][1]["action_available"] is False
    sms_checks = {check["key"]: check for check in center["channels"][1]["setup_checks"]}
    assert sms_checks["operator_sms_preferences"]["status"] == "missing"
    assert sms_checks["twilio_messaging"]["status"] == "missing"
    assert sms_checks["twilio_status_callback"]["status"] == "missing"
    assert sms_checks["twilio_status_callback"]["value"] is None
    assert center["channels"][2]["readiness"] == "read_only"
    assert center["channels"][2]["setup_checks"][0]["key"] == "leasium_receipts"
    assert center["channels"][2]["setup_checks"][0]["status"] == "ready"

    mark_read_response = client.post(
        "/api/v1/work-assignments/notification-center/mark-read",
        params={"entity_id": entity_id},
    )
    assert mark_read_response.status_code == 200
    read_state = mark_read_response.json()
    assert read_state["unread_count"] == 0
    assert read_state["read_at"] is not None

    center_after_read_response = client.get(
        "/api/v1/work-assignments/notification-center",
        params={"entity_id": entity_id},
    )
    assert center_after_read_response.status_code == 200
    center_after_read = center_after_read_response.json()
    assert center_after_read["unread_count"] == 0
    assert center_after_read["last_read_at"] == read_state["read_at"]
    session.refresh(assignee)
    stored_read_at = assignee.notification_preferences[
        "work_assignment_notification_center_read_at"
    ][entity_id]
    assert stored_read_at.replace("+00:00", "Z") == read_state["read_at"]


def test_notification_center_provider_setup_checks_hide_secrets(
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
        "work_assignment_sms_enabled": True,
        "work_assignment_sms_phone": "+61400111222",
    }
    session.commit()
    configured_settings = settings.model_copy(
        update={
            "public_api_url": "https://api.leasium.test",
            "communications_webhook_secret": "super-secret",
            "sendgrid_api_key": "sendgrid-secret",
            "sendgrid_from_email": "ops@leasium.test",
            "twilio_account_sid": "AC123",
            "twilio_auth_token": "twilio-secret",
            "twilio_messaging_service_sid": "MG123",
        }
    )
    monkeypatch.setattr(
        "apps.api.routers.work_assignment_notifications.get_settings",
        lambda: configured_settings,
    )

    response = client.get(
        "/api/v1/work-assignments/notification-center",
        params={"entity_id": entity_id},
    )

    assert response.status_code == 200
    center = response.json()
    email_checks = {check["key"]: check for check in center["channels"][0]["setup_checks"]}
    assert email_checks["sendgrid_sender"]["status"] == "ready"
    assert email_checks["sendgrid_sender"]["value"] == "ops@leasium.test"
    assert email_checks["sendgrid_event_webhook"]["status"] == "review"
    assert email_checks["sendgrid_event_webhook"]["value"] == (
        "https://api.leasium.test/api/v1/work-assignments/webhooks/sendgrid-events"
    )
    assert "sendgrid-secret" not in str(email_checks)
    assert "super-secret" not in str(email_checks)

    sms_checks = {check["key"]: check for check in center["channels"][1]["setup_checks"]}
    assert sms_checks["operator_sms_preferences"]["status"] == "ready"
    assert sms_checks["twilio_messaging"]["status"] == "ready"
    assert sms_checks["twilio_status_callback"]["status"] == "review"
    assert sms_checks["twilio_status_callback"]["value"] == (
        "https://api.leasium.test/api/v1/work-assignments/webhooks/twilio-status"
    )
    assert "twilio-secret" not in str(sms_checks)
    assert "super-secret" not in str(sms_checks)
    assert "token=" not in sms_checks["twilio_status_callback"]["value"]


def test_work_assignment_notification_template_catalog(client: TestClient) -> None:
    response = client.get("/api/v1/work-assignments/notification-templates")

    assert response.status_code == 200
    catalog = response.json()
    assert catalog["guardrails"][0].startswith("Template choices only set reviewed")
    assert catalog["notice_templates"][0]["key"] == "work_assignment_notification"
    assert catalog["notice_templates"][0]["name"] == "Standard assignment notice"
    assert catalog["notice_templates"][0]["provider"] == "sendgrid"
    assert catalog["digest_templates"][0]["key"] == "work_assignment_digest"
    assert catalog["digest_templates"][0]["default_version"] == "v1"
    assert any(
        template["key"] == "work_assignment_digest_owner_review"
        for template in catalog["digest_templates"]
    )


def test_work_assignment_digest_delivery_requires_approval_and_records_receipts(
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
        "work_assignment_digest_template_key": "custom_work_digest",
        "work_assignment_digest_template_version": "v3",
    }
    session.commit()

    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": entity_id,
            "title": "Digest delivery maintenance job",
            "description": "Digest email should include this work item.",
            "priority": "high",
            "status": "requested",
            "due_date": "2026-05-21",
            "metadata": {
                "work_assignment": {
                    "assigned_user_id": str(assignee.id),
                    "assigned_user_name": assignee.display_name,
                    "assigned_user_email": assignee.email,
                    "assigned_at": "2026-05-21T08:00:00Z",
                    "notification": {
                        "status": "ready",
                        "detail": "Assignment notice is ready.",
                    },
                }
            },
        },
    )
    assert create_response.status_code == 201

    attempts: list[str] = []

    def fake_send_work_assignment_digest_email(invite: Any, settings_arg: Any) -> DeliveryResult:
        assert invite.entity_id == UUID(entity_id)
        assert invite.assignee_user_id == assignee.id
        assert invite.assignee_email == assignee.email
        assert invite.cadence == "daily"
        assert invite.item_count == 1
        assert invite.items[0].title == "Digest delivery maintenance job"
        assert invite.template_key == "custom_work_digest"
        assert invite.template_version == "v3"
        assert settings_arg.work_assignment_email_template_key == ("work_assignment_notification")
        attempts.append(str(invite.assignee_user_id))
        message_id = f"sg-digest-{len(attempts)}"
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            attempted_at="2026-05-21T09:00:00+00:00",
            recipient=invite.assignee_email,
            provider_message_id=message_id,
            metadata={
                "template_key": invite.template_key,
                "template_version": invite.template_version,
                "entity_id": str(invite.entity_id),
                "assignee_user_id": str(invite.assignee_user_id),
                "cadence": invite.cadence,
                "generated_at": invite.generated_at.isoformat(),
            },
        )

    monkeypatch.setattr(
        "apps.api.routers.work_assignment_notifications.send_work_assignment_digest_email",
        fake_send_work_assignment_digest_email,
    )

    preview_response = client.post(
        "/api/v1/work-assignments/digests/run-scheduled",
        json={"entity_id": entity_id, "cadence": "daily"},
    )
    assert preview_response.status_code == 200
    assert attempts == []
    assert preview_response.json()["digests"][0]["message_sent"] is False

    delivery_response = client.post(
        "/api/v1/work-assignments/digests/run-scheduled",
        json={
            "entity_id": entity_id,
            "cadence": "daily",
            "send_email_approved": True,
        },
    )
    assert delivery_response.status_code == 200
    delivered = delivery_response.json()
    assert delivered["guardrails"][0].startswith("Digest email delivery only")
    assert attempts == [str(assignee.id)]
    operator_digest = delivered["digests"][0]
    assert operator_digest["delivery_status"] == "queued"
    assert operator_digest["message_sent"] is True
    assert operator_digest["provider_message_id"] == "sg-digest-1"
    assert operator_digest["delivery_trigger"] == "scheduled"
    assert operator_digest["delivery_attempt_count"] == 1

    session.refresh(assignee)
    receipt = assignee.notification_preferences["work_assignment_digest_history"][0]
    assert receipt["delivery_status"] == "queued"
    assert receipt["message_sent"] is True
    assert receipt["provider_message_id"] == "sg-digest-1"
    assert receipt["recipient_email"] == assignee.email
    assert receipt["delivery_trigger"] == "scheduled"
    assert receipt["delivery_attempt_count"] == 1
    assert receipt["provider_history"][0]["event"] == "digest_delivery_attempted"

    center_response = client.get(
        "/api/v1/work-assignments/notification-center",
        params={"entity_id": entity_id},
    )
    assert center_response.status_code == 200
    center = center_response.json()
    assert center["digest_receipts"][0]["delivery_status"] == "queued"
    assert center["digest_receipts"][0]["message_sent"] is True
    assert center["digest_receipts"][0]["delivery_channel"] == "email"
    assert center["digest_receipts"][0]["provider"] == "sendgrid"
    assert center["digest_receipts"][0]["provider_message_id"] == "sg-digest-1"
    assert center["digest_receipts"][0]["template_key"] == "custom_work_digest"
    assert center["digest_receipts"][0]["template_version"] == "v3"
    assert center["digest_receipts"][0]["delivery_trigger"] == "scheduled"
    assert center["digest_receipts"][0]["delivery_attempt_count"] == 1
    assert center["digest_receipts"][0]["provider_history"][0]["event"] == (
        "digest_delivery_attempted"
    )
    sent_digest_channel_receipts = center["digest_receipts"][0]["channel_receipts"]
    assert len(sent_digest_channel_receipts) == 1
    sent_digest_email_receipt = sent_digest_channel_receipts[0]
    assert sent_digest_email_receipt["channel"] == "email"
    assert sent_digest_email_receipt["provider"] == "sendgrid"
    assert sent_digest_email_receipt["status"] == "queued"
    assert sent_digest_email_receipt["message_sent"] is True
    assert sent_digest_email_receipt["provider_message_id"] == "sg-digest-1"
    assert sent_digest_email_receipt["template_key"] == "custom_work_digest"
    assert sent_digest_email_receipt["template_version"] == "v3"
    assert sent_digest_email_receipt["delivery_trigger"] == "scheduled"
    assert sent_digest_email_receipt["delivery_attempt_count"] == 1
    assert sent_digest_email_receipt["recipient_email"] == assignee.email
    assert (
        sent_digest_email_receipt["provider_history"][0]["event"]
        == "digest_delivery_attempted"
    )
    assert center["digest_receipts"][0]["provider_history"][0]["template_key"] == (
        "custom_work_digest"
    )
    delivery_preview = center["digest_receipts"][0]["rendered_message_preview"]
    assert delivery_preview["subject"] == "Leasium Daily Work digest: 1 items"
    assert "Digest delivery maintenance job" in delivery_preview["body_text"]
    assert delivery_preview["template_key"] == "custom_work_digest"
    assert delivery_preview["template_version"] == "v3"

    recovery_response = client.post(
        "/api/v1/work-assignments/digests/run",
        json={
            "entity_id": entity_id,
            "cadence": "daily",
            "send_email_approved": True,
            "delivery_trigger": "recovery",
            "recovery_of_generated_at": receipt["generated_at"],
        },
    )
    assert recovery_response.status_code == 200
    recovery_digest = recovery_response.json()["digests"][0]
    assert attempts == [str(assignee.id), str(assignee.id)]
    assert recovery_digest["delivery_trigger"] == "recovery"
    assert recovery_digest["recovery_of_generated_at"] == receipt["generated_at"].replace(
        "+00:00", "Z"
    )
    assert recovery_digest["delivery_attempt_count"] == 2
    session.refresh(assignee)
    recovery_receipt = assignee.notification_preferences["work_assignment_digest_history"][0]
    assert recovery_receipt["provider_message_id"] == "sg-digest-2"
    assert recovery_receipt["delivery_trigger"] == "recovery"
    assert recovery_receipt["recovery_of_generated_at"] == receipt["generated_at"]
    assert recovery_receipt["delivery_attempt_count"] == 2

    receipt_response = client.post(
        "/api/v1/work-assignments/webhooks/sendgrid-events",
        json=[
            {
                "work_assignment_digest_entity_id": entity_id,
                "work_assignment_digest_assignee_user_id": str(assignee.id),
                "sg_message_id": "sg-digest-2",
                "event": "delivered",
                "email": assignee.email,
            }
        ],
    )
    assert receipt_response.status_code == 204
    session.refresh(assignee)
    receipt = assignee.notification_preferences["work_assignment_digest_history"][0]
    assert receipt["delivery_status"] == "delivered"
    assert receipt["last_event"] == "delivered"
    assert receipt["provider_history"][0]["event"] == "digest_provider_receipt"

    center_after_receipt_response = client.get(
        "/api/v1/work-assignments/notification-center",
        params={"entity_id": entity_id},
    )
    assert center_after_receipt_response.status_code == 200
    center_after_receipt = center_after_receipt_response.json()
    assert center_after_receipt["digest_receipts"][0]["delivery_status"] == "delivered"
    assert center_after_receipt["digest_receipts"][0]["provider_history"][0]["event"] == (
        "digest_provider_receipt"
    )
    assert center_after_receipt["digest_receipts"][0]["provider_history"][0]["status"] == (
        "delivered"
    )

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.tool_name == "sendgrid.work_assignment_digest_event_webhook"
        )
    )
    assert audit is not None
    assert audit.target_table == "app_user"


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


def test_maintenance_work_order_ai_classify_stamps_metadata_and_suggests_contractor(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """The classify endpoint stamps ai_classification on the work order and
    matches a contractor whose categories overlap with the AI category."""

    context = _lease_context(client, session)
    entity_id = context["entity_id"]

    # Seed two contractors — one electrical (preferred), one plumbing.
    elec = client.post(
        "/api/v1/contractors",
        json={
            "entity_id": entity_id,
            "name": "Bright Sparks Electrical",
            "categories": ["electrical", "urgent"],
            "priority": 1,
        },
    )
    assert elec.status_code == 201
    plumb = client.post(
        "/api/v1/contractors",
        json={
            "entity_id": entity_id,
            "name": "Pipe Pros Plumbing",
            "categories": ["plumbing"],
            "priority": 2,
        },
    )
    assert plumb.status_code == 201

    # Create the work order.
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": entity_id,
            "property_id": context["property_id"],
            "tenancy_unit_id": context["tenancy_unit_id"],
            "lease_id": context["lease_id"],
            "tenant_id": context["tenant_id"],
            "title": "Hot water tap leaking under sink",
            "description": "Kitchen tap dripping continuously, water pooling in cabinet base.",
            "priority": "normal",
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    # Stub the AI module + settings.
    from apps.api.routers import maintenance as maintenance_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        maintenance_router,
        "categorise_maintenance",
        lambda *, title, description, settings: (
            {
                "category": "plumbing",
                "confidence": 0.91,
                "summary": "Leaking kitchen tap; plumber attendance needed.",
                "is_urgent": False,
                "warnings": [],
            },
            "resp-plumb-1",
        ),
    )
    monkeypatch.setattr(
        maintenance_router,
        "get_settings",
        lambda: Settings(openai_api_key="sk-test"),
    )

    classify_response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/classify",
    )
    assert classify_response.status_code == 200
    body = classify_response.json()
    classification = body["metadata"]["ai_classification"]
    assert classification["category"] == "plumbing"
    assert classification["confidence"] == 0.91
    assert classification["is_urgent"] is False
    assert classification["suggested_contractor_id"] == plumb.json()["id"]
    assert classification["suggested_contractor_name"] == "Pipe Pros Plumbing"
    # Electrical contractor is NOT suggested even though it has lower priority.
    assert classification["suggested_contractor_id"] != elec.json()["id"]


def test_maintenance_work_order_classify_returns_503_when_openai_unset(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Without OPENAI_API_KEY, classify soft-fails with 503."""

    context = _lease_context(client, session)
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "property_id": context["property_id"],
            "tenancy_unit_id": context["tenancy_unit_id"],
            "lease_id": context["lease_id"],
            "tenant_id": context["tenant_id"],
            "title": "Test",
            "description": "Test",
            "priority": "normal",
        },
    )
    work_order_id = create_response.json()["id"]

    from apps.api.routers import maintenance as maintenance_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        maintenance_router,
        "get_settings",
        lambda: Settings(openai_api_key=""),
    )

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/classify",
    )
    assert response.status_code == 503


def test_maintenance_classify_no_matching_contractor_returns_null_suggestion(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """When no contractor matches the AI category, suggested_contractor_id is None."""

    context = _lease_context(client, session)
    # Seed a contractor with a non-matching category.
    client.post(
        "/api/v1/contractors",
        json={
            "entity_id": context["entity_id"],
            "name": "Locks Only Co",
            "categories": ["locks"],
            "priority": 1,
        },
    )
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "property_id": context["property_id"],
            "tenancy_unit_id": context["tenancy_unit_id"],
            "lease_id": context["lease_id"],
            "tenant_id": context["tenant_id"],
            "title": "Aircon fault",
            "description": "Air conditioning unit not cooling.",
            "priority": "normal",
        },
    )
    work_order_id = create_response.json()["id"]

    from apps.api.routers import maintenance as maintenance_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        maintenance_router,
        "categorise_maintenance",
        lambda *, title, description, settings: (
            {
                "category": "hvac",
                "confidence": 0.72,
                "summary": "AC not cooling; HVAC service needed.",
                "is_urgent": False,
                "warnings": [],
            },
            None,
        ),
    )
    monkeypatch.setattr(
        maintenance_router,
        "get_settings",
        lambda: Settings(openai_api_key="sk-test"),
    )

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/classify",
    )
    assert response.status_code == 200
    classification = response.json()["metadata"]["ai_classification"]
    assert classification["category"] == "hvac"
    assert classification["suggested_contractor_id"] is None
    assert classification["suggested_contractor_name"] is None


def _create_completed_work_order(client: TestClient, context: dict[str, str]) -> str:
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "Completed roof repair",
            "description": "Contractor patched the leaking flashing.",
            "priority": "normal",
            "status": "completed",
            "completed_at": "2026-05-22T03:00:00Z",
            "contractor_name": "Rapid Roofing",
            "notes": "Closed after contractor attended.",
        },
    )
    assert create_response.status_code == 201
    return str(create_response.json()["id"])


def test_maintenance_completion_review_records_owner_review(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)
    work_order_id = _create_completed_work_order(client, context)

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/completion-review",
        json={
            "party": "owner",
            "outcome": "confirmed",
            "notes": "Owner inspected and is satisfied with the repair.",
        },
    )
    assert response.status_code == 200
    body = response.json()
    reviews = body["metadata"]["completion_reviews"]
    assert len(reviews) == 1
    assert reviews[0]["party"] == "owner"
    assert reviews[0]["outcome"] == "confirmed"
    assert reviews[0]["notes"] == "Owner inspected and is satisfied with the repair."
    assert reviews[0]["reviewed_by"] == f"user:{get_settings().dev_user_email}"
    assert reviews[0]["reviewed_at"]
    # Projected onto the read schema for the frontend (later wave).
    assert body["completion_reviews"][0]["party"] == "owner"
    assert body["completion_reviews"][0]["outcome"] == "confirmed"

    history = body["metadata"]["activity_history"]
    assert history[-1]["event"] == "completion_review_recorded"
    assert history[-1]["summary"] == ("Recorded owner completion review: confirmed.")

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "maintenance_work_order")
    ).all()
    assert audit_rows[-1].action == "update"
    assert audit_rows[-1].tool_name == "maintenance.completion_review.record"


def test_maintenance_completion_review_records_tenant_confirmation(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)
    work_order_id = _create_completed_work_order(client, context)

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/completion-review",
        json={
            "party": "tenant",
            "outcome": "follow_up_requested",
            "notes": "Tenant says a small drip remains near the window.",
        },
    )
    assert response.status_code == 200
    body = response.json()
    reviews = body["completion_reviews"]
    assert len(reviews) == 1
    assert reviews[0]["party"] == "tenant"
    assert reviews[0]["outcome"] == "follow_up_requested"
    history = body["metadata"]["activity_history"]
    assert history[-1]["event"] == "completion_review_recorded"
    assert history[-1]["summary"] == ("Recorded tenant completion review: requested follow-up.")


def test_maintenance_completion_review_rejects_not_completed_work_order(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)
    create_response = client.post(
        "/api/v1/maintenance/work-orders",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "title": "In-progress repair",
            "priority": "normal",
            "status": "in_progress",
        },
    )
    assert create_response.status_code == 201
    work_order_id = create_response.json()["id"]

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/completion-review",
        json={"party": "owner", "outcome": "confirmed"},
    )
    assert response.status_code == 409
    assert "completed work orders" in response.json()["detail"]
    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    assert "completion_reviews" not in (work_order.work_order_metadata or {})


def test_maintenance_completion_review_requires_entity_access(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)
    work_order_id = _create_completed_work_order(client, context)

    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    other_entity = Entity(organisation_id=entity.organisation_id, name="No Role Maintenance Entity")
    session.add(other_entity)
    session.commit()

    work_order = session.get(MaintenanceWorkOrder, UUID(work_order_id))
    assert work_order is not None
    work_order.entity_id = other_entity.id
    session.commit()

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/completion-review",
        json={"party": "owner", "outcome": "confirmed"},
    )
    assert response.status_code == 403


def test_maintenance_completion_review_fires_no_provider_call(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Recording a completion review must never open an outbound provider call.

    Review-first: the operator records what they heard from the owner/tenant;
    the owner/tenant are not contacted. We assert at the httpx boundary that no
    external SendGrid/Twilio/Xero call is made. The Starlette TestClient is
    itself built on httpx.Client, so testserver traffic is allowed and only
    absolute external URLs fail the test.
    """
    import httpx

    context = _lease_context(client, session)
    work_order_id = _create_completed_work_order(client, context)

    original_request = httpx.Client.request

    def _guarded_request(self, method, url, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        target = str(url)
        if target.startswith(("http://", "https://")) and "testserver" not in target:
            raise AssertionError(
                f"Completion review attempted an outbound HTTP call to {target}."
            )
        return original_request(self, method, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "request", _guarded_request)

    response = client.post(
        f"/api/v1/maintenance/work-orders/{work_order_id}/completion-review",
        json={"party": "owner", "outcome": "confirmed", "notes": "All good."},
    )
    assert response.status_code == 200
    assert response.json()["completion_reviews"][0]["outcome"] == "confirmed"


def _create_arrears_case(client: TestClient, context: dict[str, str]) -> str:
    response = client.post(
        "/api/v1/arrears/cases",
        json={
            "entity_id": context["entity_id"],
            "lease_id": context["lease_id"],
            "tenant_id": context["tenant_id"],
            "balance_current_cents": 120000,
            "total_balance_cents": 120000,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_arrears_promise_to_pay_records_operator_note(
    client: TestClient,
    session: Session,
) -> None:
    from stewart.core.models import ArrearsCase

    context = _lease_context(client, session)
    arrears_case_id = _create_arrears_case(client, context)

    response = client.post(
        f"/api/v1/arrears/cases/{arrears_case_id}/promise-to-pay",
        json={
            "promised_amount_cents": 80000,
            "promised_date": "2026-06-30",
            "notes": "Tenant promised partial payment after payroll run.",
        },
    )
    assert response.status_code == 200
    body = response.json()
    promises = body["metadata"]["promise_to_pay"]
    assert len(promises) == 1
    assert promises[0]["promised_amount_cents"] == 80000
    assert promises[0]["promised_date"] == "2026-06-30"
    assert promises[0]["notes"] == "Tenant promised partial payment after payroll run."
    assert promises[0]["recorded_by"] == f"user:{get_settings().dev_user_email}"
    assert promises[0]["recorded_at"]
    # Projected onto the read schema for the frontend (later wave).
    assert body["promise_to_pay_notes_log"][0]["promised_amount_cents"] == 80000
    assert body["promise_to_pay_notes_log"][0]["notes"] == (
        "Tenant promised partial payment after payroll run."
    )

    history = body["metadata"]["activity_history"]
    assert history[-1]["event"] == "promise_to_pay_recorded"
    assert history[-1]["summary"] == "Recorded tenant promise-to-pay note."

    case = session.get(ArrearsCase, UUID(arrears_case_id))
    assert case is not None
    assert len(case.arrears_metadata["promise_to_pay"]) == 1

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "arrears_case")
    ).all()
    assert audit_rows[-1].action == "update"
    assert audit_rows[-1].tool_name == "arrears.promise_to_pay.record"


def test_arrears_promise_to_pay_allows_notes_only(
    client: TestClient,
    session: Session,
) -> None:
    context = _lease_context(client, session)
    arrears_case_id = _create_arrears_case(client, context)

    response = client.post(
        f"/api/v1/arrears/cases/{arrears_case_id}/promise-to-pay",
        json={"notes": "Tenant will call back next week with a plan."},
    )
    assert response.status_code == 200
    promises = response.json()["promise_to_pay_notes_log"]
    assert len(promises) == 1
    assert promises[0]["promised_amount_cents"] is None
    assert promises[0]["promised_date"] is None


def test_arrears_promise_to_pay_rejects_negative_amount(
    client: TestClient,
    session: Session,
) -> None:
    from stewart.core.models import ArrearsCase

    context = _lease_context(client, session)
    arrears_case_id = _create_arrears_case(client, context)

    response = client.post(
        f"/api/v1/arrears/cases/{arrears_case_id}/promise-to-pay",
        json={"promised_amount_cents": -100, "notes": "Bad amount."},
    )
    assert response.status_code == 422
    case = session.get(ArrearsCase, UUID(arrears_case_id))
    assert case is not None
    assert "promise_to_pay" not in (case.arrears_metadata or {})


def test_arrears_promise_to_pay_requires_entity_access(
    client: TestClient,
    session: Session,
) -> None:
    from stewart.core.models import ArrearsCase

    context = _lease_context(client, session)
    arrears_case_id = _create_arrears_case(client, context)

    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    other_entity = Entity(organisation_id=entity.organisation_id, name="No Role Arrears Entity")
    session.add(other_entity)
    session.commit()

    case = session.get(ArrearsCase, UUID(arrears_case_id))
    assert case is not None
    case.entity_id = other_entity.id
    session.commit()

    response = client.post(
        f"/api/v1/arrears/cases/{arrears_case_id}/promise-to-pay",
        json={"notes": "Should be denied."},
    )
    assert response.status_code == 403


def test_arrears_promise_to_pay_fires_no_provider_call(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Recording a promise-to-pay note must never open an outbound provider call.

    Review-first: the operator records what they heard from the tenant; the
    tenant is not contacted, no payment/charge/reconciliation runs. We assert at
    the httpx boundary that no external SendGrid/Twilio/Xero call is made. The
    Starlette TestClient is itself built on httpx.Client, so testserver traffic
    is allowed and only absolute external URLs fail the test.
    """
    import httpx

    context = _lease_context(client, session)
    arrears_case_id = _create_arrears_case(client, context)

    original_request = httpx.Client.request

    def _guarded_request(self, method, url, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        target = str(url)
        if target.startswith(("http://", "https://")) and "testserver" not in target:
            raise AssertionError(
                f"Promise-to-pay attempted an outbound HTTP call to {target}."
            )
        return original_request(self, method, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "request", _guarded_request)

    response = client.post(
        f"/api/v1/arrears/cases/{arrears_case_id}/promise-to-pay",
        json={"promised_amount_cents": 50000, "notes": "Plan agreed verbally."},
    )
    assert response.status_code == 200
    assert response.json()["promise_to_pay_notes_log"][0]["promised_amount_cents"] == 50000
