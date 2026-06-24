"""Property CRUD routes with entity-scoped access checks."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    Lease,
    Obligation,
    Property,
    RentChargeRule,
    TenancyUnit,
    UserRole,
)

from apps.api.deps import (
    CurrentUser,
    assert_entity_role,
    get_current_user,
    get_session,
    readable_entity_ids,
)
from apps.api.schemas.register import PropertyCreate, PropertyRead, PropertyUpdate

router = APIRouter(prefix="/properties", tags=["properties"])
alias_router = APIRouter(prefix="/premises", tags=["properties"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


@router.get("", response_model=list[PropertyRead])
def list_properties(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID | None = None,
    include_deleted: bool = False,
) -> list[Property]:
    statement = select(Property)
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(Property.entity_id == entity_id)
    else:
        statement = statement.where(
            Property.entity_id.in_(readable_entity_ids(session, user, READ_ROLES))
        )
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


def _soft_delete_property_cascade(prop: Property, session: Session) -> dict[str, int]:
    """Soft-delete a property and the register records that hang off it.

    Units, their leases, those leases' charge rules, and any obligations scoped
    to the property/unit/lease are all marked deleted so nothing is orphaned and
    a later re-import stays clean. Tenants are entity-scoped and shared, so they
    are intentionally left in place.
    """
    now = utcnow()
    units = list(
        session.scalars(
            select(TenancyUnit).where(
                TenancyUnit.property_id == prop.id,
                TenancyUnit.deleted_at.is_(None),
            )
        )
    )
    unit_ids = [unit.id for unit in units]

    leases: list[Lease] = []
    if unit_ids:
        leases = list(
            session.scalars(
                select(Lease).where(
                    Lease.tenancy_unit_id.in_(unit_ids),
                    Lease.deleted_at.is_(None),
                )
            )
        )
    lease_ids = [lease.id for lease in leases]

    if lease_ids:
        for rule in session.scalars(
            select(RentChargeRule).where(
                RentChargeRule.lease_id.in_(lease_ids),
                RentChargeRule.deleted_at.is_(None),
            )
        ):
            rule.deleted_at = now

    obligation_scope = [Obligation.property_id == prop.id]
    if unit_ids:
        obligation_scope.append(Obligation.tenancy_unit_id.in_(unit_ids))
    if lease_ids:
        obligation_scope.append(Obligation.lease_id.in_(lease_ids))
    for obligation in session.scalars(
        select(Obligation).where(
            Obligation.deleted_at.is_(None),
            or_(*obligation_scope),
        )
    ):
        obligation.deleted_at = now

    for lease in leases:
        lease.deleted_at = now
    for unit in units:
        unit.deleted_at = now
    prop.deleted_at = now
    return {"units": len(units), "leases": len(leases)}


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property(
    property_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    prop = _get_property_for_user(property_id, user, session, WRITE_ROLES)
    cascade = _soft_delete_property_cascade(prop, session)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="delete",
        target_table="property",
        target_id=prop.id,
        tool_output_summary=(
            f"Soft-deleted property with {cascade['units']} unit(s) "
            f"and {cascade['leases']} lease(s)."
        ),
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
