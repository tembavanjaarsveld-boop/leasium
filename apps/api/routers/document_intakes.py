"""Smart Intake routes for review-first document ingestion."""

from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from stewart.ai.document_intake import DocumentExtractionError, extract_document_file
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    DocumentCategory,
    DocumentIntake,
    DocumentIntakeStatus,
    StoredDocument,
    UserRole,
)
from stewart.core.settings import get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.document_intake import DocumentIntakeRead

router = APIRouter(prefix="/document-intakes", tags=["document-intakes"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
SUPPORTED_EXTENSIONS = {".docx", ".pdf", ".txt", ".md"}
SUPPORTED_CONTENT_TYPES = {
    "application/octet-stream",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/markdown",
    "text/plain",
}


def _read_intake(intake: DocumentIntake) -> DocumentIntakeRead:
    document = intake.document
    return DocumentIntakeRead.model_validate(
        {
            "id": intake.id,
            "entity_id": intake.entity_id,
            "document_id": intake.document_id,
            "status": intake.status,
            "document_type": intake.document_type,
            "summary": intake.summary,
            "confidence": intake.confidence,
            "extracted_data": intake.extracted_data,
            "review_data": intake.review_data,
            "openai_response_id": intake.openai_response_id,
            "error_message": intake.error_message,
            "reviewed_at": intake.reviewed_at,
            "reviewed_by_user_id": intake.reviewed_by_user_id,
            "applied_at": intake.applied_at,
            "applied_by_user_id": intake.applied_by_user_id,
            "created_at": intake.created_at,
            "updated_at": intake.updated_at,
            "filename": document.filename,
            "content_type": document.content_type,
            "byte_size": document.byte_size,
            "category": document.category,
        }
    )


def _validate_upload(filename: str, content_type: str | None) -> None:
    if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Smart Intake supports PDF, Word, TXT, and Markdown files.",
        )
    if content_type and content_type not in SUPPORTED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Smart Intake supports PDF, Word, TXT, and Markdown files.",
        )


def _document_category(document_type: str | None) -> DocumentCategory:
    match document_type:
        case "lease":
            return DocumentCategory.lease
        case "insurance_certificate":
            return DocumentCategory.insurance
        case "bank_guarantee":
            return DocumentCategory.bank_guarantee
        case "invoice_admin":
            return DocumentCategory.invoice
        case "tenant_document":
            return DocumentCategory.onboarding
        case _:
            return DocumentCategory.other


def _confidence(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return min(max(number, 0), 1)


def _status_for_extraction(extracted: dict[str, Any]) -> DocumentIntakeStatus:
    document_type = extracted.get("document_type")
    if document_type == "unknown":
        return DocumentIntakeStatus.needs_attention
    if extracted.get("warnings") or extracted.get("missing_information"):
        return DocumentIntakeStatus.needs_attention
    return DocumentIntakeStatus.ready_for_review


def _audit_extract(
    intake: DocumentIntake,
    user: CurrentUser,
    session: Session,
    *,
    outcome: AuditOutcome = AuditOutcome.success,
    error_message: str | None = None,
) -> None:
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=intake.entity_id,
        action="extract",
        target_table="document_intake",
        target_id=intake.id,
        tool_name="openai.responses",
        tool_input={
            "filename": intake.document.filename,
            "byte_size": intake.document.byte_size,
        },
        tool_output_summary=None if error_message else "Document review prepared.",
        outcome=outcome,
        error_message=error_message,
    )


def _extract_into_intake(intake: DocumentIntake, user: CurrentUser, session: Session) -> None:
    settings = get_settings()
    document = intake.document
    intake.status = DocumentIntakeStatus.reading
    intake.error_message = None
    session.flush()
    try:
        extracted, response_id = extract_document_file(
            file_data=document.file_data,
            filename=document.filename,
            content_type=document.content_type,
            settings=settings,
        )
    except DocumentExtractionError as exc:
        intake.status = DocumentIntakeStatus.failed
        intake.error_message = str(exc)
        _audit_extract(
            intake,
            user,
            session,
            outcome=AuditOutcome.error,
            error_message=str(exc),
        )
        return

    document_type = str(extracted.get("document_type") or "unknown")
    summary = str(extracted.get("summary") or "").strip() or None
    intake.status = _status_for_extraction(extracted)
    intake.document_type = document_type
    intake.summary = summary
    intake.confidence = _confidence(extracted.get("confidence"))
    intake.extracted_data = extracted
    intake.review_data = {}
    intake.openai_response_id = response_id
    document.category = _document_category(document_type)
    document.document_metadata = {
        **(document.document_metadata or {}),
        "smart_intake_id": str(intake.id),
        "document_type": document_type,
    }
    _audit_extract(intake, user, session)


def _extract_intake_background(intake_id: UUID, user: CurrentUser, bind: Any) -> None:
    BackgroundSession = sessionmaker(
        bind=bind,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    with BackgroundSession() as session:
        intake = session.get(DocumentIntake, intake_id)
        if intake is None or intake.deleted_at is not None:
            return
        if intake.status == DocumentIntakeStatus.applied:
            return
        intake.status = DocumentIntakeStatus.reading
        intake.error_message = None
        session.commit()
        _extract_into_intake(intake, user, session)
        session.commit()


def _get_intake(
    intake_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> DocumentIntake:
    intake = session.get(DocumentIntake, intake_id)
    if intake is None or intake.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document intake not found.",
        )
    assert_entity_role(session, user, intake.entity_id, roles)
    return intake


@router.get("", response_model=list[DocumentIntakeRead])
def list_document_intakes(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID,
) -> list[DocumentIntakeRead]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    intakes = session.scalars(
        select(DocumentIntake)
        .where(DocumentIntake.entity_id == entity_id, DocumentIntake.deleted_at.is_(None))
        .order_by(DocumentIntake.created_at.desc())
    ).all()
    return [_read_intake(intake) for intake in intakes]


@router.post("", response_model=DocumentIntakeRead, status_code=status.HTTP_201_CREATED)
async def create_document_intake(
    background_tasks: BackgroundTasks,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Form()],
    file: Annotated[UploadFile, File()],
    extract: Annotated[bool, Form()] = True,
) -> DocumentIntakeRead:
    settings = get_settings()
    assert_entity_role(session, user, entity_id, WRITE_ROLES)

    filename = Path(file.filename or "document").name
    _validate_upload(filename, file.content_type)
    data = await file.read(settings.document_max_bytes + 1)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File is empty.",
        )
    if len(data) > settings.document_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Document is larger than the configured intake limit.",
        )

    document = StoredDocument(
        entity_id=entity_id,
        filename=filename,
        content_type=file.content_type,
        byte_size=len(data),
        file_data=data,
        category=DocumentCategory.other,
        notes="Smart Intake upload",
        document_metadata={"source": "smart_intake"},
    )
    session.add(document)
    session.flush()
    intake = DocumentIntake(
        entity_id=entity_id,
        document_id=document.id,
        status=DocumentIntakeStatus.uploaded,
        extracted_data={},
        review_data={},
    )
    session.add(intake)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="upload",
        target_table="document_intake",
        target_id=intake.id,
        tool_input={"filename": filename, "byte_size": len(data)},
    )
    session.commit()
    session.refresh(intake)
    if extract:
        background_tasks.add_task(_extract_intake_background, intake.id, user, session.get_bind())
    return _read_intake(intake)


@router.get("/{intake_id}", response_model=DocumentIntakeRead)
def get_document_intake(
    intake_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> DocumentIntakeRead:
    return _read_intake(_get_intake(intake_id, user, session, READ_ROLES))


@router.post("/{intake_id}/extract", response_model=DocumentIntakeRead)
def extract_document_intake(
    intake_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> DocumentIntakeRead:
    intake = _get_intake(intake_id, user, session, WRITE_ROLES)
    if intake.status == DocumentIntakeStatus.applied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Applied document intakes cannot be extracted again.",
        )
    _extract_into_intake(intake, user, session)
    session.commit()
    session.refresh(intake)
    if intake.status == DocumentIntakeStatus.failed:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=intake.error_message or "Document extraction failed.",
        )
    return _read_intake(intake)


@router.delete("/{intake_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document_intake(
    intake_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    intake = _get_intake(intake_id, user, session, WRITE_ROLES)
    now = utcnow()
    intake.deleted_at = now
    intake.document.deleted_at = now
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=intake.entity_id,
        action="delete",
        target_table="document_intake",
        target_id=intake.id,
        tool_input={"document_id": str(intake.document_id)},
    )
    session.commit()
