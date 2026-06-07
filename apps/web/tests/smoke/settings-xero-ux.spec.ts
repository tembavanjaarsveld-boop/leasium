import { expect, type Locator, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

const XERO_EXCEPTION_QUEUE_FIXTURE = {
  entity_id: "entity-1",
  generated_at: "2026-05-19T10:45:00.000Z",
  summary: {
    total: 2,
    blockers: 1,
    warnings: 0,
    info: 1,
    connection: 0,
    contact: 0,
    chart: 0,
    tax: 1,
    invoice_sync: 0,
    provider: 0,
    payment: 1,
  },
  items: [
    {
      id: "tax-charge-1",
      kind: "tax",
      severity: "blocker",
      label: "Base Rent tax type missing",
      detail:
        "Queen Street Retail Centre / Shop 3 is taxable and needs a Xero tax type.",
      action: "Review and apply the suggested tax mapping.",
      next_action: "review_chart_tax_mapping",
      source: "xero_status",
      property_id: "property-1",
      property_name: "Queen Street Retail Centre",
      tenancy_unit_id: "unit-1",
      unit_label: "Shop 3",
      lease_id: "lease-1",
      tenant_id: "tenant-1",
      tenant_name: "Bright Cafe",
      charge_rule_id: "charge-1",
      charge_type: "base_rent",
      current_account_code: "401",
      current_tax_type: null,
      suggested_account_code: "200",
      suggested_tax_type: "OUTPUT",
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
    },
    {
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
      property_id: "property-1",
      property_name: "Queen Street Retail Centre",
      tenancy_unit_id: "unit-1",
      unit_label: "Shop 3",
      lease_id: "lease-1",
      tenant_id: "tenant-1",
      tenant_name: "Bright Cafe",
      charge_rule_id: null,
      charge_type: null,
      current_account_code: null,
      current_tax_type: null,
      suggested_account_code: null,
      suggested_tax_type: null,
      invoice_draft_id: "invoice-draft-1",
      invoice_number: "INV-1001",
      invoice_title: "June 2026 Rent",
      total_cents: 880000,
      currency: "AUD",
      provider: "xero",
      provider_status: "unpaid",
      external_posting_status: "DRAFT",
      idempotency_key: "xero-draft-create-invoice-draft-1",
      xero_invoice_id: "xero-invoice-smoke-1",
      xero_status: "DRAFT",
      received_at: "2026-05-20T10:15:00.000Z",
      retry_count: 2,
    },
  ],
  guardrails: [
    "The exception queue is built from local Leasium records only.",
    "Loading this queue does not refresh Xero tokens, call Xero APIs, post invoices, send emails, or reconcile payments.",
  ],
};

async function mockXeroExceptionQueue(page: Parameters<typeof mockLeasiumApi>[0]) {
  await page.route("**/api/v1/xero/exception-queue?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(XERO_EXCEPTION_QUEUE_FIXTURE),
    });
  });
}

async function expectTouchTarget(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test("settings Xero exceptions use contextual loading copy", async ({
  page,
}) => {
  let releaseExceptionQueue: () => void = () => {};
  const exceptionQueueCanResolve = new Promise<void>((resolve) => {
    releaseExceptionQueue = resolve;
  });

  await mockLeasiumApi(page);
  await page.route("**/api/v1/xero/exception-queue?**", async (route) => {
    await exceptionQueueCanResolve;
    await route.fallback();
  });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Connect" }).click();

  const exceptionPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Xero sync exception queue" }),
    })
    .first();

  await expect(exceptionPanel).toBeVisible();
  await expect(
    exceptionPanel.getByText("Checking Xero sync exceptions."),
  ).toBeVisible();
  await expect(
    exceptionPanel.getByText("Checking", { exact: true }),
  ).toBeVisible();
  await expect(exceptionPanel.getByText("0 open")).toHaveCount(0);
  await expect(
    exceptionPanel.getByText("Loading Xero sync exceptions."),
  ).toHaveCount(0);

  releaseExceptionQueue();
});

test("mobile settings Xero exceptions use readable review cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await mockXeroExceptionQueue(page);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Connect" }).click();

  const exceptionPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Xero sync exception queue" }),
    })
    .first();
  await expect(exceptionPanel).toBeVisible();
  await exceptionPanel.getByText("Review 2 follow-ups").click();
  await expect(exceptionPanel.getByText("...", { exact: true })).toHaveCount(0);

  const taxExceptionCard = page
    .getByTestId("xero-exception-mobile-card")
    .filter({ hasText: "Base Rent tax type missing" })
    .first();

  await expect(taxExceptionCard).toBeVisible();
  await expect(taxExceptionCard.getByText("Current mapping")).toBeVisible();
  await expect(taxExceptionCard.getByText("Suggested mapping")).toBeVisible();
  await expect(
    taxExceptionCard.getByRole("button", { name: "Apply suggestion" }),
  ).toBeVisible();
  await expect(
    taxExceptionCard.getByText("Review and apply the suggested tax mapping."),
  ).toBeVisible();

  const paymentExceptionCard = page
    .getByTestId("xero-exception-mobile-card")
    .filter({ hasText: "Xero payment status needs review" })
    .first();

  await expect(paymentExceptionCard).toBeVisible();
  await expect(
    paymentExceptionCard.getByText("Invoice: INV-1001"),
  ).toBeVisible();
  await expect(
    paymentExceptionCard.getByText("Provider: Xero / unpaid"),
  ).toBeVisible();
  await expect(paymentExceptionCard.getByText("Posting: DRAFT")).toBeVisible();
  await expect(paymentExceptionCard.getByText("Attempt #2")).toBeVisible();
  await expect(
    paymentExceptionCard.getByRole("link", { name: "Open property" }),
  ).toHaveAttribute(
    "href",
    "/properties?entity_id=entity-1&property_id=property-1",
  );
});

test("desktop settings Xero exception actions stay touch-safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1432, height: 900 });
  await mockLeasiumApi(page);
  await mockXeroExceptionQueue(page);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Connect" }).click();

  const exceptionPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Xero sync exception queue" }),
    })
    .first();
  await expect(exceptionPanel).toBeVisible();
  await exceptionPanel.getByText("Review 2 follow-ups").click();

  await expectTouchTarget(
    exceptionPanel.getByRole("button", { name: "Copy exception packet" }),
  );
  await expectTouchTarget(
    exceptionPanel.getByRole("button", { name: "Download exceptions CSV" }),
  );

  const taxExceptionRow = page
    .getByTestId("xero-exception-desktop-row")
    .filter({ hasText: "Base Rent tax type missing" })
    .first();
  await expect(taxExceptionRow).toBeVisible();
  await expectTouchTarget(
    taxExceptionRow.getByRole("button", { name: "Apply suggestion" }),
  );
  await expectTouchTarget(
    taxExceptionRow.getByRole("link", { name: "Open property" }),
  );
});

test("desktop settings Xero readiness handoffs stay touch-safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1432, height: 900 });
  await mockLeasiumApi(page);
  await mockXeroExceptionQueue(page);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Connect" }).click();

  const accountingFreshnessPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Accounting freshness snapshot" }),
    })
    .first();
  await expect(accountingFreshnessPanel).toBeVisible();
  await expectTouchTarget(
    accountingFreshnessPanel.getByRole("button", {
      name: "Review exception queue",
    }),
  );

  const chartTaxPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Chart and tax mapping" }),
    })
    .first();
  await expect(chartTaxPanel).toBeVisible();
  const mappingRow = chartTaxPanel
    .locator("tbody tr")
    .filter({ hasText: "Base Rent tax type missing" })
    .first();
  await expect(mappingRow).toBeVisible();
  await expectTouchTarget(
    mappingRow.getByRole("link", { name: "Open property" }),
  );
  await expectTouchTarget(mappingRow.getByRole("button", { name: "Apply" }));
});

test("settings Xero draft creation action keeps the touch-safe class without creating drafts", async () => {
  const source = await readFile("src/app/settings/page.tsx", "utf8");

  expect(source).not.toMatch(
    /min-h-9 rounded-lg px-3[\s\S]{0,500}xeroDraftCreateMutation[\s\S]{0,500}Create Xero drafts/,
  );
  expect(source).toMatch(
    /min-h-11 rounded-lg px-3[\s\S]{0,500}xeroDraftCreateMutation[\s\S]{0,500}Create Xero drafts/,
  );
});
