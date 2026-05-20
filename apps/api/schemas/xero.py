"""Schemas for Xero readiness and pre-sync mapping surfaces."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class XeroProviderConfigRead(BaseModel):
    configured: bool
    missing_config: list[str]
    redirect_uri: str
    scopes: list[str]


class XeroOAuthStartRead(BaseModel):
    configured: bool
    authorization_url: str | None
    missing_config: list[str]
    redirect_uri: str
    scopes: list[str]
    state_expires_at: datetime | None


class XeroConnectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connected: bool = True
    xero_tenant_id: str | None = None


class XeroConnectionStatusRead(BaseModel):
    entity_id: UUID
    entity_name: str
    connected: bool
    xero_tenant_id: str | None
    tenant_name: str | None = None
    tenant_type: str | None = None
    connected_at: datetime | None
    last_sync_at: datetime | None
    last_contact_sync_at: datetime | None = None
    provider_configured: bool = False
    provider_connection_id: UUID | None = None
    connection_source: Literal["provider", "manual", "none"] = "none"
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
    provider: XeroProviderConfigRead
    connection: XeroConnectionStatusRead
    contact_mapping: XeroReadinessSummaryRead
    chart_mapping: XeroReadinessSummaryRead
    tax_mapping: XeroReadinessSummaryRead
    invoice_sync: XeroInvoiceSyncSummaryRead
    payment_reconciliation: XeroPaymentSummaryRead
    issues: list[XeroMappingIssueRead]
    guardrails: list[str]


class XeroContactMatchRead(BaseModel):
    target_type: Literal["tenant", "property"]
    target_id: UUID
    target_name: str
    current_xero_contact_id: str | None
    xero_contact_id: str
    xero_contact_name: str
    xero_email: str | None
    match_reason: str
    confidence: float


class XeroContactSyncPreviewRead(BaseModel):
    entity_id: UUID
    xero_tenant_id: str
    tenant_name: str | None
    fetched_contacts: int
    suggested_matches: list[XeroContactMatchRead]
    last_contact_sync_at: datetime
    guardrails: list[str]
