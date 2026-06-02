"""Tenant CRUD routes with entity-scoped access checks."""

from datetime import date, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    DocumentIntake,
    Lease,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    TenantPortalAccount,
    TenantPortalAccountStatus,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register import (
    TenantActivityItemRead,
    TenantContactChangeRequestAction,
    TenantCreate,
    TenantDetailRead,
    TenantLeaseContextRead,
    TenantPortalAccountAction,
    TenantPortalAccountRead,
    TenantRead,
    TenantReviewedChangeRead,
    TenantReviewedFieldChangeRead,
    TenantUpdate,
)

router = APIRouter(prefix="/tenants", tags=["tenants"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

TENANT_PROFILE_FIELDS: tuple[tuple[str, str], ...] = (
    ("legal_name", "Legal name"),
    ("trading_name", "Trading as"),
    ("abn", "ABN"),
    ("contact_name", "Primary contact"),
    ("contact_email", "Contact email"),
    ("contact_phone", "Phone"),
    ("billing_email", "Billing email"),
    ("notes", "Notes"),
)
TENANT_METADATA_FIELDS: tuple[tuple[str, str], ...] = (
    ("insurance_confirmed", "Insurance confirmed"),
    ("insurance_expiry_date", "Insurance expiry"),
    ("emergency_contact_name", "Emergency contact"),
    ("emergency_contact_phone", "Emergency phone"),
)
PORTAL_CONTACT_REQUESTS_KEY = "portal_contact_change_requests"


def _property_address(prop: Property) -> str | None:
    parts = [prop.street_address, prop.suburb, prop.state, prop.postcode]
    address = ", ".join(part for part in parts if part)
    return address or None


def _json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if value == "":
        return None
    return value


def tenant_submission_changes(
    tenant: Tenant,
    submitted_data: dict[str, Any],
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for field, label in TENANT_PROFILE_FIELDS:
        before = _json_value(getattr(tenant, field))
        after = _json_value(submitted_data.get(field))
        if field == "billing_email":
            after = _json_value(
                submitted_data.get("billing_email") or submitted_data.get("contact_email")
            )
        if before != after:
            changes.append({"field": field, "label": label, "before": before, "after": after})

    metadata = tenant.tenant_metadata or {}
    for field, label in TENANT_METADATA_FIELDS:
        before = _json_value(metadata.get(field))
        after = _json_value(submitted_data.get(field))
        if field == "insurance_confirmed":
            before = bool(before)
            after = bool(after)
        if before != after:
            changes.append({"field": field, "label": label, "before": before, "after": after})
    return changes


def _change_rows(changes: Any) -> list[TenantReviewedFieldChangeRead]:
    if not isinstance(changes, list):
        return []
    rows: list[TenantReviewedFieldChangeRead] = []
    for change in changes:
        if not isinstance(change, dict):
            continue
        field = change.get("field")
        if not isinstance(field, str) or not field:
            continue
        label = change.get("label")
        rows.append(
            TenantReviewedFieldChangeRead(
                field=field,
                label=label if isinstance(label, str) and label else field.replace("_", " "),
                before=change.get("before"),
                after=change.get("after"),
            )
        )
    return rows


def append_tenant_reviewed_change_history(
    tenant: Tenant,
    onboarding: TenantOnboarding,
    changes: list[dict[str, Any]],
) -> None:
    if not changes:
        return
    metadata = dict(tenant.tenant_metadata or {})
    history = metadata.get("reviewed_change_history")
    if not isinstance(history, list):
        history = []
    history.append(
        {
            "source": "tenant_onboarding",
            "tenant_onboarding_id": str(onboarding.id),
            "status": str(onboarding.status),
            "reviewed_at": onboarding.reviewed_at.isoformat() if onboarding.reviewed_at else None,
            "applied_at": onboarding.applied_at.isoformat() if onboarding.applied_at else None,
            "notes": (
                onboarding.review_data.get("notes")
                if isinstance(onboarding.review_data, dict)
                else None
            ),
            "changes": changes,
        }
    )
    metadata["reviewed_change_history"] = history[-20:]
    tenant.tenant_metadata = metadata


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_uuid(value: Any) -> UUID | None:
    if isinstance(value, UUID):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def _account_recovery_receipt(account: TenantPortalAccount) -> dict[str, Any]:
    receipt = (account.account_metadata or {}).get("last_recovery_receipt")
    return receipt if isinstance(receipt, dict) else {}


def _record_account_recovery(
    account: TenantPortalAccount,
    *,
    action: str,
    at: datetime,
    user: CurrentUser,
    reason: str | None,
) -> None:
    metadata = dict(account.account_metadata or {})
    receipt: dict[str, Any] = {
        "action": action,
        "at": at.isoformat(),
        "by_user_id": str(user.id),
    }
    if reason:
        receipt["reason"] = reason
    receipts = metadata.get("recovery_receipts")
    if not isinstance(receipts, list):
        receipts = []
    receipts.append(receipt)
    metadata["recovery_receipts"] = receipts[-10:]
    metadata["last_recovery_receipt"] = receipt
    account.account_metadata = metadata


def _activity(
    occurred_at: datetime | None,
    *,
    kind: str,
    label: str,
    source: str,
    detail: str | None = None,
    related_id: UUID | None = None,
    tone: str = "neutral",
) -> TenantActivityItemRead | None:
    if occurred_at is None:
        return None
    return TenantActivityItemRead(
        occurred_at=occurred_at,
        kind=kind,
        label=label,
        detail=detail,
        source=source,
        related_id=related_id,
        tone=tone,
    )


@router.get("", response_model=list[TenantRead])
def list_tenants(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    include_deleted: bool = False,
) -> list[Tenant]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = select(Tenant).where(Tenant.entity_id == entity_id)
    if not include_deleted:
        statement = statement.where(Tenant.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(Tenant.legal_name)))


@router.post("", response_model=TenantRead, status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Tenant:
    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    data = payload.model_dump()
    data["tenant_metadata"] = data.pop("metadata")
    tenant = Tenant(**data)
    session.add(tenant)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="create",
        target_table="tenant",
        target_id=tenant.id,
    )
    session.commit()
    session.refresh(tenant)
    return tenant


def _get_tenant_for_user(
    tenant_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Tenant:
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    assert_entity_role(session, user, tenant.entity_id, roles)
    return tenant


def _account_status(account: TenantPortalAccount) -> str:
    if account.deleted_at is not None:
        return "unlinked"
    return account.status.value


def _tenant_portal_account_read(account: TenantPortalAccount) -> TenantPortalAccountRead:
    receipt = _account_recovery_receipt(account)
    action = receipt.get("action")
    reason = receipt.get("reason")
    return TenantPortalAccountRead(
        id=account.id,
        tenant_id=account.tenant_id,
        tenant_onboarding_id=account.tenant_onboarding_id,
        auth_provider=account.auth_provider,
        auth_provider_id=account.auth_provider_id,
        email=account.email,
        status=_account_status(account),
        linked_at=account.linked_at,
        created_at=account.created_at,
        updated_at=account.updated_at,
        last_seen_at=account.last_seen_at,
        revoked_at=account.revoked_at,
        deleted_at=account.deleted_at,
        recovery_action=action if isinstance(action, str) else None,
        recovery_reason=reason if isinstance(reason, str) else None,
        recovery_at=_parse_datetime(receipt.get("at")),
    )


def _tenant_portal_preferred_email(tenant: Tenant) -> str | None:
    return tenant.billing_email or tenant.contact_email


def _tenant_portal_account_for_user(
    tenant: Tenant,
    account_id: UUID,
    session: Session,
) -> TenantPortalAccount:
    account = session.get(TenantPortalAccount, account_id)
    if account is None or account.tenant_id != tenant.id or account.entity_id != tenant.entity_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant portal account not found.",
        )
    return account


@router.get("/{tenant_id}", response_model=TenantRead)
def get_tenant(
    tenant_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Tenant:
    return _get_tenant_for_user(tenant_id, user, session, READ_ROLES)


@router.get("/{tenant_id}/portal-accounts", response_model=list[TenantPortalAccountRead])
def list_tenant_portal_accounts(
    tenant_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> list[TenantPortalAccountRead]:
    tenant = _get_tenant_for_user(tenant_id, user, session, READ_ROLES)
    accounts = session.scalars(
        select(TenantPortalAccount)
        .where(
            TenantPortalAccount.tenant_id == tenant.id,
            TenantPortalAccount.entity_id == tenant.entity_id,
        )
        .order_by(TenantPortalAccount.updated_at.desc())
    ).all()
    return [_tenant_portal_account_read(account) for account in accounts]


@router.post(
    "/{tenant_id}/portal-accounts/{account_id}/revoke",
    response_model=TenantPortalAccountRead,
)
def revoke_tenant_portal_account(
    tenant_id: UUID,
    account_id: UUID,
    payload: TenantPortalAccountAction,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantPortalAccountRead:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    account = _tenant_portal_account_for_user(tenant, account_id, session)
    now = utcnow()
    if account.deleted_at is None:
        account.status = TenantPortalAccountStatus.revoked
        account.revoked_at = account.revoked_at or now
    metadata = dict(account.account_metadata or {})
    if payload.reason:
        metadata["revoked_reason"] = payload.reason
    metadata["revoked_at"] = (account.revoked_at or now).isoformat()
    metadata["revoked_by_user_id"] = str(user.id)
    account.account_metadata = metadata
    _record_account_recovery(
        account,
        action="revoked",
        at=account.revoked_at or now,
        user=user,
        reason=payload.reason,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="revoke",
        target_table="tenant_portal_account",
        target_id=account.id,
        tool_name="tenant.portal_account_revoke",
        tool_input={
            "tenant_id": str(tenant.id),
            "reason": payload.reason,
        },
        tool_output_summary="Tenant portal account revoked by operator.",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(account)
    return _tenant_portal_account_read(account)


@router.post(
    "/{tenant_id}/portal-accounts/{account_id}/restore",
    response_model=TenantPortalAccountRead,
)
def restore_tenant_portal_account(
    tenant_id: UUID,
    account_id: UUID,
    payload: TenantPortalAccountAction,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantPortalAccountRead:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    account = _tenant_portal_account_for_user(tenant, account_id, session)
    if account.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unlinked tenant portal accounts must be relinked from a fresh portal link.",
        )
    conflicting = session.scalar(
        select(TenantPortalAccount).where(
            TenantPortalAccount.id != account.id,
            TenantPortalAccount.auth_provider == account.auth_provider,
            TenantPortalAccount.auth_provider_id == account.auth_provider_id,
            TenantPortalAccount.status == TenantPortalAccountStatus.active,
            TenantPortalAccount.revoked_at.is_(None),
            TenantPortalAccount.deleted_at.is_(None),
        )
    )
    if conflicting is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another active tenant portal account already uses this login.",
        )
    now = utcnow()
    account.status = TenantPortalAccountStatus.active
    account.revoked_at = None
    _record_account_recovery(
        account,
        action="restored",
        at=now,
        user=user,
        reason=payload.reason,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="restore",
        target_table="tenant_portal_account",
        target_id=account.id,
        tool_name="tenant.portal_account_restore",
        tool_input={
            "tenant_id": str(tenant.id),
            "reason": payload.reason,
        },
        tool_output_summary="Tenant portal account restored by operator.",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(account)
    return _tenant_portal_account_read(account)


@router.post(
    "/{tenant_id}/portal-accounts/{account_id}/unlink",
    response_model=TenantPortalAccountRead,
)
def unlink_tenant_portal_account(
    tenant_id: UUID,
    account_id: UUID,
    payload: TenantPortalAccountAction,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantPortalAccountRead:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    account = _tenant_portal_account_for_user(tenant, account_id, session)
    now = utcnow()
    account.deleted_at = account.deleted_at or now
    metadata = dict(account.account_metadata or {})
    if payload.reason:
        metadata["unlinked_reason"] = payload.reason
    metadata["unlinked_at"] = account.deleted_at.isoformat()
    metadata["unlinked_by_user_id"] = str(user.id)
    account.account_metadata = metadata
    _record_account_recovery(
        account,
        action="unlinked",
        at=account.deleted_at,
        user=user,
        reason=payload.reason,
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="unlink",
        target_table="tenant_portal_account",
        target_id=account.id,
        tool_name="tenant.portal_account_unlink",
        tool_input={
            "tenant_id": str(tenant.id),
            "reason": payload.reason,
        },
        tool_output_summary="Tenant portal account unlinked by operator.",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(account)
    return _tenant_portal_account_read(account)


def _tenant_lease_contexts(session: Session, tenant: Tenant) -> list[TenantLeaseContextRead]:
    leases = session.scalars(
        select(Lease)
        .where(Lease.tenant_id == tenant.id, Lease.deleted_at.is_(None))
        .order_by(Lease.expiry_date, Lease.created_at)
    ).all()
    contexts: list[TenantLeaseContextRead] = []
    for lease in leases:
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        if unit is None or unit.deleted_at is not None:
            continue
        prop = session.get(Property, unit.property_id)
        if prop is None or prop.deleted_at is not None or prop.entity_id != tenant.entity_id:
            continue
        contexts.append(
            TenantLeaseContextRead(
                lease_id=lease.id,
                status=lease.status,
                property_id=prop.id,
                property_name=prop.name,
                property_address=_property_address(prop),
                property_type=prop.property_type,
                tenancy_unit_id=unit.id,
                unit_label=unit.unit_label,
                commencement_date=lease.commencement_date,
                expiry_date=lease.expiry_date,
                annual_rent_cents=lease.annual_rent_cents,
                rent_frequency=lease.rent_frequency,
                outgoings_recoverable=lease.outgoings_recoverable,
                next_review_date=lease.next_review_date,
            )
        )
    return contexts


def _tenant_documents(session: Session, tenant: Tenant) -> list[StoredDocument]:
    return list(
        session.scalars(
            select(StoredDocument)
            .where(StoredDocument.tenant_id == tenant.id)
            .order_by(StoredDocument.created_at.desc())
        )
    )


def _tenant_onboardings(session: Session, tenant: Tenant) -> list[TenantOnboarding]:
    return list(
        session.scalars(
            select(TenantOnboarding)
            .where(
                TenantOnboarding.tenant_id == tenant.id,
                TenantOnboarding.deleted_at.is_(None),
            )
            .order_by(TenantOnboarding.created_at.desc())
        )
    )


def _tenant_document_intakes(
    session: Session,
    documents: list[StoredDocument],
) -> list[DocumentIntake]:
    document_ids = [document.id for document in documents]
    if not document_ids:
        return []
    return list(
        session.scalars(
            select(DocumentIntake)
            .where(
                DocumentIntake.document_id.in_(document_ids),
                DocumentIntake.deleted_at.is_(None),
            )
            .order_by(DocumentIntake.updated_at.desc())
        )
    )


def _tenant_activity(
    tenant: Tenant,
    leases: list[TenantLeaseContextRead],
    documents: list[StoredDocument],
    intakes: list[DocumentIntake],
    onboardings: list[TenantOnboarding],
) -> list[TenantActivityItemRead]:
    items: list[TenantActivityItemRead] = []
    tenant_created = _activity(
        tenant.created_at,
        kind="tenant",
        label="Tenant profile created",
        source="Tenant profile",
        related_id=tenant.id,
    )
    if tenant_created is not None:
        items.append(tenant_created)
    if tenant.updated_at > tenant.created_at:
        tenant_updated = _activity(
            tenant.updated_at,
            kind="tenant",
            label="Tenant profile updated",
            source="Tenant profile",
            related_id=tenant.id,
            tone="primary",
        )
        if tenant_updated is not None:
            items.append(tenant_updated)

    for lease in leases:
        lease_item = _activity(
            _parse_datetime(lease.commencement_date.isoformat())
            if lease.commencement_date
            else tenant.created_at,
            kind="lease",
            label=f"Lease {lease.status.value.replace('_', ' ')}",
            detail=f"{lease.property_name} - {lease.unit_label}",
            source="Lease register",
            related_id=lease.lease_id,
            tone="success" if lease.status.value == "active" else "neutral",
        )
        if lease_item is not None:
            items.append(lease_item)

    for onboarding in onboardings:
        onboarding_created = _activity(
            onboarding.last_sent_at or onboarding.created_at,
            kind="onboarding",
            label="Onboarding link sent",
            source="Tenant onboarding",
            related_id=onboarding.id,
            tone="primary",
        )
        if onboarding_created is not None:
            items.append(onboarding_created)
        onboarding_resent = _activity(
            onboarding.resent_at,
            kind="onboarding",
            label="Onboarding link resent",
            source="Tenant onboarding",
            related_id=onboarding.id,
            tone="primary",
        )
        if onboarding_resent is not None:
            items.append(onboarding_resent)
        onboarding_submitted = _activity(
            onboarding.submitted_at,
            kind="onboarding",
            label="Tenant submitted details",
            source="Tenant onboarding",
            related_id=onboarding.id,
            tone="warning",
        )
        if onboarding_submitted is not None:
            items.append(onboarding_submitted)
        onboarding_reviewed = _activity(
            onboarding.reviewed_at,
            kind="review",
            label="Submitted details reviewed",
            source="Tenant onboarding",
            related_id=onboarding.id,
            tone="primary",
        )
        if onboarding_reviewed is not None:
            items.append(onboarding_reviewed)
        onboarding_applied = _activity(
            onboarding.applied_at,
            kind="apply",
            label="Reviewed details applied",
            source="Tenant onboarding",
            related_id=onboarding.id,
            tone="success",
        )
        if onboarding_applied is not None:
            items.append(onboarding_applied)
        if onboarding.status == TenantOnboardingStatus.cancelled:
            onboarding_cancelled = _activity(
                onboarding.updated_at,
                kind="onboarding",
                label="Onboarding cancelled",
                detail=onboarding.cancel_reason,
                source="Tenant onboarding",
                related_id=onboarding.id,
            )
            if onboarding_cancelled is not None:
                items.append(onboarding_cancelled)

    document_names = {document.id: document.filename for document in documents}
    for document in documents:
        uploaded = _activity(
            document.created_at,
            kind="document",
            label="Document uploaded",
            detail=document.filename,
            source="Documents",
            related_id=document.id,
            tone="primary" if document.tenant_onboarding_id else "neutral",
        )
        if uploaded is not None:
            items.append(uploaded)
        deleted = _activity(
            document.deleted_at,
            kind="document",
            label="Document deleted",
            detail=document.filename,
            source="Documents",
            related_id=document.id,
        )
        if deleted is not None:
            items.append(deleted)

    for intake in intakes:
        filename = document_names.get(intake.document_id)
        if intake.reviewed_at is not None:
            reviewed = _activity(
                intake.reviewed_at,
                kind="review",
                label="Document reviewed",
                detail=filename,
                source="Smart Intake",
                related_id=intake.id,
                tone="primary",
            )
            if reviewed is not None:
                items.append(reviewed)
        if intake.applied_at is not None:
            applied = _activity(
                intake.applied_at,
                kind="apply",
                label="Document changes applied",
                detail=filename,
                source="Smart Intake",
                related_id=intake.id,
                tone="success",
            )
            if applied is not None:
                items.append(applied)
        if intake.status.value in {"failed", "needs_attention"}:
            attention = _activity(
                intake.updated_at,
                kind="review",
                label="Document needs attention",
                detail=filename,
                source="Smart Intake",
                related_id=intake.id,
                tone="warning" if intake.status.value == "needs_attention" else "danger",
            )
            if attention is not None:
                items.append(attention)

    return sorted(items, key=lambda item: item.occurred_at, reverse=True)[:24]


def _reviewed_change_history(
    tenant: Tenant,
    onboardings: list[TenantOnboarding],
) -> list[TenantReviewedChangeRead]:
    rows: list[TenantReviewedChangeRead] = []
    seen_onboardings: set[str] = set()
    history = (tenant.tenant_metadata or {}).get("reviewed_change_history")
    if isinstance(history, list):
        for entry in history:
            if not isinstance(entry, dict):
                continue
            source = entry.get("source")
            source_id = entry.get("tenant_onboarding_id")
            occurred_at = _parse_datetime(entry.get("applied_at")) or _parse_datetime(
                entry.get("reviewed_at")
            )
            if occurred_at is None:
                continue
            if isinstance(source_id, str):
                seen_onboardings.add(source_id)
            notes = entry.get("notes")
            rows.append(
                TenantReviewedChangeRead(
                    occurred_at=occurred_at,
                    source=str(source or "tenant_onboarding"),
                    source_label="Tenant onboarding",
                    source_id=_parse_uuid(source_id),
                    status=str(entry.get("status") or "applied"),
                    notes=notes if isinstance(notes, str) else None,
                    changes=_change_rows(entry.get("changes")),
                )
            )

    portal_requests = (tenant.tenant_metadata or {}).get(PORTAL_CONTACT_REQUESTS_KEY)
    if isinstance(portal_requests, list):
        for entry in portal_requests:
            if not isinstance(entry, dict):
                continue
            request_id = entry.get("id")
            occurred_at = (
                _parse_datetime(entry.get("applied_at"))
                or _parse_datetime(entry.get("submitted_at"))
                or _parse_datetime(entry.get("dismissed_at"))
            )
            if occurred_at is None:
                continue
            source_uuid: UUID | None = None
            if isinstance(request_id, str):
                source_uuid = _parse_uuid(request_id)
            notes = entry.get("notes")
            rows.append(
                TenantReviewedChangeRead(
                    occurred_at=occurred_at,
                    source="tenant_portal_contact_request",
                    source_label="Tenant portal request",
                    source_id=source_uuid,
                    status=str(entry.get("status") or "submitted"),
                    notes=notes if isinstance(notes, str) else None,
                    changes=_change_rows(entry.get("changes")),
                )
            )

    for onboarding in onboardings:
        if str(onboarding.id) in seen_onboardings or not isinstance(onboarding.review_data, dict):
            continue
        changes = _change_rows(onboarding.review_data.get("changes"))
        if not changes:
            continue
        occurred_at = onboarding.applied_at or onboarding.reviewed_at or onboarding.submitted_at
        if occurred_at is None:
            continue
        notes = onboarding.review_data.get("notes")
        rows.append(
            TenantReviewedChangeRead(
                occurred_at=occurred_at,
                source="tenant_onboarding",
                source_label="Tenant onboarding",
                source_id=onboarding.id,
                status=onboarding.status.value,
                notes=notes if isinstance(notes, str) else None,
                changes=changes,
            )
        )
    return sorted(rows, key=lambda row: row.occurred_at, reverse=True)[:12]


@router.get("/{tenant_id}/detail", response_model=TenantDetailRead)
def get_tenant_detail(
    tenant_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantDetailRead:
    tenant = _get_tenant_for_user(tenant_id, user, session, READ_ROLES)
    leases = _tenant_lease_contexts(session, tenant)
    documents = _tenant_documents(session, tenant)
    intakes = _tenant_document_intakes(session, documents)
    onboardings = _tenant_onboardings(session, tenant)
    return TenantDetailRead(
        tenant=TenantRead.model_validate(tenant),
        leases=leases,
        activity=_tenant_activity(tenant, leases, documents, intakes, onboardings),
        reviewed_changes=_reviewed_change_history(tenant, onboardings),
    )


@router.patch("/{tenant_id}", response_model=TenantRead)
def update_tenant(
    tenant_id: UUID,
    payload: TenantUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Tenant:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    if "metadata" in data:
        data["tenant_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(tenant, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="update",
        target_table="tenant",
        target_id=tenant.id,
    )
    session.commit()
    session.refresh(tenant)
    return tenant


@router.post(
    "/{tenant_id}/contact-change-requests/{request_id}/apply",
    response_model=TenantRead,
)
def apply_contact_change_request(
    tenant_id: UUID,
    request_id: UUID,
    payload: TenantContactChangeRequestAction,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Tenant:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    metadata = dict(tenant.tenant_metadata or {})
    portal_requests = metadata.get(PORTAL_CONTACT_REQUESTS_KEY)
    if not isinstance(portal_requests, list):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact change request not found.",
        )

    request_index = next(
        (
            index
            for index, entry in enumerate(portal_requests)
            if isinstance(entry, dict) and entry.get("id") == str(request_id)
        ),
        None,
    )
    if request_index is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact change request not found.",
        )
    entry = portal_requests[request_index]
    if not isinstance(entry, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact change request not found.",
        )
    if entry.get("status") != "submitted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only submitted contact change requests can be applied.",
        )

    changes = entry.get("changes")
    if not isinstance(changes, list) or not changes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Contact change request has no applicable fields.",
        )

    allowed_fields = {"contact_name", "contact_email", "contact_phone", "billing_email"}
    applied_fields: list[str] = []
    for change in changes:
        if not isinstance(change, dict):
            continue
        field = change.get("field")
        if not isinstance(field, str) or field not in allowed_fields:
            continue
        setattr(tenant, field, change.get("after"))
        applied_fields.append(field)
    if not applied_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Contact change request has no applicable fields.",
        )
    if {"contact_email", "billing_email"} & set(applied_fields):
        preferred_email = _tenant_portal_preferred_email(tenant)
        linked_accounts = session.scalars(
            select(TenantPortalAccount).where(
                TenantPortalAccount.tenant_id == tenant.id,
                TenantPortalAccount.entity_id == tenant.entity_id,
                TenantPortalAccount.status == TenantPortalAccountStatus.active,
                TenantPortalAccount.revoked_at.is_(None),
                TenantPortalAccount.deleted_at.is_(None),
            )
        )
        for account in linked_accounts:
            account.email = preferred_email

    now = utcnow()
    entry = {
        **entry,
        "status": "applied",
        "applied_at": now.isoformat(),
        "applied_by_user_id": str(user.id),
        "apply_notes": payload.notes,
    }
    portal_requests[request_index] = entry
    metadata[PORTAL_CONTACT_REQUESTS_KEY] = portal_requests
    tenant.tenant_metadata = metadata
    flag_modified(tenant, "tenant_metadata")
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="apply_contact_change_request",
        target_table="tenant",
        target_id=tenant.id,
        tool_name="tenants.contact_change_request_apply",
        tool_input={"request_id": str(request_id), "fields": applied_fields},
        tool_output_summary="Applied tenant portal contact-change request.",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(tenant)
    return tenant


@router.post(
    "/{tenant_id}/contact-change-requests/{request_id}/dismiss",
    response_model=TenantRead,
)
def dismiss_contact_change_request(
    tenant_id: UUID,
    request_id: UUID,
    payload: TenantContactChangeRequestAction,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Tenant:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    metadata = dict(tenant.tenant_metadata or {})
    portal_requests = metadata.get(PORTAL_CONTACT_REQUESTS_KEY)
    if not isinstance(portal_requests, list):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact change request not found.",
        )

    request_index = next(
        (
            index
            for index, entry in enumerate(portal_requests)
            if isinstance(entry, dict) and entry.get("id") == str(request_id)
        ),
        None,
    )
    if request_index is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact change request not found.",
        )
    entry = portal_requests[request_index]
    if not isinstance(entry, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact change request not found.",
        )
    if entry.get("status") != "submitted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only submitted contact change requests can be dismissed.",
        )

    now = utcnow()
    entry = {
        **entry,
        "status": "dismissed",
        "dismissed_at": now.isoformat(),
        "dismissed_by_user_id": str(user.id),
        "dismiss_notes": payload.notes,
    }
    portal_requests[request_index] = entry
    metadata[PORTAL_CONTACT_REQUESTS_KEY] = portal_requests
    tenant.tenant_metadata = metadata
    flag_modified(tenant, "tenant_metadata")
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="dismiss_contact_change_request",
        target_table="tenant",
        target_id=tenant.id,
        tool_name="tenants.contact_change_request_dismiss",
        tool_input={"request_id": str(request_id)},
        tool_output_summary="Dismissed tenant portal contact-change request.",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(tenant)
    return tenant


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(
    tenant_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    tenant = _get_tenant_for_user(tenant_id, user, session, WRITE_ROLES)
    now = utcnow()
    tenant.deleted_at = now
    portal_accounts = session.scalars(
        select(TenantPortalAccount).where(
            TenantPortalAccount.tenant_id == tenant.id,
            TenantPortalAccount.entity_id == tenant.entity_id,
            TenantPortalAccount.deleted_at.is_(None),
        )
    ).all()
    for account in portal_accounts:
        account.deleted_at = now
        metadata = dict(account.account_metadata or {})
        metadata["unlinked_at"] = now.isoformat()
        metadata["unlinked_by_user_id"] = str(user.id)
        metadata["unlinked_reason"] = "Tenant profile was deleted."
        account.account_metadata = metadata
        _record_account_recovery(
            account,
            action="unlinked",
            at=now,
            user=user,
            reason="Tenant profile was deleted.",
        )
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=tenant.entity_id,
            action="unlink",
            target_table="tenant_portal_account",
            target_id=account.id,
            tool_name="tenant.delete",
            tool_input={"tenant_id": str(tenant.id)},
            tool_output_summary="Tenant portal account unlinked because tenant was deleted.",
            data_classification="confidential",
        )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=tenant.entity_id,
        action="delete",
        target_table="tenant",
        target_id=tenant.id,
    )
    session.commit()
