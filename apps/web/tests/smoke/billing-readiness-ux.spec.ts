import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test("mobile billing readiness uses calm loading KPIs and review draft cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);

  let delayedRentRoll = true;
  await page.route("**/api/v1/rent-roll?**", async (route) => {
    if (delayedRentRoll) {
      delayedRentRoll = false;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.fallback();
  });

  await page.goto("/billing-readiness");

  const kpis = page.locator("section").filter({ hasText: "Ready to bill" });
  await expect(kpis).toBeVisible();
  await expect(kpis.getByText("...", { exact: true })).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Review drafts/ }).click();

  const mobileDraftCard = page
    .getByTestId("billing-draft-mobile-card")
    .filter({ hasText: "May rent and outgoings" })
    .first();
  await expect(mobileDraftCard).toBeVisible();
  await expect(mobileDraftCard.getByText("$8,800")).toBeVisible();
  await expect(
    mobileDraftCard.getByRole("link", { name: /Intake intake-1/ }),
  ).toHaveAttribute("href", "/intake?entity_id=entity-1&review=intake-1");
  await expect(
    mobileDraftCard.getByRole("button", { name: "Approve" }),
  ).toBeVisible();
});

test("mobile billing operations expose invoice and delivery cards without raw placeholders", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);

  await page.goto("/billing-readiness");
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Approve invoices/ }).click();
  const invoicePrepCard = page
    .getByTestId("invoice-prep-mobile-card")
    .filter({ hasText: "INV-1001" })
    .first();
  await expect(invoicePrepCard).toBeVisible();
  await expect(invoicePrepCard.getByText("Bright Cafe Pty Ltd")).toBeVisible();
  await expect(invoicePrepCard.getByText("$8,800")).toBeVisible();
  const previewLink = invoicePrepCard.getByRole("link", { name: "Preview" });
  await expect(previewLink).toBeVisible();
  const previewBox = await previewLink.boundingBox();
  expect(previewBox?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
  const deliveryCard = page
    .getByTestId("billing-delivery-mobile-card")
    .filter({ hasText: "INV-1002" })
    .first();
  await expect(deliveryCard).toBeVisible();
  await expect(deliveryCard.getByText("Recovery needed #1")).toBeVisible();
  const retryDispatchButton = deliveryCard.getByRole("button", {
    name: "Retry dispatch",
  });
  await expect(retryDispatchButton).toBeVisible();
  const retryBox = await retryDispatchButton.boundingBox();
  expect(retryBox?.height).toBeGreaterThanOrEqual(44);

  await expect(page.locator("body")).not.toContainText(/\.\.\.|Loading\.\.\./);
});
