import { expect, type Locator, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

function watchForbiddenXeroProviderRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.includes("/api/v1/xero/oauth/start") ||
      url.includes("/api/v1/xero/contacts/sync-preview") ||
      url.includes("/api/v1/xero/chart-tax/validate-preview") ||
      url.includes("/api/v1/xero/invoices/posting-preview") ||
      url.includes("/api/v1/xero/invoices/draft-create") ||
      url.includes("/api/v1/xero/invoices/provider-dispatch") ||
      url.includes("/api/v1/xero/payments/reconciliation-preview") ||
      url.includes("/api/v1/xero/payments/reconciliation-apply")
    ) {
      requests.push(`${request.method()} ${url}`);
    }
  });
  return requests;
}

function watchForbiddenCommsReadOnlyRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const mutatesLocalComms =
      request.method() !== "GET" &&
      (path.startsWith("/api/v1/comms/") ||
        path.startsWith("/api/v1/documents") ||
        path.includes("/provider-history") ||
        path.includes("/provider-dispatch"));
    const callsProviders =
      path.includes("/api/v1/sendgrid") ||
      path.includes("/api/v1/twilio") ||
      path.includes("/provider-refresh");
    if (mutatesLocalComms || callsProviders) {
      requests.push(`${request.method()} ${url.toString()}`);
    }
  });
  return requests;
}

async function expectTouchTarget(locator: Locator, minSize = 44) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

test.beforeEach(async ({ page }, testInfo) => {
  await mockLeasiumApi(page, {
    leaseMatchAcceptConflict: testInfo.title.includes(
      "active DocuSign conflict",
    ),
  });
});

test("setup explains Clerk configuration before first workspace setup", async ({
  page,
}) => {
  await page.goto("/setup");

  await expect(
    page.getByRole("heading", { name: "First workspace setup" }),
  ).toBeVisible();
  await expect(page.getByText("Clerk is not configured yet")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toBeVisible();
});

test("workspace guard asks signed-out operators to sign in when Clerk is configured", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_CLERK_GUARD ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a real Clerk smoke environment.",
  );

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Sign in to open the workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "First workspace setup" }),
  ).toBeVisible();
});

test("dashboard shows the mocked portfolio and opens billing readiness", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Daily command center" }),
  ).toBeVisible();
  await expect(page.getByLabel("Entity")).toHaveValue("entity-1");
  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Queen Street Retail Centre").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Insurance certificate renewal").first(),
  ).toBeVisible();
  const workspaceToolbar = page.getByRole("toolbar", {
    name: "Workspace utilities",
  });
  await expect(workspaceToolbar).toBeVisible();
  await expect(workspaceToolbar.getByLabel("Entity")).toHaveValue("entity-1");
  await expect(
    workspaceToolbar.getByRole("button", { name: "Open search" }),
  ).toBeVisible();
  await expect(
    workspaceToolbar.getByRole("button", {
      name: "Show keyboard shortcuts",
    }),
  ).toBeVisible();
  await expect(
    workspaceToolbar.getByRole("link", { name: "Open notifications" }),
  ).toBeVisible();
  await expect(
    workspaceToolbar.getByRole("button", { name: /Appearance:/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open search" }).click();
  await expect(
    page.getByRole("dialog", { name: "Command search" }),
  ).toBeVisible();
  const commandSearch = page.getByRole("textbox", { name: "Command search" });
  await commandSearch.fill("portfolio qa");
  await expect(
    page.getByRole("link", { name: /Data cleanup \/ Portfolio QA/ }),
  ).toBeVisible();
  await commandSearch.fill("add property");
  await expect(
    page
      .getByRole("list", { name: "Command actions" })
      .getByRole("link", { name: /Add property/ }),
  ).toHaveAttribute("href", "/properties?action=new");
  await commandSearch.fill("add tenant");
  await expect(
    page
      .getByRole("list", { name: "Command actions" })
      .getByRole("link", { name: /Add tenant/ }),
  ).toHaveAttribute("href", "/tenants?action=invite");
  await commandSearch.fill("comms");
  await expect(
    page.getByRole("list", { name: "Command actions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open comms queue/ }),
  ).toBeVisible();
  await commandSearch.fill("zzzz-no-match");
  await expect(page.getByRole("status")).toContainText("No matching action.");
  await page.mouse.click(300, 100);
  await expect(
    page.getByRole("dialog", { name: "Command search" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Open search" }).click();
  await expect(
    page.getByRole("dialog", { name: "Command search" }),
  ).toBeVisible();
  const reopenedCommandSearch = page.getByRole("textbox", {
    name: "Command search",
  });
  await expect(reopenedCommandSearch).toHaveValue("");
  await reopenedCommandSearch.fill("billing");
  await page
    .getByRole("list", { name: "Command actions" })
    .getByRole("link", { name: /Review billing blockers/ })
    .click();

  await expect(page).toHaveURL(/\/billing-readiness$/);
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();
  const billingActionQueue = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Billing action queue" }),
    })
    .first();
  await expect(
    billingActionQueue.getByText("Xero mapping needs review").first(),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Fix blockers/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Review drafts/ })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Approve invoices/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Dispatch & reconcile/ }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Review drafts/ }).click();
  const billingDraftTable = page.locator("table").filter({
    hasText: "May rent and outgoings",
  });
  await expect(billingDraftTable).toBeVisible();
  await expect(
    billingDraftTable.getByText("May rent and outgoings"),
  ).toBeVisible();
  await expect(
    billingDraftTable.getByRole("link", { name: /Intake intake-1/ }),
  ).toHaveAttribute("href", "/intake?entity_id=entity-1&review=intake-1");
  await expectTouchTarget(
    billingDraftTable.getByRole("link", { name: /Intake intake-1/ }),
  );

  await page.getByRole("tab", { name: /Approve invoices/ }).click();
  const invoicePrep = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Invoice preparation" }),
    })
    .first();
  await expect(invoicePrep).toBeVisible();
  const invoicePrepTable = invoicePrep.locator("table");
  const invoicePrepRow = invoicePrepTable
    .getByRole("row")
    .filter({ hasText: "INV-1001" })
    .first();
  await expect(
    invoicePrepRow.getByText("INV-1001", { exact: true }),
  ).toBeVisible();
  await expect(
    invoicePrepRow.getByText("invoice_delivery v1").first(),
  ).toBeVisible();
  await invoicePrepRow.getByText("Message preview").first().click();
  await expect(
    invoicePrepRow.getByText("Please find your invoice attached.").first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
  await expect(
    page.getByRole("heading", { name: "Month-end checklist" }),
  ).toBeVisible();
  await expect(
    page.getByText("1 provider recovery needs attention before month end."),
  ).toBeVisible();
  await expect(
    page.getByText("2 approved invoices are still unpaid locally.").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Owner statements", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("1 owner need billing email before dispatch"),
  ).toBeVisible();
  await expect(page.getByText("Needs Xero approval").first()).toBeVisible();
  const primaryDispatchRow = page.getByRole("row").filter({
    hasText: "INV-1001",
  });
  await expect(
    primaryDispatchRow.getByRole("button", { exact: true, name: "Dispatch" }),
  ).toBeVisible();
  await expect(
    primaryDispatchRow.getByRole("button", { name: "Email" }),
  ).toBeVisible();
  const handoffDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download handoff CSV" }).click();
  const handoffDownload = await handoffDownloadPromise;
  expect(handoffDownload.suggestedFilename()).toBe(
    "billing-month-end-handoff-2026-05.csv",
  );
  const handoffDownloadPath = await handoffDownload.path();
  expect(handoffDownloadPath).not.toBeNull();
  const handoffCsv = await readFile(handoffDownloadPath!, "utf8");
  expect(handoffCsv).toContain("Acme Holdings Pty Ltd");
  expect(handoffCsv).toContain("2026-05");
  expect(handoffCsv).toContain("Approved invoices");
  expect(handoffCsv).toContain("Provider dispatch");
  expect(handoffCsv).toContain("Payment review");
  expect(handoffCsv).toContain("Owner statements");
  expect(handoffCsv).toContain("missing recipient");
  expect(handoffCsv).toContain(
    "Review-only export: downloading this file does not create Xero drafts, preview or apply payment reconciliation, send tenant or owner email, generate billing drafts, dispatch invoices, refresh providers, or mutate provider history.",
  );

  await page.getByRole("link", { name: "Open statements" }).last().click();
  await expect(page).toHaveURL(/\/statements\?.*month=2026-05/);
  await expect(
    page.getByRole("heading", { name: "Owner statements" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Statement pack readiness" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Finance checklist" }),
  ).toBeVisible();
  const checklistDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download checklist CSV" }).click();
  const checklistDownload = await checklistDownloadPromise;
  expect(checklistDownload.suggestedFilename()).toBe(
    "owner-statement-checklist-2026-05.csv",
  );
  await expect(page.getByText("Statement pack blocked")).toBeVisible();
  await expect(page.getByText("2 statement invoices").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Queen Street Property Trust" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print / save PDF" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download accountant pack" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download PDF" }),
  ).toBeVisible();
  await expect(
    page.getByText("Owner statement", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dispatch review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy dispatch draft" }),
  ).toBeVisible();
  await expect(page.getByText("Review only. This does not send")).toBeVisible();
});

test("mobile header keeps utility touch targets at least 44px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expectTouchTarget(
    page.getByRole("button", { name: "Open navigation" }),
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  const closeNavigation = page.getByRole("button", {
    name: "Close navigation",
  });
  await expect(closeNavigation).toBeVisible();
  await expectTouchTarget(closeNavigation);
  await closeNavigation.click();

  const workspaceToolbar = page.getByRole("toolbar", {
    name: "Workspace utilities",
  });
  await expect(workspaceToolbar).toBeVisible();
  await expectTouchTarget(
    workspaceToolbar.getByRole("button", { name: "Open search" }),
  );
  await expectTouchTarget(
    workspaceToolbar.getByRole("link", { name: "Open notifications" }),
  );
  await expectTouchTarget(
    workspaceToolbar.getByRole("button", { name: /Appearance:/ }),
  );
  await expect(
    workspaceToolbar.getByRole("button", {
      name: "Show keyboard shortcuts",
    }),
  ).toBeHidden();
});

test("mobile navigation drawer closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Open navigation" }).click();

  const closeNavigation = page.getByRole("button", {
    name: "Close navigation",
  });
  await expect(closeNavigation).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(closeNavigation).toBeHidden();
});

test("smart intake quick-add links keep 44px touch targets", async ({
  page,
}) => {
  await page.goto("/intake");

  await expect(
    page.getByRole("heading", { level: 1, name: "Smart Intake" }),
  ).toBeVisible();
  const addProperty = page.getByRole("link", { name: "Add property" });
  await expectTouchTarget(addProperty);
  await expect(addProperty).toHaveAttribute("href", "/properties?action=new");
  const addTenant = page.getByRole("link", { name: "Add tenant" });
  await expectTouchTarget(addTenant);
  await expect(addTenant).toHaveAttribute("href", "/tenants?action=invite");
});

test("smart intake review filter keeps a 44px touch target", async ({
  page,
}) => {
  await page.goto("/intake");

  await expect(
    page.getByRole("heading", { level: 1, name: "Smart Intake" }),
  ).toBeVisible();
  await expectTouchTarget(page.getByLabel("Review filter"));
});

test("billing readiness mobile actions keep 44px touch targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/billing-readiness");

  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
  await expect(
    page.getByRole("heading", { name: "Month-end checklist" }),
  ).toBeVisible();

  const deliveryPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Delivery & payments" }),
  });
  const deliveryFilterButton = (name: RegExp) =>
    deliveryPanel.getByRole("button", { name });
  const forbiddenFilterRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const callsBasiq = path.includes("/basiq");
    const mutatesBillingOrProvider =
      request.method() !== "GET" &&
      (path.includes("/billing-drafts") ||
        path.includes("/invoice-drafts") ||
        path.includes("/invoice-delivery") ||
        path.includes("/provider-dispatch") ||
        path.includes("/payments/reconciliation") ||
        path.includes("/xero/"));
    if (callsBasiq || mutatesBillingOrProvider) {
      forbiddenFilterRequests.push(`${request.method()} ${url.toString()}`);
    }
  });

  await expectTouchTarget(deliveryFilterButton(/^All\b/));
  await expectTouchTarget(deliveryFilterButton(/^Needs action\b/));
  await expectTouchTarget(deliveryFilterButton(/^Ready to dispatch\b/));
  await expectTouchTarget(deliveryFilterButton(/^Complete\b/));
  await expectTouchTarget(deliveryFilterButton(/^Unpaid\b/));
  await deliveryFilterButton(/^Needs action\b/).click();
  await deliveryFilterButton(/^Ready to dispatch\b/).click();
  await deliveryFilterButton(/^Complete\b/).click();
  await deliveryFilterButton(/^Unpaid\b/).click();
  await deliveryFilterButton(/^All\b/).click();
  expect(forbiddenFilterRequests).toEqual([]);

  await expectTouchTarget(page.getByRole("link", { name: "Open recovery" }));
  await expectTouchTarget(
    page.getByRole("link", { name: "Review payments" }).first(),
  );
  await expectTouchTarget(
    page.getByRole("link", { name: "Open statements" }).first(),
  );
  const staleDispatchCard = page
    .getByTestId("billing-delivery-mobile-card")
    .filter({ hasText: "INV-1001" })
    .first();
  await expectTouchTarget(
    staleDispatchCard.getByRole("link", { name: "Preview" }),
  );
  await expectTouchTarget(staleDispatchCard.getByRole("link", { name: "PDF" }));
});

test("settings mobile tabs keep 44px touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expectTouchTarget(page.getByRole("tab", { name: "Security" }));
  await expectTouchTarget(page.getByRole("tab", { name: "Organisation" }));
  await expectTouchTarget(page.getByRole("tab", { name: "Connect" }));
});

test("notifications mobile actions keep intended touch targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  const workNoticeCenter = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Work notice center" }),
  });
  for (const filterName of [
    /^All 2$/,
    /^Attention 1$/,
    /^In flight 1$/,
    /^Ready 0$/,
    /^Follow-up due 1$/,
    /^Failed email 1$/,
    /^All channels 2$/,
    /^Email 2$/,
    /^SMS 2$/,
    /^In-app 0$/,
  ]) {
    await expectTouchTarget(
      workNoticeCenter.getByRole("button", { name: filterName }),
    );
  }
  const digestHistory = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Digest history" }),
  });
  for (const filterName of [
    /^All 1$/,
    /^Needs send 1$/,
    /^Sent 0$/,
    /^Failed 0$/,
    /^Skipped 0$/,
    /^Recovery 0$/,
    /^All channels 1$/,
    /^Email 0$/,
    /^SMS 0$/,
    /^Preview only 1$/,
  ]) {
    await expectTouchTarget(
      digestHistory.getByRole("button", { name: filterName }),
    );
  }
  await expectTouchTarget(
    page.getByRole("link", { name: "Open work" }).first(),
  );
  await expectTouchTarget(
    page.getByRole("link", { exact: true, name: "Open Work" }),
  );
});

test("dashboard Leasium AI panel answers with cited record", async ({
  page,
}) => {
  await page.goto("/");

  const askPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: /^Leasium AI/ }),
  });
  await expect(askPanel).toBeVisible();
  await expect(
    askPanel.getByText(/Read-only — Leasium AI will never act on a question/),
  ).toBeVisible();

  for (const suggestion of [
    "Which leases expire in the next 90 days?",
    "Which properties are vacant right now?",
  ]) {
    await expectTouchTarget(askPanel.getByRole("button", { name: suggestion }));
  }

  await askPanel
    .getByRole("button", { name: "Which properties are vacant right now?" })
    .click();

  await expect(
    askPanel.getByText(
      "1 lease expires within the next 90 days: Queen Street Retail Centre on 2026-07-15.",
    ),
  ).toBeVisible();
  await expect(askPanel.getByText("Sources")).toBeVisible();
  const sourceLink = askPanel.getByRole("link", {
    name: /Property · Queen Street Retail Centre/,
  });
  await expect(sourceLink).toBeVisible();
  await expectTouchTarget(sourceLink);
});

test("Properties multi-view toggles between table and board", async ({
  page,
}) => {
  await page.goto("/properties");

  // Table is the default — table headers visible.
  await expect(page.locator("table").first()).toBeVisible();

  await page.getByRole("tab", { name: "Board" }).click();
  // Switching to board hides the table headers; columns rendered by
  // occupancy bucket appear instead.
  await expect(page.locator("table").first()).toBeHidden();
  await expect(page.getByText("Queen Street Retail Centre")).toBeVisible();
  await expect(page.getByText("No units").first()).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=board/);

  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator("table").first()).toBeVisible();
});

test("AI inbox classifies a pasted message and surfaces a deep-link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox");

  await expect(page.getByRole("heading", { name: "AI inbox" })).toBeVisible();
  await page.getByRole("button", { name: "Try sample" }).click();
  await page.getByRole("button", { name: /Classify/ }).click();

  await expect(page.getByText(/Maintenance request/i).first()).toBeVisible();
  await expect(
    page.getByText("Tenant reports a slow kitchen tap leak."),
  ).toBeVisible();
  const handoffLink = page.getByRole("link", { name: /Take it from here/ });
  await expect(handoffLink).toBeVisible();
  await expectTouchTarget(handoffLink);
});

test("AI inbox promotes a classified message into a maintenance draft", async ({
  page,
}) => {
  await page.goto("/inbox");

  await page.getByRole("button", { name: "Try sample" }).click();
  await page.getByRole("button", { name: /Classify/ }).click();

  const promotePanel = page.getByTestId("promote-panel");
  await expect(promotePanel).toBeVisible();
  await expect(
    promotePanel.getByText(/Create maintenance work order/i),
  ).toBeVisible();

  // The AI-suggested property + tenant should be pre-filled in the
  // dropdowns from the triage response.
  await expect(promotePanel.getByLabel("Promote property")).toHaveValue(
    "11111111-1111-1111-1111-111111111111",
  );
  await expect(promotePanel.getByLabel("Promote tenant")).toHaveValue(
    "22222222-2222-2222-2222-222222222222",
  );

  await promotePanel.getByRole("button", { name: /Promote to draft/ }).click();
  await expect(page).toHaveURL(
    /\/operations\/maintenance\/99999999-9999-9999-9999-999999999999/,
  );
});

test("comms queue approves inbound SMS with a phone recipient", async ({
  page,
}) => {
  const forbiddenOutboundLogRequests =
    watchForbiddenCommsReadOnlyRequests(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/comms");

  await expect(
    page.getByRole("heading", { name: "Comms queue" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Work, 9 drafts in the comms queue, 3 urgent",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Approve to send the email or SMS"),
  ).toBeVisible();
  await expect(page.getByText(/Queue generated 27 May 2026/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh queue" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("group", { name: "Remaining now: 9" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Settled now: 0" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Urgent: 3" })).toBeVisible();
  const outboundLogPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Outbound log" }) });
  await expect(outboundLogPanel).toBeVisible();
  await expect(
    outboundLogPanel.getByText("6 dispatch receipts", { exact: true }),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByRole("tab", { name: "All receipts 6" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    outboundLogPanel.getByRole("tab", { name: "Needs attention 1" }),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByRole("tab", { name: "Email 5" }),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByRole("tab", { name: "SMS 1" }),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("Showing all 6 dispatch receipts."),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("comms draft sms failed"),
  ).toBeVisible();
  await expect(
    outboundLogPanel
      .getByTestId("outbound-log-event")
      .filter({ hasText: "comms draft sms failed" })
      .getByText("Twilio SMS"),
  ).toBeVisible();
  await expect(outboundLogPanel.getByText("+61400111222")).toBeVisible();
  await expect(
    outboundLogPanel.getByText("contractor update email queued"),
  ).toBeVisible();
  const maintenanceOutboundLogRow = outboundLogPanel
    .getByTestId("outbound-log-event")
    .filter({ hasText: "contractor update email queued" });
  await expect(
    maintenanceOutboundLogRow.getByRole("link", { name: "Open work order" }),
  ).toHaveAttribute("href", "/operations/maintenance/work%2Forder%3F1");
  await expect(
    outboundLogPanel.getByRole("link", { name: "Open arrears case" }),
  ).toHaveAttribute("href", "/operations?tab=arrears");
  const lifecycleOutboundLogRow = outboundLogPanel
    .getByTestId("outbound-log-event")
    .filter({ hasText: "tenant lifecycle email queued" });
  await expect(
    lifecycleOutboundLogRow.getByRole("link", {
      name: "Open tenant workflow",
    }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  const complianceOutboundLogRow = outboundLogPanel
    .getByTestId("outbound-log-event")
    .filter({ hasText: "compliance email queued" });
  await expect(
    complianceOutboundLogRow.getByRole("link", { name: "Open work queue" }),
  ).toHaveAttribute("href", "/operations");
  const leaseOutboundLogRow = outboundLogPanel
    .getByTestId("outbound-log-event")
    .filter({ hasText: "rent review email queued" });
  await expect(
    leaseOutboundLogRow.getByRole("link", { name: "Open tenant workflow" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  await expect(
    outboundLogPanel.getByText("Opening this log does not send email"),
  ).toBeVisible();
  const outboundLogDownloadPromise = page.waitForEvent("download");
  await outboundLogPanel
    .getByRole("button", { name: "Download outbound log CSV" })
    .click();
  const outboundLogDownload = await outboundLogDownloadPromise;
  expect(outboundLogDownload.suggestedFilename()).toBe(
    "comms-outbound-log-2026-05-27.csv",
  );
  const outboundLogDownloadPath = await outboundLogDownload.path();
  expect(outboundLogDownloadPath).not.toBeNull();
  const outboundLogCsv = await readFile(outboundLogDownloadPath!, "utf8");
  expect(outboundLogCsv).toContain("Outbound log");
  expect(outboundLogCsv).toContain("comms draft sms failed");
  expect(outboundLogCsv).toContain("contractor update email queued");
  expect(outboundLogCsv).toContain("maintenance_work_order:work/order?1");
  expect(outboundLogCsv).toContain(
    '"\'=HYPERLINK(""https://example.invalid"",""Cool Air"")"',
  );
  expect(outboundLogCsv).toContain(
    "Read-only export: downloading this file does not send SendGrid email, send Twilio SMS, dismiss candidates, upload evidence, write provider history, settle candidates, mutate the queue, or refresh provider state.",
  );
  await outboundLogPanel
    .getByRole("tab", { name: "Needs attention 1" })
    .click();
  await expect(
    outboundLogPanel.getByText(
      "Showing 1 of 6 dispatch receipts in Needs attention.",
    ),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("comms draft sms failed"),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("contractor update email queued"),
  ).not.toBeVisible();
  const filteredOutboundLogDownloadPromise = page.waitForEvent("download");
  await outboundLogPanel
    .getByRole("button", { name: "Download outbound log CSV" })
    .click();
  const filteredOutboundLogDownload = await filteredOutboundLogDownloadPromise;
  const filteredOutboundLogDownloadPath =
    await filteredOutboundLogDownload.path();
  expect(filteredOutboundLogDownloadPath).not.toBeNull();
  const filteredOutboundLogCsv = await readFile(
    filteredOutboundLogDownloadPath!,
    "utf8",
  );
  expect(filteredOutboundLogCsv).toContain("Needs attention dispatch receipts");
  expect(filteredOutboundLogCsv).toContain("1 of 6 receipts");
  expect(filteredOutboundLogCsv).toContain("comms draft sms failed");
  expect(filteredOutboundLogCsv).not.toContain(
    "contractor update email queued",
  );
  await outboundLogPanel.getByRole("tab", { name: "Email 5" }).click();
  await expect(
    outboundLogPanel.getByText("Showing 5 of 6 dispatch receipts in Email."),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("contractor update email queued"),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("comms draft sms failed"),
  ).not.toBeVisible();
  await outboundLogPanel.getByRole("tab", { name: "SMS 1" }).click();
  await expect(
    outboundLogPanel.getByText("Showing 1 of 6 dispatch receipts in SMS."),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("comms draft sms failed"),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("contractor update email queued"),
  ).not.toBeVisible();
  await outboundLogPanel.getByRole("tab", { name: "All receipts 6" }).click();
  expect(forbiddenOutboundLogRequests).toEqual([]);
  await expect(page.getByRole("tab", { name: "All drafts 9" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Showing all 9 drafts.")).toBeVisible();
  await expect(
    page.getByText("9 drafts remaining this session."),
  ).toBeVisible();
  const commsReviewDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download review CSV" }).click();
  const commsReviewDownload = await commsReviewDownloadPromise;
  expect(commsReviewDownload.suggestedFilename()).toBe(
    "comms-queue-review-2026-05-27.csv",
  );
  const commsReviewDownloadPath = await commsReviewDownload.path();
  expect(commsReviewDownloadPath).not.toBeNull();
  const commsReviewCsv = await readFile(commsReviewDownloadPath!, "utf8");
  expect(commsReviewCsv).toContain("Inbound SMS");
  expect(commsReviewCsv).toContain("Inbound email");
  expect(commsReviewCsv).toContain("Compliance reminder");
  expect(commsReviewCsv).toContain("Annual fire safety certificate");
  expect(commsReviewCsv).toContain("Rent review");
  expect(commsReviewCsv).toContain("Tenant lifecycle");
  expect(commsReviewCsv).toContain("Contractor forward");
  expect(commsReviewCsv).toContain("Tenant forward");
  expect(commsReviewCsv).toContain(
    "Tenant says the front counter unit is still leaking.",
  );
  expect(commsReviewCsv).toContain("Contractor can attend tomorrow morning.");
  expect(commsReviewCsv).toContain("Twilio SMS");
  expect(commsReviewCsv).toContain("SendGrid email");
  expect(commsReviewCsv).toContain("+61400111222");
  expect(commsReviewCsv).toContain("attachments@tenant.example");
  expect(commsReviewCsv).toContain("tenant@example.com");
  expect(commsReviewCsv).toContain("1 attachment routed to Smart Intake");
  expect(commsReviewCsv).toContain(
    "DocuSign retry needed for your lease activation",
  );
  expect(commsReviewCsv).toContain(
    "DocuSign setup needed before lease signing",
  );
  expect(commsReviewCsv).toContain(
    "Lease activation review for tenant-uploaded lease",
  );
  expect(commsReviewCsv).toContain(
    "Review-only export: downloading this file does not send SendGrid email, send Twilio SMS, dismiss candidates, upload evidence, write provider history, settle candidates, mutate the queue, or refresh provider state.",
  );

  const smsCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Inbound SMS" }) });
  const emailCard = page
    .locator("section")
    .filter({ hasText: "Inbound email" })
    .first();
  await expect(smsCard).toBeVisible();
  await expect(emailCard).toBeVisible();
  const contractorForwardCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Contractor forward" }) })
    .first();
  await page.getByRole("tab", { name: "Contractor forward 1" }).click();
  await expect(
    page.getByText("Showing 1 of 9 drafts in Contractor forward."),
  ).toBeVisible();
  await expect(contractorForwardCard).toBeVisible();
  await expect(
    contractorForwardCard.getByText(
      "reviewed forward to contractor from latest tenant-visible activity",
    ),
  ).toBeVisible();
  await expect(contractorForwardCard.getByLabel("Email recipient")).toHaveValue(
    "service@coolair.example",
  );
  await expect(contractorForwardCard.getByLabel("Body")).toHaveValue(
    "Hi Cool Air Services,\n\nPlease note the latest tenant-facing update for Air conditioning fault:\nTenant says the front counter unit is still leaking.\n\nPlease confirm the next action or timing before we send anything further.",
  );
  await expect(
    contractorForwardCard.getByRole("link", { name: "Open work order" }),
  ).toHaveAttribute("href", "/operations/maintenance/work-order-1");
  await expect(
    contractorForwardCard.getByRole("button", { name: "Approve & send" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Tenant lifecycle 3" }).click();
  await expect(
    page.getByText("Showing 3 of 9 drafts in Tenant lifecycle."),
  ).toBeVisible();
  await expect(smsCard).not.toBeVisible();
  await expect(emailCard).not.toBeVisible();
  const lifecycleCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Tenant lifecycle" }) })
    .first();
  await expect(lifecycleCard).toBeVisible();
  await expect(
    lifecycleCard.getByText(
      "DocuSign retry review: envelope stalled before activation",
    ),
  ).toBeVisible();
  await expect(lifecycleCard.getByLabel("Subject")).toHaveValue(
    "DocuSign retry needed for your lease activation",
  );
  await expect(lifecycleCard.getByLabel("Body")).toHaveValue(
    "Hi Bright Cafe team, your lease activation is waiting on a DocuSign retry review. We are checking the envelope status now and will confirm the next step before anything is sent.",
  );
  await expect(lifecycleCard.getByText("SendGrid email")).toBeVisible();
  await expect(
    lifecycleCard.getByRole("button", { name: "Approve & send" }),
  ).toBeEnabled();
  await expect(lifecycleCard.getByText("Urgent")).toBeVisible();
  await expect(
    lifecycleCard.getByRole("link", { name: "Open tenant review" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  const skippedDocusignLifecycleCard = page
    .locator("section")
    .filter({ hasText: "DocuSign skipped" })
    .first();
  await expect(skippedDocusignLifecycleCard).toBeVisible();
  await expect(
    skippedDocusignLifecycleCard.getByText("DOCUSIGN_BASE_URL"),
  ).toBeVisible();
  await expect(skippedDocusignLifecycleCard.getByLabel("Subject")).toHaveValue(
    "DocuSign setup needed before lease signing",
  );
  await expect(skippedDocusignLifecycleCard.getByLabel("Body")).toHaveValue(
    "Hi Bright Cafe team, the DocuSign signing request could not be sent because provider setup needs attention. We are fixing the signing setup before sending a fresh lease pack.",
  );
  await expect(skippedDocusignLifecycleCard.getByText("Urgent")).toBeVisible();
  await expect(
    skippedDocusignLifecycleCard.getByRole("link", {
      name: "Open tenant review",
    }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  const tenantUploadLifecycleCard = page
    .locator("section")
    .filter({ hasText: "tenant upload completed" })
    .first();
  await expect(tenantUploadLifecycleCard).toBeVisible();
  await expect(
    tenantUploadLifecycleCard.getByText(
      "tenant upload completed, document tenant-uploaded-lease-1, activation ready_for_review, lease pending -> active",
    ),
  ).toBeVisible();
  await expect(tenantUploadLifecycleCard.getByLabel("Subject")).toHaveValue(
    "Lease activation review for tenant-uploaded lease",
  );
  await expect(tenantUploadLifecycleCard.getByLabel("Body")).toHaveValue(
    "Hi Bright Cafe team, thanks for uploading your signed lease. The property team is completing the final activation review before the lease is marked active in our system.",
  );
  await expect(
    tenantUploadLifecycleCard.getByRole("link", {
      name: "Open tenant review",
    }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  await page.getByRole("tab", { name: "Rent review 1" }).click();
  await expect(
    page.getByText("Showing 1 of 9 drafts in Rent review."),
  ).toBeVisible();
  await expect(smsCard).not.toBeVisible();
  const rentReviewCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Rent review" }) })
    .first();
  await expect(rentReviewCard).toBeVisible();
  await expect(
    rentReviewCard.getByRole("link", { name: "Open tenant workflow" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  await rentReviewCard.getByRole("button", { name: "Dismiss" }).click();
  await expect(rentReviewCard.getByRole("status")).toContainText(
    "Draft deferred until 3 June 2026",
  );
  await expect(
    page.getByRole("group", { name: "Remaining now: 8" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Settled now: 1" }),
  ).toBeVisible();
  await expect(
    page.getByText("8 drafts remaining, 1 settled this session."),
  ).toBeVisible();
  await expect(
    rentReviewCard.getByText("Deferred", { exact: true }),
  ).toBeVisible();
  await expect(rentReviewCard.getByLabel("Subject")).toBeDisabled();
  await expect(
    rentReviewCard.getByText(
      "This draft is locked because a dispatch or dismiss receipt has been recorded.",
    ),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Inbound SMS 1" }).click();
  await expect(
    page.getByText("Showing 1 of 9 drafts in Inbound SMS."),
  ).toBeVisible();
  await expect(smsCard).toBeVisible();
  await expect(
    smsCard.getByText("AI: maintenance request (82%)"),
  ).toBeVisible();
  await expect(smsCard.getByText(/Due 27 May 2026/)).toBeVisible();
  await expect(smsCard.getByText(/Drafted 27 May 2026/)).toBeVisible();
  await expect(smsCard.getByText("Twilio SMS")).toBeVisible();
  await expect(smsCard.getByLabel("Subject")).toHaveCount(0);
  await expect(smsCard.getByLabel("Phone recipient")).toHaveValue(
    "+61400111222",
  );
  await smsCard.getByLabel("Phone recipient").fill("");
  await expect(smsCard.getByText("Approval needs review")).toBeVisible();
  await expect(
    smsCard.getByText("Add a phone recipient before approving."),
  ).toBeVisible();
  await expect(
    smsCard.getByRole("button", { name: "Approve & send" }),
  ).toBeDisabled();
  await expect(
    smsCard.getByRole("button", { name: "Approve & send" }),
  ).toHaveAttribute("aria-describedby", /.+/);
  await expect(smsCard.getByText("Edited draft")).toBeVisible();
  await smsCard.getByLabel("Phone recipient").fill("+61400111222");
  await expect(
    smsCard.getByRole("button", { name: "Approve & send" }),
  ).not.toHaveAttribute("aria-describedby", /.+/);
  await expect(smsCard.getByText("Edited draft")).toHaveCount(0);
  await smsCard
    .getByLabel("Body")
    .fill(
      "Thanks for the heads up. We have logged this and will follow up shortly.",
    );
  await expect(smsCard.getByText("Edited draft")).toBeVisible();
  await expect(
    smsCard.getByRole("button", { name: "Reset draft" }),
  ).toBeVisible();
  await expect(
    smsCard.getByRole("button", { name: "Reset draft" }),
  ).toBeEnabled();
  await smsCard.getByRole("button", { name: "Reset draft" }).click();
  await expect(smsCard.getByText("Edited draft")).toHaveCount(0);
  await expect(smsCard.getByLabel("Body")).toHaveValue(
    "Thanks for the update. We have logged this and will follow up shortly.",
  );
  await expect(
    smsCard.getByRole("button", { name: "Reset draft" }),
  ).toHaveCount(0);
  await expect(smsCard.getByText("SMS body review")).toBeVisible();
  await expect(
    smsCard.getByText("Under the 160-character single SMS guide."),
  ).toBeVisible();
  await expect(
    smsCard.getByText("Approve sends the SMS through Twilio."),
  ).toBeVisible();
  await expect(
    smsCard.getByText("Edit body or recipient before approving."),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Inbound email 1" }).click();
  await expect(
    page.getByText("Showing 1 of 9 drafts in Inbound email."),
  ).toBeVisible();
  await expect(emailCard).toBeVisible();
  await expect(
    emailCard.getByText("1 attachment routed to Smart Intake"),
  ).toBeVisible();
  await expect(
    emailCard.getByRole("link", { name: "Open Smart Intake" }),
  ).toHaveAttribute("href", "/intake");
  await expect(emailCard.getByText("SendGrid email")).toBeVisible();
  await expect(emailCard.getByLabel("Email recipient")).toHaveValue(
    "attachments@tenant.example",
  );

  await page.getByRole("tab", { name: "Inbound SMS 1" }).click();
  await expect(smsCard).toBeVisible();
  await smsCard.getByRole("button", { name: "Approve & send" }).click();

  await expect(smsCard.getByText("SMS send skipped")).toBeVisible();
  await expect(
    smsCard.getByText("Send skipped", { exact: true }),
  ).toBeVisible();
  const dispatchReceipt = smsCard.getByRole("status");
  await expect(dispatchReceipt).toContainText("SMS send skipped");
  await expect(smsCard.getByText("Twilio SMS to +61400111222.")).toBeVisible();
  await expect(
    smsCard.getByText("Twilio Messaging is not configured yet"),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Remaining now: 7" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Settled now: 2" }),
  ).toBeVisible();
  await expect(
    page.getByText("7 drafts remaining, 2 settled this session."),
  ).toBeVisible();
  await expect(
    smsCard.getByText(
      "This draft is locked because a dispatch or dismiss receipt has been recorded.",
    ),
  ).toBeVisible();
  await expect(smsCard.getByLabel("Phone recipient")).toBeDisabled();
  await expect(smsCard.getByLabel("Body")).toBeDisabled();

  await page.getByRole("tab", { name: "Compliance reminder 1" }).click();
  await expect(
    page.getByText("Showing 1 of 9 drafts in Compliance reminder."),
  ).toBeVisible();
  const complianceCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Compliance reminder" }) })
    .first();
  await expect(complianceCard).toBeVisible();
  await expect(
    complianceCard.getByText("Annual fire safety certificate"),
  ).toBeVisible();
  await expect(complianceCard.getByLabel("Email recipient")).toHaveValue(
    "compliance@bright.example",
  );
  await expect(
    complianceCard.getByRole("link", { name: "Open compliance work" }),
  ).toHaveAttribute("href", "/operations?tab=compliance");
  await expect(
    complianceCard.getByRole("link", { name: "Upload via Smart Intake" }),
  ).toHaveAttribute("href", "/intake");
  const evidenceFileChooserPromise = page.waitForEvent("filechooser");
  await complianceCard
    .getByRole("button", { name: "Or attach a file manually" })
    .click();
  const evidenceFileChooser = await evidenceFileChooserPromise;
  await evidenceFileChooser.setFiles({
    name: "fire-safety.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("fire safety evidence"),
  });
  await expect(
    complianceCard.getByText("Uploaded fire-safety.pdf"),
  ).toBeVisible();
  await complianceCard.getByRole("button", { name: "Approve & send" }).click();
  await expect(complianceCard.getByText("Email send skipped")).toBeVisible();
  await expect(
    complianceCard.getByText("SendGrid email to compliance@bright.example."),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Remaining now: 6" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Settled now: 3" }),
  ).toBeVisible();
});

test("grouped compliance comms drafts avoid single-obligation evidence upload", async ({
  page,
}) => {
  await page.route("**/api/v1/comms/queue?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entity_id: "entity-1",
        generated_at: "2026-05-27T02:00:00.000Z",
        candidates: [
          {
            id: "comms-compliance-obligation-grouped",
            kind: "compliance_obligation",
            target_kind: "obligation",
            target_id: "obligation-compliance-1",
            related_target_ids: [
              "obligation-compliance-1",
              "obligation-compliance-2",
            ],
            tenant_id: "tenant-1",
            tenant_name: "Auto General Services Pty Ltd",
            property_name: "2 compliance items",
            unit_label: null,
            recipient_email: "ap@autogeneral.example",
            recipient_phone: null,
            subject: "2 compliance items due",
            body: [
              "Hi Accounts Payable,",
              "",
              "We have multiple compliance items for your tenancies:",
              "- Auto General Site 1 Suite 1: Annual fire safety certificate due 18 Jun 2026.",
              "- Auto General Site 2 Suite 2: Public liability insurance due 19 Jun 2026.",
              "",
              "Please send through any documentation that demonstrates these are in place.",
            ].join("\n"),
            severity: "warning",
            due_at: "2026-06-18T00:00:00.000Z",
            detail: "2 items, earliest due 18 Jun 2026",
            generated_at: "2026-05-27T02:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route("**/api/v1/comms/queue/counts?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entity_id: "entity-1",
        total: 1,
        urgent: 0,
        by_kind: {
          arrears_reminder: 0,
          insurance_expiry: 0,
          lease_renewal: 0,
          inbound_email: 0,
          inbound_sms: 0,
          compliance_obligation: 1,
          rent_review: 0,
          tenant_lifecycle_stall: 0,
          maintenance_contractor_forward: 0,
          maintenance_tenant_forward: 0,
        },
        generated_at: "2026-05-27T02:00:00.000Z",
      }),
    });
  });

  await page.goto("/comms");

  const complianceCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Compliance reminder" }) })
    .first();
  await expect(complianceCard).toBeVisible();
  await expect(complianceCard.getByLabel("Subject")).toHaveValue(
    "2 compliance items due",
  );
  await expect(
    complianceCard.getByText("This draft covers 2 compliance items."),
  ).toBeVisible();
  await expect(
    complianceCard.getByRole("link", { name: "Open compliance work" }),
  ).toHaveAttribute("href", "/operations?tab=compliance");
  await expect(
    complianceCard.getByRole("link", { name: "Upload via Smart Intake" }),
  ).toHaveAttribute("href", "/intake");
  await expect(
    complianceCard.getByRole("button", { name: "Or attach a file manually" }),
  ).toHaveCount(0);
});

test("AI inbox vendor classification offers a contractor picker", async ({
  page,
}) => {
  // Override triage + promote to exercise the vendor_or_contractor path.
  // The default mockLeasiumApi returns maintenance_request; per-test
  // routes registered before goto win.
  await page.route("**/api/v1/ai/triage", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "vendor_or_contractor",
        confidence: 0.7,
        summary: "New locksmith introducing themselves to the panel.",
        suggested_action: "Add Sam's Locksmiths to the directory.",
        suggested_target_kind: "smart_intake",
        suggested_target_href: "/contractors",
        suggested_property: null,
        suggested_tenant: null,
        suggested_lease: null,
        suggested_contractor: null,
        key_facts: [{ label: "Trade", value: "Locksmith" }],
        warnings: [],
        guardrails: [],
        response_id: "resp_vendor_smoke",
      }),
    });
  });

  await page.route("**/api/v1/ai/triage/promote", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        target_kind: "contractor",
        target_id: "33333333-3333-3333-3333-333333333333",
        target_href: "/contractors",
        target_label: "Sam Lock",
      }),
    });
  });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "Try sample" }).click();
  await page.getByRole("button", { name: /Classify/ }).click();

  const promotePanel = page.getByTestId("promote-panel");
  await expect(promotePanel).toBeVisible();
  await expect(
    promotePanel.getByText(/Add to contractor directory/i),
  ).toBeVisible();

  // The contractor picker is shown for vendor_or_contractor (with the
  // "Create new contractor" empty option), not the property/tenant
  // dropdowns.
  await expect(promotePanel.getByLabel("Promote contractor")).toBeVisible();
  await expect(promotePanel.getByLabel("Promote contractor")).toHaveValue("");

  await promotePanel.getByRole("button", { name: /Promote to draft/ }).click();
  await expect(page).toHaveURL(/\/contractors/);
});

test("AI inbox tenant contact classification applies selected fields", async ({
  page,
}) => {
  await page.route("**/api/v1/ai/triage", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "tenant_contact",
        confidence: 0.84,
        summary: "Tenant wants billing contact details updated.",
        suggested_action: "Review the proposed tenant contact changes.",
        suggested_target_kind: "tenant",
        suggested_target_href: "/tenants",
        suggested_property: null,
        suggested_tenant: {
          id: "22222222-2222-2222-2222-222222222222",
          label: "Acme Bakery",
        },
        suggested_lease: null,
        suggested_contractor: null,
        key_facts: [
          { label: "New email", value: "accounts@acmebakery.example" },
        ],
        warnings: [],
        guardrails: [],
        response_id: "resp_tenant_contact_smoke",
      }),
    });
  });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "Try sample" }).click();
  await page.getByRole("button", { name: /Classify/ }).click();

  const promotePanel = page.getByTestId("promote-panel");
  await expect(promotePanel).toBeVisible();
  await expect(
    promotePanel.getByText(/Update tenant contact details/i),
  ).toBeVisible();
  await expect(promotePanel.getByLabel("Promote tenant")).toHaveValue(
    "22222222-2222-2222-2222-222222222222",
  );

  await promotePanel.getByRole("button", { name: "Prepare updates" }).click();
  await expect(
    promotePanel.getByText("Proposed: accounts@acmebakery.example"),
  ).toBeVisible();
  await expect(promotePanel.getByText("Proposed: 0411 222 333")).toBeVisible();

  await promotePanel
    .getByRole("button", { name: "Apply selected fields" })
    .click();
  await expect(page).toHaveURL(
    /\/tenants\/22222222-2222-2222-2222-222222222222/,
  );
});

test("tenants saved views capture and re-apply filter combos", async ({
  page,
}) => {
  await page.goto("/tenants");

  // Pick a non-default filter so the saved view has something to capture.
  await page.getByRole("button", { name: "Submitted" }).click();

  // Open the saved-views menu, name it, save.
  const savedViewsTrigger = page
    .getByRole("button", { name: /^(Saved views|Custom view|No saved views)/ })
    .first();
  await expectTouchTarget(savedViewsTrigger);
  await savedViewsTrigger.click();
  const nameInput = page.getByLabel("Save current view as");
  await expect(nameInput).toBeEnabled();
  await expectTouchTarget(nameInput);
  await nameInput.fill("Submitted only");
  const saveCurrentView = page.getByRole("button", { name: /Save/ }).first();
  await expectTouchTarget(saveCurrentView);
  await saveCurrentView.click();

  // The chip should now reflect the saved view name.
  await expect(
    page.getByRole("button", { name: /^Submitted only/ }).first(),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /^Submitted only/ })
    .first()
    .click();
  const activeSavedViewButton = page
    .getByRole("button", { name: /^Submitted only$/ })
    .first();
  await expectTouchTarget(activeSavedViewButton);
  await expectTouchTarget(
    page.getByRole("button", { name: "Rename Submitted only" }),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: "Delete Submitted only" }),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: "Close saved views menu" }),
  );

  await page.getByRole("button", { name: "Rename Submitted only" }).click();
  const renameInput = page.getByLabel("Rename saved view");
  await expectTouchTarget(renameInput);
  await renameInput.fill("Submitted only");
  await renameInput.press("Enter");

  await page.getByRole("button", { name: "Delete Submitted only" }).click();
  await expect(
    page.getByRole("button", { name: "Close saved views menu" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Submitted only$/ }),
  ).toHaveCount(0);

  await nameInput.fill("Submitted only");
  await saveCurrentView.click();
  await expect(
    page.getByRole("button", { name: /^Submitted only/ }).first(),
  ).toBeVisible();

  // Switch to "All" — the chip should fall back to "Saved views" or
  // "No saved views" (no longer "Submitted only").
  await page.getByRole("button", { name: "All", exact: true }).first().click();

  // Reopen the menu and re-apply the saved view; filter pill should
  // highlight Submitted again.
  await page
    .getByRole("button", { name: /^(Saved views|Custom view)/ })
    .click();
  await expectTouchTarget(
    page.getByRole("button", { name: /^Submitted only$/ }).first(),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: "Rename Submitted only" }),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: "Delete Submitted only" }),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: "Close saved views menu" }),
  );
  await page.getByRole("button", { name: "Close saved views menu" }).click();
  await expect(
    page.getByRole("button", { name: /^Submitted only$/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /^(Saved views|Custom view)/ })
    .click();
  await page
    .getByRole("button", { name: /^Submitted only$/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Submitted", exact: true }),
  ).toBeVisible();
});

test("tenants table inline-edits contact email", async ({ page }) => {
  await page.goto("/tenants");

  // Find the first Add email / contact_email inline cell. The aria-label
  // is dynamic to the tenant name, so we match the "Contact email"
  // prefix.
  const editButton = page
    .getByRole("button", { name: /^Edit Contact email for / })
    .first();
  await editButton.click();

  const input = page.getByLabel(/^Contact email for /).first();
  await expect(input).toBeFocused();
  await input.fill("inline.edit@example.com");
  await input.press("Enter");

  // After save, the read-only inline-edit button reappears with the new value.
  await expect(
    page
      .getByRole("button", { name: /^Edit Contact email for / })
      .filter({ hasText: "inline.edit@example.com" })
      .first(),
  ).toBeVisible();
});

test("tenant list opens the quick-view detail drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tenants");

  await expect(page.locator("table").first()).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Onboarding command center" }),
  ).toBeVisible();
  const brightCafeCard = page
    .getByRole("button")
    .filter({ hasText: "Bright Cafe (Bright Cafe Pty Ltd)" })
    .first();
  await expect(brightCafeCard).toBeVisible();
  await expect(brightCafeCard).toContainText("mia@example.com");
  await expect(brightCafeCard).toContainText(/due/i);
  await brightCafeCard.click();

  const drawer = page.getByRole("dialog", {
    name: "Bright Cafe (Bright Cafe Pty Ltd)",
  });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Contact")).toBeVisible();
  await expect(drawer.getByText("mia@example.com")).toBeVisible();
  await expect(drawer.getByText("1 active lease")).toBeVisible();
  await expect(drawer.getByText("Latest onboarding")).toBeVisible();
  await expect(
    drawer.getByRole("link", { name: "Open full record" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("keyboard cheatsheet hides owner-statement shortcuts for self-managed accounts", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Show keyboard shortcuts" }).click();

  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(page.getByText("Open command search")).toBeVisible();
  await expect(page.getByText("Show this keyboard cheatsheet")).toBeVisible();
  await expect(page.getByText("Dashboard").last()).toBeVisible();
  await expect(page.getByText("Properties").last()).toBeVisible();
  await expect(page.getByText("Tenants").last()).toBeVisible();
  await expect(page.getByText("Comms queue")).toBeVisible();
  await expect(page.getByText("Owner statements")).toHaveCount(0);
  // The Go-to legend itself appears in the cheatsheet.
  await expect(page.getByText("Go to (press G, then…)")).toBeVisible();
  await page.mouse.click(300, 100);
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Open search" }).click();
  await page
    .getByRole("textbox", { name: "Command search" })
    .fill("owner statements");
  await expect(page.getByText("No matching action.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Owner statements/i }),
  ).toHaveCount(0);
});

test("keyboard shortcuts include owner statements for managing-agent accounts", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.goto("/");

  await page.getByRole("button", { name: "Show keyboard shortcuts" }).click();
  await expect(page.getByText("Owner statements")).toBeVisible();
  await page.mouse.click(300, 100);
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Open search" }).click();
  await page
    .getByRole("textbox", { name: "Command search" })
    .fill("owner statements");
  await expect(
    page.getByRole("link", { name: /Owner statements/i }),
  ).toBeVisible();
});

test("dashboard activity feed groups recent audit rows", async ({ page }) => {
  await page.goto("/");

  const activityPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Recent activity" }),
  });
  await expect(activityPanel).toBeVisible();
  await expect(
    activityPanel.getByText(
      "Approved invoice INV-1001 for May rent and outgoings.",
    ),
  ).toBeVisible();
  await expect(activityPanel.getByText("Today")).toBeVisible();
  await expect(activityPanel.getByText("Yesterday")).toBeVisible();
  await expect(
    activityPanel.getByRole("link", {
      name: /Approved INV-1001/,
    }),
  ).toBeVisible();
});

test("portfolio QA guides cleanup fixes and source trails", async ({
  page,
}) => {
  await page.goto("/portfolio-qa");

  await expect(
    page.getByRole("heading", { name: "Portfolio QA" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cleanup readiness report" }),
  ).toBeVisible();
  await expect(
    page.getByText("AI-assisted enrichment candidates"),
  ).toBeVisible();
  const enrichmentPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Cleanup readiness report" }),
  });
  const enrichmentDownloadPromise = page.waitForEvent("download");
  await enrichmentPanel
    .getByRole("button", { name: "Download queue CSV" })
    .click();
  const enrichmentDownload = await enrichmentDownloadPromise;
  expect(enrichmentDownload.suggestedFilename()).toBe(
    "portfolio-qa-enrichment-queue.csv",
  );
  const enrichmentDownloadPath = await enrichmentDownload.path();
  expect(enrichmentDownloadPath).not.toBeNull();
  const enrichmentCsv = await readFile(enrichmentDownloadPath!, "utf8");
  expect(enrichmentCsv).toContain("Eagle Street Office");
  expect(enrichmentCsv).toContain("Property");
  expect(enrichmentCsv).toContain("Owner Abn");
  expect(enrichmentCsv).toContain("high");
  expect(enrichmentCsv).toContain(
    "Review-only: accept sourced suggestions only after checking citations.",
  );
  await expect(page.getByText("Blocked follow-ups")).toBeVisible();
  await expect(page.getByText("Register cleanup still blocked")).toBeVisible();
  await expect(page.getByText("Final report")).toBeVisible();
  const readinessPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Cleanup readiness report" }),
  });
  await expect(
    readinessPanel
      .getByText("Eagle Street Office is missing owner ABN")
      .first(),
  ).toBeVisible();
  await expect(readinessPanel.getByText("Blocker drilldown")).toBeVisible();
  await expect(
    readinessPanel
      .locator("span")
      .filter({
        hasText:
          /^Bright Cafe \(Bright Cafe Pty Ltd\) \/ Queen Street Retail Centre$/,
      })
      .first(),
  ).toBeVisible();
  await expect(
    readinessPanel.getByText("Existing onboarding Sent").first(),
  ).toBeVisible();
  await expect(
    readinessPanel
      .getByText("Eagle Street Office is missing owner ABN")
      .first(),
  ).toBeVisible();
  await expect(
    readinessPanel.getByText("Missing Xero tax type").first(),
  ).toBeVisible();
  const cleanupReportDownloadPromise = page.waitForEvent("download");
  await readinessPanel
    .getByRole("button", { name: "Download report CSV" })
    .click();
  const cleanupReportDownload = await cleanupReportDownloadPromise;
  expect(cleanupReportDownload.suggestedFilename()).toBe(
    "portfolio-qa-cleanup-report.csv",
  );
  const cleanupReportPath = await cleanupReportDownload.path();
  expect(cleanupReportPath).not.toBeNull();
  const cleanupReportCsv = await readFile(cleanupReportPath!, "utf8");
  expect(cleanupReportCsv).toContain("Blocker drilldown");
  expect(cleanupReportCsv).toContain(
    "Bright Cafe (Bright Cafe Pty Ltd) / Queen Street Retail Centre",
  );
  expect(cleanupReportCsv).toContain("Existing onboarding sent");
  expect(cleanupReportCsv).toContain("Missing Xero tax type");

  const ownerPanel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Owner and billing guided fixes",
    }),
  });
  await ownerPanel.getByRole("button", { name: "Stage suggestions" }).click();
  await expect(
    ownerPanel.getByText("Review staged owner billing suggestions"),
  ).toBeVisible();
  await expect(ownerPanel.getByText("Eagle Street Office")).toBeVisible();
  await ownerPanel.getByLabel("Owner ABN").fill("33123456789");
  await ownerPanel
    .getByLabel("Invoice issuer")
    .fill("Eagle Street Trustee Pty Ltd");
  await ownerPanel.getByLabel("Billing contact").fill("Noah Accounts");
  await ownerPanel
    .getByLabel("Billing email")
    .fill("owners@eaglestreet.example");
  await ownerPanel.getByRole("button", { name: "Save fix" }).click();
  await expect(
    page.getByText("Eagle Street Office billing identity saved."),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Tenant contacts Clean invite details/ })
    .click();
  const contactPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Tenant contact enrichment" }),
  });
  await contactPanel.getByRole("button", { name: "Stage suggestions" }).click();
  await expect(
    contactPanel.getByText("Review staged tenant suggestions"),
  ).toBeVisible();
  await expect(contactPanel.getByText("Northwind Fitness")).toBeVisible();
  await contactPanel
    .getByLabel("Billing email")
    .fill("accounts@northwind.example");
  await contactPanel.getByRole("button", { name: "Save fix" }).click();
  await expect(
    contactPanel.getByText("Tenant contact data is complete"),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Onboarding prep Ready or blocked/ })
    .click();
  const onboardingPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Batch tenant onboarding prep" }),
  });
  await expect(
    onboardingPanel.getByText("Invite blocker review"),
  ).toBeVisible();
  await expect(onboardingPanel.getByText("Ready invites")).toBeVisible();
  await expect(onboardingPanel.getByText("Existing invites")).toBeVisible();
  await expect(onboardingPanel.getByText("Northwind Fitness")).toBeVisible();
  await page.getByRole("button", { name: "Select ready" }).click();
  await page.getByRole("button", { name: "Send selected invites" }).click();
  await expect(page.getByText("1 invite links created.")).toBeVisible();

  await page
    .getByRole("button", { name: /Billing drafts Prepare internal drafts/ })
    .click();
  const billingPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Billing draft generation" }),
  });
  await expect(
    billingPanel.getByText("Billing cleanup blockers"),
  ).toBeVisible();
  await expect(
    billingPanel.getByText("Billing readiness blockers"),
  ).toBeVisible();
  await expect(
    billingPanel.getByRole("link", { name: /Billing readiness blockers/ }),
  ).toHaveAttribute("href", "/billing-readiness");

  await page
    .getByRole("button", {
      name: /Source history Spreadsheet and intake trails/,
    })
    .click();
  await expect(
    page.getByText("Acme portfolio register.xlsx").first(),
  ).toBeVisible();
  await expect(page.getByText("Properties row 12").first()).toBeVisible();
  await page.getByPlaceholder("Search sources").fill("public enrichment");
  const sourcePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Source and apply history" }),
  });
  await expect(
    sourcePanel.getByText(/Bright Cafe .* public enrichment/),
  ).toBeVisible();
  await page.getByPlaceholder("Search sources").fill("purchase contract");
  await expect(
    sourcePanel.getByRole("link", { name: "Queen Street Retail Centre" }),
  ).toHaveAttribute("href", "/intake?entity_id=entity-1&review=intake-1");
});

test("operations workspace surfaces maintenance and arrears work", async ({
  page,
}) => {
  await page.goto("/operations");
  const arrearsPacketMutationPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== "GET" &&
      (url.pathname.includes("/api/v1/arrears") ||
        url.pathname.includes("/api/v1/comms/dispatch") ||
        url.pathname.includes("/api/v1/comms/dismiss") ||
        url.pathname.includes("/api/v1/xero") ||
        url.pathname.includes("/api/v1/basiq") ||
        url.pathname.includes("/api/v1/invoice-drafts"))
    ) {
      arrearsPacketMutationPaths.push(`${request.method()} ${url.pathname}`);
    }
  });

  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).toBeVisible();
  await expect(page.getByRole("button", { name: /Overdue/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Assign owner for Air conditioning fault" })
    .click();
  await page
    .getByLabel("Assignee for Air conditioning fault")
    .selectOption({ label: "Temba van Jaarsveld" });
  await page
    .getByRole("button", { exact: true, name: "Assign" })
    .first()
    .click();
  await expect(
    page.getByText("Assigned to Temba van Jaarsveld").first(),
  ).toBeVisible();
  await expect(page.getByText("Notification ready").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Send ready notices 1/ }),
  ).toBeVisible();
  const queueDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download queue CSV" }).click();
  const queueDownload = await queueDownloadPromise;
  expect(queueDownload.suggestedFilename()).toBe(
    "operations-work-queue-review.csv",
  );
  const queueDownloadPath = await queueDownload.path();
  expect(queueDownloadPath).not.toBeNull();
  const queueCsv = await readFile(queueDownloadPath!, "utf8");
  expect(queueCsv).toContain("Air conditioning fault");
  expect(queueCsv).toContain("Bright Cafe arrears");
  expect(queueCsv).toContain("Insurance certificate renewal");
  expect(queueCsv).toContain("Temba van Jaarsveld");
  expect(queueCsv).toContain("Notification ready");
  expect(queueCsv).toContain(
    "Local-only review export: downloading this file does not send SendGrid or Twilio messages, send tenant, owner, or provider email, dispatch providers, refresh providers, mutate provider history, generate billing drafts, perform Xero/Basiq writes, apply payment reconciliation, or update maintenance, arrears, onboarding, or assignment records.",
  );
  const tenantInsuranceReviewLink = page
    .locator("a")
    .filter({ hasText: "tenant-uploaded-insurance.txt" })
    .first();
  await expect(tenantInsuranceReviewLink).toHaveAttribute(
    "href",
    "/intake?entity_id=entity-1&review=intake-tenant-upload-insurance-1",
  );
  await expect(page.getByText("Notice inbox")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Air conditioning fault Ready/ }),
  ).toBeVisible();
  await expect(page.getByText("Reminder Today").first()).toBeVisible();
  await page.getByRole("button", { name: "Send notice" }).first().click();
  await expect(page.getByText("Email queued").first()).toBeVisible();
  await expect(page.getByText("Recent activity").first()).toBeVisible();
  await page.getByRole("button", { name: "Generate digest" }).click();
  await expect(page.getByText("Work digest generated")).toBeVisible();
  await expect(page.getByText("No messages sent")).toBeVisible();
  await page.getByText("Message preview").click();
  await expect(
    page.getByText("Leasium Daily Work digest: 4 items"),
  ).toBeVisible();
  await expect(page.getByText("- Air conditioning fault")).toBeVisible();
  await page.getByRole("button", { name: "Send digest" }).click();
  await expect(page.getByText("1 email queued")).toBeVisible();
  await expect(
    page.getByText("Digest email was queued by SendGrid."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log reminder" }).first().click();
  await expect(page.getByText("Reminder logged").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Show Temba van Jaarsveld work, 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Show assignment follow-ups, 0/ }),
  ).toBeVisible();
  await page.getByLabel("Queue assignee").selectOption("follow_up");
  await expect(page.getByText("No assignment follow-ups due")).toBeVisible();
  const queueMaintenanceLink = page.getByRole("link", {
    name: /Air conditioning fault.*Maintenance/,
  });
  await expect(queueMaintenanceLink).not.toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).not.toBeVisible();
  await page
    .getByLabel("Queue assignee")
    .selectOption({ label: "Temba van Jaarsveld" });
  await expect(queueMaintenanceLink).toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).not.toBeVisible();
  await page.getByLabel("Queue assignee").selectOption("unassigned");
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();
  await expect(queueMaintenanceLink).not.toBeVisible();
  await page.getByLabel("Queue assignee").selectOption("all");

  await page.getByRole("tab", { name: /Maintenance/ }).click();
  await expect(page.getByText("Cool Air Services")).toBeVisible();
  await expect(
    page.getByText("Assigned to Temba van Jaarsveld").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Status for Air conditioning fault" })
    .click();
  await page
    .getByLabel("Status for Air conditioning fault", { exact: true })
    .selectOption("triaged");
  await expect(page.getByText("Status changed to triaged")).toBeVisible();
  await expect(
    page.getByText("Air conditioning fault was previously awaiting approval."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Status changed to triaged")).not.toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Edit Status for Air conditioning fault" })
      .filter({ hasText: "Awaiting approval" }),
  ).toBeVisible();
  const completionReviewLink = page
    .getByRole("link", { name: "Review completion" })
    .first();
  await expect(completionReviewLink).toBeVisible();
  await page.getByRole("button", { name: "Detail" }).click();
  await expect(page.getByText("Approval", { exact: true })).toBeVisible();
  await expect(page.getByText("$640").first()).toBeVisible();
  await expect(
    page.getByText("Tenant submitted maintenance request."),
  ).toBeVisible();
  await page
    .getByLabel("Invoice draft for Air conditioning fault")
    .selectOption("invoice-draft-1");
  await page.getByRole("button", { name: "Link invoice" }).click();
  await expect(page.getByText("INV-1001").first()).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Approve" }).click();
  await expect(
    page
      .locator("dd")
      .filter({ hasText: /^approved$/ })
      .first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Arrears/ }).click();
  await expect(page.getByText("$8,800").first()).toBeVisible();
  await expect(page.getByText("raised").first()).toBeVisible();
  const arrearsPacket = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Arrears and credit control",
      }),
    })
    .locator("[data-testid='arrears-review-packet-arrears-1']");
  await expect(arrearsPacket).toBeVisible();
  await expect(
    arrearsPacket.getByText("Review dispute before reminder"),
  ).toBeVisible();
  await expect(arrearsPacket.getByText("Balance age")).toBeVisible();
  await expect(arrearsPacket.getByText("1-30 $8,800")).toBeVisible();
  await expect(
    arrearsPacket.getByText("Reminder", { exact: true }),
  ).toBeVisible();
  await expect(
    arrearsPacket.getByText("Dispute", { exact: true }),
  ).toBeVisible();
  await expect(
    arrearsPacket.getByText("raised", { exact: true }),
  ).toBeVisible();
  await expect(
    arrearsPacket.getByText("Escalation", { exact: true }),
  ).toBeVisible();
  await expect(
    arrearsPacket.getByText("Promise", { exact: true }),
  ).toBeVisible();
  await expect(
    arrearsPacket.getByText("Assignment", { exact: true }),
  ).toBeVisible();
  await expect(
    arrearsPacket.getByRole("link", { name: "Open tenant" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  await expect(
    arrearsPacket.getByRole("link", { name: "Open queue" }),
  ).toHaveAttribute("href", "/operations?tab=queue");
  await arrearsPacket.getByRole("button", { name: "Copy packet" }).click();
  await expect(
    arrearsPacket.getByText("Arrears review packet copied."),
  ).toBeVisible();

  const arrearsPacketDownloadPromise = page.waitForEvent("download");
  await arrearsPacket
    .getByRole("button", { name: "Download packet CSV" })
    .click();
  const arrearsPacketDownload = await arrearsPacketDownloadPromise;
  expect(arrearsPacketDownload.suggestedFilename()).toBe(
    "arrears-review-packet-arrears-1.csv",
  );
  const arrearsPacketPath = await arrearsPacketDownload.path();
  expect(arrearsPacketPath).not.toBeNull();
  const arrearsPacketCsv = await readFile(arrearsPacketPath!, "utf8");
  expect(arrearsPacketCsv).toContain("Bright Cafe");
  expect(arrearsPacketCsv).toContain("$8,800");
  expect(arrearsPacketCsv).toContain("Review dispute before reminder");
  expect(arrearsPacketCsv).toContain(
    "Review-only arrears packet: downloading or copying this file does not send email, SMS, tenant messages, owner messages, provider dispatch, Xero/Basiq writes, payment reconciliation, invoice updates, arrears status changes, reminder updates, escalation updates, or assignment updates.",
  );
  expect(arrearsPacketMutationPaths).toEqual([]);
  await page.getByRole("button", { name: "Escalate" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^queued$/ })
      .first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Maintenance/ }).click();
  await completionReviewLink.click();
  await expect(page).toHaveURL(/\/operations\/maintenance\/work-order-1/);
  await expect(page.getByText("Job completion handoff")).toBeVisible();
});

test("operations workspace keeps mobile rows compact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations");

  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  await expectTouchTarget(page.getByRole("tab", { name: /Queue/ }));
  await expectTouchTarget(page.getByRole("tab", { name: /Maintenance/ }));
  await expectTouchTarget(page.getByRole("tab", { name: /Arrears/ }));
  await expectTouchTarget(
    page.getByRole("button", { name: /Show all open work/ }),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: /Show unowned work/ }),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: /Show assignment follow-ups/ }),
  );
  await expectTouchTarget(page.getByRole("button", { name: /Show my work/ }));
  await expectTouchTarget(
    page.getByRole("link", { name: "Open tenants" }).first(),
  );
  await expectTouchTarget(page.getByRole("link", { name: "Review" }).first());

  const queueControls = page
    .locator("summary")
    .filter({ hasText: "Work controls" })
    .first();
  const airconAssignee = page
    .getByLabel("Work controls owner selector: Air conditioning fault")
    .first();
  await expect(queueControls).toBeVisible();
  await expect(queueControls).toContainText(
    "Unassigned - urgent / awaiting approval",
  );
  await expect(airconAssignee).not.toBeVisible();
  await queueControls.click();
  await expect(airconAssignee).toBeVisible();

  await page.getByRole("tab", { name: /Maintenance/ }).click();
  const workOrderActions = page
    .locator("summary")
    .filter({ hasText: "Work-order actions" })
    .first();
  await expect(workOrderActions).toBeVisible();
  await expect(workOrderActions).toContainText(
    "Unassigned - urgent - awaiting approval",
  );
  await expect(
    page.getByRole("link", { name: "Open completion review" }).first(),
  ).not.toBeVisible();
  await workOrderActions.click();
  await expect(
    page.getByRole("link", { name: "Open completion review" }).first(),
  ).toBeVisible();
  await expectTouchTarget(
    page.getByRole("link", { name: "Open completion review" }).first(),
  );
});

test("maintenance detail mobile billing actions keep 44px touch targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations/maintenance/work-order-1");

  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible();
  await expectTouchTarget(page.getByRole("link", { name: "Operations" }));
  await page
    .getByLabel("Linked maintenance invoice")
    .selectOption("invoice-draft-failed");
  await page.getByRole("button", { name: "Link" }).click();
  await expect(page.getByText("Invoice linked")).toBeVisible();
  await expect(page.getByText("Billing recovery path")).toBeVisible();
  await expectTouchTarget(
    page.getByRole("link", { name: "Recover in Billing" }),
  );
  await expectTouchTarget(
    page.getByRole("link", { name: "Preview", exact: true }),
  );
  await expectTouchTarget(page.getByRole("link", { name: "PDF" }));
});

test("notification center shows work notices and digest receipts", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open notifications" }).click();
  await expect(page).toHaveURL(/\/notifications$/);

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("Work notice center")).toBeVisible();
  await expect(page.getByText("Email actionable")).toBeVisible();
  await expect(page.getByText("SMS actionable")).toBeVisible();
  await expect(page.getByText("In-app read-only")).toBeVisible();
  await expect(
    page.getByText(
      "Email actions are available, but SendGrid is not fully configured.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "SMS actions are available, but Twilio is not fully configured.",
    ),
  ).toBeVisible();
  await page.getByText("Provider setup checks").click();
  await expect(page.getByText("Email / SendGrid sender")).toBeVisible();
  await expect(page.getByText("SMS / Twilio status callback")).toBeVisible();
  await expect(
    page.getByText(
      "https://api.leasium.test/api/v1/work-assignments/webhooks/sendgrid-events",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Air conditioning fault", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Bright Cafe arrears", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Attention 1/ }).click();
  await expect(
    page.getByText("Bright Cafe arrears", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Air conditioning fault", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: /^All 2$/ }).click();
  await expect(
    page.getByText("Air conditioning fault", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Email 2$/ }).click();
  await expect(
    page.getByText("Bright Cafe arrears", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Air conditioning fault", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Latest provider event").first()).toBeVisible();
  await expect(
    page.getByText("Provider Notification Attempted").first(),
  ).toBeVisible();
  await expect(page.getByText("Message preview").first()).toBeVisible();
  await page.getByText("Message preview").first().click();
  await expect(
    page.getByText("Leasium work assigned: Air conditioning fault"),
  ).toBeVisible();
  await expect(
    page.getByText("Maintenance has been assigned to you in Leasium.").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Retry the assignment email from this page."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry notice" }).click();
  await expect(
    page.getByText("Assignment notification email was queued.").first(),
  ).toBeVisible();
  await page.getByText("Message preview").nth(1).click();
  await expect(
    page.getByText("Leasium work assigned: Bright Cafe arrears"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send SMS" }).last().click();
  await expect(
    page.getByText("Twilio Messaging is not configured.").first(),
  ).toBeVisible();
  await page.getByText("Message preview").nth(2).click();
  await expect(
    page.getByText("Leasium: Maintenance assigned to Temba van Jaarsveld"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry SMS" })).toBeVisible();
  await expect(page.getByText("Digest history")).toBeVisible();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
  await expect(page.getByText("No messages sent").first()).toBeVisible();
  await page.getByText("Message preview").last().click();
  await expect(
    page.getByText("Leasium Daily Work digest: 4 items"),
  ).toBeVisible();
  await expect(page.getByText("Send digest from this page.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Needs send 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Preview only 1/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send digest" }).click();
  await expect(
    page.getByText("Digest email was queued by SendGrid."),
  ).toBeVisible();
  await expect(page.getByText("Email queued").first()).toBeVisible();
  await expect(
    page.getByText("Digest Delivery Attempted").first(),
  ).toBeVisible();
  await page.getByText("Receipt evidence").last().click();
  await expect(page.getByText("sg-digest-smoke-retry").first()).toBeVisible();
  await expect(
    page.getByText("Wait for the SendGrid delivery receipt."),
  ).toBeVisible();
  await page.getByRole("button", { name: /Sent 1/ }).click();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
  await page.getByRole("button", { name: /^Email 1$/ }).click();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
  await expect(page.getByText("3 unread")).toBeVisible();
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByText("0 unread")).toBeVisible();
  await expect(page.getByText(/Reviewed 21 May 2026/)).toBeVisible();
});

test("maintenance detail route shows quote evidence", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("maintenanceCopiedCorrespondenceCsv");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.localStorage.setItem(
            "maintenanceCopiedCorrespondenceCsv",
            text,
          );
        },
      },
    });
  });
  let commsCorrespondenceMutationRequests = 0;
  const reviewPacketMutationPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== "GET" &&
      (url.pathname.endsWith("/api/v1/comms/dispatch") ||
        url.pathname.endsWith("/api/v1/comms/dismiss"))
    ) {
      commsCorrespondenceMutationRequests += 1;
    }
    if (
      request.method() !== "GET" &&
      (url.pathname.includes(
        "/api/v1/maintenance/work-orders/work-order-1/contractor-",
      ) ||
        url.pathname.includes(
          "/api/v1/maintenance/work-orders/work-order-1/vendor-portal",
        ) ||
        url.pathname.includes("/api/v1/invoice-drafts/") ||
        url.pathname.includes("/api/v1/comms/dispatch") ||
        url.pathname.includes("/api/v1/comms/dismiss") ||
        url.pathname.includes("/api/v1/xero") ||
        url.pathname.includes("/api/v1/basiq"))
    ) {
      reviewPacketMutationPaths.push(`${request.method()} ${url.pathname}`);
    }
  });
  await page.goto("/operations/maintenance/work-order-1");

  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Quote documents" }),
  ).toBeVisible();
  await expect(page.getByText("shopfront-ac-photo.jpg")).toBeVisible();
  await expect(page.getByText("Edit work-order details")).toBeVisible();
  await expect(page.getByText("Latest update")).toBeVisible();
  await expect(page.getByText("External visibility")).toBeVisible();
  await expect(
    page.getByText("2 tenant-visible · 0 contractor-visible"),
  ).toBeVisible();
  await expect(page.getByText("Provider evidence").first()).toBeVisible();
  await expect(page.getByText("Closeout trail")).toBeVisible();
  await expect(page.getByText("Internal audit").first()).toBeVisible();
  // Channel evidence disclosure renders the normalized contractor channel
  // receipt (this work order's mock email_delivery is in a failed state).
  await page.getByText("Channel evidence").click();
  await expect(page.getByText("Contractor email").first()).toBeVisible();
  await expect(
    page.getByText("To service@coolair.example").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Template maintenance_contractor_update v1").first(),
  ).toBeVisible();
  const reviewPacket = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Review packet" }) });
  await expect(reviewPacket).toBeVisible();
  await expect(
    reviewPacket.getByText("Review and approve quote").first(),
  ).toBeVisible();
  await expect(reviewPacket.getByText("Quote evidence").first()).toBeVisible();
  await expect(reviewPacket.getByText(/\d+ linked/).first()).toBeVisible();
  await expect(reviewPacket.getByText("Invoice handoff").first()).toBeVisible();
  await expect(
    reviewPacket.getByText("No linked invoice").first(),
  ).toBeVisible();
  await expect(reviewPacket.getByText("Vendor portal").first()).toBeVisible();
  await expect(reviewPacket.getByText("Hidden").first()).toBeVisible();
  await expect(
    reviewPacket.getByRole("link", { name: "Open Comms" }),
  ).toHaveAttribute("href", "/comms");
  await expect(
    reviewPacket.getByRole("link", { name: "Open tenant" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  await reviewPacket.getByRole("button", { name: "Copy packet" }).click();
  await expect(
    reviewPacket.getByText("Maintenance review packet copied."),
  ).toBeVisible();

  const reviewPacketDownloadPromise = page.waitForEvent("download");
  await reviewPacket
    .getByRole("button", { name: "Download packet CSV" })
    .click();
  const reviewPacketDownload = await reviewPacketDownloadPromise;
  expect(reviewPacketDownload.suggestedFilename()).toBe(
    "maintenance-review-packet-work-order-1.csv",
  );
  const reviewPacketPath = await reviewPacketDownload.path();
  expect(reviewPacketPath).not.toBeNull();
  const reviewPacketCsv = await readFile(reviewPacketPath!, "utf8");
  expect(reviewPacketCsv).toContain("Air conditioning fault");
  expect(reviewPacketCsv).toContain("Review and approve quote");
  expect(reviewPacketCsv).toContain(
    "Review-only packet: downloading or copying this file does not send email, SMS, portal messages, provider dispatch, invoice updates, Xero/Basiq writes, payment reconciliation, document uploads, or maintenance mutations.",
  );
  expect(reviewPacketMutationPaths).toEqual([]);
  const workOrderCorrespondencePanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Correspondence" }) });
  await expect(workOrderCorrespondencePanel).toBeVisible();
  await expect(
    workOrderCorrespondencePanel.getByText("3 correspondence events"),
  ).toBeVisible();
  await expect(
    workOrderCorrespondencePanel.getByText("contractor forward email queued"),
  ).toBeVisible();
  await expect(
    workOrderCorrespondencePanel.getByText("tenant forward sms failed"),
  ).toBeVisible();
  await expect(
    workOrderCorrespondencePanel.getByText("SendGrid email"),
  ).toBeVisible();
  await expect(
    workOrderCorrespondencePanel.getByText("Twilio SMS"),
  ).toBeVisible();
  await expect(
    workOrderCorrespondencePanel.getByText("Internal"),
  ).toBeVisible();
  await expect(
    workOrderCorrespondencePanel.getByRole("link", {
      name: "Open Comms queue",
    }),
  ).toHaveAttribute("href", "/comms");
  await expectTouchTarget(
    workOrderCorrespondencePanel.getByRole("link", {
      name: "Open Comms queue",
    }),
  );
  await expect(
    workOrderCorrespondencePanel.getByRole("link", { name: "Open tenant" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  await expectTouchTarget(
    workOrderCorrespondencePanel.getByRole("link", { name: "Open tenant" }),
  );
  await expect(
    workOrderCorrespondencePanel.getByText(
      "Opening this panel does not send email",
    ),
  ).toBeVisible();
  const copyCorrespondenceCsv = workOrderCorrespondencePanel.getByRole(
    "button",
    { name: "Copy correspondence CSV" },
  );
  const downloadCorrespondenceCsv = workOrderCorrespondencePanel.getByRole(
    "button",
    { name: "Download correspondence CSV" },
  );
  await expect(copyCorrespondenceCsv).toBeVisible();
  await expect(copyCorrespondenceCsv).toBeEnabled();
  await expect(downloadCorrespondenceCsv).toBeVisible();
  await expect(downloadCorrespondenceCsv).toBeEnabled();
  await copyCorrespondenceCsv.click();
  await expect(
    workOrderCorrespondencePanel.getByText("Correspondence CSV copied."),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("maintenanceCopiedCorrespondenceCsv"),
      ),
    )
    .not.toBeNull();
  const copiedWorkOrderCorrespondenceCsv = await page.evaluate(() =>
    window.localStorage.getItem("maintenanceCopiedCorrespondenceCsv"),
  );
  const workOrderCorrespondenceDownloadPromise = page.waitForEvent("download");
  await downloadCorrespondenceCsv.click();
  const workOrderCorrespondenceDownload =
    await workOrderCorrespondenceDownloadPromise;
  expect(workOrderCorrespondenceDownload.suggestedFilename()).toBe(
    "maintenance-correspondence-work-order-1.csv",
  );
  const workOrderCorrespondencePath =
    await workOrderCorrespondenceDownload.path();
  expect(workOrderCorrespondencePath).not.toBeNull();
  const workOrderCorrespondenceCsv = await readFile(
    workOrderCorrespondencePath!,
    "utf8",
  );
  expect(copiedWorkOrderCorrespondenceCsv).toBe(workOrderCorrespondenceCsv);
  expect(workOrderCorrespondenceCsv).toContain(
    "maintenance_work_order:work-order-1",
  );
  expect(workOrderCorrespondenceCsv).toContain(
    "maintenance_contractor_forward",
  );
  expect(workOrderCorrespondenceCsv).toContain("maintenance_tenant_forward");
  expect(workOrderCorrespondenceCsv).toContain(
    '"\'=HYPERLINK(""https://example.invalid"",""Cool Air"")"',
  );
  expect(workOrderCorrespondenceCsv).toContain(
    "Read-only export: copying or downloading this file does not send SendGrid email, send Twilio SMS, dismiss candidates, upload evidence, write provider history, settle candidates, mutate the queue, refresh providers, or mutate maintenance records.",
  );
  expect(commsCorrespondenceMutationRequests).toBe(0);
  await page
    .getByRole("textbox", { name: "Operational note" })
    .fill(
      "Needs owner approval before work proceeds. Confirm tenant access after 9am.",
    );
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(
    page.getByRole("textbox", { name: "Operational note" }),
  ).toHaveValue(
    "Needs owner approval before work proceeds. Confirm tenant access after 9am.",
  );
  await expect(page.getByLabel("Quote document")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Attach quote" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Approve quote" }),
  ).toBeVisible();
  await expect(page.getByText("Job completion handoff")).toBeVisible();
  await expect(page.getByText("Approval still pending")).toBeVisible();
  await expect(page.getByText("Job completion not recorded")).toBeVisible();
  await expect(page.getByText("No invoice linked")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete job" }),
  ).toBeDisabled();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Email Failed #1$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Last provider attempt failed")).toBeVisible();
  await expect(page.getByText("Provider history").first()).toBeVisible();
  await expect(
    page.getByText("Template maintenance_contractor_update v1").first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Attempt Failed #1$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Receipt Failed #1$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Contractor update template")).toBeVisible();
  await page
    .getByLabel("Contractor update template")
    .selectOption("attendance_window");
  await expect(page.getByLabel("Email subject")).toHaveValue(
    "Attendance window request: Air conditioning fault",
  );
  await expect(
    page.getByRole("textbox", { name: "Contractor email message" }),
  ).toHaveValue(/Please confirm your first available attendance window/);
  await page.getByRole("button", { name: "Retry update" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Email Queued #2$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Receipt Queued$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Attempt Queued #2$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Receipt Queued #2$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByText(/Please confirm your first available attendance window/)
      .last(),
  ).toBeVisible();
  await expect(page.getByText("07 3000 1111", { exact: true })).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^SMS not sent$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Contractor SMS message" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Contractor SMS message" })
    .fill("Please text back your first available attendance window.");
  await page.getByRole("button", { name: "Send SMS" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^SMS Queued #1$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("SMS provider history")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^SMS attempt Queued #1$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^SMS receipt Queued #1$/ })
      .first(),
  ).toBeVisible();
  await page
    .getByLabel("Linked maintenance invoice")
    .selectOption("invoice-draft-failed");
  await page.getByRole("button", { name: "Link" }).click();
  await expect(page.getByText("Invoice linked")).toBeVisible();
  await expect(page.getByText("Invoice delivery ready")).toBeVisible();
  await expect(page.getByText("Payment Unpaid")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Delivery ready$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Billing handoff$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Recovery needed$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Xero provider returned validation error.").first(),
  ).toBeVisible();
  await expect(page.getByText("Billing recovery path")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Retry provider dispatch$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Recover in Billing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Preview", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "PDF" })).toBeVisible();
  await page.getByRole("button", { name: "Approve quote" }).click();
  await expect(page.getByText("Operations completion ready")).toBeVisible();
  await expect(page.getByText("Approval still pending")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Closeout note" })
    .fill("Contractor completed repairs and supplied final photo.");
  await page.getByLabel("Closeout photo").setInputFiles({
    name: "closeout-ac-photo.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("closeout image bytes"),
  });
  await page.getByRole("button", { name: "Complete job" }).click();
  await expect(page.getByText("Job complete")).toBeVisible();
  await expect(page.getByText("Job completion not recorded")).toHaveCount(0);
  await expect(page.getByText("Closeout recorded")).toBeVisible();
  await expect(
    page
      .getByText("Contractor completed repairs and supplied final photo.")
      .first(),
  ).toBeVisible();
  await expect(page.getByText("closeout-ac-photo.jpg").first()).toBeVisible();
  const closeoutPhotoLinks = page.getByRole("link", {
    name: "closeout-ac-photo.jpg",
  });
  await expect(closeoutPhotoLinks).toHaveCount(2);
  await expectTouchTarget(closeoutPhotoLinks.first());
  await expectTouchTarget(closeoutPhotoLinks.nth(1));
  await expect(page.getByText("Closeout history")).toBeVisible();
  await expect(page.getByText("1 closeout photo")).toBeVisible();
  await expect(page.getByText("Source evidence")).toBeVisible();
  await expect(page.getByText("Completion communications")).toBeVisible();
  await expect(page.getByText("Owner update ready")).toBeVisible();
  await expect(page.getByText("Contractor follow-up ready")).toBeVisible();
  await expect(page.getByText("Tenant update ready")).toBeVisible();
  await expect(page.getByText("Contractor closeout review")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Needs contractor review$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Tenant closeout review")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Needs tenant review$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Review this copy before sending anything outside Leasium."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Review-only; no owner, tenant, contractor, email, or portal message is sent from this panel.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy owner update" }).click();
  await expect(
    page.getByText("Owner update copied. No message sent."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy tenant update" }).click();
  await expect(
    page.getByText("Tenant update copied. No message sent."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy contractor follow-up" }).click();
  await expect(
    page.getByText("Contractor follow-up copied. No message sent."),
  ).toBeVisible();
  await expect(page.getByText("Owner completion review")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Needs owner review$/ })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Owner review note" })
    .fill("Owner reviewed completion copy before sending.");
  await page.getByRole("button", { name: "Mark owner reviewed" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Owner review recorded$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Owner reviewed completion copy before sending."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Tenant review note" })
    .fill("Tenant update reviewed for portal-safe wording.");
  await page.getByRole("button", { name: "Mark tenant reviewed" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Tenant review recorded$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Tenant update reviewed for portal-safe wording."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Contractor review note" })
    .fill("Contractor follow-up copy reviewed before sending.");
  await page.getByRole("button", { name: "Mark contractor reviewed" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Contractor review recorded$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Contractor follow-up copy reviewed before sending."),
  ).toBeVisible();
  const completionHandoff = page.locator("#job-completion-handoff");
  const completionPacketDownloadPromise = page.waitForEvent("download");
  await completionHandoff
    .getByRole("button", { name: "Download packet CSV" })
    .click();
  const completionPacketDownload = await completionPacketDownloadPromise;
  expect(completionPacketDownload.suggestedFilename()).toBe(
    "maintenance-completion-review-work-order-1.csv",
  );
  const completionPacketDownloadPath = await completionPacketDownload.path();
  expect(completionPacketDownloadPath).not.toBeNull();
  const completionPacketCsv = await readFile(
    completionPacketDownloadPath!,
    "utf8",
  );
  expect(completionPacketCsv).toContain("Air conditioning fault");
  expect(completionPacketCsv).toContain("Closeout evidence");
  expect(completionPacketCsv).toContain("1 closeout event");
  expect(completionPacketCsv).toContain("Owner review recorded");
  expect(completionPacketCsv).toContain("Tenant review recorded");
  expect(completionPacketCsv).toContain("Contractor review recorded");
  expect(completionPacketCsv).toContain("Forwarding draft");
  expect(completionPacketCsv).toContain("Billing handoff");
  expect(completionPacketCsv).toContain(
    "Review-only: no owner, tenant, contractor, email, SMS, provider dispatch, billing update, or portal message has been sent from this packet.",
  );
  await page.getByRole("button", { name: "Reopen job" }).click();
  await expect(page.getByText("Job reopened")).toBeVisible();
  await expect(page.getByText("Job completion not recorded")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill("Owner approved attendance tomorrow morning.");
  await page.getByLabel("Comment visibility").selectOption("tenant");
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(
    page.getByText("Owner approved attendance tomorrow morning.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Tenant visible").last()).toBeVisible();
  await expect(page.getByText("Forwarding drafts")).toBeVisible();
  await expect(page.getByText("Tenant to contractor")).toBeVisible();
  await expect(
    page.getByText(
      "Draft from latest tenant-visible activity for the contractor.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy contractor forward" }).click();
  await expect(
    page.getByText("Contractor forward copied. No message sent."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill("Contractor confirmed attendance tomorrow morning.");
  await page.getByLabel("Comment visibility").selectOption("contractor");
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(
    page.getByText("Contractor confirmed attendance tomorrow morning.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Draft from latest contractor-visible activity for the tenant.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy tenant forward" }).click();
  await expect(
    page.getByText("Tenant forward copied. No message sent."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Recover in Billing" }).click();
  await expect(page).toHaveURL(/\/billing-readiness\?/);
  await expect(page.getByText("Operations handoff")).toBeVisible();
  await expect(
    page.getByText("Maintenance: Air conditioning fault"),
  ).toBeVisible();
  await expectTouchTarget(
    page.getByRole("link", { name: /Maintenance: Air conditioning fault/ }),
  );
  await expect(
    page.getByRole("table").getByText("Maintenance-linked invoice"),
  ).toBeVisible();
  await expect(page.getByText("Contractor Cool Air Services")).toBeVisible();
  await expect(
    page.getByText(
      "Retry dispatch here, then return to the work order once the provider receipt clears.",
    ),
  ).toBeVisible();
  await expectTouchTarget(
    page.getByRole("link", { name: "Return to work order" }),
  );
  await expect(
    page.getByRole("button", { name: "Retry dispatch" }),
  ).toBeVisible();
});

test("maintenance detail AI classification suggests and applies a contractor", async ({
  page,
}) => {
  await page.goto("/operations/maintenance/work-order-1");

  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible();
  await expect(page.getByText("AI classification")).toBeVisible();
  await expect(
    page.getByText("Run the AI categoriser to classify this work order"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Classify with AI" }).click();

  await expect(page.getByText(/hvac.*82%/i)).toBeVisible();
  await expect(page.getByText("Same-day")).toBeVisible();
  await expect(
    page.getByText(
      "HVAC issue affecting tenant trading; dispatch a preferred HVAC contractor.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Suggested contractor")).toBeVisible();
  await expect(page.getByText("Brisbane HVAC Response")).toBeVisible();
  await expect(page.getByText("hvac@contractors.example")).toBeVisible();
  await expect(
    page.getByText("Confirm rooftop access with tenant."),
  ).toBeVisible();
  await expect(page.getByText("AI never dispatches anything")).toBeVisible();

  await page.getByRole("button", { name: "Apply to contractor" }).click();
  await expect(page.getByText("Applied")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply to contractor" }),
  ).toHaveCount(0);
});

test("spreadsheet intake review supports bulk approval controls", async ({
  page,
}) => {
  await page.goto("/intake/spreadsheet");

  await expect(
    page.getByRole("heading", { name: "Spreadsheet Intake" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review workbook" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Download template" }),
  ).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download template" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("leasium-migration-template.xlsx");

  await page.locator('input[type="file"]').setInputFiles({
    name: "portfolio-import.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("mock workbook"),
  });

  await expect(
    page.getByRole("heading", { name: "portfolio-import.xlsx" }),
  ).toBeVisible();
  await expect(page.getByText("Approve recommended")).toBeVisible();
  await expect(page.getByText("Ignore all")).toBeVisible();
  await expect(page.getByText("Needs review")).toBeVisible();
  await expect(page.getByText("Street address")).toBeVisible();
  await expect(page.getByText("Owner ABN")).toBeVisible();
  await expect(
    page.getByRole("table").getByText("Unit label is missing."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Ignore all" }).click();
  await expect(
    page.getByRole("button", { name: "Apply approved" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Approve recommended" }).click();
  await expect(
    page.getByRole("button", { name: "Apply approved" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply approved" }).click();
  await expect(page.getByText("Apply complete")).toBeVisible();
  await expect(page.getByText("1 properties")).toBeVisible();
});

test("tenant workspace supports search and the add tenant form", async ({
  page,
}) => {
  await page.goto("/tenants");

  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Bright Cafe (Bright Cafe Pty Ltd)",
    }),
  ).toBeVisible();

  await page.getByPlaceholder("Search tenants").fill("northwind");
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Northwind Fitness (Northwind Fitness Pty Ltd)",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Bright Cafe (Bright Cafe Pty Ltd)",
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Send invite" }).first().click();
  await expect(page.getByLabel("Tenant name")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Contact email" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Property/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Unit/ })).toBeVisible();
});

test("tenant send invite adapts unit picker before creating records", async ({
  page,
}) => {
  let createdUnitPayload: unknown = null;
  let portalInviteRequested = false;

  await page.route("**/api/v1/tenancy-units", async (route) => {
    if (route.request().method() === "POST") {
      createdUnitPayload = route.request().postDataJSON();
    }
    await route.fallback();
  });
  await page.route(
    "**/api/v1/tenant-onboarding/*/send-portal-invite",
    async (route) => {
      if (route.request().method() === "POST") {
        portalInviteRequested = true;
      }
      await route.fallback();
    },
  );

  await page.goto("/tenants");
  await page.getByRole("button", { name: "Send invite" }).first().click();

  await page
    .getByRole("combobox", { name: /^Property/ })
    .selectOption("property-1");
  await expect(page.getByText("Shop 3")).toBeVisible();

  await page
    .getByRole("combobox", { name: /^Property/ })
    .selectOption("property-3");
  await expect(page.getByText("No sub-units on this property")).toBeVisible();
  await expect(page.getByText("Main premises")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Unit/ })).toHaveCount(0);

  await page.getByLabel("Tenant name").fill("New Studio Pty Ltd");
  await page
    .getByRole("textbox", { name: "Contact email" })
    .fill("newstudio@example.com");
  await page.getByRole("button", { name: "Send invite" }).last().click();

  await expect(page.getByLabel("Tenant name")).toHaveCount(0);
  expect(createdUnitPayload).toMatchObject({
    property_id: "property-3",
    unit_label: "Main premises",
  });
  expect(portalInviteRequested).toBe(true);
});

test("tenant detail delete soft-deletes and returns to tenant list", async ({
  page,
}) => {
  let deletedTenantPath = "";
  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Delete Bright Cafe");
    expect(dialog.message()).toContain("1 active lease");
    await dialog.accept();
  });
  await page.route("**/api/v1/tenants/tenant-1", async (route) => {
    if (route.request().method() === "DELETE") {
      deletedTenantPath = new URL(route.request().url()).pathname;
    }
    await route.fallback();
  });

  await page.goto("/tenants/tenant-1");
  await page.getByRole("button", { name: "Delete tenant" }).click();

  await expect(page).toHaveURL(/\/tenants$/);
  expect(deletedTenantPath).toBe("/api/v1/tenants/tenant-1");
  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible();
});

test("tenant detail hides business identity fields for residential leases", async ({
  page,
}) => {
  await page.route("**/api/v1/tenants/tenant-1/detail", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tenant: {
          id: "tenant-1",
          entity_id: "entity-1",
          legal_name: "Bright Cafe Pty Ltd",
          trading_name: "Bright Cafe",
          abn: "34123456789",
          contact_name: "Mia Hart",
          contact_email: "mia@example.com",
          contact_phone: "0400 111 222",
          billing_email: "accounts@bright.example",
          notes: "Prefers email follow-up.",
          metadata: {},
          created_at: "2026-05-01T00:00:00.000Z",
          deleted_at: null,
        },
        leases: [
          {
            lease_id: "lease-1",
            status: "active",
            property_id: "property-residential-1",
            property_name: "River Studio",
            property_address: "4 River Street, Brisbane City, QLD, 4000",
            property_type: "residential",
            tenancy_unit_id: "unit-1",
            unit_label: "Apartment 4",
            commencement_date: "2025-07-01",
            expiry_date: "2028-06-30",
            annual_rent_cents: 4200000,
            rent_frequency: "monthly",
            outgoings_recoverable: false,
            next_review_date: null,
          },
        ],
        activity: [],
        reviewed_changes: [],
      }),
    });
  });

  await page.goto("/tenants/tenant-1");
  await expect(
    page.getByRole("heading", { name: /Bright Cafe/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit profile" }).click();

  await expect(
    page.getByRole("heading", { name: "Edit tenant profile" }),
  ).toBeVisible();
  await expect(page.getByLabel("Legal name")).toBeVisible();
  await expect(page.getByLabel("Trading as")).toHaveCount(0);
  await expect(page.getByLabel("ABN")).toHaveCount(0);
});

test("property workspace shows the evidence source trail", async ({ page }) => {
  await page.goto("/properties?entity_id=entity-1&property_id=property-1");

  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/property_id=property-1/);
  await expect(
    page.getByAltText("Queen Street Retail Centre primary image"),
  ).toBeVisible();
  await expect(
    page.getByAltText("Queen Street Retail Centre primary image"),
  ).toHaveAttribute("src", /.+/);
  await page.getByRole("button", { name: "Find property images" }).click();
  await expect(page.getByText("Queen Street awning frontage")).toBeVisible();
  await expect(
    page.getByTestId("property-image-candidate-preview").first(),
  ).toBeVisible();
  await expect(page.getByText("88% confidence").first()).toBeVisible();
  await page.getByRole("button", { name: "Apply image" }).first().click();
  await expect(page.getByText("Queen Street awning frontage")).toBeVisible();
  await expect(page.getByTestId("selected-property-image")).toHaveAttribute(
    "src",
    /.+/,
  );
  await expect(page.getByTestId("selected-property-image")).toHaveClass(
    /object-cover/,
  );
  const propertyTable = page.getByRole("table").first();
  await expect(
    propertyTable.getByRole("row", { name: /Queen Street Warehouse/ }),
  ).toBeVisible();
  await expect(
    propertyTable.getByRole("row", { name: /Eagle Street Office/ }),
  ).toBeVisible();

  await page
    .getByRole("row", { name: /Queen Street Warehouse/ })
    .getByRole("button", {
      name: "Filter by ownership tag Queen Street Property Trust",
    })
    .click();
  await expect(page).toHaveURL(
    /owner_tag=queen(?:\+|%20)street(?:\+|%20)property(?:\+|%20)trust/,
  );
  await expect(page).toHaveURL(/property_id=property-1/);
  await expect(
    page.getByText("2 properties tagged Queen Street Property Trust"),
  ).toBeVisible();
  await expect(page.getByText("Ownership tag", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Showing properties with this ownership tag."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear ownership tag filter" }),
  ).toBeVisible();
  const filteredPropertyTable = page.getByRole("table").first();
  await expect(
    filteredPropertyTable.getByRole("row", {
      name: /Queen Street Retail Centre/,
    }),
  ).toBeVisible();
  await expect(
    filteredPropertyTable.getByRole("row", { name: /Queen Street Warehouse/ }),
  ).toBeVisible();
  await expect(
    filteredPropertyTable.getByRole("row", { name: /Eagle Street Office/ }),
  ).toHaveCount(0);
  await expect(
    filteredPropertyTable.getByText("Queen Street Property Trust").first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Documents/ }).click();

  await expect(
    page.getByRole("heading", { name: "Evidence drawer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Intake intake-1/ }),
  ).toHaveAttribute("href", "/intake?entity_id=entity-1&review=intake-1");
  await expect(page.getByText("Purchase contract").first()).toBeVisible();
  await expect(page.getByText("Street address").first()).toBeVisible();
  await expect(page.getByText("12 Queen St").first()).toBeVisible();
  await expect(page.getByText("12 Queen Street").first()).toBeVisible();
  await expect(page.getByText("Citation stored for Owner ABN")).toBeVisible();
});

test("tenant detail shows portal access recovery actions", async ({ page }) => {
  await page.goto("/tenants/tenant-1");

  await expect(
    page.getByRole("heading", { name: /Bright Cafe/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Portal access" }),
  ).toBeVisible();
  await expect(page.getByText("Invite another portal login")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invite" })).toBeVisible();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Portal invite sent.")).toBeVisible();
  await expect(page.getByText("tenant-subject-one")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Source history" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant onboarding applied")).toBeVisible();
  await expect(page.getByText("Billing email").first()).toBeVisible();
  await expect(page.getByText("accounts@bright.example").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Insurance" })).toBeVisible();
  await expect(page.getByText(/Confirmed until 30 .* 2027/)).toBeVisible();
  await expect(page.getByText("Source: Smart Intake")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Smart Intake review" }),
  ).toHaveAttribute(
    "href",
    "/intake?entity_id=entity-1&review=intake-insurance-1",
  );
  await expect(
    page.getByRole("heading", { name: "Correspondence" }),
  ).toBeVisible();
  await expect(page.getByText("Inbound email")).toBeVisible();
  await expect(page.getByText("Broken tap")).toBeVisible();
  await expect(
    page.getByText("Tenant reports a leaking bathroom tap."),
  ).toBeVisible();
  await expect(page.getByText("Dispatch").first()).toBeVisible();
  await expect(page.getByText("comms draft email queued")).toBeVisible();
  const dispatchCorrespondenceEvent = page
    .getByTestId("correspondence-event")
    .filter({ hasText: "comms draft email queued" });
  await expect(
    dispatchCorrespondenceEvent.getByRole("link", {
      name: "Open arrears case",
    }),
  ).toHaveAttribute("href", "/operations?tab=arrears");
  const maintenanceCorrespondenceEvent = page
    .getByTestId("correspondence-event")
    .filter({ hasText: "contractor note copied" });
  await expect(
    maintenanceCorrespondenceEvent.getByRole("link", {
      name: "Open work order",
    }),
  ).toHaveAttribute("href", "/operations/maintenance/work%2Forder%3F1");
  await expect(
    page.getByText("Opening it does not send email, send SMS"),
  ).toBeVisible();
  const correspondenceDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download correspondence CSV" })
    .click();
  const correspondenceDownload = await correspondenceDownloadPromise;
  expect(correspondenceDownload.suggestedFilename()).toBe(
    "tenant-correspondence-bright-cafe.csv",
  );
  const correspondenceDownloadPath = await correspondenceDownload.path();
  expect(correspondenceDownloadPath).not.toBeNull();
  const correspondenceCsv = await readFile(correspondenceDownloadPath!, "utf8");
  expect(correspondenceCsv).toContain("Tenant correspondence");
  expect(correspondenceCsv).toContain("Inbound email");
  expect(correspondenceCsv).toContain("Broken tap");
  expect(correspondenceCsv).toContain("comms draft email queued");
  expect(correspondenceCsv).toContain("arrears_case:arrears-1");
  expect(correspondenceCsv).toContain("inbound_message:inbound-message-1");
  expect(correspondenceCsv).toContain(
    '"\'=HYPERLINK(""https://example.invalid"",""Mia"")"',
  );
  expect(correspondenceCsv).toContain(
    "Review-only export: copying or downloading this file does not send email or SMS",
  );
  await expect(page.getByText("Applied ABN")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Preview portal" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Preview portal" }).click();
  await expect(page).toHaveURL(
    /\/tenants\/tenant-1\/portal-preview\/onboarding-1/,
  );
  await expect(
    page.getByRole("heading", { name: "Tenant portal preview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Operator preview", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/No tenant portal account is created/),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByText("INV-1001")).toBeVisible();
  await expect(page.getByText("Contact change request")).toBeVisible();
  await expect(page.getByText("new.accounts@bright.example")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toHaveCount(0);
  const previewDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download preview CSV" }).click();
  const previewDownload = await previewDownloadPromise;
  expect(previewDownload.suggestedFilename()).toBe(
    "tenant-portal-preview-bright-cafe.csv",
  );
  const previewDownloadPath = await previewDownload.path();
  expect(previewDownloadPath).not.toBeNull();
  const previewCsv = await readFile(previewDownloadPath!, "utf8");
  expect(previewCsv).toContain("Operator preview");
  expect(previewCsv).toContain("No tenant portal account is created");
  expect(previewCsv).toContain("INV-1001");
  expect(previewCsv).toContain("Contact change request");
  expect(previewCsv).toContain("new.accounts@bright.example");
  expect(previewCsv).toContain(
    "Review-only export: downloading this file does not create tenant portal accounts, send portal invites, submit tenant details, apply or dismiss contact changes, send email or SMS, upload or delete documents, fetch document bytes, write Xero data, dispatch providers, refresh providers, or mutate provider history.",
  );
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Back to tenant" }).first().click();
  await expect(page).toHaveURL(/\/tenants\/tenant-1$/);

  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(
    page.getByText("Recovery receipt: revoked by staff"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByText("Recovery receipt: restored by staff"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlink" })).toBeVisible();

  await page.getByRole("button", { name: "Unlink" }).click();
  await expect(page.getByRole("button", { name: "Fresh link" })).toBeVisible();

  await page.getByRole("button", { name: "Fresh link" }).click();
  await expect(page.getByText("Fresh portal link copied.")).toBeVisible();
});

test("tenant detail keeps provider detail in one responsive surface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tenants/tenant-1");

  await expect(
    page.getByRole("heading", { name: /Bright Cafe/ }),
  ).toBeVisible();
  const providerDetail = page.getByTestId("provider-detail");
  const providerSummary = providerDetail
    .locator("summary")
    .filter({ hasText: "Provider detail" });
  await expect(providerDetail).toBeVisible();
  await expect(page.getByTestId("provider-detail")).toHaveCount(1);
  await expectTouchTarget(providerSummary);
  const remindersLabel = providerDetail
    .locator("dt")
    .filter({ hasText: /^Reminders$/ });
  await expect(remindersLabel).toHaveCount(1);
  await expect(remindersLabel).not.toBeVisible();
  await providerSummary.click();
  await expect(remindersLabel).toBeVisible();
  await expect(providerDetail.getByText("Last sent")).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 844 });
  const desktopProviderDetail = page.getByTestId("provider-detail");
  await expect(desktopProviderDetail).toBeVisible();
  await expect(desktopProviderDetail).toHaveCount(1);
  await expect(providerSummary).toBeHidden();
  await expect(
    desktopProviderDetail.locator("dt").filter({ hasText: /^Reminders$/ }),
  ).toBeVisible();
  await expect(
    desktopProviderDetail.locator("dt").filter({ hasText: /^Last sent$/ }),
  ).toBeVisible();
});

test("smart intake shows tenant lease upload match recommendation", async ({
  page,
}) => {
  await page.goto("/intake");

  await page.getByRole("button", { name: "Review" }).first().click();

  await expect(
    page.getByRole("heading", { name: "Review document" }),
  ).toBeVisible();
  await expect(page.getByText("Lease upload match")).toBeVisible();
  await expect(page.getByText("Matched to scoped lease")).toBeVisible();
  await expect(page.getByText("3 matched fields")).toBeVisible();
  await expect(
    page.getByText("No lease status or register data"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Accept match" }).click();
  await expect(page.getByText("Lease match accepted.")).toBeVisible();
  await expect(page.getByText("Applied").first()).toBeVisible();
});

test("smart intake labels inbound email attachments in review queue", async ({
  page,
}) => {
  await page.goto("/intake");

  await page.getByLabel("Review filter").selectOption("tenant_portal");
  const tenantInsuranceCard = page.getByTestId(
    "review-intake-intake-tenant-upload-insurance-1",
  );
  await expect(
    tenantInsuranceCard.getByText("Tenant portal upload"),
  ).toBeVisible();
  await expect(
    tenantInsuranceCard.getByText("Tenant-uploaded insurance review"),
  ).toBeVisible();
  const smartIntakeDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download queue CSV" }).click();
  const smartIntakeDownload = await smartIntakeDownloadPromise;
  expect(smartIntakeDownload.suggestedFilename()).toBe(
    "smart-intake-review-queue-tenant_portal.csv",
  );
  const smartIntakeDownloadPath = await smartIntakeDownload.path();
  expect(smartIntakeDownloadPath).not.toBeNull();
  const smartIntakeCsv = await readFile(smartIntakeDownloadPath!, "utf8");
  expect(smartIntakeCsv).toContain("tenant-uploaded-insurance.txt");
  expect(smartIntakeCsv).toContain("Tenant portal upload");
  expect(smartIntakeCsv).not.toContain("inbound-insurance-certificate.txt");

  const inboundCard = page.getByTestId(
    "review-intake-intake-inbound-email-attachment-1",
  );
  await expect(inboundCard).toBeHidden();

  await page
    .getByLabel("Review filter")
    .selectOption("inbound_email_attachment");
  await expect(tenantInsuranceCard).toBeHidden();
  await expect(inboundCard.getByText("Inbound email attachment")).toBeVisible();
  await expect(
    inboundCard.getByText("Subject: Insurance certificate"),
  ).toBeVisible();
  await expect(
    inboundCard.getByText("From broker@inbound.example"),
  ).toBeVisible();

  await inboundCard.getByRole("button", { name: "Review" }).click();

  await expect(
    page.getByRole("heading", { name: "Review document" }),
  ).toBeVisible();
  await expect(
    page.getByText("inbound-insurance-certificate.txt").nth(1),
  ).toBeVisible();
  await expect(page.getByText("Policy dates")).toBeVisible();
  await expect(page.locator("textarea").first()).toHaveValue(
    "Inbound insurance certificate expires 2027-04-30.",
  );
  await expect(
    page.getByText(
      "No tenant data, lease data, provider action, or payment record is changed",
    ),
  ).toBeVisible();
});

test("smart intake applies inspection findings into work orders", async ({
  page,
}) => {
  const forbiddenProviderRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.includes("/contractor-delivery/send-email") ||
      url.includes("/contractor-delivery/send-sms") ||
      url.includes("/assignment-notification/send-email") ||
      url.includes("/assignment-notification/send-sms")
    ) {
      forbiddenProviderRequests.push(`${request.method()} ${url}`);
    }
  });

  await page.goto("/intake");

  await page.getByLabel("Review filter").selectOption("inspection_report");
  const inspectionCard = page.getByTestId("review-intake-intake-inspection-1");
  await expect(
    inspectionCard.getByText("inspection report", { exact: true }),
  ).toBeVisible();
  await expect(
    inspectionCard.getByText(
      "Inspection report with two maintenance findings ready for review.",
    ),
  ).toBeVisible();

  const smartIntakeDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download queue CSV" }).click();
  const smartIntakeDownload = await smartIntakeDownloadPromise;
  expect(smartIntakeDownload.suggestedFilename()).toBe(
    "smart-intake-review-queue-inspection_report.csv",
  );
  const smartIntakeDownloadPath = await smartIntakeDownload.path();
  expect(smartIntakeDownloadPath).not.toBeNull();
  const smartIntakeCsv = await readFile(smartIntakeDownloadPath!, "utf8");
  expect(smartIntakeCsv).toContain("queen-street-inspection.txt");
  expect(smartIntakeCsv).toContain("inspection report");

  await inspectionCard.getByRole("button", { name: "Review" }).click();

  await expect(
    page.getByRole("heading", { name: "Review document" }),
  ).toBeVisible();
  await expect(
    page.getByText("Work order drafts", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[value="Repair leaking tap"]')).toBeVisible();
  await expect(
    page.locator('input[value="Kitchen mixer is leaking at the base."]'),
  ).toBeVisible();
  await expect(page.locator('input[value="Kitchen"]')).toBeVisible();
  await expect(page.locator('input[value="plumbing"]')).toBeVisible();
  await expect(page.locator('input[value="high"]')).toBeVisible();
  await expect(page.locator('input[value="Inspection item 4"]')).toBeVisible();
  await expect(
    page.getByText("Create 2 requested work order drafts"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Apply reviewed items" }).click();
  await expect(page.getByText("Document workflow applied.")).toBeVisible();
  await expect(
    page.getByText("Created 2 requested work orders."),
  ).toBeVisible();
  await expect(page.getByText("Created work orders")).toBeVisible();
  await expect(
    page.getByText("No contractor email, SMS, assignment notification"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Operations" }),
  ).toHaveAttribute("href", "/operations?tab=maintenance");
  await page.getByRole("link", { name: "Open Operations" }).click();
  await expect(page).toHaveURL(/\/operations\?tab=maintenance/);
  await expect(page.getByText("Repair leaking tap").first()).toBeVisible();
  expect(forbiddenProviderRequests).toEqual([]);
});

test("smart intake deep link selects the review entity", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.entity_id", "entity-2");
  });

  await page.goto(
    "/intake?entity_id=entity-1&review=intake-tenant-upload-insurance-1",
  );

  await expect(page.getByLabel("Entity")).toHaveValue("entity-1");
  await expect(
    page.getByRole("heading", { name: "Review document" }),
  ).toBeVisible();
  await expect(
    page.getByText("tenant-uploaded-insurance.txt").nth(1),
  ).toBeVisible();
  await expect(
    page.getByText("Tenant portal upload", { exact: true }),
  ).toHaveCount(2);
});

test("smart intake explains active DocuSign conflict before accepting lease match", async ({
  page,
}) => {
  await page.goto("/intake");

  await page.getByRole("button", { name: "Review" }).first().click();
  await expect(page.getByText("Lease upload match")).toBeVisible();

  await page.getByRole("button", { name: "Accept match" }).click();
  await expect(
    page.getByText(
      "Resolve the active DocuSign envelope before accepting a tenant-uploaded lease.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Lease match accepted.")).toBeHidden();
});

test("tenant detail sends lease pack after onboarding approval", async ({
  page,
}) => {
  type SmokeOnboardingRow = Record<string, unknown> & {
    delivery_data: Record<string, unknown>;
    review_data: Record<string, unknown>;
    status: string;
  };
  const submittedAt = "2026-05-19T09:10:00.000Z";
  let onboardingRow: SmokeOnboardingRow = {
    id: "onboarding-1",
    entity_id: "entity-1",
    lease_id: "lease-1",
    tenant_id: "tenant-1",
    token: "tenant-token-1",
    status: "submitted",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    last_sent_at: "2026-05-18T09:30:00.000Z",
    resent_at: null,
    cancel_reason: null,
    onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
    portal_url: "http://127.0.0.1:3000/tenant-portal/tenant-token-1",
    submitted_data: {
      legal_name: "Bright Cafe Pty Ltd",
      contact_name: "Mia Hart",
      contact_email: "mia@example.com",
      contact_phone: "0400 111 222",
      accepted: true,
    },
    submitted_at: submittedAt,
    review_data: {},
    delivery_data: {
      channels: {
        email: {
          channel: "email",
          status: "sent",
          provider: "mock",
          attempted_at: "2026-05-18T09:30:00.000Z",
          recipient: "mia@example.com",
        },
      },
      lease_agreement: {
        status: "ready_to_sign",
        open_question_count: 0,
        questions: [],
        signed_at: null,
        signed_by_actor: null,
        signing_locked_reason: null,
      },
    },
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-18T09:30:00.000Z",
    updated_at: submittedAt,
    deleted_at: null,
  };
  let reviewed = false;
  let applied = false;
  let activated = false;

  await page.route(
    /\/api\/v1\/tenant-onboarding(\/.*)?(\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (request.method() === "GET" && path === "/tenant-onboarding") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([onboardingRow]),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/review"
      ) {
        reviewed = true;
        onboardingRow = {
          ...onboardingRow,
          status: "reviewed",
          review_data: { approved: true, notes: null },
          reviewed_at: "2026-05-19T09:25:00.000Z",
          reviewed_by_user_id: "user-temba",
          updated_at: "2026-05-19T09:25:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/apply"
      ) {
        applied = true;
        onboardingRow = {
          ...onboardingRow,
          status: "applied",
          applied_at: "2026-05-19T09:30:00.000Z",
          applied_by_user_id: "user-temba",
          updated_at: "2026-05-19T09:30:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/send-lease-pack"
      ) {
        onboardingRow = {
          ...onboardingRow,
          delivery_data: {
            ...onboardingRow.delivery_data,
            lease_pack: {
              sent_at: "2026-05-21T00:20:00.000Z",
              sent_by_user_id: "user-temba",
              template_key: "tenant_lease_pack",
              template_version: "v1",
              receipts: [
                {
                  channel: "email",
                  status: "queued",
                  provider: "sendgrid",
                  recipient: "mi***@example.com",
                  provider_message_id: "lease-pack-msg-1",
                  error: null,
                  metadata: { template_key: "tenant_lease_pack" },
                },
              ],
              docusign: {
                status: "queued",
                provider: "docusign",
                envelope_id: "envelope-smoke-1",
                signer_email: "mi***@example.com",
                document_id: "document-lease-smoke-1",
                error: null,
              },
            },
            lease_agreement: {
              status: "ready_to_sign",
              open_question_count: 0,
              questions: [],
              signed_at: null,
              signed_by_actor: null,
              signing_locked_reason: null,
              signing: {
                provider: "docusign",
                status: "queued",
                envelope_id: "envelope-smoke-1",
                signer_email: "mi***@example.com",
                document_id: "document-lease-smoke-1",
                sent_at: "2026-05-21T00:20:00.000Z",
                sent_by_user_id: "user-temba",
              },
              signing_provider: "docusign",
              signing_status: "queued",
              signing_envelope_id: "envelope-smoke-1",
              signing_document_id: "document-lease-smoke-1",
              signing_sent_at: "2026-05-21T00:20:00.000Z",
            },
          },
          updated_at: "2026-05-21T00:20:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/activate-lease"
      ) {
        activated = true;
        const deliveryData = onboardingRow.delivery_data;
        const leaseAgreement = deliveryData.lease_agreement as Record<
          string,
          unknown
        >;
        const signing = leaseAgreement.signing as Record<string, unknown>;
        onboardingRow = {
          ...onboardingRow,
          delivery_data: {
            ...deliveryData,
            lease_agreement: {
              ...leaseAgreement,
              signing: {
                ...signing,
                lease_activation_review: {
                  status: "activated",
                  current_lease_status: "active",
                  recommended_status: "active",
                  activated_at: "2026-05-21T00:30:00.000Z",
                },
              },
            },
          },
          updated_at: "2026-05-21T00:30:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto("/tenants/tenant-1");

  await page.getByRole("button", { name: "Approve & apply" }).click();
  await expect.poll(() => reviewed).toBe(true);
  await expect.poll(() => applied).toBe(true);
  await expect(page.getByText("Lease pack next")).toBeVisible();
  await expect(
    page.getByText(
      "Upload a custom lease before sending the tenant a signing link.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send lease pack" }),
  ).toBeDisabled();

  await page.getByLabel("Custom lease file").setInputFiles({
    name: "custom-lease.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("custom lease bytes"),
  });
  await page.getByRole("button", { name: "Attach lease" }).click();
  await expect(page.getByText("custom-lease.pdf").first()).toBeVisible();

  await page.getByRole("button", { name: "Send lease pack" }).click();
  await expect(
    page.getByText("Lease pack sent. DocuSign is waiting for signature."),
  ).toBeVisible();
  await expect(page.getByText("DocuSign pending").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lease pack sent" }),
  ).toBeDisabled();

  const deliveryData = onboardingRow.delivery_data;
  onboardingRow = {
    ...onboardingRow,
    delivery_data: {
      ...deliveryData,
      lease_agreement: {
        ...(deliveryData.lease_agreement as Record<string, unknown>),
        status: "signed",
        signed_at: "2026-05-21T00:25:00.000Z",
        signed_by_actor: "provider:docusign",
        signing_locked_reason: null,
        signing: {
          provider: "docusign",
          status: "completed",
          envelope_id: "envelope-smoke-1",
          signed_at: "2026-05-21T00:25:00.000Z",
          signed_by_actor: "provider:docusign",
          signed_document_id: "document-signed-smoke-1",
          lease_activation_review: {
            status: "ready_for_review",
            current_lease_status: "pending",
            recommended_status: "active",
            guardrail:
              "DocuSign completion does not activate a lease automatically; review and activate explicitly.",
          },
        },
        signing_provider: "docusign",
        signing_status: "completed",
        signing_envelope_id: "envelope-smoke-1",
        signing_document_id: "document-lease-smoke-1",
        signing_sent_at: "2026-05-21T00:20:00.000Z",
      },
    },
    updated_at: "2026-05-21T00:25:00.000Z",
  };
  await page.reload();
  await expect(page.getByText("Lease signing complete")).toBeVisible();
  await expect(page.getByText("Activation review ready")).toBeVisible();
  await expect(
    page.getByText("Lease status: Pending -> Active."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "DocuSign completion does not activate a lease automatically; review and activate explicitly.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download signed lease" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Activate lease" }).click();
  expect(activated).toBe(true);
  await expect(
    page.getByText("Lease activated after signed lease review."),
  ).toBeVisible();
  await expect(
    page.getByText("Lease activated", { exact: true }),
  ).toBeVisible();
});

test("tenant detail labels tenant-uploaded lease activation review", async ({
  page,
}) => {
  let activated = false;
  let onboardingRow = {
    id: "onboarding-1",
    entity_id: "entity-1",
    lease_id: "lease-1",
    tenant_id: "tenant-1",
    token: "tenant-token-1",
    status: "applied",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    last_sent_at: "2026-05-18T09:30:00.000Z",
    resent_at: null,
    cancel_reason: null,
    onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
    portal_url: "http://127.0.0.1:3000/tenant-portal/tenant-token-1",
    submitted_data: {},
    submitted_at: "2026-05-19T09:10:00.000Z",
    review_data: {},
    delivery_data: {
      lease_agreement: {
        status: "signed",
        open_question_count: 0,
        questions: [],
        signed_at: "2026-05-21T00:25:00.000Z",
        signed_by_actor: "user-temba",
        signing_locked_reason: null,
        signing: {
          provider: "tenant_upload",
          status: "completed",
          document_id: "tenant-uploaded-lease-1",
          signed_document_id: "tenant-uploaded-lease-1",
          document_intake_id: "intake-1",
          accepted_at: "2026-05-21T00:25:00.000Z",
          signed_at: "2026-05-21T00:25:00.000Z",
          lease_activation_review: {
            status: "ready_for_review",
            current_lease_status: "pending",
            recommended_status: "active",
            guardrail:
              "Tenant-uploaded lease match does not activate a lease automatically; review and activate explicitly.",
          },
        },
        signing_provider: "tenant_upload",
        signing_status: "completed",
        signing_document_id: "tenant-uploaded-lease-1",
      },
    },
    reviewed_at: "2026-05-19T09:25:00.000Z",
    reviewed_by_user_id: "user-temba",
    applied_at: "2026-05-19T09:30:00.000Z",
    applied_by_user_id: "user-temba",
    created_at: "2026-05-18T09:30:00.000Z",
    updated_at: "2026-05-21T00:25:00.000Z",
    deleted_at: null,
  };

  await page.route(
    /\/api\/v1\/tenant-onboarding(\/.*)?(\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (request.method() === "GET" && path === "/tenant-onboarding") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([onboardingRow]),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/activate-lease"
      ) {
        activated = true;
        const deliveryData = onboardingRow.delivery_data;
        const leaseAgreement = deliveryData.lease_agreement;
        const signing = leaseAgreement.signing;
        onboardingRow = {
          ...onboardingRow,
          delivery_data: {
            ...deliveryData,
            lease_agreement: {
              ...leaseAgreement,
              signing: {
                ...signing,
                lease_activation_review: {
                  status: "activated",
                  current_lease_status: "active",
                  recommended_status: "active",
                  activated_at: "2026-05-21T00:30:00.000Z",
                },
              },
            },
          },
          updated_at: "2026-05-21T00:30:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto("/tenants/tenant-1");

  await expect(page.getByText("Lease signing complete")).toBeVisible();
  await expect(page.getByText("Tenant upload accepted").first()).toBeVisible();
  await expect(page.getByText("Signed PDF retained")).toBeVisible();
  await expect(
    page.getByText("Lease status: Pending -> Active."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Tenant-uploaded lease match does not activate a lease automatically; review and activate explicitly.",
    ),
  ).toBeVisible();
  await expect(
    page
      .locator('a[href="/intake?entity_id=entity-1&review=intake-1"]')
      .getByText("Open Smart Intake review"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Activate lease" }).click();
  expect(activated).toBe(true);
  await expect(
    page.getByText("Lease activated after tenant-uploaded lease review."),
  ).toBeVisible();
});

test("tenant detail blocks onboarding apply until lease questions are resolved", async ({
  page,
}) => {
  type SmokeOnboardingRow = Record<string, unknown> & {
    delivery_data: Record<string, unknown>;
    review_data: Record<string, unknown>;
    status: string;
  };
  const submittedAt = "2026-05-19T09:10:00.000Z";
  let onboardingRow: SmokeOnboardingRow = {
    id: "onboarding-1",
    entity_id: "entity-1",
    lease_id: "lease-1",
    tenant_id: "tenant-1",
    token: "tenant-token-1",
    status: "submitted",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    last_sent_at: "2026-05-18T09:30:00.000Z",
    resent_at: null,
    cancel_reason: null,
    onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
    portal_url: "http://127.0.0.1:3000/tenant-portal/tenant-token-1",
    submitted_data: {
      legal_name: "Bright Cafe Pty Ltd",
      contact_name: "Mia Hart",
      contact_email: "mia@example.com",
      contact_phone: "0400 111 222",
      accepted: true,
    },
    submitted_at: submittedAt,
    review_data: {},
    delivery_data: {
      channels: {
        email: {
          channel: "email",
          status: "sent",
          provider: "mock",
          attempted_at: "2026-05-18T09:30:00.000Z",
          recipient: "mia@example.com",
        },
      },
      lease_agreement: {
        status: "questions_open",
        open_question_count: 1,
        questions: [
          {
            id: "lease-question-1",
            question: "Can you confirm the make-good clause before we sign?",
            clause_reference: "Clause 12",
            status: "open",
            answer: null,
            asked_at: "2026-05-19T09:05:00.000Z",
            asked_by_actor: "tenant:tenant-1",
            answered_at: null,
            answered_by_actor: null,
            answered_by_user_id: null,
            resolved_at: null,
          },
        ],
        signed_at: null,
        signed_by_actor: null,
        signing: {},
        signing_provider: null,
        signing_status: null,
        signing_envelope_id: null,
        signing_document_id: null,
        signing_sent_at: null,
        signing_locked_reason: null,
      },
    },
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-18T09:30:00.000Z",
    updated_at: submittedAt,
    deleted_at: null,
  };
  let reviewed = false;
  let applied = false;
  let questionResolved = false;

  await page.route(
    /\/api\/v1\/tenant-onboarding(\/.*)?(\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (request.method() === "GET" && path === "/tenant-onboarding") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([onboardingRow]),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/review"
      ) {
        reviewed = true;
        onboardingRow = {
          ...onboardingRow,
          status: "reviewed",
          review_data: { approved: true, notes: null },
          reviewed_at: "2026-05-19T09:25:00.000Z",
          reviewed_by_user_id: "user-temba",
          updated_at: "2026-05-19T09:25:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path ===
          "/tenant-onboarding/onboarding-1/lease-questions/lease-question-1/respond"
      ) {
        const payload = (request.postDataJSON() ?? {}) as {
          answer?: string | null;
          status?: string | null;
        };
        questionResolved = true;
        const deliveryData = onboardingRow.delivery_data;
        const leaseAgreement = deliveryData.lease_agreement as Record<
          string,
          unknown
        >;
        onboardingRow = {
          ...onboardingRow,
          delivery_data: {
            ...deliveryData,
            lease_agreement: {
              ...leaseAgreement,
              status: "ready_to_sign",
              open_question_count: 0,
              questions: [
                {
                  id: "lease-question-1",
                  question:
                    "Can you confirm the make-good clause before we sign?",
                  clause_reference: "Clause 12",
                  status: payload.status ?? "resolved",
                  answer: payload.answer,
                  asked_at: "2026-05-19T09:05:00.000Z",
                  asked_by_actor: "tenant:tenant-1",
                  answered_at: "2026-05-19T09:28:00.000Z",
                  answered_by_actor: "operator",
                  answered_by_user_id: "user-temba",
                  resolved_at:
                    payload.status === "resolved"
                      ? "2026-05-19T09:28:00.000Z"
                      : null,
                },
              ],
            },
          },
          updated_at: "2026-05-19T09:28:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/apply"
      ) {
        applied = true;
        onboardingRow = {
          ...onboardingRow,
          status: "applied",
          applied_at: "2026-05-19T09:30:00.000Z",
          applied_by_user_id: "user-temba",
          updated_at: "2026-05-19T09:30:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto("/tenants/tenant-1");

  await expect(page.getByText("Questions open").first()).toBeVisible();
  await expect(
    page.getByText("Answer lease questions before applying.").first(),
  ).toBeVisible();
  await expect(page.getByText("Clause 12")).toBeVisible();
  await expect(
    page.getByText("Can you confirm the make-good clause before we sign?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect.poll(() => reviewed).toBe(true);
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  expect(applied).toBe(false);

  await page
    .getByPlaceholder("Answer the tenant's question")
    .fill("The make-good clause is limited to tenant-installed works.");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect.poll(() => questionResolved).toBe(true);
  await expect(page.getByText("Ready to sign").first()).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => applied).toBe(true);
});

test("tenant detail shows skipped DocuSign setup after lease pack send", async ({
  page,
}) => {
  await mockLeasiumApi(page, { docusignSkippedLeasePack: true });

  await page.goto("/tenants/tenant-1");

  await expect(page.getByText("custom-lease.pdf").first()).toBeVisible();
  await page.getByRole("button", { name: "Send lease pack" }).click();
  await expect(
    page.getByText("Lease pack sent. DocuSign setup needs attention."),
  ).toBeVisible();
  await expect(page.getByText("DocuSign not sent").first()).toBeVisible();
  await expect(
    page
      .getByText(
        "DocuSign production endpoints are not configured. Set DOCUSIGN_BASE_URL=https://www.docusign.net/restapi and DOCUSIGN_AUTH_BASE_URL=https://account.docusign.com before sending live lease envelopes.",
      )
      .last(),
  ).toBeVisible();
  await expect(page.getByText("DocuSign pending")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send again" })).toBeVisible();
});

test("tenant detail reports signed DocuSign delivery instead of Not sent", async ({
  page,
}) => {
  await mockLeasiumApi(page, { docusignSignedLeasePackNoEmail: true });

  await page.goto("/tenants/tenant-1");

  await expect(page.getByText("Signed via DocuSign").first()).toBeVisible();
  await expect(
    page
      .getByText(
        "Lease pack was completed through DocuSign; no email delivery was needed.",
      )
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Delivery has not been attempted yet."),
  ).toHaveCount(0);
});

test("tenant detail flags declined DocuSign envelope", async ({ page }) => {
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, { tenantPortalLeaseReady: true });
  let onboardingRow = {
    id: "onboarding-1",
    entity_id: "entity-1",
    lease_id: "lease-1",
    tenant_id: "tenant-1",
    token: "tenant-token-1",
    status: "applied",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    last_sent_at: "2026-05-18T09:30:00.000Z",
    resent_at: null,
    cancel_reason: null,
    onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
    portal_url: "http://127.0.0.1:3000/tenant-portal/tenant-token-1",
    submitted_data: {
      legal_name: "Bright Cafe Pty Ltd",
      contact_name: "Mia Hart",
      contact_email: "mia@example.com",
      accepted: true,
    },
    submitted_at: "2026-05-19T09:10:00.000Z",
    review_data: { approved: true },
    delivery_data: {
      lease_pack: {
        sent_at: "2026-05-21T00:20:00.000Z",
        docusign: {
          provider: "docusign",
          status: "queued",
          envelope_id: "envelope-declined-smoke",
          document_id: "document-lease-smoke-1",
        },
      },
      lease_agreement: {
        status: "ready_to_sign",
        open_question_count: 0,
        questions: [],
        signed_at: null,
        signed_by_actor: null,
        signing_locked_reason: null,
        signing: {
          provider: "docusign",
          status: "declined",
          envelope_id: "envelope-declined-smoke",
          last_event: "envelope-declined",
          last_event_at: "2026-05-21T00:30:00.000Z",
        },
        signing_provider: "docusign",
        signing_status: "declined",
        signing_envelope_id: "envelope-declined-smoke",
        signing_document_id: "document-lease-smoke-1",
        signing_sent_at: "2026-05-21T00:20:00.000Z",
      },
    },
    reviewed_at: "2026-05-19T09:25:00.000Z",
    reviewed_by_user_id: "user-temba",
    applied_at: "2026-05-19T09:30:00.000Z",
    applied_by_user_id: "user-temba",
    created_at: "2026-05-18T09:30:00.000Z",
    updated_at: "2026-05-21T00:30:00.000Z",
    deleted_at: null,
  };

  await page.route(
    /\/api\/v1\/tenant-onboarding(\/.*)?(\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (request.method() === "GET" && path === "/tenant-onboarding") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([onboardingRow]),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/send-lease-pack"
      ) {
        onboardingRow = {
          ...onboardingRow,
          delivery_data: {
            ...onboardingRow.delivery_data,
            lease_pack: {
              sent_at: "2026-05-21T00:40:00.000Z",
              docusign: {
                provider: "docusign",
                status: "queued",
                envelope_id: "fresh-resend-smoke",
                document_id: "document-lease-smoke-1",
              },
            },
            lease_agreement: {
              ...onboardingRow.delivery_data.lease_agreement,
              signing: {
                provider: "docusign",
                status: "queued",
                envelope_id: "fresh-resend-smoke",
                document_id: "document-lease-smoke-1",
                sent_at: "2026-05-21T00:40:00.000Z",
              },
              signing_provider: "docusign",
              signing_status: "queued",
              signing_envelope_id: "fresh-resend-smoke",
              signing_document_id: "document-lease-smoke-1",
              signing_sent_at: "2026-05-21T00:40:00.000Z",
            },
          },
          updated_at: "2026-05-21T00:40:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto("/tenants/tenant-1");

  await expect(
    page.getByText("DocuSign needs attention").first(),
  ).toBeVisible();
  await expect(page.getByText("Envelope declined.").first()).toBeVisible();
  await page.getByRole("button", { name: "Send again" }).click();
  await expect(
    page.getByText("Lease pack sent. DocuSign is waiting for signature."),
  ).toBeVisible();
  await expect(page.getByText("DocuSign pending").first()).toBeVisible();
  await expect(page.getByText("fresh-re")).toBeVisible();
});

test("tenant portal invite is account-first before onboarding", async ({
  page,
}) => {
  test.skip(
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only when tenant account auth is enabled.",
  );
  await page.goto("/tenant-portal/tenant-token-1");

  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant Account Setup")).toBeVisible();
  await expect(page.getByText("Invite email")).toBeVisible();
  await expect(page.getByText("mia@example.com")).toBeVisible();
  await expect(page.getByText(/Sign in with a one-time code/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("mia@example.com");
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
});

test("public onboarding token explains the account-first portal handoff", async ({
  page,
}) => {
  await page.goto("/onboarding/tenant-token-1");

  await expect(
    page.getByRole("heading", {
      name: "Bright Cafe, your tenant portal is ready.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Tenant portal invite")).toBeVisible();
  await expect(page.getByText("Queen Street Retail Centre")).toBeVisible();
  await expect(page.getByText("Shop 3")).toBeVisible();
  await expect(page.getByText("12 Queen Street, Brisbane City")).toBeVisible();
  await expect(page.getByText("available until")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue to tenant portal" }),
  ).toHaveAttribute("href", "/tenant-portal/tenant-token-1");
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
});

test("tenant portal invite handles missing tenant login setup", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    "Runs only when tenant account auth is not configured.",
  );
  await page.goto("/tenant-portal/tenant-token-1");

  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant Account Setup")).toBeVisible();
  await expect(page.getByText("Invite email")).toBeVisible();
  await expect(page.getByText("mia@example.com")).toBeVisible();
  await expect(page.getByText("Tenant login not configured")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
});

test("tenant portal onboarding room keeps setup focused", async ({ page }) => {
  test.skip(
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only when tenant account auth is enabled.",
  );
  await mockLeasiumApi(page, { tenantAccountLinked: true });
  await page.goto("/tenant-portal");

  await expect(
    page.getByRole("heading", { name: "Let's get your tenancy ready." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  const checklist = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Checklist" }),
  });
  await expect(
    checklist.getByText("Confirm details + upload docs"),
  ).toBeVisible();
  await expect(checklist.getByText("Property team review")).toBeVisible();
  await expect(checklist.getByText("Sign lease")).toBeVisible();
  await expect(checklist.getByText("Tenant account")).toHaveCount(0);
  await expect(checklist.getByText("Required documents")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Required Documents" }),
  ).toBeVisible();
  await expect(page.getByLabel("Legal name")).toBeVisible();
  await expect(page.getByLabel("Contact name")).toBeVisible();
  await expect(page.getByLabel("Contact email")).toBeVisible();
  await expect(page.getByLabel("Contact phone")).toBeVisible();
  await expect(page.getByLabel("ABN")).toBeHidden();
  await page.getByText("Add optional details").click();
  await expect(page.getByLabel("ABN")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
  await page
    .getByLabel(
      "I confirm the information above is correct to the best of my knowledge. My property manager will review before any changes apply.",
    )
    .check();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();
  await expect(page.getByText("In review")).toBeVisible();
  await expect(
    page.getByText(/property manager will review and confirm/i),
  ).toBeVisible();
});

test("tenant lease entry handles missing tenant login setup", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    "Runs only when tenant account auth is not configured.",
  );
  await page.goto("/tenant-portal/lease");

  await expect(
    page.getByRole("heading", { name: "Open your lease pack" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant login not configured")).toBeVisible();
});

test("tenant lease page focuses signing without portal dashboard", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_ENTRY_LINKED ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    tenantAccountLinked: true,
    tenantPortalLeaseReady: true,
  });

  await page.goto("/tenant-portal/lease");

  await expect(
    page.getByRole("heading", { name: "Review and sign your lease" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lease questions and signing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lease document" }),
  ).toBeVisible();
  await expect(page.getByText("Attached")).toBeVisible();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open full portal" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
});

test("tenant lease page confirms signing", async ({ page }) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_ENTRY_LINKED ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    tenantAccountLinked: true,
    tenantPortalLeaseReady: true,
  });

  await page.goto("/tenant-portal/lease");

  await page
    .getByLabel("I have reviewed and signed the lease agreement.")
    .check();
  await page.getByRole("button", { name: "Confirm signed" }).click();

  await expect(page.getByText("Complete")).toBeVisible();
  await expect(page.getByText(/Signed 21 May 2026/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open full portal" }),
  ).toHaveAttribute("href", "/tenant-portal");
});

test("tenant portal operator preview shows contact review, maintenance status, and no compliance checklist", async ({
  page,
}) => {
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    tenantPortalNoComplianceItems: true,
  });

  await page.goto("/tenants/tenant-1/portal-preview/onboarding-1");

  await expect(
    page.getByRole("heading", { name: "Tenant portal preview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Operator preview", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/No tenant portal account is created/),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Maintenance" }),
  ).toBeVisible();

  const contactPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Tenant contact" }),
  });
  await expect(contactPanel).toBeVisible();
  await expect(
    contactPanel.getByText("accounts@bright.example", { exact: true }),
  ).toBeVisible();
  await expect(contactPanel.getByText("Contact change request")).toBeVisible();
  await expect(
    contactPanel.getByText("new.accounts@bright.example"),
  ).toBeVisible();

  const maintenancePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Maintenance" }),
  });
  await expect(
    maintenancePanel.getByText(
      "Waiting for property team approval before work starts.",
    ),
  ).toBeVisible();

  const compliancePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Checklist" }),
  });
  await expect(compliancePanel.getByText("Required documents")).toBeVisible();
  await expect(
    compliancePanel.getByText(
      "No required document checklist for this onboarding.",
    ),
  ).toBeVisible();
  await expect(compliancePanel.getByText("Not required")).toBeVisible();

  const previewDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download preview CSV" }).click();
  const previewDownload = await previewDownloadPromise;
  const previewDownloadPath = await previewDownload.path();
  expect(previewDownloadPath).not.toBeNull();
  const previewCsv = await readFile(previewDownloadPath!, "utf8");
  expect(previewCsv).toContain("Required documents");
  expect(previewCsv).toContain("Not required");
  expect(previewCsv).toContain("No required document checklist");
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toHaveCount(0);
});

test("tenant portal operator preview explains every maintenance status", async ({
  page,
}) => {
  const maintenanceMatrixOptions = {
    tenantPortalMaintenanceStatusMatrix: true,
  };
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, maintenanceMatrixOptions);

  await page.goto("/tenants/tenant-1/portal-preview/onboarding-1");

  const maintenancePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Maintenance" }),
  });
  await expect(maintenancePanel).toBeVisible();
  await expect(
    maintenancePanel.getByText("Submitted to the property team."),
  ).toBeVisible();
  await expect(
    maintenancePanel.getByText(/Reviewed by the property team.*Target date/),
  ).toBeVisible();
  await expect(
    maintenancePanel.getByText("Assigned to the right person or contractor."),
  ).toBeVisible();
  await expect(
    maintenancePanel.getByText(
      "Waiting for property team approval before work starts.",
    ),
  ).toBeVisible();
  await expect(
    maintenancePanel.getByText("Approved and waiting to be scheduled."),
  ).toBeVisible();
  await expect(
    maintenancePanel.getByText(
      "A contractor or property team member is working on this.",
    ),
  ).toBeVisible();
  await expect(
    maintenancePanel.getByText(/Completed .*22 May 2026/),
  ).toBeVisible();
  await expect(
    maintenancePanel.getByText("Closed by the property team."),
  ).toBeVisible();
});

test("tenant portal operator preview shows recent activity feed", async ({
  page,
}) => {
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    tenantPortalActivityFeed: true,
  });

  await page.goto("/tenants/tenant-1/portal-preview/onboarding-1");

  const activityPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Recent Activity" }),
  });
  await expect(activityPanel).toBeVisible();
  await expect(
    activityPanel.getByRole("button", { name: "Copy summary" }),
  ).toBeVisible();
  await expect(activityPanel.getByText("6 events")).toBeVisible();
  await expect(activityPanel.getByText("Preferences saved")).toBeVisible();
  await expect(activityPanel.getByText("Portal invite sent")).toBeVisible();
  await expect(activityPanel.getByText("Contact request sent")).toBeVisible();
  await expect(
    activityPanel.getByText("Document uploaded").first(),
  ).toBeVisible();
  await expect(activityPanel.getByText("Team update")).toBeVisible();
  await expect(activityPanel.getByText("Request submitted")).toBeVisible();
  await expect(
    activityPanel.getByText(
      "Your portal notification preferences were updated.",
    ),
  ).toBeVisible();

  const previewDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download preview CSV" }).click();
  const previewDownload = await previewDownloadPromise;
  const previewDownloadPath = await previewDownload.path();
  expect(previewDownloadPath).not.toBeNull();
  const previewCsv = await readFile(previewDownloadPath!, "utf8");
  expect(previewCsv).toContain("Recent Activity");
  expect(previewCsv).toContain("Preferences saved");
  expect(previewCsv).toContain("Portal invite sent");
  expect(previewCsv).toContain("Contact request sent");
  expect(previewCsv).toContain("Request submitted");
});

test("tenant portal entry shows signed-out account access when Clerk is configured", async ({
  page,
}) => {
  test.skip(
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only when tenant account auth is enabled.",
  );

  const response = await page.goto("/tenant-portal");
  test.skip(
    response?.status() === 404,
    "Tenant portal account entry route is not implemented yet.",
  );

  await expect(page.getByText("Account Access")).toBeVisible();
  await expect(
    page.getByText("Create or sign in to a tenant login"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create login" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("tenant portal entry shows linked account-scoped tenant data", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_ENTRY_LINKED ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );

  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, { tenantAccountLinked: true });

  const response = await page.goto("/tenant-portal");
  test.skip(
    response?.status() === 404,
    "Tenant portal account entry route is not implemented yet.",
  );

  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await expect(page.getByText("Account linked")).toBeVisible();
  await expect(page.getByText("tenant_portal_account")).toBeVisible();
  await expect(
    page.getByText("Access is scoped to the tenant linked"),
  ).toBeVisible();
  await expect(page.getByText("INV-1001")).toBeVisible();
});

test("tenant portal entry guides signed-in tenants to recover an unlinked portal", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_ENTRY_UNLINKED ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );

  const response = await page.goto("/tenant-portal");
  test.skip(
    response?.status() === 404,
    "Tenant portal account entry route is not implemented yet.",
  );

  await expect(
    page.getByRole("heading", { name: "Open your portal" }),
  ).toBeVisible();
  await expect(page.getByText("No portal linked")).toBeVisible();
  await expect(
    page.getByText("Open your original tenant portal link once"),
  ).toBeVisible();
});

test("tenant portal token view guides relink when the signed-in account belongs to another tenant", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_RELINK_GUIDANCE ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );

  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    tenantAccountLinked: true,
    tenantAccountLinkedToDifferentTenant: true,
  });

  await page.goto("/tenant-portal/tenant-token-1");

  await expect(page.getByText("Different tenant")).toBeVisible();
  await expect(
    page.getByText("This login is already linked to another tenant portal."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
});

test("settings shows Xero readiness and records mappings", async ({ page }) => {
  await page.setViewportSize({ width: 1432, height: 900 });
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const brandSubtitle = page
    .getByText("Lease operations", { exact: true })
    .first();
  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  const settingsNavLink = page.getByRole("link", { name: "Settings" }).first();
  const searchButton = page.getByRole("button", { name: "Open search" });
  await expect(brandSubtitle).toBeVisible();
  await expect(primaryNav).toBeVisible();
  await expect(settingsNavLink).toBeVisible();
  await expect(searchButton).toBeVisible();
  const brandSubtitleFits = await brandSubtitle.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  const primaryNavFits = await primaryNav.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  const settingsNavFits = await settingsNavLink.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  expect(brandSubtitleFits).toBe(true);
  expect(primaryNavFits).toBe(true);
  expect(settingsNavFits).toBe(true);
  await expect(page.getByText("Operator access")).toBeVisible();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
  await expect(page.getByText("Work notifications")).toBeVisible();
  await expect(page.getByText("2 email on").first()).toBeVisible();
  await expect(page.getByText("1 SMS ready").first()).toBeVisible();
  await expect(
    page.getByLabel("Owner Operator assignment email notifications").first(),
  ).toBeVisible();
  await expect(
    page.getByLabel("Owner Operator assignment SMS notifications").first(),
  ).toBeVisible();
  await expect(
    page.getByLabel("Owner Operator assignment SMS phone").first(),
  ).toHaveValue("+61400111222");
  const ownerTemplateDefaults = page
    .locator("details")
    .filter({ hasText: "Templates" })
    .first();
  await expect(ownerTemplateDefaults).toBeVisible();
  await expect(
    ownerTemplateDefaults.getByText("Template preview").first(),
  ).not.toBeVisible();
  await expect(
    ownerTemplateDefaults.getByText("Standard assignment notice").first(),
  ).not.toBeVisible();
  await expect(
    ownerTemplateDefaults.getByText("Standard work digest").first(),
  ).not.toBeVisible();
  await expect(ownerTemplateDefaults.locator("summary")).not.toContainText(
    "Standard assignment notice",
  );
  await expect(ownerTemplateDefaults.locator("summary")).not.toContainText(
    "Standard work digest",
  );
  const ownerNotificationRow = await page
    .getByLabel("Owner Operator assignment email notifications")
    .first()
    .evaluate((node) => {
      let current = node.parentElement;
      while (current) {
        const hasOwner = current.textContent?.includes("Owner Operator");
        const hasSmsPhone = Boolean(
          current.querySelector(
            '[aria-label="Owner Operator assignment SMS phone"]',
          ),
        );
        const hasTemplates = current.textContent?.includes("Templates");
        if (hasOwner && hasSmsPhone && hasTemplates) {
          const box = current.getBoundingClientRect();
          return {
            height: box.height,
            width: box.width,
          };
        }
        current = current.parentElement;
      }
      return null;
    });
  expect(ownerNotificationRow).not.toBeNull();
  expect(ownerNotificationRow?.width).toBeGreaterThan(900);
  expect(ownerNotificationRow?.height).toBeLessThanOrEqual(170);
  await ownerTemplateDefaults.locator("summary").click();
  await expect(
    ownerTemplateDefaults
      .getByLabel("Owner Operator assignment notice template key")
      .first(),
  ).toHaveValue("work_assignment_notification");
  await expect(
    ownerTemplateDefaults
      .getByLabel("Owner Operator digest template key")
      .first(),
  ).toHaveValue("work_assignment_digest");
  await expect(
    ownerTemplateDefaults.getByText("Template preview").first(),
  ).toBeVisible();
  await expect(
    ownerTemplateDefaults
      .getByText("New Leasium work assigned to Owner Operator")
      .first(),
  ).toBeVisible();
  const ownerDigestCadence = page
    .getByLabel("Owner Operator work digest")
    .first();
  await expect(ownerDigestCadence).toBeVisible();
  await expect(ownerDigestCadence).toHaveValue("daily");
  await expect(page.getByText("Last digest").first()).toBeVisible();
  await expect(page.getByText("No messages sent").first()).toBeVisible();

  await page.getByRole("tab", { name: "Organisation" }).click();
  await expect(page.getByText("Setup needed").first()).toBeVisible();
  await expect(
    page.getByText("Missing production setup").first(),
  ).toBeVisible();
  await expect(
    page.getByText("DOCUSIGN_WEBHOOK_SECRET", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("DocuSign Connect webhook")).toBeVisible();
  await expect(
    page.getByText(
      "https://api.leasium.test/api/v1/tenant-onboarding/webhooks/docusign",
    ),
  ).toBeVisible();
  const docusignCard = page
    .locator("div")
    .filter({ hasText: /^DocuSign/ })
    .filter({ hasText: "Lease signature envelopes" })
    .first();
  await expectTouchTarget(
    docusignCard.getByRole("button", {
      name: "Copy DocuSign setup packet",
    }),
  );
  await expectTouchTarget(
    docusignCard.getByRole("button", {
      name: "Download DocuSign setup packet",
    }),
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await docusignCard
    .getByRole("button", { name: "Copy DocuSign setup packet" })
    .click();
  await expect(
    docusignCard.getByText("DocuSign setup packet copied."),
  ).toBeVisible();
  const copiedDocusignSetupPacket = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(copiedDocusignSetupPacket).toContain("DocuSign provider setup packet");
  expect(copiedDocusignSetupPacket).toContain(
    "Webhook URL: https://api.leasium.test/api/v1/tenant-onboarding/webhooks/docusign",
  );
  expect(copiedDocusignSetupPacket).toContain("DOCUSIGN_WEBHOOK_SECRET");
  expect(copiedDocusignSetupPacket).toContain(
    "Set DOCUSIGN_BASE_URL=https://www.docusign.net/restapi for live envelopes.",
  );
  expect(copiedDocusignSetupPacket).toContain(
    "Review-only export: copying or downloading this packet does not call DocuSign, send envelopes, accept Connect events, download signed PDFs, activate leases, or mutate provider history.",
  );
  const docusignSetupDownloadPromise = page.waitForEvent("download");
  await docusignCard
    .getByRole("button", { name: "Download DocuSign setup packet" })
    .click();
  const docusignSetupDownload = await docusignSetupDownloadPromise;
  expect(docusignSetupDownload.suggestedFilename()).toBe(
    "docusign-provider-setup-packet.txt",
  );
  const docusignSetupPath = await docusignSetupDownload.path();
  expect(docusignSetupPath).not.toBeNull();
  const docusignSetupText = await readFile(docusignSetupPath!, "utf8");
  expect(docusignSetupText).toContain("DocuSign provider setup packet");
  expect(docusignSetupText).toContain("DOCUSIGN_ACCOUNT_ID");
  expect(docusignSetupText).toContain("DOCUSIGN_WEBHOOK_SECRET");
  expect(docusignSetupText).toContain(
    "Webhook URL: https://api.leasium.test/api/v1/tenant-onboarding/webhooks/docusign",
  );
  await expect(page.getByText("API release", { exact: true })).toBeVisible();
  await expect(page.getByText("Render commit")).toBeVisible();
  await expect(page.getByText("7248a2b", { exact: true })).toBeVisible();
  await expect(page.getByText("Communication templates")).toBeVisible();
  await expect(page.getByText("Invoice delivery").first()).toBeVisible();
  await expect(page.getByText("Stored template overrides")).toBeVisible();
  await expect(page.getByText("Override coverage")).toBeVisible();
  await expect(
    page.getByText("2/2 active overrides match runtime keys."),
  ).toBeVisible();
  await expect(page.getByText("invoice_delivery covered")).toBeVisible();
  await expect(page.getByText("SKJ invoice delivery")).toBeVisible();
  await expect(page.getByText("Read-only")).toBeVisible();
  await expect(
    page.getByText("tenant_onboarding_invite").first(),
  ).toBeVisible();
  await expect(
    page.getByText("/api/v1/invoice-drafts/webhooks/sendgrid-events"),
  ).toBeVisible();
  await expect(page.getByText("Ownership tags")).toBeVisible();
  await expect(page.getByText("Queen Street Property Trust")).toBeVisible();
  await expect(page.getByText("Legal owner").first()).toBeVisible();
  await expect(page.getByText("Trust", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("2 properties")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open tagged properties" }).first(),
  ).toBeVisible();
  await expectTouchTarget(
    page.getByRole("link", { name: "Open tagged properties" }).first(),
  );
  await expect(
    page.getByRole("link", { name: /Queen Street Retail Centre/ }),
  ).toBeVisible();
  await expectTouchTarget(
    page.getByRole("link", { name: /Queen Street Retail Centre/ }),
  );

  await page.getByRole("tab", { name: "Connect" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect Xero" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Each trust gets its own connection, so repeat this once per trust.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect this trust" }),
  ).toBeVisible();
  await expect(page.getByText("Xero sync exception queue")).toBeVisible();
  const exceptionQueuePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Xero sync exception queue" }),
  });
  await expect(
    exceptionQueuePanel.getByText("Review 3 follow-ups"),
  ).toBeVisible();
  await exceptionQueuePanel.getByText("Review 3 follow-ups").click();
  await expect(
    exceptionQueuePanel
      .getByTestId("xero-exception-desktop-row")
      .filter({ hasText: "Base Rent tax type missing" }),
  ).toBeVisible();
  const forbiddenExceptionExportRequests =
    watchForbiddenXeroProviderRequests(page);
  await exceptionQueuePanel
    .getByRole("button", { name: "Copy exception packet" })
    .click();
  await expect(
    exceptionQueuePanel.getByText("Xero exception packet copied."),
  ).toBeVisible();
  const exceptionDownloadPromise = page.waitForEvent("download");
  await exceptionQueuePanel
    .getByRole("button", { name: "Download exceptions CSV" })
    .click();
  const exceptionDownload = await exceptionDownloadPromise;
  expect(exceptionDownload.suggestedFilename()).toBe(
    "xero-exception-review.csv",
  );
  const exceptionDownloadPath = await exceptionDownload.path();
  expect(exceptionDownloadPath).not.toBeNull();
  const exceptionCsv = await readFile(exceptionDownloadPath!, "utf8");
  expect(exceptionCsv).toContain("Base Rent tax type missing");
  expect(exceptionCsv).toContain("needs a Xero tax type");
  expect(exceptionCsv).toContain("Queen Street Retail Centre");
  expect(exceptionCsv).toContain("Review and apply the suggested tax mapping.");
  expect(exceptionCsv).toContain(
    "No Xero API refresh, invoice posting, tenant email, provider dispatch, or payment reconciliation is run by this export.",
  );
  expect(forbiddenExceptionExportRequests).toEqual([]);
  const advancedSupportDetails = page
    .locator("details")
    .filter({ hasText: "Advanced support details" })
    .first();
  await advancedSupportDetails.getByText("Advanced support details").click();
  const providerSetupPreflightPanel = page.getByRole("region", {
    name: "Provider setup preflight",
  });
  await expect(providerSetupPreflightPanel).toBeVisible();
  await expect(
    providerSetupPreflightPanel.getByText("XERO_CLIENT_ID", { exact: true }),
  ).toBeVisible();
  await expect(
    providerSetupPreflightPanel.getByText(
      "http://localhost:8000/api/v1/xero/oauth/callback",
    ),
  ).toBeVisible();
  await expect(
    providerSetupPreflightPanel.getByText("accounting.contacts.read", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    providerSetupPreflightPanel.getByText(
      "Register expected_redirect_uri in the Xero app.",
    ),
  ).toBeVisible();
  const forbiddenSetupPacketRequests = watchForbiddenXeroProviderRequests(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await providerSetupPreflightPanel
    .getByRole("button", { name: "Copy setup packet" })
    .click();
  await expect(
    providerSetupPreflightPanel.getByText("Provider setup packet copied."),
  ).toBeVisible();
  const copiedSetupPacket = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(copiedSetupPacket).toContain("Xero provider setup packet");
  expect(copiedSetupPacket).toContain(
    "Expected redirect URI: http://localhost:8000/api/v1/xero/oauth/callback",
  );
  expect(copiedSetupPacket).toContain("XERO_CLIENT_ID");
  expect(copiedSetupPacket).toContain("accounting.contacts.read");
  expect(copiedSetupPacket).toContain(
    "Register expected_redirect_uri in the Xero app.",
  );
  expect(copiedSetupPacket).toContain(
    "Diagnostics are local only; loading this panel does not call Xero.",
  );
  const setupPacketDownloadPromise = page.waitForEvent("download");
  await providerSetupPreflightPanel
    .getByRole("button", { name: "Download setup packet" })
    .click();
  const setupPacketDownload = await setupPacketDownloadPromise;
  expect(setupPacketDownload.suggestedFilename()).toBe(
    "xero-provider-setup-packet.txt",
  );
  const setupPacketDownloadPath = await setupPacketDownload.path();
  expect(setupPacketDownloadPath).not.toBeNull();
  const setupPacketText = await readFile(setupPacketDownloadPath!, "utf8");
  expect(setupPacketText).toContain("Xero provider setup packet");
  expect(setupPacketText).toContain(
    "Expected redirect URI: http://localhost:8000/api/v1/xero/oauth/callback",
  );
  expect(setupPacketText).toContain("XERO_CLIENT_ID");
  expect(setupPacketText).toContain("XERO_CLIENT_SECRET");
  expect(setupPacketText).toContain("XERO_TOKEN_ENCRYPTION_KEY");
  expect(setupPacketText).toContain("accounting.contacts.read");
  expect(setupPacketText).toContain(
    "Register expected_redirect_uri in the Xero app.",
  );
  expect(setupPacketText).toContain(
    "Diagnostics are local only; loading this panel does not call Xero.",
  );
  expect(setupPacketText).toContain(
    "No Xero write occurs until an explicit reviewed action is run.",
  );
  expect(forbiddenSetupPacketRequests).toEqual([]);
  await expect(
    advancedSupportDetails.getByText(
      "Local setup and permission checks for support.",
    ),
  ).toBeVisible();
  const forbiddenUnconnectedDiagnosticsRequests =
    watchForbiddenXeroProviderRequests(page);
  const diagnosticsDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagnostics CSV" }).click();
  const diagnosticsDownload = await diagnosticsDownloadPromise;
  expect(diagnosticsDownload.suggestedFilename()).toBe(
    "xero-connection-diagnostics.csv",
  );
  const diagnosticsDownloadPath = await diagnosticsDownload.path();
  expect(diagnosticsDownloadPath).not.toBeNull();
  const diagnosticsCsv = await readFile(diagnosticsDownloadPath!, "utf8");
  expect(diagnosticsCsv).toContain("Local readiness check");
  expect(diagnosticsCsv).toContain("OAuth");
  expect(diagnosticsCsv).toContain("Contacts");
  expect(diagnosticsCsv).toContain("Draft creation");
  expect(diagnosticsCsv).toContain("Ready");
  expect(diagnosticsCsv).toContain(
    "http://localhost:8000/api/v1/xero/oauth/callback",
  );
  expect(diagnosticsCsv).toContain("XERO_CLIENT_ID");
  expect(diagnosticsCsv).toContain("accounting.contacts.read");
  expect(diagnosticsCsv).toContain(
    "Diagnostics are local only; loading this panel does not call Xero.",
  );
  expect(diagnosticsCsv).toContain(
    "Review-only export: downloading this file does not start OAuth, call or refresh Xero, preview or apply payment reconciliation, create Xero drafts, dispatch invoices or providers, send email or SMS, refresh providers, or mutate provider history.",
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy diagnostics packet" }).click();
  await expect(
    advancedSupportDetails.getByText("Xero diagnostics packet copied."),
  ).toBeVisible();
  const diagnosticsPacket = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(diagnosticsPacket).toContain("Xero connection diagnostics packet");
  expect(diagnosticsPacket).toContain("Local readiness check");
  expect(diagnosticsPacket).toContain("OAuth: Ready");
  expect(diagnosticsPacket).toContain("Draft creation: Blocked");
  expect(diagnosticsPacket).toContain(
    "Expected redirect URI: http://localhost:8000/api/v1/xero/oauth/callback",
  );
  expect(diagnosticsPacket).toContain("Required env vars:");
  expect(diagnosticsPacket).toContain("XERO_CLIENT_ID");
  expect(diagnosticsPacket).toContain(
    "Diagnostics are local only; loading this panel does not call Xero.",
  );
  expect(diagnosticsPacket).toContain(
    "Review-only export: downloading this file does not start OAuth, call or refresh Xero, preview or apply payment reconciliation, create Xero drafts, dispatch invoices or providers, send email or SMS, refresh providers, or mutate provider history.",
  );
  const diagnosticsPacketDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download diagnostics packet" })
    .click();
  const diagnosticsPacketDownload = await diagnosticsPacketDownloadPromise;
  expect(diagnosticsPacketDownload.suggestedFilename()).toBe(
    "xero-connection-diagnostics.txt",
  );
  const diagnosticsPacketDownloadPath = await diagnosticsPacketDownload.path();
  expect(diagnosticsPacketDownloadPath).not.toBeNull();
  const diagnosticsPacketText = await readFile(
    diagnosticsPacketDownloadPath!,
    "utf8",
  );
  expect(diagnosticsPacketText).toContain("Xero connection diagnostics packet");
  expect(diagnosticsPacketText).toContain("Local readiness check");
  expect(diagnosticsPacketText).toContain("OAuth: Ready");
  expect(diagnosticsPacketText).toContain("Draft creation: Blocked");
  expect(diagnosticsPacketText).toContain(
    "Expected redirect URI: http://localhost:8000/api/v1/xero/oauth/callback",
  );
  expect(diagnosticsPacketText).toContain("Required env vars:");
  expect(diagnosticsPacketText).toContain("XERO_CLIENT_ID");
  expect(diagnosticsPacketText).toContain(
    "Diagnostics are local only; loading this panel does not call Xero.",
  );
  expect(diagnosticsPacketText).toContain(
    "Review-only export: downloading this file does not start OAuth, call or refresh Xero, preview or apply payment reconciliation, create Xero drafts, dispatch invoices or providers, send email or SMS, refresh providers, or mutate provider history.",
  );
  await expect(
    advancedSupportDetails.getByText(
      "Connect Xero before provider previews and draft creation are available.",
    ),
  ).toBeVisible();
  expect(forbiddenUnconnectedDiagnosticsRequests).toEqual([]);
  const xeroConnectionPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Connect Xero" }),
  });
  await expect(
    xeroConnectionPanel.getByText("Connection source"),
  ).toBeVisible();
  await expect(
    xeroConnectionPanel.getByText("Not connected").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect this trust" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply suggestion" }),
  ).toBeVisible();

  await advancedSupportDetails
    .getByLabel("Xero tenant ID")
    .fill("tenant-smoke");
  await advancedSupportDetails
    .getByRole("button", { name: "Save status" })
    .click();
  await expect(
    page.getByText("Connected", { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reconnect Xero" }).click();
  await expect(page.getByText("Provider connected").first()).toBeVisible();

  await page.getByRole("button", { name: "Review contacts" }).click();
  const xeroContactPreviewPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Xero contact preview" }),
  });
  await expect(
    xeroContactPreviewPanel.getByText("Xero contact preview", { exact: true }),
  ).toBeVisible();
  await expect(
    xeroContactPreviewPanel.getByText("Contacts fetched"),
  ).toBeVisible();
  await expect(
    xeroContactPreviewPanel.getByText("Bright Cafe").first(),
  ).toBeVisible();
  await expect(
    xeroContactPreviewPanel.getByText("Suggested Xero contact: Bright Cafe"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Apply selected mappings" }).click();
  await expect(page.getByText("1 applied")).toBeVisible();
  await expect(page.getByText("0 skipped")).toBeVisible();
  await expect(
    page.getByText(
      "No invoice posting, tenant email, or payment reconciliation",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Check accounts and tax" }).click();
  await expect(page.getByText("Xero chart/tax preview")).toBeVisible();
  await expect(page.getByText("0/1 ready").first()).toBeVisible();
  await expect(
    page.getByText("Taxable charge is missing a Xero tax type."),
  ).toBeVisible();
  await expect(page.getByText("No invoice posting").first()).toBeVisible();

  const baseRentExceptionRow = exceptionQueuePanel
    .getByTestId("xero-exception-desktop-row")
    .filter({ hasText: "Base Rent tax type missing" });
  await expect(baseRentExceptionRow).toBeVisible();
  await baseRentExceptionRow
    .getByRole("button", { name: "Apply suggestion" })
    .click();
  await expect(
    page.getByText("Chart and tax mappings look ready"),
  ).toBeVisible();
  await expect(
    exceptionQueuePanel
      .getByTestId("xero-exception-desktop-row")
      .filter({ hasText: "Needs Xero approval" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Check accounts and tax" }).click();
  await expect(page.getByText("1/1 ready").first()).toBeVisible();
  await expect(page.getByText("Rental Income")).toBeVisible();
  await expect(page.getByText("GST on Income")).toBeVisible();

  await page.getByRole("button", { name: "Review posting" }).click();
  const xeroInvoicePostingPreviewPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Xero invoice posting preview" }),
  });
  await expect(page.getByText("Xero invoice posting preview")).toBeVisible();
  await expect(page.getByText("1 ready").first()).toBeVisible();
  await expect(page.getByText("0 blocked").first()).toBeVisible();
  await expect(
    page.getByText(
      "This preview does not post to Xero, email tenants, or reconcile payments.",
    ),
  ).toBeVisible();
  await expect(page.getByText("acct 401 / tax OUTPUT")).toBeVisible();

  await page.getByRole("button", { name: "Approve Xero" }).click();
  await expect(
    xeroInvoicePostingPreviewPanel.getByText("Approved for Xero"),
  ).toBeVisible();
  await expect(
    xeroInvoicePostingPreviewPanel.getByText(
      "Xero draft posting was explicitly approved locally.",
    ),
  ).toBeVisible();
  await expect(
    exceptionQueuePanel
      .getByTestId("xero-exception-desktop-row")
      .filter({ hasText: "Run idempotent Xero draft creation when ready." }),
  ).toBeVisible();
  const billingHandoffLink = xeroInvoicePostingPreviewPanel.getByRole("link", {
    name: "Open Billing handoff",
  });
  await expect(billingHandoffLink).toBeVisible();
  await expectTouchTarget(billingHandoffLink);

  await page.getByRole("button", { name: "Create Xero drafts" }).click();
  const xeroDraftCreationResultPanel = page.locator("section").filter({
    has: page.getByText("Xero draft creation result"),
  });
  await expect(
    xeroDraftCreationResultPanel.getByText("Xero draft creation result"),
  ).toBeVisible();
  await expect(
    xeroDraftCreationResultPanel.getByText(
      "Xero draft invoice was created after explicit approval.",
    ),
  ).toBeVisible();
  await expect(
    xeroDraftCreationResultPanel.getByText("xero-invoice-smoke-1"),
  ).toBeVisible();
  const dispatchHandoffLink = xeroDraftCreationResultPanel.getByRole("link", {
    name: "Open dispatch handoff",
  });
  await expect(dispatchHandoffLink).toBeVisible();
  await expectTouchTarget(dispatchHandoffLink);
  await expect(
    exceptionQueuePanel
      .getByTestId("xero-exception-desktop-row")
      .filter({ hasText: "Xero payment status needs review" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Open dispatch handoff" }).click();
  await expect(page).toHaveURL(/\/billing-readiness/);
  await expect(page.getByText("Accounting missing")).toBeVisible();
  await expect(page.getByText("Reconciliation stale").first()).toBeVisible();
  const staleDispatchRow = page.getByRole("row").filter({
    hasText: "INV-1001",
  });
  await expect(
    staleDispatchRow.getByText("Payment check missing"),
  ).toBeVisible();
  await expect(staleDispatchRow.getByText("Review payments")).toBeVisible();
  await expect(
    page.getByText("1 Xero-linked payment review is open."),
  ).toBeVisible();

  await page.goto("/settings?tab=xero");
  const freshnessPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Accounting freshness snapshot" }),
  });
  await expect(freshnessPanel).toBeVisible();
  await expect(
    freshnessPanel.getByText("Reconciliation stale after"),
  ).toBeVisible();
  await expect(freshnessPanel.getByText("Contact preview")).toBeVisible();
  await expect(
    freshnessPanel.getByText(
      "1 open Xero-linked invoice needs a payment reconciliation preview.",
    ),
  ).toBeVisible();
  await expect(freshnessPanel.getByText("Next accounting step")).toBeVisible();
  await expect(
    freshnessPanel.getByText("Review Xero-linked payments"),
  ).toBeVisible();
  await expect(freshnessPanel.getByText("Open payment review")).toBeVisible();
  const forbiddenFreshnessExportRequests =
    watchForbiddenXeroProviderRequests(page);
  const freshnessDownloadPromise = page.waitForEvent("download");
  await freshnessPanel
    .getByRole("button", { name: "Download freshness CSV" })
    .click();
  const freshnessDownload = await freshnessDownloadPromise;
  expect(freshnessDownload.suggestedFilename()).toBe(
    "xero-accounting-freshness.csv",
  );
  const freshnessDownloadPath = await freshnessDownload.path();
  expect(freshnessDownloadPath).not.toBeNull();
  const freshnessCsv = await readFile(freshnessDownloadPath!, "utf8");
  expect(freshnessCsv).toContain("Accounting freshness");
  expect(freshnessCsv).toContain("Reconciliation stale after 7 days");
  expect(freshnessCsv).toContain("Contact preview");
  expect(freshnessCsv).toContain("Review Xero-linked payments");
  expect(freshnessCsv).toContain(
    "1 open Xero-linked invoice needs a payment reconciliation preview before month-end reporting.",
  );
  expect(freshnessCsv).toContain("Xero-linked open invoices");
  expect(freshnessCsv).toContain(
    "Accounting freshness is calculated from local Leasium metadata only.",
  );
  expect(freshnessCsv).toContain(
    "Loading Xero status does not refresh tokens, call Xero, post invoices, or reconcile payments.",
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await freshnessPanel
    .getByRole("button", { name: "Copy freshness packet" })
    .click();
  await expect(
    freshnessPanel.getByText("Xero freshness packet copied."),
  ).toBeVisible();
  const freshnessPacket = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(freshnessPacket).toContain("Xero accounting freshness packet");
  expect(freshnessPacket).toContain("Reconciliation stale after 7 days");
  expect(freshnessPacket).toContain("Review Xero-linked payments");
  expect(freshnessPacket).toContain(
    "1 open Xero-linked invoice needs a payment reconciliation preview before month-end reporting.",
  );
  expect(freshnessPacket).toContain(
    "Loading Xero status does not refresh tokens, call Xero, post invoices, or reconcile payments.",
  );
  expect(forbiddenFreshnessExportRequests).toEqual([]);

  await expect(
    page.getByRole("button", { exact: true, name: "Review payments" }),
  ).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Review payments" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment reconciliation review" }),
  ).toBeVisible();
  await expect(
    page.getByText("Payment status can be reconciled locally."),
  ).toBeVisible();
  await expect(page.getByText("Current unpaid / Proposed paid")).toBeVisible();
  await expect(page.getByText("high confidence")).toBeVisible();
  await expect(page.getByText("No bank write")).toBeVisible();
  await expect(page.getByText("Ref INV-1001")).toBeVisible();
  await expect(page.getByText("Bank bank-txn-smoke-1")).toBeVisible();
  await page.getByRole("button", { name: "Apply provider payments" }).click();
  await expect(
    page.getByText("Payment status was reconciled locally."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open reconciliation handoff" }),
  ).toBeVisible();
  await expectTouchTarget(
    page.getByRole("link", { name: "Open reconciliation handoff" }),
  );
  await expect(
    exceptionQueuePanel.getByText("Review 0 follow-ups"),
  ).toBeVisible();
  await exceptionQueuePanel.getByText("Review 0 follow-ups").click();
  await expect(
    exceptionQueuePanel.getByText("No Xero sync exceptions"),
  ).toBeVisible();
  await expect(
    freshnessPanel.getByText("Reconciliation current"),
  ).toBeVisible();
  await expect(freshnessPanel.getByText("Payment source manual")).toBeVisible();
  await expect(
    freshnessPanel.getByText("Payment mode local payment status apply"),
  ).toBeVisible();
  await expect(
    freshnessPanel.getByText("Ready for month-end review"),
  ).toBeVisible();

  await page.goto("/billing-readiness");
  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
  const primaryDispatchRow = page.getByRole("row").filter({
    hasText: "INV-1001",
  });
  await expect(
    primaryDispatchRow.locator("span").filter({ hasText: /^Xero DRAFT$/ }),
  ).toBeVisible();
  await primaryDispatchRow
    .getByRole("button", { exact: true, name: "Dispatch" })
    .click();
  await expect(page.getByText("Xero receipt created #1")).toBeVisible();
  await expect(
    primaryDispatchRow.getByText("Xero draft and tenant email are recorded."),
  ).toBeVisible();
  await expect(primaryDispatchRow.getByText("Provider history")).toBeVisible();
  await expect(
    page.getByText("Payment status was reconciled locally."),
  ).toBeVisible();
  await expect(primaryDispatchRow.getByText("high confidence")).toBeVisible();
  await expect(
    primaryDispatchRow.getByText("Bank feed was not mutated."),
  ).toBeVisible();
  await page.getByRole("button", { name: /Complete/ }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "INV-1001" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Unpaid/ }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "INV-1002" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "INV-1001" }),
  ).toHaveCount(0);
});

test("settings keeps provider readiness visible when API release is unavailable", async ({
  page,
}) => {
  await page.unroute("**/api/v1/**");
  await page.unroute("**/health");
  await mockLeasiumApi(page, { apiHealthUnavailable: true });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Organisation" }).click();

  await expect(page.getByText("API release", { exact: true })).toBeVisible();
  await expect(page.getByText("Release unavailable")).toBeVisible();
  await expect(
    page.getByText("API release status is unavailable."),
  ).toBeVisible();
  await expect(page.getByText("DocuSign Connect webhook")).toBeVisible();
  await expect(
    page.getByText("DOCUSIGN_WEBHOOK_SECRET", { exact: true }),
  ).toBeVisible();
});

test("settings explains DocuSign demo endpoint readiness", async ({ page }) => {
  await page.unroute("**/api/v1/**");
  await page.unroute("**/health");
  await mockLeasiumApi(page, { docusignDemoEndpoints: true });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Organisation" }).click();

  await expect(page.getByText("DocuSign", { exact: true })).toBeVisible();
  await expect(page.getByText("Setup needed").first()).toBeVisible();
  await expect(
    page.getByText(
      "Credentials and webhook are set; switch DocuSign REST and auth URLs to production before live envelope testing.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("DOCUSIGN_BASE_URL", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("DOCUSIGN_AUTH_BASE_URL", { exact: true }),
  ).toBeVisible();
});

test("settings shows Xero OAuth callback success feedback", async ({
  page,
}) => {
  await page.goto(
    "/settings?xero_connected=1&xero_tenant_id=tenant-provider-123",
  );

  await expect(page.getByText("Xero connected")).toBeVisible();
  await expect(page.getByText(/Next, review suggested contacts/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Connect" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("settings shows Xero OAuth callback error feedback without tab param", async ({
  page,
}) => {
  await page.goto("/settings?xero_error=access_denied");

  await expect(page.getByText("Xero connection needs attention")).toBeVisible();
  await expect(page.getByText(/access denied/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Connect" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("settings disables Xero provider actions when diagnostics block capabilities", async ({
  page,
}) => {
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, { xeroDiagnosticsBlocked: true });

  await page.goto("/settings?tab=xero");

  await expect(
    page.getByRole("heading", { name: "Connect Xero" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect this trust" }),
  ).toBeVisible();
  const advancedSupportDetails = page
    .locator("details")
    .filter({ hasText: "Advanced support details" })
    .first();
  await advancedSupportDetails.getByText("Advanced support details").click();
  await expect(
    advancedSupportDetails.getByText(
      "Your role or authorised scopes do not allow provider actions.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Xero" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Connect this trust" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review contacts" }),
  ).toBeDisabled();
});

async function assertXeroDiagnosticsFailClosed(
  page: Page,
  expectedDetail: string,
) {
  await expect(page.getByText(expectedDetail)).toBeVisible();
  await expect(
    page.getByText("Xero actions stay disabled until the setup check reloads."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download diagnostics CSV" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy diagnostics packet" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download setup packet" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect this trust" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review contacts" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Check accounts and tax" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Preview invoices" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review payments" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Create Xero drafts" }),
  ).toHaveCount(0);
}

test("settings fails closed when Xero diagnostics are unavailable", async ({
  page,
}) => {
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, { xeroDiagnosticsUnavailable: true });
  const forbiddenProviderRequests = watchForbiddenXeroProviderRequests(page);

  await page.goto("/settings?tab=xero");

  await assertXeroDiagnosticsFailClosed(
    page,
    "Xero connection diagnostics are unavailable in this mocked response.",
  );
  expect(forbiddenProviderRequests).toEqual([]);
});

test("settings fails closed when Xero diagnostics require operator access", async ({
  page,
}) => {
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, { xeroDiagnosticsUnauthorized: true });
  const forbiddenProviderRequests = watchForbiddenXeroProviderRequests(page);

  await page.goto("/settings?tab=xero");

  await assertXeroDiagnosticsFailClosed(
    page,
    "Operator access is required for Xero diagnostics.",
  );
  expect(forbiddenProviderRequests).toEqual([]);
});

test("settings fails closed when Xero diagnostics are missing a signed-in operator", async ({
  page,
}) => {
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    xeroDiagnosticsUnauthorized: true,
    xeroDiagnosticsUnauthorizedStatus: 401,
  });
  const forbiddenProviderRequests = watchForbiddenXeroProviderRequests(page);

  await page.goto("/settings?tab=xero");

  await assertXeroDiagnosticsFailClosed(page, "Missing Clerk bearer token.");
  expect(forbiddenProviderRequests).toEqual([]);
});

test("settings shows Xero draft creation ready only from diagnostics", async ({
  page,
}) => {
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, { xeroDiagnosticsDraftReady: true });

  await page.goto("/settings?tab=xero");

  const advancedSupportDetails = page
    .locator("details")
    .filter({ hasText: "Advanced support details" })
    .first();
  await advancedSupportDetails.getByText("Advanced support details").click();
  const draftCreationCard = advancedSupportDetails.getByLabel(
    "Draft creation readiness",
  );
  await expect(draftCreationCard).toContainText("Draft creation");
  await expect(draftCreationCard).toContainText("Ready");
  await expect(draftCreationCard).toContainText(
    "Provider connection and authorised scopes allow this reviewed action.",
  );
  const forbiddenDiagnosticsRequests = watchForbiddenXeroProviderRequests(page);
  const diagnosticsCsvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagnostics CSV" }).click();
  const diagnosticsCsvDownload = await diagnosticsCsvDownloadPromise;
  expect(diagnosticsCsvDownload.suggestedFilename()).toBe(
    "xero-connection-diagnostics.csv",
  );
  const diagnosticsCsvPath = await diagnosticsCsvDownload.path();
  expect(diagnosticsCsvPath).not.toBeNull();
  const diagnosticsCsv = await readFile(diagnosticsCsvPath!, "utf8");
  expect(diagnosticsCsv).toContain('"Connection diagnostics"');
  expect(diagnosticsCsv).toContain('"provider"');
  expect(diagnosticsCsv).toContain('"Draft creation","Ready"');
  expect(diagnosticsCsv).toContain('"Payments","Blocked"');
  expect(diagnosticsCsv).toContain(
    "Provider connection and authorised scopes allow this reviewed action.",
  );
  expect(diagnosticsCsv).toContain(
    "Review-only export: downloading this file does not start OAuth, call or refresh Xero, preview or apply payment reconciliation, create Xero drafts, dispatch invoices or providers, send email or SMS, refresh providers, or mutate provider history.",
  );
  const diagnosticsPacketDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download diagnostics packet" })
    .click();
  const diagnosticsPacketDownload = await diagnosticsPacketDownloadPromise;
  expect(diagnosticsPacketDownload.suggestedFilename()).toBe(
    "xero-connection-diagnostics.txt",
  );
  const diagnosticsPacketPath = await diagnosticsPacketDownload.path();
  expect(diagnosticsPacketPath).not.toBeNull();
  const diagnosticsPacket = await readFile(diagnosticsPacketPath!, "utf8");
  expect(diagnosticsPacket).toContain("Local readiness check");
  expect(diagnosticsPacket).toContain("Provider setup:");
  expect(diagnosticsPacket).toContain("Draft creation: Ready");
  expect(diagnosticsPacket).toContain("Payments: Blocked");
  expect(diagnosticsPacket).toContain(
    "Provider connection and authorised scopes allow this reviewed action.",
  );
  expect(diagnosticsPacket).toContain("Next steps:");
  expect(diagnosticsPacket).toContain("Guardrails:");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy diagnostics packet" }).click();
  await expect(
    advancedSupportDetails.getByText("Xero diagnostics packet copied."),
  ).toBeVisible();
  const copiedDiagnosticsPacket = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(copiedDiagnosticsPacket).toContain("Connection source: provider");
  expect(copiedDiagnosticsPacket).toContain("Draft creation: Ready");
  expect(copiedDiagnosticsPacket).toContain("Payments: Blocked");
  expect(copiedDiagnosticsPacket).toContain(
    "Provider connection and authorised scopes allow this reviewed action.",
  );
  expect(copiedDiagnosticsPacket).toContain(
    "Review-only export: downloading this file does not start OAuth, call or refresh Xero, preview or apply payment reconciliation, create Xero drafts, dispatch invoices or providers, send email or SMS, refresh providers, or mutate provider history.",
  );
  expect(forbiddenDiagnosticsRequests).toEqual([]);
});

test("insights shows overview, exceptions, activity, and owner snapshot", async ({
  page,
}) => {
  await page.goto("/insights");

  await expect(
    page.getByRole("heading", { exact: true, name: "Insights" }),
  ).toBeVisible();
  // Overview tab (default): exceptions and billing risk.
  await expect(
    page.getByRole("heading", { name: "Live Exceptions" }),
  ).toBeVisible();
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();

  // Money tab: finance, invoices, arrears.
  await page.getByRole("tab", { name: /Money/ }).click();
  await expect(
    page.getByRole("heading", { name: "Finance Snapshot" }),
  ).toBeVisible();
  await expect(page.getByText("Approved not synced").first()).toBeVisible();
  const financeSnapshotPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Finance Snapshot" }) });
  await expect(
    financeSnapshotPanel.getByText("Accounting readiness"),
  ).toBeVisible();
  await expect(
    financeSnapshotPanel.getByText("Source local metadata"),
  ).toBeVisible();
  await expect(
    financeSnapshotPanel.getByText("Reconciliation current"),
  ).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Contacts ready")).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Guardrails")).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Chart")).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Tax")).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Open in Xero")).toBeVisible();

  // Operations tab: maintenance, compliance, lease events.
  await page.getByRole("tab", { name: /Operations/ }).click();
  await expect(
    page.getByRole("heading", { name: "Lease Events" }),
  ).toBeVisible();
  await expect(page.getByText("Bright Cafe Pty Ltd rent review")).toBeVisible();

  // Portfolio tab: owner/entity, activity, and sharing.
  await page.getByRole("tab", { name: /Portfolio/ }).click();
  await expect(
    page.getByRole("heading", { name: "Automation Activity" }),
  ).toBeVisible();
  await expect(page.getByText("Created reviewed lease records")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  ).toBeVisible();
  await expect(page.getByText("Trust", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Generate link" }).click();
  await expect(page.getByText("Snapshot link ready")).toBeVisible();
  await page.getByRole("link", { name: "Open snapshot" }).click();

  await expect(page).toHaveURL(/\/snapshots\/snapshot-token-1$/);
  await expect(page.getByText("Frozen view")).toBeVisible();
  const ownerSnapshotSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  });
  await expect(ownerSnapshotSection).toBeVisible();
  await expect(
    ownerSnapshotSection.getByText("Accounting readiness"),
  ).toBeVisible();
  await expect(
    ownerSnapshotSection.getByText("Source local metadata"),
  ).toBeVisible();
  await expect(ownerSnapshotSection.getByText("Guardrails")).toBeVisible();
});
