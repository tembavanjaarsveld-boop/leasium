"""Comms queue API tests.

Covers the read-only comms queue endpoint introduced as the foundation of the
scheduled comms loop in ``docs/automation-strategy-2026-05-23.md``. v1 returns
arrears reminder drafts only; future slices extend to document-chase and
lease-event drafts.
"""

from datetime import UTC, date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    Entity,
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
    case = session.get(ArrearsCase, scope["case_id"])
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
    case = session.get(ArrearsCase, scope["case_id"])
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
