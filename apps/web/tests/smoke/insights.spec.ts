import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("insights renders the Horizon first-screen cockpit", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const unsafeRequests: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const isReadOnlyShellBadge =
      request.method() === "GET" && path === "/comms/queue/counts";
    const isUnsafe =
      request.method() !== "GET" &&
      !isReadOnlyShellBadge &&
      !path.startsWith("/insights/snapshots");

    if (isUnsafe) {
      unsafeRequests.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "insights must stay review-only" }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/insights");

  await expect(
    page.getByRole("heading", { exact: true, name: "Insights" }),
  ).toBeVisible();
  await expect(
    page.getByText("Portfolio health, compliance, and what changed - shareable."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy review packet" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();

  await expect(
    page.getByText("PORTFOLIO VALUE FLOW", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("COMPLIANCE", { exact: true })).toBeVisible();
  await expect(page.getByText("EXCEPTIONS", { exact: true })).toBeVisible();
  await expect(
    page.getByText("WHAT CHANGED THIS WEEK", { exact: true }),
  ).toBeVisible();
  const changeRail = page
    .locator("section")
    .filter({
      has: page.getByText("WHAT CHANGED THIS WEEK", { exact: true }),
    })
    .first();
  const changeRailBox = await changeRail.boundingBox();
  expect(changeRailBox).not.toBeNull();
  expect(changeRailBox!.y + changeRailBox!.height).toBeLessThanOrEqual(900);
  await expect(page.getByText("Rent roll up")).toBeVisible();
  await expect(page.getByText("Arrears aged past")).toBeVisible();
  await expect(page.getByText("Vacancy listed")).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  expect(unsafeRequests).toEqual([]);
});

test("insights exports review packet CSV from loaded overview data", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedInsightsPacket?: string })
            .__copiedInsightsPacket = text;
        },
      },
    });
  });

  const forbiddenApiCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const isSnapshotMutation =
      request.method() !== "GET" &&
      (path === "/insights/snapshots" ||
        /^\/insights\/snapshots\/[^/]+\/revoke$/.test(path));
    const isReadOnlyShellBadge =
      request.method() === "GET" && path === "/comms/queue/counts";
    const isForbiddenPath =
      !isReadOnlyShellBadge &&
      (isSnapshotMutation ||
        path.includes("/provider") ||
        path.includes("/xero") ||
        path.includes("/send") ||
        path.includes("/dispatch") ||
        path.includes("/payment") ||
        path.includes("/reconciliation") ||
        path.includes("/comms") ||
        path.includes("/billing-drafts") ||
        path.includes("/invoice-drafts"));

    if (isForbiddenPath) {
      forbiddenApiCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "review packet must stay local-only" }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/insights");

  await expect(
    page.getByRole("heading", { exact: true, name: "Insights" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live Exceptions" }),
  ).toBeVisible();
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();

  // Money sections: finance snapshot, arrears, invoice status.
  await expect(
    page.getByRole("heading", { name: "Finance Snapshot" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Arrears Snapshot" }),
  ).toBeVisible();
  const arrearsRow = page.getByRole("link", {
    name: /Bright Cafe Pty Ltd arrears/,
  });
  await expect(arrearsRow).toBeVisible();
  await expect(arrearsRow.getByText("$8,800")).toBeVisible();
  await expect(arrearsRow.getByText("18 days aged")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Invoice Status" }),
  ).toBeVisible();
  const invoiceRow = page.getByRole("link", {
    name: /Maintenance recovery invoice/,
  });
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow.getByText("Provider failed")).toBeVisible();
  await expect(invoiceRow.getByText("$8,800")).toBeVisible();

  // Operations sections: compliance, maintenance aging.
  await expect(
    page.getByRole("heading", { name: "Compliance & Inspections" }),
  ).toBeVisible();
  const fireSafetyRow = page.getByRole("link", {
    name: /Fire safety certificate renewal/,
  });
  await expect(fireSafetyRow).toBeVisible();
  await expect(fireSafetyRow.getByText("Bright Cafe Pty Ltd")).toBeVisible();

  // Register completion roll-up chips render near the existing compliance counts.
  const complianceSection = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Compliance & Inspections" }),
    })
    .first();
  await expect(complianceSection.getByText("Tracked checks")).toBeVisible();
  await expect(complianceSection.getByText("Approved evidence")).toBeVisible();
  await expect(complianceSection.getByText("Recently completed")).toBeVisible();

  // A row with operator-approved evidence shows the badge + last-completed line.
  await expect(fireSafetyRow.getByText("Evidence on file")).toBeVisible();
  await expect(
    fireSafetyRow.getByText(/Last completed .* by ops@example\.test/),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Maintenance Aging" }),
  ).toBeVisible();
  const maintenanceRow = page.getByRole("link", {
    name: /Front counter leak/,
  });
  await expect(maintenanceRow).toBeVisible();
  await expect(maintenanceRow.getByText("21 days open")).toBeVisible();
  await expect(maintenanceRow.getByText("Cool Air Services")).toBeVisible();

  // Portfolio section: owner/entity snapshot.
  await expect(
    page.getByRole("heading", { name: "Portfolio rollup" }),
  ).toBeVisible();
  await expect(page.getByText("2 entities")).toBeVisible();
  await expect(page.getByText("75% occupied")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Copy review packet" }).click();
  await expect(page.getByText("Insights review packet copied.")).toBeVisible();
  const copiedPacket = await page.evaluate(
    () =>
      (window as Window & { __copiedInsightsPacket?: string })
        .__copiedInsightsPacket ?? "",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "insights-review-packet-2026-05-19.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(csv).toContain("Live exception");
  expect(csv).toContain("Insurance certificate renewal");
  expect(csv).toContain("Automation activity");
  expect(csv).toContain("Created reviewed lease records");
  expect(csv).toContain("Finance snapshot");
  expect(csv).toContain("Accounting readiness");
  expect(csv).toContain("Owner / entity snapshot");
  expect(csv).toContain("Compliance snapshot");
  expect(csv).toContain("Fire safety certificate renewal");
  expect(csv).toContain("Maintenance snapshot");
  expect(csv).toContain("Front counter leak");
  expect(csv).toContain("21 days open");
  expect(csv).toContain("Cool Air Services");
  expect(csv).toContain("Arrears snapshot");
  expect(csv).toContain("Bright Cafe Pty Ltd arrears");
  expect(csv).toContain("18 days aged");
  expect(csv).toContain("Invoice status");
  expect(csv).toContain("Maintenance recovery invoice");
  expect(csv).toContain("Provider failed");
  expect(csv).toContain("ops@example.test");
  expect(csv).toContain("Lease event");
  expect(csv).toContain("Bright Cafe Pty Ltd rent review");
  expect(csv).toContain("Snapshot history");
  expect(csv).toContain("No saved snapshots");
  expect(csv).toContain(
    "Review-only export: downloading this file does not create or revoke snapshots, write Xero data, refresh providers, send SendGrid or Twilio messages, send tenant, owner, or provider email, apply payment reconciliation, generate billing drafts, dispatch providers, or mutate provider history.",
  );

  for (const packet of [copiedPacket, csv]) {
    expect(packet).toContain("Live exception");
    expect(packet).toContain("Insurance certificate renewal");
    expect(packet).toContain("Automation activity");
    expect(packet).toContain("Created reviewed lease records");
    expect(packet).toContain("Finance snapshot");
    expect(packet).toContain("Accounting readiness");
    expect(packet).toContain("Owner / entity snapshot");
    expect(packet).toContain("Compliance snapshot");
    expect(packet).toContain("Fire safety certificate renewal");
    expect(packet).toContain("Maintenance snapshot");
    expect(packet).toContain("Front counter leak");
    expect(packet).toContain("21 days open");
    expect(packet).toContain("Cool Air Services");
    expect(packet).toContain("Arrears snapshot");
    expect(packet).toContain("Bright Cafe Pty Ltd arrears");
    expect(packet).toContain("18 days aged");
    expect(packet).toContain("Invoice status");
    expect(packet).toContain("Maintenance recovery invoice");
    expect(packet).toContain("Provider failed");
    expect(packet).toContain("ops@example.test");
    expect(packet).toContain("Lease event");
    expect(packet).toContain("Bright Cafe Pty Ltd rent review");
    expect(packet).toContain("Snapshot history");
    expect(packet).toContain("No saved snapshots");
    expect(packet).toContain(
      "Review-only export: downloading this file does not create or revoke snapshots, write Xero data, refresh providers, send SendGrid or Twilio messages, send tenant, owner, or provider email, apply payment reconciliation, generate billing drafts, dispatch providers, or mutate provider history.",
    );
  }
  expect(forbiddenApiCalls).toEqual([]);
});

test("insights snapshot generation uses an explicit trust picker in all-entities mode", async ({
  page,
}) => {
  const snapshotCalls: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/insights/snapshots", async (route) => {
    if (route.request().method() === "POST") {
      snapshotCalls.push(route.request().postDataJSON() as Record<string, unknown>);
    }
    await route.fallback();
  });

  await page.goto("/insights");

  const snapshotPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Shareable Snapshots" }),
  });
  await expect(snapshotPanel).toBeVisible();
  const trustPicker = snapshotPanel.getByLabel("Snapshot trust");
  await expect(trustPicker).toBeVisible();
  await expect(trustPicker).toHaveValue("entity-1");

  await trustPicker.selectOption("entity-2");
  await snapshotPanel.getByRole("button", { name: "Generate link" }).click();

  await expect(snapshotPanel.getByText("Snapshot link ready")).toBeVisible();
  expect(snapshotCalls).toHaveLength(1);
  expect(snapshotCalls[0].entity_id).toBe("entity-2");
  expect(snapshotCalls[0].snapshot_type).toBe("owner");
});

test("insights splits the Xero-status guardrail into label and caption", async ({
  page,
}) => {
  await page.goto("/insights");

  const financeSnapshot = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Finance Snapshot" }),
    })
    .first();
  await expect(financeSnapshot).toBeVisible();

  // C8: the leading status clause and the guardrail caption render as two
  // distinct elements rather than one run-on sentence.
  const statusLabel = financeSnapshot.getByText("Loading Xero status", {
    exact: true,
  });
  await expect(statusLabel).toBeVisible();
  const caption = financeSnapshot.getByText(
    "does not refresh tokens, call Xero, post invoices, or reconcile payments.",
    { exact: true },
  );
  await expect(caption).toBeVisible();
});
