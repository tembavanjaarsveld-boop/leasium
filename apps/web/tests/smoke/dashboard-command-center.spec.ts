import { expect, type Locator, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

async function expectTouchTarget(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
}

test("dashboard command center prepares work without raw loading counters", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.removeItem("leasium.entity_id");
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    await page.waitForTimeout(1200);
    await route.fallback();
  });

  await page.goto("/");

  const commandCenter = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Today's focus" }),
    })
    .first();

  await expect(commandCenter).toContainText("Today's focus");
  await expect(commandCenter).toContainText("Preparing today's focus.");
  await expect(commandCenter.getByText("...")).toHaveCount(0);
  await expect(commandCenter).not.toContainText("Loading…");
  await expect(commandCenter).not.toContainText("Refreshing…");
  await expect(commandCenter).not.toContainText("Loading today's focus.");
  await expect(page.locator("body")).not.toContainText(
    /Loading live portfolio|Loading recent activity\.|Loading upcoming events\./,
  );

  const metricStrip = page
    .locator("section")
    .filter({
      has: page.getByText("Operations", { exact: true }),
    })
    .first();
  await expect(metricStrip).toContainText("Checking");
  await expect(metricStrip).toContainText("Preparing");
  await expect(metricStrip.getByText("...", { exact: true })).toHaveCount(0);
  await expect(metricStrip).not.toContainText("Loading…");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("entity bootstrap stays warm across operator navigation", async ({
  page,
}) => {
  const entityRequests: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/entities") {
      entityRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Today's focus" }),
  ).toBeVisible();
  await expect(page.getByLabel("Entity")).toHaveValue("entity-1");
  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toHaveCount(0);

  await page.locator('nav a[href="/people"]').first().click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  await expect.poll(() => entityRequests.length).toBe(1);
});

test("stored entity lets dashboard data start before entities refresh settles", async ({
  page,
}) => {
  const requestEvents: string[] = [];
  let releaseEntities: (() => void) | null = null;
  const entitiesHeld = new Promise<void>((resolve) => {
    releaseEntities = resolve;
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/entities", async (route) => {
    requestEvents.push("entities-start");
    await entitiesHeld;
    requestEvents.push("entities-release");
    await route.fallback();
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/premises/by-entity/entity-1") {
      requestEvents.push("portfolio-start");
    }
  });

  await page.goto("/");

  await expect
    .poll(() => requestEvents.includes("portfolio-start"))
    .toBeTruthy();
  expect(requestEvents).not.toContain("entities-release");
  releaseEntities?.();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("dashboard groups upcoming lease events under a date-bucket header", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);

  await page.goto("/");

  const eventsPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Upcoming lease events" }),
    })
    .first();

  // B3: the seeded rent-review event renders under one of the lightweight
  // date-bucket headers (the exact bucket is relative to today's date).
  await expect(eventsPanel).toContainText("Bright Cafe Pty Ltd rent review");
  await expect(
    eventsPanel.getByText(/^(Overdue|Today|This week|Later)$/).first(),
  ).toBeVisible();
});

test("dashboard clarifies repeated near-term event chips", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");

    const fixedNow = new Date("2026-05-31T12:00:00.000Z").valueOf();
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor>) {
        if (args.length === 0) {
          super(fixedNow);
        } else {
          super(...args);
        }
      }

      static now() {
        return fixedNow;
      }
    }
    Object.setPrototypeOf(FixedDate, RealDate);
    globalThis.Date = FixedDate as DateConstructor;
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/insights/overview**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        lease_event_snapshot: {
          active_lease_count: 2,
          next_review_count: 1,
          next_expiry_count: 1,
          overdue_obligation_count: 0,
          due_soon_obligation_count: 0,
          tenant_onboarding_waiting_count: 0,
          next_events: [
            {
              id: "review-tomorrow",
              kind: "rent_review",
              title: "Bright Cafe Pty Ltd rent review",
              date: "2026-06-01",
              chip: "Tomorrow",
              href: "/properties",
              target: null,
              rank: 1,
            },
            {
              id: "expiry-tomorrow",
              kind: "lease_expiry",
              title: "Harbour Retail lease expiry",
              date: "2026-06-01",
              chip: "Tomorrow",
              href: "/properties",
              target: null,
              rank: 2,
            },
          ],
        },
      },
    });
  });

  await page.goto("/");

  const eventsPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Upcoming lease events" }),
    })
    .first();

  await expect(eventsPanel.getByText("Due tomorrow")).toHaveCount(2);
  await expect(eventsPanel.getByText("Tomorrow", { exact: true })).toHaveCount(
    0,
  );
});

test("dashboard keeps long upcoming event lists collapsed until requested", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");

    const fixedNow = new Date("2026-05-31T12:00:00.000Z").valueOf();
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor>) {
        if (args.length === 0) {
          super(fixedNow);
        } else {
          super(...args);
        }
      }

      static now() {
        return fixedNow;
      }
    }
    Object.setPrototypeOf(FixedDate, RealDate);
    globalThis.Date = FixedDate as DateConstructor;
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/insights/overview**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        lease_event_snapshot: {
          active_lease_count: 7,
          next_review_count: 4,
          next_expiry_count: 3,
          overdue_obligation_count: 0,
          due_soon_obligation_count: 0,
          tenant_onboarding_waiting_count: 0,
          next_events: Array.from({ length: 7 }, (_, index) => ({
            id: `event-${index + 1}`,
            kind: index % 2 === 0 ? "rent_review" : "lease_expiry",
            title: `Lease event ${index + 1}`,
            date: `2026-06-${String(index + 1).padStart(2, "0")}`,
            chip: `Jun ${index + 1}`,
            href: "/properties",
            target: null,
            rank: index + 1,
          })),
        },
      },
    });
  });

  await page.goto("/");

  const eventsPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Upcoming lease events" }),
    })
    .first();

  await expect(eventsPanel.getByText("Lease event 1")).toBeVisible();
  await expect(eventsPanel.getByText("Lease event 5")).toBeVisible();
  await expect(eventsPanel.getByText("Lease event 6")).toHaveCount(0);
  await expect(eventsPanel.getByText("Lease event 7")).toHaveCount(0);

  await eventsPanel.getByRole("button", { name: "Show all 7" }).click();
  await expect(eventsPanel.getByText("Lease event 7")).toBeVisible();

  await eventsPanel.getByRole("button", { name: "Show fewer" }).click();
  await expect(eventsPanel.getByText("Lease event 6")).toHaveCount(0);
});

test("dashboard recent activity disclosure keeps its control touch-friendly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/activity-feed**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        items: Array.from({ length: 10 }, (_, index) => ({
          id: `activity-${index + 1}`,
          occurred_at: new Date(Date.now() - index * 15 * 60_000).toISOString(),
          actor: index % 2 === 0 ? "Temba van Jaarsveld" : "System",
          actor_kind: index % 2 === 0 ? "operator" : "system",
          action: "review",
          action_kind: "review",
          action_label: "Reviewed",
          summary: `Reviewed dashboard activity ${index + 1}.`,
          target_table: "document_intake",
          target_id: `activity-target-${index + 1}`,
          target_label: `Activity item ${index + 1}`,
          target_href: "/intake",
          tool_name: null,
          outcome: "success",
          error_message: null,
        })),
        has_more: false,
        next_cursor: null,
      },
    });
  });

  await page.goto("/");

  const activityPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Recent activity" }),
    })
    .first();

  await expect(activityPanel.getByText("Activity item 1")).toBeVisible();
  await expect(activityPanel.getByText("Activity item 8")).toBeVisible();
  await expect(activityPanel.getByText("Activity item 9")).toHaveCount(0);

  const showAll = activityPanel.getByRole("button", { name: "Show all 10" });
  await expect(showAll).toBeVisible();
  await expectTouchTarget(showAll);
  await showAll.click();

  await expect(activityPanel.getByText("Activity item 10")).toBeVisible();

  const showFewer = activityPanel.getByRole("button", { name: "Show fewer" });
  await expectTouchTarget(showFewer);
});

test("dashboard compliance cue surfaces overdue and due-soon counts with links", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);

  await page.goto("/");

  const compliancePanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Compliance" }),
    })
    .first();

  // Default insights-overview fixture: overdue_count 1, due_soon_count 1,
  // operator_approved_evidence_count 1, recently_completed_count 1.
  await expect(compliancePanel.getByText("1 overdue")).toBeVisible();
  await expect(compliancePanel.getByText("1 due soon")).toBeVisible();
  await expect(compliancePanel.getByText("1 evidence approved")).toBeVisible();
  await expect(
    compliancePanel.getByText("1 recently completed"),
  ).toBeVisible();
  await expect(compliancePanel.getByText("Needs attention")).toBeVisible();

  const openCompliance = compliancePanel.getByRole("link", {
    name: "Open compliance",
  });
  await expect(openCompliance).toHaveAttribute(
    "href",
    "/operations?tab=compliance",
  );
  await expectTouchTarget(openCompliance);
  await expect(
    compliancePanel.getByRole("link", { name: "View insights" }),
  ).toHaveAttribute("href", "/insights");
});

test("dashboard onboarding manage links action stays touch-safe", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Today's focus" }),
  ).toBeVisible();
  await expectTouchTarget(page.getByRole("link", { name: "Manage links" }));
});

test("dashboard overview clears first-paint loading before detailed fan-out settles", async ({
  page,
}) => {
  let releaseDetailed: (() => void) | null = null;
  const detailedHeld = new Promise<void>((resolve) => {
    releaseDetailed = resolve;
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const slowPaths = [
      "/premises/by-entity/entity-1",
      "/tenants",
      "/obligations",
      "/rent-roll",
      "/tenant-onboarding",
      "/document-intakes",
      "/insights/overview",
      "/activity-feed",
    ];
    if (slowPaths.includes(path)) {
      await detailedHeld;
    }
    await route.fallback();
  });

  await page.goto("/");

  const commandCenter = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Today's focus" }),
    })
    .first();
  try {
    await expect(
      commandCenter.getByRole("heading", { name: "Today's focus" }),
    ).toBeVisible();
    await expect(commandCenter).not.toContainText("Preparing today's focus.");
    const billingCard = page
      .locator("a")
      .filter({ has: page.getByText("Billing blockers", { exact: true }) })
      .first();
    await expect(billingCard).toContainText(/Billing blockers\s*5\s*Blocked/);
  } finally {
    releaseDetailed?.();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
