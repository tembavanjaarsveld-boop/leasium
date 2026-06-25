import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("settings surfaces mis-filed properties and re-files them in review", async ({
  page,
}) => {
  // Inject a mis-filed suggestion: a property filed under Acme whose owner
  // label points at the Secondary Holdings trust.
  await page.route(
    "**/api/v1/entities/reassign-suggestions",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          groups: [
            {
              target_entity_id: "entity-2",
              target_entity_name: "Secondary Holdings Pty Ltd",
              owner_label: "Secondary Holdings Pty Ltd",
              property_ids: ["property-7"],
              property_count: 1,
            },
          ],
          suggested_property_count: 1,
        }),
      });
    },
  );

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Organisation" }).click();
  await page.getByRole("tab", { name: /^Entities\b/ }).click();

  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Looks mis-filed" }) });
  await expect(panel).toBeVisible();
  const row = panel.getByTestId("reassign-suggestion-row");
  await expect(row).toContainText("Secondary Holdings Pty Ltd");

  await row.getByTestId("reassign-suggestion-review").click();

  const drawer = page.getByTestId("property-entity-reassign-drawer");
  await expect(drawer).toBeVisible();
  // The preset target auto-previews; the summary shows what moves.
  await expect(drawer.getByTestId("reassign-preview-summary")).toBeVisible();
  await expect(drawer.getByTestId("reassign-preview-summary")).toContainText(
    "Moving 1 property",
  );

  await drawer.getByTestId("reassign-confirm").click();
  await expect(drawer.getByTestId("reassign-applied-summary")).toBeVisible();
  await expect(drawer.getByTestId("reassign-applied-summary")).toContainText(
    "Moved 1 property",
  );
});

test("property editor moves a property to a different entity", async ({
  page,
}) => {
  await page.goto("/properties?entity_id=entity-1&property_id=property-1");

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "Edit property", exact: true }),
  ).toBeVisible();

  await page.getByTestId("property-move-entity").click();

  const drawer = page.getByTestId("property-entity-reassign-drawer");
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("reassign-target-select").selectOption("entity-2");
  await expect(drawer.getByTestId("reassign-preview-summary")).toBeVisible();

  await drawer.getByTestId("reassign-confirm").click();
  await expect(drawer.getByTestId("reassign-applied-summary")).toBeVisible();
});
