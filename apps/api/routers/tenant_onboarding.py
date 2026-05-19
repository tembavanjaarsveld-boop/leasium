"""Tenant onboarding link routes."""

import secrets
from datetime import UTC
from pathlib import Path
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    DocumentCategory,
    Lease,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    UserRole,
)
from stewart.core.settings import get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.documents import DocumentRead
from apps.api.schemas.tenant_onboarding import (
    TenantOnboardingCancel,
    TenantOnboardingCreate,
    TenantOnboardingPublicRead,
    TenantOnboardingRead,
    TenantOnboardingReview,
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


def _is_expired(row: TenantOnboarding) -> bool:
    if row.expires_at is None:
        return False
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= utcnow()


def _property_address(prop: Property) -> str | None:
    parts = [
        prop.street_address,
        prop.suburb,
        prop.state,
        prop.postcode,
    ]
    address = ", ".join(part for part in parts if part)
    return address or None


def _apply_submission(onboarding: TenantOnboarding, tenant: Tenant) -> None:
    data = onboarding.submitted_data
    tenant.legal_name = data["legal_name"]
    tenant.trading_name = data.get("trading_name")
    tenant.abn = data.get("abn")
    tenant.contact_name = data["contact_name"]
    tenant.contact_email = data["contact_email"]
    tenant.contact_phone = data.get("contact_phone")
    tenant.billing_email = data.get("billing_email") or data["contact_email"]
    tenant.tenant_metadata = {
        **tenant.tenant_metadata,
        "tenant_onboarding_id": str(onboarding.id),
        "insurance_confirmed": data.get("insurance_confirmed", False),
        "insurance_expiry_date": data.get("insurance_expiry_date"),
    }


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


def _get_public_onboarding(token: str, session: Session) -> TenantOnboarding:
    onboarding = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.token == token,
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    if (
        onboarding is None
        or onboarding.status == TenantOnboardingStatus.cancelled
        or _is_expired(onboarding)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    return onboarding


def _public_document(
    token: str,
    document_id: UUID,
    session: Session,
) -> tuple[TenantOnboarding, StoredDocument]:
    onboarding = _get_public_onboarding(token, session)
    document = session.get(StoredDocument, document_id)
    if (
        document is None
        or document.deleted_at is not None
        or document.tenant_onboarding_id != onboarding.id
        or document.tenant_id != onboarding.tenant_id
        or document.entity_id != onboarding.entity_id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return onboarding, document


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
        expires_at=payload.expires_at,
        last_sent_at=utcnow(),
        submitted_data={},
        review_data={},
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
    payload: TenantOnboardingCancel | None = None,
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status in {
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submitted onboarding cannot be cancelled.",
        )
    onboarding.status = TenantOnboardingStatus.cancelled
    if payload is not None:
        onboarding.cancel_reason = payload.reason
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


@router.post("/{onboarding_id}/resend", response_model=TenantOnboardingRead)
def resend_tenant_onboarding(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status in {
        TenantOnboardingStatus.cancelled,
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only sent onboarding links can be resent.",
        )
    if _is_expired(onboarding):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Expired onboarding links cannot be resent.",
        )

    now = utcnow()
    onboarding.status = TenantOnboardingStatus.sent
    onboarding.last_sent_at = now
    onboarding.resent_at = now
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="resend",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/review", response_model=TenantOnboardingRead)
def review_tenant_onboarding(
    onboarding_id: UUID,
    payload: TenantOnboardingReview,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status not in {TenantOnboardingStatus.submitted, TenantOnboardingStatus.reviewed}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only submitted onboarding can be reviewed.",
        )

    onboarding.review_data = payload.model_dump(mode="json")
    onboarding.reviewed_at = utcnow()
    onboarding.reviewed_by_user_id = user.id
    if payload.approved:
        onboarding.status = TenantOnboardingStatus.reviewed
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="review",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
    )
    session.commit()
    session.refresh(onboarding)
    return _read(onboarding)


@router.post("/{onboarding_id}/apply", response_model=TenantOnboardingRead)
def apply_tenant_onboarding(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingRead:
    onboarding = _get_onboarding_for_user(onboarding_id, user, session, WRITE_ROLES)
    if onboarding.status not in {
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only submitted onboarding can be applied.",
        )
    tenant = session.get(Tenant, onboarding.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    _apply_submission(onboarding, tenant)
    onboarding.status = TenantOnboardingStatus.applied
    onboarding.applied_at = utcnow()
    onboarding.applied_by_user_id = user.id
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=onboarding.entity_id,
        action="apply",
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
    onboarding = _get_public_onboarding(token, session)
    lease, prop, tenant = _lease_scope(onboarding.lease_id, session)
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding not found.")
    return TenantOnboardingPublicRead(
        token=onboarding.token,
        status=onboarding.status,
        tenant_legal_name=tenant.legal_name,
        tenant_trading_name=tenant.trading_name,
        property_name=prop.name,
        property_address=_property_address(prop),
        unit_label=unit.unit_label,
        contact_name=tenant.contact_name,
        contact_email=tenant.contact_email,
        contact_phone=tenant.contact_phone,
        billing_email=tenant.billing_email,
        lease_commencement_date=lease.commencement_date,
        lease_expiry_date=lease.expiry_date,
        due_date=onboarding.due_date,
        expires_at=onboarding.expires_at,
        submitted_at=onboarding.submitted_at,
    )


@router.get("/public/{token}/documents", response_model=list[DocumentRead])
def list_public_onboarding_documents(
    token: str,
    session: Annotated[Session, Depends(get_session)],
) -> list[StoredDocument]:
    onboarding = _get_public_onboarding(token, session)
    rows = session.scalars(
        select(StoredDocument)
        .where(
            StoredDocument.entity_id == onboarding.entity_id,
            StoredDocument.tenant_id == onboarding.tenant_id,
            StoredDocument.tenant_onboarding_id == onboarding.id,
            StoredDocument.deleted_at.is_(None),
        )
        .order_by(StoredDocument.created_at.desc())
    ).all()
    return list(rows)


@router.post(
    "/public/{token}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_public_onboarding_document(
    token: str,
    session: Annotated[Session, Depends(get_session)],
    file: Annotated[UploadFile, File()],
    category: Annotated[DocumentCategory, Form()] = DocumentCategory.onboarding,
    notes: Annotated[str | None, Form()] = None,
) -> StoredDocument:
    onboarding = _get_public_onboarding(token, session)
    if onboarding.status in {
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submitted onboarding documents cannot be changed.",
        )
    lease, prop, _tenant = _lease_scope(onboarding.lease_id, session)
    data = await file.read()
    max_bytes = get_settings().document_max_bytes
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty.")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Document is too large. Max size is {max_bytes // 1_000_000}MB.",
        )

    document = StoredDocument(
        entity_id=onboarding.entity_id,
        property_id=prop.id,
        tenancy_unit_id=lease.tenancy_unit_id,
        tenant_id=onboarding.tenant_id,
        lease_id=onboarding.lease_id,
        tenant_onboarding_id=onboarding.id,
        filename=Path(file.filename or "document").name,
        content_type=file.content_type,
        byte_size=len(data),
        file_data=data,
        category=category,
        notes=notes.strip() if notes and notes.strip() else None,
        document_metadata={"source": "tenant_onboarding"},
    )
    session.add(document)
    session.flush()
    audit_log(
        session,
        actor=f"tenant-onboarding:{token[:8]}",
        entity_id=onboarding.entity_id,
        action="upload",
        target_table="stored_document",
        target_id=document.id,
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(document)
    return document


@router.get("/public/{token}/documents/{document_id}/download")
def download_public_onboarding_document(
    token: str,
    document_id: UUID,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    _onboarding, document = _public_document(token, document_id, session)
    return Response(
        content=document.file_data,
        media_type=document.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(document.filename)}"
        },
    )


@router.delete("/public/{token}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_public_onboarding_document(
    token: str,
    document_id: UUID,
    session: Annotated[Session, Depends(get_session)],
) -> None:
    onboarding, document = _public_document(token, document_id, session)
    if onboarding.status in {
        TenantOnboardingStatus.submitted,
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submitted onboarding documents cannot be changed.",
        )
    document.deleted_at = utcnow()
    audit_log(
        session,
        actor=f"tenant-onboarding:{token[:8]}",
        entity_id=onboarding.entity_id,
        action="delete",
        target_table="stored_document",
        target_id=document.id,
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()


@router.post("/public/{token}/submit", response_model=TenantOnboardingPublicRead)
def submit_public_tenant_onboarding(
    token: str,
    payload: TenantOnboardingSubmit,
    session: Annotated[Session, Depends(get_session)],
) -> TenantOnboardingPublicRead:
    onboarding = _get_public_onboarding(token, session)
    if not payload.accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Acceptance is required.",
        )
    tenant = session.get(Tenant, onboarding.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    data = payload.model_dump(mode="json")
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
