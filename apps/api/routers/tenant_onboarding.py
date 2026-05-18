"""Tenant onboarding link routes."""

import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    Lease,
    Property,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    UserRole,
)
from stewart.core.settings import get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.tenant_onboarding import (
    TenantOnboardingCreate,
    TenantOnboardingPublicRead,
    TenantOnboardingRead,
    TenantOnboardingSubmit,
)

router = APIRouter(prefix="/tenant-onboarding", tags=["tenant-onboarding"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _onboarding_url(token: str) -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/onboarding/{token}"


def _read(row: TenantOnboarding) -> TenantOnboardingRead:
    response = TenantOnboardingRead.model_validate(row)
    response.onboarding_url = _onboarding_url(row.token)
    return response


def _lease_scope(
    lease_id: UUID,
    session: Session,
) -> tuple[Lease, Property, Tenant]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lease not found.")
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    tenant = session.get(Tenant, lease.tenant_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenancy unit not found.")
    prop = session.get(Property, unit.property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    if tenant.entity_id != prop.entity_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease links tenant and unit across different entities.",
        )
    return lease, prop, tenant


def _new_token(session: Session) -> str:
    while True:
        token = secrets.token_urlsafe(24)
        exists = session.scalar(
            select(TenantOnboarding.id).where(TenantOnboarding.token == token)
        )
        if exists is None:
            return token


def _get_onboarding_for_user(
    onboarding_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> TenantOnboarding:
    onboarding = session.get(TenantOnboarding, onboarding_id)
    if onboarding is None or onboarding.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    assert_entity_role(session, user, onboarding.entity_id, roles)
    return onboarding


@router.get("", response_model=list[TenantOnboardingRead])
def list_tenant_onboardings(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID,
) -> list[TenantOnboardingRead]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    rows = session.scalars(
        select(TenantOnboarding)
        .where(TenantOnboarding.entity_id == entity_id, TenantOnboarding.deleted_at.is_(None))
        .order_by(TenantOnboarding.created_at.desc())
    ).all()
    return [_read(row) for row in rows]


@router.post("", response_model=TenantOnboardingRead, status_code=status.HTTP_201_CREATED)
def create_tenant_onboarding(
    payload: TenantOnboardingCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    lease, prop, tenant = _lease_scope(payload.lease_id, session)
    assert_entity_role(session, user, prop.entity_id, WRITE_ROLES)

    existing = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.lease_id == lease.id,
            TenantOnboarding.tenant_id == tenant.id,
            TenantOnboarding.status != TenantOnboardingStatus.cancelled,
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    if existing is not None:
        return _read(existing)

    onboarding = TenantOnboarding(
        entity_id=prop.entity_id,
        lease_id=lease.id,
        tenant_id=tenant.id,
        token=_new_token(session),
        status=TenantOnboardingStatus.sent,
        due_date=payload.due_date,
        submitted_data={},
    )
    session.add(onboarding)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="create",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/cancel", response_model=TenantOnboardingRead)
def cancel_tenant_onboarding(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status == TenantOnboardingStatus.submitted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submitted onboarding cannot be cancelled.",
        )
    onboarding.status = TenantOnboardingStatus.cancelled
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="cancel",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.get("/public/{token}", response_model=TenantOnboardingPublicRead)
def get_public_tenant_onboarding(
    token: str,
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingPublicRead:
    onboarding = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.token == token,
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    if onboarding is None or onboarding.status == TenantOnboardingStatus.cancelled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    tenant = session.get(Tenant, onboarding.tenant_id)
    lease = session.get(Lease, onboarding.lease_id)
    if tenant is None or lease is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    return TenantOnboardingPublicRead(
        token=onboarding.token,
        status=onboarding.status,
        tenant_legal_name=tenant.legal_name,
        tenant_trading_name=tenant.trading_name,
        contact_name=tenant.contact_name,
        contact_email=tenant.contact_email,
        contact_phone=tenant.contact_phone,
        billing_email=tenant.billing_email,
        lease_commencement_date=lease.commencement_date,
        lease_expiry_date=lease.expiry_date,
        submitted_at=onboarding.submitted_at,
    )


@router.post("/public/{token}/submit", response_model=TenantOnboardingPublicRead)
def submit_public_tenant_onboarding(
    token: str,
    payload: TenantOnboardingSubmit,
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingPublicRead:
    onboarding = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.token == token,
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    if onboarding is None or onboarding.status == TenantOnboardingStatus.cancelled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    if not payload.accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Acceptance is required.",
        )
    tenant = session.get(Tenant, onboarding.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    data = payload.model_dump(mode="json")
    tenant.legal_name = payload.legal_name
    tenant.trading_name = payload.trading_name
    tenant.abn = payload.abn
    tenant.contact_name = payload.contact_name
    tenant.contact_email = payload.contact_email
    tenant.contact_phone = payload.contact_phone
    tenant.billing_email = payload.billing_email or payload.contact_email
    tenant.tenant_metadata = {
        **tenant.tenant_metadata,
        "tenant_onboarding_id": str(onboarding.id),
        "insurance_confirmed": payload.insurance_confirmed,
        "insurance_expiry_date": (
            payload.insurance_expiry_date.isoformat()
            if payload.insurance_expiry_date
            else None
        ),
    }
    onboarding.status = TenantOnboardingStatus.submitted
    onboarding.submitted_data = data
    onboarding.submitted_at = utcnow()
    audit_log(
        session,
        actor=f"tenant-onboarding:{token[:8]}",
        entity_id=onboarding.entity_id,
        action="submit",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    return get_public_tenant_onboarding(token, session)
