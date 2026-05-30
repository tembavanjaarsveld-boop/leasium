import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.use({ colorScheme: "dark" });

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

async function expectLightAppearance(page: import("@playwright/test").Page) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "light",
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("leasium.appearance")),
    )
    .toBe("light");
}

test("MVP appearance defaults to light under dark OS", async ({ page }) => {
  await page.goto("/");

  await expectLightAppearance(page);
});

test("MVP appearance sanitizes stale system preference", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.appearance", "system");
  });

  await page.goto("/");

  await expectLightAppearance(page);
});

test("MVP appearance stays light under dark OS and stale dark preference", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.appearance", "dark");
  });

  await page.goto("/");

  await expectLightAppearance(page);

  const appearanceButton = page
    .getByRole("toolbar", { name: "Workspace utilities" })
    .getByRole("button", { name: /Appearance: light/ });
  await expect(appearanceButton).toBeVisible();
  await expect(appearanceButton).toBeDisabled();
  await expectLightAppearance(page);
  await expect(
    page.getByRole("button", { name: /Appearance: (dark|system)/ }),
  ).toHaveCount(0);

  await page.goto("/settings");

  await expect(page.getByText("Light active")).toBeVisible();
  await expect(page.getByRole("button", { name: /^System$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Dark$/ })).toHaveCount(0);
});
