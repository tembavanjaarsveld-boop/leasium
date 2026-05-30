"""Auth and role dependency tests."""

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core import auth as auth_module
from stewart.core.auth import (
    ClerkIdentity,
    _clerk_jwks_client,
    _clerk_provider_id,
    _clerk_user,
    _dev_user,
    _verified_email_from_clerk_user,
    _verified_emails_from_clerk_user,
    assert_entity_role,
)
from stewart.core.models import AppUser, Entity, OperatorInviteStatus, UserRole
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


def test_clerk_jwks_client_is_reused_across_token_checks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        auth_mode="clerk",
        clerk_jwks_url="https://clerk.example/.well-known/jwks.json",
    )
    init_count = 0

    class FakeSigningKey:
        key = "public-key"

    class FakeJwksClient:
        def __init__(self, jwks_url: str) -> None:
            nonlocal init_count
            init_count += 1
            assert jwks_url == settings.clerk_jwks_url

        def get_signing_key_from_jwt(self, token: str) -> FakeSigningKey:
            assert token == "signed-in-session"
            return FakeSigningKey()

    _clerk_jwks_client.cache_clear()
    monkeypatch.setattr(auth_module, "PyJWKClient", FakeJwksClient)
    monkeypatch.setattr(
        auth_module.jwt,
        "decode",
        lambda *_args, **_kwargs: {"sub": "user_clerk_owner"},
    )

    assert _clerk_provider_id("signed-in-session", settings) == "user_clerk_owner"
    assert _clerk_provider_id("signed-in-session", settings) == "user_clerk_owner"
    assert init_count == 1

    _clerk_jwks_client.cache_clear()


def test_clerk_user_links_existing_operator_by_verified_email_claim(
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
) -> None:
    seeded_user = session.scalar(select(AppUser))
    assert seeded_user is not None
    settings = Settings(
        _env_file=None,
        auth_mode="clerk",
        clerk_jwks_url="https://clerk.example/.well-known/jwks.json",
    )

    def fake_clerk_identity(token: str, auth_settings: Settings) -> ClerkIdentity:
        assert token == "signed-in-session"
        assert auth_settings is settings
        return ClerkIdentity(
            provider_id="user_new_clerk_subject",
            verified_email=seeded_user.email.upper(),
        )

    monkeypatch.setattr(auth_module, "_clerk_identity", fake_clerk_identity)

    current_user = _clerk_user("Bearer signed-in-session", session, settings)

    user = session.scalar(select(AppUser).where(AppUser.email == seeded_user.email))
    assert user is not None
    assert current_user.id == user.id
    assert user.auth_provider_id == "user_new_clerk_subject"
    assert user.invite_status == OperatorInviteStatus.accepted
    assert user.invite_accepted_at is not None


def test_clerk_user_rejects_unknown_verified_email(
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
) -> None:
    settings = Settings(
        _env_file=None,
        auth_mode="clerk",
        clerk_jwks_url="https://clerk.example/.well-known/jwks.json",
    )

    monkeypatch.setattr(
        auth_module,
        "_clerk_identity",
        lambda token, auth_settings: ClerkIdentity(
            provider_id="user_new_clerk_subject",
            verified_email="missing@example.com",
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        _clerk_user("Bearer signed-in-session", session, settings)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Unknown Clerk user."


def test_verified_email_from_clerk_user_uses_verified_primary_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(_env_file=None, clerk_secret_key="sk_test_clerk")
    requests: list[httpx.Request] = []

    def fake_get(
        url: str,
        headers: dict[str, str],
        timeout: float,
    ) -> httpx.Response:
        request = httpx.Request("GET", url, headers=headers)
        requests.append(request)
        assert timeout == 5.0
        return httpx.Response(
            200,
            json={
                "primary_email_address_id": "email_primary",
                "email_addresses": [
                    {
                        "id": "email_primary",
                        "email_address": " Ash@SKJCapital.com ",
                        "verification": {"status": "verified"},
                    }
                ],
            },
            request=request,
        )

    monkeypatch.setattr(auth_module.httpx, "get", fake_get)

    email = _verified_email_from_clerk_user("user_clerk_subject", settings)

    assert email == "ash@skjcapital.com"
    assert requests[0].url == "https://api.clerk.com/v1/users/user_clerk_subject"
    assert requests[0].headers["authorization"] == "Bearer sk_test_clerk"
    assert requests[0].headers["accept"] == "application/json"
    assert requests[0].headers["user-agent"] == "Leasium/1.0 (+https://leasium.ai)"


def test_verified_email_from_clerk_user_rejects_unverified_primary_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(_env_file=None, clerk_secret_key="sk_test_clerk")

    def fake_get(
        url: str,
        headers: dict[str, str],  # noqa: ARG001
        timeout: float,  # noqa: ARG001
    ) -> httpx.Response:
        request = httpx.Request("GET", url)
        return httpx.Response(
            200,
            json={
                "primary_email_address_id": "email_primary",
                "email_addresses": [
                    {
                        "id": "email_primary",
                        "email_address": "ash@skjcapital.com",
                        "verification": {"status": "unverified"},
                    }
                ],
            },
            request=request,
        )

    monkeypatch.setattr(auth_module.httpx, "get", fake_get)

    assert _verified_email_from_clerk_user("user_clerk_subject", settings) is None


def test_verified_emails_from_clerk_user_returns_all_verified_emails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(_env_file=None, clerk_secret_key="sk_test_clerk")

    def fake_get(
        url: str,
        headers: dict[str, str],  # noqa: ARG001
        timeout: float,  # noqa: ARG001
    ) -> httpx.Response:
        request = httpx.Request("GET", url)
        return httpx.Response(
            200,
            json={
                "primary_email_address_id": "email_old",
                "email_addresses": [
                    {
                        "id": "email_old",
                        "email_address": "old@example.com",
                        "verification": {"status": "verified"},
                    },
                    {
                        "id": "email_new",
                        "email_address": " Tenant@Example.com ",
                        "verification": {"status": "verified"},
                    },
                    {
                        "id": "email_unverified",
                        "email_address": "unverified@example.com",
                        "verification": {"status": "unverified"},
                    },
                ],
            },
            request=request,
        )

    monkeypatch.setattr(auth_module.httpx, "get", fake_get)

    assert _verified_emails_from_clerk_user("user_clerk_subject", settings) == {
        "old@example.com",
        "tenant@example.com",
    }


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
