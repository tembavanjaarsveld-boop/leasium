"""Schemas for Xero readiness and pre-sync mapping surfaces."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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


class XeroContactMappingApplyItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_type: Literal["tenant", "property"]
    target_id: UUID
    xero_contact_id: str = Field(min_length=1)
    xero_contact_name: str = Field(min_length=1)
    xero_email: str | None = None
    match_reason: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class XeroContactMappingApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mappings: list[XeroContactMappingApplyItem] = Field(min_length=1, max_length=50)


class XeroContactMappingApplyResultRead(BaseModel):
    target_type: Literal["tenant", "property"]
    target_id: UUID
    target_name: str
    previous_xero_contact_id: str | None
    xero_contact_id: str
    xero_contact_name: str
    status: Literal["applied", "skipped"]
    reason: str


class XeroContactMappingApplyRead(BaseModel):
    entity_id: UUID
    applied_mappings: list[XeroContactMappingApplyResultRead]
    skipped_mappings: list[XeroContactMappingApplyResultRead]
    applied_at: datetime
    guardrails: list[str]


class XeroChartTaxValidationResultRead(BaseModel):
    charge_rule_id: UUID
    charge_type: str
    property_name: str
    unit_label: str
    tenant_name: str | None
    account_code: str | None
    account_name: str | None
    account_status: str | None
    account_valid: bool
    tax_type: str | None
    tax_name: str | None
    tax_valid: bool
    suggested_account_code: str | None
    suggested_tax_type: str | None
    status: Literal["ready", "needs_mapping", "not_found"]
    blockers: list[str]


class XeroChartTaxValidationPreviewRead(BaseModel):
    entity_id: UUID
    xero_tenant_id: str
    tenant_name: str | None
    fetched_accounts: int
    fetched_tax_rates: int
    checked_rules: int
    results: list[XeroChartTaxValidationResultRead]
    validated_at: datetime
    guardrails: list[str]


class XeroInvoicePostingPreviewLineRead(BaseModel):
    description: str
    quantity: float
    unit_amount: float
    account_code: str | None
    tax_type: str | None
    line_amount: float
    source_line_id: UUID | None


class XeroInvoicePostingPreviewResultRead(BaseModel):
    invoice_draft_id: UUID
    invoice_number: str | None
    title: str
    status: Literal["ready", "blocked"]
    xero_contact_id: str | None
    contact_name: str | None
    issue_date: date | None
    due_date: date | None
    currency: str
    total_cents: int
    line_count: int
    line_items: list[XeroInvoicePostingPreviewLineRead]
    blockers: list[str]
    payload_preview: dict[str, Any]


class XeroInvoicePostingPreviewRead(BaseModel):
    entity_id: UUID
    xero_tenant_id: str
    tenant_name: str | None
    checked_invoices: int
    ready_count: int
    blocked_count: int
    results: list[XeroInvoicePostingPreviewResultRead]
    prepared_at: datetime
    guardrails: list[str]
