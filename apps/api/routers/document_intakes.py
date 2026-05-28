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
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker
from stewart.ai.document_intake import DocumentExtractionError, extract_document_file
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    BillingDraft,
    BillingDraftLine,
    BillingDraftStatus,
    DocumentCategory,
    DocumentIntake,
    DocumentIntakeStatus,
    GstTreatment,
    Lease,
    LeaseIntake,
    LeaseIntakeStatus,
    LeaseStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    PropertyType,
    RentChargeRule,
    RentChargeType,
    RentFrequency,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    UserRole,
)
from stewart.core.settings import get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.lease_intakes import _apply_lease_records
from apps.api.routers.obligations import _validate_obligation_scope
from apps.api.schemas.document_intake import (
    DocumentIntakeApplyRequest,
    DocumentIntakeRead,
    DocumentIntakeReviewRequest,
)
from apps.api.schemas.lease_intake import LeaseIntakeApplyRequest
from apps.api.tenant_lease_agreement import lease_agreement_section, mark_lease_agreement_signed

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
ACTIVE_DOCUSIGN_SIGNING_STATUSES = {"queued", "sent", "delivered"}


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


def _float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def _int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(str(value).replace(",", "")))
    except ValueError:
        return None


def _optional_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.lower()
        if lowered in {"1", "true", "yes", "y"}:
            return True
        if lowered in {"0", "false", "no", "n"}:
            return False
    return None


def _bool(value: Any, default: bool) -> bool:
    parsed = _optional_bool(value)
    return default if parsed is None else parsed


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


def _apply_tenant_insurance_metadata(
    intake: DocumentIntake,
    data: dict[str, Any],
    session: Session,
) -> None:
    document = intake.document
    tenant_id = document.tenant_id
    if document.lease_id is not None:
        lease = session.get(Lease, document.lease_id)
        if lease is None or lease.deleted_at is not None:
            return
        tenant_id = lease.tenant_id
        document.tenant_id = lease.tenant_id
    if tenant_id is None:
        return
    expiry_date = _insurance_due_date(data)
    if expiry_date is None:
        return
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        return

    now = utcnow().isoformat()
    metadata = dict(tenant.tenant_metadata or {})
    history_raw = metadata.get("insurance_auto_update_history")
    history = (
        [item for item in history_raw if isinstance(item, dict)]
        if isinstance(history_raw, list)
        else []
    )
    history.append(
        {
            "source": "document_intake",
            "document_intake_id": str(intake.id),
            "document_id": str(document.id),
            "expiry_date": expiry_date.isoformat(),
            "applied_at": now,
        }
    )
    metadata.update(
        {
            "insurance_confirmed": True,
            "insurance_expiry_date": expiry_date.isoformat(),
            "insurance_document_id": str(document.id),
            "insurance_document_intake_id": str(intake.id),
            "insurance_auto_updated_at": now,
            "insurance_auto_update_history": history[-10:],
        }
    )
    tenant.tenant_metadata = metadata


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
        case "invoice_admin":
            return ObligationCategory.other
        case "purchase_contract":
            return ObligationCategory.other
        case "notice":
            return ObligationCategory.other
        case _:
            return ObligationCategory.other


def _first_money_record(data: dict[str, Any]) -> dict[str, Any] | None:
    for record in _records(data.get("money_amounts")):
        if _float(record.get("amount")) is not None:
            return record
    return None


def _money_note(record: dict[str, Any] | None) -> str | None:
    if record is None:
        return None
    amount = _float(record.get("amount"))
    if amount is None:
        return None
    currency = _str(record.get("currency")) or "AUD"
    label = _str(record.get("label")) or "Amount"
    frequency = _str(record.get("frequency"))
    formatted = f"{currency} {amount:,.2f}"
    if frequency:
        formatted = f"{formatted} {frequency}"
    return f"{label}: {formatted}."


def _money_cents(value: Any) -> int | None:
    amount = _float(value)
    if amount is None:
        return None
    return int(round(amount * 100))


def _currency(value: Any) -> str:
    text = (_str(value) or "AUD").upper()
    return text[:3] if len(text) >= 3 else "AUD"


def _invoice_date(data: dict[str, Any]) -> date | None:
    record = _first_dated_record(
        _records(data.get("key_dates")),
        {"invoice date", "issued", "issue date", "tax invoice date"},
    )
    if record is None:
        return None
    return _date(record.get("date") or record.get("due_date"))


def _invoice_due_date(data: dict[str, Any]) -> date | None:
    record = _first_dated_record(
        _records(data.get("key_dates")),
        {
            "due",
            "payment due",
            "pay by",
            "invoice due",
            "service period end",
            "period end",
        },
    )
    if record is None:
        record = _first_dated_record(_records(data.get("key_dates")))
    if record is None:
        record = _first_dated_record(_records(data.get("obligations")))
    if record is None:
        return None
    return _date(record.get("date") or record.get("due_date"))


def _billing_draft_status(data: dict[str, Any]) -> BillingDraftStatus:
    if _records(data.get("warnings")) or _records(data.get("missing_information")):
        return BillingDraftStatus.needs_review
    if data.get("warnings") or data.get("missing_information"):
        return BillingDraftStatus.needs_review
    return BillingDraftStatus.draft


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
        due_date = _date(source_record.get("date")) or _date(source_record.get("due_date"))
        if due_date is None:
            return None
        return (
            label or "Bank guarantee renewal",
            due_date,
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
        due_date = _date(source_record.get("date")) or _date(source_record.get("due_date"))
        if due_date is None:
            return None
        return (
            label or "Compliance follow-up",
            due_date,
            ObligationCategory.compliance,
            "Review compliance document before the recorded date.",
            _str(source_record.get("source_hint")),
        )
    if document_type == "purchase_contract":
        source_record = _first_dated_record(
            key_dates,
            {
                "settlement",
                "completion",
                "due diligence",
                "finance",
                "handover",
                "condition",
                "deposit",
            },
        )
        if source_record is None:
            source_record = _first_dated_record(key_dates)
        if source_record is None:
            return None
        label = _str(source_record.get("label"))
        due_date = _date(source_record.get("date")) or _date(source_record.get("due_date"))
        if due_date is None:
            return None
        return (
            label or "Acquisition milestone",
            due_date,
            ObligationCategory.other,
            "Review acquisition milestone from the source document.",
            _str(source_record.get("source_hint")),
        )
    if document_type == "invoice_admin":
        source_record = _first_dated_record(
            key_dates,
            {
                "due",
                "payment due",
                "pay by",
                "invoice due",
                "service period end",
                "period end",
            },
        )
        if source_record is None:
            source_record = _first_dated_record(key_dates)
        if source_record is None:
            return None
        label = _str(source_record.get("label"))
        due_date = _date(source_record.get("date")) or _date(source_record.get("due_date"))
        if due_date is None:
            return None
        money_note = _money_note(_first_money_record(data))
        notes = "Prepare billing review. No invoice was created, posted, or synced."
        if money_note:
            notes = f"{money_note} {notes}"
        return (
            label or "Review billing document",
            due_date,
            ObligationCategory.other,
            notes,
            _str(source_record.get("source_hint")),
        )
    if document_type == "notice":
        source_record = _first_dated_record(key_dates)
        if source_record is None:
            return None
        label = _str(source_record.get("label"))
        category = _category_from_text(label, ObligationCategory.other)
        due_date = _date(source_record.get("date")) or _date(source_record.get("due_date"))
        if due_date is None:
            return None
        return (
            label or "Notice follow-up",
            due_date,
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


def _record_with_label(records: list[dict[str, Any]], labels: set[str]) -> dict[str, Any] | None:
    for record in records:
        label = (
            _str(record.get("label")) or _str(record.get("title")) or _str(record.get("role")) or ""
        ).lower()
        if any(fragment in label for fragment in labels):
            return record
    return None


def _generic_date(data: dict[str, Any], labels: set[str]) -> str | None:
    record = _first_dated_record(_records(data.get("key_dates")), labels)
    if record is None:
        record = _first_dated_record(_records(data.get("obligations")), labels)
    if record is None:
        return None
    value = _date(record.get("date") or record.get("due_date"))
    return value.isoformat() if value else None


def _generic_tenant_party(data: dict[str, Any]) -> dict[str, Any]:
    parties = _records(data.get("parties"))
    for party in parties:
        role = (_str(party.get("role")) or "").lower()
        if "tenant" in role or "lessee" in role:
            return party
    return parties[0] if parties else {}


def _normalised_rent_frequency(value: Any, label: str | None = None) -> str | None:
    text = (_str(value) or label or "").lower()
    if "week" in text:
        return "weekly"
    if "month" in text:
        return "monthly"
    if "quarter" in text:
        return "quarterly"
    if "annual" in text or "year" in text or "annum" in text or "pa" in text:
        return "annual"
    return None


def _rent_frequency(value: Any, label: str | None = None) -> RentFrequency | None:
    normalised = _normalised_rent_frequency(value, label)
    if normalised is None:
        return None
    try:
        return RentFrequency(normalised)
    except ValueError:
        return None


def _annualised_cents(amount: float, frequency: str | None) -> int:
    multiplier = 1
    if frequency == "weekly":
        multiplier = 52
    elif frequency == "monthly":
        multiplier = 12
    elif frequency == "quarterly":
        multiplier = 4
    return int(round(amount * multiplier * 100))


def _periodic_rent_cents(annual_rent_cents: int, frequency: RentFrequency) -> int:
    divisor = 1
    if frequency == RentFrequency.weekly:
        divisor = 52
    elif frequency == RentFrequency.monthly:
        divisor = 12
    elif frequency == RentFrequency.quarterly:
        divisor = 4
    return int(round(annual_rent_cents / divisor))


def _generic_rent(data: dict[str, Any]) -> tuple[int | None, str | None]:
    amounts = _records(data.get("money_amounts"))
    rent_record = _record_with_label(
        amounts,
        {"annual rent", "base rent", "rent", "licence fee"},
    )
    if rent_record is None and amounts:
        rent_record = amounts[0]
    if rent_record is None:
        return None, None
    amount = _float(rent_record.get("amount"))
    if amount is None:
        return None, None
    label = _str(rent_record.get("label"))
    frequency = _normalised_rent_frequency(rent_record.get("frequency"), label)
    return _annualised_cents(amount, frequency), frequency or "annual"


def _generic_lease_review_to_lease_intake_data(data: dict[str, Any]) -> dict[str, Any]:
    if {"property", "tenancy_unit", "tenant", "lease"}.issubset(data.keys()):
        return data

    property_record = _records(data.get("properties"))
    prop = property_record[0] if property_record else {}
    tenant_party = _generic_tenant_party(data)
    annual_rent_cents, rent_frequency = _generic_rent(data)
    commencement_date = _generic_date(
        data,
        {"commencement", "lease start", "term start", "start date", "start"},
    )
    expiry_date = _generic_date(
        data,
        {"expiry", "expiration", "lease end", "term end", "end date", "expires"},
    )
    next_review_date = _generic_date(
        data,
        {"rent review", "review date", "cpi review", "rent adjustment"},
    )
    option_record = _record_with_label(
        _records(data.get("obligations")) + _records(data.get("key_dates")),
        {"option", "renewal option"},
    )
    security_record = _record_with_label(
        _records(data.get("obligations")) + _records(data.get("money_amounts")),
        {"bank guarantee", "security", "bond", "deposit"},
    )
    obligations: list[dict[str, Any]] = []
    for row in _records(data.get("obligations")):
        due_date = _date(row.get("due_date") or row.get("date"))
        title = _str(row.get("title")) or _str(row.get("label"))
        if due_date is None or title is None:
            continue
        obligations.append(
            {
                "title": title,
                "category": _category_from_text(
                    _str(row.get("category")) or title,
                    ObligationCategory.other,
                ).value,
                "due_date": due_date.isoformat(),
                "priority": 1 if (_float(row.get("confidence")) or 1) >= 0.8 else 2,
                "owner_role": UserRole.ops.value,
                "notes": _str(row.get("notes")) or _str(row.get("source_hint")),
            }
        )

    return {
        "property": {
            "name": _str(prop.get("name")),
            "street_address": _str(prop.get("street_address")) or _str(prop.get("address")),
            "suburb": _str(prop.get("suburb")),
            "state": _str(prop.get("state")),
            "postcode": _str(prop.get("postcode")),
            "country_code": _str(prop.get("country_code")) or "AU",
            "property_type": _str(prop.get("property_type")) or "other",
        },
        "tenancy_unit": {
            "unit_label": _str(prop.get("unit_label")) or _str(prop.get("label")),
            "sqm": _float(prop.get("sqm")),
            "parking_spaces": None,
        },
        "tenant": {
            "legal_name": _str(tenant_party.get("name")),
            "trading_name": _str(tenant_party.get("trading_name")),
            "abn": _str(tenant_party.get("abn")),
            "contact_name": _str(tenant_party.get("contact")),
            "contact_email": _str(tenant_party.get("contact_email")),
            "contact_phone": _str(tenant_party.get("contact_phone")),
            "billing_email": _str(tenant_party.get("billing_email"))
            or _str(tenant_party.get("contact_email")),
        },
        "lease": {
            "status": "active",
            "commencement_date": commencement_date,
            "expiry_date": expiry_date,
            "annual_rent_cents": annual_rent_cents,
            "rent_frequency": rent_frequency,
            "outgoings_recoverable": True,
            "next_review_date": next_review_date,
            "option_summary": _str(option_record.get("title") or option_record.get("label"))
            if option_record
            else None,
            "security_summary": _str(security_record.get("title") or security_record.get("label"))
            if security_record
            else None,
            "notes": _str(data.get("summary")),
        },
        "obligations": obligations,
        "warnings": data.get("warnings") if isinstance(data.get("warnings"), list) else [],
    }


def _apply_lease_document_intake(
    intake: DocumentIntake,
    data: dict[str, Any],
    payload: DocumentIntakeApplyRequest,
    user: CurrentUser,
    session: Session,
) -> tuple[LeaseIntake, Property, TenancyUnit, Tenant, Lease, list[Obligation]]:
    existing = next(
        (
            candidate
            for candidate in session.scalars(
                select(LeaseIntake).where(
                    LeaseIntake.entity_id == intake.entity_id,
                    LeaseIntake.deleted_at.is_(None),
                )
            )
            if _dict(candidate.extracted_data).get("source_document_intake_id") == str(intake.id)
        ),
        None,
    )
    if existing is not None and existing.status == LeaseIntakeStatus.applied:
        lease = session.get(Lease, existing.applied_lease_id)
        if lease is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Applied lease intake is missing its lease record.",
            )
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        tenant = session.get(Tenant, lease.tenant_id)
        prop = session.get(Property, unit.property_id) if unit is not None else None
        obligations = list(
            session.scalars(
                select(Obligation).where(
                    Obligation.lease_id == lease.id,
                    Obligation.deleted_at.is_(None),
                )
            )
        )
        if prop is None or unit is None or tenant is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Applied lease intake is missing linked register records.",
            )
        return existing, prop, unit, tenant, lease, obligations

    lease_data = _generic_lease_review_to_lease_intake_data(data)
    lease_data["source_document_intake_id"] = str(intake.id)
    lease_data["source_document_id"] = str(intake.document_id)
    lease_intake = existing or LeaseIntake(
        entity_id=intake.entity_id,
        filename=intake.document.filename,
        content_type=intake.document.content_type,
        byte_size=intake.document.byte_size,
        file_data=intake.document.file_data,
        status=LeaseIntakeStatus.extracted,
        extracted_data=lease_data,
        openai_response_id=intake.openai_response_id,
    )
    lease_intake.status = LeaseIntakeStatus.extracted
    lease_intake.extracted_data = lease_data
    session.add(lease_intake)
    session.flush()
    prop, unit, tenant, lease, obligations = _apply_lease_records(
        lease_intake,
        LeaseIntakeApplyRequest(
            property_id=payload.property_id,
            tenancy_unit_id=payload.tenancy_unit_id,
            tenant_id=payload.tenant_id,
            reviewed_data=lease_data,
        ),
        user,
        session,
    )
    lease_intake.status = LeaseIntakeStatus.applied
    lease_intake.applied_lease_id = lease.id
    lease_intake.applied_at = utcnow()
    return lease_intake, prop, unit, tenant, lease, obligations


def _tenant_upload_activation_review_data(
    lease: Lease,
    document: StoredDocument,
) -> dict[str, object]:
    already_active = lease.status in {LeaseStatus.active, LeaseStatus.holding_over}
    return {
        "status": "already_active" if already_active else "ready_for_review",
        "current_lease_status": lease.status.value,
        "recommended_status": LeaseStatus.active.value,
        "signed_document_id": str(document.id),
        "updated_at": utcnow().isoformat(),
        "guardrail": (
            "Tenant-uploaded lease match does not activate a lease automatically; "
            "review and activate explicitly."
        ),
    }


def _mark_tenant_uploaded_lease_match_signed(
    intake: DocumentIntake,
    lease: Lease,
    user: CurrentUser,
    session: Session,
) -> None:
    onboarding_id = intake.document.tenant_onboarding_id
    if onboarding_id is None:
        return
    onboarding = session.get(TenantOnboarding, onboarding_id)
    if onboarding is None or onboarding.deleted_at is not None:
        return
    if onboarding.lease_id != lease.id:
        return
    mark_lease_agreement_signed(
        onboarding,
        actor=user.actor,
        source="tenant_uploaded_lease_match",
        signing_updates={
            "provider": "tenant_upload",
            "status": "completed",
            "document_id": str(intake.document.id),
            "signed_document_id": str(intake.document.id),
            "document_intake_id": str(intake.id),
            "accepted_at": utcnow().isoformat(),
            "lease_activation_review": _tenant_upload_activation_review_data(
                lease,
                intake.document,
            ),
        },
    )


def _active_docusign_signing_for_onboarding(
    onboarding: TenantOnboarding,
) -> bool:
    signing = lease_agreement_section(onboarding).get("signing")
    signing_data = dict(signing) if isinstance(signing, dict) else {}
    return (
        signing_data.get("provider") == "docusign"
        and signing_data.get("status") in ACTIVE_DOCUSIGN_SIGNING_STATUSES
        and not signing_data.get("signed_at")
    )


def _property_for_document_apply(
    property_id: UUID,
    entity_id: UUID,
    user: CurrentUser,
    session: Session,
) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None or prop.entity_id != entity_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    return prop


def _tenant_for_document_apply(
    tenant_id: UUID,
    entity_id: UUID,
    user: CurrentUser,
    session: Session,
) -> Tenant:
    tenant = session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None or tenant.entity_id != entity_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    return tenant


def _unit_for_property_apply(
    unit_id: UUID,
    prop: Property,
    session: Session,
) -> TenancyUnit:
    unit = session.get(TenancyUnit, unit_id)
    if unit is None or unit.deleted_at is not None or unit.property_id != prop.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenancy unit not found.",
        )
    return unit


def _property_identity(row: dict[str, Any]) -> tuple[str | None, str | None]:
    return _str(row.get("name")), _str(row.get("street_address")) or _str(row.get("address"))


def _find_matching_property(
    entity_id: UUID,
    row: dict[str, Any],
    session: Session,
) -> Property | None:
    name, street_address = _property_identity(row)
    if not name and not street_address:
        return None
    statement = select(Property).where(
        Property.entity_id == entity_id,
        Property.deleted_at.is_(None),
    )
    if name:
        statement = statement.where(func.lower(Property.name) == name.lower())
    if street_address:
        statement = statement.where(func.lower(Property.street_address) == street_address.lower())
    return session.scalar(statement)


PROPERTY_APPLY_FIELDS = (
    "name",
    "street_address",
    "suburb",
    "state",
    "postcode",
    "country_code",
    "parcel_id",
    "land_sqm",
    "building_sqm",
    "parking_spaces",
    "ownership_structure",
    "owner_legal_name",
    "owner_abn",
    "trustee_name",
    "trust_name",
    "invoice_issuer_name",
    "billing_contact_name",
    "billing_email",
    "invoice_reference",
    "ownership_split",
    "owner_gst_registered",
    "xero_contact_id",
    "xero_tracking_category",
)


def _property_updates_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _str(row.get("name")),
        "street_address": _str(row.get("street_address")) or _str(row.get("address")),
        "suburb": _str(row.get("suburb")),
        "state": _str(row.get("state")),
        "postcode": _str(row.get("postcode")),
        "country_code": _str(row.get("country_code")) or "AU",
        "parcel_id": _str(row.get("parcel_id")),
        "land_sqm": _float(row.get("land_sqm")),
        "building_sqm": _float(row.get("building_sqm")),
        "parking_spaces": _int(row.get("parking_spaces")),
        "ownership_structure": _str(row.get("ownership_structure")),
        "owner_legal_name": _str(row.get("owner_legal_name")),
        "owner_abn": _str(row.get("owner_abn")),
        "trustee_name": _str(row.get("trustee_name")),
        "trust_name": _str(row.get("trust_name")),
        "invoice_issuer_name": _str(row.get("invoice_issuer_name")),
        "billing_contact_name": _str(row.get("billing_contact_name")),
        "billing_email": _str(row.get("billing_email")),
        "invoice_reference": _str(row.get("invoice_reference")),
        "ownership_split": _str(row.get("ownership_split")),
        "owner_gst_registered": _optional_bool(row.get("owner_gst_registered")),
        "xero_contact_id": _str(row.get("xero_contact_id")),
        "xero_tracking_category": _str(row.get("xero_tracking_category")),
    }


def _source_for_property_field(row: dict[str, Any], field: str) -> dict[str, Any]:
    field_sources = (
        _dict(row.get("source_citations"))
        or _dict(row.get("field_sources"))
        or _dict(row.get("source_hints"))
    )
    raw_source = field_sources.get(field)
    if isinstance(raw_source, dict):
        source = {
            "source_hint": _str(raw_source.get("source_hint")) or _str(raw_source.get("hint")),
            "citation": _str(raw_source.get("citation")) or _str(raw_source.get("text")),
            "confidence": _float(raw_source.get("confidence")),
        }
    elif raw_source is not None:
        source = {
            "source_hint": _str(raw_source),
            "citation": None,
            "confidence": _float(row.get("confidence")),
        }
    else:
        source = {
            "source_hint": _str(row.get("source_hint")),
            "citation": None,
            "confidence": _float(row.get("confidence")),
        }
    return {key: value for key, value in source.items() if value is not None}


def _property_change(
    field: str,
    before: Any,
    after: Any,
    row: dict[str, Any],
) -> dict[str, Any]:
    change: dict[str, Any] = {
        "field": field,
        "before": before,
        "after": after,
    }
    source = _source_for_property_field(row, field)
    if source:
        change["source"] = source
    return change


def _append_property_apply_metadata(
    prop: Property,
    intake: DocumentIntake,
    document_type: str,
    changes: list[dict[str, Any]],
) -> None:
    metadata = dict(prop.property_metadata or {})
    citations = dict(_dict(metadata.get("source_citations")))
    for change in changes:
        source = _dict(change.get("source"))
        field = _str(change.get("field"))
        if field and source:
            citations[field] = source

    history = list(metadata.get("apply_change_history") or [])
    history.append(
        {
            "document_intake_id": str(intake.id),
            "document_id": str(intake.document_id),
            "document_type": document_type,
            "changes": changes,
        }
    )
    metadata.update(
        {
            "last_applied_document_intake_id": str(intake.id),
            "last_applied_document_id": str(intake.document_id),
            "last_applied_document_type": document_type,
            "apply_change_history": history,
        }
    )
    if citations:
        metadata["source_citations"] = citations
    prop.property_metadata = metadata


def _fill_blank_property_fields(
    prop: Property,
    row: dict[str, Any],
) -> tuple[list[str], list[dict[str, Any]]]:
    filled: list[str] = []
    changes: list[dict[str, Any]] = []
    updates = _property_updates_from_row(row)
    updates.pop("name", None)
    updates.pop("street_address", None)
    updates.pop("country_code", None)
    for key, value in updates.items():
        if value is not None and getattr(prop, key) is None:
            before = getattr(prop, key)
            setattr(prop, key, value)
            filled.append(key)
            changes.append(_property_change(key, before, value, row))
    return filled, changes


def _created_property_changes(prop: Property, row: dict[str, Any]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for field in PROPERTY_APPLY_FIELDS:
        value = getattr(prop, field)
        if value is not None:
            changes.append(_property_change(field, None, value, row))
    return changes


def _resolve_purchase_property(
    intake: DocumentIntake,
    data: dict[str, Any],
    payload: DocumentIntakeApplyRequest,
    user: CurrentUser,
    session: Session,
) -> tuple[Property, str, list[str], list[dict[str, Any]]]:
    rows = _records(data.get("properties"))
    row = rows[0] if rows else {}
    if payload.property_id is not None:
        prop = _property_for_document_apply(payload.property_id, intake.entity_id, user, session)
        filled_fields, changes = _fill_blank_property_fields(prop, row)
        _append_property_apply_metadata(prop, intake, "purchase_contract", changes)
        return prop, "linked_property_register_records", filled_fields, changes

    name, street_address = _property_identity(row)
    if not name and not street_address:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Choose an existing property or confirm the property name/address.",
        )

    existing = _find_matching_property(intake.entity_id, row, session)
    if existing is not None:
        filled_fields, changes = _fill_blank_property_fields(existing, row)
        _append_property_apply_metadata(existing, intake, "purchase_contract", changes)
        return (
            existing,
            "linked_property_register_records",
            filled_fields,
            changes,
        )

    prop = Property(
        entity_id=intake.entity_id,
        name=name or street_address or "Property to confirm",
        street_address=street_address or "Address to confirm",
        suburb=_str(row.get("suburb")),
        state=_str(row.get("state")),
        postcode=_str(row.get("postcode")),
        country_code=_str(row.get("country_code")) or "AU",
        property_type=PropertyType.other,
        parcel_id=_str(row.get("parcel_id")),
        land_sqm=_float(row.get("land_sqm")),
        building_sqm=_float(row.get("building_sqm")),
        parking_spaces=_int(row.get("parking_spaces")),
        has_solar_pv=False,
        ownership_structure=_str(row.get("ownership_structure")),
        owner_legal_name=_str(row.get("owner_legal_name")),
        owner_abn=_str(row.get("owner_abn")),
        trustee_name=_str(row.get("trustee_name")),
        trust_name=_str(row.get("trust_name")),
        invoice_issuer_name=_str(row.get("invoice_issuer_name")),
        billing_contact_name=_str(row.get("billing_contact_name")),
        billing_email=_str(row.get("billing_email")),
        invoice_reference=_str(row.get("invoice_reference")),
        ownership_split=_str(row.get("ownership_split")),
        owner_gst_registered=_optional_bool(row.get("owner_gst_registered")),
        xero_contact_id=_str(row.get("xero_contact_id")),
        xero_tracking_category=_str(row.get("xero_tracking_category")),
        property_metadata={
            "source": "document_intake",
            "document_intake_id": str(intake.id),
            "document_id": str(intake.document_id),
            "document_type": "purchase_contract",
            "source_hint": _str(row.get("source_hint")),
        },
    )
    session.add(prop)
    session.flush()
    changes = _created_property_changes(prop, row)
    _append_property_apply_metadata(prop, intake, "purchase_contract", changes)
    return prop, "created_property_register_records", [], changes


def _fill_blank_unit_fields(unit: TenancyUnit, row: dict[str, Any]) -> list[str]:
    filled: list[str] = []
    updates = {
        "sqm": _float(row.get("sqm")),
        "parking_spaces": _int(row.get("parking_spaces")),
    }
    for key, value in updates.items():
        if value is not None and getattr(unit, key) is None:
            setattr(unit, key, value)
            filled.append(key)
    return filled


def _purchase_unit_rows(data: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    schedule_rows = [
        row for row in _records(data.get("tenancy_schedule")) if _str(row.get("unit_label"))
    ]
    if schedule_rows:
        return schedule_rows, True
    return _records(data.get("properties")), False


def _tenancy_schedule_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    snapshot = {
        "unit_label": _str(row.get("unit_label")),
        "sqm": _float(row.get("sqm")),
        "parking_spaces": _int(row.get("parking_spaces")),
        "tenant_name": _str(row.get("tenant_name")),
        "tenant_abn": _str(row.get("tenant_abn")),
        "lease_start": (
            _date(row.get("lease_start")).isoformat() if _date(row.get("lease_start")) else None
        ),
        "lease_expiry": (
            _date(row.get("lease_expiry")).isoformat() if _date(row.get("lease_expiry")) else None
        ),
        "next_review_date": (
            _date(row.get("next_review_date")).isoformat()
            if _date(row.get("next_review_date"))
            else None
        ),
        "annual_rent_cents": _money_cents(row.get("annual_rent")),
        "rent_frequency": _str(row.get("rent_frequency")),
        "outgoings": _str(row.get("outgoings")),
        "outgoings_amount_cents": _money_cents(row.get("outgoings_amount")),
        "outgoings_frequency": _str(row.get("outgoings_frequency")),
        "parking_amount_cents": _money_cents(row.get("parking_amount")),
        "parking_frequency": _str(row.get("parking_frequency")),
        "storage_amount_cents": _money_cents(row.get("storage_amount")),
        "storage_frequency": _str(row.get("storage_frequency")),
        "utilities_amount_cents": _money_cents(row.get("utilities_amount")),
        "utilities_frequency": _str(row.get("utilities_frequency")),
        "promotion_levy_amount_cents": _money_cents(row.get("promotion_levy_amount")),
        "promotion_levy_frequency": _str(row.get("promotion_levy_frequency")),
        "other_charge_label": _str(row.get("other_charge_label")),
        "other_charge_amount_cents": _money_cents(row.get("other_charge_amount")),
        "other_charge_frequency": _str(row.get("other_charge_frequency")),
        "option_summary": _str(row.get("option_summary")),
        "option_notice_date": (
            _date(row.get("option_notice_date")).isoformat()
            if _date(row.get("option_notice_date"))
            else None
        ),
        "security_summary": _str(row.get("security_summary")),
        "security_due_date": (
            _date(row.get("security_due_date")).isoformat()
            if _date(row.get("security_due_date"))
            else None
        ),
        "confidence": _confidence(row.get("confidence")),
        "source_hint": _str(row.get("source_hint")),
    }
    return {key: value for key, value in snapshot.items() if value is not None}


def _append_unit_schedule_metadata(
    unit: TenancyUnit,
    intake: DocumentIntake,
    row: dict[str, Any],
) -> None:
    snapshot = _tenancy_schedule_snapshot(row)
    if not snapshot:
        return
    metadata = dict(unit.unit_metadata or {})
    history = list(metadata.get("tenancy_schedule_history") or [])
    entry = {
        "document_intake_id": str(intake.id),
        "document_id": str(intake.document_id),
        "document_type": "purchase_contract",
        "schedule": snapshot,
    }
    history.append(entry)
    metadata.update(
        {
            "last_tenancy_schedule_document_intake_id": str(intake.id),
            "last_tenancy_schedule_document_id": str(intake.document_id),
            "tenancy_schedule": snapshot,
            "tenancy_schedule_history": history,
        }
    )
    unit.unit_metadata = metadata


def _schedule_row_for_unit(
    unit: TenancyUnit,
    schedule_rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    for row in schedule_rows:
        label = _str(row.get("unit_label"))
        if label and label.lower() == unit.unit_label.lower():
            return row
    return None


def _find_or_create_schedule_tenant(
    intake: DocumentIntake,
    row: dict[str, Any],
    session: Session,
) -> tuple[Tenant | None, bool, str | None]:
    tenant_name = _str(row.get("tenant_name"))
    tenant_abn = _str(row.get("tenant_abn"))
    if not tenant_name and not tenant_abn:
        return None, False, "Tenant name missing."

    statement = select(Tenant).where(
        Tenant.entity_id == intake.entity_id,
        Tenant.deleted_at.is_(None),
    )
    if tenant_abn:
        statement = statement.where(Tenant.abn == tenant_abn)
    elif tenant_name:
        statement = statement.where(func.lower(Tenant.legal_name) == tenant_name.lower())
    existing = session.scalar(statement)
    if existing is not None:
        return existing, False, None

    tenant = Tenant(
        entity_id=intake.entity_id,
        legal_name=tenant_name or "Tenant to confirm",
        abn=tenant_abn,
        tenant_metadata={
            "source": "document_intake",
            "document_intake_id": str(intake.id),
            "document_id": str(intake.document_id),
            "document_type": "purchase_contract",
            "source_hint": _str(row.get("source_hint")),
            "tenancy_schedule": _tenancy_schedule_snapshot(row),
        },
    )
    session.add(tenant)
    session.flush()
    return tenant, True, None


def _schedule_outgoings_recoverable(value: Any) -> bool:
    text = (_str(value) or "").lower()
    if any(fragment in text for fragment in {"non-recoverable", "not recoverable", "gross"}):
        return False
    if any(fragment in text for fragment in {"recoverable", "net", "outgoing"}):
        return True
    return True


def _schedule_tenant_blocker(row: dict[str, Any]) -> str | None:
    if not _str(row.get("tenant_name")) and not _str(row.get("tenant_abn")):
        return "Tenant name missing."
    return None


def _schedule_lease_blockers(row: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    start = _date(row.get("lease_start"))
    end = _date(row.get("lease_expiry"))
    annual_rent_cents = _money_cents(row.get("annual_rent"))
    if start is None:
        blockers.append("Lease start missing.")
    if end is None:
        blockers.append("Lease expiry missing.")
    if start is not None and end is not None and end < start:
        blockers.append("Lease expiry is before lease start.")
    if annual_rent_cents is None:
        blockers.append("Annual rent missing.")
    elif annual_rent_cents <= 0:
        blockers.append("Annual rent must be greater than zero.")
    if _rent_frequency(row.get("rent_frequency")) is None:
        blockers.append("Rent frequency missing.")
    return blockers


def _has_overlapping_unit_lease(
    unit: TenancyUnit,
    start: date,
    end: date,
    session: Session,
) -> bool:
    return (
        session.scalar(
            select(Lease).where(
                Lease.tenancy_unit_id == unit.id,
                Lease.deleted_at.is_(None),
                Lease.commencement_date <= end,
                Lease.expiry_date >= start,
            )
        )
        is not None
    )


def _create_schedule_lease_obligations(
    intake: DocumentIntake,
    unit: TenancyUnit,
    lease: Lease,
    row: dict[str, Any],
    session: Session,
) -> list[Obligation]:
    candidates: list[dict[str, Any]] = []
    review_date = _date(row.get("next_review_date"))
    if review_date is not None:
        candidates.append(
            {
                "title": f"Rent review - {unit.unit_label}",
                "category": ObligationCategory.rent_review,
                "due_date": review_date,
                "owner_role": UserRole.finance,
                "notes": "Review rent from acquisition tenancy schedule.",
            }
        )
    if lease.expiry_date is not None:
        candidates.append(
            {
                "title": f"Lease expiry - {unit.unit_label}",
                "category": ObligationCategory.lease_expiry,
                "due_date": lease.expiry_date,
                "owner_role": UserRole.ops,
                "notes": "Track lease expiry from acquisition tenancy schedule.",
            }
        )
    option_notice_date = _date(row.get("option_notice_date"))
    if option_notice_date is not None:
        candidates.append(
            {
                "title": f"Option notice - {unit.unit_label}",
                "category": ObligationCategory.option_notice,
                "due_date": option_notice_date,
                "owner_role": UserRole.ops,
                "notes": "Track option notice window from acquisition tenancy schedule.",
            }
        )
    security_due_date = _date(row.get("security_due_date"))
    if security_due_date is not None:
        candidates.append(
            {
                "title": f"Security review - {unit.unit_label}",
                "category": ObligationCategory.bank_guarantee,
                "due_date": security_due_date,
                "owner_role": UserRole.ops,
                "notes": "Review lease security from acquisition tenancy schedule.",
            }
        )

    obligations: list[Obligation] = []
    for index, candidate in enumerate(candidates):
        existing = session.scalar(
            select(Obligation).where(
                Obligation.lease_id == lease.id,
                Obligation.category == candidate["category"],
                Obligation.due_date == candidate["due_date"],
                Obligation.deleted_at.is_(None),
            )
        )
        if existing is not None:
            obligations.append(existing)
            continue
        obligation = Obligation(
            entity_id=intake.entity_id,
            property_id=unit.property_id,
            tenancy_unit_id=unit.id,
            lease_id=lease.id,
            title=candidate["title"],
            category=candidate["category"],
            status=ObligationStatus.upcoming,
            due_date=candidate["due_date"],
            priority=1,
            owner_role=candidate["owner_role"],
            notes=(
                f"{candidate['notes']} Source document: {intake.document.filename}."
            ),
            obligation_metadata={
                "source": "document_intake",
                "document_intake_id": str(intake.id),
                "document_id": str(intake.document_id),
                "document_type": "purchase_contract",
                "source_hint": _str(row.get("source_hint")),
                "lease_id": str(lease.id),
                "review_index": index,
            },
        )
        session.add(obligation)
        obligations.append(obligation)
    session.flush()
    return obligations


SCHEDULE_EXTRA_CHARGE_FIELDS: tuple[
    tuple[RentChargeType, tuple[str, ...], tuple[str, ...], str],
    ...,
] = (
    (
        RentChargeType.parking,
        ("parking_amount", "car_parking_amount", "parking_charge"),
        ("parking_frequency", "car_parking_frequency"),
        "Parking",
    ),
    (
        RentChargeType.storage,
        ("storage_amount", "storage_charge"),
        ("storage_frequency",),
        "Storage",
    ),
    (
        RentChargeType.utilities,
        ("utilities_amount", "utility_amount", "utilities_charge"),
        ("utilities_frequency", "utility_frequency"),
        "Utilities",
    ),
    (
        RentChargeType.promotion_levy,
        ("promotion_levy_amount", "marketing_levy_amount", "promotion_fund_amount"),
        ("promotion_levy_frequency", "marketing_levy_frequency"),
        "Promotion levy",
    ),
    (
        RentChargeType.other,
        ("other_charge_amount", "misc_charge_amount"),
        ("other_charge_frequency", "misc_charge_frequency"),
        "Other charge",
    ),
)


def _schedule_first_money(
    row: dict[str, Any],
    keys: tuple[str, ...],
) -> tuple[int | None, str | None]:
    for key in keys:
        amount_cents = _money_cents(row.get(key))
        if amount_cents is not None:
            return amount_cents, key
    return None, None


def _schedule_first_frequency(
    row: dict[str, Any],
    keys: tuple[str, ...],
) -> tuple[RentFrequency | None, str | None]:
    for key in keys:
        frequency = _rent_frequency(row.get(key))
        if frequency is not None:
            return frequency, key
    fallback = _rent_frequency(row.get("rent_frequency"))
    if fallback is not None:
        return fallback, "rent_frequency"
    return None, None


def _create_schedule_charge_rule(
    intake: DocumentIntake,
    lease: Lease,
    row: dict[str, Any],
    session: Session,
    charge_type: RentChargeType,
    amount_cents: int,
    frequency: RentFrequency,
    extra_metadata: dict[str, Any] | None = None,
) -> RentChargeRule:
    existing = session.scalar(
        select(RentChargeRule).where(
            RentChargeRule.lease_id == lease.id,
            RentChargeRule.charge_type == charge_type,
            RentChargeRule.deleted_at.is_(None),
        )
    )
    if existing is not None:
        return existing

    charge_rule = RentChargeRule(
        lease_id=lease.id,
        charge_type=charge_type,
        amount_cents=amount_cents,
        frequency=frequency,
        gst_treatment=GstTreatment.taxable,
        start_date=lease.commencement_date,
        end_date=lease.expiry_date,
        next_due_date=lease.commencement_date,
        arrears_or_advance="advance",
        charge_rule_metadata={
            "source": "document_intake",
            "draft": True,
            "draft_status": "needs_review",
            "document_intake_id": str(intake.id),
            "document_id": str(intake.document_id),
            "document_type": "purchase_contract",
            "source_hint": _str(row.get("source_hint")),
            "tenancy_schedule": _tenancy_schedule_snapshot(row),
            **(extra_metadata or {}),
        },
    )
    session.add(charge_rule)
    session.flush()
    return charge_rule


def _create_schedule_base_rent_rule(
    intake: DocumentIntake,
    lease: Lease,
    row: dict[str, Any],
    session: Session,
) -> RentChargeRule | None:
    annual_rent_cents = _money_cents(row.get("annual_rent"))
    frequency = _rent_frequency(row.get("rent_frequency"))
    if annual_rent_cents is None or frequency is None:
        return None

    return _create_schedule_charge_rule(
        intake,
        lease,
        row,
        session,
        RentChargeType.base_rent,
        _periodic_rent_cents(annual_rent_cents, frequency),
        frequency,
        {
            "annual_rent_cents": annual_rent_cents,
            "source_field": "annual_rent",
        },
    )


def _create_schedule_outgoings_rule(
    intake: DocumentIntake,
    lease: Lease,
    row: dict[str, Any],
    session: Session,
) -> RentChargeRule | None:
    amount_cents = _money_cents(row.get("outgoings_amount"))
    frequency = _rent_frequency(row.get("outgoings_frequency") or row.get("rent_frequency"))
    if amount_cents is None or frequency is None:
        return None

    return _create_schedule_charge_rule(
        intake,
        lease,
        row,
        session,
        RentChargeType.outgoings,
        amount_cents,
        frequency,
        {
            "outgoings": _str(row.get("outgoings")),
            "source_field": "outgoings_amount",
        },
    )


def _create_schedule_extra_charge_rules(
    intake: DocumentIntake,
    lease: Lease,
    row: dict[str, Any],
    session: Session,
) -> list[RentChargeRule]:
    charge_rules: list[RentChargeRule] = []
    for charge_type, amount_keys, frequency_keys, label in SCHEDULE_EXTRA_CHARGE_FIELDS:
        amount_cents, amount_field = _schedule_first_money(row, amount_keys)
        frequency, frequency_field = _schedule_first_frequency(row, frequency_keys)
        if amount_cents is None or frequency is None:
            continue
        display_label = (
            _str(row.get("other_charge_label"))
            if charge_type == RentChargeType.other
            else label
        )
        charge_rules.append(
            _create_schedule_charge_rule(
                intake,
                lease,
                row,
                session,
                charge_type,
                amount_cents,
                frequency,
                {
                    "source_field": amount_field,
                    "frequency_source_field": frequency_field,
                    "schedule_charge_label": display_label or label,
                },
            )
        )
    return charge_rules


def _schedule_charge_rule_summary(rule: RentChargeRule) -> dict[str, Any]:
    metadata = _dict(rule.charge_rule_metadata)
    charge_type = getattr(rule.charge_type, "value", str(rule.charge_type))
    frequency = getattr(rule.frequency, "value", str(rule.frequency))
    return {
        "id": str(rule.id),
        "lease_id": str(rule.lease_id),
        "charge_type": charge_type,
        "amount_cents": rule.amount_cents,
        "frequency": frequency,
        "source_hint": _str(metadata.get("source_hint")),
        "source_field": _str(metadata.get("source_field")),
        "label": _str(metadata.get("schedule_charge_label")),
    }


def _apply_purchase_schedule_leases(
    intake: DocumentIntake,
    units: list[TenancyUnit],
    schedule_rows: list[dict[str, Any]],
    user: CurrentUser,
    session: Session,
) -> dict[str, Any]:
    tenant_ids: list[str] = []
    lease_ids: list[str] = []
    created_tenants = 0
    linked_tenants = 0
    created_leases = 0
    schedule_obligation_ids: list[str] = []
    charge_rule_ids: list[str] = []
    charge_rule_summaries: list[dict[str, Any]] = []
    skipped_rows: list[dict[str, Any]] = []

    for unit in units:
        row = _schedule_row_for_unit(unit, schedule_rows)
        if row is None:
            continue
        row_blockers = _schedule_lease_blockers(row)
        tenant_blocker = _schedule_tenant_blocker(row)
        if tenant_blocker:
            row_blockers.append(tenant_blocker)
        start = _date(row.get("lease_start"))
        end = _date(row.get("lease_expiry"))
        if start is not None and end is not None and _has_overlapping_unit_lease(
            unit,
            start,
            end,
            session,
        ):
            row_blockers.append("Unit already has an overlapping lease.")
        if row_blockers:
            skipped_rows.append(
                {
                    "unit_label": unit.unit_label,
                    "tenant_name": _str(row.get("tenant_name")),
                    "blockers": row_blockers,
                }
            )
            continue

        tenant, tenant_created, tenant_blocker = _find_or_create_schedule_tenant(
            intake,
            row,
            session,
        )
        if tenant_blocker or tenant is None:
            skipped_rows.append(
                {
                    "unit_label": unit.unit_label,
                    "tenant_name": _str(row.get("tenant_name")),
                    "blockers": [tenant_blocker or "Tenant could not be resolved."],
                }
            )
            continue

        if tenant_created:
            created_tenants += 1
            audit_log(
                session,
                actor=user.actor,
                user_id=user.id,
                entity_id=intake.entity_id,
                action="create",
                target_table="tenant",
                target_id=tenant.id,
                tool_name="smart_intake_apply",
                tool_input={"document_intake_id": str(intake.id)},
                tool_output_summary=(
                    f"Created tenant {tenant.id} from purchase contract tenancy schedule."
                ),
            )
        else:
            linked_tenants += 1
        tenant_ids.append(str(tenant.id))

        rent_frequency = _rent_frequency(row.get("rent_frequency"))
        annual_rent_cents = _money_cents(row.get("annual_rent"))
        lease = Lease(
            tenancy_unit_id=unit.id,
            tenant_id=tenant.id,
            status=LeaseStatus.pending,
            commencement_date=start,
            expiry_date=end,
            annual_rent_cents=annual_rent_cents,
            rent_frequency=rent_frequency,
            outgoings_recoverable=_schedule_outgoings_recoverable(row.get("outgoings")),
            next_review_date=_date(row.get("next_review_date")),
            option_summary=_str(row.get("option_summary")),
            security_summary=_str(row.get("security_summary")),
            notes="Created from reviewed purchase contract tenancy schedule.",
            lease_metadata={
                "source": "document_intake",
                "document_intake_id": str(intake.id),
                "document_id": str(intake.document_id),
                "document_type": "purchase_contract",
                "source_hint": _str(row.get("source_hint")),
                "tenancy_schedule": _tenancy_schedule_snapshot(row),
            },
        )
        session.add(lease)
        session.flush()
        created_leases += 1
        lease_ids.append(str(lease.id))
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=intake.entity_id,
            action="create",
            target_table="lease",
            target_id=lease.id,
            tool_name="smart_intake_apply",
            tool_input={"document_intake_id": str(intake.id), "unit_id": str(unit.id)},
            tool_output_summary=(
                f"Created pending lease {lease.id} from purchase contract tenancy schedule."
            ),
        )
        charge_rules = [
            rule
            for rule in (
                _create_schedule_base_rent_rule(intake, lease, row, session),
                _create_schedule_outgoings_rule(intake, lease, row, session),
                *_create_schedule_extra_charge_rules(intake, lease, row, session),
            )
            if rule is not None
        ]
        for charge_rule in charge_rules:
            charge_rule_ids.append(str(charge_rule.id))
            charge_rule_summaries.append(_schedule_charge_rule_summary(charge_rule))
            audit_log(
                session,
                actor=user.actor,
                user_id=user.id,
                entity_id=intake.entity_id,
                action="create",
                target_table="rent_charge_rule",
                target_id=charge_rule.id,
                tool_name="smart_intake_apply",
                tool_input={"document_intake_id": str(intake.id), "lease_id": str(lease.id)},
                tool_output_summary=(
                    f"Created draft {charge_rule.charge_type.value} charge rule "
                    "from acquisition schedule."
                ),
            )
        schedule_obligations = _create_schedule_lease_obligations(
            intake,
            unit,
            lease,
            row,
            session,
        )
        for obligation in schedule_obligations:
            schedule_obligation_ids.append(str(obligation.id))
            audit_log(
                session,
                actor=user.actor,
                user_id=user.id,
                entity_id=intake.entity_id,
                action="create",
                target_table="obligation",
                target_id=obligation.id,
                tool_name="smart_intake_apply",
                tool_input={"document_intake_id": str(intake.id), "lease_id": str(lease.id)},
                tool_output_summary=(
                    f"Created {obligation.category.value} task from acquisition schedule."
                ),
            )

    return {
        "tenant_ids": tenant_ids,
        "lease_ids": lease_ids,
        "created_tenant_count": created_tenants,
        "linked_tenant_count": linked_tenants,
        "created_lease_count": created_leases,
        "charge_rule_ids": charge_rule_ids,
        "charge_rule_summaries": charge_rule_summaries,
        "created_charge_rule_count": len(charge_rule_ids),
        "lease_obligation_ids": schedule_obligation_ids,
        "lease_obligation_count": len(schedule_obligation_ids),
        "skipped_tenancy_schedule_rows": skipped_rows,
    }


def _resolve_purchase_units(
    intake: DocumentIntake,
    prop: Property,
    data: dict[str, Any],
    payload: DocumentIntakeApplyRequest,
    session: Session,
) -> tuple[list[TenancyUnit], int, int, list[str], int, list[dict[str, Any]]]:
    rows, used_schedule = _purchase_unit_rows(data)
    if payload.tenancy_unit_id is not None:
        unit = _unit_for_property_apply(payload.tenancy_unit_id, prop, session)
        row = rows[0] if rows else {}
        filled_fields = _fill_blank_unit_fields(unit, row)
        if used_schedule:
            _append_unit_schedule_metadata(unit, intake, row)
        return (
            [unit],
            0,
            0,
            filled_fields,
            1 if used_schedule and row else 0,
            [_tenancy_schedule_snapshot(row)] if used_schedule and row else [],
        )

    units: list[TenancyUnit] = []
    created_count = 0
    linked_count = 0
    filled_fields: list[str] = []
    schedule_summaries: list[dict[str, Any]] = []
    seen_labels: set[str] = set()
    for row in rows:
        label = _str(row.get("unit_label"))
        if label is None or label.lower() in seen_labels:
            continue
        seen_labels.add(label.lower())
        existing = session.scalar(
            select(TenancyUnit).where(
                TenancyUnit.property_id == prop.id,
                TenancyUnit.deleted_at.is_(None),
                func.lower(TenancyUnit.unit_label) == label.lower(),
            )
        )
        if existing is not None:
            linked_count += 1
            filled_fields.extend(_fill_blank_unit_fields(existing, row))
            if used_schedule:
                _append_unit_schedule_metadata(existing, intake, row)
                schedule_summaries.append(_tenancy_schedule_snapshot(row))
            units.append(existing)
            continue
        unit = TenancyUnit(
            property_id=prop.id,
            unit_label=label,
            sqm=_float(row.get("sqm")),
            parking_spaces=_int(row.get("parking_spaces")),
            unit_metadata={
                "source": "document_intake",
                "document_intake_id": str(intake.id),
                "document_id": str(intake.document_id),
                "document_type": "purchase_contract",
                "source_hint": _str(row.get("source_hint")),
            },
        )
        session.add(unit)
        session.flush()
        if used_schedule:
            _append_unit_schedule_metadata(unit, intake, row)
            schedule_summaries.append(_tenancy_schedule_snapshot(row))
        created_count += 1
        units.append(unit)
    return (
        units,
        created_count,
        linked_count,
        filled_fields,
        len(schedule_summaries),
        schedule_summaries,
    )


def _apply_purchase_contract_intake(
    intake: DocumentIntake,
    data: dict[str, Any],
    payload: DocumentIntakeApplyRequest,
    user: CurrentUser,
    session: Session,
) -> tuple[Property, list[TenancyUnit], list[Obligation], dict[str, Any]]:
    prop, property_action, filled_property_fields, property_changes = _resolve_purchase_property(
        intake,
        data,
        payload,
        user,
        session,
    )
    (
        units,
        created_units,
        linked_units,
        filled_unit_fields,
        tenancy_schedule_count,
        tenancy_schedule_rows,
    ) = _resolve_purchase_units(
        intake,
        prop,
        data,
        payload,
        session,
    )
    intake.document.property_id = prop.id
    intake.document.tenancy_unit_id = units[0].id if len(units) == 1 else None

    obligation_payloads = _obligation_payloads_from_review(data, "purchase_contract")
    obligations: list[Obligation] = []
    if obligation_payloads:
        scoped_payload = payload.model_copy(
            update={
                "property_id": prop.id,
                "tenancy_unit_id": units[0].id if len(units) == 1 else None,
            }
        )
        obligations = _apply_document_obligation_intake(
            intake,
            data,
            scoped_payload,
            user,
            session,
        )

    schedule_apply = _apply_purchase_schedule_leases(
        intake,
        units,
        _records(data.get("tenancy_schedule")),
        user,
        session,
    )
    if len(schedule_apply["lease_ids"]) == 1:
        intake.document.lease_id = UUID(schedule_apply["lease_ids"][0])

    summary = {
        "action": property_action,
        "property_id": str(prop.id),
        "tenancy_unit_ids": [str(unit.id) for unit in units],
        "tenancy_unit_count": len(units),
        "created_tenancy_unit_count": created_units,
        "linked_tenancy_unit_count": linked_units,
        "filled_blank_property_fields": filled_property_fields,
        "property_changes": property_changes,
        "filled_blank_unit_fields": filled_unit_fields,
        "tenancy_schedule_count": tenancy_schedule_count,
        "tenancy_schedule_rows": tenancy_schedule_rows,
        "tenant_ids": schedule_apply["tenant_ids"],
        "created_tenant_count": schedule_apply["created_tenant_count"],
        "linked_tenant_count": schedule_apply["linked_tenant_count"],
        "lease_ids": schedule_apply["lease_ids"],
        "created_lease_count": schedule_apply["created_lease_count"],
        "tenant_lease_records_created": (
            schedule_apply["created_tenant_count"] + schedule_apply["created_lease_count"]
        ),
        "charge_rule_ids": schedule_apply["charge_rule_ids"],
        "charge_rule_summaries": schedule_apply["charge_rule_summaries"],
        "created_charge_rule_count": schedule_apply["created_charge_rule_count"],
        "lease_obligation_ids": schedule_apply["lease_obligation_ids"],
        "lease_obligation_count": schedule_apply["lease_obligation_count"],
        "skipped_tenancy_schedule_rows": schedule_apply["skipped_tenancy_schedule_rows"],
        "obligation_ids": [str(obligation.id) for obligation in obligations],
        "obligation_count": len(obligations) + schedule_apply["lease_obligation_count"],
    }
    return prop, units, obligations, summary


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
        metadata: dict[str, Any] = {
            "source": "document_intake",
            "document_intake_id": str(intake.id),
            "document_id": str(intake.document_id),
            "document_type": document_type,
            "source_hint": obligation_payload["source_hint"],
            "openai_response_id": intake.openai_response_id,
            "review_index": index,
        }
        if document_type == "invoice_admin":
            metadata["money_amounts"] = data.get("money_amounts")
            metadata["proposed_actions"] = data.get("proposed_actions")
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
            obligation_metadata=metadata,
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


def _billing_lines_from_review(data: dict[str, Any]) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for index, record in enumerate(_records(data.get("money_amounts"))):
        amount_cents = _money_cents(record.get("amount"))
        if amount_cents is None:
            continue
        currency = _currency(record.get("currency"))
        label = _str(record.get("label")) or f"Billing line {index + 1}"
        lines.append(
            {
                "description": label,
                "amount_cents": amount_cents,
                "currency": currency,
                "source_hint": _str(record.get("source_hint")),
                "confidence": _confidence(record.get("confidence")),
                "metadata": {
                    "source": "document_intake",
                    "review_index": index,
                    "raw": record,
                    "frequency": _str(record.get("frequency")),
                },
            }
        )
    return lines


def _apply_billing_draft_intake(
    intake: DocumentIntake,
    data: dict[str, Any],
    payload: DocumentIntakeApplyRequest,
    user: CurrentUser,
    session: Session,
) -> BillingDraft | None:
    existing = session.scalar(
        select(BillingDraft).where(
            BillingDraft.document_intake_id == intake.id,
            BillingDraft.deleted_at.is_(None),
        )
    )
    if existing is not None:
        return existing

    lines = _billing_lines_from_review(data)
    if not lines:
        return None

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
    tenant_id = payload.tenant_id or document.tenant_id
    if lease_id is not None:
        lease = session.get(Lease, lease_id)
        if lease is not None:
            tenant_id = lease.tenant_id
    elif tenant_id is not None:
        tenant = _tenant_for_document_apply(tenant_id, intake.entity_id, user, session)
        tenant_id = tenant.id
    document.property_id = property_id
    document.tenancy_unit_id = tenancy_unit_id
    document.lease_id = lease_id
    document.tenant_id = tenant_id
    currency = lines[0]["currency"]
    total_cents = sum(line["amount_cents"] for line in lines)
    title = _str(data.get("summary")) or lines[0]["description"]
    draft = BillingDraft(
        entity_id=intake.entity_id,
        property_id=property_id,
        tenancy_unit_id=tenancy_unit_id,
        tenant_id=tenant_id,
        lease_id=lease_id,
        document_id=document.id,
        document_intake_id=intake.id,
        status=_billing_draft_status(data),
        title=title,
        currency=currency,
        issue_date=_invoice_date(data),
        due_date=_invoice_due_date(data),
        total_cents=total_cents,
        notes=(
            "Draft prepared from Smart Intake review. It has not been approved, "
            "posted, emailed, or synced to Xero."
        ),
        billing_metadata={
            "source": "document_intake",
            "document_intake_id": str(intake.id),
            "document_id": str(document.id),
            "document_type": "invoice_admin",
            "openai_response_id": intake.openai_response_id,
            "warnings": data.get("warnings"),
            "missing_information": data.get("missing_information"),
            "proposed_actions": data.get("proposed_actions"),
            "raw_money_amounts": data.get("money_amounts"),
        },
    )
    session.add(draft)
    session.flush()
    for line in lines:
        session.add(
            BillingDraftLine(
                billing_draft_id=draft.id,
                description=line["description"],
                amount_cents=line["amount_cents"],
                currency=line["currency"],
                source_hint=line["source_hint"],
                confidence=line["confidence"],
                line_metadata=line["metadata"],
            )
        )
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=intake.entity_id,
        action="create",
        target_table="billing_draft",
        target_id=draft.id,
        tool_name="smart_intake_apply",
        tool_input={
            "document_intake_id": str(intake.id),
            "document_id": str(document.id),
            "line_count": len(lines),
        },
        tool_output_summary=(
            f"Created billing draft {draft.id} with {len(lines)} line(s); "
            "no posting or Xero sync performed."
        ),
    )
    return draft


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
    if document_type == "lease":
        lease_intake, prop, unit, tenant, lease, obligations = _apply_lease_document_intake(
            intake,
            reviewed,
            payload,
            user,
            session,
        )
        obligation_ids = [str(obligation.id) for obligation in obligations]
        intake.review_data = {
            **reviewed,
            "applied": {
                "action": "created_lease_register_records",
                "lease_intake_id": str(lease_intake.id),
                "property_id": str(prop.id),
                "tenancy_unit_id": str(unit.id),
                "tenant_id": str(tenant.id),
                "lease_id": str(lease.id),
                "obligation_ids": obligation_ids,
                "obligation_count": len(obligation_ids),
            },
        }
        intake.status = DocumentIntakeStatus.applied
        intake.applied_at = utcnow()
        intake.applied_by_user_id = user.id
        intake.document.category = DocumentCategory.lease
        intake.document.property_id = prop.id
        intake.document.tenancy_unit_id = unit.id
        intake.document.tenant_id = tenant.id
        intake.document.lease_id = lease.id
        intake.document.document_metadata = {
            **(intake.document.document_metadata or {}),
            "applied_document_intake_id": str(intake.id),
            "applied_lease_intake_id": str(lease_intake.id),
            "applied_lease_id": str(lease.id),
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
            tool_output_summary=(
                f"Applied lease {lease.id}; {len(obligation_ids)} obligation(s) created."
            ),
        )
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=intake.entity_id,
            action="apply",
            target_table="lease_intake",
            target_id=lease_intake.id,
            tool_output_summary=(
                f"Created lease {lease.id} from Smart Intake document {intake.id}."
            ),
        )
        session.commit()
        session.refresh(intake)
        return _read_intake(intake)

    if document_type == "purchase_contract":
        prop, units, obligations, applied = _apply_purchase_contract_intake(
            intake,
            reviewed,
            payload,
            user,
            session,
        )
        intake.review_data = {
            **reviewed,
            "applied": applied,
        }
        intake.status = DocumentIntakeStatus.applied
        intake.applied_at = utcnow()
        intake.applied_by_user_id = user.id
        intake.document.category = DocumentCategory.other
        intake.document.document_metadata = {
            **(intake.document.document_metadata or {}),
            "applied_document_intake_id": str(intake.id),
            "applied_property_id": str(prop.id),
            "applied_tenancy_unit_ids": [str(unit.id) for unit in units],
            "applied_tenant_ids": applied.get("tenant_ids") or [],
            "applied_lease_ids": applied.get("lease_ids") or [],
            "applied_charge_rule_ids": applied.get("charge_rule_ids") or [],
            "applied_obligation_ids": [
                *[str(obligation.id) for obligation in obligations],
                *(applied.get("lease_obligation_ids") or []),
            ],
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
            tool_output_summary=(
                f"Applied purchase contract to property {prop.id}; "
                f"{len(units)} unit(s), {applied.get('created_lease_count', 0)} "
                f"lease(s), {applied.get('obligation_count', len(obligations))} task(s)."
            ),
        )
        property_changes = list(applied.get("property_changes") or [])
        if property_changes:
            audit_log(
                session,
                actor=user.actor,
                user_id=user.id,
                entity_id=intake.entity_id,
                action="apply",
                target_table="property",
                target_id=prop.id,
                tool_name="smart_intake_apply",
                tool_input={
                    "document_intake_id": str(intake.id),
                    "document_id": str(intake.document_id),
                    "document_type": document_type,
                    "changes": property_changes,
                },
                tool_output_summary=(
                    f"Applied {len(property_changes)} property field change(s) "
                    f"from Smart Intake document {intake.id}."
                ),
            )
        session.commit()
        session.refresh(intake)
        return _read_intake(intake)

    if document_type not in {
        "insurance_certificate",
        "bank_guarantee",
        "compliance",
        "invoice_admin",
        "notice",
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This document type is review-only for now.",
        )

    obligations = _apply_document_obligation_intake(intake, reviewed, payload, user, session)
    billing_draft = (
        _apply_billing_draft_intake(intake, reviewed, payload, user, session)
        if document_type == "invoice_admin"
        else None
    )
    if document_type == "insurance_certificate":
        _apply_tenant_insurance_metadata(intake, reviewed, session)
    obligation_ids = [str(obligation.id) for obligation in obligations]
    billing_draft_ids = [str(billing_draft.id)] if billing_draft is not None else []
    if billing_draft is not None:
        for obligation in obligations:
            obligation.obligation_metadata = {
                **(obligation.obligation_metadata or {}),
                "billing_draft_id": str(billing_draft.id),
                "billing_draft_ids": billing_draft_ids,
            }
    applied_action = (
        "created_insurance_obligation"
        if document_type == "insurance_certificate" and len(obligations) == 1
        else "prepared_billing_work"
        if document_type == "invoice_admin"
        else "created_document_obligations"
    )
    intake.review_data = {
        **reviewed,
        "applied": {
            "obligation_id": obligation_ids[0],
            "obligation_ids": obligation_ids,
            "obligation_count": len(obligation_ids),
            "billing_draft_id": billing_draft_ids[0] if billing_draft_ids else None,
            "billing_draft_ids": billing_draft_ids,
            "billing_draft_count": len(billing_draft_ids),
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
            "applied_billing_draft_ids": billing_draft_ids,
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


@router.post("/{intake_id}/accept-lease-match", response_model=DocumentIntakeRead)
def accept_document_intake_lease_match(
    intake_id: UUID,
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
            detail="Document intake is not ready to accept.",
        )

    reviewed = _reviewed_data(intake)
    document_type = _str(reviewed.get("document_type")) or intake.document_type
    if document_type != "lease":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only lease matches can be accepted.",
        )
    match = _dict(reviewed.get("lease_auto_match")) or _dict(
        _dict(intake.extracted_data).get("lease_auto_match")
    )
    if match.get("status") != "matched":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease match must be matched before it can be accepted.",
        )
    if _records(match.get("differences")) or (
        isinstance(match.get("missing_fields"), list) and match.get("missing_fields")
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resolve lease match differences before accepting.",
        )
    document_metadata = _dict(intake.document.document_metadata)
    if (
        intake.document.tenant_onboarding_id is None
        or document_metadata.get("source") != "tenant_portal"
        or document_metadata.get("auto_match_candidate") != "tenant_uploaded_lease"
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only tenant-uploaded scoped lease matches can be accepted.",
        )
    lease_id = _str(match.get("lease_id"))
    if lease_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease match is missing the matched lease.",
        )
    lease = session.get(Lease, UUID(lease_id))
    if lease is None or lease.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Matched lease not found.",
        )
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if (
        intake.document.lease_id != lease.id
        or intake.document.tenant_id != lease.tenant_id
        or intake.document.tenancy_unit_id != lease.tenancy_unit_id
        or unit is None
        or intake.document.property_id != unit.property_id
        or intake.document.entity_id != unit.property.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Matched lease does not match the uploaded document scope.",
        )
    onboarding = session.get(TenantOnboarding, intake.document.tenant_onboarding_id)
    if (
        onboarding is None
        or onboarding.deleted_at is not None
        or onboarding.lease_id != lease.id
        or onboarding.tenant_id != lease.tenant_id
        or onboarding.entity_id != intake.document.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Matched lease does not match the uploaded onboarding scope.",
        )
    if onboarding is not None and _active_docusign_signing_for_onboarding(onboarding):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Resolve the active DocuSign envelope before accepting a "
                "tenant-uploaded lease."
            ),
        )

    now = utcnow()
    intake.review_data = {
        **reviewed,
        "applied": {
            "action": "accepted_tenant_lease_match",
            "lease_id": str(lease.id),
            "document_id": str(intake.document_id),
            "matched_field_count": len(_records(match.get("matched_fields"))),
            "difference_count": len(_records(match.get("differences"))),
            "missing_field_count": len(match.get("missing_fields") or [])
            if isinstance(match.get("missing_fields"), list)
            else 0,
            "guardrail": (
                "Accepted the tenant-uploaded lease match. The existing lease "
                "record was not mutated."
            ),
        },
    }
    intake.status = DocumentIntakeStatus.applied
    intake.reviewed_at = intake.reviewed_at or now
    intake.reviewed_by_user_id = intake.reviewed_by_user_id or user.id
    intake.applied_at = now
    intake.applied_by_user_id = user.id
    intake.document.category = DocumentCategory.lease
    intake.document.lease_id = lease.id
    intake.document.tenancy_unit_id = lease.tenancy_unit_id
    intake.document.tenant_id = lease.tenant_id
    intake.document.property_id = unit.property_id
    intake.document.document_metadata = {
        **(intake.document.document_metadata or {}),
        "accepted_lease_match": True,
        "accepted_lease_match_id": str(intake.id),
        "accepted_lease_id": str(lease.id),
        "accepted_lease_match_at": now.isoformat(),
        "applied_document_intake_id": str(intake.id),
        "applied_document_type": document_type,
    }
    _mark_tenant_uploaded_lease_match_signed(intake, lease, user, session)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=intake.entity_id,
        action="apply",
        target_table="document_intake",
        target_id=intake.id,
        tool_name="smart_intake_accept_lease_match",
        tool_input={
            "document_id": str(intake.document_id),
            "lease_id": str(lease.id),
        },
        tool_output_summary=(
            "Accepted tenant-uploaded lease match without mutating the lease record."
        ),
        data_classification="confidential",
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
