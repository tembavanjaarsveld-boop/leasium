"""Auth and role dependency tests."""

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.auth import _clerk_provider_id, _dev_user, assert_entity_role
from stewart.core.models import Entity, UserRole
from stewart.core.settings import Settings, get_settings


def test_dev_user_comes_from_settings() -> None:
    settings = get_settings()
    user = _dev_user(settings)

    assert user.id == settings.dev_user_id
    assert user.organisation_id == settings.dev_organisation_id
    assert user.actor == f"user:{settings.dev_user_email}"


def test_clerk_provider_id_requires_jwks_url_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CLERK_ALLOW_LEGACY_TOKEN_MAPPING", raising=False)
    settings = Settings(_env_file=None, auth_mode="clerk", clerk_jwks_url="")

    with pytest.raises(HTTPException) as exc_info:
        _clerk_provider_id("user_clerk_owner", settings)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Clerk JWKS is not configured."


def test_clerk_provider_id_legacy_token_mapping_requires_explicit_flag() -> None:
    disabled_settings = Settings(
        _env_file=None,
        auth_mode="clerk",
        clerk_jwks_url="",
        clerk_allow_legacy_token_mapping=False,
    )
    enabled_settings = Settings(
        _env_file=None,
        auth_mode="clerk",
        clerk_jwks_url="",
        clerk_allow_legacy_token_mapping=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        _clerk_provider_id("user_legacy_owner", disabled_settings)

    assert exc_info.value.status_code == 401
    assert _clerk_provider_id("user_legacy_owner", enabled_settings) == "user_legacy_owner"


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
