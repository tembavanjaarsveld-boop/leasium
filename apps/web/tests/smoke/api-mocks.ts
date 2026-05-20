import type { Page, Route } from "@playwright/test";

type JsonBody =
  | null
  | boolean
  | number
  | string
  | JsonBody[]
  | { [key: string]: JsonBody };

type XeroContactMapping = {
  target_type: "tenant" | "property";
  target_id: string;
  target_name: string;
  xero_contact_id: string;
  xero_contact_name: string;
  xero_email: string | null;
};

const entityId = "entity-1";
const propertyId = "property-1";
const tenantId = "tenant-1";
const unitId = "unit-1";
const leaseId = "lease-1";
const operatorId = "operator-1";

const entities = [
  {
    id: entityId,
    organisation_id: "org-1",
    name: "Acme Holdings Pty Ltd",
    abn: "12123123123",
    gst_registered: true,
    xero_tenant_id: null,
    xero_connected_at: null,
    xero_last_sync_at: null,
    notes: null,
    created_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
];

const properties = [
  {
    id: propertyId,
    entity_id: entityId,
    name: "Queen Street Retail Centre",
    street_address: "12 Queen Street",
    suburb: "Brisbane City",
    state: "QLD",
    postcode: "4000",
    country_code: "AU",
    property_type: "commercial_retail",
    parcel_id: "L1-SP12345",
    land_sqm: 820,
    building_sqm: 640,
    parking_spaces: 12,
    has_solar_pv: true,
    ownership_structure: "trust",
    owner_legal_name: "Queen Street Property Trust",
    owner_abn: "22123456789",
    trustee_name: "Queen Street Trustee Pty Ltd",
    trust_name: "Queen Street Property Trust",
    invoice_issuer_name: "Queen Street Trustee Pty Ltd",
    billing_contact_name: "Mia Accounts",
    billing_email: "owners@queenstreet.example",
    invoice_reference: "QSR-",
    ownership_split: "100% Queen Street Property Trust",
    owner_gst_registered: true,
    xero_contact_id: "xero-owner-1",
    xero_tracking_category: "Queen Street",
    metadata: {},
  },
];

const tenants = [
  {
    id: tenantId,
    entity_id: entityId,
    legal_name: "Bright Cafe Pty Ltd",
    trading_name: "Bright Cafe",
    abn: "34123456789",
    contact_name: "Mia Hart",
    contact_email: "mia@example.com",
    contact_phone: "0400 111 222",
    billing_email: "accounts@bright.example",
    notes: "Prefers email follow-up.",
  },
  {
    id: "tenant-2",
    entity_id: entityId,
    legal_name: "Northwind Fitness Pty Ltd",
    trading_name: "Northwind Fitness",
    abn: "56123456789",
    contact_name: "Leo Nguyen",
    contact_email: "leo@example.com",
    contact_phone: "0400 333 444",
    billing_email: null,
    notes: null,
  },
];

const tenantOnboardings = [
  {
    id: "onboarding-1",
    entity_id: entityId,
    lease_id: leaseId,
    tenant_id: tenantId,
    token: "tenant-token-1",
    status: "sent",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    last_sent_at: "2026-05-18T09:30:00.000Z",
    resent_at: null,
    cancel_reason: null,
    onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
    submitted_data: {},
    submitted_at: null,
    review_data: {},
    delivery_data: {
      last_attempted_at: "2026-05-18T09:30:00.000Z",
      channels: {
        email: {
          channel: "email",
          status: "sent",
          provider: "mock",
          attempted_at: "2026-05-18T09:30:00.000Z",
          recipient: "mia@example.com",
        },
      },
    },
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-18T09:30:00.000Z",
    updated_at: "2026-05-18T09:30:00.000Z",
    deleted_at: null,
  },
];

const obligations = [
  {
    id: "obligation-1",
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    lease_id: leaseId,
    title: "Insurance certificate renewal",
    category: "insurance",
    status: "open",
    due_date: "2026-05-24",
    completed_at: null,
    priority: 1,
    owner_role: "property_manager",
    notes: "Tenant needs to provide updated public liability certificate.",
    metadata: {},
  },
];

const maintenanceWorkOrders = [
  {
    id: "work-order-1",
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    title: "Air conditioning fault",
    description: "Tenant reported warm air from the shopfront unit.",
    status: "awaiting_approval",
    priority: "urgent",
    requested_at: "2026-05-19T01:00:00.000Z",
    contractor_name: "Cool Air Services",
    contractor_email: "service@coolair.example",
    contractor_phone: "07 3000 1111",
    contractor_assigned_at: "2026-05-19T02:00:00.000Z",
    approval_required: true,
    approval_status: "pending",
    approval_limit_cents: 50000,
    quote_amount_cents: 64000,
    approved_by_user_id: null,
    approved_at: null,
    approval_notes: null,
    source_document_id: null,
    invoice_draft_id: null,
    invoice_reference: null,
    invoice_amount_cents: null,
    source_reference: "Tenant email",
    due_date: "2026-05-20",
    completed_at: null,
    notes: "Needs owner approval before work proceeds.",
    document_ids: [],
    photo_document_ids: [],
    metadata: {},
    created_at: "2026-05-19T01:00:00.000Z",
    updated_at: "2026-05-19T02:00:00.000Z",
    deleted_at: null,
  },
];

const arrearsCases = [
  {
    id: "arrears-1",
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    status: "active",
    currency: "AUD",
    as_of: "2026-05-20",
    balance_current_cents: 0,
    balance_1_30_cents: 880000,
    balance_31_60_cents: 0,
    balance_61_90_cents: 0,
    balance_90_plus_cents: 0,
    total_balance_cents: 880000,
    oldest_unpaid_invoice_date: "2026-05-01",
    last_invoice_date: "2026-05-01",
    source_reference: "May invoice run",
    reminder_stage: 1,
    reminder_frequency_days: 7,
    next_reminder_on: "2026-05-20",
    last_reminder_at: null,
    reminder_paused_until: null,
    dispute_status: "raised",
    dispute_notes: "Tenant queried outgoings allocation.",
    promise_to_pay_date: "2026-05-27",
    promise_to_pay_amount_cents: 880000,
    promise_to_pay_notes: "Tenant expects to clear after statement review.",
    escalation_status: "none",
    escalation_queue: null,
    escalated_at: null,
    assigned_user_id: operatorId,
    notes: "Follow up after statement pack is sent.",
    metadata: {},
    created_at: "2026-05-18T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    deleted_at: null,
  },
];

const rentRoll = [
  {
    entity_id: entityId,
    entity_name: "Acme Holdings Pty Ltd",
    property_id: propertyId,
    property_name: "Queen Street Retail Centre",
    tenancy_unit_id: unitId,
    unit_label: "Shop 3",
    lease_id: leaseId,
    tenant_id: tenantId,
    tenant_name: "Bright Cafe",
    lease_status: "active",
    commencement_date: "2025-07-01",
    expiry_date: "2028-06-30",
    tenant_billing_email: "accounts@bright.example",
    annual_rent_cents: 9600000,
    rent_frequency: "monthly",
    charge_rules: [
      {
        id: "charge-1",
        charge_type: "base_rent",
        amount_cents: 800000,
        frequency: "monthly",
        gst_treatment: "taxable",
        xero_account_code: "401",
        xero_tax_type: null,
        start_date: "2025-07-01",
        end_date: null,
        next_due_date: "2026-06-01",
        arrears_or_advance: "advance",
      },
    ],
    charge_rules_total_cents: 800000,
    next_due_date: "2026-06-01",
    gst_readiness_blockers: [],
    xero_readiness_blockers: ["Missing Xero tax type"],
    invoice_readiness_blockers: [],
  },
];

const billingDrafts = [
  {
    id: "billing-draft-1",
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    document_id: "document-1",
    document_intake_id: "intake-1",
    status: "approved",
    title: "May rent and outgoings",
    currency: "AUD",
    issue_date: "2026-05-01",
    due_date: "2026-05-15",
    total_cents: 880000,
    notes: "Prepared from the reviewed rent schedule.",
    metadata: {},
    lines: [
      {
        id: "billing-draft-line-1",
        billing_draft_id: "billing-draft-1",
        description: "Base rent",
        amount_cents: 800000,
        currency: "AUD",
        source_hint: "Rent schedule",
        confidence: 0.92,
        metadata: {},
        created_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
      {
        id: "billing-draft-line-2",
        billing_draft_id: "billing-draft-1",
        description: "GST",
        amount_cents: 80000,
        currency: "AUD",
        source_hint: "GST schedule",
        confidence: 0.88,
        metadata: {},
        created_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
];

const invoiceDrafts = [
  {
    id: "invoice-draft-1",
    entity_id: entityId,
    billing_draft_id: "billing-draft-1",
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    document_id: "document-1",
    document_intake_id: "intake-1",
    status: "approved",
    invoice_number: "INV-1001",
    title: "May rent and outgoings",
    currency: "AUD",
    issue_date: "2026-05-01",
    due_date: "2026-05-15",
    subtotal_cents: 800000,
    gst_cents: 80000,
    total_cents: 880000,
    issuer_name: "Queen Street Trustee Pty Ltd",
    issuer_abn: "22123456789",
    recipient_name: "Bright Cafe Pty Ltd",
    recipient_email: "accounts@bright.example",
    notes: "Approved internal invoice draft.",
    metadata: {
      readiness_blockers: [],
      delivery_state: {
        pdf_preview_generated: true,
        pdf_artifact_stored: true,
        tenant_email_prepared: true,
        delivery_ready: true,
        tenant_email_sent: false,
      },
      delivery_preview: {
        email: {
          to: "accounts@bright.example",
          subject: "Invoice INV-1001",
          body: "Please find your invoice attached.",
        },
      },
      pdf_artifact: {
        document_id: "document-1",
      },
      delivery_email: {
        send: {
          status: "draft",
        },
      },
      payment_status: {
        status: "unpaid",
      },
    },
    lines: [
      {
        id: "invoice-draft-line-1",
        invoice_draft_id: "invoice-draft-1",
        billing_draft_line_id: "billing-draft-line-1",
        description: "Base rent",
        amount_cents: 800000,
        gst_cents: 80000,
        currency: "AUD",
        source_hint: "Rent schedule",
        metadata: {},
        created_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
];

const documentIntakes = [
  {
    id: "intake-1",
    entity_id: entityId,
    document_id: "document-1",
    status: "ready_for_review",
    document_type: "lease",
    summary: "Lease summary is ready for review.",
    confidence: 0.86,
    extracted_data: {
      document_type: "lease",
      summary: "Lease summary is ready for review.",
      confidence: 0.86,
      parties: [{ name: "Bright Cafe Pty Ltd", role: "tenant" }],
      properties: [
        { name: "Queen Street Retail Centre", unit_label: "Shop 3" },
      ],
      key_dates: [{ label: "Rent review", date: "2026-07-01" }],
      money_amounts: [{ label: "Annual rent", amount: 96000, currency: "AUD" }],
      obligations: [],
      suggested_links: { tenant_name: "Bright Cafe Pty Ltd" },
      warnings: [],
      missing_information: [],
    },
    review_data: {},
    openai_response_id: "resp-smoke",
    error_message: null,
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-18T08:30:00.000Z",
    updated_at: "2026-05-18T08:30:00.000Z",
    filename: "bright-cafe-lease.pdf",
    content_type: "application/pdf",
    byte_size: 45000,
    category: "lease",
  },
];

const tenancyUnits = [
  {
    id: unitId,
    property_id: propertyId,
    unit_label: "Shop 3",
    sqm: 110,
    parking_spaces: 2,
    metadata: {},
    created_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
];

const leases = [
  {
    id: leaseId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    status: "active",
    commencement_date: "2025-07-01",
    expiry_date: "2028-06-30",
    annual_rent_cents: 9600000,
    rent_frequency: "monthly",
    outgoings_recoverable: true,
    next_review_date: "2026-07-01",
    option_summary: "One further term of three years.",
    security_summary: "Bank guarantee held.",
    notes: null,
  },
];

const tenantPortalSession = () => ({
  auth: {
    mode: "tenant_portal_token",
    token_source: "header",
    tenant_auth_configured: false,
    dev_fallback: false,
    boundary: "tenant_onboarding_token",
    detail:
      "Tenant identity-provider auth is not wired yet. Access is scoped to the tenant linked to this onboarding token.",
  },
  tenant: {
    id: tenantId,
    legal_name: "Bright Cafe Pty Ltd",
    trading_name: "Bright Cafe",
    contact_name: "Mia Hart",
    contact_email: "mia@example.com",
    contact_phone: "0400 111 222",
    billing_email: "accounts@bright.example",
  },
  lease: {
    lease_id: leaseId,
    status: "active",
    property_name: "Queen Street Retail Centre",
    property_address: "12 Queen Street, Brisbane City, QLD, 4000",
    unit_label: "Shop 3",
    commencement_date: "2025-07-01",
    expiry_date: "2028-06-30",
    next_review_date: "2026-07-01",
  },
  onboarding: {
    id: "onboarding-1",
    status: "sent",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    submitted_at: null,
    last_sent_at: "2026-05-18T09:30:00.000Z",
    document_count: 1,
  },
  compliance: {
    uploads_enabled: true,
    accepted_categories: ["insurance", "bank_guarantee", "lease", "onboarding", "other"],
    items: [
      {
        key: "insurance",
        label: "Insurance",
        status: "received",
        document_count: 1,
        latest_document: {
          id: "portal-document-1",
          filename: "bright-cafe-insurance.pdf",
          content_type: "application/pdf",
          byte_size: 45000,
          category: "insurance",
          notes: "Current certificate.",
          source: "tenant_onboarding",
          created_at: "2026-05-18T09:35:00.000Z",
        },
        due_date: "2027-06-30",
      },
      {
        key: "bank_guarantee",
        label: "Bank guarantee",
        status: "not_on_file",
        document_count: 0,
        latest_document: null,
        due_date: null,
      },
      {
        key: "onboarding",
        label: "Onboarding files",
        status: "not_on_file",
        document_count: 0,
        latest_document: null,
        due_date: null,
      },
    ],
    uploaded_documents: [
      {
        id: "portal-document-1",
        filename: "bright-cafe-insurance.pdf",
        content_type: "application/pdf",
        byte_size: 45000,
        category: "insurance",
        notes: "Current certificate.",
        source: "tenant_onboarding",
        created_at: "2026-05-18T09:35:00.000Z",
      },
    ],
  },
  invoices: [
    {
      id: "invoice-draft-1",
      invoice_number: "INV-1001",
      title: "May rent and outgoings",
      status: "approved",
      issue_date: "2026-05-01",
      due_date: "2026-05-15",
      currency: "AUD",
      subtotal_cents: 800000,
      gst_cents: 80000,
      total_cents: 880000,
      paid_cents: 0,
      outstanding_cents: 880000,
      payment_status: "unpaid",
      pdf_document_id: "document-1",
      lines: [
        {
          id: "invoice-draft-line-1",
          description: "Base rent",
          amount_cents: 800000,
          gst_cents: 80000,
          currency: "AUD",
        },
      ],
    },
  ],
  payment_summary: {
    invoice_count: 1,
    total_cents: 880000,
    paid_cents: 0,
    outstanding_cents: 880000,
    overdue_count: 1,
    next_due_date: "2026-05-15",
    status: "overdue",
    manual_only: true,
  },
  maintenance_requests: maintenanceWorkOrders
    .filter((workOrder) => workOrder.tenant_id === tenantId)
    .map((workOrder) => ({
      id: workOrder.id,
      title: workOrder.title,
      description: workOrder.description,
      status: workOrder.status,
      priority: workOrder.priority,
      requested_at: workOrder.requested_at,
      source_reference: workOrder.source_reference,
      due_date: workOrder.due_date,
      completed_at: workOrder.completed_at,
      document_ids: workOrder.document_ids,
      photo_document_ids: workOrder.photo_document_ids,
      created_at: workOrder.created_at,
    })),
  notification_preferences: {
    email_enabled: true,
    sms_enabled: true,
    billing_email_enabled: true,
    compliance_reminders_enabled: true,
    preferred_channel: "both",
    updated_at: null,
  },
  guardrails: [
    "Tenant portal responses are scoped to the tenant attached to the onboarding token.",
    "Only approved invoice drafts are visible to tenants.",
    "Notification preference updates do not send email or SMS.",
  ],
});

const securityWorkspace = () => ({
  auth: {
    auth_mode: "dev",
    dev_auth_active: true,
    clerk_secret_configured: false,
    clerk_jwks_configured: false,
    operator_login_enforced: false,
    login_boundary: "Development operator identity",
    next_steps: [
      "Switch AUTH_MODE to clerk before sending real operator invites.",
      "Set CLERK_SECRET_KEY before enabling provider-backed login.",
    ],
  },
  current_user: {
    id: operatorId,
    organisation_id: "org-1",
    email: "owner@example.com",
    display_name: "Owner Operator",
  },
  organisation: {
    id: "org-1",
    name: "Acme Holdings",
    country_code: "AU",
    timezone: "Australia/Brisbane",
    created_at: "2026-05-01T00:00:00.000Z",
  },
  members: [
    {
      id: operatorId,
      email: "owner@example.com",
      display_name: "Owner Operator",
      is_active: true,
      login_linked: true,
      invite_email_status: "accepted",
      invite_email_detail: "Provider login is linked for this operator.",
      invite_sent_at: "2026-05-01T00:00:00.000Z",
      invite_expires_at: "2026-05-04T00:00:00.000Z",
      invite_accepted_at: "2026-05-01T00:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      roles: [
        {
          entity_id: entityId,
          entity_name: "Acme Holdings Pty Ltd",
          role: "owner",
        },
      ],
    },
  ],
  current_user_roles: [
    {
      entity_id: entityId,
      entity_name: "Acme Holdings Pty Ltd",
      role: "owner",
    },
  ],
  can_manage_security: true,
});

const securityBootstrapStatus = () => ({
  available: true,
  reason: "No production workspace exists yet.",
  auth: {
    auth_mode: "clerk",
    dev_auth_active: false,
    clerk_secret_configured: true,
    clerk_jwks_configured: true,
    operator_login_enforced: true,
    login_boundary: "Production operator login",
    next_steps: [],
  },
  organisation_count: 0,
  entity_count: 0,
  operator_count: 0,
});

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-origin": "*",
};

async function fulfillJson(route: Route, body: JsonBody, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    headers: corsHeaders,
    status,
  });
}

export async function mockLeasiumApi(page: Page) {
  let xeroTenantId: string | null = null;
  let xeroConnectedAt: string | null = null;
  let xeroProviderConnected = false;
  let chargeAccountCode: string | null = "401";
  let chargeTaxType: string | null = null;
  let appliedContactMappings: XeroContactMapping[] = [];
  let snapshotCount = 0;
  let insightSnapshots: JsonBody[] = [];

  const xeroConnection = () => ({
    entity_id: entityId,
    entity_name: "Acme Holdings Pty Ltd",
    connected: Boolean(xeroTenantId),
    xero_tenant_id: xeroTenantId,
    tenant_name: xeroTenantId ? "Demo Xero Org" : null,
    tenant_type: xeroTenantId ? "ORGANISATION" : null,
    connected_at: xeroConnectedAt,
    last_sync_at: null,
    last_contact_sync_at: null,
    provider_configured: true,
    provider_connection_id: xeroProviderConnected ? "xero-connection-1" : null,
    connection_source: xeroProviderConnected ? "provider" : xeroTenantId ? "manual" : "none",
    status_label: xeroProviderConnected
      ? "Provider connected"
      : xeroTenantId
        ? "Connected"
        : "Not connected",
    next_action: xeroTenantId
      ? "Preview Xero contacts, then review local mappings before approving any sync."
      : "Connect Xero or record the tenant before any sync approval can be enabled.",
  });

  const xeroStatus = () => {
    const issues = [];
    if (!xeroTenantId) {
      issues.push({
        id: `connection-${entityId}`,
        kind: "connection",
        severity: "blocker",
        label: "Xero is not connected",
        detail: "This entity has no Xero tenant recorded yet.",
        action: "Record the Xero tenant before approving invoice sync.",
        property_id: null,
        property_name: null,
        tenancy_unit_id: null,
        unit_label: null,
        lease_id: null,
        tenant_id: null,
        tenant_name: null,
        charge_rule_id: null,
        charge_type: null,
        current_account_code: null,
        current_tax_type: null,
        suggested_account_code: null,
        suggested_tax_type: null,
      });
    }
    if (!chargeTaxType) {
      issues.push({
        id: "tax-charge-1",
        kind: "tax",
        severity: "blocker",
        label: "Base Rent tax type missing",
        detail:
          "Queen Street Retail Centre / Shop 3 is taxable and needs a Xero tax type.",
        action: "Review and apply the suggested tax mapping.",
        property_id: propertyId,
        property_name: "Queen Street Retail Centre",
        tenancy_unit_id: unitId,
        unit_label: "Shop 3",
        lease_id: leaseId,
        tenant_id: tenantId,
        tenant_name: "Bright Cafe",
        charge_rule_id: "charge-1",
        charge_type: "base_rent",
        current_account_code: chargeAccountCode,
        current_tax_type: chargeTaxType,
        suggested_account_code: "200",
        suggested_tax_type: "OUTPUT",
      });
    }
    return {
      provider: {
        configured: true,
        missing_config: [],
        redirect_uri: "http://localhost:8000/api/v1/xero/oauth/callback",
        scopes: [
          "offline_access",
          "accounting.contacts.read",
          "accounting.settings.read",
          "accounting.transactions",
        ],
      },
      connection: xeroConnection(),
      contact_mapping: { total: 2, ready: 2, missing: 0 },
      chart_mapping: {
        total: 1,
        ready: chargeAccountCode ? 1 : 0,
        missing: chargeAccountCode ? 0 : 1,
      },
      tax_mapping: {
        total: 1,
        ready: chargeTaxType ? 1 : 0,
        missing: chargeTaxType ? 0 : 1,
      },
      invoice_sync: {
        total_invoice_drafts: 1,
        approved_unsynced: 1,
        synced: 0,
        blocked: 0,
      },
      payment_reconciliation: {
        unpaid: 0,
        partially_paid: 0,
        paid: 0,
        reconciliation_ready: 0,
      },
      issues,
      guardrails: [
        "Xero contact apply only saves reviewed local mappings; it does not mutate Xero.",
        "Invoice posting remains blocked until a future explicit approval action exists.",
        "Payment reconciliation is manual status tracking until bank/Xero feeds are connected.",
      ],
    };
  };

  const xeroChartTaxValidationPreview = () => {
    const chartReady = chargeAccountCode === "401" || chargeAccountCode === "200";
    const taxReady = chargeTaxType === "OUTPUT";
    const resultStatus =
      chartReady && taxReady ? "ready" : chargeTaxType ? "not_found" : "needs_mapping";
    const blockers = [
      ...(chartReady
        ? []
        : chargeAccountCode
          ? [`Account code ${chargeAccountCode} was not found in Xero.`]
          : ["Xero account code is missing."]),
      ...(taxReady
        ? []
        : chargeTaxType
          ? [`Tax type ${chargeTaxType} was not found in Xero.`]
          : ["Taxable charge is missing a Xero tax type."]),
    ];

    return {
      entity_id: entityId,
      xero_tenant_id: xeroTenantId ?? "tenant-smoke",
      tenant_name: "Demo Xero Org",
      fetched_accounts: 2,
      fetched_tax_rates: 2,
      checked_rules: 1,
      results: [
        {
          charge_rule_id: "charge-1",
          charge_type: "base_rent",
          property_name: "Queen Street Retail Centre",
          unit_label: "Shop 3",
          tenant_name: "Bright Cafe",
          account_code: chargeAccountCode,
          account_name: chartReady ? "Rental Income" : null,
          account_status: chartReady ? "ACTIVE" : null,
          account_valid: chartReady,
          tax_type: chargeTaxType,
          tax_name: taxReady ? "GST on Income" : null,
          tax_valid: taxReady,
          suggested_account_code: "200",
          suggested_tax_type: "OUTPUT",
          status: resultStatus,
          blockers,
        },
      ],
      validated_at: "2026-05-19T10:12:00.000Z",
      guardrails: [
        "This preview validates local charge-rule mappings against provider chart and tax settings only.",
        "No invoice posting or tenant email is triggered by chart/tax validation.",
        "Payment reconciliation remains separate and manual.",
      ],
    };
  };

  const xeroInvoicePostingPreview = () => ({
    entity_id: entityId,
    xero_tenant_id: xeroTenantId ?? "tenant-smoke",
    tenant_name: "Demo Xero Org",
    checked_invoices: 1,
    ready_count: 1,
    blocked_count: 0,
    results: [
      {
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        title: "May rent and outgoings",
        status: "ready",
        xero_contact_id: "contact-bright-cafe",
        contact_name: "Bright Cafe",
        issue_date: "2026-05-01",
        due_date: "2026-05-15",
        currency: "AUD",
        total_cents: 880000,
        line_count: 1,
        line_items: [
          {
            description: "Base rent",
            quantity: 1,
            unit_amount: 8000,
            account_code: "401",
            tax_type: "OUTPUT",
            line_amount: 8000,
            source_line_id: "invoice-draft-line-1",
          },
        ],
        blockers: [],
        payload_preview: {
          Type: "ACCREC",
          Contact: { ContactID: "contact-bright-cafe" },
          LineItems: [{ Description: "Base rent", AccountCode: "401" }],
        },
      },
    ],
    prepared_at: "2026-05-19T10:20:00.000Z",
    guardrails: [
      "No Xero posting, email, or payment mutation is performed by this preview.",
      "The preview builds local payloads only and does not create Xero invoices.",
      "Payment reconciliation remains manual until a separate approval path exists.",
    ],
  });

  const insightsOverview = () => {
    const xero = xeroStatus();
    return {
      entity: {
        id: entityId,
        name: "Acme Holdings Pty Ltd",
        gst_registered: true,
        xero_connected: Boolean(xeroTenantId),
        xero_last_sync_at: null,
      },
      as_of: "2026-05-19",
      portfolio_health: {
        property_count: 1,
        tenant_count: 2,
        unit_count: 1,
        active_lease_count: 1,
        vacant_unit_count: 0,
        overdue_obligation_count: 0,
        due_soon_obligation_count: 1,
        open_obligation_count: 1,
        smart_intake_waiting_count: 1,
        tenant_onboarding_waiting_count: 1,
      },
      live_exceptions: [
        {
          id: "obligation-obligation-1",
          kind: "obligation",
          severity: "warning",
          title: "Insurance certificate renewal",
          detail: "Insurance obligation due 2026-05-24.",
          chip: "In 5d",
          due_date: "2026-05-24",
          source: "Tasks",
          href: "/tasks",
          target: {
            property_id: propertyId,
            tenancy_unit_id: unitId,
            lease_id: leaseId,
            tenant_id: null,
            document_intake_id: null,
            obligation_id: "obligation-1",
            billing_draft_id: null,
            invoice_draft_id: null,
          },
          rank: 5,
        },
        {
          id: "smart-intake-intake-1",
          kind: "smart_intake",
          severity: "primary",
          title: "bright-cafe-lease.pdf",
          detail: "Lease summary is ready for review.",
          chip: "Ready For Review",
          due_date: null,
          source: "Smart Intake",
          href: "/intake?review=intake-1",
          target: {
            property_id: null,
            tenancy_unit_id: null,
            lease_id: null,
            tenant_id: null,
            document_intake_id: "intake-1",
            obligation_id: null,
            billing_draft_id: null,
            invoice_draft_id: null,
          },
          rank: -1,
        },
        ...xero.issues.map((issue, index) => ({
          id: `xero-${issue.id}`,
          kind: "xero_readiness",
          severity: issue.severity === "blocker" ? "danger" : "warning",
          title: issue.label,
          detail: issue.detail,
          chip: issue.severity === "blocker" ? "Blocker" : "Warning",
          due_date: null,
          source: "Xero Readiness",
          href: "/settings",
          target: {
            property_id: issue.property_id,
            tenancy_unit_id: issue.tenancy_unit_id,
            lease_id: issue.lease_id,
            tenant_id: issue.tenant_id,
            document_intake_id: null,
            obligation_id: null,
            billing_draft_id: null,
            invoice_draft_id: null,
          },
          rank: index + 1,
        })),
      ],
      automation_activity: [
        {
          id: "activity-1",
          occurred_at: "2026-05-19T10:00:00.000Z",
          kind: "smart_intake_apply",
          label: "Apply document intake",
          detail: "Created reviewed lease records from Smart Intake.",
          source: "smart_intake_apply",
          target_table: "document_intake",
          target_id: "intake-1",
          outcome: "success",
        },
      ],
      billing_risk: {
        ready_to_bill_count: chargeTaxType ? 1 : 0,
        blocked_row_count: chargeTaxType ? 0 : 1,
        blocker_count: chargeTaxType ? 0 : 1,
        configured_charges_cents: 800000,
        billing_draft_counts: { approved: 1 },
        invoice_draft_counts: { ready_for_approval: 1 },
        xero_issue_count: xero.issues.length,
        xero_blocker_count: xero.issues.filter(
          (issue) => issue.severity === "blocker",
        ).length,
        approved_unsynced_invoice_count: 1,
        unpaid_invoice_count: 1,
      },
      finance_snapshot: {
        configured_charges_cents: 800000,
        ready_to_bill_count: chargeTaxType ? 1 : 0,
        blocked_row_count: chargeTaxType ? 0 : 1,
        approved_unsynced_invoice_count: 1,
        unpaid_invoice_count: 1,
        billing_draft_counts: { approved: 1 },
        invoice_draft_counts: { ready_for_approval: 1 },
      },
      owner_entity_snapshot: {
        ownership_profile_counts: { trust: 1 },
        missing_invoice_issuer_count: 0,
        missing_owner_abn_count: 0,
        missing_trustee_count: 0,
        missing_ownership_split_count: 0,
        missing_xero_contact_count: 0,
        entity_gst_registered: true,
        xero_connected: Boolean(xeroTenantId),
        xero_last_sync_at: null,
      },
      lease_event_snapshot: {
        active_lease_count: 1,
        next_review_count: 1,
        next_expiry_count: 0,
        overdue_obligation_count: 0,
        due_soon_obligation_count: 1,
        tenant_onboarding_waiting_count: 1,
        next_events: [
          {
            id: `rent-review-${leaseId}`,
            kind: "rent_review",
            title: "Bright Cafe Pty Ltd rent review - Queen Street Retail Centre, Shop 3",
            date: "2026-07-01",
            chip: "01 Jul 2026",
            href: "/properties",
            target: {
              property_id: propertyId,
              tenancy_unit_id: unitId,
              lease_id: leaseId,
              tenant_id: tenantId,
              document_intake_id: null,
              obligation_id: null,
              billing_draft_id: null,
              invoice_draft_id: null,
            },
            rank: 43,
          },
        ],
      },
      guardrails: [
        "Insights is read-only and does not mutate portfolio records.",
        "Billing and Xero risk counts come from readiness checks; no invoice posting or sync runs here.",
        "Automation activity is summarized from audit logs without exposing tool inputs.",
      ],
    };
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");

    if (method === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (method === "GET" && path === "/entities") {
      await fulfillJson(
        route,
        entities.map((entity) => ({
          ...entity,
          xero_tenant_id: xeroTenantId,
          xero_connected_at: xeroConnectedAt,
        })),
      );
      return;
    }

    if (method === "GET" && path === "/security/workspace") {
      await fulfillJson(route, securityWorkspace());
      return;
    }

    if (method === "GET" && path === "/security/bootstrap/status") {
      await fulfillJson(route, securityBootstrapStatus());
      return;
    }

    if (method === "GET" && path === "/xero/status") {
      await fulfillJson(route, xeroStatus());
      return;
    }

    if (method === "GET" && path === "/xero/oauth/start") {
      xeroTenantId = xeroTenantId ?? "tenant-smoke";
      xeroConnectedAt = xeroConnectedAt ?? "2026-05-19T10:00:00.000Z";
      xeroProviderConnected = true;
      await fulfillJson(route, {
        configured: true,
        authorization_url: null,
        missing_config: [],
        redirect_uri: "http://localhost:8000/api/v1/xero/oauth/callback",
        scopes: [
          "offline_access",
          "accounting.contacts.read",
          "accounting.settings.read",
          "accounting.transactions",
        ],
        state_expires_at: "2026-05-19T10:15:00.000Z",
      });
      return;
    }

    if (method === "GET" && path === "/insights/overview") {
      await fulfillJson(route, insightsOverview());
      return;
    }

    if (method === "POST" && path === "/insights/snapshots") {
      const payload = request.postDataJSON() as {
        snapshot_type?: string;
        as_of?: string;
      };
      snapshotCount += 1;
      const token = `snapshot-token-${snapshotCount}`;
      const snapshot = {
        id: `snapshot-${snapshotCount}`,
        entity_id: entityId,
        snapshot_type: payload.snapshot_type ?? "owner",
        as_of: payload.as_of ?? "2026-05-19",
        created_at: "2026-05-19T10:00:00.000Z",
        expires_at: "2026-06-18T10:00:00.000Z",
        revoked_at: null,
        payload: insightsOverview(),
        share_url: null,
      };
      insightSnapshots = [snapshot, ...insightSnapshots];
      await fulfillJson(
        route,
        {
          ...snapshot,
          token,
          share_url: `/snapshots/${token}`,
        },
        201,
      );
      return;
    }

    if (method === "GET" && path === "/insights/snapshots") {
      await fulfillJson(route, insightSnapshots);
      return;
    }

    if (method === "GET" && path.startsWith("/insights/snapshots/public/")) {
      const token = path.split("/").pop();
      const tokenIndex = Number(token?.replace("snapshot-token-", "")) - 1;
      const snapshot = insightSnapshots[tokenIndex] as
        | { [key: string]: JsonBody }
        | undefined;
      if (!snapshot || snapshot.revoked_at) {
        await fulfillJson(route, { detail: "Insights snapshot not found." }, 404);
        return;
      }
      await fulfillJson(route, {
        id: snapshot.id,
        snapshot_type: snapshot.snapshot_type,
        as_of: snapshot.as_of,
        created_at: snapshot.created_at,
        expires_at: snapshot.expires_at,
        payload: snapshot.payload,
        guardrails: [
          "This is a frozen snapshot, not a live portfolio connection.",
          "The public link cannot mutate Leasium records.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path.startsWith("/insights/snapshots/") &&
      path.endsWith("/revoke")
    ) {
      const snapshotId = path.split("/").at(-2);
      insightSnapshots = insightSnapshots.map((snapshot) => {
        const row = snapshot as { [key: string]: JsonBody };
        if (row.id === snapshotId) {
          return { ...row, revoked_at: "2026-05-19T10:30:00.000Z" };
        }
        return row;
      });
      const revoked = insightSnapshots.find(
        (snapshot) => (snapshot as { [key: string]: JsonBody }).id === snapshotId,
      );
      await fulfillJson(route, revoked ?? { detail: "Insights snapshot not found." });
      return;
    }

    if (method === "PATCH" && path === `/xero/connection/${entityId}`) {
      const payload = request.postDataJSON() as {
        connected?: boolean;
        xero_tenant_id?: string | null;
      };
      if (payload.connected === false) {
        xeroTenantId = null;
        xeroConnectedAt = null;
        xeroProviderConnected = false;
      } else {
        xeroTenantId = payload.xero_tenant_id ?? "tenant-smoke";
        xeroConnectedAt = "2026-05-19T10:00:00.000Z";
        xeroProviderConnected = false;
      }
      await fulfillJson(route, xeroConnection());
      return;
    }

    if (method === "POST" && path === `/xero/contacts/sync-preview/${entityId}`) {
      xeroTenantId = xeroTenantId ?? "tenant-smoke";
      xeroConnectedAt = xeroConnectedAt ?? "2026-05-19T10:00:00.000Z";
      xeroProviderConnected = true;
      const brightCafeMapping = appliedContactMappings.find(
        (mapping) =>
          mapping.target_type === "tenant" && mapping.target_id === tenantId,
      );
      await fulfillJson(route, {
        entity_id: entityId,
        xero_tenant_id: xeroTenantId,
        tenant_name: "Demo Xero Org",
        fetched_contacts: 2,
        suggested_matches: [
          {
            target_type: "tenant",
            target_id: tenantId,
            target_name: "Bright Cafe",
            current_xero_contact_id: brightCafeMapping?.xero_contact_id ?? null,
            xero_contact_id: "contact-bright-cafe",
            xero_contact_name: "Bright Cafe",
            xero_email: "accounts@bright.example",
            match_reason: "billing/contact email matched",
            confidence: 0.94,
          },
        ],
        last_contact_sync_at: "2026-05-19T10:05:00.000Z",
        guardrails: [
          "This is a preview only; tenant and property Xero contact IDs were not changed.",
          "Invoice posting and payment reconciliation are still blocked behind future approvals.",
        ],
      });
      return;
    }

    if (method === "POST" && path === `/xero/contacts/apply-preview/${entityId}`) {
      const payload = request.postDataJSON() as {
        mappings?: Partial<XeroContactMapping>[];
      };
      const appliedAt = "2026-05-19T10:10:00.000Z";
      const appliedMappings: XeroContactMapping[] = [];
      const skippedMappings: JsonBody[] = [];

      for (const mapping of payload.mappings ?? []) {
        if (
          (mapping.target_type === "tenant" || mapping.target_type === "property") &&
          mapping.target_id &&
          mapping.xero_contact_id
        ) {
          const appliedMapping: XeroContactMapping = {
            target_type: mapping.target_type,
            target_id: mapping.target_id,
            target_name: mapping.target_name ?? mapping.target_id,
            xero_contact_id: mapping.xero_contact_id,
            xero_contact_name: mapping.xero_contact_name ?? mapping.xero_contact_id,
            xero_email: mapping.xero_email ?? null,
          };
          appliedMappings.push(appliedMapping);
          continue;
        }
        skippedMappings.push({
          target_type:
            mapping.target_type === "tenant" || mapping.target_type === "property"
              ? mapping.target_type
              : "tenant",
          target_id: mapping.target_id ?? "unknown",
          target_name: mapping.target_name ?? "Unknown target",
          previous_xero_contact_id: null,
          xero_contact_id: mapping.xero_contact_id ?? "unknown",
          xero_contact_name: mapping.xero_contact_name ?? "Unknown contact",
          status: "skipped",
          reason: "Mapping needs a tenant/property target and Xero contact ID.",
        });
      }

      appliedContactMappings = [
        ...appliedMappings,
        ...appliedContactMappings.filter(
          (existing) =>
            !appliedMappings.some(
              (mapping) =>
                mapping.target_type === existing.target_type &&
                mapping.target_id === existing.target_id,
            ),
        ),
      ];

      await fulfillJson(route, {
        entity_id: entityId,
        applied_mappings: appliedMappings.map((mapping) => ({
          ...mapping,
          previous_xero_contact_id: null,
          status: "applied",
          reason: "Reviewed mapping was saved locally.",
        })),
        skipped_mappings: skippedMappings,
        guardrails: [
          "Only reviewed tenant/property contact IDs were updated locally.",
          "No invoice posting, tenant email, or payment reconciliation was run.",
          "Provider contacts can be re-previewed before future approval actions.",
        ],
        applied_at: appliedAt,
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/chart-tax/validate-preview/${entityId}`
    ) {
      xeroTenantId = xeroTenantId ?? "tenant-smoke";
      xeroConnectedAt = xeroConnectedAt ?? "2026-05-19T10:00:00.000Z";
      xeroProviderConnected = true;
      await fulfillJson(route, xeroChartTaxValidationPreview());
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/invoices/posting-preview/${entityId}`
    ) {
      xeroTenantId = xeroTenantId ?? "tenant-smoke";
      xeroConnectedAt = xeroConnectedAt ?? "2026-05-19T10:00:00.000Z";
      xeroProviderConnected = true;
      await fulfillJson(route, xeroInvoicePostingPreview());
      return;
    }

    if (method === "GET" && path === `/premises/by-entity/${entityId}`) {
      await fulfillJson(route, properties);
      return;
    }

    if (method === "GET" && path === "/tenants") {
      await fulfillJson(route, tenants);
      return;
    }

    if (method === "GET" && path === `/tenants/${tenantId}`) {
      await fulfillJson(route, tenants[0]);
      return;
    }

    if (method === "GET" && path === "/tenant-onboarding") {
      await fulfillJson(route, tenantOnboardings);
      return;
    }

    if (method === "GET" && path === "/tenant-portal/session") {
      await fulfillJson(route, tenantPortalSession());
      return;
    }

    if (method === "POST" && path === "/tenant-portal/maintenance-requests") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const created = {
        ...maintenanceWorkOrders[0],
        ...payload,
        id: "portal-work-order-created",
        entity_id: entityId,
        property_id: propertyId,
        tenancy_unit_id: unitId,
        tenant_id: tenantId,
        lease_id: leaseId,
        status: "requested",
        priority: String(payload.priority ?? "normal"),
        requested_at: "2026-05-20T03:00:00.000Z",
        contractor_name: null,
        contractor_email: null,
        contractor_phone: null,
        contractor_assigned_at: null,
        approval_required: false,
        approval_status: "not_required",
        approval_limit_cents: null,
        quote_amount_cents: null,
        approved_by_user_id: null,
        approved_at: null,
        approval_notes: null,
        source_document_id: null,
        invoice_draft_id: null,
        invoice_reference: null,
        invoice_amount_cents: null,
        source_reference:
          typeof payload.source_reference === "string"
            ? payload.source_reference
            : null,
        due_date: null,
        completed_at: null,
        notes: null,
        document_ids: [],
        photo_document_ids: [],
        metadata: { source: "tenant_portal" },
        created_at: "2026-05-20T03:00:00.000Z",
        updated_at: "2026-05-20T03:00:00.000Z",
        deleted_at: null,
      };
      maintenanceWorkOrders.unshift(created);
      await fulfillJson(
        route,
        {
          id: created.id,
          title: created.title,
          description: created.description,
          status: created.status,
          priority: created.priority,
          requested_at: created.requested_at,
          source_reference: created.source_reference,
          due_date: created.due_date,
          completed_at: created.completed_at,
          document_ids: created.document_ids,
          photo_document_ids: created.photo_document_ids,
          created_at: created.created_at,
        },
        201,
      );
      return;
    }

    if (method === "GET" && path === "/obligations") {
      await fulfillJson(route, obligations);
      return;
    }

    if (method === "GET" && path === "/maintenance/work-orders") {
      await fulfillJson(route, maintenanceWorkOrders);
      return;
    }

    if (method === "PATCH" && path === "/maintenance/work-orders/work-order-1") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      Object.assign(maintenanceWorkOrders[0], payload, {
        updated_at: "2026-05-20T01:00:00.000Z",
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (method === "POST" && path === "/maintenance/work-orders") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const created = {
        ...maintenanceWorkOrders[0],
        ...payload,
        id: "work-order-created",
        requested_at: "2026-05-20T02:00:00.000Z",
        created_at: "2026-05-20T02:00:00.000Z",
        updated_at: "2026-05-20T02:00:00.000Z",
        document_ids: [],
        photo_document_ids: [],
        deleted_at: null,
      };
      maintenanceWorkOrders.unshift(created);
      await fulfillJson(route, created, 201);
      return;
    }

    if (method === "GET" && path === "/arrears/cases") {
      await fulfillJson(route, arrearsCases);
      return;
    }

    if (method === "PATCH" && path === "/arrears/cases/arrears-1") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      Object.assign(arrearsCases[0], payload, {
        updated_at: "2026-05-20T01:00:00.000Z",
      });
      await fulfillJson(route, arrearsCases[0]);
      return;
    }

    if (method === "POST" && path === "/arrears/cases") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const total =
        Number(payload.balance_current_cents ?? 0) +
        Number(payload.balance_1_30_cents ?? 0) +
        Number(payload.balance_31_60_cents ?? 0) +
        Number(payload.balance_61_90_cents ?? 0) +
        Number(payload.balance_90_plus_cents ?? 0);
      const created = {
        ...arrearsCases[0],
        ...payload,
        id: "arrears-created",
        total_balance_cents: total,
        created_at: "2026-05-20T02:00:00.000Z",
        updated_at: "2026-05-20T02:00:00.000Z",
        deleted_at: null,
      };
      arrearsCases.unshift(created);
      await fulfillJson(route, created, 201);
      return;
    }

    if (method === "GET" && path === "/rent-roll") {
      await fulfillJson(route, rentRoll);
      return;
    }

    if (method === "GET" && path === "/billing-drafts") {
      await fulfillJson(route, billingDrafts);
      return;
    }

    if (method === "GET" && path === "/invoice-drafts") {
      await fulfillJson(route, invoiceDrafts);
      return;
    }

    if (method === "GET" && path === "/document-intakes") {
      await fulfillJson(route, documentIntakes);
      return;
    }

    if (method === "GET" && path === "/tenancy-units") {
      await fulfillJson(route, tenancyUnits);
      return;
    }

    if (method === "GET" && path === "/leases") {
      await fulfillJson(route, leases);
      return;
    }

    if (method === "GET" && path === "/charge-rules") {
      await fulfillJson(route, rentRoll[0].charge_rules);
      return;
    }

    if (method === "PATCH" && path === "/charge-rules/charge-1") {
      const payload = request.postDataJSON() as {
        xero_account_code?: string | null;
        xero_tax_type?: string | null;
      };
      chargeAccountCode = payload.xero_account_code ?? chargeAccountCode;
      chargeTaxType = payload.xero_tax_type ?? chargeTaxType;
      await fulfillJson(route, {
        ...rentRoll[0].charge_rules[0],
        xero_account_code: chargeAccountCode,
        xero_tax_type: chargeTaxType,
      });
      return;
    }

    await fulfillJson(
      route,
      {
        detail: `Unhandled smoke mock: ${method} ${url.pathname}${url.search}`,
      },
      404,
    );
  });
}
