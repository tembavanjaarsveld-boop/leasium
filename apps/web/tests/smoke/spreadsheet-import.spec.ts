import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

// The spreadsheet review surface is review-first. Reviewing a workbook fetches
// the stored plan (with its review summary) but must never send, dispatch, or
// reconcile anything until the explicit Apply action runs.
function watchUnsafeRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      /\/(send|dispatch|reconcile)/.test(url) ||
      url.includes("/xero/")
    ) {
      requests.push(url);
    }
  });
  return requests;
}

async function reviewWorkbook(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "portfolio-import.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("mock workbook"),
  });
}

test("the spreadsheet review summary strip renders ready, attention, and confidence counts", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  const unsafeRequests = watchUnsafeRequests(page);
  await page.goto("/intake/spreadsheet");

  await expect(
    page.getByRole("heading", { name: "Spreadsheet Intake" }),
  ).toBeVisible();

  await reviewWorkbook(page);

  // The plan renders, and the additive review-summary strip appears.
  await expect(
    page.getByRole("heading", { name: "portfolio-import.xlsx" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review summary" }),
  ).toBeVisible();
  await expect(page.getByText("1 ready to approve")).toBeVisible();
  await expect(page.getByText("2 need attention")).toBeVisible();
  await expect(page.getByText("High confidence")).toBeVisible();
  await expect(page.getByText("Medium confidence")).toBeVisible();
  await expect(page.getByText("Low confidence")).toBeVisible();

  // Fetching the plan summary fires no send/dispatch/reconcile route.
  expect(unsafeRequests).toHaveLength(0);
});

test("Apply behaviour is unchanged with the review summary strip present", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.goto("/intake/spreadsheet");

  await reviewWorkbook(page);
  await expect(
    page.getByRole("heading", { name: "Review summary" }),
  ).toBeVisible();

  // Ignore all disables Apply; approving recommended re-enables it.
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
});
