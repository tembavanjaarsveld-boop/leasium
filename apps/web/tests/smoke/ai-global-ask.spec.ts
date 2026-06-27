import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

async function openCommandSearch(page: Page) {
  const toolbar = page.getByRole("toolbar", { name: "Workspace utilities" });
  await expect(toolbar).toBeVisible();
  const searchButton = toolbar.getByRole("button", { name: "Open search" });
  await expect(searchButton).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "Command search" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await searchButton.click();
    const opened = await dialog
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(
        () => true,
        () => false,
      );
    if (opened) return;
    await page.waitForTimeout(250);
  }

  await expect(dialog).toBeVisible();
}

// The ⌘K command bar becomes a Relby AI launcher from any page: typing a
// question surfaces an "Ask Relby AI" action that carries the text and the
// selected trust to /intake?ask=… .
test("command bar surfaces an Ask Relby AI action from any page", async ({
  page,
}) => {
  await seedPrimaryEntitySelection(page);
  await page.goto("/");
  await openCommandSearch(page);

  const input = page.getByRole("textbox", { name: "Command search" });
  await expect(input).toBeVisible();
  await input.fill("when does the gorilla grind lease end");

  const askRow = page.getByRole("link", { name: /Ask Relby AI:/ });
  await expect(askRow).toBeVisible();
  await expect(askRow).toHaveAttribute("href", /\/intake\?ask=/);
  await expect(askRow).toHaveAttribute("href", /entity_id=entity-1/);
});

// /intake?entity_id=…&ask=… answers the question inline in the landing composer.
test("intake answers a handed-off ?ask= question inline", async ({ page }) => {
  await page.route("**/api/v1/ai/ask", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "Their lease ends 10 Dec 2027.",
          citations: [],
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(
    `/intake?entity_id=entity-1&ask=${encodeURIComponent(
      "when does the lease end",
    )}`,
  );

  await expect(
    page.getByRole("heading", { level: 1, name: "Relby AI" }),
  ).toBeVisible();
  await expect(
    page.getByText("Their lease ends 10 Dec 2027."),
  ).toBeVisible();
});
