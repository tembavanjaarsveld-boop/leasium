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
  await page.getByRole("tab", { name: /Review drafts/ }).click();

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
    mobileDraftCard.getByRole("button", { name: "Approve" }),
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

  await page.getByRole("tab", { name: /Approve invoices/ }).click();
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

  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
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

  await page.getByRole("tab", { name: /Review drafts/ }).click();
  const draftTable = page
    .locator("table")
    .filter({ hasText: "May rent and outgoings" })
    .first();
  await expect(draftTable).toBeVisible();
  await expectTouchSafe(
    draftTable.getByRole("button", { name: "Approve" }).first(),
  );
  await expectTouchSafe(
    draftTable.getByRole("button", { name: "Void" }).first(),
  );

  await page.getByRole("tab", { name: /Approve invoices/ }).click();
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

  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
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
    page.getByRole("heading", { name: "Delivery & payments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("No approved invoices", { exact: true }),
  ).toBeVisible();

  const guide = page.getByRole("region", { name: "Invoice run guide" });
  await expect(guide).toBeVisible();
  await expect(guide.getByText("Next: create invoice draft")).toBeVisible();
  await expect(
    guide.getByText(
      "No email, Xero sync, or payment change runs from this guide.",
    ),
  ).toBeVisible();

  await guide.getByRole("button", { name: "Review drafts" }).click();
  await expect(
    page.getByRole("tab", { name: /Review drafts/ }),
  ).toHaveAttribute("aria-selected", "true");
  expect(mutationCalls).toEqual([]);
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

  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();

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
