import { expect, type Page, test } from "@playwright/test";
import path from "node:path";
import { mkdir } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

const screenshotDir = path.resolve(
  process.cwd(),
  "../../output/ux/leasium-ai-conversation-thread",
);

async function expectNoViewportSlop(page: Page) {
  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  const escaped = await page.evaluate(() => {
    const issues: string[] = [];
    for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        continue;
      }
      if (rect.left < -1 || rect.right > window.innerWidth + 1) {
        issues.push(
          `${element.tagName.toLowerCase()} ${element.textContent?.trim().slice(0, 48)}`,
        );
      }
    }
    return issues.slice(0, 10);
  });
  expect(escaped).toEqual([]);

  const clippedText = await page.evaluate(() => {
    const issues: string[] = [];
    for (const element of document.body.querySelectorAll<HTMLElement>(
      "button,a,[role='button']",
    )) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (
        element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1
      ) {
        issues.push(element.textContent?.trim().slice(0, 48) ?? element.tagName);
      }
    }
    return issues.slice(0, 10);
  });
  expect(clippedText).toEqual([]);
}

async function openLeasiumAiHome(page: Page) {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
  await page.goto("/intake");
  await expect(page.getByTestId("leasium-ai-home-composer")).toBeVisible();
  await expect(page.getByTestId("leasium-ai-home-recent")).toHaveCount(0);
}

async function expectLeasiumAiColourWash(page: Page) {
  const composer = page.getByTestId("leasium-ai-home-composer");
  const visualStyle = await composer.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      borderColor: style.borderColor,
    };
  });

  expect(visualStyle.backgroundImage).toContain("234, 240, 255");
  expect(visualStyle.backgroundImage).toContain("232, 250, 247");
  expect(visualStyle.borderColor).toContain("36, 91, 255");
}

test("Relby AI conversation thread home stays clean at 1440", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLeasiumAiHome(page);
  await expectLeasiumAiColourWash(page);
  await expectNoViewportSlop(page);
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, "2026-06-17-colour-desktop-1440.png"),
    fullPage: false,
  });
});

test("Relby AI conversation thread home stays clean at 390", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeasiumAiHome(page);
  await expectNoViewportSlop(page);
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, "2026-06-17-colour-mobile-390.png"),
    fullPage: false,
  });
});
