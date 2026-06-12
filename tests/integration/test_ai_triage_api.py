"""Inbox triage API tests."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest
from apps.api.routers import ai as ai_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.ai.inbox import InboxTriageError
from stewart.ai.lease_change import LeaseChangeError
from stewart.ai.tenant_contact import TenantContactError
from stewart.ai.vendor_intake import VendorIntakeError
from stewart.core.models import (
    ArrearsCase,
    AuditAction,
    Contractor,
    DocumentCategory,
    DocumentIntake,
    Entity,
    InboundMessage,
    MaintenanceWorkOrder,
    StoredDocument,
    Tenant,
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


def _trusted_mailbox_message(
    session: Session,
    context: dict[str, str],
    *,
    trust_state: str = "trusted",
    classification_kind: str = "maintenance_request",
    classification_summary: str = "Tenant reports a non-urgent tap leak.",
    classification_target_kind: str = "maintenance_work_order",
    subject: str = "Fwd: Kitchen tap leak",
    body_text: str = (
        "Tenant says the kitchen tap at Unit 3 is leaking and the cabinet"
        " is starting to swell. Please arrange a plumber this week."
    ),
) -> tuple[InboundMessage, StoredDocument]:
    raw_document = StoredDocument(
        entity_id=UUID(context["entity_id"]),
        filename="ai-mailbox-test.eml",
        content_type="message/rfc822",
        byte_size=27,
        file_data=b"raw trusted mailbox message",
        category=DocumentCategory.other,
        notes="AI mailbox raw email provenance",
        document_metadata={"source": "ai_mailbox_raw_email"},
    )
    session.add(raw_document)
    session.flush()
    message = InboundMessage(
        entity_id=UUID(context["entity_id"]),
        channel="email",
        provider="sendgrid",
        source="ai_mailbox",
        trust_state=trust_state,
        auth_result={"spf": "pass", "dkim": "pass"},
        original_sender="broker@external.example",
        from_address="temba@leasium.test",
        to_address="ai@leasium.ai",
        subject=subject,
        body_text=body_text,
        classification_kind=classification_kind,
        classification_confidence=0.91,
        classification_summary=classification_summary,
        classification_target_kind=classification_target_kind,
        inbound_metadata={"raw_email_document_id": str(raw_document.id)},
    )
    session.add(message)
    session.flush()
    return message, raw_document


def _mailbox_attachment_intake(
    session: Session,
    context: dict[str, str],
    message: InboundMessage,
) -> tuple[StoredDocument, DocumentIntake]:
    document = StoredDocument(
        entity_id=UUID(context["entity_id"]),
        property_id=UUID(context["property_id"]),
        tenant_id=UUID(context["tenant_id"]),
        lease_id=UUID(context["lease_id"]),
        filename="public-liability-certificate.pdf",
        content_type="application/pdf",
        byte_size=42,
        file_data=b"%PDF-1.4 public liability certificate",
        category=DocumentCategory.other,
        notes="SendGrid inbound email attachment",
        document_metadata={
            "source": "sendgrid_inbound_parse",
            "inbound_message_id": str(message.id),
            "original_filename": "public-liability-certificate.pdf",
        },
    )
    session.add(document)
    session.flush()
    intake = DocumentIntake(
        entity_id=UUID(context["entity_id"]),
        document_id=document.id,
        status="uploaded",
        extracted_data={},
        review_data={
            "source": "sendgrid_inbound_parse",
            "candidate": "inbound_email_attachment",
            "inbound_message_id": str(message.id),
            "inbound_subject": message.subject,
            "inbound_sender": message.from_address,
            "guardrail": (
                "No tenant data, lease data, provider action, or payment record "
                "is changed until an operator applies the Smart Intake review."
            ),
        },
    )
    session.add(intake)
    session.flush()
    document.document_metadata = {
        **document.document_metadata,
        "smart_intake_id": str(intake.id),
        "smart_intake_promoted": True,
    }
    message.inbound_metadata = {
        **(message.inbound_metadata or {}),
        "attachment_intake_count": 1,
        "attachment_document_ids": [str(document.id)],
        "attachment_intake_ids": [str(intake.id)],
    }
    session.flush()
    return document, intake


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
                "suggested_contractor_id": None,
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
        "matched_contractor": False,
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
                "suggested_contractor_id": None,
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
    assert body["suggested_contractor"] is None


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


def test_promote_trusted_mailbox_message_links_raw_provenance_without_retriage(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)
    message, raw_document = _trusted_mailbox_message(session, context)

    def fail_triage(**kwargs):  # noqa: ANN003, ARG001
        raise AssertionError("mailbox promote must use stored classification")

    monkeypatch.setattr(ai_router, "triage_inbox", fail_triage)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "maintenance_request",
            "summary": "Tenant reports a non-urgent tap leak.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()

    work_order = session.scalar(
        select(MaintenanceWorkOrder).where(
            MaintenanceWorkOrder.id == UUID(body["target_id"])
        )
    )
    assert work_order is not None
    ai_metadata = work_order.work_order_metadata["ai_inbox"]
    assert ai_metadata["kind"] == "maintenance_request"
    assert ai_metadata["mailbox"]["inbound_message_id"] == str(message.id)
    assert ai_metadata["mailbox"]["raw_email_document_id"] == str(raw_document.id)
    assert ai_metadata["mailbox"]["subject"] == "Fwd: Kitchen tap leak"
    assert ai_metadata["mailbox"]["sender"] == "broker@external.example"
    assert ai_metadata["mailbox"]["classification_confidence"] == 0.91

    session.refresh(message)
    assert message.processed_at is not None

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.tool_name == "ai_inbox_promote")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.tool_input["inbound_message_id"] == str(message.id)

    duplicate = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "maintenance_request",
            "summary": "Tenant reports a non-urgent tap leak.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert duplicate.status_code == 422
    assert "already" in duplicate.json()["detail"].lower()


def test_promote_compliance_mailbox_message_creates_smart_intake_review(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)
    message, raw_document = _trusted_mailbox_message(
        session,
        context,
        classification_kind="compliance_or_insurance",
        classification_summary="Insurance certificate needs compliance review.",
        classification_target_kind="smart_intake",
        subject="Fwd: Updated public liability certificate",
        body_text=(
            "Attached is the updated public liability certificate for Unit 3."
            " The certificate expires on 30 June 2027 and should be checked"
            " against the current lease obligation."
        ),
    )

    def fail_triage(**kwargs):  # noqa: ANN003, ARG001
        raise AssertionError("mailbox promote must use stored classification")

    monkeypatch.setattr(ai_router, "triage_inbox", fail_triage)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "compliance_or_insurance",
            "summary": "Insurance certificate needs compliance review.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "document_intake"
    assert body["target_href"] == (
        f"/intake?entity_id={context['entity_id']}&review={body['target_id']}"
    )

    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.id == UUID(body["target_id"]))
    )
    assert intake is not None
    assert intake.status.value == "uploaded"
    assert intake.document_type is None
    assert intake.summary == "Insurance certificate needs compliance review."
    assert intake.extracted_data == {}
    assert intake.review_data["source"] == "ai_inbox_promote"
    assert intake.review_data["candidate"] == "compliance_or_insurance"
    assert intake.review_data["mailbox"]["inbound_message_id"] == str(message.id)
    assert intake.review_data["mailbox"]["raw_email_document_id"] == str(
        raw_document.id
    )
    assert intake.document.category == DocumentCategory.other
    assert intake.document.filename == "inbox-compliance-insurance.txt"
    assert b"public liability certificate" in intake.document.file_data
    assert intake.document.document_metadata["source"] == "ai_inbox_promote"
    assert intake.document.document_metadata["mailbox"][
        "inbound_message_id"
    ] == str(message.id)

    session.refresh(message)
    assert message.processed_at is not None

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.tool_name == "ai_inbox_promote")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.target_table == "document_intake"
    assert audit_row.tool_input["kind"] == "compliance_or_insurance"
    assert audit_row.tool_input["inbound_message_id"] == str(message.id)


def test_promote_compliance_mailbox_message_reuses_attachment_intake(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)
    message, raw_document = _trusted_mailbox_message(
        session,
        context,
        classification_kind="compliance_or_insurance",
        classification_summary="Insurance certificate needs compliance review.",
        classification_target_kind="smart_intake",
        subject="Fwd: Updated public liability certificate",
        body_text=(
            "Please review the attached public liability certificate rather than "
            "using this email body as the evidence document."
        ),
    )
    attachment_document, attachment_intake = _mailbox_attachment_intake(
        session, context, message
    )
    existing_document_ids = set(session.scalars(select(StoredDocument.id)).all())
    existing_intake_ids = set(session.scalars(select(DocumentIntake.id)).all())

    def fail_triage(**kwargs):  # noqa: ANN003, ARG001
        raise AssertionError("mailbox promote must use stored classification")

    monkeypatch.setattr(ai_router, "triage_inbox", fail_triage)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "compliance_or_insurance",
            "summary": "Insurance certificate needs compliance review.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "document_intake"
    assert body["target_id"] == str(attachment_intake.id)
    assert body["target_href"] == (
        f"/intake?entity_id={context['entity_id']}&review={attachment_intake.id}"
    )

    assert set(session.scalars(select(StoredDocument.id)).all()) == existing_document_ids
    assert set(session.scalars(select(DocumentIntake.id)).all()) == existing_intake_ids

    session.refresh(attachment_document)
    session.refresh(attachment_intake)
    assert attachment_document.filename == "public-liability-certificate.pdf"
    assert attachment_intake.review_data["source"] == "sendgrid_inbound_parse"
    assert attachment_intake.review_data["candidate"] == "inbound_email_attachment"
    promote_data = attachment_intake.review_data["ai_inbox_promote"]
    assert promote_data["candidate"] == "compliance_or_insurance"
    assert promote_data["mailbox"]["inbound_message_id"] == str(message.id)
    assert promote_data["mailbox"]["raw_email_document_id"] == str(raw_document.id)
    assert attachment_document.document_metadata["ai_inbox_promote"][
        "mailbox"
    ]["inbound_message_id"] == str(message.id)

    session.refresh(message)
    assert message.processed_at is not None

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.tool_name == "ai_inbox_promote")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.target_table == "document_intake"
    assert audit_row.target_id == attachment_intake.id
    assert audit_row.tool_input["source"] == "attachment_intake"
    assert audit_row.tool_input["attachment_intake_id"] == str(attachment_intake.id)


def test_promote_compliance_rejects_stale_attachment_metadata_without_synthesis(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)
    message, _raw_document = _trusted_mailbox_message(
        session,
        context,
        classification_kind="compliance_or_insurance",
        classification_summary="Insurance certificate needs compliance review.",
        classification_target_kind="smart_intake",
        subject="Fwd: Updated public liability certificate",
        body_text="The certificate is attached, but the stored intake id is stale.",
    )
    message.inbound_metadata = {
        **(message.inbound_metadata or {}),
        "attachment_intake_count": 1,
        "attachment_document_ids": [str(uuid4())],
        "attachment_intake_ids": [str(uuid4())],
    }
    session.flush()
    existing_document_ids = set(session.scalars(select(StoredDocument.id)).all())
    existing_intake_ids = set(session.scalars(select(DocumentIntake.id)).all())

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "compliance_or_insurance",
            "summary": "Insurance certificate needs compliance review.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 422
    assert "attachment" in response.json()["detail"].lower()
    assert set(session.scalars(select(StoredDocument.id)).all()) == existing_document_ids
    assert set(session.scalars(select(DocumentIntake.id)).all()) == existing_intake_ids


def test_promote_mailbox_property_update_creates_review_intake(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)
    message, raw_document = _trusted_mailbox_message(
        session,
        context,
        classification_kind="property_update",
        classification_summary="Council rates notice needs property review.",
        classification_target_kind="property",
        subject="Fwd: Council rates notice",
        body_text=(
            "Please review the attached council rates notice for Queen Street "
            "Centre before updating any property records."
        ),
    )

    def fail_triage(**kwargs):  # noqa: ANN003, ARG001
        raise AssertionError("mailbox promote must use stored classification")

    monkeypatch.setattr(ai_router, "triage_inbox", fail_triage)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "property_update",
            "summary": "Council rates notice needs property review.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "document_intake"
    assert body["target_href"] == (
        f"/intake?entity_id={context['entity_id']}&review={body['target_id']}"
    )

    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.id == UUID(body["target_id"]))
    )
    assert intake is not None
    assert intake.status.value == "uploaded"
    assert intake.extracted_data == {}
    assert intake.openai_response_id is None
    assert intake.reviewed_at is None
    assert intake.applied_at is None
    assert intake.review_data["candidate"] == "property_update"
    assert intake.review_data["mailbox"]["raw_email_document_id"] == str(
        raw_document.id
    )
    assert intake.document.filename == "inbox-property-update.txt"
    assert intake.document.property_id == UUID(context["property_id"])
    assert intake.document.document_metadata["candidate"] == "property_update"

    session.refresh(message)
    assert message.processed_at is not None

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.tool_name == "ai_inbox_promote")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.target_table == "document_intake"
    assert audit_row.tool_input["kind"] == "property_update"
    assert audit_row.tool_input["inbound_message_id"] == str(message.id)


@pytest.mark.parametrize(
    ("kind", "classification_target_kind", "summary", "body_text"),
    [
        (
            "property_update",
            "property",
            "Council rates notice needs property review.",
            "Please review the attached council rates notice as the evidence.",
        ),
        (
            "owner_or_entity_admin",
            "smart_intake",
            "Owner billing detail needs admin review.",
            "Please review the attached owner billing detail as the evidence.",
        ),
    ],
)
def test_promote_mailbox_review_kinds_reuse_attachment_intake(
    client: TestClient,
    session: Session,
    monkeypatch,
    kind: str,
    classification_target_kind: str,
    summary: str,
    body_text: str,
) -> None:
    context = _lease_context(client, session)
    message, raw_document = _trusted_mailbox_message(
        session,
        context,
        classification_kind=kind,
        classification_summary=summary,
        classification_target_kind=classification_target_kind,
        subject="Fwd: Attachment-backed mailbox review",
        body_text=body_text,
    )
    attachment_document, attachment_intake = _mailbox_attachment_intake(
        session, context, message
    )
    existing_document_ids = set(session.scalars(select(StoredDocument.id)).all())
    existing_intake_ids = set(session.scalars(select(DocumentIntake.id)).all())

    def fail_triage(**kwargs):  # noqa: ANN003, ARG001
        raise AssertionError("mailbox promote must use stored classification")

    monkeypatch.setattr(ai_router, "triage_inbox", fail_triage)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": kind,
            "summary": summary,
            "body": message.body_text,
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "document_intake"
    assert body["target_id"] == str(attachment_intake.id)
    assert body["target_href"] == (
        f"/intake?entity_id={context['entity_id']}&review={attachment_intake.id}"
    )

    assert set(session.scalars(select(StoredDocument.id)).all()) == existing_document_ids
    assert set(session.scalars(select(DocumentIntake.id)).all()) == existing_intake_ids

    session.refresh(attachment_document)
    session.refresh(attachment_intake)
    promote_data = attachment_intake.review_data["ai_inbox_promote"]
    assert promote_data["candidate"] == kind
    assert promote_data["mailbox"]["inbound_message_id"] == str(message.id)
    assert promote_data["mailbox"]["raw_email_document_id"] == str(raw_document.id)
    assert attachment_document.document_metadata["ai_inbox_promote"][
        "candidate"
    ] == kind

    session.refresh(message)
    assert message.processed_at is not None

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.tool_name == "ai_inbox_promote")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.target_table == "document_intake"
    assert audit_row.target_id == attachment_intake.id
    assert audit_row.tool_input["kind"] == kind
    assert audit_row.tool_input["source"] == "attachment_intake"
    assert audit_row.tool_input["attachment_intake_id"] == str(attachment_intake.id)


@pytest.mark.parametrize("kind", ["property_update", "owner_or_entity_admin"])
def test_promote_mailbox_review_kinds_reject_stale_attachment_metadata(
    client: TestClient, session: Session, kind: str
) -> None:
    context = _lease_context(client, session)
    message, _raw_document = _trusted_mailbox_message(
        session,
        context,
        classification_kind=kind,
        classification_summary="Attachment-backed mailbox review is stale.",
        classification_target_kind="smart_intake",
        subject="Fwd: Stale attachment-backed mailbox review",
        body_text="The attachment id is stale and must not synthesize a fallback.",
    )
    message.inbound_metadata = {
        **(message.inbound_metadata or {}),
        "attachment_intake_count": 1,
        "attachment_document_ids": [str(uuid4())],
        "attachment_intake_ids": [str(uuid4())],
    }
    session.flush()
    existing_document_ids = set(session.scalars(select(StoredDocument.id)).all())
    existing_intake_ids = set(session.scalars(select(DocumentIntake.id)).all())

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": kind,
            "summary": "Attachment-backed mailbox review is stale.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 422
    assert "attachment" in response.json()["detail"].lower()
    assert set(session.scalars(select(StoredDocument.id)).all()) == existing_document_ids
    assert set(session.scalars(select(DocumentIntake.id)).all()) == existing_intake_ids


def test_promote_mailbox_task_or_reminder_creates_operations_work_order(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)
    message, raw_document = _trusted_mailbox_message(
        session,
        context,
        classification_kind="task_or_reminder",
        classification_summary="Follow up the insurer next Tuesday.",
        classification_target_kind="maintenance_work_order",
        subject="Fwd: Insurance follow-up reminder",
        body_text=(
            "Please remind me to follow up the insurer next Tuesday about the "
            "Queen Street Centre claim response."
        ),
    )

    def fail_triage(**kwargs):  # noqa: ANN003, ARG001
        raise AssertionError("mailbox promote must use stored classification")

    monkeypatch.setattr(ai_router, "triage_inbox", fail_triage)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "task_or_reminder",
            "summary": "Follow up the insurer next Tuesday.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "maintenance_work_order"
    assert body["target_href"].startswith("/operations/maintenance/")

    work_order = session.scalar(
        select(MaintenanceWorkOrder).where(
            MaintenanceWorkOrder.id == UUID(body["target_id"])
        )
    )
    assert work_order is not None
    assert work_order.status.value == "requested"
    assert work_order.source_reference == "ai_inbox_promote"
    assert work_order.contractor_name is None
    assert work_order.contractor_email is None
    assert work_order.contractor_phone is None
    assert work_order.contractor_assigned_at is None
    assert work_order.approved_at is None
    assert work_order.invoice_draft_id is None
    assert work_order.work_order_metadata["ai_inbox"]["kind"] == "task_or_reminder"
    assert work_order.work_order_metadata["ai_inbox"]["mailbox"][
        "raw_email_document_id"
    ] == str(raw_document.id)

    session.refresh(message)
    assert message.processed_at is not None

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.tool_name == "ai_inbox_promote")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.target_table == "maintenance_work_order"
    assert audit_row.tool_input["kind"] == "task_or_reminder"


def test_promote_mailbox_owner_admin_creates_review_intake(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)
    message, raw_document = _trusted_mailbox_message(
        session,
        context,
        classification_kind="owner_or_entity_admin",
        classification_summary="Owner billing detail needs admin review.",
        classification_target_kind="smart_intake",
        subject="Fwd: Owner billing detail",
        body_text=(
            "Please review this owner billing detail before changing any owner "
            "or entity administration records."
        ),
    )

    def fail_triage(**kwargs):  # noqa: ANN003, ARG001
        raise AssertionError("mailbox promote must use stored classification")

    monkeypatch.setattr(ai_router, "triage_inbox", fail_triage)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "owner_or_entity_admin",
            "summary": "Owner billing detail needs admin review.",
            "body": message.body_text,
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "document_intake"

    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.id == UUID(body["target_id"]))
    )
    assert intake is not None
    assert intake.status.value == "uploaded"
    assert intake.extracted_data == {}
    assert intake.openai_response_id is None
    assert intake.reviewed_at is None
    assert intake.applied_at is None
    assert intake.review_data["candidate"] == "owner_or_entity_admin"
    assert intake.review_data["mailbox"]["raw_email_document_id"] == str(
        raw_document.id
    )
    assert intake.document.filename == "inbox-owner-admin.txt"
    assert intake.document.document_metadata["candidate"] == "owner_or_entity_admin"

    session.refresh(message)
    assert message.processed_at is not None


def test_promote_mailbox_only_kind_requires_mailbox_provenance(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "property_update",
            "summary": "Council rates notice needs property review.",
            "body": "Please review this council rates notice before updating records.",
            "property_id": context["property_id"],
        },
    )
    assert response.status_code == 422
    assert "mailbox" in response.json()["detail"].lower()

    intake = session.scalar(
        select(DocumentIntake).where(
            DocumentIntake.summary == "Council rates notice needs property review."
        )
    )
    assert intake is None


def test_promote_compliance_requires_mailbox_provenance(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "compliance_or_insurance",
            "summary": "Insurance certificate needs compliance review.",
            "body": (
                "Attached is the updated public liability certificate for Unit 3."
            ),
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
        },
    )
    assert response.status_code == 422
    assert "mailbox" in response.json()["detail"].lower()

    intake = session.scalar(
        select(DocumentIntake).where(
            DocumentIntake.summary == "Insurance certificate needs compliance review."
        )
    )
    assert intake is None


def test_promote_rejects_quarantined_mailbox_message_without_draft(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)
    message, _raw_document = _trusted_mailbox_message(
        session, context, trust_state="quarantined"
    )

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "maintenance_request",
            "summary": "Tenant reports a non-urgent tap leak.",
            "body": message.body_text,
            "property_id": context["property_id"],
            "tenant_id": context["tenant_id"],
            "lease_id": context["lease_id"],
            "inbound_message_id": str(message.id),
        },
    )
    assert response.status_code == 422
    assert "trusted" in response.json()["detail"].lower()

    work_order = session.scalar(
        select(MaintenanceWorkOrder).where(
            MaintenanceWorkOrder.title == "Tenant reports a non-urgent tap leak."
        )
    )
    assert work_order is None
    session.refresh(message)
    assert message.processed_at is None


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
    client: TestClient, session: Session, monkeypatch
) -> None:
    """When OPENAI_API_KEY is unset the extractor raises; promote falls
    back to v2.0 behaviour (uploaded status, empty extracted_data) with
    a warning recorded in review_data — no 5xx."""
    context = _lease_context(client, session)

    def fake_extract(
        *,
        body: str,
        settings: Any,
        lease_snapshot: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str | None]:
        raise LeaseChangeError("OpenAI API key is not configured.")

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
    assert body["target_kind"] == "document_intake"
    assert body["target_href"] == (
        f"/intake?entity_id={context['entity_id']}&review={body['target_id']}"
    )

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
    assert body["target_href"] == (
        f"/intake?entity_id={context['entity_id']}&review={body['target_id']}"
    )
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


# ---------------------------------------------------------------------------
# v2.3: tenant_contact promote path.
# ---------------------------------------------------------------------------


def test_preview_tenant_contact_extracts_reviewable_proposals(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)
    captured: dict[str, Any] = {}

    def fake_extract(
        *,
        body: str,
        settings: Any,
        tenant_snapshot: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str | None]:
        captured["tenant_snapshot"] = tenant_snapshot
        return (
            {
                "summary": "Tenant asked to update the accounts contact.",
                "confidence": 0.87,
                "contact_name": "Jane Accounts",
                "contact_email": "accounts@acmebakery.example",
                "contact_phone": "0411 222 333",
                "billing_email": "accounts@acmebakery.example",
                "warnings": [],
            },
            "resp_tenant_contact_001",
        )

    monkeypatch.setattr(ai_router, "extract_tenant_contact", fake_extract)

    response = client.post(
        "/api/v1/ai/triage/tenant-contact-preview",
        json={
            "entity_id": context["entity_id"],
            "tenant_id": context["tenant_id"],
            "body": (
                "Hi, please use Jane Accounts for our billing contact from"
                " now on: accounts@acmebakery.example or 0411 222 333."
            ),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tenant"]["id"] == context["tenant_id"]
    assert body["confidence"] == 0.87
    assert body["response_id"] == "resp_tenant_contact_001"
    assert captured["tenant_snapshot"]["billing_email"] == (
        "billing@acmebakery.example"
    )
    proposals = {item["field"]: item for item in body["proposed_updates"]}
    assert proposals["contact_name"]["proposed_value"] == "Jane Accounts"
    assert proposals["contact_email"]["current_value"] is None
    assert proposals["billing_email"]["current_value"] == (
        "billing@acmebakery.example"
    )


def test_preview_tenant_contact_soft_fails_without_extractor(
    client: TestClient, session: Session, monkeypatch
) -> None:
    context = _lease_context(client, session)

    def fake_extract(
        *,
        body: str,
        settings: Any,
        tenant_snapshot: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str | None]:
        raise TenantContactError("OpenAI tenant-contact request failed.")

    monkeypatch.setattr(ai_router, "extract_tenant_contact", fake_extract)

    response = client.post(
        "/api/v1/ai/triage/tenant-contact-preview",
        json={
            "entity_id": context["entity_id"],
            "tenant_id": context["tenant_id"],
            "body": "Please update the billing email to accounts@example.test.",
        },
    )
    assert response.status_code == 503
    assert "tenant-contact" in response.json()["detail"]


def test_promote_tenant_contact_updates_selected_fields(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "tenant_contact",
            "summary": "Tenant changed billing contact details.",
            "body": (
                "Please use Jane Accounts on accounts@acmebakery.example and"
                " 0411 222 333 for tenant contact updates."
            ),
            "tenant_id": context["tenant_id"],
            "tenant_contact_updates": {
                "contact_name": "Jane Accounts",
                "contact_email": "accounts@acmebakery.example",
                "contact_phone": "0411 222 333",
            },
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "tenant"
    assert body["target_href"] == f"/tenants/{context['tenant_id']}"

    tenant = session.scalar(
        select(Tenant).where(Tenant.id == UUID(context["tenant_id"]))
    )
    assert tenant is not None
    assert tenant.contact_name == "Jane Accounts"
    assert tenant.contact_email == "accounts@acmebakery.example"
    assert tenant.contact_phone == "0411 222 333"
    assert tenant.billing_email == "billing@acmebakery.example"
    history = tenant.tenant_metadata["ai_inbox_contact_promotions"]
    assert history[-1]["fields"] == [
        "contact_email",
        "contact_name",
        "contact_phone",
    ]

    audit_row = session.scalar(
        select(AuditAction)
        .where(
            AuditAction.tool_name == "ai_inbox_promote",
            AuditAction.target_table == "tenant",
        )
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.action == "update"


def test_promote_tenant_contact_requires_tenant_and_selected_fields(
    client: TestClient, session: Session
) -> None:
    context = _lease_context(client, session)

    missing_tenant = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "tenant_contact",
            "summary": "Tenant changed contact details.",
            "body": "Please update the contact email to accounts@example.test.",
            "tenant_contact_updates": {
                "contact_email": "accounts@example.test",
            },
        },
    )
    assert missing_tenant.status_code == 422
    assert "tenant" in missing_tenant.json()["detail"].lower()

    no_fields = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": context["entity_id"],
            "kind": "tenant_contact",
            "summary": "Tenant changed contact details.",
            "body": "Please update the contact email to accounts@example.test.",
            "tenant_id": context["tenant_id"],
            "tenant_contact_updates": {},
        },
    )
    assert no_fields.status_code == 422
    assert "field" in no_fields.json()["detail"].lower()


# ---------------------------------------------------------------------------
# v2.2: vendor_or_contractor promote path.
# ---------------------------------------------------------------------------


def _seed_contractor(
    client: TestClient,
    entity_id: str,
    *,
    name: str = "Reliable Plumbing",
    company_name: str | None = "Reliable Plumbing Pty Ltd",
    categories: list[str] | None = None,
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/contractors",
        json={
            "entity_id": entity_id,
            "name": name,
            "company_name": company_name,
            "categories": categories or ["plumbing"],
            "email": "ops@reliableplumbing.example",
            "phone": "0400111222",
            "priority": 1,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_promote_vendor_or_contractor_with_match_routes_no_draft(
    client: TestClient, session: Session
) -> None:
    """When the operator passes contractor_id, the promote endpoint
    returns a deep-link to the existing directory entry without
    creating a new Contractor row."""
    entity_id = _entity_id(session)
    contractor = _seed_contractor(client, entity_id)

    contractor_count_before = session.scalar(
        select(Contractor).where(Contractor.entity_id == UUID(entity_id))
    )
    assert contractor_count_before is not None

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": entity_id,
            "kind": "vendor_or_contractor",
            "summary": "Existing plumber following up on a job.",
            "body": (
                "Hi team, this is Reliable Plumbing — just confirming we're"
                " booked in for Unit 3 Queen Street on Tuesday at 9am."
            ),
            "contractor_id": contractor["id"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "contractor"
    assert body["target_id"] == contractor["id"]
    assert body["target_href"] == "/contractors"

    # No additional Contractor rows were created.
    all_contractors = list(
        session.scalars(
            select(Contractor).where(Contractor.entity_id == UUID(entity_id))
        ).all()
    )
    assert len(all_contractors) == 1
    assert str(all_contractors[0].id) == contractor["id"]


def test_promote_vendor_or_contractor_unmatched_extracts_new_contractor(
    client: TestClient, session: Session, monkeypatch
) -> None:
    """When no contractor_id is supplied and the AI extractor succeeds,
    a new Contractor row is created at priority=3 with the extracted
    fields populated."""
    entity_id = _entity_id(session)

    def fake_extract(
        *, body: str, settings: Any
    ) -> tuple[dict[str, Any], str | None]:
        return (
            {
                "name": "Sam Lock",
                "company_name": "Sam's Locksmiths",
                "email": "sam@samslocks.example",
                "phone": "0411 222 333",
                "categories": ["locks"],
                "notes": "Mobile locksmith covering Brisbane CBD.",
                "confidence": 0.78,
                "warnings": [],
            },
            "resp_vendor_intake_001",
        )

    monkeypatch.setattr(ai_router, "extract_vendor_intake", fake_extract)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": entity_id,
            "kind": "vendor_or_contractor",
            "summary": "New locksmith introducing themselves.",
            "body": (
                "G'day, Sam from Sam's Locksmiths here. We're mobile around"
                " Brisbane CBD and would love to be on your panel for"
                " emergency lockouts. Reach me on 0411 222 333 or sam@"
                "samslocks.example."
            ),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_kind"] == "contractor"
    assert body["target_href"] == "/contractors"

    contractor = session.scalar(
        select(Contractor).where(Contractor.id == UUID(body["target_id"]))
    )
    assert contractor is not None
    assert contractor.priority == 3  # Backup tier — operator promotes after review.
    assert contractor.name == "Sam Lock"
    assert contractor.company_name == "Sam's Locksmiths"
    assert contractor.email == "sam@samslocks.example"
    assert contractor.categories == ["locks"]
    metadata = contractor.contractor_metadata
    assert metadata["source"] == "ai_inbox_promote"
    assert metadata["ai_confidence"] == 0.78
    assert metadata["openai_response_id"] == "resp_vendor_intake_001"


def test_promote_vendor_or_contractor_extractor_soft_fails_to_minimal_row(
    client: TestClient, session: Session, monkeypatch
) -> None:
    """When the extractor raises, the operator still gets a draft
    Contractor row seeded from the triage summary so they can fill in
    the rest from /contractors."""
    entity_id = _entity_id(session)

    def fake_extract(
        *, body: str, settings: Any
    ) -> tuple[dict[str, Any], str | None]:
        raise VendorIntakeError("OpenAI vendor intake request failed.")

    monkeypatch.setattr(ai_router, "extract_vendor_intake", fake_extract)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": entity_id,
            "kind": "vendor_or_contractor",
            "summary": "Locksmith introducing themselves.",
            "body": "Hi team, locksmith here, we operate around Brisbane.",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    contractor = session.scalar(
        select(Contractor).where(Contractor.id == UUID(body["target_id"]))
    )
    assert contractor is not None
    assert contractor.name.startswith("Locksmith introducing")
    assert contractor.priority == 3
    assert contractor.categories == []
    assert (
        "extraction_error" in contractor.contractor_metadata
    ), "soft-fail should record why extraction didn't run"


def test_promote_rejects_contractor_from_other_entity(
    client: TestClient, session: Session
) -> None:
    entity_id = _entity_id(session)

    response = client.post(
        "/api/v1/ai/triage/promote",
        json={
            "entity_id": entity_id,
            "kind": "vendor_or_contractor",
            "summary": "Follow-up.",
            "body": "Body that is at least ten characters long for validation.",
            "contractor_id": str(uuid4()),  # Does not exist in entity.
        },
    )
    assert response.status_code == 404
    assert "Contractor" in response.json()["detail"]
