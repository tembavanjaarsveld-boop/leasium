import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

function watchBasiqRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/api/v1/basiq")) {
      requests.push(`${request.method()} ${url.pathname}`);
    }
  });
  return requests;
}

test("settings keeps parked Basiq bank-feed controls hidden", async ({
  page,
}) => {
  const basiqRequests = watchBasiqRequests(page);
  await mockLeasiumApi(page, { basiqConsentReady: true });

  await page.goto("/settings?tab=xero");

  await expect(page.getByRole("tab", { name: "Integrations" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Bank feed (Basiq)" }),
  ).toHaveCount(0);
  await expect(page.getByText("Connect bank feed")).toHaveCount(0);
  await expect(page.getByText("Open Basiq consent")).toHaveCount(0);
  await expect(page.getByText("BASIQ_ENABLED")).toHaveCount(0);
  expect(basiqRequests).toEqual([]);
});

test("money hub hides Basiq review routes", async ({ page }) => {
  const basiqRequests = watchBasiqRequests(page);
  await mockLeasiumApi(page, { basiqConsentReady: true });

  await page.goto("/money");

  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
  await expect(page.getByText("Basiq")).toHaveCount(0);
  await expect(page.getByText("bank-feed")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open Basiq controls" }),
  ).toHaveCount(0);
  expect(basiqRequests).toEqual([]);
});
