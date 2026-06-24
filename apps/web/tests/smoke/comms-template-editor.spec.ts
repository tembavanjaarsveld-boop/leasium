import { expect, test, type Page } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

async function watchForbiddenTemplateEditorCalls(page: Page) {
  const forbiddenApiCalls: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const method = request.method();
    const allowedTemplateMutation =
      method !== "GET" &&
      (path === "/branded-communication-templates" ||
        path === "/branded-communication-templates/render-preview" ||
        /^\/branded-communication-templates\/[^/]+$/.test(path) ||
        /^\/branded-communication-templates\/[^/]+\/versions$/.test(path));
    const isForbiddenSendPath =
      /email|sms|sendgrid|twilio|dispatch|dismiss|notification-center|invoice/i.test(
        path,
      );
    const isForbiddenMutation = method !== "GET" && !allowedTemplateMutation;

    if (isForbiddenSendPath || isForbiddenMutation) {
      forbiddenApiCalls.push(`${method} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "template editor must never send or dispatch messages",
        }),
      });
      return;
    }

    await route.fallback();
  });

  return forbiddenApiCalls;
}

function templateCatalog(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Template catalog" }) });
}

function requestPath(requestUrl: string) {
  return new URL(requestUrl).pathname.replace(/^\/api\/v1/, "");
}

test("creates an operator template without touching send paths", async ({
  page,
}) => {
  const forbiddenApiCalls = await watchForbiddenTemplateEditorCalls(page);

  await page.goto("/comms");

  const catalog = templateCatalog(page);
  await catalog.getByRole("button", { name: "New template" }).click();

  const drawer = page.getByRole("dialog", {
    name: "New communication template",
  });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Key").fill("work_assignment_notice");
  await drawer.getByLabel("Version").fill("v1");
  await drawer.getByLabel("Channel").selectOption("email");
  await expect(drawer.getByLabel("Provider")).toHaveValue("sendgrid");
  await drawer.getByLabel("Name").fill("Work assignment notice");
  await drawer
    .getByLabel("Subject")
    .fill("New work assigned to {{assignee_name}}");
  await drawer
    .getByLabel("Body")
    .fill("Please review {{work_title}} in Relby.");

  const postRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      requestPath(request.url()) === "/branded-communication-templates",
  );
  await drawer.getByRole("button", { name: "Save template" }).click();
  const postRequest = await postRequestPromise;
  expect(postRequest.postDataJSON()).toMatchObject({
    entity_id: "entity-1",
    key: "work_assignment_notice",
    version: "v1",
    channel: "email",
    provider: "sendgrid",
    name: "Work assignment notice",
    subject_template: "New work assigned to {{assignee_name}}",
    body_template: "Please review {{work_title}} in Relby.",
    is_active: true,
  });
  await expect(catalog.getByText("Work assignment notice")).toBeVisible();
  expect(forbiddenApiCalls).toEqual([]);
});

test("edits an operator template subject and body as a new version", async ({
  page,
}) => {
  const forbiddenApiCalls = await watchForbiddenTemplateEditorCalls(page);

  await page.goto("/comms");

  const catalog = templateCatalog(page);
  await catalog
    .getByRole("button", { name: "Edit SKJ invoice delivery" })
    .click();

  const drawer = page.getByRole("dialog", {
    name: "Edit SKJ invoice delivery",
  });
  await drawer
    .getByLabel("Subject")
    .fill("Updated invoice {{invoice_number}}");
  await drawer
    .getByLabel("Body")
    .fill("Thanks {{tenant_name}}, your updated invoice is ready.");

  const versionRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      requestPath(request.url()) ===
        "/branded-communication-templates/branded-template-1/versions",
  );
  await drawer.getByRole("button", { name: "Save template" }).click();
  const versionRequest = await versionRequestPromise;
  expect(versionRequest.postDataJSON()).toMatchObject({
    subject_template: "Updated invoice {{invoice_number}}",
    body_template: "Thanks {{tenant_name}}, your updated invoice is ready.",
  });
  await expect(
    catalog.getByText("Updated invoice {{invoice_number}}"),
  ).toBeVisible();
  await expect(
    catalog.getByText(
      "Thanks {{tenant_name}}, your updated invoice is ready.",
    ),
  ).toBeVisible();
  expect(forbiddenApiCalls).toEqual([]);
});

test("renders a review-only sample preview with template variables", async ({
  page,
}) => {
  const forbiddenApiCalls = await watchForbiddenTemplateEditorCalls(page);

  await page.goto("/comms");

  const catalog = templateCatalog(page);
  await catalog
    .getByRole("button", { name: "Edit SKJ invoice delivery" })
    .click();

  const drawer = page.getByRole("dialog", {
    name: "Edit SKJ invoice delivery",
  });
  const preview = drawer.getByRole("region", { name: "Sample preview" });

  await expect(
    preview.getByText("Invoice INV-1042 from SKJ Capital"),
  ).toBeVisible();
  await expect(
    preview.getByText(
      "Hi Rivergum Bakery, your reviewed invoice is attached. Please contact SKJ Capital if any detail needs attention.",
    ),
  ).toBeVisible();
  await expect(preview.getByText("View invoice")).toBeVisible();
  await expect(
    preview.getByText(
      "https://leasium.ai/tenants/tenant-1/invoices/invoice-1042",
    ),
  ).toBeVisible();

  await drawer
    .getByLabel("Subject")
    .fill("Hello {{tenant_name}} about {{unknown_token}}");
  await expect(
    preview.getByText("Hello Rivergum Bakery about {{unknown_token}}"),
  ).toBeVisible();
  expect(forbiddenApiCalls).toEqual([]);
});

test("system templates can be deactivated but not deleted", async ({ page }) => {
  const forbiddenApiCalls = await watchForbiddenTemplateEditorCalls(page);

  await page.goto("/comms");

  const catalog = templateCatalog(page);
  const activeTemplates = catalog.getByLabel("Active templates");
  await expect(activeTemplates.getByText("Contractor update default")).toBeVisible();

  await catalog
    .getByRole("button", { name: "Edit Contractor update default" })
    .click();
  const drawer = page.getByRole("dialog", {
    name: "Edit Contractor update default",
  });
  await expect(
    drawer.getByText("System templates cannot be deleted; deactivate instead."),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Delete template" }),
  ).toHaveCount(0);

  const deactivateRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      requestPath(request.url()) ===
        "/branded-communication-templates/branded-template-2",
  );
  await drawer.getByRole("button", { name: "Deactivate template" }).click();
  const deactivateRequest = await deactivateRequestPromise;
  expect(deactivateRequest.postDataJSON()).toMatchObject({
    is_active: false,
  });
  await expect(
    activeTemplates.getByText("Contractor update default"),
  ).toHaveCount(0);
  await expect(catalog.getByText("Inactive templates")).toBeVisible();
  expect(forbiddenApiCalls).toEqual([]);
});

test("duplicate create surfaces the backend conflict detail", async ({ page }) => {
  const forbiddenApiCalls = await watchForbiddenTemplateEditorCalls(page);

  await page.goto("/comms");

  const catalog = templateCatalog(page);
  await catalog.getByRole("button", { name: "New template" }).click();
  const drawer = page.getByRole("dialog", {
    name: "New communication template",
  });
  await drawer.getByLabel("Key").fill("invoice_delivery");
  await drawer.getByLabel("Version").fill("v1");
  await drawer.getByLabel("Channel").selectOption("email");
  await drawer.getByLabel("Provider").selectOption("sendgrid");
  await drawer.getByLabel("Name").fill("Duplicate invoice delivery");
  await drawer.getByLabel("Subject").fill("Duplicate invoice");
  await drawer.getByLabel("Body").fill("Duplicate invoice body.");

  await drawer.getByRole("button", { name: "Save template" }).click();

  await expect(
    drawer.getByText(
      "An active template already exists for this key and version. Edit it or use a new version.",
    ),
  ).toBeVisible();
  expect(forbiddenApiCalls).toEqual([]);
});
