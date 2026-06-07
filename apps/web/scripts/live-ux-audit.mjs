#!/usr/bin/env node

import { chromium, devices } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const outputDir = path.resolve(repoRoot, "output/playwright/live-audit");
const defaultStoragePath = path.join(outputDir, "storage-state.json");

const baseUrl = (process.env.LEASIUM_AUDIT_URL ?? "https://leasium.ai").replace(
  /\/$/,
  "",
);
const storagePath = path.resolve(
  process.env.LEASIUM_AUDIT_STORAGE ?? defaultStoragePath,
);
const timeoutMs = numberFromEnv("LEASIUM_AUDIT_TIMEOUT_MS", 45_000);
const settleMs = numberFromEnv("LEASIUM_AUDIT_SETTLE_MS", 4_000);
const failOnBudget = process.env.LEASIUM_AUDIT_FAIL_ON_BUDGET === "1";
const loginMode =
  process.argv.includes("--login") || process.env.LEASIUM_AUDIT_LOGIN === "1";
const headless = loginMode ? false : process.env.LEASIUM_AUDIT_HEADLESS !== "0";

export const DEFAULT_ROUTE_SPECS = [
  ["/", "Dashboard", /Dashboard|Daily command center/i],
  ["/intake", "Smart Intake", /Smart Intake|Drop a document/i],
  ["/properties", "Properties", /Properties|Portfolio/i],
  ["/people", "People", /People|Tenants|Owners|Vendors/i],
  ["/operations", "Work", /Work|Operations/i],
  [
    "/billing-readiness",
    "Billing Readiness",
    /Billing Readiness|Review invoice|Xero|GST/i,
  ],
  ["/money", "Money", /Money|Billing|Statements/i],
  ["/insights", "Insights", /Insights|Live portfolio/i],
  ["/settings", "Settings", /Settings|Security|Organisation|Xero/i],
];

const viewports = [
  { name: "desktop", use: devices["Desktop Chrome"] },
  { name: "mobile", use: devices["iPhone 13"] },
];

if (isDirectRun()) {
  await main();
}

async function main() {
  if (process.argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  await fs.mkdir(outputDir, { recursive: true });

  if (loginMode) {
    await saveLoginSession();
    process.exit(0);
  }

  const routeSpecs = parseRoutes(
    process.env.LEASIUM_AUDIT_ROUTES,
    DEFAULT_ROUTE_SPECS,
  );
  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    storage_state: storagePath,
    settle_ms: settleMs,
    timeout_ms: timeoutMs,
    viewports: [],
  };

  for (const viewport of viewports) {
    report.viewports.push(await auditViewport(viewport, routeSpecs));
  }

  const jsonPath = path.join(outputDir, "report.json");
  const markdownPath = path.join(outputDir, "report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, renderMarkdown(report));

  const hasBudgetFailure = report.viewports.some((viewport) =>
    viewport.routes.some((route) => route.budget_status !== "pass"),
  );

  console.log(`Live UX audit written to ${markdownPath}`);
  if (hasBudgetFailure) {
    console.log("Budget warnings found. Open the report for route-level detail.");
  }

  if (failOnBudget && hasBudgetFailure) {
    process.exitCode = 1;
  }
}

function isDirectRun() {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parseRoutes(raw, fallback) {
  if (!raw?.trim()) {
    return fallback.map(([pathname, label, readyPattern]) => ({
      pathname,
      label,
      readyPattern,
    }));
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((pathname) => ({
      pathname: pathname.startsWith("/") ? pathname : `/${pathname}`,
      label: pathname.replace(/^\//, "") || "Dashboard",
      readyPattern: null,
    }));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function saveLoginSession() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices["Desktop Chrome"] });
  const page = await context.newPage();
  await page.goto(baseUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });

  console.log("");
  console.log("A browser window is open for login.");
  console.log(
    "Sign in normally, wait until the dashboard is usable, then return here and press Enter.",
  );
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await rl.question("Press Enter once signed in: ");
  rl.close();

  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await context.storageState({ path: storagePath });
  await browser.close();
  console.log(`Saved browser session to ${storagePath}`);
}

async function auditViewport(viewport, routeSpecs) {
  const browser = await chromium.launch({ headless });
  const hasStorageState = await fileExists(storagePath);
  const context = await browser.newContext({
    ...viewport.use,
    ...(hasStorageState ? { storageState: storagePath } : {}),
  });

  const routes = [];
  for (const route of routeSpecs) {
    routes.push(
      await auditRoute(context, viewport.name, route, hasStorageState),
    );
  }

  await browser.close();
  return {
    name: viewport.name,
    has_storage_state: hasStorageState,
    routes,
  };
}

async function auditRoute(context, viewportName, route, hasStorageState) {
  const page = await context.newPage();
  const startedAt = Date.now();
  const requests = new Map();
  const slowRequests = [];
  const consoleMessages = [];
  const pageErrors = [];

  page.on("request", (request) => {
    requests.set(request, {
      method: request.method(),
      url: request.url(),
      startedAt: Date.now(),
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    const record = requests.get(request);
    if (!record) return;
    const durationMs = Date.now() - record.startedAt;
    if (isInterestingRequest(record.url) || durationMs >= 1_200) {
      slowRequests.push({
        method: record.method,
        url: redactUrl(record.url),
        status: response.status(),
        duration_ms: durationMs,
      });
    }
  });
  page.on("requestfailed", (request) => {
    const record = requests.get(request);
    slowRequests.push({
      method: record?.method ?? request.method(),
      url: redactUrl(request.url()),
      status: "failed",
      duration_ms: record ? Date.now() - record.startedAt : null,
      error: request.failure()?.errorText ?? "request failed",
    });
  });
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push({
        type: message.type(),
        text: message.text().slice(0, 500),
      });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message.slice(0, 500));
  });

  const url = new URL(route.pathname, `${baseUrl}/`).toString();
  let navigationError = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForSessionGate(page);
    if (await pageLooksSignedOut(page)) {
      throw new Error(
        "Signed-out audit session. Re-run audit:live -- --login before trusting route timings.",
      );
    }
    if (route.readyPattern) {
      await page.waitForFunction(
        (source) => new RegExp(source, "i").test(document.body.innerText),
        route.readyPattern.source,
        { timeout: Math.min(timeoutMs, 20_000) },
      );
    }
    await waitForVisualStability(page);
    await page.waitForTimeout(settleMs);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  const settledMs = Date.now() - startedAt;
  const screenshotPath = path.join(
    outputDir,
    `${safeFileName(route.label)}-${viewportName}.png`,
  );
  await page
    .screenshot({ path: screenshotPath, fullPage: true })
    .catch(() => null);

  const pageState = await page
    .evaluate(() => {
      const text = document.body.innerText;
      const loadingMatches = Array.from(
        text.matchAll(/\b(?:Checking|Loading|Confirming)\b[^\n]{0,90}/gi),
      ).map((match) => match[0]);
      return {
        title: document.title,
        url: window.location.href,
        body_sample: text.replace(/\s+/g, " ").trim().slice(0, 500),
        document_width: document.documentElement.scrollWidth,
        viewport_width: window.innerWidth,
        horizontal_overflow:
          document.documentElement.scrollWidth > window.innerWidth + 2,
        loading_text: [...new Set(loadingMatches)].slice(0, 8),
      };
    })
    .catch(() => ({
      title: "",
      url,
      body_sample: "",
      document_width: null,
      viewport_width: null,
      horizontal_overflow: null,
      loading_text: [],
    }));

  await page.close();

  const signedOut = isSignedOutPageState(pageState);
  const budgetStatus = classifyBudgetStatus({
    navigationError,
    hasStorageState,
    pageState,
    settledMs,
    pageErrors,
  });

  return {
    label: route.label,
    pathname: route.pathname,
    url: pageState.url,
    settled_ms: settledMs,
    budget_status: budgetStatus,
    screenshot: screenshotPath,
    navigation_error: navigationError,
    signed_out: signedOut,
    title: pageState.title,
    body_sample: pageState.body_sample,
    horizontal_overflow: pageState.horizontal_overflow,
    document_width: pageState.document_width,
    viewport_width: pageState.viewport_width,
    loading_text: pageState.loading_text,
    slow_requests: slowRequests
      .sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))
      .slice(0, 12),
    console_messages: consoleMessages.slice(0, 12),
    page_errors: pageErrors,
  };
}

async function waitForSessionGate(page) {
  await page
    .waitForFunction(
      () =>
        !/Confirming operator access|Checking your session/.test(
          document.body.innerText,
        ),
      { timeout: Math.min(timeoutMs, 20_000) },
    )
    .catch(() => null);
}

async function pageLooksSignedOut(page) {
  const state = await page
    .evaluate(() => ({
      url: window.location.href,
      body_sample: document.body.innerText.replace(/\s+/g, " ").trim(),
    }))
    .catch(() => ({ url: "", body_sample: "" }));
  return isSignedOutPageState(state);
}

export function isSignedOutPageState(pageState) {
  const url = pageState?.url ?? "";
  const bodySample = pageState?.body_sample ?? "";
  return (
    /\/(?:sign-in|welcome)(?:[/?#]|$)/.test(url) ||
    /Sign in to open the workspace/i.test(bodySample) ||
    /Operator access is required/i.test(bodySample) ||
    /Sign in to your Leasium account/i.test(bodySample)
  );
}

export function classifyBudgetStatus({
  navigationError,
  hasStorageState,
  pageState,
  settledMs,
  pageErrors,
}) {
  return navigationError ||
    !hasStorageState ||
    isSignedOutPageState(pageState) ||
    pageState.horizontal_overflow ||
    settledMs > 8_000 ||
    pageErrors.length > 0
    ? "warn"
    : "pass";
}

async function waitForVisualStability(page) {
  await page
    .waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) })
    .catch(() => null);

  let previous = "";
  for (let index = 0; index < 3; index += 1) {
    const current = await page
      .evaluate(() =>
        document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 2000),
      )
      .catch(() => "");
    if (current && current === previous) {
      return;
    }
    previous = current;
    await page.waitForTimeout(1_000);
  }
}

function isInterestingRequest(url) {
  return (
    url.includes("/api/v1/") ||
    url.includes("api.leasium.ai") ||
    url.includes("clerk.") ||
    url.includes(".clerk.") ||
    url.includes("/_next/")
  );
}

function redactUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|code|state|session|secret|password/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function safeFileName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function renderMarkdown(data) {
  const lines = [
    "# Leasium Live UX Audit",
    "",
    `Generated: ${data.generated_at}`,
    `Base URL: ${data.base_url}`,
    `Settle wait: ${data.settle_ms}ms`,
    "",
  ];

  for (const viewport of data.viewports) {
    lines.push(`## ${viewport.name}`);
    lines.push("");
    lines.push(
      "| Route | Status | Settled | Overflow | Slowest API/request | Screenshot |",
    );
    lines.push("| --- | --- | ---: | --- | --- | --- |");
    for (const route of viewport.routes) {
      const slowest = route.slow_requests[0];
      lines.push(
        [
          route.label,
          route.budget_status,
          `${route.settled_ms}ms`,
          route.horizontal_overflow ? "yes" : "no",
          slowest ? `${slowest.duration_ms}ms ${trimUrl(slowest.url)}` : "-",
          path.relative(repoRoot, route.screenshot),
        ]
          .map((cell) => ` ${String(cell).replace(/\|/g, "\\|")} `)
          .join("|")
          .replace(/^/, "|")
          .replace(/$/, "|"),
      );
    }
    lines.push("");

    for (const route of viewport.routes.filter(
      (item) => item.budget_status !== "pass",
    )) {
      lines.push(`### ${viewport.name} / ${route.label}`);
      if (route.navigation_error) {
        lines.push(`Navigation: ${route.navigation_error}`);
      }
      if (route.signed_out) {
        lines.push(
          "Session: signed out or storage expired; refresh the saved audit session before using route timings.",
        );
      }
      if (route.loading_text.length) {
        lines.push(`Loading copy seen: ${route.loading_text.join("; ")}`);
      }
      if (route.console_messages.length) {
        lines.push(
          `Console: ${route.console_messages
            .map((message) => `${message.type}: ${message.text}`)
            .join("; ")}`,
        );
      }
      if (route.page_errors.length) {
        lines.push(`Page errors: ${route.page_errors.join("; ")}`);
      }
      lines.push("");
    }
  }

  lines.push("## How to refresh the signed-in session");
  lines.push("");
  lines.push(
    "From `apps/web`, run `npm run audit:live -- --login`, sign in in the opened browser, then press Enter in the terminal.",
  );
  lines.push("Then run `npm run audit:live` for a desktop/mobile route audit.");
  lines.push(
    "If `pnpm` is available, the equivalent commands are `pnpm audit:live -- --login` and `pnpm audit:live`.",
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function trimUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

function printHelp() {
  console.log(`
Live UX/performance audit for Leasium.

Usage:
  npm run audit:live -- --login Save a signed-in browser session
  npm run audit:live            Audit desktop and mobile routes

  pnpm audit:live -- --login    Same, when pnpm is available
  pnpm audit:live               Same, when pnpm is available

Environment:
  LEASIUM_AUDIT_URL            Base URL. Defaults to https://leasium.ai
  LEASIUM_AUDIT_STORAGE        Storage-state path. Defaults to output/playwright/live-audit/storage-state.json
  LEASIUM_AUDIT_ROUTES         Comma-separated routes. Defaults to core MVP routes
  LEASIUM_AUDIT_SETTLE_MS      Extra wait before screenshots. Defaults to 4000
  LEASIUM_AUDIT_TIMEOUT_MS     Route timeout. Defaults to 45000
  LEASIUM_AUDIT_HEADLESS=0     Show the browser during audits
  LEASIUM_AUDIT_FAIL_ON_BUDGET=1 Exit non-zero when warnings are found
`);
}
