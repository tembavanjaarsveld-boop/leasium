import { expect, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

function watchForbiddenTrustedSenderSettingsRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const isAllowedTrustedSenderManagement =
      (path === "/api/v1/comms/trusted-senders" &&
        (method === "GET" || method === "POST")) ||
      (method === "DELETE" &&
        /^\/api\/v1\/comms\/trusted-senders\/[^/]+$/.test(path));
    const isUnexpectedCommsMutation =
      method !== "GET" &&
      method !== "HEAD" &&
      path.startsWith("/api/v1/comms/") &&
      !isAllowedTrustedSenderManagement;
    const callsForbiddenSurface =
      path.startsWith("/api/v1/sendgrid") ||
      path.startsWith("/api/v1/twilio") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path === "/api/v1/ai/triage" ||
      path === "/api/v1/ai/triage/promote" ||
      path.includes("/provider-dispatch") ||
      path.includes("/provider-refresh");
    if (isUnexpectedCommsMutation || callsForbiddenSurface) {
      requests.push(`${method} ${path}`);
    }
  });
  return requests;
}

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("settings render the Horizon operator controls without provider mutation on load", async ({
  page,
}) => {
  const forbiddenCalls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const unsafeMethod = request.method() !== "GET";
    const providerPath =
      /sendgrid|twilio|provider|notification|digests\/run|comms|xero|basiq|payment|reconciliation/i.test(
        path,
      );
    if (unsafeMethod && providerPath) {
      forbiddenCalls.push(`${request.method()} ${path}`);
    }
  });

  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  for (const section of [
    "Organisation",
    "Security",
    "Notifications",
    "Connect",
  ]) {
    await expect(page.getByRole("tab", { name: section })).toBeVisible();
  }
  await expect(page.getByText(/WORK NOTIFICATIONS/i)).toBeVisible();
  await expect(page.getByText("Assignment email").first()).toBeVisible();
  await expect(page.getByText("Assignment SMS").first()).toBeVisible();
  await expect(page.getByText("Managed").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "OWNERSHIP TAGS" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(
    page.getByText(
      "Provider changes are review-first — nothing connects or sends without you.",
    ),
  ).toBeVisible();
  expect(forbiddenCalls).toEqual([]);
});

test("settings notifications tab opens the Horizon operator controls directly", async ({
  page,
}) => {
  await page.goto("/settings?tab=notifications");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Notifications" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText(/WORK NOTIFICATIONS/i)).toBeVisible();
  await expect(page.getByText("Assignment email").first()).toBeVisible();
  await expect(page.getByText("Assignment SMS").first()).toBeVisible();
  await expect(
    page.getByText(
      "Provider changes are review-first — nothing connects or sends without you.",
    ),
  ).toBeVisible();
});

test("settings manages AI mailbox trusted senders locally", async ({ page }) => {
  const forbiddenRequests = watchForbiddenTrustedSenderSettingsRequests(page);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Organisation" }).click();

  const trustedSendersPanel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "AI mailbox aliases and trusted senders",
    }),
  });
  await expect(trustedSendersPanel).toBeVisible();
  await expect(
    trustedSendersPanel.getByText(
      "Client aliases use inbox.leasium.ai, for example skj@inbox.leasium.ai.",
    ),
  ).toBeVisible();
  await expect(
    trustedSendersPanel.getByText("Client mailbox aliases"),
  ).toBeVisible();
  await expect(trustedSendersPanel.getByText("SKJ intake")).toBeVisible();
  await expect(
    trustedSendersPanel.getByRole("link", { name: "Review mailbox" }),
  ).toHaveAttribute("href", "/inbox");
  await expect(trustedSendersPanel.getByText("temba@leasium.test")).toBeVisible();
  await expect(
    trustedSendersPanel.getByText("Operator forwarder"),
  ).toBeVisible();

  await trustedSendersPanel
    .getByLabel("Sender email")
    .fill("new.agent@example.com");
  await trustedSendersPanel
    .getByLabel("Label (optional)")
    .fill("Managing agent");
  await trustedSendersPanel.getByRole("button", { name: "Add sender" }).click();

  await expect(
    trustedSendersPanel.getByText("new.agent@example.com trusted locally."),
  ).toBeVisible();
  await expect(
    trustedSendersPanel.locator("li").filter({
      hasText: "new.agent@example.com",
    }),
  ).toHaveCount(1);
  await expect(trustedSendersPanel.getByText("Managing agent")).toBeVisible();

  await trustedSendersPanel
    .getByRole("button", { name: "Revoke temba@leasium.test" })
    .click();

  await expect(
    trustedSendersPanel.getByText("temba@leasium.test revoked."),
  ).toBeVisible();
  await expect(
    trustedSendersPanel.locator("li").filter({ hasText: "temba@leasium.test" }),
  ).toHaveCount(0);
  expect(forbiddenRequests).toEqual([]);
});

test("mobile settings keeps the approved compact tab rail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const settingsSections = page.getByRole("tablist", {
    name: "Settings sections",
  });
  await expect(settingsSections.getByRole("tab")).toHaveCount(3);
  for (const section of ["Organisation", "Security", "Connect"]) {
    const tab = settingsSections.getByRole("tab", { name: section });
    await expect(tab).toBeVisible();
    const tabBox = await tab.boundingBox();
    expect(tabBox).not.toBeNull();
    expect(tabBox!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(
    settingsSections.getByRole("tab", { name: "Notifications" }),
  ).toHaveCount(0);
  await expect(page.getByText(/WORK NOTIFICATIONS/i)).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  await page.goto("/settings?tab=notifications");
  await expect(page).toHaveURL(/\/settings\?tab=notifications/);
  const deepLinkSections = page.getByRole("tablist", {
    name: "Settings sections",
  });
  await expect(
    deepLinkSections.getByRole("tab", { name: "Notifications" }),
  ).toHaveCount(0);
  await expect(page.getByText(/WORK NOTIFICATIONS/i)).toBeVisible();
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

  await page.goto("/settings?tab=security");

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
  let releaseBrandedTemplates: () => void = () => {};
  let releaseProperties: () => void = () => {};
  const securityWorkspaceCanResolve = new Promise<void>((resolve) => {
    releaseSecurityWorkspace = resolve;
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

  await page.goto("/settings?tab=security");
  await page.getByRole("tab", { name: "Organisation" }).click();

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
  releaseBrandedTemplates();
  releaseProperties();
});

test("mobile settings users and roles use readable cards", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings?tab=security");

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

test("settings Work notification preferences stay inside the desktop viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const notificationPreferences = {
    work_assignment_email_enabled: true,
    work_assignment_sms_enabled: false,
    work_assignment_sms_phone: null,
    work_assignment_notice_template_key: "work_assignment_notification",
    work_assignment_notice_template_version: "v1",
    work_assignment_digest_cadence: "daily",
    work_assignment_digest_template_key: "work_assignment_digest",
    work_assignment_digest_template_version: "v1",
    work_assignment_digest_last_generated_at: null,
    work_assignment_digest_last_item_count: null,
    work_assignment_digest_history: [],
  };
  const members = [
    {
      id: "operator-1",
      email: "owner@example.com",
      display_name: "Owner Operator",
      role: "owner",
      phone: "+61400111222",
    },
    {
      id: "operator-2",
      email: "tembavanjaarsveld@gmail.com",
      display_name: "tembavanjaarsveld@gmail.com",
      role: "admin",
      phone: null,
    },
    {
      id: "operator-3",
      email: "wajahat.ahmed@luckiest.com",
      display_name: "wajahat.ahmed@luckiest.com",
      role: "admin",
      phone: null,
    },
    {
      id: "operator-4",
      email: "very.long.operator.identity.for.settings@skjcapital.example",
      display_name: "very.long.operator.identity.for.settings@skjcapital.example",
      role: "finance",
      phone: null,
    },
  ];
  await page.route("**/api/v1/security/workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        auth: {
          auth_mode: "dev",
          dev_auth_active: true,
          clerk_secret_configured: false,
          clerk_jwks_configured: false,
          operator_login_enforced: false,
          login_boundary: "Development operator identity",
          next_steps: [],
        },
        current_user: {
          id: "operator-1",
          organisation_id: "org-1",
          email: "owner@example.com",
          display_name: "Owner Operator",
        },
        organisation: {
          id: "org-1",
          name: "Acme Holdings",
          country_code: "AU",
          timezone: "Australia/Brisbane",
          operating_mode: "self_managed_owner",
          created_at: "2026-05-01T00:00:00.000Z",
        },
        members: members.map((member) => ({
          id: member.id,
          email: member.email,
          display_name: member.display_name,
          is_active: true,
          login_linked: true,
          invite_email_status: "accepted",
          invite_email_detail: "Provider login is linked for this operator.",
          invite_sent_at: "2026-05-01T00:00:00.000Z",
          invite_expires_at: "2026-05-04T00:00:00.000Z",
          invite_accepted_at: "2026-05-01T00:00:00.000Z",
          notification_preferences: {
            ...notificationPreferences,
            work_assignment_sms_enabled: Boolean(member.phone),
            work_assignment_sms_phone: member.phone,
          },
          created_at: "2026-05-01T00:00:00.000Z",
          roles: [
            {
              entity_id: "entity-1",
              entity_name: "Acme Holdings Pty Ltd",
              role: member.role,
            },
          ],
        })),
        current_user_roles: [
          {
            entity_id: "entity-1",
            entity_name: "Acme Holdings Pty Ltd",
            role: "owner",
          },
        ],
        can_manage_security: true,
      }),
    });
  });
  await page.goto("/settings?tab=security");

  const workNotifications = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Work notifications" }) })
    .first();
  await expect(workNotifications).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  const templateSummaryFits = await workNotifications
    .locator("details summary")
    .evaluateAll((summaries) =>
      summaries.every((summary) => {
        const box = summary.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth + 1;
      }),
    );
  expect(templateSummaryFits).toBe(true);

  await workNotifications
    .locator("details")
    .evaluateAll((details) =>
      details.forEach((detail) => detail.setAttribute("open", "")),
    );
  const panelOverflowers = await workNotifications.evaluate((panel) => {
    const panelBox = panel.getBoundingClientRect();
    return Array.from(panel.querySelectorAll("*"))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          (box.left < panelBox.left - 1 || box.right > panelBox.right + 1)
        );
      })
      .map((element) => ({
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
        tag: element.tagName.toLowerCase(),
      }));
  });
  expect(panelOverflowers).toEqual([]);
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
    page.getByText(
      "Database-backed branded templates are visible here for audit. Edit templates from the Comms hub; send-time wiring remains paused for internal-first use.",
    ),
  ).toBeVisible();
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
    "Review-only export: downloading this file does not wire stored templates into send paths, edit templates, send notifications, run digests, send invoices, send tenant onboarding messages, send contractor updates, mutate preferences, or write provider history.",
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
  await expect(
    page.getByRole("heading", { name: "Your entities & properties" }),
  ).toBeVisible();
  const entitiesPropertiesSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Your entities & properties" }),
  });
  await expect(
    entitiesPropertiesSection.getByText("Acme Holdings Pty Ltd"),
  ).toBeVisible();
  await expect(
    entitiesPropertiesSection.getByText("Owner & trust records"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Split into trust entities (preview)" }),
  ).toBeVisible();
  await expect(page.getByText("2 trusts found")).toBeVisible();
  const splitPanel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Split into trust entities (preview)",
    }),
  });
  await expect(splitPanel.getByText("GRHQ Pty Ltd")).toBeVisible();
  await splitPanel.getByRole("button", { name: "Apply split…" }).click();
  await splitPanel
    .getByRole("button", { name: /Confirm — create/ })
    .click();
  await expect(
    splitPanel.getByText(/Created 2 entities, moved 3 properties/),
  ).toBeVisible();

  await operatingModeSelect.selectOption("hybrid");

  await expect.poll(() => operatingModePayloads.length).toBe(1);
  expect(operatingModePayloads[0]).toEqual({ operating_mode: "hybrid" });
  await expect(operatingModeSelect).toHaveValue("hybrid");
  await expect(
    page.getByRole("heading", { name: "Your entities & properties" }),
  ).toHaveCount(0);
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
