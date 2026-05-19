"""Schemas for Xero readiness and pre-sync mapping surfaces."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class XeroConnectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connected: bool = True
    xero_tenant_id: str | None = None


class XeroConnectionStatusRead(BaseModel):
    entity_id: UUID
    entity_name: str
    connected: bool
    xero_tenant_id: str | None
    connected_at: datetime | None
    last_sync_at: datetime | None
    status_label: str
    next_action: str


class XeroReadinessSummaryRead(BaseModel):
    total: int
    ready: int
    missing: int


class XeroInvoiceSyncSummaryRead(BaseModel):
    total_invoice_drafts: int
    approved_unsynced: int
    synced: int
    blocked: int


class XeroPaymentSummaryRead(BaseModel):
    unpaid: int
    partially_paid: int
    paid: int
    reconciliation_ready: int


class XeroMappingIssueRead(BaseModel):
    id: str
    kind: Literal["connection", "contact", "chart", "tax", "invoice_sync", "payment"]
    severity: Literal["blocker", "warning", "info"]
    label: str
    detail: str
    action: str
    property_id: UUID | None = None
    property_name: str | None = None
    tenancy_unit_id: UUID | None = None
    unit_label: str | None = None
    lease_id: UUID | None = None
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    charge_rule_id: UUID | None = None
    charge_type: str | None = None
    current_account_code: str | None = None
    current_tax_type: str | None = None
    suggested_account_code: str | None = None
    suggested_tax_type: str | None = None


class XeroStatusRead(BaseModel):
    connection: XeroConnectionStatusRead
    contact_mapping: XeroReadinessSummaryRead
    chart_mapping: XeroReadinessSummaryRead
    tax_mapping: XeroReadinessSummaryRead
    invoice_sync: XeroInvoiceSyncSummaryRead
    payment_reconciliation: XeroPaymentSummaryRead
    issues: list[XeroMappingIssueRead]
    guardrails: list[str]
