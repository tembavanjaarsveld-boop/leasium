import { expect, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("comms queue supports keyboard review without stealing draft editing", async ({
  page,
}) => {
  const mutationRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== "GET" &&
      url.pathname.startsWith("/api/v1/comms/")
    ) {
      mutationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto("/comms");
  await expect(
    page.getByRole("heading", { name: "Comms queue" }),
  ).toBeVisible();

  const smsDraft = page.getByRole("listitem", {
    name: /Review Inbound SMS draft for Bright Cafe Pty Ltd/,
  });
  const emailDraft = page.getByRole("listitem", {
    name: /Review Inbound email draft for Bright Cafe Pty Ltd/,
  });

  await smsDraft.focus();
  await expect(smsDraft).toBeFocused();

  await page.keyboard.press("j");
  await expect(emailDraft).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(smsDraft).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(smsDraft.getByLabel("Phone recipient")).toBeFocused();

  await page.keyboard.press("j");
  await expect(smsDraft.getByLabel("Phone recipient")).toBeFocused();

  expect(mutationRequests).toEqual([]);
});
