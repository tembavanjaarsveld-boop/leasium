"""Tenant CRUD routes with entity-scoped access checks."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import Tenant, UserRole

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register import TenantCreate, TenantRead, TenantUpdate

router = APIRouter(prefix="/tenants", tags=["tenants"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


@router.get("", response_model=list[TenantRead])
def list_tenants(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    include_deleted: bool = False,
) -> list[Tenant]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = select(Tenant).where(Tenant.entity_id == entity_id)
    if not include_deleted:
        statement = statement.where(Tenant.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(Tenant.legal_name)))


@router.post("", response_model=TenantRead, status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Tenant:
    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    data = payload.model_dump()
    data["tenant_metadata"] = data.pop("metadata")
    tenant = Tenant(**data)
    session.add(tenant)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="create",
        target_table="tenant",
        target_id=tenant.id,
    )
    session.commit()
    session.refresh(tenant)
    return tenant


def _get_tenant_for_user(
    tenant_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Tenant:
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    assert_entity_role(session, user, tenant.entity_id, roles)
    return tenant


@router.get("/{tenant_id}", response_model=TenantRead)
def get_tenant(
    tenant_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Tenant:
    return _get_tenant_for_user(tenant_id, user, session, READ_ROLES)


@router.patch("/{tenant_id}", response_model=TenantRead)
def update_tenant(
    tenant_id: UUID,
    payload: TenantUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Tenant:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    if "metadata" in data:
        data["tenant_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(tenant, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="update",
        target_table="tenant",
        target_id=tenant.id,
    )
    session.commit()
    session.refresh(tenant)
    return tenant


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(
    tenant_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    tenant.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="delete",
        target_table="tenant",
        target_id=tenant.id,
    )
    session.commit()
