import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

// The ⌘K command bar becomes a Leasium AI launcher from any page: typing a
// question surfaces an "Ask Leasium AI" action that carries the text to
// /intake?ask=… .
test("command bar surfaces an Ask Leasium AI action from any page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open search" }).click();

  const input = page.getByRole("textbox", { name: "Command search" });
  await expect(input).toBeVisible();
  await input.fill("when does the gorilla grind lease end");

  const askRow = page.getByRole("link", { name: /Ask Leasium AI:/ });
  await expect(askRow).toBeVisible();
  await expect(askRow).toHaveAttribute("href", /\/intake\?ask=/);
});

// /intake?ask=… answers the question inline in the landing composer.
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

  await page.goto(`/intake?ask=${encodeURIComponent("when does the lease end")}`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Leasium AI" }),
  ).toBeVisible();
  await expect(
    page.getByText("Their lease ends 10 Dec 2027."),
  ).toBeVisible();
});
