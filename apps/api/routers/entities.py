"""Entity CRUD routes."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import Entity, Property, UserEntityRole, UserRole, XeroConnection

from apps.api.deps import CurrentUser, get_current_user, get_session
from apps.api.schemas.register import (
    EntityCreate,
    EntityRead,
    EntityUpdate,
    EntityXeroOverviewRead,
    EntityXeroOverviewSummary,
    EntityXeroStatusRead,
)

router = APIRouter(prefix="/entities", tags=["entities"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


@router.get("", response_model=list[EntityRead])
def list_entities(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    include_deleted: bool = False,
) -> list[Entity]:
    statement = (
        select(Entity)
        .join(UserEntityRole, UserEntityRole.entity_id == Entity.id)
        .where(Entity.organisation_id == user.organisation_id, UserEntityRole.user_id == user.id)
    )
    if not include_deleted:
        statement = statement.where(Entity.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(Entity.name)))


@router.post("", response_model=EntityRead, status_code=status.HTTP_201_CREATED)
def create_entity(
    payload: EntityCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Entity:
    if payload.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organisation denied.")
    entity = Entity(**payload.model_dump())
    session.add(entity)
    session.flush()
    session.add(UserEntityRole(user_id=user.id, entity_id=entity.id, role=UserRole.owner))
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="create",
        target_table="entity",
        target_id=entity.id,
    )
    session.commit()
    session.refresh(entity)
    return entity


@router.get("/xero-overview", response_model=EntityXeroOverviewRead)
def entities_xero_overview(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> EntityXeroOverviewRead:
    """Cross-entity Xero connection health for the Entities & Xero hub.

    One row per accessible entity with its property count and derived Xero
    status. Read-only: this never starts an OAuth flow or touches a provider.
    """
    entities = list(
        session.scalars(
            select(Entity)
            .join(UserEntityRole, UserEntityRole.entity_id == Entity.id)
            .where(
                Entity.organisation_id == user.organisation_id,
                UserEntityRole.user_id == user.id,
                Entity.deleted_at.is_(None),
            )
            .order_by(Entity.name)
        )
    )
    entity_ids = [entity.id for entity in entities]
    property_counts: dict[UUID, int] = {}
    connections: dict[UUID, XeroConnection] = {}
    if entity_ids:
        for entity_id, count in session.execute(
            select(Property.entity_id, func.count(Property.id))
            .where(Property.entity_id.in_(entity_ids), Property.deleted_at.is_(None))
            .group_by(Property.entity_id)
        ):
            property_counts[entity_id] = count
        for connection in session.scalars(
            select(XeroConnection).where(
                XeroConnection.entity_id.in_(entity_ids),
                XeroConnection.revoked_at.is_(None),
                XeroConnection.deleted_at.is_(None),
            )
        ):
            connections[connection.entity_id] = connection

    now = datetime.now(UTC)
    counts = {"connected": 0, "token_expired": 0, "manual": 0, "not_connected": 0}
    rows: list[EntityXeroStatusRead] = []
    for entity in entities:
        connection = connections.get(entity.id)
        if connection is not None:
            expires_at = _as_aware(connection.token_expires_at)
            if expires_at is not None and expires_at < now:
                xero_status = "token_expired"
            else:
                xero_status = "connected"
            tenant_name = connection.tenant_name
            last_sync_at = connection.last_contact_sync_at
            token_expires_at = connection.token_expires_at
        elif entity.xero_tenant_id:
            xero_status = "manual"
            tenant_name = None
            last_sync_at = entity.xero_last_sync_at
            token_expires_at = None
        else:
            xero_status = "not_connected"
            tenant_name = None
            last_sync_at = None
            token_expires_at = None
        counts[xero_status] += 1
        rows.append(
            EntityXeroStatusRead(
                id=entity.id,
                name=entity.name,
                entity_type=entity.entity_type,
                is_managing_entity=entity.is_managing_entity,
                property_count=property_counts.get(entity.id, 0),
                xero_status=xero_status,
                tenant_name=tenant_name,
                last_sync_at=last_sync_at,
                token_expires_at=token_expires_at,
            )
        )
    return EntityXeroOverviewRead(
        summary=EntityXeroOverviewSummary(total=len(entities), **counts),
        entities=rows,
    )


@router.get("/{entity_id}", response_model=EntityRead)
def get_entity(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Entity:
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    if entity.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organisation denied.")
    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    if role not in READ_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Entity denied.")
    return entity


@router.patch("/{entity_id}", response_model=EntityRead)
def update_entity(
    entity_id: UUID,
    payload: EntityUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Entity:
    entity = get_entity(entity_id, user, session)
    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Entity denied.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(entity, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="update",
        target_table="entity",
        target_id=entity.id,
    )
    session.commit()
    session.refresh(entity)
    return entity


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    entity = get_entity(entity_id, user, session)
    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Entity denied.")
    entity.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="delete",
        target_table="entity",
        target_id=entity.id,
    )
    session.commit()
