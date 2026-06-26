"""Xero readiness and provider connection routes."""

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AppUser,
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    Property,
    RentChargeRule,
    RentChargeType,
    TenancyUnit,
    Tenant,
    UserEntityRole,
    UserRole,
    XeroConnection,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.xero import (
    XeroIntegrationError,
    create_xero_invoice_draft,
    decrypt_xero_token,
    encrypt_xero_token,
    exchange_code_for_tokens,
    fetch_xero_accounts,
    fetch_xero_connections,
    fetch_xero_contacts,
    fetch_xero_invoices,
    fetch_xero_tax_rates,
    refresh_xero_tokens,
    token_expiry_from_payload,
    xero_authorization_url,
    xero_missing_config,
    xero_provider_configured,
    xero_redirect_uri,
    xero_scopes,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.charge_rules import (
    _invoice_delivery_ready,
    _invoice_pdf_document,
    _provider_invoice_delivery_invite,
    _record_invoice_provider_delivery,
    send_invoice_delivery_email,
)
from apps.api.schemas.xero import (
    XeroAccountingFreshnessRead,
    XeroAccountOptionRead,
    XeroChartTaxMappingApplyItem,
    XeroChartTaxMappingApplyRead,
    XeroChartTaxMappingApplyRequest,
    XeroChartTaxMappingApplyResultRead,
    XeroChartTaxValidationPreviewRead,
    XeroChartTaxValidationResultRead,
    XeroConnectionDiagnosticsRead,
    XeroConnectionStatusRead,
    XeroConnectionUpdate,
    XeroContactMappingApplyItem,
    XeroContactMappingApplyRead,
    XeroContactMappingApplyRequest,
    XeroContactMappingApplyResultRead,
    XeroContactMatchRead,
    XeroContactOptionRead,
    XeroContactSyncPreviewRead,
    XeroContactTargetRead,
    XeroExceptionQueueItemRead,
    XeroExceptionQueueRead,
    XeroExceptionQueueSummaryRead,
    XeroInvoiceDraftCreateRead,
    XeroInvoiceDraftCreateRequest,
    XeroInvoiceDraftCreateResultRead,
    XeroInvoicePostingApprovalRead,
    XeroInvoicePostingApprovalRequest,
    XeroInvoicePostingPreviewLineRead,
    XeroInvoicePostingPreviewRead,
    XeroInvoicePostingPreviewResultRead,
    XeroInvoiceProviderDispatchRead,
    XeroInvoiceProviderDispatchRequest,
    XeroInvoiceProviderDispatchResultRead,
    XeroInvoiceSyncSummaryRead,
    XeroMappingIssueRead,
    XeroOAuthStartRead,
    XeroPaymentReconciliationItem,
    XeroPaymentReconciliationRead,
    XeroPaymentReconciliationRequest,
    XeroPaymentReconciliationResultRead,
    XeroPaymentSummaryRead,
    XeroProviderConfigRead,
    XeroProviderSetupPreflightRead,
    XeroProviderStatusReceiptRead,
    XeroReadinessSummaryRead,
    XeroStatusRead,
    XeroTaxRateOptionRead,
)

router = APIRouter(prefix="/xero", tags=["xero"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
XERO_CONTACT_PREVIEW_SCOPES = {"accounting.contacts.read"}
XERO_CHART_TAX_SCOPES = {"accounting.settings.read"}
XERO_INVOICE_WRITE_SCOPES = {"accounting.invoices"}
XERO_INVOICE_READ_SCOPES = {"accounting.invoices.read"}
XERO_LEGACY_TRANSACTION_WRITE_SCOPES = {"accounting.transactions"}
XERO_LEGACY_TRANSACTION_READ_SCOPES = {"accounting.transactions.read"}
XERO_INVOICE_POSTING_PREVIEW_SCOPES = XERO_CONTACT_PREVIEW_SCOPES | XERO_CHART_TAX_SCOPES
XERO_PROVIDER_REQUIRED_ENV_VARS = [
    "XERO_CLIENT_ID",
    "XERO_CLIENT_SECRET",
    "XERO_TOKEN_ENCRYPTION_KEY",
]

PROPERTY_OWNER_BILLING_STRUCTURES = {"property_owner", "trust", "split"}
SUGGESTED_CHARGE_MAPPINGS: dict[RentChargeType, tuple[str, str | None]] = {
    RentChargeType.base_rent: ("200", "OUTPUT"),
    RentChargeType.outgoings: ("201", "OUTPUT"),
    RentChargeType.parking: ("202", "OUTPUT"),
    RentChargeType.storage: ("203", "OUTPUT"),
    RentChargeType.utilities: ("204", "OUTPUT"),
    RentChargeType.promotion_levy: ("205", "OUTPUT"),
    RentChargeType.other: ("299", "OUTPUT"),
}
CHARGE_ACCOUNT_NAME_HINTS: dict[RentChargeType, tuple[str, ...]] = {
    RentChargeType.base_rent: ("rent",),
    RentChargeType.outgoings: ("outgoing", "recover", "opex"),
    RentChargeType.parking: ("parking", "car park"),
    RentChargeType.storage: ("storage",),
    RentChargeType.utilities: ("utilit", "recover"),
    RentChargeType.promotion_levy: ("promotion", "marketing", "advertis", "levy"),
    RentChargeType.other: (),
}
REVENUE_ACCOUNT_CLASSES = {"REVENUE"}
OAUTH_STATE_TTL_MINUTES = 15
XERO_EXCEPTION_KINDS = (
    "connection",
    "contact",
    "chart",
    "tax",
    "invoice_sync",
    "provider",
    "payment",
)


def _tenant_name(tenant: Tenant | None) -> str | None:
    if tenant is None:
        return None
    return tenant.trading_name or tenant.legal_name


def _provider(settings: Settings) -> XeroProviderConfigRead:
    return XeroProviderConfigRead(
        configured=xero_provider_configured(settings),
        missing_config=xero_missing_config(settings),
        redirect_uri=xero_redirect_uri(settings),
        scopes=xero_scopes(settings),
    )


def _active_xero_connection(session: Session, entity_id: UUID) -> XeroConnection | None:
    return session.scalar(
        select(XeroConnection)
        .where(
            XeroConnection.entity_id == entity_id,
            XeroConnection.revoked_at.is_(None),
            XeroConnection.deleted_at.is_(None),
        )
        .order_by(XeroConnection.created_at.desc())
    )


def _entity_role(session: Session, user: CurrentUser, entity_id: UUID) -> UserRole | None:
    return session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity_id,
        )
    )


def _xero_scope_set(provider_connection: XeroConnection | None) -> set[str]:
    if provider_connection is None or not provider_connection.scopes:
        return set()
    return {scope.strip() for scope in provider_connection.scopes.split() if scope.strip()}


def _has_xero_scopes(
    provider_connection: XeroConnection | None,
    required_scopes: set[str],
) -> bool:
    return required_scopes.issubset(_xero_scope_set(provider_connection))


def _has_any_xero_scope(
    provider_connection: XeroConnection | None,
    accepted_scopes: set[str],
) -> bool:
    return bool(_xero_scope_set(provider_connection) & accepted_scopes)


def _has_xero_invoice_write_scope(provider_connection: XeroConnection | None) -> bool:
    return _has_any_xero_scope(
        provider_connection,
        XERO_INVOICE_WRITE_SCOPES | XERO_LEGACY_TRANSACTION_WRITE_SCOPES,
    )


def _has_xero_invoice_read_scope(provider_connection: XeroConnection | None) -> bool:
    granted_scopes = _xero_scope_set(provider_connection)
    return bool(
        granted_scopes
        & (
            XERO_INVOICE_READ_SCOPES
            | XERO_INVOICE_WRITE_SCOPES
            | XERO_LEGACY_TRANSACTION_READ_SCOPES
            | XERO_LEGACY_TRANSACTION_WRITE_SCOPES
        )
    )


def _connection(
    entity: Entity,
    session: Session,
    settings: Settings,
) -> XeroConnectionStatusRead:
    provider_connection = _active_xero_connection(session, entity.id)
    connected = bool(entity.xero_tenant_id or provider_connection)
    provider_configured = xero_provider_configured(settings)
    connection_source: Literal["provider", "manual", "none"] = "none"
    if provider_connection is not None:
        connection_source = "provider"
    elif entity.xero_tenant_id:
        connection_source = "manual"
    tenant_id = provider_connection.xero_tenant_id if provider_connection else entity.xero_tenant_id
    tenant_name = provider_connection.tenant_name if provider_connection else None
    tenant_type = provider_connection.tenant_type if provider_connection else None
    last_contact_sync_at = (
        provider_connection.last_contact_sync_at if provider_connection is not None else None
    )
    return XeroConnectionStatusRead(
        entity_id=entity.id,
        entity_name=entity.name,
        connected=connected,
        xero_tenant_id=tenant_id,
        tenant_name=tenant_name,
        tenant_type=tenant_type,
        connected_at=entity.xero_connected_at,
        last_sync_at=entity.xero_last_sync_at,
        last_contact_sync_at=last_contact_sync_at,
        provider_configured=provider_configured,
        provider_connection_id=provider_connection.id if provider_connection else None,
        connection_source=connection_source,
        status_label=(
            "Provider connected"
            if provider_connection is not None
            else "Connected"
            if connected
            else "Not connected"
        ),
        next_action=(
            "Preview Xero contacts, then review local mappings before approving any sync."
            if provider_connection is not None
            else "Review contact, chart, tax, invoice, and payment readiness before enabling sync."
            if connected
            else "Connect Xero or record the tenant before any sync approval can be enabled."
        ),
    )


def _xero_diagnostics_next_steps(
    *,
    provider_configured: bool,
    connection_source: Literal["provider", "manual", "none"],
) -> list[str]:
    if not provider_configured:
        return [
            "Configure the missing Xero OAuth environment variables in Render.",
            "Confirm the redirect URI matches the Xero app before starting OAuth.",
        ]
    if connection_source == "provider":
        return [
            "Preview Xero contacts and apply reviewed local mappings.",
            "Validate chart and tax mappings before invoice posting approval.",
            "Use invoice posting preview before explicit draft creation.",
            "Preview payment reconciliation before applying local payment status changes.",
        ]
    if connection_source == "manual":
        return [
            "Reconnect Xero through OAuth so provider-backed previews can run.",
            "Manual tenant IDs are enough for readiness labels, not provider API workflows.",
        ]
    return [
        "Connect Xero through OAuth from the operator settings screen.",
        "After connection, preview contacts, validate chart/tax mappings, then preview invoices.",
    ]


def _xero_provider_setup_preflight(
    provider: XeroProviderConfigRead,
) -> XeroProviderSetupPreflightRead:
    required_scopes = " ".join(provider.scopes)
    return XeroProviderSetupPreflightRead(
        required_env_vars=XERO_PROVIDER_REQUIRED_ENV_VARS,
        missing_env_vars=[
            env_var
            for env_var in XERO_PROVIDER_REQUIRED_ENV_VARS
            if env_var in provider.missing_config
        ],
        expected_redirect_uri=provider.redirect_uri,
        required_scopes=provider.scopes,
        setup_checklist=[
            (
                "Set XERO_CLIENT_ID, XERO_CLIENT_SECRET, and XERO_TOKEN_ENCRYPTION_KEY "
                "on the API service."
            ),
            f"Set XERO_REDIRECT_URI={provider.redirect_uri} on the API service.",
            "Set XERO_STATE_SECRET on the API service before production OAuth.",
            f"Register expected_redirect_uri in the Xero app: {provider.redirect_uri}",
            f"Confirm required_scopes in the Xero app consent screen: {required_scopes}",
            "Start OAuth only after these local diagnostics show provider_configured=true.",
        ],
    )


def _payment_status(metadata: dict[str, Any]) -> str:
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        status_value = payment.get("status")
        if isinstance(status_value, str) and status_value:
            return status_value
    return "unpaid"


def _payment_paid_cents(metadata: dict[str, Any]) -> int | None:
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        paid_cents = payment.get("paid_cents")
        if isinstance(paid_cents, int):
            return paid_cents
    return None


def _short_idempotency_key(prefix: str, *parts: object) -> str:
    raw = "|".join(str(part) for part in parts if part is not None)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
    return f"{prefix}-{digest}"


def _metadata_text(metadata: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = metadata.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _metadata_record(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _metadata_datetime(metadata: dict[str, Any], *keys: str) -> datetime | None:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=UTC)
        if isinstance(value, str) and value.strip():
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                continue
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


def _invoice_draft_for_xero_access(
    invoice_draft_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> InvoiceDraft:
    draft = session.get(InvoiceDraft, invoice_draft_id)
    if draft is None or draft.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice draft not found.",
        )
    assert_entity_role(session, user, draft.entity_id, roles)
    return draft


def _xero_sync_state(metadata: dict[str, Any]) -> dict[str, Any]:
    state = metadata.get("xero_sync")
    return dict(state) if isinstance(state, dict) else {}


def _xero_invoice_id_from_metadata(metadata: dict[str, Any]) -> str | None:
    sync_state = _xero_sync_state(metadata)
    invoice_id = _metadata_text(sync_state, "xero_invoice_id", "InvoiceID")
    if invoice_id:
        return invoice_id
    posting_state = metadata.get("posting_preparation")
    if isinstance(posting_state, dict):
        return _metadata_text(posting_state, "xero_invoice_id", "InvoiceID")
    return None


def _checkpoint_at(
    connection_metadata: dict[str, Any],
    key: str,
    *timestamp_keys: str,
) -> datetime | None:
    return _metadata_datetime(
        _metadata_record(connection_metadata.get(key)),
        *timestamp_keys,
    )


def _latest_datetime(*values: datetime | None) -> datetime | None:
    timestamps = [value for value in values if value is not None]
    return max(timestamps) if timestamps else None


def _accounting_freshness(
    *,
    provider_connection: XeroConnection | None,
    readiness_issue_count: int,
    readiness_blocker_count: int,
    readiness_warning_count: int,
    approved_unsynced_invoice_count: int,
    xero_linked_open_invoice_count: int,
    generated_at: datetime,
    settings: Settings,
) -> XeroAccountingFreshnessRead:
    stale_after_days = max(1, int(settings.xero_reconciliation_stale_after_days or 1))
    connection_metadata = (
        dict(provider_connection.connection_metadata or {})
        if provider_connection is not None
        else {}
    )
    last_contact_sync_at = (
        provider_connection.last_contact_sync_at
        if provider_connection is not None
        else None
    ) or _checkpoint_at(connection_metadata, "last_contact_sync", "synced_at")
    last_chart_tax_validation_at = _checkpoint_at(
        connection_metadata,
        "last_chart_tax_validation",
        "validated_at",
    )
    last_invoice_posting_preview_at = _checkpoint_at(
        connection_metadata,
        "last_invoice_posting_preview",
        "prepared_at",
    )
    last_invoice_draft_create_at = _checkpoint_at(
        connection_metadata,
        "last_invoice_draft_create",
        "applied_at",
    )
    last_invoice_provider_dispatch_at = _checkpoint_at(
        connection_metadata,
        "last_invoice_provider_dispatch",
        "dispatched_at",
    )
    payment_preview = _metadata_record(
        connection_metadata.get("last_payment_reconciliation_preview")
    )
    payment_apply = _metadata_record(connection_metadata.get("last_payment_reconciliation_apply"))
    last_payment_preview_at = _metadata_datetime(payment_preview, "reconciled_at")
    last_payment_apply_at = _metadata_datetime(payment_apply, "reconciled_at")
    last_payment_at = _latest_datetime(last_payment_preview_at, last_payment_apply_at)
    last_payment_record = (
        payment_apply
        if last_payment_apply_at
        and (last_payment_preview_at is None or last_payment_apply_at >= last_payment_preview_at)
        else payment_preview
    )

    stale_reconciliation = False
    needs_readiness_attention = (
        readiness_issue_count > 0 or approved_unsynced_invoice_count > 0
    )
    if xero_linked_open_invoice_count > 0 and last_payment_at is None:
        freshness_status: Literal["ready", "stale", "missing", "attention"]
        freshness_status = "missing"
        stale_reconciliation = True
        invoice_label = "invoice" if xero_linked_open_invoice_count == 1 else "invoices"
        summary = (
            f"{xero_linked_open_invoice_count} open Xero-linked {invoice_label} "
            "need a payment reconciliation preview."
        )
    elif (
        xero_linked_open_invoice_count > 0
        and last_payment_at is not None
        and generated_at - last_payment_at > timedelta(days=stale_after_days)
    ):
        freshness_status = "stale"
        stale_reconciliation = True
        summary = (
            "Payment reconciliation is stale for open Xero-linked invoices; "
            "preview payments before relying on the accounting snapshot."
        )
    elif needs_readiness_attention:
        freshness_status = "attention"
        issue_label = "issue" if readiness_issue_count == 1 else "issues"
        invoice_label = "invoice" if approved_unsynced_invoice_count == 1 else "invoices"
        summary_parts = []
        if readiness_issue_count > 0:
            summary_parts.append(
                f"{readiness_issue_count} Xero readiness {issue_label} "
                f"{'needs' if readiness_issue_count == 1 else 'need'} review"
            )
        if approved_unsynced_invoice_count > 0:
            summary_parts.append(
                f"{approved_unsynced_invoice_count} approved {invoice_label} "
                "still need Xero draft creation"
            )
        summary = "; ".join(summary_parts) + "."
    else:
        freshness_status = "ready"
        summary = (
            "Payment reconciliation is fresh for open Xero-linked invoices."
            if xero_linked_open_invoice_count > 0
            else "No open Xero-linked invoices need payment reconciliation."
        )

    return XeroAccountingFreshnessRead(
        generated_at=generated_at,
        source="local_metadata",
        status=freshness_status,
        summary=summary,
        stale_after_days=stale_after_days,
        stale_reconciliation=stale_reconciliation,
        readiness_issue_count=readiness_issue_count,
        readiness_blocker_count=readiness_blocker_count,
        readiness_warning_count=readiness_warning_count,
        approved_unsynced_invoice_count=approved_unsynced_invoice_count,
        xero_linked_open_invoice_count=xero_linked_open_invoice_count,
        last_contact_sync_at=last_contact_sync_at,
        last_chart_tax_validation_at=last_chart_tax_validation_at,
        last_invoice_posting_preview_at=last_invoice_posting_preview_at,
        last_invoice_draft_create_at=last_invoice_draft_create_at,
        last_invoice_provider_dispatch_at=last_invoice_provider_dispatch_at,
        last_payment_reconciliation_preview_at=last_payment_preview_at,
        last_payment_reconciliation_apply_at=last_payment_apply_at,
        last_payment_reconciliation_at=last_payment_at,
        last_payment_reconciliation_source=_metadata_text(last_payment_record, "source"),
        last_payment_reconciliation_mode=_metadata_text(last_payment_record, "mode"),
        guardrails=[
            "Accounting freshness is calculated from local Relby metadata only.",
            (
                "Loading Xero status does not refresh tokens, call Xero, "
                "post invoices, or reconcile payments."
            ),
            "Stale payment reconciliation is a review cue, not an automatic accounting action.",
        ],
    )


def _xero_posting_approval_state(metadata: dict[str, Any]) -> str:
    approval = metadata.get("xero_posting_approval")
    if isinstance(approval, dict):
        state_value = approval.get("state")
        if isinstance(state_value, str) and state_value:
            return state_value
    return "not_requested"


def _xero_posting_approved(metadata: dict[str, Any]) -> bool:
    approval = metadata.get("xero_posting_approval")
    return (
        isinstance(approval, dict)
        and approval.get("approved") is True
        and approval.get("state") == "approved"
    )


def _xero_posting_approval_key(draft: InvoiceDraft, payload_key: str | None = None) -> str:
    if payload_key:
        return _short_idempotency_key("xero-post-approval", payload_key, draft.id)
    return f"xero-post-approval-{draft.id}"


def _xero_draft_create_key(draft: InvoiceDraft, payload_key: str | None = None) -> str:
    metadata = draft.invoice_metadata or {}
    sync_state = _xero_sync_state(metadata)
    existing_key = _metadata_text(sync_state, "idempotency_key")
    if existing_key:
        return existing_key[:128]
    approval = metadata.get("xero_posting_approval")
    if isinstance(approval, dict):
        approval_key = _metadata_text(approval, "draft_create_idempotency_key")
        if approval_key:
            return approval_key[:128]
    if payload_key:
        return _short_idempotency_key("xero-draft", payload_key, draft.id)
    return f"xero-draft-{draft.id}"


def _state_secret(settings: Settings) -> bytes:
    secret = (
        settings.xero_state_secret.strip()
        or settings.xero_client_secret.strip()
        or settings.clerk_secret_key.strip()
    )
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Xero OAuth state signing is not configured.",
        )
    return secret.encode("utf-8")


def _b64_json(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _decode_b64_json(value: str) -> dict[str, Any]:
    padded = f"{value}{'=' * (-len(value) % 4)}"
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8"))
        payload = json.loads(decoded)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Xero connection state.",
        ) from exc
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Xero connection state.",
        )
    return payload


def _sign_state(body: str, settings: Settings) -> str:
    digest = hmac.new(_state_secret(settings), body.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")


def _make_state(entity_id: UUID, user_id: UUID, settings: Settings) -> tuple[str, Any]:
    expires_at = utcnow() + timedelta(minutes=OAUTH_STATE_TTL_MINUTES)
    body = _b64_json(
        {
            "entity_id": str(entity_id),
            "user_id": str(user_id),
            "exp": int(expires_at.timestamp()),
            "nonce": secrets.token_urlsafe(12),
        }
    )
    return f"{body}.{_sign_state(body, settings)}", expires_at


def _verify_state(raw_state: str, settings: Settings) -> tuple[UUID, UUID]:
    try:
        body, signature = raw_state.split(".", 1)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Xero connection state.",
        ) from exc
    expected = _sign_state(body, settings)
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Xero connection state.",
        )
    payload = _decode_b64_json(body)
    exp = payload.get("exp")
    entity_id = payload.get("entity_id")
    user_id = payload.get("user_id")
    if not isinstance(exp, int) or exp < int(utcnow().timestamp()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Xero connection state has expired.",
        )
    if not isinstance(entity_id, str) or not isinstance(user_id, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Xero connection state.",
        )
    return UUID(entity_id), UUID(user_id)


def _frontend_redirect(settings: Settings, entity_id: UUID, **params: str) -> RedirectResponse:
    query = {"tab": "xero", "entity_id": str(entity_id), **params}
    return RedirectResponse(f"{settings.frontend_url.rstrip('/')}/settings?{urlencode(query)}")


def _safe_connection_summary(connection: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": connection.get("id"),
        "tenantId": connection.get("tenantId"),
        "tenantName": connection.get("tenantName"),
        "tenantType": connection.get("tenantType"),
    }


def _select_xero_tenant(
    connections: list[dict[str, Any]],
    preferred_tenant_id: str | None,
) -> dict[str, Any] | None:
    organisations = [
        connection
        for connection in connections
        if str(connection.get("tenantType") or "").upper() in {"ORGANISATION", "ORG", ""}
    ]
    candidates = organisations or connections
    if preferred_tenant_id:
        for connection in candidates:
            if connection.get("tenantId") == preferred_tenant_id:
                return connection
    return candidates[0] if candidates else None


def _token_value(tokens: dict[str, Any], key: str) -> str:
    value = tokens.get(key)
    if not isinstance(value, str) or not value:
        raise XeroIntegrationError(f"Xero token response did not include {key}.")
    return value


def _refresh_provider_access_token(
    provider_connection: XeroConnection,
    settings: Settings,
) -> str:
    refresh_token = decrypt_xero_token(provider_connection.refresh_token_ciphertext, settings)
    tokens = refresh_xero_tokens(refresh_token, settings)
    access_token = _token_value(tokens, "access_token")
    provider_connection.access_token_ciphertext = encrypt_xero_token(access_token, settings)
    provider_connection.refresh_token_ciphertext = encrypt_xero_token(
        _token_value(tokens, "refresh_token"),
        settings,
    )
    provider_connection.token_expires_at = token_expiry_from_payload(tokens)
    return access_token


def _store_provider_connection(
    *,
    session: Session,
    entity: Entity,
    user: AppUser,
    tokens: dict[str, Any],
    selected_connection: dict[str, Any],
    all_connections: list[dict[str, Any]],
    settings: Settings,
) -> XeroConnection:
    now = utcnow()
    for connection in session.scalars(
        select(XeroConnection).where(
            XeroConnection.entity_id == entity.id,
            XeroConnection.revoked_at.is_(None),
            XeroConnection.deleted_at.is_(None),
        )
    ):
        connection.revoked_at = now
        connection.updated_by_user_id = user.id
    tenant_id = str(selected_connection.get("tenantId") or "").strip()
    if not tenant_id:
        raise XeroIntegrationError("Xero did not return a tenant id.")
    access_token = _token_value(tokens, "access_token")
    refresh_token = _token_value(tokens, "refresh_token")
    provider_connection = XeroConnection(
        entity_id=entity.id,
        created_by_user_id=user.id,
        updated_by_user_id=user.id,
        xero_tenant_id=tenant_id,
        tenant_name=(
            str(selected_connection.get("tenantName"))
            if selected_connection.get("tenantName")
            else None
        ),
        tenant_type=(
            str(selected_connection.get("tenantType"))
            if selected_connection.get("tenantType")
            else None
        ),
        access_token_ciphertext=encrypt_xero_token(access_token, settings),
        refresh_token_ciphertext=encrypt_xero_token(refresh_token, settings),
        token_expires_at=token_expiry_from_payload(tokens),
        scopes=str(tokens.get("scope") or " ".join(xero_scopes(settings))),
        connection_metadata={
            "connected_via": "xero_oauth",
            "available_connections": [
                _safe_connection_summary(connection) for connection in all_connections
            ],
            "xero_connection_id": selected_connection.get("id"),
            "token_type": tokens.get("token_type"),
        },
    )
    session.add(provider_connection)
    entity.xero_tenant_id = tenant_id
    entity.xero_connected_at = entity.xero_connected_at or now
    return provider_connection


def _charge_rule_rows(session: Session, entity_id: UUID) -> list[Any]:
    return list(
        session.execute(
            select(RentChargeRule, Lease, TenancyUnit, Property, Tenant)
            .join(Lease, Lease.id == RentChargeRule.lease_id)
            .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
            .join(Property, Property.id == TenancyUnit.property_id)
            .outerjoin(Tenant, Tenant.id == Lease.tenant_id)
            .where(
                Property.entity_id == entity_id,
                Property.deleted_at.is_(None),
                TenancyUnit.deleted_at.is_(None),
                Lease.deleted_at.is_(None),
                RentChargeRule.deleted_at.is_(None),
            )
            .order_by(Property.name, TenancyUnit.unit_label, RentChargeRule.charge_type)
        ).all()
    )


def _normalise(value: str | None) -> str:
    text = (value or "").casefold().replace("&", "and")
    text = "".join(char if char.isalnum() or char.isspace() else " " for char in text)
    return " ".join(text.split())


def _email(value: str | None) -> str:
    return (value or "").strip().casefold()


def _contact_email(contact: dict[str, Any]) -> str | None:
    value = contact.get("EmailAddress")
    return str(value).strip() if isinstance(value, str) and value.strip() else None


def _contact_name(contact: dict[str, Any]) -> str:
    value = contact.get("Name")
    return str(value).strip() if isinstance(value, str) and value.strip() else "Xero contact"


def _contact_id(contact: dict[str, Any]) -> str | None:
    value = contact.get("ContactID")
    return str(value).strip() if isinstance(value, str) and value.strip() else None


def _match_xero_contacts(
    *,
    contacts: list[dict[str, Any]],
    tenants: list[Tenant],
    properties: list[Property],
) -> list[XeroContactMatchRead]:
    by_email = {
        _email(_contact_email(contact)): contact
        for contact in contacts
        if _contact_email(contact) and _contact_id(contact)
    }
    by_name = {
        _normalise(_contact_name(contact)): contact
        for contact in contacts
        if _contact_name(contact) and _contact_id(contact)
    }
    matches: list[XeroContactMatchRead] = []
    for tenant in tenants:
        metadata = tenant.tenant_metadata or {}
        current = metadata.get("xero_contact_id")
        if isinstance(current, str) and current:
            continue
        contact = by_email.get(_email(tenant.billing_email or tenant.contact_email))
        reason = "billing/contact email matched"
        confidence = 0.94
        if contact is None:
            contact = by_name.get(_normalise(_tenant_name(tenant)))
            reason = "tenant name matched"
            confidence = 0.78
        contact_id = _contact_id(contact or {})
        if contact is None or contact_id is None:
            continue
        matches.append(
            XeroContactMatchRead(
                target_type="tenant",
                target_id=tenant.id,
                target_name=_tenant_name(tenant) or tenant.legal_name,
                current_xero_contact_id=None,
                xero_contact_id=contact_id,
                xero_contact_name=_contact_name(contact),
                xero_email=_contact_email(contact),
                match_reason=reason,
                confidence=confidence,
            )
        )
    for prop in properties:
        if prop.xero_contact_id:
            continue
        contact = by_email.get(_email(prop.billing_email))
        reason = "billing email matched"
        confidence = 0.94
        if contact is None:
            contact = by_name.get(_normalise(prop.invoice_issuer_name or prop.owner_legal_name))
            reason = "issuer/owner name matched"
            confidence = 0.78
        contact_id = _contact_id(contact or {})
        if contact is None or contact_id is None:
            continue
        matches.append(
            XeroContactMatchRead(
                target_type="property",
                target_id=prop.id,
                target_name=prop.name,
                current_xero_contact_id=prop.xero_contact_id,
                xero_contact_id=contact_id,
                xero_contact_name=_contact_name(contact),
                xero_email=_contact_email(contact),
                match_reason=reason,
                confidence=confidence,
            )
        )
    return matches[:50]


def _contact_options(contacts: list[dict[str, Any]]) -> list[XeroContactOptionRead]:
    options: list[XeroContactOptionRead] = []
    for contact in contacts:
        contact_id = _contact_id(contact)
        if contact_id is None or not _active_xero_contact(contact):
            continue
        options.append(
            XeroContactOptionRead(
                contact_id=contact_id,
                name=_contact_name(contact),
                email=_contact_email(contact),
            )
        )
    return options


def _unmatched_contact_targets(
    *,
    tenants: list[Tenant],
    properties: list[Property],
    matches: list[XeroContactMatchRead],
) -> list[XeroContactTargetRead]:
    matched = {(match.target_type, match.target_id) for match in matches}
    targets: list[XeroContactTargetRead] = []
    for tenant in tenants:
        if _tenant_xero_contact_id(tenant) or ("tenant", tenant.id) in matched:
            continue
        targets.append(
            XeroContactTargetRead(
                target_type="tenant",
                target_id=tenant.id,
                target_name=_tenant_name(tenant) or tenant.legal_name,
            )
        )
    for prop in properties:
        if prop.xero_contact_id or ("property", prop.id) in matched:
            continue
        targets.append(
            XeroContactTargetRead(
                target_type="property",
                target_id=prop.id,
                target_name=prop.name,
            )
        )
    return targets


def _contact_mapping_metadata(
    mapping: XeroContactMappingApplyItem,
    user: CurrentUser,
    applied_at: Any,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "source": "xero_contact_preview",
        "xero_contact_id": mapping.xero_contact_id.strip(),
        "xero_contact_name": mapping.xero_contact_name.strip(),
        "applied_at": applied_at.isoformat(),
        "applied_by_user_id": str(user.id),
    }
    if mapping.xero_email:
        metadata["xero_email"] = mapping.xero_email.strip()
    if mapping.match_reason:
        metadata["match_reason"] = mapping.match_reason.strip()
    if mapping.confidence is not None:
        metadata["confidence"] = mapping.confidence
    return metadata


def _contact_mapping_result(
    mapping: XeroContactMappingApplyItem,
    *,
    target_name: str,
    previous_xero_contact_id: str | None,
    status_label: Literal["applied", "skipped"],
    reason: str,
) -> XeroContactMappingApplyResultRead:
    return XeroContactMappingApplyResultRead(
        target_type=mapping.target_type,
        target_id=mapping.target_id,
        target_name=target_name,
        previous_xero_contact_id=previous_xero_contact_id,
        xero_contact_id=mapping.xero_contact_id.strip(),
        xero_contact_name=mapping.xero_contact_name.strip(),
        status=status_label,
        reason=reason,
    )


def _xero_text(payload: dict[str, Any] | None, key: str) -> str | None:
    if payload is None:
        return None
    value = payload.get(key)
    return str(value).strip() if value is not None and str(value).strip() else None


def _xero_account_code(account: dict[str, Any]) -> str | None:
    return _xero_text(account, "Code")


def _xero_account_name(account: dict[str, Any]) -> str | None:
    return _xero_text(account, "Name")


def _xero_account_class(account: dict[str, Any]) -> str | None:
    return _xero_text(account, "Class")


def _suggest_charge_account_code(
    charge_type: RentChargeType,
    accounts: list[dict[str, Any]],
) -> str | None:
    """Suggest a Xero account code for a charge type, preferring a name match
    against the live chart (e.g. base rent -> "Rent received") and falling back
    to the built-in default code."""
    default_code, _ = SUGGESTED_CHARGE_MAPPINGS.get(charge_type, ("299", "OUTPUT"))
    hints = CHARGE_ACCOUNT_NAME_HINTS.get(charge_type, ())
    if hints:
        active = [account for account in accounts if _active_xero_status(account)]
        revenue = [
            account
            for account in active
            if (_xero_account_class(account) or "").upper() in REVENUE_ACCOUNT_CLASSES
        ]
        candidates = revenue or active
        for hint in hints:
            for account in candidates:
                code = _xero_account_code(account)
                name = (_xero_account_name(account) or "").casefold()
                if code and hint in name:
                    return code
    return default_code


def _xero_tax_type(tax_rate: dict[str, Any]) -> str | None:
    return _xero_text(tax_rate, "TaxType")


def _active_xero_status(payload: dict[str, Any] | None) -> bool:
    status_value = _xero_text(payload, "Status")
    return status_value is None or status_value.upper() == "ACTIVE"


def _validate_xero_chart_tax(
    *,
    charge_rows: list[Any],
    accounts: list[dict[str, Any]],
    tax_rates: list[dict[str, Any]],
) -> list[XeroChartTaxValidationResultRead]:
    accounts_by_code = {
        code: account
        for account in accounts
        if (code := _xero_account_code(account)) is not None
    }
    tax_rates_by_type = {
        tax_type.upper(): tax_rate
        for tax_rate in tax_rates
        if (tax_type := _xero_tax_type(tax_rate)) is not None
    }
    results: list[XeroChartTaxValidationResultRead] = []
    for rule, _lease, unit, prop, tenant in charge_rows:
        _, suggested_tax = SUGGESTED_CHARGE_MAPPINGS.get(
            rule.charge_type,
            ("299", "OUTPUT"),
        )
        suggested_account = _suggest_charge_account_code(rule.charge_type, accounts)
        account_code = rule.xero_account_code.strip() if rule.xero_account_code else None
        tax_type = rule.xero_tax_type.strip() if rule.xero_tax_type else None
        account = accounts_by_code.get(account_code or "")
        tax_rate = tax_rates_by_type.get((tax_type or "").upper())
        blockers: list[str] = []

        account_valid = False
        if not account_code:
            blockers.append("Xero account code is missing.")
        elif account is None:
            blockers.append(f"Account code {account_code} was not found in Xero.")
        elif not _active_xero_status(account):
            blockers.append(f"Account code {account_code} is not active in Xero.")
        else:
            account_valid = True

        taxable_rule = rule.gst_treatment.value == "taxable"
        tax_valid = not taxable_rule and not tax_type
        if taxable_rule and not tax_type:
            blockers.append("Taxable charge is missing a Xero tax type.")
        elif tax_type and tax_rate is None:
            blockers.append(f"Tax type {tax_type} was not found in Xero.")
        elif tax_type and not _active_xero_status(tax_rate):
            blockers.append(f"Tax type {tax_type} is not active in Xero.")
        elif tax_type:
            tax_valid = True

        missing_mapping = not account_code or (taxable_rule and not tax_type)
        status_label: Literal["ready", "needs_mapping", "not_found"] = "ready"
        if missing_mapping:
            status_label = "needs_mapping"
        elif blockers:
            status_label = "not_found"

        results.append(
            XeroChartTaxValidationResultRead(
                charge_rule_id=rule.id,
                charge_type=rule.charge_type.value,
                property_name=prop.name,
                unit_label=unit.unit_label,
                tenant_name=_tenant_name(tenant),
                account_code=account_code,
                account_name=_xero_text(account, "Name"),
                account_status=_xero_text(account, "Status"),
                account_valid=account_valid,
                tax_type=tax_type,
                tax_name=_xero_text(tax_rate, "Name"),
                tax_valid=tax_valid,
                suggested_account_code=suggested_account,
                suggested_tax_type=suggested_tax,
                status=status_label,
                blockers=blockers,
            )
        )
    return results


def _active_xero_contact(contact: dict[str, Any] | None) -> bool:
    status_value = _xero_text(contact, "ContactStatus")
    return status_value is None or status_value.upper() == "ACTIVE"


def _tenant_xero_contact_id(tenant: Tenant | None) -> str | None:
    metadata = tenant.tenant_metadata if tenant is not None else None
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("xero_contact_id")
    return str(value).strip() if value is not None and str(value).strip() else None


def _invoice_draft_xero_synced(draft: InvoiceDraft) -> bool:
    metadata = draft.invoice_metadata or {}
    for key in ("xero_sync", "posting_preparation", "delivery_state"):
        state = metadata.get(key)
        if isinstance(state, dict) and state.get("xero_synced") is True:
            return True
    return False


def _approved_unsynced_invoice_drafts(
    session: Session,
    entity_id: UUID,
) -> list[InvoiceDraft]:
    drafts = list(
        session.scalars(
            select(InvoiceDraft)
            .where(
                InvoiceDraft.entity_id == entity_id,
                InvoiceDraft.status == InvoiceDraftStatus.approved,
                InvoiceDraft.deleted_at.is_(None),
            )
            .order_by(InvoiceDraft.due_date, InvoiceDraft.created_at)
        )
    )
    return [draft for draft in drafts if not _invoice_draft_xero_synced(draft)]


def _charge_rule_lookup_for_invoice(
    session: Session,
    draft: InvoiceDraft,
) -> dict[UUID, RentChargeRule]:
    if draft.lease_id is None:
        return {}
    rules = session.scalars(
        select(RentChargeRule).where(
            RentChargeRule.lease_id == draft.lease_id,
            RentChargeRule.deleted_at.is_(None),
        )
    )
    return {rule.id: rule for rule in rules}


def _metadata_uuid(metadata: dict[str, Any], *keys: str) -> UUID | None:
    for key in keys:
        value = metadata.get(key)
        if value is None:
            continue
        try:
            return UUID(str(value))
        except ValueError:
            continue
    return None


def _charge_rule_for_invoice_line(
    *,
    line: Any,
    charge_rules: dict[UUID, RentChargeRule],
) -> RentChargeRule | None:
    metadata = line.line_metadata or {}
    rule_id = _metadata_uuid(metadata, "charge_rule_id", "rent_charge_rule_id")
    if rule_id is None:
        raw = metadata.get("raw")
        if isinstance(raw, dict):
            rule_id = _metadata_uuid(raw, "charge_rule_id", "rent_charge_rule_id")
    if rule_id is not None and rule_id in charge_rules:
        return charge_rules[rule_id]
    if len(charge_rules) == 1:
        return next(iter(charge_rules.values()))
    return None


def _line_metadata_text(line: Any, *keys: str) -> str | None:
    metadata = line.line_metadata or {}
    raw = metadata.get("raw") if isinstance(metadata.get("raw"), dict) else {}
    for source in (metadata, raw):
        for key in keys:
            value = source.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
    return None


def _invoice_line_amount(amount_cents: int) -> float:
    return round(amount_cents / 100, 2)


def _invoice_line_posting_preview(
    *,
    line: Any,
    index: int,
    charge_rules: dict[UUID, RentChargeRule],
    accounts_by_code: dict[str, dict[str, Any]],
    tax_rates_by_type: dict[str, dict[str, Any]],
) -> tuple[XeroInvoicePostingPreviewLineRead, dict[str, Any], list[str]]:
    rule = _charge_rule_for_invoice_line(line=line, charge_rules=charge_rules)
    account_code = _line_metadata_text(line, "xero_account_code", "account_code")
    tax_type = _line_metadata_text(line, "xero_tax_type", "tax_type")
    if rule is not None:
        account_code = account_code or rule.xero_account_code
        tax_type = tax_type or rule.xero_tax_type

    blockers: list[str] = []
    label = f"Line {index + 1}"
    if not account_code:
        blockers.append(f"{label} is missing a Xero account code.")
    elif account_code not in accounts_by_code:
        blockers.append(f"{label} account code {account_code} was not found in Xero.")
    elif not _active_xero_status(accounts_by_code[account_code]):
        blockers.append(f"{label} account code {account_code} is not active in Xero.")

    taxable_rule = rule is None or rule.gst_treatment.value == "taxable" or line.gst_cents > 0
    if taxable_rule and not tax_type:
        blockers.append(f"{label} needs a Xero tax type before posting.")
    elif tax_type and tax_type.upper() not in tax_rates_by_type:
        blockers.append(f"{label} tax type {tax_type} was not found in Xero.")
    elif tax_type and not _active_xero_status(tax_rates_by_type[tax_type.upper()]):
        blockers.append(f"{label} tax type {tax_type} is not active in Xero.")

    line_amount = _invoice_line_amount(line.amount_cents)
    line_preview = XeroInvoicePostingPreviewLineRead(
        description=line.description,
        quantity=1.0,
        unit_amount=line_amount,
        account_code=account_code,
        tax_type=tax_type,
        line_amount=line_amount,
        source_line_id=line.id,
    )
    payload_line: dict[str, Any] = {
        "Description": line.description,
        "Quantity": 1,
        "UnitAmount": line_amount,
        "LineAmount": line_amount,
    }
    if account_code:
        payload_line["AccountCode"] = account_code
    if tax_type:
        payload_line["TaxType"] = tax_type
    return line_preview, payload_line, blockers


def _xero_invoice_posting_result(
    *,
    draft: InvoiceDraft,
    session: Session,
    contacts_by_id: dict[str, dict[str, Any]],
    accounts_by_code: dict[str, dict[str, Any]],
    tax_rates_by_type: dict[str, dict[str, Any]],
) -> XeroInvoicePostingPreviewResultRead:
    tenant = session.get(Tenant, draft.tenant_id) if draft.tenant_id else None
    xero_contact_id = _tenant_xero_contact_id(tenant)
    contact = contacts_by_id.get(xero_contact_id or "")
    contact_name = _contact_name(contact) if contact is not None else _tenant_name(tenant)
    blockers: list[str] = []
    if not xero_contact_id:
        blockers.append("Tenant Xero contact mapping missing.")
    elif contact is None:
        blockers.append(f"Tenant Xero contact {xero_contact_id} was not found in Xero.")
    elif not _active_xero_contact(contact):
        blockers.append(f"Tenant Xero contact {xero_contact_id} is not active in Xero.")
    if not draft.invoice_number:
        blockers.append("Invoice number missing.")
    if draft.issue_date is None:
        blockers.append("Invoice issue date missing.")
    if draft.due_date is None:
        blockers.append("Invoice due date missing.")
    active_lines = [line for line in draft.lines if line.deleted_at is None]
    if not active_lines:
        blockers.append("Invoice draft has no line items.")
    if draft.total_cents <= 0:
        blockers.append("Invoice amount missing.")

    charge_rules = _charge_rule_lookup_for_invoice(session, draft)
    line_items: list[XeroInvoicePostingPreviewLineRead] = []
    payload_lines: list[dict[str, Any]] = []
    for index, line in enumerate(active_lines):
        line_preview, payload_line, line_blockers = _invoice_line_posting_preview(
            line=line,
            index=index,
            charge_rules=charge_rules,
            accounts_by_code=accounts_by_code,
            tax_rates_by_type=tax_rates_by_type,
        )
        line_items.append(line_preview)
        payload_lines.append(payload_line)
        blockers.extend(line_blockers)

    payload_preview: dict[str, Any] = {
        "Type": "ACCREC",
        "Status": "DRAFT",
        "Contact": {"ContactID": xero_contact_id} if xero_contact_id else {},
        "Date": draft.issue_date.isoformat() if draft.issue_date else None,
        "DueDate": draft.due_date.isoformat() if draft.due_date else None,
        "InvoiceNumber": draft.invoice_number,
        "Reference": draft.title,
        "CurrencyCode": draft.currency,
        "LineAmountTypes": "Exclusive",
        "LineItems": payload_lines,
    }
    status_label: Literal["ready", "blocked"] = "blocked" if blockers else "ready"
    return XeroInvoicePostingPreviewResultRead(
        invoice_draft_id=draft.id,
        invoice_number=draft.invoice_number,
        title=draft.title,
        status=status_label,
        xero_contact_id=xero_contact_id,
        contact_name=contact_name,
        issue_date=draft.issue_date,
        due_date=draft.due_date,
        currency=draft.currency,
        total_cents=draft.total_cents,
        line_count=len(active_lines),
        line_items=line_items,
        blockers=blockers,
        payload_preview=payload_preview,
    )


def _draft_create_result(
    draft: InvoiceDraft,
    *,
    status_label: Literal["created", "skipped", "blocked", "failed"],
    reason: str,
    external_posting_status: str,
    idempotency_key: str | None = None,
    xero_invoice_id: str | None = None,
    xero_status: str | None = None,
) -> XeroInvoiceDraftCreateResultRead:
    metadata = draft.invoice_metadata or {}
    return XeroInvoiceDraftCreateResultRead(
        invoice_draft_id=draft.id,
        invoice_number=draft.invoice_number,
        status=status_label,
        reason=reason,
        approval_state=_xero_posting_approval_state(metadata),
        idempotency_key=idempotency_key,
        xero_invoice_id=xero_invoice_id,
        xero_status=xero_status,
        external_posting_status=external_posting_status,
    )


def _store_xero_draft_create_result(
    *,
    draft: InvoiceDraft,
    created_invoice: dict[str, Any],
    provider_connection: XeroConnection,
    user: CurrentUser,
    idempotency_key: str,
    created_at: Any,
) -> tuple[str | None, str | None]:
    metadata = dict(draft.invoice_metadata or {})
    xero_invoice_id = _xero_text(created_invoice, "InvoiceID")
    xero_status = _xero_text(created_invoice, "Status") or "DRAFT"
    xero_invoice_number = _xero_text(created_invoice, "InvoiceNumber") or draft.invoice_number
    sync_state = {
        "xero_synced": True,
        "external_posting_status": "draft_created",
        "xero_invoice_id": xero_invoice_id,
        "xero_invoice_number": xero_invoice_number,
        "xero_status": xero_status,
        "created_at": created_at.isoformat(),
        "created_by_user_id": str(user.id),
        "idempotency_key": idempotency_key,
        "provider_connection_id": str(provider_connection.id),
        "xero_tenant_id": provider_connection.xero_tenant_id,
    }
    metadata["xero_sync"] = sync_state

    posting_preparation = dict(metadata.get("posting_preparation") or {})
    posting_preparation.update(
        {
            "xero_synced": True,
            "xero_sync_allowed": False,
            "xero_sync_requested": False,
            "external_posting_status": "draft_created",
            "xero_invoice_id": xero_invoice_id,
            "xero_invoice_number": xero_invoice_number,
            "xero_status": xero_status,
            "posted_at": created_at.isoformat(),
            "posted_by_user_id": str(user.id),
            "guardrail": "Xero draft was created after explicit local posting approval.",
        }
    )
    metadata["posting_preparation"] = posting_preparation

    delivery_state = dict(metadata.get("delivery_state") or {})
    if delivery_state:
        delivery_state["xero_synced"] = True
        metadata["delivery_state"] = delivery_state

    history = list(metadata.get("xero_sync_history") or [])
    history.append(sync_state)
    metadata["xero_sync_history"] = history[-20:]
    draft.invoice_metadata = metadata
    return xero_invoice_id, xero_status


def _provider_status_receipts(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    receipts = metadata.get("provider_status_receipts")
    if not isinstance(receipts, list):
        return []
    return [receipt for receipt in receipts if isinstance(receipt, dict)]


def _record_xero_provider_receipt(
    *,
    draft: InvoiceDraft,
    status_label: str,
    reason: str,
    external_posting_status: str,
    idempotency_key: str | None,
    attempted_at: Any,
    user: CurrentUser,
    provider_connection: XeroConnection | None = None,
    xero_invoice_id: str | None = None,
    xero_status: str | None = None,
) -> dict[str, Any]:
    metadata = dict(draft.invoice_metadata or {})
    receipts = _provider_status_receipts(metadata)
    retry_count = (
        sum(1 for receipt in receipts if receipt.get("provider") == "xero") + 1
    )
    receipt = {
        "provider": "xero",
        "status": status_label,
        "reason": reason,
        "external_posting_status": external_posting_status,
        "idempotency_key": idempotency_key,
        "xero_invoice_id": xero_invoice_id,
        "xero_status": xero_status,
        "received_at": attempted_at.isoformat(),
        "retry_count": retry_count,
        "provider_connection_id": (
            str(provider_connection.id) if provider_connection is not None else None
        ),
        "xero_tenant_id": (
            provider_connection.xero_tenant_id if provider_connection is not None else None
        ),
        "recorded_by_user_id": str(user.id),
    }

    dispatch = metadata.get("provider_dispatch")
    provider_dispatch = dict(dispatch) if isinstance(dispatch, dict) else {}
    provider_dispatch["xero"] = receipt
    metadata["provider_dispatch"] = provider_dispatch
    metadata["provider_status_receipts"] = [receipt, *receipts[:19]]

    posting_preparation_value = metadata.get("posting_preparation")
    posting_preparation = (
        dict(posting_preparation_value)
        if isinstance(posting_preparation_value, dict)
        else {}
    )
    posting_preparation.update(
        {
            "external_posting_status": external_posting_status,
            "last_provider_status": status_label,
            "last_provider_reason": reason,
            "last_provider_attempted_at": attempted_at.isoformat(),
            "last_provider_idempotency_key": idempotency_key,
            "provider_retry_count": retry_count,
        }
    )
    if status_label == "failed":
        posting_preparation.update(
            {
                "xero_sync_allowed": True,
                "xero_sync_requested": True,
                "guardrail": "Provider dispatch failed; retry still requires explicit approval.",
            }
        )
    metadata["posting_preparation"] = posting_preparation
    draft.invoice_metadata = metadata
    return receipt


def _xero_provider_receipt_reads(
    metadata: dict[str, Any],
) -> list[XeroProviderStatusReceiptRead]:
    receipts: list[XeroProviderStatusReceiptRead] = []
    for receipt in _provider_status_receipts(metadata):
        if receipt.get("provider") != "xero" or not receipt.get("received_at"):
            continue
        receipts.append(XeroProviderStatusReceiptRead.model_validate(receipt))
    return receipts


def _provider_dispatch_next_action(
    xero_status: str,
    email_status: str,
) -> str | None:
    if xero_status == "failed":
        return "retry_xero_dispatch"
    if xero_status == "blocked":
        return "resolve_xero_blockers"
    if xero_status == "skipped":
        return "configure_xero_provider"
    if email_status == "failed":
        return "retry_email_dispatch"
    if email_status == "blocked":
        return "resolve_email_blockers"
    if email_status == "skipped":
        return "configure_email_provider"
    return None


def _exception_from_status_issue(issue: XeroMappingIssueRead) -> XeroExceptionQueueItemRead:
    return XeroExceptionQueueItemRead(
        id=issue.id,
        kind=issue.kind,
        severity=issue.severity,
        label=issue.label,
        detail=issue.detail,
        action=issue.action,
        next_action=(
            "connect_xero"
            if issue.kind == "connection"
            else "review_contact_mapping"
            if issue.kind == "contact"
            else "review_chart_tax_mapping"
            if issue.kind in {"chart", "tax"}
            else "review_invoice_posting"
            if issue.kind == "invoice_sync"
            else "preview_payment_reconciliation"
            if issue.kind == "payment"
            else None
        ),
        source="xero_status",
        property_id=issue.property_id,
        property_name=issue.property_name,
        tenancy_unit_id=issue.tenancy_unit_id,
        unit_label=issue.unit_label,
        lease_id=issue.lease_id,
        tenant_id=issue.tenant_id,
        tenant_name=issue.tenant_name,
        charge_rule_id=issue.charge_rule_id,
        charge_type=issue.charge_type,
        current_account_code=issue.current_account_code,
        current_tax_type=issue.current_tax_type,
        suggested_account_code=issue.suggested_account_code,
        suggested_tax_type=issue.suggested_tax_type,
    )


def _latest_xero_provider_receipt(metadata: dict[str, Any]) -> dict[str, Any] | None:
    for receipt in _provider_status_receipts(metadata):
        if receipt.get("provider") == "xero":
            return receipt
    return None


def _receipt_needs_xero_exception(receipt: dict[str, Any] | None) -> bool:
    if receipt is None:
        return False
    status_value = str(receipt.get("status") or "").lower()
    external_status = str(receipt.get("external_posting_status") or "").lower()
    return status_value in {"failed", "blocked"} or external_status in {
        "provider_failed",
        "preview_blocked",
        "approval_required",
        "provider_unconfigured",
    }


def _provider_exception_from_invoice(
    draft: InvoiceDraft,
    metadata: dict[str, Any],
) -> XeroExceptionQueueItemRead | None:
    receipt = _latest_xero_provider_receipt(metadata)
    if not _receipt_needs_xero_exception(receipt):
        return None
    status_value = str(receipt.get("status") or "failed")
    reason = str(receipt.get("reason") or "The latest Xero provider attempt needs review.")
    return XeroExceptionQueueItemRead(
        id=f"xero-provider-{draft.id}",
        kind="provider",
        severity="blocker" if status_value == "failed" else "warning",
        label="Xero provider dispatch needs attention",
        detail=f"{draft.invoice_number or draft.title}: {reason}",
        action=(
            "Review the latest provider receipt, then retry dispatch once the "
            "blocker is resolved."
        ),
        next_action=_provider_dispatch_next_action(status_value, "skipped"),
        source="provider_status_receipt",
        property_id=draft.property_id,
        tenancy_unit_id=draft.tenancy_unit_id,
        lease_id=draft.lease_id,
        tenant_id=draft.tenant_id,
        invoice_draft_id=draft.id,
        invoice_number=draft.invoice_number,
        invoice_title=draft.title,
        total_cents=draft.total_cents,
        currency=draft.currency,
        provider=str(receipt.get("provider") or "xero"),
        provider_status=status_value,
        external_posting_status=(
            str(receipt.get("external_posting_status"))
            if receipt.get("external_posting_status") is not None
            else None
        ),
        idempotency_key=(
            str(receipt.get("idempotency_key"))
            if receipt.get("idempotency_key") is not None
            else None
        ),
        xero_invoice_id=(
            str(receipt.get("xero_invoice_id"))
            if receipt.get("xero_invoice_id") is not None
            else None
        ),
        xero_status=(
            str(receipt.get("xero_status")) if receipt.get("xero_status") is not None else None
        ),
        received_at=receipt.get("received_at"),
        retry_count=(
            int(receipt["retry_count"])
            if isinstance(receipt.get("retry_count"), int)
            else None
        ),
    )


def _payment_exception_from_invoice(
    draft: InvoiceDraft,
    metadata: dict[str, Any],
) -> XeroExceptionQueueItemRead | None:
    xero_invoice_id = _xero_invoice_id_from_metadata(metadata)
    if not xero_invoice_id:
        return None
    payment_status = _payment_status(metadata)
    if payment_status == "paid":
        return None
    due_date = draft.due_date
    overdue = due_date is not None and due_date < utcnow().date()
    paid_cents = _payment_paid_cents(metadata) or 0
    outstanding_cents = max(draft.total_cents - paid_cents, 0)
    return XeroExceptionQueueItemRead(
        id=f"xero-payment-{draft.id}",
        kind="payment",
        severity="warning" if overdue else "info",
        label="Xero payment status needs review",
        detail=(
            f"{draft.invoice_number or draft.title} is linked to a Xero draft "
            f"but Relby still shows {payment_status.replace('_', ' ')}."
        ),
        action=(
            "Preview provider payments, then apply reviewed local payment metadata "
            "if a match is found."
        ),
        next_action="preview_payment_reconciliation",
        source="invoice_payment_metadata",
        property_id=draft.property_id,
        tenancy_unit_id=draft.tenancy_unit_id,
        lease_id=draft.lease_id,
        tenant_id=draft.tenant_id,
        invoice_draft_id=draft.id,
        invoice_number=draft.invoice_number,
        invoice_title=draft.title,
        total_cents=outstanding_cents,
        currency=draft.currency,
        provider="xero",
        provider_status=payment_status,
        xero_invoice_id=xero_invoice_id,
    )


def _freshness_exception_from_status(
    freshness: XeroAccountingFreshnessRead,
) -> XeroExceptionQueueItemRead | None:
    if not freshness.stale_reconciliation:
        return None
    return XeroExceptionQueueItemRead(
        id="xero-payment-reconciliation-freshness",
        kind="payment",
        severity="warning",
        label="Payment reconciliation freshness needs review",
        detail=freshness.summary,
        action=(
            "Run preview payments from the provider before relying on the accounting snapshot "
            "for Xero-linked invoices."
        ),
        next_action="preview_payment_reconciliation",
        source="accounting_freshness",
        provider="xero",
    )


def _xero_exception_summary(
    items: list[XeroExceptionQueueItemRead],
) -> XeroExceptionQueueSummaryRead:
    severity_counts = {
        "blocker": sum(1 for item in items if item.severity == "blocker"),
        "warning": sum(1 for item in items if item.severity == "warning"),
        "info": sum(1 for item in items if item.severity == "info"),
    }
    kind_counts = {
        kind: sum(1 for item in items if item.kind == kind) for kind in XERO_EXCEPTION_KINDS
    }
    return XeroExceptionQueueSummaryRead(
        total=len(items),
        blockers=severity_counts["blocker"],
        warnings=severity_counts["warning"],
        info=severity_counts["info"],
        connection=kind_counts["connection"],
        contact=kind_counts["contact"],
        chart=kind_counts["chart"],
        tax=kind_counts["tax"],
        invoice_sync=kind_counts["invoice_sync"],
        provider=kind_counts["provider"],
        payment=kind_counts["payment"],
    )


EMAIL_DELIVERED_STATUSES = {"queued", "sent", "delivered", "opened"}


def _sendgrid_send_state(metadata: dict[str, Any]) -> dict[str, Any] | None:
    delivery_email = metadata.get("delivery_email")
    if not isinstance(delivery_email, dict):
        return None
    send_state = delivery_email.get("send")
    return dict(send_state) if isinstance(send_state, dict) else None


def _provider_dispatch_email_result(
    *,
    draft: InvoiceDraft,
    user: CurrentUser,
    session: Session,
    settings: Settings,
) -> tuple[Literal["sent", "reused", "skipped", "blocked", "failed"], str, str | None, str | None]:
    metadata = dict(draft.invoice_metadata or {})
    if draft.status != InvoiceDraftStatus.approved:
        return "blocked", "Invoice draft must be approved before tenant email dispatch.", None, None
    if not _invoice_delivery_ready(metadata):
        return "blocked", "Prepare invoice delivery before tenant email dispatch.", None, None
    if _invoice_pdf_document(draft, metadata, session) is None:
        return "blocked", "Invoice PDF artifact missing. Prepare delivery again.", None, None
    if not draft.recipient_email:
        return "blocked", "Tenant billing email missing.", None, None

    send_state = _sendgrid_send_state(metadata)
    if (
        send_state is not None
        and send_state.get("provider") == "sendgrid"
        and send_state.get("status") in EMAIL_DELIVERED_STATUSES
    ):
        return (
            "reused",
            "SendGrid invoice email receipt already exists.",
            str(send_state.get("status") or ""),
            str(send_state.get("provider_message_id") or "") or None,
        )

    result = send_invoice_delivery_email(
        _provider_invoice_delivery_invite(draft, metadata, session, settings),
        settings,
    )
    draft.invoice_metadata = _record_invoice_provider_delivery(draft, metadata, result, user)
    result_dict = result.to_dict()
    provider_status = str(result_dict.get("status") or "failed")
    message_id = str(result_dict.get("provider_message_id") or "") or None
    if provider_status in EMAIL_DELIVERED_STATUSES:
        return (
            "sent",
            "SendGrid invoice email was queued for delivery.",
            provider_status,
            message_id,
        )
    if provider_status == "skipped":
        return (
            "skipped",
            "SendGrid invoice email was skipped by provider configuration.",
            provider_status,
            message_id,
        )
    return (
        "failed",
        str(result_dict.get("error") or "SendGrid invoice email delivery failed."),
        provider_status,
        message_id,
    )


def _money_to_cents(value: Any) -> int | None:
    if value is None:
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return int((amount * Decimal("100")).quantize(Decimal("1")))


def _payment_items_from_xero_invoices(
    invoices: list[dict[str, Any]],
) -> list[XeroPaymentReconciliationItem]:
    items: list[XeroPaymentReconciliationItem] = []
    for invoice in invoices:
        invoice_id = _xero_text(invoice, "InvoiceID")
        invoice_number = _xero_text(invoice, "InvoiceNumber")
        if not invoice_id and not invoice_number:
            continue
        total_cents = _money_to_cents(invoice.get("Total"))
        paid_cents = _money_to_cents(invoice.get("AmountPaid")) or 0
        due_cents = _money_to_cents(invoice.get("AmountDue"))
        status_value = (_xero_text(invoice, "Status") or "").upper()
        if status_value == "PAID" or (total_cents is not None and paid_cents >= total_cents):
            proposed_status: Literal["unpaid", "partially_paid", "paid"] = "paid"
            proposed_paid = total_cents if total_cents is not None else paid_cents
        elif paid_cents > 0 or (due_cents is not None and total_cents and due_cents < total_cents):
            proposed_status = "partially_paid"
            proposed_paid = paid_cents
        else:
            proposed_status = "unpaid"
            proposed_paid = 0
        items.append(
            XeroPaymentReconciliationItem(
                invoice_number=invoice_number,
                xero_invoice_id=invoice_id,
                status=proposed_status,
                paid_cents=proposed_paid,
                source="provider",
                provider_payment_id=_xero_text(invoice, "UpdatedDateUTC") or invoice_id,
            )
        )
    return items


def _invoice_payment_status(
    draft: InvoiceDraft,
    item: XeroPaymentReconciliationItem,
    reconciled_at: Any,
) -> tuple[dict[str, Any] | None, str | None]:
    if item.status == "unpaid":
        paid_cents = 0
    elif item.status == "paid":
        paid_cents = draft.total_cents if item.paid_cents is None else item.paid_cents
        if paid_cents < draft.total_cents:
            return None, "Paid reconciliation cannot be less than the invoice total."
    else:
        if item.paid_cents is None:
            return None, "Partial payment needs a paid amount."
        paid_cents = item.paid_cents
        if paid_cents <= 0 or paid_cents >= draft.total_cents:
            return (
                None,
                "Partial payment must be greater than zero and less than the invoice total.",
            )

    paid_cents = min(paid_cents, draft.total_cents)
    outstanding_cents = max(draft.total_cents - paid_cents, 0)
    status_value = item.status
    if outstanding_cents == 0:
        status_value = "paid"
    elif paid_cents > 0:
        status_value = "partially_paid"
    else:
        status_value = "unpaid"
    return (
        {
            "status": status_value,
            "paid_cents": paid_cents,
            "outstanding_cents": outstanding_cents,
            "paid_at": item.paid_at.isoformat() if item.paid_at else None,
            "updated_at": reconciled_at.isoformat(),
            "source": f"xero_payment_reconciliation_{item.source}",
        },
        None,
    )


def _payment_reconciliation_key(
    draft: InvoiceDraft,
    item: XeroPaymentReconciliationItem,
    proposed_status: dict[str, Any],
) -> str:
    if item.idempotency_key:
        return _short_idempotency_key("xero-payment", item.idempotency_key, draft.id)
    return _short_idempotency_key(
        "xero-payment",
        item.provider_payment_id,
        item.xero_invoice_id,
        item.invoice_number,
        draft.id,
        proposed_status.get("status"),
        proposed_status.get("paid_cents"),
        proposed_status.get("paid_at"),
    )


def _payment_match_method(
    item: XeroPaymentReconciliationItem,
    match_basis: Literal["invoice_draft_id", "xero_invoice_id", "invoice_number", "none"],
) -> str:
    if item.match_method:
        return item.match_method
    if match_basis == "invoice_draft_id":
        return "Matched by Relby invoice draft ID."
    if match_basis == "xero_invoice_id":
        return "Matched by Xero invoice ID."
    if match_basis == "invoice_number":
        return "Matched by invoice number."
    return "No invoice match found."


def _payment_match_confidence(
    item: XeroPaymentReconciliationItem,
    match_basis: Literal["invoice_draft_id", "xero_invoice_id", "invoice_number", "none"],
) -> Literal["high", "medium", "low"]:
    if item.match_confidence:
        return item.match_confidence
    if match_basis in {"invoice_draft_id", "xero_invoice_id"}:
        return "high"
    if match_basis == "invoice_number":
        return "medium"
    return "low"


def _payment_amount_delta_cents(
    item: XeroPaymentReconciliationItem,
    proposed_status: dict[str, Any] | None,
) -> int | None:
    if proposed_status is None:
        return None
    proposed_paid = proposed_status.get("paid_cents")
    if not isinstance(proposed_paid, int):
        return None
    statement_amount = item.statement_amount_cents
    if statement_amount is None:
        statement_amount = item.paid_cents
    if statement_amount is None:
        return 0
    return statement_amount - proposed_paid


def _payment_guardrail_flags(
    item: XeroPaymentReconciliationItem,
    proposed_status: dict[str, Any] | None,
    match_confidence: Literal["high", "medium", "low"],
) -> list[str]:
    flags = ["no_bank_feed_mutation", "local_payment_metadata_only"]
    if item.bank_transaction_id or item.reference or item.statement_amount_cents is not None:
        flags.append("bank_evidence_stored")
    if match_confidence != "high":
        flags.append("review_match_confidence")
    amount_delta = _payment_amount_delta_cents(item, proposed_status)
    if amount_delta not in {None, 0}:
        flags.append("amount_delta_needs_review")
    if item.match_notes:
        flags.append("operator_match_notes")
    return flags


def _payment_result_context(
    item: XeroPaymentReconciliationItem,
    match_basis: Literal["invoice_draft_id", "xero_invoice_id", "invoice_number", "none"],
    proposed_status: dict[str, Any] | None,
) -> dict[str, Any]:
    match_confidence = _payment_match_confidence(item, match_basis)
    return {
        "match_method": _payment_match_method(item, match_basis),
        "match_confidence": match_confidence,
        "amount_delta_cents": _payment_amount_delta_cents(item, proposed_status),
        "bank_transaction_id": item.bank_transaction_id,
        "bank_account_name": item.bank_account_name,
        "statement_date": item.statement_date,
        "statement_amount_cents": item.statement_amount_cents,
        "counterparty": item.counterparty,
        "reference": item.reference,
        "guardrail_flags": _payment_guardrail_flags(item, proposed_status, match_confidence),
    }


def _payment_reconciliation_result(
    *,
    item: XeroPaymentReconciliationItem,
    drafts_by_id: dict[UUID, InvoiceDraft],
    drafts_by_number: dict[str, InvoiceDraft],
    drafts_by_xero_invoice_id: dict[str, InvoiceDraft],
    apply_changes: bool,
    user: CurrentUser,
    reconciled_at: Any,
) -> XeroPaymentReconciliationResultRead:
    draft = None
    match_basis: Literal["invoice_draft_id", "xero_invoice_id", "invoice_number", "none"] = "none"
    if item.invoice_draft_id is not None:
        draft = drafts_by_id.get(item.invoice_draft_id)
        if draft is not None:
            match_basis = "invoice_draft_id"
    if draft is None and item.xero_invoice_id:
        draft = drafts_by_xero_invoice_id.get(item.xero_invoice_id)
        if draft is not None:
            match_basis = "xero_invoice_id"
    if draft is None and item.invoice_number:
        draft = drafts_by_number.get(item.invoice_number)
        if draft is not None:
            match_basis = "invoice_number"
    if draft is None:
        return XeroPaymentReconciliationResultRead(
            invoice_draft_id=item.invoice_draft_id,
            invoice_number=item.invoice_number,
            status="blocked",
            reason="No matching invoice draft was found for this payment status.",
            current_status=None,
            proposed_status=item.status,
            current_paid_cents=None,
            proposed_paid_cents=item.paid_cents,
            outstanding_cents=None,
            idempotency_key=item.idempotency_key,
            **_payment_result_context(item, "none", None),
        )

    metadata = dict(draft.invoice_metadata or {})
    proposed_status, error = _invoice_payment_status(draft, item, reconciled_at)
    current_status = _payment_status(metadata)
    current_paid_cents = _payment_paid_cents(metadata)
    result_context = _payment_result_context(item, match_basis, proposed_status)
    if proposed_status is None:
        return XeroPaymentReconciliationResultRead(
            invoice_draft_id=draft.id,
            invoice_number=draft.invoice_number,
            status="blocked",
            reason=error or "Payment status could not be normalised.",
            current_status=current_status,
            proposed_status=item.status,
            current_paid_cents=current_paid_cents,
            proposed_paid_cents=item.paid_cents,
            outstanding_cents=None,
            idempotency_key=item.idempotency_key,
            **result_context,
        )

    if result_context["match_confidence"] == "low":
        return XeroPaymentReconciliationResultRead(
            invoice_draft_id=draft.id,
            invoice_number=draft.invoice_number,
            status="blocked",
            reason="Low-confidence payment matches require manual review before apply.",
            current_status=current_status,
            proposed_status=proposed_status["status"],
            current_paid_cents=current_paid_cents,
            proposed_paid_cents=proposed_status["paid_cents"],
            outstanding_cents=proposed_status["outstanding_cents"],
            idempotency_key=item.idempotency_key,
            **result_context,
        )

    idempotency_key = _payment_reconciliation_key(draft, item, proposed_status)
    reconciliation_history = list(metadata.get("xero_payment_reconciliation_history") or [])
    if any(entry.get("idempotency_key") == idempotency_key for entry in reconciliation_history):
        return XeroPaymentReconciliationResultRead(
            invoice_draft_id=draft.id,
            invoice_number=draft.invoice_number,
            status="skipped",
            reason="This payment reconciliation item was already applied.",
            current_status=current_status,
            proposed_status=proposed_status["status"],
            current_paid_cents=current_paid_cents,
            proposed_paid_cents=proposed_status["paid_cents"],
            outstanding_cents=proposed_status["outstanding_cents"],
            idempotency_key=idempotency_key,
            **result_context,
        )

    if (
        current_status == proposed_status["status"]
        and current_paid_cents == proposed_status["paid_cents"]
    ):
        return XeroPaymentReconciliationResultRead(
            invoice_draft_id=draft.id,
            invoice_number=draft.invoice_number,
            status="skipped",
            reason="Invoice payment status is already up to date.",
            current_status=current_status,
            proposed_status=proposed_status["status"],
            current_paid_cents=current_paid_cents,
            proposed_paid_cents=proposed_status["paid_cents"],
            outstanding_cents=proposed_status["outstanding_cents"],
            idempotency_key=idempotency_key,
            **result_context,
        )

    if not apply_changes:
        return XeroPaymentReconciliationResultRead(
            invoice_draft_id=draft.id,
            invoice_number=draft.invoice_number,
            status="ready",
            reason="Payment status can be reconciled locally.",
            current_status=current_status,
            proposed_status=proposed_status["status"],
            current_paid_cents=current_paid_cents,
            proposed_paid_cents=proposed_status["paid_cents"],
            outstanding_cents=proposed_status["outstanding_cents"],
            idempotency_key=idempotency_key,
            **result_context,
        )

    proposed_status["reconciled_by_user_id"] = str(user.id)
    metadata["payment_status"] = proposed_status
    payment_history = list(metadata.get("payment_history") or [])
    payment_history.append(proposed_status)
    metadata["payment_history"] = payment_history[-20:]
    reconciliation_entry = {
        "idempotency_key": idempotency_key,
        "invoice_draft_id": str(draft.id),
        "invoice_number": draft.invoice_number,
        "xero_invoice_id": item.xero_invoice_id,
        "provider_payment_id": item.provider_payment_id,
        "source": item.source,
        "status": proposed_status["status"],
        "paid_cents": proposed_status["paid_cents"],
        "reconciled_at": reconciled_at.isoformat(),
        "reconciled_by_user_id": str(user.id),
        "match_method": result_context["match_method"],
        "match_confidence": result_context["match_confidence"],
        "amount_delta_cents": result_context["amount_delta_cents"],
        "bank_transaction_id": item.bank_transaction_id,
        "bank_account_name": item.bank_account_name,
        "statement_date": item.statement_date.isoformat() if item.statement_date else None,
        "statement_amount_cents": item.statement_amount_cents,
        "counterparty": item.counterparty,
        "reference": item.reference,
        "guardrail_flags": result_context["guardrail_flags"],
    }
    reconciliation_history.append(reconciliation_entry)
    metadata["xero_payment_reconciliation_history"] = reconciliation_history[-20:]
    metadata["xero_payment_reconciliation"] = reconciliation_entry
    draft.invoice_metadata = metadata
    return XeroPaymentReconciliationResultRead(
        invoice_draft_id=draft.id,
        invoice_number=draft.invoice_number,
        status="applied",
        reason="Payment status was reconciled locally.",
        current_status=current_status,
        proposed_status=proposed_status["status"],
        current_paid_cents=current_paid_cents,
        proposed_paid_cents=proposed_status["paid_cents"],
        outstanding_cents=proposed_status["outstanding_cents"],
        idempotency_key=idempotency_key,
        **result_context,
    )


@router.get("/oauth/start", response_model=XeroOAuthStartRead)
def start_xero_oauth(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    entity_id: Annotated[UUID, Query()],
) -> XeroOAuthStartRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    missing_config = xero_missing_config(settings)
    scopes = xero_scopes(settings)
    redirect_uri = xero_redirect_uri(settings)
    if missing_config:
        return XeroOAuthStartRead(
            configured=False,
            authorization_url=None,
            missing_config=missing_config,
            redirect_uri=redirect_uri,
            scopes=scopes,
            state_expires_at=None,
        )
    state, expires_at = _make_state(entity.id, user.id, settings)
    return XeroOAuthStartRead(
        configured=True,
        authorization_url=xero_authorization_url(settings, state),
        missing_config=[],
        redirect_uri=redirect_uri,
        scopes=scopes,
        state_expires_at=expires_at,
    )


@router.get("/oauth/callback")
def finish_xero_oauth(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    state: Annotated[str, Query()],
    code: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    try:
        entity_id, user_id = _verify_state(state, settings)
    except HTTPException:
        return _frontend_redirect(settings, UUID(int=0), xero_error="invalid_state")

    if error:
        return _frontend_redirect(settings, entity_id, xero_error=error[:80])

    if not code:
        return _frontend_redirect(settings, entity_id, xero_error="missing_code")

    entity = session.get(Entity, entity_id)
    user = session.get(AppUser, user_id)
    if entity is None or entity.deleted_at is not None or user is None or not user.is_active:
        return _frontend_redirect(settings, entity_id, xero_error="connection_not_allowed")
    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    if role not in WRITE_ROLES:
        return _frontend_redirect(settings, entity_id, xero_error="connection_not_allowed")

    try:
        tokens = exchange_code_for_tokens(code, settings)
        access_token = _token_value(tokens, "access_token")
        connections = fetch_xero_connections(access_token, settings)
        selected_connection = _select_xero_tenant(connections, entity.xero_tenant_id)
        if selected_connection is None:
            raise XeroIntegrationError("No Xero organisation was returned.")
        provider_connection = _store_provider_connection(
            session=session,
            entity=entity,
            user=user,
            tokens=tokens,
            selected_connection=selected_connection,
            all_connections=connections,
            settings=settings,
        )
    except (XeroIntegrationError, HTTPException):
        session.rollback()
        return _frontend_redirect(settings, entity_id, xero_error="provider_connection_failed")

    audit_log(
        session,
        actor=f"user:{user.email}",
        user_id=user.id,
        entity_id=entity.id,
        action="create",
        target_table="xero_connection",
        target_id=provider_connection.id,
        tool_name="xero.oauth_callback",
        tool_input={
            "entity_id": str(entity.id),
            "xero_tenant_id": provider_connection.xero_tenant_id,
        },
        tool_output_summary=(
            "Connected Xero provider account; no contacts, invoices, or payments were mutated."
        ),
    )
    session.commit()
    return _frontend_redirect(
        settings,
        entity.id,
        xero_connected="1",
        xero_tenant_id=provider_connection.xero_tenant_id,
    )


@router.get("/connection-diagnostics", response_model=XeroConnectionDiagnosticsRead)
def xero_connection_diagnostics(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    entity_id: Annotated[UUID, Query()],
) -> XeroConnectionDiagnosticsRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    provider = _provider(settings)
    connection = _connection(entity, session, settings)
    provider_connection = _active_xero_connection(session, entity.id)
    provider_ready = provider.configured and provider_connection is not None
    can_write = _entity_role(session, user, entity.id) in WRITE_ROLES
    action_ready = provider_ready and can_write
    return XeroConnectionDiagnosticsRead(
        entity_id=entity.id,
        entity_name=entity.name,
        provider_configured=provider.configured,
        missing_config=provider.missing_config,
        redirect_uri=provider.redirect_uri,
        scopes=provider.scopes,
        provider_setup_preflight=_xero_provider_setup_preflight(provider),
        connected=connection.connected,
        connection_source=connection.connection_source,
        xero_tenant_id=connection.xero_tenant_id,
        tenant_name=connection.tenant_name,
        token_expires_at=(
            provider_connection.token_expires_at if provider_connection is not None else None
        ),
        can_start_oauth=provider.configured and can_write,
        can_preview_contacts=action_ready
        and _has_xero_scopes(provider_connection, XERO_CONTACT_PREVIEW_SCOPES),
        can_validate_chart_tax=action_ready
        and _has_xero_scopes(provider_connection, XERO_CHART_TAX_SCOPES),
        can_preview_invoice_posting=action_ready
        and _has_xero_scopes(provider_connection, XERO_INVOICE_POSTING_PREVIEW_SCOPES),
        can_create_xero_drafts=action_ready
        and _has_xero_scopes(provider_connection, XERO_INVOICE_POSTING_PREVIEW_SCOPES)
        and _has_xero_invoice_write_scope(provider_connection),
        can_preview_payment_reconciliation=action_ready
        and _has_xero_invoice_read_scope(provider_connection),
        next_steps=_xero_diagnostics_next_steps(
            provider_configured=provider.configured,
            connection_source=connection.connection_source,
        ),
        guardrails=[
            "Connection diagnostics reads local Relby configuration and database state only.",
            "Loading diagnostics does not refresh tokens, call Xero, or mutate provider state.",
            (
                "No Xero API calls, invoice posting, contact writes, "
                "or payment reconciliation run here."
            ),
        ],
    )


@router.post("/contacts/sync-preview/{entity_id}", response_model=XeroContactSyncPreviewRead)
def preview_xero_contact_sync(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> XeroContactSyncPreviewRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    provider_connection = _active_xero_connection(session, entity.id)
    if provider_connection is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Connect Xero through OAuth before previewing provider contacts.",
        )

    try:
        access_token = _refresh_provider_access_token(provider_connection, settings)
        contacts = fetch_xero_contacts(access_token, provider_connection.xero_tenant_id, settings)
    except XeroIntegrationError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    tenants = list(
        session.scalars(
            select(Tenant).where(
                Tenant.entity_id == entity.id,
                Tenant.deleted_at.is_(None),
            )
        )
    )
    properties = list(
        session.scalars(
            select(Property).where(
                Property.entity_id == entity.id,
                Property.deleted_at.is_(None),
            )
        )
    )
    matches = _match_xero_contacts(contacts=contacts, tenants=tenants, properties=properties)
    contact_options = _contact_options(contacts)
    unmatched_targets = _unmatched_contact_targets(
        tenants=tenants,
        properties=properties,
        matches=matches,
    )
    synced_at = utcnow()
    provider_connection.last_contact_sync_at = synced_at
    provider_connection.updated_by_user_id = user.id
    metadata = dict(provider_connection.connection_metadata or {})
    metadata["last_contact_sync"] = {
        "synced_at": synced_at.isoformat(),
        "fetched_contacts": len(contacts),
        "suggested_matches": len(matches),
        "mode": "preview_only",
    }
    provider_connection.connection_metadata = metadata
    entity.xero_last_sync_at = synced_at
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="read",
        target_table="xero_connection",
        target_id=provider_connection.id,
        tool_name="xero.contact_sync_preview",
        tool_input={"entity_id": str(entity.id)},
        tool_output_summary=(
            f"Fetched {len(contacts)} Xero contacts and suggested {len(matches)} local matches; "
            "no local mappings were applied."
        ),
    )
    session.commit()
    return XeroContactSyncPreviewRead(
        entity_id=entity.id,
        xero_tenant_id=provider_connection.xero_tenant_id,
        tenant_name=provider_connection.tenant_name,
        fetched_contacts=len(contacts),
        suggested_matches=matches,
        contacts=contact_options,
        unmatched_targets=unmatched_targets,
        last_contact_sync_at=synced_at,
        guardrails=[
            "This is a preview only; tenant and property Xero contact IDs were not changed.",
            "Invoice posting and payment reconciliation are still blocked behind future approvals.",
        ],
    )


@router.post("/contacts/apply-preview/{entity_id}", response_model=XeroContactMappingApplyRead)
def apply_xero_contact_mappings(
    entity_id: UUID,
    payload: XeroContactMappingApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],  # noqa: ARG001
) -> XeroContactMappingApplyRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    provider_connection = _active_xero_connection(session, entity.id)
    if provider_connection is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Connect Xero through OAuth before applying reviewed contact mappings.",
        )

    applied_at = utcnow()
    applied: list[XeroContactMappingApplyResultRead] = []
    skipped: list[XeroContactMappingApplyResultRead] = []
    seen_targets: set[tuple[str, UUID]] = set()

    for mapping in payload.mappings:
        target_key = (mapping.target_type, mapping.target_id)
        xero_contact_id = mapping.xero_contact_id.strip()
        xero_contact_name = mapping.xero_contact_name.strip()
        if target_key in seen_targets:
            skipped.append(
                _contact_mapping_result(
                    mapping,
                    target_name=xero_contact_name or "Duplicate target",
                    previous_xero_contact_id=None,
                    status_label="skipped",
                    reason="Duplicate reviewed mapping for this target was ignored.",
                )
            )
            continue
        seen_targets.add(target_key)
        if not xero_contact_id or not xero_contact_name:
            skipped.append(
                _contact_mapping_result(
                    mapping,
                    target_name=xero_contact_name or "Xero contact",
                    previous_xero_contact_id=None,
                    status_label="skipped",
                    reason="Xero contact ID and name are required.",
                )
            )
            continue

        if mapping.target_type == "tenant":
            tenant = session.get(Tenant, mapping.target_id)
            if tenant is None or tenant.deleted_at is not None or tenant.entity_id != entity.id:
                skipped.append(
                    _contact_mapping_result(
                        mapping,
                        target_name="Unknown tenant",
                        previous_xero_contact_id=None,
                        status_label="skipped",
                        reason="Tenant was not found in this entity.",
                    )
                )
                continue

            metadata = dict(tenant.tenant_metadata or {})
            current_value = metadata.get("xero_contact_id")
            current_contact_id = (
                current_value.strip() if isinstance(current_value, str) and current_value else None
            )
            tenant_name = _tenant_name(tenant) or tenant.legal_name
            if current_contact_id and current_contact_id != xero_contact_id:
                skipped.append(
                    _contact_mapping_result(
                        mapping,
                        target_name=tenant_name,
                        previous_xero_contact_id=current_contact_id,
                        status_label="skipped",
                        reason="Tenant already has a different Xero contact mapping.",
                    )
                )
                continue
            if current_contact_id == xero_contact_id:
                skipped.append(
                    _contact_mapping_result(
                        mapping,
                        target_name=tenant_name,
                        previous_xero_contact_id=current_contact_id,
                        status_label="skipped",
                        reason="Tenant is already mapped to this Xero contact.",
                    )
                )
                continue

            metadata["xero_contact_id"] = xero_contact_id
            metadata["xero_contact_mapping"] = _contact_mapping_metadata(mapping, user, applied_at)
            tenant.tenant_metadata = metadata
            applied.append(
                _contact_mapping_result(
                    mapping,
                    target_name=tenant_name,
                    previous_xero_contact_id=None,
                    status_label="applied",
                    reason="Reviewed tenant mapping was saved locally.",
                )
            )
            continue

        prop = session.get(Property, mapping.target_id)
        if prop is None or prop.deleted_at is not None or prop.entity_id != entity.id:
            skipped.append(
                _contact_mapping_result(
                    mapping,
                    target_name="Unknown property",
                    previous_xero_contact_id=None,
                    status_label="skipped",
                    reason="Property was not found in this entity.",
                )
            )
            continue

        current_contact_id = prop.xero_contact_id.strip() if prop.xero_contact_id else None
        if current_contact_id and current_contact_id != xero_contact_id:
            skipped.append(
                _contact_mapping_result(
                    mapping,
                    target_name=prop.name,
                    previous_xero_contact_id=current_contact_id,
                    status_label="skipped",
                    reason="Property already has a different Xero contact mapping.",
                )
            )
            continue
        if current_contact_id == xero_contact_id:
            skipped.append(
                _contact_mapping_result(
                    mapping,
                    target_name=prop.name,
                    previous_xero_contact_id=current_contact_id,
                    status_label="skipped",
                    reason="Property is already mapped to this Xero contact.",
                )
            )
            continue

        prop.xero_contact_id = xero_contact_id
        property_metadata = dict(prop.property_metadata or {})
        property_metadata["xero_contact_mapping"] = _contact_mapping_metadata(
            mapping,
            user,
            applied_at,
        )
        prop.property_metadata = property_metadata
        applied.append(
            _contact_mapping_result(
                mapping,
                target_name=prop.name,
                previous_xero_contact_id=None,
                status_label="applied",
                reason="Reviewed property mapping was saved locally.",
            )
        )

    connection_metadata = dict(provider_connection.connection_metadata or {})
    connection_metadata["last_contact_apply"] = {
        "applied_at": applied_at.isoformat(),
        "requested_mappings": len(payload.mappings),
        "applied_mappings": len(applied),
        "skipped_mappings": len(skipped),
        "mode": "local_mapping_apply",
    }
    provider_connection.connection_metadata = connection_metadata
    provider_connection.updated_by_user_id = user.id
    entity.xero_last_sync_at = applied_at

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="apply",
        target_table="xero_connection",
        target_id=provider_connection.id,
        tool_name="xero.contact_mapping_apply",
        tool_input={"entity_id": str(entity.id), "requested_mappings": len(payload.mappings)},
        tool_output_summary=(
            f"Applied {len(applied)} reviewed Xero contact mappings locally; "
            f"skipped {len(skipped)}; no Xero contacts, invoices, or payments were mutated."
        ),
    )
    session.commit()
    return XeroContactMappingApplyRead(
        entity_id=entity.id,
        applied_mappings=applied,
        skipped_mappings=skipped,
        applied_at=applied_at,
        guardrails=[
            "Only selected reviewed tenant/property Xero contact IDs were saved locally.",
            "No Xero contacts, invoices, payments, or accounting records were created or changed.",
            "Existing conflicting mappings were skipped instead of overwritten.",
        ],
    )


@router.post(
    "/chart-tax/validate-preview/{entity_id}",
    response_model=XeroChartTaxValidationPreviewRead,
)
def validate_xero_chart_tax_preview(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> XeroChartTaxValidationPreviewRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    provider_connection = _active_xero_connection(session, entity.id)
    if provider_connection is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Connect Xero through OAuth before validating chart and tax mappings.",
        )

    try:
        access_token = _refresh_provider_access_token(provider_connection, settings)
        accounts = fetch_xero_accounts(access_token, provider_connection.xero_tenant_id, settings)
        tax_rates = fetch_xero_tax_rates(
            access_token,
            provider_connection.xero_tenant_id,
            settings,
        )
    except XeroIntegrationError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    charge_rows = _charge_rule_rows(session, entity.id)
    results = _validate_xero_chart_tax(
        charge_rows=charge_rows,
        accounts=accounts,
        tax_rates=tax_rates,
    )
    validated_at = utcnow()
    provider_connection.updated_by_user_id = user.id
    connection_metadata = dict(provider_connection.connection_metadata or {})
    connection_metadata["last_chart_tax_validation"] = {
        "validated_at": validated_at.isoformat(),
        "fetched_accounts": len(accounts),
        "fetched_tax_rates": len(tax_rates),
        "checked_rules": len(charge_rows),
        "ready": sum(1 for result in results if result.status == "ready"),
        "needs_mapping": sum(1 for result in results if result.status == "needs_mapping"),
        "not_found": sum(1 for result in results if result.status == "not_found"),
        "mode": "preview_only",
    }
    provider_connection.connection_metadata = connection_metadata
    entity.xero_last_sync_at = validated_at

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="read",
        target_table="xero_connection",
        target_id=provider_connection.id,
        tool_name="xero.chart_tax_validation_preview",
        tool_input={"entity_id": str(entity.id)},
        tool_output_summary=(
            f"Validated {len(charge_rows)} charge-rule chart/tax mappings against Xero; "
            "no invoice posting, Xero mutation, or payment reconciliation was run."
        ),
    )
    account_options = [
        XeroAccountOptionRead(
            code=code,
            name=_xero_account_name(account),
            type=_xero_text(account, "Type"),
            account_class=_xero_account_class(account),
            status=_xero_text(account, "Status"),
        )
        for account in accounts
        if (code := _xero_account_code(account)) is not None
    ]
    tax_options = [
        XeroTaxRateOptionRead(
            tax_type=tax_type,
            name=_xero_text(tax_rate, "Name"),
            status=_xero_text(tax_rate, "Status"),
        )
        for tax_rate in tax_rates
        if (tax_type := _xero_tax_type(tax_rate)) is not None
    ]
    session.commit()
    return XeroChartTaxValidationPreviewRead(
        entity_id=entity.id,
        xero_tenant_id=provider_connection.xero_tenant_id,
        tenant_name=provider_connection.tenant_name,
        fetched_accounts=len(accounts),
        fetched_tax_rates=len(tax_rates),
        checked_rules=len(charge_rows),
        results=results,
        accounts=account_options,
        tax_rates=tax_options,
        validated_at=validated_at,
        guardrails=[
            "This is a provider-backed validation preview only.",
            "Relby only checks whether local account codes and tax types exist in Xero.",
            "No invoice posting, Xero mutation, tenant email, or payment reconciliation was run.",
        ],
    )


def _chart_tax_mapping_metadata(
    item: XeroChartTaxMappingApplyItem,
    user: CurrentUser,
    applied_at: Any,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "source": (item.source or "xero_chart_tax_preview").strip(),
        "applied_at": applied_at.isoformat(),
        "applied_by_user_id": str(user.id),
    }
    if item.account_code and item.account_code.strip():
        metadata["account_code"] = item.account_code.strip()
    if item.tax_type and item.tax_type.strip():
        metadata["tax_type"] = item.tax_type.strip()
    if item.confidence is not None:
        metadata["confidence"] = item.confidence
    return metadata


def _chart_tax_mapping_result(
    *,
    charge_rule_id: UUID,
    charge_type: str,
    property_name: str,
    unit_label: str,
    previous_account_code: str | None,
    previous_tax_type: str | None,
    account_code: str | None,
    tax_type: str | None,
    status_label: Literal["applied", "skipped"],
    reason: str,
) -> XeroChartTaxMappingApplyResultRead:
    return XeroChartTaxMappingApplyResultRead(
        charge_rule_id=charge_rule_id,
        charge_type=charge_type,
        property_name=property_name,
        unit_label=unit_label,
        previous_account_code=previous_account_code,
        previous_tax_type=previous_tax_type,
        account_code=account_code,
        tax_type=tax_type,
        status=status_label,
        reason=reason,
    )


@router.post(
    "/chart-tax/apply-preview/{entity_id}",
    response_model=XeroChartTaxMappingApplyRead,
)
def apply_xero_chart_tax_mappings(
    entity_id: UUID,
    payload: XeroChartTaxMappingApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],  # noqa: ARG001
) -> XeroChartTaxMappingApplyRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    provider_connection = _active_xero_connection(session, entity.id)
    if provider_connection is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Connect Xero through OAuth before applying reviewed chart and tax mappings.",
        )

    rows_by_rule_id = {row[0].id: row for row in _charge_rule_rows(session, entity.id)}
    applied_at = utcnow()
    applied: list[XeroChartTaxMappingApplyResultRead] = []
    skipped: list[XeroChartTaxMappingApplyResultRead] = []
    seen_rules: set[UUID] = set()

    for item in payload.mappings:
        account_code = item.account_code.strip() if item.account_code else None
        tax_type = item.tax_type.strip() if item.tax_type else None
        row = rows_by_rule_id.get(item.charge_rule_id)
        if row is None:
            skipped.append(
                _chart_tax_mapping_result(
                    charge_rule_id=item.charge_rule_id,
                    charge_type="unknown",
                    property_name="Unknown property",
                    unit_label="",
                    previous_account_code=None,
                    previous_tax_type=None,
                    account_code=account_code,
                    tax_type=tax_type,
                    status_label="skipped",
                    reason="Charge rule was not found in this entity.",
                )
            )
            continue
        rule, _lease, unit, prop, _tenant = row
        previous_account_code = rule.xero_account_code.strip() if rule.xero_account_code else None
        previous_tax_type = rule.xero_tax_type.strip() if rule.xero_tax_type else None

        if item.charge_rule_id in seen_rules:
            skipped.append(
                _chart_tax_mapping_result(
                    charge_rule_id=rule.id,
                    charge_type=rule.charge_type.value,
                    property_name=prop.name,
                    unit_label=unit.unit_label,
                    previous_account_code=previous_account_code,
                    previous_tax_type=previous_tax_type,
                    account_code=account_code,
                    tax_type=tax_type,
                    status_label="skipped",
                    reason="Duplicate reviewed mapping for this charge rule was ignored.",
                )
            )
            continue
        seen_rules.add(item.charge_rule_id)

        if not account_code:
            skipped.append(
                _chart_tax_mapping_result(
                    charge_rule_id=rule.id,
                    charge_type=rule.charge_type.value,
                    property_name=prop.name,
                    unit_label=unit.unit_label,
                    previous_account_code=previous_account_code,
                    previous_tax_type=previous_tax_type,
                    account_code=None,
                    tax_type=tax_type,
                    status_label="skipped",
                    reason="An account code is required to apply this mapping.",
                )
            )
            continue

        if previous_account_code == account_code and previous_tax_type == tax_type:
            skipped.append(
                _chart_tax_mapping_result(
                    charge_rule_id=rule.id,
                    charge_type=rule.charge_type.value,
                    property_name=prop.name,
                    unit_label=unit.unit_label,
                    previous_account_code=previous_account_code,
                    previous_tax_type=previous_tax_type,
                    account_code=account_code,
                    tax_type=tax_type,
                    status_label="skipped",
                    reason="Charge rule already uses this account code and tax type.",
                )
            )
            continue

        rule.xero_account_code = account_code
        rule.xero_tax_type = tax_type
        rule_metadata = dict(rule.charge_rule_metadata or {})
        rule_metadata["xero_chart_tax_mapping"] = _chart_tax_mapping_metadata(
            item,
            user,
            applied_at,
        )
        rule.charge_rule_metadata = rule_metadata
        applied.append(
            _chart_tax_mapping_result(
                charge_rule_id=rule.id,
                charge_type=rule.charge_type.value,
                property_name=prop.name,
                unit_label=unit.unit_label,
                previous_account_code=previous_account_code,
                previous_tax_type=previous_tax_type,
                account_code=account_code,
                tax_type=tax_type,
                status_label="applied",
                reason="Reviewed chart and tax mapping was saved locally.",
            )
        )

    connection_metadata = dict(provider_connection.connection_metadata or {})
    connection_metadata["last_chart_tax_apply"] = {
        "applied_at": applied_at.isoformat(),
        "requested_mappings": len(payload.mappings),
        "applied_mappings": len(applied),
        "skipped_mappings": len(skipped),
        "mode": "local_mapping_apply",
    }
    provider_connection.connection_metadata = connection_metadata
    provider_connection.updated_by_user_id = user.id
    entity.xero_last_sync_at = applied_at

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="apply",
        target_table="xero_connection",
        target_id=provider_connection.id,
        tool_name="xero.chart_tax_mapping_apply",
        tool_input={"entity_id": str(entity.id), "requested_mappings": len(payload.mappings)},
        tool_output_summary=(
            f"Applied {len(applied)} reviewed Xero chart/tax mappings to charge rules locally; "
            f"skipped {len(skipped)}; no Xero accounts, invoices, or payments were mutated."
        ),
    )
    session.commit()
    return XeroChartTaxMappingApplyRead(
        entity_id=entity.id,
        applied_mappings=applied,
        skipped_mappings=skipped,
        applied_at=applied_at,
        guardrails=[
            "Only reviewed charge-rule account codes and tax types were saved locally.",
            "No Xero accounts, tax rates, invoices, or payments were created or changed.",
            "Account codes and tax types are checked against Xero only in the validate preview.",
        ],
    )


@router.post(
    "/invoices/posting-preview/{entity_id}",
    response_model=XeroInvoicePostingPreviewRead,
)
def preview_xero_invoice_posting(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> XeroInvoicePostingPreviewRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    provider_connection = _active_xero_connection(session, entity.id)
    if provider_connection is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Connect Xero through OAuth before previewing invoice posting.",
        )

    try:
        access_token = _refresh_provider_access_token(provider_connection, settings)
        contacts = fetch_xero_contacts(access_token, provider_connection.xero_tenant_id, settings)
        accounts = fetch_xero_accounts(access_token, provider_connection.xero_tenant_id, settings)
        tax_rates = fetch_xero_tax_rates(
            access_token,
            provider_connection.xero_tenant_id,
            settings,
        )
    except XeroIntegrationError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    contacts_by_id = {
        contact_id: contact
        for contact in contacts
        if (contact_id := _contact_id(contact)) is not None
    }
    accounts_by_code = {
        code: account
        for account in accounts
        if (code := _xero_account_code(account)) is not None
    }
    tax_rates_by_type = {
        tax_type.upper(): tax_rate
        for tax_rate in tax_rates
        if (tax_type := _xero_tax_type(tax_rate)) is not None
    }
    invoice_drafts = _approved_unsynced_invoice_drafts(session, entity.id)
    results = [
        _xero_invoice_posting_result(
            draft=draft,
            session=session,
            contacts_by_id=contacts_by_id,
            accounts_by_code=accounts_by_code,
            tax_rates_by_type=tax_rates_by_type,
        )
        for draft in invoice_drafts
    ]
    prepared_at = utcnow()
    provider_connection.updated_by_user_id = user.id
    connection_metadata = dict(provider_connection.connection_metadata or {})
    connection_metadata["last_invoice_posting_preview"] = {
        "prepared_at": prepared_at.isoformat(),
        "checked_invoices": len(results),
        "ready": sum(1 for result in results if result.status == "ready"),
        "blocked": sum(1 for result in results if result.status == "blocked"),
        "fetched_contacts": len(contacts),
        "fetched_accounts": len(accounts),
        "fetched_tax_rates": len(tax_rates),
        "mode": "preview_only",
    }
    provider_connection.connection_metadata = connection_metadata
    entity.xero_last_sync_at = prepared_at

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="read",
        target_table="xero_connection",
        target_id=provider_connection.id,
        tool_name="xero.invoice_posting_preview",
        tool_input={"entity_id": str(entity.id)},
        tool_output_summary=(
            f"Prepared Xero posting preview for {len(results)} approved invoice draft(s); "
            "no invoice posting, Xero mutation, tenant email, or payment reconciliation was run."
        ),
    )
    session.commit()
    return XeroInvoicePostingPreviewRead(
        entity_id=entity.id,
        xero_tenant_id=provider_connection.xero_tenant_id,
        tenant_name=provider_connection.tenant_name,
        checked_invoices=len(results),
        ready_count=sum(1 for result in results if result.status == "ready"),
        blocked_count=sum(1 for result in results if result.status == "blocked"),
        results=results,
        prepared_at=prepared_at,
        guardrails=[
            "This is a provider-backed invoice posting preview only.",
            "Relby builds the draft Xero payload and blocker list for approved invoice drafts.",
            (
                "No invoices are posted, no Xero records are mutated, no tenant email is "
                "sent, and no payment reconciliation is run."
            ),
        ],
    )


@router.post(
    "/invoices/{invoice_draft_id}/posting-approval",
    response_model=XeroInvoicePostingApprovalRead,
)
def approve_xero_invoice_posting(
    invoice_draft_id: UUID,
    payload: XeroInvoicePostingApprovalRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> XeroInvoicePostingApprovalRead:
    draft = _invoice_draft_for_xero_access(invoice_draft_id, user, session, WRITE_ROLES)
    metadata = dict(draft.invoice_metadata or {})
    existing_xero_invoice_id = _xero_invoice_id_from_metadata(metadata)
    if existing_xero_invoice_id:
        return XeroInvoicePostingApprovalRead(
            invoice_draft_id=draft.id,
            invoice_number=draft.invoice_number,
            status="skipped",
            approval_state="already_posted",
            xero_sync_allowed=False,
            external_posting_status="draft_created",
            approved_at=None,
            idempotency_key=_xero_draft_create_key(draft, payload.idempotency_key),
            reason="Invoice draft already has a Xero draft reference.",
            guardrails=[
                "No Xero mutation was run by the approval endpoint.",
                "Existing Xero draft references are treated as idempotent completion.",
            ],
        )
    if draft.status != InvoiceDraftStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approve the invoice draft before approving Xero draft posting.",
        )

    approved_at = utcnow()
    approval_key = _xero_posting_approval_key(draft, payload.idempotency_key)
    draft_create_key = _xero_draft_create_key(draft, payload.idempotency_key)
    posting_preparation = dict(metadata.get("posting_preparation") or {})
    history = list(metadata.get("xero_posting_approval_history") or [])

    if payload.approved:
        current_approval = metadata.get("xero_posting_approval")
        if (
            isinstance(current_approval, dict)
            and current_approval.get("state") == "approved"
            and current_approval.get("approved") is True
        ):
            return XeroInvoicePostingApprovalRead(
                invoice_draft_id=draft.id,
                invoice_number=draft.invoice_number,
                status="skipped",
                approval_state="approved",
                xero_sync_allowed=True,
                external_posting_status=str(
                    posting_preparation.get("external_posting_status")
                    or "approved_pending_xero_draft"
                ),
                approved_at=approved_at,
                idempotency_key=_metadata_text(current_approval, "draft_create_idempotency_key"),
                reason="Xero draft posting was already explicitly approved.",
                guardrails=[
                    "No Xero mutation was run by the approval endpoint.",
                    "Run Xero draft creation separately to use this approval.",
                ],
            )
        approval_state = {
            "state": "approved",
            "approved": True,
            "approved_at": approved_at.isoformat(),
            "approved_by_user_id": str(user.id),
            "approval_idempotency_key": approval_key,
            "draft_create_idempotency_key": draft_create_key,
            "notes": payload.notes,
            "guardrail": "This local approval is required before creating a Xero draft.",
        }
        metadata["xero_posting_approval"] = approval_state
        history.append(approval_state)
        posting_preparation.update(
            {
                "approval_required": True,
                "xero_posting_approval_state": "approved",
                "xero_sync_allowed": True,
                "xero_sync_requested": True,
                "external_posting_status": "approved_pending_xero_draft",
                "guardrail": (
                    "Xero draft creation still runs only from the explicit create endpoint."
                ),
            }
        )
        status_label: Literal["approved", "revoked", "skipped"] = "approved"
        approval_state_label: Literal["approved", "revoked", "already_posted"] = "approved"
        reason = "Xero draft posting was explicitly approved locally."
    else:
        approval_state = {
            "state": "revoked",
            "approved": False,
            "revoked_at": approved_at.isoformat(),
            "revoked_by_user_id": str(user.id),
            "approval_idempotency_key": approval_key,
            "notes": payload.notes,
        }
        metadata["xero_posting_approval"] = approval_state
        history.append(approval_state)
        posting_preparation.update(
            {
                "approval_required": True,
                "xero_posting_approval_state": "revoked",
                "xero_sync_allowed": False,
                "xero_sync_requested": False,
                "external_posting_status": "approval_revoked",
                "guardrail": "Xero draft creation is blocked until approval is granted again.",
            }
        )
        status_label = "revoked"
        approval_state_label = "revoked"
        reason = "Xero draft posting approval was revoked locally."

    metadata["xero_posting_approval_history"] = history[-20:]
    metadata["posting_preparation"] = posting_preparation
    draft.invoice_metadata = metadata
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="approve" if payload.approved else "update",
        target_table="invoice_draft",
        target_id=draft.id,
        tool_name="xero.invoice_posting_approval",
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary=(
            "Recorded explicit local Xero draft posting approval; no Xero mutation was run."
            if payload.approved
            else "Revoked local Xero draft posting approval; no Xero mutation was run."
        ),
    )
    session.commit()
    session.refresh(draft)
    return XeroInvoicePostingApprovalRead(
        invoice_draft_id=draft.id,
        invoice_number=draft.invoice_number,
        status=status_label,
        approval_state=approval_state_label,
        xero_sync_allowed=bool(posting_preparation.get("xero_sync_allowed")),
        external_posting_status=str(posting_preparation.get("external_posting_status")),
        approved_at=approved_at if payload.approved else None,
        idempotency_key=draft_create_key if payload.approved else None,
        reason=reason,
        guardrails=[
            "This endpoint only records local posting approval.",
            "No Xero invoice is created until the separate draft creation endpoint is called.",
            "Draft creation still requires an active configured provider connection.",
        ],
    )


@router.post(
    "/invoices/draft-create/{entity_id}",
    response_model=XeroInvoiceDraftCreateRead,
)
def create_approved_xero_invoice_drafts(
    entity_id: UUID,
    payload: XeroInvoiceDraftCreateRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> XeroInvoiceDraftCreateRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    if payload.invoice_draft_ids:
        drafts = list(
            session.scalars(
                select(InvoiceDraft).where(
                    InvoiceDraft.id.in_(payload.invoice_draft_ids),
                    InvoiceDraft.entity_id == entity.id,
                    InvoiceDraft.deleted_at.is_(None),
                )
            )
        )
        if len({draft.id for draft in drafts}) != len(set(payload.invoice_draft_ids)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more invoice drafts were not found for this entity.",
            )
    else:
        drafts = _approved_unsynced_invoice_drafts(session, entity.id)

    applied_at = utcnow()
    provider_configured = xero_provider_configured(settings)
    provider_connection = _active_xero_connection(session, entity.id)
    results: list[XeroInvoiceDraftCreateResultRead] = []
    candidates: list[InvoiceDraft] = []

    for draft in sorted(
        drafts,
        key=lambda item: (item.due_date or item.created_at.date(), item.id),
    ):
        metadata = draft.invoice_metadata or {}
        existing_xero_invoice_id = _xero_invoice_id_from_metadata(metadata)
        if existing_xero_invoice_id:
            results.append(
                _draft_create_result(
                    draft,
                    status_label="skipped",
                    reason="Invoice draft already has a Xero draft reference.",
                    external_posting_status="draft_created",
                    idempotency_key=_xero_draft_create_key(draft, payload.idempotency_key),
                    xero_invoice_id=existing_xero_invoice_id,
                    xero_status=_metadata_text(_xero_sync_state(metadata), "xero_status"),
                )
            )
            continue
        if draft.status != InvoiceDraftStatus.approved:
            results.append(
                _draft_create_result(
                    draft,
                    status_label="blocked",
                    reason="Invoice draft must be approved before Xero draft creation.",
                    external_posting_status="blocked",
                )
            )
            continue
        if not _xero_posting_approved(metadata):
            results.append(
                _draft_create_result(
                    draft,
                    status_label="blocked",
                    reason="Explicit Xero posting approval is required before any Xero mutation.",
                    external_posting_status="approval_required",
                )
            )
            continue
        candidates.append(draft)

    if candidates and (not provider_configured or provider_connection is None):
        reason = (
            "Xero provider credentials are not configured; no external call was attempted."
            if not provider_configured
            else "Xero provider connection is not active; no external call was attempted."
        )
        for draft in candidates:
            results.append(
                _draft_create_result(
                    draft,
                    status_label="skipped",
                    reason=reason,
                    external_posting_status="provider_unconfigured"
                    if not provider_configured
                    else "provider_not_connected",
                    idempotency_key=_xero_draft_create_key(draft, payload.idempotency_key),
                )
            )
        candidates = []

    if candidates and provider_connection is not None:
        try:
            access_token = _refresh_provider_access_token(provider_connection, settings)
            contacts = fetch_xero_contacts(
                access_token,
                provider_connection.xero_tenant_id,
                settings,
            )
            accounts = fetch_xero_accounts(
                access_token,
                provider_connection.xero_tenant_id,
                settings,
            )
            tax_rates = fetch_xero_tax_rates(
                access_token,
                provider_connection.xero_tenant_id,
                settings,
            )
        except XeroIntegrationError as exc:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

        contacts_by_id = {
            contact_id: contact
            for contact in contacts
            if (contact_id := _contact_id(contact)) is not None
        }
        accounts_by_code = {
            code: account
            for account in accounts
            if (code := _xero_account_code(account)) is not None
        }
        tax_rates_by_type = {
            tax_type.upper(): tax_rate
            for tax_rate in tax_rates
            if (tax_type := _xero_tax_type(tax_rate)) is not None
        }
        for draft in candidates:
            preview = _xero_invoice_posting_result(
                draft=draft,
                session=session,
                contacts_by_id=contacts_by_id,
                accounts_by_code=accounts_by_code,
                tax_rates_by_type=tax_rates_by_type,
            )
            idempotency_key = _xero_draft_create_key(draft, payload.idempotency_key)
            if preview.status == "blocked":
                results.append(
                    _draft_create_result(
                        draft,
                        status_label="blocked",
                        reason=" ".join(preview.blockers),
                        external_posting_status="preview_blocked",
                        idempotency_key=idempotency_key,
                    )
                )
                continue
            try:
                created_invoice = create_xero_invoice_draft(
                    access_token,
                    provider_connection.xero_tenant_id,
                    preview.payload_preview,
                    settings,
                    idempotency_key=idempotency_key,
                )
            except XeroIntegrationError as exc:
                _record_xero_provider_receipt(
                    draft=draft,
                    status_label="failed",
                    reason=str(exc),
                    external_posting_status="provider_failed",
                    idempotency_key=idempotency_key,
                    attempted_at=applied_at,
                    user=user,
                    provider_connection=provider_connection,
                )
                results.append(
                    _draft_create_result(
                        draft,
                        status_label="failed",
                        reason=str(exc),
                        external_posting_status="provider_failed",
                        idempotency_key=idempotency_key,
                    )
                )
                continue
            xero_invoice_id, xero_status = _store_xero_draft_create_result(
                draft=draft,
                created_invoice=created_invoice,
                provider_connection=provider_connection,
                user=user,
                idempotency_key=idempotency_key,
                created_at=applied_at,
            )
            _record_xero_provider_receipt(
                draft=draft,
                status_label="created",
                reason="Xero draft invoice was created after explicit approval.",
                external_posting_status="draft_created",
                idempotency_key=idempotency_key,
                attempted_at=applied_at,
                user=user,
                provider_connection=provider_connection,
                xero_invoice_id=xero_invoice_id,
                xero_status=xero_status,
            )
            results.append(
                _draft_create_result(
                    draft,
                    status_label="created",
                    reason="Xero draft invoice was created after explicit approval.",
                    external_posting_status="draft_created",
                    idempotency_key=idempotency_key,
                    xero_invoice_id=xero_invoice_id,
                    xero_status=xero_status,
                )
            )

    if provider_connection is not None:
        connection_metadata = dict(provider_connection.connection_metadata or {})
        connection_metadata["last_invoice_draft_create"] = {
            "applied_at": applied_at.isoformat(),
            "checked_invoices": len(drafts),
            "created": sum(1 for result in results if result.status == "created"),
            "skipped": sum(1 for result in results if result.status == "skipped"),
            "blocked": sum(1 for result in results if result.status == "blocked"),
            "failed": sum(1 for result in results if result.status == "failed"),
            "mode": "explicit_approved_draft_create",
        }
        provider_connection.connection_metadata = connection_metadata
        provider_connection.updated_by_user_id = user.id
    entity.xero_last_sync_at = applied_at
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="apply",
        target_table="xero_connection" if provider_connection is not None else "entity",
        target_id=provider_connection.id if provider_connection is not None else entity.id,
        tool_name="xero.invoice_draft_create",
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary=(
            f"Xero draft creation checked {len(drafts)} invoice draft(s); "
            f"created {sum(1 for result in results if result.status == 'created')}, "
            f"skipped {sum(1 for result in results if result.status == 'skipped')}, "
            f"blocked {sum(1 for result in results if result.status == 'blocked')}, "
            f"failed {sum(1 for result in results if result.status == 'failed')}; "
            "no tenant email or payment reconciliation was run."
        ),
    )
    session.commit()
    return XeroInvoiceDraftCreateRead(
        entity_id=entity.id,
        provider_configured=provider_configured,
        provider_connection_id=provider_connection.id if provider_connection else None,
        xero_tenant_id=provider_connection.xero_tenant_id if provider_connection else None,
        checked_invoices=len(drafts),
        created_count=sum(1 for result in results if result.status == "created"),
        skipped_count=sum(1 for result in results if result.status == "skipped"),
        blocked_count=sum(1 for result in results if result.status == "blocked"),
        failed_count=sum(1 for result in results if result.status == "failed"),
        results=results,
        applied_at=applied_at,
        guardrails=[
            (
                "Xero draft creation only runs for invoice drafts with explicit local "
                "posting approval."
            ),
            (
                "When provider credentials or provider connection are absent, invoices "
                "are skipped safely."
            ),
            (
                "Successful Xero draft references are stored locally and repeated calls "
                "are idempotent."
            ),
        ],
    )


@router.post(
    "/invoices/provider-dispatch/{entity_id}",
    response_model=XeroInvoiceProviderDispatchRead,
)
def dispatch_approved_invoice_providers(
    entity_id: UUID,
    payload: XeroInvoiceProviderDispatchRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> XeroInvoiceProviderDispatchRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    if payload.invoice_draft_ids:
        drafts = list(
            session.scalars(
                select(InvoiceDraft).where(
                    InvoiceDraft.id.in_(payload.invoice_draft_ids),
                    InvoiceDraft.entity_id == entity.id,
                    InvoiceDraft.deleted_at.is_(None),
                )
            )
        )
        if len({draft.id for draft in drafts}) != len(set(payload.invoice_draft_ids)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more invoice drafts were not found for this entity.",
            )
    else:
        drafts = list(
            session.scalars(
                select(InvoiceDraft)
                .where(
                    InvoiceDraft.entity_id == entity.id,
                    InvoiceDraft.status == InvoiceDraftStatus.approved,
                    InvoiceDraft.deleted_at.is_(None),
                )
                .order_by(InvoiceDraft.due_date, InvoiceDraft.created_at)
            )
        )

    dispatched_at = utcnow()
    provider_configured = xero_provider_configured(settings)
    provider_connection = _active_xero_connection(session, entity.id)
    ordered_drafts = sorted(
        drafts,
        key=lambda item: (item.due_date or item.created_at.date(), item.id),
    )
    xero_outcomes: dict[
        UUID,
        tuple[
            Literal["created", "reused", "skipped", "blocked", "failed"],
            str,
            str | None,
            str | None,
            str | None,
        ],
    ] = {}
    candidates: list[InvoiceDraft] = []

    for draft in ordered_drafts:
        metadata = draft.invoice_metadata or {}
        existing_xero_invoice_id = _xero_invoice_id_from_metadata(metadata)
        if existing_xero_invoice_id:
            xero_outcomes[draft.id] = (
                "reused",
                "Invoice draft already has a Xero draft reference.",
                existing_xero_invoice_id,
                _metadata_text(_xero_sync_state(metadata), "xero_status"),
                _metadata_text(_xero_sync_state(metadata), "idempotency_key"),
            )
            continue
        if draft.status != InvoiceDraftStatus.approved:
            xero_outcomes[draft.id] = (
                "blocked",
                "Invoice draft must be approved before provider dispatch.",
                None,
                None,
                None,
            )
            continue
        if not _xero_posting_approved(metadata):
            xero_outcomes[draft.id] = (
                "blocked",
                "Explicit Xero posting approval is required before provider dispatch.",
                None,
                None,
                None,
            )
            continue
        candidates.append(draft)

    if candidates and (not provider_configured or provider_connection is None):
        reason = (
            "Xero provider credentials are not configured; no external call was attempted."
            if not provider_configured
            else "Xero provider connection is not active; no external call was attempted."
        )
        for draft in candidates:
            xero_outcomes[draft.id] = (
                "skipped",
                reason,
                None,
                None,
                _xero_draft_create_key(draft, payload.idempotency_key),
            )
        candidates = []

    if candidates and provider_connection is not None:
        try:
            access_token = _refresh_provider_access_token(provider_connection, settings)
            contacts = fetch_xero_contacts(
                access_token,
                provider_connection.xero_tenant_id,
                settings,
            )
            accounts = fetch_xero_accounts(
                access_token,
                provider_connection.xero_tenant_id,
                settings,
            )
            tax_rates = fetch_xero_tax_rates(
                access_token,
                provider_connection.xero_tenant_id,
                settings,
            )
        except XeroIntegrationError as exc:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

        contacts_by_id = {
            contact_id: contact
            for contact in contacts
            if (contact_id := _contact_id(contact)) is not None
        }
        accounts_by_code = {
            code: account
            for account in accounts
            if (code := _xero_account_code(account)) is not None
        }
        tax_rates_by_type = {
            tax_type.upper(): tax_rate
            for tax_rate in tax_rates
            if (tax_type := _xero_tax_type(tax_rate)) is not None
        }
        for draft in candidates:
            preview = _xero_invoice_posting_result(
                draft=draft,
                session=session,
                contacts_by_id=contacts_by_id,
                accounts_by_code=accounts_by_code,
                tax_rates_by_type=tax_rates_by_type,
            )
            idempotency_key = _xero_draft_create_key(draft, payload.idempotency_key)
            if preview.status == "blocked":
                xero_outcomes[draft.id] = (
                    "blocked",
                    " ".join(preview.blockers),
                    None,
                    "preview_blocked",
                    idempotency_key,
                )
                continue
            try:
                created_invoice = create_xero_invoice_draft(
                    access_token,
                    provider_connection.xero_tenant_id,
                    preview.payload_preview,
                    settings,
                    idempotency_key=idempotency_key,
                )
            except XeroIntegrationError as exc:
                _record_xero_provider_receipt(
                    draft=draft,
                    status_label="failed",
                    reason=str(exc),
                    external_posting_status="provider_failed",
                    idempotency_key=idempotency_key,
                    attempted_at=dispatched_at,
                    user=user,
                    provider_connection=provider_connection,
                )
                xero_outcomes[draft.id] = (
                    "failed",
                    str(exc),
                    None,
                    "provider_failed",
                    idempotency_key,
                )
                continue
            xero_invoice_id, xero_status = _store_xero_draft_create_result(
                draft=draft,
                created_invoice=created_invoice,
                provider_connection=provider_connection,
                user=user,
                idempotency_key=idempotency_key,
                created_at=dispatched_at,
            )
            _record_xero_provider_receipt(
                draft=draft,
                status_label="created",
                reason="Xero draft invoice was created after explicit approval.",
                external_posting_status="draft_created",
                idempotency_key=idempotency_key,
                attempted_at=dispatched_at,
                user=user,
                provider_connection=provider_connection,
                xero_invoice_id=xero_invoice_id,
                xero_status=xero_status,
            )
            xero_outcomes[draft.id] = (
                "created",
                "Xero draft invoice was created after explicit approval.",
                xero_invoice_id,
                xero_status,
                idempotency_key,
            )

    results: list[XeroInvoiceProviderDispatchResultRead] = []
    for draft in ordered_drafts:
        xero_status, xero_reason, xero_invoice_id, xero_provider_status, xero_key = (
            xero_outcomes[draft.id]
        )
        if xero_status in {"created", "reused"}:
            email_status, email_reason, email_provider_status, email_message_id = (
                _provider_dispatch_email_result(
                    draft=draft,
                    user=user,
                    session=session,
                    settings=settings,
                )
            )
        else:
            email_status = "skipped"
            email_reason = "Tenant email waits until a Xero draft exists or is reused."
            email_provider_status = None
            email_message_id = None
        results.append(
            XeroInvoiceProviderDispatchResultRead(
                invoice_draft_id=draft.id,
                invoice_number=draft.invoice_number,
                xero_status=xero_status,
                xero_reason=xero_reason,
                xero_invoice_id=xero_invoice_id,
                xero_provider_status=xero_provider_status,
                xero_idempotency_key=xero_key,
                email_status=email_status,
                email_reason=email_reason,
                email_provider_status=email_provider_status,
                email_provider_message_id=email_message_id,
                provider_receipts=_xero_provider_receipt_reads(
                    dict(draft.invoice_metadata or {})
                ),
                next_action=_provider_dispatch_next_action(
                    xero_status,
                    email_status,
                ),
            )
        )

    if provider_connection is not None:
        connection_metadata = dict(provider_connection.connection_metadata or {})
        connection_metadata["last_invoice_provider_dispatch"] = {
            "dispatched_at": dispatched_at.isoformat(),
            "checked_invoices": len(ordered_drafts),
            "xero_created": sum(1 for result in results if result.xero_status == "created"),
            "xero_reused": sum(1 for result in results if result.xero_status == "reused"),
            "email_sent": sum(1 for result in results if result.email_status == "sent"),
            "email_reused": sum(1 for result in results if result.email_status == "reused"),
        }
        provider_connection.connection_metadata = connection_metadata
        provider_connection.updated_by_user_id = user.id
        entity.xero_last_sync_at = dispatched_at

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="apply",
        target_table="xero_connection" if provider_connection is not None else "entity",
        target_id=provider_connection.id if provider_connection is not None else entity.id,
        tool_name="provider.invoice_dispatch",
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary=(
            f"Provider invoice dispatch checked {len(ordered_drafts)} invoice draft(s); "
            f"created {sum(1 for result in results if result.xero_status == 'created')} "
            "Xero draft(s) and sent "
            f"{sum(1 for result in results if result.email_status == 'sent')} "
            "tenant email(s). Payment reconciliation was not run."
        ),
    )
    session.commit()
    return XeroInvoiceProviderDispatchRead(
        entity_id=entity.id,
        provider_configured=provider_configured,
        provider_connection_id=provider_connection.id if provider_connection else None,
        xero_tenant_id=provider_connection.xero_tenant_id if provider_connection else None,
        checked_invoices=len(ordered_drafts),
        xero_created_count=sum(1 for result in results if result.xero_status == "created"),
        xero_reused_count=sum(1 for result in results if result.xero_status == "reused"),
        email_sent_count=sum(1 for result in results if result.email_status == "sent"),
        email_reused_count=sum(1 for result in results if result.email_status == "reused"),
        blocked_count=sum(
            1
            for result in results
            if result.xero_status == "blocked" or result.email_status == "blocked"
        ),
        failed_count=sum(
            1
            for result in results
            if result.xero_status == "failed" or result.email_status == "failed"
        ),
        dispatched_at=dispatched_at,
        results=results,
        guardrails=[
            "Provider dispatch creates or reuses an approved Xero DRAFT before tenant email.",
            "SendGrid email is reused when a successful provider receipt already exists.",
            "Payment reconciliation remains a separate reviewed action.",
        ],
    )


def _xero_payment_reconciliation(
    *,
    entity_id: UUID,
    payload: XeroPaymentReconciliationRequest,
    apply_changes: bool,
    user: CurrentUser,
    session: Session,
    settings: Settings,
) -> XeroPaymentReconciliationRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    provider_configured = xero_provider_configured(settings)
    provider_connection = _active_xero_connection(session, entity.id)
    payments = list(payload.payments)
    reconciled_at = utcnow()
    if payload.source == "provider" and not payments:
        if provider_configured and provider_connection is not None:
            try:
                access_token = _refresh_provider_access_token(provider_connection, settings)
                xero_invoices = fetch_xero_invoices(
                    access_token,
                    provider_connection.xero_tenant_id,
                    settings,
                )
            except XeroIntegrationError as exc:
                session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=str(exc),
                ) from exc
            payments = _payment_items_from_xero_invoices(xero_invoices)
        else:
            payments = []

    drafts = list(
        session.scalars(
            select(InvoiceDraft).where(
                InvoiceDraft.entity_id == entity.id,
                InvoiceDraft.deleted_at.is_(None),
            )
        )
    )
    drafts_by_id = {draft.id: draft for draft in drafts}
    drafts_by_number = {
        draft.invoice_number: draft for draft in drafts if draft.invoice_number is not None
    }
    drafts_by_xero_invoice_id = {
        xero_invoice_id: draft
        for draft in drafts
        if (xero_invoice_id := _xero_invoice_id_from_metadata(draft.invoice_metadata or {}))
    }
    results = [
        _payment_reconciliation_result(
            item=item,
            drafts_by_id=drafts_by_id,
            drafts_by_number=drafts_by_number,
            drafts_by_xero_invoice_id=drafts_by_xero_invoice_id,
            apply_changes=apply_changes,
            user=user,
            reconciled_at=reconciled_at,
        )
        for item in payments
    ]

    target_id = provider_connection.id if provider_connection is not None else entity.id
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="apply" if apply_changes else "read",
        target_table="xero_connection" if provider_connection is not None else "entity",
        target_id=target_id,
        tool_name=(
            "xero.payment_reconciliation_apply"
            if apply_changes
            else "xero.payment_reconciliation_preview"
        ),
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary=(
            f"{'Applied' if apply_changes else 'Previewed'} {len(results)} Xero payment "
            "reconciliation item(s); no Xero payments, invoices, or bank records were mutated."
        ),
    )
    if provider_connection is not None:
        connection_metadata = dict(provider_connection.connection_metadata or {})
        connection_metadata[
            "last_payment_reconciliation_apply"
            if apply_changes
            else "last_payment_reconciliation_preview"
        ] = {
            "reconciled_at": reconciled_at.isoformat(),
            "source": payload.source,
            "checked_payments": len(results),
            "ready": sum(1 for result in results if result.status == "ready"),
            "applied": sum(1 for result in results if result.status == "applied"),
            "skipped": sum(1 for result in results if result.status == "skipped"),
            "blocked": sum(1 for result in results if result.status == "blocked"),
            "mode": "local_payment_status_apply" if apply_changes else "preview_only",
        }
        provider_connection.connection_metadata = connection_metadata
        provider_connection.updated_by_user_id = user.id
    entity.xero_last_sync_at = reconciled_at
    session.commit()
    return XeroPaymentReconciliationRead(
        entity_id=entity.id,
        source=payload.source,
        provider_configured=provider_configured,
        provider_connection_id=provider_connection.id if provider_connection else None,
        checked_payments=len(results),
        ready_count=sum(1 for result in results if result.status == "ready"),
        applied_count=sum(1 for result in results if result.status == "applied"),
        skipped_count=sum(1 for result in results if result.status == "skipped"),
        blocked_count=sum(1 for result in results if result.status == "blocked"),
        results=results,
        reconciled_at=reconciled_at,
        guardrails=[
            "Payment reconciliation preview does not change local invoice payment status.",
            "Apply only updates Relby invoice payment metadata; it never mutates Xero payments.",
            "Duplicate payment idempotency keys are skipped.",
            (
                "Bank-feed evidence is stored for review only; Relby does not create, "
                "edit, or match bank transactions in Xero."
            ),
        ],
    )


@router.post(
    "/payments/reconciliation-preview/{entity_id}",
    response_model=XeroPaymentReconciliationRead,
)
def preview_xero_payment_reconciliation(
    entity_id: UUID,
    payload: XeroPaymentReconciliationRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> XeroPaymentReconciliationRead:
    return _xero_payment_reconciliation(
        entity_id=entity_id,
        payload=payload,
        apply_changes=False,
        user=user,
        session=session,
        settings=settings,
    )


@router.post(
    "/payments/reconciliation-apply/{entity_id}",
    response_model=XeroPaymentReconciliationRead,
)
def apply_xero_payment_reconciliation(
    entity_id: UUID,
    payload: XeroPaymentReconciliationRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> XeroPaymentReconciliationRead:
    return _xero_payment_reconciliation(
        entity_id=entity_id,
        payload=payload,
        apply_changes=True,
        user=user,
        session=session,
        settings=settings,
    )


@router.get("/exception-queue", response_model=XeroExceptionQueueRead)
def xero_exception_queue(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    entity_id: Annotated[UUID, Query()],
) -> XeroExceptionQueueRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    status_read = xero_status(
        user=user,
        session=session,
        settings=settings,
        entity_id=entity_id,
    )
    items = [_exception_from_status_issue(issue) for issue in status_read.issues]
    freshness_exception = _freshness_exception_from_status(status_read.accounting_freshness)
    if freshness_exception is not None:
        items.append(freshness_exception)

    invoice_drafts = list(
        session.scalars(
            select(InvoiceDraft)
            .where(
                InvoiceDraft.entity_id == entity_id,
                InvoiceDraft.deleted_at.is_(None),
            )
            .order_by(InvoiceDraft.due_date, InvoiceDraft.created_at)
        )
    )
    for draft in invoice_drafts:
        metadata = dict(draft.invoice_metadata or {})
        provider_exception = _provider_exception_from_invoice(draft, metadata)
        if provider_exception is not None:
            items.append(provider_exception)
        payment_exception = _payment_exception_from_invoice(draft, metadata)
        if payment_exception is not None:
            items.append(payment_exception)

    generated_at = utcnow()
    severity_order = {"blocker": 0, "warning": 1, "info": 2}
    kind_order = {kind: index for index, kind in enumerate(XERO_EXCEPTION_KINDS)}
    items.sort(
        key=lambda item: (
            severity_order[item.severity],
            kind_order[item.kind],
            item.received_at or generated_at,
            item.label,
            item.id,
        )
    )
    return XeroExceptionQueueRead(
        entity_id=entity.id,
        generated_at=generated_at,
        summary=_xero_exception_summary(items),
        items=items,
        guardrails=[
            "The exception queue is built from local Relby records only.",
            (
                "Loading this queue does not refresh Xero tokens, call Xero APIs, "
                "post invoices, send emails, or reconcile payments."
            ),
            (
                "Provider actions still require explicit operator review before any "
                "mutation is attempted."
            ),
        ],
    )


@router.get("/status", response_model=XeroStatusRead)
def xero_status(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    entity_id: Annotated[UUID, Query()],
) -> XeroStatusRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    provider_connection = _active_xero_connection(session, entity.id)
    connection = _connection(entity, session, settings)
    issues: list[XeroMappingIssueRead] = []
    if not connection.xero_tenant_id:
        issues.append(
            XeroMappingIssueRead(
                id=f"connection-{entity.id}",
                kind="connection",
                severity="blocker",
                label="Xero is not connected",
                detail="This entity has no Xero tenant recorded yet.",
                action="Record the Xero tenant before approving invoice sync.",
            )
        )

    properties = list(
        session.scalars(
            select(Property).where(
                Property.entity_id == entity_id,
                Property.deleted_at.is_(None),
            )
        )
    )
    tenants = list(
        session.scalars(
            select(Tenant).where(
                Tenant.entity_id == entity_id,
                Tenant.deleted_at.is_(None),
            )
        )
    )
    tenant_contact_ready = 0
    for tenant in tenants:
        metadata = tenant.tenant_metadata or {}
        if tenant.billing_email or tenant.contact_email or metadata.get("xero_contact_id"):
            tenant_contact_ready += 1
            continue
        issues.append(
            XeroMappingIssueRead(
                id=f"tenant-contact-{tenant.id}",
                kind="contact",
                severity="warning",
                label="Tenant contact not ready",
                detail=f"{_tenant_name(tenant)} has no billing email or Xero contact metadata.",
                action="Add a billing email or reviewed Xero contact mapping before sync.",
                tenant_id=tenant.id,
                tenant_name=_tenant_name(tenant),
            )
        )

    property_contact_total = 0
    property_contact_ready = 0
    for prop in properties:
        if (prop.ownership_structure or "current_entity") not in PROPERTY_OWNER_BILLING_STRUCTURES:
            continue
        property_contact_total += 1
        if prop.xero_contact_id:
            property_contact_ready += 1
            continue
        issues.append(
            XeroMappingIssueRead(
                id=f"property-contact-{prop.id}",
                kind="contact",
                severity="warning",
                label="Property invoice issuer not mapped",
                detail=f"{prop.name} needs a Xero issuer/contact mapping.",
                action="Add the Xero issuer mapping on the property billing identity.",
                property_id=prop.id,
                property_name=prop.name,
            )
        )

    charge_rows = _charge_rule_rows(session, entity_id)
    account_ready = 0
    tax_ready = 0
    for rule, lease, unit, prop, tenant in charge_rows:
        suggested_account, suggested_tax = SUGGESTED_CHARGE_MAPPINGS.get(
            rule.charge_type,
            ("299", "OUTPUT"),
        )
        charge_label = rule.charge_type.value.replace("_", " ")
        if rule.xero_account_code:
            account_ready += 1
        else:
            issues.append(
                XeroMappingIssueRead(
                    id=f"chart-{rule.id}",
                    kind="chart",
                    severity="blocker",
                    label=f"{charge_label.title()} account missing",
                    detail=f"{prop.name} / {unit.unit_label} needs a Xero account code.",
                    action="Review and apply the suggested account mapping.",
                    property_id=prop.id,
                    property_name=prop.name,
                    tenancy_unit_id=unit.id,
                    unit_label=unit.unit_label,
                    lease_id=lease.id,
                    tenant_id=tenant.id if tenant else None,
                    tenant_name=_tenant_name(tenant),
                    charge_rule_id=rule.id,
                    charge_type=rule.charge_type.value,
                    current_account_code=rule.xero_account_code,
                    current_tax_type=rule.xero_tax_type,
                    suggested_account_code=suggested_account,
                    suggested_tax_type=suggested_tax,
                )
            )
        if rule.gst_treatment.value != "taxable" or rule.xero_tax_type:
            tax_ready += 1
        else:
            issues.append(
                XeroMappingIssueRead(
                    id=f"tax-{rule.id}",
                    kind="tax",
                    severity="blocker",
                    label=f"{charge_label.title()} tax type missing",
                    detail=f"{prop.name} / {unit.unit_label} is taxable and needs a Xero tax type.",
                    action="Review and apply the suggested tax mapping.",
                    property_id=prop.id,
                    property_name=prop.name,
                    tenancy_unit_id=unit.id,
                    unit_label=unit.unit_label,
                    lease_id=lease.id,
                    tenant_id=tenant.id if tenant else None,
                    tenant_name=_tenant_name(tenant),
                    charge_rule_id=rule.id,
                    charge_type=rule.charge_type.value,
                    current_account_code=rule.xero_account_code,
                    current_tax_type=rule.xero_tax_type,
                    suggested_account_code=suggested_account,
                    suggested_tax_type=suggested_tax,
                )
            )

    invoice_drafts = list(
        session.scalars(
            select(InvoiceDraft).where(
                InvoiceDraft.entity_id == entity_id,
                InvoiceDraft.deleted_at.is_(None),
            )
        )
    )
    approved_unsynced = 0
    synced = 0
    blocked = 0
    unpaid = 0
    partially_paid = 0
    paid = 0
    xero_linked_open_invoice_count = 0
    for draft in invoice_drafts:
        metadata = draft.invoice_metadata or {}
        xero_sync = metadata.get("xero_sync")
        is_synced = isinstance(xero_sync, dict) and xero_sync.get("xero_synced") is True
        if is_synced:
            synced += 1
        elif draft.status == InvoiceDraftStatus.approved:
            approved_unsynced += 1
            posting_approved = _xero_posting_approved(metadata)
            if not connection.xero_tenant_id or not posting_approved:
                blocked += 1
            issue_action = (
                "Connect the Xero provider before draft creation can be applied."
                if not connection.xero_tenant_id
                else "Approve Xero posting explicitly, then run idempotent draft creation."
                if not posting_approved
                else "Run idempotent Xero draft creation when ready."
            )
            issues.append(
                XeroMappingIssueRead(
                    id=f"invoice-sync-{draft.id}",
                    kind="invoice_sync",
                    severity="warning",
                    label="Approved invoice not synced",
                    detail=(
                        f"{draft.invoice_number or draft.title} is approved "
                        "but not posted to Xero."
                    ),
                    action=issue_action,
                    property_id=draft.property_id,
                    tenancy_unit_id=draft.tenancy_unit_id,
                    lease_id=draft.lease_id,
                    tenant_id=draft.tenant_id,
                )
            )
        payment_status = _payment_status(metadata)
        if payment_status == "paid":
            paid += 1
        elif payment_status == "partially_paid":
            partially_paid += 1
            if _xero_invoice_id_from_metadata(metadata):
                xero_linked_open_invoice_count += 1
        else:
            unpaid += 1
            if _xero_invoice_id_from_metadata(metadata):
                xero_linked_open_invoice_count += 1

    total_contacts = len(tenants) + property_contact_total
    ready_contacts = tenant_contact_ready + property_contact_ready
    issue_order = {"blocker": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda issue: (issue_order[issue.severity], issue.label, issue.id))
    readiness_blocker_count = sum(1 for issue in issues if issue.severity == "blocker")
    readiness_warning_count = sum(1 for issue in issues if issue.severity == "warning")
    readiness_issue_count = len(issues)
    generated_at = utcnow()
    accounting_freshness = _accounting_freshness(
        provider_connection=provider_connection,
        readiness_issue_count=readiness_issue_count,
        readiness_blocker_count=readiness_blocker_count,
        readiness_warning_count=readiness_warning_count,
        approved_unsynced_invoice_count=approved_unsynced,
        xero_linked_open_invoice_count=xero_linked_open_invoice_count,
        generated_at=generated_at,
        settings=settings,
    )
    return XeroStatusRead(
        provider=_provider(settings),
        connection=connection,
        contact_mapping=XeroReadinessSummaryRead(
            total=total_contacts,
            ready=ready_contacts,
            missing=max(total_contacts - ready_contacts, 0),
        ),
        chart_mapping=XeroReadinessSummaryRead(
            total=len(charge_rows),
            ready=account_ready,
            missing=max(len(charge_rows) - account_ready, 0),
        ),
        tax_mapping=XeroReadinessSummaryRead(
            total=len(charge_rows),
            ready=tax_ready,
            missing=max(len(charge_rows) - tax_ready, 0),
        ),
        invoice_sync=XeroInvoiceSyncSummaryRead(
            total_invoice_drafts=len(invoice_drafts),
            approved_unsynced=approved_unsynced,
            synced=synced,
            blocked=blocked,
        ),
        payment_reconciliation=XeroPaymentSummaryRead(
            unpaid=unpaid,
            partially_paid=partially_paid,
            paid=paid,
            reconciliation_ready=paid + partially_paid,
        ),
        accounting_freshness=accounting_freshness,
        issues=issues[:50],
        guardrails=[
            "Xero contact apply only saves reviewed local mappings; it does not mutate Xero.",
            "Invoice posting requires explicit local approval and an active configured provider.",
            "Payment reconciliation apply only updates local invoice payment metadata.",
        ],
    )


@router.patch("/connection/{entity_id}", response_model=XeroConnectionStatusRead)
def update_xero_connection(
    entity_id: UUID,
    payload: XeroConnectionUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> XeroConnectionStatusRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    if not payload.connected:
        entity.xero_tenant_id = None
        entity.xero_connected_at = None
        entity.xero_last_sync_at = None
        for provider_connection in session.scalars(
            select(XeroConnection).where(
                XeroConnection.entity_id == entity.id,
                XeroConnection.revoked_at.is_(None),
                XeroConnection.deleted_at.is_(None),
            )
        ):
            provider_connection.revoked_at = utcnow()
            provider_connection.updated_by_user_id = user.id
        action_summary = "Cleared recorded Xero connection status."
    else:
        tenant_id = (payload.xero_tenant_id or "").strip()
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Xero tenant ID is required when marking an entity connected.",
            )
        entity.xero_tenant_id = tenant_id
        entity.xero_connected_at = entity.xero_connected_at or utcnow()
        action_summary = "Recorded Xero connection status; no sync was run."

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="update",
        target_table="entity",
        target_id=entity.id,
        tool_name="xero.connection_status",
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary=action_summary,
    )
    session.commit()
    session.refresh(entity)
    return _connection(entity, session, settings)
