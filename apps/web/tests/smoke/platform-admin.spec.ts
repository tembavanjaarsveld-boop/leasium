import { mkdir } from "node:fs/promises";

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

  // AI Mailbox aliases are controlled from the platform tier, not client
  // Settings. These actions mutate only the mocked local routing API.
  await page.getByRole("tab", { name: "Mailbox aliases" }).click();
  await expect(
    page.getByRole("heading", { name: "Mailbox aliases" }),
  ).toBeVisible();
  const harbourAliasRow = page
    .getByRole("listitem")
    .filter({ hasText: "harbour@inbox.leasium.ai" });
  await expect(harbourAliasRow).toBeVisible();
  await expect(
    page.getByText(
      "Changing aliases does not send email, apply Smart Intake, move money, or reconcile.",
    ),
  ).toBeVisible();

  const reserveAliasForm = page
    .locator("form")
    .filter({ hasText: "Reserve client alias" });
  await reserveAliasForm
    .getByLabel("Client organisation")
    .selectOption("client-org-2");
  await reserveAliasForm.getByLabel("Alias").fill("rivergum-new");
  await reserveAliasForm
    .getByLabel("Label", { exact: true })
    .fill("Rivergum intake");
  await reserveAliasForm.getByRole("button", { name: "Reserve alias" }).click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "rivergum-new@inbox.leasium.ai" }),
  ).toBeVisible();
  await expect(
    page.getByText("Reserved rivergum-new@inbox.leasium.ai."),
  ).toBeVisible();

  await harbourAliasRow
    .getByLabel("Label for harbour@inbox.leasium.ai")
    .fill("Harbour mailroom");
  await harbourAliasRow.getByRole("button", { name: "Save label" }).click();
  await expect(
    page.getByText("Updated harbour@inbox.leasium.ai."),
  ).toBeVisible();
  await expect(
    harbourAliasRow.getByLabel("Label for harbour@inbox.leasium.ai"),
  ).toHaveValue("Harbour mailroom");

  await harbourAliasRow.getByRole("button", { name: "Disable" }).click();
  await expect(harbourAliasRow.getByText("Disabled")).toBeVisible();
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

test("platform admin mailbox aliases fit desktop and mobile", async ({
  page,
}) => {
  await mkdir("../../output/playwright", { recursive: true });

  for (const viewport of [
    { label: "1440", width: 1440, height: 900 },
    { label: "390", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await mockLeasiumApi(page, { platformAdmin: true });
    await page.goto("/admin");
    await page.addStyleTag({
      content:
        "nextjs-portal, script[data-nextjs-dev-overlay='true'] { display: none !important; }",
    });
    await page.getByRole("tab", { name: "Mailbox aliases" }).click();

    await expect(
      page.getByRole("heading", { name: "Mailbox aliases" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reserve alias" })).toBeVisible();
    await expect(
      page.getByText("Disabled aliases quarantine future mail as evidence"),
    ).toBeVisible();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: `../../output/playwright/platform-admin-mailbox-aliases-${viewport.label}.png`,
      fullPage: true,
    });
  }
});
