import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { mockLeasiumApi } from "./api-mocks";

test.use({ colorScheme: "dark" });

const clerkAppearancePath = path.join(
  process.cwd(),
  "src/lib/clerk-appearance.ts",
);
const rootLayoutPath = path.join(process.cwd(), "src/app/layout.tsx");
const uiComponentsPath = path.join(process.cwd(), "src/components/ui.tsx");

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

type AppearanceMode = "system" | "light" | "dark";
type ResolvedAppearance = "light" | "dark";

async function expectAppearance(
  page: import("@playwright/test").Page,
  mode: AppearanceMode,
  resolved: ResolvedAppearance,
) {
  await expectRootAppearance(page, mode, resolved);
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("leasium.appearance")),
    )
    .toBe(mode);
}

async function expectRootAppearance(
  page: import("@playwright/test").Page,
  mode: AppearanceMode,
  resolved: ResolvedAppearance,
) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", resolved);
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    mode,
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.colorScheme),
    )
    .toBe(resolved);

  if (resolved === "dark") {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  } else {
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  }
}

test("appearance defaults to system and follows dark OS", async ({ page }) => {
  await page.goto("/");

  await expectAppearance(page, "system", "dark");

  const appearanceButton = page
    .getByRole("toolbar", { name: "Workspace utilities" })
    .getByRole("button", { name: /Appearance: system/ });
  await expect(appearanceButton).toBeVisible();
  await expect(appearanceButton).toBeEnabled();
});

test("appearance header toggle cycles system, light, and dark", async ({
  page,
}) => {
  await page.goto("/");

  const appearanceButton = page
    .getByRole("toolbar", { name: "Workspace utilities" })
    .getByRole("button", { name: /Appearance:/ });

  await expectAppearance(page, "system", "dark");
  await appearanceButton.click();
  await expectAppearance(page, "light", "light");
  await appearanceButton.click();
  await expectAppearance(page, "dark", "dark");
  await appearanceButton.click();
  await expectAppearance(page, "system", "dark");
});

test("appearance applies stored dark preference even under light OS", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.appearance", "dark");
  });

  await page.goto("/");

  await expectAppearance(page, "dark", "dark");
});

test("manual appearance changes hold when storage persistence is blocked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.appearance", "system");
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === "leasium.appearance") {
        throw new Error("Appearance storage blocked");
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await page.goto("/");

  await expectRootAppearance(page, "system", "dark");
  await page
    .getByRole("toolbar", { name: "Workspace utilities" })
    .getByRole("button", { name: /Appearance:/ })
    .click();

  await expectRootAppearance(page, "light", "light");
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("leasium.appearance")),
    )
    .toBe("system");

  await page.emulateMedia({ colorScheme: "light" });
  await expectRootAppearance(page, "light", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectRootAppearance(page, "light", "light");
});

test("settings appearance can choose light, dark, and system", async ({
  page,
}) => {
  await page.goto("/settings");

  const appearancePanel = page
    .getByText("Choose a workspace appearance or follow this device.")
    .locator("xpath=ancestor::section[1]");
  await expect(appearancePanel).toBeVisible();
  await expect(page.getByText("Locked for the MVP workspace.")).toHaveCount(0);
  await expect(
    page.getByText("Light workspace appearance for the MVP release."),
  ).toHaveCount(0);
  await expect(page.getByText("System active")).toBeVisible();
  await expect(page.getByRole("button", { name: /^System/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Light/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Dark/ })).toBeVisible();
  const appearanceButtons = appearancePanel.getByRole("button", {
    name: /^(System|Light|Dark) appearance/,
  });
  await expect(appearanceButtons).toHaveCount(3);
  await expectAppearance(page, "system", "dark");

  await page.getByRole("button", { name: /^Light/ }).click();
  await expectAppearance(page, "light", "light");
  await expect(page.getByText("Light active")).toBeVisible();

  await page.getByRole("button", { name: /^Dark/ }).click();
  await expectAppearance(page, "dark", "dark");
  await expect(page.getByText("Dark active")).toBeVisible();

  await page.getByRole("button", { name: /^System/ }).click();
  await expectAppearance(page, "system", "dark");
  await expect(page.getByText("System active")).toBeVisible();

  const appearancePanelBox = await appearancePanel.boundingBox();
  expect(appearancePanelBox?.height).toBeLessThan(180);
  expect(appearancePanelBox?.width).toBeLessThan(900);
  const appearanceButtonBoxes = await appearanceButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height),
  );
  expect(appearanceButtonBoxes.every((height) => height >= 44)).toBe(true);
});

test("dark mode renders the core operator surfaces on desktop and mobile", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.appearance", "dark");
  });

  const surfaces = [
    { path: "/", heading: "Today's focus" },
    { path: "/intake", heading: "Smart Intake" },
    { path: "/properties", heading: "Acme Holdings Pty Ltd" },
    { path: "/people?tab=tenants", heading: "People" },
    { path: "/operations", heading: "Operations" },
    { path: "/notifications", heading: "Notifications" },
    { path: "/settings", heading: "Settings" },
  ];

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const surface of surfaces) {
      await page.goto(surface.path);
      await expectAppearance(page, "dark", "dark");
      await expect(
        page
          .locator("main")
          .getByRole("heading", { name: surface.heading })
          .first(),
      ).toBeVisible();

      const colors = await page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement);
        const bodyStyle = getComputedStyle(document.body);
        const toolbar = document.querySelector(
          '[aria-label="Workspace utilities"]',
        );
        const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
        return {
          darkCanvas: rootStyle.getPropertyValue("--leasium-bg").trim(),
          bodyBackground: bodyStyle.backgroundColor,
          bodyText: bodyStyle.color,
          toolbarBackground: toolbarStyle?.backgroundColor ?? null,
        };
      });
      expect(colors.darkCanvas).toBe("#0d1424");
      expect(colors.bodyBackground).toBe("rgb(13, 20, 36)");
      expect(colors.bodyText).toBe("rgb(230, 234, 243)");
      expect(colors.toolbarBackground).not.toBe("rgba(255, 255, 255, 0.9)");
      expect(colors.toolbarBackground).not.toBe("rgb(255, 255, 255)");
    }
  }
});

test("neutral chip soft tone keeps readable text in dark", async ({
  page,
}) => {
  // Read the canonical neutral soft class string straight from chipClass()
  // so this test tracks the source instead of a copy that can drift.
  const uiSource = await readFile(uiComponentsPath, "utf8");
  const neutralSoftMatch = uiSource.match(
    /neutral:\s*\{[\s\S]*?soft:\s*"([^"]+)"/,
  );
  expect(neutralSoftMatch).not.toBeNull();
  const neutralSoftClasses = neutralSoftMatch![1];

  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.appearance", "dark");
  });
  await page.goto("/");
  await expectAppearance(page, "dark", "dark");

  const probeChip = (classes: string) =>
    page.evaluate((chipClasses) => {
      const probe = document.createElement("span");
      probe.className = `inline-flex items-center rounded-full ${chipClasses}`;
      probe.textContent = "Neutral";
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      const colors = {
        background: style.backgroundColor,
        color: style.color,
      };
      probe.remove();
      return colors;
    }, classes);

  // .bg-muted overrides to dark Slate 100 (#182133) in dark; the chip text
  // must resolve to the dark Slate 500 token (#aab5c8). The light #475467
  // reads at roughly 2.2:1 on that fill and fails AA.
  const chipColors = await probeChip(neutralSoftClasses);
  expect(chipColors.background).toBe("rgb(24, 33, 51)");
  expect(chipColors.color).toBe("rgb(170, 181, 200)");

  // Inline neutral-chip copies (evidence drawer, settings, billing
  // readiness) still pin the static light slate-500 utility; the scoped
  // .bg-muted.text-leasium-slate-500 dark override must catch them too.
  const legacyChipColors = await probeChip("bg-muted text-leasium-slate-500");
  expect(legacyChipColors.background).toBe("rgb(24, 33, 51)");
  expect(legacyChipColors.color).toBe("rgb(170, 181, 200)");
});

test("Clerk auth screens pin light appearance tokens", async () => {
  const source = await readFile(clerkAppearancePath, "utf8");

  expect(source).toContain("variables:");
  expect(source).toContain("colorBackground");
  expect(source).toContain("colorInputBackground");
  expect(source).toContain("colorText");
  expect(source).toContain("colorTextSecondary");
  expect(source).toContain("colorPrimary");
  expect(source).toContain("formFieldInput");
  expect(source).toContain("bg-white text-foreground");
  expect(source).toContain("formButtonPrimary");
  expect(source).toContain("bg-primary");
});

test("first-paint appearance script applies root theme before storage persistence", async () => {
  const source = await readFile(rootLayoutPath, "utf8");
  const themeApplyIndex = source.indexOf(
    "document.documentElement.dataset.theme = resolved",
  );
  const persistenceIndex = source.indexOf(
    "window.localStorage.setItem(key, mode)",
  );

  expect(themeApplyIndex).toBeGreaterThan(-1);
  expect(persistenceIndex).toBeGreaterThan(-1);
  expect(themeApplyIndex).toBeLessThan(persistenceIndex);
});
