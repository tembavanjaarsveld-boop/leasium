"""Smart Intake routes for review-first document ingestion."""

from datetime import date
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
    Obligation,
    ObligationCategory,
    ObligationStatus,
    StoredDocument,
    UserRole,
)
from stewart.core.settings import get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.obligations import _validate_obligation_scope
from apps.api.schemas.document_intake import (
    DocumentIntakeApplyRequest,
    DocumentIntakeRead,
    DocumentIntakeReviewRequest,
)

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


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _date(value: Any) -> date | None:
    text = _str(value)
    if text is None:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _reviewed_data(intake: DocumentIntake, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if payload is not None:
        return payload
    review_data = _dict(intake.review_data)
    return review_data or _dict(intake.extracted_data)


def _best_date(records: list[dict[str, Any]], labels: set[str]) -> date | None:
    for record in records:
        value = _date(record.get("date") or record.get("due_date"))
        if value is None:
            continue
        label = (_str(record.get("label")) or _str(record.get("title")) or "").lower()
        if any(fragment in label for fragment in labels):
            return value
    return None


def _first_dated_record(
    records: list[dict[str, Any]],
    labels: set[str] | None = None,
) -> dict[str, Any] | None:
    for record in records:
        if _date(record.get("date") or record.get("due_date")) is None:
            continue
        if not labels:
            return record
        label = (
            _str(record.get("label"))
            or _str(record.get("title"))
            or _str(record.get("category"))
            or ""
        ).lower()
        if any(fragment in label for fragment in labels):
            return record
    return None


def _insurance_due_date(data: dict[str, Any]) -> date | None:
    labels = {
        "expiry",
        "expires",
        "expiration",
        "valid until",
        "policy end",
        "period end",
    }
    due_date = _best_date(_records(data.get("key_dates")), labels)
    if due_date is not None:
        return due_date
    return _best_date(_records(data.get("obligations")), labels)


def _insurance_obligation_title(data: dict[str, Any]) -> str:
    return "Insurance certificate renewal"


def _document_apply_category(document_type: str | None) -> DocumentCategory:
    if document_type == "compliance":
        return DocumentCategory.other
    return _document_category(document_type)


def _category_from_text(value: str | None, fallback: ObligationCategory) -> ObligationCategory:
    if value:
        try:
            return ObligationCategory(value)
        except ValueError:
            lowered = value.lower()
            if "insurance" in lowered:
                return ObligationCategory.insurance
            if "guarantee" in lowered:
                return ObligationCategory.bank_guarantee
            if "compliance" in lowered or "certificate" in lowered:
                return ObligationCategory.compliance
            if "option" in lowered:
                return ObligationCategory.option_notice
            if "review" in lowered and "rent" in lowered:
                return ObligationCategory.rent_review
            if "expiry" in lowered or "expiration" in lowered:
                return ObligationCategory.lease_expiry
    return fallback


def _fallback_obligation_category(document_type: str | None) -> ObligationCategory:
    match document_type:
        case "insurance_certificate":
            return ObligationCategory.insurance
        case "bank_guarantee":
            return ObligationCategory.bank_guarantee
        case "compliance":
            return ObligationCategory.compliance
        case "notice":
            return ObligationCategory.other
        case _:
            return ObligationCategory.other


def _fallback_dated_record(
    data: dict[str, Any],
    document_type: str | None,
) -> tuple[str, date, ObligationCategory, str | None, str | None] | None:
    key_dates = _records(data.get("key_dates"))
    if document_type == "insurance_certificate":
        due_date = _insurance_due_date(data)
        if due_date is None:
            return None
        source_record = _first_dated_record(
            key_dates,
            {
                "expiry",
                "expires",
                "expiration",
                "valid until",
                "policy end",
                "period end",
            },
        )
        return (
            _insurance_obligation_title(data),
            due_date,
            ObligationCategory.insurance,
            "Renew certificate before the policy expires.",
            _str(source_record.get("source_hint")) if source_record else None,
        )
    if document_type == "bank_guarantee":
        source_record = _first_dated_record(
            key_dates,
            {"expiry", "expires", "expiration", "valid until", "review", "renewal"},
        )
        if source_record is None:
            return None
        label = _str(source_record.get("label"))
        return (
            label or "Bank guarantee renewal",
            _date(source_record.get("date")) or _date(source_record.get("due_date")),
            ObligationCategory.bank_guarantee,
            "Review bank guarantee before the recorded date.",
            _str(source_record.get("source_hint")),
        )
    if document_type == "compliance":
        source_record = _first_dated_record(
            key_dates,
            {"expiry", "expires", "due", "renewal", "certificate", "inspection", "review"},
        )
        if source_record is None:
            return None
        label = _str(source_record.get("label"))
        return (
            label or "Compliance follow-up",
            _date(source_record.get("date")) or _date(source_record.get("due_date")),
            ObligationCategory.compliance,
            "Review compliance document before the recorded date.",
            _str(source_record.get("source_hint")),
        )
    if document_type == "notice":
        source_record = _first_dated_record(key_dates)
        if source_record is None:
            return None
        label = _str(source_record.get("label"))
        category = _category_from_text(label, ObligationCategory.other)
        return (
            label or "Notice follow-up",
            _date(source_record.get("date")) or _date(source_record.get("due_date")),
            category,
            "Follow up notice before the recorded date.",
            _str(source_record.get("source_hint")),
        )
    return None


def _obligation_payloads_from_review(
    data: dict[str, Any],
    document_type: str | None,
) -> list[dict[str, Any]]:
    fallback_category = _fallback_obligation_category(document_type)
    payloads: list[dict[str, Any]] = []
    for row in _records(data.get("obligations")):
        due_date = _date(row.get("due_date") or row.get("date"))
        if due_date is None:
            continue
        title = _str(row.get("title")) or _str(row.get("label"))
        if title is None:
            title = "Document follow-up"
        category = _category_from_text(_str(row.get("category")), fallback_category)
        payloads.append(
            {
                "title": title,
                "due_date": due_date,
                "category": category,
                "notes": _str(row.get("notes")),
                "source_hint": _str(row.get("source_hint")),
            }
        )
    if payloads:
        return payloads
    fallback = _fallback_dated_record(data, document_type)
    if fallback is None:
        return []
    title, due_date, category, notes, source_hint = fallback
    if due_date is None:
        return []
    return [
        {
            "title": title,
            "due_date": due_date,
            "category": category,
            "notes": notes,
            "source_hint": source_hint,
        }
    ]


def _apply_document_obligation_intake(
    intake: DocumentIntake,
    data: dict[str, Any],
    payload: DocumentIntakeApplyRequest,
    user: CurrentUser,
    session: Session,
) -> list[Obligation]:
    document_type = _str(data.get("document_type")) or intake.document_type
    obligation_payloads = _obligation_payloads_from_review(data, document_type)
    if not obligation_payloads:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Confirm at least one obligation due date before applying.",
        )
    existing = [
        obligation
        for obligation in session.scalars(
            select(Obligation).where(
                Obligation.entity_id == intake.entity_id,
                Obligation.deleted_at.is_(None),
            )
        )
        if _dict(obligation.obligation_metadata).get("document_intake_id") == str(intake.id)
    ]
    if existing:
        return existing
    document = intake.document
    property_id, tenancy_unit_id, lease_id = _validate_obligation_scope(
        entity_id=intake.entity_id,
        property_id=payload.property_id or document.property_id,
        tenancy_unit_id=payload.tenancy_unit_id or document.tenancy_unit_id,
        lease_id=payload.lease_id or document.lease_id,
        user=user,
        session=session,
        roles=WRITE_ROLES,
    )
    intake.document.property_id = property_id
    intake.document.tenancy_unit_id = tenancy_unit_id
    intake.document.lease_id = lease_id
    obligations: list[Obligation] = []
    for index, obligation_payload in enumerate(obligation_payloads):
        notes = obligation_payload["notes"] or "Created from Smart Intake document."
        obligation = Obligation(
            entity_id=intake.entity_id,
            property_id=property_id,
            tenancy_unit_id=tenancy_unit_id,
            lease_id=lease_id,
            title=obligation_payload["title"],
            category=obligation_payload["category"],
            status=ObligationStatus.upcoming,
            due_date=obligation_payload["due_date"],
            priority=1,
            owner_role=UserRole.ops,
            notes=f"{notes} Source document: {intake.document.filename}.",
            obligation_metadata={
                "source": "document_intake",
                "document_intake_id": str(intake.id),
                "document_id": str(intake.document_id),
                "document_type": document_type,
                "source_hint": obligation_payload["source_hint"],
                "openai_response_id": intake.openai_response_id,
                "review_index": index,
            },
        )
        session.add(obligation)
        obligations.append(obligation)
    session.flush()
    for obligation in obligations:
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=intake.entity_id,
            action="create",
            target_table="obligation",
            target_id=obligation.id,
            tool_input={"document_intake_id": str(intake.id), "document_type": document_type},
            tool_output_summary=(
                f"Created {obligation.category.value} obligation due "
                f"{obligation.due_date.isoformat()}."
            ),
        )
    return obligations


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


@router.post("/from-document/{document_id}", response_model=DocumentIntakeRead)
def create_document_intake_from_document(
    background_tasks: BackgroundTasks,
    document_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    extract: bool = True,
) -> DocumentIntakeRead:
    document = session.get(StoredDocument, document_id)
    if document is None or document.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )
    assert_entity_role(session, user, document.entity_id, WRITE_ROLES)
    _validate_upload(document.filename, document.content_type)
    existing = session.scalar(
        select(DocumentIntake).where(
            DocumentIntake.document_id == document.id,
            DocumentIntake.deleted_at.is_(None),
        )
    )
    if existing is not None:
        if extract and existing.status in {
            DocumentIntakeStatus.uploaded,
            DocumentIntakeStatus.failed,
        }:
            background_tasks.add_task(
                _extract_intake_background,
                existing.id,
                user,
                session.get_bind(),
            )
        return _read_intake(existing)

    intake = DocumentIntake(
        entity_id=document.entity_id,
        document_id=document.id,
        status=DocumentIntakeStatus.uploaded,
        extracted_data={},
        review_data={},
    )
    session.add(intake)
    session.flush()
    document.document_metadata = {
        **(document.document_metadata or {}),
        "smart_intake_id": str(intake.id),
        "smart_intake_promoted": True,
    }
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=document.entity_id,
        action="promote",
        target_table="document_intake",
        target_id=intake.id,
        tool_input={"document_id": str(document.id), "filename": document.filename},
    )
    session.commit()
    session.refresh(intake)
    if extract:
        background_tasks.add_task(_extract_intake_background, intake.id, user, session.get_bind())
    return _read_intake(intake)


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


@router.post("/{intake_id}/review", response_model=DocumentIntakeRead)
def review_document_intake(
    intake_id: UUID,
    payload: DocumentIntakeReviewRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> DocumentIntakeRead:
    intake = _get_intake(intake_id, user, session, WRITE_ROLES)
    if intake.status == DocumentIntakeStatus.applied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Applied document intakes cannot be reviewed again.",
        )
    if intake.status not in {
        DocumentIntakeStatus.ready_for_review,
        DocumentIntakeStatus.needs_attention,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document intake is not ready to review.",
        )
    intake.review_data = payload.review_data
    intake.reviewed_at = utcnow()
    intake.reviewed_by_user_id = user.id
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=intake.entity_id,
        action="review",
        target_table="document_intake",
        target_id=intake.id,
    )
    session.commit()
    session.refresh(intake)
    return _read_intake(intake)


@router.post("/{intake_id}/apply", response_model=DocumentIntakeRead)
def apply_document_intake(
    intake_id: UUID,
    payload: DocumentIntakeApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> DocumentIntakeRead:
    intake = _get_intake(intake_id, user, session, WRITE_ROLES)
    if intake.status == DocumentIntakeStatus.applied:
        return _read_intake(intake)
    if intake.status not in {
        DocumentIntakeStatus.ready_for_review,
        DocumentIntakeStatus.needs_attention,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document intake is not ready to apply.",
        )

    reviewed = _reviewed_data(intake, payload.review_data)
    document_type = _str(reviewed.get("document_type")) or intake.document_type
    if document_type not in {
        "insurance_certificate",
        "bank_guarantee",
        "compliance",
        "notice",
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This document type is review-only for now.",
        )

    obligations = _apply_document_obligation_intake(intake, reviewed, payload, user, session)
    obligation_ids = [str(obligation.id) for obligation in obligations]
    applied_action = (
        "created_insurance_obligation"
        if document_type == "insurance_certificate" and len(obligations) == 1
        else "created_document_obligations"
    )
    intake.review_data = {
        **reviewed,
        "applied": {
            "obligation_id": obligation_ids[0],
            "obligation_ids": obligation_ids,
            "obligation_count": len(obligation_ids),
            "action": applied_action,
        },
    }
    intake.status = DocumentIntakeStatus.applied
    intake.applied_at = utcnow()
    intake.applied_by_user_id = user.id
    intake.document.category = _document_apply_category(document_type)
    intake.document.document_metadata = {
        **(intake.document.document_metadata or {}),
        "applied_document_intake_id": str(intake.id),
        "applied_obligation_ids": obligation_ids,
        "applied_document_type": document_type,
    }
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=intake.entity_id,
        action="apply",
        target_table="document_intake",
        target_id=intake.id,
        tool_output_summary=f"Applied {len(obligation_ids)} document obligation(s).",
    )
    session.commit()
    session.refresh(intake)
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
