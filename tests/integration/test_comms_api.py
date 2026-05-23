"""Comms queue API tests.

Covers the read-only comms queue endpoint introduced as the foundation of the
scheduled comms loop in ``docs/automation-strategy-2026-05-23.md``. v1 returns
arrears reminder drafts only; future slices extend to document-chase and
lease-event drafts.
"""

from datetime import date, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    Entity,
    InboundMessage,
    Lease,
    LeaseStatus,
    Property,
    PropertyType,
    TenancyUnit,
    Tenant,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


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
    assert body["entity_id"] == str(entity.id)


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
