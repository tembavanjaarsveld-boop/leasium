"""Maintenance work order and arrears API integration tests."""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AuditAction, Entity, Organisation
from stewart.core.settings import get_settings


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
    assert body["metadata"] == {"intake": "tenant_request"}

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
    assert [row.action for row in audit_rows] == ["create", "update"]


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
