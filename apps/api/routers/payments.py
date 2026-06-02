"""Operator-entered tenant payment instructions (display-only).

These are the landlord's receiving details (EFT / PayID, optional BPAY, notes)
the operator chooses to show tenants. No payment is processed, no money moves,
and no Basiq/Xero/reconciliation action runs from here.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import EntityPaymentInstruction, UserRole

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.payments import PaymentInstructionRead, PaymentInstructionUpdate

router = APIRouter(prefix="/payments", tags=["payments"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance}

PAYMENT_INSTRUCTION_GUARDRAILS = [
    (
        "Payment instructions are display-only: Leasium shows tenants how and what "
        "to pay but does not process payments, move money, or reconcile here."
    ),
]


def _methods(row: EntityPaymentInstruction | None) -> list[str]:
    if row is None:
        return []
    methods: list[str] = []
    if row.bsb and row.account_number:
        methods.append("eft")
    if row.payid:
        methods.append("payid")
    if row.bpay_biller_code:
        methods.append("bpay")
    return methods


def _read(
    entity_id: UUID, row: EntityPaymentInstruction | None
) -> PaymentInstructionRead:
    methods = _methods(row)
    return PaymentInstructionRead(
        entity_id=entity_id,
        account_name=row.account_name if row else None,
        bsb=row.bsb if row else None,
        account_number=row.account_number if row else None,
        payid=row.payid if row else None,
        payid_name=row.payid_name if row else None,
        bpay_biller_code=row.bpay_biller_code if row else None,
        instructions=row.instructions if row else None,
        configured=bool(methods),
        methods=methods,
        updated_at=row.updated_at if row else None,
        guardrails=PAYMENT_INSTRUCTION_GUARDRAILS,
    )


def _active_row(entity_id: UUID, session: Session) -> EntityPaymentInstruction | None:
    return session.scalar(
        select(EntityPaymentInstruction).where(
            EntityPaymentInstruction.entity_id == entity_id,
            EntityPaymentInstruction.deleted_at.is_(None),
        )
    )


@router.get("/instructions", response_model=PaymentInstructionRead)
def get_payment_instructions(
    entity_id: Annotated[UUID, Query()],
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> PaymentInstructionRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    return _read(entity_id, _active_row(entity_id, session))


@router.put("/instructions", response_model=PaymentInstructionRead)
def update_payment_instructions(
    entity_id: Annotated[UUID, Query()],
    payload: PaymentInstructionUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> PaymentInstructionRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    row = _active_row(entity_id, session)
    now = utcnow()
    if row is None:
        row = EntityPaymentInstruction(entity_id=entity_id, created_at=now, updated_at=now)
        session.add(row)
    row.account_name = payload.account_name
    row.bsb = payload.bsb
    row.account_number = payload.account_number
    row.payid = payload.payid
    row.payid_name = payload.payid_name
    row.bpay_biller_code = payload.bpay_biller_code
    row.instructions = payload.instructions
    row.updated_by_user_id = user.id
    row.updated_at = now
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="update",
        target_table="entity_payment_instruction",
        target_id=row.id,
        tool_name="payment.instructions.update",
        tool_output_summary=(
            "Updated tenant payment instructions (display-only); no payment was "
            "processed, no money moved, and no provider/reconciliation action ran."
        ),
        data_classification="confidential",
    )
    session.commit()
    session.refresh(row)
    return _read(entity_id, row)
