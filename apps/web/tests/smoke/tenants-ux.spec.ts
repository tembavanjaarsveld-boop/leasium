import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

// The two-entity fixture defaults fresh storage to All entities; pin these
// single-entity specs to the primary entity.
test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
});

function expectTouchTarget(box: { width: number; height: number } | null) {
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

function expectTenantCorrespondenceCsv(correspondenceCsv: string) {
  expect(correspondenceCsv).toContain("Tenant correspondence");
  expect(correspondenceCsv).toContain("Inbound email");
  expect(correspondenceCsv).toContain("Broken tap");
  expect(correspondenceCsv).toContain("comms draft email queued");
  expect(correspondenceCsv).toContain("arrears_case:arrears-1");
  expect(correspondenceCsv).toContain("inbound_message:inbound-message-1");
  expect(correspondenceCsv).toContain("maintenance_work_order:work/order?1");
  expect(correspondenceCsv).toContain(
    '"\'=HYPERLINK(""https://example.invalid"",""Mia"")"',
  );
  expect(correspondenceCsv).not.toMatch(/(?:^|,)"[=+\-@]/m);
  expect(correspondenceCsv).toContain(
    "Review-only export: copying or downloading this file does not send email or SMS",
  );
  expect(correspondenceCsv).toContain("fetch document bytes.");
}

test("desktop tenant register filters and inline actions are touch-safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  await page.goto("/tenants");

  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible({ timeout: 15_000 });

  for (const label of [
    "All",
    "Needs onboarding",
    "Sent",
    "Submitted",
    "Overdue",
    "Cancelled",
  ]) {
    await expectTouchTarget(
      await page
        .getByRole("button", { name: label, exact: true })
        .boundingBox(),
    );
  }

  const tenantRow = page
    .locator("tbody tr")
    .filter({
      has: page.getByRole("button", {
        name: "Bright Cafe (Bright Cafe Pty Ltd)",
        exact: true,
      }),
    })
    .first();
  await expect(tenantRow).toBeVisible();

  await expectTouchTarget(
    await tenantRow
      .getByRole("button", {
        name: "Bright Cafe (Bright Cafe Pty Ltd)",
        exact: true,
      })
      .boundingBox(),
  );

  for (const label of [
    "Edit Contact name for Bright Cafe (Bright Cafe Pty Ltd)",
    "Edit Contact email for Bright Cafe (Bright Cafe Pty Ltd)",
    "Edit Contact phone for Bright Cafe (Bright Cafe Pty Ltd)",
  ]) {
    await expectTouchTarget(
      await tenantRow
        .getByRole("button", { name: label, exact: true })
        .boundingBox(),
    );
  }
});

test("tenant invite drawer close action stays touch-safe", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  await page.goto("/tenants?action=invite");

  await expect(page.getByRole("heading", { name: "Send invite" })).toBeVisible({
    timeout: 15_000,
  });

  await expectTouchTarget(
    await page.getByRole("button", { name: "Close send invite" }).boundingBox(),
  );
});

test("tenant invite creation uses an explicit trust picker in all-entities mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  const tenantCreates: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/tenants", async (route) => {
    if (route.request().method() === "POST") {
      tenantCreates.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
    }
    await route.fallback();
  });

  await page.goto("/tenants");

  await page.getByRole("button", { name: "Send invite" }).click();
  const invitePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Send invite" }),
  });
  await expect(invitePanel).toBeVisible();
  const trustPicker = invitePanel.getByLabel("File under trust");
  await expect(trustPicker).toBeVisible();
  await expect(trustPicker).toHaveValue("entity-1");

  await invitePanel.getByLabel(/^Property/).selectOption("property-1");
  await invitePanel.getByLabel("Tenant name").fill("Action Picker Cafe");
  await invitePanel
    .getByLabel("Contact email")
    .fill("action-picker@example.test");
  await invitePanel
    .locator("form")
    .getByRole("button", { name: "Send invite" })
    .click();

  expect(tenantCreates).toHaveLength(1);
  expect(tenantCreates[0].entity_id).toBe("entity-1");
  expect(tenantCreates[0].entity_id).not.toBe("__all__");
});

test("tenant reminder sends require explicit approval", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  const reminderEntityIds: string[] = [];
  await page.route(
    /\/api\/v1\/tenant-onboarding\/reminders\/run(?:\?.*)?$/,
    async (route) => {
      reminderEntityIds.push(
        new URL(route.request().url()).searchParams.get("entity_id") ?? "",
      );
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          checked: 3,
          sent: 2,
          skipped: 1,
          onboarding_ids: ["onboarding-1", "onboarding-2"],
        }),
      });
    },
  );

  await page.goto("/tenants");

  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Review reminders" }).click();
  const reminderApproval = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Send due reminders?" }),
    })
    .first();
  await expect(
    reminderApproval.getByRole("heading", { name: "Send due reminders?" }),
  ).toBeVisible();
  const trustPicker = reminderApproval.getByLabel("Reminder trust");
  await expect(trustPicker).toBeVisible();
  await expect(trustPicker).toHaveValue("entity-1");
  await expect.poll(() => reminderEntityIds.length).toBe(0);

  await reminderApproval.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Send due reminders?" }),
  ).toHaveCount(0);
  await expect.poll(() => reminderEntityIds.length).toBe(0);

  await page.getByRole("button", { name: "Review reminders" }).click();
  await reminderApproval
    .getByRole("button", { name: "Send due reminders" })
    .click();
  await expect.poll(() => reminderEntityIds).toEqual(["entity-1"]);
  await expect(page.getByText("2 reminders sent.")).toBeVisible();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("mobile tenant rows expose invite actions without raw loading placeholders", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.localStorage.setItem("tenantCopiedLink", text);
        },
      },
    });
  });

  await mockLeasiumApi(page);

  let delayedTenantLists = true;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    if (
      delayedTenantLists &&
      request.method() === "GET" &&
      (path === "/tenants" || path === "/tenant-onboarding")
    ) {
      delayedTenantLists = false;
      await page.waitForTimeout(1200);
    }
    await route.fallback();
  });

  let cancelCalled = false;
  await page.route(
    "**/api/v1/tenant-onboarding/onboarding-1/cancel",
    async (route) => {
      cancelCalled = true;
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          id: "onboarding-1",
          status: "cancelled",
          tenant_id: "tenant-1",
          lease_id: "lease-1",
          onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
          expires_at: "2026-06-12T00:00:00.000Z",
          due_date: "2026-05-29",
          created_at: "2026-05-18T09:30:00.000Z",
          updated_at: "2026-05-20T00:00:00.000Z",
        }),
      });
    },
  );

  await page.goto("/tenants");

  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible({ timeout: 15_000 });

  const tenantSurface = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Onboarding command center" }),
    })
    .first();
  const kpis = page
    .locator("section")
    .filter({ hasText: "Waiting on tenants" });

  await expect(kpis).toBeVisible();
  await expect(kpis.getByText("...", { exact: true })).toHaveCount(0);
  await expect(tenantSurface.getByText("...", { exact: true })).toHaveCount(0);

  const brightCafeRow = page
    .getByTestId("tenant-mobile-row")
    .filter({ hasText: "Bright Cafe" })
    .first();
  await expect(brightCafeRow).toBeVisible();

  await expect(
    brightCafeRow.getByRole("link", { name: "Open" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");

  const copyLink = brightCafeRow.getByRole("button", { name: "Copy link" });
  await expect(copyLink).toBeVisible();
  const copyBox = await copyLink.boundingBox();
  expect(copyBox?.height).toBeGreaterThanOrEqual(44);
  await copyLink.click();
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("tenantCopiedLink")),
    )
    .toBe("http://127.0.0.1:3000/onboarding/tenant-token-1");

  const cancel = brightCafeRow.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();
  const cancelBox = await cancel.boundingBox();
  expect(cancelBox?.height).toBeGreaterThanOrEqual(44);
  await cancel.click();
  await expect.poll(() => cancelCalled).toBe(true);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("tenant detail correspondence export is touch-safe and local-only on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.removeItem("tenantCopiedCorrespondenceCsv");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.localStorage.setItem("tenantCopiedCorrespondenceCsv", text);
        },
      },
    });
  });
  await mockLeasiumApi(page);

  let localExportStarted = false;
  const forbiddenApiCalls: string[] = [];
  const forbiddenMutationPrefixes = [
    "/tenants",
    "/comms/dispatch",
    "/comms/dismiss",
    "/providers",
    "/provider-history",
    "/provider-refresh",
    "/sendgrid",
    "/twilio",
    "/xero",
    "/basiq",
    "/tenant-onboarding",
    "/tenant-portal",
  ];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const method = request.method();
    const documentByteDownload =
      (path.includes("/documents/") && path.includes("/download")) ||
      path.includes("document-byte");
    const forbiddenMutation =
      method !== "GET" &&
      forbiddenMutationPrefixes.some((prefix) => path.startsWith(prefix));

    if (localExportStarted && (forbiddenMutation || documentByteDownload)) {
      forbiddenApiCalls.push(`${method} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "tenant correspondence CSV export must stay local-only",
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/tenants/tenant-1");
  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity" }).click();

  const correspondencePanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Correspondence" }),
    })
    .first();
  const copyCorrespondenceCsv = correspondencePanel.getByRole("button", {
    name: "Copy correspondence CSV",
  });
  const downloadCorrespondenceCsv = correspondencePanel.getByRole("button", {
    name: "Download correspondence CSV",
  });
  await expect(copyCorrespondenceCsv).toBeVisible();
  await expect(copyCorrespondenceCsv).toBeEnabled();
  await expect(downloadCorrespondenceCsv).toBeVisible();
  await expect(downloadCorrespondenceCsv).toBeEnabled();
  const copyActionBox = await copyCorrespondenceCsv.boundingBox();
  const downloadActionBox = await downloadCorrespondenceCsv.boundingBox();
  expectTouchTarget(copyActionBox);
  expectTouchTarget(downloadActionBox);
  const verticalGap = Math.max(
    0,
    Math.max(copyActionBox!.y, downloadActionBox!.y) -
      Math.min(
        copyActionBox!.y + copyActionBox!.height,
        downloadActionBox!.y + downloadActionBox!.height,
      ),
  );
  const horizontalGap = Math.max(
    0,
    Math.max(copyActionBox!.x, downloadActionBox!.x) -
      Math.min(
        copyActionBox!.x + copyActionBox!.width,
        downloadActionBox!.x + downloadActionBox!.width,
      ),
  );
  expect(Math.min(verticalGap, horizontalGap)).toBeLessThanOrEqual(12);
  await expect(downloadCorrespondenceCsv).not.toHaveClass(
    /(?:^|\s)h-8(?:\s|$)/,
  );
  await expect(copyCorrespondenceCsv).not.toHaveClass(/(?:^|\s)h-8(?:\s|$)/);

  localExportStarted = true;
  await copyCorrespondenceCsv.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("tenantCopiedCorrespondenceCsv"),
      ),
    )
    .not.toBeNull();
  const copiedCorrespondenceCsv = await page.evaluate(() =>
    window.localStorage.getItem("tenantCopiedCorrespondenceCsv"),
  );
  expect(copiedCorrespondenceCsv).not.toBeNull();

  const downloadPromise = page.waitForEvent("download");
  await downloadCorrespondenceCsv.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "tenant-correspondence-bright-cafe.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const correspondenceCsv = await readFile(downloadPath!, "utf8");

  expect(copiedCorrespondenceCsv).toBe(correspondenceCsv);
  expectTenantCorrespondenceCsv(correspondenceCsv);
  expect(forbiddenApiCalls).toEqual([]);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("tenant detail document review links stay touch-safe without document actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  await page.goto("/tenants/tenant-1");
  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Documents" }).click();

  const openReviewLinks = page.getByRole("link", {
    exact: true,
    name: "Open review",
  });
  await expect(openReviewLinks.first()).toBeVisible();
  const openReviewCount = await openReviewLinks.count();
  expect(openReviewCount).toBeGreaterThan(0);
  for (let index = 0; index < openReviewCount; index += 1) {
    await expectTouchTarget(await openReviewLinks.nth(index).boundingBox());
  }

  const documentDownloadLinks = page.locator('a[aria-label^="Download "]');
  await expect(documentDownloadLinks.first()).toBeVisible();
  const downloadCount = await documentDownloadLinks.count();
  expect(downloadCount).toBeGreaterThan(0);
  for (let index = 0; index < downloadCount; index += 1) {
    await expectTouchTarget(
      await documentDownloadLinks.nth(index).boundingBox(),
    );
  }
});

test("tenant detail uses tabs and sets up tenant invoice charges from lease billing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  const chargeCreates: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/charge-rules", async (route) => {
    if (route.request().method() === "POST") {
      chargeCreates.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
    }
    await route.fallback();
  });

  await page.goto("/tenants/tenant-1?tab=lease-billing");
  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "Tenant record sections" });
  await expect(tabs).toBeVisible();
  for (const label of [
    "Overview",
    "Lease & Billing",
    "Portal",
    "Documents",
    "Activity",
  ]) {
    await expect(tabs.getByRole("tab", { name: label })).toBeVisible();
  }

  await expect(
    tabs.getByRole("tab", { name: "Lease & Billing" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Lease & Billing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Billing schedule" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Portal access" }),
  ).toHaveCount(0);

  const billingSchedule = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Billing schedule" }),
    })
    .first();
  await expect(
    billingSchedule.getByText("Base rent - $8,000 Monthly"),
  ).toBeVisible();
  const addLineToggle = billingSchedule.getByRole("button", {
    name: "Add line",
  });
  await expect(addLineToggle).toBeVisible();
  await expect(addLineToggle).toHaveAttribute("aria-expanded", "false");
  const billingEditor = page.locator("#tenant-billing-schedule-editor");
  await expect(billingEditor).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(async () => (await billingEditor.boundingBox())?.height ?? 0)
    .toBeLessThan(4);
  await expect(billingSchedule.getByLabel("Amount")).toBeDisabled();

  await addLineToggle.click();
  await expect(addLineToggle).toHaveAttribute("aria-expanded", "true");
  await expect(billingEditor).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(async () => (await billingEditor.boundingBox())?.height ?? 0)
    .toBeGreaterThan(300);
  await expect(billingSchedule.getByLabel("Amount")).toBeVisible();

  await billingSchedule.getByRole("combobox").nth(1).selectOption("outgoings");
  await billingSchedule.getByLabel("Amount").fill("425");
  await billingSchedule.getByLabel("Starts").fill("2026-08-01");
  await billingSchedule.getByLabel("Invoice sent").fill("2026-07-15");
  await billingSchedule.getByLabel("Next due").fill("2026-08-01");
  await billingSchedule
    .getByRole("button", { name: "Add schedule line" })
    .click();

  await expect.poll(() => chargeCreates.length).toBe(1);
  expect(chargeCreates[0]).toMatchObject({
    lease_id: "lease-1",
    charge_type: "outgoings",
    amount_cents: 42500,
    frequency: "monthly",
    gst_treatment: "taxable",
    start_date: "2026-08-01",
    next_invoice_date: "2026-07-15",
    next_due_date: "2026-08-01",
    arrears_or_advance: "advance",
  });
  expect(chargeCreates[0].metadata).toMatchObject({
    billing_schedule_owner: "lease",
    tenant_record_setup: true,
    tenant_facing: true,
  });
  await expect(page.getByText(/Added Outgoings/)).toBeVisible();
  await expect(addLineToggle).toHaveAttribute("aria-expanded", "false");
  await expect(billingEditor).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(async () => (await billingEditor.boundingBox())?.height ?? 0)
    .toBeLessThan(4);
  await expect(billingSchedule.getByLabel("Amount")).toBeDisabled();

  const tenantDangerZone = page.getByTestId("tenant-danger-zone");
  await expect(tenantDangerZone).toBeVisible();
  const deleteTenantButton = tenantDangerZone.getByRole("button", {
    name: "Delete tenant",
  });
  await expect(deleteTenantButton).toBeVisible();
  await expect(deleteTenantButton).toHaveClass(/rounded-full/);
  await expect(deleteTenantButton).toHaveClass(/border-danger/);
  const dangerZoneFollowsTabPanel = await tenantDangerZone.evaluate((zone) => {
    const tabPanel = document.querySelector(
      '[role="tabpanel"][aria-label="Lease & Billing"]',
    );
    return Boolean(
      tabPanel &&
        tabPanel.compareDocumentPosition(zone) &
          Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(dangerZoneFollowsTabPanel).toBe(true);

  await tabs.getByRole("tab", { name: "Portal" }).click();
  await expect(
    page.getByRole("heading", { name: "Portal access" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Billing schedule" }),
  ).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("tenant portal invoice PDF controls stay on the touch-target baseline", async () => {
  const source = await readFile(
    "src/app/tenant-portal/tenant-portal-content.tsx",
    "utf8",
  );

  expect(source).not.toMatch(/invoice\.pdf_document_id[\s\S]{0,700}min-h-9/);
  expect(source).toMatch(/invoice\.pdf_document_id[\s\S]{0,700}min-h-11/);
});

test("tenant portal upload documents jump stays on the touch-target baseline", async () => {
  const source = await readFile(
    "src/app/tenant-portal/tenant-portal-content.tsx",
    "utf8",
  );

  // The Home "Upload documents" shortcut now switches to the Documents tab via
  // the shared SecondaryButton primitive (a 44px touch target by construction),
  // rather than an in-page anchor jump.
  expect(source).toMatch(
    /<SecondaryButton[\s\S]{0,160}setActiveTab\("documents"\)[\s\S]{0,200}Upload documents/,
  );
  expect(source).not.toMatch(/href="#tenant-documents"/);
});

test("mobile tenant portal recovery actions stay touch-safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.localStorage.setItem("tenantPortalRecoveryLink", text);
        },
      },
    });
  });
  await mockLeasiumApi(page);

  await page.goto("/tenants/tenant-1");

  await page.getByRole("tab", { name: "Portal" }).click();
  const portalAccess = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Portal access" }),
    })
    .first();
  await expect(portalAccess).toBeVisible();

  const sendInvite = portalAccess.getByRole("button", { name: "Send invite" });
  const copyLink = portalAccess.getByRole("button", { name: "Copy link" });
  const unlink = portalAccess.getByRole("button", { name: "Unlink" });
  const revoke = portalAccess.getByRole("button", { name: "Revoke" });
  await expectTouchTarget(await sendInvite.boundingBox());
  await expectTouchTarget(await copyLink.boundingBox());
  await expectTouchTarget(await unlink.boundingBox());
  await expectTouchTarget(await revoke.boundingBox());
  await expect(unlink).not.toHaveClass(/(?:^|\s)h-8(?:\s|$)/);
  await expect(revoke).not.toHaveClass(/(?:^|\s)h-8(?:\s|$)/);

  await revoke.click();
  const restore = portalAccess.getByRole("button", { name: "Restore" });
  await expect(restore).toBeVisible();
  await expectTouchTarget(await restore.boundingBox());
  await expect(restore).not.toHaveClass(/(?:^|\s)h-8(?:\s|$)/);

  await restore.click();
  const restoredUnlink = portalAccess.getByRole("button", { name: "Unlink" });
  await expect(restoredUnlink).toBeVisible();
  await expectTouchTarget(await restoredUnlink.boundingBox());
  await expect(restoredUnlink).not.toHaveClass(/(?:^|\s)h-8(?:\s|$)/);

  await restoredUnlink.click();
  const freshLink = portalAccess.getByRole("button", { name: "Fresh link" });
  await expect(freshLink).toBeVisible();
  await expectTouchTarget(await freshLink.boundingBox());
  await expect(freshLink).not.toHaveClass(/(?:^|\s)h-8(?:\s|$)/);

  await freshLink.click();
  await expect(page.getByText("Fresh portal link copied.")).toBeVisible();
});
