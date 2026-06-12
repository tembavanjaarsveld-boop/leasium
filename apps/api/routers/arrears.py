"""Arrears and credit control routes."""

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import AuditOutcome, audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AppUser,
    ArrearsCase,
    ArrearsCaseStatus,
    ArrearsDisputeStatus,
    ArrearsEscalationStatus,
    Lease,
    Property,
    TenancyUnit,
    Tenant,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import get_settings
from stewart.integrations.communications import send_work_assignment_email

from apps.api.deps import (
    CurrentUser,
    assert_entity_role,
    get_current_user,
    get_session,
    readable_entity_ids,
)
from apps.api.schemas.arrears import (
    PROMISE_TO_PAY_KEY,
    ArrearsCaseCreate,
    ArrearsCaseRead,
    ArrearsCaseUpdate,
    ArrearsPromiseToPayCreate,
)
from apps.api.work_assignments import (
    assignment_notification_sent,
    record_work_assignment_delivery,
    work_assignment_email_invite,
    work_assignment_email_preference_enabled,
    work_assignment_email_preference_skipped_result,
    work_url,
)

ACTIVITY_HISTORY_KEY = "activity_history"

router = APIRouter(prefix="/arrears/cases", tags=["arrears"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
BALANCE_BUCKETS = (
    "balance_current_cents",
    "balance_1_30_cents",
    "balance_31_60_cents",
    "balance_61_90_cents",
    "balance_90_plus_cents",
)


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{name} not found.")


def _property_for_entity(property_id: UUID, entity_id: UUID, session: Session) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None or prop.entity_id != entity_id:
        raise _not_found("Property")
    return prop


def _unit_for_entity(
    tenancy_unit_id: UUID, entity_id: UUID, session: Session
) -> tuple[TenancyUnit, Property]:
    unit = session.get(TenancyUnit, tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise _not_found("Tenancy unit")
    prop = _property_for_entity(unit.property_id, entity_id, session)
    return unit, prop


def _tenant_for_entity(tenant_id: UUID, entity_id: UUID, session: Session) -> Tenant:
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None or tenant.entity_id != entity_id:
        raise _not_found("Tenant")
    return tenant


def _lease_for_entity(
    lease_id: UUID, entity_id: UUID, session: Session
) -> tuple[Lease, TenancyUnit, Property, Tenant]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise _not_found("Lease")
    unit, prop = _unit_for_entity(lease.tenancy_unit_id, entity_id, session)
    tenant = _tenant_for_entity(lease.tenant_id, entity_id, session)
    if prop.entity_id != tenant.entity_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease links tenant and unit across different entities.",
        )
    return lease, unit, prop, tenant


def _user_for_entity(user_id: UUID, entity_id: UUID, session: Session) -> AppUser:
    app_user = session.get(AppUser, user_id)
    if app_user is None or not app_user.is_active:
        raise _not_found("User")
    role = session.scalar(
        select(UserEntityRole).where(
            UserEntityRole.user_id == user_id,
            UserEntityRole.entity_id == entity_id,
        )
    )
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="User must have access to the arrears case entity.",
        )
    return app_user


def _validate_scope(
    *,
    entity_id: UUID,
    property_id: UUID | None,
    tenancy_unit_id: UUID | None,
    tenant_id: UUID | None,
    lease_id: UUID | None,
    session: Session,
) -> tuple[UUID | None, UUID | None, UUID, UUID | None]:
    if tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Arrears cases require a tenant.",
        )
    tenant = _tenant_for_entity(tenant_id, entity_id, session)

    if property_id is not None:
        _property_for_entity(property_id, entity_id, session)

    if tenancy_unit_id is not None:
        unit, prop = _unit_for_entity(tenancy_unit_id, entity_id, session)
        if property_id is not None and property_id != prop.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Tenancy unit must belong to the arrears case property.",
            )
        property_id = prop.id
        tenancy_unit_id = unit.id

    if lease_id is not None:
        lease, unit, prop, lease_tenant = _lease_for_entity(lease_id, entity_id, session)
        if lease_tenant.id != tenant.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the arrears case tenant.",
            )
        if tenancy_unit_id is not None and tenancy_unit_id != lease.tenancy_unit_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the arrears case tenancy unit.",
            )
        if property_id is not None and property_id != prop.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the arrears case property.",
            )
        property_id = prop.id
        tenancy_unit_id = unit.id
        lease_id = lease.id

    return property_id, tenancy_unit_id, tenant.id, lease_id


def _normalise_currency(data: dict[str, Any]) -> None:
    if "currency" not in data or data["currency"] is None:
        return
    currency = str(data["currency"]).upper()
    if len(currency) != 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Currency must be a 3-letter code.",
        )
    data["currency"] = currency


def _balance_total(data: dict[str, Any], current: ArrearsCase | None = None) -> int:
    total = 0
    for bucket in BALANCE_BUCKETS:
        value = data.get(bucket, getattr(current, bucket) if current is not None else 0)
        total += int(value or 0)
    return total


def _ensure_total_balance(data: dict[str, Any], current: ArrearsCase | None = None) -> None:
    if current is None:
        bucket_total = _balance_total(data)
        if data.get("total_balance_cents", 0) == 0 and bucket_total != 0:
            data["total_balance_cents"] = bucket_total
        return
    if "total_balance_cents" not in data and any(bucket in data for bucket in BALANCE_BUCKETS):
        data["total_balance_cents"] = _balance_total(data, current)


def _validate_linked_records(data: dict[str, Any], entity_id: UUID, session: Session) -> None:
    assigned_user_id = data.get("assigned_user_id")
    if assigned_user_id is not None:
        _user_for_entity(assigned_user_id, entity_id, session)


def _arrears_case_for_user(
    arrears_case_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> ArrearsCase:
    arrears_case = session.get(ArrearsCase, arrears_case_id)
    if arrears_case is None or arrears_case.deleted_at is not None:
        raise _not_found("Arrears case")
    assert_entity_role(session, user, arrears_case.entity_id, roles)
    return arrears_case


def _append_activity_history(
    metadata: dict[str, Any] | None,
    entry: dict[str, Any],
) -> dict[str, Any]:
    next_metadata = dict(metadata or {})
    current_history = next_metadata.get(ACTIVITY_HISTORY_KEY)
    history = list(current_history) if isinstance(current_history, list) else []
    history.append(entry)
    next_metadata[ACTIVITY_HISTORY_KEY] = history
    return next_metadata


def _append_promise_to_pay(
    metadata: dict[str, Any] | None,
    *,
    actor: str,
    promised_amount_cents: int | None,
    promised_date: date | None,
    notes: str,
) -> dict[str, Any]:
    """Append an operator-recorded tenant promise-to-pay / payment-plan note.

    Records the note only — the tenant is NOT contacted, no payment is taken,
    no charge is created, and nothing is reconciled (review-first; no provider
    call). Adds a ``promise_to_pay`` entry plus an activity-history event so the
    arrears-case timeline reflects the recorded promise.
    """
    next_metadata = dict(metadata or {})
    existing = next_metadata.get(PROMISE_TO_PAY_KEY)
    promises = list(existing) if isinstance(existing, list) else []
    recorded_at = utcnow().isoformat()
    promise = {
        "promised_amount_cents": promised_amount_cents,
        "promised_date": promised_date.isoformat() if promised_date is not None else None,
        "notes": notes.strip(),
        "recorded_by": actor,
        "recorded_at": recorded_at,
    }
    promises.append(promise)
    next_metadata[PROMISE_TO_PAY_KEY] = promises
    return _append_activity_history(
        next_metadata,
        {
            "timestamp": recorded_at,
            "actor": actor,
            "source": "operator_api",
            "event": "promise_to_pay_recorded",
            "summary": "Recorded tenant promise-to-pay note.",
        },
    )


@router.get("", response_model=list[ArrearsCaseRead])
def list_arrears_cases(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID | None, Query()] = None,
    tenant_id: UUID | None = None,
    status_filter: Annotated[ArrearsCaseStatus | None, Query(alias="status")] = None,
    dispute_status: ArrearsDisputeStatus | None = None,
    escalation_status: ArrearsEscalationStatus | None = None,
    include_deleted: bool = False,
) -> list[ArrearsCase]:
    statement = select(ArrearsCase)
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(ArrearsCase.entity_id == entity_id)
    else:
        statement = statement.where(
            ArrearsCase.entity_id.in_(readable_entity_ids(session, user, READ_ROLES))
        )
    if tenant_id is not None:
        tenant = session.get(Tenant, tenant_id)
        if tenant is None or tenant.deleted_at is not None:
            raise _not_found("Tenant")
        if entity_id is not None:
            if tenant.entity_id != entity_id:
                raise _not_found("Tenant")
        else:
            assert_entity_role(session, user, tenant.entity_id, READ_ROLES)
        statement = statement.where(ArrearsCase.tenant_id == tenant_id)
    if status_filter is not None:
        statement = statement.where(ArrearsCase.status == status_filter)
    if dispute_status is not None:
        statement = statement.where(ArrearsCase.dispute_status == dispute_status)
    if escalation_status is not None:
        statement = statement.where(ArrearsCase.escalation_status == escalation_status)
    if not include_deleted:
        statement = statement.where(ArrearsCase.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(ArrearsCase.created_at.desc())))


@router.post("", response_model=ArrearsCaseRead, status_code=status.HTTP_201_CREATED)
def create_arrears_case(
    payload: ArrearsCaseCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ArrearsCase:
    data = payload.model_dump()
    entity_id = data["entity_id"]
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    property_id, tenancy_unit_id, tenant_id, lease_id = _validate_scope(
        entity_id=entity_id,
        property_id=data["property_id"],
        tenancy_unit_id=data["tenancy_unit_id"],
        tenant_id=data["tenant_id"],
        lease_id=data["lease_id"],
        session=session,
    )
    data["property_id"] = property_id
    data["tenancy_unit_id"] = tenancy_unit_id
    data["tenant_id"] = tenant_id
    data["lease_id"] = lease_id
    _normalise_currency(data)
    _ensure_total_balance(data)
    data["arrears_metadata"] = data.pop("metadata")
    _validate_linked_records(data, entity_id, session)

    arrears_case = ArrearsCase(**data)
    session.add(arrears_case)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=arrears_case.entity_id,
        action="create",
        target_table="arrears_case",
        target_id=arrears_case.id,
    )
    session.commit()
    session.refresh(arrears_case)
    return arrears_case


@router.get("/{arrears_case_id}", response_model=ArrearsCaseRead)
def get_arrears_case(
    arrears_case_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ArrearsCase:
    return _arrears_case_for_user(arrears_case_id, user, session, READ_ROLES)


@router.patch("/{arrears_case_id}", response_model=ArrearsCaseRead)
def update_arrears_case(
    arrears_case_id: UUID,
    payload: ArrearsCaseUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ArrearsCase:
    arrears_case = _arrears_case_for_user(arrears_case_id, user, session, WRITE_ROLES)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    property_id, tenancy_unit_id, tenant_id, lease_id = _validate_scope(
        entity_id=arrears_case.entity_id,
        property_id=data.get("property_id", arrears_case.property_id),
        tenancy_unit_id=data.get("tenancy_unit_id", arrears_case.tenancy_unit_id),
        tenant_id=data.get("tenant_id", arrears_case.tenant_id),
        lease_id=data.get("lease_id", arrears_case.lease_id),
        session=session,
    )
    data["property_id"] = property_id
    data["tenancy_unit_id"] = tenancy_unit_id
    data["tenant_id"] = tenant_id
    data["lease_id"] = lease_id
    _normalise_currency(data)
    _ensure_total_balance(data, arrears_case)
    if "metadata" in data:
        data["arrears_metadata"] = data.pop("metadata")
    _validate_linked_records(data, arrears_case.entity_id, session)

    for key, value in data.items():
        setattr(arrears_case, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=arrears_case.entity_id,
        action="update",
        target_table="arrears_case",
        target_id=arrears_case.id,
    )
    session.commit()
    session.refresh(arrears_case)
    return arrears_case


@router.post(
    "/{arrears_case_id}/assignment-notification/send-email",
    response_model=ArrearsCaseRead,
)
def send_arrears_assignment_notification_email(
    arrears_case_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ArrearsCase:
    arrears_case = _arrears_case_for_user(arrears_case_id, user, session, WRITE_ROLES)
    metadata = dict(arrears_case.arrears_metadata or {})
    if assignment_notification_sent(metadata):
        return arrears_case

    tenant = session.get(Tenant, arrears_case.tenant_id)
    tenant_name = (tenant.trading_name or tenant.legal_name) if tenant is not None else "Tenant"
    settings = get_settings()
    invite = work_assignment_email_invite(
        metadata,
        target_id=arrears_case.id,
        target_type="arrears_case",
        entity_id=arrears_case.entity_id,
        work_kind="Arrears",
        title=f"{tenant_name} arrears",
        description=arrears_case.notes,
        due_date=arrears_case.next_reminder_on,
        work_url=work_url(settings, "/operations"),
        settings=settings,
        session=session,
    )
    result = (
        send_work_assignment_email(invite, settings)
        if work_assignment_email_preference_enabled(metadata, session)
        else work_assignment_email_preference_skipped_result(invite)
    )
    arrears_case.arrears_metadata = record_work_assignment_delivery(
        metadata,
        result=result,
        user=user,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=arrears_case.entity_id,
        action="deliver",
        target_table="arrears_case",
        target_id=arrears_case.id,
        tool_name="sendgrid.work_assignment",
        tool_input={
            "arrears_case_id": str(arrears_case.id),
            "recipient_email": result.recipient,
            "provider": result.provider,
            "status": result.status,
        },
        tool_output_summary=(
            f"Attempted assignment notification delivery via {result.provider}: {result.status}."
        ),
    )
    session.commit()
    session.refresh(arrears_case)
    return arrears_case


@router.post("/{arrears_case_id}/promise-to-pay", response_model=ArrearsCaseRead)
def record_arrears_promise_to_pay(
    arrears_case_id: UUID,
    payload: ArrearsPromiseToPayCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ArrearsCase:
    """Operator records a tenant promise-to-pay / payment-plan note.

    Review-first: this stores what the operator heard from the tenant. It does
    NOT take payment, create a charge, reconcile, or contact the tenant — a
    future tenant-notify hook would attach where noted below (no SendGrid /
    Twilio / Xero call here).
    """
    arrears_case = _arrears_case_for_user(arrears_case_id, user, session, WRITE_ROLES)
    arrears_case.arrears_metadata = _append_promise_to_pay(
        arrears_case.arrears_metadata,
        actor=user.actor,
        promised_amount_cents=payload.promised_amount_cents,
        promised_date=payload.promised_date,
        notes=payload.notes,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=arrears_case.entity_id,
        action="update",
        target_table="arrears_case",
        target_id=arrears_case.id,
        tool_name="arrears.promise_to_pay.record",
        tool_input={
            "arrears_case_id": str(arrears_case.id),
            "promised_amount_cents": payload.promised_amount_cents,
            "promised_date": (
                payload.promised_date.isoformat() if payload.promised_date is not None else None
            ),
        },
        tool_output_summary=(
            "Recorded operator-entered tenant promise-to-pay note; no tenant, "
            "provider, billing, payment, charge, or reconciliation action ran."
        ),
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    # Future tenant-notify hook goes here (review-only in v1; no SendGrid/Twilio call).
    session.refresh(arrears_case)
    return arrears_case


@router.delete("/{arrears_case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_arrears_case(
    arrears_case_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    arrears_case = _arrears_case_for_user(arrears_case_id, user, session, WRITE_ROLES)
    arrears_case.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=arrears_case.entity_id,
        action="delete",
        target_table="arrears_case",
        target_id=arrears_case.id,
    )
    session.commit()
