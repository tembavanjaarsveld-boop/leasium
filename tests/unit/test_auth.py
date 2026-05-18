"""Auth and role dependency tests."""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.auth import _dev_user, assert_entity_role
from stewart.core.models import Entity, UserRole
from stewart.core.settings import get_settings


def test_dev_user_comes_from_settings() -> None:
    settings = get_settings()
    user = _dev_user(settings)

    assert user.id == settings.dev_user_id
    assert user.organisation_id == settings.dev_organisation_id
    assert user.actor == f"user:{settings.dev_user_email}"


def test_assert_entity_role_allows_matching_role(session: Session) -> None:
    settings = get_settings()
    user = _dev_user(settings)
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None

    assert_entity_role(session, user, entity.id, {UserRole.owner})


def test_assert_entity_role_blocks_missing_role(session: Session) -> None:
    settings = get_settings()
    user = _dev_user(settings)
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None

    try:
        assert_entity_role(session, user, entity.id, {UserRole.viewer})
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("Expected missing role to be blocked.")
