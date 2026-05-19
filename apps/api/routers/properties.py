"""Property CRUD routes with entity-scoped access checks."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import Property, UserRole

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register import PropertyCreate, PropertyRead, PropertyUpdate

router = APIRouter(prefix="/properties", tags=["properties"])
alias_router = APIRouter(prefix="/premises", tags=["properties"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


@router.get("", response_model=list[PropertyRead])
def list_properties(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    include_deleted: bool = False,
) -> list[Property]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = select(Property).where(Property.entity_id == entity_id)
    if not include_deleted:
        statement = statement.where(Property.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(Property.name)))


@router.post("", response_model=PropertyRead, status_code=status.HTTP_201_CREATED)
def create_property(
    payload: PropertyCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Property:
    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    data = payload.model_dump()
    data["property_metadata"] = data.pop("metadata")
    prop = Property(**data)
    session.add(prop)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="create",
        target_table="property",
        target_id=prop.id,
    )
    session.commit()
    session.refresh(prop)
    return prop


def _get_property_for_user(
    property_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    assert_entity_role(session, user, prop.entity_id, roles)
    return prop


@router.get("/{property_id}", response_model=PropertyRead)
def get_property(
    property_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Property:
    return _get_property_for_user(property_id, user, session, READ_ROLES)


@router.patch("/{property_id}", response_model=PropertyRead)
def update_property(
    property_id: UUID,
    payload: PropertyUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Property:
    prop = _get_property_for_user(property_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    if "metadata" in data:
        data["property_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(prop, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="update",
        target_table="property",
        target_id=prop.id,
    )
    session.commit()
    session.refresh(prop)
    return prop


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property(
    property_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    prop = _get_property_for_user(property_id, user, session, WRITE_ROLES)
    prop.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="delete",
        target_table="property",
        target_id=prop.id,
    )
    session.commit()


def list_premises_by_entity(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    include_deleted: bool = False,
) -> list[Property]:
    return list_properties(user, session, entity_id, include_deleted)


alias_router.add_api_route(
    "",
    list_properties,
    methods=["GET"],
    response_model=list[PropertyRead],
)
alias_router.add_api_route(
    "",
    create_property,
    methods=["POST"],
    response_model=PropertyRead,
    status_code=status.HTTP_201_CREATED,
)
alias_router.add_api_route(
    "/by-entity/{entity_id}",
    list_premises_by_entity,
    methods=["GET"],
    response_model=list[PropertyRead],
)
alias_router.add_api_route(
    "/{property_id}",
    get_property,
    methods=["GET"],
    response_model=PropertyRead,
)
alias_router.add_api_route(
    "/{property_id}",
    update_property,
    methods=["PATCH"],
    response_model=PropertyRead,
)
alias_router.add_api_route(
    "/{property_id}",
    delete_property,
    methods=["DELETE"],
    status_code=status.HTTP_204_NO_CONTENT,
)
