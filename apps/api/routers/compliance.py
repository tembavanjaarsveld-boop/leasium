"""Recurring compliance check routes."""

import calendar
from datetime import date, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AppUser,
    ComplianceCheck,
    ComplianceCheckStatus,
    ComplianceRecurrenceUnit,
    Entity,
    Lease,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    StoredDocument,
    Tenant,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.obligations import _validate_obligation_scope
from apps.api.schemas.compliance import (
    ComplianceCheckComplete,
    ComplianceCheckCreate,
    ComplianceCheckRead,
    ComplianceCheckUpdate,
)

router = APIRouter(prefix="/compliance/checks", tags=["compliance"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{name} not found.")


def _entity_for_access(
    entity_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Entity:
    assert_entity_role(session, user, entity_id, roles)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise _not_found("Entity")
    return entity


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


def _dict(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _validate_tenant(
    tenant_id: UUID | None,
    *,
    entity_id: UUID,
    lease_id: UUID | None,
    session: Session,
) -> UUID | None:
    if tenant_id is None and lease_id is not None:
        lease = session.get(Lease, lease_id)
        return lease.tenant_id if lease is not None and lease.deleted_at is None else None
    if tenant_id is None:
        return None
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise _not_found("Tenant")
    if tenant.entity_id != entity_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tenant must belong to the compliance check entity.",
        )
    if lease_id is not None:
        lease = session.get(Lease, lease_id)
        if lease is not None and lease.tenant_id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Tenant must match the compliance check lease.",
            )
    return tenant_id


def _validate_document(
    document_id: UUID | None,
    *,
    entity_id: UUID,
    session: Session,
) -> UUID | None:
    if document_id is None:
        return None
    document = session.get(StoredDocument, document_id)
    if document is None or document.deleted_at is not None:
        raise _not_found("Stored document")
    if document.entity_id != entity_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Stored document must belong to the compliance check entity.",
        )
    return document_id


def _validate_assigned_user(
    assigned_user_id: UUID | None,
    *,
    entity: Entity,
    session: Session,
) -> UUID | None:
    if assigned_user_id is None:
        return None
    assigned_user = session.get(AppUser, assigned_user_id)
    if (
        assigned_user is None
        or not assigned_user.is_active
        or assigned_user.organisation_id != entity.organisation_id
    ):
        raise _not_found("Assigned user")
    return assigned_user_id


def _validate_current_obligation(
    obligation_id: UUID | None,
    *,
    entity_id: UUID,
    session: Session,
) -> UUID | None:
    if obligation_id is None:
        return None
    obligation = session.get(Obligation, obligation_id)
    if obligation is None or obligation.deleted_at is not None:
        raise _not_found("Obligation")
    if obligation.entity_id != entity_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Obligation must belong to the compliance check entity.",
        )
    return obligation_id


def _validate_scope(
    *,
    entity_id: UUID,
    property_id: UUID | None,
    tenancy_unit_id: UUID | None,
    lease_id: UUID | None,
    tenant_id: UUID | None,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> tuple[UUID | None, UUID | None, UUID | None, UUID | None]:
    property_id, tenancy_unit_id, lease_id = _validate_obligation_scope(
        entity_id=entity_id,
        property_id=property_id,
        tenancy_unit_id=tenancy_unit_id,
        lease_id=lease_id,
        user=user,
        session=session,
        roles=roles,
    )
    tenant_id = _validate_tenant(
        tenant_id,
        entity_id=entity_id,
        lease_id=lease_id,
        session=session,
    )
    return property_id, tenancy_unit_id, lease_id, tenant_id


def _obligation_status(due_date: date) -> ObligationStatus:
    today = date.today()
    if due_date < today:
        return ObligationStatus.overdue
    if due_date <= today + timedelta(days=30):
        return ObligationStatus.due_soon
    return ObligationStatus.upcoming


def _obligation_metadata(check: ComplianceCheck) -> dict[str, Any]:
    metadata = {
        "source": "compliance_check",
        "compliance_check_id": str(check.id),
        "kind": _enum_value(check.kind),
        "recurrence_interval": check.recurrence_interval,
        "recurrence_unit": _enum_value(check.recurrence_unit),
    }
    if check.certificate_expires_on is not None:
        metadata["certificate_expires_on"] = check.certificate_expires_on.isoformat()
    if check.source_document_id is not None:
        metadata["source_document_id"] = str(check.source_document_id)
    return metadata


def _advance_date(
    value: date,
    *,
    interval: int,
    unit: ComplianceRecurrenceUnit,
) -> date:
    if unit == ComplianceRecurrenceUnit.days:
        return value + timedelta(days=interval)
    months = interval * (12 if unit == ComplianceRecurrenceUnit.years else 1)
    year = value.year + (value.month - 1 + months) // 12
    month = (value.month - 1 + months) % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _create_current_obligation(check: ComplianceCheck, session: Session) -> Obligation:
    obligation = Obligation(
        entity_id=check.entity_id,
        property_id=check.property_id,
        tenancy_unit_id=check.tenancy_unit_id,
        lease_id=check.lease_id,
        title=check.title,
        category=ObligationCategory.compliance,
        status=_obligation_status(check.next_due_date),
        due_date=check.next_due_date,
        priority=1,
        owner_role=check.owner_role,
        notes=check.notes,
        obligation_metadata=_obligation_metadata(check),
    )
    session.add(obligation)
    session.flush()
    check.current_obligation_id = obligation.id
    return obligation


def _check_for_user(
    check_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> ComplianceCheck:
    check = session.get(ComplianceCheck, check_id)
    if check is None or check.deleted_at is not None:
        raise _not_found("Compliance check")
    assert_entity_role(session, user, check.entity_id, roles)
    return check


def _completion_signature(payload: ComplianceCheckComplete, completed_at: datetime) -> str:
    document_id = str(payload.source_document_id) if payload.source_document_id else ""
    return f"{document_id}:{completed_at.isoformat()}"


def _list(value: object) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _link_evidence(
    obligation: Obligation,
    *,
    document_id: UUID | None,
    completed_at: datetime,
    user: CurrentUser,
) -> None:
    if document_id is None:
        return
    metadata = dict(obligation.obligation_metadata or {})
    evidence_ids = [str(item) for item in _list(metadata.get("evidence_document_ids"))]
    document_id_str = str(document_id)
    if document_id_str not in evidence_ids:
        evidence_ids.append(document_id_str)
    evidence_history = _list(metadata.get("evidence_history"))
    evidence_history.append(
        {
            "document_id": document_id_str,
            "source": "compliance_check_complete",
            "actor": user.actor,
            "linked_at": completed_at.isoformat(),
        }
    )
    metadata["evidence_document_ids"] = evidence_ids
    metadata["evidence_history"] = evidence_history
    obligation.obligation_metadata = metadata


def _append_completion_history(
    check: ComplianceCheck,
    *,
    completed_at: datetime,
    completed_obligation_id: UUID | None,
    next_due_date: date,
    payload: ComplianceCheckComplete,
    user: CurrentUser,
    signature: str,
) -> None:
    metadata = dict(check.check_metadata or {})
    history = _list(metadata.get("completion_history"))
    entry = {
        **payload.metadata,
        "completed_at": completed_at.isoformat(),
        "completed_obligation_id": str(completed_obligation_id)
        if completed_obligation_id
        else None,
        "next_due_date": next_due_date.isoformat(),
        "source_document_id": str(payload.source_document_id)
        if payload.source_document_id
        else None,
        "actor": user.actor,
    }
    history.append(entry)
    metadata["completion_history"] = history
    metadata["last_completion_signature"] = signature
    check.check_metadata = metadata


@router.get("", response_model=list[ComplianceCheckRead])
def list_compliance_checks(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    include_deleted: bool = False,
) -> list[ComplianceCheck]:
    _entity_for_access(entity_id, user, session, READ_ROLES)
    statement = select(ComplianceCheck).where(ComplianceCheck.entity_id == entity_id)
    if not include_deleted:
        statement = statement.where(ComplianceCheck.deleted_at.is_(None))
    return list(
        session.scalars(
            statement.order_by(ComplianceCheck.next_due_date, ComplianceCheck.created_at)
        )
    )


@router.post("", response_model=ComplianceCheckRead, status_code=status.HTTP_201_CREATED)
def create_compliance_check(
    payload: ComplianceCheckCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceCheck:
    entity = _entity_for_access(payload.entity_id, user, session, WRITE_ROLES)
    property_id, tenancy_unit_id, lease_id, tenant_id = _validate_scope(
        entity_id=payload.entity_id,
        property_id=payload.property_id,
        tenancy_unit_id=payload.tenancy_unit_id,
        lease_id=payload.lease_id,
        tenant_id=payload.tenant_id,
        user=user,
        session=session,
        roles=WRITE_ROLES,
    )
    data = payload.model_dump()
    data["property_id"] = property_id
    data["tenancy_unit_id"] = tenancy_unit_id
    data["lease_id"] = lease_id
    data["tenant_id"] = tenant_id
    data["assigned_user_id"] = _validate_assigned_user(
        data["assigned_user_id"], entity=entity, session=session
    )
    data["source_document_id"] = _validate_document(
        data["source_document_id"], entity_id=payload.entity_id, session=session
    )
    data["current_obligation_id"] = _validate_current_obligation(
        data["current_obligation_id"], entity_id=payload.entity_id, session=session
    )
    data["check_metadata"] = data.pop("metadata")
    check = ComplianceCheck(**data)
    session.add(check)
    session.flush()
    if check.current_obligation_id is None and check.status == ComplianceCheckStatus.active:
        _create_current_obligation(check, session)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=check.entity_id,
        action="create",
        target_table="compliance_check",
        target_id=check.id,
        tool_output_summary=f"Created compliance check {check.title}.",
    )
    session.commit()
    session.refresh(check)
    return check


@router.get("/{check_id}", response_model=ComplianceCheckRead)
def get_compliance_check(
    check_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceCheck:
    return _check_for_user(check_id, user, session, READ_ROLES)


@router.patch("/{check_id}", response_model=ComplianceCheckRead)
def update_compliance_check(
    check_id: UUID,
    payload: ComplianceCheckUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceCheck:
    check = _check_for_user(check_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    if {
        "property_id",
        "tenancy_unit_id",
        "lease_id",
        "tenant_id",
    } & data.keys():
        property_id, tenancy_unit_id, lease_id, tenant_id = _validate_scope(
            entity_id=check.entity_id,
            property_id=data.get("property_id", check.property_id),
            tenancy_unit_id=data.get("tenancy_unit_id", check.tenancy_unit_id),
            lease_id=data.get("lease_id", check.lease_id),
            tenant_id=data.get("tenant_id", check.tenant_id),
            user=user,
            session=session,
            roles=WRITE_ROLES,
        )
        data["property_id"] = property_id
        data["tenancy_unit_id"] = tenancy_unit_id
        data["lease_id"] = lease_id
        data["tenant_id"] = tenant_id
    entity = session.get(Entity, check.entity_id)
    assert entity is not None
    if "assigned_user_id" in data:
        data["assigned_user_id"] = _validate_assigned_user(
            data["assigned_user_id"], entity=entity, session=session
        )
    if "source_document_id" in data:
        data["source_document_id"] = _validate_document(
            data["source_document_id"], entity_id=check.entity_id, session=session
        )
    if "current_obligation_id" in data:
        data["current_obligation_id"] = _validate_current_obligation(
            data["current_obligation_id"], entity_id=check.entity_id, session=session
        )
    if "metadata" in data:
        data["check_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(check, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=check.entity_id,
        action="update",
        target_table="compliance_check",
        target_id=check.id,
        tool_output_summary=f"Updated compliance check {check.title}.",
    )
    session.commit()
    session.refresh(check)
    return check


@router.post("/{check_id}/complete", response_model=ComplianceCheckRead)
def complete_compliance_check(
    check_id: UUID,
    payload: ComplianceCheckComplete,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceCheck:
    check = _check_for_user(check_id, user, session, WRITE_ROLES)
    completed_at = payload.completed_at or utcnow()
    signature = _completion_signature(payload, completed_at)
    if _dict(check.check_metadata).get("last_completion_signature") == signature:
        return check
    if payload.source_document_id is not None:
        _validate_document(payload.source_document_id, entity_id=check.entity_id, session=session)
    completed_obligation_id = check.current_obligation_id
    completed_obligation = (
        session.get(Obligation, completed_obligation_id)
        if completed_obligation_id is not None
        else None
    )
    if completed_obligation is not None and completed_obligation.deleted_at is None:
        completed_obligation.status = ObligationStatus.completed
        completed_obligation.completed_at = completed_at
        _link_evidence(
            completed_obligation,
            document_id=payload.source_document_id,
            completed_at=completed_at,
            user=user,
        )
    next_due_date = (
        payload.next_due_date
        or payload.certificate_expires_on
        or _advance_date(
            check.next_due_date,
            interval=check.recurrence_interval,
            unit=check.recurrence_unit,
        )
    )
    check.last_checked_at = completed_at
    check.next_due_date = next_due_date
    if payload.source_document_id is not None:
        check.source_document_id = payload.source_document_id
    if payload.certificate_expires_on is not None:
        check.certificate_expires_on = payload.certificate_expires_on
    _append_completion_history(
        check,
        completed_at=completed_at,
        completed_obligation_id=completed_obligation_id,
        next_due_date=next_due_date,
        payload=payload,
        user=user,
        signature=signature,
    )
    _create_current_obligation(check, session)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=check.entity_id,
        action="complete",
        target_table="compliance_check",
        target_id=check.id,
        tool_output_summary=f"Completed compliance check {check.title}.",
    )
    session.commit()
    session.refresh(check)
    return check


@router.delete("/{check_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_compliance_check(
    check_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    check = _check_for_user(check_id, user, session, WRITE_ROLES)
    check.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=check.entity_id,
        action="delete",
        target_table="compliance_check",
        target_id=check.id,
        tool_output_summary=f"Removed compliance check {check.title}.",
    )
    session.commit()
