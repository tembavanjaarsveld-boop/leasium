import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("comms queue copies and downloads the same review-only CSV", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedCommsReviewCsv?: string })
            .__copiedCommsReviewCsv = text;
        },
      },
    });
  });

  let reviewActionsStarted = false;
  const forbiddenApiCalls: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

    if (request.method() === "GET" && path === "/comms/queue") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entity_id: "entity-1",
          generated_at: "2026-05-27T02:00:00.000Z",
          candidates: [
            {
              id: "comms-formula-candidate-1",
              kind: "rent_review",
              target_kind: "lease",
              target_id: "lease-1",
              tenant_id: "tenant-1",
              tenant_name: "=HYPERLINK(\"https://unsafe.example\")",
              property_name: "  +SUM(1,2)",
              unit_label: "Shop 3",
              recipient_email: "tenant@example.com",
              recipient_phone: null,
              subject: "@formula subject",
              body: "-formula body",
              severity: "info",
              due_at: "2026-07-01T00:00:00.000Z",
              detail: "Review-only rent review candidate",
              generated_at: "2026-05-27T02:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }

    const isForbiddenDuringReviewAction =
      reviewActionsStarted &&
      (request.method() !== "GET" ||
        path.includes("/comms/dispatch") ||
        path.includes("/comms/dismiss") ||
        path.includes("/provider") ||
        path.includes("/history") ||
        path.includes("/sendgrid") ||
        path.includes("/twilio") ||
        path.includes("/xero") ||
        path.includes("/basiq") ||
        path.includes("/payment") ||
        path.includes("/reconciliation") ||
        path.includes("/billing") ||
        path.includes("/invoice") ||
        path.includes("/email") ||
        path.includes("/settle") ||
        path.includes("/refresh"));

    if (isForbiddenDuringReviewAction) {
      forbiddenApiCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "comms review export must stay local-only" }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/comms");
  await expect(
    page.getByRole("heading", { name: "Comms queue" }),
  ).toBeVisible();
  await expect(page.getByText("Showing all 1 draft.")).toBeVisible();

  reviewActionsStarted = true;

  await page.getByRole("button", { name: "Copy review CSV" }).click();
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedCommsReviewCsv?: string })
        .__copiedCommsReviewCsv ?? "",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download review CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "comms-queue-review-2026-05-27.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloadedCsv = await readFile(downloadPath!, "utf8");

  expect(copiedCsv).toBe(downloadedCsv);
  expect(copiedCsv).toContain("Rent review");
  expect(copiedCsv).toContain("\"'=HYPERLINK(\"\"https://unsafe.example\"\")\"");
  expect(copiedCsv).toContain("\"'  +SUM(1,2)\"");
  expect(copiedCsv).toContain("\"'@formula subject\"");
  expect(copiedCsv).toContain("\"'-formula body\"");
  expect(copiedCsv).toContain(
    "Review-only export: downloading this file does not send SendGrid email, send Twilio SMS, dismiss candidates, upload evidence, write provider history, settle candidates, mutate the queue, or refresh provider state.",
  );
  expect(forbiddenApiCalls).toEqual([]);
});
