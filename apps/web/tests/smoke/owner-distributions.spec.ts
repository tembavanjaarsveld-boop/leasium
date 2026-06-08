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

// Distribution PDF export is review-only: it must never hit a send/dispatch/pay
// route. Record any request that would move money or message an owner.
function watchUnsafeRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    const method = request.method();
    const isMutation = method === "POST" || method === "PUT" || method === "PATCH";
    if (
      /\/owners\/(statements\/send|distributions\/[^/?]+\/pay)/.test(url) ||
      url.includes("/dispatch/send") ||
      // Any write to a payment / bank / Xero / reconciliation rail is unsafe
      // for this review-only surface. mark-disbursed is an audit-only status
      // marker (not a pay/bank/xero/rail route) so it is intentionally allowed.
      (isMutation &&
        /\/(payments?|bank|xero|reconcil|rails?)\b/i.test(url))
    ) {
      requests.push(url);
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

test("managing-agent accounts can download a review-only distribution PDF without any send", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  const unsafeRequests = watchUnsafeRequests(page);
  const pdfRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().includes("/api/v1/owners/distributions/pdf")
    ) {
      pdfRequests.push(request.url());
    }
  });
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner distributions" }),
  ).toBeVisible();

  const downloadButton = page.getByRole("button", {
    name: "Download distribution PDF",
  });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("owner-distributions-2026-05.pdf");

  // The export only fetches the PDF and never fires a send/dispatch/pay route.
  expect(pdfRequests).toHaveLength(1);
  expect(unsafeRequests).toHaveLength(0);
});

test("self-managed owner accounts do not see the distribution PDF action", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Download distribution PDF" }),
  ).toHaveCount(0);
});

test("managing-agent accounts see the dispatch review drafts with ready and blocked badges, copy, and no send", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"]);
  const unsafeRequests = watchUnsafeRequests(page);
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner distributions" }),
  ).toBeVisible();

  const dispatch = page
    .locator("summary")
    .filter({ hasText: "Dispatch review" });
  await expect(dispatch).toBeVisible();
  await dispatch.click();

  // The review-only, no-send guardrail is prominent.
  await expect(
    page.getByText("review-only", { exact: false }).first(),
  ).toBeVisible();

  // Drafts render with both a ready and a blocked recipient badge.
  await expect(page.getByText("Owner distribution for 2026-05", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Ready").first()).toBeVisible();
  await expect(page.getByText("Add an owner billing email.")).toBeVisible();

  // A copy action exists; clicking it does not fire any send/dispatch route.
  const copyButton = page.getByRole("button", { name: "Copy draft" }).first();
  await expect(copyButton).toBeVisible();
  await copyButton.click();

  expect(unsafeRequests).toHaveLength(0);
  // No send/dispatch button is wired in this review-only distribution surface
  // (owner-statement send actions elsewhere on the page are a separate feature).
  const dispatchPanel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Dispatch review" }) });
  await expect(
    dispatchPanel.getByRole("button", { name: /send|dispatch/i }),
  ).toHaveCount(0);
});

test("self-managed owner accounts do not see the dispatch review drafts", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();

  await expect(
    page.getByText("Dispatch review", { exact: true }),
  ).toHaveCount(0);
});

function watchDisburseRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/owners\/distributions\/[^/?]+\/mark-disbursed/.test(request.url())
    ) {
      requests.push(request.url());
    }
  });
  return requests;
}

test("managing-agent accounts see distribution history status badges", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.goto("/statements?month=2026-05");

  const history = page.getByText("Distribution history", { exact: true });
  await expect(history).toBeVisible();
  await history.click();

  const historyPanel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Distribution history" }) });

  // Both the reviewed and the already-disbursed fixture rows render badges.
  await expect(
    historyPanel.getByText("Reviewed", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    historyPanel.getByText("Disbursed", { exact: true }).first(),
  ).toBeVisible();
  // The disbursed row shows a quiet "Disbursed {date} by {who}" line.
  await expect(
    historyPanel.getByText("Disbursed 3 May 2026", { exact: false }),
  ).toBeVisible();
});

test("marking a reviewed distribution disbursed calls the endpoint and reflects disbursed without any payment route", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  const disburseRequests = watchDisburseRequests(page);
  const unsafeRequests = watchUnsafeRequests(page);
  // The confirm dialog gates the action; auto-accept it for the happy path.
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/statements?month=2026-05");

  const history = page.getByText("Distribution history", { exact: true });
  await expect(history).toBeVisible();
  await history.click();

  const historyPanel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Distribution history" }) });

  // Only the reviewed fixture row offers a mark-disbursed action.
  const disburseButton = historyPanel.getByRole("button", {
    name: "Mark disbursed",
  });
  await expect(disburseButton).toHaveCount(1);
  // Touch-target floor.
  await expect(disburseButton).toHaveClass(/min-h-11/);
  await disburseButton.click();

  // The reviewed row flips to disbursed; the action disappears for it.
  await expect(disburseButton).toHaveCount(0);
  await expect(
    historyPanel.getByText("Disbursed", { exact: true }),
  ).toHaveCount(2);

  expect(disburseRequests).toHaveLength(1);
  // Audit-only marker: no payment / bank / Xero / rail route was hit.
  expect(unsafeRequests).toHaveLength(0);
});

test("self-managed owner accounts do not see the distribution history mark-disbursed action", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();

  // The whole distributions panel (and therefore the action) is gated off.
  await expect(
    page.getByRole("button", { name: "Mark disbursed" }),
  ).toHaveCount(0);
});
