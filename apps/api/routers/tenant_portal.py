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
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.auth import _clerk_provider_id
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditOutcome,
    DocumentCategory,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    TenantPortalAccount,
    TenantPortalAccountStatus,
    UserRole,
)
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.tenant_onboarding import TenantOnboardingSubmit
from apps.api.schemas.tenant_portal import (
    TenantPortalAccountClaimCreate,
    TenantPortalAccountLifecycleRead,
    TenantPortalAuthRead,
    TenantPortalComplianceItemRead,
    TenantPortalComplianceRead,
    TenantPortalDocumentRead,
    TenantPortalInvitePreviewRead,
    TenantPortalInvoiceLineRead,
    TenantPortalInvoiceRead,
    TenantPortalLeaseRead,
    TenantPortalMaintenanceHistoryItemRead,
    TenantPortalMaintenanceRequestCreate,
    TenantPortalMaintenanceRequestRead,
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
ACTIVITY_HISTORY_KEY = "activity_history"
READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}
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
class PortalAccountAuth:
    account: TenantPortalAccount

    @property
    def mode(self) -> Literal["tenant_portal_account"]:
        return "tenant_portal_account"

    @property
    def source(self) -> Literal["bearer"]:
        return "bearer"

    @property
    def actor(self) -> str:
        return f"tenant-portal-account:{self.account.id}"

    def read(self) -> TenantPortalAuthRead:
        return TenantPortalAuthRead(
            mode=self.mode,
            token_source="bearer",
            tenant_auth_configured=True,
            dev_fallback=False,
            boundary="tenant_portal_account",
            detail="Access is scoped to the tenant linked to this tenant portal account.",
        )


@dataclass(frozen=True)
class OperatorPreviewAuth:
    user: CurrentUser

    @property
    def mode(self) -> Literal["operator_preview"]:
        return "operator_preview"

    @property
    def source(self) -> Literal["bearer"]:
        return "bearer"

    @property
    def actor(self) -> str:
        return self.user.actor

    def read(self) -> TenantPortalAuthRead:
        return TenantPortalAuthRead(
            mode=self.mode,
            token_source="bearer",
            tenant_auth_configured=True,
            dev_fallback=False,
            boundary="operator_session",
            detail=(
                "Read-only operator preview scoped by the signed-in Leasium role. "
                "No tenant portal account is created."
            ),
        )


@dataclass(frozen=True)
class PortalScope:
    auth: PortalAuth | PortalAccountAuth | OperatorPreviewAuth
    onboarding: TenantOnboarding
    lease: Lease
    property: Property
    unit: TenancyUnit
    tenant: Tenant


def _property_address(prop: Property) -> str | None:
    parts = [prop.street_address, prop.suburb, prop.state, prop.postcode]
    address = ", ".join(part for part in parts if part)
    return address or None


def _tenant_name(tenant: Tenant | None) -> str | None:
    if tenant is None or tenant.deleted_at is not None:
        return None
    return tenant.trading_name or tenant.legal_name


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


def _account_recovery_receipt(account: TenantPortalAccount) -> dict[str, object]:
    receipt = (account.account_metadata or {}).get("last_recovery_receipt")
    return receipt if isinstance(receipt, dict) else {}


def _account_recovery_at(account: TenantPortalAccount) -> datetime | None:
    return _parse_iso_datetime(_account_recovery_receipt(account).get("at"))


def _account_recovery_action(account: TenantPortalAccount) -> str | None:
    action = _account_recovery_receipt(account).get("action")
    return action if isinstance(action, str) else None


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
    allow_consumed: bool = False,
) -> PortalScope:
    """Resolve a token-scoped portal request.

    By default refuses tokens that have been claimed via the soft-switch
    claim gate (`tenant_onboarding.token_consumed_at` is set). The claim
    endpoint itself passes `allow_consumed=True` so it can look up the
    onboarding for an idempotent re-link of the same Clerk account; the
    claim handler then rejects mismatched re-claim attempts.
    """
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
    if not allow_consumed and onboarding.token_consumed_at is not None:
        # The invite has been claimed by a Clerk account; the token is
        # no longer a valid access path. Tenants sign in via Clerk.
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "This invite link has been used. Sign in with the tenant"
                " portal account it was claimed by."
            ),
        )

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


def _operator_preview_scope(
    onboarding_id: UUID,
    user: CurrentUser,
    session: Session,
) -> PortalScope:
    onboarding = session.get(TenantOnboarding, onboarding_id)
    if onboarding is None or onboarding.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found.")
    assert_entity_role(session, user, onboarding.entity_id, READ_ROLES)

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
        auth=OperatorPreviewAuth(user=user),
        onboarding=onboarding,
        lease=lease,
        property=prop,
        unit=unit,
        tenant=tenant,
    )


def _portal_scope_for_request(
    request: Request,
    session: Session,
    settings: Settings,
    *,
    authorization: str | None = None,
    header_token: str | None = None,
    form_token: str | None = None,
) -> PortalScope:
    has_token = any(
        _clean_token(value) is not None
        for value in (
            header_token or request.headers.get(PORTAL_TOKEN_HEADER),
            form_token,
            request.query_params.get(PORTAL_TOKEN_QUERY),
        )
    )
    if authorization and authorization.startswith("Bearer ") and not has_token:
        provider_id = _tenant_portal_provider_id(authorization, settings)
        account = _active_tenant_portal_account(provider_id, session)
        return _account_scope(account, session)
    return _portal_scope(
        request,
        session,
        header_token=header_token,
        form_token=form_token,
    )


def _tenant_portal_provider_id(
    authorization: str | None,
    settings: Settings,
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant portal account bearer token required.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant portal account bearer token required.",
        )
    return _clerk_provider_id(token, settings)


def _active_tenant_portal_account(
    provider_id: str,
    session: Session,
) -> TenantPortalAccount:
    account = session.scalar(
        select(TenantPortalAccount).where(
            TenantPortalAccount.auth_provider == "clerk",
            TenantPortalAccount.auth_provider_id == provider_id,
            TenantPortalAccount.status == TenantPortalAccountStatus.active,
            TenantPortalAccount.revoked_at.is_(None),
            TenantPortalAccount.deleted_at.is_(None),
        )
    )
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant portal account not found.",
        )
    return account


def _latest_account_onboarding(
    account: TenantPortalAccount,
    session: Session,
) -> TenantOnboarding | None:
    if account.tenant_onboarding_id is not None:
        onboarding = session.get(TenantOnboarding, account.tenant_onboarding_id)
        if onboarding is not None:
            return onboarding
    return session.scalar(
        select(TenantOnboarding)
        .where(
            TenantOnboarding.entity_id == account.entity_id,
            TenantOnboarding.tenant_id == account.tenant_id,
            TenantOnboarding.status != TenantOnboardingStatus.cancelled,
            TenantOnboarding.deleted_at.is_(None),
        )
        .order_by(TenantOnboarding.created_at.desc())
    )


def _account_scope(
    account: TenantPortalAccount,
    session: Session,
) -> PortalScope:
    tenant = session.get(Tenant, account.tenant_id)
    if (
        tenant is None
        or tenant.deleted_at is not None
        or tenant.entity_id != account.entity_id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found.")

    onboarding = _latest_account_onboarding(account, session)
    if (
        onboarding is None
        or onboarding.deleted_at is not None
        or onboarding.status == TenantOnboardingStatus.cancelled
        or onboarding.entity_id != account.entity_id
        or onboarding.tenant_id != tenant.id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found.")

    lease, prop, unit = _lease_scope(onboarding.lease_id, session)
    if (
        lease.tenant_id != tenant.id
        or prop.entity_id != account.entity_id
        or tenant.entity_id != prop.entity_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Portal scope is inconsistent.",
        )

    return PortalScope(
        auth=PortalAccountAuth(account=account),
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


def _portal_work_order_metadata(scope: PortalScope) -> dict[str, str]:
    auth_boundary = (
        "tenant_portal_account"
        if scope.auth.mode == "tenant_portal_account"
        else "tenant_onboarding_token"
    )
    return {
        "source": "tenant_portal",
        "auth_boundary": auth_boundary,
        "auth_mode": scope.auth.mode,
        "tenant_onboarding_id": str(scope.onboarding.id),
        "portal_token_source": scope.auth.source,
    }


def _is_portal_work_order(scope: PortalScope, work_order: MaintenanceWorkOrder) -> bool:
    metadata = work_order.work_order_metadata or {}
    return (
        metadata.get("source") == "tenant_portal"
        and metadata.get("tenant_onboarding_id") == str(scope.onboarding.id)
    )


def _portal_work_orders(scope: PortalScope, session: Session) -> list[MaintenanceWorkOrder]:
    rows = session.scalars(
        select(MaintenanceWorkOrder)
        .where(
            MaintenanceWorkOrder.entity_id == scope.onboarding.entity_id,
            MaintenanceWorkOrder.property_id == scope.property.id,
            MaintenanceWorkOrder.tenancy_unit_id == scope.unit.id,
            MaintenanceWorkOrder.tenant_id == scope.tenant.id,
            MaintenanceWorkOrder.lease_id == scope.lease.id,
            MaintenanceWorkOrder.deleted_at.is_(None),
        )
        .order_by(MaintenanceWorkOrder.created_at.desc())
    )
    return [row for row in rows if _is_portal_work_order(scope, row)]


def _portal_activity_entry(
    scope: PortalScope,
    *,
    event: str,
    summary: str,
    status_value: MaintenanceWorkOrderStatus | str,
) -> dict[str, str]:
    status_text = (
        status_value.value if isinstance(status_value, MaintenanceWorkOrderStatus) else status_value
    )
    return {
        "timestamp": utcnow().isoformat(),
        "actor": scope.auth.actor,
        "source": "tenant_portal",
        "event": event,
        "summary": summary,
        "status": status_text,
    }


def _portal_safe_history(
    work_order: MaintenanceWorkOrder,
) -> list[TenantPortalMaintenanceHistoryItemRead]:
    metadata = work_order.work_order_metadata or {}
    raw_history = metadata.get(ACTIVITY_HISTORY_KEY)
    if not isinstance(raw_history, list):
        return []

    history: list[TenantPortalMaintenanceHistoryItemRead] = []
    for raw_entry in raw_history:
        if not isinstance(raw_entry, dict):
            continue
        if (
            raw_entry.get("source") != "tenant_portal"
            and raw_entry.get("visibility") != "tenant"
        ):
            continue
        timestamp = _parse_iso_datetime(raw_entry.get("timestamp"))
        event = raw_entry.get("event")
        summary = raw_entry.get("summary")
        status_value = raw_entry.get("status")
        if timestamp is None or not isinstance(event, str) or not isinstance(summary, str):
            continue
        history.append(
            TenantPortalMaintenanceHistoryItemRead(
                timestamp=timestamp,
                event=event,
                summary=summary,
                status=status_value if isinstance(status_value, str) else None,
            )
        )
    return history


def _maintenance_request_read(
    work_order: MaintenanceWorkOrder,
) -> TenantPortalMaintenanceRequestRead:
    return TenantPortalMaintenanceRequestRead(
        id=work_order.id,
        title=work_order.title,
        description=work_order.description,
        status=work_order.status.value,
        priority=work_order.priority.value,
        requested_at=work_order.requested_at,
        source_reference=work_order.source_reference,
        due_date=work_order.due_date,
        completed_at=work_order.completed_at,
        document_ids=work_order.document_ids,
        photo_document_ids=work_order.photo_document_ids,
        history=_portal_safe_history(work_order),
        created_at=work_order.created_at,
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


def _portal_invite_sent_at(delivery_data: dict[str, object] | None) -> datetime | None:
    """Return the timestamp of the last portal-invite delivery, if any.

    The operator-triggered portal invite records its receipts under
    ``delivery_data['portal_invite']`` so the tenant dashboard can show when the
    account-claim link was last sent.
    """

    if not isinstance(delivery_data, dict):
        return None
    section = delivery_data.get("portal_invite")
    if not isinstance(section, dict):
        return None
    return _parse_iso_datetime(section.get("sent_at"))


def _portal_read(scope: PortalScope, session: Session) -> TenantPortalRead:
    documents = _tenant_documents(scope, session)
    invoices = _portal_invoices(scope, session)
    maintenance_requests = _portal_work_orders(scope, session)
    if scope.auth.mode == "tenant_portal_account":
        guardrails = [
            (
                "Tenant portal responses are scoped to the tenant linked to this "
                "tenant portal account."
            ),
            "Only approved invoice drafts are visible to tenants.",
            "Maintenance requests only include tenant portal submissions for this tenant account.",
            "Notification preference updates do not send email or SMS.",
        ]
    elif scope.auth.mode == "operator_preview":
        guardrails = [
            "Operator preview is read-only and does not create a tenant portal session.",
            "Only tenant-visible portal data is shown.",
            "Only approved invoice drafts are visible to tenants.",
            "Maintenance requests only include tenant portal submissions for this onboarding.",
            "Notification preference updates do not send email or SMS.",
        ]
    else:
        guardrails = [
            "Tenant portal responses are scoped to the tenant attached to the onboarding token.",
            "Only approved invoice drafts are visible to tenants.",
            "Maintenance requests only include tenant portal submissions for this token.",
            "Notification preference updates do not send email or SMS.",
        ]
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
            submitted_data=scope.onboarding.submitted_data or None,
            portal_invite_sent_at=_portal_invite_sent_at(scope.onboarding.delivery_data),
        ),
        compliance=_compliance(scope, documents),
        invoices=[_invoice_read(invoice) for invoice in invoices],
        payment_summary=_payment_summary(invoices),
        maintenance_requests=[
            _maintenance_request_read(work_order) for work_order in maintenance_requests
        ],
        notification_preferences=_notification_preferences(scope.tenant),
        guardrails=guardrails,
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


def _portal_document_id_strings(
    scope: PortalScope,
    document_ids: list[UUID],
    session: Session,
) -> list[str]:
    validated: list[str] = []
    seen: set[UUID] = set()
    for document_id in document_ids:
        if document_id in seen:
            continue
        seen.add(document_id)
        validated.append(str(_portal_document(scope, document_id, session).id))
    return validated


@router.get(
    "/invites/{token}/preview",
    response_model=TenantPortalInvitePreviewRead,
)
def preview_tenant_portal_invite(
    token: str,
    session: Annotated[Session, Depends(get_session)],
) -> TenantPortalInvitePreviewRead:
    """Minimum-viable preview for the claim gate.

    Public (unauthenticated) — returns only enough context for the
    tenant to confirm they're claiming the right property before they
    sign in. Never returns financial data, contact details, or
    documents. Used by the /tenant-portal/[token] claim gate when no
    Clerk session exists.
    """
    onboarding = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.token == token,
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    if (
        onboarding is None
        or onboarding.status == TenantOnboardingStatus.cancelled
        or _is_expired(onboarding)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found.",
        )
    tenant = session.get(Tenant, onboarding.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found.",
        )
    _, prop, unit = _lease_scope(onboarding.lease_id, session)
    address_parts = [prop.street_address, prop.suburb, prop.state]
    address = ", ".join(part for part in address_parts if part) or None
    property_label = (
        f"{prop.name} — {unit.unit_label}" if unit.unit_label else prop.name
    )
    return TenantPortalInvitePreviewRead(
        property_name=property_label,
        property_address=address,
        tenant_display_name=tenant.trading_name or tenant.legal_name,
        expires_at=onboarding.expires_at,
        claimable=onboarding.token_consumed_at is None,
    )


@router.post("/account/claim", response_model=TenantPortalRead)
def claim_tenant_portal_account(
    payload: TenantPortalAccountClaimCreate,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> TenantPortalRead:
    provider_id = _tenant_portal_provider_id(authorization, settings)
    token_scope = _portal_scope(
        request,
        session,
        header_token=payload.portal_token,
        allow_consumed=True,
    )
    # If the token has already been consumed, only the Clerk user who
    # previously claimed it (i.e. has ANY history with this tenant —
    # active, revoked, or unlinked) may proceed. The existing revoked /
    # unlinked / relink logic further down then produces the right
    # response (403 revoked, 200 relink, etc.). Anyone else gets 410.
    if token_scope.onboarding.token_consumed_at is not None:
        prior_link = session.scalar(
            select(TenantPortalAccount).where(
                TenantPortalAccount.auth_provider == "clerk",
                TenantPortalAccount.auth_provider_id == provider_id,
                TenantPortalAccount.tenant_id == token_scope.tenant.id,
            )
        )
        if prior_link is None:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail=(
                    "This invite link has been used. Sign in with the"
                    " tenant portal account it was claimed by."
                ),
            )
    revoked_account = session.scalar(
        select(TenantPortalAccount).where(
            TenantPortalAccount.auth_provider == "clerk",
            TenantPortalAccount.auth_provider_id == provider_id,
            TenantPortalAccount.tenant_id == token_scope.tenant.id,
            or_(
                TenantPortalAccount.status == TenantPortalAccountStatus.revoked,
                TenantPortalAccount.revoked_at.is_not(None),
            ),
            TenantPortalAccount.deleted_at.is_(None),
        )
    )
    if revoked_account is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant portal account is revoked.",
        )

    account = session.scalar(
        select(TenantPortalAccount).where(
            TenantPortalAccount.auth_provider == "clerk",
            TenantPortalAccount.auth_provider_id == provider_id,
            TenantPortalAccount.status == TenantPortalAccountStatus.active,
            TenantPortalAccount.revoked_at.is_(None),
            TenantPortalAccount.deleted_at.is_(None),
        )
    )
    now = utcnow()
    if account is not None and account.tenant_id != token_scope.tenant.id:
        linked_tenant = session.get(Tenant, account.tenant_id)
        if linked_tenant is not None and linked_tenant.deleted_at is not None:
            account.deleted_at = now
            account.account_metadata = {
                **(account.account_metadata or {}),
                "unlinked_at": now.isoformat(),
                "unlinked_reason": "Linked tenant was deleted before a fresh invite claim.",
            }
            audit_log(
                session,
                actor=f"tenant-portal-account:{account.id}",
                entity_id=account.entity_id,
                action="unlink",
                target_table="tenant_portal_account",
                target_id=account.id,
                outcome=AuditOutcome.success,
                tool_name="tenant_portal.account_claim",
                tool_input={
                    "tenant_id": str(linked_tenant.id),
                    "replacement_tenant_id": str(token_scope.tenant.id),
                },
                tool_output_summary=(
                    "Stale tenant portal account unlinked because its tenant was deleted."
                ),
                data_classification="confidential",
            )
            session.flush()
            account = None
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This tenant portal login is already linked to another tenant. "
                    "Sign out and use the tenant login for this invite, or ask the "
                    "property team to unlink the old portal access and send a fresh invite."
                ),
            )
    if account is None:
        account = TenantPortalAccount(
            entity_id=token_scope.onboarding.entity_id,
            tenant_id=token_scope.tenant.id,
            tenant_onboarding_id=token_scope.onboarding.id,
            auth_provider="clerk",
            auth_provider_id=provider_id,
            email=token_scope.tenant.billing_email or token_scope.tenant.contact_email,
            status=TenantPortalAccountStatus.active,
            linked_at=now,
            last_seen_at=now,
            account_metadata={
                "source": "tenant_portal_claim",
                "tenant_onboarding_id": str(token_scope.onboarding.id),
            },
        )
        session.add(account)
        session.flush()
        audit_action = "claim"
    else:
        if account.entity_id != token_scope.onboarding.entity_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tenant portal account scope is inconsistent.",
            )
        account.tenant_onboarding_id = token_scope.onboarding.id
        account.email = (
            account.email
            or token_scope.tenant.billing_email
            or token_scope.tenant.contact_email
        )
        account.last_seen_at = now
        account.account_metadata = {
            **(account.account_metadata or {}),
            "last_claimed_at": now.isoformat(),
            "tenant_onboarding_id": str(token_scope.onboarding.id),
        }
        audit_action = "refresh"
    # Soft-switch: the first successful claim consumes the token so the
    # bare URL stops working. Idempotent for the same Clerk account.
    if token_scope.onboarding.token_consumed_at is None:
        token_scope.onboarding.token_consumed_at = now
    audit_log(
        session,
        actor=f"tenant-portal-account:{account.id}",
        entity_id=token_scope.onboarding.entity_id,
        action=audit_action,
        target_table="tenant_portal_account",
        target_id=account.id,
        outcome=AuditOutcome.success,
        tool_name="tenant_portal.account_claim",
        tool_input={"tenant_id": str(token_scope.tenant.id)},
        tool_output_summary="Tenant portal account linked without operator role access.",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(account)
    return _portal_read(_account_scope(account, session), session)


@router.get("/account/status", response_model=TenantPortalAccountLifecycleRead)
def get_tenant_portal_account_status(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> TenantPortalAccountLifecycleRead:
    provider_id = _tenant_portal_provider_id(authorization, settings)
    base_filters = (
        TenantPortalAccount.auth_provider == "clerk",
        TenantPortalAccount.auth_provider_id == provider_id,
        TenantPortalAccount.deleted_at.is_(None),
    )
    account = session.scalar(
        select(TenantPortalAccount)
        .where(
            *base_filters,
            TenantPortalAccount.status == TenantPortalAccountStatus.active,
            TenantPortalAccount.revoked_at.is_(None),
        )
        .order_by(TenantPortalAccount.updated_at.desc())
    )
    if account is not None:
        tenant = session.get(Tenant, account.tenant_id)
        recovery_action = _account_recovery_action(account)
        return TenantPortalAccountLifecycleRead(
            status="active",
            tenant_id=account.tenant_id,
            tenant_name=_tenant_name(tenant),
            email=account.email,
            linked_at=account.linked_at,
            last_seen_at=account.last_seen_at,
            revoked_at=account.revoked_at,
            recovery_action=recovery_action,
            recovery_at=_account_recovery_at(account),
            recovery_hint=(
                "The property team restored this tenant login. It can open the portal "
                "without the original link again."
                if recovery_action == "restored"
                else (
                    "This tenant login can open the portal without the original link. "
                    "If it is linked to the wrong tenant, ask the property team to unlink "
                    "and relink the account."
                )
            ),
        )

    revoked_account = session.scalar(
        select(TenantPortalAccount)
        .where(
            *base_filters,
            or_(
                TenantPortalAccount.status == TenantPortalAccountStatus.revoked,
                TenantPortalAccount.revoked_at.is_not(None),
            ),
        )
        .order_by(TenantPortalAccount.updated_at.desc())
    )
    if revoked_account is not None:
        tenant = session.get(Tenant, revoked_account.tenant_id)
        return TenantPortalAccountLifecycleRead(
            status="revoked",
            tenant_id=revoked_account.tenant_id,
            tenant_name=_tenant_name(tenant),
            email=revoked_account.email,
            linked_at=revoked_account.linked_at,
            last_seen_at=revoked_account.last_seen_at,
            revoked_at=revoked_account.revoked_at,
            recovery_action=_account_recovery_action(revoked_account),
            recovery_at=_account_recovery_at(revoked_account),
            recovery_hint=(
                "This tenant login was revoked by the property team. Ask them to "
                "restore access or send a fresh tenant portal link before trying again."
            ),
        )

    unlinked_account = session.scalar(
        select(TenantPortalAccount)
        .where(
            TenantPortalAccount.auth_provider == "clerk",
            TenantPortalAccount.auth_provider_id == provider_id,
            TenantPortalAccount.deleted_at.is_not(None),
        )
        .order_by(TenantPortalAccount.updated_at.desc())
    )
    if unlinked_account is not None:
        tenant = session.get(Tenant, unlinked_account.tenant_id)
        return TenantPortalAccountLifecycleRead(
            status="unlinked",
            tenant_id=unlinked_account.tenant_id,
            tenant_name=_tenant_name(tenant),
            email=unlinked_account.email,
            linked_at=unlinked_account.linked_at,
            last_seen_at=unlinked_account.last_seen_at,
            revoked_at=unlinked_account.revoked_at,
            recovery_action=_account_recovery_action(unlinked_account),
            recovery_at=_account_recovery_at(unlinked_account),
            recovery_hint=(
                "The property team unlinked this tenant login so it can be safely "
                "reconnected. Open a fresh tenant portal link once to relink this account."
            ),
        )

    return TenantPortalAccountLifecycleRead(
        status="unlinked",
        recovery_hint=(
            "Open your original tenant portal link once to connect this login. "
            "If the link expired or was lost, ask the property team for a fresh "
            "tenant portal link."
        ),
    )


@router.get("/account/session", response_model=TenantPortalRead)
def get_tenant_portal_account_session(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> TenantPortalRead:
    provider_id = _tenant_portal_provider_id(authorization, settings)
    account = _active_tenant_portal_account(provider_id, session)
    account.last_seen_at = utcnow()
    session.commit()
    session.refresh(account)
    return _portal_read(_account_scope(account, session), session)


@router.get("/session", response_model=TenantPortalRead)
def get_tenant_portal(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> TenantPortalRead:
    scope = _portal_scope_for_request(
        request,
        session,
        settings,
        authorization=authorization,
        header_token=x_tenant_portal_token,
    )
    return _portal_read(scope, session)


@router.get("/operator-preview/{onboarding_id}", response_model=TenantPortalRead)
def get_tenant_portal_operator_preview(
    onboarding_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> TenantPortalRead:
    return _portal_read(_operator_preview_scope(onboarding_id, user, session), session)


@router.get(
    "/maintenance-requests",
    response_model=list[TenantPortalMaintenanceRequestRead],
)
def list_tenant_portal_maintenance_requests(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> list[TenantPortalMaintenanceRequestRead]:
    scope = _portal_scope_for_request(
        request,
        session,
        settings,
        authorization=authorization,
        header_token=x_tenant_portal_token,
    )
    return [
        _maintenance_request_read(work_order)
        for work_order in _portal_work_orders(scope, session)
    ]


@router.post(
    "/maintenance-requests",
    response_model=TenantPortalMaintenanceRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def create_tenant_portal_maintenance_request(
    payload: TenantPortalMaintenanceRequestCreate,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> TenantPortalMaintenanceRequestRead:
    scope = _portal_scope_for_request(
        request,
        session,
        settings,
        authorization=authorization,
        header_token=x_tenant_portal_token,
    )
    document_ids = _portal_document_id_strings(scope, payload.document_ids, session)
    photo_document_ids = _portal_document_id_strings(scope, payload.photo_document_ids, session)
    work_order = MaintenanceWorkOrder(
        entity_id=scope.onboarding.entity_id,
        property_id=scope.property.id,
        tenancy_unit_id=scope.unit.id,
        tenant_id=scope.tenant.id,
        lease_id=scope.lease.id,
        title=payload.title,
        description=payload.description,
        status=MaintenanceWorkOrderStatus.requested,
        priority=payload.priority,
        source_reference=payload.source_reference,
        attachments={
            "document_ids": document_ids,
            "photo_document_ids": photo_document_ids,
        },
        work_order_metadata={
            **_portal_work_order_metadata(scope),
            "submitted_at": utcnow().isoformat(),
            ACTIVITY_HISTORY_KEY: [
                _portal_activity_entry(
                    scope,
                    event="tenant_submitted",
                    summary="Tenant submitted maintenance request.",
                    status_value=MaintenanceWorkOrderStatus.requested,
                )
            ],
        },
    )
    session.add(work_order)
    session.flush()
    audit_log(
        session,
        actor=scope.auth.actor,
        entity_id=work_order.entity_id,
        action="create",
        target_table="maintenance_work_order",
        target_id=work_order.id,
        outcome=AuditOutcome.success,
        tool_name="tenant_portal.maintenance_request",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(work_order)
    return _maintenance_request_read(work_order)


@router.post("/onboarding/submit", response_model=TenantPortalRead)
def submit_tenant_portal_onboarding(
    payload: TenantOnboardingSubmit,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> TenantPortalRead:
    """Tenant-facing onboarding submit from inside the authenticated portal.

    Mirrors the public ``/tenant-onboarding/public/{token}/submit`` endpoint —
    writes the payload to ``submitted_data`` and moves the onboarding row to
    ``submitted``. The operator still has to review and apply before any tenant
    record is mutated; this endpoint never touches the tenant table directly.
    """

    scope = _portal_scope_for_request(
        request,
        session,
        settings,
        authorization=authorization,
        header_token=x_tenant_portal_token,
    )
    onboarding = scope.onboarding
    if onboarding.status != TenantOnboardingStatus.sent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only sent onboarding can be submitted from the tenant portal.",
        )
    if not payload.accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Acceptance is required.",
        )
    data = payload.model_dump(mode="json")
    onboarding.status = TenantOnboardingStatus.submitted
    onboarding.submitted_data = data
    onboarding.submitted_at = utcnow()
    delivery = onboarding.delivery_data or {}
    reminders = delivery.get("reminders")
    if isinstance(reminders, dict):
        reminders = {**reminders, "completed": True, "completed_reason": "submitted"}
        delivery = {**delivery, "reminders": reminders}
        onboarding.delivery_data = delivery
    audit_log(
        session,
        actor=scope.auth.actor,
        entity_id=onboarding.entity_id,
        action="submit",
        target_table="tenant_onboarding",
        target_id=onboarding.id,
        outcome=AuditOutcome.success,
        tool_name="tenant_portal.onboarding_submit",
        data_classification="confidential",
    )
    session.commit()
    session.refresh(onboarding)
    return _portal_read(scope, session)


@router.patch("/notification-preferences", response_model=TenantPortalNotificationPreferencesRead)
def update_notification_preferences(
    payload: TenantPortalNotificationPreferencesUpdate,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> TenantPortalNotificationPreferencesRead:
    scope = _portal_scope_for_request(
        request,
        session,
        settings,
        authorization=authorization,
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
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
    portal_token: Annotated[str | None, Form()] = None,
    category: Annotated[DocumentCategory, Form()] = DocumentCategory.onboarding,
    notes: Annotated[str | None, Form()] = None,
) -> TenantPortalDocumentRead:
    scope = _portal_scope_for_request(
        request,
        session,
        settings,
        authorization=authorization,
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
            "auth_boundary": (
                "tenant_portal_account"
                if scope.auth.mode == "tenant_portal_account"
                else "tenant_onboarding_token"
            ),
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
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    x_tenant_portal_token: Annotated[str | None, Header()] = None,
) -> Response:
    scope = _portal_scope_for_request(
        request,
        session,
        settings,
        authorization=authorization,
        header_token=x_tenant_portal_token,
    )
    document = _portal_document(scope, document_id, session)
    return Response(
        content=document.file_data,
        media_type=document.content_type or "application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(document.filename)}"},
    )
