"""Xero readiness and provider connection routes."""

import base64
import hashlib
import hmac
import json
import secrets
from datetime import timedelta
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
    decrypt_xero_token,
    encrypt_xero_token,
    exchange_code_for_tokens,
    fetch_xero_accounts,
    fetch_xero_connections,
    fetch_xero_contacts,
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
from apps.api.schemas.xero import (
    XeroChartTaxValidationPreviewRead,
    XeroChartTaxValidationResultRead,
    XeroConnectionStatusRead,
    XeroConnectionUpdate,
    XeroContactMappingApplyItem,
    XeroContactMappingApplyRead,
    XeroContactMappingApplyRequest,
    XeroContactMappingApplyResultRead,
    XeroContactMatchRead,
    XeroContactSyncPreviewRead,
    XeroInvoicePostingPreviewLineRead,
    XeroInvoicePostingPreviewRead,
    XeroInvoicePostingPreviewResultRead,
    XeroInvoiceSyncSummaryRead,
    XeroMappingIssueRead,
    XeroOAuthStartRead,
    XeroPaymentSummaryRead,
    XeroProviderConfigRead,
    XeroReadinessSummaryRead,
    XeroStatusRead,
)

router = APIRouter(prefix="/xero", tags=["xero"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

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
OAUTH_STATE_TTL_MINUTES = 15


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


def _payment_status(metadata: dict[str, Any]) -> str:
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        status_value = payment.get("status")
        if isinstance(status_value, str) and status_value:
            return status_value
    return "unpaid"


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
    return " ".join((value or "").casefold().replace("&", "and").split())


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
        suggested_account, suggested_tax = SUGGESTED_CHARGE_MAPPINGS.get(
            rule.charge_type,
            ("299", "OUTPUT"),
        )
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
    session.commit()
    return XeroChartTaxValidationPreviewRead(
        entity_id=entity.id,
        xero_tenant_id=provider_connection.xero_tenant_id,
        tenant_name=provider_connection.tenant_name,
        fetched_accounts=len(accounts),
        fetched_tax_rates=len(tax_rates),
        checked_rules=len(charge_rows),
        results=results,
        validated_at=validated_at,
        guardrails=[
            "This is a provider-backed validation preview only.",
            "Leasium only checks whether local account codes and tax types exist in Xero.",
            "No invoice posting, Xero mutation, tenant email, or payment reconciliation was run.",
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
            "Leasium builds the draft Xero payload and blocker list for approved invoice drafts.",
            (
                "No invoices are posted, no Xero records are mutated, no tenant email is "
                "sent, and no payment reconciliation is run."
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
    for draft in invoice_drafts:
        metadata = draft.invoice_metadata or {}
        xero_sync = metadata.get("xero_sync")
        is_synced = isinstance(xero_sync, dict) and xero_sync.get("xero_synced") is True
        if is_synced:
            synced += 1
        elif draft.status == InvoiceDraftStatus.approved:
            approved_unsynced += 1
            if not connection.xero_tenant_id:
                blocked += 1
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
                    action="Keep this queued until Xero posting approvals are enabled.",
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
        else:
            unpaid += 1

    total_contacts = len(tenants) + property_contact_total
    ready_contacts = tenant_contact_ready + property_contact_ready
    issue_order = {"blocker": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda issue: (issue_order[issue.severity], issue.label, issue.id))
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
        issues=issues[:50],
        guardrails=[
            "Xero contact apply only saves reviewed local mappings; it does not mutate Xero.",
            "Invoice posting remains blocked until a future explicit approval action exists.",
            "Payment reconciliation is manual status tracking until bank/Xero feeds are connected.",
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
