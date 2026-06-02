"""Operator tenant payment-instructions API tests (display-only)."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AuditAction, Entity, EntityPaymentInstruction


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def test_operator_can_set_and_read_payment_instructions(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)

    put = client.put(
        f"/api/v1/payments/instructions?entity_id={entity.id}",
        json={
            "account_name": "SKJ Property Pty Ltd",
            "bsb": "062-000",
            "account_number": "12345678",
            "payid": "rent@skj.example",
            "payid_name": "SKJ Property",
            "bpay_biller_code": "123456",
            "instructions": "Quote your invoice number as the payment reference.",
        },
    )

    assert put.status_code == 200, put.text
    body = put.json()
    assert body["configured"] is True
    assert set(body["methods"]) == {"eft", "payid", "bpay"}
    assert body["account_number"] == "12345678"
    assert "display-only" in body["guardrails"][0]

    get = client.get(f"/api/v1/payments/instructions?entity_id={entity.id}")
    assert get.status_code == 200, get.text
    g = get.json()
    assert g["payid"] == "rent@skj.example"
    assert g["payid_name"] == "SKJ Property"
    assert g["bpay_biller_code"] == "123456"
    assert g["configured"] is True

    row = session.scalar(
        select(EntityPaymentInstruction).where(
            EntityPaymentInstruction.entity_id == entity.id
        )
    )
    assert row is not None
    assert row.account_number == "12345678"
    assert row.updated_by_user_id is not None

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.tool_name == "payment.instructions.update",
            AuditAction.target_table == "entity_payment_instruction",
        )
    )
    assert audit is not None
    assert audit.data_classification == "confidential"


def test_get_returns_unconfigured_when_unset(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)

    get = client.get(f"/api/v1/payments/instructions?entity_id={entity.id}")

    assert get.status_code == 200, get.text
    g = get.json()
    assert g["configured"] is False
    assert g["methods"] == []
    assert g["account_number"] is None
    assert g["payid"] is None


def test_put_normalises_blanks_and_updates_in_place(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)

    first = client.put(
        f"/api/v1/payments/instructions?entity_id={entity.id}",
        json={
            "account_name": "SKJ Property Pty Ltd",
            "bsb": "062-000",
            "account_number": "   ",
            "payid": "  ",
        },
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["account_number"] is None
    assert first_body["payid"] is None
    assert first_body["bsb"] == "062-000"
    assert first_body["methods"] == []
    assert first_body["configured"] is False

    second = client.put(
        f"/api/v1/payments/instructions?entity_id={entity.id}",
        json={"bsb": "062-000", "account_number": "87654321"},
    )
    assert second.status_code == 200, second.text
    second_body = second.json()
    assert second_body["methods"] == ["eft"]
    assert second_body["configured"] is True
    assert second_body["account_number"] == "87654321"
    assert second_body["account_name"] is None

    rows = list(
        session.scalars(
            select(EntityPaymentInstruction).where(
                EntityPaymentInstruction.entity_id == entity.id,
                EntityPaymentInstruction.deleted_at.is_(None),
            )
        )
    )
    assert len(rows) == 1


def test_payment_instructions_reject_entities_without_access(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    other = Entity(organisation_id=entity.organisation_id, name="No Access Pty Ltd")
    session.add(other)
    session.commit()

    put = client.put(
        f"/api/v1/payments/instructions?entity_id={other.id}",
        json={"payid": "x@y.example"},
    )
    assert put.status_code == 403

    get = client.get(f"/api/v1/payments/instructions?entity_id={other.id}")
    assert get.status_code == 403

    bogus = client.get(f"/api/v1/payments/instructions?entity_id={uuid4()}")
    assert bogus.status_code == 403

    assert (
        session.scalar(
            select(EntityPaymentInstruction).where(
                EntityPaymentInstruction.entity_id == other.id
            )
        )
        is None
    )
