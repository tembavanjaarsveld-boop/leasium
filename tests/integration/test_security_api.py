"""Security and operator access API integration tests."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AppUser, AuditAction, Entity, UserEntityRole, UserRole
from stewart.core.settings import get_settings


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

    response = client.get("/api/v1/security/workspace")

    assert response.status_code == 200
    body = response.json()
    assert body["auth"]["auth_mode"] == "dev"
    assert body["auth"]["dev_auth_active"] is True
    assert body["auth"]["operator_login_enforced"] is False
    assert body["organisation"]["name"] == "SKJ Capital"
    assert body["current_user"]["email"] == get_settings().dev_user_email
    assert body["can_manage_security"] is True
    assert body["members"][0]["roles"] == [
        {
            "entity_id": str(entity.id),
            "entity_name": "SKJ Property Pty Ltd",
            "role": "owner",
        }
    ]


def test_owner_can_invite_and_update_operator_roles(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)

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
    assert created["login_linked"] is False
    assert created["invite_email_status"] == "not_sent"
    assert created["invite_email_detail"] == (
        "No operator invite email has been sent yet; access is recorded only."
    )
    assert created["roles"][0]["role"] == "ops"

    update_response = client.patch(
        f"/api/v1/security/members/{member_id}",
        json={
            "display_name": "Operations Team",
            "is_active": False,
            "roles": [{"entity_id": str(entity.id), "role": "viewer"}],
        },
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["display_name"] == "Operations Team"
    assert updated["is_active"] is False
    assert updated["roles"][0]["role"] == "viewer"

    member = session.get(AppUser, UUID(member_id))
    assert member is not None
    assert member.email == "ops.team@example.com"
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
