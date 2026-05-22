"""Branded communication template read-only API.

Operators can override the in-code default communication templates per entity
(work_assignment_notification, invoice_delivery, maintenance_contractor_update,
etc.) without code changes. This first slice exposes list and detail reads
only; create/update/delete + Settings editor land in follow-up commits.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.branded_templates import BrandedTemplateRead
from stewart.core.models import BrandedCommunicationTemplate, UserRole

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


@router.get("", response_model=list[BrandedTemplateRead])
def list_branded_templates(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    include_inactive: bool = False,
) -> list[BrandedCommunicationTemplate]:
    assert_entity_role(user, entity_id, READ_ROLES)
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
    assert_entity_role(user, template.entity_id, READ_ROLES)
    return template
