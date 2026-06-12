"""Contractor directory router.

v1 of the maintenance categorisation feature. Per-entity directory of
maintenance contractors with categories, contact details, priority, and
notes. v2 wires the AI maintenance-categorisation classifier to suggest a
contractor on each work order; v1 is just the directory operators
reference manually.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    Contractor,
    UserRole,
)

from apps.api.deps import (
    CurrentUser,
    assert_entity_role,
    get_current_user,
    get_session,
    readable_entity_ids,
)
from apps.api.schemas.contractors import (
    ContractorCreate,
    ContractorRead,
    ContractorUpdate,
)

router = APIRouter(prefix="/contractors", tags=["contractors"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}

WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _read(contractor: Contractor) -> ContractorRead:
    return ContractorRead.model_validate(contractor)


@router.get("", response_model=list[ContractorRead])
def list_contractors(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID | None = None,
) -> list[ContractorRead]:
    """Return non-deleted contractors for one entity or all readable entities.

    Sorted by priority asc (1 = preferred first), then name.
    """

    statement = select(Contractor)
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(Contractor.entity_id == entity_id)
    else:
        statement = statement.where(
            Contractor.entity_id.in_(readable_entity_ids(session, user, READ_ROLES))
        )
    rows = list(
        session.scalars(
            statement.where(Contractor.deleted_at.is_(None)).order_by(
                Contractor.priority.asc(),
                Contractor.name.asc(),
            )
        ).all()
    )
    return [_read(row) for row in rows]


@router.post(
    "", response_model=ContractorRead, status_code=status.HTTP_201_CREATED
)
def create_contractor(
    payload: ContractorCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ContractorRead:
    """Create a new contractor in the entity's directory."""

    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    if not payload.name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Contractor name is required.",
        )
    if payload.priority not in (1, 2, 3):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Priority must be 1 (preferred), 2 (normal), or 3 (backup).",
        )
    contractor = Contractor(
        entity_id=payload.entity_id,
        name=payload.name.strip(),
        company_name=payload.company_name,
        categories=list(payload.categories or []),
        email=payload.email,
        phone=payload.phone,
        service_radius_km=payload.service_radius_km,
        priority=payload.priority,
        notes=payload.notes,
    )
    session.add(contractor)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=contractor.entity_id,
        action="create",
        target_table="contractor",
        target_id=contractor.id,
        tool_name="contractor.create",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(contractor)
    return _read(contractor)


def _get_contractor_for_user(
    contractor_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Contractor:
    contractor = session.get(Contractor, contractor_id)
    if contractor is None or contractor.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contractor not found.",
        )
    assert_entity_role(session, user, contractor.entity_id, roles)
    return contractor


@router.get("/{contractor_id}", response_model=ContractorRead)
def get_contractor(
    contractor_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ContractorRead:
    """Return one non-deleted contractor visible to the operator."""

    contractor = _get_contractor_for_user(contractor_id, user, session, READ_ROLES)
    return _read(contractor)


@router.patch("/{contractor_id}", response_model=ContractorRead)
def update_contractor(
    contractor_id: UUID,
    payload: ContractorUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ContractorRead:
    """Patch a contractor's fields. Every field optional."""

    contractor = _get_contractor_for_user(contractor_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        if not data["name"] or not data["name"].strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Contractor name cannot be blank.",
            )
        data["name"] = data["name"].strip()
    if "priority" in data and data["priority"] not in (1, 2, 3):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Priority must be 1 (preferred), 2 (normal), or 3 (backup).",
        )
    if "categories" in data and data["categories"] is not None:
        data["categories"] = list(data["categories"])
    for key, value in data.items():
        setattr(contractor, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=contractor.entity_id,
        action="update",
        target_table="contractor",
        target_id=contractor.id,
        tool_name="contractor.update",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(contractor)
    return _read(contractor)


@router.delete(
    "/{contractor_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_contractor(
    contractor_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Soft-delete a contractor — stamps ``deleted_at``, leaves the row."""

    contractor = _get_contractor_for_user(contractor_id, user, session, WRITE_ROLES)
    contractor.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=contractor.entity_id,
        action="delete",
        target_table="contractor",
        target_id=contractor.id,
        tool_name="contractor.delete",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
