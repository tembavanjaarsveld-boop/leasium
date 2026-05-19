import type { Page, Route } from "@playwright/test";

type JsonBody =
  | null
  | boolean
  | number
  | string
  | JsonBody[]
  | { [key: string]: JsonBody };

const entityId = "entity-1";
const propertyId = "property-1";
const tenantId = "tenant-1";
const unitId = "unit-1";
const leaseId = "lease-1";

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
  let chargeAccountCode: string | null = "401";
  let chargeTaxType: string | null = null;

  const xeroConnection = () => ({
    entity_id: entityId,
    entity_name: "Acme Holdings Pty Ltd",
    connected: Boolean(xeroTenantId),
    xero_tenant_id: xeroTenantId,
    connected_at: xeroConnectedAt,
    last_sync_at: null,
    status_label: xeroTenantId ? "Connected" : "Not connected",
    next_action: xeroTenantId
      ? "Review contact, chart, tax, invoice, and payment readiness before enabling sync."
      : "Record the Xero tenant connection before any sync approval can be enabled.",
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
        detail: "Queen Street Retail Centre / Shop 3 is taxable and needs a Xero tax type.",
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
      connection: xeroConnection(),
      contact_mapping: { total: 2, ready: 2, missing: 0 },
      chart_mapping: { total: 1, ready: chargeAccountCode ? 1 : 0, missing: chargeAccountCode ? 0 : 1 },
      tax_mapping: { total: 1, ready: chargeTaxType ? 1 : 0, missing: chargeTaxType ? 0 : 1 },
      invoice_sync: {
        total_invoice_drafts: 0,
        approved_unsynced: 0,
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
        "This surface records readiness only; it does not call Xero.",
        "Invoice posting remains blocked until a future explicit approval action exists.",
        "Payment reconciliation is manual status tracking until bank/Xero feeds are connected.",
      ],
    };
  };

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
        xero_blocker_count: xero.issues.filter((issue) => issue.severity === "blocker")
          .length,
        approved_unsynced_invoice_count: 1,
        unpaid_invoice_count: 1,
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

    if (method === "GET" && path === "/xero/status") {
      await fulfillJson(route, xeroStatus());
      return;
    }

    if (method === "GET" && path === "/insights/overview") {
      await fulfillJson(route, insightsOverview());
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
      } else {
        xeroTenantId = payload.xero_tenant_id ?? "tenant-smoke";
        xeroConnectedAt = "2026-05-19T10:00:00.000Z";
      }
      await fulfillJson(route, xeroConnection());
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

    if (method === "GET" && path === "/obligations") {
      await fulfillJson(route, obligations);
      return;
    }

    if (method === "GET" && path === "/rent-roll") {
      await fulfillJson(route, rentRoll);
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
