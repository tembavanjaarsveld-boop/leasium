"""Authentication and entity-scoped authorization dependencies."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from stewart.core.db import get_session
from stewart.core.models import AppUser, UserEntityRole, UserRole
from stewart.core.settings import Settings, get_settings


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    organisation_id: UUID
    email: str
    display_name: str
    actor: str


def _dev_user(settings: Settings) -> CurrentUser:
    return CurrentUser(
        id=settings.dev_user_id,
        organisation_id=settings.dev_organisation_id,
        email=settings.dev_user_email,
        display_name=settings.dev_user_name,
        actor=f"user:{settings.dev_user_email}",
    )


def _clerk_user(
    authorization: str | None,
    session: Session,
) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Clerk bearer token.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    user = session.scalar(select(AppUser).where(AppUser.auth_provider_id == token))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown Clerk user.")
    return CurrentUser(
        id=user.id,
        organisation_id=user.organisation_id,
        email=user.email,
        display_name=user.display_name,
        actor=f"user:{user.email}",
    )


def get_current_user(
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Resolve the current user through dev auth or the Clerk adapter boundary."""

    if settings.auth_mode == "dev":
        return _dev_user(settings)
    return _clerk_user(authorization, session)


def assert_entity_role(
    session: Session,
    user: CurrentUser,
    entity_id: UUID,
    allowed_roles: set[UserRole],
) -> None:
    """Raise 403 unless the user has one of the allowed roles for the entity."""

    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity_id,
        )
    )
    if role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this entity.",
        )


def require_entity_role(
    entity_id: UUID, allowed_roles: set[UserRole]
) -> Callable[..., CurrentUser]:
    """Dependency-style helper for routes that already have an entity id."""

    def dependency(
        user: Annotated[CurrentUser, Depends(get_current_user)],
        session: Annotated[Session, Depends(get_session)],
    ) -> CurrentUser:
        assert_entity_role(session, user, entity_id, allowed_roles)
        return user

    return dependency
