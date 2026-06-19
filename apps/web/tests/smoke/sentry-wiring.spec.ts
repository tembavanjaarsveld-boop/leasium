import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(__dirname, "../..");

async function source(relativePath: string) {
  return readFile(path.join(appRoot, relativePath), "utf8");
}

test("Next.js Sentry wiring stays review-first and PII-safe", async () => {
  const packageJson = JSON.parse(await source("package.json")) as {
    dependencies?: Record<string, string>;
  };
  expect(packageJson.dependencies).toHaveProperty("@sentry/nextjs");

  await expect(source("next.config.ts")).resolves.toContain("withSentryConfig");
  await expect(source("instrumentation-client.ts")).resolves.toContain(
    "NEXT_PUBLIC_SENTRY_DSN",
  );
  await expect(source("instrumentation.ts")).resolves.toContain(
    "captureRequestError",
  );
  await expect(source("sentry.server.config.ts")).resolves.toContain(
    "sendDefaultPii: false",
  );
  await expect(source("sentry.edge.config.ts")).resolves.toContain(
    "sendDefaultPii: false",
  );

  const globalError = await source("src/app/global-error.tsx");
  expect(globalError).toContain("Sentry.captureException(error)");
  expect(globalError).toContain('"use client"');
});
