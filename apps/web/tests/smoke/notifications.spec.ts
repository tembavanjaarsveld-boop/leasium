import { expect, type Locator, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("notifications render the Horizon review queue without provider mutation on load", async ({
  page,
}) => {
  const forbiddenCalls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const unsafeMethod = request.method() !== "GET";
    const providerPath =
      /sendgrid|twilio|provider|notification|digests\/run|comms|xero|basiq/i.test(
        path,
      );
    if (unsafeMethod && providerPath) {
      forbiddenCalls.push(`${request.method()} ${path}`);
    }
  });

  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Work notices and digest receipts/i),
  ).toBeVisible();
  for (const channel of ["Email", "SMS", "In-app"]) {
    await expect(
      page
        .locator("section, article, div")
        .filter({ has: page.getByText(channel, { exact: true }) })
        .first(),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: /NEEDS YOU/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "RECEIPTS — QUIET" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Notification center is read-only — sends need your explicit approval.",
    ),
  ).toBeVisible();
  expect(forbiddenCalls).toEqual([]);
});

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

async function expectNoHorizontalOverflow(page: Page) {
  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
}

test("notifications mobile matches the Horizon compact first viewport without provider mutation on load", async ({
  page,
}) => {
  const forbiddenCalls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const unsafeMethod = request.method() !== "GET";
    const providerPath =
      /sendgrid|twilio|provider|notification|digests\/run|comms|xero|basiq/i.test(
        path,
      );
    if (unsafeMethod && providerPath) {
      forbiddenCalls.push(`${request.method()} ${path}`);
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("2 need you · rest are receipts")).toBeVisible();
  for (const chip of ["Email setup", "SMS setup", "In-app ready"]) {
    await expect(page.getByText(chip, { exact: true })).toBeVisible();
  }

  const mobileSummary = page.getByTestId("notifications-mobile-first-viewport");
  await expect(mobileSummary).toBeVisible();
  await expect(mobileSummary.getByText("Needs you")).toBeVisible();
  await expect(mobileSummary.getByText("Air conditioning fault")).toBeVisible();
  await expect(
    mobileSummary.getByText("Assignment notification email was queued."),
  ).toBeVisible();
  await expect(mobileSummary.getByText("Bright Cafe arrears")).toBeVisible();
  await expect(
    mobileSummary.getByText("Assignment notification email failed."),
  ).toBeVisible();
  await expect(mobileSummary.getByText("Receipts")).toBeVisible();
  await expect(
    mobileSummary.getByText("Daily digest — Owner Operator"),
  ).toBeVisible();
  await expect(mobileSummary.getByText(/4 items/)).toBeVisible();

  for (const actionName of ["Send SMS", "Retry notice", "Send digest"]) {
    await expectTouchTarget(
      mobileSummary.getByRole("button", { name: actionName }),
    );
  }

  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark reviewed" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^All 2$/ })).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Mobile primary" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(forbiddenCalls).toEqual([]);
});

test("notifications message preview action links stay touch-safe", async ({
  page,
}) => {
  await page.goto("/notifications");

  await expect(page.getByText("Work notice center")).toBeVisible();
  const messagePreview = page.getByText("Message preview").first();
  await expectTouchTarget(messagePreview);
  await messagePreview.click();

  await expectTouchTarget(
    page.getByRole("link", { name: "Open assigned work" }).first(),
  );
});

test("notifications provider and receipt disclosures stay touch-safe", async ({
  page,
}) => {
  await page.goto("/notifications");

  await expect(page.getByText("Work notice center")).toBeVisible();
  await expectTouchTarget(
    page.locator("summary").filter({ hasText: "Provider setup checks" }),
  );
  await expectTouchTarget(
    page.locator("summary").filter({ hasText: "Receipt evidence" }).first(),
  );
});

test("notifications exports provider readiness review CSV", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedProviderReadinessCsv?: string })
            .__copiedProviderReadinessCsv = text;
        },
      },
    });
  });

  let readinessExportStarted = false;
  const readinessExportApiCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

    if (readinessExportStarted) {
      readinessExportApiCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "provider readiness CSV copy/download must stay local-only",
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("Provider setup checks")).toBeVisible();

  const exportMenuButton = page.getByRole("button", {
    name: "Export",
    exact: true,
  });
  await exportMenuButton.click();
  const copyButton = page.getByRole("menuitem", {
    name: "Copy readiness CSV",
  });
  const downloadButton = page.getByRole("menuitem", {
    name: "Download readiness CSV",
  });
  await expect(copyButton).toBeVisible();
  await expect(downloadButton).toBeVisible();
  for (const control of [copyButton, downloadButton]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  readinessExportStarted = true;

  await copyButton.click();
  await expect(page.getByText("Readiness CSV copied")).toBeVisible();
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedProviderReadinessCsv?: string })
        .__copiedProviderReadinessCsv ?? "",
  );
  expect(copiedCsv).toBeTruthy();

  const downloadPromise = page.waitForEvent("download");
  await exportMenuButton.click();
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "work-notification-provider-readiness.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(copiedCsv).toBe(csv);
  expect(csv).toContain("Email");
  expect(csv).toContain("Sendgrid");
  expect(csv).toContain("SMS");
  expect(csv).toContain("Twilio");
  expect(csv).toContain("In-app");
  expect(csv).toContain("Leasium");
  expect(csv).toContain("SendGrid sender");
  expect(csv).toContain("Twilio status callback");
  expect(csv).toContain("Configure SendGrid to queue provider emails");
  expect(csv).toContain("Configure Twilio to queue provider SMS");
  expect(csv).toContain(
    "Notification center is read-only; sending still requires explicit operator action.",
  );
  expect(csv).toContain(
    "Review-only export: downloading this file does not send email, send SMS, run digests, mark notifications read, dispatch providers, refresh provider tokens, or mutate provider history.",
  );
  expect(readinessExportApiCalls).toEqual([]);
});

test("notifications exports work notification review packet without provider calls", async ({
  page,
}) => {
  const mutationCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const isForbiddenMutation =
      request.method() !== "GET" &&
      (path.includes("/notification") ||
        path.includes("/digests/run") ||
        path.includes("/providers") ||
        path.includes("/provider") ||
        path.includes("/tokens") ||
        path.includes("/history") ||
        path.includes("/comms") ||
        path.includes("/work-assignments") ||
        path.includes("/maintenance") ||
        path.includes("/arrears") ||
        path.includes("/xero") ||
        path.includes("/basiq"));

    if (isForbiddenMutation) {
      mutationCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "review packet must be local-only" }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();

  const exportMenuButton = page.getByRole("button", {
    name: "Export",
    exact: true,
  });
  await exportMenuButton.click();
  const copyButton = page.getByRole("menuitem", {
    name: "Copy review packet",
  });
  await expect(copyButton).toBeVisible();
  const copyBox = await copyButton.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(copyBox!.width).toBeGreaterThanOrEqual(44);
  expect(copyBox!.height).toBeGreaterThanOrEqual(44);
  await copyButton.click();
  await expect(page.getByText("Review packet copied")).toBeVisible();

  await exportMenuButton.click();
  const downloadButton = page.getByRole("menuitem", {
    name: "Download review packet CSV",
  });
  await expect(downloadButton).toBeVisible();
  const downloadBox = await downloadButton.boundingBox();
  expect(downloadBox).not.toBeNull();
  expect(downloadBox!.width).toBeGreaterThanOrEqual(44);
  expect(downloadBox!.height).toBeGreaterThanOrEqual(44);
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "work-notification-review-packet.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(csv).toContain("Air conditioning fault");
  expect(csv).toContain("Bright Cafe arrears");
  expect(csv).toContain("Assignment email was queued by SendGrid.");
  expect(csv).toContain("SendGrid returned 500.");
  expect(csv).toContain("Work digest email");
  expect(csv).toContain("Leasium Daily Work digest: 4 items");
  expect(csv).toContain("Send digest from this page.");
  expect(csv).toContain("Retry the assignment email from this page.");
  expect(csv).toContain(
    "Review-only packet: copying or downloading this packet does not send email, send SMS, run digests, mark notifications read, mark notifications reviewed, dispatch providers, call Comms, call Xero, call Basiq, refresh provider tokens, or mutate provider history.",
  );
  expect(mutationCalls).toEqual([]);
});
