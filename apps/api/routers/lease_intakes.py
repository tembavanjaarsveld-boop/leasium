"""Lease upload intake routes."""

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
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, sessionmaker
from stewart.ai.lease_intake import LeaseExtractionError, extract_lease_file
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    Lease,
    LeaseIntake,
    LeaseIntakeStatus,
    LeaseStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    PropertyType,
    RentFrequency,
    TenancyUnit,
    Tenant,
    UserRole,
)
from stewart.core.settings import get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.lease_intake import LeaseIntakeApplyRequest, LeaseIntakeRead

router = APIRouter(prefix="/lease-intakes", tags=["lease-intakes"])

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


def _int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(str(value)))
    except ValueError:
        return None


def _float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value))
    except ValueError:
        return None


def _annual_rent_cents(data: dict[str, Any]) -> int | None:
    cents = _int(data.get("annual_rent_cents"))
    if cents is not None:
        return cents
    dollars = _float(data.get("annual_rent_dollars"))
    if dollars is None:
        dollars = _float(data.get("annual_rent"))
    if dollars is None:
        return None
    return int(round(dollars * 100))


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "y"}
    return default


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


def _enum(enum_type: type[Any], value: Any, default: Any) -> Any:
    text = _str(value)
    if text is None:
        return default
    try:
        return enum_type(text)
    except ValueError:
        return default


def _uuid_or_none(value: Any) -> UUID | None:
    text = _str(value)
    if text is None:
        return None
    try:
        return UUID(text)
    except ValueError:
        return None


def _context_property_id(extracted: dict[str, Any]) -> UUID | None:
    return _uuid_or_none(_dict(extracted.get("context")).get("property_id"))


def _apply_validation_errors(
    payload: LeaseIntakeApplyRequest,
    extracted: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    property_data = _dict(extracted.get("property"))
    unit_data = _dict(extracted.get("tenancy_unit"))
    tenant_data = _dict(extracted.get("tenant"))
    lease_data = _dict(extracted.get("lease"))

    has_property_reference = payload.property_id is not None or _context_property_id(extracted)
    property_name = _str(property_data.get("name"))
    property_address = _str(property_data.get("street_address")) or _str(
        property_data.get("address")
    )
    if not has_property_reference and not (property_name or property_address):
        errors.append("Choose an existing property or confirm a property name/address.")

    unit_label = _str(unit_data.get("unit_label")) or _str(unit_data.get("label"))
    if payload.tenancy_unit_id is None and not unit_label:
        errors.append("Choose an existing unit or confirm a unit label.")

    tenant_name = _str(tenant_data.get("legal_name")) or _str(tenant_data.get("name"))
    if payload.tenant_id is None and not tenant_name:
        errors.append("Choose an existing tenant or confirm the tenant legal name.")

    if _date(lease_data.get("commencement_date")) is None:
        errors.append("Confirm the lease start date.")
    if _date(lease_data.get("expiry_date")) is None:
        errors.append("Confirm the lease expiry date.")
    if _annual_rent_cents(lease_data) is None:
        errors.append("Confirm the lease rent amount.")
    if _enum(RentFrequency, lease_data.get("rent_frequency"), None) is None:
        errors.append("Confirm the lease rent frequency.")
    return errors


def _assert_no_overlapping_lease(
    unit: TenancyUnit,
    extracted: dict[str, Any],
    session: Session,
) -> None:
    lease_data = _dict(extracted.get("lease"))
    start = _date(lease_data.get("commencement_date"))
    end = _date(lease_data.get("expiry_date"))
    if start is None or end is None:
        return
    overlapping_lease = session.scalar(
        select(Lease).where(
            Lease.tenancy_unit_id == unit.id,
            Lease.deleted_at.is_(None),
            or_(Lease.commencement_date.is_(None), Lease.commencement_date <= end),
            or_(Lease.expiry_date.is_(None), Lease.expiry_date >= start),
        )
    )
    if overlapping_lease is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This unit already has a lease overlapping the reviewed date range.",
        )


def _clear_orphaned_unit_leases(
    unit: TenancyUnit,
    entity_id: UUID,
    user: CurrentUser,
    session: Session,
) -> None:
    """Soft-delete leases on this unit whose tenant has been deleted. An
    orphaned lease (its tenant removed) must not block — or later duplicate —
    a fresh lease when the document is re-imported."""
    leases = session.scalars(
        select(Lease).where(
            Lease.tenancy_unit_id == unit.id,
            Lease.deleted_at.is_(None),
        )
    ).all()
    now = utcnow()
    for lease in leases:
        tenant = session.get(Tenant, lease.tenant_id)
        if tenant is not None and tenant.deleted_at is None:
            continue
        lease.deleted_at = now
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=entity_id,
            action="delete",
            target_table="lease",
            target_id=lease.id,
            tool_name="lease_intake.apply",
            tool_output_summary=(
                "Orphaned lease (tenant removed) cleared before re-creating the lease."
            ),
        )


def _get_intake(
    intake_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> LeaseIntake:
    intake = session.get(LeaseIntake, intake_id)
    if intake is None or intake.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lease intake not found.")
    assert_entity_role(session, user, intake.entity_id, roles)
    return intake


def _property_for_entity(
    property_id: UUID,
    entity_id: UUID,
    user: CurrentUser,
    session: Session,
) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None or prop.entity_id != entity_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    assert_entity_role(session, user, prop.entity_id, WRITE_ROLES)
    return prop


def _validate_upload(filename: str, content_type: str | None) -> None:
    if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Lease intake supports PDF, Word, TXT, and Markdown files.",
        )
    if content_type and content_type not in SUPPORTED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Lease intake supports PDF, Word, TXT, and Markdown files.",
        )


def _audit_extract(
    intake: LeaseIntake,
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
        target_table="lease_intake",
        target_id=intake.id,
        tool_name="openai.responses",
        tool_input={"filename": intake.filename, "byte_size": intake.byte_size},
        tool_output_summary=None if error_message else "Lease details prepared for review.",
        outcome=outcome,
        error_message=error_message,
    )


def _extract_into_intake(intake: LeaseIntake, user: CurrentUser, session: Session) -> None:
    settings = get_settings()
    intake.status = LeaseIntakeStatus.extracting
    intake.error_message = None
    session.flush()
    try:
        extracted, response_id = extract_lease_file(
            file_data=intake.file_data,
            filename=intake.filename,
            content_type=intake.content_type,
            settings=settings,
        )
    except LeaseExtractionError as exc:
        intake.status = LeaseIntakeStatus.extraction_failed
        intake.error_message = str(exc)
        _audit_extract(
            intake,
            user,
            session,
            outcome=AuditOutcome.error,
            error_message=str(exc),
        )
        return

    context = _dict(intake.extracted_data).get("context")
    if isinstance(context, dict):
        extracted.setdefault("context", {}).update(context)
    intake.status = LeaseIntakeStatus.extracted
    intake.extracted_data = extracted
    intake.openai_response_id = response_id
    _audit_extract(intake, user, session)


def _extract_intake_background(intake_id: UUID, user: CurrentUser, bind: Any) -> None:
    BackgroundSession = sessionmaker(
        bind=bind,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    with BackgroundSession() as session:
        intake = session.get(LeaseIntake, intake_id)
        if intake is None or intake.deleted_at is not None:
            return
        if intake.status == LeaseIntakeStatus.applied:
            return
        intake.status = LeaseIntakeStatus.extracting
        intake.error_message = None
        session.commit()
        _extract_into_intake(intake, user, session)
        session.commit()


@router.get("", response_model=list[LeaseIntakeRead])
def list_lease_intakes(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID,
) -> list[LeaseIntake]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    return list(
        session.scalars(
            select(LeaseIntake)
            .where(LeaseIntake.entity_id == entity_id, LeaseIntake.deleted_at.is_(None))
            .order_by(LeaseIntake.created_at.desc())
        )
    )


@router.post("", response_model=LeaseIntakeRead, status_code=status.HTTP_201_CREATED)
async def create_lease_intake(
    background_tasks: BackgroundTasks,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Form()],
    file: Annotated[UploadFile, File()],
    property_id: Annotated[UUID | None, Form()] = None,
    extract: Annotated[bool, Form()] = True,
) -> LeaseIntake:
    settings = get_settings()
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    if property_id is not None:
        _property_for_entity(property_id, entity_id, user, session)

    filename = Path(file.filename or "lease").name
    _validate_upload(filename, file.content_type)
    data = await file.read(settings.lease_intake_max_bytes + 1)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File is empty.",
        )
    if len(data) > settings.lease_intake_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Lease file is larger than the configured intake limit.",
        )

    intake = LeaseIntake(
        entity_id=entity_id,
        filename=filename,
        content_type=file.content_type,
        byte_size=len(data),
        file_data=data,
        status=LeaseIntakeStatus.uploaded,
        extracted_data={"context": {"property_id": str(property_id)} if property_id else {}},
    )
    session.add(intake)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="upload",
        target_table="lease_intake",
        target_id=intake.id,
    )
    session.commit()
    session.refresh(intake)
    if extract:
        background_tasks.add_task(_extract_intake_background, intake.id, user, session.get_bind())
    return intake


@router.post("/{intake_id}/extract", response_model=LeaseIntakeRead)
def extract_lease_intake(
    intake_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> LeaseIntake:
    intake = _get_intake(intake_id, user, session, WRITE_ROLES)
    if intake.status == LeaseIntakeStatus.applied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Applied lease intakes cannot be extracted again.",
        )
    _extract_into_intake(intake, user, session)
    session.commit()
    session.refresh(intake)
    if intake.status == LeaseIntakeStatus.extraction_failed:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=intake.error_message or "Lease extraction failed.",
        )
    return intake


@router.get("/{intake_id}", response_model=LeaseIntakeRead)
def get_lease_intake(
    intake_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> LeaseIntake:
    return _get_intake(intake_id, user, session, READ_ROLES)


@router.post("/{intake_id}/apply", response_model=LeaseIntakeRead)
def apply_lease_intake(
    intake_id: UUID,
    payload: LeaseIntakeApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> LeaseIntake:
    intake = _get_intake(intake_id, user, session, WRITE_ROLES)
    if intake.status == LeaseIntakeStatus.applied:
        return intake
    if intake.status not in {LeaseIntakeStatus.extracted, LeaseIntakeStatus.apply_failed}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease intake is not ready to apply.",
        )

    try:
        prop, unit, tenant, lease, obligations = _apply_lease_records(
            intake,
            payload,
            user,
            session,
        )
    except HTTPException:
        intake.status = LeaseIntakeStatus.apply_failed
        intake.error_message = "Lease could not be applied."
        session.commit()
        raise
    except Exception as exc:
        intake.status = LeaseIntakeStatus.apply_failed
        intake.error_message = "Lease could not be applied."
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=intake.entity_id,
            action="apply",
            target_table="lease_intake",
            target_id=intake.id,
            outcome=AuditOutcome.error,
            error_message=str(exc),
        )
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Lease could not be applied.",
        ) from exc

    intake.status = LeaseIntakeStatus.applied
    intake.applied_lease_id = lease.id
    intake.applied_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=intake.entity_id,
        action="apply",
        target_table="lease_intake",
        target_id=intake.id,
        tool_output_summary=(
            f"Created lease {lease.id} for tenant {tenant.id}; "
            f"{len(obligations)} obligations added."
        ),
    )
    session.commit()
    session.refresh(intake)
    return intake


def _apply_lease_records(
    intake: LeaseIntake,
    payload: LeaseIntakeApplyRequest,
    user: CurrentUser,
    session: Session,
) -> tuple[Property, TenancyUnit, Tenant, Lease, list[Obligation]]:
    extracted = _dict(payload.reviewed_data) or _dict(intake.extracted_data)
    context = _dict(intake.extracted_data).get("context")
    if isinstance(context, dict):
        extracted.setdefault("context", {}).update(context)
    validation_errors = _apply_validation_errors(payload, extracted)
    if validation_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=validation_errors,
        )
    intake.extracted_data = extracted
    prop = _find_or_create_property(payload.property_id, intake, extracted, user, session)
    unit = _find_or_create_unit(payload.tenancy_unit_id, prop, extracted, intake, session)
    _clear_orphaned_unit_leases(unit, prop.entity_id, user, session)
    _assert_no_overlapping_lease(unit, extracted, session)
    tenant = _find_or_create_tenant(payload.tenant_id, intake, extracted, user, session)
    lease = _create_lease(unit, tenant, intake, extracted, session)
    obligations = _create_obligations(intake, prop, unit, lease, extracted, session)
    return prop, unit, tenant, lease, obligations


def _find_or_create_property(
    property_id: UUID | None,
    intake: LeaseIntake,
    extracted: dict[str, Any],
    user: CurrentUser,
    session: Session,
) -> Property:
    data = _dict(extracted.get("property"))
    resolved_property_id = property_id or _context_property_id(extracted)
    if resolved_property_id is not None:
        prop = _property_for_entity(resolved_property_id, intake.entity_id, user, session)
        _fill_blank_property_billing_fields(prop, data)
        return prop

    name = _str(data.get("name"))
    street_address = _str(data.get("street_address")) or _str(data.get("address"))
    if name:
        statement = select(Property).where(
            Property.entity_id == intake.entity_id,
            Property.deleted_at.is_(None),
            func.lower(Property.name) == name.lower(),
        )
        if street_address:
            statement = statement.where(
                func.lower(Property.street_address) == street_address.lower()
            )
        existing = session.scalar(statement)
        if existing is not None:
            _fill_blank_property_billing_fields(existing, data)
            return existing

    prop = Property(
        entity_id=intake.entity_id,
        name=name or street_address or Path(intake.filename).stem or "Lease property",
        street_address=street_address or "Address to confirm",
        suburb=_str(data.get("suburb")),
        state=_str(data.get("state")),
        postcode=_str(data.get("postcode")),
        country_code=_str(data.get("country_code")) or "AU",
        property_type=_enum(PropertyType, data.get("property_type"), PropertyType.other),
        parcel_id=_str(data.get("parcel_id")),
        land_sqm=_float(data.get("land_sqm")),
        building_sqm=_float(data.get("building_sqm")),
        parking_spaces=_int(data.get("parking_spaces")),
        ownership_structure=_str(data.get("ownership_structure")),
        owner_legal_name=_str(data.get("owner_legal_name")),
        owner_abn=_str(data.get("owner_abn")),
        trustee_name=_str(data.get("trustee_name")),
        trust_name=_str(data.get("trust_name")),
        invoice_issuer_name=_str(data.get("invoice_issuer_name")),
        billing_contact_name=_str(data.get("billing_contact_name")),
        billing_email=_str(data.get("billing_email")),
        invoice_reference=_str(data.get("invoice_reference")),
        ownership_split=_str(data.get("ownership_split")),
        owner_gst_registered=_optional_bool(data.get("owner_gst_registered")),
        xero_contact_id=_str(data.get("xero_contact_id")),
        xero_tracking_category=_str(data.get("xero_tracking_category")),
        property_metadata={"source": "lease_intake", "lease_intake_id": str(intake.id)},
    )
    session.add(prop)
    session.flush()
    return prop


def _fill_blank_property_billing_fields(prop: Property, data: dict[str, Any]) -> None:
    updates: dict[str, Any] = {
        "ownership_structure": _str(data.get("ownership_structure")),
        "owner_legal_name": _str(data.get("owner_legal_name")),
        "owner_abn": _str(data.get("owner_abn")),
        "trustee_name": _str(data.get("trustee_name")),
        "trust_name": _str(data.get("trust_name")),
        "invoice_issuer_name": _str(data.get("invoice_issuer_name")),
        "billing_contact_name": _str(data.get("billing_contact_name")),
        "billing_email": _str(data.get("billing_email")),
        "invoice_reference": _str(data.get("invoice_reference")),
        "ownership_split": _str(data.get("ownership_split")),
        "owner_gst_registered": _optional_bool(data.get("owner_gst_registered")),
        "xero_contact_id": _str(data.get("xero_contact_id")),
        "xero_tracking_category": _str(data.get("xero_tracking_category")),
    }
    for key, value in updates.items():
        if value is not None and getattr(prop, key) is None:
            setattr(prop, key, value)


def _find_or_create_unit(
    unit_id: UUID | None,
    prop: Property,
    extracted: dict[str, Any],
    intake: LeaseIntake,
    session: Session,
) -> TenancyUnit:
    if unit_id is not None:
        unit = session.get(TenancyUnit, unit_id)
        if unit is None or unit.deleted_at is not None or unit.property_id != prop.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenancy unit not found.",
            )
        return unit

    data = _dict(extracted.get("tenancy_unit"))
    label = _str(data.get("unit_label")) or _str(data.get("label")) or "Main tenancy"
    existing = session.scalar(
        select(TenancyUnit).where(
            TenancyUnit.property_id == prop.id,
            TenancyUnit.deleted_at.is_(None),
            func.lower(TenancyUnit.unit_label) == label.lower(),
        )
    )
    if existing is not None:
        return existing

    unit = TenancyUnit(
        property_id=prop.id,
        unit_label=label,
        sqm=_float(data.get("sqm")),
        parking_spaces=_int(data.get("parking_spaces")),
        unit_metadata={"source": "lease_intake", "lease_intake_id": str(intake.id)},
    )
    session.add(unit)
    session.flush()
    return unit


def _find_or_create_tenant(
    tenant_id: UUID | None,
    intake: LeaseIntake,
    extracted: dict[str, Any],
    user: CurrentUser,
    session: Session,
) -> Tenant:
    if tenant_id is not None:
        tenant = session.get(Tenant, tenant_id)
        if tenant is None or tenant.deleted_at is not None or tenant.entity_id != intake.entity_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found.",
            )
        assert_entity_role(session, user, tenant.entity_id, WRITE_ROLES)
        return tenant

    data = _dict(extracted.get("tenant"))
    legal_name = _str(data.get("legal_name")) or _str(data.get("name")) or "Tenant to confirm"
    abn = _str(data.get("abn"))
    statement = select(Tenant).where(
        Tenant.entity_id == intake.entity_id,
        Tenant.deleted_at.is_(None),
    )
    if abn:
        statement = statement.where(Tenant.abn == abn)
    else:
        statement = statement.where(func.lower(Tenant.legal_name) == legal_name.lower())
    existing = session.scalar(statement)
    if existing is not None:
        return existing

    tenant = Tenant(
        entity_id=intake.entity_id,
        legal_name=legal_name,
        trading_name=_str(data.get("trading_name")),
        abn=abn,
        contact_name=_str(data.get("contact_name")),
        contact_email=_str(data.get("contact_email")),
        contact_phone=_str(data.get("contact_phone")),
        billing_email=_str(data.get("billing_email")) or _str(data.get("contact_email")),
        notes=_str(data.get("notes")),
        tenant_metadata={"source": "lease_intake", "lease_intake_id": str(intake.id)},
    )
    session.add(tenant)
    session.flush()
    return tenant


def _create_lease(
    unit: TenancyUnit,
    tenant: Tenant,
    intake: LeaseIntake,
    extracted: dict[str, Any],
    session: Session,
) -> Lease:
    data = _dict(extracted.get("lease"))
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=_enum(LeaseStatus, data.get("status"), LeaseStatus.pending),
        commencement_date=_date(data.get("commencement_date")),
        expiry_date=_date(data.get("expiry_date")),
        annual_rent_cents=_annual_rent_cents(data),
        rent_frequency=_enum(RentFrequency, data.get("rent_frequency"), None),
        outgoings_recoverable=_bool(data.get("outgoings_recoverable"), True),
        next_review_date=_date(data.get("next_review_date")),
        option_summary=_str(data.get("option_summary")),
        security_summary=_str(data.get("security_summary")),
        notes=_str(data.get("notes")),
        lease_metadata={"source": "lease_intake", "lease_intake_id": str(intake.id)},
    )
    session.add(lease)
    session.flush()
    return lease


def _create_obligations(
    intake: LeaseIntake,
    prop: Property,
    unit: TenancyUnit,
    lease: Lease,
    extracted: dict[str, Any],
    session: Session,
) -> list[Obligation]:
    raw_obligations = extracted.get("obligations")
    extracted_rows: list[Any] = raw_obligations if isinstance(raw_obligations, list) else []
    lease_data = _dict(extracted.get("lease"))
    rows = [row for row in extracted_rows if isinstance(row, dict)]
    if _date(lease_data.get("next_review_date")):
        rows.append(
            {
                "title": "Rent review",
                "category": ObligationCategory.rent_review.value,
                "due_date": lease_data.get("next_review_date"),
                "priority": 1,
                "owner_role": UserRole.finance.value,
            }
        )
    if _date(lease_data.get("expiry_date")):
        rows.append(
            {
                "title": "Lease expiry",
                "category": ObligationCategory.lease_expiry.value,
                "due_date": lease_data.get("expiry_date"),
                "priority": 1,
                "owner_role": UserRole.ops.value,
            }
        )

    seen: set[tuple[str, date, str]] = set()
    obligations: list[Obligation] = []
    for row in rows:
        due_date = _date(row.get("due_date") or row.get("due"))
        title = _str(row.get("title"))
        if due_date is None or title is None:
            continue
        category = _enum(ObligationCategory, row.get("category"), ObligationCategory.other)
        key = (title.lower(), due_date, category.value)
        if key in seen:
            continue
        seen.add(key)
        owner_role = _enum(UserRole, row.get("owner_role"), None)
        obligation = Obligation(
            entity_id=intake.entity_id,
            property_id=prop.id,
            tenancy_unit_id=unit.id,
            lease_id=lease.id,
            title=title,
            category=category,
            status=ObligationStatus.upcoming,
            due_date=due_date,
            priority=_int(row.get("priority")) or 2,
            owner_role=owner_role,
            notes=_str(row.get("notes")),
            obligation_metadata={"source": "lease_intake", "lease_intake_id": str(intake.id)},
        )
        session.add(obligation)
        obligations.append(obligation)
    session.flush()
    return obligations
