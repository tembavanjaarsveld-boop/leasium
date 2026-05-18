"""Lease CRUD routes with unit, property, and entity scoped access checks."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import Lease, Property, TenancyUnit, Tenant, UserRole

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register import LeaseCreate, LeaseRead, LeaseUpdate

router = APIRouter(prefix="/leases", tags=["leases"])

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


def _unit_for_access(
    unit_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> tuple[TenancyUnit, Property]:
    unit = session.get(TenancyUnit, unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenancy unit not found.")
    prop = _property_for_access(unit.property_id, user, session, roles)
    return unit, prop


def _tenant_for_access(
    tenant_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> Tenant:
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    assert_entity_role(session, user, tenant.entity_id, roles)
    return tenant


def _entity_id_for_lease_parts(
    tenant_id: UUID,
    unit_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> UUID:
    tenant = _tenant_for_access(tenant_id, user, session, roles)
    _, prop = _unit_for_access(unit_id, user, session, roles)
    if tenant.entity_id != prop.entity_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tenant and tenancy unit must belong to the same entity.",
        )
    return prop.entity_id


@router.get("", response_model=list[LeaseRead])
def list_leases(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID | None = None,
    property_id: UUID | None = None,
    tenancy_unit_id: UUID | None = None,
    unit_id: UUID | None = None,
    tenant_id: UUID | None = None,
    include_deleted: bool = False,
) -> list[Lease]:
    tenancy_unit_scope = tenancy_unit_id or unit_id
    if (
        entity_id is None
        and property_id is None
        and tenancy_unit_scope is None
        and tenant_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide an entity, property, tenancy unit, or tenant scope.",
        )

    statement = (
        select(Lease)
        .join(TenancyUnit)
        .join(Property)
        .join(Tenant, Tenant.id == Lease.tenant_id)
    )

    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(Property.entity_id == entity_id)
    if property_id is not None:
        _property_for_access(property_id, user, session, READ_ROLES)
        statement = statement.where(TenancyUnit.property_id == property_id)
    if tenancy_unit_scope is not None:
        _unit_for_access(tenancy_unit_scope, user, session, READ_ROLES)
        statement = statement.where(Lease.tenancy_unit_id == tenancy_unit_scope)
    if tenant_id is not None:
        _tenant_for_access(tenant_id, user, session, READ_ROLES)
        statement = statement.where(Lease.tenant_id == tenant_id)
    if not include_deleted:
        statement = statement.where(Lease.deleted_at.is_(None))

    statement = statement.where(
        Property.deleted_at.is_(None),
        TenancyUnit.deleted_at.is_(None),
        Tenant.deleted_at.is_(None),
    )
    return list(session.scalars(statement.order_by(Lease.expiry_date, Lease.created_at)))


@router.post("", response_model=LeaseRead, status_code=status.HTTP_201_CREATED)
def create_lease(
    payload: LeaseCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Lease:
    entity_id = _entity_id_for_lease_parts(
        payload.tenant_id, payload.tenancy_unit_id, user, session, WRITE_ROLES
    )
    data = payload.model_dump()
    data["lease_metadata"] = data.pop("metadata")
    lease = Lease(**data)
    session.add(lease)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="create",
        target_table="lease",
        target_id=lease.id,
    )
    session.commit()
    session.refresh(lease)
    return lease


def _get_lease_for_user(
    lease_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> tuple[Lease, UUID]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lease not found.")
    _, prop = _unit_for_access(lease.tenancy_unit_id, user, session, roles)
    tenant = _tenant_for_access(lease.tenant_id, user, session, roles)
    if tenant.entity_id != prop.entity_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease links tenant and unit across different entities.",
        )
    return lease, prop.entity_id


@router.get("/{lease_id}", response_model=LeaseRead)
def get_lease(
    lease_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Lease:
    lease, _ = _get_lease_for_user(lease_id, user, session, READ_ROLES)
    return lease


@router.patch("/{lease_id}", response_model=LeaseRead)
def update_lease(
    lease_id: UUID,
    payload: LeaseUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Lease:
    lease, _ = _get_lease_for_user(lease_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    tenant_id = data.get("tenant_id", lease.tenant_id)
    unit_id = data.get("tenancy_unit_id", lease.tenancy_unit_id)
    entity_id = _entity_id_for_lease_parts(tenant_id, unit_id, user, session, WRITE_ROLES)
    if "metadata" in data:
        data["lease_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(lease, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="update",
        target_table="lease",
        target_id=lease.id,
    )
    session.commit()
    session.refresh(lease)
    return lease


@router.delete("/{lease_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lease(
    lease_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    lease, entity_id = _get_lease_for_user(lease_id, user, session, WRITE_ROLES)
    lease.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="delete",
        target_table="lease",
        target_id=lease.id,
    )
    session.commit()
