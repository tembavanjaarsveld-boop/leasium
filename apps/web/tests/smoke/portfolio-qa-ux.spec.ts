import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test("portfolio QA loading metrics use contextual labels", async ({ page }) => {
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    await page.waitForTimeout(1200);
    await route.fallback();
  });

  await page.goto("/portfolio-qa");

  const metrics = page
    .locator("section")
    .filter({
      has: page.getByText("Open issues", { exact: true }),
    })
    .first();

  await expect(metrics).toContainText("Checking");
  await expect(metrics).toContainText("Preparing");
  await expect(metrics).toContainText("Updating");
  await expect(metrics.getByText("...", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Preparing QA workspace.")).toBeVisible();
  await expect(page.getByText("Loading QA workspace.")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("portfolio QA blocker triage shows per-reason counts, plain-English copy, and a guided fix", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.goto("/portfolio-qa");

  // The reason-breakdown layer lives only inside the Blocker triage packet.
  const breakdown = page.getByTestId("blocker-reason-breakdown");
  await expect(breakdown).toBeVisible();

  // Scope to the rent-roll billing group card within the breakdown.
  const rentRollGroup = breakdown.getByTestId("reason-group-billing-readiness");
  await expect(rentRollGroup).toBeVisible();

  // Reason 1: appears twice (two seeded rows) with plain-English copy.
  await expect(
    rentRollGroup.getByText("Tenant is missing a billing email.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    rentRollGroup.getByText(
      "Onboarding invites and invoices can't reach the tenant.",
    ),
  ).toBeVisible();

  // Reason 2: a distinct reason at a different count, also explained.
  await expect(
    rentRollGroup.getByText("Rent is missing a Xero account code.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    rentRollGroup.getByText(
      "Blocks syncing the invoice to Xero without an account code.",
    ),
  ).toBeVisible();

  // Guided fix path routes through the existing billing-readiness surface.
  await expect(
    rentRollGroup.getByRole("link", { name: /Open billing/ }).first(),
  ).toHaveAttribute("href", "/billing-readiness");

  // The "missing a billing email" reason expands to its 2 affected rows.
  await rentRollGroup
    .getByRole("button", { name: "Show 2 affected rows" })
    .click();
  await expect(
    rentRollGroup.getByRole("button", { name: "Hide affected rows" }),
  ).toBeVisible();
});

test("portfolio QA enrichment queue actions meet mobile touch targets and stay local-only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

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

  await page.goto("/portfolio-qa");

  await expect(
    page.getByText("AI-assisted enrichment candidates", { exact: true }),
  ).toBeVisible();

  const copyQueue = page.getByRole("button", {
    name: "Copy queue",
  });
  const downloadQueueCsv = page.getByRole("button", {
    name: "Download queue CSV",
  });

  for (const control of [copyQueue, downloadQueueCsv]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  mutationCalls.length = 0;
  await copyQueue.click();
  await expect(page.getByText("Enrichment queue copied.")).toBeVisible();
  const copiedQueue = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedQueue).toContain("Portfolio QA enrichment queue");
  expect(copiedQueue).toContain("Review-only");

  const downloadPromise = page.waitForEvent("download");
  await downloadQueueCsv.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "portfolio-qa-enrichment-queue.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv).toContain("Eagle Street Office");
  expect(csv).toContain(
    "Review-only: accept sourced suggestions only after checking citations.",
  );
  expect(mutationCalls).toEqual([]);
});
