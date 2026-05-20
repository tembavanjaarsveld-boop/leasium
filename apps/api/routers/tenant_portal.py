"""Tenant portal routes scoped by an onboarding token boundary."""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    DocumentCategory,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
)
from stewart.core.settings import get_settings

from apps.api.deps import get_session
from apps.api.schemas.tenant_portal import (
    TenantPortalAuthRead,
    TenantPortalComplianceItemRead,
    TenantPortalComplianceRead,
    TenantPortalDocumentRead,
    TenantPortalInvoiceLineRead,
    TenantPortalInvoiceRead,
    TenantPortalLeaseRead,
    TenantPortalNotificationPreferencesRead,
    TenantPortalNotificationPreferencesUpdate,
    TenantPortalOnboardingRead,
    TenantPortalPaymentSummaryRead,
    TenantPortalRead,
    TenantPortalTenantRead,
)

router = APIRouter(prefix="/tenant-portal", tags=["tenant-portal"])

PORTAL_TOKEN_HEADER = "x-tenant-portal-token"
PORTAL_TOKEN_QUERY = "portal_token"
PORTAL_PREFERENCES_KEY = "portal_notification_preferences"
PORTAL_UPLOAD_CATEGORIES = (
    DocumentCategory.insurance,
    DocumentCategory.bank_guarantee,
    DocumentCategory.lease,
    DocumentCategory.onboarding,
    DocumentCategory.other,
)


@dataclass(frozen=True)
class PortalAuth:
    token: str
    source: Literal["header", "query", "form"]

    @property
    def mode(self) -> Literal["tenant_portal_token", "tenant_portal_token_dev_fallback"]:
        if self.source == "header":
            return "tenant_portal_token"
        return "tenant_portal_token_dev_fallback"

    @property
    def actor(self) -> str:
        return f"tenant-portal:{self.source}:{self.token[:8]}"

    def read(self) -> TenantPortalAuthRead:
        dev_fallback = self.source != "header"
        return TenantPortalAuthRead(
            mode=self.mode,
            token_source=self.source,
            tenant_auth_configured=False,
            dev_fallback=dev_fallback,
            boundary="tenant_onboarding_token",
            detail=(
                "Tenant identity-provider auth is not wired yet. Access is scoped to the "
                "tenant linked to this onboarding token"
                + (" via a controlled development fallback." if dev_fallback else ".")
            ),
        )


@dataclass(frozen=True)
class PortalScope:
    auth: PortalAuth
    onboarding: TenantOnboarding
    lease: Lease
    property: Property
    unit: TenancyUnit
    tenant: Tenant


def _property_address(prop: Property) -> str | None:
    parts = [prop.street_address, prop.suburb, prop.state, prop.postcode]
    address = ", ".join(part for part in parts if part)
    return address or None


def _is_expired(row: TenantOnboarding) -> bool:
    if row.expires_at is None:
        return False
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= utcnow()


def _parse_iso_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _parse_iso_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _clean_token(value: str | None) -> str | None:
    token = value.strip() if value else ""
    return token or None


def _portal_auth(
    request: Request,
    *,
    header_token: str | None = None,
    form_token: str | None = None,
) -> PortalAuth:
    header_value = _clean_token(header_token or request.headers.get(PORTAL_TOKEN_HEADER))
    if header_value is not None:
        return PortalAuth(token=header_value, source="header")

    # This mirrors the existing public onboarding-link pattern and is intentionally
    # labelled as a development fallback in every response that uses it.
    form_value = _clean_token(form_token)
    if form_value is not None:
        return PortalAuth(token=form_value, source="form")

    query_value = _clean_token(request.query_params.get(PORTAL_TOKEN_QUERY))
    if query_value is not None:
        return PortalAuth(token=query_value, source="query")

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Tenant portal token required.",
    )


def _lease_scope(lease_id: UUID, session: Session) -> tuple[Lease, Property, TenancyUnit]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found.")
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found.")
    prop = session.get(Property, unit.property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found.")
    return lease, prop, unit


def _portal_scope(
    request: Request,
    session: Session,
    *,
    header_token: str | None = None,
    form_token: str | None = None,
) -> PortalScope:
    auth = _portal_auth(request, header_token=header_token, form_token=form_token)
    onboarding = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.token == auth.token,
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    if (
        onboarding is None
        or onboarding.status == TenantOnboardingStatus.cancelled
        or _is_expired(onboarding)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found.")

    tenant = session.get(Tenant, onboarding.tenant_id)
    if (
        tenant is None
        or tenant.deleted_at is not None
        or tenant.entity_id != onboarding.entity_id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found.")

    lease, prop, unit = _lease_scope(onboarding.lease_id, session)
    if (
        lease.tenant_id != tenant.id
        or prop.entity_id != onboarding.entity_id
        or tenant.entity_id != prop.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Portal scope is inconsistent.",
        )

    return PortalScope(
        auth=auth,
        onboarding=onboarding,
        lease=lease,
        property=prop,
        unit=unit,
        tenant=tenant,
    )


def _document_source(document: StoredDocument) -> str:
    metadata = document.document_metadata or {}
    source = metadata.get("source")
    if source == "invoice_draft_pdf_artifact":
        return "invoice"
    if source == "tenant_portal":
        return "tenant_portal"
    if document.tenant_onboarding_id is not None:
        return "tenant_onboarding"
    return "tenant_record"


def _document_read(document: StoredDocument) -> TenantPortalDocumentRead:
    return TenantPortalDocumentRead(
        id=document.id,
        filename=document.filename,
        content_type=document.content_type,
        byte_size=document.byte_size,
        category=document.category,
        notes=document.notes,
        source=_document_source(document),
        created_at=document.created_at,
    )


def _tenant_documents(scope: PortalScope, session: Session) -> list[StoredDocument]:
    return list(
        session.scalars(
            select(StoredDocument)
            .where(
                StoredDocument.entity_id == scope.onboarding.entity_id,
                StoredDocument.tenant_id == scope.tenant.id,
                StoredDocument.category != DocumentCategory.invoice,
                StoredDocument.deleted_at.is_(None),
            )
            .order_by(StoredDocument.created_at.desc())
        )
    )


def _uuid_from_metadata(value: object) -> UUID | None:
    if not isinstance(value, str):
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def _invoice_pdf_document_id(invoice: InvoiceDraft) -> UUID | None:
    metadata = invoice.invoice_metadata or {}
    artifact = metadata.get("pdf_artifact")
    if not isinstance(artifact, dict):
        return None
    return _uuid_from_metadata(artifact.get("document_id"))


def _portal_invoices(scope: PortalScope, session: Session) -> list[InvoiceDraft]:
    return list(
        session.scalars(
            select(InvoiceDraft)
            .where(
                InvoiceDraft.entity_id == scope.onboarding.entity_id,
                InvoiceDraft.tenant_id == scope.tenant.id,
                InvoiceDraft.status == InvoiceDraftStatus.approved,
                InvoiceDraft.deleted_at.is_(None),
            )
            .order_by(InvoiceDraft.due_date, InvoiceDraft.created_at.desc())
        )
    )


def _int_metadata(value: object, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    return default


def _invoice_payment(invoice: InvoiceDraft) -> tuple[str, int, int]:
    metadata = invoice.invoice_metadata or {}
    raw = metadata.get("payment_status")
    payment = raw if isinstance(raw, dict) else {}
    status_value = payment.get("status")
    payment_status = status_value if isinstance(status_value, str) and status_value else "unpaid"
    paid_cents = _int_metadata(payment.get("paid_cents"), 0)
    outstanding_cents = _int_metadata(
        payment.get("outstanding_cents"),
        max(invoice.total_cents - paid_cents, 0),
    )
    return payment_status, max(paid_cents, 0), max(outstanding_cents, 0)


def _invoice_read(invoice: InvoiceDraft) -> TenantPortalInvoiceRead:
    payment_status, paid_cents, outstanding_cents = _invoice_payment(invoice)
    return TenantPortalInvoiceRead(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        title=invoice.title,
        status=invoice.status.value,
        issue_date=invoice.issue_date,
        due_date=invoice.due_date,
        currency=invoice.currency,
        subtotal_cents=invoice.subtotal_cents,
        gst_cents=invoice.gst_cents,
        total_cents=invoice.total_cents,
        paid_cents=paid_cents,
        outstanding_cents=outstanding_cents,
        payment_status=payment_status,
        pdf_document_id=_invoice_pdf_document_id(invoice),
        lines=[
            TenantPortalInvoiceLineRead(
                id=line.id,
                description=line.description,
                amount_cents=line.amount_cents,
                gst_cents=line.gst_cents,
                currency=line.currency,
            )
            for line in invoice.lines
            if line.deleted_at is None
        ],
    )


def _payment_summary(invoices: list[InvoiceDraft]) -> TenantPortalPaymentSummaryRead:
    today = utcnow().date()
    invoice_count = len(invoices)
    total_cents = sum(invoice.total_cents for invoice in invoices)
    paid_cents = 0
    outstanding_cents = 0
    overdue_count = 0
    next_due_date = None
    for invoice in invoices:
        _payment_status, invoice_paid, invoice_outstanding = _invoice_payment(invoice)
        paid_cents += invoice_paid
        outstanding_cents += invoice_outstanding
        if invoice_outstanding > 0 and invoice.due_date is not None:
            if invoice.due_date < today:
                overdue_count += 1
            if next_due_date is None or invoice.due_date < next_due_date:
                next_due_date = invoice.due_date
    if invoice_count == 0:
        summary_status: Literal["no_invoices", "paid", "unpaid", "overdue"] = "no_invoices"
    elif overdue_count:
        summary_status = "overdue"
    elif outstanding_cents <= 0:
        summary_status = "paid"
    else:
        summary_status = "unpaid"
    return TenantPortalPaymentSummaryRead(
        invoice_count=invoice_count,
        total_cents=total_cents,
        paid_cents=paid_cents,
        outstanding_cents=outstanding_cents,
        overdue_count=overdue_count,
        next_due_date=next_due_date,
        status=summary_status,
    )


def _latest_document(
    documents: list[StoredDocument],
    category: DocumentCategory,
) -> StoredDocument | None:
    rows = [document for document in documents if document.category == category]
    return rows[0] if rows else None


def _compliance(scope: PortalScope, documents: list[StoredDocument]) -> TenantPortalComplianceRead:
    metadata = scope.tenant.tenant_metadata or {}
    insurance_expiry = _parse_iso_date(metadata.get("insurance_expiry_date"))
    today = utcnow().date()
    insurance_document = _latest_document(documents, DocumentCategory.insurance)
    insurance_status: Literal["missing", "received", "expired", "not_on_file"] = (
        "received" if insurance_document is not None else "missing"
    )
    if insurance_expiry is not None and insurance_expiry < today:
        insurance_status = "expired"

    items = [
        TenantPortalComplianceItemRead(
            key="insurance",
            label="Insurance",
            status=insurance_status,
            document_count=sum(
                1 for doc in documents if doc.category == DocumentCategory.insurance
            ),
            latest_document=_document_read(insurance_document) if insurance_document else None,
            due_date=insurance_expiry,
        ),
        TenantPortalComplianceItemRead(
            key="bank_guarantee",
            label="Bank guarantee",
            status=(
                "received"
                if _latest_document(documents, DocumentCategory.bank_guarantee)
                else "not_on_file"
            ),
            document_count=sum(
                1 for doc in documents if doc.category == DocumentCategory.bank_guarantee
            ),
            latest_document=(
                _document_read(latest)
                if (latest := _latest_document(documents, DocumentCategory.bank_guarantee))
                else None
            ),
        ),
        TenantPortalComplianceItemRead(
            key="onboarding",
            label="Onboarding files",
            status=(
                "received"
                if _latest_document(documents, DocumentCategory.onboarding)
                else "not_on_file"
            ),
            document_count=sum(
                1 for doc in documents if doc.category == DocumentCategory.onboarding
            ),
            latest_document=(
                _document_read(latest)
                if (latest := _latest_document(documents, DocumentCategory.onboarding))
                else None
            ),
        ),
    ]
    return TenantPortalComplianceRead(
        accepted_categories=list(PORTAL_UPLOAD_CATEGORIES),
        items=items,
        uploaded_documents=[_document_read(document) for document in documents],
    )


def _preferred_channel(
    email_enabled: bool,
    sms_enabled: bool,
) -> Literal["email", "sms", "both", "none"]:
    if email_enabled and sms_enabled:
        return "both"
    if email_enabled:
        return "email"
    if sms_enabled:
        return "sms"
    return "none"


def _bool_pref(raw: dict[str, object], key: str, default: bool) -> bool:
    value = raw.get(key)
    return value if isinstance(value, bool) else default


def _notification_preferences(tenant: Tenant) -> TenantPortalNotificationPreferencesRead:
    metadata = tenant.tenant_metadata or {}
    raw_preferences = metadata.get(PORTAL_PREFERENCES_KEY)
    preferences = raw_preferences if isinstance(raw_preferences, dict) else {}
    email_enabled = _bool_pref(
        preferences,
        "email_enabled",
        bool(tenant.contact_email or tenant.billing_email),
    )
    sms_enabled = _bool_pref(preferences, "sms_enabled", bool(tenant.contact_phone))
    billing_email_enabled = _bool_pref(
        preferences,
        "billing_email_enabled",
        bool(tenant.billing_email),
    )
    compliance_reminders_enabled = _bool_pref(
        preferences,
        "compliance_reminders_enabled",
        True,
    )
    return TenantPortalNotificationPreferencesRead(
        email_enabled=email_enabled,
        sms_enabled=sms_enabled,
        billing_email_enabled=billing_email_enabled,
        compliance_reminders_enabled=compliance_reminders_enabled,
        preferred_channel=_preferred_channel(email_enabled, sms_enabled),
        updated_at=_parse_iso_datetime(preferences.get("updated_at")),
    )


def _portal_read(scope: PortalScope, session: Session) -> TenantPortalRead:
    documents = _tenant_documents(scope, session)
    invoices = _portal_invoices(scope, session)
    return TenantPortalRead(
        auth=scope.auth.read(),
        tenant=TenantPortalTenantRead(
            id=scope.tenant.id,
            legal_name=scope.tenant.legal_name,
            trading_name=scope.tenant.trading_name,
            contact_name=scope.tenant.contact_name,
            contact_email=scope.tenant.contact_email,
            contact_phone=scope.tenant.contact_phone,
            billing_email=scope.tenant.billing_email,
        ),
        lease=TenantPortalLeaseRead(
            lease_id=scope.lease.id,
            status=scope.lease.status.value,
            property_name=scope.property.name,
            property_address=_property_address(scope.property),
            unit_label=scope.unit.unit_label,
            commencement_date=scope.lease.commencement_date,
            expiry_date=scope.lease.expiry_date,
            next_review_date=scope.lease.next_review_date,
        ),
        onboarding=TenantPortalOnboardingRead(
            id=scope.onboarding.id,
            status=scope.onboarding.status.value,
            due_date=scope.onboarding.due_date,
            expires_at=scope.onboarding.expires_at,
            submitted_at=scope.onboarding.submitted_at,
            last_sent_at=scope.onboarding.last_sent_at,
            document_count=len(documents),
        ),
        compliance=_compliance(scope, documents),
        invoices=[_invoice_read(invoice) for invoice in invoices],
        payment_summary=_payment_summary(invoices),
        notification_preferences=_notification_preferences(scope.tenant),
        guardrails=[
            "Tenant portal responses are scoped to the tenant attached to the onboarding token.",
            "Only approved invoice drafts are visible to tenants.",
            "Notification preference updates do not send email or SMS.",
        ],
    )


def _invoice_document_allowed(
    scope: PortalScope,
    document: StoredDocument,
    session: Session,
) -> bool:
    metadata = document.document_metadata or {}
    invoice_id = _uuid_from_metadata(metadata.get("invoice_draft_id"))
    if invoice_id is None:
        return False
    invoice = session.get(InvoiceDraft, invoice_id)
    return bool(
        invoice is not None
        and invoice.deleted_at is None
        and invoice.status == InvoiceDraftStatus.approved
        and invoice.entity_id == scope.onboarding.entity_id
        and invoice.tenant_id == scope.tenant.id
        and _invoice_pdf_document_id(invoice) == document.id
    )


def _portal_document(
    scope: PortalScope,
    document_id: UUID,
    session: Session,
) -> StoredDocument:
    document = session.get(StoredDocument, document_id)
    if (
        document is None
        or document.deleted_at is not None
        or document.entity_id != scope.onboarding.entity_id
        or document.tenant_id != scope.tenant.id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    if document.category == DocumentCategory.invoice and not _invoice_document_allowed(
        scope,
        document,
        session,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


@router.get("/session", response_model=TenantPortalRead)
def get_tenant_portal(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> TenantPortalRead:
    scope = _portal_scope(
        request,
        session,
        header_token=x_tenant_portal_token,
    )
    return _portal_read(scope, session)


@router.patch("/notification-preferences", response_model=TenantPortalNotificationPreferencesRead)
def update_notification_preferences(
    payload: TenantPortalNotificationPreferencesUpdate,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> TenantPortalNotificationPreferencesRead:
    scope = _portal_scope(
        request,
        session,
        header_token=x_tenant_portal_token,
    )
    current = _notification_preferences(scope.tenant).model_dump(mode="json")
    updates = payload.model_dump(exclude_unset=True)
    current.update(updates)
    current["updated_at"] = utcnow().isoformat()
    current["source"] = scope.auth.mode
    metadata = dict(scope.tenant.tenant_metadata or {})
    metadata[PORTAL_PREFERENCES_KEY] = current
    scope.tenant.tenant_metadata = metadata
    audit_log(
        session,
        actor=scope.auth.actor,
        entity_id=scope.onboarding.entity_id,
        action="update",
        target_table="tenant",
        target_id=scope.tenant.id,
        tool_name="tenant_portal.notification_preferences",
        tool_input={key: value for key, value in updates.items() if value is not None},
        tool_output_summary="Updated tenant portal notification preferences; no message sent.",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(scope.tenant)
    return _notification_preferences(scope.tenant)


@router.post(
    "/documents",
    response_model=TenantPortalDocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_tenant_portal_document(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    file: Annotated[UploadFile, File()],
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
    portal_token: Annotated[str | None, Form()] = None,
    category: Annotated[DocumentCategory, Form()] = DocumentCategory.onboarding,
    notes: Annotated[str | None, Form()] = None,
) -> TenantPortalDocumentRead:
    scope = _portal_scope(
        request,
        session,
        header_token=x_tenant_portal_token,
        form_token=portal_token,
    )
    if category not in PORTAL_UPLOAD_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Category is not available for tenant portal upload.",
        )
    data = await file.read()
    max_bytes = get_settings().document_max_bytes
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty.")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Document is too large. Max size is {max_bytes // 1_000_000}MB.",
        )

    document = StoredDocument(
        entity_id=scope.onboarding.entity_id,
        property_id=scope.property.id,
        tenancy_unit_id=scope.unit.id,
        tenant_id=scope.tenant.id,
        lease_id=scope.lease.id,
        tenant_onboarding_id=scope.onboarding.id,
        filename=Path(file.filename or "document").name,
        content_type=file.content_type,
        byte_size=len(data),
        file_data=data,
        category=category,
        notes=notes.strip() if notes and notes.strip() else None,
        document_metadata={
            "source": "tenant_portal",
            "auth_boundary": "tenant_onboarding_token",
            "auth_mode": scope.auth.mode,
            "uploaded_at": utcnow().isoformat(),
        },
    )
    session.add(document)
    session.flush()
    audit_log(
        session,
        actor=scope.auth.actor,
        entity_id=scope.onboarding.entity_id,
        action="upload",
        target_table="stored_document",
        target_id=document.id,
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    session.commit()
    session.refresh(document)
    return _document_read(document)


@router.get("/documents/{document_id}/download")
def download_tenant_portal_document(
    document_id: UUID,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> Response:
    scope = _portal_scope(
        request,
        session,
        header_token=x_tenant_portal_token,
    )
    document = _portal_document(scope, document_id, session)
    return Response(
        content=document.file_data,
        media_type=document.content_type or "application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(document.filename)}"},
    )
