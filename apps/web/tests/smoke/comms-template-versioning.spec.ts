import { expect, test, type Page } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

async function watchForbiddenTemplateVersioningCalls(page: Page) {
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
          error: "template versioning must never send or dispatch messages",
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

test("saving content edits posts a new version and keeps the prior version in history", async ({
  page,
}) => {
  const forbiddenApiCalls = await watchForbiddenTemplateVersioningCalls(page);

  await page.goto("/comms");

  const catalog = templateCatalog(page);
  const activeTemplates = catalog.getByLabel("Active templates");
  await activeTemplates
    .getByRole("button", { name: "Edit SKJ invoice delivery" })
    .click();

  const drawer = page.getByRole("dialog", {
    name: "Edit SKJ invoice delivery",
  });
  await expect(drawer.getByLabel("Version", { exact: true })).toHaveValue("v1");
  await drawer
    .getByLabel("Body")
    .fill("Hi {{tenant_name}}, version two of this invoice note.");

  const versionRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      requestPath(request.url()) ===
        "/branded-communication-templates/branded-template-1/versions",
  );
  await drawer.getByRole("button", { name: "Save template" }).click();
  const versionRequest = await versionRequestPromise;
  expect(versionRequest.postDataJSON()).toMatchObject({
    name: "SKJ invoice delivery",
    body_template: "Hi {{tenant_name}}, version two of this invoice note.",
  });

  await expect(activeTemplates.getByText("v2", { exact: true })).toBeVisible();
  await expect(
    activeTemplates.getByText(
      "Hi {{tenant_name}}, version two of this invoice note.",
    ),
  ).toBeVisible();
  await expect(catalog.getByText("Inactive templates (1)")).toBeVisible();

  await activeTemplates
    .getByRole("button", { name: "Edit SKJ invoice delivery" })
    .click();
  const reopenedDrawer = page.getByRole("dialog", {
    name: "Edit SKJ invoice delivery",
  });
  await expect(reopenedDrawer.getByLabel("Version", { exact: true })).toHaveValue("v2");
  await reopenedDrawer.getByText("Version history (2)").click();
  const history = reopenedDrawer.getByLabel("Template versions");
  const currentVersion = history.getByLabel("Version v2");
  await expect(currentVersion.getByText("Active", { exact: true })).toBeVisible();
  const priorVersion = history.getByLabel("Version v1");
  await expect(priorVersion.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(
    priorVersion.getByText(
      "Hi {{tenant_name}}, your reviewed invoice is attached. Please contact SKJ Capital if any detail needs attention.",
    ),
  ).toBeVisible();

  expect(forbiddenApiCalls).toEqual([]);
});

test("rendered preview shows the server-rendered subject and body", async ({
  page,
}) => {
  const forbiddenApiCalls = await watchForbiddenTemplateVersioningCalls(page);

  await page.goto("/comms");

  const catalog = templateCatalog(page);
  await catalog
    .getByRole("button", { name: "Edit SKJ invoice delivery" })
    .click();

  const drawer = page.getByRole("dialog", {
    name: "Edit SKJ invoice delivery",
  });
  const renderedPreview = drawer.getByRole("region", {
    name: "Rendered preview",
  });
  await expect(renderedPreview).toBeVisible();

  const renderRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      requestPath(request.url()) ===
        "/branded-communication-templates/render-preview",
  );
  await renderedPreview
    .getByRole("button", { name: "Render with sample data" })
    .click();
  const renderRequest = await renderRequestPromise;
  expect(renderRequest.postDataJSON()).toMatchObject({
    entity_id: "entity-1",
    key: "invoice_delivery",
    channel: "email",
    subject_template: "Invoice {{invoice_number}} from SKJ Capital",
  });

  await expect(
    renderedPreview.getByText("Invoice INV-7300 from SKJ Capital"),
  ).toBeVisible();
  await expect(
    renderedPreview.getByText(
      "Hi Sample Tenant Pty Ltd, your reviewed invoice is attached. Please contact SKJ Capital if any detail needs attention.",
    ),
  ).toBeVisible();

  expect(forbiddenApiCalls).toEqual([]);
});
