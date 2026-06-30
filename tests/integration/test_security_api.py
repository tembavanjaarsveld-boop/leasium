"""Security and operator access API integration tests."""

from collections.abc import Generator
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest
from apps.api.deps import get_session
from apps.api.main import app
from apps.api.routers import security as security_router
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from stewart.core.db import Base
from stewart.core.models import (
    AppUser,
    AuditAction,
    Entity,
    Organisation,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.communications import DeliveryResult


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


@pytest.fixture()
def clerk_bootstrap_settings() -> Settings:
    return Settings(
        _env_file=None,
        auth_mode="clerk",
        clerk_secret_key="sk_test_clerk",
        clerk_jwks_url="https://clerk.example/.well-known/jwks.json",
        clerk_allow_legacy_token_mapping=False,
    )


@pytest.fixture()
def empty_clerk_client(
    empty_session: Session,
    clerk_bootstrap_settings: Settings,
) -> Generator[TestClient, None, None]:
    def override_session() -> Generator[Session, None, None]:
        yield empty_session

    def override_settings() -> Settings:
        return clerk_bootstrap_settings

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_settings] = override_settings
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def clerk_client(
    session: Session,
    clerk_bootstrap_settings: Settings,
) -> Generator[TestClient, None, None]:
    def override_session() -> Generator[Session, None, None]:
        yield session

    def override_settings() -> Settings:
        return clerk_bootstrap_settings

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_settings] = override_settings
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def test_security_workspace_lists_current_operator_and_auth_boundary(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)

    me_response = client.get("/api/v1/me")
    assert me_response.status_code == 200
    me_body = me_response.json()
    assert me_body["current_user"]["email"] == get_settings().dev_user_email
    assert me_body["roles"][0]["entity_id"] == str(entity.id)
    assert me_body["can_manage_security"] is True
    assert me_body["organisation"]["operating_mode"] == "self_managed_owner"

    response = client.get("/api/v1/security/workspace")

    assert response.status_code == 200
    body = response.json()
    assert body["auth"]["auth_mode"] == "dev"
    assert body["auth"]["dev_auth_active"] is True
    assert body["auth"]["operator_login_enforced"] is False
    assert body["organisation"]["name"] == "SKJ Capital"
    assert body["organisation"]["operating_mode"] == "self_managed_owner"
    assert body["current_user"]["email"] == get_settings().dev_user_email
    assert body["can_manage_security"] is True
    assert body["members"][0]["notification_preferences"] == {
        "work_assignment_email_enabled": True,
        "work_assignment_sms_enabled": False,
        "work_assignment_sms_phone": None,
        "work_assignment_notice_template_key": "work_assignment_notification",
        "work_assignment_notice_template_version": "v1",
        "work_assignment_digest_cadence": "daily",
        "work_assignment_digest_template_key": "work_assignment_digest",
        "work_assignment_digest_template_version": "v1",
        "work_assignment_digest_last_generated_at": None,
        "work_assignment_digest_last_item_count": None,
        "work_assignment_digest_history": [],
    }
    assert body["members"][0]["roles"] == [
        {
            "entity_id": str(entity.id),
            "entity_name": "SKJ Property Pty Ltd",
            "role": "owner",
        }
    ]


def test_security_workspace_omits_archived_entity_roles(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    settings = get_settings()
    archived_entity = Entity(
        organisation_id=entity.organisation_id,
        name="Archived Property Manager",
        deleted_at=datetime(2026, 6, 30, tzinfo=UTC),
    )
    session.add(archived_entity)
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=archived_entity.id,
            role=UserRole.owner,
        )
    )
    session.commit()

    response = client.get("/api/v1/security/workspace")

    assert response.status_code == 200
    body = response.json()
    assert body["current_user_roles"] == [
        {
            "entity_id": str(entity.id),
            "entity_name": "SKJ Property Pty Ltd",
            "role": "owner",
        }
    ]
    assert body["members"][0]["roles"] == body["current_user_roles"]


def test_first_workspace_bootstrap_creates_workspace_owner(
    empty_clerk_client: TestClient,
    empty_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_tokens: list[str] = []

    def fake_clerk_provider_id(token: str, settings: Settings) -> str:  # noqa: ARG001
        provider_tokens.append(token)
        return "user_clerk_owner"

    monkeypatch.setattr(security_router, "_clerk_provider_id", fake_clerk_provider_id)

    response = empty_clerk_client.post(
        "/api/v1/security/bootstrap",
        headers={"Authorization": "Bearer signed-in-clerk-session"},
        json={
            "organisation_name": "Stewart Capital",
            "entity_name": "Stewart Property Pty Ltd",
            "email": "  Owner@Example.com ",
            "display_name": "Owner Operator",
            "entity_abn": "12345678901",
            "gst_registered": True,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["accepted"] is True
    assert body["organisation"]["name"] == "Stewart Capital"
    assert body["entity"]["name"] == "Stewart Property Pty Ltd"
    assert body["entity"]["abn"] == "12345678901"
    assert body["member"]["email"] == "owner@example.com"
    assert body["member"]["display_name"] == "Owner Operator"
    assert body["member"]["login_linked"] is True
    assert body["member"]["invite_email_status"] == "accepted"
    assert body["member"]["roles"] == [
        {
            "entity_id": body["entity"]["id"],
            "entity_name": "Stewart Property Pty Ltd",
            "role": "owner",
        }
    ]
    assert provider_tokens == ["signed-in-clerk-session"]

    organisation = empty_session.scalar(
        select(Organisation).where(Organisation.name == "Stewart Capital")
    )
    member = empty_session.scalar(select(AppUser).where(AppUser.email == "owner@example.com"))
    entity = empty_session.scalar(select(Entity).where(Entity.name == "Stewart Property Pty Ltd"))
    assert organisation is not None
    assert member is not None
    assert entity is not None
    assert member.organisation_id == organisation.id
    assert entity.organisation_id == organisation.id
    assert member.auth_provider_id == "user_clerk_owner"

    role = empty_session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == member.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    assert role == UserRole.owner
    audit_actions = empty_session.scalars(
        select(AuditAction.action).where(AuditAction.target_table == "organisation")
    ).all()
    assert audit_actions == ["bootstrap"]


def test_bootstrap_status_unavailable_once_workspace_data_exists(
    clerk_client: TestClient,
) -> None:
    response = clerk_client.get("/api/v1/security/bootstrap/status")

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert body["reason"] == (
        "First workspace setup is closed because Relby already has workspace data."
    )
    assert body["auth"]["auth_mode"] == "clerk"
    assert body["auth"]["clerk_jwks_configured"] is True
    assert body["organisation_count"] == 1
    assert body["entity_count"] == 1
    assert body["operator_count"] == 1


def test_owner_can_invite_and_update_operator_roles(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
) -> None:
    entity = _entity(session)
    sent_urls: list[str] = []

    def fake_send(invite, settings):  # noqa: ANN001, ARG001
        sent_urls.append(invite.accept_url)
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            recipient=invite.email,
            provider_message_id="operator-email-1",
        )

    monkeypatch.setattr(security_router, "send_operator_invite_email", fake_send)

    create_response = client.post(
        "/api/v1/security/members",
        json={
            "email": "  Ops.Team@Example.com ",
            "display_name": "Ops Team",
            "roles": [{"entity_id": str(entity.id), "role": "ops"}],
        },
    )

    assert create_response.status_code == 201
    created = create_response.json()
    member_id = created["id"]
    assert created["email"] == "ops.team@example.com"
    assert created["display_name"] == "Ops Team"
    assert created["is_active"] is True
    assert created["access_status"] == "invited"
    assert created["login_linked"] is False
    assert created["invite_email_status"] == "sent"
    assert created["invite_sent_at"] is not None
    assert created["invite_expires_at"] is not None
    assert sent_urls
    assert created["invite_accept_url"] == sent_urls[0]
    assert created["roles"][0]["role"] == "ops"
    member = session.get(AppUser, UUID(member_id))
    assert member is not None
    member.notification_preferences = {
        "work_assignment_email_enabled": True,
        "work_assignment_digest_cadence": "daily",
        "work_assignment_digest_last_generated_at": "2026-05-21T08:00:00+00:00",
        "work_assignment_digest_last_item_count": 3,
        "work_assignment_digest_history": [
            {
                "event": "digest_generated",
                "generated_at": "2026-05-21T08:00:00+00:00",
                "entity_id": str(entity.id),
                "cadence": "daily",
                "item_count": 3,
                "ready_count": 2,
                "attention_count": 1,
                "in_flight_count": 0,
                "done_count": 0,
                "follow_up_due_count": 1,
                "delivery_status": "previewed",
                "message_sent": False,
            }
        ],
    }
    session.commit()

    update_response = client.patch(
        f"/api/v1/security/members/{member_id}",
        json={
            "display_name": "Operations Team",
            "is_active": False,
            "roles": [{"entity_id": str(entity.id), "role": "viewer"}],
            "notification_preferences": {
                "work_assignment_email_enabled": False,
                "work_assignment_sms_enabled": True,
                "work_assignment_sms_phone": "+61400111222",
                "work_assignment_digest_cadence": "weekly",
            },
        },
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["display_name"] == "Operations Team"
    assert updated["is_active"] is False
    assert updated["access_status"] == "disabled"
    assert updated["roles"][0]["role"] == "viewer"
    assert updated["notification_preferences"]["work_assignment_email_enabled"] is False
    assert updated["notification_preferences"]["work_assignment_sms_enabled"] is True
    assert updated["notification_preferences"]["work_assignment_sms_phone"] == "+61400111222"
    assert updated["notification_preferences"]["work_assignment_digest_cadence"] == "weekly"
    assert (
        updated["notification_preferences"]["work_assignment_notice_template_key"]
        == "work_assignment_notification"
    )
    assert (
        updated["notification_preferences"]["work_assignment_digest_template_key"]
        == "work_assignment_digest"
    )
    assert updated["notification_preferences"]["work_assignment_digest_last_item_count"] == 3
    assert (
        updated["notification_preferences"]["work_assignment_digest_history"][0]["delivery_status"]
        == "previewed"
    )

    member = session.get(AppUser, UUID(member_id))
    assert member is not None
    assert member.email == "ops.team@example.com"
    assert member.notification_preferences["work_assignment_email_enabled"] is False
    assert member.notification_preferences["work_assignment_sms_enabled"] is True
    assert member.notification_preferences["work_assignment_sms_phone"] == "+61400111222"
    assert member.notification_preferences["work_assignment_digest_cadence"] == "weekly"
    assert (
        member.notification_preferences["work_assignment_notice_template_key"]
        == "work_assignment_notification"
    )
    assert (
        member.notification_preferences["work_assignment_digest_template_key"]
        == "work_assignment_digest"
    )
    assert member.notification_preferences["work_assignment_digest_last_item_count"] == 3
    assert member.notification_preferences["work_assignment_digest_history"][0]["item_count"] == 3
    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == member.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    assert role == UserRole.viewer
    audit_actions = session.scalars(
        select(AuditAction.action).where(AuditAction.target_table == "app_user")
    ).all()
    assert audit_actions == ["invite", "update"]


def test_operator_invite_sendgrid_receipt_updates_member_status(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
) -> None:
    entity = _entity(session)

    def fake_send(invite, settings):  # noqa: ANN001, ARG001
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            recipient=invite.email,
            provider_message_id="operator-message-1",
        )

    monkeypatch.setattr(security_router, "send_operator_invite_email", fake_send)
    create_response = client.post(
        "/api/v1/security/members",
        json={
            "email": "ops.delivery@example.com",
            "display_name": "Ops Delivery",
            "roles": [{"entity_id": str(entity.id), "role": "admin"}],
        },
    )
    assert create_response.status_code == 201
    member_id = create_response.json()["id"]

    delivered_response = client.post(
        "/api/v1/security/webhooks/sendgrid-events",
        json=[
            {
                "operator_user_id": member_id,
                "sg_message_id": "operator-message-1.filterdrecv-123",
                "event": "delivered",
                "email": "ops.delivery@example.com",
            }
        ],
    )

    assert delivered_response.status_code == 204
    member = session.get(AppUser, UUID(member_id))
    assert member is not None
    assert member.invite_status == "sent"
    assert member.invite_last_error == "Operator invite delivered by SendGrid."

    workspace_response = client.get("/api/v1/security/workspace")
    assert workspace_response.status_code == 200
    workspace_member = next(
        item for item in workspace_response.json()["members"] if item["id"] == member_id
    )
    assert workspace_member["invite_email_detail"] == "Operator invite delivered by SendGrid."
    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "app_user",
            AuditAction.target_id == UUID(member_id),
            AuditAction.tool_name == "sendgrid.operator_invite_event_webhook",
        )
    )
    assert audit is not None
    assert audit.tool_output_summary == "Operator invite delivered by SendGrid."


def test_operator_invite_sendgrid_receipt_requires_configured_secret(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = security_router.get_settings()
    monkeypatch.setattr(
        security_router,
        "get_settings",
        lambda: settings.model_copy(update={"communications_webhook_secret": "sg-secret"}),
    )

    missing_response = client.post(
        "/api/v1/security/webhooks/sendgrid-events",
        json=[],
    )
    assert missing_response.status_code == 401
    assert missing_response.json()["detail"] == "Invalid webhook token."

    accepted_response = client.post(
        "/api/v1/security/webhooks/sendgrid-events",
        headers={"x-relby-webhook-secret": "sg-secret"},
        json=[],
    )
    assert accepted_response.status_code == 204


def test_operator_invite_sendgrid_bounce_matches_message_id_prefix(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
) -> None:
    entity = _entity(session)

    def fake_send(invite, settings):  # noqa: ANN001, ARG001
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            recipient=invite.email,
            provider_message_id="operator-message-2",
        )

    monkeypatch.setattr(security_router, "send_operator_invite_email", fake_send)
    create_response = client.post(
        "/api/v1/security/members",
        json={
            "email": "ops.bounce@example.com",
            "display_name": "Ops Bounce",
            "roles": [{"entity_id": str(entity.id), "role": "admin"}],
        },
    )
    assert create_response.status_code == 201
    member_id = create_response.json()["id"]

    bounce_response = client.post(
        "/api/v1/security/webhooks/sendgrid-events",
        json={
            "sg_message_id": "operator-message-2.filterdrecv-456",
            "event": "bounce",
            "email": "ops.bounce@example.com",
            "reason": "mailbox unavailable",
        },
    )

    assert bounce_response.status_code == 204
    member = session.get(AppUser, UUID(member_id))
    assert member is not None
    assert member.invite_status == "failed"
    assert member.invite_last_error == "SendGrid reported mailbox unavailable."


def test_operator_invite_accept_links_clerk_identity(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
) -> None:
    entity = _entity(session)
    sent_urls: list[str] = []

    def fake_send(invite, settings):  # noqa: ANN001, ARG001
        sent_urls.append(invite.accept_url)
        return DeliveryResult(channel="email", status="queued", provider="sendgrid")

    monkeypatch.setattr(security_router, "send_operator_invite_email", fake_send)

    create_response = client.post(
        "/api/v1/security/members",
        json={
            "email": "invitee@example.com",
            "display_name": "Invitee User",
            "roles": [{"entity_id": str(entity.id), "role": "admin"}],
        },
    )
    assert create_response.status_code == 201
    token = parse_qs(urlparse(sent_urls[0]).query)["token"][0]

    accept_response = client.post(
        "/api/v1/security/invitations/accept",
        json={
            "token": token,
            "auth_provider_id": "user_clerk_invitee",
            "email": "invitee@example.com",
            "display_name": "Invitee User",
        },
    )

    assert accept_response.status_code == 200
    body = accept_response.json()
    assert body["accepted"] is True
    assert body["member"]["login_linked"] is True
    assert body["member"]["invite_email_status"] == "accepted"
    member = session.scalar(select(AppUser).where(AppUser.email == "invitee@example.com"))
    assert member is not None
    assert member.auth_provider_id == "user_clerk_invitee"
    assert member.invite_token_hash is None


def test_owner_can_unlink_operator_login(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
) -> None:
    entity = _entity(session)
    sent_urls: list[str] = []

    def fake_send(invite, settings):  # noqa: ANN001, ARG001
        sent_urls.append(invite.accept_url)
        return DeliveryResult(channel="email", status="queued", provider="sendgrid")

    monkeypatch.setattr(security_router, "send_operator_invite_email", fake_send)

    create_response = client.post(
        "/api/v1/security/members",
        json={
            "email": "unlink@example.com",
            "display_name": "Unlink User",
            "roles": [{"entity_id": str(entity.id), "role": "admin"}],
        },
    )
    assert create_response.status_code == 201
    token = parse_qs(urlparse(sent_urls[0]).query)["token"][0]
    accept_response = client.post(
        "/api/v1/security/invitations/accept",
        json={
            "token": token,
            "auth_provider_id": "user_clerk_unlink",
            "email": "unlink@example.com",
            "display_name": "Unlink User",
        },
    )
    assert accept_response.status_code == 200
    member_id = accept_response.json()["member"]["id"]
    assert accept_response.json()["member"]["access_status"] == "login_linked"

    unlink_response = client.post(f"/api/v1/security/members/{member_id}/unlink-login")

    assert unlink_response.status_code == 200
    body = unlink_response.json()
    assert body["access_status"] == "not_linked"
    assert body["login_linked"] is False
    assert body["invite_email_status"] == "not_sent"
    member = session.get(AppUser, UUID(member_id))
    assert member is not None
    assert member.auth_provider_id is None
    assert member.invite_token_hash is None
    assert member.invite_accepted_at is None
    audit_actions = session.scalars(
        select(AuditAction.action)
        .where(AuditAction.target_table == "app_user")
        .order_by(AuditAction.occurred_at)
    ).all()
    assert audit_actions[-1] == "unlink"


def test_security_mutations_require_owner_or_admin(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    settings = get_settings()
    role = session.get(UserEntityRole, (settings.dev_user_id, entity.id))
    assert role is not None
    role.role = UserRole.viewer
    session.commit()

    response = client.post(
        "/api/v1/security/members",
        json={
            "email": "blocked@example.com",
            "display_name": "Blocked User",
            "roles": [{"entity_id": str(entity.id), "role": "viewer"}],
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Only owners and admins can manage operator access."


def test_current_operator_cannot_remove_own_last_admin_role(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    settings = get_settings()

    response = client.patch(
        f"/api/v1/security/members/{settings.dev_user_id}",
        json={"roles": [{"entity_id": str(entity.id), "role": "viewer"}]},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Keep at least one owner or admin role on your own account."
    )


def test_client_operating_mode_route_removed(
    client: TestClient,
) -> None:
    # Operating mode is set by Relby platform admins per client org
    # (clients don't decide what they are). The old client-side route
    # must stay gone; the replacement lives under /platform.
    response = client.patch(
        "/api/v1/security/organisation/operating-mode",
        json={"operating_mode": "managing_agent"},
    )

    assert response.status_code == 404
