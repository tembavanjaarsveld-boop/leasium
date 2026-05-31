"""Read-only owner portal preview routes."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.auth import (
    ClerkIdentity,
    _clerk_identity,
    _normalise_email,
    _verified_emails_from_clerk_user,
)
from stewart.core.db import utcnow
from stewart.core.models import (
    DocumentCategory,
    Owner,
    OwnerPortalAccount,
    OwnerPortalAccountStatus,
    OwnerPortalInvite,
    Property,
    PropertyOwner,
    StoredDocument,
    UserRole,
)
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.owners import _build_owner_statements
from apps.api.schemas.owner_portal import (
    OwnerPortalAccountClaimCreate,
    OwnerPortalAccountLifecycleRead,
    OwnerPortalAuthRead,
    OwnerPortalDocumentRead,
    OwnerPortalInvitePreviewRead,
    OwnerPortalInviteRead,
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


def _current_statement_month() -> str:
    return utcnow().strftime("%Y-%m")


def _owner_portal_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_owner_portal_token() -> str:
    return secrets.token_urlsafe(32)


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


def _active_owner_portal_account(
    provider_id: str,
    session: Session,
) -> OwnerPortalAccount:
    account = session.scalar(
        select(OwnerPortalAccount)
        .where(
            OwnerPortalAccount.auth_provider == "clerk",
            OwnerPortalAccount.auth_provider_id == provider_id,
            OwnerPortalAccount.status == OwnerPortalAccountStatus.active,
            OwnerPortalAccount.revoked_at.is_(None),
            OwnerPortalAccount.deleted_at.is_(None),
        )
        .order_by(OwnerPortalAccount.updated_at.desc())
    )
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Owner portal account not found.",
        )
    return account


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
        guardrails=OWNER_PORTAL_GUARDRAILS,
        generated_at=owner_statements.generated_at,
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
    session.commit()
    session.refresh(account)
    session.refresh(owner)
    return _portal_read(
        owner,
        session,
        _current_statement_month(),
        OwnerPortalAuthRead(
            mode="owner_portal_account",
            token_source="bearer",
            owner_auth_configured=True,
            boundary="owner_portal_account",
            detail="Access is scoped to the owner linked to this owner portal account.",
        ),
    )


@router.get("/account/status", response_model=OwnerPortalAccountLifecycleRead)
def get_owner_portal_account_status(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> OwnerPortalAccountLifecycleRead:
    identity = _owner_portal_identity(authorization, settings)
    provider_id = identity.provider_id
    account = session.scalar(
        select(OwnerPortalAccount)
        .where(
            OwnerPortalAccount.auth_provider == "clerk",
            OwnerPortalAccount.auth_provider_id == provider_id,
            OwnerPortalAccount.status == OwnerPortalAccountStatus.active,
            OwnerPortalAccount.revoked_at.is_(None),
            OwnerPortalAccount.deleted_at.is_(None),
        )
        .order_by(OwnerPortalAccount.updated_at.desc())
    )
    if account is not None:
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
