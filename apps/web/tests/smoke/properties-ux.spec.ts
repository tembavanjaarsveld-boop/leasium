import { expect, type Locator, test } from "@playwright/test";

import type { PropertyRecord } from "../../src/lib/api";
import {
  propertyMatchesOwnershipTag,
  propertyOwnershipBadges,
} from "../../src/lib/property-ownership";
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

test("properties table density toggle trims row padding in compact mode", async ({
  page,
}) => {
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toBeVisible();

  const densityGroup = page.getByRole("group", { name: "Table row density" });
  await expect(densityGroup).toBeVisible();
  const comfortable = densityGroup.getByRole("button", {
    name: "Comfortable",
  });
  const compact = densityGroup.getByRole("button", { name: "Compact" });

  // Comfortable is the unchanged default; its cells keep the py-3 padding.
  await expect(comfortable).toHaveAttribute("aria-pressed", "true");
  const firstCell = page
    .getByRole("table")
    .first()
    .locator("tbody tr")
    .first()
    .locator("td")
    .first();
  await expect(firstCell).toHaveClass(/py-3/);

  // Compact mode swaps the row cells to the tighter py-1.5 padding and
  // persists the choice in localStorage.
  await compact.click();
  await expect(compact).toHaveAttribute("aria-pressed", "true");
  await expect(firstCell).toHaveClass(/py-1\.5/);
  await expect(firstCell).not.toHaveClass(/py-3/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("leasium.properties.density"),
      ),
    )
    .toBe("compact");
});

test("property owner chips display ownership chains with cleaner arrows", async () => {
  const property = {
    ownership_structure: "split",
    ownership_split: "50% Queen Street Property Trust -> Trustee Pty Ltd",
    owner_legal_name: null,
    trust_name: null,
    invoice_issuer_name: null,
    metadata: {},
  } as PropertyRecord;

  const [badge] = propertyOwnershipBadges(property, "Acme Holdings Pty Ltd");

  expect(badge).toMatchObject({
    label: "Queen Street Property Trust › Trustee Pty Ltd",
    tagKey: "queen street property trust -> trustee pty ltd",
    title: "Queen Street Property Trust -> Trustee Pty Ltd",
  });
  expect(
    propertyMatchesOwnershipTag(
      property,
      "Acme Holdings Pty Ltd",
      "queen street property trust -> trustee pty ltd",
    ),
  ).toBe(true);
});
