import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBudgetStatus,
  DEFAULT_ROUTE_SPECS,
  isSignedOutPageState,
  parseRoutes,
} from "./live-ux-audit.mjs";

test("default live-audit routes follow the current hub IA", () => {
  const paths = DEFAULT_ROUTE_SPECS.map(([pathname]) => pathname);

  assert.deepEqual(paths, [
    "/",
    "/intake",
    "/properties",
    "/people",
    "/operations",
    "/billing-readiness",
    "/money",
    "/insights",
    "/settings",
  ]);
});

test("signed-out operator gate is classified independently of URL", () => {
  assert.equal(
    isSignedOutPageState({
      url: "https://leasium.ai/operations",
      body_sample:
        "Leasium operator login Sign in to open the workspace Operator access is required Property team workspace",
    }),
    true,
  );
});

test("signed-out pages warn even when route copy would otherwise match", () => {
  const status = classifyBudgetStatus({
    navigationError: null,
    hasStorageState: true,
    settledMs: 6_000,
    pageErrors: [],
    pageState: {
      url: "https://leasium.ai/operations",
      body_sample:
        "Sign in to open the workspace Operator access is required Property team workspace",
      horizontal_overflow: false,
    },
  });

  assert.equal(status, "warn");
});

test("custom route parsing still accepts comma-separated route overrides", () => {
  assert.deepEqual(parseRoutes("operations, /settings", []), [
    { pathname: "/operations", label: "operations", readyPattern: null },
    { pathname: "/settings", label: "settings", readyPattern: null },
  ]);
});
