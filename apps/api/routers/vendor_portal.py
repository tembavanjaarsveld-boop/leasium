"""Vendor portal: read-only operator preview + authenticated contractor account.

Contractors can claim a Clerk-backed account from a locally-created invite, then
self-serve on the maintenance jobs an operator has explicitly shared to them:
see the job, accept it, post an update, and attach a photo. Tenant identity,
internal notes, provider receipts, and payment data never cross the boundary, and
no provider call (Xero, Basiq, SendGrid, Twilio, payment reconciliation) is made.

The account flow mirrors the owner portal (``apps/api/routers/owner_portal.py``).
Unlike owners, vendors are not gated on operating mode: contractors are relevant
to self-managed and managing-agent operators alike.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.auth import (
    ClerkIdentity,
    _clerk_identity,
    _normalise_email,
    _verified_emails_from_clerk_user,
)
from stewart.core.db import utcnow
from stewart.core.models import (
    Contractor,
    DocumentCategory,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    StoredDocument,
    UserRole,
    VendorPortalAccount,
    VendorPortalAccountStatus,
    VendorPortalInvite,
)
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.vendor_portal import (
    VendorPortalAccountClaimCreate,
    VendorPortalAccountLifecycleRead,
    VendorPortalAuthRead,
    VendorPortalCommentCreate,
    VendorPortalCommentRead,
    VendorPortalInvitePreviewRead,
    VendorPortalInviteRead,
    VendorPortalRead,
    VendorPortalVendorRead,
    VendorPortalWorkOrderItemRead,
    VendorPortalWorkOrderMessagesRead,
    VendorPortalWorkOrdersRead,
)

router = APIRouter(prefix="/vendor-portal", tags=["vendor-portal"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}
INVITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.ops}

VENDOR_PORTAL_GUARDRAILS = [
    (
        "Read-only vendor portal: opening this page does not send contractor "
        "email or SMS, dispatch work, refresh providers, write Xero data, "
        "reconcile payments, or mutate provider history."
    ),
    (
        "Work orders are shown only when explicitly marked vendor-visible; "
        "tenant identity, internal notes, provider evidence, and payment "
        "identifiers stay inside the operator workspace."
    ),
]

VENDOR_PORTAL_ACCOUNT_GUARDRAILS = [
    (
        "Vendor portal account: you can accept jobs, post updates, and add photos "
        "for work shared with you. Tenant identity, internal notes, provider "
        "receipts, and payment data stay inside the property team's workspace."
    ),
    (
        "Accepting or updating a job here does not send contractor or tenant "
        "email/SMS, dispatch other providers, write Xero/Basiq data, or reconcile "
        "payments."
    ),
]

VENDOR_PORTAL_INVITE_GUARDRAILS = [
    (
        "Vendor portal invite created locally only: no contractor email or SMS is "
        "sent, no work is dispatched, and no provider history is mutated."
    )
]

VENDOR_PORTAL_MESSAGING_GUARDRAILS = [
    "Messages stay in this portal; no email or SMS is sent.",
]

VENDOR_PORTAL_INVITE_TTL_DAYS = 30

VENDOR_PORTAL_VISIBLE_KEY = "vendor_portal_visible"
VENDOR_PORTAL_CONTRACTOR_ID_KEY = "vendor_portal_contractor_id"
VENDOR_PORTAL_TITLE_KEY = "vendor_portal_title"
VENDOR_PORTAL_ACCEPTED_AT_KEY = "vendor_portal_accepted_at"
VENDOR_PORTAL_ACCEPTED_BY_KEY = "vendor_portal_accepted_by_contractor_id"
VENDOR_PORTAL_SHARED_BY_USER_ID_KEY = "vendor_portal_shared_by_user_id"
VENDOR_PORTAL_NOTIFICATIONS_KEY = "vendor_portal_notifications"
WORK_ASSIGNMENT_KEY = "work_assignment"
COMMENTS_KEY = "comments"
ACTIVITY_HISTORY_KEY = "activity_history"

VENDOR_PORTAL_OPEN_STATUSES = {
    MaintenanceWorkOrderStatus.requested,
    MaintenanceWorkOrderStatus.triaged,
    MaintenanceWorkOrderStatus.assigned,
    MaintenanceWorkOrderStatus.awaiting_approval,
    MaintenanceWorkOrderStatus.approved,
    MaintenanceWorkOrderStatus.in_progress,
}
VENDOR_PORTAL_CLOSED_STATUSES = {
    MaintenanceWorkOrderStatus.completed,
    MaintenanceWorkOrderStatus.cancelled,
}
# Statuses where a contractor accepting the job may begin work immediately.
VENDOR_PORTAL_ACCEPT_START_STATUSES = {
    MaintenanceWorkOrderStatus.assigned,
    MaintenanceWorkOrderStatus.approved,
}


def _metadata_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _metadata_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _metadata_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _metadata_list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def _normalise_text(value: str | None) -> str:
    return (value or "").strip().casefold()


def _vendor_portal_title(metadata: dict[str, object]) -> str:
    return _metadata_text(metadata.get(VENDOR_PORTAL_TITLE_KEY)) or "Maintenance item"


def _matches_contractor(contractor_id: UUID, metadata: dict[str, object]) -> bool:
    return str(metadata.get(VENDOR_PORTAL_CONTRACTOR_ID_KEY) or "") == str(contractor_id)


def _vendor_comments(
    metadata: dict[str, object],
    contractor: Contractor,
) -> list[VendorPortalCommentRead]:
    comments = metadata.get(COMMENTS_KEY)
    if not isinstance(comments, list):
        return []

    contractor_label = _vendor_display_name(contractor)
    safe_comments: list[VendorPortalCommentRead] = []
    for comment in comments:
        if not isinstance(comment, dict):
            continue
        if _normalise_text(comment.get("visibility")) not in {"contractor", "vendor"}:
            continue
        body = _metadata_text(comment.get("body"))
        if body is None:
            continue
        actor = _metadata_text(comment.get("actor")) or ""
        from_contractor = actor.startswith("vendor:")
        safe_comments.append(
            VendorPortalCommentRead(
                body=body,
                timestamp=_metadata_text(comment.get("timestamp")),
                author="contractor" if from_contractor else "property_team",
                author_label=contractor_label if from_contractor else "Property team",
            )
        )
    return safe_comments


def _vendor_read(contractor: Contractor) -> VendorPortalVendorRead:
    return VendorPortalVendorRead(
        id=contractor.id,
        entity_id=contractor.entity_id,
        name=contractor.name,
        company_name=contractor.company_name,
        categories=list(contractor.categories or []),
        email=contractor.email,
        phone=contractor.phone,
        service_radius_km=contractor.service_radius_km,
        priority=contractor.priority,
    )


def _vendor_work_orders(
    contractor: Contractor,
    session: Session,
) -> VendorPortalWorkOrdersRead:
    rows = list(
        session.scalars(
            select(MaintenanceWorkOrder)
            .join(Property, Property.id == MaintenanceWorkOrder.property_id)
            .where(
                MaintenanceWorkOrder.entity_id == contractor.entity_id,
                MaintenanceWorkOrder.status.in_(VENDOR_PORTAL_OPEN_STATUSES),
                MaintenanceWorkOrder.deleted_at.is_(None),
                Property.entity_id == contractor.entity_id,
                Property.deleted_at.is_(None),
            )
            .order_by(
                MaintenanceWorkOrder.due_date.asc().nullslast(),
                MaintenanceWorkOrder.requested_at.desc(),
            )
        ).all()
    )

    items: list[VendorPortalWorkOrderItemRead] = []
    for row in rows:
        metadata = _metadata_dict(row.work_order_metadata)
        if metadata.get(VENDOR_PORTAL_VISIBLE_KEY) is not True:
            continue
        if not _matches_contractor(contractor.id, metadata):
            continue
        if row.property_id is None or row.property is None:
            continue
        items.append(
            VendorPortalWorkOrderItemRead(
                id=row.id,
                property_id=row.property_id,
                property_name=row.property.name,
                title=_vendor_portal_title(metadata),
                status=row.status,
                priority=row.priority,
                requested_at=row.requested_at,
                due_date=row.due_date,
                contractor_assigned_at=row.contractor_assigned_at,
                quote_amount_cents=row.quote_amount_cents,
                photo_count=len(row.photo_document_ids),
                comments=_vendor_comments(metadata, contractor),
            )
        )

    today = utcnow().date()
    return VendorPortalWorkOrdersRead(
        open_count=len(items),
        urgent_count=sum(1 for item in items if item.priority == MaintenancePriority.urgent),
        overdue_count=sum(1 for item in items if item.due_date and item.due_date < today),
        items=items,
    )


def _get_contractor_for_user(
    contractor_id: UUID,
    user: CurrentUser,
    session: Session,
) -> Contractor:
    contractor = session.get(Contractor, contractor_id)
    if contractor is None or contractor.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor portal not found.",
        )
    assert_entity_role(session, user, contractor.entity_id, READ_ROLES)
    return contractor


# ---------------------------------------------------------------------------
# Account auth: invite -> claim -> bearer session (mirrors owner portal)
# ---------------------------------------------------------------------------


def _vendor_portal_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_vendor_portal_token() -> str:
    return secrets.token_urlsafe(32)


def _vendor_portal_identity(
    authorization: str | None,
    settings: Settings,
) -> ClerkIdentity:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Vendor portal account bearer token required.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Vendor portal account bearer token required.",
        )
    return _clerk_identity(token, settings)


def _vendor_display_name(contractor: Contractor) -> str:
    if contractor.company_name and contractor.company_name.strip():
        return contractor.company_name.strip()
    if contractor.name and contractor.name.strip():
        return contractor.name.strip()
    return "Unnamed vendor"


def _claim_email(contractor: Contractor) -> str:
    email = contractor.email.strip() if contractor.email else ""
    if not email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contractor email is required before creating a vendor portal invite.",
        )
    return email


def _is_expired(expires_at: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= utcnow()


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
                    "Vendor account email verification is not fully configured. "
                    "Ask the property team to check contractor sign-up settings."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor portal login email must match this invite.",
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Vendor portal login email must match this invite.",
    )


def _invite_for_token(token: str, session: Session) -> VendorPortalInvite:
    invite = session.scalar(
        select(VendorPortalInvite).where(
            VendorPortalInvite.token_hash == _vendor_portal_token_hash(token),
            VendorPortalInvite.deleted_at.is_(None),
        )
    )
    if invite is None or invite.revoked_at is not None or _is_expired(invite.expires_at):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor portal invite not found.",
        )
    return invite


def _contractor_for_invite(invite: VendorPortalInvite, session: Session) -> Contractor:
    contractor = session.get(Contractor, invite.contractor_id)
    if (
        contractor is None
        or contractor.deleted_at is not None
        or contractor.entity_id != invite.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor portal invite not found.",
        )
    return contractor


_VENDOR_PORTAL_LOGIN_ALREADY_LINKED_DETAIL = (
    "This vendor portal login is already linked to another contractor. Ask the "
    "property team for a separate login before claiming this link."
)


def _vendor_portal_login_already_linked_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=_VENDOR_PORTAL_LOGIN_ALREADY_LINKED_DETAIL,
    )


def _is_active_provider_integrity_error(error: IntegrityError) -> bool:
    message = str(error.orig).lower()
    return (
        "vendor_portal_account_auth_provider_active_idx" in message
        or "vendor_portal_account_auth_provider_contractor_active_idx" in message
        or (
            "vendor_portal_account" in message
            and "auth_provider" in message
            and "auth_provider_id" in message
        )
    )


def _active_vendor_portal_accounts(
    provider_id: str,
    session: Session,
) -> list[VendorPortalAccount]:
    return list(
        session.scalars(
            select(VendorPortalAccount)
            .where(
                VendorPortalAccount.auth_provider == "clerk",
                VendorPortalAccount.auth_provider_id == provider_id,
                VendorPortalAccount.status == VendorPortalAccountStatus.active,
                VendorPortalAccount.revoked_at.is_(None),
                VendorPortalAccount.deleted_at.is_(None),
            )
            .order_by(VendorPortalAccount.updated_at.desc())
        ).all()
    )


def _assert_vendor_portal_accounts_unambiguous(
    accounts: list[VendorPortalAccount],
) -> None:
    if len({account.contractor_id for account in accounts}) > 1:
        raise _vendor_portal_login_already_linked_error()


def _active_vendor_portal_account(
    provider_id: str,
    session: Session,
) -> VendorPortalAccount:
    accounts = _active_vendor_portal_accounts(provider_id, session)
    if not accounts:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Vendor portal account not found.",
        )
    _assert_vendor_portal_accounts_unambiguous(accounts)
    return accounts[0]


def _contractor_for_account(account: VendorPortalAccount, session: Session) -> Contractor:
    contractor = session.get(Contractor, account.contractor_id)
    if (
        contractor is None
        or contractor.deleted_at is not None
        or contractor.entity_id != account.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor portal account not found.",
        )
    return contractor


def _vendor_account_auth() -> VendorPortalAuthRead:
    return VendorPortalAuthRead(
        mode="vendor_portal_account",
        token_source="bearer",
        vendor_auth_configured=True,
        boundary="vendor_portal_account",
        detail="Access is scoped to the contractor linked to this vendor portal account.",
    )


def _vendor_account_read(contractor: Contractor, session: Session) -> VendorPortalRead:
    return VendorPortalRead(
        auth=_vendor_account_auth(),
        vendor=_vendor_read(contractor),
        work_orders=_vendor_work_orders(contractor, session),
        guardrails=VENDOR_PORTAL_ACCOUNT_GUARDRAILS,
        generated_at=utcnow(),
    )


def _shared_work_order_for_account(
    account: VendorPortalAccount,
    work_order_id: UUID,
    session: Session,
) -> MaintenanceWorkOrder:
    """Return the work order only if it is vendor-visible and shared to this account."""

    work_order = session.get(MaintenanceWorkOrder, work_order_id)
    if (
        work_order is None
        or work_order.deleted_at is not None
        or work_order.entity_id != account.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Work order not found.",
        )
    metadata = _metadata_dict(work_order.work_order_metadata)
    if metadata.get(VENDOR_PORTAL_VISIBLE_KEY) is not True or not _matches_contractor(
        account.contractor_id, metadata
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Work order not found.",
        )
    return work_order


def _append_comment(
    metadata: dict[str, object],
    *,
    body: str,
    visibility: str,
    actor: str,
    now: datetime,
) -> dict[str, object]:
    updated = dict(metadata or {})
    comments = list(updated.get(COMMENTS_KEY, []))
    comments.append(
        {
            "timestamp": now.isoformat(),
            "actor": actor,
            "visibility": visibility,
            "body": body.strip(),
        }
    )
    updated[COMMENTS_KEY] = comments
    return updated


def _append_activity_history(
    metadata: dict[str, object],
    *,
    actor: str,
    source: str,
    event: str,
    summary: str,
    now: datetime,
    status_value: MaintenanceWorkOrderStatus | None = None,
) -> dict[str, object]:
    updated = dict(metadata or {})
    history = list(updated.get(ACTIVITY_HISTORY_KEY, []))
    entry: dict[str, object] = {
        "timestamp": now.isoformat(),
        "actor": actor,
        "source": source,
        "event": event,
        "summary": summary,
    }
    if status_value is not None:
        entry["status"] = getattr(status_value, "value", status_value)
    history.append(entry)
    updated[ACTIVITY_HISTORY_KEY] = history
    return updated


def _record_contractor_reply_operator_notification(
    metadata: dict[str, object],
    *,
    now: datetime,
) -> dict[str, object]:
    updated = dict(metadata or {})
    assignment = _metadata_dict(updated.get(WORK_ASSIGNMENT_KEY))
    recipient_user_id = _metadata_text(assignment.get("assigned_user_id")) or _metadata_text(
        updated.get(VENDOR_PORTAL_SHARED_BY_USER_ID_KEY)
    )
    recipient_name = _metadata_text(assignment.get("assigned_user_name"))
    recipient_email = _metadata_text(assignment.get("assigned_user_email"))
    notifications = _metadata_dict(updated.get(VENDOR_PORTAL_NOTIFICATIONS_KEY))
    current = _metadata_dict(notifications.get("operator_reply"))
    history = _metadata_list(current.get("history"))
    previous_attempt_count = _metadata_int(current.get("delivery_attempt_count"))
    if previous_attempt_count is None:
        previous_attempt_count = len(history)
    attempt_count = previous_attempt_count + 1
    status_value = "ready" if recipient_user_id else "skipped"
    detail = (
        "Contractor replied in the vendor portal."
        if recipient_user_id
        else "Contractor replied, but no assigned or sharing operator was available."
    )
    receipt = {
        "event": "vendor_portal_reply_received",
        "channel": "in_app",
        "provider": "leasium",
        "status": status_value,
        "at": now.isoformat(),
        "recipient_user_id": recipient_user_id,
        "recipient_name": recipient_name,
        "recipient_email": recipient_email,
        "summary": detail,
        "delivery_attempt_count": attempt_count,
    }
    notifications["operator_reply"] = {
        "channel": "in_app",
        "provider": "leasium",
        "status": status_value,
        "detail": detail,
        "recipient_user_id": recipient_user_id,
        "recipient_name": recipient_name,
        "recipient_email": recipient_email,
        "attempted_at": now.isoformat(),
        "delivery_attempt_count": attempt_count,
        "history": [receipt, *history][:10],
    }
    updated[VENDOR_PORTAL_NOTIFICATIONS_KEY] = notifications
    return updated


def _assert_actionable(work_order: MaintenanceWorkOrder) -> None:
    if work_order.status in VENDOR_PORTAL_CLOSED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This job is already completed or cancelled.",
        )


def _audit_account_action(
    session: Session,
    *,
    account: VendorPortalAccount,
    work_order: MaintenanceWorkOrder,
    action_name: str,
    summary: str,
) -> None:
    audit_log(
        session,
        actor=f"vendor:{account.contractor_id}",
        entity_id=account.entity_id,
        action="update",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        tool_name=f"vendor_portal.account.{action_name}",
        tool_input={
            "maintenance_work_order_id": str(work_order.id),
            "contractor_id": str(account.contractor_id),
        },
        tool_output_summary=summary,
        data_classification="confidential",
    )


@router.post(
    "/{contractor_id}/invite",
    response_model=VendorPortalInviteRead,
    status_code=status.HTTP_201_CREATED,
)
def create_vendor_portal_invite(
    contractor_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> VendorPortalInviteRead:
    """Create a local one-time vendor portal claim link without sending it."""

    contractor = session.get(Contractor, contractor_id)
    if contractor is None or contractor.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor portal not found.",
        )
    assert_entity_role(session, user, contractor.entity_id, INVITE_ROLES)
    claim_email = _claim_email(contractor)
    token = _new_vendor_portal_token()
    now = utcnow()
    invite = VendorPortalInvite(
        entity_id=contractor.entity_id,
        contractor_id=contractor.id,
        token_hash=_vendor_portal_token_hash(token),
        claim_email=claim_email,
        expires_at=now + timedelta(days=VENDOR_PORTAL_INVITE_TTL_DAYS),
        created_by_user_id=user.id,
        invite_metadata={
            "source": "vendor_portal_invite",
            "created_by": user.actor,
        },
        created_at=now,
        updated_at=now,
    )
    session.add(invite)
    session.commit()
    return VendorPortalInviteRead(
        contractor_id=contractor.id,
        vendor_display_name=_vendor_display_name(contractor),
        claim_email=claim_email,
        portal_token=token,
        claim_url=f"/vendor-portal/invite/{token}",
        expires_at=invite.expires_at,
        guardrails=VENDOR_PORTAL_INVITE_GUARDRAILS,
    )


@router.get("/invites/{token}/preview", response_model=VendorPortalInvitePreviewRead)
def preview_vendor_portal_invite(
    token: str,
    session: Annotated[Session, Depends(get_session)],
) -> VendorPortalInvitePreviewRead:
    """Return safe context for the public vendor account claim gate."""

    invite = _invite_for_token(token, session)
    contractor = _contractor_for_invite(invite, session)
    return VendorPortalInvitePreviewRead(
        vendor_display_name=_vendor_display_name(contractor),
        claim_email=invite.claim_email,
        expires_at=invite.expires_at,
        claimable=invite.consumed_at is None,
    )


@router.post("/account/claim", response_model=VendorPortalRead)
def claim_vendor_portal_account(
    payload: VendorPortalAccountClaimCreate,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> VendorPortalRead:
    identity = _vendor_portal_identity(authorization, settings)
    invite = _invite_for_token(payload.portal_token, session)
    contractor = _contractor_for_invite(invite, session)
    provider_id = identity.provider_id

    if invite.consumed_at is not None:
        prior_link = session.scalar(
            select(VendorPortalAccount).where(
                VendorPortalAccount.auth_provider == "clerk",
                VendorPortalAccount.auth_provider_id == provider_id,
                VendorPortalAccount.contractor_id == contractor.id,
            )
        )
        if prior_link is None:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail=(
                    "This vendor portal invite has been used. Sign in with the "
                    "contractor account it was claimed by."
                ),
            )

    _assert_claim_email_matches_invite(identity, invite.claim_email, settings)

    active_accounts = _active_vendor_portal_accounts(provider_id, session)
    if any(account.contractor_id != contractor.id for account in active_accounts):
        raise _vendor_portal_login_already_linked_error()

    revoked_account = session.scalar(
        select(VendorPortalAccount).where(
            VendorPortalAccount.auth_provider == "clerk",
            VendorPortalAccount.auth_provider_id == provider_id,
            VendorPortalAccount.contractor_id == contractor.id,
            VendorPortalAccount.revoked_at.is_not(None),
            VendorPortalAccount.deleted_at.is_(None),
        )
    )
    if revoked_account is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor portal account is revoked.",
        )

    account = session.scalar(
        select(VendorPortalAccount).where(
            VendorPortalAccount.auth_provider == "clerk",
            VendorPortalAccount.auth_provider_id == provider_id,
            VendorPortalAccount.contractor_id == contractor.id,
            VendorPortalAccount.status == VendorPortalAccountStatus.active,
            VendorPortalAccount.revoked_at.is_(None),
            VendorPortalAccount.deleted_at.is_(None),
        )
    )
    now = utcnow()
    if account is None:
        account = VendorPortalAccount(
            entity_id=contractor.entity_id,
            contractor_id=contractor.id,
            vendor_portal_invite_id=invite.id,
            auth_provider="clerk",
            auth_provider_id=provider_id,
            email=contractor.email or invite.claim_email,
            status=VendorPortalAccountStatus.active,
            linked_at=now,
            last_seen_at=now,
            account_metadata={
                "source": "vendor_portal_claim",
                "vendor_portal_invite_id": str(invite.id),
            },
        )
        session.add(account)
    else:
        account.vendor_portal_invite_id = invite.id
        account.email = account.email or contractor.email or invite.claim_email
        account.last_seen_at = now
        account.account_metadata = {
            **(account.account_metadata or {}),
            "last_claimed_at": now.isoformat(),
            "vendor_portal_invite_id": str(invite.id),
        }
    if invite.consumed_at is None:
        invite.consumed_at = now
    contractor_id = contractor.id
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if not _is_active_provider_integrity_error(exc):
            raise
        active_accounts = _active_vendor_portal_accounts(provider_id, session)
        if any(account.contractor_id != contractor_id for account in active_accounts):
            raise _vendor_portal_login_already_linked_error() from None
        account = next(
            (
                active_account
                for active_account in active_accounts
                if active_account.contractor_id == contractor_id
            ),
            None,
        )
        if account is None:
            raise
        contractor = _contractor_for_account(account, session)
        account.last_seen_at = utcnow()
        session.commit()
        session.refresh(account)
        session.refresh(contractor)
        return _vendor_account_read(contractor, session)
    session.refresh(account)
    session.refresh(contractor)
    return _vendor_account_read(contractor, session)


@router.get("/account/status", response_model=VendorPortalAccountLifecycleRead)
def get_vendor_portal_account_status(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> VendorPortalAccountLifecycleRead:
    identity = _vendor_portal_identity(authorization, settings)
    provider_id = identity.provider_id
    active_accounts = _active_vendor_portal_accounts(provider_id, session)
    _assert_vendor_portal_accounts_unambiguous(active_accounts)
    if active_accounts:
        account = active_accounts[0]
        contractor = session.get(Contractor, account.contractor_id)
        return VendorPortalAccountLifecycleRead(
            status="active",
            contractor_id=account.contractor_id,
            vendor_name=_vendor_display_name(contractor) if contractor is not None else None,
            email=account.email,
            linked_at=account.linked_at,
            last_seen_at=account.last_seen_at,
            revoked_at=account.revoked_at,
            recovery_hint=(
                "This contractor login can open the vendor portal without the "
                "original claim link."
            ),
        )

    revoked_account = session.scalar(
        select(VendorPortalAccount)
        .where(
            VendorPortalAccount.auth_provider == "clerk",
            VendorPortalAccount.auth_provider_id == provider_id,
            VendorPortalAccount.revoked_at.is_not(None),
            VendorPortalAccount.deleted_at.is_(None),
        )
        .order_by(VendorPortalAccount.updated_at.desc())
    )
    if revoked_account is not None:
        contractor = session.get(Contractor, revoked_account.contractor_id)
        return VendorPortalAccountLifecycleRead(
            status="revoked",
            contractor_id=revoked_account.contractor_id,
            vendor_name=_vendor_display_name(contractor) if contractor is not None else None,
            email=revoked_account.email,
            linked_at=revoked_account.linked_at,
            last_seen_at=revoked_account.last_seen_at,
            revoked_at=revoked_account.revoked_at,
            recovery_hint=(
                "This contractor login was revoked by the property team. Ask them "
                "to restore access or send a fresh vendor portal link."
            ),
        )

    return VendorPortalAccountLifecycleRead(
        status="unlinked",
        recovery_hint=(
            "Open your vendor portal claim link once to connect this login. If the "
            "link expired or was lost, ask the property team for a fresh link."
        ),
    )


@router.get("/account/session", response_model=VendorPortalRead)
def get_vendor_portal_account_session(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> VendorPortalRead:
    identity = _vendor_portal_identity(authorization, settings)
    account = _active_vendor_portal_account(identity.provider_id, session)
    contractor = _contractor_for_account(account, session)
    account.last_seen_at = utcnow()
    session.commit()
    session.refresh(account)
    return _vendor_account_read(contractor, session)


@router.post(
    "/account/work-orders/{work_order_id}/accept",
    response_model=VendorPortalRead,
)
def accept_vendor_portal_work_order(
    work_order_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> VendorPortalRead:
    identity = _vendor_portal_identity(authorization, settings)
    account = _active_vendor_portal_account(identity.provider_id, session)
    contractor = _contractor_for_account(account, session)
    work_order = _shared_work_order_for_account(account, work_order_id, session)
    _assert_actionable(work_order)

    now = utcnow()
    actor = f"vendor:{account.contractor_id}"
    metadata = _metadata_dict(work_order.work_order_metadata)
    metadata[VENDOR_PORTAL_ACCEPTED_AT_KEY] = now.isoformat()
    metadata[VENDOR_PORTAL_ACCEPTED_BY_KEY] = str(account.contractor_id)
    metadata = _append_comment(
        metadata,
        body="Contractor accepted the job.",
        visibility="contractor",
        actor=actor,
        now=now,
    )

    started = False
    if work_order.status in VENDOR_PORTAL_ACCEPT_START_STATUSES:
        work_order.status = MaintenanceWorkOrderStatus.in_progress
        started = True
    summary = (
        "Contractor accepted the job and started work."
        if started
        else "Contractor accepted the job."
    )
    metadata = _append_activity_history(
        metadata,
        actor=actor,
        source="vendor_portal_contractor",
        event="vendor_accepted",
        summary=summary,
        now=now,
        status_value=work_order.status,
    )
    work_order.work_order_metadata = metadata
    _audit_account_action(
        session,
        account=account,
        work_order=work_order,
        action_name="accept",
        summary=(
            "Contractor accepted a shared work order; no contractor/tenant message, "
            "provider dispatch, billing, payment, or reconciliation action ran."
        ),
    )
    account.last_seen_at = now
    session.commit()
    session.refresh(contractor)
    return _vendor_account_read(contractor, session)


@router.post(
    "/account/work-orders/{work_order_id}/comment",
    response_model=VendorPortalRead,
)
def comment_vendor_portal_work_order(
    work_order_id: UUID,
    payload: VendorPortalCommentCreate,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> VendorPortalRead:
    identity = _vendor_portal_identity(authorization, settings)
    account = _active_vendor_portal_account(identity.provider_id, session)
    contractor = _contractor_for_account(account, session)
    work_order = _shared_work_order_for_account(account, work_order_id, session)
    _assert_actionable(work_order)

    now = utcnow()
    actor = f"vendor:{account.contractor_id}"
    metadata = _metadata_dict(work_order.work_order_metadata)
    metadata = _append_comment(
        metadata,
        body=payload.body,
        visibility="contractor",
        actor=actor,
        now=now,
    )
    metadata = _append_activity_history(
        metadata,
        actor=actor,
        source="vendor_portal_contractor",
        event="vendor_comment",
        summary="Contractor posted a job update.",
        now=now,
    )
    metadata = _record_contractor_reply_operator_notification(metadata, now=now)
    work_order.work_order_metadata = metadata
    _audit_account_action(
        session,
        account=account,
        work_order=work_order,
        action_name="comment",
        summary=(
            "Contractor posted a job update and Leasium recorded an operator "
            "in-app cue; no email/SMS, provider, billing, payment, or "
            "reconciliation action ran."
        ),
    )
    account.last_seen_at = now
    session.commit()
    # Future notify hook goes here (in-app only in v1; no SendGrid/Twilio call).
    session.refresh(contractor)
    return _vendor_account_read(contractor, session)


@router.get(
    "/account/work-orders/{work_order_id}/messages",
    response_model=VendorPortalWorkOrderMessagesRead,
)
def get_vendor_portal_work_order_messages(
    work_order_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> VendorPortalWorkOrderMessagesRead:
    """Return the contractor-visible message thread for one shared work order."""

    identity = _vendor_portal_identity(authorization, settings)
    account = _active_vendor_portal_account(identity.provider_id, session)
    contractor = _contractor_for_account(account, session)
    work_order = _shared_work_order_for_account(account, work_order_id, session)
    metadata = _metadata_dict(work_order.work_order_metadata)
    account.last_seen_at = utcnow()
    session.commit()
    return VendorPortalWorkOrderMessagesRead(
        work_order_id=work_order.id,
        title=_vendor_portal_title(metadata),
        messages=_vendor_comments(metadata, contractor),
        guardrails=VENDOR_PORTAL_MESSAGING_GUARDRAILS,
        generated_at=utcnow(),
    )


@router.post(
    "/account/work-orders/{work_order_id}/photo",
    response_model=VendorPortalRead,
)
async def upload_vendor_portal_work_order_photo(
    work_order_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: Annotated[UploadFile, File()],
    authorization: Annotated[str | None, Header()] = None,
) -> VendorPortalRead:
    identity = _vendor_portal_identity(authorization, settings)
    account = _active_vendor_portal_account(identity.provider_id, session)
    contractor = _contractor_for_account(account, session)
    work_order = _shared_work_order_for_account(account, work_order_id, session)
    _assert_actionable(work_order)

    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image files can be attached as job photos.",
        )
    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty."
        )
    max_bytes = settings.document_max_bytes
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Photo is too large. Max size is {max_bytes // 1_000_000}MB.",
        )

    now = utcnow()
    actor = f"vendor:{account.contractor_id}"
    document = StoredDocument(
        entity_id=account.entity_id,
        property_id=work_order.property_id,
        filename=Path(file.filename or "vendor-photo").name,
        content_type=file.content_type,
        byte_size=len(data),
        file_data=data,
        category=DocumentCategory.other,
        document_metadata={
            "source": "vendor_portal_photo",
            "maintenance_work_order_id": str(work_order.id),
            "vendor_portal_contractor_id": str(account.contractor_id),
            "uploaded_at": now.isoformat(),
        },
    )
    session.add(document)
    session.flush()

    attachments = dict(work_order.attachments or {})
    photo_ids = [str(value) for value in attachments.get("photo_document_ids", [])]
    photo_ids.append(str(document.id))
    attachments["photo_document_ids"] = photo_ids
    work_order.attachments = attachments

    metadata = _metadata_dict(work_order.work_order_metadata)
    metadata = _append_comment(
        metadata,
        body="Contractor added a job photo.",
        visibility="contractor",
        actor=actor,
        now=now,
    )
    metadata = _append_activity_history(
        metadata,
        actor=actor,
        source="vendor_portal_contractor",
        event="vendor_photo_added",
        summary="Contractor uploaded a job photo.",
        now=now,
    )
    work_order.work_order_metadata = metadata
    _audit_account_action(
        session,
        account=account,
        work_order=work_order,
        action_name="photo",
        summary=(
            "Contractor uploaded a job photo; no message was sent, no provider, "
            "billing, payment, or reconciliation action ran."
        ),
    )
    account.last_seen_at = now
    session.commit()
    session.refresh(contractor)
    return _vendor_account_read(contractor, session)


@router.get("/{contractor_id}", response_model=VendorPortalRead)
def get_vendor_portal(
    contractor_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> VendorPortalRead:
    """Return a contractor-safe, read-only operator preview."""

    contractor = _get_contractor_for_user(contractor_id, user, session)
    return VendorPortalRead(
        auth=VendorPortalAuthRead(
            mode="operator_preview",
            token_source="bearer",
            vendor_auth_configured=False,
            boundary="operator_session",
            detail=(
                "Read-only operator preview scoped by entity role; no vendor portal "
                "account is created."
            ),
        ),
        vendor=_vendor_read(contractor),
        work_orders=_vendor_work_orders(contractor, session),
        guardrails=VENDOR_PORTAL_GUARDRAILS,
        generated_at=utcnow(),
    )
