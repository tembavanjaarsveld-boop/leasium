"""Organisation CRUD routes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import Organisation

from apps.api.deps import CurrentUser, get_current_user, get_session
from apps.api.schemas.register import OrganisationCreate, OrganisationRead, OrganisationUpdate

router = APIRouter(prefix="/organisations", tags=["organisations"])


@router.get("", response_model=list[OrganisationRead])
def list_organisations(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> list[Organisation]:
    return list(
        session.scalars(select(Organisation).where(Organisation.id == user.organisation_id))
    )


@router.post("", response_model=OrganisationRead, status_code=status.HTTP_201_CREATED)
def create_organisation(
    payload: OrganisationCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Organisation:
    org = Organisation(**payload.model_dump())
    session.add(org)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        action="create",
        target_table="organisation",
        target_id=org.id,
    )
    session.commit()
    session.refresh(org)
    return org


@router.get("/{organisation_id}", response_model=OrganisationRead)
def get_organisation(
    organisation_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Organisation:
    if organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organisation denied.")
    org = session.get(Organisation, organisation_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found.")
    return org


@router.patch("/{organisation_id}", response_model=OrganisationRead)
def update_organisation(
    organisation_id: UUID,
    payload: OrganisationUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Organisation:
    org = get_organisation(organisation_id, user, session)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(org, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        action="update",
        target_table="organisation",
        target_id=org.id,
    )
    session.commit()
    session.refresh(org)
    return org
