# Tenant portal redesign — light sidebar, maintenance-first

Shipped slice (2026-06-24). Restructures the post-onboarding tenant portal
(`apps/web/src/app/tenant-portal/tenant-portal-content.tsx`, `fullPortalUnlocked`
body) from a single long scroll into a navigated, maintenance-first workspace.

## Approved direction
Signed off by Temba on the interactive HTML prototype (`tenant-portal-redesign.html`):
- **Light left sidebar** on desktop → collapses to an **icon rail** (tablet) →
  **thumb-reachable bottom tab bar** (mobile). Not the dark operator navy.
- **Slim, maintenance-first Home**: one calm "one thing to do" line, a prominent
  "Report an issue" hero with live request status, then quick tiles
  (balance, documents, next review).
- **Polished on existing tokens** — Geist/blue/teal, Horizon cards, status-chip
  vocabulary, 44px targets. No new colours or components.

## Destinations
Home · Maintenance · Payments · Documents · Lease & details. Account/settings,
contact details and notification prefs live under Lease & details (kept the
sidebar to 5 items rather than adding a 6th).

## Behaviour preserved (no provider/guardrail changes)
All existing data fetching and mutations are untouched — the section panels were
relocated into tabs, not rewritten. Clerk auth, token vs account modes,
maintenance/upload/contact/preferences mutations, document download, and the
review-first "Leasium does not process payments" copy all remain. The operator
preview (`portal-preview/.../page.tsx`) and the pre-onboarding / lease-signing /
sign-in gate flows are unchanged.

## Verification (on Temba's Mac via Desktop Commander)
- `eslint src/app/tenant-portal/tenant-portal-content.tsx` — clean
- `tsc --noEmit` — 0 errors (whole app)
- `playwright test -g "tenant portal"` — 17 passed, 6 skipped (Clerk-gated
  account-entry tests, skipped without a signed-in smoke session), 0 failed
- `next build` — success; `/tenant-portal` routes compiled

Smoke updates: `tenants-ux.spec.ts` upload-documents touch-target test now
asserts the SecondaryButton tab-jump; `app-flows.spec.ts` linked-account test is
nav-aware (clicks Lease & details / Payments tabs). The Clerk-gated account test
could not be executed in this environment.

## UX gate
Design sign-off (the human gate) met via the approved prototype; build to spec
done; tokens pulled from the design source of truth. Real 1440/390 screenshots
of the **authed** portal could not be captured locally — the full portal is
Clerk-gated and does not render without a signed-in tenant session. Final
1440/390 visual pass to be done on the live deploy (Clerk available).

## Cleanup debt (follow-ups, intentionally deferred)
- `TenantPortalMobileCockpit` is now unused (its only call site was removed). Left
  in place to avoid a large deletion right before the push; its source-regex test
  (`tenants-ux.spec.ts` "mobile Horizon cockpit…") still passes against it. Remove
  both together in a follow-up.
- `design-governance.md` UX Pass Log, `product-roadmap.md`, and
  `next-chat-handover.md` updates were **deferred**: those files are already
  modified by an unrelated in-flight (parked Workflows) slice in the working tree,
  and editing them would entangle this isolated commit. Add the governance line
  when that slice is committed or the tree is clean.
- Mirror the approved screens into the Figma SoT file (`PO2jOANgmqgZHfqWZXOZGU`).
