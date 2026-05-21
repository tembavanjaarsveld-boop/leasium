"""Obligation and critical date CRUD routes with entity scoped access checks."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    Lease,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    TenancyUnit,
    Tenant,
    UserRole,
)
from stewart.core.settings import get_settings
from stewart.integrations.communications import send_work_assignment_email

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register import ObligationCreate, ObligationRead, ObligationUpdate
from apps.api.work_assignments import (
    assignment_notification_sent,
    record_work_assignment_delivery,
    work_assignment_email_invite,
    work_url,
)

router = APIRouter(prefix="/obligations", tags=["obligations"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _property_for_access(
    property_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Property not found."
        )
    assert_entity_role(session, user, prop.entity_id, roles)
    return prop


def _unit_for_access(
    unit_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> tuple[TenancyUnit, Property]:
    unit = session.get(TenancyUnit, unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Tenancy unit not found."
        )
    prop = _property_for_access(unit.property_id, user, session, roles)
    return unit, prop


def _lease_for_access(
    lease_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> tuple[Lease, TenancyUnit, Property]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Lease not found.")
    unit, prop = _unit_for_access(lease.tenancy_unit_id, user, session, roles)
    tenant = session.get(Tenant, lease.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    if tenant.entity_id != prop.entity_id:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Lease links tenant and unit across different entities.",
        )
    assert_entity_role(session, user, tenant.entity_id, roles)
    return lease, unit, prop


def _validate_obligation_scope(
    *,
    entity_id: UUID,
    property_id: UUID | None,
    tenancy_unit_id: UUID | None,
    lease_id: UUID | None,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> tuple[UUID | None, UUID | None, UUID | None]:
    assert_entity_role(session, user, entity_id, roles)

    if property_id is not None:
        prop = _property_for_access(property_id, user, session, roles)
        if prop.entity_id != entity_id:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Property must belong to the obligation entity.",
            )

    if tenancy_unit_id is not None:
        _, prop = _unit_for_access(tenancy_unit_id, user, session, roles)
        if prop.entity_id != entity_id:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Tenancy unit must belong to the obligation entity.",
            )
        if property_id is not None and property_id != prop.id:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Tenancy unit must belong to the obligation property.",
            )
        property_id = prop.id

    if lease_id is not None:
        lease, unit, prop = _lease_for_access(lease_id, user, session, roles)
        if prop.entity_id != entity_id:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the obligation entity.",
            )
        if tenancy_unit_id is not None and tenancy_unit_id != lease.tenancy_unit_id:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the obligation tenancy unit.",
            )
        if property_id is not None and property_id != prop.id:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the obligation property.",
            )
        tenancy_unit_id = unit.id
        property_id = prop.id

    return property_id, tenancy_unit_id, lease_id


@router.get("", response_model=list[ObligationRead])
def list_obligations(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID | None = None,
    property_id: UUID | None = None,
    tenancy_unit_id: UUID | None = None,
    lease_id: UUID | None = None,
    status: ObligationStatus | None = None,
    category: ObligationCategory | None = None,
    include_deleted: bool = False,
) -> list[Obligation]:
    if entity_id is None and property_id is None and tenancy_unit_id is None and lease_id is None:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Provide an entity, property, tenancy unit, or lease scope.",
        )

    statement = select(Obligation)
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(Obligation.entity_id == entity_id)
    if property_id is not None:
        _property_for_access(property_id, user, session, READ_ROLES)
        statement = statement.where(Obligation.property_id == property_id)
    if tenancy_unit_id is not None:
        _unit_for_access(tenancy_unit_id, user, session, READ_ROLES)
        statement = statement.where(Obligation.tenancy_unit_id == tenancy_unit_id)
    if lease_id is not None:
        _lease_for_access(lease_id, user, session, READ_ROLES)
        statement = statement.where(Obligation.lease_id == lease_id)
    if status is not None:
        statement = statement.where(Obligation.status == status)
    if category is not None:
        statement = statement.where(Obligation.category == category)
    if not include_deleted:
        statement = statement.where(Obligation.deleted_at.is_(None))

    return list(
        session.scalars(
            statement.order_by(Obligation.due_date, Obligation.priority, Obligation.created_at)
        )
    )


@router.post("", response_model=ObligationRead, status_code=http_status.HTTP_201_CREATED)
def create_obligation(
    payload: ObligationCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Obligation:
    data = payload.model_dump()
    property_id, tenancy_unit_id, lease_id = _validate_obligation_scope(
        entity_id=data["entity_id"],
        property_id=data["property_id"],
        tenancy_unit_id=data["tenancy_unit_id"],
        lease_id=data["lease_id"],
        user=user,
        session=session,
        roles=WRITE_ROLES,
    )
    data["property_id"] = property_id
    data["tenancy_unit_id"] = tenancy_unit_id
    data["lease_id"] = lease_id
    data["obligation_metadata"] = data.pop("metadata")
    obligation = Obligation(**data)
    session.add(obligation)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=obligation.entity_id,
        action="create",
        target_table="obligation",
        target_id=obligation.id,
    )
    session.commit()
    session.refresh(obligation)
    return obligation


def _get_obligation_for_user(
    obligation_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Obligation:
    obligation = session.get(Obligation, obligation_id)
    if obligation is None or obligation.deleted_at is not None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Obligation not found."
        )
    assert_entity_role(session, user, obligation.entity_id, roles)
    return obligation


@router.get("/{obligation_id}", response_model=ObligationRead)
def get_obligation(
    obligation_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Obligation:
    return _get_obligation_for_user(obligation_id, user, session, READ_ROLES)


@router.patch("/{obligation_id}", response_model=ObligationRead)
def update_obligation(
    obligation_id: UUID,
    payload: ObligationUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Obligation:
    obligation = _get_obligation_for_user(obligation_id, user, session, WRITE_ROLES)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    entity_id = data.get("entity_id", obligation.entity_id)
    property_id = data.get("property_id", obligation.property_id)
    tenancy_unit_id = data.get("tenancy_unit_id", obligation.tenancy_unit_id)
    lease_id = data.get("lease_id", obligation.lease_id)
    property_id, tenancy_unit_id, lease_id = _validate_obligation_scope(
        entity_id=entity_id,
        property_id=property_id,
        tenancy_unit_id=tenancy_unit_id,
        lease_id=lease_id,
        user=user,
        session=session,
        roles=WRITE_ROLES,
    )
    data["property_id"] = property_id
    data["tenancy_unit_id"] = tenancy_unit_id
    data["lease_id"] = lease_id
    if "metadata" in data:
        data["obligation_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(obligation, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=obligation.entity_id,
        action="update",
        target_table="obligation",
        target_id=obligation.id,
    )
    session.commit()
    session.refresh(obligation)
    return obligation


@router.post("/{obligation_id}/assignment-notification/send-email", response_model=ObligationRead)
def send_obligation_assignment_notification_email(
    obligation_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Obligation:
    obligation = _get_obligation_for_user(obligation_id, user, session, WRITE_ROLES)
    metadata = dict(obligation.obligation_metadata or {})
    if assignment_notification_sent(metadata):
        return obligation

    settings = get_settings()
    result = send_work_assignment_email(
        work_assignment_email_invite(
            metadata,
            target_id=obligation.id,
            target_type="obligation",
            entity_id=obligation.entity_id,
            work_kind="Critical date",
            title=obligation.title,
            description=obligation.notes,
            due_date=obligation.due_date,
            work_url=work_url(settings, "/properties"),
            settings=settings,
        ),
        settings,
    )
    obligation.obligation_metadata = record_work_assignment_delivery(
        metadata,
        result=result,
        user=user,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=obligation.entity_id,
        action="deliver",
        target_table="obligation",
        target_id=obligation.id,
        tool_name="sendgrid.work_assignment",
        tool_input={
            "obligation_id": str(obligation.id),
            "recipient_email": result.recipient,
            "provider": result.provider,
            "status": result.status,
        },
        tool_output_summary=(
            f"Attempted assignment notification delivery via {result.provider}: "
            f"{result.status}."
        ),
    )
    session.commit()
    session.refresh(obligation)
    return obligation


@router.delete("/{obligation_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_obligation(
    obligation_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    obligation = _get_obligation_for_user(obligation_id, user, session, WRITE_ROLES)
    obligation.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=obligation.entity_id,
        action="delete",
        target_table="obligation",
        target_id=obligation.id,
    )
    session.commit()
