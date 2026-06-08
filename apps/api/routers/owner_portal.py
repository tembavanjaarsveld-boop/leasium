"""Read-only owner portal preview routes."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from stewart.core.auth import (
    ClerkIdentity,
    _clerk_identity,
    _normalise_email,
    _verified_emails_from_clerk_user,
)
from stewart.core.db import utcnow
from stewart.core.models import (
    ComplianceCheck,
    ComplianceCheckStatus,
    DocumentCategory,
    Entity,
    Lease,
    LeaseStatus,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    OperatingMode,
    Organisation,
    Owner,
    OwnerPortalAccount,
    OwnerPortalAccountStatus,
    OwnerPortalInvite,
    Property,
    PropertyOwner,
    StoredDocument,
    TenancyUnit,
    UserRole,
)
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.owners import _build_owner_statements
from apps.api.schemas.owner_portal import (
    OwnerPortalAccountClaimCreate,
    OwnerPortalAccountLifecycleRead,
    OwnerPortalAuthRead,
    OwnerPortalComplianceItemRead,
    OwnerPortalComplianceRead,
    OwnerPortalDocumentRead,
    OwnerPortalInvitePreviewRead,
    OwnerPortalInviteRead,
    OwnerPortalLeaseEventRead,
    OwnerPortalLeaseEventsRead,
    OwnerPortalMaintenanceItemRead,
    OwnerPortalMaintenanceRead,
    OwnerPortalOwnerRead,
    OwnerPortalPropertyRead,
    OwnerPortalRead,
    OwnerPortalStatementPropertyRead,
    OwnerPortalStatementRead,
)
from apps.api.schemas.owners import OwnerStatementRead

router = APIRouter(prefix="/owner-portal", tags=["owner-portal"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}

OWNER_PORTAL_GUARDRAILS = [
    (
        "Read-only owner portal: opening this page does not send owner email, "
        "dispatch invoices, write Xero data, reconcile payments, refresh "
        "providers, or mutate provider history."
    ),
    (
        "Shared document downloads are account-scoped and limited to files "
        "explicitly shared by the property team for this owner; no owner "
        "statement PDFs are generated or sent from the portal."
    ),
]

OWNER_PORTAL_INVITE_GUARDRAILS = [
    (
        "Owner portal invite created locally only: no owner email is sent, "
        "no PDF is generated or dispatched, no Xero data is written, and no "
        "provider history is mutated."
    )
]
OWNER_PORTAL_INVITE_TTL_DAYS = 30
OWNER_PORTAL_DOCUMENT_VISIBLE_KEY = "owner_portal_visible"
OWNER_PORTAL_MAINTENANCE_VISIBLE_KEY = "owner_portal_visible"
OWNER_PORTAL_MAINTENANCE_TITLE_KEY = "owner_portal_title"
OWNER_PORTAL_COMPLIANCE_VISIBLE_KEY = "owner_portal_visible"
OWNER_PORTAL_COMPLIANCE_TITLE_KEY = "owner_portal_title"
OWNER_PORTAL_COMPLIANCE_DUE_SOON_DAYS = 30
OWNER_PORTAL_LEASE_EVENT_WINDOW_DAYS = 180
OWNER_PORTAL_OPEN_MAINTENANCE_STATUSES = {
    MaintenanceWorkOrderStatus.requested,
    MaintenanceWorkOrderStatus.triaged,
    MaintenanceWorkOrderStatus.assigned,
    MaintenanceWorkOrderStatus.awaiting_approval,
    MaintenanceWorkOrderStatus.approved,
    MaintenanceWorkOrderStatus.in_progress,
}
OWNER_PORTAL_LEASE_EVENT_STATUSES = {
    LeaseStatus.pending,
    LeaseStatus.active,
    LeaseStatus.holding_over,
}
OWNER_PORTAL_OPEN_COMPLIANCE_STATUSES = {ComplianceCheckStatus.active}


def _current_statement_month() -> str:
    return utcnow().strftime("%Y-%m")


def _owner_portal_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_owner_portal_token() -> str:
    return secrets.token_urlsafe(32)


def _metadata_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _metadata_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _owner_portal_maintenance_title(metadata: dict[str, object]) -> str:
    return (
        _metadata_text(metadata.get(OWNER_PORTAL_MAINTENANCE_TITLE_KEY))
        or "Maintenance item"
    )


def _owner_portal_compliance_title(
    metadata: dict[str, object],
    fallback: str,
) -> str:
    return _metadata_text(metadata.get(OWNER_PORTAL_COMPLIANCE_TITLE_KEY)) or fallback


def _owner_portal_compliance_due_status(
    next_due_date: date,
    today: date,
) -> str:
    if next_due_date < today:
        return "overdue"
    if next_due_date <= today + timedelta(days=OWNER_PORTAL_COMPLIANCE_DUE_SOON_DAYS):
        return "due_soon"
    return "upcoming"


def _owner_portal_compliance_evidence_status(
    obligation_metadata: dict[str, object] | None,
) -> str:
    metadata = obligation_metadata or {}
    evidence_ids = metadata.get("evidence_document_ids")
    if isinstance(evidence_ids, list) and any(str(item).strip() for item in evidence_ids):
        return "linked"
    return "missing"


def _assert_owner_portal_operating_mode(session: Session, entity_id: UUID) -> None:
    operating_mode = session.scalar(
        select(Organisation.operating_mode)
        .join(Entity, Entity.organisation_id == Organisation.id)
        .where(Entity.id == entity_id)
    )
    if (operating_mode or OperatingMode.self_managed_owner.value) not in {
        OperatingMode.managing_agent.value,
        OperatingMode.hybrid.value,
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Owner portal access is available only for managing-agent "
                "or hybrid accounts."
            ),
        )


def _is_expired(expires_at: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= utcnow()


def _claim_email(owner: Owner) -> str:
    email = owner.billing_email.strip() if owner.billing_email else ""
    if not email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Owner billing email is required before creating a portal invite.",
        )
    return email


def _owner_portal_identity(
    authorization: str | None,
    settings: Settings,
) -> ClerkIdentity:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Owner portal account bearer token required.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Owner portal account bearer token required.",
        )
    return _clerk_identity(token, settings)


def _assert_claim_email_matches_invite(
    identity: ClerkIdentity,
    claim_email: str,
    settings: Settings,
) -> None:
    expected = _normalise_email(claim_email)
    if identity.verified_email and _normalise_email(identity.verified_email) == expected:
        return

    verified_emails = _verified_emails_from_clerk_user(identity.provider_id, settings)
    if expected in verified_emails:
        return

    if identity.verified_email is None and not verified_emails:
        if settings.clerk_allow_legacy_token_mapping:
            return
        if not settings.clerk_secret_key.strip():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Owner account email verification is not fully configured. "
                    "Ask the property team to check owner sign-up settings."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner portal login email must match this invite.",
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Owner portal login email must match this invite.",
    )


def _invite_for_token(token: str, session: Session) -> OwnerPortalInvite:
    invite = session.scalar(
        select(OwnerPortalInvite).where(
            OwnerPortalInvite.token_hash == _owner_portal_token_hash(token),
            OwnerPortalInvite.deleted_at.is_(None),
        )
    )
    if (
        invite is None
        or invite.revoked_at is not None
        or _is_expired(invite.expires_at)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner portal invite not found.",
        )
    return invite


def _owner_for_invite(invite: OwnerPortalInvite, session: Session) -> Owner:
    owner = session.get(Owner, invite.owner_id)
    if (
        owner is None
        or owner.deleted_at is not None
        or owner.entity_id != invite.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner portal invite not found.",
        )
    return owner


_OWNER_PORTAL_LOGIN_ALREADY_LINKED_DETAIL = (
    "This owner portal login is already linked to another owner. Ask the "
    "property team for a separate login before claiming this link."
)


def _owner_portal_login_already_linked_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=_OWNER_PORTAL_LOGIN_ALREADY_LINKED_DETAIL,
    )


def _is_active_provider_integrity_error(error: IntegrityError) -> bool:
    message = str(error.orig).lower()
    return (
        "owner_portal_account_auth_provider_active_idx" in message
        or (
            "owner_portal_account.auth_provider" in message
            and "owner_portal_account.auth_provider_id" in message
        )
        or (
            "owner_portal_account" in message
            and "auth_provider" in message
            and "auth_provider_id" in message
        )
    )


def _active_owner_portal_accounts(
    provider_id: str,
    session: Session,
) -> list[OwnerPortalAccount]:
    return list(
        session.scalars(
            select(OwnerPortalAccount)
            .where(
                OwnerPortalAccount.auth_provider == "clerk",
                OwnerPortalAccount.auth_provider_id == provider_id,
                OwnerPortalAccount.status == OwnerPortalAccountStatus.active,
                OwnerPortalAccount.revoked_at.is_(None),
                OwnerPortalAccount.deleted_at.is_(None),
            )
            .order_by(OwnerPortalAccount.updated_at.desc())
        ).all()
    )


def _assert_owner_portal_accounts_unambiguous(
    accounts: list[OwnerPortalAccount],
) -> None:
    if len({account.owner_id for account in accounts}) > 1:
        raise _owner_portal_login_already_linked_error()


def _active_owner_portal_account(
    provider_id: str,
    session: Session,
) -> OwnerPortalAccount:
    accounts = _active_owner_portal_accounts(provider_id, session)
    if not accounts:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Owner portal account not found.",
        )
    _assert_owner_portal_accounts_unambiguous(accounts)
    return accounts[0]


def _owner_for_account(account: OwnerPortalAccount, session: Session) -> Owner:
    owner = session.get(Owner, account.owner_id)
    if (
        owner is None
        or owner.deleted_at is not None
        or owner.entity_id != account.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner portal account not found.",
        )
    return owner


def _owner_display_name(owner: Owner) -> str:
    if owner.trust_name and owner.trustee_name:
        return f"{owner.trust_name.strip()} (Trustee: {owner.trustee_name.strip()})"
    if owner.trust_name:
        return owner.trust_name.strip()
    if owner.trustee_name:
        return owner.trustee_name.strip()
    if owner.legal_name:
        return owner.legal_name.strip()
    if owner.invoice_issuer_name:
        return owner.invoice_issuer_name.strip()
    return "Unnamed owner"


def _owner_read(owner: Owner) -> OwnerPortalOwnerRead:
    return OwnerPortalOwnerRead(
        id=owner.id,
        entity_id=owner.entity_id,
        display_name=_owner_display_name(owner),
        legal_name=owner.legal_name,
        abn=owner.abn,
        trustee_name=owner.trustee_name,
        trust_name=owner.trust_name,
        invoice_issuer_name=owner.invoice_issuer_name,
        billing_contact_name=owner.billing_contact_name,
        billing_email=owner.billing_email,
        invoice_reference=owner.invoice_reference,
        gst_registered=owner.gst_registered,
    )


def _linked_properties(owner: Owner, session: Session) -> list[OwnerPortalPropertyRead]:
    rows = session.execute(
        select(PropertyOwner.property_id, Property.name, PropertyOwner.split_pct)
        .join(Property, Property.id == PropertyOwner.property_id)
        .where(
            PropertyOwner.owner_id == owner.id,
            Property.entity_id == owner.entity_id,
            Property.deleted_at.is_(None),
        )
        .order_by(Property.name.asc())
    ).all()
    return [
        OwnerPortalPropertyRead(
            property_id=property_id,
            property_name=property_name,
            split_pct=float(split_pct),
        )
        for property_id, property_name, split_pct in rows
    ]


def _document_source_label_from_metadata(metadata: dict[str, object] | None) -> str:
    metadata = metadata or {}
    source = metadata.get("source")
    if source == "operator_upload":
        return "Shared by property team"
    if source == "property_document":
        return "Property document"
    return "Shared file"


def _document_is_explicitly_owner_visible(document: StoredDocument) -> bool:
    metadata = document.document_metadata or {}
    return metadata.get(OWNER_PORTAL_DOCUMENT_VISIBLE_KEY) is True


def _document_is_property_level(document: StoredDocument) -> bool:
    return (
        document.property_id is not None
        and document.tenancy_unit_id is None
        and document.tenant_id is None
        and document.lease_id is None
        and document.tenant_onboarding_id is None
        and document.category != DocumentCategory.invoice
    )


def _document_read(
    document: StoredDocument,
    property_name: str,
) -> OwnerPortalDocumentRead:
    assert document.property_id is not None
    return OwnerPortalDocumentRead(
        id=document.id,
        property_id=document.property_id,
        property_name=property_name,
        filename=document.filename,
        content_type=document.content_type,
        byte_size=document.byte_size,
        category=document.category,
        notes=document.notes,
        source_label=_document_source_label_from_metadata(document.document_metadata),
        created_at=document.created_at,
    )


def _owner_portal_documents(
    owner: Owner,
    session: Session,
    properties: list[OwnerPortalPropertyRead],
) -> list[OwnerPortalDocumentRead]:
    property_names = {row.property_id: row.property_name for row in properties}
    if not property_names:
        return []

    rows = session.execute(
        select(
            StoredDocument.id,
            StoredDocument.property_id,
            Property.name.label("property_name"),
            StoredDocument.filename,
            StoredDocument.content_type,
            StoredDocument.byte_size,
            StoredDocument.category,
            StoredDocument.notes,
            StoredDocument.document_metadata,
            StoredDocument.created_at,
        )
        .join(Property, Property.id == StoredDocument.property_id)
        .join(PropertyOwner, PropertyOwner.property_id == StoredDocument.property_id)
        .where(
            StoredDocument.entity_id == owner.entity_id,
            StoredDocument.property_id.in_(list(property_names)),
            StoredDocument.tenancy_unit_id.is_(None),
            StoredDocument.tenant_id.is_(None),
            StoredDocument.lease_id.is_(None),
            StoredDocument.tenant_onboarding_id.is_(None),
            StoredDocument.category != DocumentCategory.invoice,
            StoredDocument.deleted_at.is_(None),
            PropertyOwner.owner_id == owner.id,
            Property.entity_id == owner.entity_id,
            Property.deleted_at.is_(None),
        )
        .order_by(StoredDocument.created_at.desc(), StoredDocument.filename.asc())
    ).all()

    visible_documents: list[OwnerPortalDocumentRead] = []
    for row in rows:
        if (row.document_metadata or {}).get(OWNER_PORTAL_DOCUMENT_VISIBLE_KEY) is not True:
            continue
        assert row.property_id is not None
        visible_documents.append(
            OwnerPortalDocumentRead(
                id=row.id,
                property_id=row.property_id,
                property_name=row.property_name,
                filename=row.filename,
                content_type=row.content_type,
                byte_size=row.byte_size,
                category=row.category,
                notes=row.notes,
                source_label=_document_source_label_from_metadata(row.document_metadata),
                created_at=row.created_at,
            )
        )
    return visible_documents


def _owner_portal_maintenance(
    owner: Owner,
    session: Session,
    properties: list[OwnerPortalPropertyRead],
) -> OwnerPortalMaintenanceRead:
    property_ids = {row.property_id for row in properties}
    if not property_ids:
        return OwnerPortalMaintenanceRead(
            open_count=0,
            urgent_count=0,
            awaiting_approval_count=0,
            items=[],
        )

    rows = session.execute(
        select(
            MaintenanceWorkOrder.id,
            MaintenanceWorkOrder.property_id,
            Property.name.label("property_name"),
            MaintenanceWorkOrder.work_order_metadata,
            MaintenanceWorkOrder.status,
            MaintenanceWorkOrder.priority,
            MaintenanceWorkOrder.requested_at,
            MaintenanceWorkOrder.due_date,
            MaintenanceWorkOrder.completed_at,
            MaintenanceWorkOrder.approval_required,
            MaintenanceWorkOrder.approval_status,
            MaintenanceWorkOrder.quote_amount_cents,
        )
        .join(Property, Property.id == MaintenanceWorkOrder.property_id)
        .join(PropertyOwner, PropertyOwner.property_id == MaintenanceWorkOrder.property_id)
        .where(
            MaintenanceWorkOrder.entity_id == owner.entity_id,
            MaintenanceWorkOrder.property_id.in_(list(property_ids)),
            MaintenanceWorkOrder.status.in_(OWNER_PORTAL_OPEN_MAINTENANCE_STATUSES),
            MaintenanceWorkOrder.deleted_at.is_(None),
            PropertyOwner.owner_id == owner.id,
            Property.entity_id == owner.entity_id,
            Property.deleted_at.is_(None),
        )
        .order_by(
            MaintenanceWorkOrder.due_date.asc().nullslast(),
            MaintenanceWorkOrder.requested_at.desc(),
        )
    ).all()

    items: list[OwnerPortalMaintenanceItemRead] = []
    for row in rows:
        metadata = _metadata_dict(row.work_order_metadata)
        if metadata.get(OWNER_PORTAL_MAINTENANCE_VISIBLE_KEY) is not True:
            continue
        items.append(
            OwnerPortalMaintenanceItemRead(
                id=row.id,
                property_id=row.property_id,
                property_name=row.property_name,
                title=_owner_portal_maintenance_title(metadata),
                status=row.status,
                priority=row.priority,
                requested_at=row.requested_at,
                due_date=row.due_date,
                completed_at=row.completed_at,
                approval_required=row.approval_required,
                approval_status=row.approval_status,
                quote_amount_cents=row.quote_amount_cents,
            )
        )
    return OwnerPortalMaintenanceRead(
        open_count=len(items),
        urgent_count=sum(1 for item in items if item.priority == MaintenancePriority.urgent),
        awaiting_approval_count=sum(
            1
            for item in items
            if item.status == MaintenanceWorkOrderStatus.awaiting_approval
        ),
        items=items,
    )


def _owner_portal_month_start(month: str) -> date:
    year_value, month_value = month.split("-", 1)
    return date(int(year_value), int(month_value), 1)


def _owner_portal_lease_events(
    owner: Owner,
    session: Session,
    properties: list[OwnerPortalPropertyRead],
    month: str,
) -> OwnerPortalLeaseEventsRead:
    property_ids = {row.property_id for row in properties}
    if not property_ids:
        return OwnerPortalLeaseEventsRead(
            upcoming_count=0,
            rent_review_count=0,
            expiry_count=0,
            events=[],
        )

    window_start = _owner_portal_month_start(month)
    window_end = window_start + timedelta(days=OWNER_PORTAL_LEASE_EVENT_WINDOW_DAYS)
    rows = session.execute(
        select(
            Lease.id,
            TenancyUnit.property_id,
            Property.name.label("property_name"),
            TenancyUnit.unit_label,
            Lease.status,
            Lease.expiry_date,
            Lease.next_review_date,
            Lease.annual_rent_cents,
        )
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
        .join(PropertyOwner, PropertyOwner.property_id == Property.id)
        .where(
            Lease.deleted_at.is_(None),
            Lease.status.in_(OWNER_PORTAL_LEASE_EVENT_STATUSES),
            TenancyUnit.property_id.in_(list(property_ids)),
            TenancyUnit.deleted_at.is_(None),
            PropertyOwner.owner_id == owner.id,
            Property.entity_id == owner.entity_id,
            Property.deleted_at.is_(None),
        )
    ).all()

    events: list[OwnerPortalLeaseEventRead] = []
    for row in rows:
        for event_kind, event_date in (
            ("rent_review", row.next_review_date),
            ("lease_expiry", row.expiry_date),
        ):
            if event_date is None or event_date < window_start or event_date > window_end:
                continue
            events.append(
                OwnerPortalLeaseEventRead(
                    lease_id=row.id,
                    property_id=row.property_id,
                    property_name=row.property_name,
                    unit_label=row.unit_label,
                    event_kind=event_kind,
                    event_date=event_date,
                    lease_status=row.status.value,
                    annual_rent_cents=row.annual_rent_cents,
                )
            )

    event_kind_rank = {"rent_review": 0, "lease_expiry": 1}
    events.sort(
        key=lambda event: (
            event.event_date,
            event_kind_rank[event.event_kind],
            event.property_name,
            event.unit_label,
        )
    )
    return OwnerPortalLeaseEventsRead(
        upcoming_count=len(events),
        rent_review_count=sum(1 for event in events if event.event_kind == "rent_review"),
        expiry_count=sum(1 for event in events if event.event_kind == "lease_expiry"),
        events=events,
    )


def _owner_portal_compliance(
    owner: Owner,
    session: Session,
    properties: list[OwnerPortalPropertyRead],
) -> OwnerPortalComplianceRead:
    property_ids = {row.property_id for row in properties}
    if not property_ids:
        return OwnerPortalComplianceRead(
            open_count=0,
            overdue_count=0,
            due_soon_count=0,
            missing_evidence_count=0,
            items=[],
        )

    rows = session.execute(
        select(
            ComplianceCheck.id,
            ComplianceCheck.property_id,
            Property.name.label("property_name"),
            ComplianceCheck.check_metadata,
            ComplianceCheck.kind,
            ComplianceCheck.status,
            ComplianceCheck.last_checked_at,
            ComplianceCheck.next_due_date,
            ComplianceCheck.certificate_expires_on,
            Obligation.obligation_metadata.label("current_obligation_metadata"),
        )
        .join(Property, Property.id == ComplianceCheck.property_id)
        .join(PropertyOwner, PropertyOwner.property_id == ComplianceCheck.property_id)
        .outerjoin(
            Obligation,
            (Obligation.id == ComplianceCheck.current_obligation_id)
            & (Obligation.entity_id == owner.entity_id)
            & (Obligation.deleted_at.is_(None)),
        )
        .where(
            ComplianceCheck.entity_id == owner.entity_id,
            ComplianceCheck.property_id.in_(list(property_ids)),
            ComplianceCheck.status.in_(OWNER_PORTAL_OPEN_COMPLIANCE_STATUSES),
            ComplianceCheck.deleted_at.is_(None),
            PropertyOwner.owner_id == owner.id,
            Property.entity_id == owner.entity_id,
            Property.deleted_at.is_(None),
        )
        .order_by(
            ComplianceCheck.next_due_date.asc(),
            Property.name.asc(),
            ComplianceCheck.id.asc(),
        )
    ).all()

    today = utcnow().date()
    items: list[OwnerPortalComplianceItemRead] = []
    for row in rows:
        metadata = _metadata_dict(row.check_metadata)
        if metadata.get(OWNER_PORTAL_COMPLIANCE_VISIBLE_KEY) is not True:
            continue
        assert row.property_id is not None
        due_status = _owner_portal_compliance_due_status(row.next_due_date, today)
        evidence_status = _owner_portal_compliance_evidence_status(
            row.current_obligation_metadata
        )
        items.append(
            OwnerPortalComplianceItemRead(
                id=row.id,
                property_id=row.property_id,
                property_name=row.property_name,
                title=_owner_portal_compliance_title(metadata, "Compliance check"),
                kind=row.kind,
                status=row.status,
                due_status=due_status,
                next_due_date=row.next_due_date,
                certificate_expires_on=row.certificate_expires_on,
                last_checked_at=row.last_checked_at,
                evidence_status=evidence_status,
            )
        )

    return OwnerPortalComplianceRead(
        open_count=len(items),
        overdue_count=sum(1 for item in items if item.due_status == "overdue"),
        due_soon_count=sum(1 for item in items if item.due_status == "due_soon"),
        missing_evidence_count=sum(
            1 for item in items if item.evidence_status == "missing"
        ),
        items=items,
    )


def _owner_portal_document(
    owner: Owner,
    document_id: UUID,
    session: Session,
) -> StoredDocument:
    scoped_document = session.execute(
        select(StoredDocument.id, StoredDocument.document_metadata)
        .join(Property, Property.id == StoredDocument.property_id)
        .join(PropertyOwner, PropertyOwner.property_id == StoredDocument.property_id)
        .where(
            StoredDocument.id == document_id,
            StoredDocument.entity_id == owner.entity_id,
            StoredDocument.property_id.is_not(None),
            StoredDocument.tenancy_unit_id.is_(None),
            StoredDocument.tenant_id.is_(None),
            StoredDocument.lease_id.is_(None),
            StoredDocument.tenant_onboarding_id.is_(None),
            StoredDocument.category != DocumentCategory.invoice,
            StoredDocument.deleted_at.is_(None),
            PropertyOwner.owner_id == owner.id,
            Property.entity_id == owner.entity_id,
            Property.deleted_at.is_(None),
        )
    ).one_or_none()
    if scoped_document is None or (
        scoped_document.document_metadata or {}
    ).get(OWNER_PORTAL_DOCUMENT_VISIBLE_KEY) is not True:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )

    document = session.scalar(
        select(StoredDocument).where(
            StoredDocument.id == scoped_document.id,
            StoredDocument.deleted_at.is_(None),
        )
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )
    return document


def _statement_matches_owner(
    owner: Owner,
    statement: OwnerStatementRead,
    property_ids: set[UUID],
) -> bool:
    statement_property_ids = {line.property_id for line in statement.properties}
    if statement_property_ids != property_ids:
        return False
    if statement.owner_id is not None:
        return statement.owner_id == owner.id
    if statement.owner_identity == _owner_display_name(owner):
        return True
    return (
        statement.owner_legal_name == owner.legal_name
        and statement.trustee_name == owner.trustee_name
        and statement.trust_name == owner.trust_name
        and statement.invoice_issuer_name == owner.invoice_issuer_name
    )


def _statement_read(
    owner: Owner,
    statements: list[OwnerStatementRead],
    month: str,
    property_ids: set[UUID],
) -> OwnerPortalStatementRead | None:
    if not property_ids:
        return None
    for statement in statements:
        if _statement_matches_owner(owner, statement, property_ids):
            return OwnerPortalStatementRead(
                month=month,
                owner_identity=statement.owner_identity,
                property_count=statement.property_count,
                properties=[
                    OwnerPortalStatementPropertyRead(
                        property_id=line.property_id,
                        property_name=line.property_name,
                        invoiced_cents=line.invoiced_cents,
                        paid_cents=line.paid_cents,
                        outstanding_cents=line.outstanding_cents,
                        invoice_count=line.invoice_count,
                    )
                    for line in statement.properties
                ],
                invoiced_cents=statement.invoiced_cents,
                paid_cents=statement.paid_cents,
                outstanding_cents=statement.outstanding_cents,
                invoice_count=statement.invoice_count,
            )
    return None


def _portal_read(
    owner: Owner,
    session: Session,
    month: str,
    auth: OwnerPortalAuthRead,
) -> OwnerPortalRead:
    # Gate requirement: the portal currently exposes only read-only statement
    # roll-ups (invoiced/paid/outstanding), documents, maintenance, lease, and
    # compliance — no disbursement, distribution, or trust-accounting surface.
    # If/when those land here, they must stay behind the same
    # managing_agent|hybrid gate (_assert_owner_portal_operating_mode) so a
    # self_managed_owner account can never reach a disbursement/trust surface.
    properties = _linked_properties(owner, session)
    property_ids = {row.property_id for row in properties}
    owner_statements = _build_owner_statements(owner.entity_id, session, month)
    statement = _statement_read(
        owner=owner,
        statements=owner_statements.owners,
        month=owner_statements.month,
        property_ids=property_ids,
    )
    return OwnerPortalRead(
        auth=auth,
        owner=_owner_read(owner),
        properties=properties,
        statement=statement,
        documents=_owner_portal_documents(owner, session, properties),
        maintenance=_owner_portal_maintenance(owner, session, properties),
        lease_events=_owner_portal_lease_events(owner, session, properties, month),
        compliance=_owner_portal_compliance(owner, session, properties),
        guardrails=OWNER_PORTAL_GUARDRAILS,
        generated_at=owner_statements.generated_at,
    )


def _owner_portal_account_read(
    owner: Owner,
    session: Session,
    month: str | None = None,
) -> OwnerPortalRead:
    return _portal_read(
        owner,
        session,
        month or _current_statement_month(),
        OwnerPortalAuthRead(
            mode="owner_portal_account",
            token_source="bearer",
            owner_auth_configured=True,
            boundary="owner_portal_account",
            detail="Access is scoped to the owner linked to this owner portal account.",
        ),
    )


@router.post(
    "/{owner_id}/invite",
    response_model=OwnerPortalInviteRead,
    status_code=status.HTTP_201_CREATED,
)
def create_owner_portal_invite(
    owner_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnerPortalInviteRead:
    """Create a local one-time owner portal claim link without sending it."""

    owner = session.get(Owner, owner_id)
    if owner is None or owner.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Owner not found."
        )
    assert_entity_role(
        session,
        user,
        owner.entity_id,
        {UserRole.owner, UserRole.admin, UserRole.finance},
    )
    _assert_owner_portal_operating_mode(session, owner.entity_id)
    claim_email = _claim_email(owner)
    token = _new_owner_portal_token()
    now = utcnow()
    invite = OwnerPortalInvite(
        entity_id=owner.entity_id,
        owner_id=owner.id,
        token_hash=_owner_portal_token_hash(token),
        claim_email=claim_email,
        expires_at=now + timedelta(days=OWNER_PORTAL_INVITE_TTL_DAYS),
        created_by_user_id=user.id,
        invite_metadata={
            "source": "owner_portal_invite",
            "created_by": user.actor,
        },
        created_at=now,
        updated_at=now,
    )
    session.add(invite)
    session.commit()
    return OwnerPortalInviteRead(
        owner_id=owner.id,
        owner_display_name=_owner_display_name(owner),
        claim_email=claim_email,
        portal_token=token,
        claim_url=f"/owner-portal/invite/{token}",
        expires_at=invite.expires_at,
        guardrails=OWNER_PORTAL_INVITE_GUARDRAILS,
    )


@router.get(
    "/invites/{token}/preview",
    response_model=OwnerPortalInvitePreviewRead,
)
def preview_owner_portal_invite(
    token: str,
    session: Annotated[Session, Depends(get_session)],
) -> OwnerPortalInvitePreviewRead:
    """Return safe context for the public owner account claim gate."""

    invite = _invite_for_token(token, session)
    owner = _owner_for_invite(invite, session)
    return OwnerPortalInvitePreviewRead(
        owner_display_name=_owner_display_name(owner),
        claim_email=invite.claim_email,
        expires_at=invite.expires_at,
        claimable=invite.consumed_at is None,
    )


@router.post("/account/claim", response_model=OwnerPortalRead)
def claim_owner_portal_account(
    payload: OwnerPortalAccountClaimCreate,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> OwnerPortalRead:
    identity = _owner_portal_identity(authorization, settings)
    invite = _invite_for_token(payload.portal_token, session)
    owner = _owner_for_invite(invite, session)
    _assert_owner_portal_operating_mode(session, owner.entity_id)
    provider_id = identity.provider_id

    if invite.consumed_at is not None:
        prior_link = session.scalar(
            select(OwnerPortalAccount).where(
                OwnerPortalAccount.auth_provider == "clerk",
                OwnerPortalAccount.auth_provider_id == provider_id,
                OwnerPortalAccount.owner_id == owner.id,
            )
        )
        if prior_link is None:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail=(
                    "This owner portal invite has been used. Sign in with the "
                    "owner account it was claimed by."
                ),
            )

    _assert_claim_email_matches_invite(identity, invite.claim_email, settings)

    active_accounts = _active_owner_portal_accounts(provider_id, session)
    if any(account.owner_id != owner.id for account in active_accounts):
        raise _owner_portal_login_already_linked_error()

    revoked_account = session.scalar(
        select(OwnerPortalAccount).where(
            OwnerPortalAccount.auth_provider == "clerk",
            OwnerPortalAccount.auth_provider_id == provider_id,
            OwnerPortalAccount.owner_id == owner.id,
            OwnerPortalAccount.revoked_at.is_not(None),
            OwnerPortalAccount.deleted_at.is_(None),
        )
    )
    if revoked_account is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner portal account is revoked.",
        )

    account = session.scalar(
        select(OwnerPortalAccount).where(
            OwnerPortalAccount.auth_provider == "clerk",
            OwnerPortalAccount.auth_provider_id == provider_id,
            OwnerPortalAccount.owner_id == owner.id,
            OwnerPortalAccount.status == OwnerPortalAccountStatus.active,
            OwnerPortalAccount.revoked_at.is_(None),
            OwnerPortalAccount.deleted_at.is_(None),
        )
    )
    now = utcnow()
    if account is None:
        account = OwnerPortalAccount(
            entity_id=owner.entity_id,
            owner_id=owner.id,
            owner_portal_invite_id=invite.id,
            auth_provider="clerk",
            auth_provider_id=provider_id,
            email=owner.billing_email or invite.claim_email,
            status=OwnerPortalAccountStatus.active,
            linked_at=now,
            last_seen_at=now,
            account_metadata={
                "source": "owner_portal_claim",
                "owner_portal_invite_id": str(invite.id),
            },
        )
        session.add(account)
    else:
        account.owner_portal_invite_id = invite.id
        account.email = account.email or owner.billing_email or invite.claim_email
        account.last_seen_at = now
        account.account_metadata = {
            **(account.account_metadata or {}),
            "last_claimed_at": now.isoformat(),
            "owner_portal_invite_id": str(invite.id),
        }
    if invite.consumed_at is None:
        invite.consumed_at = now
    owner_id = owner.id
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if not _is_active_provider_integrity_error(exc):
            raise
        active_accounts = _active_owner_portal_accounts(provider_id, session)
        if any(account.owner_id != owner_id for account in active_accounts):
            raise _owner_portal_login_already_linked_error() from None
        account = next(
            (
                active_account
                for active_account in active_accounts
                if active_account.owner_id == owner_id
            ),
            None,
        )
        if account is None:
            raise
        owner = _owner_for_account(account, session)
        _assert_owner_portal_operating_mode(session, owner.entity_id)
        account.last_seen_at = utcnow()
        session.commit()
        session.refresh(account)
        session.refresh(owner)
        return _owner_portal_account_read(owner, session)
    session.refresh(account)
    session.refresh(owner)
    return _owner_portal_account_read(owner, session)


@router.get("/account/status", response_model=OwnerPortalAccountLifecycleRead)
def get_owner_portal_account_status(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> OwnerPortalAccountLifecycleRead:
    identity = _owner_portal_identity(authorization, settings)
    provider_id = identity.provider_id
    active_accounts = _active_owner_portal_accounts(provider_id, session)
    _assert_owner_portal_accounts_unambiguous(active_accounts)
    if active_accounts:
        account = active_accounts[0]
        _assert_owner_portal_operating_mode(session, account.entity_id)
        owner = session.get(Owner, account.owner_id)
        return OwnerPortalAccountLifecycleRead(
            status="active",
            owner_id=account.owner_id,
            owner_name=_owner_display_name(owner) if owner is not None else None,
            email=account.email,
            linked_at=account.linked_at,
            last_seen_at=account.last_seen_at,
            revoked_at=account.revoked_at,
            recovery_hint=(
                "This owner login can open the owner portal without the original "
                "claim link."
            ),
        )

    revoked_account = session.scalar(
        select(OwnerPortalAccount)
        .where(
            OwnerPortalAccount.auth_provider == "clerk",
            OwnerPortalAccount.auth_provider_id == provider_id,
            OwnerPortalAccount.revoked_at.is_not(None),
            OwnerPortalAccount.deleted_at.is_(None),
        )
        .order_by(OwnerPortalAccount.updated_at.desc())
    )
    if revoked_account is not None:
        _assert_owner_portal_operating_mode(session, revoked_account.entity_id)
        owner = session.get(Owner, revoked_account.owner_id)
        return OwnerPortalAccountLifecycleRead(
            status="revoked",
            owner_id=revoked_account.owner_id,
            owner_name=_owner_display_name(owner) if owner is not None else None,
            email=revoked_account.email,
            linked_at=revoked_account.linked_at,
            last_seen_at=revoked_account.last_seen_at,
            revoked_at=revoked_account.revoked_at,
            recovery_hint=(
                "This owner login was revoked by the property team. Ask them to "
                "restore access or send a fresh owner portal link before trying again."
            ),
        )

    return OwnerPortalAccountLifecycleRead(
        status="unlinked",
        recovery_hint=(
            "Open your owner portal claim link once to connect this login. "
            "If the link expired or was lost, ask the property team for a fresh "
            "owner portal link."
        ),
    )


@router.get("/account/session", response_model=OwnerPortalRead)
def get_owner_portal_account_session(
    month: Annotated[
        str,
        Query(
            pattern=r"^\d{4}-\d{2}$",
            description="Statement month in YYYY-MM format.",
        ),
    ],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> OwnerPortalRead:
    identity = _owner_portal_identity(authorization, settings)
    account = _active_owner_portal_account(identity.provider_id, session)
    owner = _owner_for_account(account, session)
    _assert_owner_portal_operating_mode(session, owner.entity_id)
    account.last_seen_at = utcnow()
    session.commit()
    session.refresh(account)
    return _portal_read(
        owner,
        session,
        month,
        OwnerPortalAuthRead(
            mode="owner_portal_account",
            token_source="bearer",
            owner_auth_configured=True,
            boundary="owner_portal_account",
            detail="Access is scoped to the owner linked to this owner portal account.",
        ),
    )


@router.get("/account/documents/{document_id}/download")
def download_owner_portal_account_document(
    document_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> Response:
    identity = _owner_portal_identity(authorization, settings)
    account = _active_owner_portal_account(identity.provider_id, session)
    owner = _owner_for_account(account, session)
    _assert_owner_portal_operating_mode(session, owner.entity_id)
    document = _owner_portal_document(owner, document_id, session)
    return Response(
        content=document.file_data,
        media_type=document.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{quote(document.filename)}"
            )
        },
    )


@router.get("/{owner_id}", response_model=OwnerPortalRead)
def get_owner_portal_preview(
    owner_id: UUID,
    month: Annotated[
        str,
        Query(
            pattern=r"^\d{4}-\d{2}$",
            description="Statement month in YYYY-MM format.",
        ),
    ],
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnerPortalRead:
    """Return a read-only operator preview of one owner's portal."""

    owner = session.get(Owner, owner_id)
    if owner is None or owner.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Owner not found."
        )
    assert_entity_role(session, user, owner.entity_id, READ_ROLES)
    _assert_owner_portal_operating_mode(session, owner.entity_id)

    return _portal_read(
        owner,
        session,
        month,
        OwnerPortalAuthRead(
            mode="operator_preview",
            token_source="bearer",
            owner_auth_configured=True,
            boundary="operator_session",
            detail=(
                "Read-only operator preview scoped by entity role; no owner "
                "portal account is created."
            ),
        ),
    )
