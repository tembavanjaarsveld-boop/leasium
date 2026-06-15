import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

// Regression: the rent roll stores annual_rent_cents (the ANNUAL rent). The
// rent column must show the PER-PERIOD amount matching the frequency, not the
// annual total with a per-period label. The fixture row is $96,000/yr paid
// monthly → it must read $8,000 monthly, never "$96,000 monthly".
test("billing readiness shows per-period rent, not the annual total", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/billing-readiness");

  const table = page.locator("table").first();
  await expect(table.getByText("$8,000").first()).toBeVisible();
  await expect(table.getByText("$96,000")).toHaveCount(0);
});
