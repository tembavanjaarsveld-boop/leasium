"""Insights overview API integration tests."""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    ArrearsDisputeStatus,
    ArrearsEscalationStatus,
    AuditAction,
    AuditOutcome,
    BillingDraft,
    BillingDraftLine,
    BillingDraftStatus,
    ComplianceCheck,
    ComplianceCheckKind,
    ComplianceCheckStatus,
    ComplianceRecurrenceUnit,
    DocumentCategory,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    InsightsSnapshot,
    InvoiceDraft,
    InvoiceDraftStatus,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    StoredDocument,
    TenantOnboarding,
    TenantOnboardingStatus,
    UserRole,
)


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def test_insights_portfolio_rollup_aggregates_across_entities(
    client: TestClient,
    session: Session,
) -> None:
    seed = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seed is not None
    organisation_id = str(seed.organisation_id)

    second = client.post(
        "/api/v1/entities",
        json={
            "organisation_id": organisation_id,
            "name": "Rivergum Trust",
            "entity_type": "trust",
        },
    ).json()
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": second["id"],
            "name": "Rivergum House",
            "street_address": "9 Rivergum Road",
            "property_type": "residential",
        },
    )
    assert property_response.status_code == 201

    response = client.get("/api/v1/insights/portfolio-rollup")
    assert response.status_code == 200
    body = response.json()
    rows = {row["name"]: row for row in body["entities"]}

    assert "Rivergum Trust" in rows
    assert rows["Rivergum Trust"]["property_count"] == 1
    assert rows["Rivergum Trust"]["occupancy_pct"] is None

    totals = body["totals"]
    assert totals["entity_count"] == len(body["entities"])
    assert totals["entity_count"] >= 2
    assert totals["property_count"] >= 1


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
            "next_review_date": "2026-06-15",
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
        invoice_metadata={
            "delivery_state": {
                "delivery_ready": True,
                "pdf_generated": True,
                "pdf_artifact_stored": True,
                "tenant_email_sent": False,
            },
            "payment_status": {
                "status": "unpaid",
                "paid_cents": 0,
                "outstanding_cents": 100000,
            },
            "posting_preparation": {
                "external_posting_status": "approved_not_synced",
                "xero_synced": False,
            },
            "xero_posting_approval": {"state": "approved", "approved": True},
        },
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
    smart_intake_exception = next(
        item for item in body["live_exceptions"] if item["kind"] == "smart_intake"
    )
    assert smart_intake_exception["href"] == (
        f"/intake?entity_id={entity_id}&review={intake.id}"
    )

    assert body["billing_risk"]["blocked_row_count"] == 2
    assert body["billing_risk"]["blocker_count"] >= 1
    assert body["billing_risk"]["xero_blocker_count"] >= 1
    assert body["billing_risk"]["approved_unsynced_invoice_count"] == 1
    assert body["billing_risk"]["unpaid_invoice_count"] == 1
    assert body["billing_risk"]["billing_draft_counts"]["approved"] == 1
    assert body["billing_risk"]["invoice_draft_counts"]["approved"] == 1
    assert body["finance_snapshot"]["configured_charges_cents"] > 0
    assert body["finance_snapshot"]["approved_unsynced_invoice_count"] == 1
    invoice_status = body["invoice_status_snapshot"]
    assert invoice_status["total_invoice_count"] == 1
    assert invoice_status["approved_count"] == 1
    assert invoice_status["approved_unsynced_count"] == 1
    assert invoice_status["ready_to_send_count"] == 1
    assert invoice_status["sent_count"] == 0
    assert invoice_status["unpaid_count"] == 1
    assert invoice_status["overdue_count"] == 0
    assert invoice_status["xero_failed_count"] == 0
    assert invoice_status["total_cents"] == 100000
    assert invoice_status["outstanding_cents"] == 100000
    assert invoice_status["status_counts"] == {"approved": 1}
    assert invoice_status["payment_status_counts"] == {"unpaid": 1}
    assert invoice_status["delivery_status_counts"] == {"ready": 1}
    assert invoice_status["posting_status_counts"] == {"approved_not_synced": 1}
    invoice_item = invoice_status["next_items"][0]
    assert invoice_item["title"] == "May rent"
    assert invoice_item["invoice_number"] == "INV-0001"
    assert invoice_item["property_name"] == "Queen Street Retail"
    assert invoice_item["tenant_name"] == "No Email Retail Pty Ltd"
    assert invoice_item["total_cents"] == 100000
    assert invoice_item["outstanding_cents"] == 100000
    assert invoice_item["payment_status"] == "unpaid"
    assert invoice_item["delivery_status"] == "ready"
    assert invoice_item["posting_status"] == "approved_not_synced"
    assert invoice_item["chip"] == "In 13d"
    assert invoice_item["href"].startswith("/billing-readiness?tab=delivery&")
    accounting = body["finance_snapshot"]["accounting_readiness"]
    assert accounting["status"] in {"ready", "missing", "stale", "attention"}
    assert accounting["generated_at"] is not None
    assert accounting["source"] == "local_metadata"
    assert accounting["approved_unsynced_invoice_count"] == 1
    assert accounting["readiness_issue_count"] >= 1
    assert accounting["readiness_blocker_count"] >= 1
    assert "local Leasium metadata only" in accounting["guardrails"][0]

    snapshot = body["owner_entity_snapshot"]
    assert snapshot["ownership_profile_counts"]["trust"] == 1
    assert snapshot["missing_owner_abn_count"] == 1
    assert snapshot["missing_trustee_count"] == 1
    assert snapshot["missing_xero_contact_count"] == 1
    assert snapshot["accounting_readiness"]["status"] == accounting["status"]

    lease_events = body["lease_event_snapshot"]
    assert lease_events["active_lease_count"] == 1
    assert lease_events["next_review_count"] == 1
    assert any(item["kind"] == "rent_review" for item in lease_events["next_events"])

    activity = body["automation_activity"]
    assert activity
    assert "tool_input" not in activity[0]
    assert "do-not-return" not in response.text
    assert body["guardrails"][0] == "Insights is read-only and does not mutate portfolio records."


def test_insights_overview_summarises_compliance_and_inspection_risk(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    as_of = "2026-05-19"

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Fortitude Valley Arcade",
            "street_address": "18 Wickham Street",
            "suburb": "Fortitude Valley",
            "state": "QLD",
            "postcode": "4006",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 6"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Valley Books Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2025-07-01",
            "expiry_date": "2028-06-30",
            "annual_rent_cents": 960000,
            "rent_frequency": "monthly",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    evidence_document_id = uuid4()
    fire_safety_obligation = Obligation(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        lease_id=UUID(lease_id),
        title="Fire safety certificate renewal",
        category=ObligationCategory.compliance,
        status=ObligationStatus.overdue,
        due_date=date(2026, 5, 10),
        priority=1,
        owner_role=UserRole.ops,
        obligation_metadata={
            "compliance_type": "fire_safety",
            "document_type": "inspection_report",
            "evidence_document_ids": [str(evidence_document_id)],
            "evidence_history": [
                {
                    "document_id": str(evidence_document_id),
                    "linked_at": "2026-05-11T01:02:03Z",
                    "actor": "ops@example.test",
                }
            ],
        },
    )
    bank_guarantee_obligation = Obligation(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        lease_id=UUID(lease_id),
        title="Bank guarantee expiry",
        category=ObligationCategory.bank_guarantee,
        status=ObligationStatus.upcoming,
        due_date=date(2026, 6, 1),
        priority=2,
        owner_role=UserRole.finance,
        obligation_metadata={},
    )
    maintenance_obligation = Obligation(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        title="HVAC quarterly service",
        category=ObligationCategory.maintenance,
        status=ObligationStatus.upcoming,
        due_date=date(2026, 5, 25),
        priority=2,
        obligation_metadata={},
    )
    session.add_all(
        [fire_safety_obligation, bank_guarantee_obligation, maintenance_obligation]
    )
    urgent_work_order = MaintenanceWorkOrder(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        tenant_id=UUID(tenant_id),
        lease_id=UUID(lease_id),
        title="Front counter leak",
        description="Tenant reports water near the counter.",
        status=MaintenanceWorkOrderStatus.requested,
        priority=MaintenancePriority.urgent,
        requested_at=datetime(2026, 4, 28, tzinfo=UTC),
        due_date=date(2026, 5, 15),
        contractor_name="Cool Air Services",
        quote_amount_cents=220000,
    )
    assigned_work_order = MaintenanceWorkOrder(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        tenant_id=UUID(tenant_id),
        lease_id=UUID(lease_id),
        title="Back door closer",
        status=MaintenanceWorkOrderStatus.assigned,
        priority=MaintenancePriority.normal,
        requested_at=datetime(2026, 5, 14, tzinfo=UTC),
        due_date=date(2026, 5, 28),
        contractor_name="Door Tech QLD",
    )
    closed_work_order = MaintenanceWorkOrder(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        tenant_id=UUID(tenant_id),
        lease_id=UUID(lease_id),
        title="Completed light fitting",
        status=MaintenanceWorkOrderStatus.completed,
        priority=MaintenancePriority.low,
        requested_at=datetime(2026, 4, 9, tzinfo=UTC),
        completed_at=utcnow(),
    )
    session.add_all([urgent_work_order, assigned_work_order, closed_work_order])
    disputed_arrears = ArrearsCase(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        tenant_id=UUID(tenant_id),
        lease_id=UUID(lease_id),
        status=ArrearsCaseStatus.active,
        as_of=date(2026, 5, 19),
        balance_current_cents=0,
        balance_1_30_cents=0,
        balance_31_60_cents=440000,
        balance_61_90_cents=0,
        balance_90_plus_cents=0,
        total_balance_cents=440000,
        oldest_unpaid_invoice_date=date(2026, 4, 1),
        last_invoice_date=date(2026, 5, 1),
        reminder_stage=2,
        reminder_frequency_days=7,
        next_reminder_on=date(2026, 5, 18),
        dispute_status=ArrearsDisputeStatus.raised,
        promise_to_pay_date=date(2026, 5, 24),
        promise_to_pay_amount_cents=220000,
        notes="Tenant queried outgoings allocation.",
    )
    escalated_arrears = ArrearsCase(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        tenant_id=UUID(tenant_id),
        lease_id=UUID(lease_id),
        status=ArrearsCaseStatus.monitoring,
        as_of=date(2026, 5, 19),
        balance_current_cents=0,
        balance_1_30_cents=0,
        balance_31_60_cents=0,
        balance_61_90_cents=0,
        balance_90_plus_cents=125000,
        total_balance_cents=125000,
        oldest_unpaid_invoice_date=date(2026, 2, 10),
        reminder_stage=3,
        next_reminder_on=date(2026, 5, 23),
        escalation_status=ArrearsEscalationStatus.queued,
        escalation_queue="Legal review",
        source_reference="February invoice run",
    )
    resolved_arrears = ArrearsCase(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        tenant_id=UUID(tenant_id),
        lease_id=UUID(lease_id),
        status=ArrearsCaseStatus.resolved,
        as_of=date(2026, 5, 19),
        total_balance_cents=0,
    )
    session.add_all([disputed_arrears, escalated_arrears, resolved_arrears])
    session.commit()

    response = client.get(f"/api/v1/insights/overview?entity_id={entity_id}&as_of={as_of}")
    assert response.status_code == 200
    compliance = response.json()["compliance_snapshot"]

    assert compliance["open_count"] == 2
    assert compliance["overdue_count"] == 1
    assert compliance["due_soon_count"] == 1
    assert compliance["missing_evidence_count"] == 1
    assert compliance["evidence_linked_count"] == 1
    assert compliance["delegated_owner_count"] == 2
    assert compliance["fire_safety_count"] == 1
    assert compliance["inspection_report_count"] == 1
    assert compliance["category_counts"] == {"compliance": 1, "bank_guarantee": 1}

    titles = [item["title"] for item in compliance["next_items"]]
    assert titles == ["Fire safety certificate renewal", "Bank guarantee expiry"]

    fire_item = compliance["next_items"][0]
    assert fire_item["property_name"] == "Fortitude Valley Arcade"
    assert fire_item["unit_label"] == "Shop 6"
    assert fire_item["tenant_name"] == "Valley Books Pty Ltd"
    assert fire_item["owner_role"] == "ops"
    assert fire_item["evidence_count"] == 1
    assert fire_item["evidence_event_count"] == 1
    assert fire_item["latest_evidence_actor"] == "ops@example.test"
    assert fire_item["inspection_type"] == "fire_safety"
    assert fire_item["chip"] == "9d overdue"
    assert fire_item["href"] == "/tasks"

    maintenance = response.json()["maintenance_snapshot"]
    assert maintenance["open_count"] == 2
    assert maintenance["urgent_count"] == 1
    assert maintenance["overdue_count"] == 1
    assert maintenance["contractor_assigned_count"] == 2
    assert maintenance["aged_14_day_count"] == 1
    assert maintenance["oldest_age_days"] == 21
    assert maintenance["status_counts"] == {"requested": 1, "assigned": 1}
    assert maintenance["priority_counts"] == {"urgent": 1, "normal": 1}

    maintenance_titles = [item["title"] for item in maintenance["next_items"]]
    assert maintenance_titles == ["Front counter leak", "Back door closer"]

    maintenance_item = maintenance["next_items"][0]
    assert maintenance_item["property_name"] == "Fortitude Valley Arcade"
    assert maintenance_item["unit_label"] == "Shop 6"
    assert maintenance_item["tenant_name"] == "Valley Books Pty Ltd"
    assert maintenance_item["contractor_name"] == "Cool Air Services"
    assert maintenance_item["quote_amount_cents"] == 220000
    assert maintenance_item["age_days"] == 21
    assert maintenance_item["chip"] == "4d overdue"
    assert maintenance_item["href"].startswith("/operations/maintenance/")

    arrears = response.json()["arrears_snapshot"]
    assert arrears["open_count"] == 2
    assert arrears["total_balance_cents"] == 565000
    assert arrears["overdue_reminder_count"] == 1
    assert arrears["disputed_count"] == 1
    assert arrears["escalated_count"] == 1
    assert arrears["promise_to_pay_count"] == 1
    assert arrears["aged_30_day_count"] == 2
    assert arrears["aged_90_day_count"] == 1
    assert arrears["oldest_age_days"] == 98
    assert arrears["status_counts"] == {"active": 1, "monitoring": 1}
    assert arrears["dispute_counts"] == {"raised": 1, "none": 1}
    assert arrears["escalation_counts"] == {"none": 1, "queued": 1}

    arrears_titles = [item["title"] for item in arrears["next_items"]]
    assert arrears_titles == [
        "Valley Books Pty Ltd arrears",
        "Valley Books Pty Ltd arrears",
    ]

    arrears_item = arrears["next_items"][0]
    assert arrears_item["property_name"] == "Fortitude Valley Arcade"
    assert arrears_item["unit_label"] == "Shop 6"
    assert arrears_item["tenant_name"] == "Valley Books Pty Ltd"
    assert arrears_item["total_balance_cents"] == 440000
    assert arrears_item["age_days"] == 48
    assert arrears_item["chip"] == "1d overdue"
    assert arrears_item["promise_to_pay_date"] == "2026-05-24"
    assert arrears_item["href"].startswith("/operations?tab=arrears&case_id=")


def test_insights_snapshots_freeze_public_payload_and_revoke(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/insights/snapshots",
        json={
            "entity_id": entity_id,
            "snapshot_type": "finance",
            "as_of": "2026-05-19",
            "expires_in_days": 30,
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["snapshot_type"] == "finance"
    assert created["token"]
    assert created["share_url"].endswith(f"/snapshots/{created['token']}")
    assert created["payload"]["entity"]["name"] == "SKJ Property Pty Ltd"

    stored = session.get(InsightsSnapshot, UUID(created["id"]))
    assert stored is not None
    assert stored.token_hash != created["token"]
    assert len(stored.token_hash or "") == 64

    public_response = client.get(f"/api/v1/insights/snapshots/public/{created['token']}")
    assert public_response.status_code == 200
    public_body = public_response.json()
    assert public_body["payload"]["entity"]["name"] == "SKJ Property Pty Ltd"
    assert public_body["payload"]["finance_snapshot"]["ready_to_bill_count"] >= 0
    assert public_body["payload"]["finance_snapshot"]["accounting_readiness"]["status"]
    assert (
        public_body["payload"]["finance_snapshot"]["accounting_readiness"]["generated_at"]
        is not None
    )
    assert (
        public_body["payload"]["finance_snapshot"]["accounting_readiness"]["source"]
        == "local_metadata"
    )
    assert "tool_input" not in public_response.text

    list_response = client.get(f"/api/v1/insights/snapshots?entity_id={entity_id}")
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == created["id"]
    assert list_response.json()[0]["share_url"] is None

    revoke_response = client.post(f"/api/v1/insights/snapshots/{created['id']}/revoke")
    assert revoke_response.status_code == 200
    assert revoke_response.json()["revoked_at"] is not None
    revoked_public_response = client.get(
        f"/api/v1/insights/snapshots/public/{created['token']}"
    )
    assert revoked_public_response.status_code == 404


def test_expired_insights_snapshot_public_link_is_blocked(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    create_response = client.post(
        "/api/v1/insights/snapshots",
        json={
            "entity_id": entity_id,
            "snapshot_type": "owner",
            "as_of": "2026-05-19",
            "expires_in_days": 1,
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()

    snapshot = session.get(InsightsSnapshot, UUID(created["id"]))
    assert snapshot is not None
    snapshot.expires_at = utcnow() - timedelta(days=1)
    session.commit()

    public_response = client.get(f"/api/v1/insights/snapshots/public/{created['token']}")
    assert public_response.status_code == 404


def test_insights_compliance_snapshot_reflects_register_completion_and_evidence(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    as_of = "2026-05-19"

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Register Compliance Tower",
            "street_address": "200 Edward Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    evidence_document_id = uuid4()
    # Current (rolled-forward) obligation backed by a recurring check that has
    # an operator-approved completion with evidence.
    tracked_obligation = Obligation(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        title="Annual fire safety statement",
        category=ObligationCategory.compliance,
        status=ObligationStatus.due_soon,
        due_date=date(2026, 6, 10),
        priority=1,
        owner_role=UserRole.ops,
        obligation_metadata={"compliance_type": "fire_safety"},
    )
    session.add(tracked_obligation)
    session.flush()

    completed_check = ComplianceCheck(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        title="Annual fire safety statement",
        kind=ComplianceCheckKind.fire_safety,
        status=ComplianceCheckStatus.active,
        recurrence_interval=1,
        recurrence_unit=ComplianceRecurrenceUnit.years,
        next_due_date=date(2026, 6, 10),
        owner_role=UserRole.ops,
        source_document_id=evidence_document_id,
        current_obligation_id=tracked_obligation.id,
        check_metadata={
            "completion_history": [
                {
                    "completed_at": "2026-05-10T03:04:05+00:00",
                    "approved_at": "2026-05-10T03:04:05+00:00",
                    "approved_by": "ops@example.test",
                    "actor": "ops@example.test",
                    "operator_approved": True,
                    "source_document_id": str(evidence_document_id),
                    "next_due_date": "2026-06-10",
                }
            ],
        },
    )

    # A separate, still-overdue compliance obligation with no recurring check.
    overdue_obligation = Obligation(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        title="Lift registration overdue",
        category=ObligationCategory.compliance,
        status=ObligationStatus.overdue,
        due_date=date(2026, 5, 1),
        priority=1,
        obligation_metadata={},
    )
    session.add_all([completed_check, overdue_obligation])
    session.commit()

    response = client.get(f"/api/v1/insights/overview?entity_id={entity_id}&as_of={as_of}")
    assert response.status_code == 200
    compliance = response.json()["compliance_snapshot"]

    # Roll-forward + overdue accounting via the raw obligations is unchanged.
    assert compliance["open_count"] == 2
    assert compliance["overdue_count"] == 1
    assert compliance["due_soon_count"] == 1

    # Register-completion roll-up reflects the operator-approved evidence.
    assert compliance["tracked_check_count"] == 1
    assert compliance["operator_approved_evidence_count"] == 1
    assert compliance["recently_completed_count"] == 1

    items = {item["title"]: item for item in compliance["next_items"]}

    tracked_item = items["Annual fire safety statement"]
    assert tracked_item["register_check_id"] == str(completed_check.id)
    assert tracked_item["operator_approved_evidence"] is True
    assert tracked_item["last_completed_by"] == "ops@example.test"
    assert tracked_item["last_completed_at"] is not None

    overdue_item = items["Lift registration overdue"]
    assert overdue_item["status"] == "overdue"
    assert overdue_item["register_check_id"] is None
    assert overdue_item["operator_approved_evidence"] is False
    assert overdue_item["last_completed_at"] is None


def test_insights_overview_is_read_only_for_compliance_register(
    client: TestClient,
    session: Session,
) -> None:
    """The overview must not mutate the register or fire any provider call."""
    entity_id = _entity_id(session)

    tracked_obligation = Obligation(
        entity_id=UUID(entity_id),
        title="Sprinkler certification",
        category=ObligationCategory.compliance,
        status=ObligationStatus.due_soon,
        due_date=date(2026, 6, 10),
        priority=1,
        obligation_metadata={},
    )
    session.add(tracked_obligation)
    session.flush()

    check = ComplianceCheck(
        entity_id=UUID(entity_id),
        title="Sprinkler certification",
        kind=ComplianceCheckKind.fire_safety,
        status=ComplianceCheckStatus.active,
        recurrence_interval=1,
        recurrence_unit=ComplianceRecurrenceUnit.years,
        next_due_date=date(2026, 6, 10),
        current_obligation_id=tracked_obligation.id,
        check_metadata={
            "completion_history": [
                {
                    "approved_at": "2026-05-10T03:04:05+00:00",
                    "approved_by": "ops@example.test",
                    "operator_approved": True,
                }
            ]
        },
    )
    session.add(check)
    session.commit()

    # Read the persisted values back so the comparison is DB-consistent
    # (SQLite round-trips drop tzinfo); we are asserting no mutation, not tz shape.
    session.refresh(check)
    session.refresh(tracked_obligation)
    check_updated_at = check.updated_at
    obligation_status_before = tracked_obligation.status

    response = client.get(
        f"/api/v1/insights/overview?entity_id={entity_id}&as_of=2026-05-19"
    )
    assert response.status_code == 200

    session.refresh(check)
    session.refresh(tracked_obligation)
    # No write to the register, its obligation, or its evidence linkage.
    assert check.updated_at == check_updated_at
    assert check.next_due_date == date(2026, 6, 10)
    assert tracked_obligation.status == obligation_status_before
    assert tracked_obligation.completed_at is None
    # No provider mutation surfaces leak through the read-only payload.
    assert "tool_input" not in response.text
