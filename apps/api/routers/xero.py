"""Xero readiness routes.

These routes expose connection and mapping state only. They do not call Xero,
post invoices, or reconcile payments.
"""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    Property,
    RentChargeRule,
    RentChargeType,
    TenancyUnit,
    Tenant,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.xero import (
    XeroConnectionStatusRead,
    XeroConnectionUpdate,
    XeroInvoiceSyncSummaryRead,
    XeroMappingIssueRead,
    XeroPaymentSummaryRead,
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


def _tenant_name(tenant: Tenant | None) -> str | None:
    if tenant is None:
        return None
    return tenant.trading_name or tenant.legal_name


def _connection(entity: Entity) -> XeroConnectionStatusRead:
    connected = bool(entity.xero_tenant_id)
    return XeroConnectionStatusRead(
        entity_id=entity.id,
        entity_name=entity.name,
        connected=connected,
        xero_tenant_id=entity.xero_tenant_id,
        connected_at=entity.xero_connected_at,
        last_sync_at=entity.xero_last_sync_at,
        status_label="Connected" if connected else "Not connected",
        next_action=(
            "Review contact, chart, tax, invoice, and payment readiness before enabling sync."
            if connected
            else "Record the Xero tenant connection before any sync approval can be enabled."
        ),
    )


def _payment_status(metadata: dict[str, Any]) -> str:
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        status_value = payment.get("status")
        if isinstance(status_value, str) and status_value:
            return status_value
    return "unpaid"


@router.get("/status", response_model=XeroStatusRead)
def xero_status(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
) -> XeroStatusRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    issues: list[XeroMappingIssueRead] = []
    if not entity.xero_tenant_id:
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
            if not entity.xero_tenant_id:
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
        connection=_connection(entity),
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
            "This surface records readiness only; it does not call Xero.",
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
) -> XeroConnectionStatusRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    if not payload.connected:
        entity.xero_tenant_id = None
        entity.xero_connected_at = None
        entity.xero_last_sync_at = None
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
    return _connection(entity)
