import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

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
      await page.getByRole("button", { name: label, exact: true }).boundingBox(),
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

  await expect(
    page.getByRole("heading", { name: "Send invite" }),
  ).toBeVisible({ timeout: 15_000 });

  await expectTouchTarget(
    await page.getByRole("button", { name: "Close send invite" }).boundingBox(),
  );
});

test("tenant reminder sends require explicit approval", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  let reminderRuns = 0;
  await page.route(
    /\/api\/v1\/tenant-onboarding\/reminders\/run(?:\?.*)?$/,
    async (route) => {
      reminderRuns += 1;
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
  await expect.poll(() => reminderRuns).toBe(0);

  await reminderApproval.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Send due reminders?" }),
  ).toHaveCount(0);
  await expect.poll(() => reminderRuns).toBe(0);

  await page.getByRole("button", { name: "Review reminders" }).click();
  await reminderApproval
    .getByRole("button", { name: "Send due reminders" })
    .click();
  await expect.poll(() => reminderRuns).toBe(1);
  await expect(page.getByText("2 reminders sent.")).toBeVisible();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("mobile tenant rows expose invite actions without raw loading placeholders", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.removeItem("leasium.entity_id");
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
