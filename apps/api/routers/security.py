"""Operator security and access-management routes."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.auth import _clerk_provider_id
from stewart.core.db import utcnow
from stewart.core.models import (
    AppUser,
    Entity,
    OperatorInviteStatus,
    Organisation,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.communications import (
    DeliveryResult,
    OperatorInviteEmail,
    send_operator_invite_email,
)

from apps.api import webhook_auth
from apps.api.deps import CurrentUser, get_current_user, get_session
from apps.api.schemas.security import (
    SecurityAuthStatusRead,
    SecurityBootstrapCreate,
    SecurityBootstrapEntityRead,
    SecurityBootstrapRead,
    SecurityBootstrapStatusRead,
    SecurityCurrentUserRead,
    SecurityEntityRoleRead,
    SecurityInviteAccept,
    SecurityInviteAcceptRead,
    SecurityMemberCreate,
    SecurityMemberInviteRead,
    SecurityMemberRead,
    SecurityMemberUpdate,
    SecurityMeRead,
    SecurityNotificationPreferences,
    SecurityOrganisationRead,
    SecurityRoleAssignment,
    SecurityWorkAssignmentDigestReceipt,
    SecurityWorkspaceRead,
)

router = APIRouter(prefix="/security", tags=["security"])
me_router = APIRouter(tags=["security"])

MANAGE_SECURITY_ROLES = {UserRole.owner, UserRole.admin}


def _normalise_email(email: str) -> str:
    return email.strip().lower()


def _invite_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _invite_accept_url(token: str, settings: Settings) -> str:
    return f"{settings.frontend_url.rstrip('/')}/accept-invite?token={token}"


def _assert_webhook_secret(request: Request) -> None:
    secret = get_settings().communications_webhook_secret
    if not secret:
        return
    webhook_auth.assert_webhook_secret(request, secret)


def _operator_invite_receipt_detail(raw_status: str, event: dict[str, object]) -> str:
    value = raw_status.strip().lower()
    if value == "processed":
        return "SendGrid processed the operator invite."
    if value == "delivered":
        return "Operator invite delivered by SendGrid."
    if value == "open":
        return "Operator invite opened by the recipient."
    if value == "click":
        return "Operator invite link clicked by the recipient."
    if value == "deferred":
        return "SendGrid is still trying to deliver the operator invite."
    if value in {"bounce", "dropped", "spamreport", "unsubscribe", "group_unsubscribe"}:
        reason = event.get("reason") or event.get("response") or event.get("type") or value
        return f"SendGrid reported {reason}."
    return f"SendGrid reported {raw_status}."


def _operator_invite_receipt_status(raw_status: str) -> OperatorInviteStatus:
    value = raw_status.strip().lower()
    if value in {"bounce", "dropped", "spamreport", "unsubscribe", "group_unsubscribe"}:
        return OperatorInviteStatus.failed
    return OperatorInviteStatus.sent


def _sendgrid_message_matches(stored: str | None, incoming: str | None) -> bool:
    if not stored or not incoming:
        return False
    return incoming == stored or incoming.startswith(f"{stored}.")


def _operator_from_sendgrid_event(
    session: Session,
    event: dict[str, object],
) -> AppUser | None:
    raw_user_id = event.get("operator_user_id")
    if isinstance(raw_user_id, str):
        try:
            member = session.get(AppUser, UUID(raw_user_id))
        except ValueError:
            member = None
        if member is not None:
            return member

    message_id = event.get("sg_message_id") or event.get("sg-message-id")
    if isinstance(message_id, str):
        members = session.scalars(
            select(AppUser).where(AppUser.invite_provider_message_id.is_not(None))
        ).all()
        for member in members:
            if _sendgrid_message_matches(member.invite_provider_message_id, message_id):
                return member

    email = event.get("email")
    if isinstance(email, str):
        return session.scalar(select(AppUser).where(AppUser.email == _normalise_email(email)))
    return None


def _apply_operator_invite_receipt(
    member: AppUser,
    raw_status: str,
    provider_message_id: str | None,
    event: dict[str, object],
) -> None:
    if provider_message_id and not member.invite_provider_message_id:
        member.invite_provider_message_id = provider_message_id.split(".", 1)[0]
    if member.auth_provider_id or member.invite_status == OperatorInviteStatus.accepted:
        return
    member.invite_last_error = _operator_invite_receipt_detail(raw_status, event)
    member.invite_status = _operator_invite_receipt_status(raw_status)


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
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        next_steps.append("Set SendGrid credentials before operator invite emails can send.")
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


def _bootstrap_counts(session: Session) -> tuple[int, int, int]:
    organisation_count = session.scalar(select(func.count(Organisation.id))) or 0
    entity_count = session.scalar(select(func.count(Entity.id))) or 0
    operator_count = session.scalar(select(func.count(AppUser.id))) or 0
    return organisation_count, entity_count, operator_count


def _bootstrap_status(session: Session, settings: Settings) -> SecurityBootstrapStatusRead:
    organisation_count, entity_count, operator_count = _bootstrap_counts(session)
    empty_workspace = organisation_count == 0 and entity_count == 0 and operator_count == 0
    if empty_workspace and settings.auth_mode == "clerk" and settings.clerk_jwks_url.strip():
        available = True
        reason = "First workspace setup is available for a signed-in Clerk operator."
    elif empty_workspace and settings.auth_mode == "clerk":
        available = False
        reason = "Set CLERK_JWKS_URL before first workspace setup can verify Clerk sessions."
    elif empty_workspace:
        available = False
        reason = "Switch AUTH_MODE to clerk before first workspace setup."
    else:
        available = False
        reason = "First workspace setup is closed because Relby already has workspace data."
    return SecurityBootstrapStatusRead(
        available=available,
        reason=reason,
        auth=_auth_status(settings),
        organisation_count=organisation_count,
        entity_count=entity_count,
        operator_count=operator_count,
    )


def _bootstrap_clerk_provider_id(authorization: str | None, settings: Settings) -> str:
    if settings.auth_mode != "clerk":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Switch AUTH_MODE to clerk before first workspace setup.",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in with Clerk before first workspace setup.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    return _clerk_provider_id(token, settings)


def _invite_detail(member: AppUser) -> str:
    if not member.is_active:
        return "This operator is disabled and cannot access Relby."
    if member.auth_provider_id or member.invite_status == OperatorInviteStatus.accepted:
        return "Provider login is linked for this operator."
    if member.invite_status == OperatorInviteStatus.sent:
        return member.invite_last_error or "Operator invite email has been queued for delivery."
    if member.invite_status == OperatorInviteStatus.failed:
        return member.invite_last_error or "Operator invite email failed to send."
    if member.invite_status == OperatorInviteStatus.skipped:
        return member.invite_last_error or "Operator invite email was skipped."
    if member.invite_status == OperatorInviteStatus.expired:
        return "The last operator invite has expired; send a new invite."
    if member.invite_status == OperatorInviteStatus.revoked:
        return "The last operator invite was revoked."
    return "No operator invite email has been sent yet; access is recorded only."


def _member_access_status(
    member: AppUser,
) -> Literal["disabled", "login_linked", "invited", "not_linked"]:
    if not member.is_active:
        return "disabled"
    if member.auth_provider_id or member.invite_status == OperatorInviteStatus.accepted:
        return "login_linked"
    if member.invite_status == OperatorInviteStatus.sent:
        return "invited"
    return "not_linked"


def _notification_preferences(member: AppUser) -> SecurityNotificationPreferences:
    raw = (
        member.notification_preferences if isinstance(member.notification_preferences, dict) else {}
    )
    enabled = raw.get("work_assignment_email_enabled")
    sms_enabled = raw.get("work_assignment_sms_enabled")
    sms_phone = raw.get("work_assignment_sms_phone")
    digest_cadence = raw.get("work_assignment_digest_cadence")
    if digest_cadence not in {"off", "daily", "weekly"}:
        digest_cadence = "daily"
    notice_template_key = raw.get("work_assignment_notice_template_key")
    notice_template_version = raw.get("work_assignment_notice_template_version")
    digest_template_key = raw.get("work_assignment_digest_template_key")
    digest_template_version = raw.get("work_assignment_digest_template_version")
    raw_history = raw.get("work_assignment_digest_history")
    history: list[SecurityWorkAssignmentDigestReceipt] = []
    if isinstance(raw_history, list):
        for receipt in raw_history:
            if not isinstance(receipt, dict):
                continue
            try:
                history.append(SecurityWorkAssignmentDigestReceipt.model_validate(receipt))
            except ValueError:
                continue
    raw_last_generated_at = raw.get("work_assignment_digest_last_generated_at")
    last_generated_at = (
        raw_last_generated_at if isinstance(raw_last_generated_at, (datetime, str)) else None
    )
    last_item_count = raw.get("work_assignment_digest_last_item_count")
    return SecurityNotificationPreferences(
        work_assignment_email_enabled=enabled if isinstance(enabled, bool) else True,
        work_assignment_sms_enabled=sms_enabled if isinstance(sms_enabled, bool) else False,
        work_assignment_sms_phone=sms_phone.strip()
        if isinstance(sms_phone, str) and sms_phone.strip()
        else None,
        work_assignment_notice_template_key=notice_template_key
        if isinstance(notice_template_key, str) and notice_template_key.strip()
        else "work_assignment_notification",
        work_assignment_notice_template_version=notice_template_version
        if isinstance(notice_template_version, str) and notice_template_version.strip()
        else "v1",
        work_assignment_digest_cadence=digest_cadence,
        work_assignment_digest_template_key=digest_template_key
        if isinstance(digest_template_key, str) and digest_template_key.strip()
        else "work_assignment_digest",
        work_assignment_digest_template_version=digest_template_version
        if isinstance(digest_template_version, str) and digest_template_version.strip()
        else "v1",
        work_assignment_digest_last_generated_at=last_generated_at,
        work_assignment_digest_last_item_count=last_item_count
        if isinstance(last_item_count, int) and not isinstance(last_item_count, bool)
        else None,
        work_assignment_digest_history=history,
    )


def _notification_preferences_for_write(
    current: object,
    payload: SecurityNotificationPreferences,
) -> dict[str, object]:
    preferences = dict(current) if isinstance(current, dict) else {}
    preferences["work_assignment_email_enabled"] = payload.work_assignment_email_enabled
    preferences["work_assignment_sms_enabled"] = payload.work_assignment_sms_enabled
    preferences["work_assignment_sms_phone"] = (
        payload.work_assignment_sms_phone.strip()
        if payload.work_assignment_sms_phone and payload.work_assignment_sms_phone.strip()
        else None
    )
    preferences["work_assignment_notice_template_key"] = (
        payload.work_assignment_notice_template_key.strip() or "work_assignment_notification"
    )
    preferences["work_assignment_notice_template_version"] = (
        payload.work_assignment_notice_template_version.strip() or "v1"
    )
    preferences["work_assignment_digest_cadence"] = payload.work_assignment_digest_cadence
    preferences["work_assignment_digest_template_key"] = (
        payload.work_assignment_digest_template_key.strip() or "work_assignment_digest"
    )
    preferences["work_assignment_digest_template_version"] = (
        payload.work_assignment_digest_template_version.strip() or "v1"
    )
    return preferences


def _member_read(
    member: AppUser,
    roles_by_user: dict[UUID, list[SecurityEntityRoleRead]],
    invite_accept_url: str | None = None,
) -> SecurityMemberRead:
    login_linked = bool(member.auth_provider_id)
    return SecurityMemberRead(
        id=member.id,
        email=member.email,
        display_name=member.display_name,
        is_active=member.is_active,
        access_status=_member_access_status(member),
        login_linked=login_linked,
        invite_email_status=OperatorInviteStatus.accepted if login_linked else member.invite_status,
        invite_email_detail=_invite_detail(member),
        invite_sent_at=member.invite_sent_at,
        invite_expires_at=member.invite_expires_at,
        invite_accepted_at=member.invite_accepted_at,
        invite_accept_url=invite_accept_url,
        notification_preferences=_notification_preferences(member),
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
        assignment.entity_id for assignment in assignments if assignment.entity_id not in found_ids
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


def _send_operator_invite(
    member: AppUser,
    inviter: CurrentUser,
    organisation: Organisation,
    settings: Settings,
) -> tuple[DeliveryResult, str]:
    now = utcnow()
    raw_token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(hours=settings.operator_invite_ttl_hours)
    accept_url = _invite_accept_url(raw_token, settings)
    member.invite_token_hash = _invite_token_hash(raw_token)
    member.invite_expires_at = expires_at
    member.invited_by_user_id = inviter.id
    member.invite_accepted_at = None
    member.invite_last_error = None
    member.invite_provider_message_id = None
    result = send_operator_invite_email(
        OperatorInviteEmail(
            user_id=member.id,
            organisation_name=organisation.name,
            invited_by_name=inviter.display_name,
            display_name=member.display_name,
            email=member.email,
            accept_url=accept_url,
            expires_at=expires_at,
            template_key=settings.operator_invite_template_key,
            template_version=settings.operator_invite_template_version,
        ),
        settings,
    )
    member.invite_sent_at = now if result.status in {"queued", "sent"} else None
    member.invite_provider_message_id = result.provider_message_id
    member.invite_last_error = result.error
    if result.status in {"queued", "sent", "delivered", "opened"}:
        member.invite_status = OperatorInviteStatus.sent
    elif result.status == "failed":
        member.invite_status = OperatorInviteStatus.failed
    else:
        member.invite_status = OperatorInviteStatus.skipped
    return result, accept_url


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


@router.get("/bootstrap/status", response_model=SecurityBootstrapStatusRead)
def get_security_bootstrap_status(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SecurityBootstrapStatusRead:
    return _bootstrap_status(session, settings)


@router.post(
    "/bootstrap",
    response_model=SecurityBootstrapRead,
    status_code=status.HTTP_201_CREATED,
)
def create_first_workspace(
    payload: SecurityBootstrapCreate,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> SecurityBootstrapRead:
    bootstrap_status = _bootstrap_status(session, settings)
    if not bootstrap_status.available:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=bootstrap_status.reason)

    provider_id = _bootstrap_clerk_provider_id(authorization, settings)
    email = _normalise_email(payload.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid email.")
    organisation_name = payload.organisation_name.strip()
    entity_name = payload.entity_name.strip()
    timezone = payload.timezone.strip()
    country_code = payload.country_code.strip().upper()
    entity_abn = payload.entity_abn.strip() if payload.entity_abn else None
    if not organisation_name or not entity_name or not timezone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organisation, entity, and timezone are required.",
        )

    now = utcnow()
    organisation = Organisation(
        name=organisation_name,
        country_code=country_code,
        timezone=timezone,
    )
    session.add(organisation)
    session.flush()

    member = AppUser(
        organisation_id=organisation.id,
        email=email,
        display_name=(payload.display_name or "").strip() or email,
        auth_provider_id=provider_id,
        is_active=True,
        invite_status=OperatorInviteStatus.accepted,
        invite_accepted_at=now,
        notification_preferences=SecurityNotificationPreferences().model_dump(),
    )
    entity = Entity(
        organisation_id=organisation.id,
        name=entity_name,
        abn=entity_abn or None,
        gst_registered=payload.gst_registered,
        notes="Created during first workspace setup.",
    )
    session.add_all([member, entity])
    session.flush()
    session.add(UserEntityRole(user_id=member.id, entity_id=entity.id, role=UserRole.owner))
    audit_log(
        session,
        actor=f"user:{email}",
        user_id=member.id,
        entity_id=entity.id,
        target_table="organisation",
        target_id=organisation.id,
        action="bootstrap",
        tool_name="security.first_workspace_setup",
        tool_input={
            "organisation_name": organisation.name,
            "entity_name": entity.name,
            "email": email,
        },
    )
    session.commit()
    session.refresh(organisation)
    session.refresh(entity)
    session.refresh(member)
    roles_by_user = _role_rows(session, organisation.id)
    return SecurityBootstrapRead(
        accepted=True,
        organisation=SecurityOrganisationRead.model_validate(organisation),
        entity=SecurityBootstrapEntityRead(
            id=entity.id,
            organisation_id=entity.organisation_id,
            name=entity.name,
            abn=entity.abn,
            gst_registered=entity.gst_registered,
        ),
        member=_member_read(member, roles_by_user),
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
            is_platform_admin=user.is_platform_admin,
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
            is_platform_admin=user.is_platform_admin,
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
    settings: Annotated[Settings, Depends(get_settings)],
) -> SecurityMemberRead:
    _assert_can_manage_security(session, user)
    assignments = _validate_role_assignments(session, user, payload.roles)
    organisation = session.get(Organisation, user.organisation_id)
    if organisation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found.")
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
            notification_preferences=_notification_preferences_for_write(
                None,
                payload.notification_preferences,
            ),
        )
        session.add(member)
        session.flush()
    else:
        member.display_name = payload.display_name.strip() or member.display_name
        member.is_active = payload.is_active
        member.notification_preferences = _notification_preferences_for_write(
            member.notification_preferences,
            payload.notification_preferences,
        )
    _replace_roles(session, user.organisation_id, member.id, assignments)
    result, accept_url = _send_operator_invite(member, user, organisation, settings)
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
            "delivery_status": result.status,
            "delivery_error": result.error,
        },
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, user.organisation_id)
    return _member_read(member, roles_by_user, invite_accept_url=accept_url)


@router.post("/members/{member_id}/invite", response_model=SecurityMemberInviteRead)
def resend_security_member_invite(
    member_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SecurityMemberInviteRead:
    _assert_can_manage_security(session, user)
    organisation = session.get(Organisation, user.organisation_id)
    member = session.get(AppUser, member_id)
    if organisation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found.")
    if member is None or member.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")
    if member.auth_provider_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This operator already has a linked provider login.",
        )
    result, accept_url = _send_operator_invite(member, user, organisation, settings)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        target_table="app_user",
        target_id=member.id,
        action="invite",
        tool_name="security.member_invite_resend",
        tool_input={
            "email": member.email,
            "delivery_status": result.status,
            "delivery_error": result.error,
        },
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, user.organisation_id)
    return SecurityMemberInviteRead(
        member=_member_read(member, roles_by_user, invite_accept_url=accept_url),
        delivery_status=result.status,
        delivery_detail=result.error,
        invite_accept_url=accept_url,
    )


@router.post("/webhooks/sendgrid-events", status_code=status.HTTP_204_NO_CONTENT)
async def record_operator_invite_sendgrid_events(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    _assert_webhook_secret(request)
    payload = await request.json()
    events = payload if isinstance(payload, list) else [payload]
    for event in events:
        if not isinstance(event, dict):
            continue
        raw_status = str(event.get("event") or "")
        if not raw_status:
            continue
        member = _operator_from_sendgrid_event(session, event)
        if member is None:
            continue
        message_id = event.get("sg_message_id") or event.get("sg-message-id")
        provider_message_id = str(message_id) if message_id else None
        _apply_operator_invite_receipt(member, raw_status, provider_message_id, event)
        audit_log(
            session,
            actor="provider:sendgrid",
            action="receipt",
            target_table="app_user",
            target_id=member.id,
            tool_name="sendgrid.operator_invite_event_webhook",
            tool_input={
                "status": raw_status,
                "provider_message_id": provider_message_id,
            },
            tool_output_summary=_operator_invite_receipt_detail(raw_status, event),
            data_classification="confidential",
        )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/members/{member_id}/unlink-login", response_model=SecurityMemberRead)
def unlink_security_member_login(
    member_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> SecurityMemberRead:
    _assert_can_manage_security(session, user)
    member = session.get(AppUser, member_id)
    if member is None or member.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")
    if member.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot unlink your own operator login.",
        )
    if not member.auth_provider_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This operator does not have a linked provider login.",
        )

    member.auth_provider_id = None
    member.invite_status = OperatorInviteStatus.not_sent
    member.invite_accepted_at = None
    member.invite_token_hash = None
    member.invite_expires_at = None
    member.invite_last_error = "Provider login unlinked by an owner/admin."
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        target_table="app_user",
        target_id=member.id,
        action="unlink",
        tool_name="security.member_unlink_login",
        tool_input={"email": member.email},
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, user.organisation_id)
    return _member_read(member, roles_by_user)


@router.post("/invitations/accept", response_model=SecurityInviteAcceptRead)
def accept_security_invitation(
    payload: SecurityInviteAccept,
    session: Annotated[Session, Depends(get_session)],
) -> SecurityInviteAcceptRead:
    token_hash = _invite_token_hash(payload.token.strip())
    member = session.scalar(select(AppUser).where(AppUser.invite_token_hash == token_hash))
    if member is None or not member.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found.")
    now = utcnow()
    invite_expires_at = _aware(member.invite_expires_at)
    if invite_expires_at is None or invite_expires_at < now:
        member.invite_status = OperatorInviteStatus.expired
        member.invite_last_error = "Invite expired."
        session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite expired.")
    email = _normalise_email(payload.email)
    if email != member.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signed-in email does not match this invite.",
        )
    existing = session.scalar(
        select(AppUser).where(
            AppUser.auth_provider_id == payload.auth_provider_id,
            AppUser.id != member.id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This provider login is already linked to another operator.",
        )
    member.auth_provider_id = payload.auth_provider_id
    member.display_name = (
        payload.display_name.strip() if payload.display_name else member.display_name
    )
    member.invite_status = OperatorInviteStatus.accepted
    member.invite_accepted_at = now
    member.invite_last_error = None
    member.invite_token_hash = None
    audit_log(
        session,
        actor=f"user:{member.email}",
        user_id=member.id,
        target_table="app_user",
        target_id=member.id,
        action="accept",
        tool_name="security.member_invite_accept",
        tool_input={"email": member.email},
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, member.organisation_id)
    return SecurityInviteAcceptRead(member=_member_read(member, roles_by_user), accepted=True)


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
    if payload.notification_preferences is not None:
        member.notification_preferences = _notification_preferences_for_write(
            member.notification_preferences,
            payload.notification_preferences,
        )
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
