#!/usr/bin/env node
// Verifies the Review-queue cards no longer overflow their grid cells, against
// the deployed site (Properties → Calendar view) using the saved audit session.
import { chromium, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const storagePath = path.resolve(
  repoRoot,
  "output/playwright/live-audit/storage-state.json",
);
const baseUrl = (process.env.LEASIUM_AUDIT_URL ?? "https://leasium.ai").replace(
  /\/$/,
  "",
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices["Desktop Chrome"],
  storageState: storagePath,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto(`${baseUrl}/properties?view=calendar`, {
  waitUntil: "domcontentloaded",
  timeout: 45000,
});
await page
  .waitForFunction(
    () =>
      !/Confirming operator access|Checking your session/.test(
        document.body.innerText,
      ),
    { timeout: 20000 },
  )
  .catch(() => null);
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
await page.getByText("Review queue").first().waitFor({ timeout: 20000 }).catch(() => null);
await page.waitForTimeout(2000);

const url = page.url();
if (/\/(sign-in|welcome|access)/.test(url)) {
  console.log(`SESSION_EXPIRED: ${url}`);
  await browser.close();
  process.exit(2);
}

const result = await page.evaluate(() => {
  // The review-queue title is the bold first line inside each card link.
  const titles = Array.from(
    document.querySelectorAll("a .font-semibold.line-clamp-2"),
  );
  let maxOverflow = 0;
  let overflowing = 0;
  for (const el of titles) {
    const o = el.scrollWidth - el.clientWidth;
    if (o > 2) overflowing += 1;
    if (o > maxOverflow) maxOverflow = o;
  }
  // Also check page-level horizontal overflow.
  const docOverflow =
    document.documentElement.scrollWidth - window.innerWidth;
  return {
    titlesFound: titles.length,
    overflowing,
    maxOverflow,
    docOverflow,
  };
});

console.log(JSON.stringify(result));
const pass =
  result.titlesFound > 0 &&
  result.overflowing === 0 &&
  result.docOverflow <= 2;
console.log(pass ? "REVIEW_QUEUE_PASS" : "REVIEW_QUEUE_FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
