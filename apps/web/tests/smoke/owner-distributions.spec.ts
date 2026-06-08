import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

function watchDistributionReviewRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/owners/distributions/review")
    ) {
      requests.push(request.url());
    }
  });
  return requests;
}

test("managing-agent accounts see the owner distributions panel with a GST breakdown", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.goto("/statements?month=2026-05");

  const panel = page.getByRole("heading", { name: "Owner distributions" });
  await expect(panel).toBeVisible();

  await expect(
    page.getByText("Payment execution is not available in this version.", {
      exact: false,
    }),
  ).toBeVisible();

  // The fee breakdown columns are present. Match exact accessible names so
  // "GST" resolves to its own column header rather than the "Fee ex-GST" /
  // "Fee inc-GST" headers that contain it as a substring.
  await expect(
    page.getByRole("columnheader", { name: "Fee ex-GST", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "GST", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Fee inc-GST", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Net distribution", exact: true }),
  ).toBeVisible();
});

test("self-managed owner accounts do not see the distributions panel", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });
  await page.goto("/statements?month=2026-05");

  // The entity statements surface still renders.
  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Owner distributions" }),
  ).toHaveCount(0);
});

test("marking a distribution reviewed calls the endpoint and reflects reviewed state", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  const reviewRequests = watchDistributionReviewRequests(page);
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner distributions" }),
  ).toBeVisible();

  const reviewButton = page
    .getByRole("button", { name: "Mark reviewed" })
    .first();
  await expect(reviewButton).toBeVisible();
  await reviewButton.click();

  await expect(page.getByText("Reviewed").first()).toBeVisible();
  expect(reviewRequests).toHaveLength(1);
});

test("managing-agent accounts see distribution history with a CSV export action", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.goto("/statements?month=2026-05");

  const history = page.getByText("Distribution history", { exact: true });
  await expect(history).toBeVisible();
  await history.click();

  // Reviewed history rows render from the mocked history endpoint.
  await expect(page.getByText("Harbour Lane Trust").first()).toBeVisible();

  const exportButton = page.getByRole("button", {
    name: "Export history CSV",
  });
  await expect(exportButton).toBeVisible();

  // The export wires through the browser download path.
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("owner-distributions-2026-05.csv");
});

test("self-managed owner accounts do not see distribution history", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();

  await expect(
    page.getByText("Distribution history", { exact: true }),
  ).toHaveCount(0);
});
