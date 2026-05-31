"""Owner entity CRUD router (DoorLoop benchmark P0, Ticket 1.4).

First-class ``Owner`` records: list / create / detail / patch / soft-delete
under ``/owners``. Registered AFTER ``owners.router`` (the statements router)
so the literal ``/owners/statements*`` paths resolve before the
``/owners/{owner_id}`` parameter route.

Owner *statements* still derive from ``Property`` fields until the read-path
cutover (Ticket 1.3); this router manages the new entity itself.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import AuditOutcome, Owner, Property, PropertyOwner, UserRole

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.owner_entities import (
    OwnerCreate,
    OwnerPropertyLinkCreate,
    OwnerPropertyLinkRead,
    OwnerRead,
    OwnerUpdate,
)

router = APIRouter(prefix="/owners", tags=["owners"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

_IDENTITY_FIELDS = ("legal_name", "trust_name", "trustee_name", "invoice_issuer_name")


def _read(owner: Owner, session: Session) -> OwnerRead:
    rows = session.execute(
        select(PropertyOwner.property_id, Property.name, PropertyOwner.split_pct)
        .join(Property, Property.id == PropertyOwner.property_id)
        .where(PropertyOwner.owner_id == owner.id, Property.deleted_at.is_(None))
        .order_by(Property.name.asc())
    ).all()
    properties = [
        OwnerPropertyLinkRead(
            property_id=property_id, property_name=name, split_pct=float(split_pct)
        )
        for property_id, name, split_pct in rows
    ]
    return OwnerRead.model_validate(owner).model_copy(
        update={"property_count": len(properties), "properties": properties}
    )


def _has_identity(values: dict[str, object]) -> bool:
    for field in _IDENTITY_FIELDS:
        value = values.get(field)
        if isinstance(value, str) and value.strip():
            return True
    return False


@router.get("", response_model=list[OwnerRead])
def list_owners(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> list[OwnerRead]:
    """Return all non-deleted owners for ``entity_id`` with their property links."""

    assert_entity_role(session, user, entity_id, READ_ROLES)
    owners = list(
        session.scalars(
            select(Owner)
            .where(Owner.entity_id == entity_id, Owner.deleted_at.is_(None))
            .order_by(Owner.legal_name.asc(), Owner.created_at.asc())
        ).all()
    )
    return [_read(owner, session) for owner in owners]


@router.post("", response_model=OwnerRead, status_code=status.HTTP_201_CREATED)
def create_owner(
    payload: OwnerCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnerRead:
    """Create a first-class owner. Requires at least one identity field."""

    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    data = payload.model_dump()
    if not _has_identity(data):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Provide at least one of legal name, trust name, trustee name, "
                "or invoice issuer name."
            ),
        )
    owner = Owner(**data)
    session.add(owner)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=owner.entity_id,
        action="create",
        target_table="owner",
        target_id=owner.id,
        tool_name="owner.create",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(owner)
    return _read(owner, session)


def _get_owner_for_user(
    owner_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Owner:
    owner = session.get(Owner, owner_id)
    if owner is None or owner.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Owner not found."
        )
    assert_entity_role(session, user, owner.entity_id, roles)
    return owner


@router.get("/{owner_id}", response_model=OwnerRead)
def get_owner(
    owner_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnerRead:
    owner = _get_owner_for_user(owner_id, user, session, READ_ROLES)
    return _read(owner, session)


@router.patch("/{owner_id}", response_model=OwnerRead)
def update_owner(
    owner_id: UUID,
    payload: OwnerUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnerRead:
    """Patch owner fields. Every field optional."""

    owner = _get_owner_for_user(owner_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(owner, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=owner.entity_id,
        action="update",
        target_table="owner",
        target_id=owner.id,
        tool_name="owner.update",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(owner)
    return _read(owner, session)


@router.delete("/{owner_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_owner(
    owner_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Soft-delete an owner — stamps ``deleted_at``, leaves the row + its links."""

    owner = _get_owner_for_user(owner_id, user, session, WRITE_ROLES)
    owner.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=owner.entity_id,
        action="delete",
        target_table="owner",
        target_id=owner.id,
        tool_name="owner.delete",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()


@router.post("/{owner_id}/properties", response_model=OwnerRead)
def attach_property(
    owner_id: UUID,
    payload: OwnerPropertyLinkCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnerRead:
    """Attach a property to the owner at ``split_pct`` — upsert by property."""

    owner = _get_owner_for_user(owner_id, user, session, WRITE_ROLES)
    if not 0 < payload.split_pct <= 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Ownership split must be greater than 0 and at most 100.",
        )
    prop = session.get(Property, payload.property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Property not found."
        )
    if prop.entity_id != owner.entity_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Property belongs to a different entity than the owner.",
        )

    link = session.scalar(
        select(PropertyOwner).where(
            PropertyOwner.owner_id == owner.id,
            PropertyOwner.property_id == prop.id,
        )
    )
    action = "update"
    if link is None:
        link = PropertyOwner(
            owner_id=owner.id, property_id=prop.id, split_pct=payload.split_pct
        )
        session.add(link)
        action = "create"
    else:
        link.split_pct = payload.split_pct
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=owner.entity_id,
        action=action,
        target_table="property_owner",
        target_id=owner.id,
        tool_name="owner.attach_property",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(owner)
    return _read(owner, session)


@router.delete(
    "/{owner_id}/properties/{property_id}", status_code=status.HTTP_204_NO_CONTENT
)
def detach_property(
    owner_id: UUID,
    property_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Remove a property link from the owner."""

    owner = _get_owner_for_user(owner_id, user, session, WRITE_ROLES)
    link = session.scalar(
        select(PropertyOwner).where(
            PropertyOwner.owner_id == owner.id,
            PropertyOwner.property_id == property_id,
        )
    )
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Property link not found."
        )
    session.delete(link)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=owner.entity_id,
        action="delete",
        target_table="property_owner",
        target_id=owner.id,
        tool_name="owner.detach_property",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
