import { expect, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("comms draft shows stored template preview without dispatching", async ({
  page,
}) => {
  const mutationRequests: string[] = [];
  let previewRequests = 0;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method();

    if (method === "POST" && path === "/comms/template-preview") {
      previewRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entity_id: "entity-1",
          candidate_id: "maintenance_contractor_forward:maintenance_work_order:work-order-1",
          template_id: "branded-template-2",
          template_key: "maintenance_contractor_update",
          template_version: "v1",
          channel: "email",
          subject: "Maintenance update requested",
          body: "Please confirm the attendance window for Air conditioning fault.",
          variables: {
            property_name: "Queen Street Retail Centre",
            tenant_name: "Bright Cafe Pty Ltd",
            draft_body: "Hi Cool Air Services, please confirm the next action.",
          },
          guardrails: [
            "Template preview is review-only; it saves nothing and never sends any message.",
            "Approve & send remains the only provider-mutation action for this draft.",
            "If the operator edits the subject or body, the reviewed text wins over the template.",
          ],
        }),
      });
      return;
    }

    if (method !== "GET" && path.startsWith("/comms/")) {
      mutationRequests.push(`${method} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "preview smoke must not dispatch" }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/comms");

  await page.getByRole("tab", { name: "Contractor forward 1" }).click();
  const contractorForwardCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Contractor forward" }) })
    .first();

  await expect(contractorForwardCard).toBeVisible();
  await expect(
    contractorForwardCard
      .getByText("Template maintenance_contractor_update v1")
      .first(),
  ).toBeVisible();

  await contractorForwardCard.getByText("Stored template preview").click();
  await contractorForwardCard
    .getByRole("button", { name: "Preview stored template" })
    .click();

  await expect(
    contractorForwardCard.getByText("Maintenance update requested"),
  ).toBeVisible();
  await expect(
    contractorForwardCard.getByText(
      "Please confirm the attendance window for Air conditioning fault.",
    ),
  ).toBeVisible();
  await expect(
    contractorForwardCard.getByText("Template preview is review-only"),
  ).toBeVisible();
  expect(previewRequests).toBe(1);
  expect(mutationRequests).toEqual([]);
});
