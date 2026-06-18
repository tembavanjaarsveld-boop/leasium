import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const commandCenterPath = path.join(
  process.cwd(),
  "src/components/dashboard/DashboardCommandCenter.tsx",
);
const activityAuditPath = path.join(
  process.cwd(),
  "src/components/activity-audit-panel.tsx",
);
const upcomingLeaseEventsPath = path.join(
  process.cwd(),
  "src/components/dashboard/UpcomingLeaseEventsPanel.tsx",
);

test("dashboard list rows use the shared Leasium motion tokens", async () => {
  const [commandCenterSource, activityAuditSource, upcomingLeaseEventsSource] =
    await Promise.all([
      readFile(commandCenterPath, "utf8"),
      readFile(activityAuditPath, "utf8"),
      readFile(upcomingLeaseEventsPath, "utf8"),
    ]);

  expect(commandCenterSource).toContain("transition duration-200 ease-leasium");
  expect(commandCenterSource).toContain("hover:border-primary/30");
  expect(activityAuditSource).toContain(
    "animate-leasium-row-in grid gap-1 rounded-md border border-border bg-white p-3 text-sm transition duration-200 ease-leasium",
  );
  expect(upcomingLeaseEventsSource).toContain(
    "animate-leasium-row-in grid gap-1 rounded-md border border-border bg-white p-3 text-sm transition duration-200 ease-leasium",
  );
});
