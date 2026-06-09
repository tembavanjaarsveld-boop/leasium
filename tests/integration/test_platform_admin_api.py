"""Platform-admin tier: gate, integration surface, client provisioning + management.

All provider sends are mocked (no real SendGrid/Twilio/Xero call). See
docs/platform-admin-tier-ia.md.
"""

from collections.abc import Generator
from uuid import UUID

import pytest
from apps.api.deps import get_session
from apps.api.main import app
from apps.api.routers import security as security_router
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from stewart.core.auth import _clerk_user, require_platform_admin
from stewart.core.db import Base
from stewart.core.models import (
    AppUser,
    AuditAction,
    Entity,
    Organisation,
    UserEntityRole,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.communications import DeliveryResult


def _queued(invite, settings):  # noqa: ANN001, ARG001
    return DeliveryResult(
        channel="email",
        status="queued",
        provider="sendgrid",
        recipient=invite.email,
        provider_message_id="platform-invite-1",
    )


@pytest.fixture()
def mock_invite(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    sent: list[str] = []

    def fake_send(invite, settings):  # noqa: ANN001, ARG001
        sent.append(invite.accept_url)
        return _queued(invite, settings)

    monkeypatch.setattr(security_router, "send_operator_invite_email", fake_send)
    return sent


# --- require_platform_admin gate -------------------------------------------------


def test_require_platform_admin_blocks_non_admin() -> None:
    from fastapi import HTTPException
    from stewart.core.auth import CurrentUser

    user = CurrentUser(
        id=UUID(int=1),
        organisation_id=UUID(int=2),
        email="op@example.com",
        display_name="Operator",
        actor="user:op@example.com",
        is_platform_admin=False,
    )
    with pytest.raises(HTTPException) as exc:
        require_platform_admin(user)
    assert exc.value.status_code == 403


def test_require_platform_admin_passes_admin() -> None:
    from stewart.core.auth import CurrentUser

    user = CurrentUser(
        id=UUID(int=1),
        organisation_id=UUID(int=2),
        email="admin@leasium.ai",
        display_name="Admin",
        actor="user:admin@leasium.ai",
        is_platform_admin=True,
    )
    assert require_platform_admin(user) is user


def test_dev_is_platform_admin_flag_controls_current_user() -> None:
    from stewart.core.auth import _dev_user

    admin = _dev_user(Settings(_env_file=None, dev_is_platform_admin=True))
    assert admin.is_platform_admin is True
    not_admin = _dev_user(Settings(_env_file=None, dev_is_platform_admin=False))
    assert not_admin.is_platform_admin is False


# --- integration-status re-gating ------------------------------------------------


def test_integration_status_allows_platform_admin(client: TestClient) -> None:
    # Default dev auth is a platform admin (dev_is_platform_admin defaults True).
    response = client.get("/api/v1/system/integration-status")
    assert response.status_code == 200
    assert "docusign" in response.json()


def test_integration_status_blocks_client_operator(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base = get_settings()
    app.dependency_overrides[get_settings] = lambda: base.model_copy(
        update={"dev_is_platform_admin": False}
    )
    try:
        response = client.get("/api/v1/system/integration-status")
    finally:
        app.dependency_overrides.pop(get_settings, None)
    assert response.status_code == 403


# --- /me exposes the platform-admin flag (drives the /admin nav + gate) ----------


def test_me_exposes_platform_admin_flag(client: TestClient) -> None:
    # Default dev auth is a platform admin (dev_is_platform_admin defaults True).
    response = client.get("/api/v1/me")
    assert response.status_code == 200
    assert response.json()["current_user"]["is_platform_admin"] is True


def test_me_platform_admin_flag_false_for_client_operator(client: TestClient) -> None:
    base = get_settings()
    app.dependency_overrides[get_settings] = lambda: base.model_copy(
        update={"dev_is_platform_admin": False}
    )
    try:
        response = client.get("/api/v1/me")
    finally:
        app.dependency_overrides.pop(get_settings, None)
    assert response.status_code == 200
    assert response.json()["current_user"]["is_platform_admin"] is False


# --- client provisioning + management --------------------------------------------


def test_create_platform_organisation_invites_first_operator(
    client: TestClient,
    session: Session,
    mock_invite: list[str],
) -> None:
    response = client.post(
        "/api/v1/platform/organisations",
        json={
            "organisation_name": "Riverside Holdings",
            "operator_email": "  Owner@Riverside.example ",
            "operator_display_name": "Riverside Owner",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["organisation"]["name"] == "Riverside Holdings"
    assert body["organisation"]["is_active"] is True
    assert body["organisation"]["operator_count"] == 1
    assert body["operator"]["email"] == "owner@riverside.example"
    assert body["operator"]["access_status"] == "invited"
    assert body["delivery_status"] == "queued"
    assert mock_invite  # invite delivery attempted (mocked)

    org = session.scalar(select(Organisation).where(Organisation.name == "Riverside Holdings"))
    assert org is not None
    member = session.scalar(select(AppUser).where(AppUser.email == "owner@riverside.example"))
    assert member is not None and member.organisation_id == org.id
    actions = session.scalars(
        select(AuditAction.action).where(
            AuditAction.target_table == "organisation",
            AuditAction.tool_name == "platform.organisation_provision",
        )
    ).all()
    assert actions == ["provision"]


def test_create_platform_organisation_requires_platform_admin(
    client: TestClient,
) -> None:
    base = get_settings()
    app.dependency_overrides[get_settings] = lambda: base.model_copy(
        update={"dev_is_platform_admin": False}
    )
    try:
        response = client.post(
            "/api/v1/platform/organisations",
            json={"organisation_name": "Blocked Co", "operator_email": "x@example.com"},
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)
    assert response.status_code == 403


def test_list_platform_organisations_excludes_reserved_org(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    reserved = Organisation(
        id=settings.platform_organisation_id,
        name="Leasium Platform",
    )
    client_org = Organisation(name="Client Co")
    session.add_all([reserved, client_org])
    session.commit()

    response = client.get("/api/v1/platform/organisations")
    assert response.status_code == 200
    names = [org["name"] for org in response.json()["organisations"]]
    assert "Leasium Platform" not in names
    assert "Client Co" in names
    assert "SKJ Capital" in names


def test_suspend_then_restore_blocks_and_reenables_login(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    client_org = Organisation(name="Suspend Co")
    session.add(client_org)
    session.flush()
    operator = AppUser(
        organisation_id=client_org.id,
        email="suspend.op@example.com",
        display_name="Suspend Operator",
        auth_provider_id="user_clerk_suspend",
        is_active=True,
    )
    session.add(operator)
    session.commit()

    clerk_settings = settings.model_copy(
        update={
            "auth_mode": "clerk",
            "clerk_secret_key": "sk_test",
            "clerk_jwks_url": "https://clerk.example/jwks.json",
        }
    )

    # Active org: clerk resolver lets the operator in.
    import stewart.core.auth as auth_mod

    auth_mod_orig = auth_mod._clerk_identity

    def fake_identity(token, settings):  # noqa: ANN001, ARG001
        from stewart.core.auth import ClerkIdentity

        return ClerkIdentity(provider_id="user_clerk_suspend")

    auth_mod._clerk_identity = fake_identity
    try:
        resolved = _clerk_user("Bearer t", session, clerk_settings)
        assert resolved.email == "suspend.op@example.com"

        suspend = client.patch(
            f"/api/v1/platform/organisations/{client_org.id}",
            json={"is_active": False},
        )
        assert suspend.status_code == 200
        assert suspend.json()["is_active"] is False

        session.expire_all()
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            _clerk_user("Bearer t", session, clerk_settings)
        assert exc.value.status_code == 403

        restore = client.patch(
            f"/api/v1/platform/organisations/{client_org.id}",
            json={"is_active": True},
        )
        assert restore.status_code == 200
        assert restore.json()["is_active"] is True

        session.expire_all()
        again = _clerk_user("Bearer t", session, clerk_settings)
        assert again.email == "suspend.op@example.com"
    finally:
        auth_mod._clerk_identity = auth_mod_orig

    actions = session.scalars(
        select(AuditAction.action)
        .where(AuditAction.tool_name == "platform.organisation_lifecycle")
        .order_by(AuditAction.occurred_at)
    ).all()
    assert actions == ["suspend", "restore"]


def test_suspend_refuses_reserved_org(client: TestClient, session: Session) -> None:
    settings = get_settings()
    reserved = Organisation(id=settings.platform_organisation_id, name="Leasium Platform")
    session.add(reserved)
    session.commit()

    response = client.patch(
        f"/api/v1/platform/organisations/{settings.platform_organisation_id}",
        json={"is_active": False},
    )
    assert response.status_code == 400


def test_cross_org_member_add_invite_and_disable(
    client: TestClient,
    session: Session,
    mock_invite: list[str],
) -> None:
    client_org = Organisation(name="Members Co")
    session.add(client_org)
    session.commit()

    add = client.post(
        f"/api/v1/platform/organisations/{client_org.id}/members",
        json={"email": "extra.op@example.com", "display_name": "Extra Operator"},
    )
    assert add.status_code == 201
    member_id = add.json()["member"]["id"]
    assert add.json()["member"]["email"] == "extra.op@example.com"
    assert add.json()["delivery_status"] == "queued"

    listing = client.get(f"/api/v1/platform/organisations/{client_org.id}/members")
    assert listing.status_code == 200
    assert any(m["id"] == member_id for m in listing.json()["members"])

    resend = client.post(
        f"/api/v1/platform/organisations/{client_org.id}/members/{member_id}/invite",
    )
    assert resend.status_code == 200
    assert resend.json()["delivery_status"] == "queued"
    assert len(mock_invite) == 2  # one on add, one on resend

    disable = client.patch(
        f"/api/v1/platform/organisations/{client_org.id}/members/{member_id}",
        json={"is_active": False},
    )
    assert disable.status_code == 200
    assert disable.json()["member"]["is_active"] is False

    member = session.get(AppUser, UUID(member_id))
    assert member is not None and member.is_active is False
    actions = session.scalars(
        select(AuditAction.action)
        .where(AuditAction.target_table == "app_user")
        .order_by(AuditAction.occurred_at)
    ).all()
    assert actions == ["invite", "invite", "update"]


def test_cross_org_member_endpoints_require_platform_admin(
    client: TestClient,
    session: Session,
) -> None:
    client_org = Organisation(name="Guard Co")
    session.add(client_org)
    session.commit()

    base = get_settings()
    app.dependency_overrides[get_settings] = lambda: base.model_copy(
        update={"dev_is_platform_admin": False}
    )
    try:
        listing = client.get(f"/api/v1/platform/organisations/{client_org.id}/members")
        add = client.post(
            f"/api/v1/platform/organisations/{client_org.id}/members",
            json={"email": "no@example.com", "display_name": "No"},
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)
    assert listing.status_code == 403
    assert add.status_code == 403


# --- bootstrap reconciliation ----------------------------------------------------


@pytest.fixture()
def empty_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    with TestingSession() as db:
        yield db


def test_bootstrap_closes_once_reserved_platform_org_seeded(
    empty_session: Session,
) -> None:
    from scripts.seed_platform_admin import ensure_platform_admin

    clerk_settings = Settings(
        _env_file=None,
        auth_mode="clerk",
        clerk_secret_key="sk_test",
        clerk_jwks_url="https://clerk.example/jwks.json",
    )

    def override_session() -> Generator[Session, None, None]:
        yield empty_session

    def override_settings() -> Settings:
        return clerk_settings

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_settings] = override_settings
    try:
        with TestClient(app) as test_client:
            before = test_client.get("/api/v1/security/bootstrap/status")
            assert before.status_code == 200
            assert before.json()["available"] is True

            ensure_platform_admin(empty_session)
            empty_session.commit()

            after = test_client.get("/api/v1/security/bootstrap/status")
            assert after.status_code == 200
            assert after.json()["available"] is False
            assert "already has workspace data" in after.json()["reason"]
    finally:
        app.dependency_overrides.clear()


def test_seed_platform_admin_is_idempotent(empty_session: Session) -> None:
    from scripts.seed_platform_admin import ensure_platform_admin

    org1, admin1 = ensure_platform_admin(empty_session)
    empty_session.commit()
    org2, admin2 = ensure_platform_admin(empty_session)
    empty_session.commit()

    assert org1.id == org2.id
    assert admin1.id == admin2.id
    assert admin2.is_platform_admin is True
    from sqlalchemy import func

    org_count = empty_session.scalar(select(func.count(Organisation.id)))
    admin_count = empty_session.scalar(select(func.count(AppUser.id)))
    assert org_count == 1
    assert admin_count == 1
    # Reserved org holds no entities.
    entity_count = empty_session.scalar(select(func.count(Entity.id)))
    assert entity_count == 0


def test_reserved_org_admin_role_unused(empty_session: Session) -> None:
    from scripts.seed_platform_admin import ensure_platform_admin

    _, admin = ensure_platform_admin(empty_session)
    empty_session.commit()
    roles = empty_session.scalars(
        select(UserEntityRole).where(UserEntityRole.user_id == admin.id)
    ).all()
    assert roles == []
    assert admin.is_platform_admin is True
