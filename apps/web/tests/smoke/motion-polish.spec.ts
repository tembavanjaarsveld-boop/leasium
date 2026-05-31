import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const commandCenterPath = path.join(
  process.cwd(),
  "src/components/dashboard/DashboardCommandCenter.tsx",
);
const activityFeedPath = path.join(
  process.cwd(),
  "src/components/dashboard/ActivityFeedPanel.tsx",
);
const upcomingLeaseEventsPath = path.join(
  process.cwd(),
  "src/components/dashboard/UpcomingLeaseEventsPanel.tsx",
);

test("dashboard list rows use the shared Leasium motion tokens", async () => {
  const [commandCenterSource, activityFeedSource, upcomingLeaseEventsSource] =
    await Promise.all([
      readFile(commandCenterPath, "utf8"),
      readFile(activityFeedPath, "utf8"),
      readFile(upcomingLeaseEventsPath, "utf8"),
    ]);

  expect(commandCenterSource).toContain(
    "transition duration-200 ease-leasium hover:bg-muted/55",
  );
  expect(activityFeedSource).toContain(
    "animate-leasium-row-in grid gap-1 rounded-md border border-border bg-white p-3 text-sm transition duration-200 ease-leasium",
  );
  expect(upcomingLeaseEventsSource).toContain(
    "animate-leasium-row-in grid gap-1 rounded-md border border-border bg-white p-3 text-sm transition duration-200 ease-leasium",
  );
});
