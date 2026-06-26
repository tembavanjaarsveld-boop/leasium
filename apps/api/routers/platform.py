"""Platform-admin client provisioning + management routes.

Every endpoint is gated on ``require_platform_admin``. A platform admin acts
*across* client organisations; the reserved "Relby Platform" org is excluded
from client lists and refused where the operation makes no sense. All mutations
are audited; all provider sends route through the mocked-in-tests invite
machinery (no real Xero/SendGrid/Twilio call fires without operator approval).
See docs/platform-admin-tier-ia.md.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import AppUser, OperatingMode, OperatorInviteStatus, Organisation
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, get_session, require_platform_admin
from apps.api.routers.security import (
    _member_access_status,
    _member_read,
    _normalise_email,
    _role_rows,
    _send_operator_invite,
)
from apps.api.schemas.platform import (
    PlatformMemberCreate,
    PlatformMemberInviteRead,
    PlatformMemberListRead,
    PlatformMemberUpdate,
    PlatformOperatingModeUpdate,
    PlatformOrganisationCreate,
    PlatformOrganisationCreateRead,
    PlatformOrganisationListRead,
    PlatformOrganisationRead,
    PlatformOrganisationUpdate,
)

router = APIRouter(prefix="/platform", tags=["platform"])


def _is_reserved_org(organisation: Organisation, settings: Settings) -> bool:
    return organisation.id == settings.platform_organisation_id


def _operator_count(session: Session, organisation_id: UUID) -> int:
    return (
        session.scalar(
            select(func.count(AppUser.id)).where(AppUser.organisation_id == organisation_id)
        )
        or 0
    )


def _first_operator(session: Session, organisation_id: UUID) -> AppUser | None:
    return session.scalar(
        select(AppUser)
        .where(AppUser.organisation_id == organisation_id)
        .order_by(AppUser.created_at, AppUser.email)
        .limit(1)
    )


def _organisation_read(session: Session, organisation: Organisation) -> PlatformOrganisationRead:
    first = _first_operator(session, organisation.id)
    return PlatformOrganisationRead(
        id=organisation.id,
        name=organisation.name,
        country_code=organisation.country_code,
        timezone=organisation.timezone,
        operating_mode=organisation.operating_mode,
        is_active=organisation.suspended_at is None,
        suspended_at=organisation.suspended_at,
        created_at=organisation.created_at,
        operator_count=_operator_count(session, organisation.id),
        first_operator_email=first.email if first is not None else None,
        first_operator_access_status=(
            _member_access_status(first) if first is not None else None
        ),
    )


def _get_client_org(
    organisation_id: UUID,
    session: Session,
    settings: Settings,
) -> Organisation:
    organisation = session.get(Organisation, organisation_id)
    if organisation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found.")
    if _is_reserved_org(organisation, settings):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The reserved platform organisation is not a client.",
        )
    return organisation


@router.get("/organisations", response_model=PlatformOrganisationListRead)
def list_platform_organisations(
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],  # noqa: ARG001
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformOrganisationListRead:
    organisations = session.scalars(
        select(Organisation)
        .where(Organisation.id != settings.platform_organisation_id)
        .order_by(Organisation.created_at, Organisation.name)
    ).all()
    return PlatformOrganisationListRead(
        organisations=[_organisation_read(session, org) for org in organisations]
    )


@router.post(
    "/organisations",
    response_model=PlatformOrganisationCreateRead,
    status_code=status.HTTP_201_CREATED,
)
def create_platform_organisation(
    payload: PlatformOrganisationCreate,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformOrganisationCreateRead:
    organisation_name = payload.organisation_name.strip()
    if not organisation_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organisation name is required.",
        )
    email = _normalise_email(payload.operator_email)
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid email.")
    existing = session.scalar(select(AppUser).where(func.lower(AppUser.email) == email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email already belongs to an operator.",
        )

    organisation = Organisation(
        name=organisation_name,
        country_code=payload.country_code.strip().upper() or "AU",
        timezone=payload.timezone.strip() or "Australia/Brisbane",
        operating_mode=OperatingMode.self_managed_owner.value,
    )
    session.add(organisation)
    session.flush()

    member = AppUser(
        organisation_id=organisation.id,
        email=email,
        display_name=(payload.operator_display_name or "").strip() or email,
        is_active=True,
        invite_status=OperatorInviteStatus.not_sent,
    )
    session.add(member)
    session.flush()

    result, accept_url = _send_operator_invite(member, admin, organisation, settings)
    audit_log(
        session,
        actor=admin.actor,
        user_id=admin.id,
        target_table="organisation",
        target_id=organisation.id,
        action="provision",
        tool_name="platform.organisation_provision",
        tool_input={
            "organisation_name": organisation.name,
            "operator_email": email,
            "delivery_status": result.status,
            "delivery_error": result.error,
        },
    )
    session.commit()
    session.refresh(organisation)
    session.refresh(member)
    roles_by_user = _role_rows(session, organisation.id)
    return PlatformOrganisationCreateRead(
        organisation=_organisation_read(session, organisation),
        operator=_member_read(member, roles_by_user, invite_accept_url=accept_url),
        invite_accept_url=accept_url,
        delivery_status=result.status,
        delivery_detail=result.error,
    )


@router.patch("/organisations/{organisation_id}", response_model=PlatformOrganisationRead)
def update_platform_organisation(
    organisation_id: UUID,
    payload: PlatformOrganisationUpdate,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformOrganisationRead:
    organisation = _get_client_org(organisation_id, session, settings)
    if payload.is_active:
        organisation.suspended_at = None
        action = "restore"
    else:
        organisation.suspended_at = organisation.suspended_at or utcnow()
        action = "suspend"
    audit_log(
        session,
        actor=admin.actor,
        user_id=admin.id,
        target_table="organisation",
        target_id=organisation.id,
        action=action,
        tool_name="platform.organisation_lifecycle",
        tool_input={"is_active": payload.is_active},
    )
    session.commit()
    session.refresh(organisation)
    return _organisation_read(session, organisation)


@router.patch(
    "/organisations/{organisation_id}/operating-mode",
    response_model=PlatformOrganisationRead,
)
def set_platform_operating_mode(
    organisation_id: UUID,
    payload: PlatformOperatingModeUpdate,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformOrganisationRead:
    """Set a client organisation's operating mode.

    Operating mode is a platform-level classification (clients don't decide
    what they are): it gates owner-client surfaces such as People → Owners.
    """
    organisation = _get_client_org(organisation_id, session, settings)
    organisation.operating_mode = payload.operating_mode.value
    audit_log(
        session,
        actor=admin.actor,
        user_id=admin.id,
        target_table="organisation",
        target_id=organisation.id,
        action="update",
        tool_name="platform.set_operating_mode",
        tool_input={"operating_mode": payload.operating_mode.value},
    )
    session.commit()
    session.refresh(organisation)
    return _organisation_read(session, organisation)


@router.get("/organisations/{organisation_id}/members", response_model=PlatformMemberListRead)
def list_platform_members(
    organisation_id: UUID,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],  # noqa: ARG001
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformMemberListRead:
    organisation = _get_client_org(organisation_id, session, settings)
    members = session.scalars(
        select(AppUser)
        .where(AppUser.organisation_id == organisation.id)
        .order_by(AppUser.display_name, AppUser.email)
    ).all()
    roles_by_user = _role_rows(session, organisation.id)
    return PlatformMemberListRead(
        members=[_member_read(member, roles_by_user) for member in members]
    )


@router.post(
    "/organisations/{organisation_id}/members",
    response_model=PlatformMemberInviteRead,
    status_code=status.HTTP_201_CREATED,
)
def create_platform_member(
    organisation_id: UUID,
    payload: PlatformMemberCreate,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformMemberInviteRead:
    organisation = _get_client_org(organisation_id, session, settings)
    email = _normalise_email(payload.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid email.")
    member = session.scalar(select(AppUser).where(func.lower(AppUser.email) == email))
    if member is not None and member.organisation_id != organisation.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email belongs to another organisation.",
        )
    if member is None:
        member = AppUser(
            organisation_id=organisation.id,
            email=email,
            display_name=payload.display_name.strip() or email,
            is_active=payload.is_active,
            invite_status=OperatorInviteStatus.not_sent,
        )
        session.add(member)
        session.flush()
    else:
        member.display_name = payload.display_name.strip() or member.display_name
        member.is_active = payload.is_active

    result, accept_url = _send_operator_invite(member, admin, organisation, settings)
    audit_log(
        session,
        actor=admin.actor,
        user_id=admin.id,
        target_table="app_user",
        target_id=member.id,
        action="invite",
        tool_name="platform.member_invite",
        tool_input={
            "organisation_id": str(organisation.id),
            "email": email,
            "delivery_status": result.status,
            "delivery_error": result.error,
        },
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, organisation.id)
    return PlatformMemberInviteRead(
        member=_member_read(member, roles_by_user, invite_accept_url=accept_url),
        delivery_status=result.status,
        delivery_detail=result.error,
        invite_accept_url=accept_url,
    )


@router.post(
    "/organisations/{organisation_id}/members/{member_id}/invite",
    response_model=PlatformMemberInviteRead,
)
def resend_platform_member_invite(
    organisation_id: UUID,
    member_id: UUID,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformMemberInviteRead:
    organisation = _get_client_org(organisation_id, session, settings)
    member = session.get(AppUser, member_id)
    if member is None or member.organisation_id != organisation.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")
    if member.auth_provider_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This operator already has a linked provider login.",
        )
    result, accept_url = _send_operator_invite(member, admin, organisation, settings)
    audit_log(
        session,
        actor=admin.actor,
        user_id=admin.id,
        target_table="app_user",
        target_id=member.id,
        action="invite",
        tool_name="platform.member_invite_resend",
        tool_input={
            "organisation_id": str(organisation.id),
            "email": member.email,
            "delivery_status": result.status,
            "delivery_error": result.error,
        },
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, organisation.id)
    return PlatformMemberInviteRead(
        member=_member_read(member, roles_by_user, invite_accept_url=accept_url),
        delivery_status=result.status,
        delivery_detail=result.error,
        invite_accept_url=accept_url,
    )


@router.patch(
    "/organisations/{organisation_id}/members/{member_id}",
    response_model=PlatformMemberInviteRead,
)
def update_platform_member(
    organisation_id: UUID,
    member_id: UUID,
    payload: PlatformMemberUpdate,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlatformMemberInviteRead:
    organisation = _get_client_org(organisation_id, session, settings)
    member = session.get(AppUser, member_id)
    if member is None or member.organisation_id != organisation.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")
    if payload.display_name is not None:
        member.display_name = payload.display_name.strip() or member.display_name
    if payload.is_active is not None:
        member.is_active = payload.is_active
    audit_log(
        session,
        actor=admin.actor,
        user_id=admin.id,
        target_table="app_user",
        target_id=member.id,
        action="update",
        tool_name="platform.member_update",
        tool_input={
            "organisation_id": str(organisation.id),
            **payload.model_dump(mode="json", exclude_unset=True),
        },
    )
    session.commit()
    session.refresh(member)
    roles_by_user = _role_rows(session, organisation.id)
    return PlatformMemberInviteRead(
        member=_member_read(member, roles_by_user),
        delivery_status="not_sent",
        delivery_detail=None,
    )
