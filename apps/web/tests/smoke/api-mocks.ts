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
const assigneeId = "operator-2";

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
    metadata: {
      source_citations: {
        owner_abn: {
          source_hint: "Purchase contract vendor schedule",
          citation: "Vendor details",
          confidence: 0.91,
        },
        street_address: {
          source_hint: "Purchase contract property schedule",
          citation: "Property address",
          confidence: 0.88,
        },
      },
      apply_change_history: [
        {
          document_intake_id: "intake-1",
          document_id: "document-1",
          document_type: "purchase_contract",
          changes: [
            {
              field: "street_address",
              before: "12 Queen St",
              after: "12 Queen Street",
              source: {
                source_hint: "Purchase contract property schedule",
                citation: "Property address",
                confidence: 0.88,
              },
            },
            {
              field: "owner_abn",
              before: null,
              after: "22123456789",
              source: {
                source_hint: "Purchase contract vendor schedule",
                citation: "Vendor details",
                confidence: 0.91,
              },
            },
          ],
        },
      ],
    },
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
    metadata: {
      public_enrichment: {
        source_citations: {
          abn: {
            source_hint: "Australian Business Register",
            citation: "Bright Cafe Pty Ltd",
            confidence: 0.94,
          },
        },
        apply_history: [
          {
            field: "abn",
            label: "ABN",
            before: null,
            after: "34123456789",
            source: {
              source_hint: "Australian Business Register",
              citation: "Bright Cafe Pty Ltd",
              confidence: 0.94,
            },
            applied_at: "2026-05-19T10:00:00.000Z",
            applied_by_user_id: operatorId,
          },
        ],
      },
    },
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
    metadata: {},
  },
];

const initialTenantOnboardings = [
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
    portal_url: "http://127.0.0.1:3000/tenant-portal/tenant-token-1",
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

const initialOperatorTenantPortalAccounts = [
  {
    id: "portal-account-1",
    tenant_id: tenantId,
    tenant_onboarding_id: "onboarding-1",
    auth_provider: "clerk",
    auth_provider_id: "tenant-subject-one",
    email: "mia@example.com",
    status: "active",
    linked_at: "2026-05-19T09:00:00.000Z",
    created_at: "2026-05-19T09:00:00.000Z",
    updated_at: "2026-05-19T09:30:00.000Z",
    last_seen_at: "2026-05-19T09:30:00.000Z",
    revoked_at: null,
    deleted_at: null,
    recovery_action: null,
    recovery_reason: null,
    recovery_at: null,
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
    document_ids: ["portal-document-1"],
    photo_document_ids: ["portal-photo-1"],
    metadata: {
      comments: [],
      contractor_delivery: {
        email: {
          send: {
            status: "failed",
            provider: "sendgrid",
            attempted_at: "2026-05-19T02:15:00.000Z",
            sent_at: null,
            sent_by_user_id: operatorId,
            provider_message_id: "sg-maintenance-failed",
            recipient_email: "service@coolair.example",
            subject: "Attendance window request",
            body: "Please confirm your first available attendance window.",
            error: "SendGrid returned 500.",
            template_key: "maintenance_contractor_update",
            template_version: "v1",
            retry_count: 1,
          },
          receipts: [
            {
              received_at: "2026-05-19T02:15:00.000Z",
              channel: "email",
              status: "failed",
              provider: "sendgrid",
              recipient_email: "service@coolair.example",
              provider_message_id: "sg-maintenance-failed",
              error: "SendGrid returned 500.",
              subject: "Attendance window request",
              template_key: "maintenance_contractor_update",
              template_version: "v1",
              retry_count: 1,
            },
          ],
          history: [
            {
              event: "provider_delivery_attempted",
              at: "2026-05-19T02:15:00.000Z",
              user_id: operatorId,
              provider: "sendgrid",
              status: "failed",
              recipient_email: "service@coolair.example",
              provider_message_id: "sg-maintenance-failed",
              error: "SendGrid returned 500.",
              subject: "Attendance window request",
              template_key: "maintenance_contractor_update",
              template_version: "v1",
              retry_count: 1,
            },
          ],
        },
      },
      activity_history: [
        {
          timestamp: "2026-05-19T01:00:00.000Z",
          actor: "tenant-portal:header:tenant-t",
          source: "tenant_portal",
          event: "tenant_submitted",
          summary: "Tenant submitted maintenance request.",
          status: "requested",
        },
        {
          timestamp: "2026-05-19T02:00:00.000Z",
          actor: "operator-1",
          source: "operator_api",
          event: "updated",
          summary: "Updated contractor and approval status.",
          status: "awaiting_approval",
        },
        {
          timestamp: "2026-05-19T02:30:00.000Z",
          actor: "operator-1",
          source: "operator_api",
          event: "comment_added",
          summary: "We have asked the contractor for an attendance window.",
          status: "awaiting_approval",
          visibility: "tenant",
        },
      ],
    },
    created_at: "2026-05-19T01:00:00.000Z",
    updated_at: "2026-05-19T02:00:00.000Z",
    deleted_at: null,
  },
];

const initialTenantPortalDocuments = [
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
  {
    id: "portal-photo-1",
    filename: "shopfront-ac-photo.jpg",
    content_type: "image/jpeg",
    byte_size: 128000,
    category: "other",
    notes: "Photo attached to the maintenance request.",
    source: "tenant_portal",
    created_at: "2026-05-19T01:00:00.000Z",
  },
];

let tenantPortalDocuments = initialTenantPortalDocuments.map((document) => ({
  ...document,
}));

function operatorDocumentRecords() {
  return tenantPortalDocuments.map((document) => ({
    ...document,
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    tenant_onboarding_id: "onboarding-1",
    metadata: { source: document.source },
    deleted_at: null,
  }));
}

const initialTenantPortalNotificationPreferences = {
  email_enabled: true,
  sms_enabled: true,
  billing_email_enabled: true,
  compliance_reminders_enabled: true,
  preferred_channel: "both",
  updated_at: null,
};

let tenantPortalNotificationPreferences = {
  ...initialTenantPortalNotificationPreferences,
};

function tenantPortalDocumentsByCategory(category: string) {
  return tenantPortalDocuments.filter(
    (document) => document.category === category,
  );
}

function tenantPortalPreferredChannel(
  emailEnabled: boolean,
  smsEnabled: boolean,
) {
  if (emailEnabled && smsEnabled) {
    return "both";
  }
  if (emailEnabled) {
    return "email";
  }
  if (smsEnabled) {
    return "sms";
  }
  return "none";
}

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
  {
    id: "invoice-draft-failed",
    entity_id: entityId,
    billing_draft_id: "billing-draft-1",
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    document_id: "document-1",
    document_intake_id: "intake-1",
    status: "approved",
    invoice_number: "INV-1002",
    title: "Maintenance recovery invoice",
    currency: "AUD",
    issue_date: "2026-05-02",
    due_date: "2026-05-16",
    subtotal_cents: 800000,
    gst_cents: 80000,
    total_cents: 880000,
    issuer_name: "Queen Street Trustee Pty Ltd",
    issuer_abn: "22123456789",
    recipient_name: "Bright Cafe Pty Ltd",
    recipient_email: "accounts@bright.example",
    notes: "Approved maintenance-linked invoice with provider failure.",
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
          subject: "Invoice INV-1002",
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
      xero_posting_approval: {
        state: "approved",
        approved: true,
        approved_at: "2026-05-19T10:25:00.000Z",
        idempotency_key: "xero-draft-invoice-draft-failed",
      },
      posting_preparation: {
        external_posting_status: "provider_failed",
        xero_sync_allowed: true,
        xero_sync_requested: true,
        xero_synced: false,
        last_provider_status: "failed",
        last_provider_reason: "Xero provider returned validation error.",
        provider_retry_count: 1,
      },
      provider_dispatch: {
        xero: {
          provider: "xero",
          status: "failed",
          reason: "Xero provider returned validation error.",
          received_at: "2026-05-20T02:00:00.000Z",
          retry_count: 1,
        },
      },
      provider_status_receipts: [
        {
          provider: "xero",
          status: "failed",
          reason: "Xero provider returned validation error.",
          received_at: "2026-05-20T02:00:00.000Z",
          retry_count: 1,
        },
      ],
      xero_sync: {
        xero_synced: false,
      },
    },
    lines: [
      {
        id: "invoice-draft-line-failed",
        invoice_draft_id: "invoice-draft-failed",
        billing_draft_line_id: "billing-draft-line-1",
        description: "Maintenance recovery",
        amount_cents: 800000,
        gst_cents: 80000,
        currency: "AUD",
        source_hint: "Maintenance invoice",
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

const tenantPortalSession = (
  authMode: "token" | "account" = "token",
  options: { tenantId?: string; tradingName?: string } = {},
) => ({
  auth:
    authMode === "account"
      ? {
          mode: "tenant_portal_account",
          token_source: "bearer",
          tenant_auth_configured: true,
          dev_fallback: false,
          boundary: "tenant_portal_account",
          detail:
            "Access is scoped to the tenant linked to this tenant portal account.",
        }
      : {
          mode: "tenant_portal_token",
          token_source: "header",
          tenant_auth_configured: false,
          dev_fallback: false,
          boundary: "tenant_onboarding_token",
          detail:
            "Tenant identity-provider auth is not wired yet. Access is scoped to the tenant linked to this onboarding token.",
        },
  tenant: {
    id: options.tenantId ?? tenantId,
    legal_name: "Bright Cafe Pty Ltd",
    trading_name: options.tradingName ?? "Bright Cafe",
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
    accepted_categories: [
      "insurance",
      "bank_guarantee",
      "lease",
      "onboarding",
      "other",
    ],
    items: [
      {
        key: "insurance",
        label: "Insurance",
        status: tenantPortalDocumentsByCategory("insurance").length
          ? "received"
          : "not_on_file",
        document_count: tenantPortalDocumentsByCategory("insurance").length,
        latest_document:
          tenantPortalDocumentsByCategory("insurance")[0] ?? null,
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
        status: tenantPortalDocumentsByCategory("onboarding").length
          ? "received"
          : "not_on_file",
        document_count: tenantPortalDocumentsByCategory("onboarding").length,
        latest_document:
          tenantPortalDocumentsByCategory("onboarding")[0] ?? null,
        due_date: null,
      },
    ],
    uploaded_documents: tenantPortalDocuments,
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
      history: Array.isArray(workOrder.metadata?.activity_history)
        ? workOrder.metadata.activity_history
            .filter((entry) => {
              if (typeof entry !== "object" || !entry) {
                return false;
              }
              const source = "source" in entry ? entry.source : null;
              const visibility =
                "visibility" in entry ? entry.visibility : null;
              return source === "tenant_portal" || visibility === "tenant";
            })
            .map((entry) => ({
              timestamp:
                typeof entry === "object" && entry && "timestamp" in entry
                  ? String(entry.timestamp)
                  : workOrder.created_at,
              event:
                typeof entry === "object" && entry && "event" in entry
                  ? String(entry.event)
                  : "updated",
              summary:
                typeof entry === "object" && entry && "summary" in entry
                  ? String(entry.summary)
                  : "Maintenance request updated.",
              status:
                typeof entry === "object" && entry && "status" in entry
                  ? String(entry.status)
                  : workOrder.status,
            }))
        : [],
    })),
  notification_preferences: tenantPortalNotificationPreferences,
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
      notification_preferences: {
        work_assignment_email_enabled: true,
        work_assignment_digest_cadence: "daily",
        work_assignment_digest_last_generated_at: "2026-05-21T09:00:00.000Z",
        work_assignment_digest_last_item_count: 4,
        work_assignment_digest_history: [
          {
            event: "digest_generated",
            generated_at: "2026-05-21T09:00:00.000Z",
            entity_id: entityId,
            cadence: "daily",
            item_count: 4,
            ready_count: 2,
            attention_count: 1,
            in_flight_count: 1,
            done_count: 0,
            follow_up_due_count: 2,
            delivery_status: "previewed",
            message_sent: false,
            delivery_detail: null,
            provider_message_id: null,
            delivery_trigger: "preview",
            recovery_of_generated_at: null,
            delivery_attempt_count: 0,
          },
        ],
      },
      created_at: "2026-05-01T00:00:00.000Z",
      roles: [
        {
          entity_id: entityId,
          entity_name: "Acme Holdings Pty Ltd",
          role: "owner",
        },
      ],
    },
    {
      id: assigneeId,
      email: "temba@example.com",
      display_name: "Temba van Jaarsveld",
      is_active: true,
      login_linked: true,
      invite_email_status: "accepted",
      invite_email_detail: "Provider login is linked for this operator.",
      invite_sent_at: "2026-05-01T00:00:00.000Z",
      invite_expires_at: "2026-05-04T00:00:00.000Z",
      invite_accepted_at: "2026-05-01T00:00:00.000Z",
      notification_preferences: {
        work_assignment_email_enabled: true,
        work_assignment_digest_cadence: "daily",
        work_assignment_digest_last_generated_at: null,
        work_assignment_digest_last_item_count: null,
        work_assignment_digest_history: [],
      },
      created_at: "2026-05-01T00:00:00.000Z",
      roles: [
        {
          entity_id: entityId,
          entity_name: "Acme Holdings Pty Ltd",
          role: "ops",
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

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonStringArray(value: JsonBody | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function jsonRecord(value: JsonBody | undefined) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value;
}

function assignmentNotificationMetadata(
  value: JsonBody | undefined,
  targetId: string,
) {
  const metadata = { ...jsonRecord(value) };
  const assignment = { ...jsonRecord(metadata.work_assignment) };
  const notification = { ...jsonRecord(assignment.notification) };
  const providerHistory = Array.isArray(notification.provider_history)
    ? notification.provider_history
    : [];
  const assignmentHistory = Array.isArray(assignment.history)
    ? assignment.history
    : [];
  const timestamp = "2026-05-20T01:15:00.000Z";
  const recipient =
    typeof assignment.assigned_user_email === "string" &&
    assignment.assigned_user_email.trim()
      ? assignment.assigned_user_email
      : "temba@example.com";
  const templateKey =
    typeof notification.template_key === "string" && notification.template_key
      ? notification.template_key
      : "work_assignment_notification";
  const templateVersion =
    typeof notification.template_version === "string" &&
    notification.template_version
      ? notification.template_version
      : "v1";
  const receipt = {
    event: "provider_notification_attempted",
    channel: "email",
    status: "queued",
    provider: "sendgrid",
    attempted_at: timestamp,
    sent_at: timestamp,
    sent_by_user_id: operatorId,
    sent_by_name: "Owner Operator",
    recipient_email: recipient,
    provider_message_id: `sg-assignment-${targetId}`,
    error: null,
    template_key: templateKey,
    template_version: templateVersion,
  };
  const historyEntry = {
    event: "provider_notification_attempted",
    at: timestamp,
    actor_user_id: operatorId,
    actor_name: "Owner Operator",
    assigned_user_id:
      typeof assignment.assigned_user_id === "string"
        ? assignment.assigned_user_id
        : null,
    assigned_user_name:
      typeof assignment.assigned_user_name === "string"
        ? assignment.assigned_user_name
        : null,
    assigned_user_email: recipient,
    notification_status: "queued",
    summary: "Assignment notification email was queued.",
  };

  metadata.work_assignment = {
    ...assignment,
    notification: {
      ...notification,
      channel: "email",
      provider: "sendgrid",
      status: "queued",
      recipient_email: recipient,
      provider_message_id: `sg-assignment-${targetId}`,
      attempted_at: timestamp,
      sent_at: timestamp,
      sent_by_user_id: operatorId,
      sent_by_name: "Owner Operator",
      error: null,
      template_key: templateKey,
      template_version: templateVersion,
      detail: "Assignment email was queued by SendGrid.",
      provider_history: [receipt, ...providerHistory].slice(0, 10),
    },
    history: [historyEntry, ...assignmentHistory].slice(0, 10),
  };
  return metadata;
}

function multipartField(body: string, name: string) {
  const match = body.match(
    new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r\\n]*)`),
  );
  return match?.[1]?.trim() ?? null;
}

function multipartFilename(body: string) {
  const match = body.match(/name="file"; filename="([^"]+)"/);
  return match?.[1] ?? "tenant-portal-upload";
}

type MockLeasiumApiOptions = {
  tenantAccountLinked?: boolean;
  tenantAccountLinkedToDifferentTenant?: boolean;
};

export async function mockLeasiumApi(
  page: Page,
  options: MockLeasiumApiOptions = {},
) {
  let xeroTenantId: string | null = null;
  let xeroConnectedAt: string | null = null;
  let xeroProviderConnected = false;
  let chargeAccountCode: string | null = "401";
  let chargeTaxType: string | null = null;
  let xeroDraftApproved = false;
  let xeroDraftCreated = false;
  let xeroPaymentApplied = false;
  let localInvoiceDrafts = jsonClone(invoiceDrafts);
  let tenantAccountLinked = options.tenantAccountLinked ?? false;
  let notificationCenterReadAt: string | null = null;
  let digestReceiptSent = false;
  const tenantAccountLinkedToDifferentTenant =
    options.tenantAccountLinkedToDifferentTenant ?? false;
  let appliedContactMappings: XeroContactMapping[] = [];
  let snapshotCount = 0;
  let insightSnapshots: JsonBody[] = [];
  let tenantPortalDocumentCount = initialTenantPortalDocuments.length;
  let tenantOnboardings = initialTenantOnboardings.map((onboarding) => ({
    ...onboarding,
    delivery_data: {
      ...onboarding.delivery_data,
      channels: { ...onboarding.delivery_data.channels },
    },
  }));
  let operatorTenantPortalAccounts = initialOperatorTenantPortalAccounts.map(
    (account) => ({ ...account }),
  );
  tenantPortalDocuments = initialTenantPortalDocuments.map((document) => ({
    ...document,
  }));
  tenantPortalNotificationPreferences = {
    ...initialTenantPortalNotificationPreferences,
  };

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
    connection_source: xeroProviderConnected
      ? "provider"
      : xeroTenantId
        ? "manual"
        : "none",
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
        approved_unsynced: xeroDraftCreated ? 0 : 1,
        synced: xeroDraftCreated ? 1 : 0,
        blocked: 0,
      },
      payment_reconciliation: {
        unpaid: xeroPaymentApplied ? 0 : 1,
        partially_paid: 0,
        paid: xeroPaymentApplied ? 1 : 0,
        reconciliation_ready: xeroPaymentApplied ? 1 : 0,
      },
      issues,
      guardrails: [
        "Xero contact apply only saves reviewed local mappings; it does not mutate Xero.",
        "Invoice posting requires explicit local approval before Xero draft creation.",
        "Payment reconciliation is manual status tracking until bank/Xero feeds are connected.",
      ],
    };
  };

  const xeroExceptionItemBase = () => ({
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
    invoice_draft_id: null,
    invoice_number: null,
    invoice_title: null,
    total_cents: null,
    currency: null,
    provider: null,
    provider_status: null,
    external_posting_status: null,
    idempotency_key: null,
    xero_invoice_id: null,
    xero_status: null,
    received_at: null,
    retry_count: null,
  });

  const xeroExceptionQueue = () => {
    const items: Array<Record<string, JsonBody>> = [];
    if (!xeroTenantId) {
      items.push({
        ...xeroExceptionItemBase(),
        id: `connection-${entityId}`,
        kind: "connection",
        severity: "blocker",
        label: "Xero is not connected",
        detail: "This entity has no Xero tenant recorded yet.",
        action: "Record the Xero tenant before approving invoice sync.",
        next_action: "connect_xero",
        source: "xero_status",
      });
    }
    if (!chargeTaxType) {
      items.push({
        ...xeroExceptionItemBase(),
        id: "tax-charge-1",
        kind: "tax",
        severity: "blocker",
        label: "Base Rent tax type missing",
        detail:
          "Queen Street Retail Centre / Shop 3 is taxable and needs a Xero tax type.",
        action: "Review and apply the suggested tax mapping.",
        next_action: "review_chart_tax_mapping",
        source: "xero_status",
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
    if (!xeroDraftCreated) {
      items.push({
        ...xeroExceptionItemBase(),
        id: "invoice-sync-invoice-draft-1",
        kind: "invoice_sync",
        severity: "warning",
        label: xeroDraftApproved
          ? "Approved invoice not synced"
          : "Needs Xero approval",
        detail: "INV-1001 is approved but not posted to Xero.",
        action: xeroDraftApproved
          ? "Run idempotent Xero draft creation when ready."
          : "Approve Xero posting explicitly, then run idempotent draft creation.",
        next_action: xeroDraftApproved
          ? "review_invoice_posting"
          : "review_invoice_posting",
        source: "xero_status",
        property_id: propertyId,
        tenancy_unit_id: unitId,
        lease_id: leaseId,
        tenant_id: tenantId,
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        invoice_title: "June 2026 Rent",
        total_cents: 880000,
        currency: "AUD",
      });
    }
    if (xeroDraftCreated && !xeroPaymentApplied) {
      items.push({
        ...xeroExceptionItemBase(),
        id: "xero-payment-invoice-draft-1",
        kind: "payment",
        severity: "info",
        label: "Xero payment status needs review",
        detail:
          "INV-1001 is linked to a Xero draft but Leasium still shows unpaid.",
        action:
          "Preview provider payments, then apply reviewed local payment metadata if a match is found.",
        next_action: "preview_payment_reconciliation",
        source: "invoice_payment_metadata",
        property_id: propertyId,
        tenancy_unit_id: unitId,
        lease_id: leaseId,
        tenant_id: tenantId,
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        invoice_title: "June 2026 Rent",
        total_cents: 880000,
        currency: "AUD",
        provider: "xero",
        provider_status: "unpaid",
        xero_invoice_id: "xero-invoice-smoke-1",
      });
    }
    return {
      entity_id: entityId,
      generated_at: "2026-05-19T10:45:00.000Z",
      summary: {
        total: items.length,
        blockers: items.filter((item) => item.severity === "blocker").length,
        warnings: items.filter((item) => item.severity === "warning").length,
        info: items.filter((item) => item.severity === "info").length,
        connection: items.filter((item) => item.kind === "connection").length,
        contact: items.filter((item) => item.kind === "contact").length,
        chart: items.filter((item) => item.kind === "chart").length,
        tax: items.filter((item) => item.kind === "tax").length,
        invoice_sync: items.filter((item) => item.kind === "invoice_sync")
          .length,
        provider: items.filter((item) => item.kind === "provider").length,
        payment: items.filter((item) => item.kind === "payment").length,
      },
      items,
      guardrails: [
        "The exception queue is built from local Leasium records only.",
        "Loading this queue does not refresh Xero tokens, call Xero APIs, post invoices, send emails, or reconcile payments.",
        "Provider actions still require explicit operator review before any mutation is attempted.",
      ],
    };
  };

  const activeInvoiceDraft = () => localInvoiceDrafts[0];

  const activeInvoiceMetadata = () =>
    activeInvoiceDraft().metadata as unknown as Record<string, JsonBody>;

  const xeroProviderReceipt = (receivedAt: string) => ({
    provider: "xero",
    status: "created",
    reason: "Xero draft invoice was created after explicit approval.",
    external_posting_status: "draft_created",
    idempotency_key: "xero-draft-invoice-draft-1",
    xero_invoice_id: "xero-invoice-smoke-1",
    xero_status: "DRAFT",
    received_at: receivedAt,
    retry_count: 1,
  });

  const markXeroApproval = (approved: boolean) => {
    const metadata = activeInvoiceMetadata();
    metadata.xero_posting_approval = {
      state: approved ? "approved" : "revoked",
      approved,
      approved_at: approved ? "2026-05-19T10:25:00.000Z" : null,
      idempotency_key: approved ? "xero-draft-invoice-draft-1" : null,
    };
    metadata.posting_preparation = {
      external_posting_status: approved
        ? "approved_pending_xero_draft"
        : "approval_revoked",
      xero_sync_allowed: approved,
      xero_sync_requested: approved,
      xero_synced: false,
    };
  };

  const markXeroDraftCreated = (createdAt: string) => {
    const metadata = activeInvoiceMetadata();
    const receipt = xeroProviderReceipt(createdAt);
    metadata.xero_sync = {
      xero_synced: true,
      xero_invoice_id: "xero-invoice-smoke-1",
      xero_status: "DRAFT",
      idempotency_key: "xero-draft-invoice-draft-1",
      synced_at: createdAt,
    };
    metadata.posting_preparation = {
      external_posting_status: "draft_created",
      xero_sync_allowed: true,
      xero_sync_requested: true,
      xero_synced: true,
      last_provider_status: "created",
      last_provider_reason:
        "Xero draft invoice was created after explicit approval.",
      provider_retry_count: 1,
    };
    metadata.provider_dispatch = { xero: receipt };
    metadata.provider_status_receipts = [receipt];
  };

  const markInvoiceProviderEmailSent = (sentAt: string) => {
    const metadata = activeInvoiceMetadata();
    const deliveryState =
      metadata.delivery_state && typeof metadata.delivery_state === "object"
        ? { ...(metadata.delivery_state as Record<string, JsonBody>) }
        : {};
    deliveryState.tenant_email_sent = true;
    deliveryState.tenant_email_sent_at = sentAt;
    deliveryState.tenant_email_delivery_method = "sendgrid";
    deliveryState.tenant_email_provider_status = "queued";
    deliveryState.xero_synced = true;
    metadata.delivery_state = deliveryState;
    metadata.delivery_email = {
      send: {
        status: "queued",
        provider: "sendgrid",
        provider_message_id: "sg-dispatch-smoke-1",
        sent_at: sentAt,
        xero_synced: true,
      },
    };
  };

  const markInvoicePaymentReconciled = (reconciledAt: string) => {
    xeroPaymentApplied = true;
    const metadata = activeInvoiceMetadata();
    const paymentStatus = {
      status: "paid",
      paid_cents: 880000,
      outstanding_cents: 0,
      paid_at: null,
      updated_at: reconciledAt,
      source: "xero_payment_reconciliation_provider",
    };
    metadata.payment_status = paymentStatus;
    metadata.payment_history = [paymentStatus];
    metadata.xero_payment_reconciliation = {
      idempotency_key: "xero-payment-smoke-1",
      invoice_draft_id: "invoice-draft-1",
      invoice_number: "INV-1001",
      xero_invoice_id: "xero-invoice-smoke-1",
      provider_payment_id: "provider-payment-smoke-1",
      source: "provider",
      status: "paid",
      paid_cents: 880000,
      reconciled_at: reconciledAt,
      match_method: "Matched by Xero invoice ID.",
      match_confidence: "high",
      amount_delta_cents: 0,
      bank_transaction_id: "bank-txn-smoke-1",
      bank_account_name: "Operating Account",
      statement_date: "2026-05-19",
      statement_amount_cents: 880000,
      counterparty: "Bright Cafe",
      reference: "INV-1001",
      guardrail_flags: [
        "no_bank_feed_mutation",
        "local_payment_metadata_only",
        "bank_evidence_stored",
      ],
    };
    metadata.xero_payment_reconciliation_history = [
      metadata.xero_payment_reconciliation,
    ];
  };

  const xeroPaymentReconciliationResult = (applied: boolean) => ({
    entity_id: entityId,
    source: "provider",
    provider_configured: true,
    provider_connection_id: "xero-connection-1",
    checked_payments: 1,
    ready_count: applied ? 0 : 1,
    applied_count: applied ? 1 : 0,
    skipped_count: 0,
    blocked_count: 0,
    reconciled_at: applied
      ? "2026-05-19T10:42:00.000Z"
      : "2026-05-19T10:40:00.000Z",
    results: [
      {
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        status: applied ? "applied" : "ready",
        reason: applied
          ? "Payment status was reconciled locally."
          : "Payment status can be reconciled locally.",
        current_status: applied ? "unpaid" : "unpaid",
        proposed_status: "paid",
        current_paid_cents: 0,
        proposed_paid_cents: 880000,
        outstanding_cents: 0,
        idempotency_key: "xero-payment-smoke-1",
        match_method: "Matched by Xero invoice ID.",
        match_confidence: "high",
        amount_delta_cents: 0,
        bank_transaction_id: "bank-txn-smoke-1",
        bank_account_name: "Operating Account",
        statement_date: "2026-05-19",
        statement_amount_cents: 880000,
        counterparty: "Bright Cafe",
        reference: "INV-1001",
        guardrail_flags: [
          "no_bank_feed_mutation",
          "local_payment_metadata_only",
          "bank_evidence_stored",
        ],
      },
    ],
    guardrails: [
      "Payment reconciliation preview does not change local invoice payment status.",
      "Apply only updates Leasium invoice payment metadata; it never mutates Xero payments.",
      "Duplicate payment idempotency keys are skipped.",
      "Bank-feed evidence is stored for review only; Leasium does not create, edit, or match bank transactions in Xero.",
    ],
  });

  const xeroChartTaxValidationPreview = () => {
    const chartReady =
      chargeAccountCode === "401" || chargeAccountCode === "200";
    const taxReady = chargeTaxType === "OUTPUT";
    const resultStatus =
      chartReady && taxReady
        ? "ready"
        : chargeTaxType
          ? "not_found"
          : "needs_mapping";
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
            title:
              "Bright Cafe Pty Ltd rent review - Queen Street Retail Centre, Shop 3",
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

    if (method === "GET" && path === "/xero/exception-queue") {
      await fulfillJson(route, xeroExceptionQueue());
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
        await fulfillJson(
          route,
          { detail: "Insights snapshot not found." },
          404,
        );
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
        (snapshot) =>
          (snapshot as { [key: string]: JsonBody }).id === snapshotId,
      );
      await fulfillJson(
        route,
        revoked ?? { detail: "Insights snapshot not found." },
      );
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

    if (
      method === "POST" &&
      path === `/xero/contacts/sync-preview/${entityId}`
    ) {
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

    if (
      method === "POST" &&
      path === `/xero/contacts/apply-preview/${entityId}`
    ) {
      const payload = request.postDataJSON() as {
        mappings?: Partial<XeroContactMapping>[];
      };
      const appliedAt = "2026-05-19T10:10:00.000Z";
      const appliedMappings: XeroContactMapping[] = [];
      const skippedMappings: JsonBody[] = [];

      for (const mapping of payload.mappings ?? []) {
        if (
          (mapping.target_type === "tenant" ||
            mapping.target_type === "property") &&
          mapping.target_id &&
          mapping.xero_contact_id
        ) {
          const appliedMapping: XeroContactMapping = {
            target_type: mapping.target_type,
            target_id: mapping.target_id,
            target_name: mapping.target_name ?? mapping.target_id,
            xero_contact_id: mapping.xero_contact_id,
            xero_contact_name:
              mapping.xero_contact_name ?? mapping.xero_contact_id,
            xero_email: mapping.xero_email ?? null,
          };
          appliedMappings.push(appliedMapping);
          continue;
        }
        skippedMappings.push({
          target_type:
            mapping.target_type === "tenant" ||
            mapping.target_type === "property"
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

    if (
      method === "POST" &&
      path === "/xero/invoices/invoice-draft-1/posting-approval"
    ) {
      const payload = (await route.request().postDataJSON()) as {
        approved?: boolean;
      };
      xeroDraftApproved = payload.approved !== false;
      markXeroApproval(xeroDraftApproved);
      await fulfillJson(route, {
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        status: xeroDraftApproved ? "approved" : "revoked",
        approval_state: xeroDraftApproved ? "approved" : "revoked",
        xero_sync_allowed: xeroDraftApproved,
        external_posting_status: xeroDraftApproved
          ? "approved_pending_xero_draft"
          : "approval_revoked",
        approved_at: xeroDraftApproved ? "2026-05-19T10:25:00.000Z" : null,
        idempotency_key: xeroDraftApproved
          ? "xero-draft-invoice-draft-1"
          : null,
        reason: xeroDraftApproved
          ? "Xero draft posting was explicitly approved locally."
          : "Xero draft posting approval was revoked locally.",
        guardrails: [
          "This endpoint only records local posting approval.",
          "No Xero invoice is created until the separate draft creation endpoint is called.",
          "Draft creation still requires an active configured provider connection.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/invoices/draft-create/${entityId}`
    ) {
      if (xeroDraftApproved) {
        xeroDraftCreated = true;
        markXeroDraftCreated("2026-05-19T10:30:00.000Z");
      }
      await fulfillJson(route, {
        entity_id: entityId,
        provider_configured: true,
        provider_connection_id: "xero-connection-1",
        xero_tenant_id: xeroTenantId ?? "tenant-smoke",
        checked_invoices: 1,
        created_count: xeroDraftApproved && xeroDraftCreated ? 1 : 0,
        skipped_count: 0,
        blocked_count: xeroDraftApproved ? 0 : 1,
        failed_count: 0,
        results: [
          {
            invoice_draft_id: "invoice-draft-1",
            invoice_number: "INV-1001",
            status: xeroDraftApproved ? "created" : "blocked",
            reason: xeroDraftApproved
              ? "Xero draft invoice was created after explicit approval."
              : "Explicit Xero posting approval is required before any Xero mutation.",
            approval_state: xeroDraftApproved ? "approved" : "missing",
            idempotency_key: "xero-draft-invoice-draft-1",
            xero_invoice_id: xeroDraftApproved ? "xero-invoice-smoke-1" : null,
            xero_status: xeroDraftApproved ? "DRAFT" : null,
            external_posting_status: xeroDraftApproved
              ? "draft_created"
              : "approval_required",
          },
        ],
        applied_at: "2026-05-19T10:30:00.000Z",
        guardrails: [
          "Xero draft creation only runs for invoice drafts with explicit local posting approval.",
          "When provider credentials or provider connection are absent, invoices are skipped safely.",
          "Successful Xero draft references are stored locally and repeated calls are idempotent.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/invoices/provider-dispatch/${entityId}`
    ) {
      const dispatchedAt = "2026-05-19T10:35:00.000Z";
      const xeroStatusValue = xeroDraftApproved
        ? xeroDraftCreated
          ? "reused"
          : "created"
        : "blocked";
      if (xeroDraftApproved && !xeroDraftCreated) {
        xeroDraftCreated = true;
        markXeroDraftCreated(dispatchedAt);
      }
      if (xeroDraftApproved) {
        markInvoiceProviderEmailSent(dispatchedAt);
      }
      const metadata = activeInvoiceMetadata();
      const providerReceipts = Array.isArray(metadata.provider_status_receipts)
        ? metadata.provider_status_receipts
        : [];
      await fulfillJson(route, {
        entity_id: entityId,
        provider_configured: true,
        provider_connection_id: "xero-connection-1",
        xero_tenant_id: xeroTenantId ?? "tenant-smoke",
        checked_invoices: 1,
        xero_created_count: xeroStatusValue === "created" ? 1 : 0,
        xero_reused_count: xeroStatusValue === "reused" ? 1 : 0,
        email_sent_count: xeroDraftApproved ? 1 : 0,
        email_reused_count: 0,
        blocked_count: xeroDraftApproved ? 0 : 1,
        failed_count: 0,
        dispatched_at: dispatchedAt,
        results: [
          {
            invoice_draft_id: "invoice-draft-1",
            invoice_number: "INV-1001",
            xero_status: xeroStatusValue,
            xero_reason: xeroDraftApproved
              ? xeroStatusValue === "reused"
                ? "Invoice draft already has a Xero draft reference."
                : "Xero draft invoice was created after explicit approval."
              : "Explicit Xero posting approval is required before provider dispatch.",
            xero_invoice_id: xeroDraftApproved ? "xero-invoice-smoke-1" : null,
            xero_provider_status: xeroDraftApproved ? "DRAFT" : null,
            xero_idempotency_key: xeroDraftApproved
              ? "xero-draft-invoice-draft-1"
              : null,
            email_status: xeroDraftApproved ? "sent" : "skipped",
            email_reason: xeroDraftApproved
              ? "SendGrid queued the prepared invoice email."
              : "Tenant email waits until a Xero draft exists or is reused.",
            email_provider_status: xeroDraftApproved ? "queued" : null,
            email_provider_message_id: xeroDraftApproved
              ? "sg-dispatch-smoke-1"
              : null,
            provider_receipts: providerReceipts,
            next_action: xeroDraftApproved ? null : "resolve_xero_blockers",
          },
        ],
        guardrails: [
          "Provider dispatch creates or reuses an approved Xero DRAFT before tenant email.",
          "SendGrid email is reused when a successful provider receipt already exists.",
          "Payment reconciliation remains a separate reviewed action.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/payments/reconciliation-preview/${entityId}`
    ) {
      await fulfillJson(route, xeroPaymentReconciliationResult(false));
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/payments/reconciliation-apply/${entityId}`
    ) {
      markInvoicePaymentReconciled("2026-05-19T10:42:00.000Z");
      await fulfillJson(route, xeroPaymentReconciliationResult(true));
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

    if (method === "GET" && path === `/tenants/${tenantId}/detail`) {
      await fulfillJson(route, {
        tenant: tenants[0],
        leases: [
          {
            lease_id: leaseId,
            status: "active",
            property_id: propertyId,
            property_name: "Queen Street Retail Centre",
            property_address: "12 Queen Street, Brisbane City, QLD, 4000",
            tenancy_unit_id: unitId,
            unit_label: "Shop 3",
            commencement_date: "2025-07-01",
            expiry_date: "2028-06-30",
            annual_rent_cents: 9600000,
            rent_frequency: "monthly",
            outgoings_recoverable: true,
            next_review_date: "2026-07-01",
          },
        ],
        activity: [
          {
            occurred_at: "2026-05-19T09:00:00.000Z",
            kind: "tenant_portal_account",
            label: "Portal account linked",
            detail: "mia@example.com",
            source: "tenant_portal_account",
            related_id: "portal-account-1",
            tone: "success",
          },
        ],
        reviewed_changes: [
          {
            occurred_at: "2026-05-19T09:30:00.000Z",
            source: "tenant_onboarding",
            source_label: "Tenant onboarding",
            source_id: "onboarding-1",
            status: "applied",
            notes: "Reviewed tenant onboarding submission.",
            changes: [
              {
                field: "billing_email",
                label: "Billing email",
                before: null,
                after: "accounts@bright.example",
              },
              {
                field: "contact_phone",
                label: "Phone",
                before: null,
                after: "0400 111 222",
              },
            ],
          },
        ],
      });
      return;
    }

    if (method === "GET" && path === `/tenants/${tenantId}/portal-accounts`) {
      await fulfillJson(route, operatorTenantPortalAccounts);
      return;
    }

    if (
      method === "POST" &&
      path === `/tenants/${tenantId}/portal-accounts/portal-account-1/revoke`
    ) {
      operatorTenantPortalAccounts = operatorTenantPortalAccounts.map(
        (account) =>
          account.id === "portal-account-1"
            ? {
                ...account,
                status: "revoked",
                revoked_at: "2026-05-20T00:00:00.000Z",
                updated_at: "2026-05-20T00:00:00.000Z",
                recovery_action: "revoked",
                recovery_reason:
                  "Operator revoked access from the tenant profile.",
                recovery_at: "2026-05-20T00:00:00.000Z",
              }
            : account,
      );
      await fulfillJson(route, operatorTenantPortalAccounts[0]);
      return;
    }

    if (
      method === "POST" &&
      path === `/tenants/${tenantId}/portal-accounts/portal-account-1/restore`
    ) {
      operatorTenantPortalAccounts = operatorTenantPortalAccounts.map(
        (account) =>
          account.id === "portal-account-1"
            ? {
                ...account,
                status: "active",
                revoked_at: null,
                updated_at: "2026-05-20T00:05:00.000Z",
                recovery_action: "restored",
                recovery_reason:
                  "Operator restored access from the tenant profile.",
                recovery_at: "2026-05-20T00:05:00.000Z",
              }
            : account,
      );
      await fulfillJson(route, operatorTenantPortalAccounts[0]);
      return;
    }

    if (
      method === "POST" &&
      path === `/tenants/${tenantId}/portal-accounts/portal-account-1/unlink`
    ) {
      const account =
        operatorTenantPortalAccounts[0] ??
        initialOperatorTenantPortalAccounts[0];
      operatorTenantPortalAccounts = [
        {
          ...account,
          status: "unlinked",
          deleted_at: "2026-05-20T00:00:00.000Z",
          updated_at: "2026-05-20T00:00:00.000Z",
          recovery_action: "unlinked",
          recovery_reason:
            "Operator unlinked access so the tenant can reconnect.",
          recovery_at: "2026-05-20T00:00:00.000Z",
        },
      ];
      await fulfillJson(route, {
        ...account,
        status: "unlinked",
        deleted_at: "2026-05-20T00:00:00.000Z",
        updated_at: "2026-05-20T00:00:00.000Z",
        recovery_action: "unlinked",
        recovery_reason:
          "Operator unlinked access so the tenant can reconnect.",
        recovery_at: "2026-05-20T00:00:00.000Z",
      });
      return;
    }

    if (method === "GET" && path === "/tenant-onboarding") {
      await fulfillJson(route, tenantOnboardings);
      return;
    }

    if (
      method === "POST" &&
      path === "/tenant-onboarding/onboarding-1/fresh-link"
    ) {
      const refreshedAt = "2026-05-20T00:10:00.000Z";
      tenantOnboardings = tenantOnboardings.map((onboarding) =>
        onboarding.id === "onboarding-1"
          ? {
              ...onboarding,
              token: "tenant-token-fresh",
              expires_at: "2026-06-03T00:10:00.000Z",
              last_sent_at: refreshedAt,
              resent_at: refreshedAt,
              onboarding_url:
                "http://127.0.0.1:3000/onboarding/tenant-token-fresh",
              portal_url:
                "http://127.0.0.1:3000/tenant-portal/tenant-token-fresh",
              updated_at: refreshedAt,
              delivery_data: {
                ...onboarding.delivery_data,
                fresh_link: {
                  refreshed_at: refreshedAt,
                  reason:
                    "Operator sent a fresh portal link from the tenant profile.",
                  expires_in_days: 14,
                  expires_at: "2026-06-03T00:10:00.000Z",
                },
              },
            }
          : onboarding,
      );
      await fulfillJson(route, tenantOnboardings[0]);
      return;
    }

    if (method === "GET" && path === "/tenant-portal/session") {
      await fulfillJson(route, tenantPortalSession());
      return;
    }

    if (method === "GET" && path === "/tenant-portal/account/status") {
      if (!tenantAccountLinked) {
        await fulfillJson(route, {
          status: "unlinked",
          tenant_id: null,
          tenant_name: null,
          email: null,
          linked_at: null,
          last_seen_at: null,
          revoked_at: null,
          recovery_action: "unlinked",
          recovery_at: "2026-05-20T00:00:00.000Z",
          recovery_hint:
            "The property team unlinked this tenant login so it can be safely reconnected. Open a fresh tenant portal link once to relink this account.",
        });
        return;
      }
      await fulfillJson(route, {
        status: "active",
        tenant_id: tenantAccountLinkedToDifferentTenant
          ? "tenant-linked-elsewhere"
          : tenantId,
        tenant_name: tenantAccountLinkedToDifferentTenant
          ? "Riverfront Books"
          : "Bright Cafe",
        email: "mia@example.com",
        linked_at: "2026-05-19T09:00:00.000Z",
        last_seen_at: "2026-05-19T09:30:00.000Z",
        revoked_at: null,
        recovery_action: null,
        recovery_at: null,
        recovery_hint:
          "This tenant login can open the portal without the original link. If it is linked to the wrong tenant, ask the property team to unlink and relink the account.",
      });
      return;
    }

    if (method === "GET" && path === "/tenant-portal/account/session") {
      if (!tenantAccountLinked) {
        await fulfillJson(
          route,
          { detail: "Tenant portal account not found." },
          401,
        );
        return;
      }
      await fulfillJson(
        route,
        tenantPortalSession(
          "account",
          tenantAccountLinkedToDifferentTenant
            ? {
                tenantId: "tenant-linked-elsewhere",
                tradingName: "Riverfront Books",
              }
            : {},
        ),
      );
      return;
    }

    if (method === "POST" && path === "/tenant-portal/account/claim") {
      tenantAccountLinked = true;
      await fulfillJson(route, tenantPortalSession("account"));
      return;
    }

    if (
      method === "PATCH" &&
      path === "/tenant-portal/notification-preferences"
    ) {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const emailEnabled =
        typeof payload.email_enabled === "boolean"
          ? payload.email_enabled
          : tenantPortalNotificationPreferences.email_enabled;
      const smsEnabled =
        typeof payload.sms_enabled === "boolean"
          ? payload.sms_enabled
          : tenantPortalNotificationPreferences.sms_enabled;
      tenantPortalNotificationPreferences = {
        ...tenantPortalNotificationPreferences,
        email_enabled: emailEnabled,
        sms_enabled: smsEnabled,
        billing_email_enabled:
          typeof payload.billing_email_enabled === "boolean"
            ? payload.billing_email_enabled
            : tenantPortalNotificationPreferences.billing_email_enabled,
        compliance_reminders_enabled:
          typeof payload.compliance_reminders_enabled === "boolean"
            ? payload.compliance_reminders_enabled
            : tenantPortalNotificationPreferences.compliance_reminders_enabled,
        preferred_channel: tenantPortalPreferredChannel(
          emailEnabled,
          smsEnabled,
        ),
        updated_at: "2026-05-20T03:15:00.000Z",
      };
      await fulfillJson(route, tenantPortalNotificationPreferences);
      return;
    }

    if (method === "POST" && path === "/tenant-portal/documents") {
      const body = request.postDataBuffer()?.toString("utf8") ?? "";
      const uploaded = {
        id: `portal-document-upload-${++tenantPortalDocumentCount}`,
        filename: multipartFilename(body),
        content_type: request
          .headers()
          ["content-type"]?.includes("multipart/form-data")
          ? null
          : (request.headers()["content-type"] ?? null),
        byte_size: request.postDataBuffer()?.byteLength ?? 0,
        category: multipartField(body, "category") ?? "other",
        notes: multipartField(body, "notes"),
        source: "tenant_portal",
        created_at: "2026-05-20T03:00:00.000Z",
      };
      tenantPortalDocuments.unshift(uploaded);
      await fulfillJson(route, uploaded, 201);
      return;
    }

    if (method === "POST" && path === "/tenant-portal/maintenance-requests") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const documentIds = jsonStringArray(payload.document_ids);
      const photoDocumentIds = jsonStringArray(payload.photo_document_ids);
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
        document_ids: documentIds,
        photo_document_ids: photoDocumentIds,
        metadata: {
          source: "tenant_portal",
          attached_document_ids: documentIds,
          attached_photo_document_ids: photoDocumentIds,
          activity_history: [
            {
              timestamp: "2026-05-20T03:00:00.000Z",
              actor: "tenant-portal:header:tenant-t",
              source: "tenant_portal",
              event: "tenant_submitted",
              summary: "Tenant submitted maintenance request.",
              status: "requested",
            },
          ],
        },
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
          history: created.metadata.activity_history.map((entry) => ({
            timestamp: entry.timestamp,
            event: entry.event,
            summary: entry.summary,
            status: entry.status,
          })),
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

    if (method === "PATCH" && path === "/obligations/obligation-1") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const nextPayload = { ...payload };
      if ("metadata" in nextPayload) {
        nextPayload.metadata = {
          ...jsonRecord(obligations[0].metadata),
          ...jsonRecord(nextPayload.metadata),
        };
      }
      Object.assign(obligations[0], nextPayload);
      await fulfillJson(route, obligations[0]);
      return;
    }

    if (
      method === "POST" &&
      path === "/obligations/obligation-1/assignment-notification/send-email"
    ) {
      Object.assign(obligations[0], {
        metadata: assignmentNotificationMetadata(
          obligations[0].metadata,
          obligations[0].id,
        ),
      });
      await fulfillJson(route, obligations[0]);
      return;
    }

    if (method === "GET" && path === "/maintenance/work-orders") {
      await fulfillJson(route, maintenanceWorkOrders);
      return;
    }

    if (method === "GET" && path === "/maintenance/work-orders/work-order-1") {
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "POST" &&
      path ===
        "/maintenance/work-orders/work-order-1/contractor-delivery/send-email"
    ) {
      const payload = request.postDataJSON() as {
        body?: string;
        subject?: string | null;
        include_comment?: boolean;
      };
      const body = (payload.body ?? "").trim();
      const subject =
        payload.subject?.trim() || "Maintenance update: Air conditioning fault";
      const timestamp = "2026-05-20T01:20:00.000Z";
      const existingDelivery = maintenanceWorkOrders[0].metadata
        .contractor_delivery as Record<string, JsonBody> | undefined;
      const existingEmailDelivery = existingDelivery?.email as
        | Record<string, JsonBody>
        | undefined;
      const existingReceipts = Array.isArray(existingEmailDelivery?.receipts)
        ? existingEmailDelivery.receipts
        : [];
      const existingHistory = Array.isArray(existingEmailDelivery?.history)
        ? existingEmailDelivery.history
        : [];
      const retryCount = existingHistory.length + 1;
      const contractorDelivery = {
        email: {
          send: {
            status: "queued",
            provider: "sendgrid",
            attempted_at: timestamp,
            sent_at: timestamp,
            sent_by_user_id: operatorId,
            provider_message_id: "sg-maintenance-1",
            recipient_email: "service@coolair.example",
            subject,
            body,
            error: null,
            template_key: "maintenance_contractor_update",
            template_version: "v1",
            retry_count: retryCount,
          },
          receipts: [
            {
              received_at: timestamp,
              channel: "email",
              status: "queued",
              provider: "sendgrid",
              recipient_email: "service@coolair.example",
              provider_message_id: "sg-maintenance-1",
              error: null,
              subject,
              template_key: "maintenance_contractor_update",
              template_version: "v1",
              retry_count: retryCount,
            },
            ...existingReceipts,
          ],
          history: [
            ...existingHistory,
            {
              event: "provider_delivery_attempted",
              at: timestamp,
              user_id: operatorId,
              provider: "sendgrid",
              status: "queued",
              recipient_email: "service@coolair.example",
              provider_message_id: "sg-maintenance-1",
              error: null,
              subject,
              template_key: "maintenance_contractor_update",
              template_version: "v1",
              retry_count: retryCount,
            },
          ],
        },
      };
      const existingComments =
        (maintenanceWorkOrders[0].metadata.comments as
          | JsonBody[]
          | undefined) ?? [];
      const comments =
        payload.include_comment === false
          ? existingComments
          : [
              ...existingComments,
              {
                timestamp,
                actor: operatorId,
                visibility: "contractor",
                body,
              },
            ];
      const commentActivity =
        payload.include_comment === false
          ? []
          : [
              {
                timestamp,
                actor: operatorId,
                source: "operator_api",
                event: "comment_added",
                visibility: "contractor",
                summary: body,
              },
            ];
      const metadata = {
        ...maintenanceWorkOrders[0].metadata,
        comments,
        contractor_delivery: contractorDelivery,
        activity_history: [
          ...maintenanceWorkOrders[0].metadata.activity_history,
          ...commentActivity,
          {
            timestamp,
            actor: operatorId,
            source: "operator_api",
            event: "contractor_email_attempted",
            summary: "Contractor email queued.",
            status: maintenanceWorkOrders[0].status,
          },
        ],
      };
      Object.assign(maintenanceWorkOrders[0], {
        metadata,
        updated_at: timestamp,
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "POST" &&
      path ===
        "/maintenance/work-orders/work-order-1/assignment-notification/send-email"
    ) {
      Object.assign(maintenanceWorkOrders[0], {
        metadata: assignmentNotificationMetadata(
          maintenanceWorkOrders[0].metadata,
          maintenanceWorkOrders[0].id,
        ),
        updated_at: "2026-05-20T01:15:00.000Z",
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "POST" &&
      path === "/maintenance/work-orders/work-order-1/comments"
    ) {
      const payload = request.postDataJSON() as {
        body?: string;
        visibility?: string;
      };
      const body = (payload.body ?? "").trim();
      const timestamp = "2026-05-20T01:15:00.000Z";
      const metadata = {
        ...maintenanceWorkOrders[0].metadata,
        comments: [
          ...((maintenanceWorkOrders[0].metadata.comments as
            | JsonBody[]
            | undefined) ?? []),
          {
            timestamp,
            actor: operatorId,
            visibility: payload.visibility ?? "internal",
            body,
          },
        ],
        activity_history: [
          ...maintenanceWorkOrders[0].metadata.activity_history,
          {
            timestamp,
            actor: operatorId,
            source: "operator_api",
            event: "comment_added",
            visibility: payload.visibility ?? "internal",
            summary: body,
          },
        ],
      };
      Object.assign(maintenanceWorkOrders[0], {
        metadata,
        updated_at: timestamp,
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "PATCH" &&
      path === "/maintenance/work-orders/work-order-1"
    ) {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const nextPayload = { ...payload };
      if ("metadata" in nextPayload) {
        nextPayload.metadata = {
          ...jsonRecord(maintenanceWorkOrders[0].metadata),
          ...jsonRecord(nextPayload.metadata),
        };
      }
      Object.assign(maintenanceWorkOrders[0], nextPayload, {
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
      const nextPayload = { ...payload };
      if ("metadata" in nextPayload) {
        nextPayload.metadata = {
          ...jsonRecord(arrearsCases[0].metadata),
          ...jsonRecord(nextPayload.metadata),
        };
      }
      Object.assign(arrearsCases[0], nextPayload, {
        updated_at: "2026-05-20T01:00:00.000Z",
      });
      await fulfillJson(route, arrearsCases[0]);
      return;
    }

    if (
      method === "POST" &&
      path === "/arrears/cases/arrears-1/assignment-notification/send-email"
    ) {
      Object.assign(arrearsCases[0], {
        metadata: assignmentNotificationMetadata(
          arrearsCases[0].metadata,
          arrearsCases[0].id,
        ),
        updated_at: "2026-05-20T01:15:00.000Z",
      });
      await fulfillJson(route, arrearsCases[0]);
      return;
    }

    if (method === "GET" && path === "/work-assignments/notification-center") {
      await fulfillJson(route, {
        entity_id: url.searchParams.get("entity_id") ?? entityId,
        generated_at: "2026-05-21T10:00:00.000Z",
        last_read_at: notificationCenterReadAt,
        unread_count: notificationCenterReadAt ? 0 : 3,
        notice_count: 2,
        attention_count: 1,
        ready_count: 0,
        in_flight_count: 1,
        done_count: 0,
        digest_receipt_count: 1,
        guardrails: [
          "Notification center is read-only; sending still requires explicit operator action.",
          "Digest receipts are preview receipts unless message_sent is true.",
        ],
        notices: [
          {
            target_id: "work-order-1",
            target_type: "maintenance_work_order",
            title: "Air conditioning fault",
            summary: "Assignment notification email was queued.",
            assignee_user_id: assigneeId,
            assignee_name: "Temba van Jaarsveld",
            assignee_email: "temba@example.com",
            group: "in_flight",
            notification_status: "queued",
            notification_detail: "Assignment email was queued by SendGrid.",
            channel: "email",
            provider: "sendgrid",
            due_date: "2026-05-20",
            event_at: "2026-05-20T01:15:00.000Z",
            follow_up_due: false,
            work_url: "/operations/maintenance/work-order-1",
          },
          {
            target_id: "arrears-1",
            target_type: "arrears_case",
            title: "Bright Cafe arrears",
            summary: "Assignment notification email failed.",
            assignee_user_id: assigneeId,
            assignee_name: "Temba van Jaarsveld",
            assignee_email: "temba@example.com",
            group: "attention",
            notification_status: "failed",
            notification_detail: "SendGrid returned 500.",
            channel: "email",
            provider: "sendgrid",
            due_date: "2026-05-18",
            event_at: "2026-05-20T00:30:00.000Z",
            follow_up_due: true,
            work_url: "/operations",
          },
        ],
        digest_receipts: [
          {
            assignee_user_id: operatorId,
            assignee_name: "Owner Operator",
            assignee_email: "owner@example.com",
            generated_at: "2026-05-21T09:00:00.000Z",
            cadence: "daily",
            item_count: 4,
            follow_up_due_count: 2,
            delivery_status: digestReceiptSent ? "queued" : "previewed",
            message_sent: digestReceiptSent,
            delivery_detail: digestReceiptSent
              ? "Digest email was queued by SendGrid."
              : null,
            provider_message_id: digestReceiptSent
              ? "sg-digest-smoke-retry"
              : null,
            delivery_trigger: digestReceiptSent ? "recovery" : "preview",
            recovery_of_generated_at: digestReceiptSent
              ? "2026-05-21T09:00:00.000Z"
              : null,
            delivery_attempt_count: digestReceiptSent ? 1 : 0,
          },
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path === "/work-assignments/notification-center/mark-read"
    ) {
      notificationCenterReadAt = "2026-05-21T10:05:00.000Z";
      await fulfillJson(route, {
        entity_id: url.searchParams.get("entity_id") ?? entityId,
        read_at: notificationCenterReadAt,
        unread_count: 0,
      });
      return;
    }

    if (method === "POST" && path === "/work-assignments/digests/run") {
      const payload = request.postDataJSON() as {
        entity_id?: string;
        cadence?: "daily" | "weekly";
        send_email_approved?: boolean;
        delivery_trigger?: "manual" | "scheduled" | "recovery";
        recovery_of_generated_at?: string | null;
      };
      const sendApproved = payload.send_email_approved === true;
      if (sendApproved) {
        digestReceiptSent = true;
      }
      await fulfillJson(route, {
        entity_id: payload.entity_id ?? entityId,
        cadence: payload.cadence ?? "daily",
        generated_at: "2026-05-21T02:30:00.000Z",
        operator_count: 1,
        work_item_count: 1,
        guardrails: [
          sendApproved
            ? "Digest email delivery only runs when send_email_approved is explicitly true."
            : "Digest generation is review-only; it does not send email, SMS, or push notifications.",
        ],
        digests: [
          {
            assignee_user_id: assigneeId,
            assignee_name: "Temba van Jaarsveld",
            assignee_email: "temba@example.com",
            cadence: payload.cadence ?? "daily",
            item_count: 1,
            ready_count: 0,
            attention_count: 0,
            in_flight_count: 1,
            done_count: 0,
            follow_up_due_count: 0,
            delivery_status: sendApproved ? "queued" : "previewed",
            message_sent: sendApproved,
            delivery_detail: sendApproved
              ? "Digest email was queued by SendGrid."
              : null,
            provider_message_id: sendApproved ? "sg-digest-smoke-1" : null,
            delivery_trigger: sendApproved
              ? (payload.delivery_trigger ?? "manual")
              : "preview",
            recovery_of_generated_at: payload.recovery_of_generated_at ?? null,
            delivery_attempt_count: sendApproved ? 1 : 0,
            items: [
              {
                target_id: "work-order-1",
                target_type: "maintenance_work_order",
                title: "Air conditioning fault",
                description: "Tenant says the unit is not cooling.",
                due_date: "2026-05-21",
                status: "requested",
                priority: "urgent",
                notification_status: "queued",
                notification_group: "in_flight",
                notification_detail: "Assignment email was queued by SendGrid.",
                reminder_due_on: null,
                escalation_due_on: "2026-05-22",
                follow_up_due: false,
                work_url: "/operations/maintenance/work-order-1",
              },
            ],
          },
        ],
      });
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
      await fulfillJson(route, localInvoiceDrafts);
      return;
    }

    if (method === "GET" && path === "/document-intakes") {
      await fulfillJson(route, documentIntakes);
      return;
    }

    if (method === "GET" && path === "/documents") {
      await fulfillJson(route, operatorDocumentRecords());
      return;
    }

    if (method === "POST" && path === "/documents") {
      const body = request.postDataBuffer()?.toString("utf8") ?? "";
      const uploaded = {
        id: `operator-document-upload-${++tenantPortalDocumentCount}`,
        filename: multipartFilename(body),
        content_type: request
          .headers()
          ["content-type"]?.includes("multipart/form-data")
          ? null
          : (request.headers()["content-type"] ?? null),
        byte_size: request.postDataBuffer()?.byteLength ?? 0,
        category: multipartField(body, "category") ?? "other",
        notes: multipartField(body, "notes"),
        source: "operator_upload",
        created_at: "2026-05-20T03:30:00.000Z",
      };
      tenantPortalDocuments.unshift(uploaded);
      await fulfillJson(route, operatorDocumentRecords()[0], 201);
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
