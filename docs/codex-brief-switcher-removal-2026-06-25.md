# Codex brief — finish the entity switcher rip-out (2026-06-25)

**Read first:** `docs/switcher-removal-completion-plan-2026-06-25.md` (the
per-surface list + canonical patterns) and `apps/web/CLAUDE.md`. This brief is
the execution wrapper: rules, worked examples, slice order, verification.

## Mission

The global entity switcher is being removed; the app is always all-entities and
the trust becomes a filterable tag on reads + an explicit choice at
create/action time. A WIP that forced `selectedEntityId = ALL_ENTITIES_VALUE`
app-wide is already in the working tree (uncommitted) and left ~15 surfaces
broken: local full Playwright smoke is **293 passed · 103 failed · 16 skipped**.
Drive it to green, slice by slice. **Do not push** — Temba reviews and pushes.

## Ground rules (non-negotiable)

- **You are not alone in this tree.** Temba edits/commits the same Mac working
  tree. `git fetch` + `git status --short` before starting and after any pause;
  never revert unrelated changes. There is already uncommitted WIP here — build
  on it, don't discard it.
- **Surgical.** Every changed line traces to a failing test / the patterns
  below. Match existing Horizon styling and tokens; reuse existing components.
- **§2.1 provider guardrail:** add no Xero/SendGrid/Twilio/payment/tenant-email
  writes. Pattern B only chooses the *target trust* for an action that is
  already review-first. Tests must keep mocking providers.
- **§2.2 UX gate:** the create/action trust pickers and any density change are
  design-facing — eyeball 1440/390 and add a UX Pass Log line in
  `docs/design-governance.md` when a slice lands.
- **Commit style:** terse imperative subject; multi-line body listing files +
  why; one slice per commit; NO "Generated with"/co-author lines.
- **Do NOT push.** Commit locally per slice; Temba pushes once the full suite is
  green. If a `.git/index.lock` blocks a command, rename it
  (`mv .git/index.lock .git/index.lock.bak-<ts>`) and retry.

## The two patterns (copy these, don't invent)

### Pattern A — org-wide read path
A page whose data query is `enabled: Boolean(scopedEntityId)` shows nothing in
all-mode. Fix: read org-wide when no entity is pinned.
- If the list endpoint already scopes a missing `entity_id` to all readable
  entities (Track A did the core lists), call it with `""`/omit and drop the
  `enabled` gate.
- If the read is computed per-entity, use `useEntityFanOut` with `orgWideQueryFn`
  (one request) or a per-entity fan-out.
- Keep rows entity-tagged so the `?trust_tag` filter still narrows.
- **Reference:** `src/app/people/page.tsx`, `src/lib/use-entity-fan-out.ts`,
  and the comms/notifications Track B commits.

### Pattern B — action/create trust picker
A write/action gated on a single entity renders a disabled button titled
"Select a single entity to …". Fix: give the action an explicit target trust.
- Add `const actionEntityId = actionEntityOverride || entityOptions[0]?.id ||
  ""` (operator's choice, else first accessible entity) + a small "File under
  trust" selector shown when there is >1 entity.
- Route the action's guard, payload `entity_id`, and action-scoped pickers
  through `actionEntityId` (not `scopedEntityId`); remove the disabled-gating.
- **Worked example already in the tree: `src/app/inbox/page.tsx`** — read it,
  copy the shape (derived `actionEntityId`, the selector, the guard/payload
  wiring). It revived the 8 AI-mailbox flows.

### Stays single-entity (don't force all-entities)
Settings/Xero, Settings/Basiq, Statements are legitimately per-entity. Render
their existing `EntityPicker` (`allowAllEntities=false`) **in-page** (their own
header) instead of the removed shell slot, and fix the tests that asserted the
shell switcher.

## Slice order (one commit each; verify before moving on)

Per-surface, smallest first. After each slice: run its targeted spec(s) green,
then the full suite before the final commit.

1. **Inbox classify — DONE** (reference for Pattern B).
2. **Dashboard reads org-wide** (ask already fixed) → `dashboard-command-center.spec.ts` + `app-flows` dashboard tests.
3. **Insights reads org-wide** → `insights.spec.ts` + `app-flows:7685`.
4. **Billing-readiness reads + recreate/create actions** → `billing-readiness-ux.spec.ts` + `app-flows` billing tests.
5. **Smart Intake + intake-conversation reads + actions** → `intake-conversation.spec.ts`, `smart-intake-*`, `app-flows:630/688/5197+`.
6. **Workflows reads + actions** → `workflows.spec.ts`.
7. **Portfolio-QA actions** → `portfolio-qa-guided.spec.ts`, `portfolio-qa-ux.spec.ts`, `app-flows:2845`.
8. **Contractors + Tenants actions** → `contractors.spec.ts`, `tenants-ux.spec.ts`, `app-flows` add-tenant/send-invite/scope tests.
9. **Operations compliance + ux actions** → `operations-compliance.spec.ts`, `operations-ux.spec.ts`, `app-flows:3039`.
10. **Comms template editor/catalog/preview/versioning + CSV date** → those specs + `comms-export-parity`, `comms-outbound-log-export`.
11. **Properties calendar/map reads + properties-ux totals** → `properties-map-calendar.spec.ts`, `properties-ux.spec.ts`, `app-flows:4498`.
12. **Settings/Statements in-page picker + shell-switcher test fixes** → `app-flows:6698`, settings specs.
13. **Switcher/dup-locator test fixes** → `mobile-bottom-nav.spec.ts`, `people-record-layout.spec.ts`, `nav-consolidation.spec.ts`, `app-flows:246/4564`, `dashboard bento` strict-mode.
14. **Final:** full suite green → `eslint src` + `tsc --noEmit` clean → commit the consolidated slice → stop (Temba pushes).

Test-rework notes: switcher helpers are already no-op shims;
`seedPrimaryEntitySelection` is now inert, so single-entity-total assertions
must expect all-entities totals or apply a `?trust_tag` step; switcher-existence
assertions become "switcher gone / brand + account shown"; obsolete
scope-switch tests get rewritten to the trust-tag/action-picker model or deleted.

## Verify (local; this is why it's local)

```
cd apps/web
export SMOKE='NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs'
eval $SMOKE ./node_modules/.bin/playwright test <spec>      # per slice
eval $SMOKE ./node_modules/.bin/playwright test --ui        # debug a flow
./node_modules/.bin/playwright show-trace test-results/<dir>/trace.zip
./node_modules/.bin/eslint src && ./node_modules/.bin/tsc --noEmit
eval $SMOKE ./node_modules/.bin/playwright test             # full suite before final commit
```
If `:3000` is occupied by a stale dev server: `lsof -ti:3000 | xargs kill -9`.

## Report back per slice

Files changed + which specs went green, plus the running full-suite tally. Do
not claim a slice done without green targeted spec + eslint/tsc; do not claim
the project done without a green full suite. Flag any surface where the right
new behavior is a product decision (e.g. what an all-entities Relby-AI ask or a
portfolio-wide action should target) rather than guessing.
