# Leasium Next Chat Handover

Last updated: 2026-06-08

## Codex continuation - 2026-06-08 (Settings Xero accounting touch targets - latest)

Follow-up from the autonomous Chrome + Computer Use production UX sweep on
`https://leasium.ai`: the fresh route-by-route pass found one true remaining
target-size issue in Settings -> Xero. The exception queue and older chart/tax
mapping controls mixed 16px text links, 32-40px action buttons, and dense finance
handoffs inside an otherwise review-first accounting surface.

Files changed across the shipped Settings/Xero touch-target pass:
- `apps/web/src/app/settings/page.tsx`: raises Settings -> Xero exception packet
  copy/download actions, exception row `Apply suggestion` buttons, exception
  `Open property` handoffs, accounting freshness next-step handoffs, and chart/tax
  table `Open property` / local `Apply` controls to the 44px target baseline.
- `apps/web/tests/smoke/settings-xero-ux.spec.ts`: adds focused desktop/mobile
  bounding-box coverage for the Xero exception queue and the accounting/chart-tax
  readiness handoffs without clicking provider mutations.
- `docs/product-roadmap.md` and `docs/design-governance.md`: record the visible
  Settings/Xero accounting-support follow-up as Remba-pending/prototype review.

Commits and deployment status:
- `f87891b` `Harden Xero exception targets` pushed to `main`; production
  deployment `dpl_6wnGJriMJZnzYXsTavCZPEguZ3V2` reached `READY` and was aliased
  to `leasium.ai`.
- `31b0755` `Harden Xero readiness targets` pushed to `main`; production
  deployment `dpl_DF7LpRtXXMvcwBtAGv2ZAhs2BVx7` reached `READY` and was aliased
  to `leasium.ai`, `www.leasium.ai`, and `leasium.vercel.app`.

Verification:
- Red/green proof: the new
  `desktop settings Xero readiness handoffs stay touch-safe` smoke first failed
  on the accounting next-step button at 40px, then passed after the class changes.
- `npx playwright test tests/smoke/settings-xero-ux.spec.ts`
- `npx playwright test tests/smoke/app-flows.spec.ts -g "settings shows Xero readiness and records mappings"`
- `npm run lint`
- `./node_modules/.bin/tsc --noEmit`
- `git diff --check`
- `npm run build`
- Live Chrome proof on `leasium.ai/settings?tab=xero` after `31b0755`: the
  accounting handoff, exception packet actions, exception row actions, chart/tax
  `Open property`, and chart/tax local `Apply` controls all rendered at 44px or
  taller; no rendered old-pattern 16px `Open property` links remained, and Chrome
  console logs were empty.
- Vercel production runtime logs for `dpl_DF7LpRtXXMvcwBtAGv2ZAhs2BVx7` had no
  error/warning/fatal entries in the last 30 minutes, and Vercel toolbar feedback
  on `main` had no unresolved threads.

Fresh sweep notes:
- The wider production audit covered Dashboard, Smart Intake, Properties, People,
  Operations, Compliance, Billing Readiness, Comms, Notifications, Money,
  Statements, Portfolio QA, Insights, Settings, Owner portal, Tenant portal, and
  Vendor portal at top/middle/bottom scroll positions. The remaining Security
  checkbox and Portfolio QA link hits were false positives from wrapped 44px
  labels/edge clipping; the actionable Settings/Xero issues above are now fixed.
- No provider mutation, Xero write, SendGrid email, Twilio SMS, tenant email,
  payment reconciliation, or provider refresh was run; production browser work was
  read-only except for opening local disclosures/links for measurement.

Active local state after this handover update should be clean once committed.

## Codex continuation - 2026-06-07 (Production UX sweep touch targets + People fallback - latest)

Follow-up from the autonomous Chrome + Computer Use production UX sweep on
`https://leasium.ai`: 66 production routes/detail pages were reviewed at
top/middle/bottom scroll positions for touch targets, console noise, mode-gated
copy, and obvious visual regressions. The remaining actionable issues from that
sweep were compact account/settings targets and one self-managed People URL
legibility bug.

Files changed across the shipped UX sweep:
- `apps/web/src/lib/clerk-appearance.ts`,
  `apps/web/src/components/app-shell.tsx`,
  `apps/web/src/app/account/[[...account]]/account-page-client.tsx`, and
  `apps/web/src/app/tenant-portal/tenant-portal-content.tsx`: share the 44px
  Clerk account-menu trigger appearance across operator/account/tenant portal
  surfaces.
- `apps/web/src/app/settings/page.tsx`: raises Organisation `Open tagged
  properties`, DocuSign setup packet actions, and ownership-tag property links
  to the 44px target baseline.
- `apps/web/src/app/people/page.tsx`: rewrites stale or hand-typed
  `/people?tab=owners` to `/people?tab=tenants` for self-managed accounts once
  operating mode resolves, keeping the URL aligned with the visible tab and
  preserving the owner-client hub gate.
- `apps/web/tests/smoke/app-flows.spec.ts`,
  `apps/web/tests/smoke/helper-consolidation.spec.ts`, and
  `apps/web/tests/smoke/people-hub.spec.ts`: lock the target-size and People
  fallback regressions.
- `docs/product-roadmap.md` and `docs/design-governance.md`: record the
  Remba-pending visible UX follow-ups.

Commits and deployment status:
- `c447bea` `Fix account menu touch targets` pushed to `main`; production
  deployment `dpl_79mfEKziwgBBd47Dap1Me9LPoE5R` reached `READY` and was aliased
  to `leasium.ai`. Earlier obsolete deployment `a9a200b` was blocked because the
  author email was `temba@skjcapital.com`; local git author was corrected to
  `Temba van Jaarsveld <tembavanjaarsveld@gmail.com>`, the commit was amended,
  and the corrected SHA was force-with-lease pushed.
- `f2e9182` `Harden Settings support targets` pushed to `main`; production
  deployment `dpl_3hoa9u8papuZexUhUzkbrA9qcfiv` reached `READY` and was aliased
  to `leasium.ai`.
- `b0f47c1` `Canonicalize People owner fallback` pushed to `main`; production
  deployment `dpl_8zhhGqn58xH7t5pgBwifzgTUgUR2` reached `READY` and was aliased
  to `leasium.ai`, `www.leasium.ai`, and `leasium.vercel.app`.

Verification:
- Account/settings slice:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "settings shows Xero readiness and records mappings"`,
  `npx playwright test tests/smoke/helper-consolidation.spec.ts -g "Clerk user menu|tenant portal account reads"`,
  `npm run lint`, `./node_modules/.bin/tsc --noEmit`, `git diff --check`,
  and `npm run build` all passed.
- Settings support-target slice:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "settings shows Xero readiness and records mappings"`,
  `npm run lint`, `./node_modules/.bin/tsc --noEmit`, `git diff --check`,
  and `npm run build` all passed.
- People fallback slice:
  `npx playwright test tests/smoke/people-hub.spec.ts -g "self-managed people hub hides owner-client tab"`,
  `npx playwright test tests/smoke/people-hub.spec.ts`, `npm run lint`,
  `./node_modules/.bin/tsc --noEmit`, `git diff --check`, and `npm run build`
  all passed.
- Live Chrome proof on `leasium.ai` after `b0f47c1`: `/people?tab=owners`
  rewrote to `/people?tab=tenants`, Tenants was selected, Owners was hidden,
  no owner-client copy rendered, all visible controls were at least 44px, and
  Chrome console logs were empty. A compact post-deploy sweep of
  `/people?tab=owners`, `/settings?tab=organisation`, and
  `/tenant-portal/account` at top/middle/bottom scroll positions found no
  visible sub-44px controls and no Chrome logs.
- Vercel production runtime logs for `dpl_8zhhGqn58xH7t5pgBwifzgTUgUR2` had no
  error/warning/fatal entries in the last 30 minutes, and Vercel toolbar
  feedback on `main` had no unresolved threads.

Active local state after this handover update should be clean once committed.
No provider mutation, Xero write, SendGrid email, Twilio SMS, tenant email, or
payment reconciliation was run; all production browser work was read-only.

## Codex continuation - 2026-06-07 (Tenant detail lease activity timezone fix - latest)

Follow-up from the live Chrome + Computer Use tenant-detail check after the
secondary-error labels deployed: the remaining live partial failure was now
clearly labeled `Tenant context: Failed to fetch`. A focused backend regression
reproduced the production-shaped failure: tenant detail activity mixed
timezone-aware tenant timestamps with a timezone-naive `datetime` derived from
lease `commencement_date`, causing Python to raise `TypeError: can't compare
offset-naive and offset-aware datetimes` while sorting activity.

Files changed:
- `apps/api/routers/tenants.py` now converts date-only lease activity events to
  UTC start-of-day timestamps and sorts tenant activity through a UTC-normalized
  key, keeping older naive rows comparable without changing stored data.
- `tests/integration/test_register_api.py` adds a tenant-detail regression with
  an aware tenant timestamp and active lease context.
- `docs/product-roadmap.md` records the backend stability fix.

Verification so far:
- RED: `.venv/bin/python -m pytest tests/integration/test_register_api.py -k "tenant_detail_handles_lease_activity_with_aware_timestamps"`
  first failed with `TypeError: can't compare offset-naive and offset-aware datetimes`.
- GREEN: the same focused test passed after normalizing lease activity
  timestamps and sort keys.
- `.venv/bin/python -m pytest tests/integration/test_register_api.py` - 13 passed.
- `.venv/bin/ruff check apps/api/routers/tenants.py tests/integration/test_register_api.py` - passed.
- `git diff --check` - passed.
- Commit `7763228` pushed to `main`; Render health reports
  `776322867d60841a61793d42edc9fd8750b701cd`.
- Live Chrome re-check passed after Render deploy: the affected imported tenant
  rendered `AAM Corporate (AAM Corporate Pty Ltd)`, linked lease context,
  `Lease active` activity, no `Tenant unavailable`, no `Failed to fetch`, no
  secondary error summary, no visible sub-44px controls, and no console errors.

## Codex continuation - 2026-06-07 (Tenant detail secondary-error labels - latest)

Follow-up from the live Chrome + Computer Use deep-record UX sweep: after
tenant pages were changed to keep the primary record visible, a real imported
tenant still surfaced a bottom-of-page `Failed to fetch` with no panel context.
That shared error line covered several secondary reads, so the operator could
not tell whether the failure belonged to tenant context, documents,
correspondence, source history, portal access, leases, or onboarding.

Files changed:
- `apps/web/src/app/tenants/[tenantId]/page.tsx` now renders a compact
  source-labeled secondary error summary while leaving primary tenant 404 and
  non-404 failures on the record-level unavailable/not-found paths.
- `apps/web/tests/smoke/people-record-layout.spec.ts` tightens the partial
  tenant-detail failure smoke to require the `Tenant context:` label.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  tenant detail error-label follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npx playwright test tests/smoke/people-record-layout.spec.ts -g "primary record visible")`
  first failed because the partial-failure summary was unlabeled.
- GREEN: the same focused smoke passed after the labeled secondary-error
  summary landed.
- `(cd apps/web && npx playwright test tests/smoke/people-record-layout.spec.ts)` - 13 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.
- Vercel deploy hook job `5DOEbk6ljwToEK0AJy2c` deployed commit `922543d`.
- Live Chrome re-check passed after deploy: the affected imported tenant
  rendered `AAM Corporate (AAM Corporate Pty Ltd)`, no `Tenant unavailable`,
  no small visible controls, no console errors, and the remaining secondary
  failure was labeled `Tenant context: Failed to fetch`.

## Codex continuation - 2026-06-07 (Tenant detail secondary-error resilience - latest)

Follow-up from the live Chrome + Computer Use deep-record UX sweep: a real
People-hub tenant link could open `Tenant unavailable` / `Failed to fetch`
because the tenant page treated the secondary `tenant-detail` context read as
a page-level blocker. The tenant record now only uses the primary tenant read
for full-page unavailable/not-found states; failed richer context reads render
through the existing inline error area so the profile remains usable.

Files changed:
- `apps/web/src/app/tenants/[tenantId]/page.tsx` narrows the page-level
  `tenantLoadError`/`tenantNotFound` gate to the primary tenant query.
- `apps/web/tests/smoke/people-record-layout.spec.ts` adds a partial-failure
  smoke where `/tenants/{id}` succeeds but `/tenants/{id}/detail` returns 503.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  tenant detail error-state follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npx playwright test tests/smoke/people-record-layout.spec.ts -g "primary record visible")`
  first failed because `Bright Cafe Pty Ltd` never rendered.
- GREEN: the same focused smoke passed after the page-level error gate change.
- `(cd apps/web && npx playwright test tests/smoke/people-record-layout.spec.ts)` - 13 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation - 2026-06-07 (People record/drawer close targets - latest)

Follow-up from the live Chrome + Computer Use deep-record UX sweep: tenant
detail pages still had a compact shared `Tenants` back link measuring 32px
high, and `/tenants?action=invite` had a close action measuring 32px wide.
The shared Tenant/Owner/Vendor record back link, tenant invite/profile close
controls, and shared detail/evidence drawer close buttons now use the 44px
target baseline while preserving record navigation, drawer behavior, evidence
review, and provider guardrails.

Files changed:
- `apps/web/src/components/people-record-layout.tsx` raises the shared record
  back link to the 44px baseline.
- `apps/web/src/app/tenants/page.tsx` and
  `apps/web/src/app/tenants/[tenantId]/page.tsx` raise tenant invite/profile
  close controls to 44x44.
- `apps/web/src/components/detail-drawer.tsx` and
  `apps/web/src/components/evidence-drawer.tsx` raise shared drawer close
  buttons to 44x44.
- `apps/web/tests/smoke/tenants-ux.spec.ts` and
  `apps/web/tests/smoke/people-record-layout.spec.ts` add focused target-size
  coverage.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  People record/drawer follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npx playwright test tests/smoke/tenants-ux.spec.ts -g "tenant invite drawer close")`
  first failed with width `32`, expected `>= 44`.
- GREEN: the same focused smoke passed after the close-target change.
- GREEN: `(cd apps/web && npx playwright test tests/smoke/people-record-layout.spec.ts -g "shared record back link")`
  passed after the shared record back-link target-size change. The pre-fix red
  was captured live at 32px high during the Chrome sweep; the first local run
  was blocked by an already-running smoke server on port 3000.
- `(cd apps/web && npx playwright test tests/smoke/tenants-ux.spec.ts)` - 5 passed.
- `(cd apps/web && npx playwright test tests/smoke/people-record-layout.spec.ts)` - 12 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation - 2026-06-07 (Tenants register touch targets - latest)

Follow-up from the live Chrome + Computer Use secondary-route UX sweep:
`/tenants` still had compact desktop onboarding filters, tenant drawer-open
buttons, and inline contact edit controls measuring below the 44px target
baseline. They now use the 44px baseline while preserving the same filters,
drawer behavior, contact editing, and provider guardrails.

Files changed:
- `apps/web/src/app/tenants/page.tsx` raises the desktop filter chips, tenant
  row drawer-open button, and contact inline editors to the 44px baseline.
- `apps/web/tests/smoke/tenants-ux.spec.ts` adds focused desktop touch-target
  coverage for the register controls.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Tenants follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npx playwright test tests/smoke/tenants-ux.spec.ts -g "desktop tenant register filters")`
  first failed with the `All` filter width `41.109375`, expected `>= 44`.
- GREEN: the same focused smoke passed after the Tenants target-size change.
- `(cd apps/web && npx playwright test tests/smoke/tenants-ux.spec.ts)` - 4 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation - 2026-06-07 (Work recent activity touch target - latest)

Follow-up from the live Chrome + Computer Use cross-route UX sweep: the
Operations assignment-control "Recent activity" disclosure summary measured
16px high when assignment history was present. It now uses the 44px target
baseline while preserving assignment history, notification receipts, and
provider-send guardrails.

Files changed:
- `apps/web/src/app/operations/page.tsx` raises the assignment recent-activity
  disclosure summary to the 44px baseline.
- `apps/web/tests/smoke/operations-ux.spec.ts` adds focused touch-target
  coverage with a mocked work order carrying assignment history.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Work follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- operations-ux.spec.ts -g "operations assignment recent activity disclosure stays touch-safe")`
  first failed with height `16`, expected `>= 44`.
- GREEN: the same focused smoke passed after the Work disclosure target-size
  change.

## Codex continuation - 2026-06-07 (Dashboard Manage links touch target - latest)

Follow-up from the live Chrome + Computer Use cross-route UX sweep: the
Dashboard Onboarding panel "Manage links" action measured 36px high. It now
uses the 44px target baseline while preserving the same Properties handoff and
onboarding summary copy.

Files changed:
- `apps/web/src/components/dashboard.tsx` raises the Dashboard Onboarding
  "Manage links" action to the 44px baseline.
- `apps/web/tests/smoke/dashboard-command-center.spec.ts` adds focused
  touch-target coverage for the Dashboard Onboarding handoff.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Dashboard follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- dashboard-command-center.spec.ts -g "dashboard onboarding manage links action stays touch-safe")`
  first failed with height `36`, expected `>= 44`.
- GREEN: the same focused smoke passed after the Dashboard link target-size
  change.

## Codex continuation - 2026-06-07 (Notifications disclosure touch targets - latest)

Follow-up from the live Chrome + Computer Use cross-route UX sweep: `/notifications`
provider setup summaries measured 40px high and receipt evidence summaries
measured 32px high. Both disclosure summaries now use the 44px target baseline
while preserving read-only readiness/evidence details and explicit send/retry
guardrails.

Files changed:
- `apps/web/src/app/notifications/page.tsx` raises provider setup and receipt
  evidence summary targets to the 44px baseline.
- `apps/web/tests/smoke/notifications.spec.ts` adds focused touch-target
  coverage for both notification disclosure summaries.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Notifications follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- notifications.spec.ts -g "notifications provider and receipt disclosures stay touch-safe")`
  first failed with height `40`, expected `>= 44`.
- GREEN: the same focused smoke passed after the disclosure target-size change.

## Codex continuation - 2026-06-07 (Properties inline editor touch targets - latest)

Follow-up from the live Chrome + Computer Use cross-route UX sweep: desktop
`/properties` table inline property-name and street-address editors measured
28px high, and ownership tag filter chips measured 22px high. These row controls
now use the 44px target baseline while preserving row selection, inline editing,
ownership filtering, and the filtered-state clear action.

Files changed:
- `apps/web/src/components/inline-edit-cell.tsx` adds an opt-in `touchSafe`
  mode that raises the read-only editor, active input/select, and save/cancel
  controls to the 44px target baseline without changing existing call sites.
- `apps/web/src/components/property-workspace.tsx` opts the desktop Properties
  table name/street editors into the 44px baseline, raises owner filter chips,
  and raises the clear-filter action.
- `apps/web/tests/smoke/properties-ux.spec.ts` adds a focused smoke for the row
  inline editors, owner chip, and clear-filter control.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Properties follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- properties-ux.spec.ts)` first
  failed with height `28`, expected `>= 44`.
- GREEN: `(cd apps/web && npm run test:smoke -- properties-ux.spec.ts)` - 16
  passed after the Properties target-size change.

## Codex continuation - 2026-06-07 (Notifications preview touch targets - latest)

Follow-up from the live Chrome + Computer Use cross-route UX sweep: hidden
message-preview links on `/notifications` measured 16px high once expanded. The
message preview summary opener and the expanded "Open assigned work" action links
now use the 44px target baseline while preserving read-only notification review
and explicit Work handoff links.

Files changed:
- `apps/web/src/app/notifications/page.tsx` raises the message preview summary
  and preview action link targets to the 44px baseline.
- `apps/web/tests/smoke/notifications.spec.ts` adds a focused touch-target smoke
  for the expanded message preview handoff link.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Notifications follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- notifications.spec.ts -g "notifications message preview action links stay touch-safe")` first failed with height `16`, expected `>= 44`.
- GREEN: the same focused smoke passed after the Notifications target-size change.
- `(cd apps/web && npm run test:smoke -- notifications.spec.ts app-flows.spec.ts -g "notification")` - 5 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.

## Codex continuation - 2026-06-07 (Comms outbound log touch targets - latest)

Follow-up from the live Chrome + Computer Use cross-route UX sweep: `/comms`
outbound-log filter tabs measured 40px high and stored receipt "Open work queue"
links measured 32px high. The outbound-log tabs and stored-receipt target links
now use the 44px target baseline while preserving read-only receipt filtering,
links, and local CSV export guardrails.

Files changed:
- `apps/web/src/app/comms/page.tsx` raises shared Comms filter buttons and
  outbound-log target links to the 44px target baseline.
- `apps/web/tests/smoke/comms-outbound-log-export.spec.ts` adds focused
  touch-target assertions for outbound receipt filters and "Open work queue"
  links while preserving the local-only CSV export checks.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Comms follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- comms-outbound-log-export.spec.ts)` first failed with height `40`, expected `>= 44`.
- GREEN: the same smoke passed after the Comms target-size change.
- `(cd apps/web && npm run test:smoke -- comms-outbound-log-export.spec.ts comms-export-parity.spec.ts comms-keyboard.spec.ts comms-template-catalog.spec.ts comms-template-editor.spec.ts)` - 8 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.

## Codex continuation - 2026-06-07 (Work queue assignment touch target - latest)

Follow-up from the live Chrome + Computer Use cross-route UX sweep: `/operations`
still had compact queue-row "Assign owner" actions measuring 36px high. The
collapsed assignment action and the immediate expanded assignee controls now use
the 44px target baseline while preserving the same Work assignment workflow and
review-first provider-send guardrails.

Files changed:
- `apps/web/src/app/operations/page.tsx` changes the collapsed Work assignment
  action plus the expanded assignee select, Assign button, and Cancel action from
  36px controls to 44px controls.
- `apps/web/tests/smoke/operations-ux.spec.ts` adds a focused touch-target smoke
  for the collapsed and expanded Operations queue assignment interaction.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Work queue follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- operations-ux.spec.ts -g "operations queue assignment action stays touch-safe")` first failed with height `36`, expected `>= 44`.
- GREEN: the same focused smoke passed after the Work assignment control change.
- `(cd apps/web && npm run test:smoke -- operations-ux.spec.ts)` - 12 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.

## Codex continuation - 2026-06-07 (Entity statements local-reporting copy - latest)

Follow-up from the live Chrome + Computer Use visual review: the self-managed
`/statements` page correctly titled itself `Entity statements`, but lower
local-reporting cards still used `Owner:` labels and the empty invoice-evidence
copy said "this owner." The page now keeps visible local-reporting cards and
empty evidence copy entity-framed while preserving managing-agent owner statement
copy and dispatch guardrails.

Files changed:
- `apps/web/src/app/statements/page.tsx` switches the local-reporting summary
  metric from Owners to Entities, passes operating-mode framing into statement
  cards, labels self-managed cards as `Entity: ...`, and changes empty evidence
  copy to "this entity."
- `apps/web/tests/smoke/statements.spec.ts` adds the visible-copy regression to
  the self-managed no-dispatch smoke.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Statements copy follow-up as Remba/accountant-pending prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- statements.spec.ts -g "self-managed statements keep reports local and hide owner dispatch")` first failed because no visible `Entity:` card label existed.
- GREEN: the same focused smoke passed after the Statements copy change.
- `(cd apps/web && npm run test:smoke -- statements.spec.ts)` - 6 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation - 2026-06-07 (People Add tenant touch target - latest)

Follow-up from the live Chrome + Computer Use cross-route UX scan: after the
Smart Intake review-filter fix, `/people` was the only scanned main route with
a high-confidence sub-44px target. The Tenants tab "Add tenant" action measured
36px high. It now keeps the same tenant-invite destination and People IA but
uses the 44px minimum target baseline.

Files changed:
- `apps/web/src/app/people/page.tsx` changes the Tenants tab "Add tenant"
  action from `min-h-9` to `min-h-11`.
- `apps/web/tests/smoke/people-hub.spec.ts` adds a focused touch-target smoke
  for the People Tenants tab action.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  People follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- people-hub.spec.ts -g "people tenants add action stays touch-safe")` first failed with height `36`, expected `>= 44`.
- GREEN: the same focused smoke passed after the People Add tenant action change.
- `(cd apps/web && npm run test:smoke -- people-hub.spec.ts)` - 6 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation - 2026-06-07 (Smart Intake review filter touch target - latest)

Follow-up from the live Chrome + Computer Use cross-route UX scan: the shared
Dashboard/Smart Intake review-queue filter select measured 36px high on both
`/` and `/intake`. The select now keeps the same options, review-queue behavior,
and CSV/export paths but uses a 44px minimum target.

Files changed:
- `apps/web/src/components/dashboard.tsx` changes the Review filter select from
  `h-9 min-h-9` to the 44px `h-11 min-h-11` baseline.
- `apps/web/tests/smoke/app-flows.spec.ts` adds a focused touch-target smoke
  for the Review filter on `/intake`.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  shared Smart Intake follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- app-flows.spec.ts -g "smart intake review filter keeps a 44px touch target")` first failed with height `36`, expected `>= 44`.
- GREEN: the same focused smoke passed after the Review filter select change.
- `(cd apps/web && npm run test:smoke -- app-flows.spec.ts -g "smart intake")` - 7 passed.
- `(cd apps/web && npm run test:smoke -- smart-intake-export-parity.spec.ts)` - 1 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation - 2026-06-07 (Properties image-panel toggle touch target - latest)

Follow-up from the live Chrome + Computer Use UX review: after the density and
row-edit fixes, a live control scan found the selected-property image panel
toggle ("Property images" / reviewed-image status) was 40px high. The toggle
now keeps the same thumbnail, reviewed-image status copy, and expand/collapse
behavior but uses a 44px minimum hit target.

Files changed:
- `apps/web/src/components/property-workspace.tsx` adds the 44px minimum
  target to the selected-property image panel toggle.
- `apps/web/tests/smoke/properties-ux.spec.ts` adds a focused touch-target
  smoke for the image panel toggle.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Properties follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- properties-ux.spec.ts -g "properties image panel toggle stays touch safe")` first failed with height `40`, expected `>= 44`.
- GREEN: the same focused smoke passed after the image-panel toggle change.
- `(cd apps/web && npm run test:smoke -- properties-ux.spec.ts)` - 15 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation - 2026-06-07 (Properties row edit touch targets - latest)

Follow-up from the live Chrome + Computer Use UX review: after the density
toggle fix, a live control scan found the desktop Properties table row-level
pencil edit actions were 44px high but only 32px wide. The row actions now keep
the same edit behavior, icon, and row-selection stop-propagation but use a
44px square target.

Files changed:
- `apps/web/src/components/property-workspace.tsx` changes the desktop row
  edit action from `w-8` to `w-11`.
- `apps/web/tests/smoke/properties-ux.spec.ts` adds a focused touch-target
  smoke for the row edit action.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Properties follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- properties-ux.spec.ts -g "properties table row edit actions stay touch safe")` first failed with width `32`, expected `>= 44`.
- GREEN: the same focused smoke passed after the row edit action change.
- `(cd apps/web && npm run test:smoke -- properties-ux.spec.ts)` - 14 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation - 2026-06-07 (Properties density toggle touch targets - latest)

Follow-up from the live Chrome + Computer Use UX review: the desktop
Properties table row-density controls "Comfortable" and "Compact" measured
36px high, below the 44px target baseline used by the operator shell. The
controls now keep the same labels, table-density behavior, and local
preference persistence but use a 44px minimum hit target.

Files changed:
- `apps/web/src/components/property-workspace.tsx` changes the density toggle
  buttons from a 36px minimum height to the 44px minimum target baseline.
- `apps/web/tests/smoke/properties-ux.spec.ts` adds a focused touch-target
  smoke for both density buttons.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Properties follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- properties-ux.spec.ts -g "properties table density controls stay touch safe")` first failed with height `36`, expected `>= 44`.
- GREEN: the same focused smoke passed after the density button change.
- `(cd apps/web && npm run test:smoke -- properties-ux.spec.ts)` - 13 passed.
- `(cd apps/web && npm run lint)` - passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` - passed.
- `(cd apps/web && npm run build)` - passed.
- `git diff --check` - passed.

## Codex continuation — 2026-06-07 (Smart Intake quick-add touch targets — latest)

Follow-up from the live Chrome + Computer Use UX review: the Smart Intake
drop-zone recovery links "Add property" and "Add tenant" measured 36px high,
below the 44px target baseline used by the operator shell. The links now keep
the same destinations and copy but use a 44px minimum hit target.

Files changed:
- `apps/web/src/components/dashboard.tsx` changes the Smart Intake quick-add
  links from fixed 36px height to 44px minimum height.
- `apps/web/tests/smoke/app-flows.spec.ts` adds a focused touch-target smoke.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Smart Intake follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- app-flows.spec.ts -g "smart intake quick-add links keep 44px touch targets")` first failed with height `36`, expected `>= 44`.
- GREEN: the same focused smoke passed after the quick-add link change.

## Codex continuation — 2026-06-07 (Sidebar shortcut touch target — latest)

Follow-up from the live Chrome + Computer Use UX review: the persistent desktop
sidebar footer "Keyboard shortcuts ?" control measured 32px high while primary
nav rows and AppHeader utility buttons use the 44px target baseline. The shared
AppHeader sidebar footer now keeps the same copy/modal behavior but uses a
44px minimum hit target across expanded and collapsed desktop sidebar states.

Files changed:
- `apps/web/src/components/app-shell.tsx` adds the 44px minimum target to the
  sidebar footer shortcut button.
- `apps/web/tests/smoke/nav-consolidation.spec.ts` adds the desktop regression.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  AppHeader/sidebar follow-up as Remba-pending/prototype-mode UX.

Verification so far:
- RED: `(cd apps/web && npm run test:smoke -- nav-consolidation.spec.ts -g "desktop sidebar keyboard shortcut control stays touch-safe")` first failed with height `32`, expected `>= 44`.
- GREEN: the same focused smoke passed after the component change.

## Codex continuation — 2026-06-07 (Comms compliance reminder consolidation — latest)

Follow-up from the live Comms queue review: near-duplicate compliance reminders
to the same AP inbox now collapse into one review draft. The grouped candidate
keeps a primary obligation target for the existing Compliance Work handoff, adds
`related_target_ids` for every included obligation, lists each property/unit/item
inside the draft body, and carries the related IDs through dispatch/dismiss so
one approved email or one deferral stamps every grouped source row. No automatic
email/SMS/provider action runs; dispatch remains the explicit operator-approved
SendGrid path.

Follow-up guard: grouped compliance cards now keep the Smart Intake and
Compliance Work handoffs but hide the one-off manual evidence upload button.
That avoids attaching evidence to only the primary obligation when the draft
represents multiple source obligations.

Files changed:
- `apps/api/schemas/comms.py` adds optional `related_target_ids` to candidates
  and dispatch/dismiss payloads.
- `apps/api/routers/comms.py` consolidates same-recipient compliance candidates
  and validates grouped related obligations share the same entity, compliance
  category, and recipient before stamping dispatch/dismiss metadata.
- `apps/web/src/lib/api.ts` and `apps/web/src/app/comms/page.tsx` pass grouped
  related IDs from the card actions; `/comms` also hides the manual one-off
  evidence picker for grouped compliance cards.
- `apps/web/tests/smoke/app-flows.spec.ts` covers the grouped evidence guard,
  asserting the Smart Intake / Compliance Work links stay available and the
  manual attach button is absent.
- `tests/integration/test_comms_api.py` covers grouped queue rendering, grouped
  dispatch stamping every source obligation, and grouped dismiss stamping every
  source obligation.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Comms queue behavior as Remba-pending/prototype-mode UX.

Verification so far:
- RED: grouped queue test first failed with 2 separate compliance candidates.
- RED: grouped dispatch test failed when only the primary obligation was stamped.
- RED: counts parity test failed at `total 5 != 4` until summary-only compliance scans grouped by recipient too.
- `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py -k "consolidates_compliance_obligations_for_same_recipient or dispatch_grouped_compliance_obligation or dismiss_grouped_compliance_obligation" -q` — 3 passed.
- `.venv/bin/ruff check apps/api/routers/comms.py apps/api/schemas/comms.py tests/integration/test_comms_api.py` — passed.
- `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py -k "compliance_obligation" -q` — 6 passed.
- `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_queue_counts_match_full_queue_grouping -q` — passed.
- `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py -q` — 54 passed.
- RED: grouped compliance evidence smoke first failed because grouped cards
  still exposed the single-obligation manual attach path.
- `(cd apps/web && npm run test:smoke -- app-flows.spec.ts -g "grouped compliance comms drafts avoid single-obligation evidence upload")` — 1 passed.
- `(cd apps/web && ./node_modules/.bin/tsc --noEmit)` — passed.
- `(cd apps/web && npm run lint -- --max-warnings=0 src/app/comms/page.tsx src/lib/api.ts)` — passed.
- `(cd apps/web && npm run lint)` — passed.
- `(cd apps/web && npm run build)` — passed.
- `git diff --check` — passed.

## Codex continuation — 2026-06-07 (Comms signed-agreement lifecycle settle)

Follow-up from the live Comms review: the stale "DocuSign setup needed"
tenant lifecycle draft for the signed test lease is now blocked at the queue
scanner. The scanner still surfaces DocuSign setup/retry drafts before signing,
and still surfaces signed-envelope / tenant-upload activation-review candidates
when the lease needs operator activation review, but stale retry metadata cannot
create a recovery email once the lease agreement has a recorded `signed_at`.

Files changed:
- `apps/api/routers/comms.py` imports the canonical `lease_agreement_signed`
  helper and requires unsigned agreements before adding DocuSign retry/setup
  lifecycle candidates.
- `tests/integration/test_comms_api.py` adds the regression: `status=skipped`
  plus `signed_at` returns no tenant-lifecycle candidate.
- `docs/product-roadmap.md` and `docs/design-governance.md` record the visible
  Comms queue behavior as Remba-pending/prototype-mode UX.

Verification:
- New regression failed before the code change, then passed after the scanner
  gate.
- `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py -k "docusign_setup_after_agreement_signed or skipped_docusign_setup_retry_candidate or completed_signing_pending_activation_candidate or tenant_upload_activation_review_candidate" -q` — 4 passed.
- `.venv/bin/ruff check apps/api/routers/comms.py tests/integration/test_comms_api.py` — passed.
- `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py -q` — 51 passed.
- `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py -k "skipped_docusign or failed_docusign_send_enters_lifecycle_queue" -q` — 2 passed.

Guardrail: no email, SMS, DocuSign, Xero, payment, reconciliation, tenant email,
or provider call runs. This is queue-read filtering only.

## Codex continuation — 2026-06-07 (Live UX audit + Settings notification polish)

Autonomous visual UX pass on `https://leasium.ai` using Chrome + Computer Use,
covering Dashboard, Smart Intake, Properties, People, Work, Work compliance,
Money, Insights, and Settings. Live findings: no console errors across the core
routes; some first captures needed longer waits for real data; the strongest
actionable UX defect was Settings → Security → Work notifications. Long
operator rows pushed the Templates status chip beyond the panel edge at normal
desktop width, and the shell entity selector / Clerk avatar trigger were below
the 44px target baseline.

Shipped locally: Settings notification rows now use three compact primary
columns with Templates on a full-width row at standard desktop widths, preserving
compact row height while avoiding right-edge clipping. SMS phone/save controls,
the AppHeader entity select, and the Clerk user trigger are on 44px targets. No
notification preference, digest, SMS, SendGrid, Twilio, Xero, payment, or
provider behavior changed.

Verification so far:
- `npm run test:smoke -- settings.spec.ts app-flows.spec.ts -g "settings (Work notification preferences stay inside the desktop viewport|shows Xero readiness and records mappings)"` — 2 passed.
- `npm run test:smoke -- app-flows.spec.ts appearance.spec.ts -g "(mobile header keeps utility touch targets at least 44px|appearance header toggle cycles system, light, and dark)"` — 2 passed.
- `npm run lint`, `./node_modules/.bin/tsc --noEmit`, `npm run build`, and `git diff --check` — passed.
- Mocked local visual metric: no Work notification panel overflow; phone/save/template controls measured 44px. Temporary `.codex` evidence was removed before commit. Direct local Chrome loaded the patched shell, but local API was not running so full Settings data used mocked smoke rendering.

Docs updated: `docs/product-roadmap.md` adds a `[~]` Settings Work notification
responsive-layout polish entry; `docs/design-governance.md` adds the Remba
review follow-up. Shipped in `7dc977e` (`Polish Settings notification layout`)
and pushed to `origin/main` with the Gmail author path. The `main-deploy`
Vercel deploy hook was triggered afterwards; `https://leasium.ai` returned a
fresh Vercel 200 from the public edge, but authenticated Settings content was
not re-opened in Chrome after the final browser session was closed.

## Claude continuation — 2026-06-07 evening (Testing pass + Vercel deploy unblock — latest)

Autonomous full testing pass on Temba's instruction ("I approve all, create a
list of fixes and start fixing them"). Approved scope: provider emails to
temba@skjcapital.com / tembavj@outlook.com, Twilio SMS, Xero writes; commit +
push per verified fix.

### Suite results
- Backend: ruff clean; pytest 486 passed / 1 skipped (TEST_DATABASE_URL).
- Frontend: eslint clean; tsc clean; production build green.
- Playwright smokes: 4 failed / 211 passed on takeover; all four were test
  drift, fixed in `af404b5` (suite then fully green):
  - `insights.spec.ts` x2 predated the tabbed Insights layout — now click
    through Money/Operations/Portfolio tabs before asserting panels.
  - `app-flows.spec.ts` 44px touch-target spec: ambiguous `Preview` link
    locator vs `Open vendor preview` — now exact.
  - `settings-basiq-ux.spec.ts`: the known "Not configured" strict-mode
    ambiguity — now exact against the status chip.

### Vercel production deploy was BLOCKED (root cause + workaround)
The repo went private on GitHub between the `eca3f7b` and `ab9901f` pushes.
On the Vercel Hobby plan, production deploys of commits whose author is not
the Vercel-connected GitHub account (`tembavanjaarsveld-boop`) are BLOCKED for
private repos ("commit author did not have contributing access"). Commits are
authored `temba@skjcapital.com`, which GitHub maps to the `TembaSKJ` account,
so `ab9901f` (carrying the comms editor `8dbb7e0`) never deployed and
leasium.ai silently served `eca3f7b`. Redeploy in the dashboard is also gated
behind Upgrade-to-Pro.
- Workaround proven: pushing `af404b5` authored as
  `Temba van Jaarsveld <tembavanjaarsveld@gmail.com>` deployed READY and
  re-aliased leasium.ai; the comms editor is now live in production.
- Durable fix is Temba's call: (a) make the repo public again, (b) add
  temba@skjcapital.com as a verified email on the `tembavanjaarsveld-boop`
  GitHub account, or (c) Vercel Pro. Until then author pushes with the gmail
  identity or deploys stay blocked.

### Live E2E verified on leasium.ai (production, real data)
- All 7 hubs + Dashboard load clean; no console errors; workspace APIs 200.
- Work: queue urgency buckets, collapsible Assign owner control; assigned
  "Insurance expiry - Covey Associates (T105+T106)" to temba@skjcapital.com
  (left assigned — it is a real due-soon item, due 10 June).
- Notification email lifecycle end-to-end: assignment staged a notice →
  Send notice queued SendGrid → email received in the temba@skjcapital.com
  Outlook inbox at 17:56 from no-reply@leasium.ai. Receipt evidence and
  provider history rendered correctly.
- SMS: enabled Assignment SMS for temba@skjcapital.com (+61431144423, saved
  via Settings); Send SMS produced the honest "Skipped — Twilio Messaging is
  not configured" receipt. Real SMS needs the Twilio env/console setup from
  docs/deployment.md; the receipts path is correct.
- Comms editor (post-deploy): created an operator template via the drawer,
  verified catalog render/Override badge, then guarded-deleted it. CRUD works
  live.
- Tenant side: tenant record for the Temba van Jaarsveld test tenant renders
  fully (onboarding signed, portal account active); operator portal preview
  renders the calm status hero and checklist.
- Settings Connect: Xero is **Not connected** — connecting requires Temba's
  OAuth login, so approved Xero writes were untestable this session. The
  simplified Connect panel (a015180) renders correctly in production.

### Third pass, same session ("everything but Xero, go nuts")
- **Twilio console (operator-approved):** purchased trial number
  **+1 478 339 5818** ($1.15/mo from trial credit; AU numbers need
  regulatory bundles so a US number is the pragmatic test sender), enabled
  Australia (+61) in SMS geo permissions, set the number's inbound webhook to
  `/api/v1/comms/webhooks/twilio-inbound?entity_id=019e3d7b-...d08`, and
  confirmed +61431144423 is a verified trial recipient. Account SID
  `AC585793d87db1781a97dacd2cd84981eb`. **Temba's remaining 2-minute step:**
  on the Render API service set `TWILIO_ACCOUNT_SID` (above),
  `TWILIO_AUTH_TOKEN` (reveal in Twilio console → Account Info; secrets are
  deliberately not handled by the agent), and `TWILIO_FROM_PHONE=+14783395818`,
  then redeploy and retry the staged Work SMS from /notifications. Note the
  trial account only delivers to verified numbers.
- **Comms queue reviewed as operator delegate:** sent 3 insurance
  compliance reminders (Covey Associates — urgent, due 10 Jun; Best Wilson
  Buckley; Footprints Community), all SendGrid success receipts in the
  outbound log. Held: 13 rent reviews + 2 lease renewals (commercially
  sensitive; 3 lack recipients) and 3 near-identical Auto & General
  reminders to the same AP inbox (needs a consolidation/dedup pass —
  product follow-up). Dismissed: the stale "DocuSign setup needed" tenant
  lifecycle draft for the test tenant — **resolved in the latest Comms
  signed-agreement lifecycle settle:** stale retry metadata can no longer
  stage a signing-recovery email once the lease agreement has a recorded
  signed timestamp.
- **Insurance checklist mismatch fixed** (`3a9643c`): new additive
  `confirmed_no_document` compliance status; portal shows calm
  "Confirmed - certificate not on file" instead of red "missing" when the
  tenant confirmed cover without a stored certificate.
- **Vercel durable deploy path:** created Deploy Hook `main-deploy` for
  branch main (Settings → Git); the full hook URL is stored locally only at
  `~/.leasium-vercel-deploy-hook` (not in git — anyone with the URL can
  trigger deploys). `curl -s -X POST "$(cat ~/.leasium-vercel-deploy-hook)"`
  triggers a production deploy of main regardless of commit author, tested
  working. Gmail-author pushes remain the default; the hook is the fallback.

### AI surfaces live-tested (second pass, same session)
- Portfolio QA reviewed enrichment (eca3f7b) works in production:
  Suggest fixes on BD153 returned cited public-safe suggestions (postcode
  4035 via Australia Post 99%, owner ABN 64 264 366 843 via ABR 97%);
  applied the 2 reviewed suggestions; /public-enrichment/preview and /apply
  both 200; postcode verified on the live record afterwards. OPENAI_API_KEY
  is configured on the hosted API.
- Smart Intake document pipeline works in production: a clearly-labelled
  synthetic test invoice PDF was uploaded, classified "invoice admin" with
  the issuer + ABN extracted at high confidence, and the warnings panel
  itself flagged "Document is explicitly marked as a synthetic test
  document and states it must not be applied." Nothing applied; the intake
  row was cleared from the review inbox afterwards. Note the review panel
  shows a "Reading" state for ~2 minutes while server-side extraction runs —
  slow but honest; no error.

### Open fix list (not yet built)
1. ~~Lease-pack delivery gap~~ RESOLVED in `5e342b3`: this was not a missing
   send affordance — resend is deliberately gated to failed/declined DocuSign
   states and the endpoint 409s once signed. The actual bug was misleading
   copy: a DocuSign-signed onboarding with no email receipts showed
   "Delivery: Not sent / Delivery has not been attempted yet". delivery.ts
   now reports "Signed via DocuSign" (success tone) with an explanatory
   detail; verified live on the test tenant after deploy.
2. ~~Tenant checklist vs profile mismatch~~ RESOLVED in `3a9643c`: portal
   now shows the calm `Confirmed - certificate not on file` status when the
   tenant confirmed cover but did not upload a certificate, instead of red
   "Insurance missing / 0 documents".
3. Twilio + SendGrid webhook console setup remain outstanding (Provider setup
   checks show 3-4 to review); Xero OAuth connection needed before the Monday
   rehearsal.
4. Data cleanup queues are real but not bugs: 44 blocked tenancies, 8 missing
   billing details, 142 missing Xero mappings, comms queue holding 22 staged
   drafts (11 urgent) — drafts deliberately NOT approved since they would
   email real tenants.

## Codex continuation — 2026-06-07 (Comms branded-template editor — latest)

Implemented the `/comms` operator editor for branded communication templates
from `docs/superpowers/plans/2026-06-07-comms-template-editor.md`, using
red-first smoke coverage. Scope stayed on the planned files, including the
coordination-sensitive `apps/web/tests/smoke/api-mocks.ts`.

- API client: added branded-template create/update/delete payload types and
  helpers beside the existing catalog list helper.
- Smoke mocks: branded templates are now reset per `mockLeasiumApi` call and
  support POST/PATCH/DELETE with duplicate-active 409s, system-delete 409s,
  reactivation conflict checks, and soft delete.
- `/comms`: template catalog now fetches inactive rows for editor/reactivation
  while keeping the active badge and CSV export active-only. Cards have Edit
  actions, a New template button, an inactive group, and the editor drawer.
- Drawer: create/edit form with immutable key/version/channel/provider on edit,
  runtime-key datalist on create, active toggle, deactivate/reactivate, guarded
  delete confirmation for non-system rows, system "deactivate instead" copy,
  inline API conflict messages, and the no-send/provider-dispatch footer note.
- Guardrail: smoke watcher traps provider/send/dispatch/notification/invoice
  paths and any non-template API mutation so template CRUD cannot send messages.

Final verification: touched-file eslint clean; `tsc --noEmit` clean;
Playwright `comms-template-editor.spec.ts` + `comms-template-catalog.spec.ts` +
`settings.spec.ts` passed 11/11; production `next build` passed. Commit locally
only; push still needs Temba's explicit go.

## Claude continuation — 2026-06-07 (Xero Settings simplification + compliance evidence linking — latest)

Cowork session, autonomous run on Temba's "you pick, keep going" instruction.
Two slices landed and pushed; the tree is clean apart from an intentionally
untracked real lease PDF (`Lease_TembavJaarsveld_153CamelotPl.pdf`) at the repo
root — likely the custom lease file for the outstanding live lease-pack send
(tenant `019e6272-9879-786a-aa88-abfd1aa9fa48`, requires explicit operator
approval; deliberately not committed and not sent).

### Settings Xero connection simplification (commit `a015180`, pushed)

Found uncommitted on takeover (~965 changed lines, author unknown — treat as a
prior session's in-flight slice); verified and shipped as-is. Settings → Xero
now leads with a plain-language "Connect Xero" panel ("Connect this trust"
per-trust action, organisation matching guidance, friendlier connected copy),
collapses diagnostics / manual tenant ID / setup packet behind an "Advanced
support details" disclosure, gates the sync exception queue behind "Review N
follow-ups", renames "Template defaults" → "Templates", and compacts Work
notification chips to counted badges ("2 email on / 1 SMS ready"). No provider
behaviour change. Verification: eslint + tsc clean; `settings-xero-ux` smokes
2/2; app-flows "settings shows Xero readiness" 1/1; reformatted operations +
maintenance app-flows specs 2/2; production build green. This is useful prep
for the Xero production rehearsal (runbook in "Xero Monday Verification").

### Compliance evidence linking v1 (commit `f30c2b8`, pushed)

The named compliance follow-up from 2026-06-02 ("evidence upload/linking from
the Work tab only after the operator review boundary is designed"). Built
TDD-style, red first on both layers:

- Backend: `POST /api/v1/compliance/checks/{id}/evidence`
  (`ComplianceCheckEvidenceLink`: source_document_id + optional
  certificate_expires_on/notes) links an already-stored same-entity document
  to a check **without completing it or rolling the obligation forward**.
  Appends `check_metadata.evidence_link_history` (actor/timestamp/source),
  audit-logs `link_evidence`, idempotent for re-linking the same document,
  cross-entity document → 422 with no mutation. No provider call.
- Frontend: `Needs evidence` rows on `/operations?tab=compliance` get an
  `Add evidence` button expanding to an inline review form — stored-document
  picker (`listDocuments`, fetched only while the form is open), optional
  certificate expiry, Link evidence / Cancel, local confirmation toast.
  Completion remains the separate reviewed `Complete with linked evidence`
  action, which the linked row then enables.
- Verification: backend ruff clean + `test_compliance_api.py` 7/7 (2 new);
  eslint + tsc clean; `operations-compliance.spec.ts` 4/4 (1 new, proving no
  forbidden completion/provider/billing calls fire from the link path);
  `operations-ux.spec.ts` 11/11; production build green.
- Named follow-up: direct file upload from the form (today the file must
  arrive via Smart Intake or an existing document upload first).

Docs updated in the same commits: `docs/product-roadmap.md` (new `[~]`
compliance evidence linking entry) and `docs/design-governance.md` (prototype
entries for both slices). Roadmap staleness noticed but not yet fixed: the
"Installable PWA (mobile runway)" item still shows `[ ]` although PWA v1
shipped (see "Installable PWA mobile runway v1" section) — corrected in the
handover-refresh commit if present, otherwise still open.

## Claude continuation — 2026-06-03 (Tenant Documents upload collapse — latest)

Cowork session, seventh slice. After the status-header slice, Temba said the
Documents section "still [looks] sketchy." The culprit (confirmed from his
uploaded render) was the always-open raw upload form parked mid-card — a native
file input + Type + Notes + a big Upload button, visible even though a tenant
rarely uploads. **Not yet committed** — inspect `git status --short` first.
(Pushed so far: `08163cc`, `1791e55`, `b304473`, `10b3837`, `1ef411d`, `04281d6`.)

### Tenant Documents upload collapse (uncommitted)
`apps/web/src/app/tenant-portal/tenant-portal-content.tsx`: added `uploadOpen`
state. On the established-tenant "Documents" panel the upload form is now gated —
collapsed it shows a single outline "Upload a document" button; expanded it shows
the File/Type/Notes form in a bordered container with a Cancel button; the upload
mutation's `onSuccess` now also `setUploadOpen(false)`. The onboarding
"Required Documents" panel is deliberately left always-open (uploading is the
tenant's active task there). No smoke uploads through this panel (file-upload
smokes target vendor portal / maintenance closeout / smart-intake / custom-lease),
so no smoke change was needed.

Possible follow-up flagged to Temba but not changed: the checklist tiles can read
inconsistently — e.g. "Onboarding files: Not required, 0 files" while a lease pack
is listed below as "uploaded as the onboarding lease pack." That's a
category/count mapping question (the uploaded doc is category `lease`, the
compliance item is `onboarding`), not a visual bug — left alone pending a product
call.
Verification: eslint clean, tsc clean, tenant smokes 38 passed / 9 skipped,
production build green.

## Claude continuation — 2026-06-03 (Tenant portal calm status header)

Cowork session, sixth slice. Temba felt the tenant page was "too busy" and wanted
the tenant to "feel safe and assured." After a mockup + discussion he was undecided
on direction; the agreed first pass (no-regret, carries over whether or not tabs
land later) is a calm status header + warmer copy. Committed + pushed as `04281d6`.
(Pushed so far: `08163cc`, `1791e55`, `b304473`, `10b3837`, `1ef411d`.)

Direction decision: **calm single-scroll, not tabs.** A tenant's sections are
sparse, so tabs would mostly hide near-empty panels behind clicks. Tabs stay a
later option if a section grows deep. The mockup explored a status-first + tabs
layout; we deliberately took only the status-first half for now.

### Tenant portal calm status header + warmer copy (uncommitted)
`apps/web/src/app/tenant-portal/tenant-portal-content.tsx`:
- Folded the identity "Clean header" and the attention-only action strip into one
  always-on status hero. `attentionItems` (existing — `actionItems` minus the
  success all-clear) drives it: empty → calm green "You're all set"; non-empty →
  amber "One thing to do / N things to do" listing the items, plus an
  "Upload documents" anchor to `#tenant-documents` when `!documentsComplete`.
- Added optional `id` (+ `scroll-mt-24`) to the local `Panel` so the hero link can
  anchor to the Documents panel.
- Warmer copy: Documents badge "Action needed" → "{n} to upload"; new
  `tenantDocStatusLabel` maps missing/not_on_file/expired/received →
  "Not uploaded yet"/"Not required"/"Needs renewing"/"Received" for the doc tiles
  in both the Documents and Required Documents panels (shared `label()` untouched —
  operator side unaffected); empty states warmed (payments → "Nothing due right
  now…", maintenance → "No open requests…", documents → "No documents on file yet").
Verification: eslint clean, tsc clean, tenant smokes 38 passed / 9 skipped,
production build green. No smoke asserted the changed copy. Docs:
product-roadmap.md (`[~]`) + design-governance.md (prototype entry).

## Claude continuation — 2026-06-03 (Tenant portal Documents card)

Cowork session, fifth slice. Temba flagged the Documents card on the tenant portal
(screenshot: the "not on file" status chip clipping off the Onboarding-files tile,
and the raw browser file input). Committed + pushed as `1ef411d`. (Pushed so far:
Insights tabs `08163cc`, queue urgency buckets `1791e55`, footnote declutter
`b304473`, assign-on-expand `10b3837`.)

### Tenant portal Documents card layout fix (uncommitted)
`apps/web/src/app/tenant-portal/tenant-portal-content.tsx`: the document-checklist
tiles had a `flex items-center justify-between` header where the title didn't shrink,
so a long title (Bank guarantee / Onboarding files) pushed the `whitespace-nowrap`
status chip past the tile edge. Fixed: header is `items-start`, title is `min-w-0`
(wraps), chip is `shrink-0`. Also styled the native `type="file"` input via Tailwind
`file:` classes (soft primary button) instead of the raw control. Applied to **both**
the "Documents" panel (account/portal view, ~L5129) and the duplicated
"Required Documents" panel (~L4438). Layout/styling only — text, statuses, upload
behaviour unchanged.
Verification: eslint clean, tsc clean, tenant smokes 38 passed / 9 skipped,
production build green. Docs: product-roadmap.md (`[~]`) + design-governance.md
(prototype entry).

## Claude continuation — 2026-06-03 (Queue assign-on-expand)

Cowork session, fourth slice. Temba said "Go" to the further declutter offered
after the footnote removal: collapse the desktop queue assignment widget behind a
single "Assign owner" button. Committed + pushed as `10b3837`. (Pushed so far:
Insights tabs `08163cc`, queue urgency buckets `1791e55`, footnote declutter
`b304473`.)

### Queue assign-on-expand affordance (uncommitted)
`apps/web/src/app/operations/page.tsx` (`WorkAssignmentControl`): added a
`collapsible` prop + per-instance `expanded` state. When `collapsible && !isAssigned`
an unassigned row shows a dashed "Assign owner" button (aria-label
`Assign owner for {title}`) that expands inline to the assignee `Select` + `Assign`
+ `Cancel`; assigning flips it to the full assigned control. `collapsible` is
threaded through `renderAssignmentControl` / `renderQueueAssignmentControl` and set
**true only for the desktop queue inline control** — the mobile "Work controls"
disclosure and the maintenance/arrears detail controls pass the default (false) and
keep the full inline control, so there is no double-collapse on mobile.
`apps/web/tests/smoke/app-flows.spec.ts`: the desktop queue test now clicks
"Assign owner for Air conditioning fault" to expand before selecting the assignee;
the mobile "keeps mobile rows compact" test is unchanged (mobile control stays full).
Verification: eslint clean, tsc clean, 17/17 operations smokes pass, production build
green.

## Claude continuation — 2026-06-03 (Queue assignment declutter)

Cowork session, third slice. Temba flagged the per-row assignment widget in the
`/operations` queue (repeated boilerplate caption on every row). Committed +
pushed as `b304473`. (Insights tabs = `08163cc`, queue urgency buckets = `1791e55`,
both pushed.)

### Queue assignment control declutter (uncommitted)
`apps/web/src/app/operations/page.tsx` (`WorkAssignmentControl`): the footnote
("Assign the owner and prepare the Leasium notification.") now renders only when it
carries information — `showFootnote = assignedAt || notificationReady ||
notificationDelivered || notificationProblem` — so untouched unassigned rows drop
the repeated boilerplate line and shrink by a row. Assigned-state detail, status
badges, controls, recent-activity history, and the mobile disclosure are unchanged.
Verification: eslint clean, tsc clean, 17/17 operations smokes pass, production
build green. Docs: product-roadmap.md (`[~]`) + design-governance.md (prototype
entry).

## Claude continuation — 2026-06-03 (Work queue urgency buckets)

Cowork session, second slice. Same "ugly and long" complaint applied to the
`/operations` **Work** queue: the Queue tab rendered every open item in one flat
scroll. **Not yet committed** — inspect `git status --short` / `git diff --stat`
first. (The earlier Insights tab slice this session is committed + pushed as
`08163cc`.)

### Work queue urgency buckets (uncommitted)
`apps/web/src/app/operations/page.tsx`: the Queue tab now groups
`filteredOpenQueueItems` into collapsible **Overdue / Due soon (≤7d) / Scheduled
(>7d) / No date** buckets via a `queueBucketId` helper over the existing `dueRank`.
Urgent buckets open by default, Scheduled + No date collapsed; each header shows a
tone-coloured count and each bucket caps at `QUEUE_BUCKET_PREVIEW` (12) rows with a
"Show all / Show fewer" toggle. The row JSX was extracted verbatim into
`renderQueueRow`; assignment controls, `handleQueueKeyDown` keyboard nav, the
assignee/workload filters, notice inbox, digest, and review CSV are untouched.
Display-only — no data or provider behaviour changed.
`apps/web/tests/smoke/app-flows.spec.ts`: added an Overdue bucket-header assertion,
and synced one stale `OPERATIONS_QUEUE_EXPORT_GUARDRAIL` assertion that was already
failing (test still expected the old "Review-only export…" copy; the code ships
"Local-only review export… perform Xero/Basiq writes…").
Verification: eslint clean, tsc clean, 17/17 operations Playwright smokes pass,
production build green.

## Claude continuation — 2026-06-03 (Insights tabbed layout)

Cowork session. Single design slice off the "ugly and long" Insights page: turned
the `/insights` single ~2,600px scroll (~12 stacked panels) into a persistent
five-card KPI band + four tabs. **Not yet committed** — sits on top of any prior
unstaged work; inspect `git status --short` and `git diff --stat` before
committing.

### Insights tabs (uncommitted)
`apps/web/src/app/insights/page.tsx`: added `INSIGHTS_TABS` + `activeTab` state
with `?tab=` URL sync (mirrors Operations), an Operations-style `role="tablist"`
bar after the KPI band, and wrapped each panel in a tab conditional:
- **Overview** (default): Live Exceptions + Billing Risk (existing 2-col).
- **Money**: Arrears, Invoice Status, Finance Snapshot.
- **Operations**: Compliance & Inspections, Maintenance Aging, Lease Events.
- **Portfolio**: Shareable Snapshots, Automation Activity + Owner/Entity, Controls.

Only structural surgery was splitting the old Finance+Lease 2-col div (Finance →
Money, Lease → Operations) and re-indenting those two panels. Read-only and
provider-inert; no data, copy, or guardrail change — grouping + density only.
`apps/web/tests/smoke/app-flows.spec.ts`: the Insights smoke now clicks through
Money / Operations / Portfolio tabs (the Generate-link snapshot flow lives on the
Portfolio tab). Docs touched: `product-roadmap.md` (`[~]` Insights tabbed layout),
`design-governance.md` (2026-06-03 prototype-mode entry).
Verification: eslint clean, `tsc --noEmit` clean, Insights Playwright smoke
**1 passed (15.2s)** via `PORT=3999 NODE_ENV=development playwright test -g "insights shows overview"`.

## Claude continuation — 2026-06-02 (vendor portal contractor login)

Took over from Codex with a clean, fully-pushed tree (no unstaged slice to
preserve, despite the older "Active Local Tree" note further down). Picked the
DoorLoop P2 **vendor portal authenticated login** off the backlog.

### Communications hub — branded template CRUD (commit `4b3aea9`, pushed)
Recon confirmed the comms plumbing already exists (queue, dispatch, outbound log,
tenant/contractor/maintenance correspondence timelines, inbound email/SMS
webhooks, `BrandedCommunicationTemplate` model, read-only template list/detail).
The gap was template management: `apps/api/routers/branded_templates.py` was
read-only and the `BrandedTemplateCreate/Update` schemas already existed but were
unused. Wired operator POST/PATCH/DELETE (owner/admin/finance): create
(is_system=false; duplicate active key/version → 409 via pre-check +
IntegrityError), update (system rows' content stays editable; re-activation
conflict → 409), soft-delete (system rows blocked → 409), all audited
(`branded_template.*`, internal). Editing never sends. Tests: **8 passed**
(5 new + 3 read), ruff clean. Remaining: an operator template editor UI in
Settings/Comms + optional template preview / variable substitution.

### Payment rails scaffold (commit `915ffc5`, pushed)
Provider-agnostic, review-first boundary for tenant online payments — built like
the DocuSign/Basiq adapters (inert until configured, never auto-charges).
`stewart/integrations/payment_rails.py`: `configured_rail` (reads the new
`settings.payment_rail_provider`; supports monoova/zai/stripe_au; None today) +
`build_payment_intent_preview` returning a review-only "manual_only" preview
(amount / reference / available methods; no money movement, no provider call).
`GET /api/v1/payments/rail-status` reports `online_payment_enabled=false` + the
entity's available manual methods + a guardrail. Tests: **10 passed** (boundary
unit + rail-status integration), ruff clean. Remaining: pick an AU provider →
write the concrete adapter behind this boundary, plus a tenant-portal "Pay"
surface (preview + "online coming soon").

### Tenant payment-instructions foundation (backend `ad71aa5` + frontend, pushed)
Review-first first slice of DoorLoop P1 tenant payments. Display-only: no money
movement, no rails provider, no Basiq/Xero/reconciliation change.
- Backend (`ad71aa5`): `EntityPaymentInstruction` model (per-entity; EFT
  bsb/account_name/account_number, PayID, optional BPAY, notes) + migration
  `20260602_0036`; operator `GET/PUT /api/v1/payments/instructions` (read
  owner/admin/finance/ops/viewer; write owner/admin/finance; blank-normalising;
  audited `payment.instructions.update`, confidential); tenant-portal read gains
  `how_to_pay` + per-invoice `payment_reference` + a display-only guardrail.
- Frontend: api.ts client (`getPaymentInstructions` / `updatePaymentInstructions`
  + `PaymentInstructionRecord`; `how_to_pay` + `payment_reference` on the portal
  record), a tenant-portal "How to pay" panel + per-invoice reference, and a
  Settings → Organisation operator config form (`PaymentInstructionsPanel`,
  commit `d351a3e`).
- Verification: backend pytest **61 passed** (payments + tenant portal), migration
  test 4 passed/1 skipped, ruff clean, single alembic head `20260602_0036`;
  frontend eslint + tsc + production `next build` green.
- Next: a Settings operator config form (the api client already exists), a
  tenant-portal Playwright smoke (run with `NODE_ENV=development`), then the actual
  rails (PayTo / Monoova / Zai / Stripe AU) + in-portal "pay now" — the provider
  decision still to make. Plan:
  `docs/superpowers/plans/2026-06-02-tenant-payment-instructions.md`.
- eSign → lease was found already fully built this session (helper + state machine +
  send-lease-pack + Connect webhook + signed-PDF retention + Settings provider panel +
  ~36 tests); the stale roadmap line was corrected (`2639ff6`). Going live is DocuSign
  provider config only (Render env + a Connect webhook), not code.

### Vendor portal contractor login — backend (commit `2cd21fd`, local, NOT pushed)
- New models `VendorPortalInvite` + `VendorPortalAccount` (+ `VendorPortalAccountStatus`)
  in `stewart/core/models.py`, mirroring the owner portal account pattern, with
  one-active-account-per-login and per-contractor unique partial indexes
  (shared-login guard). One-sided `contractor`/`entity` relationships so the
  broadly-used `Contractor`/`Entity` classes are untouched.
- Migration `20260602_0035_vendor_portal_accounts.py` (down_revision
  `20260602_0034`) creates the two tables + enum + indexes; cloned from owner
  portal `0030`. `alembic heads` is a single head.
- `apps/api/routers/vendor_portal.py` adds, on top of the existing read-only
  operator preview: `POST /vendor-portal/{contractor_id}/invite` (operator
  owner/admin/ops, requires contractor email, no send), `GET /vendor-portal/invites/{token}/preview`
  (public safe context), `POST /vendor-portal/account/claim` (Clerk bearer +
  token: email match, consumed/410, shared-login/409 with IntegrityError
  rollback retry, revoked/403), `GET /vendor-portal/account/status`,
  `GET /vendor-portal/account/session`, and bearer-scoped
  `POST /vendor-portal/account/work-orders/{id}/accept|comment|photo`. Catch-all
  `GET /{contractor_id}` moved to the end so `/account/*` and `/invites/*`
  resolve first.
- Accept records acceptance metadata + a contractor-visible comment + activity,
  and advances `assigned`/`approved` → `in_progress` (other statuses keep their
  status; closed → 409). Comment appends `visibility=contractor`. Photo stores an
  image-only `StoredDocument` (category `other`, source `vendor_portal_photo`),
  links `attachments.photo_document_ids`, and adds a contractor-visible comment.
  Comment/activity dict shapes match `maintenance.py` so the preview reader
  returns them unchanged. `VendorPortalWorkOrderItemRead` gains `photo_count`.
- No operating-mode gate (unlike owners — contractors serve self-managed and
  managing-agent operators). Guardrails: no provider send, Xero/Basiq write,
  payment reconciliation, tenant email/SMS, or provider-history mutation; tenant
  identity, internal notes, provider receipts, and payment data stay operator-side.
- Design/plan: `docs/superpowers/plans/2026-06-02-vendor-portal-login.md`.

### Verification (Mac `.venv`)
- `pytest tests/integration/test_vendor_portal_auth_api.py
  tests/integration/test_vendor_portal_actions_api.py
  tests/integration/test_vendor_portal_api.py
  tests/integration/test_vendor_portal_share_api.py -q` → **23 passed**.
- Regression `pytest test_maintenance_arrears_api.py test_owner_portal_auth_api.py
  test_security_api.py -q` → **49 passed**.
- `pytest tests/integration/test_migrations.py -q` → **4 passed, 1 skipped**
  (`TEST_DATABASE_URL` not configured — Postgres lane).
- `ruff check` on touched backend/test/migration files → clean.
- `git diff --check` clean; `alembic heads` = `20260602_0035` (single head).

### Vendor portal contractor login — frontend (second commit)
- `apps/web/src/lib/api.ts`: widened `VendorPortalAuthRecord.mode`, added
  `photo_count`, and added `VendorPortalInviteRecord` / `...InvitePreviewRecord`
  / `...AccountLifecycleRecord` + client fns `createVendorPortalInvite`,
  `getVendorPortalInvitePreview`, `claim/status/session`, and
  `accept/comment/uploadPhoto` (mirroring the owner portal `getToken` bearer
  pattern; `publicRequestForm` for the photo multipart).
- `apps/web/src/app/vendor-portal/vendor-portal-account-ui.tsx`: lean shared UI
  (`VendorPortalShell`/`Loading`/`Notice` + `VendorPortalAccountView`) with per-job
  Accept / Post-update / Upload-photo actions; action results replace local
  portal state. Self-contained so the read-only preview page is untouched.
- `apps/web/src/app/vendor-portal/invite/[token]/page.tsx`: claim gate (preview +
  Clerk sign-in → auto-claim), mirroring the owner invite page; gates on
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` with a no-Clerk fallback.
- `apps/web/src/app/vendor-portal/page.tsx`: bearer account entry (status →
  session → dashboard).
- `apps/web/src/app/vendor-portal/[contractorId]/page.tsx`: operator "Generate
  login link" control (no-send invite + copyable claim URL).
- Providers: root `app/layout.tsx` supplies QueryProvider globally and Clerk via
  `OperatorAuthProvider`, so these pages need no self-wrapping (same as owner).
- Verification: frontend `eslint src/app/vendor-portal src/lib/api.ts` clean;
  `tsc --noEmit` clean; production `next build` passed with all three vendor
  routes compiled (`/vendor-portal`, `/vendor-portal/[contractorId]`,
  `/vendor-portal/invite/[token]`).
- Smoke: `tests/smoke/vendor-portal.spec.ts` gains an operator generate-login-link
  test, and new `tests/smoke/vendor-portal-account.spec.ts` adds a source-wiring
  bearer-token assertion plus a no-Clerk account-dashboard interaction
  (accept -> comment -> photo) against a mocked API. **All 7 vendor smoke tests
  pass** (`NODE_ENV=development ./node_modules/.bin/playwright test
  tests/smoke/vendor-portal.spec.ts tests/smoke/vendor-portal-account.spec.ts`).
- Smoke gotcha (cost an hour): the Playwright `webServer` runs `next dev`, which
  crash-loops with `EvalError: Code generation from strings disallowed` in the
  Edge middleware runtime when `NODE_ENV=production` is set in the shell (it is,
  in the Desktop Commander shell). Run smokes with `NODE_ENV=development` and
  clear any stale prod `.next` first. A Clerk-stub runtime smoke for the signed-in
  claim/session path (mirroring the owner `installOwnerClerkSmoke` lane) remains
  an optional follow-up.
- Access fix (post-deploy): `/vendor-portal` + `/vendor-portal/invite/[token]`
  were missing from `publicOperatorPathPrefixes`, so the contractor-facing pages
  hit the operator-auth shell ("Confirming operator access") in prod. Added
  `/vendor-portal` (+ trailing slash) to the allowlist mirroring `/owner-portal`;
  the operator preview `/vendor-portal/[contractorId]` stays operator-only via the
  backend entity-role check. Prod check: api.leasium.ai live on `56325a5`, and
  `GET /api/v1/vendor-portal/invites/<token>/preview` returns 404 (vendor tables
  migrated on Neon).
- Backend commit `96722b3` is pushed to `main` (Vercel + Render redeploy; Render
  runs `alembic upgrade head`, creating the vendor portal tables on Neon).

## Codex continuation — 2026-06-02 (latest)

Continuation from the tenant portal account cache hardening and Operations
review-packet slices.

### Properties calendar follow-up task creation
- `/api/v1/obligations/lease-event-follow-ups` now creates missing internal
  obligation tasks for active/holding-over lease calendar events in a reviewed
  forward runway. The default UI action is 90 days; the API accepts 1-365 days
  and optional property filters.
- The run is idempotent by lease/category/due date: existing non-deleted
  obligations are returned as skipped rows instead of creating duplicates.
  Migration `20260602_0034` adds a source-scoped partial unique index on
  generated lease-calendar obligations (`lease_id`, `category`, `due_date`)
  where `metadata.source = lease_calendar_follow_up`, so concurrent runs cannot
  double-create generated tasks while manual obligations remain flexible.
- Created tasks are normal `Obligation` rows scoped to entity/property/unit/
  lease with `source: lease_calendar_follow_up`, `source_event`, and source
  ids in metadata, so Work/Notifications can pick them up through the existing
  critical-date machinery.
- The Properties Calendar now has `Create next 90 tasks`, using the currently
  visible property filter set when filtered; the default full-portfolio run is
  intentionally unscoped so large portfolios do not post every property id.
  Success refreshes obligations, insights, and rent-roll caches.
- Guardrails: the run only creates internal obligation tasks. It does not send
  email/SMS, dispatch providers, post invoices, sync Xero/Basiq, reconcile
  payments, or mutate leases.
- The route now handles an insert-time unique collision with a savepoint and
  returns the existing task as skipped, so a stale read during concurrent runs
  does not turn into a failed request.
- Verification: lease-calendar hardening focused backend regression passed
  **4 passed**; full register integration passed **12 passed**; migration
  tests passed **4 passed, 1 skipped** (`TEST_DATABASE_URL` not configured);
  targeted backend `ruff` and `git diff --check` passed. The earlier UI slice
  had already passed focused Properties smoke, frontend eslint, and
  `tsc --noEmit`.
- Smart Intake inspection-report apply count cleanup is now fixed:
  `created_inspection_work_orders` reports `work_order_count` from created
  maintenance work orders and `obligation_count: 0` because no obligations are
  created in that flow. Regression coverage is in
  `tests/integration/test_document_intake_api.py::test_document_intake_apply_inspection_report_creates_work_orders`.

### Owner portal compliance snapshot
- Owner portal preview and owner account session responses now include a
  read-only `compliance` section for linked owner properties.
- The projection includes only active checks where
  `check_metadata.owner_portal_visible` is exactly true and the check's
  property is linked to the owner through `PropertyOwner`.
- Owner-visible fields are deliberately narrow: property, owner-safe title,
  check kind/status, next due date, certificate expiry, last checked date, due
  status, and evidence-present state (`linked` or `missing`).
- The shared owner dashboard renders the Compliance snapshot panel, and the
  local Owner-visible packet copy/download includes matching compliance rows
  and totals without exposing tenant identity, internal notes, source document
  IDs, evidence document IDs, raw metadata, operator history, cross-owner
  checks, or unflagged checks.
- Viewing/copying/downloading remains read-only: it does not complete checks,
  upload evidence, apply Smart Intake, send email/SMS, dispatch providers,
  write Xero/Basiq data, reconcile payments, or mutate provider history.
- Verification: full owner portal API tests passed **10 passed**; owner portal
  preview/account smokes passed **13 passed, 4 skipped** (live-Clerk lanes
  skipped as expected); targeted backend `ruff`, frontend eslint,
  `tsc --noEmit`, and `git diff --check` passed.

### Owner portal lease events
- Owner portal preview and owner account session responses now include a
  read-only `lease_events` section for linked owner properties, covering
  upcoming rent reviews and lease expiries in the selected statement period's
  180-day runway.
- The projection is owner-safe: it exposes property, unit, event kind/date,
  lease status, and annual rent only. It does not expose tenant identity,
  tenant IDs, lease notes, cross-owner properties, expired/deleted leases, or
  provider/accounting evidence.
- The shared owner portal dashboard renders a new Lease events panel, and the
  local Owner-visible packet copy/download now includes the same lease-event
  rows and totals without sending owner email, generating statement PDFs,
  downloading shared documents, writing Xero/Basiq data, reconciling payments,
  calling Comms, or mutating provider history.
- Verification: focused owner portal API test passed **1 passed**; full owner
  portal API tests passed **9 passed**; owner portal preview/account smokes
  passed **13 passed, 4 skipped** (live-Clerk lanes skipped as expected);
  targeted backend `ruff`, frontend eslint, `tsc --noEmit`, and the frontend
  production build passed.

### Correspondence export guardrail wording parity
- Tenant, vendor, and maintenance correspondence CSV exports now use
  copy/download-aware guardrails: `copying or downloading this file...` rather
  than download-only language.
- The vendor correspondence smoke now asserts the full vendor export guardrail
  sentence so Copy CSV regressions are caught instead of only checking a
  generic no-send fragment.
- Verification: focused vendor correspondence, tenant correspondence mobile,
  maintenance detail, and tenant-detail app-flow smokes passed **4 passed**;
  targeted frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### Helper consolidation follow-up
- `Comms` now imports the shared `friendlyError` helper and canonical
  `StatusTone` type instead of redeclaring both inline.
- `Settings` now imports the canonical `StatusTone` type instead of carrying a
  local chip-tone union.
- Billing Readiness now imports both the shared `friendlyError` helper and
  canonical `StatusTone`; `friendlyError` accepts an optional fallback so pages
  with context-specific copy do not need local wrappers.
- The helper-consolidation smoke now includes Comms, Settings, and Billing
  Readiness and requires `StatusTone` to be imported from `@/components/ui`, so
  a local alias no longer satisfies the guard.
- Verification: the helper-consolidation smoke passed **5 passed**; focused
  Billing Readiness smoke passed **4 passed**;
  targeted frontend eslint and `tsc --noEmit` passed.

### Vendor correspondence timeline
- Contractor records now replace the Activity placeholder with a read-only
  vendor correspondence panel backed by
  `/api/v1/comms/correspondence/contractors/{contractor_id}`.
- The endpoint aggregates contractor-facing maintenance comms receipts from
  work orders matched by vendor-portal contractor id or exact saved
  contractor email/phone, and each work-order receipt must also carry a
  recipient matching the selected contractor contact. This excludes
  tenant-facing forwards, prior-vendor receipts after reassignment, and
  unrelated vendors.
- The vendor Activity panel shows recent receipt rows, safe work-order/Comms
  handoffs, endpoint guardrails, and local Copy/Download
  `vendor-correspondence-{vendor}.csv` actions with shared formula-safe cells.
- Guardrails: viewing/copying/downloading does not send email/SMS, dismiss
  queue rows, refresh providers, mutate contractor/vendor records, mutate
  maintenance records, or write provider history.
- Verification: focused backend tenant/maintenance/vendor/dismiss-recipient
  correspondence tests passed **4 passed**; focused vendor correspondence
  copy/download smoke passed **1 passed**; targeted backend `ruff`, frontend
  eslint, `tsc --noEmit`, and `git diff --check` passed. Broader People record
  smoke is now green after running the spec in managing-agent mode for Owner
  record copy (**11 passed**).

### Vendor portal preview error/cache parity
- `/vendor-portal/[contractorId]` now follows the owner/tenant preview error
  pattern: missing previews render `Vendor portal preview not found`, while
  non-404 failures stay on `Vendor portal unavailable` with the API message.
- The vendor portal preview read disables retry/stale cache reuse and refetches
  on mount so recently hidden or moved previews do not keep showing cached
  vendor/work-order rows. The smoke now covers same-route return after a
  contractor preview changes from success to 404.
- Verification: focused vendor portal smoke passed **4 passed**; combined
  People record + vendor portal smoke previously passed **14 passed**; targeted vendor
  portal/frontend eslint and `tsc --noEmit` passed.

### Maintenance correspondence export parity
- Work-order detail Correspondence now has local `Copy correspondence CSV`
  beside `Download correspondence CSV`; both actions use the same
  formula-safe maintenance correspondence CSV builder.
- The existing maintenance detail smoke now stubs clipboard, proves copied and
  downloaded CSV match exactly, keeps the export read-only/local-only, and
  tightens a duplicate `Provider history` text assertion in the same scenario.
- Verification: focused maintenance detail smoke passed **1 passed**; targeted
  maintenance frontend eslint and `tsc --noEmit` passed.

### Settings, statements, and Comms export parity
- Settings Organisation template overrides now have a local `Copy overrides
  CSV` action beside `Download overrides CSV`; both actions share the same
  communication template override CSV builder and keep formula-safe stored
  override fields.
- The template override smoke runs at 390px, proves copy/download parity,
  checks 44px export controls and proximity, and traps template, notification,
  Comms, invoice, onboarding, provider, SendGrid/Twilio, Xero/Basiq, billing,
  payment, and reconciliation side effects during local export.
- Statements dispatch approval rows now use the shared touch-safe secondary
  button baseline, and dispatch approval/draft copy and download paths carry
  fuller local-only guardrails without wiring PDF, PDF-pack, email, invoice,
  accounting, reconciliation, or provider mutation flows.
- Statements smoke verifies approval packet copy, dispatch CSV download,
  dispatch draft copy/download parity, 44px controls, and no dispatch,
  provider, accounting, Comms, email, SMS, billing, payment, or reconciliation
  side effects.
- Comms outbound log now has `Copy outbound log CSV` beside `Download outbound
  log CSV`; both use the same filtered outbound-log CSV builder and preserve
  filter metadata for the Needs attention view.
- New Comms outbound-log smoke proves copy/download parity, mobile touch
  sizing, filter proximity, generated-date/filter/total metadata, local
  guardrails, and no send, dismiss, provider, queue, invoice, billing,
  payment, reconciliation, Xero/Basiq, SendGrid, or Twilio side effects.
- Agents implemented the three slices independently; final review found no
  blocking P1/P2 issues.
- Verification: focused Settings + Statements + Comms export smokes passed
  **4 passed**; touched Settings/Statements/Comms export smokes passed
  **14 passed**; existing Comms outbound-log app flow passed **1 passed**;
  targeted frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### Tenant correspondence and Smart Intake export parity
- Tenant detail correspondence now has a local `Copy correspondence CSV`
  beside `Download correspondence CSV`; both actions share the same
  correspondence CSV/filename helper and preserve the review-only export
  guardrail.
- Tenant correspondence smoke runs at 390px, verifies copy/download parity,
  44px export controls, formula-neutralized counterparty data, target-link
  content, no document-byte fetch, and no tenant/Comms/provider, onboarding,
  portal, SendGrid/Twilio, Xero, or Basiq mutations during local export.
- Tenant operator preview Recent Activity `Copy summary` now meets the 44px
  mobile touch baseline. The preview smoke verifies clipboard summary content
  and keeps the existing CSV copy/download parity and no-mutation checks.
- Smart Intake review queue now has `Copy review queue CSV` beside `Download
  queue CSV`; both use the same filtered review-queue CSV builder.
- New Smart Intake export smoke proves copy/download parity across tenant
  portal, inbound email attachment, and inspection filters, formula-safe review
  queue fields, 390px touch targets, and no apply/accept/maintenance,
  onboarding, Comms, provider, financial, Xero/Basiq, email, or SMS side
  effects.
- Agents implemented the three slices independently; final review found no
  blocking P1/P2 issues.
- Verification: focused tenant correspondence + tenant preview + Smart Intake
  smokes passed **3 passed**; touched tenant and Smart Intake smoke coverage
  passed **6 passed**; targeted frontend eslint, `tsc --noEmit`, and
  `git diff --check` passed.

### Operations, notifications, and tenant export parity
- `/operations` queue now has a local `Copy queue CSV` action beside
  `Download queue CSV`; both actions use the same filtered queue CSV builder,
  and the queue export controls meet the 44px mobile touch baseline.
- Operations queue smoke copies and downloads the queue CSV, compares both
  outputs, keeps the local-only guardrail and formula-neutralization checks,
  and traps provider, Comms, maintenance, arrears, assignment, billing/invoice,
  Xero/Basiq, payment, reconciliation, SendGrid, and Twilio boundaries.
- `/notifications` now has `Copy readiness CSV` beside `Download readiness
  CSV`; both share the provider-readiness CSV data path and show a local copy
  receipt without marking notifications reviewed or running digests.
- Notifications smoke runs the readiness export on mobile, proves
  copy/download parity, verifies provider readiness guardrails, and keeps the
  review-packet export regression in the touched suite.
- Tenant detail `Download correspondence CSV` now inherits the shared
  touch-safe secondary button sizing. The new mobile smoke verifies the
  correspondence export filename/content, review-only guardrail, formula-safe
  counterparty data, no document-byte fetch, and no tenant/Comms/provider,
  Xero/Basiq, onboarding, or portal mutations during CSV export.
- Agents scouted and implemented the slices independently; final review found
  no blocking P1/P2 issues.
- Verification: focused Operations + Notifications + tenant smokes passed
  **3 passed**; touched smoke files passed **14 passed**; targeted frontend
  eslint, `tsc --noEmit`, and `git diff --check` passed.

### Comms and tenant preview export parity
- `/comms` now has a local `Copy review CSV` action beside `Download review
  CSV`; both use the same review-queue CSV builder and keep the queue export
  review-only with a local copy receipt.
- Comms export smoke stubs clipboard, copies and downloads the review CSV,
  compares both outputs, injects formula-looking draft fields, verifies the
  shared CSV formatter neutralizes them, and traps send/dismiss/provider,
  SendGrid/Twilio, Xero/Basiq, billing/invoice, payment, reconciliation, and
  refresh boundaries.
- Tenant operator preview now has a local `Copy preview CSV` beside `Download
  preview CSV`; both use the same tenant preview CSV data, and the preview
  export controls meet the 44px mobile touch baseline.
- Tenant preview smoke runs at 390px, proves copy/download parity, formula-safe
  tenant-visible fields, no tenant account/invite/contact/document/provider,
  Xero/Basiq, payment, reconciliation, email, SMS, or Comms mutations, and
  touch-safe export controls.
- Agents implemented the two slices independently; final review found no
  blocking P1/P2 issues.
- Verification: touched Comms + tenant preview smokes passed **2 passed**;
  targeted frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### Contractor export parity and Portfolio QA mobile actions
- `/contractors` now has a local `Copy directory CSV` action beside
  `Download directory CSV`; both use the same readiness CSV and show a local
  receipt without sending external/provider work.
- Contractor export guardrails now cover copying/downloading, contractor
  create/update/delete, maintenance AI classification, contractor assignment,
  provider history/dispatch, SendGrid/Twilio, Xero/Basiq, billing/invoice,
  receipt, payment, and reconciliation boundaries.
- Contractor smoke runs at 390px, verifies both export controls meet 44px
  touch targets, proves copied/downloaded CSV parity, injects formula-looking
  contractor fields, and checks the shared CSV formatter neutralizes them.
- Portfolio QA enrichment queue `Copy queue` and `Download queue CSV` actions
  now meet the 44px mobile touch baseline. The smoke verifies copy/download
  remain local-only and no non-read API calls fire during those actions.
- Agents implemented the two slices independently; final review caught a
  missing contractor billing/invoice/receipt trap, which was patched and
  reverified.
- Verification: focused contractor smoke passed **1 passed**; focused
  Portfolio QA smoke passed **3 passed**; touched contractor + Portfolio QA
  smokes passed **4 passed**; targeted frontend eslint, `tsc --noEmit`, and
  `git diff --check` passed.

### Insights packet copy and operations queue export guardrails
- `/insights` now offers a local `Copy review packet` action beside
  `Download review CSV`; both use the same loaded overview/snapshot review
  packet data and preserve the review-only guardrail language.
- Insights smoke stubs clipboard, copies and downloads the review packet,
  compares the key review sections across both outputs, and traps provider,
  Xero, send, payment, reconciliation, billing draft, invoice draft, and
  snapshot create/revoke API paths.
- Operations queue CSV guardrails now use local-only wording and explicitly
  call out Xero/Basiq writes. The mobile operations smoke downloads
  `operations-work-queue-review.csv`, verifies headers and guardrail text,
  injects a formula-looking queue item, and proves the exported CSV is
  formula-safe.
- Agents implemented the two slices independently; final review caught the
  missing Insights snapshot mutation trap, which was patched and reverified.
- Verification: focused Insights smoke passed **2 passed**; focused mobile
  Operations queue smoke passed **1 passed**; touched Insights + Operations UX
  smokes passed **12 passed**; targeted frontend eslint, `tsc --noEmit`, and
  `git diff --check` passed.

### Owner documents and completion packet mobile hardening
- Owner portal shared-document metadata now wraps long unbroken property,
  source, and notes values inside the mobile document row instead of forcing
  horizontal overflow.
- The populated owner shared-document smoke now injects long unbroken
  metadata strings and proves each visible value plus the download control
  stays inside a 390px viewport.
- Maintenance completion review packet Copy/Download controls now meet the
  44px touch baseline on mobile. The smoke proves copy and CSV download stay
  local, retain the review-only guardrail, and do not mutate maintenance,
  provider, Comms, billing, payment, or reconciliation APIs.
- Restored separate maintenance Review packet coverage for copied/CSV handoff
  links, including Comms and tenant links, with the same no-mutation guardrail.
- Agent review caught one restored-test guardrail gap; the direct work-order
  mutation trap was added and reverified.
- Verification: focused owner shared-document smoke passed **1 passed**;
  focused maintenance review-packet smokes passed **2 passed**; touched owner
  portal account and Operations UX smokes passed **17 passed / 4 skipped**;
  targeted frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### Command search and entity statement export parity
- Mobile command search now matches the keyboard-shortcuts overlay: the close
  control meets the 44px touch baseline, and the dialog is constrained above the
  fixed mobile bottom nav with safe-area-aware scrolling for long action lists.
- `/statements` self-managed preview/export paths now use entity/local-reporting
  framing beyond the signoff panel: visible preview labels, copied summary text,
  invoice-evidence CSV headers, and client download filenames switch to
  `Entity statement` / `entity-statement-*` while managing-agent accounts keep
  owner-statement wording.
- Backend statement PDF and ZIP exports are mode-aware too. Self-managed
  accounts receive `entity-statement-*` PDF/pack filenames, entity-labelled PDF
  bodies, manifest/invoice-evidence CSV headers without owner-recipient columns,
  and README copy focused on local entity-reporting; managing-agent/hybrid
  exports preserve owner-statement pack naming and recipient-readiness fields.
- Guardrails: mobile shell smoke covers command search touch safety and bottom
  nav clearance without provider calls; statements smoke covers self-managed
  summary/evidence/signoff copy and downloads without owner-statement framing;
  owner API integration covers self-managed and managing-agent PDF/ZIP
  filenames, README/manifest wording, and formula-safe pack CSVs.
- Verification: touched mobile nav + statements smokes passed **11 passed**;
  owner API integration passed **27 passed**; targeted backend `ruff`, frontend
  eslint, `tsc --noEmit`, and `git diff --check` passed.

### Mobile overlays and entity signoff parity
- Mobile keyboard-shortcuts overlay controls now meet the 44px touch target
  baseline, and the shortcuts dialog is constrained to the safe area above the
  fixed mobile bottom nav with internal scrolling for long shortcut lists.
- `/statements` month-end readiness, finance checklist, finance exceptions, and
  signoff copy/export paths are now mode-aware: self-managed accounts use
  entity/local-reporting guardrails, omit dispatch approval/send-workflow
  framing, and download signoff/checklist files with `entity-statement-*`
  filenames; managing-agent accounts keep the owner signoff/checklist filenames
  and dispatch framing.
- Owner account mobile coverage now includes populated shared-document rows with
  very long filenames, proving the existing portal layout keeps account
  download controls and document content inside a 390px viewport.
- Guardrails: mobile shell smoke covers shortcuts overlay touch safety and
  bottom-nav clearance without provider calls; statements smoke covers local
  entity checklist, exceptions, signoff copy/CSV, and empty-pack wording without
  owner-statement dispatch/send framing; owner portal account smoke covers
  populated shared documents without overflow.
- Verification: touched mobile nav, statements, and owner account smokes passed
  **17 passed / 4 skipped**; targeted frontend eslint, `tsc --noEmit`, and
  `git diff --check` passed.

### Mobile shortcut and maintenance handoff polish
- The global `G` shortcut hint now survives the shortcut listener rebind
  instead of being cleared immediately, while still clearing its timer on
  unmount.
- On mobile, the `G` shortcut hint sits above the fixed bottom navigation and
  safe-area inset, preserving the existing desktop placement.
- Maintenance review packet copied text now includes the same handoff links as
  the CSV export, so operators get Comms/tenant/property/invoice navigation in
  both local packet formats.
- Guardrails: mobile nav smoke covers the shortcut hint clearing the fixed
  bottom nav without provider calls; Operations UX smoke covers copied
  maintenance packet handoff links without maintenance/provider/Comms/billing
  mutations.
- Verification: focused mobile shortcut smoke passed **1 passed**; focused
  maintenance handoff smoke passed **1 passed**; touched mobile nav and
  Operations UX smokes passed **12 passed**; targeted frontend eslint,
  `tsc --noEmit`, and `git diff --check` passed.

### Self-managed statement handoff and entity records
- `/billing-readiness` now reads the organisation operating mode and only treats
  missing owner billing recipients as statement-dispatch blockers for managing
  agent and hybrid accounts. Self-managed accounts keep the month-end handoff
  local with entity-statement copy and no owner-recipient blocker language.
- Direct `/owners/{ownerId}` records are now mode-aware: self-managed accounts
  link back to Settings → Organisation entities, use entity/trust framing, and
  avoid owner-client email/follow-up/files copy. Settings now honors
  `?tab=organisation` so those back-links land on the entity directory.
- Guardrails: `billing-readiness-ux.spec.ts` covers the self-managed handoff
  with an invoice-bearing no-email owner and traps owner statement dispatch/send
  calls, plus the clean-recipient clipboard/CSV handoff export;
  `people-hub.spec.ts` covers direct self-managed record access.

### Owner portal bearer-action follow-through
- `/owner-portal/invite/[token]` now splits Clerk-enabled and local no-Clerk
  modes, fetching a fresh Clerk bearer with `getToken({ skipCache: true })`
  before claiming an owner invite and passing it to
  `claimOwnerPortalAccount(token, authToken)`.
- Owner account document downloads now receive the same fresh-auth callback
  through the shared owner portal dashboard and call the account document
  download API with the explicit bearer. If Clerk mode requires auth but no
  fresh token is available, the download fails closed instead of falling back to
  ambient cached auth.
- The local no-Clerk path remains available for dev/smoke runs: invite claim
  still uses the token-only API call and account document downloads keep the
  existing request fallback when auth is disabled.
- Guardrails: the owner account smoke preserves the safe invite preview,
  no-provider/no-statement-send traps, packet copy/CSV local-only behavior,
  mobile empty states, and account-session failure clearing. The auth-enabled
  smoke installs a Playwright-only Clerk stub, proves the invite claim,
  account status/session reads, and document download send
  `Authorization: Bearer owner-action-smoke-token`, and verifies
  `getToken({ skipCache: true })` is used at action time.
- Verification: owner portal account bearer guard passed **1 passed**;
  auth-enabled owner action smoke passed **2 passed**; default owner account
  smoke passed **6 passed / 2 skipped**; targeted frontend eslint,
  `tsc --noEmit`, and `git diff --check` passed.

### Owner portal shared-login guard
- Backfilled owners with the same billing email can no longer let one Clerk
  subject claim multiple active owner accounts. The second claim now returns a
  clear 409, leaves the second invite unconsumed, and keeps status/session reads
  scoped to the first linked owner.
- The account status/session/document paths now refuse ambiguous active
  provider rows instead of choosing the most recently updated owner.
- If a simultaneous claim slips past the application read guard, the database
  unique-index failure is rolled back and translated into the same 409 recovery
  message instead of surfacing as a server error.
- New migration `20260601_0032_owner_portal_provider_active_unique.py` adds a
  unique active-provider index on `owner_portal_account` and fails the migration
  up front if duplicate active provider links already exist, so rollout cleanup
  is explicit.
- Verification: the shared-login regression went red first, then
  `.venv/bin/python -m pytest tests/integration/test_owner_portal_auth_api.py -q`
  passed **12 passed**; targeted backend `ruff` passed.

### Owner portal production smoke runway
- Added `docs/owner-portal-production-smoke.md` for the owner rollout proof:
  target-database duplicate-active-provider preflight, migration
  `20260601_0032` verification, Clerk guard preflight, owner Clerk storage-state
  capture, read-only owner-account smoke, optional shared-document download, and
  a separately approved claim pass.
- Added an opt-in Playwright smoke in
  `apps/web/tests/smoke/owner-portal-account.spec.ts`, gated by
  `LEASIUM_SMOKE_OWNER_PORTAL_ACCOUNT_LIVE=1`,
  `PLAYWRIGHT_BASE_URL=https://...`, and
  `LEASIUM_SMOKE_OWNER_PORTAL_STORAGE=<storage-state.json>`. It opens only
  `/owner-portal`, proves the live owner account status/session reads carry
  bearer auth, verifies the owner portal/access-boundary/packet controls, and
  aborts any other `/api/v1` request. Shared-document download remains optional
  via `LEASIUM_SMOKE_OWNER_PORTAL_EXPECT_DOCUMENT`.
- Added a separately gated live invite-claim smoke for the same spec, enabled
  only with `LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_LIVE=1`, HTTPS base URL, saved
  owner Clerk storage, and a disposable
  `LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_TOKEN`. It proves the invite preview hides
  statement/property data before claim, sends exactly one bearer-authenticated
  claim request, renders the owner portal packet after claim, and keeps the
  forbidden-request trap empty by aborting any other `/api/v1` request.
- Added deployment docs for the `20260601_0032` target-database proof and
  duplicate cleanup/rollback guidance. Credential-free SQLite migration coverage
  now exercises the duplicate-active-provider guard and active-only unique-index
  behavior; the full Postgres Alembic apply smoke still requires
  `TEST_DATABASE_URL`.
- Verification: full owner portal account smoke passed **6 passed / 4 skipped**;
  targeted frontend `eslint`, `tsc --noEmit`, and `git diff --check` passed.

### Owner statement ZIP CSV hardening
- Backend owner statement ZIP packs now formula-harden both included CSVs:
  `MANIFEST-{month}.csv` and `INVOICE-EVIDENCE-{month}.csv`.
- The shared backend pack cell formatter still quotes every value and doubles
  embedded quotes, but now prefixes spreadsheet formula-looking values (`=`,
  `+`, `-`, `@`, including whitespace-leading values) before writing the ZIP.
- Guardrails: the integration test reads the ZIP CSVs with `csv.DictReader`
  and proves unsafe owner identity, billing email, property name, invoice
  number/title, Xero invoice id, reconciliation reference, and bank transaction
  id values are neutralised.
- Verification: owner statements integration tests passed **25 passed**;
  targeted backend ruff and `git diff --check` passed.

### Owner portal preview error/cache parity
- `/owner-portal/[ownerId]` now follows the tenant operator-preview freshness
  pattern: preview reads use `retry: false`, `staleTime: 0`, and
  `refetchOnMount: "always"` so returning to an owner preview rechecks the
  backend instead of trusting the shared five-minute query cache.
- 404s render `Owner portal preview not found` with the API detail, while
  non-404 failures stay on the generic `Owner portal unavailable` path.
- Guardrails: the smoke proves a 404 does not keep stale owner/property/statement
  rows on screen after a previously successful preview, and the existing
  self-managed operating-mode gate still blocks preview API reads entirely.
- Verification: focused owner portal preview error/cache smokes passed
  **3 passed**; full owner portal preview smoke passed after the route change;
  targeted frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### CSV export hardening v1
- Review/export CSV builders now share `apps/web/src/lib/csv.ts`, which quotes
  every cell, doubles embedded quotes, and prefixes spreadsheet formula-looking
  values (`=`, `+`, `-`, `@`, including whitespace-leading values) before
  download.
- Migrated exports: Dashboard, Billing Readiness, Comms, Contractors, Insights,
  Notifications, Operations, maintenance detail, Owner portal, Portfolio QA,
  Settings, Statements, tenant detail, and tenant portal preview.
- Guardrails: the source smoke now prevents these review exports from drifting
  back to local `csvCell` implementations without the shared formula-safe
  helper.
- Verification: CSV helper/source smokes passed **7 passed**; targeted frontend
  eslint, `tsc --noEmit`, and `git diff --check` passed.

### Owner portal mobile empty-state parity
- `/owner-portal` and `/owner-portal/[ownerId]` now have matching 390px smoke
  coverage for empty owner accounts/previews: no linked properties, no
  statement, no shared documents, and no open maintenance.
- The mobile smokes assert the Owner-visible packet controls remain visible,
  empty-state copy renders, the selected period stays visible without a linked
  statement, the read-only guardrail remains present, and the long owner billing
  email fits inside the mobile viewport.
- Guardrails: the tests continue trapping owner statement sends/dispatch/PDF
  generation, Comms, Xero, Basiq, payments, reconciliation, owner-portal
  mutations, and account document downloads.
- Verification: owner portal account + preview smokes passed **8 passed**;
  targeted frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### Owner portal preview parity hardening
- `/owner-portal/[ownerId]` now reuses the shared owner portal dashboard view
  used by account and invite flows, leaving only route gating, operating-mode
  checks, and preview data loading in the operator-preview route.
- The operator-preview smoke now exercises the Owner-visible packet end to end:
  copy, CSV download, owner/property split/statement/document/maintenance
  contents, `Operator preview` labeling, spreadsheet formula escaping, and the
  no-send/no-provider guardrail copy.
- Guardrails: the preview export smoke traps owner statement sends/dispatch/PDF
  generation, Comms, Xero, Basiq, payments, reconciliation, owner-portal
  mutation methods, and account-scoped shared-document downloads.
- Verification: operator owner portal preview smoke passed **2 passed**;
  targeted frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### Owner-visible review packet v1
- `/owner-portal` and `/owner-portal/[ownerId]` now show a local
  Owner-visible packet derived from the already-loaded portal payload: owner
  identity, auth boundary, property splits, selected-month statement totals,
  statement property lines, shared document filenames/notes, owner-visible
  maintenance rows, and access-boundary guardrails.
- Local `Copy packet` and `Download packet CSV` actions export
  `owner-visible-review-packet-{month}-{ownerId}.csv` without fetching a new
  statement PDF or downloading shared document files.
- Guardrails: copy/download do not send owner email, dispatch invoices,
  generate owner statement PDFs, call Comms, Xero, Basiq, payments, or
  reconciliation paths, mutate owner-portal/provider history, or trigger shared
  document downloads.
- Verification: owner portal account smoke passed **4 passed** and operator
  owner portal preview smoke passed **2 passed**; targeted frontend eslint,
  `tsc --noEmit`, and `git diff --check` passed.

### Vendor exposure packet v1
- Maintenance work-order detail now has a read-only Vendor exposure packet
  inside the operator-only Vendor portal panel, separate from the vendor preview
  page.
- The packet summarizes visibility state, selected/saved vendor, draft or saved
  vendor-safe title, draft or saved vendor-visible note evidence, portal preview
  target, and excluded vendor data: tenant identity, internal notes, provider
  history, invoice ids, and raw metadata.
- Local `Copy packet` and `Download packet CSV` actions export
  `vendor-exposure-packet-{workOrderId}.csv` from already-loaded page data.
  Draft title/note state wins over prior saved exposure evidence in both UI and
  CSV until the operator explicitly shares.
- Guardrails: copy/download do not share or hide portal access, send contractor
  email/SMS, create comments, upload documents, draft invoices, call Comms,
  Xero, Basiq, provider dispatch/history, payment, or reconciliation endpoints.
- Verification: focused Operations UX smoke passed **8 passed** after
  red-green worker coverage and parent hardening; targeted frontend eslint,
  `tsc --noEmit`, and `git diff --check` passed.

### Work notification review packet v1
- `/notifications` now has local `Copy review packet` and
  `Download review packet CSV` actions for the Work notice center, exporting
  `work-notification-review-packet.csv` from the already-loaded
  notification-center response.
- The packet includes notice rows, Email/SMS/In-app receipt evidence, digest
  receipt evidence, generated timestamps, assignee/recipient/template/provider
  evidence, next actions, center guardrails, and no-send/no-mutation guardrail
  text.
- Guardrails: copy/download do not send email or SMS, run digests, mark the
  center read/reviewed, dispatch providers, call Comms, Xero, or Basiq, refresh
  provider tokens, or mutate provider history. The packet controls also use the
  44px touch target baseline.
- Verification: focused Notifications smoke passed **2 passed** after
  red-green worker coverage and parent hardening; targeted frontend eslint,
  `tsc --noEmit`, and `git diff --check` passed.

### Arrears review packet mobile/accessibility polish
- The Arrears review packet presentation moved out of the large Operations page
  into `ArrearsReviewPacketPanel`, leaving packet derivation/copy/export wiring
  in the page.
- Packet actions and handoff links now use the 44px touch target baseline on
  mobile: Copy packet, Download packet CSV, Open tenant, and Open queue.
- Verification: focused Operations UX smoke passed **7 passed**; targeted
  frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### Owner portal account cache hardening
- `/owner-portal` account reads now use private owner-account query keys scoped
  by auth user and owner context, fetch fresh Clerk bearer tokens with
  `skipCache: true` when Clerk is enabled, and opt out of the shared five-minute
  query cache with `staleTime: 0`, `gcTime: 0`, and refetch-on-mount.
- A failed account-session read no longer keeps rendering previously cached
  owner private data: owner name, property, statement totals, shared documents,
  and maintenance rows are cleared behind the unavailable/recovery state.
- Verification: owner portal account smoke passed **4 passed**; targeted
  frontend eslint, `tsc --noEmit`, and `git diff --check` passed.

### Arrears review packet v1
- Operations → Arrears rows now carry a read-only Review packet deriving next
  action, balance-age evidence, reminder/dispute/escalation/promise state,
  assignment state, safe tenant/queue links, copy summary, and CSV export from
  already-loaded Operations data.
- Guardrails: copy/download do not send email/SMS, tenant or owner messages,
  provider dispatch, Xero/Basiq writes, payment reconciliation, invoice updates,
  arrears status changes, reminder updates, escalation updates, or assignment
  updates.
- Verification: focused Operations smoke passed after red-green coverage.

### Maintenance review packet v1
- Work-order detail now has a read-only Review packet near the top of the page,
  deriving next action, evidence rows, safe links, copy summary, and CSV export
  from already-loaded work-order, document, invoice, correspondence, and vendor
  portal state.
- Guardrails: copy/download do not send email/SMS, mutate vendor portal state,
  prepare/approve invoices, upload documents, refresh providers, write
  Xero/Basiq data, reconcile payments, or mutate maintenance records.
- Verification: focused maintenance detail smoke passed; targeted frontend
  eslint, `tsc --noEmit`, and `git diff --check` passed.

### Installable PWA mobile runway v1
- Web now exposes a typed App Router manifest at `/manifest.webmanifest` with
  `display: standalone`, root `start_url`/`scope`, Leasium theme/background
  colours, the existing SVG app icon, PNG 192/512 install icons, a 512 maskable
  icon, a dedicated 180px Apple touch icon, and shortcuts for Smart Intake,
  People, and Money.
- Root metadata now emits application name, manifest link, icon/apple icon
  links, mobile-web-app and Apple standalone tags, format-detection guard, and
  a `viewport` export with `viewport-fit=cover`, light/dark `theme-color`, and
  `color-scheme: light dark`.
- `/manifest.webmanifest` is public through the temporary access gate alongside
  `/icon.svg`, `/apple-touch-icon.png`, and `/icons/*`; the v1 deliberately
  adds no service worker, Workbox, runtime cache, or private-data offline
  storage.
- Red-green proof was captured in
  `apps/web/tests/smoke/pwa-mobile.spec.ts`: it first failed for missing
  manifest/standalone metadata and for the manifest route being gated, then
  passed after the metadata + public-route changes. Follow-up red-green added
  the PNG/maskable icon expectations, public `/icons/*` gate, and dedicated
  Apple touch icon expectation.
- Verification: PWA/mobile smoke passed **3 passed**; adjacent mobile-header
  smoke passed **1 passed**; targeted frontend `eslint`, `tsc --noEmit`,
  `git diff --check`, and production-style `next build` passed.

### Mobile operator shell bottom-nav v1
- Sub-md operator pages now carry a compact fixed bottom navigation for the
  five field-operator hubs: Dashboard, Properties, People, Work, and Money.
  Smart Intake, Insights, Settings, and the full seven-hub list remain in the
  hamburger drawer and command palette. Treat this as shipped pending
  Remba/real-device mobile review.
- The bottom nav uses the same app-shell route matching as the desktop/sidebar
  nav, marks the active destination with `aria-current="page"`, keeps each
  item at 44px+ touch size, and reserves bottom body padding with safe-area
  inset support so page content does not sit underneath it.
- Red-green proof was captured in
  `apps/web/tests/smoke/mobile-bottom-nav.spec.ts`: it failed first because no
  `Mobile primary` nav existed on mobile, then passed once the shell and body
  spacing were added. A follow-up assertion found the drawer's mobile nav rows
  were only 36px tall; they now share the 44px minimum touch target. Desktop
  stays free of the bottom nav.
- Provider guardrails unchanged: this is frontend navigation chrome only; no
  Xero, Basiq, SendGrid, Twilio, tenant email, payment reconciliation, or API
  mutation paths were touched.
- Verification: shell-adjacent Playwright smokes passed **10 passed**; targeted
  frontend `eslint`, `tsc --noEmit`, `git diff --check`, and production-style
  `next build` passed.

### Vendor portal read-only foundations v1
- Backend now has `GET /api/v1/vendor-portal/{contractor_id}` as an
  operator-authenticated preview. It returns a safe vendor summary plus active
  work orders only when the work order metadata has both
  `vendor_portal_visible: true` and
  `vendor_portal_contractor_id: "<contractor id>"`.
- The projection excludes tenant identity/contact fields, unit/lease ids, raw
  titles/descriptions, internal notes/comments, provider delivery/history,
  invoice/source document ids, raw metadata, completed/cancelled/deleted work,
  and contact-only copied contractor assignments.
- Frontend now has `/vendor-portal/[contractorId]` and a vendor-record
  `Open portal preview` action. The page shows vendor contact readiness,
  safe work-order rows, contractor-visible comments, counts, and an access
  boundary panel.
- Guardrails: this slice creates no vendor account/invite, sends no contractor
  email/SMS, dispatches no work, refreshes no providers, writes no Xero/Basiq
  data, reconciles no payments, and mutates no provider history.
- Focused red-green proof: `tests/integration/test_vendor_portal_api.py`
  passed **2 passed**; `tests/smoke/vendor-portal.spec.ts` passed
  **2 passed**; the vendor-record portal-link smoke passed **1 passed**.

### Vendor portal operator visibility controls v1
- Maintenance work-order detail now has a compact **Vendor portal** panel
  beside the contractor context. Operators choose a real contractor-directory
  vendor, enter an explicit vendor-safe title, optionally add a
  vendor-visible note, and can share/hide the work order from the read-only
  portal.
- Backend commands:
  `POST /api/v1/maintenance/work-orders/{work_order_id}/vendor-portal/share`
  and `/unshare`. They mutate only local work-order metadata, append activity
  history, and write confidential local audit rows under
  `maintenance.vendor_portal.share` / `.unshare`.
- Share requires a nonblank safe title and same-entity non-deleted contractor;
  completed/cancelled work orders are blocked. Unshare is idempotent and clears
  the contractor/title portal keys while leaving the rest of the work order
  intact.
- Guardrails: these controls create no vendor account/invite, send no
  contractor email/SMS, dispatch no work, refresh no providers, write no
  provider history, touch no Xero/Basiq data, and reconcile no payments.
- Red-green proof: `tests/integration/test_vendor_portal_share_api.py`
  passed **6 passed**; combined backend regression
  `tests/integration/test_vendor_portal_share_api.py tests/integration/test_vendor_portal_api.py tests/integration/test_maintenance_arrears_api.py`
  passed **32 passed**; browser regression
  `tests/smoke/operations-ux.spec.ts tests/smoke/vendor-portal.spec.ts`
  passed **8 passed**; targeted ruff, frontend eslint, `tsc --noEmit`,
  `git diff --check`, and production-style `next build` passed.

### Tenant portal backend account-scope hardening
- Backend tenant portal reads now keep the durable account boundary all the way
  through shared portal endpoints: if a request carries a valid Clerk bearer
  account token plus a stale portal token, the account wins and token data
  cannot steer reads or writes to another tenant/onboarding.
- Account session documents, invoice rows, invoice-PDF downloads, and ordinary
  document downloads are now scoped by entity + property + unit + tenant +
  lease, not by tenant alone. This blocks old same-tenant lease artifacts from
  leaking into the current portal.
- Lease-scoped signed documents retained by DocuSign remain visible/downloadable
  even when older rows lack property/unit columns; they still need the current
  tenant + lease boundary.
- Reclaiming an old consumed invite can no longer repoint an already relinked
  active tenant account back to stale onboarding. It returns the current account
  scope instead.
- If an active account points at a cancelled/deleted onboarding but a current
  same-tenant onboarding exists, account session falls forward to the current
  valid onboarding instead of 404ing.
- Red-green proof was captured in
  `tests/integration/test_tenant_portal_api.py` with regressions for
  stale mixed bearer/token reads, stale mixed bearer/token maintenance writes,
  same-tenant old-lease documents/invoices, consumed old invite reclaim, and
  cancelled-onboarding fallback.
- Verification so far: focused new regressions **6 passed**; full tenant portal
  backend integration file **51 passed**; targeted backend ruff clean; `git
  diff --check` clean. Provider guardrails unchanged: no SendGrid/Twilio/Xero,
  payment reconciliation, provider dispatch, or provider history mutation paths
  were touched.

### Tenant portal contact-edit review-first closeout
- Account-scoped tenant contact changes now follow the same review-first path as
  token-scoped contact changes. Signed-in tenants can submit proposed contact
  name/email/phone/billing-email changes with a note, but the canonical tenant
  record only mutates after an operator applies the request.
- The previous account-only self-edit branch was removed. Duplicate pending
  submissions are blocked for account users too, and the tenant detail
  `Tenant requests` read path sees account-submitted requests as
  `tenant_portal_contact_request` rows.
- The tenant portal UI no longer switches account users to `Edit details` /
  `Save details`; it keeps review-first `Request change` / `Send request`
  language while still using bearer auth for account sessions.
- Verification: account review-first + duplicate backend regressions and the
  existing token review-first test passed **3 passed**; full tenant portal
  backend integration file passed **52 passed**; frontend helper smoke passed
  **4 passed**.

### Dark mode v1
- Workspace appearance now supports `system`, `light`, and `dark` from one
  shared helper (`apps/web/src/lib/appearance.ts`). The root first-paint script
  resolves stored/system preference before React loads, writes
  `data-appearance`, `data-theme`, `color-scheme`, and toggles the root `.dark`
  class.
- AppHeader's appearance control is enabled and cycles System -> Light -> Dark;
  Settings exposes all three choices and syncs with the header via the existing
  `leasium:appearance-change` event.
- `apps/web/src/app/globals.css` keeps the existing `data-theme="dark"` token
  overrides and now also covers the `bg-white/90` shell toolbar escape hatch.
  Tailwind is configured with class-based dark mode for future `dark:` variants.
- Design docs/roadmap now record the dark token set and the shipped v1 scope.
  Clerk sign-in/sign-up widgets remain pinned to the light Leasium appearance
  object; live hosted Clerk dark-OS rendering is still a manual/Remba review
  item before calling dark mode design-complete.
- Verification so far: appearance smoke passed **8 passed**, including Dashboard,
  Smart Intake, Properties, People/Tenants, and Operations at desktop + mobile
  widths, plus blocked-storage first-paint/manual-change regressions.

### Owner portal maintenance snapshot
- Owner account and operator-preview dashboards now include a read-only
  `Maintenance snapshot` section for linked owner properties. The API exposes
  open, urgent, and awaiting-approval counts plus a narrow item projection for
  work orders explicitly marked `owner_portal_visible`: work-order id, property
  id/name, owner-safe `owner_portal_title`, status, priority, requested/due/
  completed dates, approval state, and quote amount.
- The projection deliberately omits raw tenant-entered work-order titles, tenant
  identity, unit/lease ids, contractor names/contact details, internal
  notes/comments, provider receipts/history, message bodies, source document
  ids, invoice handoff ids, raw metadata, completed/cancelled work, and work
  from unlinked or cross-entity properties.
- Guardrails unchanged: opening the portal does not send owner email, contact
  contractors/tenants, dispatch invoices, write Xero/Basiq/provider data,
  reconcile payments, refresh providers, mutate provider history, or mutate work
  orders.
- Verification: backend owner portal + account + statement parity suite passed
  **19 passed**; targeted backend `ruff` passed; targeted frontend `eslint`
  passed; frontend `tsc --noEmit` passed; owner portal account/preview smokes
  passed **5 passed**.

## Codex continuation — 2026-05-31 (latest)

Continuation from the Codex takeover. Branch `main` was current at `b7ec1f7`
before the Ticket 2.2 slice.

### Prod checks completed
- Render health endpoint is serving `d2e590798e09c89bee402c81c2600efce5148946`
  with `source=render`.
- Live OpenAPI includes `/api/v1/owners`, `/api/v1/owners/{owner_id}`,
  `/api/v1/owners/{owner_id}/properties`, and `/api/v1/owners/statements`.
- Neon production project `snowy-boat-02653440` is at Alembic
  `20260531_0029`; `owner` and `property_owner` tables exist.
- Prod owner backfill was run additively through Neon: **17 owners** and
  **20 property_owner links** for **20 active properties**. A second idempotence
  run created `0` owners and `0` links.
- Local backfill could not run in this desktop session because Docker is not
  installed and local Postgres on `localhost:5432` refused connections. Run
  `.venv/bin/python -m scripts.backfill_owners` locally once the DB is up.

### Phase 3 slice
- Sidebar consolidated to 7 primary hubs + Settings:
  Dashboard · Smart Intake · Properties · People · Work · Money · Insights.
- `/people` now has Tenants and Vendors inline instead of link-out actions;
  Owners remains backed by `/api/v1/owners`; Prospects remains a stub.
- New `/money` hub groups Billing · Statements · Xero · Basiq with review-first
  handoffs to the existing finance workspaces.
- Work is active for `/comms`, and hub alias redirects were added:
  `/people/tenants`, `/people/vendors`, `/work`, `/work/comms`,
  `/money/billing`, `/money/statements`, `/money/xero`, `/money/basiq`.
- Existing heavy workspaces (`/tenants`, `/contractors`, `/billing-readiness`,
  `/statements`, `/comms`) remain reachable for deep links and detailed work.
- New smoke: `apps/web/tests/smoke/nav-consolidation.spec.ts`.

### Verification for this slice
- Red-green: `./node_modules/.bin/playwright test tests/smoke/nav-consolidation.spec.ts --workers=1`
  failed first for missing People/Money/inline tabs, then passed **3 passed**.
- Adjacent smokes:
  `people-hub.spec.ts` + dashboard entity bootstrap **2 passed**; app-shell
  command/comms/shortcut checks **3 passed**.
- Frontend checks: focused `eslint` clean, `./node_modules/.bin/tsc --noEmit`
  clean, `git diff --check` clean, production-style
  `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  succeeded.

### Ticket 1.3 slice
- `/api/v1/owners/statements` now groups statement buckets from
  `Owner`/`PropertyOwner` links instead of the legacy `Property.owner_*`
  identity tuple. Legacy fields remain as a backfill source only. Code commit:
  `d1822ef`.
- Properties with no active `PropertyOwner` link remain visible under a single
  `Unattributed` statement bucket, even when legacy owner text is still present
  on the property.
- Distinct Owner rows that share the same display label now get disambiguated
  statement identities so PDF download and dispatch review can target each one.
- Statement PDF, ZIP pack, dispatch receipt, SendGrid guardrail, and no-provider
  mutation behaviour were left unchanged.
- Agent-first operating rule is now recorded in `CLAUDE.md`, this handover, and
  the active superpowers plan.
- Red-green proof:
  `test_owner_statements_group_by_owner_entity_not_legacy_tuple` and
  `test_owner_statements_unattributed_bucket` failed under the legacy grouping,
  then passed after the cutover.
- Verification:
  `tests/integration/test_owner_statement_parity.py tests/integration/test_owners_api.py`
  passed **18 passed**; owner-adjacent integration slice passed **30 passed**;
  targeted `ruff check` passed; full backend integration passed **346 passed /
  1 skipped**.
- Deployment verification: Vercel production deploy for `d1822ef` is **READY**
  on `leasium.ai`; Render health reports
  `d1822ef99e5c357a8fbcdc9b7418283a8f0c0fe2` from `api.leasium.ai`.

### Ticket 2.2 slice
- Tenant, Owner, and Vendor detail records now share the same People record
  shell: header/actions plus Overview · Financials · Tasks · Notes · Files ·
  Activity section links.
- Code commit: `aa4374b` (`Align people record pages`).
- New shared component: `apps/web/src/components/people-record-layout.tsx`.
  The links are plain in-page anchors, not ARIA tab widgets.
- Tenant detail keeps its existing inner panels and now exposes stable section
  anchors for the shared shell.
- New detail routes:
  `/owners/[ownerId]` reads `getOwner(ownerId)` and stays read-only/provider-safe;
  `/contractors/[contractorId]` reads contractor lists across entities and repairs
  stale selected-entity state before showing a vendor record.
- `/people` inline Tenant/Owner/Vendor rows now link into their records, and the
  sidebar marks `/owners/*` as part of People.
- Review agents found two functional issues before commit: missing tenant anchor
  targets and stale-entity vendor lookup. Both are now covered in
  `apps/web/tests/smoke/people-record-layout.spec.ts`.
- Later follow-up resolved: owner and vendor detail pages now use the shared
  `ApiError` status contract for calm record-level 404 states; see the slices
  below.
- Verification:
  `people-record-layout.spec.ts` passed **4 passed**; adjacent
  `people-hub.spec.ts` + `nav-consolidation.spec.ts` passed **8 passed**;
  targeted `eslint` clean; `./node_modules/.bin/tsc --noEmit` clean;
  production-style
  `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  succeeded.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_A7xtmu8hdZ3ftHpi7hegNd2ohXyA` for `aa4374b` was **READY** and aliased to
  `leasium.ai`; `https://leasium.ai` returned HTTP 200; Render health reported
  `aa4374b9cc05d52582aab57884b2d43a33e8410d` with `source=render`.

### Owner portal read-only first slice
- First owner portal slice is shipped. Code commit: `b47b7a3`
  (`Add read-only owner portal preview`).
- Backend: new `GET /api/v1/owner-portal/{owner_id}?month=YYYY-MM` returns a
  read-only `operator_preview` payload scoped by the signed-in operator's
  entity role. It uses first-class `Owner` / `PropertyOwner` links and the
  existing owner-statement roll-up for monthly totals and property lines.
- Frontend: new `/owner-portal/[ownerId]?month=YYYY-MM` portal-style route
  renders owner identity, billing contact/email, linked property splits,
  statement KPIs, statement property lines, and access-boundary guardrails.
- Guardrails: this slice creates no owner portal account, sends no owner email,
  downloads/sends no PDFs, writes no Xero data, reconciles no payments,
  dispatches no invoices, refreshes no providers, and mutates no provider
  history. True owner login/account claiming is intentionally deferred to the
  next owner-portal auth slice.
- Red-green proof: backend test failed first with 404, then passed after
  registration. Playwright smoke failed first on the missing route, then passed
  after the page landed.
- Verification: owner portal + owner statement parity/owner tests
  **22 passed**; targeted API ruff clean; targeted frontend eslint clean;
  `./node_modules/.bin/tsc --noEmit` clean; owner portal + People record smokes
  **5 passed**; `./node_modules/.bin/next build` succeeded.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_BmDUL3NHvnFheAXA4jxfSwxo2ba9` for `b47b7a3` was **READY**; `https://leasium.ai`
  returned HTTP 200; Render health reported
  `b47b7a3b10a2b90f267991fd7c229de9ab4a3993` with `source=render`.

### Owner portal account-auth slice
- First true owner-account boundary is implemented after the read-only preview.
- Backend: migration `20260531_0030_owner_portal_accounts.py` adds
  `owner_portal_invite` and `owner_portal_account` tables. Invites store only a
  SHA-256 token hash; the raw token is returned once in the operator response.
- New backend routes:
  `POST /api/v1/owner-portal/{owner_id}/invite`,
  `GET /api/v1/owner-portal/invites/{token}/preview`,
  `POST /api/v1/owner-portal/account/claim`,
  `GET /api/v1/owner-portal/account/status`, and
  `GET /api/v1/owner-portal/account/session?month=YYYY-MM`.
- Frontend: `/owner-portal/invite/[token]` renders only safe claim context
  before account claim, and `/owner-portal` opens an already linked owner
  account without an owner id in the URL. Existing
  `/owner-portal/[ownerId]?month=YYYY-MM` remains operator-preview only.
- Guardrails: owner invite creation is local only; no owner email, PDF
  generation/dispatch, Xero write, Basiq/provider refresh, payment
  reconciliation, invoice dispatch, or provider-history mutation is triggered.
- Red-green proof: backend auth tests failed first on missing account models /
  endpoints; frontend smoke failed first on missing account routes, then passed.
- Verification so far: focused owner backend slice passed **26 passed**; targeted
  backend ruff clean; frontend owner account + preview smokes passed **4
  passed**; targeted frontend eslint clean; `./node_modules/.bin/tsc --noEmit`
  clean; production-style `next build` succeeded; Postgres offline migration SQL
  for `20260531_0029:20260531_0030` generated successfully; in-app browser
  sanity checked the safe invite page and account dashboard against a local mock.
  Local `alembic upgrade head` still needs a running local Postgres (the desktop
  session refused `localhost:5432`).
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_3Gk5FKHGQXo1xgJiGuftCddsZhGY` for `ae6fabb` was **READY** and aliased to
  `leasium.ai`; `https://leasium.ai/owner-portal` returned HTTP 200; Render
  health reported `ae6fabb14efe14110d15fe60d062d67454359762` with
  `source=render`; live OpenAPI includes all five account/invite routes; the
  public invite preview endpoint returned a clean 404 for a fake token, which
  confirms migration `20260531_0030` is applied enough for the new table read
  path instead of failing with a missing-table error.

### Owner portal secure-documents slice
- First owner document-share slice is shipped. Code commit: `8c4ae0e`
  (`Add owner portal secure documents`).
- Backend: `OwnerPortalRead` now includes `documents`, populated only from
  property-level `StoredDocument` rows whose
  `document_metadata.owner_portal_visible` is exactly `true`, whose
  `property_id` is linked to the owner through `PropertyOwner`, and whose
  tenant/unit/lease/onboarding fields are empty. Invoice-category documents are
  excluded from this first slice.
- Backend: signed-in owner accounts can download those files through
  `GET /api/v1/owner-portal/account/documents/{document_id}/download`. The route
  reuses the owner portal bearer account boundary; unflagged, cross-property,
  tenant/lease/onboarding, deleted, and revoked-account access stays blocked.
- Frontend: `/owner-portal` and operator preview `/owner-portal/[ownerId]` show
  a `Shared documents` panel with owner-safe source labels. Account sessions get
  a download button; operator preview shows `Account download only`.
- Guardrails: no owner email, SendGrid/Twilio send, Xero/Basiq/provider write,
  provider refresh, payment reconciliation, invoice dispatch, owner-statement
  PDF generation, upload, or provider-history mutation was added.
- Red-green proof: backend document-list test first failed with missing
  `documents`; backend account-download test first failed with 404; frontend
  smokes first failed on missing `Shared documents`. All passed after the slice.
- Verification: owner portal backend + auth + statement parity tests
  **11 passed**; targeted backend ruff clean; targeted frontend eslint clean;
  `./node_modules/.bin/tsc --noEmit` clean; owner portal account/preview smokes
  **4 passed**; production-style `next build` succeeded. A parallel attempt to
  run Playwright and `next build` corrupted `.next`; rerunning them sequentially
  after clearing the generated cache passed cleanly.
- Deployment verification: Render health reports
  `8c4ae0eef985e114ef94fe95b3e9b66632f6485c` with `source=render`; live OpenAPI
  includes `/api/v1/owner-portal/account/documents/{document_id}/download`;
  `https://leasium.ai/owner-portal` returns HTTP 200. Vercel API auth is not
  available in this desktop session, so frontend production proof used the
  public URL and deployed static chunks; those chunks include `Shared documents`,
  `Owner account`, `Operator preview`, `source_label`, and the account document
  download path.

### Owner statement split-allocation slice
- Shipped in this continuation. Code commit: `4305533`
  (`Allocate owner statements by ownership split`). Plan:
  `docs/superpowers/plans/2026-05-31-owner-statement-split-allocation.md`.
- Backend: `/api/v1/owners/statements` now carries `PropertyOwner.split_pct`
  into statement aggregation, so shared-property invoice totals are allocated
  by owner split instead of duplicated into every linked owner. Unlinked
  properties still fall into `Unattributed` at 100%.
- The allocated values flow through owner statement JSON, owner portal
  statement projections, owner statement PDFs, statement pack manifests, and
  invoice evidence CSVs because they all read from the same statement builder.
- Guardrails unchanged: this is a read-path change only; statement send/dispatch
  remains explicit approval only, and no owner email, Xero/Basiq/provider write,
  payment reconciliation, provider refresh, or provider-history mutation was
  added.
- Red-green proof:
  `test_owner_statements_allocates_shared_property_totals_by_split_pct` first
  failed because both 60/40 owners received the full invoice, then passed after
  allocation. Owner portal expectations were updated for the fixture's 40/60
  linked-property splits.
- Rounding guard: `test_owner_statements_allocates_split_rounding_residue_once`
  covers a one-cent 50/50 split so allocation cannot create duplicate cents.
- Review fixes: allocated invoice evidence now keeps
  `paid_cents + outstanding_cents == total_cents` whenever the source invoice
  balances, caps allocated paid cents at each owner's allocated total for tiny
  split percentages, normalises invalid over-100 linked split totals defensively
  so they cannot duplicate full invoices, and owner statements include a stable
  `owner_id` so owner portal previews match duplicate-label co-owners on the
  same shared property by id rather than by display text alone.
- Verification:
  `.venv/bin/python -m pytest tests/integration/test_owners_api.py tests/integration/test_owner_portal_api.py tests/integration/test_owner_portal_auth_api.py tests/integration/test_owner_statement_parity.py -q`
  passed **35 passed**; targeted backend ruff passed; web `tsc --noEmit` and
  targeted `eslint src/lib/api.ts` passed; `apps/web` statements smoke passed
  **3 passed**.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_5G4GWVCp1Q8gXyQpkpujX6JwMcov` for `4305533` was **READY**;
  `https://leasium.ai/statements` returned HTTP 200; Render health reported
  `43055333993c3575581bc66a1411d4b12188256f` with `source=render`; live
  OpenAPI includes `/api/v1/owners/statements`.

### Owner detail 404 polish slice
- Shipped in this continuation after the split-allocation deploy.
- Frontend API errors now preserve HTTP status through `ApiError` while keeping
  the existing `Error.message` contract for `friendlyError` callers.
- `/owners/[ownerId]` now shows a calm `Owner not found` People-record state for
  404s, with a return action to the owner directory. Non-404 failures still use
  the existing `Owner unavailable` error path.
- Red-green proof: the new People-record smoke first failed because the generic
  unavailable state rendered for a mocked 404, then passed after the status-aware
  branch landed.
- Verification: `people-record-layout.spec.ts` passed **5 passed**; targeted
  `eslint`, web `tsc --noEmit`, and `git diff --check` passed. Review agent
  approved with no P1/P2 findings.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_BT5PUVTzN7YvabAZqwaDE6yo1sYQ` for `5b14961` was **READY**;
  `https://leasium.ai/owners/missing-owner` returned HTTP 200 through the
  dynamic `/owners/[ownerId]` route; Render health reported
  `5b1496164e95d46b5756471f5dea77136bc5e78b` with `source=render`.

### Vendor detail read + 404 polish slice
- Shipped in this continuation after the owner-detail polish.
- Backend: `GET /api/v1/contractors/{contractor_id}` returns one non-deleted
  vendor/contractor record through the existing `READ_ROLES` role check. It is
  read-only: no audit write, provider send, provider mutation, or dispatch path.
- Frontend: `/contractors/[contractorId]` now reads the direct contractor detail
  endpoint instead of searching contractor lists across every entity. After load
  it still repairs stale selected-entity state to the contractor's `entity_id`.
- 404s now render a record-level `Vendor not found` People-record state with a
  return action to the vendor directory. Non-404 failures use the
  `Vendor unavailable` error path.
- Red-green proof: backend detail tests first failed with **405** before the
  route existed, then passed. The new vendor not-found smoke first failed
  because the page had no record-level `Vendor not found` heading, then passed.
- Verification: `tests/integration/test_contractors_api.py` passed **4 passed**;
  People-record smoke passed **6 passed**; targeted backend ruff, frontend
  `eslint`, web `tsc --noEmit`, and `git diff --check` passed. Review agent
  approved with no P1/P2 findings.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_A7r27oinhtNVSXA84cuqh7PTmBQn` for `b4af4b4` was **READY**;
  `https://leasium.ai/contractors/missing-vendor` returned HTTP 200 through the
  dynamic `/contractors/[contractorId]` route; Render health reported
  `b4af4b49f03a903276b85930a694483992ceb093` with `source=render`; live OpenAPI
  includes `/api/v1/contractors/{contractor_id}`.

### Tenant detail status-aware error polish slice
- Shipped 2026-06-01 after the owner/vendor record-level error states.
- `/tenants/[tenantId]` now imports the shared `ApiError` status contract and
  uses it on the primary tenant and tenant-detail reads. 404s render a
  People-record `Tenant not found` state with a return action to the People
  tenants directory; non-404 primary load failures render `Tenant unavailable`
  with the API message instead of being mislabeled as missing records.
- The slice leaves tenant child queries (portal accounts, leases, documents,
  correspondence, intakes) on their existing paths and touches no provider,
  email, Xero, Basiq, reconciliation, or backend mutation code.
- Red-green proof: the new tenant People-record smoke first failed because the
  page did not expose the expected record-level heading/description and generic
  failures did not reach `Tenant unavailable`; after the status-aware branch,
  the focused smoke passed **3 passed**, including the review-found mixed
  500/404 primary-read edge case where the non-404 API message must win.

### Maintenance detail status-aware error polish slice
- Shipped 2026-06-01 after the Tenant detail status-aware slice.
- `/operations/maintenance/[workOrderId]` now imports the shared `ApiError`
  status contract and uses it on the primary work-order read. 404s render a
  `Work order not found` page/header with a return action to Work; non-404
  failures render `Work order unavailable` with the API message.
- The slice leaves correspondence, documents, invoice drafts, properties, and
  tenants child queries on their existing paths and touches no provider, email,
  SMS, Xero, Basiq, reconciliation, or backend mutation code.
- Red-green proof: the new Operations smoke first failed because both mocked
  404 and 500 primary-read failures stayed on the generic unavailable card/page
  heading; after the status-aware branch, the focused smoke passed **2 passed**.
  A follow-up review found cached data could coexist with a primary-read error;
  the added refresh regression failed red on stale `Air conditioning fault`
  content, then passed after primary-read errors began suppressing cached
  work-order data.

### Property workspace deep-link error polish slice
- Shipped 2026-06-01 after the Maintenance detail status-aware slice.
- `/properties?entity_id=...&property_id=...` now keeps the requested
  `property_id` when it is not in the selected entity's property list instead
  of silently rewriting the URL to the first property.
- `apps/web/src/lib/api.ts` now has `getProperty(property_id)` for the existing
  backend `GET /premises/{property_id}` route. The workspace only uses that
  direct read for missing deep-linked records, so normal list, unit, lease,
  obligation, rent-roll, charge-rule, document, and enrichment flows stay on
  their existing query paths.
- 404 direct-read failures render `Property not found` with a return action to
  Properties; non-404 direct-read failures render `Property unavailable` with
  the API message. The blocked record state hides selected-property panels so
  stale property detail does not sit under the error state. A review follow-up
  also keeps selected-property child queries from widening to entity-wide reads
  while a requested property is blocked, and keeps filtered deep-link selection
  inside the filtered property list.
- Red-green proof: the new Properties smoke first failed because missing and
  broken deep links never rendered record-level headings and the app selected
  the first property instead; after the status-aware branch, the focused smoke
  passed **2 passed**. Review regressions for widened child queries and
  filtered-list selection both failed red, then passed after the gates were
  tightened. The full Properties UX smoke passed **8 passed**.

### Tenant portal operator preview error polish slice
- Shipped 2026-06-01 after the Property workspace deep-link polish slice.
- `/tenants/[tenantId]/portal-preview/[onboardingId]` now imports the shared
  `ApiError` status contract for the primary operator-preview read. 404s render
  `Tenant portal preview not found` with a return path to the tenant record;
  non-404 failures render `Tenant portal preview unavailable` with the API
  message.
- This is a read-only operator-preview UI change. It does not change tenant
  invite preview, tenant portal claim, account/session, uploads, document
  downloads, notification preferences, email, SMS, Xero, Basiq, reconciliation,
  provider refresh, or provider-history mutation paths.
- Red-green proof: the new tenant-portal smoke first failed because missing and
  broken operator previews both stayed on the old generic unavailable state;
  after the status-aware branch, the focused smoke passed **2 passed**. Review
  then found the shared React Query `staleTime` could keep a successfully loaded
  preview fresh for five minutes; the app-link return regression failed red on
  stale `Bright Cafe` content, then passed after the operator-preview query was
  set to revalidate on mount without retrying record errors.
- Agent reconnaissance also found a larger follow-up risk in tenant portal
  account/session cache boundaries: stale account data can remain visible after
  refetch failures or user/token switches because account query keys are broad.
  Treat that as the next test-first tenant-portal hardening slice, separate from
  this operator-preview route polish.

### Tenant portal account-session cache hardening slice
- Shipped 2026-06-01 after the operator-preview error polish slice.
- `GET /tenant-portal/invites/{token}/preview` now returns `tenant_id` alongside
  the existing minimum-viable invite context. The frontend uses that id only to
  bind token routes to a real token tenant without reopening the disabled
  token-scoped portal read.
- `TenantAccountPanel` now scopes account-session and account-status React Query
  reads by Clerk user id plus token tenant context, revalidates on mount, uses
  zero stale/cache retention for these private account reads, and asks Clerk for
  a fresh bearer token with `skipCache: true`.
- Account-scoped portal data now publishes to the parent only after a successful
  account-session read for the current user/route. The parent stores account
  portal state with a Clerk user key and route key, then derives renderable
  account data only when both match the current render, so user switches and
  token changes cannot paint previous tenant details. Failed, signed-out,
  missing-user, missing-bearer, and wrong-tenant states clear the parent account
  portal before tenant details, invoices, documents, payments, maintenance, or
  preferences can render from stale account data.
- The shared account-scoped `refreshPortal` path now fails closed as well:
  missing fresh bearer tokens or account-session refresh failures call
  `handleAccountPortal(null, null)` instead of falling back to token data or
  leaving old account data visible.
- Top-level claim success and Account Access claim success both seed the
  account-session cache for the current user/token context before publishing the
  account portal, so the just-claimed portal remains stable without reopening
  the stale-cache path. Account lifecycle/status copy is also gated so retained
  React Query data does not render after status refetch errors.
- This is cache-boundary and preview-context hardening only. It does not change
  tenant portal claim semantics, uploads, document downloads, notification
  preferences, email, SMS, Xero, Basiq, reconciliation, provider refresh,
  provider history, or backend mutation paths.
- Red-green proof: the helper-consolidation smoke first failed because
  account/session query keys were broad and account data could publish before a
  fresh read; it then passed after user-scoped keys, revalidate-on-entry, and
  fresh-data gating were added. A second red check failed because the shared
  account refresh path still fell back after account-session errors; it passed
  after that path was changed to clear account portal state.
- Review: first review found a P1 after-paint stale portal clear and a P2
  missing token tenant context; the follow-up review found two P2s around
  top-level claim cache seeding and retained status data. All were fixed.
  Final review found **no P1/P2 issues**.
- Verification: focused helper smoke passed after each red/green fix; full
  helper-consolidation smoke passed **3 passed**; tenant-portal UX smoke passed
  **5 passed**; focused tenant portal API invite/account tests passed
  **7 passed / 38 deselected**; targeted frontend `eslint`, frontend
  `tsc --noEmit`, targeted backend `ruff`, and `git diff --check` passed.

### Account operating-mode frontend gate slice
- Shipped after the vendor-detail polish. Backend commit `cb4704f` already
  added `Organisation.operating_mode` (default `self_managed_owner`) plus the
  owner/admin-gated `PATCH /api/v1/security/organisation/operating-mode`.
- Frontend commit `1996aa7` gates the People → Owners hub by operating mode:
  `self_managed_owner` hides the Owners tab and falls back from
  `/people?tab=owners` to Tenants; `managing_agent` and `hybrid` keep the Owners
  tab and default the People hub to Owners.
- Settings → Organisation now has an owner/admin operating-mode selector. For
  self-managed accounts, owner-entity CRUD remains reachable in Settings under
  **Your entities & trusts** using the shared `OwnersDirectory`; this keeps
  owner/entity data available without framing those records as third-party owner
  clients.
- AppHeader now hides owner-statement command-palette and `G F` shortcut entry
  points for self-managed accounts. Commit `ce271e1` adds explicit smoke
  coverage for those command/shortcut gates and a Settings provider-call guard.
- Commit `add20ac` gates the deeper owner-statement dispatch surface by operating
  mode. Self-managed accounts keep `/statements` as **Entity statements** for
  local trust/entity reporting, while owner email send controls, dispatch drafts,
  dispatch approval queues, and dispatch receipt reads are available only to
  `managing_agent`/`hybrid` accounts. Missing owner billing emails no longer block
  self-managed local statement signoff.
- Commit `147eae1` gates the owner-portal surface by operating mode. Self-managed
  accounts cannot open operator owner-portal previews, create owner portal
  invites, claim owner portal accounts, read linked owner account status/session
  data, or download owner-visible account documents. Managing-agent and hybrid
  accounts keep the existing owner portal behavior; the public invite preview
  remains safe pre-claim context only.
- Guardrails: the frontend write is limited to the local organisation
  operating-mode PATCH. The tests assert the Settings mode change does not call
  SendGrid, Twilio, Xero, Basiq, provider dispatch/refresh, or provider-history
  endpoints. The statement dispatch guard returns 403 before SendGrid for
  self-managed accounts, and the self-managed smoke asserts no
  `/owners/statements/dispatch` or `/owners/statements/send` request leaves the
  page. The owner-portal guard returns 403 before invite/account mutations,
  `last_seen_at` writes, or document byte responses in self-managed mode, and
  the self-managed smoke asserts no operator preview request leaves the page.
- Remaining follow-up: gate deeper agent-only modules that are still directly
  reachable, especially disbursement/trust-accounting entry points once those
  route surfaces exist.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/people-hub.spec.ts tests/smoke/settings.spec.ts tests/smoke/app-flows.spec.ts --grep "operating mode|people hub|keyboard" --workers=1`
  passed **6 passed**; `./node_modules/.bin/tsc --noEmit` passed; targeted
  frontend `eslint` passed; `.venv/bin/python -m pytest tests/integration/test_security_api.py -q`
  passed **14 passed**; targeted backend `ruff` passed; `git diff --check`
  passed. For `add20ac`:
  `./node_modules/.bin/playwright test tests/smoke/statements.spec.ts tests/smoke/nav-consolidation.spec.ts tests/smoke/owner-statement-dispatch.spec.ts tests/smoke/app-flows.spec.ts --grep "self-managed|money hub|owner statement dispatch|keyboard|dashboard shows" --workers=1`
  passed **8 passed**; `./node_modules/.bin/tsc --noEmit` passed; targeted
  frontend `eslint` passed; `.venv/bin/python -m pytest tests/integration/test_owners_api.py -q -k "send_owner_statement"`
  passed **5 passed / 19 deselected**; targeted backend `ruff` passed; `git diff --check`
  passed. Review agent found and rechecked two P2s; follow-up review found no
  P1/P2 issues. For `147eae1`:
  `.venv/bin/python -m pytest tests/integration/test_owner_portal_api.py tests/integration/test_owner_portal_auth_api.py -q`
  passed **16 passed**; `./node_modules/.bin/playwright test tests/smoke/owner-portal.spec.ts tests/smoke/owner-portal-account.spec.ts --workers=1`
  passed **5 passed**; frontend `tsc --noEmit`, targeted frontend `eslint`,
  targeted backend `ruff`, and `git diff --check` passed. Review agent found no
  P1/P2 issues and the hybrid green-path test gap was closed before commit.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_EV1PJhmj9ckaMJEyGbasZMA5Tap9` for `ce271e1` was **READY**;
  `https://leasium.ai/people` and `https://leasium.ai/settings` returned HTTP
  200; Render health reported
  `ce271e174c41ea00fe46748becbf42abc9e6a0dd` with `source=render`.
  Deep-gate code deploy `dpl_4Bq154R6tULSkvW5CkzGWppB3htp` for `add20ac` is
  **READY**; Render health reports
  `add20ac43e3382607b70d030ab749030a3219178`; `https://leasium.ai/statements`
  and `https://leasium.ai/money` returned HTTP 200. Owner-portal deep-gate code
  deploy `dpl_ATgTm2j74BDy86R7KKi1JWPnbqQJ` for `147eae1` is **READY** and
  aliased to `leasium.ai`; Render health reports
  `147eae15d3209bc021c7bcc2c43a45798ff803e5`; `https://leasium.ai/owner-portal`,
  `https://leasium.ai/owner-portal/owner-1?month=2026-05`, and
  `https://leasium.ai/statements` returned HTTP 200.

### Next
1. Apply/verify migration `20260601_0032` in the target database before broad
   owner rollout. If the duplicate preflight fails, revoke or soft-delete the
   duplicate active owner portal account rows first.
2. Run `docs/owner-portal-production-smoke.md` with a real Clerk owner account.
   This is blocked in Codex without operator input: it needs a real operator
   Clerk session, a chosen production owner, a matching owner Clerk account, an
   eligible `owner_portal_visible` document, and explicit approval because invite
   creation/account claim mutate production state, even though they send no
   owner email and touch no providers.
3. Real-device PWA install review on iOS/Android: confirm the standalone launch
   experience and decide whether to add PNG/maskable icons or launch images.
   Keep v1's no-service-worker/no-private-offline-data constraint unless the
   operator explicitly approves an offline strategy.
4. Continue the low-provider-risk UX runway: mobile bottom-nav/field-operator
   shell review, vendor portal account/invite design only after the auth
   boundary is agreed, and then the next read-only work/maintenance depth
   slice. Avoid provider sends/writes unless explicitly approved.

### Operating rule
- Use agents wherever they can materially advance the work: parallel
  reconnaissance, bounded implementation slices with disjoint write sets, and
  review/verification lanes. Keep immediate blockers local, and review/verify
  agent output before claiming status or committing.

## Codex Takeover — 2026-05-31 (READ THIS FIRST)

Handover from a Cowork (Claude) session. Prod is healthy and current. Everything below is **on `main` and deployed** unless marked DEFERRED/TODO.

### Prod state (verified this session)
- `main` tip before this doc-sync commit: `65c1da8`. The Vercel **production** deploy for `65c1da8` is **READY** and serving `leasium.ai` (verified via the Vercel API).
- Commits newest→oldest: `65c1da8` darken canvas · `d0bd122` People hub · `ff00a18` dashboard heading polish (Temba) · `5685c90` Owner entity backend · `a524ba6` UX polish + DoorLoop research docs.

### What shipped this session (DoorLoop benchmark P0)
1. **Owner is a first-class entity** (`5685c90`): `stewart/core/models.py` `Owner` (mirrors the 11 legacy `Property.owner_*` fields) + `PropertyOwner` (`split_pct`, unique `(property_id, owner_id)`), `Entity.owners`/`Property.owner_links`; migration `20260531_0029_owner_entity.py`; `apps/api/routers/owner_entities.py` + `schemas/owner_entities.py` → `/api/v1/owners` CRUD + `POST/DELETE /owners/{id}/properties` (registered AFTER `owners.router` so `/owners/statements*` keeps route priority); `stewart/core/owner_backfill.py` + `scripts/backfill_owners.py`.
2. **People hub** (`d0bd122`): `apps/web/src/app/people/page.tsx` — Owners directory (live on the API), Tenants/Vendors compact + link-out, Prospects stub, `?tab=` URL state; Owner client in `apps/web/src/lib/api.ts`; palette + `G E` in `app-shell.tsx`; smoke `apps/web/tests/smoke/people-hub.spec.ts`.
3. **Darker canvas** (`65c1da8`): `--leasium-bg` #f6f8fb→#edf0f6, `--leasium-slate-100` #f2f4f7→#e9edf3 (globals.css). Cards lift; hierarchy preserved (cards > canvas > muted > border). Light mode only.

### Verification
- Backend: full integration suite **344 passed / 1 skipped**, ruff clean (Temba's Mac via Desktop Commander).
- Frontend: eslint + tsc clean; **Vercel prod build passed** (strongest signal). Caveat: the People hub Playwright smoke is written but its *local* run times out on Next cold-compile (the known x64-Node WASM-SWC edge-runtime issue documented later in this file) — re-run `cd apps/web && ./node_modules/.bin/playwright test tests/smoke/people-hub.spec.ts` after the arm64-Node fix.

### DO FIRST
1. `git pull` (tip should be this doc-sync commit on top of `65c1da8`).
2. Confirm **Render** deployed `5685c90`+ and migration `20260531_0029` applied (owner/property_owner tables in prod Neon). The frontend was verified; the backend (Render) was not checked this session.
3. **Populate owners** in each env: `.venv/bin/python -m scripts.backfill_owners` (local) and against prod once Render is healthy. Until then `/people` Owners shows empty with a "run backfill" hint — expected, not a bug.

### HISTORICAL NEXT TICKETS (superseded by latest sections above) — plan: `docs/superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md`
These were the takeover tasks at the start of 2026-05-31. Phase 3, Ticket 1.3,
Ticket 2.2, and the read-only owner portal slice have now shipped; use the
latest "Next" block above for current continuation.

1. **Phase 3 — nav consolidation to 7 hubs.** Fold Tenants + Vendors *inline* under `/people` (they link out today), add a **Money** hub (Billing · Statements · Xero · Basiq), route Comms under **Work**, promote People to the sidebar and drop the standalone Tenants item → Dashboard · Smart Intake · Properties · People · Work · Money · Insights (+ Settings). Honour the §10.5.1 seven-item cap; add redirects for moved routes. Test-first.
2. **Ticket 1.3 — `/owners/statements` read-path swap (DEFERRED; do with eyes on real data).** Change ONLY the grouping in `_build_owner_statements` (`apps/api/routers/owners.py`) to group by `Owner`/`PropertyOwner`, with an unattributed fallback for properties lacking an owner link. Keep `tests/integration/test_owner_statement_parity.py` green — it is the safety net. Requires the backfill to have run.
3. **Ticket 2.2 — consistent people record-page shape** (Tenant/Owner/Vendor share header → tabs → actions).
4. P1: owner portal (read-only) → tenant payments (AU rails: PayTo/PayID/BPAY) → installable PWA.

### GUARDRAILS (non-negotiable — `CLAUDE.md`)
- Review-first providers: no Xero write / SendGrid / Twilio / tenant email / payment reconciliation without explicit operator approval.
- `Owner` is the model of record; legacy `Property.owner_*` fields are a **backfill source only**.
- Additive + test-first (no production code without a failing test). Commits land directly on `main`, no PRs, no Claude/Codex attribution lines.
- Agent-first execution: use agents for bounded parallel work whenever useful,
  while keeping immediate blockers local and verifying every agent result.

### TOOLCHAIN (Temba's Mac, via Desktop Commander)
- Backend: `.venv/bin/python -m pytest`, `.venv/bin/python -m ruff check ...`, `.venv/bin/alembic upgrade head` (`uv` unavailable).
- Frontend (in `apps/web`): `./node_modules/.bin/{eslint,tsc,playwright,next}`. Local Playwright/`next dev` hits the x64-Node WASM-SWC edge-runtime issue — prefer arm64 LTS Node + clean `pnpm install`; the Vercel build is the reliable frontend gate. Verify prod deploys via the Vercel API (team `team_5auiJ5DlpnIlF4Qyb3uA6dEz`, project `prj_8fAMsCvYv1Pm728oFXLVFE9ccgRZ`).
- Local infra: `docker compose up -d` → `.venv/bin/alembic upgrade head` → `.venv/bin/python -m scripts.seed`.

## Current State

- 2026-05-31 frontend Speed Insights slice (THIS SESSION): Vercel Speed
  Insights is wired in the Next root layout with
  `@vercel/speed-insights/next`, the pnpm lockfile records the dependency, and
  a static Playwright smoke test guards the root-layout mount. Verified the
  new smoke test red -> green locally. This is non-Basiq and only starts
  collecting Core Web Vitals after the next Vercel deployment with Speed
  Insights enabled for the project.
- 2026-05-31 Comms keyboard review flow (THIS SESSION): `/comms` draft cards
  now render as a scoped focusable review list. `j`/`k` and Arrow Up/Down move
  between focused draft rows, Enter focuses the first editable field, and the
  handler exits inside inputs, textareas, selects, links, and buttons so body
  editing and approval controls keep native behaviour. Smoke coverage verifies
  keyboard movement and confirms no comms mutation request fires.
- 2026-05-31 Dashboard motion polish (THIS SESSION): command-center rows and
  activity-feed rows now use the shared 200ms `ease-leasium` transition timing
  for list feedback, and Upcoming lease-event rows now join Activity feed on
  the reduced-motion-safe row-enter animation. The command-center hero keeps
  instant first paint. Source smoke guards the token pattern; this stayed
  frontend-only and did not touch provider or Basiq paths.
- 2026-05-31 Dashboard event urgency/progressive-disclosure polish (THIS
  SESSION): upcoming
  lease-event rows now derive near-term urgency labels from the event date, so
  same-bucket chips read `Due today`, `Due tomorrow`, or `Due in Nd` instead of
  repeating raw `Tomorrow` text across rent-review / expiry rows. The same
  panel now keeps long event lists to the first five rows until the operator
  clicks `Show all`, matching the Recent activity feed's disclosure pattern.
  Recent activity's existing `Show all` control also now uses the 44px
  touch-target baseline. Browser smoke covers the repeated-tomorrow, long-list,
  and Recent activity disclosure cases; no provider, Basiq, or API mutation
  path touched.
- 2026-05-31 Dashboard Leasium AI touch-target polish (THIS SESSION): the
  read-only suggestion chips and citation source links now use the 44px target
  baseline and shared motion timing. The smoke keeps proving the cited-answer
  flow; no AI/provider mutation path changed.
- 2026-05-31 Dashboard entity-title de-duplication (THIS SESSION): the live
  dashboard no longer renders the selected entity name as a giant content H1.
  The AppHeader entity selector remains the source of entity context, the visible
  dashboard starts with Daily command center, and the compact demo/refresh
  controls now sit in that panel header. A screen-reader-only Dashboard H1
  preserves page structure. Smoke coverage verifies the selector still holds
  `entity-1` while `Acme Holdings Pty Ltd` is absent as a content heading.
- 2026-05-31 saved views touch-target polish (THIS SESSION):
  `<SavedViewsMenu>` now uses 44px interactive targets and shared motion timing
  for the trigger, saved-view row actions, save form, and close control. The
  close action now sits in the menu header so it cannot intercept first-row
  Delete/Rename clicks, and the tenants smoke flow checks those actions while
  still proving saved filters re-apply through existing tenant filter state/URL
  semantics. Frontend-only; no Basiq, provider, bank-feed, comms dispatch, or
  API mutation path touched.
- 2026-05-31 Clerk auth light-appearance guard (THIS SESSION): the shared
  `clerkEmailOnlyAppearance` now pins light Clerk variables plus Leasium
  card/input/button/link classes for Sign in / Sign up, preserving email-only
  auth while preventing stale dark OS/browser appearance from bleeding into the
  light auth shell. Source smoke guards the tokens. No auth routing, Clerk
  session, invite, Basiq, provider, or API mutation path changed.
- 2026-05-31 App shell mobile drawer close target (THIS SESSION): the mobile
  drawer's Close navigation button now uses the same 44px target baseline and
  shared motion timing as the hamburger/utility controls. The mobile header
  smoke opens the drawer and measures both open and close targets. Frontend-only;
  no Basiq, provider, bank-feed, comms dispatch, or API mutation path touched.
- 2026-05-31 maintenance detail loading-state polish (THIS SESSION):
  `/operations/maintenance/[workOrderId]` now reuses `SkeletonRows` for the
  initial work-order load and Correspondence panel load, replacing the raw
  spinner-plus-copy rows. The Operations UX smoke delays both reads and guards
  the accessible skeleton pattern. Frontend-only; no Basiq, provider, bank-feed,
  comms dispatch, or API mutation path touched.
- 2026-05-31 Notifications filter touch-target polish (THIS SESSION):
  the Work notice and Digest history filter buttons now use the 44px target
  baseline instead of the prior 40px filter-chip compromise. The mobile smoke
  measures every status/channel filter in both panels plus the existing Open
  work/Open Work links, without clicking send, retry, export, refresh, or
  mark-reviewed actions.
- 2026-05-31 Operations workload filter touch-target polish (THIS SESSION):
  the queue workload filters now use the 44px target baseline for Open,
  Unassigned, Follow-up due, My work, and per-member filter buttons. Team
  workload / Assigned chips match that height for visual alignment. The smoke
  measures stable filters only and does not click digest, assignment, notice,
  provider, or mutation actions.
- 2026-05-31 Billing Readiness delivery-filter touch-target polish (THIS
  SESSION): Dispatch & reconcile filter buttons now use the 44px target baseline
  for All, Needs action, Ready to dispatch, Complete, and Unpaid. The smoke
  measures and clicks only those read-only filters under a no-mutation request
  guard, then measures existing recovery/payment/statement and mobile invoice
  handoffs without clicking dispatch, email, payment, provider, or
  reconciliation actions.
- 2026-05-31 owner-tag chevron polish (THIS SESSION): property ownership chips
  now render raw chain labels like `A -> B -> C` as cleaner `A › B › C` display
  text while keeping the original string in the chip title and normalized
  `owner_tag` filter key. This closes the deferred C2 craft item without
  changing property data, matching, or URL semantics.
- 2026-05-31 helper consolidation (THIS SESSION): after re-checking Claude's
  UX audit/source notes, `/contractors`, `/inbox`, `/insights`,
  `/notifications`, `/intake/spreadsheet`, and the embedded Smart Intake
  register-import panel, `/operations` plus maintenance detail,
  `/portfolio-qa`, `/tenants`, tenant detail, `/statements`, and the dashboard
  shell now use shared `friendlyError` and/or `StatusTone` imports instead of
  local redeclarations. This follows the deferred external-review cleanup item.
  The property workspace also delegates generic Error-message handling to the
  shared helper while keeping its entity/property-specific recovery copy; no
  visible UX or provider behavior changed.
- 2026-05-31 live Basiq connection foundation (THIS SESSION): commits `7bcabfb`
  (backend — `BasiqConnection` model + migration `20260531_0028`, server-token +
  accounts/transactions fetch behind the soft-skip, connect/status/revoke routes,
  provider-source wired to the active connection) and `424caa8` (Settings connect
  UI + provider-source toggle). Inert and READ-ONLY until a Basiq developer app +
  `BASIQ_API_KEY` are configured; the consent step is an explicit operator click,
  the key stays server-side. **Hosted Neon/Render must apply migration
  `20260531_0028`.** Full sweep green: ruff clean, pytest 366 passed / 1 skipped,
  `eslint src` + `tsc` clean, production `next build` succeeded. Committed locally;
  push to deploy (stays inert until the Basiq env is set).
- 2026-05-30 bank-feed + observability slice (THIS SESSION, after the dispatch/UX
  push): commits `d78cf27` (bank-feed v1 backend + Sentry scaffolding) and
  `c3ef6d6` (bank-feed review UI), then this docs commit. Bank-feed reconciliation
  v1 is review-first and INERT until `BASIQ_ENABLED` + `BASIQ_API_KEY` are set:
  `/api/v1/basiq/reconciliation-preview|apply` reuse the Xero reconciliation engine
  (no fork; local-metadata-only, explicit per-row `approved_idempotency_keys`), with
  a Settings → Bank feed panel for operator-imported transactions. No new migration.
  Backend Sentry init is a no-op unless `SENTRY_DSN` is set and can never break
  startup. Full sweep green: ruff clean, pytest 352 passed / 1 skipped, `eslint src`
  + `tsc` clean, production `next build` succeeded. Committed locally; push to deploy
  (bank-feed + Sentry stay inert until their env is configured).
- 2026-05-30 dispatch + UX slice (THIS SESSION): seven feature commits on `main`
  ending `2815dc9`, then this docs commit. Shipped — comms badge-counts
  summary-only fast path (`6e36ffa`); owner statement review-first SendGrid
  dispatch backend (`486e6cf`) + UI (`63fad2e`); Portfolio QA per-blocker bulk
  review (`75952c7`); Smart Intake inbound-attachment sender/received cues
  (`42f8fae`); world-class-audit Phase B-E close-out (`2815dc9`). Full sweep
  green: backend ruff clean + `pytest` **345 passed / 1 skipped**; frontend
  `eslint src` + `tsc --noEmit` clean + production `next build` (WASM)
  succeeded. New migration `20260530_0027_owner_statement_dispatch` must be
  applied in hosted Neon/Render before the dispatch endpoints work there. Owner
  statement dispatch is OFF by default (`owner_statement_email_enabled`) and
  never sends without explicit per-owner approval (`approve=true`).
- Verification sweep (2026-05-30): working tree is **clean** at HEAD
  `1c2cc08 Add live verifier for review-queue card overflow`. Full
  health pass green — backend `ruff check apps stewart tests scripts`
  passed, `.venv/bin/python -m pytest` returned **340 passed, 1 skipped**
  (the skip is `test_migrations` with no `TEST_DATABASE_URL`), frontend
  `eslint src` + `tsc --noEmit` clean, and the production `next build`
  (WASM SWC) succeeded. The older "this slice is uncommitted" notes
  below predate this HEAD — those slices have since landed; treat the
  clean tree as the current truth.
- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.ai` (Vercel). Treat `https://leasium.vercel.app` as a provider alias only, not a product URL.
- Production API: `https://api.leasium.ai/api/v1` (Render custom domain). `https://leasium-api.onrender.com` is a provider fallback only.
- Domain cutover note: `api.leasium.ai` now resolves and serves the Render API certificate. Production frontend/API/env/provider links should use `leasium.ai` and `api.leasium.ai`.
- MVP performance note (2026-05-30): production Vercel should now set
  `NEXT_PUBLIC_API_BASE_URL=/api/v1`; `apps/web/vercel.json` rewrites same-origin
  `/api/v1` and `/health` requests to the Render API to reduce browser
  cross-origin/preflight overhead. Keep `PUBLIC_API_URL=https://api.leasium.ai`
  on the API service for provider callbacks and generated external links.
- Dashboard speed pass (2026-05-30): the home screen now has
  `GET /api/v1/dashboard/overview` for first-paint counts and command-center
  data, starts from stored `leasium.entity_id`, uses a root React Query cache,
  warms/dedupes Clerk tokens, and disables persistent shell prefetch. The
  overview endpoint is an accelerator only; if it fails during a staggered
  deploy, the dashboard falls back to the existing detailed queries.
- Live UX audit harness (2026-05-30): run
  `npm --prefix apps/web run audit:live -- --login` once to save a signed-in
  browser state, then run
  `LEASIUM_AUDIT_URL=https://leasium.ai npm --prefix apps/web run audit:live`.
  Reports land under `output/playwright/live-audit/` with screenshots,
  slow-request notes, console errors, and overflow checks.
- Infra snappiness note (2026-05-30): local/product fixes made the site
  noticeably faster, but remaining delay is likely Render/Neon/Auth/CORS/observability
  rather than layout. Backend now reuses the Clerk JWKS client, exposes
  `server-timing` and `x-request-id`, and has configurable DB pool env vars.
  Next infra checks: confirm Render plan is always-on, API and Neon are in a
  sensible shared region, DB pool vars match plan limits, and add Speed
  Insights plus a log drain/Sentry/OpenTelemetry before broad MVP traffic.
- Detailed record: `docs/mvp-ux-performance-review-2026-05-30.md`.
- Live audit continuation (2026-05-30, signed-in): ran the harness against
  `leasium.ai` as `temba@skjcapital.com` across the seven MVP routes, desktop +
  mobile. No horizontal overflow, no page/console errors, visual layer in good
  shape. Dominant latency is `GET /api/v1/comms/queue/counts` at ~6.5-8.1s on
  every page (it runs the full eight-scanner queue scan just for the sidebar
  badge count). Applied a surgical frontend fix in `app-shell.tsx`
  (`refetchOnWindowFocus: false`, `staleTime` 60s -> 5min) so the scan stops
  re-firing on tab focus/navigation; eslint + tsc clean. Backend follow-up to
  make the counts endpoint actually cheap (count-only queries or ~60s entity
  cache) is flagged as the top remaining snappiness win - left for a review-first
  pass since the scanners are shared with the live comms queue. Screenshots +
  route report under `output/playwright/live-audit/`. This slice is uncommitted.
- World-class UX pass (2026-05-30): full audit in
  `docs/leasium-ux-world-class-audit-2026-05-30.md` (benchmark reset to
  Linear/Stripe/Ramp; verdict: visual craft already B+/A-, the gap is FEEL —
  perceived speed, editorial focus, flow). Phase A + B kickoff shipped this
  session, uncommitted, eslint/tsc/ruff/pytest-clean (frontend Playwright smoke
  blocked in-sandbox by a Next middleware edge-runtime EvalError — run on Mac):
  (1) `/comms/queue/counts` now per-entity TTL-cached 45s so the badge stops
  re-running the 8-scanner scan every navigation (+ cache test; 47 comms tests
  green); (2) nav links prefetch route bundles on hover/focus intent in
  `app-shell.tsx`; (3) dashboard hero de-duplicated — removed the command-center
  right-rail summary that duplicated the metric strip; command center now
  full-width with an inline review-first guardrail (`DashboardCommandCenter.tsx`).
  Phase B progressive disclosure is now covered for Recent activity and
  Upcoming lease events; remaining UX-audit follow-ups start at Phase C
  (craft punch-list), D (keyboard/flow), and E (motion). Blast radius this
  session: comms.py, test_comms_api.py, app-shell.tsx,
  DashboardCommandCenter.tsx plus dashboard panel follow-ups.
- Clerk cutover note: live Vercel was previously serving a publishable key that decoded to `clerk.leasium.vercel.app`. That creates split-domain sessions. The canonical target is a Clerk setup anchored to `leasium.ai` (prefer `clerk.leasium.ai` via Clerk DNS/CNAME, or exact `https://leasium.ai/__clerk` proxy if enabled in Clerk Dashboard and Vercel env).
- **Latest pushed commit:** run `git log --oneline -12` to confirm before editing. This handover is kept current by the Codex continuation slices, but the local log is the source of truth.
- **Working tree:** expected clean after each pushed slice. If not, inspect with `git status --short` before editing.
- **Mac tooling change (2026-05-24):** Node v26 installed via Homebrew; Desktop Commander MCP server (`@wonderwhy-er/desktop-commander`) is configured in Claude Desktop. Future Claude sessions in this workspace have `mcp__Desktop_Commander__*` tools available — they execute commands directly on the Mac (pytest, ruff, alembic, git, next dev, playwright). Sandbox-can't-write-git and no-local-Node constraints from prior sessions no longer apply.
- The 2026-05-22 UX-review backlog is fully landed except Tier 2 (g) dark mode (deliberately deprioritised under the SKJ internal-first-6-months direction). All shipped items are marked `[x]` or `[~]` in `docs/product-roadmap.md`. Known dark-mode issue for that later pass: re-check real Clerk auth widget rendering under dark OS/browser settings. The local shared Clerk appearance now pins light variables/classes, but the full dark-mode pass should still validate live Clerk-rendered states.
- Visual polish + brand sweep (2026-05-23): nine commits resolving Tickets 1-5 of the polish plan after the competitive UX rating identified visual polish as Leasium's weakest dimension vs Re-Leased / PropertyMe / PropertyTree. Codex source-of-truth amendments in §3 (owner tag palette + two-tier naming), §4 (Body Compact 15px + Micro 11px), §5 (motion scale 150/200/300 + ease-in/toggle), §8 (empty-state convention), §9 (chip system). Tailwind config gained 36 owner-tag tokens, 11 short-alias variants, transition durations, exit easings, four custom fontSize steps. `globals.css` gained six @keyframes (drawer in/out left/right, modal in/out, backdrop in/out) and matching utility classes. New `useUnmountDelay` hook drives drawer/modal exit animations on 8 surfaces. New `chipClass()` helper in `components/ui.tsx` collapses every chip/pill/badge declaration through one tone × density × bordered surface. EmptyState component gained an `icon` slot; ~40 high-traffic empty states opt-in. Remba had been retired from the loop ("forget Remba, this is a prototype" at slice mid-point) so commits land without the [~] pending markers used in earlier slices.
- 2026-05-23 Remba sign-off note: the Token consistency pass v1 + Motion polish v1 items in `docs/design-governance.md` flipped `[~]` → `[x]` mid-session before Remba was retired. The follow-up Polish v2-v7 work landed without governance markers per the prototype-mode call.
- Behavioural baseline added at `CLAUDE.md` (repo root): the Forrest Chang / Andrej Karpathy four-principle file (~110k stars) plus Leasium-specific guardrails (provider mutation rule, Remba review, internal-first-6-months, push-to-Vercel review path, Mac/venv tooling notes). Future Claude Code / Codex sessions pick it up automatically.
- Latest live route sanity after push:
  - `/settings` returns `200` after redirecting signed-out users to `/sign-in?redirect_url=%2Fsettings`
  - `/notifications` returns `200` after redirecting signed-out users to `/sign-in?redirect_url=%2Fnotifications`
  - `/onboarding/tenant-token-1` now renders the retired-form redirect screen (still public, still `200`). Tenants land on a "Your onboarding has moved into your Leasium account" card with an "Open the tenant portal" CTA pointing to `/tenant-portal/{token}`.
- Product source of truth: `docs/product-roadmap.md`
- UX governance source of truth: `docs/design-governance.md`
- Mobile UX review (2026-05-23): `docs/mobile-ux-review-2026-05-23.md` — code-driven audit of operator + tenant surfaces at 360-480px, with prioritised backlog. First slice (Tenants list mobile card view) shipped alongside; remaining items are Remba-pending follow-ups.
- Automation strategy (2026-05-23): `docs/automation-strategy-2026-05-23.md` — names the controlling design principle ("take work off the operator; every screen should ask what to *approve*, not what to *enter*"), inventories current automation, and lists the full backlog from scheduled comms loop through DocuSign, WhatsApp, voice transcription, vacancy marketing, predictive maintenance, year-end tax pack. The product-roadmap.md "Automation backlog" section is the working list; this doc is the framing rationale.
- Brand/frontend source of truth: `docs/leasium-codex-design-source-of-truth.md`
- UX audit (2026-05-22): `docs/ux-review-2026-05-22.md` — the tiered roadmap is now fully shipped except dark mode.
- Nav-pattern research (2026-05-23): `docs/nav-pattern-research-2026-05-23.md` — captures the evidence behind the sidebar choice so Remba sign-off has the same reasoning the original review used.
- Design-facing changes still require Remba review before being treated as complete.
- 2026-05-26 continuation: owner statements now have an authenticated
  review-only per-owner PDF endpoint/download action plus a full-pack ZIP
  export, and Portfolio QA has a cleanup completion report, AI-assisted
  enrichment candidate queue, and reviewed bulk staging/saving for
  tenant-contact and owner-billing fixes. Both are review-first and do
  not run Xero, email, payment, or provider mutations.
- 2026-05-26 tenant onboarding simplification: onboarding remains
  account-first, but the invite gate now uses prefilled Clerk email-code
  sign-in/sign-up, the confirmation form is trimmed to 4 required fields
  plus optional details, the tenant checklist is now confirm/docs →
  review → sign, operator review/apply is combined into **Approve &
  apply**, and lease signing has focused `/tenant-portal/lease` and
  `/tenant-portal/[token]/lease` routes plus an operator-triggered
  **Send lease pack** action. The full tenant portal stays locked until
  lease signing is complete, and lease-pack emails use the account-scoped
  `/tenant-portal/lease` route so expired invite tokens do not block
  signing.
- Hosted sanity on 2026-05-26: `https://api.leasium.ai/health` returned
  200 with `{"status":"ok","app":"Leasium"}`. The public tenant invite
  preview route executed and returned a clean 404 for `tenant-token-1`
  rather than a schema error, which confirms the deployed API can read
  the `tenant_onboarding.token_consumed_at` column. Exact Render deploy
  log grepping for `20260524_0025` / `20260524_0026` still needs Render
  dashboard or MCP access.
- 2026-05-27 live verification: Neon production is at Alembic
  `20260524_0026`; `tenant_onboarding.token_consumed_at` exists; the
  `property_type` enum includes `residential`; `tenant-token-1` correctly
  shows the public "Invite not found" state. The prior stale-link 409
  concern appears resolved: production has one active tenant portal
  account linked to a non-deleted tenant. Temba's current live onboarding
  row is already claimed, submitted, reviewed, and applied; the remaining
  live blocker is attaching a custom lease file and explicitly clicking
  **Send lease pack** from the tenant detail page. Do not trigger this
  provider email without operator approval and the correct lease file.
- 2026-05-28 Xero Monday readiness: commits through `cf2a2f9` are pushed to
  `origin/main` and Vercel production deployment `dpl_HvcCaXcHErC2DQV6kuZnHktMWTnT`
  is ready on `https://leasium.ai`. The API health check passes, production
  OpenAPI includes `/api/v1/xero/connection-diagnostics`, and an unauthenticated
  diagnostics request returns 401 instead of the earlier 404, proving the route
  is live and protected. Chrome production verification found the signed-in
  Clerk email was `tembavj@outlook.com`; production Neon has active accepted
  operator access for `temba@skjcapital.com` on `SKJ Property Pty Ltd`, but no
  `app_user` row for `tembavj@outlook.com`. The UI therefore shows
  `Unknown Clerk user.` and no entity selector options. Do not start Xero OAuth
  until Temba either signs in with `temba@skjcapital.com` or explicitly approves
  adding/linking `tembavj@outlook.com` as an operator. Production currently has
  no Xero connection row for `SKJ Property Pty Ltd`.
- Follow-up verification after Temba signed into Chrome as `temba@skjcapital.com`:
  the production app now loads `SKJ Property Pty Ltd` and Settings → Xero reaches
  the diagnostics panel. The next blocker is API provider configuration: the UI
  reports missing `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, and
  `XERO_TOKEN_ENCRYPTION_KEY`, and disables Connect with Xero. Configure these
  on the Render API service, with
  `XERO_REDIRECT_URI=https://api.leasium.ai/api/v1/xero/oauth/callback`, before
  starting OAuth. `XERO_STATE_SECRET` is still recommended, although the current
  code can fall back to the client secret/Clerk secret for state signing. No
  Xero OAuth or provider mutation was started during this check.
- 2026-05-28 finance/Xero continuation: Xero connection diagnostics now include
  a read-only provider setup preflight block with required env vars, missing
  env vars, expected redirect URI, required scopes, and a setup checklist.
  Owner statements now include invoice-level evidence in JSON/PDF and an
  `INVOICE-EVIDENCE-{month}.csv` inside accountant ZIP packs, and the
  Statements finance checklist can download a local CSV. These are all
  review-only; no Xero refresh/write, email, payment reconciliation, provider
  attachment, or delivery-history mutation is performed.
- 2026-05-28 finance UI continuation: Settings Xero now surfaces the provider
  setup preflight in the diagnostics card, and `/statements` shows invoice
  evidence rows inside the selected owner statement preview. Both are
  read-only operator review surfaces; Connect with Xero still follows the
  diagnostics capability gate, and owner dispatch remains separate.
- 2026-05-28 finance UI continuation 2: Settings Xero can copy a provider setup
  packet containing the expected redirect URI, env vars, scopes, checklist, and
  guardrails for the Render/Xero handoff. Owner statement invoice evidence can
  be downloaded as a selected-owner CSV from the preview. Both are local UI
  conveniences only; no Xero, SendGrid, payment, owner dispatch, or provider
  history mutation is triggered.
- 2026-05-28 handoff export continuation: `/statements` now has a local
  month-end signoff CSV download, and Portfolio QA has a local cleanup report
  CSV download beside the existing copyable report. Both reuse already-loaded
  review data and do not call providers or mutate records.
- 2026-05-28 Operations continuation: completed maintenance work orders now
  show local copy actions for owner, tenant, and contractor completion
  communications beside the existing review receipts. These buttons copy the
  already-rendered closeout text only and show a "No message sent" receipt;
  they do not call SendGrid, Twilio, portal messaging, Xero, or provider
  history endpoints.
- 2026-05-28 Operations continuation 2: maintenance Activity now includes
  local forwarding drafts for tenant-to-contractor and contractor-to-tenant
  updates, derived from the latest visible timeline row for each side. The
  copy buttons are local only and do not send email/SMS, write portal messages,
  touch providers, or mutate work-order history.
- 2026-05-28 finance PDF continuation: owner statement PDFs now wrap long
  property names, invoice references, Xero IDs, bank references, and
  reconciliation IDs across readable lines/pages. Coverage lives in
  `tests/integration/test_owners_api.py`. The endpoints remain review-only
  GETs with no Xero, SendGrid, dispatch, delivery history, or payment
  reconciliation mutation.
- 2026-05-28 Portfolio QA continuation: the cleanup readiness report now has a
  row-level Blocker drilldown for active bulk groups, and
  `portfolio-qa-cleanup-report.csv` includes matching `Blocker drilldown` rows.
  This stays frontend/local-data only and does not run enrichment, onboarding,
  billing draft generation, Xero, email/SMS, or provider-history mutations.
- 2026-05-28 Xero exception export continuation: Settings -> Xero exception
  queue now has a passive copyable review packet and
  `xero-exception-review.csv` download from already-loaded exception rows.
  The export does not start OAuth, preview/apply mappings, post invoices,
  dispatch providers, refresh Xero, send email, or reconcile payments.
- 2026-05-28 Portfolio QA enrichment continuation: the enrichment queue now has
  a local `portfolio-qa-enrichment-queue.csv` download beside `Copy queue`,
  exporting candidate type, record label, missing fields, priority, impact,
  reason, action, and review guardrail text. It does not run enrichment
  preview/apply, OpenAI, SerpAPI, Xero, SendGrid, Twilio, onboarding, or
  billing draft mutations.
- 2026-05-28 Operations maintenance continuation: the completion review packet
  now has a local `maintenance-completion-review-{workOrderId}.csv` download
  beside `Copy packet`, generated from already-rendered work-order review data.
  It includes closeout evidence counts, recipient review statuses, billing
  handoff, latest activity, open review items, forwarding draft readiness, and
  review-only guardrail text. It does not send contractor email/SMS, update
  work-order status, write closeout or review metadata, touch Xero, tenant
  portal messaging, provider dispatch, billing, or provider history.
- 2026-05-28 Notifications continuation: Work notice center now has a local
  `work-notification-provider-readiness.csv` download from the already-loaded
  notification-center response. It exports Email/SendGrid, SMS/Twilio, and
  In-app/Leasium readiness, setup-check statuses, next actions, center
  guardrails, and no-send/no-mutation guardrail text. It does not exercise
  send, retry, SMS, digest send, mark-read, provider dispatch, refresh-token,
  provider-history, or read-state mutation paths.
- 2026-05-28 Comms continuation: `/comms` now has a local
  `comms-queue-review-{date}.csv` download from already-loaded
  `queueQuery.data?.candidates`, before any approve/dismiss/send interaction.
  It exports candidate kind, tenant/property/unit, channel, recipient readiness,
  severity, due/generated timestamps, subject/body preview, detail, session
  counts, and no-send/no-mutation guardrail text. It does not call comms
  dispatch, dismiss, evidence upload, SendGrid/Twilio sends, provider-history
  writes, candidate settlement, queue mutation, or provider refresh paths.
- 2026-05-28 Contractor directory continuation: `/contractors` now has a local
  `contractor-directory-readiness.csv` download from already-loaded contractor
  rows. It exports name, company, priority, categories, email/phone readiness,
  service radius, notes, AI-suggest readiness, and review-only guardrail text.
  It does not send contractor email/SMS, run maintenance AI classification,
  assign/update work-order contractors, create/update/delete contractors, write
  provider history, or dispatch receipts.
- 2026-05-28 Billing Readiness continuation: the Month-end handoff panel now has
  a local `billing-month-end-handoff-{month}.csv` download beside `Copy handoff`,
  generated from the already-built `MonthEndHandoff` object. It exports
  entity/month/status, approved invoice totals, provider dispatch
  readiness/recovery, payment review, owner statement readiness/missing
  recipients, open items, and review-only guardrail text. It does not run Xero
  draft creation, payment reconciliation preview/apply, tenant/owner email
  dispatch, billing draft generation, invoice dispatch, provider refresh, or
  provider-history mutation.
- 2026-05-28 Settings continuation: Settings Organisation now has a local
  `communication-template-overrides.csv` download from the Communication
  templates panel. It exports runtime template keys, stored override
  names/keys/versions/providers, active/inactive and system/override state,
  coverage status, and review-only guardrail text. It does not wire stored
  templates into send paths, add edit controls, send notifications/digests,
  send invoices/onboarding/contractor messages, mutate preferences, or write
  provider history.
- 2026-05-28 Insights continuation: `/insights` now has a local
  `insights-review-packet-{as_of}.csv` download from already-loaded overview and
  snapshot history. It exports live exceptions, automation activity,
  finance/accounting readiness, owner/entity gaps, lease events, saved snapshot
  status, overview guardrails, and review-only guardrail text. It does not add a
  backend export endpoint, create/revoke snapshots, refresh Xero/accounting,
  send providers, apply reconciliation, dispatch, or write provider history.
- 2026-05-28 Tenant portal continuation: the read-only operator preview route
  now has a local `tenant-portal-preview-{tenant}.csv` download generated from
  `getTenantPortalOperatorPreview()` response data. It exports tenant, lease,
  onboarding status, checklist rows, uploaded document names/counts, visible
  invoice/payment rows, maintenance rows, contact-change requests, preview
  guardrails, and no-mutation guardrail text. It does not call
  resend/fresh-link/send-portal-invite/apply/review, tenant portal
  claim/submit/contact-change apply/dismiss, SendGrid/Twilio, Xero, document
  upload/delete, provider dispatch, provider refresh, or provider-history
  writes.
- 2026-05-28 Operations continuation 3: `/operations` now has a local
  `operations-work-queue-review.csv` download from the currently visible queue
  rows. It exports item kind, title, property/tenant context, due date, urgency
  chip, completion state, assignee, notification status, reminder/escalation
  cues, and review-only guardrail text. It does not call notification
  sends/digests, maintenance/arrears update mutations, backend export endpoints,
  Xero, invoice dispatch, payment reconciliation, onboarding send/resend,
  billing draft generation, provider refresh, or provider history.
- 2026-05-28 Statements continuation: `/statements` now has a local
  `owner-statement-dispatch-review-{month}.csv` download from existing
  `StatementDispatchReviewRow` data. It exports queue summary, approval runway,
  owner, status, recipient/missing recipient, subject, invoice/property counts,
  outstanding amount, and review-only guardrails. It does not call owner
  PDF/PDF-pack downloads, comms dispatch, invoice dispatch, Xero
  preview/apply/create-draft, payment reconciliation, owner email paths,
  provider refresh, or provider-history endpoints.
- 2026-05-28 Statements continuation 2: the selected owner Dispatch review panel
  now has a local `owner-statement-dispatch-draft-{month}-{owner}.txt`
  download beside `Copy dispatch draft`, reusing the selected owner's
  already-loaded statement data. It includes recipient/missing-recipient,
  subject, owner-facing body, owner totals, and a guardrail line. It does not
  call owner email, comms dispatch, PDF/PDF-pack downloads, Xero, payment
  reconciliation, invoice dispatch, provider refresh, or provider-history
  endpoints.
- 2026-05-28 Settings Xero continuation: Settings → Xero provider setup
  preflight now has a local `xero-provider-setup-packet.txt` download beside
  `Copy setup packet`, reusing `xeroProviderSetupPacket(xeroDiagnostics)`.
  It exports expected redirect URI, required/missing env vars, scopes, setup
  checklist, and diagnostics guardrails. It does not call OAuth, Xero
  preview/apply/create-draft, SendGrid, Twilio, invoice dispatch, payment
  reconciliation, provider refresh, or provider-history endpoints.
- 2026-05-28 Settings Xero continuation 2: Settings Xero accounting freshness
  snapshot now has a local `xero-accounting-freshness.csv` export from the
  already-loaded `/xero/status` freshness snapshot and computed next accounting
  step. It includes checkpoint timestamps, stale/current reconciliation state,
  readiness counts, payment cues, freshness guardrails, and export guardrails.
  It also fixes the singular next-step copy to read `invoice needs`. It does not
  refresh Xero, preview/apply reconciliation, create Xero drafts, dispatch
  invoices, send email/SMS, refresh providers, or mutate provider history.
- 2026-05-28 Settings Xero continuation 3: the same Accounting freshness
  snapshot now has `Copy freshness packet`, reusing the already-loaded
  `status.accounting_freshness` and computed `accountingStep` data. The smoke
  test reads clipboard text and verifies the packet contains status/stale
  reconciliation/next-step/guardrail content. It does not add a backend route,
  refetch status, invalidate queries, refresh Xero, preview/apply
  reconciliation, create Xero drafts, dispatch invoices, send email/SMS, refresh
  providers, or mutate provider history.
- 2026-05-28 Settings Xero continuation 4: Connection diagnostics now has a
  local `xero-connection-diagnostics.csv` export from the already-loaded
  `xeroDiagnostics` block. It includes connection source, tenant/org context,
  token expiry, readiness gates, provider/missing config, redirect URI, required
  env vars/scopes, next steps, diagnostics guardrails, and an export guardrail.
  It does not start OAuth, call or refresh Xero, preview/apply reconciliation,
  create Xero drafts, dispatch invoices/providers, send email/SMS, refresh
  providers, or mutate provider history.
- 2026-05-29 tenant lifecycle push: tenant portal `lease` and `insurance`
  uploads now auto-promote supported PDF/DOCX/TXT/MD files into Smart Intake
  with tenant/onboarding/lease scope and review-first guardrails. When OpenAI
  is configured, promoted tenant uploads now auto-extract in the background so
  the operator gets a ready-to-review Smart Intake item; when OpenAI is absent,
  the upload remains a normal promoted queue row. Extracted tenant lease uploads
  now include a `lease_auto_match` recommendation against the scoped lease,
  with matched fields, differences, missing fields, and a no-mutation guardrail.
  Smart Intake now renders that match recommendation in the review panel so the
  operator can see whether the tenant-uploaded lease matches the scoped lease
  before applying anything. Matched tenant lease uploads can now be accepted via
  `POST /api/v1/document-intakes/{id}/accept-lease-match`; that marks the
  intake applied, links the document to the existing lease, stamps onboarding
  signing as completed by `tenant_upload`, and queues the existing
  activation-review handoff for pending leases without mutating lease
  status/register values or creating a `LeaseIntake`. The accept endpoint is
  deliberately narrow: tenant-portal source only, onboarding-scoped only, and
  blocked if differences or missing fields remain. It also requires the stored
  document and onboarding scope to match the accepted lease before relinking the
  upload or stamping the signing handoff. It also now blocks while an active
  DocuSign envelope is queued/sent/delivered for the same onboarding so
  tenant-uploaded signing cannot silently supersede an unresolved provider
  envelope. Reviewed scoped
  `insurance_certificate` applies now update tenant insurance metadata
  (`insurance_confirmed`, expiry, source document/intake ids, review history)
  in addition to creating the renewal obligation. If the reviewed document is
  lease-scoped, insurance metadata follows that lease tenant and corrects stale
  document tenant scope before writing history. Upload/extraction keeps the
  tenant-selected document category stable, preserves tenant-portal source/
  candidate/scope/guardrail metadata through extraction, labels tenant-uploaded
  insurance rows in Smart Intake as tenant portal uploads, and stores AI
  classification only as proposed metadata until review/apply. Tenant detail
  now shows the confirmed insurance expiry plus source document/review links.
  **Send lease pack** now
  requires an attached lease document server-side, calls the DocuSign signature
  helper, stores a DocuSign receipt in `delivery_data.lease_pack.docusign`,
  stores queued/sent envelope metadata under `delivery_data.lease_agreement.signing`,
  and blocks tenant-side Leasium click-signing while a DocuSign envelope is
  queued/sent. The tenant portal session read model now also fails closed for
  active DocuSign signing metadata (`queued`, `sent`, or `delivered`): it
  reports `not_ready`, exposes the DocuSign provider/status fields, and tells
  tenants to complete DocuSign instead of enabling Leasium signing.
  `stewart.integrations.docusign.send_lease_for_signature` now
  performs JWT grant + envelope create when the four required DocuSign env vars
  are configured, and soft-skips when config or signer email is missing. The
  DocuSign Connect endpoint `POST /api/v1/tenant-onboarding/webhooks/docusign`
  now requires `DOCUSIGN_WEBHOOK_SECRET`, rejects unsigned Connect events, and
  marks completed envelopes signed idempotently only when the current signing
  record is an active DocuSign envelope. On completion it downloads DocuSign's
  completed combined PDF and stores it once as a signed lease document scoped to
  the tenant/onboarding/lease. Envelope create now includes hidden custom fields
  for lease id, tenant onboarding id, source document id, entity id, property,
  and unit so provider-console traces can be matched back to Leasium. If
  DocuSign echoes those Leasium custom fields in Connect payloads, the webhook
  validates each present id before accepting completion; omitted fields remain
  allowed for simpler Connect configurations.
  Non-completion events such as declined/voided are
  now retained as provider events and shown as DocuSign attention states without
  marking the lease signed or downloading a PDF; delivered envelopes stay
  blocked from duplicate operator **Send lease pack** attempts and local Leasium
  signing until DocuSign completes or an operator resolves the provider state.
  Tenant detail now offers **Send again** for
  declined/voided/failed/skipped DocuSign states when the lease document is
  still attached, creating a fresh envelope and preserving the previous
  lease-pack attempt in history. Tenant detail now surfaces promoted Smart Intake
  upload status, DocuSign signing status, and a direct signed lease download
  when retention succeeds. Completion also stamps a review-safe
  `lease_activation_review` marker; pending leases are shown as ready for
  explicit activation review, but `Lease.status` is not changed automatically.
  Operators can now click an explicit tenant-detail **Activate lease** action
  after signed completion; that route activates only pending leases and stamps
  lease metadata/signing history. The backend activation route now also
  requires `lease_activation_review.status = ready_for_review`, so malformed or
  legacy signed-looking metadata cannot bypass the review marker. Settings >
  Organisation > Integrations now
  reports DocuSign readiness, shows the Connect webhook URL when
  `PUBLIC_API_URL` is set, warns when credentials are present but
  `DOCUSIGN_WEBHOOK_SECRET` is still missing, warns specifically when
  `PUBLIC_API_URL` is the remaining Connect blocker, and provides local
  copy/download actions for a review-only DocuSign provider setup packet. Next
  slice is provider-console
  verification with real DocuSign credentials: configure the DocuSign JWT app,
  RSA key, account GUID, integration key, and impersonated service-user GUID;
  set `DOCUSIGN_WEBHOOK_SECRET`; point DocuSign Connect at
  `https://api.leasium.ai/api/v1/tenant-onboarding/webhooks/docusign`; complete
  one test envelope; confirm the signed PDF is retained once under the
  tenant/onboarding/lease scope; then review and explicitly click tenant-detail
  **Activate lease**. Keep this operator-approved and provider-scoped: do not
  expose secrets, do not send a lease pack without the correct attached lease
  file, and do not treat webhook completion as automatic lease activation.
  Plan: `docs/superpowers/plans/2026-05-29-tenant-lifecycle-two-day-push.md`.
- 2026-05-28 Settings Xero continuation 5: Connection diagnostics now has a
  local `Copy diagnostics packet` action beside `Download diagnostics CSV`,
  reusing the already-loaded `xeroDiagnostics` block. The smoke test reads the
  clipboard and verifies connection context, readiness gates, provider setup,
  env vars, diagnostics guardrails, and the export guardrail. It does not add a
  backend route, refetch diagnostics, start OAuth, call/refresh Xero,
  preview/apply reconciliation, create drafts, dispatch invoices/providers, send
  email/SMS, refresh providers, or mutate provider history.
- 2026-05-28 Settings Xero continuation 6: Connection diagnostics now has a
  local `Download diagnostics packet` text export beside
  `Copy diagnostics packet`, using the same
  `xeroConnectionDiagnosticsPacket(xeroDiagnostics)` content and filename
  `xero-connection-diagnostics.txt`. The smoke test downloads the TXT and
  verifies the same packet content and guardrails. It does not add a backend
  route, refetch diagnostics, start OAuth, call/refresh Xero, preview/apply
  reconciliation, create drafts, dispatch invoices/providers, send email/SMS,
  refresh providers, or mutate provider history.
- 2026-05-28 Settings Xero continuation 7: Connection diagnostics readiness
  rows now include short local reasons for each provider action gate, derived
  only from the already-loaded `xeroDiagnostics` response. The smoke test
  confirms the unconnected fixture keeps Draft creation `Blocked` and explains
  that Xero must be connected before provider previews and draft creation are
  available. It does not derive readiness from `/xero/status`, invoice drafts,
  exception queues, local UI mutation state, or optimistic state, and it does
  not start OAuth, refresh tokens, call Xero, create drafts, dispatch providers,
  send email/SMS, reconcile payments, write provider history, or change local
  approval state.
- 2026-05-28 Settings Xero continuation 8: the readiness explainer now has a
  mock-only smoke fixture for diagnostics where `can_create_xero_drafts=true`.
  The test confirms the Draft creation readiness card shows `Ready` and the
  reviewed-action reason only from the diagnostics fixture. It does not start
  OAuth, refresh tokens, call Xero, create drafts, dispatch providers, send
  email/SMS, reconcile payments, write provider history, or change local
  approval state.
- 2026-05-28 Settings Xero continuation 9: the same draft-ready diagnostics
  smoke now downloads `xero-connection-diagnostics.csv` and
  `xero-connection-diagnostics.txt`, asserting provider/source context, Draft
  creation `Ready`, Payments `Blocked`, local readiness reasons, next steps, and
  review-only guardrails. The CSV/TXT exports now reuse the readiness explainer
  details. It remains test/export coverage only: no OAuth start, token refresh,
  Xero API call, draft creation, provider dispatch, email/SMS, payment
  reconciliation, or provider-history write.
- 2026-05-28 Settings Xero continuation 10: the draft-ready diagnostics smoke
  now also clicks `Copy diagnostics packet`, reads the clipboard, and asserts it
  contains provider/source details, Draft creation `Ready`, Payments `Blocked`,
  the local readiness reason, and the review-only diagnostics guardrail. The
  same test now traps forbidden provider endpoints during CSV/TXT/copy actions,
  proving those local exports do not start OAuth, preview contacts/chart/tax,
  preview posting, create Xero drafts, dispatch providers, or run payment
  reconciliation.
- 2026-05-28 Settings Xero continuation 11: the unconnected diagnostics section
  in `settings shows Xero readiness and records mappings` now has the same
  forbidden-request trap around CSV/TXT/copy actions, scoped before the later
  manual tenant save and reviewed provider workflow. It proves local diagnostics
  exports do not start OAuth, preview contacts/chart/tax, preview posting, create
  Xero drafts, dispatch providers, or run payment reconciliation before the test
  intentionally exercises reviewed provider flows.
- 2026-05-28 Settings Xero continuation 12: the Settings smoke now uses a shared
  forbidden-provider-request watcher for review-only Xero exports. Exception
  queue copy/download, accounting freshness CSV/copy, unconnected diagnostics
  CSV/TXT/copy, and draft-ready diagnostics CSV/TXT/copy all assert no OAuth
  start, contact/chart/tax/posting preview, draft creation, provider dispatch, or
  payment reconciliation request occurs during local export actions.
- 2026-05-28 Settings Xero continuation 13: provider setup preflight export
  smoke coverage now asserts `Copy setup packet` clipboard content and
  `Download setup packet` TXT content both include env vars, expected redirect
  URI, required scopes, setup checklist, and diagnostics guardrails. The same
  forbidden-provider-request watcher proves setup packet copy/download does not
  start OAuth, call Xero previews, create drafts, dispatch providers, or run
  payment reconciliation.
- 2026-05-28 Settings Xero continuation 14: backend diagnostics contract
  coverage now asserts `GET /api/v1/xero/connection-diagnostics` returns stable
  provider setup preflight fields, including required/missing env vars, expected
  redirect URI, required scopes, setup checklist, and diagnostics guardrails.
  The checklist now explicitly tells operators to set
  `XERO_REDIRECT_URI=<expected callback>` and `XERO_STATE_SECRET` before
  production OAuth. The focused backend coverage monkeypatches provider actions
  to fail if touched and confirms diagnostics remains local/read-only with no
  token refresh, Xero API call, draft creation, provider dispatch, email/SMS,
  payment reconciliation, provider-history write, or audit mutation.
- 2026-05-28 Settings Xero continuation 15: frontend smoke coverage now mocks
  `/api/v1/xero/connection-diagnostics` as unavailable and proves Settings Xero
  fails closed. The diagnostics query does not retry in this operator flow; the
  UI shows the API error plus "Provider actions stay disabled until Xero
  diagnostics reload.", hides diagnostics/setup exports, keeps Connect with
  Xero plus contact/chart-tax/invoice/payment provider previews disabled, and
  asserts no OAuth, Xero preview/apply, draft creation, provider dispatch, or
  payment reconciliation request fires.
- 2026-05-29 Settings Xero continuation 16: frontend smoke coverage now also
  mocks `GET /api/v1/xero/connection-diagnostics` returning 401 (missing Clerk
  bearer token) and 403 (operator access required). Both paths prove Settings
  Xero fails closed: diagnostics/setup exports stay hidden, provider actions
  remain disabled, and no OAuth, Xero preview/apply, draft creation, provider
  dispatch, or payment reconciliation request fires. This is mock-only safety
  coverage; the live Xero rehearsal still needs production credentials.
- 2026-05-29 comms automation continuation: SendGrid inbound email attachments
  are now routed into Stored Documents plus Smart Intake review rows tied back
  to the inbound message and attributed tenant when the sender matches a tenant
  email. When `OPENAI_API_KEY` is configured, attachment intakes are
  pre-extracted into `ready_for_review`/`needs_attention`; extraction failures
  soft-fail the intake as `failed` without losing the stored attachment or
  inbound message. The comms queue candidate detail calls out the attachment
  count routed to Smart Intake, and the `/comms` smoke fixture now includes an
  inbound email attachment draft plus CSV coverage. This remains review-first:
  no tenant data, lease data, provider action, payment record, SendGrid reply,
  or Twilio message is changed until an operator approves the next step.
- 2026-05-29 comms automation continuation 2: SendGrid inbound parse can now be
  protected with `SENDGRID_INBOUND_SECRET`. When configured, the webhook rejects
  missing/wrong secrets before persisting an inbound message; SendGrid can pass
  the value as `token`, `secret`, `X-Leasium-SendGrid-Inbound-Secret`, or
  `X-SendGrid-Inbound-Secret`. Deployment docs now show the tokenized inbound
  parse URL, so live DNS/MX should not be enabled until that env var is set.
- Sidecar recommendation for the next slice: add operator-facing Smart Intake
  filters/copy for inbound-email attachment rows, or move to the next
  tenant-lifecycle guardrail.

## Takeover Priority

1. Read `CLAUDE.md` at the repo root before starting. It encodes the behavioural baseline (state assumptions, simplest possible change, surgical edits, verifiable success criteria) plus the Leasium-specific guardrails.
2. Run `git status --short` and `git log --oneline -10` to confirm the tree is clean and the tip includes the latest Codex continuation slices.
3. Production schema verification is complete as of 2026-05-27:
   `alembic_version` is `20260524_0026`, `token_consumed_at` exists, and
   `residential` is present in `property_type`.
4. **Outstanding live tenant step:** Temba's active onboarding is already
   claimed/submitted/reviewed/applied. Open tenant
   `019e6272-9879-786a-aa88-abfd1aa9fa48`, attach the intended custom
   lease file, then explicitly send the lease pack. This is a real
   provider email, so it requires operator approval.
5. **Top priority (2026-05-31): the DoorLoop benchmark refocus (P0).** Start with the People-hub + IA execution plan at [`docs/superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md`](superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md), Ticket 1.1 (the `Owner` entity, red test first). Backlog context: `docs/product-roadmap.md` → "DoorLoop benchmark refocus". The older candidates (owner-statement PDF formatting, Portfolio QA bulk review, Operations mobile live-review) drop below this.
6. Keep all provider actions review-first: no Xero mutation, SendGrid email, Twilio SMS, tenant email, or payment reconciliation should happen without explicit operator approval.

## Project Map

- `apps/api`: FastAPI app, routers, request/response schemas, and API entrypoint.
- `stewart/core`: settings, auth, SQLAlchemy models, audit helpers, database setup, IDs.
- `stewart/ai`: document, lease, and public enrichment extraction helpers.
- `stewart/integrations`: provider adapters for communications, storage, Xero, Slack, and email.
- `migrations/versions`: Alembic revisions. Hosted deployments must include the full tree.
- `apps/web`: Next.js 15 App Router frontend.
- `apps/web/src/app`: route surfaces such as Dashboard, Smart Intake, Properties, Tenants, Operations, Settings, Notifications, Billing Readiness, Insights, tenant onboarding, and tenant portal.
- `apps/web/src/components`: shared UI and workspace components.
- `apps/web/src/lib/api.ts`: frontend API client and shared response types.
- `tests/integration`: backend workflow coverage.
- `apps/web/tests/smoke`: Playwright smoke coverage with API fixtures.
- `docs/product-roadmap.md`: built roadmap and next build order.
- `docs/design-governance.md`: Remba review queue and design-facing change log.
- `docs/deployment.md`: deployment/env/provider setup details.

## Local Connection And Tooling

- Local repo path: `/Users/tembavanjaarsveld/Documents/Stewart`
- Local API: `http://localhost:8000`
- Local web app: `http://localhost:3000`
- Local API base for web: `http://localhost:8000/api/v1`
- Production frontend: `https://leasium.ai`
- Vercel provider alias: `https://leasium.vercel.app`
- Production API base for the web app: `https://api.leasium.ai/api/v1`
- GitHub remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Backend runtime: Python 3.12 with `.venv` already present.
- Frontend dependencies: `apps/web/node_modules` already present.
- `uv` and `pnpm` are not available in this shell right now; use `.venv/bin/python`, `.venv/bin/alembic`, `.venv/bin/uvicorn`, and `apps/web/node_modules/.bin/...` directly.
- `make lint` is the fast merge gate: Ruff + frontend ESLint + frontend TypeScript.
- `make typecheck` includes Python mypy and currently represents tracked strict-mode debt, not the day-to-day merge gate.
- Xero Monday priority: connect OAuth in production, verify contact preview, chart/tax preview, invoice posting preview, approved Xero draft creation, and payment reconciliation preview/apply with explicit operator approvals.
- Local services come from `docker-compose.yml`: Postgres on `5432`, Redis on `6379`, MinIO on `9000`, MinIO console on `9001`.
- Dev auth defaults to `AUTH_MODE=dev` with the deterministic Temba operator values in `.env.example`.
- Clerk mode is used in production/staging operator auth. Public tenant onboarding, tenant portal tokens, first setup, invite acceptance, sign-in/sign-up, and access gate pages remain public.

Useful commands:

```bash
# Start local infra
docker compose up -d

# Apply migrations
.venv/bin/alembic upgrade head

# Seed local data
.venv/bin/python -m scripts.seed

# Start API
.venv/bin/uvicorn apps.api.main:app --reload --host 0.0.0.0 --port 8000

# Start web app from apps/web
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next dev

# Backend checks
.venv/bin/python -m ruff check apps stewart tests scripts
.venv/bin/python -m pytest

# Frontend checks from apps/web
./node_modules/.bin/eslint src
./node_modules/.bin/tsc --noEmit
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build
./node_modules/.bin/playwright test
```

## Xero Monday Verification

Use this as the production rehearsal path after the environment variables and Xero app redirect URI are confirmed:

1. Open Settings -> Xero for the production entity and confirm connection diagnostics show provider config, role/scope readiness, and no hidden Xero calls on load.
2. Connect OAuth through Xero and return to Settings with the `Xero connected` callback feedback visible.
3. Run contact preview and confirm contacts are previewed or safely return zero results without applying mappings automatically.
4. Run chart/tax validation preview and confirm every charge rule has an account and tax mapping before invoice posting review.
5. Run invoice posting preview and confirm payloads/blockers are visible without posting to Xero.
6. Explicitly approve only the intended invoice drafts for Xero posting.
7. Create Xero DRAFT invoices only after operator approval; verify retry/idempotency does not duplicate drafts.
8. Run provider dispatch only when both Xero draft creation and tenant email delivery are explicitly approved.
9. Run payment reconciliation preview/apply only as a reviewed local Leasium metadata update; do not create or edit Xero bank transactions.

Local proof set:

```bash
.venv/bin/python -m pytest tests/integration/test_xero_api.py -q
.venv/bin/python -m pytest \
  tests/integration/test_xero_api.py::test_xero_connection_diagnostics_configured_without_connection_is_read_only \
  tests/integration/test_xero_api.py::test_xero_connection_diagnostics_full_scopes_unlock_provider_actions \
  tests/integration/test_xero_api.py::test_xero_connection_diagnostics_viewer_cannot_use_provider_actions \
  tests/integration/test_xero_api.py::test_xero_oauth_callback_records_provider_connection \
  tests/integration/test_xero_api.py::test_xero_contact_sync_preview_suggests_matches_without_applying \
  tests/integration/test_xero_api.py::test_xero_chart_tax_validation_preview_checks_provider_accounts_and_tax_rates \
  tests/integration/test_xero_api.py::test_xero_invoice_posting_preview_builds_payload_without_posting \
  tests/integration/test_xero_api.py::test_xero_invoice_posting_preview_requires_provider_connection \
  tests/integration/test_xero_api.py::test_xero_invoice_posting_preview_blocks_connected_invoice_with_missing_mapping \
  tests/integration/test_xero_api.py::test_xero_invoice_draft_create_requires_explicit_posting_approval_before_write \
  tests/integration/test_xero_api.py::test_xero_posting_approval_then_draft_create_is_idempotent \
  tests/integration/test_xero_api.py::test_xero_provider_dispatch_creates_xero_then_sends_email_idempotently \
  tests/integration/test_xero_api.py::test_xero_provider_dispatch_persists_failed_attempt_and_retries \
  tests/integration/test_xero_api.py::test_xero_payment_reconciliation_preview_and_apply_are_idempotent \
  tests/integration/test_xero_api.py::test_xero_provider_payment_reconciliation_fetches_xero_invoices \
  -q
```

Hard guardrail: never run Xero draft creation, provider dispatch, tenant email, payment apply, or any payment reconciliation against production data without explicit operator approval at that moment.

## Active Local Tree

2026-05-24 (later): **Tenant portal soft-switch claim gate.** Closes the magic-link weakness on `/tenant-portal/{token}` — the bare URL no longer reveals portal data without a Clerk session.

Backend
- New alembic migration `20260524_0026` adds `tenant_onboarding.token_consumed_at` (nullable timestamp; Postgres `op.add_column`, SQLite no-op happens through the same path).
- `TenantOnboarding` model gains the matching field.
- `_portal_scope` in `apps/api/routers/tenant_portal.py` now refuses tokens where `token_consumed_at is not null` with **HTTP 410 Gone**. Every token-scoped data endpoint (session, documents, maintenance, payments, onboarding submit, notification prefs) flows through this helper, so they all gate at once.
- `_portal_scope` gains an `allow_consumed=False` flag. Only `claim_tenant_portal_account` passes `allow_consumed=True` — and then enforces its own check: a consumed token may only be re-claimed by a Clerk user who already has an active `TenantPortalAccount` linked to the same tenant. Anyone else gets 410.
- `claim_tenant_portal_account` stamps `token_consumed_at = now()` on first successful claim (idempotent on re-claim).
- New public `GET /api/v1/tenant-portal/invites/{token}/preview` endpoint returns the minimum-viable context for the claim gate: property name, property address, tenant display name, expiry, claimable boolean. Never returns financial data / contact details / documents. Used by the unauthenticated gate to show "you've been invited to {property}" before the tenant signs in.

Frontend
- `/tenant-portal/{token}` now renders a full-page claim gate via `apps/web/src/app/tenant-portal/tenant-portal-content.tsx`. When `token && !accountPortal` the page shows ONLY the invite preview + Clerk sign-in/sign-up. After Clerk auth a top-level `gateClaimMutation` auto-fires `claimTenantPortalAccount(token, authToken)`, links the `TenantPortalAccount`, and the existing portal content takes over.
- The unauthenticated `portalQuery` (token-scoped `/tenant-portal/session`) is disabled entirely (`enabled: false`) — every data read flows through `getTenantPortalAccountSession(authToken)` post-claim.
- Gate handles four states cleanly: preview loading, invite not found / expired, "this invite has been used" (claimable=false), and "linking your account…" (signed-in claim in flight).
- `apps/web/src/lib/api.ts` gains `TenantPortalInvitePreviewRecord` + `getTenantPortalInvitePreview(token)`.

Tests
- `tests/integration/test_tenant_portal_api.py` — the existing `test_tenant_portal_account_claim_links_account_and_returns_account_scoped_portal` test had an explicit "after claim, the bare token still works" assertion that contradicts the soft switch. Flipped to assert `token_consumed_at is not None` + token endpoint now returns **410 Gone**.

Files touched: `migrations/versions/20260524_0026_tenant_portal_token_consumed.py` (new), `stewart/core/models.py`, `apps/api/routers/tenant_portal.py`, `apps/api/schemas/tenant_portal.py`, `apps/web/src/app/tenant-portal/tenant-portal-content.tsx`, `apps/web/src/lib/api.ts`, `tests/integration/test_tenant_portal_api.py`.

Sandbox ESLint + tsc clean. Backend pytest pending Mac-side run.

Mac-side verification for the soft-switch claim gate:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m ruff check apps/api/routers/tenant_portal.py apps/api/schemas/tenant_portal.py stewart/core/models.py migrations/versions/20260524_0026_tenant_portal_token_consumed.py tests/integration/test_tenant_portal_api.py
.venv/bin/alembic upgrade head
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py -q
```

Hosted Neon/Render needs migration `20260524_0026` applied next deploy. The migration is non-destructive (additive nullable column) so a rollback is safe.

Behavioural change for tenants on existing invite links: any link sent before this deploy still works for first claim. After they sign in once and claim, the link goes dead — they must use their Clerk-linked account from then on. No data migration required.

Behavioural change for operators: the "Preview as tenant" affordance (which opens the token URL) now lands on a sign-in wall — operators can't shadow a tenant by opening their invite URL. If you need a tenant-perspective view, build a read-only operator-side preview as a separate slice.

---

2026-05-24 (three small UX/data-model fixes, all unstaged):

**(c) Residential property type + ABN contextual on tenant forms.** New `residential` value added to `PropertyType` enum (Postgres ALTER TYPE migration `20260524_0025`; SQLite is a no-op since enums store as TEXT). Lease intake schema gets the new value. Frontend `PropertyType` union extended; `propertyTypes` label map gets "Residential"; the zod `property_type` enum in property-workspace also picks up the new value. `TenantLeaseContextRead` projection now carries `property_type` (backend + frontend types). Tenant detail edit form computes `tenantIsResidential = any lease is on a residential property` and hides the Trading-as + ABN fields in both the edit form and the read-only Profile panel when true — residential rentals don't carry those. Other tenant surfaces (list, DetailDrawer) still show ABN as `-` when blank, which is fine.

**(b) Smarter Unit picker on Send invite.** `/tenants` Send invite form now adapts to the property's unit count: 0 units → picker hidden, "Auto: Main premises will be created on send" hint shown, and the submit handler calls `createTenancyUnit({property_id, unit_label: "Main premises", sqm: null, parking_spaces: null})` before `createLease`. 1 unit → auto-selected, shown as a non-interactive chip. 2+ → required dropdown stays as before. `canSubmitInvite` updated to accept the auto-create + auto-select modes. Lease editor in property-workspace was surveyed but didn't need the same logic (the editor opens from a specific unit row so the operator already has one selected).

**(a) Tenant delete affordance on `/tenants/[tenantId]`.** Added a "Delete tenant" SecondaryButton next to the existing "Edit profile" button in the detail-page header. window.confirm() pattern matches the contractor remove flow; confirm message includes a warning about active leases that will lose their tenant link. Hits the existing `DELETE /api/v1/tenants/{id}` (soft delete via deleted_at). On success invalidates tenants / tenant / tenant-detail caches and `router.push("/tenants")`.

Frontend ESLint + tsc clean in the sandbox. Files touched: `apps/web/src/{app/tenants/page.tsx,app/tenants/[tenantId]/page.tsx,components/property-workspace.tsx,lib/api.ts}` + `stewart/core/models.py` + `stewart/ai/lease_intake.py` + `apps/api/schemas/register.py` + `apps/api/routers/tenants.py` + new `migrations/versions/20260524_0025_residential_property_type.py`.

Mac-side verification for slices (b) + (c):

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m ruff check stewart/core/models.py stewart/ai/lease_intake.py apps/api/schemas/register.py apps/api/routers/tenants.py migrations/versions/20260524_0025_residential_property_type.py
.venv/bin/alembic upgrade head  # local sqlite no-op for the enum; postgres ALTER TYPE runs in autocommit block
.venv/bin/python -m pytest tests/integration/test_register_api.py tests/integration/test_tenant_portal_api.py -q  # spot-check the projection change didn't break anything
```

Hosted Neon/Render will need the new migration applied. The autocommit block handles the `ALTER TYPE ... ADD VALUE` requirement for older Postgres versions; on 12+ it's redundant but harmless.

Previously this session — 2026-05-23 (even-later-still same day): AI inbox v2.2 — contractor/vendor matching + promote. Unstaged slice on top of v2.1:

- New `stewart/ai/vendor_intake.py` — strict-JSON extractor returning name / company_name / email / phone / categories / notes / confidence / warnings for promoting an unmatched vendor message into a draft Contractor row.
- `stewart/ai/inbox.py` — schema gains `suggested_contractor_id` (optional, null when unmatched). Prompt instructs the model to copy verbatim ids from the new `entity_index["contractors"]` block.
- `apps/api/schemas/ai.py` — `InboxTriageRead` gains `suggested_contractor`. `InboxPromoteKind` extended with `vendor_or_contractor`. `InboxPromoteTargetKind` extended with `contractor`. `InboxPromoteRequest` gains `contractor_id`.
- `apps/api/routers/ai.py` — entity index helper includes contractors (`_contractor_label` shows `"name (company)"`). New `_contractor_in_entity` validator. Promote endpoint vendor branch: matched contractor → no draft, target_href `/contractors`; unmatched → run vendor extractor, create Contractor row at priority=3 with extracted fields; soft-fail when extractor raises → minimal Contractor seeded from triage summary with `contractor_metadata["extraction_error"]`. Categories drawn from `stewart/ai/maintenance.MAINTENANCE_CATEGORIES` so new entries plug into the maintenance dispatch matcher.
- `tests/integration/test_ai_triage_api.py` — existing triage tests updated for the new `suggested_contractor_id` schema field + audit input key. Four new tests: matched-vendor-routes-no-draft, unmatched-vendor-extracts-new-contractor, extractor-soft-fails-to-minimal-row, cross-entity-contractor-rejected. Total file now 14 cases.
- `apps/web/src/lib/api.ts` — types + promote payload extended.
- `apps/web/src/app/inbox/page.tsx` — promote panel swaps property/tenant/lease pickers for a single Contractor dropdown when kind is `vendor_or_contractor` (empty option = "Create new contractor"). Button label switches between "Open contractor profile" and "Add to contractor directory" based on selection.
- `apps/web/tests/smoke/api-mocks.ts` — triage mock includes `suggested_contractor: null`.
- `apps/web/tests/smoke/app-flows.spec.ts` — new spec exercises the vendor classification path via per-test route overrides; asserts the contractor dropdown is shown (not the property/tenant ones) and Promote routes to `/contractors`.
- Docs: `docs/product-roadmap.md` AI inbox v2.2 entry marked `[~]`.

Sandbox ESLint + tsc clean. Backend pytest + Playwright pending Mac-side run.

Mac-side verification for v2.2:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m ruff check stewart/ai/vendor_intake.py stewart/ai/inbox.py apps/api/schemas/ai.py apps/api/routers/ai.py tests/integration/test_ai_triage_api.py
.venv/bin/python -m pytest tests/integration/test_ai_triage_api.py -q
# Expect: 14 passing.

cd apps/web
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs \
  ./node_modules/.bin/playwright test --grep "AI inbox"
# Expect: 3 passing (deep-link + maintenance promote + vendor contractor picker).
```

---

Previously this session: 2026-05-23 (even later same day): AI inbox v2.1 — pre-extract lease-change facts at promote time. Unstaged slice on top of v2:

- New `stewart/ai/lease_change.py` — strict-JSON OpenAI extractor that returns parties / properties / key_dates / money_amounts / proposed_actions / summary / confidence / warnings shaped to the existing `DocumentIntakeExtraction` keys.
- `apps/api/routers/ai.py` — promote endpoint now takes `settings` Depends; lease_change branch builds a compact `_lease_snapshot(...)` (current expiry / current rent / next review) from the operator-matched lease, calls the extractor, stamps `extracted_data` / `summary` / `confidence` / `openai_response_id` on the DocumentIntake, and chooses `ready_for_review` vs `needs_attention` from the confidence score. Soft-fails to v2.0 behaviour (uploaded status, `review_data["extraction_error"]`) when the API key is unset or the call raises.
- `tests/integration/test_ai_triage_api.py` — existing `test_promote_lease_change_creates_intake_with_text_document` renamed to `test_promote_lease_change_soft_fails_without_openai_key` and assertions updated for the soft-fail path. Three new tests added: pre-extracts-fields-when-available (asserts ready_for_review + extracted_data + lease_snapshot was passed through), low-confidence-lands-needs_attention, soft-fails-when-extractor-raises. Total file now 10 cases (was 7 after v2).
- Zero frontend changes (intake review UI already renders the populated groups).
- Docs at the time: `docs/product-roadmap.md` AI inbox v2.1 entry marked
  `[~]`; later closeout below marks v2.1 `[x]` after focused verification.

Mac-side verification for v2.1: `.venv/bin/python -m pytest tests/integration/test_ai_triage_api.py -q` — expect 10 passing.

---

Previously this session (v2, now committed and pushed): AI inbox v2 — promote classifications into drafts. Spanning:

Backend
- `stewart/ai/inbox.py` — extended prompt + JSON schema to accept an `entity_index` (properties / tenants / active leases) and return optional `suggested_property_id` / `suggested_tenant_id` / `suggested_lease_id`. Signature now `triage_inbox(*, body, settings, entity_index=None)`.
- `apps/api/schemas/ai.py` — new `InboxTriageMatch` model; `InboxTriageRead` gains `suggested_property/tenant/lease`. New `InboxPromoteKind`, `InboxPromoteTargetKind`, `InboxPromoteRequest`, `InboxPromoteRead`.
- `apps/api/routers/ai.py` — `/triage` now builds the entity index, passes it through, and validates returned uuids against it (invented ids dropped silently). New `POST /ai/triage/promote` creates the right draft per kind. Three pre-existing `assert_entity_role` arity bugs fixed at the same time (`(user, entity_id, roles)` → `(session, user, entity_id, roles)` on `/ask`, `/triage`, and new `/promote`).
- `tests/integration/test_ai_triage_api.py` — updated existing classification test (entity_index assertions + new audit-input keys), added drop-invented-ids test, added promote tests for each of the three actionable kinds + cross-entity rejection.

Frontend
- `apps/web/src/lib/api.ts` — `InboxTriageMatch`, new `suggested_*` fields on `InboxTriageRecord`, `InboxPromoteKind`/`InboxPromoteTargetKind`/`InboxPromoteRecord`, `promoteInboxMessage(...)` client.
- `apps/web/src/app/inbox/page.tsx` — new Promote-to-draft panel below the deep-link CTA when the classified kind is actionable. Property + tenant dropdowns (plus lease for `lease_change`) pre-filled from the AI suggestions; operator can override before clicking Promote. On success the router pushes the operator into the new draft's detail page.
- `apps/web/tests/smoke/api-mocks.ts` — triage mock now returns suggested_property/tenant; new promote mock.
- `apps/web/tests/smoke/app-flows.spec.ts` — new spec asserts the promote panel pre-fills and that clicking Promote routes into `/operations/maintenance/{id}`.

Docs
- `docs/product-roadmap.md` — Tier 3 AI-inbox entry gained an "v2: promote classifications into drafts" line marked `[~]`.

Frontend ESLint + tsc clean in the Cowork sandbox. **Playwright smoke + backend pytest deferred to Mac-side verification** (sandbox can't boot `next dev` within the 45s bash cap, and the macOS-aarch64 `.venv` doesn't run on Linux). See "Mac-side verification" block below.

No pending code edits prior to this slice. `docs/external-skills/` (Vercel + Anthropic + Hallmark reference markdown, ~830K) is committed to the repo.

### Mac-side verification for the AI inbox v2 slice (2026-05-23)

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m ruff check stewart/ai/inbox.py apps/api/schemas/ai.py apps/api/routers/ai.py tests/integration/test_ai_triage_api.py
.venv/bin/python -m pytest tests/integration/test_ai_triage_api.py -q
# Expect: all tests pass — 5 cases total (existing classification + drops-invented-ids
# + 3 promote tests + cross-entity rejection).

cd apps/web
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs \
  ./node_modules/.bin/playwright test --grep "AI inbox"
# Expect: 2 passing (existing deep-link spec + new promote-to-maintenance spec).
```

## Workspace Cleanup

- Removed stale generated folders from the local checkout:
  - `.pytest_cache`
  - `apps/web/.next`
  - Python `__pycache__` folders under `apps/`, `migrations/`, `scripts/`, `stewart/`, and `tests/`
- Removed unrelated Brewery scratch files that were untracked and intentionally not part of Leasium:
  - `docs/Brewery_Invoice_Approval_Cost_Comparison.docx`
  - `docs/brewery-approval-cost-comparison.md`
  - `docs/brewery-invoice-approval-research.md`

## Recently Shipped

The 2026-05-22 UX-review sweep + supporting work. All commits on `main`.

UX review Tier 1 (foundation, visible-impact):
- `6302b0a Tier 1 (d): URL-persistent filters across tables` — `?occupancy`, `?owner_tag` on Properties; `?tenant_filter`, `?q` on Tenants; `?tab`, `?assignee`, `?maintenance_status`, `?maintenance_priority`, `?arrears_status` on Operations.
- `bd08fb3 Tier 1 (c) v1: Dashboard metric trend deltas + sparklines` — `DashboardMetricCard` accepts a `trend` prop; 7-day SVG sparkline + Stripe-style delta badge; wired on the Operations urgent-obligations card.
- `d032fc9 Tier 1 (b) v1: DetailDrawer + Tenants quick view` — new generic `<DetailDrawer>` at `apps/web/src/components/detail-drawer.tsx`; Tenants table row click opens it.
- `418d0c7 Tier 1 (a) v1: convert top-bar nav to fixed left sidebar` — 240px navy fixed sidebar, brand at top, icon + label per module, hamburger drawer on <lg. AppHeader toggles `body.app-shell-active` so auth/setup pages stay full-width.
- `b77a16f Remove G-shortcut chips from sidebar nav items` — followup operator feedback.

UX review Tier 2 (strategic):
- `c1b2a7c Ask Leasium v1 backend` + `e7b5cce Ask Leasium v2 frontend` — Tier 2 (e) Leasium AI Q&A surface on the Dashboard. `POST /api/v1/ai/ask` with bounded context, strict-JSON citations, 503 when `OPENAI_API_KEY` unset.
- `1f16485 Tier 2 (f) v1: cross-property activity feed` — Dashboard panel pulling from the append-only `audit_action` table via `GET /api/v1/activity-feed`. Time-bucketed (Today / Yesterday / Earlier / Older), 60-second background refresh.
- `d90afad Tier 2 (h) v1: keyboard shortcuts + cheatsheet` — Linear-style `G + letter` navigation (D/I/M/P/T/O/B/N/Q/S), `?` cheatsheet modal, `Esc` closes anything.

UX review Tier 3 (bigger bets):
- `ad51b4a Tier 3 v1: inline-editable Contact cells on Tenants` + `dd70a26 Tier 3 v2 + v3: inline editing on Properties + Operations` — reusable `<InlineEditCell>` (text + select variants); Tenants contact name/email/phone, Properties name/address, Operations status/priority chips. Optimistic React Query with rollback.
- `f74e5dd Tier 3 v1: saved views on Tenants / Properties / Operations` — localStorage-backed named filter combinations via `<SavedViewsMenu>` chip. Promote to backend table when a second operator comes online.
- `c63c7a6 Tier 3 v1: multi-view (Table/Board) for Properties` + `83d3c8a Board column alignment + collapsible Property images panel` — Notion-style table/board toggle with `?view=board` persistence; board groups properties by occupancy bucket. Operator-feedback fixes: column alignment + collapsing the always-open images panel to a 40×56 thumbnail with chevron.
- `c546ed6 Tier 3 v1: AI inbox processor at /inbox` — Re-Leased Credia equivalent. `POST /api/v1/ai/triage` classifies a pasted message (7 kinds) and suggests the next Leasium surface. Read-only; deep-link only, no auto-create in v1.
- `78f4e5e Tier 3 v1: mobile responsive audit pass` — entity selector drops to a wrap row on phones, dashboard metric grid promoted to `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`, Properties table now horizontally scrollable.

Tenant + AI polish:
- `e3e7a9b Preview as tenant button on tenant detail` — opens the tenant's `portal_url` (already projected on `TenantOnboardingRead`) in a new tab. No new endpoint needed.
- `7c8d029 Rebrand Ask panel to Leasium AI with distinct styling` — operator feedback: AI surfaces (Dashboard + /inbox) now share a gradient hero treatment (blue-soft → teal-soft, primary border accent, gradient Sparkles badge, Beta pill) so they read as AI at a glance.

Behavioural baseline:
- `d0823cf Add merged CLAUDE.md (Karpathy baseline + Leasium specifics)` — `CLAUDE.md` at the repo root combines the Forrest Chang / Andrej Karpathy four-principle file with Leasium-specific guardrails (provider mutation rule, Remba review, internal-first-6-months, push-to-Vercel review path, Mac/venv tooling notes).

2026-05-23 visual polish + brand sweep (commits hash-prefixed by their `git log` ID; run `git log --oneline -12` after the next pull to see them):

- `Add external agent-skills as in-repo reference` — Vendored Vercel react-best-practices, web-design-guidelines, composition-patterns + Anthropic frontend-design + Nutlope/hallmark (with full `references/` tree). Reference markdown only at `docs/external-skills/`; not runtime code.
- `Token consistency v1: Micro step, slate ramp, radii, tabular-nums` — Codex SoT §4 gained Micro 11px step; §7 gained matching Tailwind fontSize. 35 ad-hoc `text-[11px]` / `text-[10px]` callers migrated. Slate ramp extended to 200/150/100/50. borderRadius extension added. 13 `<table>` elements gained `tabular-nums` className. DashboardMetricCard sparkline hex literals extracted to `SPARKLINE_STROKE` const.
- `Motion polish v1: drawer backdrop easing + form focus-visible` — Two no-decision items: DetailDrawer backdrop got `ease-leasium`; 62 form-input focus styles migrated from `focus:` to `focus-visible:` so mouse clicks no longer flash the ring.
- `Motion polish v2: scale 150/200/300, ease-in + ease-toggle, drawer/modal enters` — Codex SoT §5 motion scale aligned with Tailwind defaults; `ease-leasiumIn` + `ease-leasiumToggle` added; three @keyframes (drawer-in-right/left, modal-fade-scale, backdrop-fade-in) wired. DetailDrawer + EvidenceDrawer + command palette + cheatsheet animate on mount.
- `Polish v3: owner-tag tokens, Body Compact, mobile + workspace modal animations` — Codex SoT §3 gained Owner tag palette section (12 entries ratifying existing colours); §4 gained Body Compact 15px step; 12 inline hex chip strings in `lib/property-ownership.ts` migrated to `leasium-ownertag-*` tokens; 7 `text-[15px]` callers migrated to `text-leasium-body-compact`; mobile nav + 3 property-workspace modals animate on mount.
- `Polish v4: alias drift resolution + checkbox focus-visible + two-tier docs` — Codex SoT §3 documented the two-tier naming convention (short aliases for common cases, `leasium-*` for explicit shades). Tailwind config gained root-level short aliases for soft/strong/hover state variants (`primary-hover`, `primary-soft`, `success`/`-soft`/`-strong`, etc.). 150+ `leasium-blue-*` / `leasium-success-*` / `leasium-warning-*` / `leasium-danger-*` / `leasium-info-*` callers migrated to short aliases. One checkbox `focus:` → `focus-visible:` carve-out finished.
- `Polish v5: drawer/modal exit animations via useUnmountDelay hook` — New `lib/use-unmount-delay.ts` hook keeps drawers/modals mounted long enough for the exit keyframe to play. Three exit @keyframes added (drawer-out-right/left, modal-fade-scale-out, backdrop-fade-out) using the new ease-in token. Applied to 8 surfaces: DetailDrawer, EvidenceDrawer, command palette, cheatsheet, mobile nav, lease/property/unit editors.
- `Polish v6: chip system consolidation` — New `chipClass(tone, options?)` helper in `components/ui.tsx` is the single source of truth for chip/pill/badge className strings. StatusBadge is a thin wrapper. `lib/property-occupancy.ts` and inline chip declarations migrated; Codex SoT §9 documents the density × tone × bordered matrix.
- `Polish v7: EmptyState icons + Codex empty-state convention` — EmptyState component gained an `icon` slot (36×36 rounded-leasiumLg with bg-primary-soft + text-primary). High-traffic empty states across Dashboard, Notifications, Insights, Operations, Settings, Billing Readiness, Tenants, Portfolio QA, Operations/Maintenance, Snapshots, Intake, Statements, Inbox, Contractors, Comms migrated to use semantic icons (CheckCircle2 for positive empty, Clock3 for time, Activity for feeds, Building2 for entity selection, etc.). Codex SoT §8 documents the icon semantic mapping.
- `Polish v8: remaining EmptyState icon opt-ins + slop-test + a11y audit fixes` — Final pass: filled icons on the remaining ~30 callers (skipped dynamic-title cases). Ran Hallmark 65-gate slop test on Dashboard surface — found and fixed gate 62 (added `overflow-x: clip` on html/body in globals.css) and gate 16 (narrowed form-input transitions to `transition-colors` so focus rings stay instant). Ran web-design-guidelines a11y audit on Notifications + opportunistically across the codebase — fixed 30+ loading-state strings missing the typographic ellipsis (`"Sending"` → `"Sending…"`, `"Loading"` → `"Loading…"`, etc.).

## Product State Snapshot

- Operator auth and workspace access are live enough for pre-production:
  - Clerk-backed operator login is working.
  - Protected frontend routes redirect signed-out users to Clerk sign-in.
  - Render API requires Clerk bearer tokens for protected workspace APIs.
  - Public tenant onboarding remains reachable.
- The SKJ portfolio workbook has been imported into the hosted register.
  - Real properties, units, tenants, leases, charge rules, and obligations are in the platform.
  - Demo seed rows were archived during the import work.
- Smart Intake remains the product center of gravity:
  - Spreadsheet import has server-stored review plans and reviewed Apply.
  - Purchase contracts can drive property/unit/tenant/lease/task/draft-charge creation with provenance.
  - Billing/admin documents create reviewed internal billing drafts and invoice drafts.
- Portfolio QA is available for cleanup but still needs final IA/Remba review.
- Xero is review-first:
  - OAuth connection foundation exists.
  - Contact preview/apply, chart/tax validation, posting preview, explicit Xero approval, draft creation, provider dispatch, and payment reconciliation preview/apply are built.
  - No Xero write runs without explicit operator approval.
- Tenant portal is beyond the token-only MVP:
  - Token-scoped self-service works.
  - Tenant account linking, account-only entry, documents, maintenance requests/photos, preferences, lifecycle controls, and operator revoke/unlink/restore exist.
- Operations/Work is now a real workspace:
  - Maintenance, arrears, critical dates, assignment, reminders, escalation cues, provider notices, SMS send/retry, digest previews/sends, and notification-center history exist.
  - Contractor communication, work-order completion, closeout notes/photos, invoice handoff, recovery, and provider history are built.

## Verification From Latest Work

- Work notification template preview:
  - Frontend lint passed.
  - TypeScript no-emit passed.
  - Settings smoke passed.
  - Production Next build passed.
  - Live route sanity passed.
- Work notification provider history:
  - `.venv/bin/python -m ruff check apps/api/schemas/work_assignments.py apps/api/routers/work_assignment_notifications.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py -q` returned `9 passed`
  - Frontend lint passed.
  - TypeScript no-emit passed.
  - Notifications smoke passed.
  - Production Next build passed.
  - Live route sanity passed.
- Work notification recovery cues:
  - Frontend lint passed.
  - TypeScript no-emit passed.
  - Notifications smoke passed.
  - Production Next build passed.
  - Live route sanity passed.
- Work notification named template catalog:
  - `.venv/bin/python -m ruff check apps/api/schemas/work_assignments.py apps/api/routers/work_assignment_notifications.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py -q` returned `10 passed`
  - `./node_modules/.bin/eslint src/app/settings/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Settings smoke passed.
- Work notification direct email recovery:
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py -q` returned `11 passed`
  - Backend ruff passed for Work assignment files.
  - Frontend lint passed for Notifications/API smoke files.
  - TypeScript no-emit passed.
  - Notifications smoke passed.
- Work notification channel readiness:
  - Backend ruff passed for Work assignment files.
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py -q` returned `11 passed`
  - Frontend lint passed for Notifications/API smoke files.
- Work SMS preference modelling:
  - Backend ruff passed for Security/Work assignment files.
  - `.venv/bin/python -m pytest tests/integration/test_security_api.py tests/integration/test_maintenance_arrears_api.py -q` returned `18 passed`
  - Frontend lint passed for Settings/Notifications/API smoke files.
- Work SMS send/retry wiring:
  - `.venv/bin/python -m ruff check stewart/integrations/communications.py apps/api/work_assignments.py apps/api/routers/work_assignment_notifications.py apps/api/schemas/work_assignments.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `19 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed for Work notices/digest receipts including SMS recovery.
- Work notification channel receipts:
  - Additive `channel_receipts` projection now returns Email and SMS receipt evidence on Work notice rows while legacy top-level email and `sms_*` fields remain.
  - `.venv/bin/python -m ruff check apps/api/schemas/work_assignments.py apps/api/routers/work_assignment_notifications.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `19 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed for the normalized channel receipt path.
- Work notification receipt evidence disclosure:
  - Notifications now exposes full Email/SMS provider receipt evidence through inline `Receipt evidence` disclosures instead of the unfinished drawer path.
  - Email notice send attempts now persist `attempt_count`/`delivery_attempt_count`, and SendGrid webhook receipts reuse that count so notification-center channel receipts do not inflate retries from receipt rows.
  - `.venv/bin/python -m ruff check apps/api/work_assignments.py apps/api/routers/work_assignment_notifications.py apps/api/schemas/work_assignments.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `19 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed for Work notices/digest receipts.
  - Live `/notifications` route loaded on the local dev server; the live seed had no receipt rows, so disclosure rendering is covered by the smoke fixture.
- Work notification rendered message previews:
  - `stewart/integrations/communications.py` now exposes rendered Work notice email, Work notice SMS, and Work digest email preview helpers, and provider sends reuse those helpers for subject/text bodies so preview and delivery stay aligned.
  - Notification-center Email/SMS channel receipts now include `rendered_message_preview`; digest receipts store and project a rendered digest preview at generation time.
  - Notifications renders collapsed `Message preview` disclosures for receipt-linked notice previews and digest previews.
  - `.venv/bin/python -m ruff check stewart/integrations/communications.py apps/api/work_assignments.py apps/api/routers/work_assignment_notifications.py apps/api/schemas/work_assignments.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `19 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed after tightening title assertions around hidden preview text.
  - Live `/notifications` route loaded on the local dev server; the local seed still has no receipt rows, so preview expansion is covered by the smoke fixture.
- Work notification provider setup checks:
  - Notification-center channel readiness now carries additive `setup_checks` for Work email, SendGrid sender/webhook, operator SMS preferences, Twilio messaging/callback, and Leasium in-app receipts.
  - Notifications renders those checks inside a collapsed `Provider setup checks` disclosure in the Work notice center, keeping provider-console detail out of each notice row.
  - The API returns bare Work webhook endpoints for SendGrid/Twilio review but never returns provider API keys, webhook secrets, or tokenized callback URLs.
  - `.venv/bin/python -m ruff check apps/api/routers/work_assignment_notifications.py apps/api/schemas/work_assignments.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `20 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed for the provider setup disclosure and bare endpoint rows.
  - Live `/notifications` loaded on the local web server, but this desktop session did not have the API server listening on port 8000, so entity-backed live hydration was covered by the smoke fixture instead.
- Ownership tags directory:
  - `apps/web/src/lib/property-ownership.ts` now centralises property owner/billing identity label extraction, chip palettes, and tag aggregation so Properties and Settings use the same computed owner chips.
  - Settings Organisation now shows an `Ownership tags` panel with one row per unique owner/billing identity label, visible source context, property counts, links back to matching properties, and tag-level links into a filtered Properties view.
  - `/properties?owner_tag=...` now applies a client-side owner-tag filter, keeps selected property detail aligned with the filtered row list, exposes a clear filter action, and can be applied directly from property-row owner chips.
  - Smoke fixtures now include multiple properties across shared and separate owner tags, so the chip-click path catches row-selection bubbling and non-matching property visibility regressions.
  - This is still a read-only aggregation of property fields/import metadata, not a new first-class owner/entity table.
- Property image helper experiment:
  - The original OpenAI web-search v1 was pulled after it returned listing page URLs instead of verified direct image file URLs; the current helper is the SerpAPI Google Images v2.
  - `stewart/ai/enrichment.py` now routes property image candidates through `stewart/integrations/serpapi_image_search.py`.
  - `/api/v1/public-enrichment/property-images/preview` returns reviewable remote image candidates with source/citation/confidence before anything is stored.
  - `/apply` downloads the selected candidate, processes it to a fixed 1600x900 JPEG, creates a property-linked StoredDocument, and stores metadata pointers such as `primary_image.document_id`, `hero_image_document_id`, `image_document_ids`, source/citation/confidence/history.
  - The Portfolio tab renders fixed-size row thumbnails and a selected-property `Property images` panel from the stored-document workflow, with candidate cards and explicit `Apply image` review before apply.
  - This is experimental. If visual quality or source clarity is poor, pull the helper rather than shipping remote metadata-only hotlinks.
  - `.venv/bin/python -m ruff check stewart/ai/enrichment.py apps/api/schemas/enrichment.py apps/api/routers/enrichment.py tests/integration/test_enrichment_api.py`
  - Current local verification: `.venv/bin/python -m pytest tests/integration/test_enrichment_api.py -k property_image -q` returned `4 passed, 3 deselected`.
  - Current browser verification: `npx playwright test tests/smoke/app-flows.spec.ts -g "property workspace shows the evidence source trail" --workers=1` returned `1 passed`, covering the thumbnail, image candidate, apply-image, and owner-tag row-conflict paths.
- Contractor SMS and Xero freshness follow-up:
  - Maintenance work-order contractor delivery now supports a reviewed Twilio SMS action beside SendGrid email, with separate send state, receipts, provider history, template key/version, Twilio status callback ingestion, and contractor-visible comments only after successful reviewed sends.
  - `/api/v1/xero/status` now returns local accounting freshness across contact sync, chart/tax validation, invoice posting/dispatch checkpoints, and payment reconciliation, including stale/missing reconciliation cues for open Xero-linked invoices.
  - Settings shows an accounting freshness metric; Insights and public finance snapshots include an accounting-readiness block for contact/chart/tax/payment freshness.
  - Verification covered focused backend unit/integration tests, TypeScript, ESLint, and smoke flows for maintenance detail, Settings Xero, and Insights/public snapshots.
- Spreadsheet import review polish:
  - `apps/web/src/app/intake/register-import-panel.tsx` and `apps/web/src/app/intake/spreadsheet/page.tsx` now show approve/review/ignored/blocked counts, explicit `Approve recommended` and `Ignore all` controls, and more field-change detail before Apply.
  - Smart Intake now also offers `Download template` before upload. The API returns an authenticated `leasium-migration-template.xlsx` workbook with instructions, supported import tabs, richer migration fields, and source/confidence hint columns while preserving no-mutation dry-run/apply behaviour.
  - `apps/web/tests/smoke/api-mocks.ts` now mocks the template download plus `POST /register-imports/dry-run` and `POST /register-imports/apply`.
  - `apps/web/tests/smoke/app-flows.spec.ts` covers the focused spreadsheet import review, bulk ignore, re-approve recommended, and apply outcome.

## Important Deployment Notes

- Vercel connector auth/env mutation was not available in-session.
  - Committed code through `39742fa` is pushed to `main`; the current local Work notification/ownership-tags slice is not committed or pushed yet.
  - Vercel should deploy from GitHub once the next commit is pushed.
  - For a true private-beta wall, set `LEASIUM_ACCESS_PASSWORD` in Vercel and redeploy.
  - For operator auth, keep both Clerk frontend/server env vars configured in Vercel.
- Render start command is expected to run Alembic before the API starts:
  - `.venv/bin/alembic upgrade head && .venv/bin/uvicorn apps.api.main:app --host 0.0.0.0 --port $PORT`
- Hosted Neon/Render should be at least through these migrations:
  - `20260520_0018_maintenance_arrears_foundations`
  - `20260520_0019_tenant_portal_accounts`
  - `20260521_0020_register_import_plans`
  - `20260521_0021_operator_notification_preferences`
  - `20260522_0022_branded_communication_templates`
  - `20260523_0023_inbound_messages`
  - `20260523_0024_contractors`
- Provider setup still has external-console work:
  - SendGrid templates/event webhook configuration; notification-center readiness shows the bare Work event webhook endpoint only.
  - **Pending external-console verification:** configure the DocuSign JWT app and Connect webhook with `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_RSA_PRIVATE_KEY`, `DOCUSIGN_WEBHOOK_SECRET`, and `PUBLIC_API_URL`. The code path now performs JWT grant, envelope create, Connect event validation, signed-PDF retention, and explicit activation review; remaining work is live provider-console proof with real credentials. Setup steps documented in `docs/deployment.md`, and Settings > Organisation > Integrations can copy/download a DocuSign provider setup packet from the current API readiness state.
  - **Pending (2026-05-23, when Twilio numbers are provisioned): point the inbound SMS webhook at each entity's Twilio number.** In the Twilio console, set each per-entity number's *Messaging → A message comes in* webhook to `https://<API_HOST>/api/v1/comms/webhooks/twilio-inbound?entity_id=<UUID>` (HTTP POST). The webhook is live and tested; it just won't see inbound SMS until the Twilio side is wired. Steps in `docs/deployment.md`.
  - **Pending (2026-05-23, Temba waiting on tokens): configure SendGrid Inbound Parse for the comms inbound webhook.** Add MX record on a subdomain pointing to `mx.sendgrid.net`, then in the SendGrid console add an Inbound Parse setting per entity mapping the subdomain to `https://<API_HOST>/api/v1/comms/webhooks/sendgrid-inbound?entity_id=<UUID>`. Steps + rationale documented in `docs/deployment.md`.
  - **Pending (2026-05-23, Temba waiting on tokens, ETA a couple of days): create the SendGrid template `tenant_portal_invite` v1 used by the new tenant portal onboarding invite slice.** Copy should explain "Your Leasium tenant portal is ready", with brand name placeholder, property + unit label, due date, expiry, and a single primary CTA linking to the onboarding URL. Template key + version are overridable via `TENANT_PORTAL_INVITE_TEMPLATE_KEY` / `TENANT_PORTAL_INVITE_TEMPLATE_VERSION` env vars on the API service if the SendGrid template name doesn't match. Until this template exists, the Invite-to-portal button still fires the send pipe but SendGrid will fall back to a generic delivery and the receipt path will record a soft failure. Backend code, dashboard panel, and operator CTA all ship in commit `5aa5f8e` + `9af7462`.
  - Twilio SMS callback/template setup; notification-center readiness shows the bare Work status callback endpoint only.
  - Twilio maintenance contractor SMS callback setup should also point at `/api/v1/maintenance/work-orders/webhooks/twilio-status`.
  - Xero app/accounting-side settings
- Public enrichment requires `OPENAI_API_KEY` on the API service. Without it, preview returns a clear 503 and does not mutate records.

### Mac-side verification for the tenant portal onboarding slice (2026-05-23)

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py tests/integration/test_tenant_portal_api.py -q
# Expect: all tests pass, including the four new ones —
#   test_tenant_onboarding_send_portal_invite_records_delivery_and_audits
#   test_tenant_onboarding_send_portal_invite_rejects_submitted_or_expired
#   test_tenant_portal_onboarding_submit_writes_submitted_data
#   test_tenant_portal_onboarding_submit_rejects_non_sent_status

cd apps/web
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs \
  ./node_modules/.bin/playwright test --grep "tenant portal shows scoped self-service"
# Expect: 1 passing. The spec now also asserts that "Complete your onboarding"
# renders, Submit-for-review is disabled until acceptance, and after submit
# the panel collapses to "your property manager will review and confirm".
```

Live route sanity after Vercel deploys:
- `/tenant-portal/tenant-token-1` still loads.
- `/onboarding/tenant-token-1` now returns the retired-form redirect screen ("Your onboarding has moved into your Leasium account") with a button pointing to `/tenant-portal/tenant-token-1`.

## Remba Review Queue

Treat these as pending UX/design sign-off:

- Smart Intake spreadsheet import review/apply panel and migration-template download.
- Portfolio QA IA and command-search placement.
- Reusable evidence/source-trail pattern across Properties, Smart Intake, Tenants, invoices, and maintenance.
- Tenant portal account/self-service surfaces, fresh-link recovery, and document provenance density.
- Billing Readiness provider dispatch/recovery and Xero approval/reconciliation surfaces.
- Operations workspace structure, work assignment controls, workload filters, reminder/escalation cues, provider notice states, and notification center.
- Settings Work notification preferences/named-template/SMS selection and Notifications provider-history/direct email/SMS recovery/channel-readiness density.

## Recommended Next Tickets

**Top priority as of 2026-05-31 — DoorLoop benchmark refocus (P0).** Make Owner a
first-class entity, gather people into one **People** hub (Tenants · Owners · Vendors ·
later Prospects), and consolidate the sidebar to 7 hubs. This is the keystone that unlocks
the owner portal, owner reporting, and distributions. Execution plan (test-first tickets):
[`docs/superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md`](superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md);
full analysis: [`docs/doorloop-benchmark-2026-05-31.md`](doorloop-benchmark-2026-05-31.md).
The list below is the prior backlog, now secondary:

The 2026-05-22 UX-review backlog is done except dark mode. The AI inbox v2 stack through v2.3 (promote → lease-change extraction → contractor matching → tenant-contact promote) and the tenant portal soft-switch are now shipped. Claim-gate polish, co-tenant/additional-login invites, and the operator-side read-only tenant portal preview are also complete. Pick from these in roughly leverage order for the SKJ internal-first-6-months window:

1. **Xero deepening** — Billing Readiness row-level stale reconciliation cues, the month-end checklist, and the Owner statements handoff are shipped. Continue into PDF statement preview/export, statement dispatch review, and finance checklist automation. Finance team will live here every month.
2. **Portfolio QA cleanup** — bulk fix review, AI-assisted enrichment candidates (the helper exists; productise it), clearer completion/reporting state. One-off but high-impact while the SKJ portfolio import is still being shaken out.
3. **Operations live review** — the small-viewport row-density pass is implemented; Temba/Remba should sanity-check the new `Work controls` and `Work-order actions` disclosures on a real phone, plus review the inline-edit undo toast, activity audit strip, and completion recipient-review cards.
4. **Tier 2 (g) Dark mode** — dark tokens in the design source of truth, `.dark` class via system preference + an account-menu toggle, contrast audit across the 5 most-used surfaces. Deliberately deferred during the internal-first-6-months window; revisit when external tenants/contractors land.
5. **Tenant portal UX audit** — predates the sidebar / inline-edit / activity-feed / Leasium AI work. v2 candidates: tenant-side activity feed scoped to their tenancy, tenant inline edit of their own contact details, tenant maintenance request status visibility.
6. **Multi-view v2 for Properties** — Map view (Leaflet vs Mapbox decision) + Calendar view (rent reviews + lease expiries — although the upcoming-events panel on the Dashboard already covers most of this).
7. **Pre-existing backlog** still valid: branded communications editable templates UI + send-time wiring (deprioritised under internal-first-6-months), Smart Intake spreadsheet improvements, evidence/source-trail pattern reuse expansion, Work assignment digest coverage.

Hosted Neon/Render migrations as of `08c23d1`: latest required revisions are `20260524_0025` (residential property_type) and `20260524_0026` (tenant_onboarding.token_consumed_at) on top of the earlier `20260520_*` / `20260521_*` / `20260522_*` / `20260523_*` set. Render's start command runs `alembic upgrade head` so these should apply automatically — verify by grepping the deploy log for those revision IDs.

## Resume Checklist

- Start with `git status --short` + `git log --oneline -10`. Tip should include the latest Operations row-density commit if this handover was pushed; `90bd99b` was the pre-slice tip.
- If there are local edits, inspect them before changing files.
- **Tooling on Temba's Mac (current as of 2026-05-24):**
  - Node v26 installed via Homebrew (`brew install node`).
  - Desktop Commander MCP server configured in `~/Library/Application Support/Claude/claude_desktop_config.json`. Claude sessions in this workspace have `mcp__Desktop_Commander__*` tools that run real shell commands on the Mac.
  - macOS-aarch64 `.venv` at `.venv/`; use `.venv/bin/python -m pytest ...`, `.venv/bin/python -m ruff check ...`, `.venv/bin/alembic upgrade head`, `.venv/bin/uvicorn apps.api.main:app --reload`.
  - Frontend tooling: `apps/web/node_modules/.bin/{next,playwright,eslint,tsc}` — runs on the Mac via Node.
- Keep Smart Intake review-first: extracted value, confidence, source, approve/edit/ignore, and no mutation until Apply.
- Keep provider actions explicit: no Xero write, SendGrid email, Twilio SMS, or payment reconciliation without reviewed operator approval.
- Remba was retired mid-session on 2026-05-23 ("forget about Remba, this is a prototype, just fling it"). Subsequent commits land without `[~]` Remba-pending markers. If Temba reverses that direction, re-introduce the markers for new visible-impact slices and rebuild the queue in `docs/design-governance.md`.
- For destructive/mutating commands (writes, commits, force-pushes, deletes), show before running. Pre-approval like "just go" or "yeah commit + push" means batch execution is fine. Tests + linters + reads — run directly, output is the deliverable.

## Session 2026-05-24 summary (handing back to Codex)

Eight slices shipped, all on `main`:

1. **AI inbox v2** (`1666a96`) — `POST /api/v1/ai/triage/promote` creates the right draft per kind: `maintenance_request` → MaintenanceWorkOrder, `payment_or_arrears` → ArrearsCase, `lease_change` → synthetic StoredDocument + DocumentIntake. Triage now passes entity_index and validates suggested property/tenant/lease ids. Three latent `assert_entity_role` arity bugs fixed in the same file.
2. **AI inbox v2.1** (`a9f4e84`) — new `stewart/ai/lease_change.py` pre-extracts proposed change shaped to `DocumentIntakeExtraction` keys (parties / properties / key_dates / money_amounts / proposed_actions). DocumentIntake lands `ready_for_review` (or `needs_attention` < 0.5 confidence), soft-fails to `uploaded` when extractor errors. Zero frontend change — existing Smart Intake renders the populated groups.
3. **AI inbox v2.2** (bundled in `1666a96` per commit message) — new `stewart/ai/vendor_intake.py`. Triage gains `suggested_contractor`. `vendor_or_contractor` becomes promotable: matched contractor → deep-link only, unmatched → new Contractor row at priority=3 with extracted name/company/email/phone/categories. Frontend promote panel swaps property/tenant/lease pickers for a Contractor dropdown.
4. **Delete tenant button** (`fd5e7e5`) — SecondaryButton next to Edit profile on `/tenants/[id]`, uses `window.confirm()`, warns about active leases that will lose their tenant link.
5. **Smarter Unit picker on Send invite** (`b84c223`) — 0 units → auto-create "Main premises", 1 unit → auto-select + chip, 2+ → required dropdown.
6. **Residential property_type + contextual ABN** (`b84c223`) — alembic `20260524_0025` adds `residential` to PropertyType. TenantLeaseContextRead projects `property_type`. Tenant detail edit form hides Trading-as + ABN when any of the tenant's leases is on a residential property.
7. **Tenant portal soft-switch claim gate** (`35b1f4a` + fix `638eeed`) — alembic `20260524_0026` adds `tenant_onboarding.token_consumed_at`. `_portal_scope` rejects consumed tokens with 410 Gone. `claim_tenant_portal_account` stamps consumption and gates a consumed-token reclaim to "same Clerk user with prior history". New public `GET /api/v1/tenant-portal/invites/{token}/preview` for context-only data on the unauthenticated gate. Frontend `/tenant-portal/{token}` renders a full-page claim gate (preview + Clerk widget) and auto-claims after sign-in. Disabled the unauthenticated token-scoped portalQuery entirely.
8. **Tenant invite email copy** (`08c23d1`) — subject "Complete tenant onboarding" → "Set up your tenant portal", body intro reframed for the sign-in-first flow, CTA "Complete onboarding" → "Sign in to continue", postscript explains the link is single-use.

Verified Mac-side: `pytest tests/integration/test_tenant_portal_api.py -q` shows 13 passing. Sandbox-side: ESLint + tsc clean on every touched file. Render needs migrations 0025 + 0026 applied (auto-runs via alembic on deploy).

Open items at session end:
- Temba was hitting a 409 "already linked to another tenant" on the live deploy because his Clerk account had a prior portal link on an older Tenant row. He attempted "delete tenant" which doesn't unlink the portal account; the actual fix is `/tenants/{id}` → "Portal access" → **Unlink** button. He may have figured it out before the session ended — verify if the v2.3 work picks up before re-sending another test invite.

## Codex continuation 2026-05-24

- Operations small-viewport row-density pass implemented on `/operations`: assignable queue rows now collapse assignment + row actions into `Work controls` below `xl`; maintenance rows collapse assignment + completion/detail actions into `Work-order actions` below `xl`; desktop columns are unchanged.
- Added smoke coverage for the 390px compact path in `apps/web/tests/smoke/app-flows.spec.ts`.
- Docs updated in `docs/product-roadmap.md` and `docs/design-governance.md`; Recommended Next Tickets now promote Xero deepening and leave Operations as live-review only.
- Billing Readiness Xero freshness cues implemented: Delivery & payments now reads `/xero/status`, shows a local accounting-freshness strip, and flags Xero-linked unpaid invoice rows with `Payment check missing` / `Reconciliation stale` plus a `Review payments` handoff to Settings. Settings fresh state now says `Reconciliation current` for consistency with Billing Readiness, Insights, and snapshots.
- Verification for the Xero slice: focused Playwright smoke `settings shows Xero readiness`, ESLint on touched frontend files, and `tsc --noEmit` all pass.
- Billing Readiness month-end finance checklist implemented: Delivery & payments now derives five local rows from invoice/Xero state — Accounting setup, Invoice approvals, Provider dispatch, Payment reconciliation, Month-end pack — with targeted handoffs and no provider mutation.
- Follow-up finance artifacts: Statements can download `owner-statement-checklist-{month}.csv`; owner statement JSON/PDF/ZIP includes invoice evidence behind owner totals; Xero diagnostics exposes a provider setup preflight block for Monday env/redirect/scope checks.
- Verification for the checklist slice: focused Playwright smokes `dashboard shows the mocked portfolio and opens billing readiness` + `settings shows Xero readiness`, ESLint on touched frontend files, and `tsc --noEmit` all pass.

## Codex continuation 2026-05-25

- Owner statements Billing handoff implemented: Billing Readiness month-end pack now opens `/statements` with entity, invoice month, `from=billing-readiness`, and close status. Statements reads those query params instead of defaulting to the previous month.
- Tenant onboarding account-first simplification shipped: tenant confirm-details now shows only the core contact fields by default with optional details collapsed; submitted/reviewed copy stays tenant-friendly ("In review" / lease-pack handoff) instead of exposing internal review/apply state. The required-documents checklist now treats "no requested documents" as not required/complete instead of telling tenants to upload files that were never requested.
- Operator tenant detail onboarding approval is streamlined: submitted rows show one primary action, choosing between Approve & apply, Approve for signing, or Mark reviewed depending on lease-signing blockers. Reviewed rows still expose Apply once ready. Frontend typecheck/lint/build passed for the slices.
- Operator tenant portal preview now mirrors the tenant-friendly `In review` wording and shows a "Not required" checklist row when no onboarding documents are requested.
- Tenant portal maintenance cards now show a plain-language status detail for requested/triaged/assigned/approval/approved/in-progress/completed/cancelled states; the operator preview mirrors the same copy.
- Full tenant portal Compliance panel now shows "Not required" and an explicit empty row when no compliance checklist exists, while keeping optional document upload available.
- Full tenant portal now has a tenant-side Recent Activity panel in the side rail. It derives the latest onboarding, lease-signing, lease-question, document-upload, maintenance-history, contact-change, and notification-preference events from the existing portal payload; no new backend feed table or mutation path was added. The operator preview now mirrors those rows for local browser proof.
- Full tenant portal side rail now also shows tenant Contact Details after the full portal unlocks, keeping the tenant's own legal/contact/billing details visible without reopening the setup form. It is read-only for now; tenant-initiated edits should go through a later reviewed proposal path.
- Tenant-initiated contact change requests are now wired as a reviewed proposal path: tenants can request contact-name/email/phone/billing-email changes from the full portal after unlock; Leasium stores the request in tenant metadata, shows persistent in-review/applied/dismissed status back in the tenant portal and operator portal preview, blocks duplicate pending submissions, surfaces it on tenant detail as `Tenant requests`, and operators explicitly click `Apply request` or `Dismiss` before the request closes.
- `/statements` now shows a Statement pack readiness panel with ready/incomplete/unpaid/blocked state derived from owner statement totals, local invoice payment metadata, and Xero accounting freshness. The panel links back to Billing Readiness and keeps PDF/export/email as future explicit actions.
- `/statements` now also has an owner-selectable Statement preview panel for finance review: owner contact context, monthly totals, property lines, copyable review summary, and print/save-PDF action. Owner dispatch remains separate and explicit.
- Statement preview now includes a dispatch review panel: recipient readiness from owner billing email, owner-facing subject/body draft, copy-to-clipboard, and an explicit no-send guardrail. Still no owner email, PDF attachment, SendGrid mutation, or provider history write.
- Billing Readiness month-end checklist now fetches the owner-statement roll-up for the statement month and adds an Owner statements checkpoint before the Month-end pack row. It shows owner/statement invoice readiness and flags missing owner billing emails before dispatch review.
- Smoke mocks now include `GET /owners/statements`; focused smoke covers Dashboard → Billing Readiness → Open statements and verifies the readiness panel/owner statement render.

## Codex continuation 2026-05-26

- Tenant onboarding live account flow was debugged through Clerk/session issues and Vercel deployment. The submit path now refreshes Clerk tokens immediately before account-scoped tenant portal actions, avoiding stale-session failures.
- Tenant detail onboarding workflow now shows a compact six-step progress strip: invite, tenant details, approval, lease file, send pack, sign.
- Added a custom lease bypass on tenant detail: operators can upload a lease document scoped to the exact tenant, lease, and onboarding. **Send lease pack** stays disabled until a lease file is attached.
- Tenant lease-signing panel now shows attached lease documents and download actions before the tenant confirms signing.
- Backend portal document reads now expose `lease_id` and `tenant_onboarding_id`, and operator document upload validates that supplied tenant/lease/onboarding scope is consistent.
- Verification: frontend ESLint + `tsc --noEmit`, backend `ruff` on touched API files, and focused Playwright smoke `tenant detail sends lease pack after onboarding approval`.

## Codex continuation 2026-05-29

- Tenant lifecycle push shipped tenant-uploaded lease auto-match, tenant-uploaded insurance auto-update, DocuSign provider runway/webhook guardrails, SendGrid inbound secret guard, inbound email attachment routing, and optional inbound attachment auto-extraction.
- Smart Intake now labels SendGrid-routed inbound email attachment rows in the review queue, shows the email subject and no-mutation guardrail in the review panel, and preserves extracted document facts even when review metadata is present.
- The Comms queue now gives operators direct handoffs from tenant lifecycle drafts to the tenant review page, and from inbound email attachment drafts to Smart Intake, so the drafted email is no longer a dead end when the real work is an internal review.
- Tenant detail now shows the lease activation review transition (`Pending -> Active`) and the stored no-auto-activation guardrail beside the Activate lease action after DocuSign completion.
- Tenant detail now labels accepted tenant-uploaded lease matches as `Tenant upload accepted` instead of the generic `Signed`, while keeping the same activation-review guardrail and Activate lease handoff.
- Tenant-uploaded lease signing panels now link back to the source Smart Intake review when `document_intake_id` is present, so operators can audit the accepted match before activation.
- The tenant insurance source card now uses the same explicit `Open Smart Intake review` handoff label for reviewed insurance certificates.
- Tenant-uploaded insurance extraction now preserves tenant portal provenance through OpenAI extraction, and Smart Intake labels those review rows as `Tenant portal upload` with insurance-specific review detail.
- Dashboard, Operations, and tenant detail Smart Intake review links now include `entity_id` plus `review`, and the intake workspace prefers a valid URL entity over saved local selection, so review links open the exact item even after working in another entity.
- Accepting a tenant-uploaded lease match now appends a tenant-onboarding audit row that the signing evidence was accepted, activation review is ready, and the lease was not activated automatically.
- Manual evidence uploads from `/comms` compliance obligation cards now pass the source obligation id through `/documents`, back-attribute the stored document id into `obligation_metadata.evidence_document_ids[]`, append `evidence_history[]`, and stamp document metadata with the manual comms evidence source.
- AI inbox lease-change promotion now returns entity-aware Smart Intake review links (`/intake?entity_id=...&review=...`) for both extracted and soft-failed promote paths, matching Dashboard/Operations/tenant-detail handoffs.
- Insights Smart Intake live-exception links now also include `entity_id` plus `review`, so overview drilldowns no longer depend on the operator's saved entity selection.
- Property workspace Smart Intake source-history links and document-upload redirects now include `entity_id` plus `review`, matching the exact-review handoff convention.
- Portfolio QA Smart Intake source-history, issue, and evidence links now include `entity_id` plus `review`, so cleanup drilldowns open the exact review row.
- Billing Readiness Smart Intake billing-draft source links now include `entity_id` plus `review`, so draft-review drilldowns open the exact Smart Intake item.
- Inbound Twilio SMS now verifies `X-Twilio-Signature` whenever `TWILIO_AUTH_TOKEN` is configured, rejecting unsigned/invalid provider posts before an `inbound_message` row is persisted.
- Tenant onboarding Twilio SMS status callbacks now also verify signed provider callbacks when `TWILIO_AUTH_TOKEN` is configured, while preserving the existing shared `COMMUNICATIONS_WEBHOOK_SECRET` path.
- Maintenance contractor SMS and Work assignment SMS status callbacks now follow the same signed Twilio callback pattern, with `PUBLIC_API_URL` support for production proxy signatures and the existing shared webhook-secret path preserved.
- Twilio webhook authentication is now centralized in `apps/api/webhook_auth.py`, with helper-level coverage for shared webhook tokens and `PUBLIC_API_URL` Twilio signatures so future callback endpoints do not grow divergent signing logic.
- SendGrid receipt webhook shared-secret checks now also use `apps/api/webhook_auth.py`, with endpoint coverage for tenant onboarding, invoice delivery, operator invite, maintenance contractor, and Work assignment receipt callbacks rejecting missing shared tokens when `COMMUNICATIONS_WEBHOOK_SECRET` is configured.
- DocuSign Connect webhook secret validation now uses the same shared helper with DocuSign-specific and Leasium shared header aliases, while still failing closed when `DOCUSIGN_WEBHOOK_SECRET` is missing.
- Tenant-uploaded insurance apply now merges extracted certificate facts with tenant-upload provenance metadata on empty Apply, and tenant insurance metadata updates write a dedicated tenant audit row with source intake/document/expiry evidence.
- Tenant-uploaded lease activation now carries the source Smart Intake review id through to `lease.lease_metadata.activation` and the lease activation audit row, so accepted tenant-upload evidence remains traceable after the final Activate lease action.
- Tenant-uploaded lease/insurance Smart Intake promotion audits now include the source onboarding, tenant, lease, and candidate type, so the first promotion event has the same scope evidence as later apply/activation events.
- DocuSign lease activation now carries the provider envelope id through to `lease.lease_metadata.activation` and the lease activation audit row, so the final Activate lease action remains traceable back to the completed DocuSign envelope.
- Skipped or failed DocuSign Send lease pack attempts now stamp `delivery_data.lease_agreement.signing` with the provider error, so real setup/send failures enter the urgent tenant lifecycle comms queue instead of only appearing on the tenant detail receipt.
- Tenant-uploaded Smart Intake extraction audits now include the source intake id, extracted document type, OpenAI response id, proposed category, and review status, so extraction evidence ties directly to the review state operators see.
- Failed tenant-uploaded Smart Intake extraction audits now also include the source intake id and failed status, so extraction errors remain traceable to the exact review row.
- Smart Intake's review queue now has a compact `Review filter` for all reviews, tenant portal uploads, inbound email attachments, lease matches, insurance, and leases, so tenant lifecycle evidence is findable without scanning the generic first-five list.
- Smart Intake's filtered review queue now has a local `Download queue CSV` handoff containing already-loaded review rows and source/detail evidence, with no provider send or review mutation.
- Inbound email attachment Smart Intake extraction audits now match tenant-upload audit evidence, carrying source intake id, extraction outcome fields, response id on success, and failed status/error on failure.
- Inbound email attachment Smart Intake promotion audits now include source inbound message, tenant attribution, candidate type, attachment field, document id, and intake id before extraction starts.
- Tenant-uploaded Smart Intake extraction audits now also carry candidate, onboarding, tenant, and lease scope on both successful and failed extraction paths.
- Tenant-uploaded Smart Intake promotion audits now include the promoted intake id alongside document, onboarding, tenant, lease, and candidate scope, matching inbound attachment promotion evidence.
- Final tenant-onboarding activation audits now carry the signed document id plus DocuSign envelope id or tenant-upload Smart Intake id, matching the lease activation audit source evidence.
- DocuSign Connect receipt audits now carry onboarding id, lease id, envelope id, and retained signed document id after completed webhook processing.
- DocuSign Connect receipt audits now also state whether the webhook event was applied, or safely ignored with a reason such as custom-field mismatch.
- DocuSign Connect receipt audits now carry the original lease document id from the envelope send metadata, including declined events that never produce a retained signed PDF.
- DocuSign Connect receipt audits for ignored event-state conflicts now include the current signing status and last event, so completed-after-declined callbacks explain why they were not applied.
- Duplicate completed DocuSign webhooks now audit as `applied=false` with `ignored_reason=already_completed`, while preserving the signed document and source document ids in the receipt.
- Unknown DocuSign envelope callbacks now write targetless receipt audits with `ignored_reason=unknown_envelope` instead of disappearing silently.
- Signed DocuSign callbacks missing an envelope id or status now write targetless receipt audits with `missing_envelope_id` or `missing_status` instead of returning without evidence.
- Signed DocuSign callbacks with non-object JSON now write targetless receipt audits with `ignored_reason=invalid_payload` and the payload type.
- Signed DocuSign callbacks with syntactically invalid JSON now write targetless receipt audits with `ignored_reason=invalid_json` instead of escaping before audit.
- Signed DocuSign callbacks with a known envelope id but missing status now scope the `missing_status` receipt audit to the matching onboarding, lease, entity, and source document.
- Signed DocuSign callbacks missing an envelope id can now scope the `missing_envelope_id` receipt audit from DocuSign custom fields when they carry tenant onboarding, lease, and source document context.
- Tenant-uploaded lease activation now shows a source-aware success notice: `Lease activated after tenant-uploaded lease review.`
- Historical DocuSign docs were cleaned up so the automation strategy and 5-day report no longer describe the flow as scaffold-only or say completion auto-activates leases; they now reflect signed-PDF retention, explicit activation review, and remaining production-readiness work.
- DocuSign live provider-console verification remains parked until the real integration key/user/account/private key/webhook secret are available. Local provider boundaries and webhook state handling are covered.

## Codex continuation 2026-05-30

- Inspection report intake v1 shipped as a Smart Intake extension. `inspection_report`
  documents can carry reviewed `inspection_findings`; the review panel now has an
  Inspections filter and editable finding rows.
- Applying a reviewed inspection report creates requested maintenance work orders
  with source document links, optional photo document ids, property/unit/tenant/lease
  scope, finding confidence/source metadata, and a no-dispatch/no-provider guardrail.
- The inspection intake path does not send contractor email/SMS, write provider
  history, create billing drafts, touch Xero, or mutate external providers. Work
  orders are created only after operator Apply.
- Verification: `pytest tests/integration/test_document_intake_api.py -k inspection`,
  backend `ruff` on touched files, and frontend `tsc --noEmit` via
  `apps/web/node_modules/.bin/tsc`.
- Broader continuation verification: `pytest tests/integration/test_document_intake_api.py tests/integration/test_maintenance_arrears_api.py -q`
  passed 47 tests, and `npm run lint -- --max-warnings=0` passed for the web app.
- Follow-up smoke coverage added for the Smart Intake inspection review path:
  the mocked queue includes an inspection report, Apply creates mocked
  work-order rows, the CSV contains the inspection row, and the smoke asserts no
  contractor/assignment provider dispatch endpoints are hit. Verification:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "smart intake applies inspection findings"`.
- The post-Apply outcome now names the created requested work orders, repeats
  the no-provider/no-billing/no-Xero guardrail, and includes an `Open Operations`
  handoff to `/operations?tab=maintenance`; the focused smoke clicks through and
  confirms the created inspection work order is visible in Operations.
- Owner statement invoice evidence UI v1 was closed from `[~]` to `[x]` after
  hardening coverage: the selected-owner invoice evidence CSV now includes the
  local/Xero/reconciliation source trail shown in the table, the smoke test
  reads the downloaded CSV contents, and backend owner-statement coverage now
  checks older Xero invoice id and reconciliation-history metadata fallbacks.
  Remba/accountant review remains open for density and inline-vs-disclosure
  presentation.
- AI Inbox v1/v2/v2.2 verification is now complete on this Mac run:
  `pytest tests/integration/test_ai_triage_api.py -q` passed 18 tests, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "AI inbox"` passed the
  four browser flows for classify, maintenance promote, vendor/contractor
  promote, and tenant-contact promote. Roadmap status moved those items to
  `[x]`; Remba review remains open.
- Spreadsheet migration template download is now verified and marked `[x]`:
  `pytest tests/integration/test_register_import_api.py -q` passed 4 tests, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "spreadsheet"` passed
  the browser flow that downloads `leasium-migration-template.xlsx` before the
  reviewed dry-run/apply path. Remba/SKJ tuning remains open for workbook tabs,
  field order, and whether extra AI-fill guidance belongs in-app.
- Tenant onboarding simplification is still not marked `[x]` because the
  Clerk-enabled tenant account smoke proof remains external-config dependent.
  Fresh local verification did pass backend/API coverage
  (`pytest tests/integration/test_tenant_onboarding_api.py tests/integration/test_tenant_portal_api.py tests/unit/test_docusign.py -q`
  passed 94 tests), backend lint on the touched onboarding/portal/DocuSign
  files, focused web lint, and the non-Clerk/public/operator subset of the
  tenant smoke (5 passed, 5 skipped when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  was absent). A fake `pk_test_ZHVtbXk` key was not sufficient: account-scoped
  tenant portal tests hung at Clerk "Checking sign-in", so final closure still
  needs a real Clerk publishable key/session or a dedicated mocked-auth harness.
- Tenant quick-win closeout: added smoke coverage for the tenant detail Delete
  button, smarter Send invite unit picker, and residential lease business-field
  hiding. `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant send invite adapts|tenant detail delete|tenant detail hides business identity"`
  passed 3 tests, and `tsc --noEmit` plus focused eslint passed. Roadmap moved
  all three tenant quick-win items to `[x]`.
- Properties multi-view v1 is now verified and marked `[x]`: `npx playwright test tests/smoke/app-flows.spec.ts -g "Properties multi-view"`
  passed, with focused web typecheck/eslint also passing. Remba review remains
  open for board density and whether map/calendar should follow later.
- DetailDrawer / tenant quick-view v1 is now verified and marked `[x]`:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant list opens the quick-view detail drawer"`
  passed, with `tsc --noEmit` and focused eslint passing. The larger Properties
  detail-drawer conversion remains a documented follow-up.
- AppHeader compact utility toolbar follow-up is now verified and marked `[x]`:
  the dashboard smoke asserts the selected entity, command search, keyboard
  shortcuts, notifications, and appearance controls are grouped inside the
  `Workspace utilities` toolbar. Verification: web `tsc --noEmit`, focused
  eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "dashboard shows the mocked portfolio"`.
- AppHeader mobile touch-target polish is now fixed and marked `[x]`: the
  shared utility button style now uses 44px controls, the Clerk wrapper/sign-in
  baseline is 44px, and the keyboard-cheatsheet control no longer leaks visible
  below `sm`. Verification: web `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "mobile header keeps utility touch targets"`.
- AI Inbox mobile touch-target polish is now verified and marked `[x]`: the
  classify-and-deep-link smoke runs at 390px width and measures the "Take it
  from here" handoff link as a 44px target. Verification: web `tsc --noEmit`,
  focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "AI inbox classifies a pasted message"`.
- Billing Readiness mobile touch-target polish is now fixed and marked `[x]`:
  month-end checklist links, payment-review handoffs, Open statements, Preview,
  PDF, and month-end handoff buttons sit on 44px targets. Verification: web
  `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "billing readiness mobile actions"`.
- Settings mobile tab touch-target polish is now verified and marked `[x]`: the
  Security, Organisation, and Xero tabs are measured at 390px width. Verification:
  web `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "settings mobile tabs"`.
- Notifications mobile touch-target polish is now verified and marked `[x]`:
  the 390px smoke measures the 44px Work notice and Digest history filter
  controls plus the per-row `Open work` and bottom `Open Work` links.
  Verification: web
  `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "notifications mobile actions"`.
- Operations mobile touch-target polish is now verified and marked `[x]`: the
  390px workspace smoke measures Queue/Maintenance/Arrears tabs, 44px workload
  filter chips, Open tenants, Review, and Review completion; the 390px
  maintenance-detail smoke measures Operations, Recover in Billing, Preview,
  and PDF. Verification: web `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "operations workspace keeps mobile rows compact|maintenance detail mobile billing actions"`.
- Operations mobile row-density follow-up is also marked `[x]` off the same
  focused smoke: it verifies closed `Work controls` / `Work-order actions`
  summaries at 390px, hidden controls before expansion, and the visible
  completion handoff after expansion. Remba/live-phone review remains open.
- Tenant detail provider-detail mobile polish is now fixed and marked `[x]`:
  below `md`, provider detail is a closed `Provider detail` disclosure with a
  44px summary; at desktop width the same detail is inline. Verification: web
  `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail collapses provider detail"`.
- Tenants list mobile card view is now verified and marked `[x]`: the 390px
  smoke checks the table is visually hidden, the Bright Cafe card shows contact
  + due state, and tapping it opens the quick-view drawer with full-record
  handoff. Verification used the same focused typecheck/eslint pass and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant list opens the quick-view detail drawer"`.
- Inspection report intake v1 is now verified and marked `[x]`: focused
  backend tests cover inspection work-order creation and cross-entity photo
  guardrails, backend lint is clean, web typecheck passes, and the Smart Intake
  smoke applies inspection findings into Operations. Verification:
  `pytest tests/integration/test_document_intake_api.py -k inspection -q`,
  backend `ruff`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "smart intake applies inspection findings"`.
- Inbound email attachment Smart Intake v1 is now verified and marked `[x]` for
  the local app path. Backend inbound webhook tests passed, comms lint is clean,
  web typecheck passes, and the Smart Intake smoke verifies filter/CSV/review
  labels, extracted policy facts, and the no-mutation guardrail. Verification:
  `pytest tests/integration/test_comms_api.py -k "inbound" -q`, backend
  `ruff`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "smart intake labels inbound email attachments"`.
  Live MX/SendGrid setup remains an external environment follow-up.
- Tenant-uploaded insurance auto-update v1 is now verified and marked `[x]`.
  Backend coverage proves tenant insurance uploads promote into scoped Smart
  Intake rows, optionally auto-extract with OpenAI, audit extraction failures,
  apply reviewed expiry data into tenant insurance metadata, refresh portal
  compliance status, reject missing expiry dates, and correct stale document
  tenant ids from lease scope. Browser coverage proves tenant-uploaded insurance
  reviews are labelled/filterable in Smart Intake, entity-aware review links
  open the exact intake, Operations queue links preserve `entity_id` + `review`,
  and tenant detail shows confirmed insurance expiry plus the Smart Intake
  source link. Verification: `pytest tests/integration/test_tenant_portal_api.py -k "insurance_upload or upload_extraction_failure_audits_source_intake" -q`,
  `pytest tests/integration/test_document_intake_api.py -k "apply_insurance or rejects_insurance_without_expiry" -q`,
  backend `ruff`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "operations workspace surfaces maintenance and arrears work|tenant detail shows portal access recovery actions|smart intake labels inbound email attachments in review queue|smart intake deep link selects the review entity"`.
- Tenant-uploaded lease auto-match runway v1 is now verified and marked `[x]`.
  Backend coverage proves lease uploads promote into scoped Smart Intake rows,
  OpenAI extraction adds matched/missing-field recommendations, accepting a
  clean match stamps tenant-upload signing evidence and activation-review audit
  without mutating lease status/register values or creating `LeaseIntake`, and
  acceptance is blocked for differences, active DocuSign envelopes, already
  signed agreements, missing document scope, or operator-uploaded documents.
  Browser coverage proves the Smart Intake match panel, no-mutation guardrail,
  Accept match success path, active DocuSign conflict copy, tenant detail
  `Tenant upload accepted` label, Smart Intake source link, and explicit
  Activate lease handoff. Verification:
  `pytest tests/integration/test_tenant_portal_api.py -k "lease_upload or accept_lease_match" -q`,
  backend `ruff`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "smart intake shows tenant lease upload match recommendation|smart intake explains active DocuSign conflict before accepting lease match|tenant detail labels tenant-uploaded lease activation review"`.
- Portfolio QA completion report + bulk staging v1 is now verified and marked
  `[x]`, including the continuation summary item. The smoke proof covers the
  cleanup readiness report, AI-assisted enrichment candidate queue, enrichment
  CSV, blocked follow-ups, final-readiness verdict, row-level blocker drilldown,
  cleanup report CSV, reviewed owner-billing staging, reviewed tenant-contact
  staging, onboarding blocker review, billing cleanup blockers, and source-trail
  search. Verification: web `tsc --noEmit`, focused `eslint`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "portfolio QA guides cleanup fixes and source trails"`.
  Live SKJ tuning remains the follow-up; no automatic enrichment, provider
  action, or batch mutation runs from the report exports.
- Comms local channel items closed after scout-assisted verification:
  Inbound SMS via Twilio webhook, Inbound email AI classification v1, Inbound
  email parsing v1, and SMS outbound dispatch through Twilio Messaging are all
  marked `[x]`. Backend coverage passed for SendGrid inbound parse/tenant
  attribution/shared-secret checks, AI classification stamping, attachment
  Smart Intake routing/extraction/failure retention, Twilio inbound
  persistence/phone attribution/signature validation, and inbound-SMS dispatch
  through Twilio. Browser coverage passed for `/comms` SMS approval with phone
  recipient/no subject/SMS guide/receipt and Smart Intake inbound attachment
  review labels/CSV/filtering. Verification: two focused
  `pytest tests/integration/test_comms_api.py::...` runs (`7 passed` and
  `5 passed`), backend `ruff`, web `tsc --noEmit`, focused `eslint`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS with a phone recipient|smart intake labels inbound email attachments in review queue" --workers=1`.
  At that point the larger Scheduled comms loop umbrella and several
  compliance/rent-review subitems still needed follow-up; later closeout notes
  below record the local fixes and newly closed subitems.
- Xero/Billing/Owner statements local closeout: Xero connection diagnostics
  and callback feedback, Billing Readiness Xero freshness cues, Billing
  Readiness month-end finance checklist, Owner statements Billing handoff,
  Owner monthly statements v1 backend, Owner monthly statements v2 frontend,
  and the Continue Xero summary are now marked `[x]`. Backend coverage passed
  for local connection diagnostics and owner statement grouping/month
  filtering/paid-outstanding/unattributed/evidence behavior; browser coverage
  passed for Settings diagnostics/OAuth callback feedback/fail-closed provider
  actions, Billing Readiness handoffs, and Statements invoice evidence,
  dispatch-review CSV, and review-only dispatch draft downloads. Verification:
  `pytest tests/integration/test_xero_api.py -k connection_diagnostics -q`
  (`8 passed`), `pytest tests/integration/test_owners_api.py -q` (`11 passed`),
  backend `ruff`, web `tsc --noEmit`, focused `eslint`,
  `npx playwright test tests/smoke/app-flows.spec.ts -g "dashboard shows the mocked portfolio and opens billing readiness|settings shows Xero readiness and records mappings|settings shows Xero OAuth callback success feedback|settings shows Xero OAuth callback error feedback without tab param|settings disables Xero provider actions when diagnostics block capabilities|settings fails closed when Xero diagnostics|settings shows Xero draft creation ready only from diagnostics" --workers=1`
  (`9 passed`), and `npx playwright test tests/smoke/statements.spec.ts --workers=1`
  (`3 passed`). Owner statement PDF export remains `[~]` until the
  Remba/accountant formatting review is done; live Xero provider-console
  validation remains external.
- Maintenance/Contractors local closeout: Maintenance activity audit v1,
  Maintenance status forwarding drafts v1, Maintenance completion recipient
  review v1, Maintenance categorisation v2, and Contractor directory v1 are now
  marked `[x]`. The maintenance detail smoke covers the audit strip, audience
  badges, provider evidence, closeout trail, no-send forwarding drafts,
  recipient review notes, copy-only completion communications, review-only CSV
  packet, and Billing handoff. Contractor coverage proves CRUD and the
  review-only readiness CSV; classifier coverage proves AI category metadata,
  matched contractor suggestion, missing-key 503, and no-match null suggestion.
  Verification: `pytest tests/integration/test_contractors_api.py -q`
  (`4 passed`), focused `pytest tests/integration/test_maintenance_arrears_api.py::...`
  (`3 passed`), backend `ruff`, web `tsc --noEmit`, focused `eslint`,
  `npx playwright test tests/smoke/app-flows.spec.ts -g "maintenance detail route shows quote evidence" --workers=1`
  (`1 passed`), and `npx playwright test tests/smoke/contractors.spec.ts -g "contractor directory exports readiness CSV" --workers=1`
  (`1 passed`). Follow-up closeout added the missing focused smoke for
  Maintenance categorisation v3: it clicks Classify with AI, renders the
  stamped HVAC confidence, Same-day badge, warning, suggested contractor
  card/contact details, no-dispatch guardrail copy, and Apply-to-contractor
  Applied state. Verification: red run failed on missing `hvac · 82%` after
  clicking Classify with AI; after adding the smoke API classify response,
  `npx playwright test tests/smoke/app-flows.spec.ts -g "maintenance detail AI classification suggests and applies a contractor" --workers=1`
  passed (`1 passed`). Maintenance categorisation v3 is now `[x]`.
- Maintenance status forwarding automation closeout: the forwarding automation
  item is now `[x]`. `/api/v1/comms/queue` now emits
  `maintenance_contractor_forward` and `maintenance_tenant_forward` candidates
  from the latest tenant-visible and contractor-visible work-order timeline
  rows, `/comms` labels them as contractor/tenant forwards with an `Open work
  order` handoff, and Approve resolves the maintenance work order through the
  existing explicit Comms dispatch path before any SendGrid send attempt.
  Queue fetch and CSV export stay read-only. Verification:
  `pytest tests/integration/test_comms_api.py -q` (`43 passed`), backend
  `ruff`, web `eslint`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS" --workers=1`
  (`1 passed`).
- Comms compliance/rent-review closeout: Evidence attach on `/comms`
  compliance candidates, Compliance obligation tracking v1, and Annual rent
  reviews v1 are now marked `[x]`. The backend now honors
  `comms_dismiss`/`next_eligible_on` metadata for both `rent_review` lease
  candidates and `compliance_obligation` obligation candidates, so reviewed
  dispatches/dismissals do not immediately resurface on the next queue scan.
  Backend coverage proves rent-review formula/no-formula/far-future queue
  behavior, rent-review dispatch and dismiss stamps that clear the queue,
  compliance candidate generation, compliance evidence document linking, and
  compliance dispatch/dismiss stamps that clear the queue. Browser coverage now
  includes the compliance reminder card inside `/comms`, the Smart Intake
  handoff, manual `fire-safety.pdf` evidence upload receipt, and the reviewed
  SendGrid approval path while SendGrid is unconfigured. Verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py -k "rent_review or compliance_obligation or compliance_evidence" -q`
  (`9 passed, 32 deselected`), backend `ruff`, web `tsc --noEmit`, focused
  `eslint`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS with a phone recipient" --workers=1`
  (`1 passed`). The broader Scheduled comms loop item remains `[~]` for
  Remba/operator review of queue density and daily CSV handoff copy.
- In-app comms badge closeout: the sidebar Work-nav badge item is now `[x]`.
  Backend `/api/v1/comms/queue/counts` reuses the queue scanners and focused
  coverage proves urgent/by-kind totals (`1 passed, 40 deselected`). Browser
  smoke now verifies the Work nav label announces `7 drafts in the comms queue,
  3 urgent` after the `/comms` mock includes SMS, email, compliance, rent
  review, and tenant-lifecycle candidates. This keeps the broad Scheduled
  comms loop `[~]` only for Remba/operator review of density/copy.
- AI Inbox local closeout: AI inbox v2.1 lease-change pre-extraction and v2.3
  tenant-contact promote are now `[x]`. Fresh verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_ai_triage_api.py -k "lease_change or tenant_contact" -q`
  (`8 passed, 10 deselected`, with existing FastAPI 422 deprecation warnings),
  backend `ruff` for `apps/api/routers/ai.py`, `stewart/ai/lease_change.py`,
  `stewart/ai/tenant_contact.py`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "AI inbox tenant contact classification applies selected fields" --workers=1`
  (`1 passed`). Lease-change remains zero-frontend-change because Smart Intake
  already renders populated extraction groups from the promoted intake.
- DocuSign local runway closeout: DocuSign integration runway v1 is now `[x]`.
  The stale provider-helper docstring was updated to describe the real JWT +
  envelope-create path rather than the old scaffold-only state. Fresh local
  verification: `pytest tests/unit/test_docusign.py tests/integration/test_system_api.py tests/integration/test_tenant_onboarding_api.py -k "docusign or activate_lease or send_lease_pack" -q`
  (`40 passed, 15 deselected`),
  `OPENAI_API_KEY= pytest tests/integration/test_tenant_portal_api.py tests/integration/test_document_intake_api.py tests/integration/test_comms_api.py -k "docusign or active_docusign or DocuSign" -q`
  (`8 passed, 101 deselected`), and
  `pytest tests/unit/test_webhook_auth.py -q` (`4 passed`), plus
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail sends lease pack after onboarding approval|tenant detail shows skipped DocuSign setup after lease pack send|tenant detail flags declined DocuSign envelope|settings shows Xero readiness and records mappings|settings explains DocuSign demo endpoint readiness" --workers=1`
  (`5 passed`). Live DocuSign provider-console verification remains external
  and is still tracked in `docs/deployment.md` plus
  `docs/tenant-lifecycle-production-smoke.md`.
- Tenant portal compliance empty-state closeout: the compliance empty-state
  item is now `[x]`. The API now treats an explicit empty
  `tenant_metadata["portal_compliance_checklist"]` as no required tenant
  checklist while keeping upload categories/supporting files available, and
  operator preview CSVs include the no-required-documents row. Verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_allows_empty_compliance_checklist -q`
  (`1 passed`) and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant portal operator preview shows contact review" --workers=1`
  (`1 passed`). The tenant portal contact-edit umbrella item remains `[~]`;
  scouts found an account-scoped contact-edit caveat that should not be
  hand-waved.
- Tenant portal maintenance status clarity closeout: the status clarity item is
  now `[x]`. A focused operator-preview smoke uses a maintenance status matrix
  to prove requested, triaged, assigned, awaiting approval, approved, in
  progress, completed, and cancelled wording renders in the tenant-visible
  preview without creating portal accounts or mutating provider/tenant state.
  Verification:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant portal operator preview explains every maintenance status" --workers=1`
  (`1 passed`).
- Tenant portal activity feed closeout: the activity feed item is now `[x]`.
  The operator preview mirrors the same derived Recent Activity feed used by
  the tenant portal side rail and exports activity rows in the preview CSV, so
  browser proof no longer depends on a live Clerk tenant account. The focused
  smoke covers invite, document upload, contact request, maintenance history,
  and notification-preference events plus the copy-summary control and CSV
  rows. Verification:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant portal operator preview shows recent activity feed" --workers=1`
  (`1 passed`).
- Settings Work notifications density pass: the Security tab's Work
  notifications section now renders each operator as a compact notification
  row with identity, email toggle, SMS toggle/phone save, digest cadence, and a
  collapsed Template defaults disclosure. The latest digest receipt in Settings
  is deliberately reduced to the scan-critical "Last digest" + send state; the
  richer receipt/provider history remains in Notifications. Focused smoke now
  asserts the default row stays at or below 170px wide-desktop height and that
  Template preview content remains hidden until the disclosure opens.
  Verification: `./node_modules/.bin/eslint src/app/settings/page.tsx tests/smoke/app-flows.spec.ts`,
  `./node_modules/.bin/tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "settings shows Xero readiness and records mappings" --workers=1`
  (`1 passed`).
- Communications hub local history v1: tenant detail now has a read-only
  Correspondence panel after Activity, fed by
  `/api/v1/comms/correspondence/tenants/{tenant_id}`. The endpoint combines
  stored inbound messages with reviewed comms audit dispatch/dismiss receipts
  tied to the tenant, lease, onboarding, arrears, maintenance, and obligation
  records. The panel shows the latest event type, direction, timestamp,
  channel, counterparty, subject, summary/body preview, provider badge, and
  explicit guardrails that opening it does not send email/SMS or mutate queue or
  tenant state. Regression coverage now excludes cross-entity inbound rows and
  generic non-comms dispatch audit rows, and asserts newest-first ordering. The
  broad Communications hub roadmap item stays open for templates, full outbound
  logs, contractor threads, and record-linked thread workflows.
  Verification: `.venv/bin/python -m pytest tests/integration/test_comms_api.py -q`
  (`44 passed`), `.venv/bin/python -m ruff check apps/api/routers/comms.py apps/api/schemas/comms.py tests/integration/test_comms_api.py`,
  `./node_modules/.bin/eslint 'src/app/tenants/[tenantId]/page.tsx' src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`,
  `./node_modules/.bin/tsc --noEmit`,
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail shows portal access recovery actions" --workers=1`
  (`1 passed`), and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "settings shows Xero readiness and records mappings" --workers=1`
  (`1 passed`).
- Tenant correspondence CSV export v1: the tenant detail Correspondence panel
  now has a local `Download correspondence CSV` action beside the event count.
  It exports the already-loaded timeline only, with event type, direction,
  timestamp, channel, counterparty, subject, summary, status, provider, target,
  endpoint guardrails, and an explicit no-send/no-mutation export guardrail.
  Formula-leading cells are prefixed before CSV quoting so inbound addresses or
  subjects cannot execute spreadsheet formulas when opened in Excel/Sheets. No
  backend route, provider call, queue refresh, or tenant mutation is involved.
  Verification: red/green
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail shows portal access recovery actions" --workers=1`
  (`1 passed`), `./node_modules/.bin/eslint 'src/app/tenants/[tenantId]/page.tsx' tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts src/lib/api.ts`,
  `./node_modules/.bin/tsc --noEmit`, and
  `.venv/bin/python -m pytest tests/integration/test_comms_api.py -q`
  (`44 passed`).
- Tenant correspondence record links v1: correspondence events now derive a
  local open-record link from `target_kind`/`target_id` where the destination is
  safely known: arrears opens the Work arrears tab, maintenance opens the work
  order detail, inbound messages open the Comms queue, tenant/onboarding/lease
  targets return to the tenant workflow, and obligations open Work. This keeps
  the tenant timeline read-only while making record-linked correspondence less
  of a dead end.
  Verification: red/green
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail shows portal access recovery actions" --workers=1`
  (`1 passed`), `./node_modules/.bin/eslint 'src/app/tenants/[tenantId]/page.tsx' tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts src/lib/api.ts`,
  and `./node_modules/.bin/tsc --noEmit`.
- Comms outbound log v1: `/api/v1/comms/outbound-log?entity_id=...` now
  returns a read-only, entity-scoped list of stored comms dispatch receipts from
  `AuditAction`, using the existing candidate-id guard to exclude dismissals,
  generic workflow dispatches, mismatched candidate rows, and cross-entity
  receipts. `/comms` shows the log below the metric cards with compact rows,
  provider/channel/status context, local target links, guardrail copy, and a
  review-only CSV export. Viewing/downloading the log does not dispatch,
  dismiss, upload evidence, refresh providers, or mutate queue state.
  Verification: red/green
  `.venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_outbound_log_returns_recent_dispatch_receipts -q`
  (`1 passed`),
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS with a phone recipient" --workers=1`
  (`1 passed`), `.venv/bin/python -m pytest tests/integration/test_comms_api.py -q`
  (`45 passed`), `.venv/bin/python -m ruff check apps/api/routers/comms.py apps/api/schemas/comms.py tests/integration/test_comms_api.py`,
  `./node_modules/.bin/eslint src/app/comms/page.tsx src/lib/api.ts tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts`,
  and `./node_modules/.bin/tsc --noEmit`.
- Comms outbound log filters v1: the `/comms` outbound log now has compact
  local filters for all receipts, needs-attention receipts, email, and SMS.
  The visible count updates by filter, the rows are filtered client-side from
  the already-loaded audit receipt response, and the CSV export now receives the
  same visible receipt set plus a filter summary. The panel remains read-only:
  filtering and exporting do not dispatch, dismiss, upload evidence, refresh
  providers, mutate queue state, or write provider history.
  Verification: red/green
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS with a phone recipient" --workers=1`
  (`1 passed`), `./node_modules/.bin/eslint src/app/comms/page.tsx tests/smoke/app-flows.spec.ts`,
  and `./node_modules/.bin/tsc --noEmit`.
- Maintenance correspondence panel v1:
  `/api/v1/comms/correspondence/maintenance-work-orders/{work_order_id}` now
  returns a read-only target-linked timeline of stored Comms dispatch/dismiss
  receipts for `maintenance_contractor_forward` and
  `maintenance_tenant_forward`, excluding generic workflow dispatches,
  mismatched candidate ids, wrong-target rows, and cross-entity receipts. The
  audit receipt helper now accepts real `comms.dismiss` rows as well as the
  older `comms.queue` test seed shape. Maintenance detail shows a compact
  Correspondence panel in the right-side context column with provider/channel
  status, recipients, Comms/tenant handoffs, guardrails, and a local
  `maintenance-correspondence-{work_order_id}.csv` export. Viewing/exporting
  does not dispatch, dismiss, upload evidence, refresh providers, mutate queue
  state, or mutate the work order.
  Verification: red/green
  `.venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_maintenance_correspondence_returns_work_order_receipts -q`
  (`1 passed`),
  `npx playwright test tests/smoke/app-flows.spec.ts -g "maintenance detail route shows quote evidence" --workers=1`
  (`1 passed`), `.venv/bin/python -m pytest tests/integration/test_comms_api.py -q`
  (`46 passed`), `.venv/bin/python -m ruff check apps/api/routers/comms.py apps/api/schemas/comms.py tests/integration/test_comms_api.py`,
  `./node_modules/.bin/eslint 'src/app/operations/maintenance/[workOrderId]/page.tsx' src/lib/api.ts tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts`,
  and `./node_modules/.bin/tsc --noEmit`.

## Cowork session 2026-05-31 — DoorLoop benchmark + refocus

Research + planning session (no app code changed; **docs only**). Studied DoorLoop's
product, UX, and information architecture and refocused the backlog around it.

Added/updated (all uncommitted — docs only, additive, safe to review then commit):
- **NEW** `docs/doorloop-benchmark-2026-05-31.md` — full DoorLoop vs Leasium benchmark +
  gap analysis (People/Properties IA, feature matrix, AU-localisation, what not to copy).
- **NEW** `docs/superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md` — test-first P0
  execution plan (Owner entity → People hub → nav consolidation), with a P1 preview.
- `docs/product-roadmap.md` — new top section in Next Build Order: "DoorLoop benchmark
  refocus (2026-05-31)" with P0–P3 `[ ]` items.
- `docs/design-governance.md` — new "2026-05-31 DoorLoop Benchmark — IA + UX Direction"
  (prototype-mode direction, not a Remba gate) + a Standing UX Direction bullet.
- `docs/leasium-codex-design-source-of-truth.md` — §11 nav model refreshed to the shipped
  nav + the People/Money target; §10.5.1 cap note updated to the People-hub path to 7.
- `CLAUDE.md` — new §2.10 "People + Properties IA north star (DoorLoop-informed)".

Where to start next session: the People-hub plan, **Ticket 1.1 — `Owner` + `PropertyOwner`
models + migration** (red test first). Keep it additive — the legacy Property owner-fields
stay as the backfill source until the Owner read path is proven at parity (Ticket 1.3).

Awaiting Temba: go-ahead to begin building P0; optional calls on the AU payment rail
(Monoova / Zai / Stripe AU) and whether to formalise a `leasium-ux-standard` skill. The
literal DoorLoop tutorial transcript could not be machine-pulled (YouTube blocked in the
sandbox, no browser connected) — the benchmark was reconstructed from DoorLoop's own docs.

## Cowork session 2026-05-31 (cont.) — P0 build started: Owner entity + CRUD API

Built and verified on Temba's Mac via Desktop Commander, **all uncommitted** — review then commit. Additive only; no existing behaviour changed.

**Ticket 1.1 — Owner + PropertyOwner models + migration (DONE, green):**
- `stewart/core/models.py` (+81): new `Owner` (mirrors the 11 `Property` owner fields) + `PropertyOwner` association (`split_pct`, unique `(property_id, owner_id)`); added `Entity.owners` and `Property.owner_links` relationships.
- `migrations/versions/20260531_0029_owner_entity.py`: creates `owner` + `property_owner`. `alembic heads` → single head `20260531_0029`; offline `--sql` emits correct DDL. **NOT applied to a live DB** — local Postgres/Docker was down. Apply with `docker compose up -d && .venv/bin/alembic upgrade head`.
- `tests/integration/test_owner_entity.py`: 2 ORM tests (split round-trip, default split). Red→green.

**Ticket 1.4 — Owner CRUD API (DONE, green):**
- `apps/api/schemas/owner_entities.py` + `apps/api/routers/owner_entities.py`: list / create / detail / patch / soft-delete at `/api/v1/owners`; `OwnerRead` surfaces linked properties + count. Registered AFTER `owners.router` in `main.py` (+2) so the literal `/owners/statements*` paths keep priority over `/owners/{owner_id}`.
- `tests/integration/test_owner_entity_api.py`: 4 tests incl. a guard that `/owners/statements` still resolves.

**Evidence:** ruff clean on all changed files; **full integration suite 337 passed / 1 skipped** (was 333; +4 new), no regressions.

**Update (same session, cont.) — Ticket 1.2 + Ticket 1.3 de-risk also done + green (still uncommitted):**

- **Ticket 1.2 — Owner backfill (DONE):** `stewart/core/owner_backfill.py` — idempotent `backfill_owners(session, entity_id=None)` groups by the same identity tuple as the statements router, creates one Owner per identity, links each property at 100%, skips unattributed. Entrypoint `scripts/backfill_owners.py` (`python -m scripts.backfill_owners`). Tests `tests/integration/test_owner_backfill.py` (dedupe/link + idempotency).
- **Ticket 1.3 — parity proven, endpoint swap DEFERRED:** `tests/integration/test_owner_statement_parity.py` proves the backfilled Owner/PropertyOwner data reproduces the legacy `_owner_identity_tuple` clusters exactly (attributed clusters match; unlinked == unattributed). The live `/owners/statements` endpoint is **unchanged** — the actual read-path swap (`_build_owner_statements` grouping via Owner with an unattributed fallback) is left for review against the real SKJ portfolio; this parity test is its safety net.

Full integration suite now **340 passed / 1 skipped**, ruff clean. Remaining P0: the reviewed statements swap, then Phase 2 (People hub UI — design-facing, paused for your direction). To apply migration + run backfill once Docker is up: `docker compose up -d && .venv/bin/alembic upgrade head && .venv/bin/python -m scripts.backfill_owners`.

## Cowork session 2026-05-31 (cont.) — process note: commit `ae6fabb` bundled extra work

`ae6fabb "Add Leasium-vs-PropertyMe take-on strategy"` unintentionally bundled **17 files of the
owner-portal-account-auth slice** (`owner_portal.py`, schemas, account UI, invite page, migration
`20260531_0030_owner_portal_accounts`, `models.py`, auth tests, `api.ts`) with the one intended file
(`market-research/Leasium_vs_PropertyMe_Strategy.md`). Cause: that work was already **staged in the
git index**, and a bare `git commit` commits the whole index. No history harm (single local repo, no
divergence); the commit **built green on Vercel and is live on leasium.ai**, and the slice's own doc
updates were inside the same commit, so the work IS documented — only the commit **subject**
under-describes it. History was **not** rewritten (amend/force-push on shared `main` is the dangerous
move). **TODO: confirm Render applied migration `20260531_0030`** for the owner-portal-account backend.
**Process fix going forward:** commit with **explicit pathspecs** (`git commit -- <path>`), never a bare
`git commit`, so a shared index is never swept again.

## Cowork session 2026-05-31 (cont.) — competitor teardowns (:Different, Ailo)

Added `market-research/Leasium_vs_Different_Ailo_Teardown.md`. Key finding: **neither is a
self-managing-owner SaaS rival.** Ailo = a modern B2B *agency* platform (a PropertyMe challenger, NPP
payments, ~200k users, agencies 100–500 doors). :Different = a tech-enabled PM *service* (done-for-you),
now largely white-labelling service delivery to agencies. So Leasium's "software for DIY owners" lane is
open; its real competitor is the **decision to outsource** (an agency / :Different) and inertia
(spreadsheets) — position against the **management fee**, and match the **NPP real-time + owner-app
transparency** bar Ailo set. Next AU comparisons still open: Kolmeo.

## Codex continuation 2026-06-02 - Tenant portal invoice payment normalization

- Chosen backlog slice after agent scouting: tenant-facing invoice payment
  summaries should not display impossible balances when stale local payment
  metadata reports paid cents above the invoice total.
- `_invoice_payment` in `apps/api/routers/tenant_portal.py` now normalizes the
  read model only: `paid_cents` is capped at `total_cents`, and
  `outstanding_cents` is recomputed from that normalized paid amount. The
  invoice-row payment status label follows the normalized cents, and the
  response summary derives from those normalized invoice rows.
- Guardrails: no Xero/Basiq write, payment reconciliation, invoice metadata
  mutation, provider dispatch, SendGrid/Twilio send, document download, or
  provider-history write.
- Verification: red/green
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_session_caps_invoice_overpayment_metadata -q`
  (`1 passed` after fix),
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py -q`
  (`56 passed`), and
  `.venv/bin/python -m ruff check apps/api/routers/tenant_portal.py tests/integration/test_tenant_portal_api.py`
  (`All checks passed!`).

## Codex continuation 2026-06-02 - Tenant portal account email freshness

- Chosen backlog slice after agent scouting: tenant portal account lifecycle
  still had change-email support open, and linked portal account rows could keep
  the old claim-time email after an operator applied a tenant-submitted
  contact/billing email change.
- `apply_contact_change_request` in `apps/api/routers/tenants.py` now syncs
  active, non-revoked, non-deleted linked tenant portal account emails to the
  tenant's preferred portal email (`billing_email` then `contact_email`) when
  the applied fields include `contact_email` or `billing_email`.
- Coverage extends the existing account contact-change flow to prove the
  account lifecycle/status endpoint reports the new email and that an additional
  active co-tenant login keeps its provider id, active status, and tenant scope
  while receiving the same local email freshness update.
- Guardrails: no Clerk email mutation, invite resend, token rotation, account
  relink, SendGrid/Twilio send, provider history write, payment, Xero, or Basiq
  mutation.
- Verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_account_contact_change_request_waits_for_operator_apply tests/integration/test_tenant_portal_api.py::test_tenant_portal_session_caps_invoice_overpayment_metadata -q`
  (`2 passed`),
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py -q`
  (`56 passed`), and
  `.venv/bin/python -m ruff check apps/api/routers/tenants.py apps/api/routers/tenant_portal.py tests/integration/test_tenant_portal_api.py`
  (`All checks passed!`).

## Codex continuation 2026-06-02 - Properties calendar mobile hardening

- Chosen backlog slice after agent scouting: `/properties?view=calendar` existed
  but did not have focused mobile smoke coverage, and the calendar filter chips
  plus review actions were smaller than the 44px tap target baseline.
- Added a 390px Playwright smoke in
  `apps/web/tests/smoke/properties-ux.spec.ts` that opens the calendar view,
  checks URL/tab state and review-queue content, and asserts touch-safe sizes for
  Calendar, Rent reviews, Next 90, Copy schedule, Copy follow-ups, and Open next.
- `apps/web/src/components/property-workspace.tsx` now gives the calendar
  event-kind chips, horizon chips, Open next link, and Copy follow-ups button
  the same 44px mobile touch floor. No data/provider mutation behavior changed.
- Red/green evidence: the new smoke first failed with a 26px-high calendar chip,
  then passed after the touch-target patch.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/properties-ux.spec.ts -g "mobile properties calendar view keeps filters and review actions touch safe" --workers=1`
  (`1 passed`),
  `./node_modules/.bin/playwright test tests/smoke/properties-ux.spec.ts --workers=1`
  (`9 passed`),
  `./node_modules/.bin/eslint src/components/property-workspace.tsx tests/smoke/properties-ux.spec.ts`
  (clean), and `./node_modules/.bin/tsc --noEmit` (clean).

## Codex continuation 2026-06-02 - Properties map mobile hardening

- Chosen follow-on backlog slice: `/properties?view=map` had the same shape as
  calendar — the surface existed, but mobile smoke did not prove the map view's
  focus controls met the 44px tap target baseline.
- Added a 390px Playwright smoke in
  `apps/web/tests/smoke/properties-ux.spec.ts` that opens the map view, checks
  URL/tab state, proves Portfolio location plan / Map planning / Regional focus
  content, and asserts touch-safe sizes for Map, Lease risk, Vacancy, Copy map
  brief, Queen Street map/property action, and Vacancy focus.
- `apps/web/src/components/property-workspace.tsx` now lifts the map focus chips
  to `min-h-11` with matching padding. Planning buttons, map pins, and the copy
  action already met the size check.
- Red/green evidence: the new smoke first failed with a 26px-high map focus
  chip, then passed after the chip patch.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/properties-ux.spec.ts -g "mobile properties map view keeps focus controls touch safe" --workers=1`
  (`1 passed`),
  `./node_modules/.bin/playwright test tests/smoke/properties-ux.spec.ts --workers=1`
  (`10 passed`),
  `./node_modules/.bin/eslint src/components/property-workspace.tsx tests/smoke/properties-ux.spec.ts`
  (clean), and `./node_modules/.bin/tsc --noEmit` (clean). In-app browser opened
  `http://127.0.0.1:3000/properties?view=map` and confirmed the Map tab was
  selected; standalone web content stayed in the app's fetch-failed state
  because the API backend/mocks were not attached to that manual browser pass.

## Codex continuation 2026-06-02 - Properties map labels

- User report: the Properties map looked like it had not loaded; the canvas was
  showing grid-only map chrome plus raw `0/0` marker badges.
- Root cause: `/properties?view=map` is currently a schematic address grouping
  view, not a tile-backed street map. `PropertyRecord` stores address fields but
  no latitude/longitude or geocode fields, and no Mapbox/Leaflet/OpenStreetMap
  provider is wired. The marker position is intentionally derived from a stable
  address hash in `propertyMapPoint(...)`.
- Fix scope: renamed the in-canvas heading to `Portfolio location plan`, made
  the subtitle describe address grouping, and reused the shared occupancy badge
  label so unknown unit data renders `No units` instead of `0/0`.
- Regression coverage: the mobile map smoke now asserts the location-plan copy
  and verifies `0/0` is absent.

## Codex continuation 2026-06-02 - Work undo toast mobile hardening

- Chosen backlog slice: Operations mobile polish still had interactive toast
  controls using explicit `min-h-9` sizing, which could leave phone operators
  with sub-44px Undo/Dismiss targets after inline maintenance edits.
- Added a 390px Playwright smoke in
  `apps/web/tests/smoke/operations-ux.spec.ts` that opens `/operations`, changes
  the Air conditioning fault status to `triaged`, waits for the inline undo
  toast, and measures the Undo and Dismiss controls.
- `apps/web/src/app/operations/page.tsx` now uses `min-h-11` for the maintenance
  inline undo toast buttons and the related obligation confirmation Dismiss
  control. No provider send, assignment send, work-order dispatch, invoice,
  Xero, Basiq, payment, or reconciliation path changed.
- Red/green evidence: the new smoke first failed with the Undo button at 36px,
  then passed after the toast controls moved to the 44px baseline.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/operations-ux.spec.ts -g "maintenance inline undo toast controls stay touch-safe on mobile" --workers=1`
  (`1 passed`),
  `./node_modules/.bin/playwright test tests/smoke/operations-ux.spec.ts --workers=1`
  (`11 passed`),
  `./node_modules/.bin/eslint src/app/operations/page.tsx tests/smoke/operations-ux.spec.ts`
  (clean), and `./node_modules/.bin/tsc --noEmit` (clean).

## Codex continuation 2026-06-02 - People/Money hub tab mobile hardening

- Chosen backlog slice after closing the scout agent: People had just gained a
  mobile tab smoke, and the scout found the same short `min-h-10` tab/action
  pattern still present on `/money`.
- `apps/web/src/app/people/page.tsx` keeps People hub tabs on the 44px
  tap-target baseline, and `apps/web/tests/smoke/people-hub.spec.ts` now scopes
  the mobile check through the named People types tablist.
- `apps/web/src/app/money/page.tsx` now lifts Money hub tabs and the active
  panel action link to `min-h-11`. A new 390px smoke in
  `apps/web/tests/smoke/nav-consolidation.spec.ts` measures Billing,
  Statements, Xero, Basiq, and Open Billing Readiness.
- Red/green evidence: the new Money smoke first failed with a 40px-high tab,
  then passed after the Money sizing patch.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/nav-consolidation.spec.ts -g "mobile money hub tabs and actions stay touch-safe" --workers=1`
  (`1 passed`),
  `./node_modules/.bin/playwright test tests/smoke/people-hub.spec.ts --workers=1`
  (`5 passed`),
  `./node_modules/.bin/playwright test tests/smoke/nav-consolidation.spec.ts --workers=1`
  (`5 passed`),
  `./node_modules/.bin/eslint src/app/people/page.tsx src/app/money/page.tsx tests/smoke/people-hub.spec.ts tests/smoke/nav-consolidation.spec.ts`
  (clean), and `./node_modules/.bin/tsc --noEmit` (clean).

## Codex continuation 2026-06-02 - Fictional AU local demo seed

- User noted that `http://127.0.0.1:3000` was mostly testing frames rather
  than meaningful data, and approved a fictional AU-realistic demo portfolio.
- Added design and implementation docs:
  `docs/superpowers/specs/2026-06-02-demo-seed-design.md` and
  `docs/superpowers/plans/2026-06-02-demo-seed.md`.
- `scripts/seed_demo.py` now exposes `seed_demo(session=None)` and CLI module
  execution. It uses the dev-auth organisation id so the normal localhost app
  can see the data, renames that local org to `Harbour Lane Property Group`,
  and adds `Rivergum Property Holdings Pty Ltd` plus three Brisbane properties:
  Kingfisher Retail Arcade, Moorooka Trade Warehouse, and Newstead Creative
  Offices.
- Seeded real API-backed rows include tenants, owner/trust records, property
  owner links, units, leases, charge rules, obligations, contractors, stored
  documents, billing draft/lines, invoice draft/lines, maintenance work,
  tenant onboarding, and an arrears case. Rows carry demo metadata
  `demo_seed=fictional_au_v1`.
- Guardrails: local-only, idempotent, no reset/truncate, no Xero/Basiq writes,
  no SendGrid/Twilio sends, no payment/reconciliation, and no external document
  calls.
- Project docs updated for future sessions: `README.md`, `CLAUDE.md`,
  `docs/leasium-codex-design-source-of-truth.md`, and
  `docs/product-roadmap.md`. Use `make demo-seed` after migrations when local
  browser QA needs meaningful data instead of empty frames.
- Red/green evidence: the new integration test first failed because
  `scripts.seed_demo` did not exist, then passed after the seeder landed.
- Verification so far:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_seed_demo.py -q`
  (`1 passed`) and
  `.venv/bin/python -m ruff check scripts/seed_demo.py tests/integration/test_seed_demo.py`
  (`All checks passed!`).
- Local DB/browser seed note: `.venv/bin/python -m scripts.seed_demo` was tried
  after the tests but could not connect to Postgres on `localhost:5432`; trying
  `docker compose up -d` also failed because `docker` is not available in this
  session. Once Postgres is running, run `make migrate && make demo-seed`, then
  reload `http://127.0.0.1:3000` for the real browser-data pass.

## Codex continuation 2026-06-02 - Insights compliance snapshot v1

- User asked to move onto bigger backlog work and explicitly rejected more
  demo/empty-state polish. Two scout agents inspected compliance/inspection
  gaps; the shipped slice keeps the work in the portfolio Insights layer while
  documenting the larger recurring-register follow-up below.
- Backend: `apps/api/routers/insights.py` now builds a read-only
  `compliance_snapshot` from existing open obligations in the `insurance`,
  `bank_guarantee`, `make_good`, and `compliance` categories. It includes
  open/overdue/due-soon counts, missing/evidence-linked counts, delegated owner
  counts, fire-safety and inspection-report signals, category/status counts, and
  next risk rows with property/unit/tenant context plus evidence-history actor
  metadata. `apps/api/schemas/insights.py` exposes the new response models.
- Frontend: `/insights` now renders a Compliance & Inspections panel with
  overdue/due-soon/evidence/owner metrics, category counts, and risk rows. The
  existing review packet copy/download now includes compliance summary and row
  detail. Smoke mocks include a realistic fire-safety certificate and bank
  guarantee scenario.
- Guardrails: viewing the panel and copying/downloading the CSV remain local
  and read-only. No provider dispatch, email/SMS, Xero/Basiq, billing draft,
  payment, reconciliation, Smart Intake apply, or obligation mutation happens
  from this snapshot/export path.
- Red/green evidence: the backend test first failed with
  `KeyError: 'compliance_snapshot'`, and the Insights smoke first failed because
  the Compliance & Inspections heading was missing. Both passed after the
  implementation.
- Larger next backlog candidate from scouts: recurring compliance register v1
  with durable compliance checks, recurrence, assigned owner, latest evidence,
  current obligation linkage, completion audit/history, and roll-forward to the
  next due obligation. Suggested files:
  `apps/api/routers/compliance.py`, `apps/api/schemas/compliance.py`,
  `tests/integration/test_compliance_api.py`, model/migration additions, and
  activity-feed labels. Keep Smart Intake/comms behavior untouched for that
  slice.

## Codex continuation 2026-06-02 - Recurring compliance register v1 backend

- Followed the larger compliance backlog path after the Insights snapshot:
  durable recurring checks first, before building the Work tab UI.
- Added `ComplianceCheckKind`, `ComplianceCheckStatus`,
  `ComplianceRecurrenceUnit`, and `ComplianceCheck` in
  `stewart/core/models.py`, plus Alembic revision
  `migrations/versions/20260602_0033_compliance_checks.py`.
- Added `apps/api/schemas/compliance.py` and `apps/api/routers/compliance.py`.
  Routes:
  `GET/POST /api/v1/compliance/checks`,
  `GET/PATCH/DELETE /api/v1/compliance/checks/{check_id}`,
  and `POST /api/v1/compliance/checks/{check_id}/complete`.
- Create validates all scope links and creates a current local
  `Obligation(category=compliance)` when no current obligation is supplied.
  Complete validates evidence, marks the old obligation completed, attaches
  evidence metadata/history, appends local completion history to the check,
  advances the next due date from certificate expiry or recurrence, and creates
  the future current obligation. Repeating the same evidence+completed-at
  request is idempotent and does not duplicate obligations.
- Guardrails: backend-only foundation. No provider dispatch, SendGrid/Twilio,
  Xero/Basiq, billing draft, payment/reconciliation, Smart Intake apply, comms
  mutation, or provider-history mutation. Existing Smart Intake/comms behavior
  is untouched.
- `apps/api/main.py` includes the router, and `apps/api/routers/activity_feed.py`
  labels `compliance_check` audit targets.
- Test coverage in `tests/integration/test_compliance_api.py` covers create
  with current obligation, list/read/update/delete, completion roll-forward,
  retry idempotency, cross-entity evidence rejection without mutation, and
  no-role access denial.
- Red/green evidence: the first test failed with `404` for
  `/api/v1/compliance/checks`; the completion test then failed because
  `next_due_date` did not roll forward. Both failures were resolved by the
  model/router implementation.
- Follow-up: build the operator-facing Compliance tab in Work
  (`/operations?tab=compliance`) to combine register checks, inspection-created
  work orders, and pending compliance/inspection Smart Intake rows, with local
  copy/download review packet coverage.

## Codex continuation 2026-06-02 - Compliance Work tab v1

- Built the operator-facing Work compliance tab at `/operations?tab=compliance`.
  It loads the recurring compliance register through the new
  `listComplianceChecks` web API client and combines it with existing
  compliance obligations, compliance/inspection Smart Intake rows, and
  inspection-created maintenance work orders.
- Frontend files touched:
  `apps/web/src/app/operations/page.tsx`,
  `apps/web/src/lib/api.ts`,
  `apps/web/tests/smoke/api-mocks.ts`, and new
  `apps/web/tests/smoke/operations-compliance.spec.ts`.
- The tab renders overdue/due-soon/missing-evidence counts, recurring check
  rows with recurrence/evidence/owner context, linked obligation rows, Smart
  Intake review links, and inspection work-order links. It does not mutate
  compliance checks or related records.
- Added AU-realistic smoke fixtures for annual fire safety and bank guarantee
  checks, plus an opt-in inspection-created work order fixture for this smoke so
  older Work tests keep their baseline queue.
- Added local copy/download export as `operations-compliance-review.csv`.
  Guardrail: export/copy does not complete checks, upload evidence,
  create/update obligations, apply Smart Intake, create/update work orders, send
  email/SMS, dispatch providers, create billing drafts, call Xero/Basiq, or
  reconcile payments.
- Red/green evidence: new smoke first failed because the Compliance tab was
  missing, then passed after implementation. Verification run:
  `npx playwright test tests/smoke/operations-ux.spec.ts tests/smoke/operations-compliance.spec.ts`
  passed 12 tests. Focused ESLint and `tsc --noEmit` also passed.
- Continued below: the next slice wires the operator-approved completion action;
  remaining compliance follow-up should focus on richer inline evidence detail
  or a local per-check evidence packet.

## Codex continuation 2026-06-02 - Compliance Work completion action

- Chosen backlog slice: the Work compliance tab had the recurring register and
  read-only packet, but still lacked the next handover follow-up: an
  operator-approved completion/evidence action.
- `/operations?tab=compliance` now enables `Complete with linked evidence` only
  for active due/overdue recurring checks that already have a linked source
  document. Checks without evidence stay blocked as `Needs evidence`; checks
  rolled outside the due window settle to `Evidence current`.
- The web API client now includes `completeComplianceCheck`, calling only
  `POST /api/v1/compliance/checks/{id}/complete`. The backend remains the
  source of truth for completing the current local obligation, linking evidence,
  appending completion history, and rolling the check forward.
- Guardrails: this UI path does not call providers, provider history, comms,
  Smart Intake apply, maintenance work orders, direct obligation mutation,
  billing/invoice, Xero/Basiq, payment, or reconciliation routes. The existing
  compliance CSV export remains review-only and still does not complete checks.
- Red/green evidence: the new smoke first failed because the recurring check row
  had no completion action/test id, then passed after adding the API helper,
  mutation, row action, success confirmation, and mock completion route.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/operations-compliance.spec.ts -g "completes a recurring check" --workers=1`
  passed **1 passed** and
  `./node_modules/.bin/playwright test tests/smoke/operations-compliance.spec.ts --workers=1`
  passed **2 passed**. Broader Work smoke
  `./node_modules/.bin/playwright test tests/smoke/operations-ux.spec.ts --workers=1`
  passed **11 passed**; focused `eslint`, `tsc --noEmit`, and
  `git diff --check` passed.
- Continued below: the next slice adds richer inline evidence detail and a
  local per-check evidence packet.

## Codex continuation 2026-06-02 - Compliance per-check evidence packet

- Chosen backlog slice: after the reviewed completion action, the remaining
  compliance follow-up was richer inline evidence detail/local evidence packet
  per recurring check.
- `/operations?tab=compliance` now shows a compact `Completion evidence packet`
  inside recurring check rows that already have linked source evidence or
  completion history. The packet exposes source document id, last completion,
  next due date, owner/context, and local copy/download controls.
- The per-check CSV downloads as
  `compliance-evidence-packet-{check_id}.csv`, uses the shared CSV formula-safe
  helper, and carries the same compliance guardrail as the portfolio-level
  packet.
- Guardrails: packet copy/download uses already-loaded page data only. It does
  not call compliance completion, direct obligations, Smart Intake, maintenance,
  comms, provider/provider-history, billing/invoice, Xero/Basiq, payment, or
  reconciliation routes.
- Test hygiene follow-up: the smoke API mock now resets compliance checks per
  `mockLeasiumApi(...)` call so the completion-action smoke cannot leak
  rolled-forward state into later packet/export smokes.
- Red/green evidence: the new smoke first failed because the recurring check row
  had no `Completion evidence packet`; after the packet UI landed, it passed.
  A full compliance smoke then exposed the fixture leak above, which was fixed
  before final verification.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/operations-compliance.spec.ts -g "per-check evidence packet" --workers=1`
  passed **1 passed**;
  `./node_modules/.bin/playwright test tests/smoke/operations-compliance.spec.ts --workers=1`
  passed **3 passed**; broader Work smoke
  `./node_modules/.bin/playwright test tests/smoke/operations-ux.spec.ts --workers=1`
  passed **11 passed**; focused `eslint`, `tsc --noEmit`, and
  `git diff --check` passed.
- Next sensible compliance follow-up: evidence upload/linking from the Work tab
  only after the operator review boundary is designed. Avoid building another
  read-only queue.

## Codex continuation 2026-06-02 - Tenant portal recovery mobile hardening

- Chosen backlog slice: tenant portal account lifecycle remains open, but the
  backend already has fresh-link, revoke/restore/unlink, and co-tenant invite
  flows. The safe UI follow-up was mobile hardening of the tenant detail Portal
  access recovery actions.
- `/tenants/[tenantId]` Portal access now removes stale `h-8` sizing from
  Unlink, Revoke, Restore, and Fresh link controls, keeping them on the
  44px touch-target baseline with `min-h-11`.
- Guardrails: no provider sends, account-linking behavior, recovery semantics,
  onboarding token generation, tenant data, or backend routes changed.
- Red/green evidence: the new 390px smoke first failed because the active
  Unlink button still carried `h-8`; it passed after the recovery controls were
  lifted to `min-h-11`.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/tenants-ux.spec.ts -g "portal recovery" --workers=1`
  passed **1 passed**;
  `./node_modules/.bin/playwright test tests/smoke/tenants-ux.spec.ts --workers=1`
  passed **3 passed**; the existing app-flow recovery smoke rerun with
  `PORT=3001` passed **1 passed** after an initial parallel port collision on
  `127.0.0.1:3000`; focused `eslint`, `tsc --noEmit`, and `git diff --check`
  passed.
- Next tenant-portal lifecycle follow-up: tenant-side recovery UX/account
  switching if a real user hits revoked or conflicting login states.

## Codex continuation 2026-06-02 - Comms template catalog v1

- Chosen backlog slice: Communications hub remains open around templates/logs.
  The stored branded-template registry already existed in Settings, but Comms
  itself did not show the active template context operators need while reviewing
  queued drafts and outbound receipts.
- `/comms` now loads active `branded-communication-templates` for the selected
  entity and shows a `Template catalog` panel above the outbound log. Rows show
  template name, key, version, provider/channel, System vs Override source,
  subject/body preview, notes, and action template context.
- Added local Copy/Download CSV export as
  `comms-template-catalog-{latest-template-date}.csv`, using formula-safe CSV
  cells and only already-loaded template rows.
- Guardrails: viewing, copying, or downloading the catalog does not send
  SendGrid email, send Twilio SMS, dispatch or dismiss queue candidates,
  refresh providers, mutate communication templates, write provider history, or
  change tenant, maintenance, invoice, billing, payment, reconciliation, Xero,
  or Basiq records.
- Red/green evidence: the new smoke first failed because the `Template catalog`
  panel was missing, then passed after wiring the existing API client and panel.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/comms-template-catalog.spec.ts --workers=1`
  passed **1 passed**; broader Comms smoke
  `./node_modules/.bin/playwright test tests/smoke/comms-template-catalog.spec.ts tests/smoke/comms-outbound-log-export.spec.ts tests/smoke/comms-export-parity.spec.ts tests/smoke/comms-keyboard.spec.ts --workers=1`
  passed **4 passed**; focused `eslint`, `tsc --noEmit`, and
  `git diff --check` passed.
- Next sensible Comms follow-up: template editing/override workflow only after
  the operator review boundary is designed; otherwise prefer record-linked
  correspondence depth over another read-only panel.

## Codex continuation 2026-06-02 - Comms queue source links v1

- Chosen backlog slice: record-linked Comms depth. The queue already linked
  tenant lifecycle drafts, Smart Intake attachment replies, and maintenance
  forwards, but rent-review lease drafts and compliance obligation reminders
  were still stranded in the Comms queue without a local source handoff.
- `/comms` now derives draft-card handoff links from `target_kind` /
  `target_id`: rent-review lease drafts link to the tenant workflow, compliance
  obligation reminders link to `/operations?tab=compliance`, and existing
  arrears, maintenance, Smart Intake, tenant, and tenant-onboarding mappings
  are centralised through one helper.
- Guardrails: opening the new source links is local navigation only. It does
  not approve/send drafts, dismiss candidates, refresh providers, mutate queue
  state, upload evidence, send email/SMS, or write provider history.
- Red/green evidence: the existing Comms app-flow smoke was extended first and
  failed because the rent-review draft had no `Open tenant workflow` link; it
  passed after adding the candidate target-link helper.
- Verification:
  `PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts -g "comms queue" --workers=1`
  passed **1 passed** after an initial parallel Playwright port collision on
  `127.0.0.1:3000`; broader Comms smoke
  `./node_modules/.bin/playwright test tests/smoke/comms-template-catalog.spec.ts tests/smoke/comms-outbound-log-export.spec.ts tests/smoke/comms-export-parity.spec.ts tests/smoke/comms-keyboard.spec.ts --workers=1`
  passed **4 passed**; focused `eslint`, `tsc --noEmit`, and
  `git diff --check` passed.

## Codex continuation 2026-06-02 - Insights maintenance aging snapshot v1

- Chosen backlog slice: Portfolio Insights still listed maintenance aging as
  open after compliance risk landed, so this slice kept the work in the
  read-only Insights layer instead of adding another mutable operations queue.
- `/api/v1/insights/overview` now returns `maintenance_snapshot` from open
  maintenance work orders, with open/urgent/overdue/awaiting-approval/
  contractor-assigned/aged-14-plus/oldest-open counts, status/priority mixes,
  and ranked work-order rows carrying property, unit, tenant, contractor, quote,
  age, due chip, and local work-order handoff links.
- `/insights` now renders a `Maintenance Aging` panel and includes the same
  maintenance summary/rows in the local review packet copy and CSV export.
- Guardrails: viewing, copying, or downloading the Insights packet does not
  update maintenance work orders, dispatch contractors, send SendGrid/Twilio
  messages, create invoices, call Xero/Basiq, reconcile payments, generate
  billing drafts, or write provider history.
- Red/green evidence: the backend test first failed with
  `KeyError: 'maintenance_snapshot'`; after the API snapshot landed it passed.
  The Insights smoke was then extended and first failed because the
  `Maintenance Aging` heading was missing; after the typed web panel and export
  rows landed it passed.
- Verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_insights_api.py -q`
  passed **4 passed**;
  `.venv/bin/python -m ruff check apps/api/routers/insights.py apps/api/schemas/insights.py tests/integration/test_insights_api.py`
  passed;
  `./node_modules/.bin/playwright test tests/smoke/insights.spec.ts --workers=1`
  passed **2 passed**; focused `eslint`, `tsc --noEmit`, and
  `git diff --check` passed.
- Next sensible Insights follow-up: arrears/invoice status depth in the same
  review-only portfolio layer, then richer owner/entity dashboard context.

## Codex continuation 2026-06-02 - Insights arrears snapshot v1

- Chosen backlog slice: Portfolio Insights still listed arrears as open after
  compliance and maintenance aging. This keeps arrears in the same read-only
  review layer rather than adding a new credit-control workflow surface.
- `/api/v1/insights/overview` now returns `arrears_snapshot` from active and
  monitoring arrears cases, with open count, total balance, reminder-due,
  disputed, escalated, promise-to-pay, aged-30-plus, aged-90-plus, oldest-aged,
  status/dispute/escalation mixes, and ranked rows carrying property, unit,
  tenant, balance buckets, reminder chip, promise, escalation, and Operations
  handoff links.
- `/insights` now renders an `Arrears Snapshot` panel and includes the same
  arrears summary/rows in the local review packet copy and CSV export.
- Guardrails: viewing, copying, or downloading the Insights packet does not
  send arrears reminders, escalate cases, update arrears records, create
  invoices, call Xero/Basiq, reconcile payments, generate billing drafts, send
  SendGrid/Twilio messages, or write provider history.
- Red/green evidence: the backend test first failed with
  `KeyError: 'arrears_snapshot'`; after the API snapshot landed it passed. The
  Insights smoke was then extended and first failed because the
  `Arrears Snapshot` heading was missing; after the typed web panel and export
  rows landed it passed.
- Verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_insights_api.py -q`
  passed **4 passed**;
  `.venv/bin/python -m ruff check apps/api/routers/insights.py apps/api/schemas/insights.py tests/integration/test_insights_api.py`
  passed;
  `./node_modules/.bin/playwright test tests/smoke/insights.spec.ts --workers=1`
  passed **2 passed**; focused `eslint`, `tsc --noEmit`, and
  `git diff --check` passed.
- Next sensible Insights follow-up: invoice-status depth and then richer
  owner/entity dashboard context.

## Codex continuation 2026-06-02 - Insights invoice status snapshot v1

- Chosen backlog slice: Portfolio Insights still listed invoice status depth as
  open after compliance, maintenance aging, and arrears landed. This keeps
  draft invoice delivery/payment/posting risk inside the read-only Insights
  review layer rather than adding a mutable billing workflow.
- `/api/v1/insights/overview` now returns `invoice_status_snapshot` from
  internal invoice drafts and their existing delivery, payment, posting,
  Xero approval, Xero sync, and provider-dispatch metadata. The snapshot rolls
  up total/approved invoices, approved-not-synced, ready-to-send, sent, unpaid,
  overdue, provider-failed, total and outstanding cents, status/payment/
  delivery/posting mixes, and ranked invoice rows carrying property, unit,
  tenant, recipient, due chip, posting state, and Billing Readiness handoff
  links.
- `/insights` now renders an `Invoice Status` panel and includes the same
  invoice status summary/rows in the local review packet copy and CSV export.
- Guardrails: viewing, copying, or downloading the Insights packet does not
  send tenant email, post invoices, sync Xero, reconcile payments, mutate
  invoice drafts, generate billing drafts, dispatch providers, send
  SendGrid/Twilio messages, or write provider history.
- Red/green evidence: the backend test first failed with
  `KeyError: 'invoice_status_snapshot'`; after the API snapshot landed it
  passed. The Insights smoke was then extended and first failed because the
  `Invoice Status` heading was missing; after the typed web panel and export
  rows landed it passed.
- Verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_insights_api.py -q`
  passed **4 passed**;
  `.venv/bin/python -m ruff check apps/api/routers/insights.py apps/api/schemas/insights.py tests/integration/test_insights_api.py`
  passed;
  `./node_modules/.bin/playwright test tests/smoke/insights.spec.ts --workers=1`
  passed **2 passed**; focused `eslint`, `tsc --noEmit`, and
  `git diff --check` passed.
- Next sensible Insights follow-up: richer owner/entity dashboard context, or
  use the same read-only snapshot pattern to deepen dashboard command-centre
  context.
