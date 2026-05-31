import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(__dirname, "../..");

async function source(relativePath: string) {
  return readFile(path.join(appRoot, relativePath), "utf8");
}

test("operator intake-adjacent pages use shared error and chip-tone helpers", async () => {
  const files: Array<{
    path: string;
    usesErrorHelper: boolean;
    usesToneHelper: boolean;
  }> = [
    {
      path: "src/app/contractors/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: true,
    },
    {
      path: "src/app/inbox/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: true,
    },
    {
      path: "src/app/insights/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: true,
    },
    {
      path: "src/app/notifications/page.tsx",
      usesErrorHelper: false,
      usesToneHelper: true,
    },
    {
      path: "src/app/operations/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: true,
    },
    {
      path: "src/app/operations/maintenance/[workOrderId]/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: true,
    },
    {
      path: "src/app/intake/spreadsheet/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: false,
    },
    {
      path: "src/app/intake/register-import-panel.tsx",
      usesErrorHelper: true,
      usesToneHelper: false,
    },
    {
      path: "src/app/portfolio-qa/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: true,
    },
    {
      path: "src/app/tenants/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: false,
    },
    {
      path: "src/app/tenants/[tenantId]/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: false,
    },
    {
      path: "src/app/statements/page.tsx",
      usesErrorHelper: true,
      usesToneHelper: false,
    },
    {
      path: "src/components/dashboard.tsx",
      usesErrorHelper: true,
      usesToneHelper: true,
    },
  ];

  for (const file of files) {
    const text = await source(file.path);
    expect(text).not.toContain("function friendlyError(");
    expect(text).not.toContain(
      'type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";',
    );
    expect(text).not.toContain(
      'type Tone = "neutral" | "success" | "warning" | "danger" | "primary";',
    );
    if (file.usesErrorHelper) {
      expect(text).toContain("friendlyError");
    }
    if (file.usesToneHelper) {
      expect(text).toContain("type StatusTone");
    }
  }
});

test("property workspace keeps access-specific error copy while sharing generic errors", async () => {
  const text = await source("src/components/property-workspace.tsx");

  expect(text).toContain("friendlyError as baseFriendlyError");
  expect(text).toContain("return baseFriendlyError(error);");
  expect(text).toContain(
    "That entity is no longer available. Select another entity to continue.",
  );
  expect(text).toContain(
    "That property is no longer available. Select another property to continue.",
  );
});

test("tenant portal account reads are user-scoped and fail closed on refresh", async () => {
  const text = await source("src/app/tenant-portal/tenant-portal-content.tsx");

  expect(text).toContain(
    'const tenantAccountUserKey = user?.id ?? "signed-out";',
  );
  expect(text).toContain(
    'const tenantAccountRouteKey = token ? `token:${token}` : "account-entry";',
  );
  expect(text).toContain(
    "const tokenTenantId = invitePreviewQuery.data?.tenant_id ?? null;",
  );
  expect(text).toContain("const accountPortalStateMatches =");
  expect(text).toContain(
    "accountPortalState?.userKey === tenantAccountUserKey",
  );
  expect(text).toContain(
    "accountPortalState.routeKey === tenantAccountRouteKey",
  );
  expect(text).toMatch(
    /queryKey:\s*\[\s*"tenant-portal-account-session",\s*tenantAccountUserKey,\s*tenantAccountContextKey,\s*\]/,
  );
  expect(text).toMatch(
    /queryKey:\s*\[\s*"tenant-portal-account-status",\s*tenantAccountUserKey,\s*tenantAccountContextKey,\s*\]/,
  );
  expect(text).toContain("(!token || Boolean(tokenTenantId))");
  expect(text).toContain('refetchOnMount: "always"');
  expect(text).toContain("const accountQueryHasFreshData =");
  expect(text).toContain("const accountPortal = accountQueryHasFreshData");
  expect(text).toContain("const accountStatusQueryHasFreshData =");
  expect(text).toContain("const accountStatus = accountStatusQueryHasFreshData");
  expect(text).toContain("useLayoutEffect(() =>");
  expect(text).toContain(
    'queryClient.setQueryData(\n        [\n          "tenant-portal-account-session"',
  );
  expect(text).toMatch(
    /catch\s*\{\s*handleAccountPortal\(null, null\);\s*return;\s*\}/,
  );

  const clearBeforePublish = text.indexOf("if (!accountQueryHasFreshData)");
  const publishAccountPortal = text.indexOf(
    "onAccountPortal(accountQuery.data.portal, accountQuery.data.authToken);",
  );
  expect(clearBeforePublish).toBeGreaterThan(-1);
  expect(publishAccountPortal).toBeGreaterThan(-1);
  expect(clearBeforePublish).toBeLessThan(publishAccountPortal);
});
