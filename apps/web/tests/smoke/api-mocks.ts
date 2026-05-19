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
      await fulfillJson(route, entities);
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

    await fulfillJson(
      route,
      {
        detail: `Unhandled smoke mock: ${method} ${url.pathname}${url.search}`,
      },
      404,
    );
  });
}
