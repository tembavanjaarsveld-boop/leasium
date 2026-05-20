"""Review-first spreadsheet import routes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import RegisterImportPlan, UserRole
from stewart.domain.register_import import (
    RegisterImportError,
    apply_register_import_plan,
    build_register_import_dry_run,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register_import import (
    RegisterImportApplyRead,
    RegisterImportApplyRequest,
    RegisterImportDryRunRead,
)

router = APIRouter(prefix="/register-imports", tags=["register-imports"])

WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
SUPPORTED_CONTENT_TYPES = {
    "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _validate_workbook_upload(filename: str, content_type: str | None) -> None:
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Register imports currently support .xlsx workbooks.",
        )
    if content_type and content_type not in SUPPORTED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Register imports currently support .xlsx workbooks.",
        )


@router.post("/dry-run", response_model=RegisterImportDryRunRead)
async def dry_run_register_import(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Form()],
    file: Annotated[UploadFile, File()],
) -> RegisterImportDryRunRead:
    """Read a source-of-truth workbook and return a no-mutation import plan."""

    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    _validate_workbook_upload(file.filename or "", file.content_type)
    content = await file.read()
    try:
        dry_run = build_register_import_dry_run(
            session=session,
            entity_id=entity_id,
            filename=file.filename or "register-import.xlsx",
            content=content,
        )
    except RegisterImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    dry_run_read = RegisterImportDryRunRead.model_validate(dry_run)
    plan = RegisterImportPlan(
        entity_id=entity_id,
        filename=dry_run_read.filename,
        plan_data=dry_run_read.model_dump(mode="json", exclude={"plan_id"}),
        created_by_user_id=user.id,
    )
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return dry_run_read.model_copy(update={"plan_id": plan.id})


@router.post("/apply", response_model=RegisterImportApplyRead)
def apply_register_import(
    payload: RegisterImportApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> RegisterImportApplyRead:
    """Apply only user-approved actions from a reviewed spreadsheet dry-run plan."""

    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    filename = payload.filename
    action_items = [item.model_dump(mode="json") for item in payload.action_items]
    plan: RegisterImportPlan | None = None
    if payload.plan_id is not None:
        plan = session.scalar(
            select(RegisterImportPlan).where(
                RegisterImportPlan.id == payload.plan_id,
                RegisterImportPlan.entity_id == payload.entity_id,
                RegisterImportPlan.deleted_at.is_(None),
            )
        )
        if plan is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Register import plan not found.",
            )
        if plan.applied_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Register import plan has already been applied.",
            )
        plan_data = dict(plan.plan_data or {})
        filename = str(plan_data.get("filename") or plan.filename)
        raw_action_items = plan_data.get("action_items")
        if not isinstance(raw_action_items, list):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Register import plan has no stored action items.",
            )
        action_items = raw_action_items

    try:
        result = apply_register_import_plan(
            session=session,
            entity_id=payload.entity_id,
            filename=filename,
            action_items=action_items,
            approved_action_ids=payload.approved_action_ids,
            ignored_action_ids=payload.ignored_action_ids,
        )
    except RegisterImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    for item in result["results"]:
        if item["status"] != "applied" or item.get("target_id") is None:
            continue
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action=item["operation"],
            target_table=item.get("target_table"),
            target_id=item["target_id"],
            tool_name="register_import_apply",
            tool_input={
                "filename": filename,
                "plan_id": str(payload.plan_id) if payload.plan_id else None,
                "action_id": item["action_id"],
            },
            tool_output_summary=item["message"],
        )
    result_read = RegisterImportApplyRead.model_validate(result)
    if plan is not None:
        plan.applied_at = result_read.applied_at
        plan.applied_by_user_id = user.id
        plan_data = dict(plan.plan_data or {})
        plan_data["apply_result"] = result_read.model_dump(mode="json")
        plan_data["approved_action_ids"] = list(payload.approved_action_ids)
        plan_data["ignored_action_ids"] = list(payload.ignored_action_ids)
        plan_data["notes"] = payload.notes
        plan.plan_data = plan_data
        plan.updated_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=payload.entity_id,
        action="apply",
        tool_name="register_import_apply",
        tool_input={
            "filename": filename,
            "plan_id": str(payload.plan_id) if payload.plan_id else None,
            "approved_action_ids": payload.approved_action_ids,
            "ignored_action_ids": payload.ignored_action_ids,
        },
        tool_output_summary=(
            f"Applied {result['applied']} register import actions; "
            f"{result['blocked']} blocked and {result['skipped']} skipped."
        ),
    )
    session.commit()
    return result_read
