"""Operator security and access-management routes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import AppUser, Entity, Organisation, UserEntityRole, UserRole
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, get_current_user, get_session
from apps.api.schemas.security import (
    SecurityAuthStatusRead,
    SecurityCurrentUserRead,
    SecurityEntityRoleRead,
    SecurityMemberCreate,
    SecurityMemberRead,
    SecurityMemberUpdate,
    SecurityMeRead,
    SecurityOrganisationRead,
    SecurityRoleAssignment,
    SecurityWorkspaceRead,
)

router = APIRouter(prefix="/security", tags=["security"])
me_router = APIRouter(tags=["security"])

MANAGE_SECURITY_ROLES = {UserRole.owner, UserRole.admin}


def _normalise_email(email: str) -> str:
    return email.strip().lower()


def _role_rows(
    session: Session,
    organisation_id: UUID,
) -> dict[UUID, list[SecurityEntityRoleRead]]:
    rows = session.execute(
        select(UserEntityRole.user_id, UserEntityRole.entity_id, Entity.name, UserEntityRole.role)
        .join(Entity, Entity.id == UserEntityRole.entity_id)
        .where(Entity.organisation_id == organisation_id)
        .order_by(Entity.name)
    ).all()
    grouped: dict[UUID, list[SecurityEntityRoleRead]] = {}
    for user_id, entity_id, entity_name, role in rows:
        grouped.setdefault(user_id, []).append(
            SecurityEntityRoleRead(entity_id=entity_id, entity_name=entity_name, role=role)
        )
    return grouped


def _can_manage_security(session: Session, user: CurrentUser) -> bool:
    role = session.scalar(
        select(UserEntityRole.role)
        .join(Entity, Entity.id == UserEntityRole.entity_id)
        .where(
            UserEntityRole.user_id == user.id,
            Entity.organisation_id == user.organisation_id,
            Entity.deleted_at.is_(None),
            UserEntityRole.role.in_(MANAGE_SECURITY_ROLES),
        )
        .limit(1)
    )
    return role in MANAGE_SECURITY_ROLES


def _assert_can_manage_security(session: Session, user: CurrentUser) -> None:
    if not _can_manage_security(session, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners and admins can manage operator access.",
        )


def _auth_status(settings: Settings) -> SecurityAuthStatusRead:
    clerk_secret_configured = bool(settings.clerk_secret_key.strip())
    clerk_jwks_configured = bool(settings.clerk_jwks_url.strip())
    operator_login_enforced = settings.auth_mode == "clerk"
    next_steps: list[str] = []
    if settings.auth_mode == "dev":
        next_steps.append("Switch AUTH_MODE to clerk before sending real operator invites.")
    if not clerk_secret_configured:
        next_steps.append("Set CLERK_SECRET_KEY before enabling provider-backed login.")
    if not clerk_jwks_configured:
        next_steps.append("Set CLERK_JWKS_URL before verifying Clerk sessions.")
    return SecurityAuthStatusRead(
        auth_mode=settings.auth_mode,
        dev_auth_active=settings.auth_mode == "dev",
        clerk_secret_configured=clerk_secret_configured,
        clerk_jwks_configured=clerk_jwks_configured,
        operator_login_enforced=operator_login_enforced,
        login_boundary=(
            "Clerk bearer-token adapter"
            if settings.auth_mode == "clerk"
            else "Development operator identity"
        ),
        next_steps=next_steps,
    )


def _member_read(
    member: AppUser,
    roles_by_user: dict[UUID, list[SecurityEntityRoleRead]],
) -> SecurityMemberRead:
    login_linked = bool(member.auth_provider_id)
    return SecurityMemberRead(
        id=member.id,
        email=member.email,
        display_name=member.display_name,
        is_active=member.is_active,
        login_linked=login_linked,
        invite_email_status="linked" if login_linked else "not_sent",
        invite_email_detail=(
            "Provider login is linked for this operator."
            if login_linked
            else "No operator invite email has been sent yet; access is recorded only."
        ),
        created_at=member.created_at,
        roles=roles_by_user.get(member.id, []),
    )


def _validate_role_assignments(
    session: Session,
    user: CurrentUser,
    assignments: list[SecurityRoleAssignment],
) -> list[SecurityRoleAssignment]:
    seen: set[UUID] = set()
    for assignment in assignments:
        if assignment.entity_id in seen:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each entity can only be assigned once.",
            )
        seen.add(assignment.entity_id)
    if not assignments:
        return assignments
    entities = session.scalars(
        select(Entity).where(
            Entity.id.in_([assignment.entity_id for assignment in assignments]),
            Entity.organisation_id == user.organisation_id,
            Entity.deleted_at.is_(None),
        )
    ).all()
    found_ids = {entity.id for entity in entities}
    missing_ids = [
        assignment.entity_id
        for assignment in assignments
        if assignment.entity_id not in found_ids
    ]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more role assignments reference an unavailable entity.",
        )
    return assignments


def _replace_roles(
    session: Session,
    organisation_id: UUID,
    member_id: UUID,
    assignments: list[SecurityRoleAssignment],
) -> None:
    entity_ids = session.scalars(
        select(Entity.id).where(Entity.organisation_id == organisation_id)
    ).all()
    if entity_ids:
        session.execute(
            delete(UserEntityRole).where(
                UserEntityRole.user_id == member_id,
                UserEntityRole.entity_id.in_(entity_ids),
            )
        )
    for assignment in assignments:
        session.add(
            UserEntityRole(
                user_id=member_id,
                entity_id=assignment.entity_id,
                role=assignment.role,
            )
        )


@router.get("/workspace", response_model=SecurityWorkspaceRead)
def get_security_workspace(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SecurityWorkspaceRead:
    organisation = session.get(Organisation, user.organisation_id)
    if organisation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organisation not found.",
        )
    members = list(
        session.scalars(
            select(AppUser)
            .where(AppUser.organisation_id == user.organisation_id)
            .order_by(AppUser.display_name, AppUser.email)
        )
    )
    roles_by_user = _role_rows(session, user.organisation_id)
    return SecurityWorkspaceRead(
        auth=_auth_status(settings),
        current_user=SecurityCurrentUserRead(
            id=user.id,
            organisation_id=user.organisation_id,
            email=user.email,
            display_name=user.display_name,
        ),
        organisation=SecurityOrganisationRead.model_validate(organisation),
        members=[_member_read(member, roles_by_user) for member in members],
        current_user_roles=roles_by_user.get(user.id, []),
        can_manage_security=_can_manage_security(session, user),
    )


@me_router.get("/me", response_model=SecurityMeRead)
def get_current_operator_profile(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SecurityMeRead:
    organisation = session.get(Organisation, user.organisation_id)
    if organisation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organisation not found.",
        )
    roles_by_user = _role_rows(session, user.organisation_id)
    return SecurityMeRead(
        auth=_auth_status(settings),
        current_user=SecurityCurrentUserRead(
            id=user.id,
            organisation_id=user.organisation_id,
            email=user.email,
            display_name=user.display_name,
        ),
        organisation=SecurityOrganisationRead.model_validate(organisation),
        roles=roles_by_user.get(user.id, []),
        can_manage_security=_can_manage_security(session, user),
    )


@router.post(
    "/members",
    response_model=SecurityMemberRead,
    status_code=status.HTTP_201_CREATED,
)
def create_security_member(
    payload: SecurityMemberCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> SecurityMemberRead:
    _assert_can_manage_security(session, user)
    assignments = _validate_role_assignments(session, user, payload.roles)
    email = _normalise_email(payload.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid email.")
    member = session.scalar(select(AppUser).where(AppUser.email == email))
    if member is not None and member.organisation_id != user.organisation_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email belongs to another organisation.",
        )
    if member is None:
        member = AppUser(
            organisation_id=user.organisation_id,
            email=email,
            display_name=payload.display_name.strip() or email,
            is_active=payload.is_active,
        )
        session.add(member)
        session.flush()
    else:
        member.display_name = payload.display_name.strip() or member.display_name
        member.is_active = payload.is_active
    _replace_roles(session, user.organisation_id, member.id, assignments)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        target_table="app_user",
        target_id=member.id,
        action="invite",
        tool_name="security.member_invite",
        tool_input={
            "email": email,
            "roles": [
                {"entity_id": str(assignment.entity_id), "role": assignment.role.value}
                for assignment in assignments
            ],
        },
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, user.organisation_id)
    return _member_read(member, roles_by_user)


@router.patch("/members/{member_id}", response_model=SecurityMemberRead)
def update_security_member(
    member_id: UUID,
    payload: SecurityMemberUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> SecurityMemberRead:
    _assert_can_manage_security(session, user)
    member = session.get(AppUser, member_id)
    if member is None or member.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")
    if member.id == user.id and payload.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own operator account.",
        )
    if payload.display_name is not None:
        member.display_name = payload.display_name.strip() or member.display_name
    if payload.is_active is not None:
        member.is_active = payload.is_active
    if payload.roles is not None:
        assignments = _validate_role_assignments(session, user, payload.roles)
        if member.id == user.id and not any(
            assignment.role in MANAGE_SECURITY_ROLES for assignment in assignments
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Keep at least one owner or admin role on your own account.",
            )
        _replace_roles(session, user.organisation_id, member.id, assignments)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        target_table="app_user",
        target_id=member.id,
        action="update",
        tool_name="security.member_update",
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, user.organisation_id)
    return _member_read(member, roles_by_user)
