"""Review-first spreadsheet import routes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import UserRole
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
    return RegisterImportDryRunRead.model_validate(dry_run)


@router.post("/apply", response_model=RegisterImportApplyRead)
def apply_register_import(
    payload: RegisterImportApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> RegisterImportApplyRead:
    """Apply only user-approved actions from a reviewed spreadsheet dry-run plan."""

    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    try:
        result = apply_register_import_plan(
            session=session,
            entity_id=payload.entity_id,
            filename=payload.filename,
            action_items=[item.model_dump(mode="json") for item in payload.action_items],
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
                "filename": payload.filename,
                "action_id": item["action_id"],
            },
            tool_output_summary=item["message"],
        )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=payload.entity_id,
        action="apply",
        tool_name="register_import_apply",
        tool_input={
            "filename": payload.filename,
            "approved_action_ids": payload.approved_action_ids,
            "ignored_action_ids": payload.ignored_action_ids,
        },
        tool_output_summary=(
            f"Applied {result['applied']} register import actions; "
            f"{result['blocked']} blocked and {result['skipped']} skipped."
        ),
    )
    session.commit()
    return RegisterImportApplyRead.model_validate(result)
