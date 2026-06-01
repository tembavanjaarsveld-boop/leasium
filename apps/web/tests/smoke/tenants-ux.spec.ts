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
