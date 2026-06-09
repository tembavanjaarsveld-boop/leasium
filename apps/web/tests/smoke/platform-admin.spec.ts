import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test("platform admin sees the /admin clients list and platform integrations", async ({
  page,
}) => {
  await mockLeasiumApi(page, { platformAdmin: true });
  await page.goto("/admin");

  await expect(
    page.getByRole("heading", { name: "Platform admin" }),
  ).toBeVisible();

  // Platform-admin nav entry is present in the sidebar.
  await expect(
    page.getByRole("link", { name: "Platform admin" }).first(),
  ).toBeVisible();

  // Clients tab is the default and lists the mocked client orgs.
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Harbour Lane Holdings")).toBeVisible();
  await expect(page.getByText("Rivergum Trust")).toBeVisible();
  await expect(page.getByText("Suspended")).toHaveCount(0);

  // Provision-client form is present.
  await expect(page.getByLabel("Organisation name")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Provision client" }),
  ).toBeVisible();

  // Manage operators drills into a client's operators.
  await page
    .getByRole("button", { name: "Manage operators" })
    .first()
    .click();
  await expect(page.getByText(/Operators ·/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invite operator" }),
  ).toBeVisible();

  // Platform integrations tab shows the relocated health card.
  await page.getByRole("tab", { name: "Platform integrations" }).click();
  await expect(
    page.getByRole("heading", { name: "Integrations" }),
  ).toBeVisible();
  await expect(page.getByText("SerpAPI Google Images")).toBeVisible();
});

test("client operator cannot access /admin and has no admin nav entry", async ({
  page,
}) => {
  await mockLeasiumApi(page, { platformAdmin: false });
  await page.goto("/admin");

  // No platform-admin nav entry for a client operator.
  await expect(
    page.getByRole("link", { name: "Platform admin" }),
  ).toHaveCount(0);

  // The /admin surface blocks a non-admin operator. EmptyState renders its
  // title as text (not a heading role), so assert on the text.
  await expect(
    page.getByText("Platform admin access required"),
  ).toBeVisible();
  await expect(page.getByText("Harbour Lane Holdings")).toHaveCount(0);
});

test("client Settings no longer shows the Integrations panel", async ({
  page,
}) => {
  await mockLeasiumApi(page, { platformAdmin: false });
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("tab", { name: "Organisation" }).click();
  await expect(
    page.getByRole("heading", { name: "Organisation profile" }),
  ).toBeVisible();

  // The Integrations health card was relocated to /admin — it must not appear
  // on the client Settings Organisation tab.
  await expect(
    page.getByRole("heading", { name: "Integrations", exact: true }),
  ).toHaveCount(0);
});
