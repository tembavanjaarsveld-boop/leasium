"""Inbox triage API tests."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from apps.api.routers import ai as ai_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.ai.inbox import InboxTriageError
from stewart.ai.lease_change import LeaseChangeError
from stewart.core.models import (
    ArrearsCase,
    AuditAction,
    DocumentIntake,
    Entity,
    MaintenanceWorkOrder,
)


def _entity_id(session: Session) -> str:
    entity = session.scalar(
        select(Entity).where(Entity.name == "SKJ Property Pty Ltd")
    )
    assert entity is not None
    return str(entity.id)


def _lease_context(client: TestClient, session: Session) -> dict[str, str]:
    """Create a property/unit/tenant/lease scaffold for promote tests."""
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Queen Street Centre",
            "street_address": "28 Queen Street",
            "suburb": "Brisbane",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Unit 3", "sqm": 65},
    )
    assert unit_response.status_code == 201
    tenancy_unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Acme Bakery Pty Ltd",
            "trading_name": "Acme Bakery",
            "billing_email": "billing@acmebakery.example",
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
            "annual_rent_cents": 7200000,
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


def test_inbox_triage_returns_classification_and_audits(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)
    entity_id = context["entity_id"]

    captured_index: dict[str, Any] = {}

    def fake_triage(
        *,
        body: str,
        settings: Any,
        entity_index: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str | None]:
        assert "leaking" in body
        captured_index["index"] = entity_index
        # Match the seeded property + tenant so the router echoes back the
        # validated InboxTriageMatch payload.
        property_id = context["property_id"]
        tenant_id = context["tenant_id"]
        return (
            {
                "kind": "maintenance_request",
                "confidence": 0.88,
                "summary": "Tenant reports a slow kitchen tap leak.",
                "suggested_action": "Open the maintenance queue and triage.",
                "suggested_target_kind": "maintenance_work_order",
                "suggested_property_id": property_id,
                "suggested_tenant_id": tenant_id,
                "suggested_lease_id": None,
                "key_facts": [
                    {"label": "Property", "value": "28 Queen Street"},
                    {"label": "Unit", "value": "Unit 3"},
                    {"label": "Severity", "value": "Non-urgent"},
                    # Malformed entries are dropped.
                    {"label": "", "value": "Should not survive"},
                    {"label": "Bad", "value": ""},
                ],
                "warnings": [
                    "Cabinet starting to swell — escalate if not addressed."
                ],
            },
            "resp_triage_001",
        )

    monkeypatch.setattr(ai_router, "triage_inbox", fake_triage)

    response = client.post(
        "/api/v1/ai/triage",
        json={
            "entity_id": entity_id,
            "body": (
                "Hi team, the kitchen tap at Unit 3, 28 Queen Street has been"
                " leaking for two days and is now dripping into the cabinet"
                " underneath. Can someone take a look this week?"
            ),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "maintenance_request"
    assert body["confidence"] == 0.88
    assert body["suggested_target_kind"] == "maintenance_work_order"
    assert body["suggested_target_href"] == "/operations"
    assert body["suggested_property"]["id"] == context["property_id"]
    assert body["suggested_tenant"]["id"] == context["tenant_id"]
    assert body["suggested_lease"] is None
    # Malformed key_facts entries dropped.
    assert len(body["key_facts"]) == 3
    assert body["warnings"] == [
        "Cabinet starting to swell — escalate if not addressed.",
    ]
    assert body["guardrails"], "guardrails should be surfaced to the operator"

    # Entity index was actually passed through to the helper and contained
    # the property the test fixture seeded.
    sent_index = captured_index["index"]
    assert sent_index is not None
    property_ids = {prop["id"] for prop in sent_index["properties"]}
    assert context["property_id"] in property_ids

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.target_table == "ai_inbox_triage")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.tool_name == "ai_inbox_triage"
    assert audit_row.tool_input == {
        "body_length": len(
            "Hi team, the kitchen tap at Unit 3, 28 Queen Street has been"
            " leaking for two days and is now dripping into the cabinet"
            " underneath. Can someone take a look this week?"
        ),
        "kind": "maintenance_request",
        "confidence": 0.88,
        "target_kind": "maintenance_work_order",
        "warning_count": 1,
        "matched_property": True,
        "matched_tenant": True,
        "matched_lease": False,
    }


def test_inbox_triage_drops_invented_ids(
    client: TestClient, session: Session, monkeypatch
) -> None:
    """A returned UUID that isn't in the entity index must be dropped."""
    context = _lease_context(client, session)
    fake_property_id = str(uuid4())

    def fake_triage(
        *,
        body: str,
        settings: Any,
        entity_index: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str | None]:
        return (
            {
                "kind": "maintenance_request",
                "confidence": 0.6,
                "summary": "Tenant request.",
                "suggested_action": "Open Operations.",
                "suggested_target_kind": "maintenance_work_order",
                "suggested_property_id": fake_property_id,
                "suggested_tenant_id": "not-a-uuid",
                "suggested_lease_id": None,
                "key_facts": [],
                "warnings": [],
            },
            None,
        )

    monkeypatch.setattr(ai_router, "triage_inbox", fake_triage)

    response = client.post(
        "/api/v1/ai/triage",
        json={
            "entity_id": context["entity_id"],
            "body": "Body that is at least ten characters long for validation.",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["suggested_property"] is None
    assert body["suggested_tenant"] is None
    assert body["suggested_lease"] is None


def test_inbox_triage_503_when_helper_unavailable(
    client: TestClient, session: Session, monkeypatch
) -> None:
    entity_id = _entity_id(session)

    def fake_triage(
        *,
        body: str,
        settings: Any,
        entity_index: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str]:
        raise InboxTriageError("OpenAI API key is not configured.")

    monkeypatch.setattr(ai_router, "triage_inbox", fake_triage)

    response = client.post(
        "/api/v1/ai/triage",
        json={
            "entity_id": entity_id,
            "body": "Body must be at least ten characters to pass validation.",
        },
    )
    assert response.status_code == 503
    assert "OpenAI" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Promote tests — v2 of the AI inbox processor.
# ---------------------------------------------------------------------------


def test_promote_maintenance_request_creates_work_order(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "maintenance_request",
            "summary": "Tenant reports a slow kitchen tap leak that needs a plumber.",
            "body": (
                "Hi team, the kitchen tap at Unit 3 has been leaking for two"
                " days. Cabinet starting to swell. Not urgent enough for"
                " out-of-hours but please book this week."
            ),
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "maintenance_work_order"
    assert body["target_href"].startswith("/operations/maintenance/")
    assert "leak" in body["target_label"].lower()

    work_order = session.scalar(
        select(MaintenanceWorkOrder).where(
            MaintenanceWorkOrder.id == UUID(body["target_id"])
        )
    )
    assert work_order is not None
    assert work_order.status.value == "requested"
    assert work_order.source_reference == "ai_inbox_promote"
    assert work_order.work_order_metadata["ai_inbox"]["kind"] == "maintenance_request"

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.tool_name == "ai_inbox_promote")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.target_table == "maintenance_work_order"


def test_promote_arrears_requires_matched_tenant(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)

    # Without tenant_id the router should return 422.
    no_tenant = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "payment_or_arrears",
            "summary": "Tenant requesting payment extension.",
            "body": "Hi, can we have an extension on this quarter's rent?",
            "property_id": context["property_id"],
        },
    )
    assert no_tenant.status_code == 422
    assert "tenant" in no_tenant.json()["detail"].lower()

    # With tenant_id it creates the arrears case.
    ok = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "payment_or_arrears",
            "summary": "Tenant requesting payment extension.",
            "body": "Hi, can we have an extension on this quarter's rent?",
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
        },
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["target_kind"] == "arrears_case"
    assert body["target_href"].startswith("/operations?tab=arrears")

    case = session.scalar(
        select(ArrearsCase).where(ArrearsCase.id == UUID(body["target_id"]))
    )
    assert case is not None
    assert case.status.value == "active"
    assert case.source_reference == "ai_inbox_promote"


def test_promote_lease_change_soft_fails_without_openai_key(
    client: TestClient, session: Session
) -> None:
    """When OPENAI_API_KEY is unset the extractor raises; promote falls
    back to v2.0 behaviour (uploaded status, empty extracted_data) with
    a warning recorded in review_data — no 5xx."""
    context = _lease_context(client, session)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "lease_change",
            "summary": "Tenant wants to extend the current lease by 12 months.",
            "body": (
                "Hi team, would you be open to extending our lease at Unit 3"
                " by another 12 months at the existing rent? Happy to discuss."
            ),
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "document_intake"
    assert body["target_href"].startswith("/intake?intake_id=")

    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.id == UUID(body["target_id"]))
    )
    assert intake is not None
    assert intake.status.value == "uploaded"
    assert intake.document_type == "lease_change"
    assert intake.extracted_data == {}
    assert "extraction_error" in intake.review_data
    # The backing StoredDocument carries the message body.
    assert intake.document is not None
    assert intake.document.filename == "inbox-lease-change.txt"
    assert b"extending our lease" in intake.document.file_data


def test_promote_lease_change_pre_extracts_fields_when_available(
    client: TestClient, session: Session, monkeypatch
) -> None:
    """When the extractor returns structured data the intake lands
    ready_for_review with extracted_data populated and the lease snapshot
    is passed through to the extractor."""
    context = _lease_context(client, session)

    captured: dict[str, Any] = {}

    def fake_extract(
        *,
        body: str,
        settings: Any,
        lease_snapshot: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str | None]:
        captured["lease_snapshot"] = lease_snapshot
        return (
            {
                "summary": "Tenant requests a 12-month extension at current rent.",
                "confidence": 0.82,
                "parties": [
                    {
                        "name": "Acme Bakery",
                        "role": "tenant",
                        "contact": "billing@acmebakery.example",
                    }
                ],
                "properties": [
                    {
                        "name": "Queen Street Centre",
                        "address": "28 Queen Street, Brisbane",
                        "unit_label": "Unit 3",
                    }
                ],
                "key_dates": [
                    {
                        "label": "Proposed new expiry",
                        "date": "2029-12-31",
                        "source_hint": "Twelve-month extension from current expiry.",
                    }
                ],
                "money_amounts": [
                    {
                        "label": "Proposed rent",
                        "amount": 72000.0,
                        "currency": "AUD",
                        "frequency": "annual",
                    }
                ],
                "proposed_actions": [
                    {
                        "title": "Extend lease by 12 months",
                        "detail": "Same annual rent; new expiry 2029-12-31.",
                    }
                ],
                "warnings": [],
            },
            "resp_lease_change_001",
        )

    monkeypatch.setattr(ai_router, "extract_lease_change", fake_extract)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "lease_change",
            "summary": "Tenant wants to extend the current lease by 12 months.",
            "body": (
                "Hi team, would you be open to extending our lease at Unit 3"
                " by another 12 months at the existing rent? Happy to discuss."
            ),
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.id == UUID(body["target_id"]))
    )
    assert intake is not None
    assert intake.status.value == "ready_for_review"
    assert intake.confidence == 0.82
    assert intake.openai_response_id == "resp_lease_change_001"
    # extracted_data follows the existing DocumentIntakeExtraction shape so
    # the Smart Intake review UI renders it without changes.
    assert intake.extracted_data["document_type"] == "lease_change"
    assert intake.extracted_data["parties"][0]["name"] == "Acme Bakery"
    assert intake.extracted_data["money_amounts"][0]["amount"] == 72000.0
    assert intake.extracted_data["proposed_actions"][0]["title"].startswith(
        "Extend"
    )
    # Lease snapshot was passed through so the model could phrase the
    # proposal as a delta from on-file values.
    assert captured["lease_snapshot"] is not None
    assert captured["lease_snapshot"]["id"] == context["lease_id"]
    assert captured["lease_snapshot"]["annual_rent_cents"] == 7200000


def test_promote_lease_change_low_confidence_lands_needs_attention(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)

    def fake_extract(
        *,
        body: str,
        settings: Any,
        lease_snapshot: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str | None]:
        return (
            {
                "summary": "Ambiguous lease change request.",
                "confidence": 0.3,
                "parties": [],
                "properties": [],
                "key_dates": [],
                "money_amounts": [],
                "proposed_actions": [],
                "warnings": ["Message is too vague to extract a clear proposal."],
            },
            None,
        )

    monkeypatch.setattr(ai_router, "extract_lease_change", fake_extract)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "lease_change",
            "summary": "Tenant mentions the lease but not specifics.",
            "body": "Hi, just wanted to ask about the lease at some point soon.",
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.id == UUID(body["target_id"]))
    )
    assert intake is not None
    assert intake.status.value == "needs_attention"
    assert intake.confidence == 0.3


def test_promote_lease_change_soft_fails_when_extractor_raises(
    client: TestClient, session: Session, monkeypatch
) -> None:
    """An extractor exception falls back to v2.0 behaviour like the
    no-API-key case — no 5xx; the intake still gets created."""
    context = _lease_context(client, session)

    def fake_extract(
        *,
        body: str,
        settings: Any,
        lease_snapshot: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str | None]:
        raise LeaseChangeError("OpenAI lease-change request failed.")

    monkeypatch.setattr(ai_router, "extract_lease_change", fake_extract)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "lease_change",
            "summary": "Tenant wants a 12-month extension.",
            "body": "Hi team, can we extend our lease at Unit 3 by twelve months?",
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.id == UUID(body["target_id"]))
    )
    assert intake is not None
    assert intake.status.value == "uploaded"
    assert intake.extracted_data == {}
    assert "extraction_error" in intake.review_data


def test_promote_rejects_property_from_other_entity(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "maintenance_request",
            "summary": "Tenant reports a leak.",
            "body": "Body that is at least ten characters long for validation.",
            "property_id": str(uuid4()),  # Does not exist in the entity.
        },
    )
    assert response.status_code == 404
    assert "Property" in response.json()["detail"]
