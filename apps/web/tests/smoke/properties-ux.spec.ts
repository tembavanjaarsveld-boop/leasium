import { expect, type Locator, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

async function expectTouchTarget(locator: Locator, minSize = 44) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("mobile properties loading copy stays contextual", async ({ page }) => {
  await page.route("**/api/v1/premises/by-entity/entity-1**", async () => {
    await new Promise(() => {});
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/properties");

  await expect(page.getByText("Checking properties").first()).toBeVisible();
  await expect(page.getByText(/Loading(?:\.\.\.|…)/)).toHaveCount(0);
});

test("mobile properties default uses cards instead of a panning table", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toBeVisible();
  await expect(page.getByRole("table").first()).toBeHidden();

  const mobileList = page.getByRole("list", { name: "Property cards" });
  await expect(mobileList).toBeVisible();

  const card = mobileList
    .getByRole("listitem")
    .filter({ hasText: "Queen Street Retail Centre" });
  await expect(card).toContainText("12 Queen Street, Brisbane City QLD");
  await expect(card).toContainText("commercial retail");
  await expect(card).toContainText("640 sqm");
  await expect(card).toContainText("12 parks");

  const selectButton = card.getByRole("button", {
    name: /Open property Queen Street Retail Centre/,
  });
  const editButton = card.getByRole("button", {
    name: "Edit Queen Street Retail Centre",
  });
  await expectTouchTarget(selectButton);
  await expectTouchTarget(editButton);
});
