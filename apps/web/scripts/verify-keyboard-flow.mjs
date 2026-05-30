#!/usr/bin/env node
// Live verification for the Phase D command-center keyboard flow.
// Runs a real browser against the deployed site using the saved audit session,
// since the local dev server can't boot (Clerk middleware + local edge runtime).
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
});
const page = await context.newPage();
await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 45000 });

// Let the dashboard settle.
await page
  .waitForFunction(
    () => !/Confirming operator access|Checking your session/.test(document.body.innerText),
    { timeout: 20000 },
  )
  .catch(() => null);
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
await page.waitForSelector("[data-cc-row]", { timeout: 20000 }).catch(() => null);
await page.waitForTimeout(2000);

const url = page.url();
if (/\/(sign-in|welcome|access)/.test(url)) {
  console.log(`SESSION_EXPIRED: landed on ${url} — re-run audit:live --login`);
  await browser.close();
  process.exit(2);
}

const rowCount = await page.locator("[data-cc-row]").count();
if (rowCount < 2) {
  console.log(`INSUFFICIENT_ROWS: found ${rowCount} command-center rows (need >=2 to test)`);
  await browser.close();
  process.exit(3);
}

// Focus the first row, then exercise j / k.
await page.locator("[data-cc-row]").first().focus();
const activeBefore = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("[data-cc-row]"));
  return rows.indexOf(document.activeElement);
});
await page.keyboard.press("j");
const afterJ = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("[data-cc-row]"));
  return rows.indexOf(document.activeElement);
});
await page.keyboard.press("k");
const afterK = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("[data-cc-row]"));
  return rows.indexOf(document.activeElement);
});

console.log(`rows=${rowCount} activeBefore=${activeBefore} afterJ=${afterJ} afterK=${afterK}`);
const pass = activeBefore === 0 && afterJ === 1 && afterK === 0;
console.log(pass ? "KEYBOARD_FLOW_PASS" : "KEYBOARD_FLOW_FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
