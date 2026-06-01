import { expect, type Locator, type Page, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

async function expectMobileTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

function watchForbiddenProviderRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const callsProvider =
      path.includes("/sendgrid") ||
      path.includes("/twilio") ||
      path.includes("/provider-dispatch") ||
      path.includes("/provider-refresh") ||
      path.includes("/provider-history") ||
      path.includes("/xero/") ||
      path.includes("/basiq") ||
      path.includes("/payments/reconciliation");
    if (callsProvider) {
      requests.push(`${request.method()} ${url.toString()}`);
    }
  });
  return requests;
}

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("mobile bottom navigation exposes the field-operator hubs", async ({
  page,
}) => {
  const forbiddenProviderRequests = watchForbiddenProviderRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations");

  const mobileNav = page.getByRole("navigation", { name: "Mobile primary" });
  await expect(mobileNav).toBeVisible();
  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  const links = mobileNav.getByRole("link");
  await expect(links).toHaveCount(5);

  for (const label of ["Dashboard", "Properties", "People", "Work", "Money"]) {
    await expect(mobileNav.getByRole("link", { name: label })).toBeVisible();
    await expectMobileTouchTarget(mobileNav.getByRole("link", { name: label }));
  }

  await expect(
    mobileNav.getByRole("link", { name: "Smart Intake" }),
  ).toHaveCount(0);
  await expect(mobileNav.getByRole("link", { name: "Insights" })).toHaveCount(
    0,
  );
  await expect(mobileNav.getByRole("link", { name: "Settings" })).toHaveCount(
    0,
  );
  await expect(mobileNav.getByRole("link", { name: "Work" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const navBox = await mobileNav.boundingBox();
  expect(navBox).toBeTruthy();
  expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(844);
  expect(navBox!.y).toBeGreaterThan(740);

  await page.getByRole("button", { name: "Open navigation" }).click();
  const fullMobileNav = page.getByRole("navigation", { name: /^Primary$/ });
  await expect(fullMobileNav.getByRole("link")).toHaveCount(8);
  for (const label of [
    "Dashboard",
    "Smart Intake",
    "Properties",
    "People",
    "Work",
    "Money",
    "Insights",
    "Settings",
  ]) {
    await expect(
      fullMobileNav.getByRole("link", { name: new RegExp(`^${label}`) }),
    ).toBeVisible();
    await expectMobileTouchTarget(
      fullMobileNav.getByRole("link", { name: new RegExp(`^${label}`) }),
    );
  }
  for (const foldedLabel of [
    "Tenants",
    "Billing",
    "Statements",
    "Comms",
    "Contractors",
    "Portfolio QA",
    "AI Inbox",
  ]) {
    await expect(
      fullMobileNav.getByRole("link", {
        name: new RegExp(`^${foldedLabel}`),
      }),
    ).toHaveCount(0);
  }
  await expect(
    fullMobileNav.getByRole("link", { name: /^Smart Intake/ }),
  ).toBeVisible();
  await expect(
    fullMobileNav.getByRole("link", { name: /^Insights/ }),
  ).toBeVisible();
  await expect(
    fullMobileNav.getByRole("link", { name: /^Settings/ }),
  ).toBeVisible();
  await fullMobileNav.getByRole("link", { name: /^People/ }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeHidden();

  await mobileNav.getByRole("link", { name: "Money" }).click();
  await expect(page).toHaveURL(/\/money$/);
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
  expect(forbiddenProviderRequests).toEqual([]);
});

test("desktop keeps the bottom navigation out of the shell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  await expect(
    page.getByRole("navigation", { name: "Mobile primary" }),
  ).toHaveCount(0);
});
