import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
});

function watchOwnerStatementSendRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/owners/statements/send")
    ) {
      requests.push(request.url());
    }
  });
  return requests;
}

test("owner statement send is two-step confirmed before any email fires", async ({
  page,
}) => {
  const sendRequests = watchOwnerStatementSendRequests(page);
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();

  // The owner with a billing email is the enabled send path.
  await page
    .getByLabel("Select statement owner")
    .selectOption({ label: "Queen Street Property Trust" });

  const sendButton = page.getByRole("button", { name: "Send statement" });
  await expect(sendButton).toBeVisible();
  await expect(sendButton).toBeEnabled();

  // First click only primes the inline confirm — no request leaves yet.
  await sendButton.click();
  await expect(
    page.getByText(
      "Send this statement as a real email to owners@queenstreet.example?",
    ),
  ).toBeVisible();
  expect(sendRequests).toHaveLength(0);

  // Cancel dismisses without sending.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Send statement" }),
  ).toBeVisible();
  expect(sendRequests).toHaveLength(0);

  // Re-open the confirm and approve.
  await page.getByRole("button", { name: "Send statement" }).click();
  await page.getByRole("button", { name: "Confirm send" }).click();

  await expect(page.getByText("Queued")).toBeVisible();
  await expect(page.getByText("to owners@queenstreet.example")).toBeVisible();
  await expect(page.getByText("Provider message id: sg-smoke-1")).toBeVisible();
  expect(sendRequests).toHaveLength(1);
});

test("owner statement send is disabled when the owner has no billing email", async ({
  page,
}) => {
  const sendRequests = watchOwnerStatementSendRequests(page);
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();

  await page
    .getByLabel("Select statement owner")
    .selectOption({ label: "Eagle Street Property Trust" });

  await expect(
    page.getByRole("button", { name: "Send statement" }),
  ).toBeDisabled();
  await expect(page.getByText("No billing email")).toBeVisible();
  expect(sendRequests).toHaveLength(0);
});
