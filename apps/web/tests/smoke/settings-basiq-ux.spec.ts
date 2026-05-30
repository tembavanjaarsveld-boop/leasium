import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

function watchBasiqApplyRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/basiq/reconciliation-apply/")
    ) {
      requests.push(request.url());
    }
  });
  return requests;
}

test("Basiq apply only fires for approved transactions and is gated", async ({
  page,
}) => {
  const applyRequests = watchBasiqApplyRequests(page);
  await mockLeasiumApi(page);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Xero" }).click();

  const basiqPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Bank feed (Basiq)" }),
    })
    .first();
  await expect(basiqPanel).toBeVisible();

  // Build the imported transaction array via the mini-form.
  await basiqPanel.getByLabel("Amount (AUD)").fill("8800.00");
  await basiqPanel.getByLabel("Posted date").fill("2026-05-19");
  await basiqPanel.getByLabel("Reference").fill("INV-1001");
  await basiqPanel.getByRole("button", { name: "Add transaction" }).click();

  // Preview renders the ready row before anything is applied.
  await basiqPanel.getByRole("button", { name: "Preview" }).click();
  await expect(basiqPanel.getByText("ready", { exact: true })).toBeVisible();
  await expect(basiqPanel.getByText("high confidence")).toBeVisible();
  await expect(
    basiqPanel.getByText("Basiq not connected"),
  ).toBeVisible();

  // Apply is gated until at least one row is approved, and no request fires.
  const applyButton = basiqPanel.getByRole("button", {
    name: "Apply approved transactions",
  });
  await expect(applyButton).toBeDisabled();
  expect(applyRequests).toHaveLength(0);

  // The guardrail strip is visible in the review state.
  await expect(
    basiqPanel.getByText(
      "Imported transactions not approved by an operator are skipped.",
    ),
  ).toBeVisible();

  // Approve the ready row, then Apply.
  await basiqPanel.getByRole("checkbox").check();
  await expect(applyButton).toBeEnabled();
  await applyButton.click();

  await expect(basiqPanel.getByText("applied", { exact: true })).toBeVisible();
  await expect(
    basiqPanel.getByText("Payment status was reconciled locally."),
  ).toBeVisible();
  expect(applyRequests).toHaveLength(1);
});
