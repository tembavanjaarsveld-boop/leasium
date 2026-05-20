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
    fetch_xero_connections,
    fetch_xero_contacts,
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
    XeroConnectionStatusRead,
    XeroConnectionUpdate,
    XeroContactMatchRead,
    XeroContactSyncPreviewRead,
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
        refresh_token = decrypt_xero_token(provider_connection.refresh_token_ciphertext, settings)
        tokens = refresh_xero_tokens(refresh_token, settings)
        access_token = _token_value(tokens, "access_token")
        provider_connection.access_token_ciphertext = encrypt_xero_token(access_token, settings)
        provider_connection.refresh_token_ciphertext = encrypt_xero_token(
            _token_value(tokens, "refresh_token"),
            settings,
        )
        provider_connection.token_expires_at = token_expiry_from_payload(tokens)
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

    charge_rows = session.execute(
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
            "Xero provider actions only preview data until an explicit reviewed apply exists.",
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
