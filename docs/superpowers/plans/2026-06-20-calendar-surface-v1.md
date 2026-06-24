# Plan — Calendar surface v1 (unified operations calendar, read-only lens)

Next product build after stabilization (Temba picked Calendar, 2026-06-20).
Design-facing → **Figma frame + Temba sign-off gate first** (CLAUDE.md §2.2/§2.12)
before any build. This brief is the design doc that seeds that frame.

## Status — 2026-06-20 (not started; awaiting scope confirm + Figma sign-off)

## What it is

One place to see everything dated across the portfolio — lease expiries, rent
reviews, work/maintenance due dates, compliance/inspection due dates, billing/
arrears milestones, reminders, and onboarding/move-in dates — on a month grid +
agenda list, each item clicking through to its source record.

**v1 is a read-only lens over data that already exists.** No new "event" model,
no creating/editing events on the calendar, no external calendar sync. This is
what makes it low-risk and fast.

## Reuse what's already built (don't rebuild)

- `apps/web/src/components/properties/PropertyCalendarMonthGrid.tsx` — month-grid
  component already used by the Properties "Calendar" view. Generalise/reuse it.
- `apps/web/src/components/dashboard/UpcomingLeaseEventsPanel.tsx` + the dashboard
  lease-events aggregation (`apps/api/routers/dashboard.py`) — the existing
  "upcoming lease events / horizon" logic is the seed for the events endpoint.
- Dated sources to union (read-only): leases (expiry, rent review), work orders
  (due/scheduled — `maintenance`/work routers), compliance checks (next due —
  `compliance.py`), obligations (`obligations.py`), charge rules / invoice due
  (`charge_rules.py`), reminders (`comms.py`/work notifications), tenant
  onboarding (`tenant_onboarding.py`).

## Decisions (locked 2026-06-20)

1. **Event sources:** ALL — lease dates (expiry + rent review), work/maintenance
   due, compliance/inspection due, and the billing/arrears/reminders/onboarding
   layer. Full unified calendar.
2. **Placement:** a **Calendar tab inside the Work hub** (`/operations?tab=calendar`),
   alongside Queue / Maintenance / Compliance / Arrears. Honours the §2.10 sidebar
   cap (no new top-level item, no global route or palette wiring needed).
3. **Views.** Proposed: **month grid** (reuse the component) **+ an agenda/list**
   view (better on mobile and for a small portfolio). Default to agenda on mobile,
   month on desktop.
4. **Entity scope.** Proposed: selected-entity by default with an **All entities**
   option, matching the dashboard's entity behaviour.
5. **Interactivity.** Proposed: read-only. Clicking an item deep-links to its
   source record (lease, work order, compliance check, etc.). Editing happens on
   the source record, not the calendar.

## Phase 0 — Design sign-off (human gate; do first)

Calendar reuses the shipped `PropertyCalendarMonthGrid` + the approved Work-hub tab
pattern, so the design basis already exists. Sign-off route (Temba's call): either a
Figma frame in `PO2jOANgmqgZHfqWZXOZGU` (month + agenda, source/severity-coloured
chips, entity selector, empty/loading states, 1440 + 390), or build-to-spec with the
in-slice UX-pass screenshots as the sign-off artifact. Either way: no "done" without
the UX pass + Temba's ok. Record the outcome in `docs/design-governance.md`.

## Phase 1 — Backend: read-only events aggregation

### Ticket 1.1 — `GET /api/v1/calendar/events`
- **Red first:** `tests/integration/test_calendar_api.py` — seed a lease expiry, a
  work order due date, and a compliance next-due in a window; assert the endpoint
  returns exactly those 3 events with `{type, title, date, severity, entity_id,
  source: {table, id}, link}` and respects `from`/`to`/`entity` filters and
  entity-role auth (happy path + 403).
- **Implementation:** new router `apps/api/routers/calendar.py` + schema, unioning
  the dated sources above using the **same query patterns** as the dashboard
  lease-events aggregation and the compliance/obligations reads. Read-only;
  provider-inert (no Xero/SendGrid/Twilio/payment). Org/entity scoped.
- **Verify:** backend tests green; ruff clean; a guardrail assertion that the
  endpoint performs no mutation/provider call.

## Phase 2 — Frontend: `/calendar` surface

### Ticket 2.1 — Calendar tab in the Work hub (month + agenda) reusing the grid
- **Red first:** smoke `apps/web/tests/smoke/calendar.spec.ts` (+ api-mocks) — the
  Work hub **Calendar tab** (`/operations?tab=calendar`) renders the month grid with
  seeded events, the agenda toggle lists them, an event click deep-links to its
  source record, entity switch refilters, and empty/loading states read in plain
  language.
- **Implementation:** add a **Calendar tab** to the Work hub tablist
  (`/operations?tab=calendar`) reusing `PropertyCalendarMonthGrid` (lift to a shared
  component) + an agenda list; typed client in `api.ts`. No new sidebar item.
- **UX gate (same session, §2.2):** screenshots at 1440 + 390, hallmark slop test,
  fix in-slice, UX Pass Log line in `docs/design-governance.md`.
- **Verify:** smoke green (`NODE_ENV=development`); `eslint`/`tsc`/`next build` clean.

## Phase 3 — Docs + ship

Update `docs/product-roadmap.md` (split the bundled "reporting/Calendar/Workflows"
line — mark Calendar shipped), `docs/design-governance.md` (UX pass + node IDs),
`docs/next-chat-handover.md`. Commit per-topic (gmail identity); verify Vercel READY.

## Out of scope for v1

Creating/editing events on the calendar; external calendar sync (Google/Outlook/
iCal feed); drag-to-reschedule; Workflows builder (parked); reporting (separate).
These are clean v2 candidates once the read-only lens proves useful.

## Ready for Codex

Scope is locked (above). Recommended design-gate path given the heavy reuse: build
to spec and use the in-slice UX-pass screenshots (1440/390 + slop test) as the
sign-off artifact — a from-scratch Figma frame is optional here. Hand this brief to
Codex to build: Phase 1 backend events endpoint → Phase 2 Work Calendar tab →
Phase 3 docs. Review-first and CI-enforced throughout.
