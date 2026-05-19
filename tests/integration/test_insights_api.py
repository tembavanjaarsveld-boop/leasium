"""Insights overview API integration tests."""

from datetime import date
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditAction,
    AuditOutcome,
    BillingDraft,
    BillingDraftLine,
    BillingDraftStatus,
    DocumentCategory,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    StoredDocument,
    TenantOnboarding,
    TenantOnboardingStatus,
)


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def test_insights_overview_summarises_live_operations_without_leaking_tool_inputs(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    as_of = "2026-05-19"

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Queen Street Retail",
            "street_address": "100 Queen Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
            "ownership_structure": "trust",
            "owner_legal_name": "Queen Street Property Trust",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 1"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    vacant_unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 2"},
    )
    assert vacant_unit_response.status_code == 201

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "No Email Retail Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "annual_rent_cents": 1200000,
            "rent_frequency": "monthly",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    charge_response = client.post(
        "/api/v1/charge-rules",
        json={
            "lease_id": lease_id,
            "charge_type": "base_rent",
            "amount_cents": 100000,
            "frequency": "monthly",
            "gst_treatment": "taxable",
            "next_due_date": "2026-06-01",
        },
    )
    assert charge_response.status_code == 201

    obligation_response = client.post(
        "/api/v1/obligations",
        json={
            "entity_id": entity_id,
            "property_id": property_id,
            "tenancy_unit_id": unit_id,
            "lease_id": lease_id,
            "title": "Renew public liability insurance",
            "category": "insurance",
            "status": "upcoming",
            "due_date": "2026-05-15",
            "priority": 1,
        },
    )
    assert obligation_response.status_code == 201

    document = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        filename="invoice.pdf",
        content_type="application/pdf",
        byte_size=12,
        file_data=b"invoice data",
        category=DocumentCategory.invoice,
    )
    session.add(document)
    session.flush()
    intake = DocumentIntake(
        entity_id=UUID(entity_id),
        document_id=document.id,
        status=DocumentIntakeStatus.ready_for_review,
        document_type="invoice_admin",
        summary="Admin invoice ready for review.",
        confidence=0.86,
    )
    billing_draft = BillingDraft(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        tenant_id=UUID(tenant_id),
        lease_id=UUID(lease_id),
        document_id=document.id,
        document_intake_id=intake.id,
        status=BillingDraftStatus.approved,
        title="May rent",
        due_date=date(2026, 6, 1),
        total_cents=100000,
    )
    session.add_all([intake, billing_draft])
    session.flush()
    session.add(
        BillingDraftLine(
            billing_draft_id=billing_draft.id,
            description="Base rent",
            amount_cents=100000,
            source_hint="invoice.pdf page 1",
        )
    )
    invoice_draft = InvoiceDraft(
        entity_id=UUID(entity_id),
        billing_draft_id=billing_draft.id,
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        tenant_id=UUID(tenant_id),
        lease_id=UUID(lease_id),
        document_id=document.id,
        document_intake_id=intake.id,
        status=InvoiceDraftStatus.approved,
        invoice_number="INV-0001",
        title="May rent",
        due_date=date(2026, 6, 1),
        subtotal_cents=100000,
        gst_cents=0,
        total_cents=100000,
        recipient_name="No Email Retail Pty Ltd",
        invoice_metadata={"payment_status": {"status": "unpaid"}},
    )
    onboarding = TenantOnboarding(
        entity_id=UUID(entity_id),
        lease_id=UUID(lease_id),
        tenant_id=UUID(tenant_id),
        token="insights-token",
        status=TenantOnboardingStatus.submitted,
        due_date=date(2026, 5, 20),
        submitted_data={"contact_name": "Ada"},
    )
    audit = AuditAction(
        request_id=uuid4(),
        actor="test",
        entity_id=UUID(entity_id),
        target_table="invoice_draft",
        target_id=invoice_draft.id,
        action="send_preview",
        tool_name="invoice.delivery",
        tool_input={"secret": "do-not-return"},
        tool_output_summary="Prepared invoice delivery preview.",
        outcome=AuditOutcome.success,
        occurred_at=utcnow(),
    )
    session.add_all([invoice_draft, onboarding, audit])
    session.commit()

    response = client.get(f"/api/v1/insights/overview?entity_id={entity_id}&as_of={as_of}")
    assert response.status_code == 200
    body = response.json()

    assert body["entity"]["name"] == "SKJ Property Pty Ltd"
    assert body["portfolio_health"]["property_count"] == 1
    assert body["portfolio_health"]["unit_count"] == 2
    assert body["portfolio_health"]["active_lease_count"] == 1
    assert body["portfolio_health"]["vacant_unit_count"] == 1
    assert body["portfolio_health"]["overdue_obligation_count"] == 1
    assert body["portfolio_health"]["smart_intake_waiting_count"] == 1
    assert body["portfolio_health"]["tenant_onboarding_waiting_count"] == 1

    exception_kinds = {item["kind"] for item in body["live_exceptions"]}
    assert {
        "obligation",
        "tenant_onboarding",
        "smart_intake",
        "billing_readiness",
        "xero_readiness",
    }.issubset(exception_kinds)

    assert body["billing_risk"]["blocked_row_count"] == 2
    assert body["billing_risk"]["blocker_count"] >= 1
    assert body["billing_risk"]["xero_blocker_count"] >= 1
    assert body["billing_risk"]["approved_unsynced_invoice_count"] == 1
    assert body["billing_risk"]["unpaid_invoice_count"] == 1
    assert body["billing_risk"]["billing_draft_counts"]["approved"] == 1
    assert body["billing_risk"]["invoice_draft_counts"]["approved"] == 1

    snapshot = body["owner_entity_snapshot"]
    assert snapshot["ownership_profile_counts"]["trust"] == 1
    assert snapshot["missing_owner_abn_count"] == 1
    assert snapshot["missing_trustee_count"] == 1
    assert snapshot["missing_xero_contact_count"] == 1

    activity = body["automation_activity"]
    assert activity
    assert "tool_input" not in activity[0]
    assert "do-not-return" not in response.text
    assert body["guardrails"][0] == "Insights is read-only and does not mutate portfolio records."
