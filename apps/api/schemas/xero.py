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


class XeroProviderSetupPreflightRead(BaseModel):
    required_env_vars: list[str]
    missing_env_vars: list[str]
    expected_redirect_uri: str
    required_scopes: list[str]
    setup_checklist: list[str]


class XeroConnectionDiagnosticsRead(BaseModel):
    entity_id: UUID
    entity_name: str
    provider_configured: bool
    missing_config: list[str]
    redirect_uri: str
    scopes: list[str]
    provider_setup_preflight: XeroProviderSetupPreflightRead
    connected: bool
    connection_source: Literal["provider", "manual", "none"]
    xero_tenant_id: str | None
    tenant_name: str | None = None
    token_expires_at: datetime | None = None
    can_start_oauth: bool
    can_preview_contacts: bool
    can_validate_chart_tax: bool
    can_preview_invoice_posting: bool
    can_create_xero_drafts: bool
    can_preview_payment_reconciliation: bool
    next_steps: list[str]
    guardrails: list[str]


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


class XeroAccountingFreshnessRead(BaseModel):
    generated_at: datetime
    source: Literal["local_metadata"]
    status: Literal["ready", "stale", "missing", "attention"]
    summary: str
    stale_after_days: int
    stale_reconciliation: bool
    readiness_issue_count: int = 0
    readiness_blocker_count: int = 0
    readiness_warning_count: int = 0
    approved_unsynced_invoice_count: int = 0
    xero_linked_open_invoice_count: int
    last_contact_sync_at: datetime | None = None
    last_chart_tax_validation_at: datetime | None = None
    last_invoice_posting_preview_at: datetime | None = None
    last_invoice_draft_create_at: datetime | None = None
    last_invoice_provider_dispatch_at: datetime | None = None
    last_payment_reconciliation_preview_at: datetime | None = None
    last_payment_reconciliation_apply_at: datetime | None = None
    last_payment_reconciliation_at: datetime | None = None
    last_payment_reconciliation_source: str | None = None
    last_payment_reconciliation_mode: str | None = None
    guardrails: list[str]


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


class XeroExceptionQueueSummaryRead(BaseModel):
    total: int
    blockers: int
    warnings: int
    info: int
    connection: int
    contact: int
    chart: int
    tax: int
    invoice_sync: int
    provider: int
    payment: int


class XeroExceptionQueueItemRead(BaseModel):
    id: str
    kind: Literal["connection", "contact", "chart", "tax", "invoice_sync", "provider", "payment"]
    severity: Literal["blocker", "warning", "info"]
    label: str
    detail: str
    action: str
    next_action: str | None = None
    source: str | None = None
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
    invoice_draft_id: UUID | None = None
    invoice_number: str | None = None
    invoice_title: str | None = None
    total_cents: int | None = None
    currency: str | None = None
    provider: str | None = None
    provider_status: str | None = None
    external_posting_status: str | None = None
    idempotency_key: str | None = None
    xero_invoice_id: str | None = None
    xero_status: str | None = None
    received_at: datetime | None = None
    retry_count: int | None = None


class XeroExceptionQueueRead(BaseModel):
    entity_id: UUID
    generated_at: datetime
    summary: XeroExceptionQueueSummaryRead
    items: list[XeroExceptionQueueItemRead]
    guardrails: list[str]


class XeroStatusRead(BaseModel):
    provider: XeroProviderConfigRead
    connection: XeroConnectionStatusRead
    contact_mapping: XeroReadinessSummaryRead
    chart_mapping: XeroReadinessSummaryRead
    tax_mapping: XeroReadinessSummaryRead
    invoice_sync: XeroInvoiceSyncSummaryRead
    payment_reconciliation: XeroPaymentSummaryRead
    accounting_freshness: XeroAccountingFreshnessRead
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


class XeroAccountOptionRead(BaseModel):
    code: str
    name: str | None
    type: str | None
    account_class: str | None
    status: str | None


class XeroTaxRateOptionRead(BaseModel):
    tax_type: str
    name: str | None
    status: str | None


class XeroChartTaxValidationPreviewRead(BaseModel):
    entity_id: UUID
    xero_tenant_id: str
    tenant_name: str | None
    fetched_accounts: int
    fetched_tax_rates: int
    checked_rules: int
    results: list[XeroChartTaxValidationResultRead]
    accounts: list[XeroAccountOptionRead]
    tax_rates: list[XeroTaxRateOptionRead]
    validated_at: datetime
    guardrails: list[str]


class XeroChartTaxMappingApplyItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    charge_rule_id: UUID
    account_code: str | None = Field(default=None, max_length=50)
    tax_type: str | None = Field(default=None, max_length=50)
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: str | None = Field(default=None, max_length=60)


class XeroChartTaxMappingApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mappings: list[XeroChartTaxMappingApplyItem] = Field(min_length=1, max_length=200)


class XeroChartTaxMappingApplyResultRead(BaseModel):
    charge_rule_id: UUID
    charge_type: str
    property_name: str
    unit_label: str
    previous_account_code: str | None
    previous_tax_type: str | None
    account_code: str | None
    tax_type: str | None
    status: Literal["applied", "skipped"]
    reason: str


class XeroChartTaxMappingApplyRead(BaseModel):
    entity_id: UUID
    applied_mappings: list[XeroChartTaxMappingApplyResultRead]
    skipped_mappings: list[XeroChartTaxMappingApplyResultRead]
    applied_at: datetime
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


class XeroInvoicePostingApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approved: bool = True
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)
    notes: str | None = Field(default=None, max_length=500)


class XeroInvoicePostingApprovalRead(BaseModel):
    invoice_draft_id: UUID
    invoice_number: str | None
    status: Literal["approved", "revoked", "skipped"]
    approval_state: Literal["approved", "revoked", "already_posted"]
    xero_sync_allowed: bool
    external_posting_status: str
    approved_at: datetime | None
    idempotency_key: str | None
    reason: str
    guardrails: list[str]


class XeroInvoiceDraftCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_draft_ids: list[UUID] | None = Field(default=None, max_length=50)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=96)


class XeroInvoiceDraftCreateResultRead(BaseModel):
    invoice_draft_id: UUID
    invoice_number: str | None
    status: Literal["created", "skipped", "blocked", "failed"]
    reason: str
    approval_state: str
    idempotency_key: str | None
    xero_invoice_id: str | None = None
    xero_status: str | None = None
    external_posting_status: str


class XeroInvoiceDraftCreateRead(BaseModel):
    entity_id: UUID
    provider_configured: bool
    provider_connection_id: UUID | None
    xero_tenant_id: str | None
    checked_invoices: int
    created_count: int
    skipped_count: int
    blocked_count: int
    failed_count: int
    results: list[XeroInvoiceDraftCreateResultRead]
    applied_at: datetime
    guardrails: list[str]


class XeroInvoiceProviderDispatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_draft_ids: list[UUID] | None = Field(default=None, max_length=50)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=96)


class XeroProviderStatusReceiptRead(BaseModel):
    provider: str
    status: str
    reason: str | None = None
    external_posting_status: str | None = None
    idempotency_key: str | None = None
    xero_invoice_id: str | None = None
    xero_status: str | None = None
    received_at: datetime
    retry_count: int | None = None


class XeroInvoiceProviderDispatchResultRead(BaseModel):
    invoice_draft_id: UUID
    invoice_number: str | None
    xero_status: Literal["created", "reused", "skipped", "blocked", "failed"]
    xero_reason: str
    xero_invoice_id: str | None = None
    xero_provider_status: str | None = None
    xero_idempotency_key: str | None = None
    email_status: Literal["sent", "reused", "skipped", "blocked", "failed"]
    email_reason: str
    email_provider_status: str | None = None
    email_provider_message_id: str | None = None
    provider_receipts: list[XeroProviderStatusReceiptRead] = Field(default_factory=list)
    next_action: str | None = None


class XeroInvoiceProviderDispatchRead(BaseModel):
    entity_id: UUID
    provider_configured: bool
    provider_connection_id: UUID | None
    xero_tenant_id: str | None
    checked_invoices: int
    xero_created_count: int
    xero_reused_count: int
    email_sent_count: int
    email_reused_count: int
    blocked_count: int
    failed_count: int
    dispatched_at: datetime
    results: list[XeroInvoiceProviderDispatchResultRead]
    guardrails: list[str]


class XeroPaymentReconciliationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_draft_id: UUID | None = None
    invoice_number: str | None = Field(default=None, min_length=1, max_length=120)
    xero_invoice_id: str | None = Field(default=None, min_length=1, max_length=120)
    status: Literal["unpaid", "partially_paid", "paid"]
    paid_cents: int | None = Field(default=None, ge=0)
    paid_at: datetime | None = None
    provider_payment_id: str | None = Field(default=None, min_length=1, max_length=120)
    source: Literal["imported", "provider"] = "imported"
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)
    bank_transaction_id: str | None = Field(default=None, min_length=1, max_length=120)
    bank_account_name: str | None = Field(default=None, min_length=1, max_length=120)
    statement_date: date | None = None
    statement_amount_cents: int | None = Field(default=None, ge=0)
    counterparty: str | None = Field(default=None, min_length=1, max_length=200)
    reference: str | None = Field(default=None, min_length=1, max_length=200)
    match_confidence: Literal["high", "medium", "low"] | None = None
    match_method: str | None = Field(default=None, min_length=1, max_length=120)
    match_notes: str | None = Field(default=None, min_length=1, max_length=500)


class XeroPaymentReconciliationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["imported", "provider"] = "imported"
    payments: list[XeroPaymentReconciliationItem] = Field(default_factory=list, max_length=100)


class XeroPaymentReconciliationResultRead(BaseModel):
    invoice_draft_id: UUID | None
    invoice_number: str | None
    status: Literal["ready", "applied", "skipped", "blocked"]
    reason: str
    current_status: str | None
    proposed_status: str | None
    current_paid_cents: int | None
    proposed_paid_cents: int | None
    outstanding_cents: int | None
    idempotency_key: str | None
    match_method: str
    match_confidence: Literal["high", "medium", "low"]
    amount_delta_cents: int | None
    bank_transaction_id: str | None = None
    bank_account_name: str | None = None
    statement_date: date | None = None
    statement_amount_cents: int | None = None
    counterparty: str | None = None
    reference: str | None = None
    guardrail_flags: list[str] = Field(default_factory=list)


class XeroPaymentReconciliationRead(BaseModel):
    entity_id: UUID
    source: Literal["imported", "provider"]
    provider_configured: bool
    provider_connection_id: UUID | None
    checked_payments: int
    ready_count: int
    applied_count: int
    skipped_count: int
    blocked_count: int
    results: list[XeroPaymentReconciliationResultRead]
    reconciled_at: datetime
    guardrails: list[str]
