"""Tenancy unit CRUD routes with inherited property/entity access checks."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    Lease,
    LeaseUnit,
    Obligation,
    Property,
    RentChargeRule,
    TenancyUnit,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register import TenancyUnitCreate, TenancyUnitRead, TenancyUnitUpdate

router = APIRouter(prefix="/tenancy-units", tags=["tenancy-units"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _property_for_access(
    property_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    assert_entity_role(session, user, prop.entity_id, roles)
    return prop


@router.get("", response_model=list[TenancyUnitRead])
def list_tenancy_units(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    property_id: Annotated[UUID, Query()],
    include_deleted: bool = False,
) -> list[TenancyUnit]:
    _property_for_access(property_id, user, session, READ_ROLES)
    statement = select(TenancyUnit).where(TenancyUnit.property_id == property_id)
    if not include_deleted:
        statement = statement.where(TenancyUnit.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(TenancyUnit.unit_label)))


@router.post("", response_model=TenancyUnitRead, status_code=status.HTTP_201_CREATED)
def create_tenancy_unit(
    payload: TenancyUnitCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenancyUnit:
    prop = _property_for_access(payload.property_id, user, session, WRITE_ROLES)
    data = payload.model_dump()
    data["unit_metadata"] = data.pop("metadata")
    unit = TenancyUnit(**data)
    session.add(unit)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="create",
        target_table="tenancy_unit",
        target_id=unit.id,
    )
    session.commit()
    session.refresh(unit)
    return unit


def _get_unit_for_user(
    unit_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> tuple[TenancyUnit, Property]:
    unit = session.get(TenancyUnit, unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenancy unit not found.")
    prop = _property_for_access(unit.property_id, user, session, roles)
    return unit, prop


def _soft_delete_unit_cascade(unit: TenancyUnit, session: Session) -> None:
    now = utcnow()
    legacy_lease_ids = list(
        session.scalars(select(Lease.id).where(Lease.tenancy_unit_id == unit.id))
    )
    linked_lease_ids = list(
        session.scalars(
            select(LeaseUnit.lease_id).where(
                LeaseUnit.tenancy_unit_id == unit.id,
                LeaseUnit.deleted_at.is_(None),
            )
        )
    )
    lease_ids = list(set(legacy_lease_ids + linked_lease_ids))
    live_leases = (
        list(
            session.scalars(
                select(Lease).where(
                    Lease.id.in_(lease_ids),
                    Lease.deleted_at.is_(None),
                )
            )
        )
        if lease_ids
        else []
    )
    if lease_ids:
        for link in session.scalars(
            select(LeaseUnit).where(
                LeaseUnit.lease_id.in_(lease_ids),
                LeaseUnit.deleted_at.is_(None),
            )
        ):
            link.deleted_at = now
        for rule in session.scalars(
            select(RentChargeRule).where(
                RentChargeRule.lease_id.in_(lease_ids),
                RentChargeRule.deleted_at.is_(None),
            )
        ):
            rule.deleted_at = now
    obligation_scope = [Obligation.tenancy_unit_id == unit.id]
    if lease_ids:
        obligation_scope.append(Obligation.lease_id.in_(lease_ids))
    for obligation in session.scalars(
        select(Obligation).where(
            Obligation.deleted_at.is_(None),
            or_(*obligation_scope),
        )
    ):
        obligation.deleted_at = now
    for lease in live_leases:
        lease.deleted_at = now
    unit.deleted_at = now


@router.get("/{unit_id}", response_model=TenancyUnitRead)
def get_tenancy_unit(
    unit_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenancyUnit:
    unit, _ = _get_unit_for_user(unit_id, user, session, READ_ROLES)
    return unit


@router.patch("/{unit_id}", response_model=TenancyUnitRead)
def update_tenancy_unit(
    unit_id: UUID,
    payload: TenancyUnitUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenancyUnit:
    unit, prop = _get_unit_for_user(unit_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    if "metadata" in data:
        data["unit_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(unit, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="update",
        target_table="tenancy_unit",
        target_id=unit.id,
    )
    session.commit()
    session.refresh(unit)
    return unit


@router.delete("/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenancy_unit(
    unit_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    unit, prop = _get_unit_for_user(unit_id, user, session, WRITE_ROLES)
    _soft_delete_unit_cascade(unit, session)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="delete",
        target_table="tenancy_unit",
        target_id=unit.id,
    )
    session.commit()
