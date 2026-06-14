"""AI Mailbox virtual client alias management (platform-admin only).

Platform admins reserve/list/disable aliases across client organisations. The
read-only operator display of an organisation's own alias (the ``/inbox``
copy-address affordance) lives beside the AI Mailbox read APIs in
``apps/api/routers/comms.py``, not here.

Aliases map a virtual recipient address (``local_part@domain``) to one
organisation. The inbound webhook (``apps/api/routers/comms.py``) resolves the
organisation from the alias *before* sender trust or AI classification, so this
is the multi-client routing control surface. No provider send fires here; every
mutation is audited. See docs/ai-mailbox-intake-design.md.
"""

import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import MailboxAlias, Organisation
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, get_session, require_platform_admin
from apps.api.schemas.mailbox_aliases import (
    MailboxAliasCreate,
    MailboxAliasListRead,
    MailboxAliasRead,
    MailboxAliasUpdate,
)

router = APIRouter(prefix="/mailbox-aliases", tags=["mailbox-aliases"])

# Only the single SendGrid Inbound Parse domain the webhook treats as AI Mailbox
# traffic can route; reserving any other domain would never receive mail.
ALLOWED_ALIAS_DOMAINS = {"inbox.leasium.ai"}
ALLOWED_ALIAS_STATUSES = {"active", "disabled"}
_LOCAL_PART_PATTERN = re.compile(r"^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$")


def _normalise_local_part(local_part: str) -> str:
    normalised = local_part.strip().lower()
    if not _LOCAL_PART_PATTERN.fullmatch(normalised):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="local_part must be lowercase letters/digits with . _ - separators.",
        )
    return normalised


def _resolve_domain(domain: str | None) -> str:
    resolved = (domain or "inbox.leasium.ai").strip().lower()
    if resolved not in ALLOWED_ALIAS_DOMAINS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"domain must be one of: {', '.join(sorted(ALLOWED_ALIAS_DOMAINS))}.",
        )
    return resolved


@router.post("", response_model=MailboxAliasRead, status_code=status.HTTP_201_CREATED)
def reserve_mailbox_alias(
    payload: MailboxAliasCreate,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MailboxAlias:
    organisation = session.get(Organisation, payload.organisation_id)
    if organisation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found.")
    if organisation.id == settings.platform_organisation_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The reserved platform organisation cannot hold a client mailbox alias.",
        )

    local_part = _normalise_local_part(payload.local_part)
    domain = _resolve_domain(payload.domain)
    email_address = f"{local_part}@{domain}"

    existing = session.scalar(
        select(MailboxAlias).where(
            MailboxAlias.email_address == email_address,
            MailboxAlias.deleted_at.is_(None),
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active alias already exists for this address.",
        )

    alias = MailboxAlias(
        organisation_id=organisation.id,
        local_part=local_part,
        domain=domain,
        email_address=email_address,
        label=payload.label,
        status="active",
        created_by_user_id=admin.id,
    )
    session.add(alias)
    session.flush()
    audit_log(
        session,
        actor=admin.actor,
        user_id=admin.id,
        target_table="mailbox_alias",
        target_id=alias.id,
        action="reserve",
        tool_name="platform.mailbox_alias_reserve",
        tool_input={"organisation_id": str(organisation.id), "email_address": email_address},
    )
    session.commit()
    session.refresh(alias)
    return alias


@router.get("", response_model=MailboxAliasListRead)
def list_mailbox_aliases(
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
    organisation_id: UUID | None = None,
) -> MailboxAliasListRead:
    query = select(MailboxAlias).where(MailboxAlias.deleted_at.is_(None))
    if organisation_id is not None:
        query = query.where(MailboxAlias.organisation_id == organisation_id)
    aliases = session.scalars(query.order_by(MailboxAlias.created_at)).all()
    return MailboxAliasListRead(aliases=[MailboxAliasRead.model_validate(a) for a in aliases])


@router.patch("/{alias_id}", response_model=MailboxAliasRead)
def update_mailbox_alias(
    alias_id: UUID,
    payload: MailboxAliasUpdate,
    admin: Annotated[CurrentUser, Depends(require_platform_admin)],
    session: Annotated[Session, Depends(get_session)],
) -> MailboxAlias:
    alias = session.get(MailboxAlias, alias_id)
    if alias is None or alias.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Mailbox alias not found."
        )

    changes: dict[str, str | None] = {}
    if payload.status is not None:
        if payload.status not in ALLOWED_ALIAS_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"status must be one of: {', '.join(sorted(ALLOWED_ALIAS_STATUSES))}.",
            )
        alias.status = payload.status
        changes["status"] = payload.status
    if payload.label is not None:
        alias.label = payload.label
        changes["label"] = payload.label

    if changes:
        audit_log(
            session,
            actor=admin.actor,
            user_id=admin.id,
            target_table="mailbox_alias",
            target_id=alias.id,
            action="update",
            tool_name="platform.mailbox_alias_update",
            tool_input={"alias_id": str(alias.id), **changes},
        )
    session.commit()
    session.refresh(alias)
    return alias
