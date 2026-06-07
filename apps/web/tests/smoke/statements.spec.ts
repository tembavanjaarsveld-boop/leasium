import {
  expect,
  type Locator,
  type Page,
  type Request,
  test,
} from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

const DISPATCH_APPROVAL_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not download owner PDFs, download PDF packs, send owner email, dispatch comms, dispatch invoices, write Xero data, preview or apply payment reconciliation, refresh providers, or mutate provider history.";
const DISPATCH_APPROVAL_COPY_GUARDRAIL =
  "Review-only export: copying this packet does not download owner PDFs, download PDF packs, send owner email, dispatch comms, dispatch invoices, write Xero data, preview or apply payment reconciliation, refresh providers, or mutate provider history.";
const DISPATCH_DRAFT_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not send owner email, dispatch comms, attach or download owner PDFs, write Xero data, preview or apply payment reconciliation, dispatch invoices, refresh providers, or mutate provider history.";

async function expectTouchTarget(control: Locator, label: string) {
  await expect(control, `${label} should be visible`).toBeVisible();
  const box = await control.boundingBox();
  expect(box, `${label} should have a rendered box`).not.toBeNull();
  expect(
    box!.width,
    `${label} should be at least 44px wide`,
  ).toBeGreaterThanOrEqual(44);
  expect(
    box!.height,
    `${label} should be at least 44px tall`,
  ).toBeGreaterThanOrEqual(44);
}

function isForbiddenDispatchReviewExportRequest(request: Request) {
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "").toLowerCase();
  const method = request.method();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);

  return (
    path.startsWith("/owners/statements/send") ||
    path.startsWith("/owners/statements/dispatch") ||
    path.startsWith("/owners/statements/pdf") ||
    path.startsWith("/comms") ||
    path.startsWith("/xero") ||
    path.startsWith("/basiq") ||
    path.includes("sendgrid") ||
    path.includes("twilio") ||
    path.includes("/provider-dispatch") ||
    path.includes("provider-refresh") ||
    path.includes("provider-history") ||
    path.includes("/history") ||
    path.includes("/reconciliation-preview") ||
    path.includes("/reconciliation-apply") ||
    (isMutation &&
      ((path.includes("/invoice-drafts") &&
        (path.includes("delivery") ||
          path.includes("dispatch") ||
          path.includes("email") ||
          path.includes("sms"))) ||
        path.includes("/billing") ||
        path.includes("/payment") ||
        path.includes("/reconciliation") ||
        path.includes("/provider") ||
        path.includes("/dispatch") ||
        path.includes("/email") ||
        path.includes("/sms")))
  );
}

async function trapForbiddenDispatchReviewExportRequests(page: Page) {
  const requests: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (isForbiddenDispatchReviewExportRequest(request)) {
      const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
      requests.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "dispatch review export must stay local-only",
        }),
      });
      return;
    }

    await route.fallback();
  });
  return requests;
}

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("self-managed statements keep reports local and hide owner dispatch", async ({
  page,
}) => {
  await mockLeasiumApi(page, { ownerStatementMissingRecipientInvoice: true });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/v1/owners/statements/dispatch") ||
      request.url().includes("/api/v1/owners/statements/send")
    ) {
      providerRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Local reporting mode" }),
  ).toBeVisible();
  await expect(page.getByText("Local reporting", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Billing recipients are not required"),
  ).toBeVisible();
  await expect(page.getByText(/dispatch-ready/i)).toHaveCount(0);
  await expect(page.getByText(/dispatch queues/i)).toHaveCount(0);
  await expect(page.getByText(/External email send/i)).toHaveCount(0);
  await expect(
    page.getByText("Missing recipient", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Add owner billing emails")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Dispatch approval queue" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send statement" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy dispatch draft" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download dispatch draft" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Copy checklist" }).click();
  const checklistText = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(checklistText).toContain("Entity statements finance checklist");
  expect(checklistText.toLowerCase()).not.toContain("owner dispatch");
  expect(checklistText.toLowerCase()).not.toContain("dispatch approval");
  expect(checklistText.toLowerCase()).not.toContain("owner statement");
  expect(checklistText.toLowerCase()).not.toContain("send workflows");

  await page.getByRole("button", { name: "Copy exceptions" }).click();
  const exceptionsText = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(exceptionsText).toContain("Entity statement finance exceptions");
  expect(exceptionsText.toLowerCase()).not.toContain("owner dispatch");
  expect(exceptionsText.toLowerCase()).not.toContain("dispatch approval");
  expect(exceptionsText.toLowerCase()).not.toContain("owner statement");

  await expect(page.getByText("Owner statement", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Entity statement", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Owner:/)).toHaveCount(0);
  await expect(page.getByText(/^Entity:/).first()).toBeVisible();

  await page.getByRole("button", { name: "Copy summary" }).click();
  const summaryText = await page.evaluate(() => navigator.clipboard.readText());
  expect(summaryText).toContain("Entity statement review");
  expect(summaryText).toContain("Queen Street Property Trust");
  expect(summaryText.toLowerCase()).not.toContain("owner statement");
  expect(summaryText.toLowerCase()).not.toContain("owner-statement");

  const evidence = page.getByRole("region", { name: "Invoice evidence" });
  await expect(evidence).toContainText(
    "Source invoice lines included in this entity statement.",
  );
  const evidenceDownloadPromise = page.waitForEvent("download");
  await evidence
    .getByRole("button", { name: "Download invoice evidence CSV" })
    .click();
  const evidenceDownload = await evidenceDownloadPromise;
  expect(evidenceDownload.suggestedFilename()).toBe(
    "entity-statement-invoice-evidence-2026-05-queen-street-property-trust.csv",
  );
  const evidenceDownloadPath = await evidenceDownload.path();
  expect(evidenceDownloadPath).not.toBeNull();
  const evidenceCsv = await readFile(evidenceDownloadPath!, "utf8");
  expect(evidenceCsv).toContain('"Entity","Property","Invoice","Title"');
  expect(evidenceCsv.toLowerCase()).not.toContain("owner statement");
  expect(evidenceCsv.toLowerCase()).not.toContain("owner-statement");
  expect(providerRequests).toHaveLength(0);
});

test("self-managed statements signoff export uses entity-local framing", async ({
  page,
}) => {
  await mockLeasiumApi(page, {
    operatingMode: "self_managed_owner",
    ownerStatementMissingRecipientInvoice: true,
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/v1/xero/status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        issues: [
          {
            id: "xero-warning-1",
            severity: "warning",
            message: "One reconciliation check needs review.",
          },
        ],
        accounting_freshness: {
          status: "ready",
          readiness_blocker_count: 0,
          readiness_warning_count: 1,
          approved_unsynced_invoice_count: 0,
          generated_at: "2026-05-20T01:00:00.000Z",
          source: "local_metadata",
          summary: "Accounting readiness has a warning.",
          stale_after_days: 7,
          stale_reconciliation: false,
          readiness_issue_count: 1,
          xero_linked_open_invoice_count: 0,
          guardrails: [],
        },
      }),
    });
  });

  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/v1/owners/statements/dispatch") ||
      request.url().includes("/api/v1/owners/statements/send")
    ) {
      providerRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto("/statements?month=2026-05");
  await expect(
    page.getByRole("heading", { name: "Entity statements" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Copy signoff" }).click();
  const signoffText = await page.evaluate(() => navigator.clipboard.readText());
  expect(signoffText).toContain("Entity statements month-end signoff");
  expect(signoffText).toContain("local entity-reporting");
  expect(signoffText).not.toContain("Owner statements");
  expect(signoffText).not.toContain("owner email");
  expect(signoffText).not.toContain("Dispatch approval runway");
  expect(signoffText.toLowerCase()).not.toContain("dispatch approval");
  expect(signoffText.toLowerCase()).not.toContain("owner send");
  expect(signoffText.toLowerCase()).not.toContain("owner dispatch");
  expect(signoffText.toLowerCase()).not.toContain("owner statement");
  expect(signoffText).not.toContain("dispatch blockers");
  expect(signoffText).not.toContain("owner statement pack");
  expect(signoffText).not.toContain("Owner totals");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download signoff CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "entity-statement-signoff-2026-05.csv",
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, "utf8");
  expect(csv).toContain("Entity statements");
  expect(csv).toContain("local entity-reporting");
  expect(csv).not.toContain("owner email");
  expect(csv).not.toContain("Dispatch approval");
  expect(csv.toLowerCase()).not.toContain("dispatch approval");
  expect(csv.toLowerCase()).not.toContain("owner send");
  expect(csv.toLowerCase()).not.toContain("owner dispatch");
  expect(csv.toLowerCase()).not.toContain("owner statement");
  expect(csv).not.toContain("dispatch blockers");
  expect(csv).not.toContain("owner statement pack");
  expect(csv).not.toContain("Owner totals");
  expect(providerRequests).toEqual([]);
});

test("self-managed statements empty pack signoff avoids owner wording", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/v1/xero/status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        issues: [],
        accounting_freshness: {
          status: "ready",
          readiness_blocker_count: 0,
          readiness_warning_count: 0,
          approved_unsynced_invoice_count: 0,
          generated_at: "2026-05-20T01:00:00.000Z",
          source: "local_metadata",
          summary: "Accounting readiness is clear.",
          stale_after_days: 7,
          stale_reconciliation: false,
          readiness_issue_count: 0,
          xero_linked_open_invoice_count: 0,
          guardrails: [],
        },
      }),
    });
  });
  await page.route(
    (url) =>
      url.pathname
        .replace(/\/$/, "")
        .endsWith("/api/v1/owners/statements"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entity_id: "entity-1",
          month: "2026-05",
          month_start: "2026-05-01",
          month_end: "2026-05-31",
          owners: [],
          generated_at: "2026-05-25T00:00:00.000Z",
        }),
      });
    },
  );

  await page.goto("/statements?month=2026-05");
  await expect(
    page.getByRole("heading", { name: "Entity statements" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Copy signoff" }).click();
  const signoffText = await page.evaluate(() => navigator.clipboard.readText());
  expect(signoffText).toContain("Status: Blocked");
  expect(signoffText).toContain("Entity statements month-end signoff");
  expect(signoffText).toContain("local entity-reporting signoff");
  expect(signoffText).not.toContain("owner statement signoff");
  expect(signoffText).not.toContain("owner statement pack");
});

test("owner statement preview exposes invoice-level evidence", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Month-end signoff packet" }),
  ).toBeVisible();
  const signoffDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download signoff CSV" }).click();
  const signoffDownload = await signoffDownloadPromise;
  expect(signoffDownload.suggestedFilename()).toBe(
    "owner-statement-signoff-2026-05.csv",
  );

  const evidence = page.getByRole("region", { name: "Invoice evidence" });
  await expect(evidence).toBeVisible();
  const evidenceDownloadPromise = page.waitForEvent("download");
  await evidence
    .getByRole("button", { name: "Download invoice evidence CSV" })
    .click();
  const evidenceDownload = await evidenceDownloadPromise;
  expect(evidenceDownload.suggestedFilename()).toBe(
    "owner-statement-invoice-evidence-2026-05-queen-street-property-trust.csv",
  );
  const evidenceDownloadPath = await evidenceDownload.path();
  expect(evidenceDownloadPath).not.toBeNull();
  const evidenceCsv = await readFile(evidenceDownloadPath!, "utf8");
  expect(evidenceCsv).toContain('"Owner","Property","Invoice","Title"');
  expect(evidenceCsv).toContain("Queen Street Property Trust");
  expect(evidenceCsv).toContain("Queen Street");
  expect(evidenceCsv).toContain("INV-1001");
  expect(evidenceCsv).toContain("May rent and outgoings");
  expect(evidenceCsv).toContain("Local invoice draft");

  const invoiceRow = evidence.getByRole("row").filter({ hasText: "INV-1001" });
  await expect(invoiceRow).toContainText("May rent and outgoings");
  await expect(invoiceRow).toContainText("Due 15 May 2026");
  await expect(invoiceRow).toContainText("$8,800");
  await expect(invoiceRow).toContainText("$0 paid");
  await expect(invoiceRow).toContainText("$8,800 due");
  await expect(invoiceRow).toContainText("Unpaid");
  await expect(invoiceRow).toContainText("Local invoice draft");
});

test("owner statement dispatch approval queue exports review CSV", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Dispatch approval queue" }),
  ).toBeVisible();
  await expectTouchTarget(
    page.getByRole("button", { name: "Copy approval packet" }),
    "Copy approval packet",
  );
  await expectTouchTarget(
    page.getByRole("button", { name: "Download dispatch CSV" }),
    "Download dispatch CSV",
  );
  const reviewButtons = page.getByRole("button", { name: "Review" });
  const reviewButtonCount = await reviewButtons.count();
  expect(reviewButtonCount).toBeGreaterThan(0);
  for (let index = 0; index < reviewButtonCount; index += 1) {
    await expectTouchTarget(
      reviewButtons.nth(index),
      `Dispatch row Review button ${index + 1}`,
    );
  }

  const forbiddenRequests =
    await trapForbiddenDispatchReviewExportRequests(page);

  await page.getByRole("button", { name: "Copy approval packet" }).click();
  const copiedPacket = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(copiedPacket).toContain("Owner statement dispatch approval queue");
  expect(copiedPacket).toContain("Queen Street Property Trust");
  expect(copiedPacket).toContain("owners@queenstreet.example");
  expect(copiedPacket).toContain("Payment review");
  expect(copiedPacket).toContain("Owner statement for May 2026");
  expect(copiedPacket).toContain("Recipient gate");
  expect(copiedPacket).toContain(DISPATCH_APPROVAL_COPY_GUARDRAIL);

  const dispatchDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download dispatch CSV" }).click();
  const dispatchDownload = await dispatchDownloadPromise;
  expect(dispatchDownload.suggestedFilename()).toBe(
    "owner-statement-dispatch-review-2026-05.csv",
  );
  const dispatchDownloadPath = await dispatchDownload.path();
  expect(dispatchDownloadPath).not.toBeNull();
  const dispatchCsv = await readFile(dispatchDownloadPath!, "utf8");
  expect(dispatchCsv).toContain("Queen Street Property Trust");
  expect(dispatchCsv).toContain("owners@queenstreet.example");
  expect(dispatchCsv).toContain("Payment review");
  expect(dispatchCsv).toContain("Owner statement for May 2026");
  expect(dispatchCsv).toContain("2");
  expect(dispatchCsv).toContain("$17,600");
  expect(dispatchCsv).toContain("Recipient gate");
  expect(dispatchCsv).toContain(DISPATCH_APPROVAL_EXPORT_GUARDRAIL);
  expect(forbiddenRequests).toEqual([]);
});

test("owner statement dispatch draft downloads as review-only text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Dispatch review" }),
  ).toBeVisible();
  await expectTouchTarget(
    page.getByRole("button", { name: "Copy dispatch draft" }),
    "Copy dispatch draft",
  );
  await expectTouchTarget(
    page.getByRole("button", { name: "Download dispatch draft" }),
    "Download dispatch draft",
  );

  const forbiddenRequests =
    await trapForbiddenDispatchReviewExportRequests(page);

  await page.getByRole("button", { name: "Copy dispatch draft" }).click();
  const copiedDraftText = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(copiedDraftText).toContain("To: owners@queenstreet.example");
  expect(copiedDraftText).toContain(
    "Subject: Owner statement for May 2026 - Queen Street Property Trust",
  );
  expect(copiedDraftText).toContain("Hi Mia Accounts,");
  expect(copiedDraftText).toContain(DISPATCH_DRAFT_EXPORT_GUARDRAIL);

  const draftDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download dispatch draft" }).click();
  const draftDownload = await draftDownloadPromise;
  expect(draftDownload.suggestedFilename()).toBe(
    "owner-statement-dispatch-draft-2026-05-queen-street-property-trust.txt",
  );
  const draftDownloadPath = await draftDownload.path();
  expect(draftDownloadPath).not.toBeNull();
  const draftText = await readFile(draftDownloadPath!, "utf8");
  expect(draftText).toContain("To: owners@queenstreet.example");
  expect(draftText).toContain(
    "Subject: Owner statement for May 2026 - Queen Street Property Trust",
  );
  expect(draftText).toContain("Hi Mia Accounts,");
  expect(draftText).toContain("Invoiced: $17,600");
  expect(draftText).toContain("Outstanding: $17,600");
  expect(draftText).toContain(DISPATCH_DRAFT_EXPORT_GUARDRAIL);
  expect(copiedDraftText).toBe(draftText);
  expect(forbiddenRequests).toEqual([]);
});
