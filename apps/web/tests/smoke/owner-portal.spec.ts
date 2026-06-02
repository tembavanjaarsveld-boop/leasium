import { readFile } from "node:fs/promises";

import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

const OWNER_PORTAL_RESPONSE = {
  auth: {
    mode: "operator_preview",
    token_source: "bearer",
    owner_auth_configured: true,
    boundary: "operator_session",
    detail:
      "Read-only operator preview scoped by entity role; no owner portal account is created.",
  },
  owner: {
    id: "owner-1",
    entity_id: "entity-1",
    display_name: "SKJ Holdings Pty Ltd",
    legal_name: "SKJ Holdings Pty Ltd",
    abn: "11222333444",
    trustee_name: null,
    trust_name: null,
    invoice_issuer_name: null,
    billing_contact_name: "Mia Accounts",
    billing_email: "owners@queenstreet.example",
    invoice_reference: null,
    gst_registered: true,
  },
  properties: [
    {
      property_id: "property-2",
      property_name: "King Street Offices",
      split_pct: 40,
    },
    {
      property_id: "property-1",
      property_name: "Queen Street Retail Centre",
      split_pct: 60,
    },
  ],
  statement: {
    month: "2026-05",
    owner_identity: "SKJ Holdings Pty Ltd",
    property_count: 2,
    properties: [
      {
        property_id: "property-1",
        property_name: "Queen Street Retail Centre",
        invoiced_cents: 880000,
        paid_cents: 0,
        outstanding_cents: 880000,
        invoice_count: 1,
      },
      {
        property_id: "property-2",
        property_name: "King Street Offices",
        invoiced_cents: 880000,
        paid_cents: 0,
        outstanding_cents: 880000,
        invoice_count: 1,
      },
    ],
    invoiced_cents: 1760000,
    paid_cents: 0,
    outstanding_cents: 1760000,
    invoice_count: 2,
  },
  documents: [
    {
      id: "document-owner-visible-1",
      property_id: "property-1",
      property_name: "Queen Street Retail Centre",
      filename: "owner-visible-report.pdf",
      content_type: "application/pdf",
      byte_size: 13,
      category: "other",
      notes: "Quarterly property report",
      source_label: '=HYPERLINK("https://unsafe.example")',
      created_at: "2026-05-31T00:00:00.000Z",
    },
  ],
  maintenance: {
    open_count: 1,
    urgent_count: 1,
    awaiting_approval_count: 1,
    items: [
      {
        id: "work-order-1",
        property_id: "property-1",
        property_name: "Queen Street Retail Centre",
        title: "Air conditioning quote review",
        status: "awaiting_approval",
        priority: "urgent",
        requested_at: "2026-05-31T00:00:00.000Z",
        due_date: "2026-06-07",
        completed_at: null,
        approval_required: true,
        approval_status: "pending",
        quote_amount_cents: 125000,
      },
    ],
  },
  compliance: {
    open_count: 2,
    overdue_count: 1,
    due_soon_count: 1,
    missing_evidence_count: 1,
    items: [
      {
        id: "compliance-1",
        property_id: "property-1",
        property_name: "Queen Street Retail Centre",
        title: "Fire safety certificate",
        kind: "fire_safety",
        status: "active",
        due_status: "overdue",
        next_due_date: "2026-05-30",
        certificate_expires_on: "2026-05-31",
        last_checked_at: "2026-05-31T00:00:00.000Z",
        evidence_status: "missing",
        tenant_name: "Private Compliance Tenant Pty Ltd",
        internal_notes: "Internal compliance note",
        source_document_id: "source-doc-secret",
        evidence_id: "evidence-secret-1",
        operator_name: "Operator Avery",
      },
      {
        id: "compliance-2",
        property_id: "property-2",
        property_name: "King Street Offices",
        title: "Essential services inspection",
        kind: "inspection",
        status: "active",
        due_status: "due_soon",
        next_due_date: "2026-06-10",
        certificate_expires_on: null,
        last_checked_at: null,
        evidence_status: "linked",
      },
    ],
  },
  lease_events: {
    upcoming_count: 2,
    rent_review_count: 1,
    expiry_count: 1,
    events: [
      {
        lease_id: "lease-owner-visible-1",
        property_id: "property-1",
        property_name: "Queen Street Retail Centre",
        unit_label: "Suite 8",
        event_kind: "rent_review",
        event_date: "2026-06-15",
        lease_status: "active",
        annual_rent_cents: 3600000,
      },
      {
        lease_id: "lease-owner-visible-1",
        property_id: "property-1",
        property_name: "Queen Street Retail Centre",
        unit_label: "Suite 8",
        event_kind: "lease_expiry",
        event_date: "2026-07-31",
        lease_status: "active",
        annual_rent_cents: 3600000,
      },
    ],
  },
  guardrails: [
    "Read-only owner portal: opening this page does not send owner email, dispatch invoices, write Xero data, reconcile payments, refresh providers, or mutate provider history.",
    "Shared document downloads are account-scoped and limited to files explicitly shared by the property team for this owner; no owner statement PDFs are generated or sent from the portal.",
  ],
  generated_at: "2026-05-31T00:00:00.000Z",
};

const LONG_OWNER_BILLING_EMAIL =
  "owner.accounts.with.an.extremely.long.mailbox.name@very-long-owner-domain.example";

const OWNER_PORTAL_EMPTY_RESPONSE = {
  ...OWNER_PORTAL_RESPONSE,
  owner: {
    ...OWNER_PORTAL_RESPONSE.owner,
    billing_email: LONG_OWNER_BILLING_EMAIL,
  },
  properties: [],
  statement: null,
  documents: [],
  maintenance: {
    open_count: 0,
    urgent_count: 0,
    awaiting_approval_count: 0,
    items: [],
  },
  compliance: {
    open_count: 0,
    overdue_count: 0,
    due_soon_count: 0,
    missing_evidence_count: 0,
    items: [],
  },
  lease_events: {
    upcoming_count: 0,
    rent_review_count: 0,
    expiry_count: 0,
    events: [],
  },
};

async function navigateWithAppRouter(page: Page, href: string) {
  await page.evaluate((targetHref) => {
    const router = (
      window as typeof window & {
        next?: { router?: { push: (href: string) => void } };
      }
    ).next?.router;
    if (!router) {
      throw new Error("Next router unavailable.");
    }
    router.push(targetHref);
  }, href);
}

test("owner portal preview renders read-only owner statement data", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  const unsafeRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const mutatesOwnerPortal =
      path.startsWith("/api/v1/owner-portal/") &&
      ["DELETE", "PATCH", "POST"].includes(method);
    const callsExternalOrDispatchPath =
      path.startsWith("/api/v1/owners/statements/send") ||
      path.startsWith("/api/v1/owners/statements/dispatch") ||
      path.startsWith("/api/v1/owners/statements/pdf") ||
      path.startsWith("/api/v1/comms") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path.startsWith("/api/v1/payments") ||
      path.startsWith("/api/v1/reconciliation");
    const downloadsSharedDocument =
      path.startsWith("/api/v1/owner-portal/account/documents/") &&
      path.endsWith("/download");
    if (
      mutatesOwnerPortal ||
      callsExternalOrDispatchPath ||
      downloadsSharedDocument
    ) {
      unsafeRequests.push(`${method} ${path}`);
    }
  });

  await page.route("**/api/v1/owners/statements/send**", async (route) => {
    unsafeRequests.push(
      `${route.request().method()} /api/v1/owners/statements/send`,
    );
    await route.fulfill({ status: 500, body: "send must stay unused" });
  });
  await page.route("**/api/v1/owner-portal/owner-1**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER_PORTAL_RESPONSE),
    });
  });

  await page.goto("/owner-portal/owner-1?month=2026-05");

  await expect(page.getByRole("heading", { name: "Owner portal" })).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(page.getByText("SKJ Holdings Pty Ltd").first()).toBeVisible();
  await expect(page.getByText("Mia Accounts")).toBeVisible();
  await expect(
    page.getByText("Queen Street Retail Centre").first(),
  ).toBeVisible();
  await expect(page.getByText("King Street Offices").first()).toBeVisible();
  await expect(page.getByText("$17,600").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shared documents" }),
  ).toBeVisible();
  await expect(
    page.getByText("owner-visible-report.pdf", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Quarterly property report")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Maintenance snapshot" }),
  ).toBeVisible();
  await expect(page.getByText("Air conditioning quote review")).toBeVisible();
  await expect(
    page.getByText("Queen Street Retail Centre").first(),
  ).toBeVisible();
  await expect(page.getByText("$1,250 quote")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Compliance snapshot" }),
  ).toBeVisible();
  await expect(page.getByText("Fire safety certificate")).toBeVisible();
  await expect(page.getByText("Essential services inspection")).toBeVisible();
  await expect(page.getByText("Overdue").first()).toBeVisible();
  await expect(page.getByText("Missing evidence").first()).toBeVisible();
  await expect(page.getByText("Due soon").first()).toBeVisible();
  await expect(page.getByText("Evidence linked").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lease events" }),
  ).toBeVisible();
  await expect(page.getByText("Rent review").first()).toBeVisible();
  await expect(page.getByText("Lease expiry").first()).toBeVisible();
  await expect(page.getByText("Suite 8").first()).toBeVisible();
  await expect(page.getByText("$36,000 annual rent").first()).toBeVisible();
  await expect(page.getByText("Private Contractor")).toHaveCount(0);
  await expect(page.getByText("dispatch@private.example")).toHaveCount(0);
  await expect(page.getByText("sendgrid-secret")).toHaveCount(0);
  await expect(page.getByText("Private Lease Tenant Pty Ltd")).toHaveCount(0);
  await expect(page.getByText("tenant_id")).toHaveCount(0);
  await expect(page.getByText("Private lease note")).toHaveCount(0);
  await expect(page.getByText("Private Compliance Tenant Pty Ltd")).toHaveCount(
    0,
  );
  await expect(page.getByText("Internal compliance note")).toHaveCount(0);
  await expect(page.getByText("source-doc-secret")).toHaveCount(0);
  await expect(page.getByText("evidence-secret-1")).toHaveCount(0);
  await expect(page.getByText("Operator Avery")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Owner-visible packet" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy packet" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download packet CSV" }),
  ).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy packet" }).click();
  await expect(page.getByText("Owner-visible packet copied.")).toBeVisible();
  const copiedPacket = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(copiedPacket).toContain("SKJ Holdings Pty Ltd");
  expect(copiedPacket).toContain("Operator preview");
  expect(copiedPacket).toContain("Queen Street Retail Centre");
  expect(copiedPacket).toContain("King Street Offices");
  expect(copiedPacket).toContain("60%");
  expect(copiedPacket).toContain("40%");
  expect(copiedPacket).toContain("$17,600");
  expect(copiedPacket).toContain("owner-visible-report.pdf");
  expect(copiedPacket).toContain("Air conditioning quote review");
  expect(copiedPacket).toContain("$1,250");
  expect(copiedPacket).toContain("Compliance");
  expect(copiedPacket).toContain("Fire safety certificate");
  expect(copiedPacket).toContain("Essential services inspection");
  expect(copiedPacket).toContain("Missing evidence");
  expect(copiedPacket).toContain("Evidence linked");
  expect(copiedPacket).not.toContain("Private Compliance Tenant Pty Ltd");
  expect(copiedPacket).not.toContain("Internal compliance note");
  expect(copiedPacket).not.toContain("source-doc-secret");
  expect(copiedPacket).not.toContain("evidence-secret-1");
  expect(copiedPacket).not.toContain("Operator Avery");
  expect(copiedPacket).toContain("Lease events");
  expect(copiedPacket).toContain("Rent review");
  expect(copiedPacket).toContain("Lease expiry");
  expect(copiedPacket).toContain("Suite 8");
  expect(copiedPacket).toContain("does not send owner email");
  expect(copiedPacket).toContain("'=HYPERLINK");

  const packetDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download packet CSV" }).click();
  const packetDownload = await packetDownloadPromise;
  expect(packetDownload.suggestedFilename()).toBe(
    "owner-visible-review-packet-2026-05-owner-1.csv",
  );
  const packetDownloadPath = await packetDownload.path();
  const packetCsv = await readFile(packetDownloadPath!, "utf8");
  expect(packetCsv).toContain("SKJ Holdings Pty Ltd");
  expect(packetCsv).toContain("Operator preview");
  expect(packetCsv).toContain("Queen Street Retail Centre");
  expect(packetCsv).toContain("King Street Offices");
  expect(packetCsv).toContain("owner-visible-report.pdf");
  expect(packetCsv).toContain("Air conditioning quote review");
  expect(packetCsv).toContain("$1,250");
  expect(packetCsv).toContain("Compliance");
  expect(packetCsv).toContain("Fire safety certificate");
  expect(packetCsv).toContain("Essential services inspection");
  expect(packetCsv).toContain("Missing evidence");
  expect(packetCsv).toContain("Evidence linked");
  expect(packetCsv).not.toContain("Private Compliance Tenant Pty Ltd");
  expect(packetCsv).not.toContain("Internal compliance note");
  expect(packetCsv).not.toContain("source-doc-secret");
  expect(packetCsv).not.toContain("evidence-secret-1");
  expect(packetCsv).not.toContain("Operator Avery");
  expect(packetCsv).toContain("Lease events");
  expect(packetCsv).toContain("Rent review");
  expect(packetCsv).toContain("Lease expiry");
  expect(packetCsv).toContain("Suite 8");
  expect(packetCsv).toContain("does not send owner email");
  expect(packetCsv).toContain("'=HYPERLINK");

  await expect(
    page.getByRole("button", { name: "Download owner-visible-report.pdf" }),
  ).toHaveCount(0);
  await expect(page.getByText("Operator preview")).toBeVisible();
  await expect(page.getByText("operator_preview")).toHaveCount(0);
  await expect(page.getByText("operator_upload")).toHaveCount(0);
  await expect(
    page.getByText("Read-only owner portal", { exact: false }),
  ).toBeVisible();
  expect(unsafeRequests).toEqual([]);
});

test("self-managed accounts do not open operator owner portal previews", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  const ownerPortalRequests: string[] = [];

  await page.route("**/api/v1/owner-portal/owner-1**", async (route) => {
    ownerPortalRequests.push(route.request().url());
    await route.fulfill({
      status: 500,
      body: "self-managed owner portal preview must stay gated",
    });
  });

  await page.goto("/owner-portal/owner-1?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("managing-agent or hybrid accounts", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open entity statements" }),
  ).toHaveAttribute("href", "/statements");
  expect(ownerPortalRequests).toEqual([]);
});

test("owner portal preview shows not-found copy without stale owner data", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.route("**/api/v1/owner-portal/owner-missing**", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Owner portal preview not found for this owner.",
      }),
    });
  });

  await page.goto("/owner-portal/owner-missing?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal preview not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("Owner portal preview not found for this owner."),
  ).toBeVisible();
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toHaveCount(0);
  await expect(page.getByText("Queen Street Retail Centre")).toHaveCount(0);
  await expect(page.getByText("$17,600")).toHaveCount(0);
});

test("owner portal preview keeps service failures generic with API detail", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.route("**/api/v1/owner-portal/owner-1**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Owner portal provider temporarily unavailable.",
      }),
    });
  });

  await page.goto("/owner-portal/owner-1?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("Owner portal provider temporarily unavailable."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner portal preview not found" }),
  ).toHaveCount(0);
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toHaveCount(0);
});

test("owner portal preview refetches on return and clears stale owner data", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  let ownerOneMode: "success" | "not_found" = "success";
  let ownerOneRequests = 0;

  await page.route("**/api/v1/owner-portal/owner-1**", async (route) => {
    ownerOneRequests += 1;
    if (ownerOneMode === "not_found") {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Owner portal preview no longer exists.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER_PORTAL_RESPONSE),
    });
  });
  await page.route("**/api/v1/owner-portal/owner-2**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...OWNER_PORTAL_RESPONSE,
        owner: {
          ...OWNER_PORTAL_RESPONSE.owner,
          id: "owner-2",
          display_name: "Other Owner Pty Ltd",
          legal_name: "Other Owner Pty Ltd",
        },
      }),
    });
  });

  await page.goto("/owner-portal/owner-1?month=2026-05");
  await expect(page.getByText("SKJ Holdings Pty Ltd").first()).toBeVisible({
    timeout: 15_000,
  });

  ownerOneMode = "not_found";
  await navigateWithAppRouter(page, "/owner-portal/owner-2?month=2026-05");
  await expect(page.getByText("Other Owner Pty Ltd").first()).toBeVisible();
  await navigateWithAppRouter(page, "/owner-portal/owner-1?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal preview not found" }),
  ).toBeVisible();
  await expect(
    page.getByText("Owner portal preview no longer exists."),
  ).toBeVisible();
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toHaveCount(0);
  await expect(page.getByText("Queen Street Retail Centre")).toHaveCount(0);
  expect(ownerOneRequests).toBeGreaterThanOrEqual(2);
});

test("owner portal preview renders mobile empty states without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  const unsafeRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (
      (path.startsWith("/api/v1/owner-portal/") &&
        ["DELETE", "PATCH", "POST"].includes(method)) ||
      path.startsWith("/api/v1/owners/statements/send") ||
      path.startsWith("/api/v1/owners/statements/dispatch") ||
      path.startsWith("/api/v1/owners/statements/pdf") ||
      path.startsWith("/api/v1/comms") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path.startsWith("/api/v1/payments") ||
      path.startsWith("/api/v1/reconciliation") ||
      (path.startsWith("/api/v1/owner-portal/account/documents/") &&
        path.endsWith("/download"))
    ) {
      unsafeRequests.push(`${method} ${path}`);
    }
  });
  await page.route("**/api/v1/owner-portal/owner-1**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER_PORTAL_EMPTY_RESPONSE),
    });
  });

  await page.goto("/owner-portal/owner-1?month=2026-05");

  await expect(page.getByRole("heading", { name: "Owner portal" })).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(
    page.getByRole("heading", { name: "Owner-visible packet" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy packet" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download packet CSV" }),
  ).toBeVisible();
  await expect(page.getByText("0 linked")).toBeVisible();
  await expect(page.getByText("$0 outstanding")).toBeVisible();
  await expect(page.getByText("0 open").first()).toBeVisible();
  await expect(page.getByText("No statement available.")).toBeVisible();
  await expect(page.getByText("No open maintenance.")).toBeVisible();
  await expect(page.getByText("No compliance items.")).toBeVisible();
  await expect(page.getByText("No upcoming lease events.")).toBeVisible();
  await expect(page.getByText("No shared documents.")).toBeVisible();
  await expect(page.getByText("No linked properties.")).toBeVisible();
  await expect(page.getByText("May 2026").first()).toBeVisible();
  await expect(
    page.getByText("Read-only owner portal", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(LONG_OWNER_BILLING_EMAIL, { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByText(LONG_OWNER_BILLING_EMAIL, { exact: true })
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      }),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(unsafeRequests).toEqual([]);
});
