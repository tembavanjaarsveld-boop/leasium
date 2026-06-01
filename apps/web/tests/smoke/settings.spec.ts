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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as Window & { __copiedTemplateOverrideCsv?: string }
          ).__copiedTemplateOverrideCsv = text;
        },
      },
    });
  });

  let exportActionsStarted = false;
  const forbiddenExportCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method();

    if (method === "GET" && path === "/branded-communication-templates") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "branded-template-1",
            entity_id: "entity-1",
            key: "invoice_delivery",
            version: "v1",
            channel: "email",
            provider: "sendgrid",
            name: "SKJ invoice delivery",
            subject_template: "Invoice {{invoice_number}} from SKJ Capital",
            body_template:
              "Hi {{tenant_name}}, your reviewed invoice is attached.",
            action_label: "View invoice",
            action_url_template: "{{invoice_url}}",
            notes: '=HYPERLINK("https://example.invalid","review")',
            is_active: true,
            is_system: false,
            created_by_user_id: "operator-1",
            created_at: "2026-05-22T00:00:00.000Z",
            updated_at: "2026-05-22T00:00:00.000Z",
            deleted_at: null,
            metadata: { brand: "SKJ Capital" },
          },
          {
            id: "branded-template-2",
            entity_id: "entity-1",
            key: "maintenance_contractor_update",
            version: "v1",
            channel: "email",
            provider: "sendgrid",
            name: "Contractor update default",
            subject_template: "Maintenance update requested",
            body_template: "+Contractor formula-safe body",
            action_label: null,
            action_url_template: null,
            notes: null,
            is_active: true,
            is_system: true,
            created_by_user_id: null,
            created_at: "2026-05-22T00:10:00.000Z",
            updated_at: "2026-05-22T00:10:00.000Z",
            deleted_at: null,
            metadata: {},
          },
        ]),
      });
      return;
    }

    if (exportActionsStarted) {
      const mutationOnlyRoots = [
        "/branded-communication-templates",
        "/work-assignments/notification-templates",
        "/comms",
        "/invoice-drafts",
        "/tenant-onboarding",
      ];
      const isForbiddenMutationRoot =
        method !== "GET" &&
        mutationOnlyRoots.some(
          (root) => path === root || path.startsWith(`${root}/`),
        );
      const isForbiddenProviderPath =
        /provider-(history|dispatch|refresh)|\/provider-history|\/provider-dispatch|\/provider-refresh/i.test(
          path,
        );
      const isForbiddenSendPath = /sendgrid|twilio|email|sms/i.test(path);
      const isForbiddenAccountingMutation =
        method !== "GET" &&
        /xero|basiq|billing|payment|reconciliation/i.test(path);

      if (
        isForbiddenMutationRoot ||
        isForbiddenProviderPath ||
        isForbiddenSendPath ||
        isForbiddenAccountingMutation
      ) {
        forbiddenExportCalls.push(`${method} ${path}`);
        await route.fulfill({
          status: 418,
          contentType: "application/json",
          body: JSON.stringify({
            error: "template override export must stay local-only",
          }),
        });
        return;
      }
    }

    await route.fallback();
  });

  await page.goto("/settings");

  await page.getByRole("tab", { name: "Organisation" }).click();
  await expect(page.getByText("Communication templates")).toBeVisible();
  await expect(page.getByText("Stored template overrides")).toBeVisible();
  await expect(
    page.getByText("2/2 active overrides match runtime keys."),
  ).toBeVisible();

  const copyOverridesCsv = page.getByRole("button", {
    name: "Copy overrides CSV",
  });
  const downloadOverridesCsv = page.getByRole("button", {
    name: "Download overrides CSV",
  });
  await expect(copyOverridesCsv).toBeVisible();
  await expect(downloadOverridesCsv).toBeVisible();
  const copyBox = await copyOverridesCsv.boundingBox();
  const downloadBox = await downloadOverridesCsv.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(downloadBox).not.toBeNull();
  for (const box of [copyBox!, downloadBox!]) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const horizontalGap = Math.max(
    copyBox!.x - (downloadBox!.x + downloadBox!.width),
    downloadBox!.x - (copyBox!.x + copyBox!.width),
    0,
  );
  const verticalGap = Math.max(
    copyBox!.y - (downloadBox!.y + downloadBox!.height),
    downloadBox!.y - (copyBox!.y + copyBox!.height),
    0,
  );
  expect(Math.max(horizontalGap, verticalGap)).toBeLessThanOrEqual(12);

  exportActionsStarted = true;
  await copyOverridesCsv.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __copiedTemplateOverrideCsv?: string })
            .__copiedTemplateOverrideCsv ?? "",
      ),
    )
    .toContain("Runtime template");
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedTemplateOverrideCsv?: string })
        .__copiedTemplateOverrideCsv ?? "",
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadOverridesCsv.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "communication-template-overrides.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(copiedCsv).toBe(csv);
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
    '"\'=HYPERLINK(""https://example.invalid"",""review"")"',
  );
  expect(csv).toContain('"\'+Contractor formula-safe body"');
  expect(csv).toContain(
    "Review-only export: downloading this file does not wire stored templates into send paths, add edit controls, send notifications, run digests, send invoices, send tenant onboarding messages, send contractor updates, mutate preferences, or write provider history.",
  );
  expect(forbiddenExportCalls).toEqual([]);
});

test("settings can switch operating mode without orphaning self-managed owner records", async ({
  page,
}) => {
  const operatingModePayloads: unknown[] = [];
  const forbiddenProviderRequests: string[] = [];
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
      path.includes("/basiq");
    if (callsProvider) {
      forbiddenProviderRequests.push(`${request.method()} ${url.toString()}`);
    }
  });
  await page.route(
    (url) => url.pathname.endsWith("/owners"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    },
  );
  await page.route(
    "**/api/v1/security/organisation/operating-mode",
    async (route) => {
      operatingModePayloads.push(route.request().postDataJSON());
      await route.fallback();
    },
  );

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Organisation" }).click();

  const operatingModeSelect = page.getByLabel("Account operating mode");
  await expect(
    page.getByRole("heading", { name: "Operating mode" }),
  ).toBeVisible();
  await expect(operatingModeSelect).toHaveValue("self_managed_owner");
  await expect(page.getByText("Your entities & trusts")).toBeVisible();
  await expect(page.getByText("No owners yet.")).toBeVisible();

  await operatingModeSelect.selectOption("hybrid");

  await expect.poll(() => operatingModePayloads.length).toBe(1);
  expect(operatingModePayloads[0]).toEqual({ operating_mode: "hybrid" });
  await expect(operatingModeSelect).toHaveValue("hybrid");
  await expect(page.getByText("Your entities & trusts")).toHaveCount(0);
  expect(forbiddenProviderRequests).toEqual([]);
});

test("settings operating-mode control is disabled without manage-security", async ({
  page,
}) => {
  await mockLeasiumApi(page, { canManageSecurity: false });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Organisation" }).click();

  await expect(
    page.getByRole("heading", { name: "Operating mode" }),
  ).toBeVisible();
  const operatingModeSelect = page.getByLabel("Account operating mode");
  await expect(operatingModeSelect).toHaveValue("self_managed_owner");
  await expect(operatingModeSelect).toBeDisabled();
  await expect(
    page.getByText("Only an owner or admin can change the operating mode."),
  ).toBeVisible();
});
