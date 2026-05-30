"""Comms queue API tests.

Covers the read-only comms queue endpoint introduced as the foundation of the
scheduled comms loop in ``docs/automation-strategy-2026-05-23.md``. v1 returns
arrears reminder drafts only; future slices extend to document-chase and
lease-event drafts.
"""

import base64
import hashlib
import hmac
from datetime import date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    AuditAction,
    AuditOutcome,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    InboundMessage,
    Lease,
    LeaseStatus,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    PropertyType,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _twilio_signature(url: str, data: dict[str, str], auth_token: str) -> str:
    payload = url + "".join(f"{key}{data[key]}" for key in sorted(data))
    digest = hmac.new(
        auth_token.encode(),
        payload.encode(),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode()


def _seed_arrears(session: Session) -> dict[str, str]:
    """Seed a minimal property + unit + tenant + lease + active arrears case."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Queen Street Retail Centre",
        street_address="12 Queen Street",
        suburb="Brisbane City",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Shop 1")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Arrears Tenant Pty Ltd",
        trading_name="Arrears Cafe",
        contact_name="Mia Hart",
        contact_email="mia@arrears.example",
        contact_phone="+61 400 111 222",
        billing_email="accounts@arrears.example",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date(2025, 1, 1),
        expiry_date=date(2028, 12, 31),
    )
    session.add(lease)
    session.flush()
    case = ArrearsCase(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        lease_id=lease.id,
        status=ArrearsCaseStatus.active,
        currency="AUD",
        as_of=date.today(),
        balance_current_cents=0,
        balance_1_30_cents=0,
        balance_31_60_cents=0,
        balance_61_90_cents=0,
        balance_90_plus_cents=420_000,
        total_balance_cents=420_000,
        oldest_unpaid_invoice_date=date.today() - timedelta(days=120),
        last_invoice_date=date.today() - timedelta(days=30),
        reminder_stage=1,
    )
    session.add(case)
    session.commit()
    return {
        "entity_id": str(entity.id),
        "tenant_id": str(tenant.id),
        "lease_id": str(lease.id),
        "property_id": str(prop.id),
        "unit_id": str(unit.id),
        "case_id": str(case.id),
    }


def test_comms_queue_returns_arrears_reminder_for_active_case(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_arrears(session)

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["entity_id"] == scope["entity_id"]
    assert isinstance(body["candidates"], list)
    assert len(body["candidates"]) == 1
    candidate = body["candidates"][0]
    assert candidate["kind"] == "arrears_reminder"
    assert candidate["target_kind"] == "arrears_case"
    assert candidate["target_id"] == scope["case_id"]
    assert candidate["tenant_id"] == scope["tenant_id"]
    assert candidate["tenant_name"] == "Arrears Cafe"
    assert candidate["property_name"] == "Queen Street Retail Centre"
    assert candidate["unit_label"] == "Shop 1"
    assert candidate["recipient_email"] == "mia@arrears.example"
    assert candidate["recipient_phone"] == "+61 400 111 222"
    # Severity should be danger because 90+ bucket is non-zero.
    assert candidate["severity"] == "danger"
    # Subject and body should reference the location.
    assert "Queen Street Retail Centre" in candidate["subject"]
    assert "Queen Street Retail Centre" in candidate["body"]
    assert "Shop 1" in candidate["body"]
    # Body should include the amount with currency.
    assert "$4,200.00 AUD" in candidate["body"]
    # ID is a stable composite of kind:target_kind:target_id.
    assert candidate["id"] == f"arrears_reminder:arrears_case:{scope['case_id']}"


def test_comms_queue_skips_paused_and_future_reminder_cases(
    client: TestClient,
    session: Session,
) -> None:
    """Cases the operator has chosen to defer are excluded from the queue."""

    scope = _seed_arrears(session)
    case = session.get(ArrearsCase, UUID(scope["case_id"]))
    assert case is not None
    case.reminder_paused_until = date.today() + timedelta(days=14)
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )

    assert response.status_code == 200
    assert response.json()["candidates"] == []

    # Future scheduled reminder also defers the case out of the queue.
    case.reminder_paused_until = None
    case.next_reminder_on = date.today() + timedelta(days=7)
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )
    assert response.status_code == 200
    assert response.json()["candidates"] == []


def test_comms_queue_skips_resolved_and_zero_balance_cases(
    client: TestClient,
    session: Session,
) -> None:
    """Resolved or zero-balance cases never appear in the queue."""

    scope = _seed_arrears(session)
    case = session.get(ArrearsCase, UUID(scope["case_id"]))
    assert case is not None
    case.status = ArrearsCaseStatus.resolved
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )
    assert response.status_code == 200
    assert response.json()["candidates"] == []

    # Zero-balance active case also skipped.
    case.status = ArrearsCaseStatus.active
    case.total_balance_cents = 0
    case.balance_90_plus_cents = 0
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )
    assert response.status_code == 200
    assert response.json()["candidates"] == []


def test_comms_queue_empty_portfolio_returns_no_candidates(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["candidates"] == []


def test_comms_tenant_correspondence_returns_inbound_and_reviewed_actions(
    client: TestClient,
    session: Session,
) -> None:
    """Tenant correspondence is a read-only timeline of local comms evidence."""

    scope = _seed_arrears(session)
    entity_id = UUID(scope["entity_id"])
    tenant_id = UUID(scope["tenant_id"])
    case_id = UUID(scope["case_id"])
    inbound = InboundMessage(
        entity_id=entity_id,
        channel="email",
        provider="sendgrid",
        from_address="mia@arrears.example",
        to_address="inbound@leasium.example",
        subject="Broken tap",
        body_text="The bathroom tap is leaking again. Can you please help?",
        classification_kind="maintenance",
        classification_summary="Tenant reports a leaking bathroom tap.",
        attributed_tenant_id=tenant_id,
        raw_payload={},
        inbound_metadata={"attachment_intake_count": 0},
        created_at=datetime(2026, 5, 21, 2, 0, 0),
    )
    entity = session.get(Entity, entity_id)
    assert entity is not None
    mismatched_entity = Entity(
        organisation_id=entity.organisation_id,
        name="Other Entity Pty Ltd",
    )
    unrelated_tenant = Tenant(
        entity_id=entity_id,
        legal_name="Other Tenant Pty Ltd",
        contact_email="other@example.test",
    )
    session.add_all([inbound, mismatched_entity, unrelated_tenant])
    session.flush()
    mismatched_inbound = InboundMessage(
        entity_id=mismatched_entity.id,
        channel="email",
        provider="sendgrid",
        from_address="cross-entity@example.test",
        subject="Cross-entity message",
        body_text="This row has a mismatched entity and attributed tenant.",
        attributed_tenant_id=tenant_id,
        raw_payload={},
        inbound_metadata={},
        created_at=datetime(2026, 5, 21, 2, 30, 0),
    )
    unrelated_inbound = InboundMessage(
        entity_id=entity_id,
        channel="email",
        provider="sendgrid",
        from_address="other@example.test",
        subject="Should not show",
        body_text="Unrelated tenant message.",
        attributed_tenant_id=unrelated_tenant.id,
        raw_payload={},
        inbound_metadata={},
    )
    session.add_all([mismatched_inbound, unrelated_inbound])
    dispatch_row = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dispatch",
        target_table="arrears_case",
        target_id=case_id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": f"arrears_reminder:arrears_case:{case_id}",
            "kind": "arrears_reminder",
            "channel": "email",
            "recipient": "mia@arrears.example",
        },
        tool_output_summary="comms draft email queued",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    dispatch_row.occurred_at = datetime(2026, 5, 21, 2, 20, 0)
    dismiss_row = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dismiss",
        target_table="inbound_message",
        target_id=inbound.id,
        tool_name="comms.queue",
        tool_input={
            "candidate_id": f"inbound_email:inbound_message:{inbound.id}",
            "kind": "inbound_email",
            "channel": "email",
            "reason": "Already handled by phone.",
        },
        tool_output_summary="inbound email deferred",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    dismiss_row.occurred_at = datetime(2026, 5, 21, 2, 10, 0)
    generic_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dispatch",
        target_table="arrears_case",
        target_id=case_id,
        tool_name="workflow.dispatch",
        tool_input={
            "candidate_id": f"arrears_reminder:arrears_case:{case_id}",
            "kind": "arrears_reminder",
            "reason": "Non-comms workflow action.",
        },
        tool_output_summary="unrelated workflow dispatch",
        outcome=AuditOutcome.success,
        data_classification="internal",
    )
    generic_dispatch.occurred_at = datetime(2026, 5, 21, 2, 25, 0)
    session.commit()

    response = client.get(f"/api/v1/comms/correspondence/tenants/{tenant_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["entity_id"] == scope["entity_id"]
    assert body["tenant_id"] == scope["tenant_id"]
    assert body["tenant_name"] == "Arrears Cafe"
    assert any("read-only" in guardrail for guardrail in body["guardrails"])
    events = body["events"]
    assert len(events) == 3
    assert {event["source"] for event in events} == {
        "inbound_message",
        "comms_audit",
    }
    assert [event["summary"] for event in events] == [
        "comms draft email queued",
        "inbound email deferred",
        "Tenant reports a leaking bathroom tap.",
    ]
    assert {event["event_type"] for event in events} >= {
        "inbound_email",
        "dispatch",
        "dismiss",
    }
    inbound_event = next(event for event in events if event["source"] == "inbound_message")
    assert inbound_event["direction"] == "inbound"
    assert inbound_event["channel"] == "email"
    assert inbound_event["subject"] == "Broken tap"
    assert "leaking again" in inbound_event["body_preview"]
    assert inbound_event["summary"] == "Tenant reports a leaking bathroom tap."
    dispatch_event = next(
        event
        for event in events
        if event["event_type"] == "dispatch"
        and event["target_kind"] == "arrears_case"
    )
    assert dispatch_event["direction"] == "outbound"
    assert dispatch_event["provider"] == "sendgrid"
    assert dispatch_event["recipient"] == "mia@arrears.example"
    assert dispatch_event["summary"] == "comms draft email queued"
    dismiss_event = next(event for event in events if event["event_type"] == "dismiss")
    assert dismiss_event["direction"] == "internal"
    assert dismiss_event["target_id"] == str(inbound.id)
    assert "Should not show" not in str(events)
    assert "Cross-entity message" not in str(events)
    assert "unrelated workflow dispatch" not in str(events)


def test_comms_outbound_log_returns_recent_dispatch_receipts(
    client: TestClient,
    session: Session,
) -> None:
    """Outbound log is a read-only view of entity-scoped comms dispatch receipts."""

    scope = _seed_arrears(session)
    entity_id = UUID(scope["entity_id"])
    tenant_id = UUID(scope["tenant_id"])
    lease_id = UUID(scope["lease_id"])
    case_id = UUID(scope["case_id"])
    entity = session.get(Entity, entity_id)
    assert entity is not None
    other_entity = Entity(
        organisation_id=entity.organisation_id,
        name="Other Entity Pty Ltd",
    )
    session.add(other_entity)
    session.flush()

    email_row = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dispatch",
        target_table="arrears_case",
        target_id=case_id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": f"arrears_reminder:arrears_case:{case_id}",
            "kind": "arrears_reminder",
            "channel": "email",
            "recipient": "mia@arrears.example",
        },
        tool_output_summary="comms draft email queued",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    email_row.occurred_at = datetime(2026, 5, 21, 2, 20, 0)
    lease_row = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dispatch",
        target_table="lease",
        target_id=lease_id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": f"rent_review:lease:{lease_id}",
            "kind": "rent_review",
            "channel": "email",
            "recipient": "mia@arrears.example",
        },
        tool_output_summary="rent review email queued",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    lease_row.occurred_at = datetime(2026, 5, 21, 2, 15, 0)
    sms_row = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dispatch",
        target_table="inbound_message",
        target_id=case_id,
        tool_name="twilio.twilio",
        tool_input={
            "candidate_id": f"inbound_sms:inbound_message:{case_id}",
            "kind": "inbound_sms",
            "channel": "sms",
            "recipient": "+61400111222",
        },
        tool_output_summary="comms draft sms failed",
        outcome=AuditOutcome.error,
        error_message="Twilio Messaging is not configured.",
        data_classification="confidential",
    )
    sms_row.occurred_at = datetime(2026, 5, 21, 2, 30, 0)
    dismiss_row = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dismiss",
        target_table="arrears_case",
        target_id=case_id,
        tool_name="comms.queue",
        tool_input={
            "candidate_id": f"arrears_reminder:arrears_case:{case_id}",
            "kind": "arrears_reminder",
            "channel": "email",
        },
        tool_output_summary="arrears reminder deferred",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    dismiss_row.occurred_at = datetime(2026, 5, 21, 2, 25, 0)
    generic_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dispatch",
        target_table="arrears_case",
        target_id=case_id,
        tool_name="workflow.dispatch",
        tool_input={
            "candidate_id": f"arrears_reminder:arrears_case:{case_id}",
            "kind": "arrears_reminder",
            "reason": "Non-comms workflow action.",
        },
        tool_output_summary="unrelated workflow dispatch",
        outcome=AuditOutcome.success,
        data_classification="internal",
    )
    generic_dispatch.occurred_at = datetime(2026, 5, 21, 2, 35, 0)
    mismatched_candidate = audit_log(
        session,
        actor="dev@test",
        entity_id=entity_id,
        action="dispatch",
        target_table="arrears_case",
        target_id=case_id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": f"arrears_reminder:lease:{case_id}",
            "kind": "arrears_reminder",
            "channel": "email",
        },
        tool_output_summary="mismatched comms dispatch",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    mismatched_candidate.occurred_at = datetime(2026, 5, 21, 2, 40, 0)
    other_entity_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=other_entity.id,
        action="dispatch",
        target_table="arrears_case",
        target_id=case_id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": f"arrears_reminder:arrears_case:{case_id}",
            "kind": "arrears_reminder",
            "channel": "email",
        },
        tool_output_summary="other entity comms dispatch",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    other_entity_dispatch.occurred_at = datetime(2026, 5, 21, 2, 45, 0)
    session.commit()

    response = client.get(
        "/api/v1/comms/outbound-log",
        params={"entity_id": str(entity_id)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["entity_id"] == scope["entity_id"]
    assert any("read-only" in guardrail for guardrail in body["guardrails"])
    events = body["events"]
    assert [event["summary"] for event in events] == [
        "comms draft sms failed",
        "comms draft email queued",
        "rent review email queued",
    ]
    assert [event["direction"] for event in events] == [
        "outbound",
        "outbound",
        "outbound",
    ]
    sms_event = events[0]
    assert sms_event["event_type"] == "dispatch"
    assert sms_event["channel"] == "sms"
    assert sms_event["provider"] == "twilio"
    assert sms_event["recipient"] == "+61400111222"
    assert sms_event["status"] == "error"
    assert sms_event["target_kind"] == "inbound_message"
    assert sms_event["metadata"]["kind"] == "inbound_sms"
    assert sms_event["metadata"]["error"] == "Twilio Messaging is not configured."
    lease_event = next(event for event in events if event["target_kind"] == "lease")
    assert lease_event["target_id"] == str(lease_id)
    assert lease_event["metadata"]["tenant_id"] == str(tenant_id)
    assert "arrears reminder deferred" not in str(events)
    assert "unrelated workflow dispatch" not in str(events)
    assert "mismatched comms dispatch" not in str(events)
    assert "other entity comms dispatch" not in str(events)


def test_comms_maintenance_correspondence_returns_work_order_receipts(
    client: TestClient,
    session: Session,
) -> None:
    """Maintenance correspondence is a read-only target-linked receipt timeline."""

    entity = _entity(session)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Maintenance Tenant Pty Ltd",
        trading_name="Maintenance Cafe",
        contact_email="maintenance.tenant@example.test",
    )
    session.add(tenant)
    session.flush()
    work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        tenant_id=tenant.id,
        title="Leaking ceiling",
        status=MaintenanceWorkOrderStatus.in_progress,
        priority=MaintenancePriority.normal,
        contractor_name="FixCo",
        contractor_email="fixco@example.test",
    )
    other_work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        title="Other maintenance",
        status=MaintenanceWorkOrderStatus.in_progress,
        priority=MaintenancePriority.normal,
    )
    other_entity = Entity(
        organisation_id=entity.organisation_id,
        name="Maintenance Other Entity Pty Ltd",
    )
    session.add_all([work_order, other_work_order, other_entity])
    session.flush()

    contractor_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=entity.id,
        action="dispatch",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": (
                "maintenance_contractor_forward:"
                f"maintenance_work_order:{work_order.id}"
            ),
            "kind": "maintenance_contractor_forward",
            "channel": "email",
            "recipient": "fixco@example.test",
        },
        tool_output_summary="contractor forward email queued",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    contractor_dispatch.occurred_at = datetime(2026, 5, 21, 2, 30, 0)
    tenant_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=entity.id,
        action="dispatch",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name="twilio.twilio",
        tool_input={
            "candidate_id": (
                f"maintenance_tenant_forward:maintenance_work_order:{work_order.id}"
            ),
            "kind": "maintenance_tenant_forward",
            "channel": "sms",
            "recipient": "+61400111222",
        },
        tool_output_summary="tenant forward sms failed",
        outcome=AuditOutcome.error,
        error_message="Twilio Messaging is not configured.",
        data_classification="confidential",
    )
    tenant_dispatch.occurred_at = datetime(2026, 5, 21, 2, 20, 0)
    dismiss_row = audit_log(
        session,
        actor="dev@test",
        entity_id=entity.id,
        action="dismiss",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name="comms.dismiss",
        tool_input={
            "candidate_id": (
                "maintenance_contractor_forward:"
                f"maintenance_work_order:{work_order.id}"
            ),
            "kind": "maintenance_contractor_forward",
            "deferred_until": "2026-05-28",
            "reason": "Contractor already called.",
        },
        tool_output_summary="contractor forward deferred",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    dismiss_row.occurred_at = datetime(2026, 5, 21, 2, 10, 0)
    generic_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=entity.id,
        action="dispatch",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name="workflow.dispatch",
        tool_input={
            "candidate_id": (
                "maintenance_contractor_forward:"
                f"maintenance_work_order:{work_order.id}"
            ),
            "kind": "maintenance_contractor_forward",
        },
        tool_output_summary="generic maintenance workflow dispatch",
        outcome=AuditOutcome.success,
        data_classification="internal",
    )
    generic_dispatch.occurred_at = datetime(2026, 5, 21, 2, 40, 0)
    mismatched_candidate = audit_log(
        session,
        actor="dev@test",
        entity_id=entity.id,
        action="dispatch",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": (
                "maintenance_contractor_forward:"
                f"maintenance_work_order:{other_work_order.id}"
            ),
            "kind": "maintenance_contractor_forward",
        },
        tool_output_summary="mismatched maintenance dispatch",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    mismatched_candidate.occurred_at = datetime(2026, 5, 21, 2, 45, 0)
    other_target_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=entity.id,
        action="dispatch",
        target_table="maintenance_work_order",
        target_id=other_work_order.id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": (
                "maintenance_contractor_forward:"
                f"maintenance_work_order:{other_work_order.id}"
            ),
            "kind": "maintenance_contractor_forward",
        },
        tool_output_summary="other work order dispatch",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    other_target_dispatch.occurred_at = datetime(2026, 5, 21, 2, 50, 0)
    other_entity_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=other_entity.id,
        action="dispatch",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": (
                "maintenance_contractor_forward:"
                f"maintenance_work_order:{work_order.id}"
            ),
            "kind": "maintenance_contractor_forward",
        },
        tool_output_summary="other entity maintenance dispatch",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    other_entity_dispatch.occurred_at = datetime(2026, 5, 21, 2, 55, 0)
    session.commit()

    response = client.get(
        f"/api/v1/comms/correspondence/maintenance-work-orders/{work_order.id}",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["entity_id"] == str(entity.id)
    assert body["work_order_id"] == str(work_order.id)
    assert body["work_order_title"] == "Leaking ceiling"
    assert any("read-only" in guardrail for guardrail in body["guardrails"])
    events = body["events"]
    assert [event["summary"] for event in events] == [
        "contractor forward email queued",
        "tenant forward sms failed",
        "contractor forward deferred",
    ]
    assert [event["direction"] for event in events] == [
        "outbound",
        "outbound",
        "internal",
    ]
    assert events[0]["provider"] == "sendgrid"
    assert events[0]["metadata"]["tenant_id"] == str(tenant.id)
    assert events[1]["provider"] == "twilio"
    assert events[1]["metadata"]["error"] == "Twilio Messaging is not configured."
    assert events[2]["event_type"] == "dismiss"
    assert "generic maintenance workflow dispatch" not in str(events)
    assert "mismatched maintenance dispatch" not in str(events)
    assert "other work order dispatch" not in str(events)
    assert "other entity maintenance dispatch" not in str(events)


def _seed_lease_only(session: Session, expiry_in_days: int) -> dict[str, str]:
    """Seed a property + unit + tenant + active lease without an arrears case.

    Used by the v2 candidate tests so the queue only ever returns one kind.
    """

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Renewal Building",
        street_address="20 Renewal Street",
        suburb="Brisbane City",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_office,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Suite 5")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Renewal Tenant Pty Ltd",
        trading_name="Renewal Co",
        contact_name="Sam Renewal",
        contact_email="sam@renewal.example",
        contact_phone="+61 400 333 444",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date.today() - timedelta(days=365),
        expiry_date=date.today() + timedelta(days=expiry_in_days),
    )
    session.add(lease)
    session.commit()
    return {
        "entity_id": str(entity.id),
        "tenant_id": str(tenant.id),
        "lease_id": str(lease.id),
        "property_id": str(prop.id),
        "unit_id": str(unit.id),
    }


def test_comms_queue_returns_lease_renewal_candidate(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_lease_only(session, expiry_in_days=45)

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )

    assert response.status_code == 200
    body = response.json()
    candidates = body["candidates"]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["kind"] == "lease_renewal"
    assert candidate["target_kind"] == "lease"
    assert candidate["target_id"] == scope["lease_id"]
    assert candidate["property_name"] == "Renewal Building"
    assert candidate["unit_label"] == "Suite 5"
    # 45 days out → warning tier.
    assert candidate["severity"] == "warning"
    assert "Renewal Building" in candidate["subject"]
    assert "Suite 5" in candidate["body"]


def test_comms_queue_lease_renewal_skips_far_future_expiry(
    client: TestClient,
    session: Session,
) -> None:
    _seed_lease_only(session, expiry_in_days=200)
    entity = _entity(session)

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert response.status_code == 200
    assert response.json()["candidates"] == []


def test_comms_dispatch_arrears_records_audit_and_bumps_reminder_stage(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Dispatch fires the SendGrid wire and clocks the arrears reminder."""

    scope = _seed_arrears(session)
    calls: list[dict[str, object]] = []

    from apps.api.routers import comms as comms_router

    def fake_send(*, recipient_email, subject, body, entity_id, candidate_id, kind, settings):  # noqa: ANN001, ARG001
        calls.append(
            {
                "recipient_email": recipient_email,
                "subject": subject,
                "body": body,
                "kind": kind,
            }
        )
        return comms_router._CommsEmailResult(
            status="queued",
            provider="sendgrid",
            recipient=recipient_email,
            provider_message_id="comms-msg-1",
        )

    monkeypatch.setattr(comms_router, "_send_comms_email", fake_send)

    response = client.post(
        "/api/v1/comms/dispatch",
        json={
            "kind": "arrears_reminder",
            "target_kind": "arrears_case",
            "target_id": scope["case_id"],
            "subject": "Urgent: outstanding rent",
            "body": "Hi Arrears Cafe, please clear the balance.",
            "recipient_email": "mia@arrears.example",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "queued"
    assert body["candidate_id"] == f"arrears_reminder:arrears_case:{scope['case_id']}"
    assert body["recipient"] == "mia@arrears.example"
    assert calls == [
        {
            "recipient_email": "mia@arrears.example",
            "subject": "Urgent: outstanding rent",
            "body": "Hi Arrears Cafe, please clear the balance.",
            "kind": "arrears_reminder",
        }
    ]

    case = session.get(ArrearsCase, UUID(scope["case_id"]))
    assert case is not None
    assert case.reminder_stage == 2  # was 1 from seed, +1 after dispatch
    assert case.last_reminder_at is not None
    assert case.next_reminder_on is not None


def test_comms_queue_returns_rent_review_with_fixed_pct_formula(
    client: TestClient,
    session: Session,
) -> None:
    """A lease with next_review_date in 45 days and a fixed_pct formula
    surfaces as a rent_review candidate with the new rent calculated."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Review Tower",
        street_address="50 Review Street",
        suburb="Brisbane City",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_office,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Level 3")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Review Tenant Pty Ltd",
        contact_name="Pat Review",
        contact_email="pat@review.example",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date.today() - timedelta(days=365),
        expiry_date=date.today() + timedelta(days=730),
        annual_rent_cents=120_000_00,  # $120,000
        next_review_date=date.today() + timedelta(days=45),
        lease_metadata={
            "rent_review": {
                "kind": "fixed_pct",
                "increase_pct": 3.0,
            }
        },
    )
    session.add(lease)
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert response.status_code == 200
    rent_reviews = [
        c for c in response.json()["candidates"] if c["kind"] == "rent_review"
    ]
    assert len(rent_reviews) == 1
    candidate = rent_reviews[0]
    assert candidate["target_kind"] == "lease"
    assert candidate["target_id"] == str(lease.id)
    assert candidate["property_name"] == "Review Tower"
    assert candidate["unit_label"] == "Level 3"
    # 45 days out → info severity (≤30 is warning, ≤0 is danger).
    assert candidate["severity"] == "info"
    assert "Review Tower" in candidate["subject"]
    # Body should reference current rent ($120,000) and new rent
    # ($120,000 * 1.03 = $123,600).
    assert "$120,000 AUD" in candidate["body"]
    assert "$123,600 AUD" in candidate["body"]
    assert "3% fixed increase" in candidate["body"]


def test_comms_queue_rent_review_without_formula_surfaces_with_needs_rule(
    client: TestClient,
    session: Session,
) -> None:
    """A lease due for review without a formula on lease_metadata still
    surfaces but without a calculated new rent."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="No-Formula House",
        street_address="9 No Formula Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Shop 9")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="No Formula Tenant Pty Ltd",
        contact_email="t@noformula.example",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        annual_rent_cents=84_000_00,
        next_review_date=date.today() + timedelta(days=20),
        # No rent_review metadata.
    )
    session.add(lease)
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    rent_reviews = [
        c for c in response.json()["candidates"] if c["kind"] == "rent_review"
    ]
    assert len(rent_reviews) == 1
    candidate = rent_reviews[0]
    # 20 days out → warning severity.
    assert candidate["severity"] == "warning"
    # Body does NOT contain a "proposed new rent" line — operator sets the
    # formula before dispatch.
    assert "Proposed new annual rent" not in candidate["body"]
    assert "needs increase rule" in (candidate["detail"] or "")


def test_comms_queue_rent_review_skips_far_future_review(
    client: TestClient,
    session: Session,
) -> None:
    """Reviews more than 60 days out don't appear in the queue yet."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Far Future",
        street_address="1 Far Future Road",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="A1")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Far Future Tenant Pty Ltd",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        annual_rent_cents=60_000_00,
        next_review_date=date.today() + timedelta(days=200),
    )
    session.add(lease)
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    rent_reviews = [
        c for c in response.json()["candidates"] if c["kind"] == "rent_review"
    ]
    assert rent_reviews == []


def test_comms_dispatch_rent_review_stamps_lease_metadata(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Approved rent-review emails get a lease-scoped comms stamp."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Rent Dispatch Tower",
        street_address="3 Review Lane",
        property_type=PropertyType.commercial_office,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Level 9")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Rent Dispatch Tenant Pty Ltd",
        contact_email="rent-dispatch@example.test",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        annual_rent_cents=120_000_00,
        next_review_date=date.today() + timedelta(days=20),
        lease_metadata={
            "rent_review": {"kind": "fixed_pct", "increase_pct": 3.0},
        },
    )
    session.add(lease)
    session.commit()

    from apps.api.routers import comms as comms_router

    def fake_send_email(*, recipient_email, subject, body, entity_id, candidate_id, kind, settings):  # noqa: ANN001, ARG001
        return comms_router._CommsEmailResult(
            status="queued",
            provider="sendgrid",
            recipient=recipient_email,
            provider_message_id="sg-rent-review-1",
        )

    monkeypatch.setattr(comms_router, "_send_comms_email", fake_send_email)

    response = client.post(
        "/api/v1/comms/dispatch",
        json={
            "kind": "rent_review",
            "target_kind": "lease",
            "target_id": str(lease.id),
            "subject": "Upcoming rent review",
            "body": "Please review the proposed annual rent.",
            "recipient_email": "rent-dispatch@example.test",
        },
    )

    assert response.status_code == 201
    assert response.json()["provider_message_id"] == "sg-rent-review-1"
    session.refresh(lease)
    comms_stamp = lease.lease_metadata[comms_router.DISMISS_METADATA_KEY][
        "rent_review"
    ]
    assert comms_stamp["dispatched_at"]
    assert date.fromisoformat(comms_stamp["next_eligible_on"]) > date.today()
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert queue.status_code == 200
    assert [
        candidate
        for candidate in queue.json()["candidates"]
        if candidate["kind"] == "rent_review"
    ] == []


def test_comms_dismiss_rent_review_stamps_lease_metadata(
    client: TestClient,
    session: Session,
) -> None:
    """Dismissed rent-review candidates record the operator deferral."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Rent Dismiss Tower",
        street_address="4 Review Lane",
        property_type=PropertyType.commercial_office,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Level 10")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Rent Dismiss Tenant Pty Ltd",
        contact_email="rent-dismiss@example.test",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        annual_rent_cents=120_000_00,
        next_review_date=date.today() + timedelta(days=20),
    )
    session.add(lease)
    session.commit()

    response = client.post(
        "/api/v1/comms/dismiss",
        json={
            "kind": "rent_review",
            "target_kind": "lease",
            "target_id": str(lease.id),
            "reason": "operator will confirm CPI rule first",
        },
    )

    assert response.status_code == 201
    deferred_until = response.json()["deferred_until"]
    session.refresh(lease)
    from apps.api.routers import comms as comms_router

    comms_stamp = lease.lease_metadata[comms_router.DISMISS_METADATA_KEY][
        "rent_review"
    ]
    assert comms_stamp["deferred_until"] == deferred_until
    assert comms_stamp["reason"] == "operator will confirm CPI rule first"
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert queue.status_code == 200
    assert [
        candidate
        for candidate in queue.json()["candidates"]
        if candidate["kind"] == "rent_review"
    ] == []


def _seed_lifecycle_onboarding(
    session: Session,
    *,
    signing: dict[str, object],
    lease_status: LeaseStatus = LeaseStatus.pending,
    contact_email: str | None = "life@example.com",
) -> dict[str, str]:
    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Lifecycle House",
        street_address="88 Lifecycle Road",
        property_type=PropertyType.commercial_office,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Suite L")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Lifecycle Tenant Pty Ltd",
        trading_name="Lifecycle Co",
        contact_name="Lane Lifecycle",
        contact_email=contact_email,
        contact_phone="+61 400 777 888",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=lease_status,
        commencement_date=date.today() - timedelta(days=15),
        expiry_date=date.today() + timedelta(days=730),
    )
    session.add(lease)
    session.flush()
    onboarding = TenantOnboarding(
        entity_id=entity.id,
        lease_id=lease.id,
        tenant_id=tenant.id,
        token=f"lifecycle-{lease.id}",
        status=TenantOnboardingStatus.applied,
        delivery_data={"lease_agreement": {"signing": signing}},
    )
    session.add(onboarding)
    session.commit()
    return {
        "entity_id": str(entity.id),
        "tenant_id": str(tenant.id),
        "lease_id": str(lease.id),
        "onboarding_id": str(onboarding.id),
    }


def test_comms_queue_returns_pending_docusign_waiting_candidate(
    client: TestClient,
    session: Session,
) -> None:
    sent_at = (date.today() - timedelta(days=8)).isoformat()
    scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": "sent",
            "envelope_id": "envelope-waiting-1",
            "sent_at": sent_at,
        },
    )

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )

    assert response.status_code == 200
    candidates = [
        c
        for c in response.json()["candidates"]
        if c["kind"] == "tenant_lifecycle_stall"
    ]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["target_kind"] == "tenant_onboarding"
    assert candidate["target_id"] == scope["onboarding_id"]
    assert candidate["tenant_id"] == scope["tenant_id"]
    assert candidate["recipient_email"] == "life@example.com"
    assert candidate["severity"] == "warning"
    assert "DocuSign envelope waiting" in candidate["subject"]
    assert "envelope-waiting-1" in (candidate["detail"] or "")


@pytest.mark.parametrize("signing_status", ["declined", "failed"])
def test_comms_queue_returns_declined_or_failed_docusign_retry_candidate(
    client: TestClient,
    session: Session,
    signing_status: str,
) -> None:
    scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": signing_status,
            "envelope_id": f"envelope-{signing_status}-1",
            "last_event": f"envelope-{signing_status}",
            "last_event_at": (date.today() - timedelta(days=1)).isoformat(),
        },
    )

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )

    assert response.status_code == 200
    candidates = [
        c
        for c in response.json()["candidates"]
        if c["kind"] == "tenant_lifecycle_stall"
    ]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["target_kind"] == "tenant_onboarding"
    assert candidate["target_id"] == scope["onboarding_id"]
    assert candidate["severity"] == "danger"
    assert "DocuSign retry needed" in candidate["subject"]
    assert signing_status in (candidate["detail"] or "")


def test_comms_queue_returns_skipped_docusign_setup_retry_candidate(
    client: TestClient,
    session: Session,
) -> None:
    error = (
        "DocuSign production endpoints are not configured. Set "
        "DOCUSIGN_BASE_URL=https://www.docusign.net/restapi and "
        "DOCUSIGN_AUTH_BASE_URL=https://account.docusign.com before sending "
        "live lease envelopes."
    )
    scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": "skipped",
            "document_id": "lease-doc-skipped-1",
            "error": error,
            "sent_at": (date.today() - timedelta(days=1)).isoformat(),
        },
    )

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )

    assert response.status_code == 200
    candidates = [
        c
        for c in response.json()["candidates"]
        if c["kind"] == "tenant_lifecycle_stall"
    ]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["target_kind"] == "tenant_onboarding"
    assert candidate["target_id"] == scope["onboarding_id"]
    assert candidate["severity"] == "danger"
    assert "DocuSign setup needed" in candidate["subject"]
    assert "skipped" in (candidate["detail"] or "")
    assert "DOCUSIGN_BASE_URL" in (candidate["detail"] or "")
    assert "provider setup needs attention" in candidate["body"]
    assert "DOCUSIGN_BASE_URL" not in candidate["body"]
    assert "DOCUSIGN_AUTH_BASE_URL" not in candidate["body"]
    assert "before sending live lease envelopes" not in candidate["body"]


def test_comms_queue_returns_completed_signing_pending_activation_candidate(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": "completed",
            "envelope_id": "envelope-completed-1",
            "signed_at": (date.today() - timedelta(days=2)).isoformat(),
            "lease_activation_review": {
                "status": "ready_for_review",
                "current_lease_status": "pending",
                "recommended_status": "active",
            },
        },
    )

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )

    assert response.status_code == 200
    candidates = [
        c
        for c in response.json()["candidates"]
        if c["kind"] == "tenant_lifecycle_stall"
    ]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["target_kind"] == "tenant_onboarding"
    assert candidate["target_id"] == scope["onboarding_id"]
    assert candidate["severity"] == "danger"
    assert "Lease activation review" in candidate["subject"]
    assert "ready_for_review" in (candidate["detail"] or "")


def test_comms_queue_returns_tenant_upload_activation_review_candidate(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "tenant_upload",
            "status": "completed",
            "signed_document_id": "tenant-uploaded-lease-1",
            "signed_at": (date.today() - timedelta(days=1)).isoformat(),
            "lease_activation_review": {
                "status": "ready_for_review",
                "current_lease_status": "pending",
                "recommended_status": "active",
            },
        },
    )

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )

    assert response.status_code == 200
    candidates = [
        c
        for c in response.json()["candidates"]
        if c["kind"] == "tenant_lifecycle_stall"
    ]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["target_kind"] == "tenant_onboarding"
    assert candidate["target_id"] == scope["onboarding_id"]
    assert candidate["severity"] == "danger"
    assert "Lease activation review" in candidate["subject"]
    assert "tenant upload completed" in (candidate["detail"] or "")


def test_comms_queue_counts_include_urgent_tenant_lifecycle_reviews(
    client: TestClient,
    session: Session,
) -> None:
    docusign_scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": "declined",
            "envelope_id": "envelope-counts-declined-1",
            "last_event": "envelope-declined",
            "last_event_at": (date.today() - timedelta(days=1)).isoformat(),
        },
        contact_email="counts-docusign@example.com",
    )
    _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "tenant_upload",
            "status": "completed",
            "signed_document_id": "tenant-uploaded-lease-counts-1",
            "signed_at": (date.today() - timedelta(days=1)).isoformat(),
            "lease_activation_review": {
                "status": "ready_for_review",
                "current_lease_status": "pending",
                "recommended_status": "active",
            },
        },
        contact_email="counts-upload@example.com",
    )
    _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": "skipped",
            "document_id": "lease-doc-counts-skipped-1",
            "error": "DocuSign production endpoints are not configured.",
            "sent_at": (date.today() - timedelta(days=1)).isoformat(),
        },
        contact_email="counts-skipped@example.com",
    )

    response = client.get(
        "/api/v1/comms/queue/counts",
        params={"entity_id": docusign_scope["entity_id"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["urgent"] == 3
    assert body["by_kind"]["tenant_lifecycle_stall"] == 3


def test_comms_queue_counts_are_cached_per_entity(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """The badge counts endpoint caches per entity so back-to-back page loads
    do not re-run the full queue scan, while still recomputing once the short
    TTL elapses. Counts stay identical to a fresh scan."""

    from apps.api.routers import comms as comms_router

    scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": "declined",
            "envelope_id": "envelope-counts-cache-1",
            "last_event": "envelope-declined",
            "last_event_at": (date.today() - timedelta(days=1)).isoformat(),
        },
        contact_email="counts-cache@example.com",
    )
    entity_id = scope["entity_id"]

    # Start from a clean cache and count how often the scan actually runs.
    comms_router._queue_counts_cache.clear()
    calls = {"n": 0}
    original = comms_router._tenant_lifecycle_stall_candidates

    def counting(entity, sess):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        return original(entity, sess)

    monkeypatch.setattr(
        comms_router, "_tenant_lifecycle_stall_candidates", counting
    )

    first = client.get("/api/v1/comms/queue/counts", params={"entity_id": entity_id})
    second = client.get("/api/v1/comms/queue/counts", params={"entity_id": entity_id})

    assert first.status_code == 200
    assert second.status_code == 200
    # Second request is served from the cache: the scan ran only once.
    assert calls["n"] == 1
    # Cached payload is identical to the freshly computed one.
    assert second.json()["total"] == first.json()["total"]
    assert second.json()["by_kind"] == first.json()["by_kind"]

    # Once the TTL elapses the next request recomputes (counts unchanged).
    monkeypatch.setattr(comms_router, "_QUEUE_COUNTS_TTL_SECONDS", 0.0)
    third = client.get("/api/v1/comms/queue/counts", params={"entity_id": entity_id})
    assert third.status_code == 200
    assert calls["n"] == 2
    assert third.json()["total"] == first.json()["total"]


def test_comms_dismiss_tenant_lifecycle_stall_defers_candidate(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": "declined",
            "envelope_id": "envelope-dismissed-1",
            "last_event_at": (date.today() - timedelta(days=1)).isoformat(),
        },
    )

    response = client.post(
        "/api/v1/comms/dismiss",
        json={
            "kind": "tenant_lifecycle_stall",
            "target_kind": "tenant_onboarding",
            "target_id": scope["onboarding_id"],
            "reason": "operator will phone tenant first",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert (
        body["candidate_id"]
        == f"tenant_lifecycle_stall:tenant_onboarding:{scope['onboarding_id']}"
    )
    assert date.fromisoformat(body["deferred_until"]) > date.today()

    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )
    assert queue.status_code == 200
    assert [
        candidate
        for candidate in queue.json()["candidates"]
        if candidate["kind"] == "tenant_lifecycle_stall"
    ] == []


def test_comms_dispatch_tenant_lifecycle_stall_defers_candidate(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    scope = _seed_lifecycle_onboarding(
        session,
        signing={
            "provider": "docusign",
            "status": "completed",
            "envelope_id": "envelope-dispatched-1",
            "signed_at": (date.today() - timedelta(days=2)).isoformat(),
            "lease_activation_review": {
                "status": "ready_for_review",
                "current_lease_status": "pending",
                "recommended_status": "active",
            },
        },
    )

    from apps.api.routers import comms as comms_router

    def fake_send_email(*, recipient_email, subject, body, entity_id, candidate_id, kind, settings):  # noqa: ANN001, ARG001
        return comms_router._CommsEmailResult(
            status="queued",
            provider="sendgrid",
            recipient=recipient_email,
            provider_message_id="sg-lifecycle-1",
        )

    monkeypatch.setattr(comms_router, "_send_comms_email", fake_send_email)

    response = client.post(
        "/api/v1/comms/dispatch",
        json={
            "kind": "tenant_lifecycle_stall",
            "target_kind": "tenant_onboarding",
            "target_id": scope["onboarding_id"],
            "subject": "Lease activation review",
            "body": "We are completing the final activation review.",
            "recipient_email": "life@example.com",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "queued"
    assert body["provider_message_id"] == "sg-lifecycle-1"

    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )
    assert queue.status_code == 200
    assert [
        candidate
        for candidate in queue.json()["candidates"]
        if candidate["kind"] == "tenant_lifecycle_stall"
    ] == []


def test_comms_dispatch_inbound_sms_routes_through_twilio(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """SMS dispatch fires the Twilio path, not the SendGrid path."""

    entity = _entity(session)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="SMS Reply Tenant",
        contact_phone="+61400111222",
    )
    session.add(tenant)
    session.flush()
    inbound = InboundMessage(
        entity_id=entity.id,
        channel="sms",
        provider="twilio",
        from_address="+61400111222",
        body_text="Smoke alarm beeping again.",
        attributed_tenant_id=tenant.id,
        raw_payload={},
        inbound_metadata={},
    )
    session.add(inbound)
    session.commit()

    from apps.api.routers import comms as comms_router

    sms_calls: list[dict[str, str]] = []
    email_calls: list[dict[str, str]] = []

    def fake_send_sms(*, recipient_phone, body, entity_id, candidate_id, kind, settings):  # noqa: ANN001, ARG001
        sms_calls.append(
            {
                "recipient_phone": recipient_phone,
                "body": body,
                "kind": kind,
            }
        )
        return comms_router._CommsSmsResult(
            status="queued",
            provider="twilio",
            recipient=recipient_phone,
            provider_message_id="SM-test-reply-1",
        )

    def fake_send_email(*, recipient_email, subject, body, entity_id, candidate_id, kind, settings):  # noqa: ANN001, ARG001
        email_calls.append({"recipient_email": recipient_email})
        return comms_router._CommsEmailResult(
            status="queued",
            provider="sendgrid",
            recipient=recipient_email,
        )

    monkeypatch.setattr(comms_router, "_send_comms_sms", fake_send_sms)
    monkeypatch.setattr(comms_router, "_send_comms_email", fake_send_email)

    response = client.post(
        "/api/v1/comms/dispatch",
        json={
            "kind": "inbound_sms",
            "target_kind": "inbound_message",
            "target_id": str(inbound.id),
            "subject": "SMS reply",
            "body": "Hi Alex, we'll have someone out today.",
            "recipient_phone": "+61400111222",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["channel"] == "sms"
    assert body["status"] == "queued"
    assert body["provider"] == "twilio"
    assert body["recipient"] == "+61400111222"
    assert body["provider_message_id"] == "SM-test-reply-1"
    # Twilio called once, SendGrid never.
    assert len(sms_calls) == 1
    assert sms_calls[0]["body"] == "Hi Alex, we'll have someone out today."
    assert len(email_calls) == 0

    # Inbound message marked processed so the candidate clears from the queue.
    refreshed = session.get(InboundMessage, inbound.id)
    assert refreshed is not None
    assert refreshed.processed_at is not None


def test_comms_dismiss_arrears_pauses_reminder(
    client: TestClient,
    session: Session,
) -> None:
    """Dismiss moves reminder_paused_until forward."""

    scope = _seed_arrears(session)

    response = client.post(
        "/api/v1/comms/dismiss",
        json={
            "kind": "arrears_reminder",
            "target_kind": "arrears_case",
            "target_id": scope["case_id"],
            "reason": "tenant promised payment by Friday",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["candidate_id"] == f"arrears_reminder:arrears_case:{scope['case_id']}"
    deferred_until = date.fromisoformat(body["deferred_until"])
    assert deferred_until > date.today()
    assert body["reason"] == "tenant promised payment by Friday"

    case = session.get(ArrearsCase, UUID(scope["case_id"]))
    assert case is not None
    assert case.reminder_paused_until == deferred_until

    # And the next queue scan should now skip this case (matches the existing
    # paused-and-future-reminder test from v1).
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": scope["entity_id"]},
    )
    assert queue.status_code == 200
    assert queue.json()["candidates"] == []


def test_comms_dispatch_rejects_unknown_target_pair(
    client: TestClient,
    session: Session,
) -> None:
    """Dispatch with an inconsistent kind/target_kind/target_id is rejected."""

    response = client.post(
        "/api/v1/comms/dispatch",
        json={
            "kind": "arrears_reminder",
            "target_kind": "tenant",  # arrears_reminder targets arrears_case, not tenant
            "target_id": "00000000-0000-0000-0000-000000000000",
            "subject": "x",
            "body": "y",
            "recipient_email": "mia@example.com",
        },
    )
    assert response.status_code == 422


def test_comms_queue_returns_insurance_expiry_candidate(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Insurance Plaza",
        street_address="33 Cover Street",
        suburb="Brisbane City",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Shop 7")
    expiry = date.today() + timedelta(days=10)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Cover Tenant Pty Ltd",
        contact_name="Riley Cover",
        contact_email="riley@cover.example",
        tenant_metadata={"insurance_expiry_date": expiry.isoformat()},
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date.today() - timedelta(days=180),
        expiry_date=date.today() + timedelta(days=730),
    )
    session.add(lease)
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["kind"] == "insurance_expiry"
    assert candidate["target_kind"] == "tenant"
    assert candidate["target_id"] == str(tenant.id)
    # 10 days out → warning tier.
    assert candidate["severity"] == "warning"
    assert "Insurance Plaza" in candidate["subject"]
    assert candidate["body"].startswith("Hi Riley Cover,")


def test_comms_queue_returns_maintenance_forward_candidates(
    client: TestClient,
    session: Session,
) -> None:
    """Tenant/contractor timeline rows become reviewed Comms queue drafts."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Forwarding Plaza",
        street_address="44 Forward Street",
        suburb="Brisbane City",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Shop 8")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Forward Tenant Pty Ltd",
        trading_name="Forward Books",
        contact_name="Terry Forward",
        contact_email="tenant.forward@example.test",
    )
    session.add_all([unit, tenant])
    session.flush()
    work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        title="Front door repair",
        description="Door closer is loose.",
        status=MaintenanceWorkOrderStatus.in_progress,
        priority=MaintenancePriority.normal,
        contractor_name="FixCo",
        contractor_email="fixco@example.test",
        work_order_metadata={
            "activity_history": [
                {
                    "timestamp": "2026-05-20T01:00:00+00:00",
                    "source": "tenant_portal",
                    "event": "tenant_submitted",
                    "summary": "Tenant says the front door is sticking again.",
                    "status": "requested",
                },
                {
                    "timestamp": "2026-05-20T02:00:00+00:00",
                    "visibility": "contractor",
                    "event": "contractor_update",
                    "summary": "Contractor can attend tomorrow morning.",
                    "status": "assigned",
                },
            ],
        },
    )
    session.add(work_order)
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )

    assert response.status_code == 200
    candidates = [
        candidate
        for candidate in response.json()["candidates"]
        if candidate["target_id"] == str(work_order.id)
    ]
    assert {candidate["kind"] for candidate in candidates} == {
        "maintenance_contractor_forward",
        "maintenance_tenant_forward",
    }
    contractor_forward = next(
        candidate
        for candidate in candidates
        if candidate["kind"] == "maintenance_contractor_forward"
    )
    assert contractor_forward["target_kind"] == "maintenance_work_order"
    assert contractor_forward["recipient_email"] == "fixco@example.test"
    assert contractor_forward["tenant_name"] == "Forward Books"
    assert contractor_forward["property_name"] == "Forwarding Plaza"
    assert contractor_forward["unit_label"] == "Shop 8"
    assert "Tenant says the front door is sticking again." in contractor_forward["body"]
    assert contractor_forward["severity"] == "warning"
    assert "reviewed forward to contractor" in (contractor_forward["detail"] or "")

    tenant_forward = next(
        candidate
        for candidate in candidates
        if candidate["kind"] == "maintenance_tenant_forward"
    )
    assert tenant_forward["recipient_email"] == "tenant.forward@example.test"
    assert "Contractor can attend tomorrow morning." in tenant_forward["body"]


def test_comms_dispatch_maintenance_forward_stamps_work_order_metadata(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Approving a maintenance forward routes through the Comms dispatch pipe."""

    entity = _entity(session)
    work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        title="Dispatch forwarding",
        status=MaintenanceWorkOrderStatus.in_progress,
        priority=MaintenancePriority.normal,
        contractor_name="Dispatch FixCo",
        contractor_email="dispatch.fixco@example.test",
        work_order_metadata={
            "activity_history": [
                {
                    "timestamp": "2026-05-20T01:00:00+00:00",
                    "source": "tenant_portal",
                    "event": "tenant_submitted",
                    "summary": "Tenant confirms the leak is active.",
                    "status": "requested",
                }
            ],
        },
    )
    session.add(work_order)
    session.commit()

    sent: dict[str, str] = {}

    def fake_send_email(*, recipient_email, subject, body, entity_id, candidate_id, kind, settings):  # noqa: ANN001, ARG001
        sent["recipient_email"] = recipient_email
        sent["subject"] = subject
        sent["body"] = body
        sent["candidate_id"] = candidate_id
        sent["kind"] = kind

        class Result:
            status = "queued"
            provider = "sendgrid"
            recipient = recipient_email
            provider_message_id = "sg-maintenance-forward"
            error = None

        return Result()

    monkeypatch.setattr("apps.api.routers.comms._send_comms_email", fake_send_email)

    response = client.post(
        "/api/v1/comms/dispatch",
        json={
            "kind": "maintenance_contractor_forward",
            "target_kind": "maintenance_work_order",
            "target_id": str(work_order.id),
            "recipient_email": "dispatch.fixco@example.test",
            "subject": "Forward: Dispatch forwarding",
            "body": "Tenant confirms the leak is active.",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "queued"
    assert body["candidate_id"] == (
        f"maintenance_contractor_forward:maintenance_work_order:{work_order.id}"
    )
    assert sent["kind"] == "maintenance_contractor_forward"
    assert sent["recipient_email"] == "dispatch.fixco@example.test"

    session.refresh(work_order)
    metadata = work_order.work_order_metadata or {}
    dispatch = metadata.get("maintenance_forwarding_comms")
    assert dispatch["maintenance_contractor_forward"]["provider_message_id"] == (
        "sg-maintenance-forward"
    )


def test_inbound_webhook_persists_and_attributes_tenant(
    client: TestClient,
    session: Session,
) -> None:
    """The SendGrid inbound webhook stores the message and attributes by from-address."""

    entity = _entity(session)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Inbound Tenant Pty Ltd",
        contact_email="rep@inbound.example",
    )
    session.add(tenant)
    session.commit()

    response = client.post(
        "/api/v1/comms/webhooks/sendgrid-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "from": "rep@inbound.example",
            "to": "leasium@inbound.example.org",
            "subject": "Question about my rent",
            "text": "Hi team, can you confirm the rent went out yesterday?",
        },
    )

    assert response.status_code == 202
    body = response.json()
    assert body["attributed_tenant_id"] == str(tenant.id)
    message_id = UUID(body["id"])

    row = session.get(InboundMessage, message_id)
    assert row is not None
    assert row.entity_id == entity.id
    assert row.channel == "email"
    assert row.provider == "sendgrid"
    assert row.from_address == "rep@inbound.example"
    assert row.subject == "Question about my rent"
    assert row.body_text == "Hi team, can you confirm the rent went out yesterday?"
    assert row.attributed_tenant_id == tenant.id
    assert row.processed_at is None
    assert row.archived_at is None

    # And the comms queue surfaces it as an inbound_email candidate.
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert queue.status_code == 200
    candidates = queue.json()["candidates"]
    inbound = [c for c in candidates if c["kind"] == "inbound_email"]
    assert len(inbound) == 1
    assert inbound[0]["target_id"] == body["id"]
    assert inbound[0]["tenant_id"] == str(tenant.id)
    assert inbound[0]["subject"] == "Re: Question about my rent"


def test_inbound_webhook_routes_attachments_to_smart_intake(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """SendGrid inbound attachments become Smart Intake rows for review."""

    entity = _entity(session)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Attachment Tenant Pty Ltd",
        contact_email="docs@inbound.example",
    )
    session.add(tenant)
    session.commit()

    from apps.api.routers import comms as comms_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(comms_router, "get_settings", lambda: Settings(openai_api_key=""))

    response = client.post(
        "/api/v1/comms/webhooks/sendgrid-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "from": "docs@inbound.example",
            "to": "leasium@inbound.example.org",
            "subject": "Lease attachment",
            "text": "Hi team, attached is the lease document.",
        },
        files={
            "attachment1": (
                "signed-lease.pdf",
                b"%PDF-1.4\nlease attachment",
                "application/pdf",
            )
        },
    )

    assert response.status_code == 202
    body = response.json()
    assert body["attachment_intake_count"] == 1
    message_id = UUID(body["id"])

    document = session.scalar(
        select(StoredDocument).where(
            StoredDocument.entity_id == entity.id,
            StoredDocument.tenant_id == tenant.id,
            StoredDocument.deleted_at.is_(None),
        )
    )
    assert document is not None
    assert document.filename == "signed-lease.pdf"
    assert document.content_type == "application/pdf"
    assert document.byte_size == len(b"%PDF-1.4\nlease attachment")
    assert document.document_metadata["source"] == "sendgrid_inbound_parse"
    assert document.document_metadata["inbound_message_id"] == str(message_id)

    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.document_id == document.id)
    )
    assert intake is not None
    assert intake.status == DocumentIntakeStatus.uploaded
    assert intake.review_data["source"] == "sendgrid_inbound_parse"
    assert intake.review_data["inbound_message_id"] == str(message_id)
    assert intake.review_data["tenant_id"] == str(tenant.id)
    assert "No tenant data, lease data, provider action, or payment record" in (
        intake.review_data["guardrail"]
    )
    promotion_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "document_intake",
            AuditAction.target_id == intake.id,
            AuditAction.action == "promote",
        )
    )
    assert promotion_audit is not None
    assert promotion_audit.tool_input == {
        "document_id": str(document.id),
        "document_intake_id": str(intake.id),
        "inbound_message_id": str(message_id),
        "filename": "signed-lease.pdf",
        "source": "sendgrid_inbound_parse",
        "candidate": "inbound_email_attachment",
        "tenant_id": str(tenant.id),
        "attachment_field": "attachment1",
    }

    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert queue.status_code == 200
    inbound = [
        candidate
        for candidate in queue.json()["candidates"]
        if candidate["kind"] == "inbound_email"
    ]
    assert len(inbound) == 1
    assert "1 attachment routed to Smart Intake" in inbound[0]["detail"]


def test_inbound_webhook_extracts_attachment_when_openai_is_configured(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Inbound attachments are pre-extracted into Smart Intake when configured."""

    entity = _entity(session)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Extract Tenant Pty Ltd",
        contact_email="extract@inbound.example",
    )
    session.add(tenant)
    session.commit()

    from apps.api.routers import comms as comms_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        comms_router,
        "get_settings",
        lambda: Settings(openai_api_key="sk-test"),
    )

    def fake_extract_document_file(**kwargs):  # noqa: ANN003
        assert kwargs["filename"] == "insurance-certificate.txt"
        return (
            {
                "document_type": "insurance_certificate",
                "summary": "Inbound insurance certificate expires 2027-04-30.",
                "confidence": 0.88,
                "key_dates": [{"label": "Policy expiry", "date": "2027-04-30"}],
                "warnings": [],
                "missing_information": [],
            },
            "resp_inbound_attachment_extract",
        )

    monkeypatch.setattr(
        comms_router,
        "extract_document_file",
        fake_extract_document_file,
        raising=False,
    )

    response = client.post(
        "/api/v1/comms/webhooks/sendgrid-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "from": "extract@inbound.example",
            "to": "leasium@inbound.example.org",
            "subject": "Insurance certificate",
            "text": "Hi team, attached is the renewed insurance certificate.",
        },
        files={
            "attachment1": (
                "insurance-certificate.txt",
                b"insurance certificate",
                "text/plain",
            )
        },
    )

    assert response.status_code == 202
    document = session.scalar(
        select(StoredDocument).where(
            StoredDocument.entity_id == entity.id,
            StoredDocument.tenant_id == tenant.id,
            StoredDocument.filename == "insurance-certificate.txt",
        )
    )
    assert document is not None
    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.document_id == document.id)
    )
    assert intake is not None
    assert intake.status == DocumentIntakeStatus.ready_for_review
    assert intake.document_type == "insurance_certificate"
    assert intake.summary == "Inbound insurance certificate expires 2027-04-30."
    assert intake.confidence == 0.88
    assert intake.openai_response_id == "resp_inbound_attachment_extract"
    assert intake.extracted_data["key_dates"][0]["date"] == "2027-04-30"
    assert intake.review_data["source"] == "sendgrid_inbound_parse"
    assert document.document_metadata["smart_intake_auto_extracted"] is True
    assert document.document_metadata["proposed_document_category"] == "insurance"
    extract_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "document_intake",
            AuditAction.target_id == intake.id,
            AuditAction.action == "extract",
            AuditAction.tool_name == "openai.responses",
        )
    )
    assert extract_audit is not None
    assert extract_audit.tool_input == {
        "document_id": str(document.id),
        "document_intake_id": str(intake.id),
        "filename": "insurance-certificate.txt",
        "source": "sendgrid_inbound_parse",
        "document_type": "insurance_certificate",
        "openai_response_id": "resp_inbound_attachment_extract",
        "proposed_document_category": "insurance",
        "status": "ready_for_review",
    }


def test_inbound_webhook_keeps_attachment_intake_when_extraction_fails(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Inbound attachment routing soft-fails if extraction fails."""

    entity = _entity(session)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Extract Failure Tenant Pty Ltd",
        contact_email="extract-fail@inbound.example",
    )
    session.add(tenant)
    session.commit()

    from apps.api.routers import comms as comms_router
    from stewart.ai.document_intake import DocumentExtractionError
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        comms_router,
        "get_settings",
        lambda: Settings(openai_api_key="sk-test"),
    )

    def fake_extract_document_file(**kwargs):  # noqa: ANN003, ARG001
        raise DocumentExtractionError("OpenAI extraction unavailable")

    monkeypatch.setattr(
        comms_router,
        "extract_document_file",
        fake_extract_document_file,
        raising=False,
    )

    response = client.post(
        "/api/v1/comms/webhooks/sendgrid-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "from": "extract-fail@inbound.example",
            "to": "leasium@inbound.example.org",
            "subject": "Insurance certificate",
            "text": "Hi team, attached is the renewed insurance certificate.",
        },
        files={
            "attachment1": (
                "insurance-certificate.txt",
                b"insurance certificate",
                "text/plain",
            )
        },
    )

    assert response.status_code == 202
    assert response.json()["attachment_intake_count"] == 1
    document = session.scalar(
        select(StoredDocument).where(
            StoredDocument.entity_id == entity.id,
            StoredDocument.tenant_id == tenant.id,
            StoredDocument.filename == "insurance-certificate.txt",
        )
    )
    assert document is not None
    intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.document_id == document.id)
    )
    assert intake is not None
    assert intake.status == DocumentIntakeStatus.failed
    assert intake.error_message == "OpenAI extraction unavailable"
    assert intake.review_data["source"] == "sendgrid_inbound_parse"
    assert document.document_metadata["smart_intake_auto_extract_failed"] is True
    extract_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "document_intake",
            AuditAction.target_id == intake.id,
            AuditAction.action == "extract",
            AuditAction.tool_name == "openai.responses",
        )
    )
    assert extract_audit is not None
    assert extract_audit.tool_input == {
        "document_id": str(document.id),
        "document_intake_id": str(intake.id),
        "filename": "insurance-certificate.txt",
        "source": "sendgrid_inbound_parse",
        "status": "failed",
    }
    assert extract_audit.error_message == "OpenAI extraction unavailable"


def test_inbound_webhook_rejects_missing_shared_secret_when_configured(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Configured SendGrid inbound routes require the shared secret."""

    entity = _entity(session)
    from apps.api.routers import comms as comms_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        comms_router,
        "get_settings",
        lambda: Settings(sendgrid_inbound_secret="inbound-secret"),
    )

    response = client.post(
        "/api/v1/comms/webhooks/sendgrid-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "from": "docs@inbound.example",
            "to": "leasium@inbound.example.org",
            "subject": "Lease attachment",
            "text": "Hi team, attached is the lease document.",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "SendGrid inbound secret is invalid."
    assert session.scalar(select(InboundMessage)) is None


def test_inbound_webhook_accepts_matching_shared_secret_when_configured(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """SendGrid inbound accepts the configured secret from a header."""

    entity = _entity(session)
    from apps.api.routers import comms as comms_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        comms_router,
        "get_settings",
        lambda: Settings(sendgrid_inbound_secret="inbound-secret"),
    )

    response = client.post(
        "/api/v1/comms/webhooks/sendgrid-inbound",
        params={"entity_id": str(entity.id)},
        headers={"x-leasium-sendgrid-inbound-secret": "inbound-secret"},
        data={
            "from": "docs@inbound.example",
            "to": "leasium@inbound.example.org",
            "subject": "Lease attachment",
            "text": "Hi team, attached is the lease document.",
        },
    )

    assert response.status_code == 202
    message_id = UUID(response.json()["id"])
    assert session.get(InboundMessage, message_id) is not None


def test_comms_queue_returns_compliance_obligation_candidate(
    client: TestClient,
    session: Session,
) -> None:
    """Compliance obligations due within 45 days surface as candidates."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Compliance House",
        street_address="44 Code Street",
        suburb="Brisbane City",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Suite 1")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Compliance Tenant Pty Ltd",
        contact_name="Jess Compliance",
        contact_email="jess@compliance.example",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date.today() - timedelta(days=200),
        expiry_date=date.today() + timedelta(days=730),
    )
    session.add(lease)
    session.flush()
    obligation = Obligation(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        lease_id=lease.id,
        title="Annual fire safety certificate",
        category=ObligationCategory.compliance,
        status=ObligationStatus.due_soon,
        due_date=date.today() + timedelta(days=20),
    )
    session.add(obligation)
    session.commit()

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert response.status_code == 200
    candidates = response.json()["candidates"]
    compliance = [c for c in candidates if c["kind"] == "compliance_obligation"]
    assert len(compliance) == 1
    candidate = compliance[0]
    assert candidate["target_kind"] == "obligation"
    assert candidate["target_id"] == str(obligation.id)
    assert candidate["tenant_id"] == str(tenant.id)
    assert candidate["property_name"] == "Compliance House"
    assert candidate["unit_label"] == "Suite 1"
    # 20 days out + status=due_soon → warning tier.
    assert candidate["severity"] == "warning"
    assert "Annual fire safety certificate" in candidate["subject"]
    assert "Annual fire safety certificate" in candidate["body"]
    assert candidate["recipient_email"] == "jess@compliance.example"


def test_compliance_evidence_upload_links_document_to_obligation(
    client: TestClient,
    session: Session,
) -> None:
    """Manual compliance evidence uploads stay linked to the source obligation."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Compliance Evidence House",
        street_address="55 Evidence Street",
        suburb="Brisbane City",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Suite 4")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Evidence Tenant Pty Ltd",
        contact_name="Evan Evidence",
        contact_email="evan@compliance.example",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date.today() - timedelta(days=200),
        expiry_date=date.today() + timedelta(days=730),
    )
    session.add(lease)
    session.flush()
    obligation = Obligation(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        lease_id=lease.id,
        title="Annual fire safety certificate",
        category=ObligationCategory.compliance,
        status=ObligationStatus.due_soon,
        due_date=date.today() + timedelta(days=20),
        obligation_metadata={"existing": "kept"},
    )
    session.add(obligation)
    session.commit()

    upload_response = client.post(
        "/api/v1/documents",
        data={
            "entity_id": str(entity.id),
            "tenant_id": str(tenant.id),
            "obligation_id": str(obligation.id),
            "category": "other",
            "notes": "Compliance evidence for annual fire safety.",
        },
        files={
            "file": (
                "fire-safety.pdf",
                b"fire safety evidence",
                "application/pdf",
            )
        },
    )

    assert upload_response.status_code == 201
    document_id = UUID(upload_response.json()["id"])
    document = session.get(StoredDocument, document_id)
    assert document is not None
    session.refresh(obligation)
    assert obligation.obligation_metadata["existing"] == "kept"
    assert obligation.obligation_metadata["evidence_document_ids"] == [
        str(document_id)
    ]
    assert obligation.obligation_metadata["evidence_history"][-1] == {
        "document_id": str(document_id),
        "filename": "fire-safety.pdf",
        "source": "manual_comms_evidence_upload",
    }
    assert document.document_metadata["source"] == "manual_comms_evidence_upload"
    assert document.document_metadata["source_obligation_id"] == str(obligation.id)


def test_comms_dispatch_compliance_obligation_stamps_metadata(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Approved compliance reminders record the source obligation handoff."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Compliance Dispatch House",
        street_address="66 Evidence Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Suite 6")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Compliance Dispatch Tenant Pty Ltd",
        contact_email="dispatch-compliance@example.test",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
    )
    session.add(lease)
    session.flush()
    obligation = Obligation(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        lease_id=lease.id,
        title="Annual fire safety certificate",
        category=ObligationCategory.compliance,
        status=ObligationStatus.due_soon,
        due_date=date.today() + timedelta(days=20),
    )
    session.add(obligation)
    session.commit()

    from apps.api.routers import comms as comms_router

    def fake_send_email(*, recipient_email, subject, body, entity_id, candidate_id, kind, settings):  # noqa: ANN001, ARG001
        return comms_router._CommsEmailResult(
            status="queued",
            provider="sendgrid",
            recipient=recipient_email,
            provider_message_id="sg-compliance-1",
        )

    monkeypatch.setattr(comms_router, "_send_comms_email", fake_send_email)

    response = client.post(
        "/api/v1/comms/dispatch",
        json={
            "kind": "compliance_obligation",
            "target_kind": "obligation",
            "target_id": str(obligation.id),
            "subject": "Annual fire safety certificate due",
            "body": "Please send through the latest evidence.",
            "recipient_email": "dispatch-compliance@example.test",
        },
    )

    assert response.status_code == 201
    assert response.json()["provider_message_id"] == "sg-compliance-1"
    session.refresh(obligation)
    comms_stamp = obligation.obligation_metadata[comms_router.DISMISS_METADATA_KEY][
        "compliance_obligation"
    ]
    assert comms_stamp["dispatched_at"]
    assert date.fromisoformat(comms_stamp["next_eligible_on"]) > date.today()
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert queue.status_code == 200
    assert [
        candidate
        for candidate in queue.json()["candidates"]
        if candidate["kind"] == "compliance_obligation"
    ] == []


def test_comms_dismiss_compliance_obligation_stamps_metadata(
    client: TestClient,
    session: Session,
) -> None:
    """Dismissed compliance reminders keep the obligation audit trail."""

    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Compliance Dismiss House",
        street_address="77 Evidence Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Suite 7")
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Compliance Dismiss Tenant Pty Ltd",
        contact_email="dismiss-compliance@example.test",
    )
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
    )
    session.add(lease)
    session.flush()
    obligation = Obligation(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        lease_id=lease.id,
        title="Annual fire safety certificate",
        category=ObligationCategory.compliance,
        status=ObligationStatus.due_soon,
        due_date=date.today() + timedelta(days=20),
    )
    session.add(obligation)
    session.commit()

    response = client.post(
        "/api/v1/comms/dismiss",
        json={
            "kind": "compliance_obligation",
            "target_kind": "obligation",
            "target_id": str(obligation.id),
            "reason": "tenant already sent evidence",
        },
    )

    assert response.status_code == 201
    deferred_until = response.json()["deferred_until"]
    session.refresh(obligation)
    from apps.api.routers import comms as comms_router

    comms_stamp = obligation.obligation_metadata[comms_router.DISMISS_METADATA_KEY][
        "compliance_obligation"
    ]
    assert comms_stamp["deferred_until"] == deferred_until
    assert comms_stamp["reason"] == "tenant already sent evidence"
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    assert queue.status_code == 200
    assert [
        candidate
        for candidate in queue.json()["candidates"]
        if candidate["kind"] == "compliance_obligation"
    ] == []


def test_inbound_webhook_classifies_with_ai_triage(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """When OPENAI_API_KEY is set, the webhook stamps the row with the triage result."""

    entity = _entity(session)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="Triage Tenant Pty Ltd",
        contact_email="rep@triage.example",
    )
    session.add(tenant)
    session.commit()

    from apps.api.routers import comms as comms_router
    from stewart.core.settings import Settings

    def fake_triage(*, body, settings):  # noqa: ANN001, ARG001
        return (
            {
                "kind": "payment_or_arrears",
                "confidence": 0.84,
                "summary": "Tenant asks about overdue rent payment processed yesterday.",
                "suggested_target_kind": "arrears_case",
            },
            "resp-1",
        )

    monkeypatch.setattr(comms_router, "triage_inbox", fake_triage)
    monkeypatch.setattr(
        comms_router,
        "get_settings",
        lambda: Settings(openai_api_key="sk-test"),
    )

    response = client.post(
        "/api/v1/comms/webhooks/sendgrid-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "from": "rep@triage.example",
            "to": "leasium@inbound.example.org",
            "subject": "Rent question",
            "text": "Hi, did my rent payment go through yesterday?",
        },
    )

    assert response.status_code == 202
    message_id = UUID(response.json()["id"])
    row = session.get(InboundMessage, message_id)
    assert row is not None
    assert row.classification_kind == "payment_or_arrears"
    assert row.classification_confidence is not None
    assert float(row.classification_confidence) == 0.84
    assert "overdue rent" in (row.classification_summary or "")
    assert row.classification_target_kind == "arrears_case"

    # Queue surfaces the classification with elevated severity for payment_or_arrears.
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    inbound = [c for c in queue.json()["candidates"] if c["kind"] == "inbound_email"]
    assert len(inbound) == 1
    assert inbound[0]["severity"] == "danger"
    assert "payment or arrears" in (inbound[0]["detail"] or "")
    assert "84%" in (inbound[0]["detail"] or "")


def test_twilio_inbound_webhook_persists_and_attributes_by_phone(
    client: TestClient,
    session: Session,
) -> None:
    """Twilio inbound SMS lands as inbound_message and attributes by phone."""

    entity = _entity(session)
    tenant = Tenant(
        entity_id=entity.id,
        legal_name="SMS Tenant Pty Ltd",
        contact_name="Alex SMS",
        contact_phone="0400 111 222",
    )
    session.add(tenant)
    session.commit()

    response = client.post(
        "/api/v1/comms/webhooks/twilio-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "From": "+61400111222",
            "To": "+61491570006",
            "Body": "Hi, the smoke alarm is beeping again — third time this week.",
            "MessageSid": "SM-test-1",
            "FromCountry": "AU",
        },
    )

    assert response.status_code == 202
    body = response.json()
    assert body["attributed_tenant_id"] == str(tenant.id)

    row = session.get(InboundMessage, UUID(body["id"]))
    assert row is not None
    assert row.channel == "sms"
    assert row.provider == "twilio"
    assert row.from_address == "+61400111222"
    assert row.body_text == "Hi, the smoke alarm is beeping again — third time this week."
    assert row.attributed_tenant_id == tenant.id
    assert row.inbound_metadata["from_country"] == "AU"
    assert row.inbound_metadata["message_sid"] == "SM-test-1"

    # Queue surfaces it as inbound_sms (not inbound_email).
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    sms_candidates = [
        c for c in queue.json()["candidates"] if c["kind"] == "inbound_sms"
    ]
    assert len(sms_candidates) == 1
    candidate = sms_candidates[0]
    assert candidate["recipient_phone"] == "+61400111222"
    assert candidate["recipient_email"] is None
    assert candidate["subject"] == "SMS reply"
    assert candidate["body"].startswith("Hi Alex SMS,")


def test_twilio_inbound_webhook_rejects_missing_signature_when_token_configured(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Configured Twilio webhooks must be signed before persisting SMS."""

    from apps.api.routers import comms as comms_router
    from stewart.core.settings import Settings

    monkeypatch.setattr(
        comms_router,
        "get_settings",
        lambda: Settings(twilio_auth_token="twilio-secret"),
    )
    entity = _entity(session)

    response = client.post(
        "/api/v1/comms/webhooks/twilio-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "From": "+61400111222",
            "To": "+61491570006",
            "Body": "Unsigned SMS should not persist.",
            "MessageSid": "SM-unsigned-1",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid Twilio webhook signature."
    rows = session.scalars(
        select(InboundMessage).where(InboundMessage.provider == "twilio")
    ).all()
    assert rows == []


def test_twilio_inbound_webhook_accepts_valid_signature_when_token_configured(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Valid Twilio signatures keep the configured webhook path open."""

    from apps.api.routers import comms as comms_router
    from stewart.core.settings import Settings

    auth_token = "twilio-secret"
    monkeypatch.setattr(
        comms_router,
        "get_settings",
        lambda: Settings(twilio_auth_token=auth_token),
    )
    entity = _entity(session)
    data = {
        "From": "+61400111222",
        "To": "+61491570006",
        "Body": "Signed SMS should persist.",
        "MessageSid": "SM-signed-1",
    }
    url = str(
        client.build_request(
            "POST",
            "/api/v1/comms/webhooks/twilio-inbound",
            params={"entity_id": str(entity.id)},
        ).url
    )
    signature = _twilio_signature(url, data, auth_token)

    response = client.post(
        "/api/v1/comms/webhooks/twilio-inbound",
        params={"entity_id": str(entity.id)},
        data=data,
        headers={"X-Twilio-Signature": signature},
    )

    assert response.status_code == 202
    row = session.get(InboundMessage, UUID(response.json()["id"]))
    assert row is not None
    assert row.provider == "twilio"
    assert row.body_text == "Signed SMS should persist."


def test_twilio_inbound_webhook_accepts_public_api_url_signature(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Proxy deployments can validate the public Twilio webhook URL."""

    from apps.api.routers import comms as comms_router
    from stewart.core.settings import Settings

    auth_token = "twilio-secret"
    public_api_url = "https://api.leasium.test"
    monkeypatch.setattr(
        comms_router,
        "get_settings",
        lambda: Settings(
            public_api_url=public_api_url,
            twilio_auth_token=auth_token,
        ),
    )
    entity = _entity(session)
    data = {
        "From": "+61400111222",
        "To": "+61491570006",
        "Body": "Signed public URL SMS should persist.",
        "MessageSid": "SM-signed-public-1",
    }
    url = (
        f"{public_api_url}/api/v1/comms/webhooks/twilio-inbound"
        f"?entity_id={entity.id}"
    )
    signature = _twilio_signature(url, data, auth_token)

    response = client.post(
        "/api/v1/comms/webhooks/twilio-inbound",
        params={"entity_id": str(entity.id)},
        data=data,
        headers={"X-Twilio-Signature": signature},
    )

    assert response.status_code == 202
    row = session.get(InboundMessage, UUID(response.json()["id"]))
    assert row is not None
    assert row.provider == "twilio"
    assert row.body_text == "Signed public URL SMS should persist."


def test_inbound_webhook_without_matching_tenant(
    client: TestClient,
    session: Session,
) -> None:
    """If no tenant matches the from-address, the row is still persisted."""

    entity = _entity(session)

    response = client.post(
        "/api/v1/comms/webhooks/sendgrid-inbound",
        params={"entity_id": str(entity.id)},
        data={
            "from": "stranger@nowhere.example",
            "to": "leasium@inbound.example.org",
            "subject": "Just curious",
            "text": "Hello.",
        },
    )

    assert response.status_code == 202
    assert response.json()["attributed_tenant_id"] is None

    # And the comms queue surfaces it with a "tenant not attributed" detail.
    queue = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(entity.id)},
    )
    candidates = queue.json()["candidates"]
    inbound = [c for c in candidates if c["kind"] == "inbound_email"]
    assert len(inbound) == 1
    assert inbound[0]["tenant_id"] is None
    assert "tenant not attributed" in (inbound[0]["detail"] or "")
