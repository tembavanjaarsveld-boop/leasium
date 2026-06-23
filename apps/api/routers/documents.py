"""Document upload, listing, download, and deletion routes."""

from pathlib import Path
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    DocumentCategory,
    DocumentIntakeStatus,
    Lease,
    Obligation,
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

router = APIRouter(prefix="/documents", tags=["documents"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{name} not found.")


def _document_for_user(
    document_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> StoredDocument:
    document = session.get(StoredDocument, document_id)
    if document is None or document.deleted_at is not None:
        raise _not_found("Document")
    assert_entity_role(session, user, document.entity_id, roles)
    return document


def _tenant_for_entity(tenant_id: UUID, entity_id: UUID, session: Session) -> Tenant:
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None or tenant.entity_id != entity_id:
        raise _not_found("Tenant")
    return tenant


def _property_for_entity(property_id: UUID, entity_id: UUID, session: Session) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None or prop.entity_id != entity_id:
        raise _not_found("Property")
    return prop


def _unit_for_entity(unit_id: UUID, entity_id: UUID, session: Session) -> TenancyUnit:
    unit = session.get(TenancyUnit, unit_id)
    if unit is None or unit.deleted_at is not None:
        raise _not_found("Tenancy unit")
    _property_for_entity(unit.property_id, entity_id, session)
    return unit


def _lease_for_entity(lease_id: UUID, entity_id: UUID, session: Session) -> Lease:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise _not_found("Lease")
    tenant = _tenant_for_entity(lease.tenant_id, entity_id, session)
    unit = _unit_for_entity(lease.tenancy_unit_id, entity_id, session)
    if tenant.entity_id != entity_id or unit is None:
        raise _not_found("Lease")
    return lease


def _onboarding_for_entity(
    onboarding_id: UUID,
    entity_id: UUID,
    session: Session,
) -> TenantOnboarding:
    onboarding = session.get(TenantOnboarding, onboarding_id)
    if onboarding is None or onboarding.deleted_at is not None or onboarding.entity_id != entity_id:
        raise _not_found("Onboarding")
    return onboarding


def _obligation_for_entity(
    obligation_id: UUID,
    entity_id: UUID,
    session: Session,
) -> Obligation:
    obligation = session.get(Obligation, obligation_id)
    if (
        obligation is None
        or obligation.deleted_at is not None
        or obligation.entity_id != entity_id
    ):
        raise _not_found("Obligation")
    return obligation


def _require_matching_scope(
    provided_id: UUID | None,
    expected_id: UUID | None,
    *,
    detail: str,
) -> None:
    if provided_id is not None and expected_id is not None and provided_id != expected_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


@router.get("", response_model=list[DocumentRead])
def list_documents(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    property_id: UUID | None = None,
    tenancy_unit_id: UUID | None = None,
    tenant_id: UUID | None = None,
    lease_id: UUID | None = None,
    tenant_onboarding_id: UUID | None = None,
    category: DocumentCategory | None = None,
) -> list[StoredDocument]:
    assert_entity_role(session, user, entity_id, READ_ROLES)

    statement = select(StoredDocument).where(
        StoredDocument.entity_id == entity_id,
        StoredDocument.deleted_at.is_(None),
    )
    if property_id is not None:
        _property_for_entity(property_id, entity_id, session)
        statement = statement.where(StoredDocument.property_id == property_id)
    if tenancy_unit_id is not None:
        _unit_for_entity(tenancy_unit_id, entity_id, session)
        statement = statement.where(StoredDocument.tenancy_unit_id == tenancy_unit_id)
    if tenant_id is not None:
        _tenant_for_entity(tenant_id, entity_id, session)
        statement = statement.where(StoredDocument.tenant_id == tenant_id)
    if lease_id is not None:
        _lease_for_entity(lease_id, entity_id, session)
        statement = statement.where(StoredDocument.lease_id == lease_id)
    if tenant_onboarding_id is not None:
        _onboarding_for_entity(tenant_onboarding_id, entity_id, session)
        statement = statement.where(StoredDocument.tenant_onboarding_id == tenant_onboarding_id)
    if category is not None:
        statement = statement.where(StoredDocument.category == category)
    return list(session.scalars(statement.order_by(StoredDocument.created_at.desc())))


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
async def upload_document(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Form()],
    file: Annotated[UploadFile, File()],
    property_id: Annotated[UUID | None, Form()] = None,
    tenancy_unit_id: Annotated[UUID | None, Form()] = None,
    tenant_id: Annotated[UUID | None, Form()] = None,
    lease_id: Annotated[UUID | None, Form()] = None,
    tenant_onboarding_id: Annotated[UUID | None, Form()] = None,
    obligation_id: Annotated[UUID | None, Form()] = None,
    category: Annotated[DocumentCategory, Form()] = DocumentCategory.other,
    notes: Annotated[str | None, Form()] = None,
) -> StoredDocument:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    obligation = (
        _obligation_for_entity(obligation_id, entity_id, session)
        if obligation_id is not None
        else None
    )
    if obligation is not None:
        _require_matching_scope(
            property_id,
            obligation.property_id,
            detail="Document property must match the obligation property.",
        )
        _require_matching_scope(
            tenancy_unit_id,
            obligation.tenancy_unit_id,
            detail="Document unit must match the obligation unit.",
        )
        _require_matching_scope(
            lease_id,
            obligation.lease_id,
            detail="Document lease must match the obligation lease.",
        )
        property_id = property_id or obligation.property_id
        tenancy_unit_id = tenancy_unit_id or obligation.tenancy_unit_id
        lease_id = lease_id or obligation.lease_id
        if tenant_id is not None and obligation.lease_id is not None:
            obligation_lease = session.get(Lease, obligation.lease_id)
            if obligation_lease is not None and obligation_lease.tenant_id != tenant_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Document tenant must match the obligation tenant.",
                )
        if tenant_id is None and obligation.lease_id is not None:
            obligation_lease = session.get(Lease, obligation.lease_id)
            if obligation_lease is not None:
                tenant_id = obligation_lease.tenant_id
    if property_id is not None:
        _property_for_entity(property_id, entity_id, session)
    if tenancy_unit_id is not None:
        _unit_for_entity(tenancy_unit_id, entity_id, session)
    if tenant_id is not None:
        _tenant_for_entity(tenant_id, entity_id, session)
    lease = _lease_for_entity(lease_id, entity_id, session) if lease_id is not None else None
    onboarding = (
        _onboarding_for_entity(tenant_onboarding_id, entity_id, session)
        if tenant_onboarding_id is not None
        else None
    )
    if onboarding is not None:
        if tenant_id is not None and onboarding.tenant_id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Document tenant must match the onboarding tenant.",
            )
        if lease_id is not None and onboarding.lease_id != lease_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Document lease must match the onboarding lease.",
            )
    if lease is not None and tenant_id is not None and lease.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document lease must match the tenant.",
        )

    data = await file.read()
    max_bytes = get_settings().document_max_bytes
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty.")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Document is too large. Max size is {max_bytes // 1_000_000}MB.",
        )

    filename = Path(file.filename or "document").name
    document = StoredDocument(
        entity_id=entity_id,
        property_id=property_id,
        tenancy_unit_id=tenancy_unit_id,
        tenant_id=tenant_id,
        lease_id=lease_id,
        tenant_onboarding_id=tenant_onboarding_id,
        filename=filename,
        content_type=file.content_type,
        byte_size=len(data),
        file_data=data,
        category=category,
        notes=notes.strip() if notes and notes.strip() else None,
        document_metadata={},
    )
    session.add(document)
    session.flush()
    if obligation is not None:
        document.document_metadata = {
            **(document.document_metadata or {}),
            "source": "manual_comms_evidence_upload",
            "source_obligation_id": str(obligation.id),
            "source_obligation_title": obligation.title,
        }
        metadata = dict(obligation.obligation_metadata or {})
        evidence_document_ids = list(metadata.get("evidence_document_ids") or [])
        document_id = str(document.id)
        if document_id not in evidence_document_ids:
            evidence_document_ids.append(document_id)
        evidence_history = list(metadata.get("evidence_history") or [])
        evidence_history.append(
            {
                "document_id": document_id,
                "filename": document.filename,
                "source": "manual_comms_evidence_upload",
            }
        )
        metadata.update(
            {
                "evidence_document_ids": evidence_document_ids,
                "evidence_history": evidence_history[-20:],
            }
        )
        obligation.obligation_metadata = metadata
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="upload",
        target_table="stored_document",
        target_id=document.id,
        tool_input=(
            {"obligation_id": str(obligation.id)}
            if obligation is not None
            else None
        ),
    )
    session.commit()
    session.refresh(document)
    return document


@router.get("/{document_id}/download")
def download_document(
    document_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    inline: Annotated[bool, Query()] = False,
) -> Response:
    # inline=1 serves the file for in-tab viewing (e.g. "View supplier invoice");
    # the default keeps the download behaviour. Read-only either way.
    document = _document_for_user(document_id, user, session, READ_ROLES)
    safe_filename = quote(document.filename)
    disposition = "inline" if inline else "attachment"
    return Response(
        content=document.file_data,
        media_type=document.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": (
                f"{disposition}; filename*=UTF-8''{safe_filename}"
            )
        },
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    document = _document_for_user(document_id, user, session, WRITE_ROLES)
    if (
        document.document_intake is not None
        and document.document_intake.status == DocumentIntakeStatus.applied
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Applied source documents cannot be deleted.",
        )
    if document.tenant_onboarding_id is not None:
        onboarding = session.get(TenantOnboarding, document.tenant_onboarding_id)
        if onboarding is not None and onboarding.status in {
            TenantOnboardingStatus.submitted,
            TenantOnboardingStatus.reviewed,
            TenantOnboardingStatus.applied,
        }:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Submitted onboarding documents cannot be deleted.",
            )
    document.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=document.entity_id,
        action="delete",
        target_table="stored_document",
        target_id=document.id,
    )
    session.commit()
