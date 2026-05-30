import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("settings security loading state avoids raw access placeholders", async ({
  page,
}) => {
  let releaseSecurityWorkspace: () => void = () => {};
  let releaseTemplates: () => void = () => {};
  const securityWorkspaceCanResolve = new Promise<void>((resolve) => {
    releaseSecurityWorkspace = resolve;
  });
  const templatesCanResolve = new Promise<void>((resolve) => {
    releaseTemplates = resolve;
  });
  await page.route("**/api/v1/security/workspace", async (route) => {
    await securityWorkspaceCanResolve;
    await route.fallback();
  });
  await page.route(
    "**/api/v1/work-assignments/notification-templates",
    async (route) => {
      await templatesCanResolve;
      await route.fallback();
    },
  );

  await page.goto("/settings");

  const securityPanel = page
    .locator("main")
    .filter({ has: page.getByRole("heading", { name: "Settings" }) });
  await expect(securityPanel.getByText("Checking").first()).toBeVisible();
  await expect(securityPanel.getByText("...", { exact: true })).toHaveCount(0);

  const operatorAccessPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Operator access" }) })
    .first();
  await expect(
    securityPanel.getByText("Checking current login boundary."),
  ).toBeVisible();
  await expect(
    securityPanel.getByText("Loading the current login boundary."),
  ).toHaveCount(0);
  await expect(operatorAccessPanel.getByText("Checking login")).toBeVisible();
  await expect(
    operatorAccessPanel.getByText("Checking operator"),
  ).toBeVisible();
  await expect(operatorAccessPanel.getByText("Loading operator")).toHaveCount(
    0,
  );
  await expect(
    operatorAccessPanel.getByText("Provider login active"),
  ).toHaveCount(0);
  await expect(page.getByText("Checking templates")).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);

  releaseSecurityWorkspace();
  releaseTemplates();
});

test("settings organisation loading states use contextual labels", async ({
  page,
}) => {
  let releaseSecurityWorkspace: () => void = () => {};
  let releaseIntegrationStatus: () => void = () => {};
  let releaseBrandedTemplates: () => void = () => {};
  let releaseProperties: () => void = () => {};
  const securityWorkspaceCanResolve = new Promise<void>((resolve) => {
    releaseSecurityWorkspace = resolve;
  });
  const integrationStatusCanResolve = new Promise<void>((resolve) => {
    releaseIntegrationStatus = resolve;
  });
  const brandedTemplatesCanResolve = new Promise<void>((resolve) => {
    releaseBrandedTemplates = resolve;
  });
  const propertiesCanResolve = new Promise<void>((resolve) => {
    releaseProperties = resolve;
  });

  await page.route("**/api/v1/security/workspace", async (route) => {
    await securityWorkspaceCanResolve;
    await route.fallback();
  });
  await page.route("**/api/v1/system/integration-status", async (route) => {
    await integrationStatusCanResolve;
    await route.fallback();
  });
  await page.route(
    "**/api/v1/branded-communication-templates?**",
    async (route) => {
      await brandedTemplatesCanResolve;
      await route.fallback();
    },
  );
  await page.route("**/api/v1/premises/by-entity/**", async (route) => {
    await propertiesCanResolve;
    await route.fallback();
  });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Organisation" }).click();

  await expect(page.getByText("Checking integration status.")).toBeVisible();
  await expect(page.getByText("Checking organisation")).toBeVisible();
  await expect(page.getByText("Checking timezone")).toBeVisible();
  await expect(
    page.getByText("Checking stored template overrides."),
  ).toBeVisible();
  await expect(page.getByText("Checking ownership tags.")).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(
    page.getByText("Loading stored template overrides."),
  ).toHaveCount(0);
  await expect(page.getByText("Loading ownership tags...")).toHaveCount(0);

  releaseSecurityWorkspace();
  releaseIntegrationStatus();
  releaseBrandedTemplates();
  releaseProperties();
});

test("mobile settings users and roles use readable cards", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const usersPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Users and roles" }) })
    .first();
  await expect(usersPanel).toBeVisible();

  const operatorCard = usersPanel
    .getByRole("article")
    .filter({ hasText: "Owner Operator" });
  await expect(operatorCard).toBeVisible();
  await expect(operatorCard.getByText("Selected entity role")).toBeVisible();
  await expect(operatorCard.getByText("All access")).toBeVisible();
  await expect(
    operatorCard.getByRole("combobox", { name: "Owner Operator role" }),
  ).toBeVisible();
  await expect(usersPanel.getByRole("table")).toBeHidden();
});

test("settings exports communication template override review CSV", async ({
  page,
}) => {
  await page.goto("/settings");

  await page.getByRole("tab", { name: "Organisation" }).click();
  await expect(page.getByText("Communication templates")).toBeVisible();
  await expect(page.getByText("Stored template overrides")).toBeVisible();
  await expect(
    page.getByText("2/2 active overrides match runtime keys."),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download overrides CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "communication-template-overrides.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(csv).toContain("Runtime template");
  expect(csv).toContain("Stored override");
  expect(csv).toContain("invoice_delivery");
  expect(csv).toContain("tenant_onboarding_invite");
  expect(csv).toContain("work_assignment_notification");
  expect(csv).toContain("SKJ invoice delivery");
  expect(csv).toContain("Contractor update default");
  expect(csv).toContain("sendgrid");
  expect(csv).toContain("Active override");
  expect(csv).toContain("Active system");
  expect(csv).toContain("Runtime-aligned");
  expect(csv).toContain("Runtime only");
  expect(csv).toContain(
    "Review-only export: downloading this file does not wire stored templates into send paths, add edit controls, send notifications, run digests, send invoices, send tenant onboarding messages, send contractor updates, mutate preferences, or write provider history.",
  );
});
