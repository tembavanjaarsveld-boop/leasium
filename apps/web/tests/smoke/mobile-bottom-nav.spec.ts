import { expect, type Locator, type Page, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

async function expectMobileTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
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
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("mobile production routes keep headings and bottom navigation in frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const route of [
    { path: "/", heading: "Today's focus" },
    { path: "/operations", heading: "Work" },
    { path: "/properties", heading: "Properties" },
    { path: "/intake", heading: "Smart Intake" },
    { path: "/notifications", heading: "Notifications" },
    { path: "/settings", heading: "Settings" },
  ]) {
    await page.goto(route.path);

    await expect(
      page.getByRole("heading", { name: route.heading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Mobile primary" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("mobile bottom navigation exposes the Horizon field-operator hubs", async ({
  page,
}) => {
  const forbiddenProviderRequests = watchForbiddenProviderRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations");

  const mobileNav = page.getByRole("navigation", { name: "Mobile primary" });
  await expect(mobileNav).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const links = mobileNav.getByRole("link");
  await expect(links).toHaveCount(5);

  for (const label of ["Home", "Properties", "Smart Intake", "Work", "Money"]) {
    await expect(mobileNav.getByRole("link", { name: label })).toBeVisible();
    await expectMobileTouchTarget(mobileNav.getByRole("link", { name: label }));
  }

  await expect(
    mobileNav.getByRole("link", { name: "People" }),
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
  const mobileDrawer = page.getByRole("complementary", {
    name: "Primary navigation",
  });
  await expect(
    mobileDrawer
      .getByRole("group", { name: "Workspace switcher" })
      .getByLabel("Entity"),
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

test("desktop Horizon sidebar exposes the entity switcher and operator card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/operations");

  const sidebar = page.getByRole("complementary", {
    name: "Primary navigation",
  });
  await expect(sidebar).toBeVisible();

  const switcher = sidebar.getByRole("group", { name: "Workspace switcher" });
  await expect(switcher).toBeVisible();
  await expect(switcher.getByLabel("Entity")).toHaveValue("entity-1");
  await expect(
    switcher.getByText("Acme Holdings", { exact: true }),
  ).toBeVisible();

  const primaryNav = sidebar.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("link")).toHaveCount(8);
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
      primaryNav.getByRole("link", { name: new RegExp(`^${label}`) }),
    ).toBeVisible();
  }
  await expect(primaryNav.getByRole("link", { name: /^Work/ })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const operatorCard = sidebar.getByTestId("horizon-sidebar-user");
  await expect(operatorCard).toContainText("Owner Operator");
  await expect(operatorCard).toContainText("Owner - operator");

  await expectNoHorizontalOverflow(page);
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

test("mobile shortcut hint clears the fixed bottom navigation", async ({
  page,
}) => {
  const forbiddenProviderRequests = watchForbiddenProviderRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations");

  const mobileNav = page.getByRole("navigation", { name: "Mobile primary" });
  await expect(mobileNav).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Work", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeHidden();

  await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  });
  await page.keyboard.press("g");
  const shortcutHint = page.getByText(/^G.*press a letter to jump/);
  await expect(shortcutHint).toBeVisible();

  const hintBox = await shortcutHint.boundingBox();
  const navBox = await mobileNav.boundingBox();
  expect(hintBox).toBeTruthy();
  expect(navBox).toBeTruthy();
  expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(navBox!.y - 8);
  expect(forbiddenProviderRequests).toEqual([]);
});

test("mobile keyboard shortcuts overlay keeps controls touch-safe above bottom nav", async ({
  page,
}) => {
  const forbiddenProviderRequests = watchForbiddenProviderRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations");

  const mobileNav = page.getByRole("navigation", { name: "Mobile primary" });
  await expect(mobileNav).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Work", exact: true }),
  ).toBeVisible();

  await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  });
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();

  const closeShortcuts = dialog.getByRole("button", {
    name: "Close shortcuts",
  });
  await page.waitForFunction(() => {
    const button = document.querySelector(
      'button[aria-label="Close shortcuts"]',
    );
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    return rect.width >= 44 && rect.height >= 44;
  });
  await expectMobileTouchTarget(closeShortcuts);

  const dialogBox = await dialog.boundingBox();
  const navBox = await mobileNav.boundingBox();
  expect(dialogBox).toBeTruthy();
  expect(navBox).toBeTruthy();
  expect(dialogBox!.y + dialogBox!.height).toBeLessThan(navBox!.y);
  expect(forbiddenProviderRequests).toEqual([]);
});

test("mobile command search overlay keeps controls touch-safe above bottom nav", async ({
  page,
}) => {
  const forbiddenProviderRequests = watchForbiddenProviderRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations");

  const mobileNav = page.getByRole("navigation", { name: "Mobile primary" });
  await expect(mobileNav).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Work", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open search" }).click();
  const dialog = page.getByRole("dialog", { name: "Command search" });
  await expect(dialog).toBeVisible();

  const commandInput = dialog.getByRole("textbox", {
    name: "Command search",
  });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Command search"]');
    if (!input) return false;
    const rect = input.getBoundingClientRect();
    return rect.width >= 44 && rect.height >= 44;
  });
  await expectMobileTouchTarget(commandInput);

  const closeSearch = dialog.getByRole("button", { name: "Close search" });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Close search"]');
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    return rect.width >= 44 && rect.height >= 44;
  });
  await expectMobileTouchTarget(closeSearch);

  const dialogBox = await dialog.boundingBox();
  const navBox = await mobileNav.boundingBox();
  expect(dialogBox).toBeTruthy();
  expect(navBox).toBeTruthy();
  expect(dialogBox!.y + dialogBox!.height).toBeLessThan(navBox!.y);
  expect(forbiddenProviderRequests).toEqual([]);
});
