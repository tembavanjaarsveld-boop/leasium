# Horizon Property Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Property detail frame (`PO2jOANgmqgZHfqWZXOZGU`, node `58:627`) as the selected-property state inside `/properties`.

**Status:** Implemented and locally verified 2026-06-10; pending Remba review,
commit, push, and Vercel deployment confirmation.

**Architecture:** Keep this frontend-only and reuse the existing selected-property data: property list/detail, tenancy units, leases, tenants, obligations, rent roll, charge rules, reviewed image, and evidence history. The detail view is a presentation layer over the existing queries; existing create/edit/image/evidence/billing/unit/lease workflows remain on explicit operator actions in the same component.

**Tech Stack:** Next.js App Router, React/TypeScript, Tailwind token classes, TanStack Query, Playwright smoke tests with mocked API.

---

## Files

- Modify: `apps/web/src/components/property-workspace.tsx`
  - Add selected-property detail tab state.
  - Add the Horizon detail header, bento metrics, current lease panel, and activity panel.
  - Map detail tabs to existing Lease/Billing/Documents workflows.
  - Keep provider/write actions unchanged.
- Modify: `apps/web/tests/smoke/properties-ux.spec.ts`
  - Add desktop selected-property detail expectations.
  - Keep Cards default and Table/Map/Calendar checks intact.
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`
  - Update the evidence/source-trail flow to pass through the new Documents tab.
  - Keep all-entities drop-in coverage.
- Modify: `apps/web/tests/smoke/appearance.spec.ts`
  - Add dark-mode route coverage for the selected-property detail frame.
- Modify: `docs/product-roadmap.md`, `docs/design-governance.md`, `docs/next-chat-handover.md`
  - Log the design-facing slice as Remba-pending.

## Tasks

### Task 1: Red Smoke For Selected-Property Detail

- [x] Add `desktop selected property opens on the Horizon detail frame` to `apps/web/tests/smoke/properties-ux.spec.ts`.

Expected assertions:

```ts
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto("/properties?entity_id=entity-1&property_id=property-1");
await expect(page.getByRole("link", { name: "Properties" })).toBeVisible();
await expect(page.getByRole("heading", { name: "Queen Street Retail Centre" })).toBeVisible();
await expect(page.getByText("Brisbane City QLD 4000 · Commercial retail · 1 unit")).toBeVisible();
await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
await expect(page.getByRole("button", { name: "Work order" })).toBeVisible();
await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
await expect(page.getByText("Rent", { exact: true })).toBeVisible();
await expect(page.getByText("$8,000 / mo")).toBeVisible();
await expect(page.getByText("Lease term")).toBeVisible();
await expect(page.getByText("Bright Cafe")).toBeVisible();
await expect(page.getByText("Current lease")).toBeVisible();
await expect(page.getByText("Bright Cafe Pty Ltd")).toBeVisible();
await expect(page.getByText("Activity")).toBeVisible();
await expect(page.getByText("Lease applied from Smart Intake")).toBeVisible();
await expect(page.getByRole("table").first()).toBeHidden();
```

- [x] Run the new test and confirm it fails before implementation:

```sh
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
PORT=3061 npm run test:smoke -- tests/smoke/properties-ux.spec.ts --grep "desktop selected property opens" --workers=1
```

Expected: FAIL because the current selected-property state still renders the old table-first workspace.

### Task 2: Implement Detail Overview

- [x] In `apps/web/src/components/property-workspace.tsx`, add `PropertyDetailTab = "overview" | "lease" | "billing" | "documents" | "activity"` and a `selectedPropertyDetailTab` state defaulting to `overview`.
- [x] Reset `selectedPropertyDetailTab` to `overview` when `selectedPropertyId` changes.
- [x] Add helper derivations local to `Workspace`:
  - selected unit count from `tenancyUnitsQuery.data`
  - selected current lease from `leasesQuery.data` + `pickUnitLease`
  - selected tenant from `tenantsById`
  - selected monthly rent from `monthlyRentByPropertyId.get(selectedProperty.id)`
  - selected obligations from `activeObligations`
  - selected activity rows from obligations, rent roll, latest property apply, and image/source history.
- [x] Add a local `PropertyDetailOverview` component near the existing property view components. It should render:
  - Back link that clears `property_id`, sets Cards view, and returns to `/properties`.
  - Header with image block, property name, owner/entity and occupancy chips, address/type/unit summary, Edit and Work order buttons.
  - Figma-style pill tabs: Overview, Lease, Billing, Documents, Activity.
  - Overview bento metrics: Rent, Lease term, Arrears/readiness, Compliance.
  - Current lease and Activity cards.
- [x] Render the detail component when the selected-property detail mode is open and hide the portfolio table in that state.

### Task 3: Wire Detail Tabs To Existing Workflows

- [x] Overview tab stays on the new detail overview.
- [x] Lease tab sets existing `activeWorkspaceTab` to `operations`, preserving Add unit/Edit lease flows.
- [x] Billing tab sets existing `activeWorkspaceTab` to `billing`, preserving enrichment and billing identity flows.
- [x] Documents tab sets existing `activeWorkspaceTab` to `documents`, preserving upload, image review, evidence drawer, and source history.
- [x] Activity tab renders the same detail shell with the Activity card expanded; no new endpoint.
- [x] Keep Cards/Table/Map/Calendar switcher behavior unchanged when no property is selected.

### Task 4: Update Existing Smokes

- [x] Update `property workspace shows the evidence source trail` in `apps/web/tests/smoke/app-flows.spec.ts`:
  - Assert deep link lands on the detail frame.
  - Click `Documents` detail tab before image/evidence assertions.
  - Preserve the reviewed image apply and evidence-source assertions.
- [x] Update all-entities drop-in expectations only if needed:
  - Selecting the secondary card should still switch to that entity and open the selected-property detail frame.
  - `New property` remains disabled in all-entities before selection.

### Task 5: Verify And Ship

- [x] Run targeted checks:

```sh
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
npm exec -- eslint src/components/property-workspace.tsx tests/smoke/properties-ux.spec.ts tests/smoke/app-flows.spec.ts
npm exec -- tsc --noEmit
PORT=3061 npm run test:smoke -- tests/smoke/properties-ux.spec.ts --workers=1
PORT=3062 npm run test:smoke -- tests/smoke/app-flows.spec.ts --grep "property workspace shows the evidence source trail|properties All entities|Properties multi-view" --workers=1
npm run build
```

- [ ] Browser-check `/properties?entity_id=entity-1&property_id=property-1` at 1280×900 and 390×844.
- [x] Update roadmap/governance/handover as Remba-pending.
- [ ] Commit with Gmail author identity, push `main`, verify Vercel READY.

## Result Notes

- The detail mode is explicit: property card clicks and valid `property_id` deep
  links open detail; automatic list selection does not silently add `property_id`.
- The Documents tab includes a compact property-image review panel so the existing
  image/evidence flow stays reachable after detail becomes the selected-property
  default.
- Activity is a frontend summary from already-loaded obligations, rent roll,
  image/source history, and latest apply data. It is not a new backend timeline.
- The arrears/readiness metric uses existing readiness data; a truly
  property-specific arrears source remains a product/backend follow-up.
- The in-app browser check was attempted on a fresh local dev server, but live
  API hydration was blocked because local Postgres was not running on
  `127.0.0.1:5432`; mocked Playwright smokes are the verified UI evidence.

## Guardrails

- No Xero write, SendGrid/Twilio send, tenant email, payment, or reconciliation paths change.
- No backend/API shape change in this slice.
- Existing edit/property image/evidence/unit/lease/billing mutations stay behind their current explicit operator actions.
- 04 Concept frames remain out of scope.
