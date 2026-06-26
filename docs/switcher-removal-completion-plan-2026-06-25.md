# Switcher removal — full rip-out completion plan (2026-06-25)

**Decision (confirmed 2026-06-25):** finish the entity-as-tag end-state. No
global switcher; the app is always all-entities; the trust is a filterable tag
on reads and an explicit choice at create/action time. This is the completion of
Track C (see `multi-entity-dimension-plan-2026-06-25.md` +
`multi-entity-filter-ux-brief-2026-06-25.md`).

This doc is the execution brief. It's structured for slice-by-slice work
(Codex- or operator-driven, locally, where the full Playwright suite iterates
fast) with the canonical patterns + the per-surface list derived from the
103 smoke failures.

## Where we are

- **Done (org-wide reads + clickable trust tag):** People, Operations queue,
  Comms, Notifications, Properties.
- **Done (action trust picker — the worked example):** AI Inbox classify/promote
  (`apps/web/src/app/inbox/page.tsx`, derived `actionEntityId`).
- **Done:** Dashboard Relby-AI ask targets a real entity (not the sentinel);
  smoke switcher helpers (`selectWorkspaceEntity`,
  `selectAllEntitiesFromWorkspaceSwitcher`) are no-op shims; people-hub merge
  test reworked off the switcher.
- **WIP (uncommitted):** the switcher-removal forced `selectedEntityId =
  ALL_ENTITIES_VALUE` app-wide. Local full smoke after that:
  **293 passed · 103 failed · 16 skipped.** Don't push until green.

## The 103 failures are ~2 source gaps + test drift

The WIP forced all-entities on ~15 surfaces that were built assuming
single-entity. The failures group cleanly:

1. **Pages render no data in all-entities mode (~50).** Their data queries are
   `enabled: Boolean(scopedEntityId)` with no org-wide fallback, so with
   `scopedEntityId === ""` they're permanently disabled → content never renders.
   (insights, dashboard, billing-readiness, properties calendar, smart-intake,
   intake-conversation, workflows, comms template catalog/preview, people-hub
   owners, ai-global-ask, etc.)
2. **Action buttons disabled "Select a single entity to…" (~30).** Write/action
   buttons gated on a single entity → dead in all-mode. (Add contractor, Send
   invite, Stage suggestions, Suggest fixes, New template, Complete check, Add
   evidence, Recreate draft, Review reminders, arrears promise-to-pay, etc.)
3. **Test drift (~20).** Switcher-existence assertions, obsolete scope-switch
   tests, single-entity total/count expectations now seeing merged data,
   CSV-filename and strict-mode-duplicate drift.

## The two canonical fix patterns

### Pattern A — org-wide read path (fixes group 1)

For a page whose reads gate on `scopedEntityId`:
- If the backend list endpoint already scopes a missing `entity_id` to all
  readable entities (Track A did this for the core lists), call it org-wide:
  pass `""`/omit and drop the `enabled: Boolean(scopedEntityId)` gate.
- If the read is computed per-entity with no org-wide endpoint, use
  `useEntityFanOut` with an `orgWideQueryFn` (single call) or a per-entity
  fan-out, exactly like Track B (`comms`/`notifications`) and People.
- Rows stay entity-tagged so the per-list trust-tag filter (`?trust_tag`) works.
- Reference: `src/app/people/page.tsx`, `src/lib/use-entity-fan-out.ts`,
  Track B commits.

### Pattern B — action/create trust picker (fixes group 2)

For a write/action gated on one entity:
- Add a derived `actionEntityId = actionEntityOverride || entityOptions[0]?.id
  || ""` (operator's choice, else first accessible entity), backed by a small
  "File under trust" / "Trust" selector shown when >1 entity.
- Route the action's guard, payload `entity_id`, and any action-scoped pickers
  through `actionEntityId` (not `scopedEntityId`).
- Remove the `disabled title="Select a single entity to …"` gating.
- Keep it review-first — no provider write changes (§2.1).
- **Worked example: `src/app/inbox/page.tsx`** (read it first; copy the shape).

### What STAYS single-entity (with an in-page picker, not the shell)

Genuinely per-entity legal/accounting surfaces keep an entity selector, but
rendered **in-page** (their own header), not in the removed shell switcher:
**Settings/Xero, Settings/Basiq, Statements.** These already own an
`EntityPicker` (`allowAllEntities=false`); the work is to render it in-page and
fix the tests that asserted the *shell* switcher.

## Per-surface conversion list (from the failure list)

Pattern A (org-wide reads):
- `app/insights/page.tsx` — overview/exceptions/finance reads.
- `components/dashboard.tsx` — Today's-focus/compliance/upcoming-events/bento
  reads (the ask is already fixed).
- `app/billing-readiness/page.tsx` — month-end/rent-roll/draft reads (audit:
  some already fan out — confirm the gated ones).
- `app/properties/*` calendar + map reads (`properties-map-calendar`).
- Smart Intake review queue (`app/intake/*`, `intake-conversation`) reads.
- `app/operations/page.tsx` workflows tab + the Workflows surface reads.
- Comms template catalog/preview reads.
- People-hub Owners directory read (managing-agent/hybrid).
- `ai-global-ask` handed-off ask (needs a real entity, like dashboard).

Pattern B (action/create trust picker):
- Portfolio-QA (`portfolio-qa-guided`, `portfolio-qa-ux`): Stage suggestions,
  Suggest fixes, Select ready, bulk-fix apply.
- Contractors (`contractors`, `app-flows` add-contractor): Add contractor.
- Tenants (`tenants-ux`, `app-flows`): Send invite, Review reminders.
- Operations compliance (`operations-compliance`): Complete with linked
  evidence, Add evidence, upload+link.
- Operations (`operations-ux`): status edit, arrears promise-to-pay.
- Billing-readiness: Recreate draft, Create this month's invoices.
- Comms template editor/versioning: New template, Edit, manage.
- Workflows: New workflow / approve-proposal actions.

Stays single-entity (in-page picker + test fix):
- Settings Xero (`app-flows:6698`), Settings/Basiq, Statements.

## Test rework

- Switcher helpers → no-op shims (done).
- `seedPrimaryEntitySelection` is now inert; tests asserting single-entity
  totals must either expect all-entities totals or apply a `?trust_tag` filter
  step first.
- Switcher-existence assertions (`getByLabel("Entity")`, "Workspace switcher"
  group: `app-flows:246/6698`, `dashboard-command-center:196`,
  `mobile-bottom-nav:75/176`, `people-record-layout`, `smart-intake-deep-link`)
  → assert the switcher is gone / brand + account shown, or the in-page picker
  for the single-entity surfaces.
- Obsolete scope-switch tests (`contractor/tenant ... blocks submit after
  switching scopes`, `fresh storage defaults to All entities`, properties
  "drops into one") → rewrite to the trust-tag / action-picker model or delete.
- Drift: CSV filename "undated" → ensure the date is available org-wide;
  strict-mode duplicate-text matches (`dashboard bento`, `nav-consolidation
  Preferred`) → scope the locator.

## Ordered bite-sized slices (each a commit, verified by the local suite)

Work Pattern-B surfaces and Pattern-A surfaces in small per-surface commits;
after each, run the targeted spec(s) then the full suite before moving on.

1. Inbox classify (DONE — reference).
2. Dashboard reads org-wide (ask DONE) → green `dashboard-command-center` +
   `app-flows` dashboard.
3. Insights reads org-wide → `insights` spec.
4. Billing-readiness reads + actions → `billing-readiness-ux`.
5. Smart Intake + intake-conversation reads + actions → those specs.
6. Workflows reads + actions → `workflows`.
7. Portfolio-QA actions (DONE — row-scoped/cross-portfolio exception) →
   `portfolio-qa-guided` + `-ux`.
8. Contractors + Tenants actions → `contractors`, `tenants-ux`, `app-flows`.
9. Operations compliance + ux actions → `operations-compliance`, `operations-ux`.
10. Comms template editor/catalog/preview/versioning → those specs.
11. Properties calendar/map reads + properties-ux totals → `properties-*`.
12. Settings/Statements: render entity picker in-page; fix shell-switcher tests.
13. Mobile-bottom-nav / people-record-layout / nav-consolidation switcher +
    duplicate-locator test fixes.
14. Final: full suite green → eslint + tsc → commit the whole slice → push.

## Verification (local — fast iteration is the whole point)

```
cd apps/web
export SMOKE='NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs'
eval $SMOKE ./node_modules/.bin/playwright test <spec-or-file>   # per slice
eval $SMOKE ./node_modules/.bin/playwright test --ui             # debug a flow
./node_modules/.bin/playwright show-trace test-results/<dir>/trace.zip
./node_modules/.bin/eslint src && ./node_modules/.bin/tsc --noEmit
```
Full suite must reach green before the final commit.

## Guardrails

- §2.1: actions stay review-first; no Xero/SendGrid/Twilio/payment writes added.
  Pattern B only chooses the *target trust* for an already-review-first action.
- §2.2: the create/action pickers + any density change are design-facing — run
  the UX gate (1440/390) and log a UX Pass Log line when the slice lands.
- Don't push until the full suite is green (the WIP is uncommitted; the prod
  deploy gate is the human).
