import { expect, test, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

// The two-entity fixture defaults fresh storage to All entities; pin these
// single-entity specs to the primary entity.
test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
});

async function expectTouchSafe(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test("mobile billing readiness uses calm loading KPIs and review draft cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);

  let delayedRentRoll = true;
  await page.route("**/api/v1/rent-roll?**", async (route) => {
    if (delayedRentRoll) {
      delayedRentRoll = false;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.fallback();
  });

  await page.goto("/billing-readiness");

  const kpis = page.locator("section").filter({ hasText: "Ready to bill" });
  await expect(kpis).toBeVisible();
  await expect(kpis.getByText("...", { exact: true })).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Review & approve/ }).click();

  const mobileDraftCard = page
    .getByTestId("billing-draft-mobile-card")
    .filter({ hasText: "May rent and outgoings" })
    .first();
  await expect(mobileDraftCard).toBeVisible();
  await expect(mobileDraftCard.getByText("$8,800")).toBeVisible();
  await expect(
    mobileDraftCard.getByRole("link", { name: /Intake intake-1/ }),
  ).toHaveAttribute("href", "/intake?entity_id=entity-1&review=intake-1");
  await expect(
    mobileDraftCard.getByRole("button", { name: "Go to send" }),
  ).toBeVisible();
});

test("mobile billing operations expose invoice and delivery cards without raw placeholders", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);

  await page.goto("/billing-readiness");
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Review & approve/ }).click();
  const invoicePrepCard = page
    .getByTestId("invoice-prep-mobile-card")
    .filter({ hasText: "INV-1001" })
    .first();
  await expect(invoicePrepCard).toBeVisible();
  await expect(invoicePrepCard.getByText("Bright Cafe Pty Ltd")).toBeVisible();
  await expect(invoicePrepCard.getByText("$8,800")).toBeVisible();
  const previewLink = invoicePrepCard.getByRole("link", { name: "Preview" });
  await expect(previewLink).toBeVisible();
  const previewBox = await previewLink.boundingBox();
  expect(previewBox?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("tab", { name: /Send & get paid/ }).click();
  const deliveryCard = page
    .getByTestId("billing-delivery-mobile-card")
    .filter({ hasText: "INV-1002" })
    .first();
  await expect(deliveryCard).toBeVisible();
  await expect(deliveryCard.getByText("Recovery needed #1")).toBeVisible();
  const retryDispatchButton = deliveryCard.getByRole("button", {
    name: "Retry dispatch",
  });
  await expect(retryDispatchButton).toBeVisible();
  const retryBox = await retryDispatchButton.boundingBox();
  expect(retryBox?.height).toBeGreaterThanOrEqual(44);

  await expect(page.locator("body")).not.toContainText(/\.\.\.|Loading\.\.\./);
});

test("desktop billing readiness row actions stay touch-safe without firing provider actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  const mutationCalls: string[] = [];
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutationCalls.push(`${method} ${new URL(request.url()).pathname}`);
    }
    await route.fallback();
  });

  await page.goto("/billing-readiness");
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Review & approve/ }).click();
  const draftTable = page
    .locator("table")
    .filter({ hasText: "May rent and outgoings" })
    .first();
  await expect(draftTable).toBeVisible();
  await expectTouchSafe(
    draftTable.getByRole("button", { name: "Go to send" }).first(),
  );

  await page.getByRole("tab", { name: /Review & approve/ }).click();
  const invoicePrepTable = page
    .locator("table")
    .filter({ hasText: "INV-1001" })
    .first();
  await expect(invoicePrepTable).toBeVisible();
  await expectTouchSafe(
    invoicePrepTable.getByRole("button", { name: "Prepare" }).first(),
  );
  await expectTouchSafe(
    invoicePrepTable.getByRole("button", { name: "Approve" }).first(),
  );

  await page.getByRole("tab", { name: /Send & get paid/ }).click();
  const deliveryTable = page
    .locator("table")
    .filter({ hasText: "INV-1002" })
    .first();
  await expect(deliveryTable).toBeVisible();
  await expectTouchSafe(
    deliveryTable.getByRole("button", { name: "Retry dispatch" }).first(),
  );
  await expectTouchSafe(
    deliveryTable.getByRole("button", { name: "Email" }).first(),
  );
  await expectTouchSafe(
    deliveryTable.getByRole("button", { name: "Sent" }).first(),
  );
  await expectTouchSafe(
    deliveryTable.getByRole("button", { name: "Paid" }).first(),
  );

  expect(mutationCalls).toEqual([]);
});

test("billing delivery dead-end guides the operator back to invoice drafting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  await page.route("**/api/v1/invoice-drafts?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route("**/api/v1/rent-roll?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          entity_id: "entity-1",
          entity_name: "Acme Holdings Pty Ltd",
          property_id: "property-1",
          property_name: "Queen Street Retail Centre",
          tenancy_unit_id: "unit-1",
          unit_label: "Shop 3",
          lease_id: "lease-1",
          tenant_id: "tenant-1",
          tenant_name: "Bright Cafe Pty Ltd",
          lease_status: "active",
          commencement_date: "2025-07-01",
          expiry_date: "2028-06-30",
          tenant_billing_email: "accounts@bright.example",
          annual_rent_cents: 9600000,
          rent_frequency: "monthly",
          charge_rules: [],
          charge_rules_total_cents: 880000,
          next_due_date: "2026-05-01",
          gst_readiness_blockers: [],
          xero_readiness_blockers: [],
          invoice_readiness_blockers: [],
        },
      ]),
    });
  });

  const mutationCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutationCalls.push(`${method} ${new URL(request.url()).pathname}`);
    }
    await route.fallback();
  });

  await page.goto("/billing-readiness?entity_id=entity-1&tab=delivery");
  await expect(
    page.getByRole("heading", { name: "Send & track payments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("No approved invoices", { exact: true }),
  ).toBeVisible();

  const guide = page.getByRole("region", { name: "Monthly invoice run" });
  await expect(guide).toBeVisible();
  await expect(
    guide.getByText(
      "Nothing is emailed, synced to Xero, or marked paid until you choose to do it.",
    ),
  ).toBeVisible();

  await guide.getByRole("button", { name: "Review & approve" }).click();
  await expect(
    page.getByRole("tab", { name: /Review & approve/ }),
  ).toHaveAttribute("aria-selected", "true");
  expect(mutationCalls).toEqual([]);
});

test("monthly invoice run separates setup and payment follow-up from dispatch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  const mutationCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutationCalls.push(`${method} ${new URL(request.url()).pathname}`);
    }
    await route.fallback();
  });

  await page.goto("/billing-readiness?entity_id=entity-1&tab=delivery");
  const monthlyRun = page.getByRole("region", {
    name: "Monthly invoice run",
  });
  await expect(monthlyRun).toBeVisible();
  await expect(monthlyRun.getByText("Monthly invoice run")).toBeVisible();
  await expect(monthlyRun.getByText("1. Review & approve")).toBeVisible();
  await expect(monthlyRun.getByText("2. Send")).toBeVisible();
  await expect(monthlyRun.getByText("3. Get paid")).toBeVisible();
  await expect(
    monthlyRun.getByText(
      "Nothing is emailed, synced to Xero, or marked paid until you choose to do it.",
    ),
  ).toBeVisible();
  expect(mutationCalls).toEqual([]);
});

test("empty billing draft review can create local drafts from ready charge rules", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  const readyRentRow = {
    entity_id: "entity-1",
    entity_name: "Acme Holdings Pty Ltd",
    property_id: "property-1",
    property_name: "Queen Street Retail Centre",
    tenancy_unit_id: "unit-1",
    unit_label: "Shop 3",
    lease_id: "lease-1",
    tenant_id: "tenant-1",
    tenant_name: "Bright Cafe Pty Ltd",
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
        amount_cents: 880000,
        frequency: "monthly",
        gst_treatment: "taxable",
        xero_account_code: "401",
        xero_tax_type: "OUTPUT",
        start_date: "2025-07-01",
        end_date: null,
        next_due_date: "2026-06-01",
        arrears_or_advance: "advance",
      },
    ],
    charge_rules_total_cents: 880000,
    next_due_date: "2026-06-01",
    gst_readiness_blockers: [],
    xero_readiness_blockers: [],
    invoice_readiness_blockers: [],
  };
  const localBillingDrafts: Array<Record<string, unknown>> = [];

  await page.route("**/api/v1/rent-roll?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([readyRentRow]),
    });
  });
  await page.route("**/api/v1/invoice-drafts?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route(
    (url) =>
      url.pathname === "/api/v1/billing-drafts" ||
      url.pathname === "/api/v1/billing-drafts/from-charge-rules",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (request.method() === "GET" && path === "/api/v1/billing-drafts") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(localBillingDrafts),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/api/v1/billing-drafts/from-charge-rules"
      ) {
        const payload = request.postDataJSON() as {
          entity_id: string;
          lease_ids?: string[];
          as_of?: string | null;
        };
        const createdDraft = {
          id: "billing-draft-created-1",
          entity_id: payload.entity_id,
          property_id: readyRentRow.property_id,
          tenancy_unit_id: readyRentRow.tenancy_unit_id,
          tenant_id: readyRentRow.tenant_id,
          lease_id: readyRentRow.lease_id,
          document_id: "document-charge-rule-1",
          document_intake_id: null,
          status: "needs_review",
          title: "Bright Cafe Pty Ltd draft charges",
          currency: "AUD",
          issue_date: payload.as_of ?? "2026-06-23",
          due_date: readyRentRow.next_due_date,
          total_cents: readyRentRow.charge_rules_total_cents,
          notes:
            "Prepared from existing Leasium charge rules. No PDF, tenant email, or Xero sync has run.",
          metadata: {
            source: "charge_rule_batch",
            guardrail:
              "No invoice PDF, tenant email, or Xero sync runs from this batch step.",
          },
          lines: [],
          created_at: "2026-06-23T00:00:00.000Z",
          updated_at: "2026-06-23T00:00:00.000Z",
          deleted_at: null,
        };
        localBillingDrafts.push(createdDraft);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            created: 1,
            existing: 0,
            skipped: 0,
            drafts: [createdDraft],
            skipped_rows: [],
          }),
        });
        return;
      }
      await route.fallback();
    },
  );

  const mutationCalls: string[] = [];
  page.on("request", (request) => {
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/v1/") &&
      !["GET", "HEAD", "OPTIONS"].includes(method)
    ) {
      mutationCalls.push(`${method} ${new URL(request.url()).pathname}`);
    }
  });

  await page.goto("/billing-readiness?entity_id=entity-1&tab=billing-drafts");
  await expect(
    page.getByRole("heading", { name: "Review & approve" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("No billing drafts", { exact: true }),
  ).toBeVisible();

  const guide = page.getByRole("region", { name: "Monthly invoice run" });
  await expect(
    guide.getByRole("heading", { name: "Create this month's invoices" }),
  ).toBeVisible();
  await guide
    .getByRole("button", { name: "Create this month's invoices" })
    .click();

  await expect
    .poll(() => mutationCalls)
    .toEqual(["POST /api/v1/billing-drafts/from-charge-rules"]);
  await expect.poll(() => localBillingDrafts.length).toBe(1);
  await expect(
    page
      .getByRole("table")
      .getByText("Bright Cafe Pty Ltd draft charges", { exact: true }),
  ).toBeVisible();
  expect(mutationCalls).toEqual([
    "POST /api/v1/billing-drafts/from-charge-rules",
  ]);
});

test("voided charge-rule billing draft can be recreated locally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  const readyRows = [
    {
      entity_id: "entity-1",
      entity_name: "Acme Holdings Pty Ltd",
      property_id: "property-1",
      property_name: "Queen Street Retail Centre",
      tenancy_unit_id: "unit-1",
      unit_label: "Shop 3",
      lease_id: "lease-active",
      tenant_id: "tenant-1",
      tenant_name: "Bright Cafe Pty Ltd",
      lease_status: "active",
      commencement_date: "2025-07-01",
      expiry_date: "2028-06-30",
      tenant_billing_email: "accounts@bright.example",
      annual_rent_cents: 9600000,
      rent_frequency: "monthly",
      charge_rules: [],
      charge_rules_total_cents: 880000,
      next_due_date: "2026-06-01",
      gst_readiness_blockers: [],
      xero_readiness_blockers: [],
      invoice_readiness_blockers: [],
    },
    {
      entity_id: "entity-1",
      entity_name: "Acme Holdings Pty Ltd",
      property_id: "property-1",
      property_name: "Queen Street Retail Centre",
      tenancy_unit_id: "unit-void",
      unit_label: "Unit 1 & Unit 3",
      lease_id: "lease-void",
      tenant_id: "tenant-void",
      tenant_name: "Gorilla Grind Pty Ltd",
      lease_status: "active",
      commencement_date: "2024-01-29",
      expiry_date: "2027-12-10",
      tenant_billing_email: "Torsten@hbhgroup.info",
      annual_rent_cents: 9500000,
      rent_frequency: "monthly",
      charge_rules: [],
      charge_rules_total_cents: 791667,
      next_due_date: "2026-06-30",
      gst_readiness_blockers: [],
      xero_readiness_blockers: [],
      invoice_readiness_blockers: [],
    },
  ];
  const localBillingDrafts: Array<Record<string, unknown>> = [
    {
      id: "billing-draft-active",
      entity_id: "entity-1",
      property_id: "property-1",
      tenancy_unit_id: "unit-1",
      tenant_id: "tenant-1",
      lease_id: "lease-active",
      document_id: "document-active",
      document_intake_id: null,
      status: "needs_review",
      title: "Billing draft - Bright Cafe Pty Ltd - Shop 3",
      currency: "AUD",
      issue_date: "2026-06-23",
      due_date: "2026-06-01",
      total_cents: 880000,
      notes:
        "Prepared from existing Leasium charge rules. No PDF, tenant email, or Xero sync has run.",
      metadata: { source: "charge_rule_batch", period_key: "2026-06-23" },
      lines: [],
      created_at: "2026-06-23T00:00:00.000Z",
      updated_at: "2026-06-23T00:00:00.000Z",
      deleted_at: null,
    },
    {
      id: "billing-draft-void",
      entity_id: "entity-1",
      property_id: "property-1",
      tenancy_unit_id: "unit-void",
      tenant_id: "tenant-void",
      lease_id: "lease-void",
      document_id: "document-void",
      document_intake_id: null,
      status: "void",
      title: "Billing draft - Gorilla Grind Pty Ltd - Unit 1 & Unit 3",
      currency: "AUD",
      issue_date: "2026-06-23",
      due_date: "2026-06-30",
      total_cents: 1583200,
      notes:
        "Prepared from existing Leasium charge rules. No PDF, tenant email, or Xero sync has run.",
      metadata: {
        source: "charge_rule_batch",
        period_key: "2026-06-23",
        voided_at: "2026-06-23T00:05:00.000Z",
      },
      lines: [],
      created_at: "2026-06-23T00:00:00.000Z",
      updated_at: "2026-06-23T00:05:00.000Z",
      deleted_at: null,
    },
  ];

  await page.route("**/api/v1/rent-roll?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyRows),
    });
  });
  await page.route("**/api/v1/invoice-drafts?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route(
    (url) =>
      url.pathname === "/api/v1/billing-drafts" ||
      url.pathname === "/api/v1/billing-drafts/from-charge-rules",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (request.method() === "GET" && path === "/api/v1/billing-drafts") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(localBillingDrafts),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/api/v1/billing-drafts/from-charge-rules"
      ) {
        const payload = request.postDataJSON() as {
          entity_id: string;
          lease_ids?: string[];
          as_of?: string | null;
        };
        expect(payload.lease_ids).toEqual(["lease-void"]);
        const createdDraft = {
          ...localBillingDrafts[1],
          id: "billing-draft-recreated",
          status: "needs_review",
          total_cents: 791667,
          title:
            "Billing draft - Gorilla Grind Pty Ltd - Unit 1 & Unit 3 (recreated)",
          updated_at: "2026-06-23T00:10:00.000Z",
        };
        localBillingDrafts.push(createdDraft);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            created: 1,
            existing: 0,
            skipped: 0,
            drafts: [createdDraft],
            skipped_rows: [],
          }),
        });
        return;
      }
      await route.fallback();
    },
  );

  const mutationCalls: string[] = [];
  page.on("request", (request) => {
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/v1/") &&
      !["GET", "HEAD", "OPTIONS"].includes(method)
    ) {
      mutationCalls.push(`${method} ${path}`);
    }
  });

  await page.goto("/billing-readiness?entity_id=entity-1&tab=billing-drafts");
  await expect(
    page.getByRole("heading", { name: "Review & approve" }),
  ).toBeVisible();

  const voidRow = page
    .getByRole("row")
    .filter({ hasText: "Gorilla Grind Pty Ltd" });
  await expect(voidRow.getByText("void", { exact: true })).toBeVisible();
  await voidRow.getByRole("button", { name: "Recreate draft" }).click();

  await expect
    .poll(() => mutationCalls)
    .toEqual(["POST /api/v1/billing-drafts/from-charge-rules"]);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Gorilla Grind Pty Ltd - Unit 1 & Unit 3 (recreated)" })
      .getByText("needs review"),
  ).toBeVisible();
  expect(mutationCalls).toEqual([
    "POST /api/v1/billing-drafts/from-charge-rules",
  ]);
});

test("self-managed billing readiness keeps statement handoff local", async ({
  page,
}) => {
  await mockLeasiumApi(page, {
    operatingMode: "self_managed_owner",
    ownerStatementMissingRecipientInvoice: true,
  });

  const providerRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.includes("/api/v1/owners/statements/dispatch") ||
      path.includes("/api/v1/owners/statements/send")
    ) {
      providerRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto("/billing-readiness");
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Send & get paid/ }).click();

  await expect(
    page.getByText("Entity statements", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Owner statements", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page
      .getByText(
        "Recipient emails are not required for self-managed reporting.",
      )
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText(/owner.*billing email before dispatch/i),
  ).toHaveCount(0);
  await expect(page.getByText(/missing recipient/i)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open statements" }).first(),
  ).toHaveAttribute("href", /\/statements\?.*from=billing-readiness/);
  expect(providerRequests).toEqual([]);
});

test("self-managed billing readiness keeps clean statement packs local", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });
  await mockOwnerStatementsWithBillingRecipients(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/billing-readiness?entity_id=entity-1&tab=delivery");
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy handoff" }),
  ).toBeVisible();

  await expect(
    page.getByText("Entity statements", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(
      "1 entity and 1 statement invoice ready for self-managed reporting.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/preview and dispatch review/i)).toHaveCount(0);
  await expect(page.getByText(/owner and accounting reporting/i)).toHaveCount(
    0,
  );
  await expect(page.getByText(/missing recipient/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Copy handoff" }).click();
  const handoffText = await page.evaluate(() => navigator.clipboard.readText());
  expect(handoffText).toContain("Month-end entity statements handoff");
  expect(handoffText).toContain("Entity statements");
  expect(handoffText).toContain(
    "1 entity / 1 invoice / self-managed reporting",
  );
  expect(handoffText).toContain(
    "Review-only: statement preview/export remain explicit local reporting steps.",
  );
  expect(handoffText).not.toContain("Owner statements");
  expect(handoffText).not.toContain("owner statement");
  expect(handoffText).not.toContain("dispatch review");
  expect(handoffText).not.toContain("missing recipient");

  const handoffDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download handoff CSV" }).click();
  const handoffDownload = await handoffDownloadPromise;
  const handoffDownloadPath = await handoffDownload.path();
  expect(handoffDownloadPath).not.toBeNull();
  const handoffCsv = await readFile(handoffDownloadPath!, "utf8");
  expect(handoffCsv).toContain("Entity statements");
  expect(handoffCsv).toContain(
    "Invoices available for entity statement review.",
  );
  expect(handoffCsv).toContain("self-managed reporting");
  expect(handoffCsv).not.toContain("Owner statements");
  expect(handoffCsv).not.toContain("owner statement review");
  expect(handoffCsv).not.toContain("missing recipient");
});

async function mockOwnerStatementsWithBillingRecipients(
  page: Parameters<typeof mockLeasiumApi>[0],
) {
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/owners/statements"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const month =
        new URL(route.request().url()).searchParams.get("month") ?? "2026-05";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entity_id: "entity-1",
          month,
          month_start: `${month}-01`,
          month_end: `${month}-31`,
          owners: [
            {
              owner_id: "owner-1",
              owner_identity: "SKJ Holdings Pty Ltd",
              owner_legal_name: "SKJ Holdings Pty Ltd",
              trustee_name: null,
              trust_name: "SKJ Family Trust",
              invoice_issuer_name: null,
              billing_contact_name: "Sam King",
              billing_email: "owners@skjcapital.example",
              property_count: 1,
              properties: [
                {
                  property_id: "property-1",
                  property_name: "Queen Street Retail Centre",
                  invoiced_cents: 880000,
                  paid_cents: 880000,
                  outstanding_cents: 0,
                  invoice_count: 1,
                  invoices: [
                    {
                      invoice_draft_id: "invoice-1",
                      invoice_number: "INV-1001",
                      title: "May rent and outgoings",
                      issue_date: `${month}-01`,
                      due_date: `${month}-14`,
                      total_cents: 880000,
                      paid_cents: 880000,
                      outstanding_cents: 0,
                      payment_status: "paid",
                      xero_invoice_id: null,
                      reconciliation_reference: null,
                      reconciliation_match_confidence: null,
                      reconciliation_bank_transaction_id: null,
                    },
                  ],
                },
              ],
              invoiced_cents: 880000,
              paid_cents: 880000,
              outstanding_cents: 0,
              invoice_count: 1,
            },
          ],
          generated_at: "2026-05-25T00:00:00.000Z",
        }),
      });
    },
  );
}
