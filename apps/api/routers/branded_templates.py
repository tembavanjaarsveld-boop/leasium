"""Branded communication template API (read + operator CRUD).

Operators can override the in-code default communication templates per entity
(work_assignment_notification, invoice_delivery, maintenance_contractor_update,
etc.) without code changes. This module exposes list/detail reads plus
operator create/update/soft-delete. System-seeded rows (``is_system``) can have
their content edited but cannot be deleted. Editing a template never sends a
message — provider sends stay behind the existing review-first dispatch paths.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import BrandedCommunicationTemplate, UserRole
from stewart.integrations.communications import (
    SYSTEM_BRANDED_TEMPLATE_SEEDS,
    WorkAssignmentDigestEmail,
    WorkAssignmentDigestEmailItem,
    WorkAssignmentEmail,
    WorkAssignmentSms,
    render_template_string,
    work_assignment_digest_context,
    work_assignment_email_context,
    work_assignment_sms_context,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.branded_templates import (
    BrandedTemplateCreate,
    BrandedTemplateRead,
    BrandedTemplateRenderPreview,
    BrandedTemplateRenderPreviewRead,
    BrandedTemplateUpdate,
    BrandedTemplateVersionCreate,
)

router = APIRouter(
    prefix="/branded-communication-templates",
    tags=["branded-communication-templates"],
)

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance}

_DUPLICATE_DETAIL = (
    "An active template already exists for this key and version. Edit it or use "
    "a new version."
)

_VERSION_PATTERN = re.compile(r"^v(\d+)$")

RENDER_PREVIEW_GUARDRAILS = [
    "Render preview is review-only; it saves nothing and never sends any message.",
    "Sample data is fictional and only used to substitute template tokens.",
]

_SAMPLE_EMAIL_INVITE = WorkAssignmentEmail(
    target_id=UUID("00000000-0000-7000-8000-00000000a001"),
    target_type="maintenance_work_order",
    entity_id=UUID("00000000-0000-7000-8000-00000000a002"),
    work_kind="Maintenance",
    title="Replace shopfront lock",
    description="Tenant reported the rear lock is sticking.",
    due_date=date(2026, 6, 12),
    assignee_name="Avery Operator",
    assignee_email="avery.operator@example.com",
    assigned_by_name="Temba van Jaarsveld",
    work_url="https://relby.ai/operations/maintenance/sample",
    template_key="work_assignment_notification",
    template_version="v1",
)
_SAMPLE_SMS_INVITE = WorkAssignmentSms(
    target_id=_SAMPLE_EMAIL_INVITE.target_id,
    target_type="maintenance_work_order",
    entity_id=_SAMPLE_EMAIL_INVITE.entity_id,
    work_kind="Maintenance",
    title="Replace shopfront lock",
    description="Tenant reported the rear lock is sticking.",
    due_date=date(2026, 6, 12),
    assignee_name="Avery Operator",
    assignee_phone="+61400111222",
    assigned_by_name="Temba van Jaarsveld",
    work_url="https://relby.ai/operations/maintenance/sample",
    template_key="work_assignment_notification",
    template_version="v1",
)
_SAMPLE_DIGEST_INVITE = WorkAssignmentDigestEmail(
    entity_id=_SAMPLE_EMAIL_INVITE.entity_id,
    assignee_user_id=UUID("00000000-0000-7000-8000-00000000a003"),
    assignee_name="Avery Operator",
    assignee_email="avery.operator@example.com",
    cadence="daily",
    generated_at=utcnow(),
    item_count=2,
    follow_up_due_count=1,
    ready_count=1,
    attention_count=1,
    in_flight_count=0,
    done_count=0,
    items=[
        WorkAssignmentDigestEmailItem(
            title="Replace shopfront lock",
            work_kind="Maintenance",
            due_date=date(2026, 6, 12),
            status="requested",
            priority="high",
            follow_up_due=True,
            work_url="https://relby.ai/operations/maintenance/sample",
        ),
        WorkAssignmentDigestEmailItem(
            title="Chase June arrears reminder",
            work_kind="Arrears",
            due_date=date(2026, 6, 15),
            status="open",
            priority="arrears",
            follow_up_due=False,
            work_url=None,
        ),
    ],
    template_key="work_assignment_digest",
    template_version="v1",
)

SAMPLE_TEMPLATE_CONTEXTS: dict[str, dict[str, str]] = {
    "work_assignment_notification": work_assignment_email_context(_SAMPLE_EMAIL_INVITE),
    "work_assignment_follow_up": work_assignment_email_context(_SAMPLE_EMAIL_INVITE),
    "work_assignment_digest": work_assignment_digest_context(_SAMPLE_DIGEST_INVITE),
    "work_assignment_digest_owner_review": work_assignment_digest_context(
        _SAMPLE_DIGEST_INVITE
    ),
}


def _sample_context(key: str, channel: str) -> dict[str, str]:
    context = SAMPLE_TEMPLATE_CONTEXTS.get(key)
    if context is not None:
        return context
    if channel == "sms":
        return work_assignment_sms_context(_SAMPLE_SMS_INVITE)
    return work_assignment_email_context(_SAMPLE_EMAIL_INVITE)


def seed_system_branded_templates(
    session: Session,
    entity_id: UUID,
) -> list[BrandedCommunicationTemplate]:
    """Insert-if-missing the system default v1 EMAIL templates for an entity.

    Idempotent and review-only: seeding templates never sends a message. The
    Alembic data seed (20260608_0037) applies the same
    ``SYSTEM_BRANDED_TEMPLATE_SEEDS`` rows for existing databases; tests use
    this helper because the test database is created via ``metadata.create_all``
    and never runs migrations.
    """

    created: list[BrandedCommunicationTemplate] = []
    for seed in SYSTEM_BRANDED_TEMPLATE_SEEDS:
        existing = session.scalar(
            select(BrandedCommunicationTemplate.id).where(
                BrandedCommunicationTemplate.entity_id == entity_id,
                BrandedCommunicationTemplate.key == seed["key"],
                BrandedCommunicationTemplate.version == "v1",
                BrandedCommunicationTemplate.deleted_at.is_(None),
            )
        )
        if existing is not None:
            continue
        template = BrandedCommunicationTemplate(
            entity_id=entity_id,
            key=seed["key"],
            version="v1",
            channel=seed["channel"],
            provider=seed["provider"],
            name=seed["name"],
            subject_template=seed["subject_template"],
            body_template=seed["body_template"],
            notes=seed["notes"],
            is_active=True,
            is_system=True,
            template_metadata={},
        )
        session.add(template)
        created.append(template)
    session.flush()
    return created


def _next_version(session: Session, entity_id: UUID, key: str) -> str:
    versions = session.scalars(
        select(BrandedCommunicationTemplate.version).where(
            BrandedCommunicationTemplate.entity_id == entity_id,
            BrandedCommunicationTemplate.key == key,
            BrandedCommunicationTemplate.deleted_at.is_(None),
        )
    ).all()
    highest = 0
    for version in versions:
        match = _VERSION_PATTERN.match(version.strip())
        if match is not None:
            highest = max(highest, int(match.group(1)))
    return f"v{highest + 1}"


def _active_conflict(
    entity_id: UUID,
    key: str,
    version: str,
    session: Session,
    *,
    exclude_id: UUID | None = None,
) -> bool:
    query = select(BrandedCommunicationTemplate.id).where(
        BrandedCommunicationTemplate.entity_id == entity_id,
        BrandedCommunicationTemplate.key == key,
        BrandedCommunicationTemplate.version == version,
        BrandedCommunicationTemplate.is_active.is_(True),
        BrandedCommunicationTemplate.deleted_at.is_(None),
    )
    if exclude_id is not None:
        query = query.where(BrandedCommunicationTemplate.id != exclude_id)
    return session.scalar(query) is not None


def _get_template_for_write(
    template_id: UUID,
    user: CurrentUser,
    session: Session,
) -> BrandedCommunicationTemplate:
    template = session.get(BrandedCommunicationTemplate, template_id)
    if template is None or template.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Branded template not found.",
        )
    assert_entity_role(session, user, template.entity_id, WRITE_ROLES)
    return template


@router.get("", response_model=list[BrandedTemplateRead])
def list_branded_templates(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    include_inactive: bool = False,
) -> list[BrandedCommunicationTemplate]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    query = select(BrandedCommunicationTemplate).where(
        BrandedCommunicationTemplate.entity_id == entity_id,
        BrandedCommunicationTemplate.deleted_at.is_(None),
    )
    if not include_inactive:
        query = query.where(BrandedCommunicationTemplate.is_active.is_(True))
    query = query.order_by(
        BrandedCommunicationTemplate.key,
        BrandedCommunicationTemplate.version,
        BrandedCommunicationTemplate.updated_at.desc(),
    )
    return list(session.scalars(query).all())


@router.get("/{template_id}", response_model=BrandedTemplateRead)
def get_branded_template(
    template_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BrandedCommunicationTemplate:
    template = session.get(BrandedCommunicationTemplate, template_id)
    if template is None or template.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Branded template not found.",
        )
    assert_entity_role(session, user, template.entity_id, READ_ROLES)
    return template


@router.post(
    "",
    response_model=BrandedTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def create_branded_template(
    payload: BrandedTemplateCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BrandedCommunicationTemplate:
    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    if payload.is_active and _active_conflict(
        payload.entity_id, payload.key, payload.version, session
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_DUPLICATE_DETAIL)
    template = BrandedCommunicationTemplate(
        entity_id=payload.entity_id,
        key=payload.key,
        version=payload.version,
        channel=payload.channel,
        provider=payload.provider,
        name=payload.name,
        subject_template=payload.subject_template,
        body_template=payload.body_template,
        action_label=payload.action_label,
        action_url_template=payload.action_url_template,
        notes=payload.notes,
        is_active=payload.is_active,
        is_system=False,
        created_by_user_id=user.id,
        template_metadata=payload.metadata,
    )
    session.add(template)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=payload.entity_id,
        action="create",
        target_table="branded_communication_template",
        target_id=template.id,
        tool_name="branded_template.create",
        tool_output_summary=(
            "Created a branded communication template; editing templates does not "
            "send any message."
        ),
        data_classification="internal",
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_DUPLICATE_DETAIL
        ) from None
    session.refresh(template)
    return template


@router.patch("/{template_id}", response_model=BrandedTemplateRead)
def update_branded_template(
    template_id: UUID,
    payload: BrandedTemplateUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BrandedCommunicationTemplate:
    template = _get_template_for_write(template_id, user, session)
    updates = payload.model_dump(exclude_unset=True)
    if "metadata" in updates:
        value = updates.pop("metadata")
        if value is not None:
            template.template_metadata = value
    reactivating = updates.get("is_active") is True and not template.is_active
    for field, value in updates.items():
        setattr(template, field, value)
    if (reactivating or template.is_active) and _active_conflict(
        template.entity_id,
        template.key,
        template.version,
        session,
        exclude_id=template.id,
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_DUPLICATE_DETAIL)
    template.updated_at = utcnow()
    template.updated_by_user_id = user.id
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=template.entity_id,
        action="update",
        target_table="branded_communication_template",
        target_id=template.id,
        tool_name="branded_template.update",
        tool_output_summary=(
            "Updated a branded communication template; editing templates does not "
            "send any message."
        ),
        data_classification="internal",
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_DUPLICATE_DETAIL
        ) from None
    session.refresh(template)
    return template


@router.delete("/{template_id}", response_model=BrandedTemplateRead)
def delete_branded_template(
    template_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BrandedCommunicationTemplate:
    template = _get_template_for_write(template_id, user, session)
    if template.is_system:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="System templates cannot be deleted; deactivate them instead.",
        )
    now = utcnow()
    template.deleted_at = now
    template.is_active = False
    template.updated_at = now
    template.updated_by_user_id = user.id
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=template.entity_id,
        action="delete",
        target_table="branded_communication_template",
        target_id=template.id,
        tool_name="branded_template.delete",
        tool_output_summary="Soft-deleted a branded communication template.",
        data_classification="internal",
    )
    session.commit()
    session.refresh(template)
    return template


@router.post(
    "/{template_id}/versions",
    response_model=BrandedTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def create_branded_template_version(
    template_id: UUID,
    payload: BrandedTemplateVersionCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BrandedCommunicationTemplate:
    """Snapshot edits as the next version and deactivate the prior active row.

    Prior versions are never deleted — they stay readable via
    ``include_inactive`` so the full history survives. System rows keep their
    ``is_system`` flag; the snapshot is always an operator row.
    """

    source = _get_template_for_write(template_id, user, session)
    updates = payload.model_dump(exclude_unset=True)
    next_version = _next_version(session, source.entity_id, source.key)
    now = utcnow()
    prior_active = session.scalars(
        select(BrandedCommunicationTemplate).where(
            BrandedCommunicationTemplate.entity_id == source.entity_id,
            BrandedCommunicationTemplate.key == source.key,
            BrandedCommunicationTemplate.is_active.is_(True),
            BrandedCommunicationTemplate.deleted_at.is_(None),
        )
    ).all()
    for prior in prior_active:
        prior.is_active = False
        prior.updated_at = now
        prior.updated_by_user_id = user.id
    template = BrandedCommunicationTemplate(
        entity_id=source.entity_id,
        key=source.key,
        version=next_version,
        channel=source.channel,
        provider=source.provider,
        name=updates.get("name") or source.name,
        subject_template=updates.get("subject_template", source.subject_template),
        body_template=updates.get("body_template") or source.body_template,
        action_label=updates.get("action_label", source.action_label),
        action_url_template=updates.get("action_url_template", source.action_url_template),
        notes=updates.get("notes", source.notes),
        is_active=True,
        is_system=False,
        created_by_user_id=user.id,
        updated_by_user_id=user.id,
        template_metadata=dict(source.template_metadata or {}),
    )
    session.add(template)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=source.entity_id,
        action="create",
        target_table="branded_communication_template",
        target_id=template.id,
        tool_name="branded_template.save_version",
        tool_input={
            "source_template_id": str(source.id),
            "key": source.key,
            "version": next_version,
        },
        tool_output_summary=(
            f"Saved branded template version {next_version} and deactivated the "
            "prior active version; editing templates does not send any message."
        ),
        data_classification="internal",
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_DUPLICATE_DETAIL
        ) from None
    session.refresh(template)
    return template


@router.post("/render-preview", response_model=BrandedTemplateRenderPreviewRead)
def render_branded_template_preview(
    payload: BrandedTemplateRenderPreview,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BrandedTemplateRenderPreviewRead:
    """Render a draft template against fictional sample data.

    Review-only: persists nothing and never sends a message.
    """

    assert_entity_role(session, user, payload.entity_id, READ_ROLES)
    context = _sample_context(payload.key, payload.channel)
    subject = (
        render_template_string(payload.subject_template, context)
        if payload.subject_template is not None
        else None
    )
    return BrandedTemplateRenderPreviewRead(
        entity_id=payload.entity_id,
        key=payload.key,
        channel=payload.channel,
        subject=subject,
        body=render_template_string(payload.body_template, context),
        guardrails=RENDER_PREVIEW_GUARDRAILS,
    )
