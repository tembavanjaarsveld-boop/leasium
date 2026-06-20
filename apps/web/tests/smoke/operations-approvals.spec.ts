import { expect, type Locator, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
});

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

function readyInvoiceDraft() {
  return {
    id: "invoice-draft-ready-approval-1",
    entity_id: "entity-1",
    billing_draft_id: "billing-draft-1",
    property_id: "property-1",
    tenancy_unit_id: "unit-1",
    tenant_id: "tenant-1",
    lease_id: "lease-1",
    document_id: "document-1",
    document_intake_id: "intake-1",
    status: "ready_for_approval",
    invoice_number: "INV-2001",
    title: "Owner recharge invoice",
    currency: "AUD",
    issue_date: "2026-06-01",
    due_date: "2026-06-15",
    subtotal_cents: 120000,
    gst_cents: 12000,
    total_cents: 132000,
    issuer_name: "Queen Street Trustee Pty Ltd",
    issuer_abn: "22123456789",
    recipient_name: "Bright Cafe Pty Ltd",
    recipient_email: "accounts@bright.example",
    notes: "Ready for operator approval.",
    metadata: {
      readiness_blockers: [],
      delivery_state: {
        pdf_preview_generated: true,
        pdf_artifact_stored: true,
        tenant_email_prepared: true,
        delivery_ready: true,
        tenant_email_sent: false,
      },
    },
    lines: [],
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    deleted_at: null,
  };
}

function readyAssignmentObligation() {
  return {
    id: "obligation-ready-assignment-1",
    entity_id: "entity-1",
    property_id: "property-1",
    tenancy_unit_id: "unit-1",
    lease_id: "lease-1",
    title: "Insurance certificate renewal",
    category: "insurance",
    status: "open",
    due_date: "2026-06-12",
    completed_at: null,
    priority: 1,
    owner_role: "property_manager",
    notes: "Assignment notice is prepared for the property manager.",
    metadata: {
      work_assignment: {
        assigned_user_id: "operator-2",
        assigned_user_name: "Temba van Jaarsveld",
        assigned_user_email: "temba@example.com",
        assigned_role: "property_manager",
        assigned_at: "2026-06-01T00:00:00.000Z",
        assigned_by_name: "Owner Operator",
        notification: {
          status: "ready",
          detail: "Assignment email preview is ready.",
          template_key: "work_assignment_notification",
          template_version: "v1",
        },
        history: [
          {
            event: "assigned",
            at: "2026-06-01T00:00:00.000Z",
            actor_name: "Owner Operator",
            assigned_user_name: "Temba van Jaarsveld",
            assigned_user_email: "temba@example.com",
            summary: "Assignment notice prepared for review.",
            notification_status: "ready",
          },
        ],
      },
    },
  };
}

function submittedTenantOnboarding() {
  return {
    id: "onboarding-submitted-1",
    entity_id: "entity-1",
    lease_id: "lease-1",
    tenant_id: "tenant-1",
    token: "tenant-token-submitted-1",
    status: "submitted",
    due_date: "2026-06-12",
    expires_at: "2026-07-01T00:00:00.000Z",
    last_sent_at: "2026-06-01T00:00:00.000Z",
    resent_at: null,
    cancel_reason: null,
    onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-submitted-1",
    portal_url:
      "http://127.0.0.1:3000/tenant-portal/tenant-token-submitted-1",
    submitted_data: {
      legal_name: "Bright Cafe Pty Ltd",
      contact_name: "Mia Hart",
      contact_email: "mia@example.com",
      accepted: true,
    },
    submitted_at: "2026-06-02T00:00:00.000Z",
    review_data: {},
    delivery_data: {},
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-02T00:00:00.000Z",
    deleted_at: null,
  };
}

async function installApprovalsClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as Window & { __copiedApprovalsCsv?: string }
          ).__copiedApprovalsCsv = text;
        },
      },
    });
  });
}

async function mockApprovalsApi(page: Page) {
  await mockLeasiumApi(page, { operationsComplianceDemo: true });
  await page.route("**/api/v1/obligations**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([readyAssignmentObligation()]),
    });
  });
  await page.route("**/api/v1/tenant-onboarding**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([submittedTenantOnboarding()]),
    });
  });
  await page.route("**/api/v1/invoice-drafts**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([readyInvoiceDraft()]),
    });
  });
}

async function trapForbiddenApprovalCalls(page: Page) {
  const forbiddenCalls: string[] = [];
  const forbiddenPathPatterns = [
    "/providers",
    "/provider-dispatch",
    "/provider-history",
    "/comms",
    "/document-intakes",
    "/compliance/checks",
    "/maintenance/work-orders",
    "/obligations",
    "/billing",
    "/invoice",
    "/xero",
    "/basiq",
    "/payment",
    "/reconciliation",
  ];
  const forbiddenSendPathPattern = /email|sms|sendgrid|twilio/i;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const apiPath = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      (request.method() !== "GET" &&
        forbiddenPathPatterns.some((pattern) => apiPath.startsWith(pattern))) ||
      forbiddenSendPathPattern.test(apiPath)
    ) {
      forbiddenCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });
  return forbiddenCalls;
}

function approvalsPanel(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Approvals inbox" }) })
    .first();
}

async function copiedApprovalsCsv(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __copiedApprovalsCsv?: string })
            .__copiedApprovalsCsv,
      ),
    )
    .toBeTruthy();
  return page.evaluate(
    () =>
      (window as Window & { __copiedApprovalsCsv?: string })
        .__copiedApprovalsCsv,
  );
}

test("operations approvals tab collects read-only approval candidates and exports without mutations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApprovalsClipboard(page);
  await mockApprovalsApi(page);
  const forbiddenCalls = await trapForbiddenApprovalCalls(page);

  await page.goto("/operations?tab=approvals");

  const tabs = page.getByRole("tablist", { name: "Operations sections" });
  const approvalsTab = tabs.getByRole("tab", { name: /Approvals/ });
  await expect(approvalsTab).toHaveAttribute("aria-selected", "true");
  await expectTouchTarget(approvalsTab);

  const panel = approvalsPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Review-only");
  await expect(panel).toContainText("Air conditioning fault");
  await expect(panel).toContainText("Owner recharge invoice");
  await expect(panel).toContainText("Annual fire safety statement");
  await expect(panel).toContainText("Tenant onboarding ready for review");
  await expect(panel).toContainText("Document waiting for review");
  await expect(panel).toContainText("Assignment notice ready");
  await expect(panel).toContainText(
    "No provider, comms, payment, or reconciliation action runs from this inbox.",
  );

  await expect(
    panel.locator('a[href="/operations/maintenance/work-order-1"]'),
  ).toBeVisible();
  await expect(
    panel.locator(
      'a[href="/billing-readiness?entity_id=entity-1&invoice_id=invoice-draft-ready-approval-1"]',
    ),
  ).toBeVisible();
  await expect(
    panel.locator(
      'a[href="/operations?tab=compliance#compliance-check-compliance-check-fire-1"]',
    ),
  ).toBeVisible();
  await expect(
    panel.locator('a[href="/intake?entity_id=entity-1&review=intake-1"]'),
  ).toBeVisible();

  await expect(panel.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send" })).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Post to Xero" }),
  ).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Complete" })).toHaveCount(0);

  const copyButton = panel.getByRole("button", {
    name: "Copy approvals CSV",
  });
  const downloadButton = panel.getByRole("button", {
    name: "Download approvals CSV",
  });
  await expectTouchTarget(copyButton);
  await expectTouchTarget(downloadButton);

  forbiddenCalls.length = 0;
  await copyButton.click();
  const copiedCsv = await copiedApprovalsCsv(page);

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("operations-approvals-review.csv");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(copiedCsv).toBe(csv);
  expect(csv).toContain("Review-only approvals packet");
  expect(csv).toContain("does not approve");
  expect(csv).toContain("Xero/Basiq");
  expect(csv).toContain("Owner recharge invoice");
  expect(csv).toContain("Air conditioning fault");
  expect(csv).toContain("Annual fire safety statement");
  expect(forbiddenCalls).toEqual([]);
});

test("operations approvals tab filters candidates and scopes review exports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await installApprovalsClipboard(page);
  await mockApprovalsApi(page);
  const forbiddenCalls = await trapForbiddenApprovalCalls(page);

  await page.goto("/operations?tab=approvals");

  const panel = approvalsPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Air conditioning fault");
  await expect(panel).toContainText("Owner recharge invoice");
  await expect(panel).toContainText("Annual fire safety statement");
  await expect(
    panel.locator('a[href="/tenants/tenant-1"]'),
  ).toBeVisible();

  const providerFilter = panel.getByRole("button", {
    name: /Provider-adjacent/,
  });
  await providerFilter.click();
  await expect(providerFilter).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText("Air conditioning fault");
  await expect(panel).toContainText("Owner recharge invoice");
  await expect(panel).toContainText("Assignment notice ready");
  await expect(panel).not.toContainText("Annual fire safety statement");
  await expect(panel).not.toContainText("Tenant onboarding ready for review");

  await panel.getByLabel("Approval source").selectOption("invoice_draft");
  await expect(panel).toContainText("Owner recharge invoice");
  await expect(panel).not.toContainText("Air conditioning fault");
  await expect(panel).not.toContainText("Annual fire safety statement");

  forbiddenCalls.length = 0;
  await panel.getByRole("button", { name: "Copy approvals CSV" }).click();
  const copiedCsv = await copiedApprovalsCsv(page);
  expect(copiedCsv).toContain("Owner recharge invoice");
  expect(copiedCsv).not.toContain("Air conditioning fault");
  expect(copiedCsv).not.toContain("Annual fire safety statement");

  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download approvals CSV" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv).toBe(copiedCsv);

  await panel.getByRole("button", { name: "Clear approval filters" }).click();
  await expect(panel.getByLabel("Approval source")).toHaveValue("all");
  await expect(panel).toContainText("Annual fire safety statement");
  await expect(forbiddenCalls).toEqual([]);
});
