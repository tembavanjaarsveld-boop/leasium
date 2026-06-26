import { expect, type Locator, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

async function expectContrast(control: Locator, minRatio = 4.5) {
  await control.scrollIntoViewIfNeeded();
  const ratio = await control.evaluate((element) => {
    function parseColor(value: string) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const [r, g, b, alpha] = match[1]
        .split(",")
        .map((part) => Number(part.trim()));
      return { r, g, b, alpha: Number.isFinite(alpha) ? alpha : 1 };
    }

    function blend(
      foreground: { r: number; g: number; b: number; alpha: number },
      background: { r: number; g: number; b: number; alpha: number },
    ) {
      const alpha = foreground.alpha;
      return {
        r: foreground.r * alpha + background.r * (1 - alpha),
        g: foreground.g * alpha + background.g * (1 - alpha),
        b: foreground.b * alpha + background.b * (1 - alpha),
        alpha: 1,
      };
    }

    function effectiveBackground(start: Element) {
      let background = { r: 255, g: 255, b: 255, alpha: 1 };
      const chain: Element[] = [];
      for (let node: Element | null = start; node; node = node.parentElement) {
        chain.unshift(node);
      }
      for (const node of chain) {
        const color = parseColor(getComputedStyle(node).backgroundColor);
        if (color && color.alpha > 0) {
          background =
            color.alpha < 1 ? blend(color, background) : { ...color, alpha: 1 };
        }
      }
      return background;
    }

    function luminance(color: { r: number; g: number; b: number }) {
      const channel = (value: number) => {
        const normalised = value / 255;
        return normalised <= 0.03928
          ? normalised / 12.92
          : Math.pow((normalised + 0.055) / 1.055, 2.4);
      };
      return (
        0.2126 * channel(color.r) +
        0.7152 * channel(color.g) +
        0.0722 * channel(color.b)
      );
    }

    const foreground = parseColor(getComputedStyle(element).color);
    if (!foreground) return 0;
    const background = effectiveBackground(element);
    const blendedForeground =
      foreground.alpha < 1 ? blend(foreground, background) : foreground;
    const foregroundLuminance = luminance(blendedForeground);
    const backgroundLuminance = luminance(background);
    const light = Math.max(foregroundLuminance, backgroundLuminance);
    const dark = Math.min(foregroundLuminance, backgroundLuminance);
    return (light + 0.05) / (dark + 0.05);
  });

  expect(ratio).toBeGreaterThanOrEqual(minRatio);
}

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("sidebar consolidates to seven hubs plus Settings", async ({ page }) => {
  await page.goto("/");

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("link")).toHaveCount(8);

  for (const label of [
    "Dashboard",
    "Relby AI",
    "Properties",
    "People",
    "Work",
    "Money",
    "Insights",
  ]) {
    await expect(
      primaryNav.getByRole("link", { name: new RegExp(`^${label}`) }),
    ).toBeVisible();
  }

  await expect(
    primaryNav.getByRole("link", { name: /^Settings/ }),
  ).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: /^Tenants/ })).toHaveCount(
    0,
  );
  await expect(primaryNav.getByRole("link", { name: /^Billing/ })).toHaveCount(
    0,
  );

  await primaryNav.getByRole("link", { name: /^People/ }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  await page.goto("/");
  await primaryNav.getByRole("link", { name: /^Money/ }).click();
  await expect(page).toHaveURL(/\/money$/);
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
});

test("desktop sidebar account card stays touch-safe without shortcut chrome", async ({
  page,
}) => {
  await page.goto("/");

  const sidebar = page.getByRole("complementary", {
    name: "Primary navigation",
  });
  await expect(
    sidebar.getByRole("button", { name: "Keyboard shortcuts ?" }),
  ).toHaveCount(0);
  await expectTouchTarget(sidebar.getByTestId("horizon-sidebar-user"));
});

test("operator shell muted text and urgent badges keep readable contrast", async ({
  page,
}) => {
  await page.goto("/comms");

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expectContrast(
    page.getByTestId("horizon-sidebar-user").getByText("Owner Operator"),
  );

  const workLink = primaryNav.getByRole("link", {
    name: "Work, 9 drafts in the comms queue, 3 urgent",
  });
  await expectContrast(workLink.locator("span").filter({ hasText: /^3$/ }));
  await expectContrast(
    page
      .getByRole("tab", { name: /All drafts \d+/ })
      .locator("span")
      .last(),
  );

  await page.goto("/billing-readiness?tab=delivery");
  await expectContrast(page.getByText("Send invoices, then track payment"));
  await expectContrast(
    page
      .getByRole("button", { name: /All \d+/ })
      .locator("span")
      .last(),
  );

  await page.goto("/operations?tab=compliance");
  await expectContrast(page.getByText("Checks and inspections"));

  await page.goto("/settings?tab=security");
  await expectContrast(
    page.getByRole("button", { name: "Deactivate" }).first(),
  );
  await page.goto("/settings?tab=organisation");
  await expectContrast(page.getByRole("tab", { name: "People & access" }));
  const organisationTab = page.getByRole("tab", { name: "Organisation" });
  await expectContrast(organisationTab);
  await expect(organisationTab).not.toHaveCSS("transition-property", /color/);
  await expect(organisationTab).not.toHaveCSS(
    "transition-property",
    /background-color/,
  );
  await page.goto("/settings?tab=xero");
  await expectContrast(page.getByRole("tab", { name: "Integrations" }));

  await page.goto("/people");
  await expectContrast(
    page.getByText("Tenants and vendors across the portfolio."),
  );
});

test("people hub keeps tenants and vendors inline", async ({ page }) => {
  await page.goto("/people?tab=tenants");

  await expect(page.getByRole("tab", { name: "Tenants" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Bright Cafe Pty Ltd")).toBeVisible();
  await expect(page.getByText("Billing ready")).toBeVisible();
  await expect(page.getByText("Portal active")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open tenant workspace/i }),
  ).toHaveCount(0);

  await page.getByRole("tab", { name: "Vendors" }).click();
  await expect(page.getByRole("tab", { name: "Vendors" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText("Bright Spark Electrical", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("electrical", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Bright Spark Electrical" })
      .getByText("Preferred"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open vendor directory/i }),
  ).toHaveCount(0);

  await page.goto("/people/vendors");
  await expect(page).toHaveURL(/\/people\?tab=vendors$/);
  await expect(page.getByRole("tab", { name: "Vendors" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("money hub groups finance destinations and legacy links still resolve", async ({
  page,
}) => {
  await page.goto("/money");

  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
  await expect(
    page.getByText("Billing readiness, arrears, and Xero"),
  ).toBeVisible();

  for (const label of ["THIS MONTH", "COLLECTED", "ARREARS", "XERO"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByText("INVOICE RUN", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("No blockers")).toBeVisible();
  await expect(
    page.getByText("Drafts only - nothing posts to Xero or sends without you."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reconcile payments" }),
  ).toHaveAttribute("href", "/billing-readiness?tab=delivery");
  await expect(page.getByRole("link", { name: "Run invoices" })).toHaveAttribute(
    "href",
    "/billing-readiness?tab=delivery",
  );
  await expect(page.getByRole("link", { name: /Approve run/ })).toHaveAttribute(
    "href",
    "/billing-readiness?tab=delivery",
  );
  await expect(
    page.getByText("Entity statements", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("dispatch review")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open entity statements" }),
  ).toHaveAttribute("href", "/statements");
  await expect(
    page.getByRole("link", { name: "Open Xero settings" }),
  ).toHaveAttribute("href", "/settings?tab=xero");
  await expect(
    page.getByRole("link", { name: "Open Basiq controls" }),
  ).toHaveCount(0);
  await expect(page.getByText("Basiq")).toHaveCount(0);

  await page.goto("/billing-readiness");
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();

  await page.goto("/statements");
  await expect(
    page.getByRole("heading", { name: "Entity statements" }),
  ).toBeVisible();

  await page.goto("/money/statements");
  await expect(page).toHaveURL(/\/statements$/);

  await page.goto("/work/comms");
  await expect(page).toHaveURL(/\/comms$/);
});

test("mobile money hub cockpit actions stay touch-safe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/money");

  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();

  await expect(
    page.getByRole("tablist", { name: "Money areas" }),
  ).toHaveCount(0);
  await expect(page.getByText("INVOICE RUN", { exact: false })).toBeVisible();
  await expect(page.getByText("Drafts only - nothing posts")).toBeVisible();
  await expectTouchTarget(page.getByRole("link", { name: "Reconcile payments" }));
  await expectTouchTarget(page.getByRole("link", { name: "Run invoices" }));
  await expectTouchTarget(
    page.getByRole("link", { name: /Approve run/ }),
  );
});

test("money hub keeps owner-statement dispatch framing for managing agents", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.goto("/money?tab=statements");

  await expect(
    page.getByText("Owner statements", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("dispatch review")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open owner statements" }),
  ).toHaveAttribute("href", "/statements");
});

test("money hub loads review data without provider mutation calls", async ({
  page,
}) => {
  const forbiddenCalls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/v1/")) return;
    const path = url.pathname.replace("/api/v1", "");
    const unsafeMethod = request.method() !== "GET";
    const unsafePath =
      /sendgrid|twilio|provider-dispatch|provider-history|provider-refresh|xero|basiq|payment|reconciliation|send-delivery-email|record-delivery|prepare-delivery/i.test(
        path,
      );
    if (unsafeMethod && unsafePath) {
      forbiddenCalls.push(`${request.method()} ${path}`);
    }
  });

  await page.goto("/money");

  await expect(
    page.getByText("Drafts only - nothing posts to Xero or sends without you."),
  ).toBeVisible();
  expect(forbiddenCalls).toEqual([]);
});
