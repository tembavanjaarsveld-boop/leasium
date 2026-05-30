# MVP UX And Performance Review - 2026-05-30

## Outcome

The operator workspace is materially faster after the prototype-to-MVP pass. The main win came from removing avoidable client-side waits: the dashboard can now show useful command-center and metric data from a single first-paint overview while the heavier detail queries continue in the background.

## Shipped

- Dashboard first-paint overview: new `GET /api/v1/dashboard/overview` returns selected entity, work counts, rent-roll summary, intake counts, and upcoming lease events for the home screen.
- Progressive dashboard loading: command center and metric cards can render from overview data instead of waiting for properties, tenants, obligations, rent roll, onboarding, document intakes, insights, and activity feed to all finish.
- Stored entity bootstrap: the dashboard starts with the last selected entity from local storage, then reconciles once `/entities` returns.
- Shared query cache: React Query now lives at the root app layout with longer stale time, lower refetch churn, and no window-focus refetch.
- Auth token warmup and dedupe: frontend API calls reuse a short-lived cached Clerk token and share any in-flight token request.
- Persistent nav prefetch disabled: shell-owned links no longer trigger route prefetch requests for every visible sidebar/header destination.
- Live audit harness: `npm run audit:live` can run repeatable desktop/mobile route checks, screenshots, slow-request capture, console-error capture, and overflow checks. Use `npm run audit:live -- --login` first to save a signed-in browser session.
- API request timing: FastAPI responses now include `x-request-id` and `server-timing`, with route/status/duration logs for live slow-page diagnosis.
- Clerk JWKS reuse: the API reuses a process-wide Clerk JWKS client instead of constructing it for every protected request.
- DB pool tuning: production database pool size, overflow, timeout, and recycle settings are now configurable.
- Same-origin API path: Vercel can proxy `/api/v1` and `/health` to the Render API so production browser calls can use `NEXT_PUBLIC_API_BASE_URL=/api/v1`.

## Verification

- Frontend lint, TypeScript, Prettier, and production `next build` passed.
- Backend Ruff, mypy, auth tests, dashboard API tests, and insights API tests passed.
- Focused smoke tests proved:
  - entity bootstrap stays warm across operator navigation,
  - stored entity lets dashboard data start before `/entities` settles,
  - dashboard overview clears first-paint loading before detailed fan-out settles,
  - app shell disables automatic prefetch for persistent navigation.
- Broader smoke pass covered dashboard, app shell, insights, operations, properties, settings, and Xero settings.

## Remaining Snappiness Work

The remaining delay is likely mostly live infrastructure and observability, not screen composition.

Priority next steps:

1. Deploy the same-origin API setting in Vercel: `NEXT_PUBLIC_API_BASE_URL=/api/v1`.
2. Confirm Render API plan is always-on and close to the Neon database region.
3. Set DB pool env vars deliberately for the Render service after checking plan limits.
4. Run `npm run audit:live -- --login`, then `LEASIUM_AUDIT_URL=https://leasium.ai npm run audit:live` and compare desktop/mobile slow requests.
5. Add Vercel Speed Insights or equivalent web-vitals capture.
6. Add a Render log drain or Sentry/OpenTelemetry before broad MVP traffic.
7. Consider Redis or SQL aggregate tables for dashboard overview if real portfolio row counts grow beyond the current prototype scale.

## Live Audit Continuation - 2026-05-30 (signed-in)

Ran the live harness against `https://leasium.ai` signed in as
`temba@skjcapital.com` (SKJ Property Pty Ltd), desktop + iPhone-13, across
Dashboard, Properties, Tenants, Operations, Statements, Insights, Settings.
Full-page screenshots and the route report are under
`output/playwright/live-audit/`.

### What is healthy

- **No horizontal overflow on any route, desktop or mobile.** Dense tables
  use `overflow-x-auto` + `hidden md:block` with mobile card / disclosure
  fallbacks (e.g. Operations queue rows collapse assignee + complete/waive
  into a "Work controls" disclosure on mobile).
- **No page errors, no console errors** on any route.
- Loading, empty, and locked states are calm and specific (statements finance
  checklist, dispatch approval queue, insights exceptions all read well).
- Visual polish (chips, density, spacing, hierarchy, touch targets) is
  consistent across surfaces. The visual layer is in good MVP shape.

### Dominant latency finding: the sidebar badge endpoint

Every route's slowest request is `GET /api/v1/comms/queue/counts` at
**~6.5-8.1s**, desktop and mobile alike. It gates `networkidle` and so sets
the perceived "settled" time (~13-15s) on every page.

Root cause: `apps/api/routers/comms.py::get_comms_queue_counts` is documented
as "lightweight" but runs the **full set of eight queue scanners**
(`_inbound_email_candidates`, `_arrears_candidates`, `_compliance_candidates`,
`_insurance_candidates`, `_lease_renewal_candidates`, `_rent_review_candidates`,
`_tenant_lifecycle_stall_candidates`, `_maintenance_forwarding_candidates`) -
the same scan as the real `/queue`. Each scanner does per-row `session.get(...)`
lookups (N+1) and builds full subject/body/detail strings, then the endpoint
throws all that away and returns `len(candidates)` + a severity tally. The
badge pays the full queue price to render a number, on a constrained Render
worker, on every navigation.

Fix applied (frontend, surgical): the badge query in
`apps/web/src/components/app-shell.tsx` had overridden the root QueryClient's
no-focus-refetch policy with `refetchOnWindowFocus: true`, re-running the 7s
scan every time the operator tabbed back to Leasium. Set
`refetchOnWindowFocus: false` and raised `staleTime` 60s -> 5min so the scan
stops firing on tab focus and on every short-interval navigation. eslint + tsc
clean; no smoke test asserts the changed behaviour.

Recommended backend follow-up (review-first, needs backend tests + operator
call - not done unprompted because the scanners are shared with the live comms
queue): make `/comms/queue/counts` actually cheap. Either (a) compute counts
from light count-only queries that replicate the scanner filters without
building candidate payloads, or (b) cache the counts per entity (~60s TTL,
Redis is already in compose) so navigations reuse a recent count. Option (a)
risks count/queue divergence if the filters drift; option (b) is simpler and
keeps a single source of truth. This single endpoint is the highest-leverage
remaining snappiness win after the infra items above.

### Lower-priority note

The insights route briefly showed a run-on loading string
("Loading Xero status does not refresh tokens, call Xero, post invoices, or
reconcile payments") during settle. The exact text is not present verbatim in
`apps/web/src` - it looks like a transient concatenation of a loading label and
an adjacent guardrail caption rather than a persistent rendered string, so it
was left untouched pending a live repro. Worth a glance when the Xero status
panel is next in hand.
