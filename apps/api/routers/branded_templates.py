"""Branded communication template API (read + operator CRUD).

Operators can override the in-code default communication templates per entity
(work_assignment_notification, invoice_delivery, maintenance_contractor_update,
etc.) without code changes. This module exposes list/detail reads plus
operator create/update/soft-delete. System-seeded rows (``is_system``) can have
their content edited but cannot be deleted. Editing a template never sends a
message — provider sends stay behind the existing review-first dispatch paths.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import BrandedCommunicationTemplate, UserRole

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.branded_templates import (
    BrandedTemplateCreate,
    BrandedTemplateRead,
    BrandedTemplateUpdate,
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
