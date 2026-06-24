# Plan — Stabilization v2 (Observability → Data integrity → Real-data MVP pass)

Follows `2026-06-19-platform-stabilization-v1.md` (CI + Smart Intake hardening,
in flight via Codex). Three thrusts Temba chose (2026-06-19), in execution order:

1. **Observability + alerting** — so you hear about prod breakage in minutes.
2. **Data-integrity sweep of the live register** — clean the dupes/orphans the
   pre-fix matching left behind.
3. **Real-data MVP-readiness pass** — drive SKJ's daily workflows on prod, punch-list the breaks, fix the blockers.

The order is deliberate: monitoring goes first so anything that breaks during the
sweep or the MVP pass is caught; the data sweep precedes the MVP pass so you're
exercising a clean register, not chasing noise from bad data.

## Status — 2026-06-19 (not started; gated on v1 landing clean)

## Why this plan (grounded in recon)

- **Backend Sentry is wired but DSN-gated** (`apps/api/main.py:60` — `if
  settings.sentry_dsn:`, env-tagged, `traces_sample_rate=0.1`, init-safe). It
  captures nothing unless `SENTRY_DSN` is set on Render. **No frontend error
  monitoring exists** (`@sentry/nextjs` absent from `apps/web/package.json`) — the
  UI users touch is currently a blind spot.
- **The v1 matching fixes are forward-only.** They stop new duplicate properties
  but don't clean the dupes/orphans already in the live SKJ register from the
  buggy period. `scripts/reconcile_building_units.py` already does building dedup
  (dry-run default, `--apply`, idempotent, entity-scoped, provider-inert) — but
  only buildings; other orphan/dupe classes have no tool yet.
- Internal-first means the real test is **"can SKJ run their day on it"** — best
  found by actually driving prod, not by speculation.

## Iron laws (superpowers methodology — non-negotiable)

1. **No production code without a failing test first** (applies to the new
   integrity script + any fixups in Phase 2 and fixes in Phase 3).
2. **No fix without a root cause.**
3. **No "done" without fresh evidence** — paste the passing test / a real Sentry
   event / the dry-run plan output.
4. **Review-first on real data.** Every hosted-data mutation is **dry-run →
   review → backup → apply**. Provider guardrail (§2.1) holds throughout.
5. **Surgical (§1.3).** Stabilisation, not features.
6. **Agent-first execution** for the code slices (integrity script TDD, frontend
   Sentry wiring, MVP-pass cataloguing can parallelise); verify every result.
7. **Hosted-data runs are operator-run.** Anything touching the live Neon DB runs
   on Temba's Mac (Desktop Commander) with the hosted `DATABASE_URL` — never the
   Cowork sandbox. Claude/Codex prepare and dry-run; Temba approves `--apply`.

## Tooling

- Backend/scripts: `.venv/bin/python -m scripts.<name> ...`, `.venv/bin/python -m pytest`, `.venv/bin/alembic current`/`upgrade head`.
- Hosted dry-run: `DATABASE_URL=<neon> .venv/bin/python -m scripts.reconcile_building_units --match <x>` (read-only without `--apply`).
- Frontend: pnpm; `eslint`/`tsc`/`next build`; smokes with `NODE_ENV=development`.

---

## Phase 1 — Observability + alerting (smallest, do first)

### Ticket 1.1 — Confirm backend Sentry is actually live on Render
- **Implementation:** verify `SENTRY_DSN` + `SENTRY_ENVIRONMENT=production` are set
  on the Render API service. Trigger a known test error (a temporary, auth-gated
  `/api/v1/system/_debug-error` route, or a one-off) and confirm the event lands in
  Sentry with the right environment tag and request context.
- **Guard PII:** keep `send_default_pii=False` (Sentry default) and add a
  `before_send` scrubber for tenant emails/names/ABNs — you hold real portfolio
  data; errors must not leak it. Add a small unit test for the scrubber.
- **Verify:** a real event visible in Sentry (paste a screenshot/issue link);
  scrubber test green. Remove the debug route after.

### Ticket 1.2 — Add Next.js frontend error monitoring (the real gap)
- **Red first:** a smoke that asserts the Sentry client init module loads without
  throwing and is wired into the App Router error boundary.
- **Implementation:** add `@sentry/nextjs`, DSN via `NEXT_PUBLIC_SENTRY_DSN` on
  Vercel, environment tag, source-map upload, and a global `error.tsx` boundary
  that reports. Keep sampling modest. Same PII discipline as 1.1.
- **Verify:** `eslint`/`tsc`/`next build` clean; smoke green; a deliberate
  client-side throw on a preview deploy appears in Sentry.

### Ticket 1.3 — Alerting so you're notified
- **Implementation:** Sentry alert rules → email and/or the connected Slack:
  new-issue and error-spike on the production environment, separate frontend vs
  backend projects/tags. Document the routing in `docs/deployment.md`.
- **Verify:** a test alert reaches the channel; routing documented.

---

## Phase 2 — Data-integrity sweep of the live register (after monitoring is live)

> Sequence: dry-run everything against hosted (read-only) → review → **Neon branch
> as backup** (Launch plan supports branching) → `--apply` → re-run to confirm idempotent/clean.

### Ticket 2.1 — Building dedup dry-run against the live SKJ register
- **Implementation:** run `scripts.reconcile_building_units --match <each likely
  building group>` against hosted (no `--apply`). Capture the printed plan: which
  properties merge, units/obligations/documents/leases re-pointed, which are
  soft-deleted.
- **Verify:** the plan is reviewed and sane (no cross-trust merges, B6≠B3 stay
  separate). Take a Neon backup branch, then `--apply`; re-run dry-run → empty plan
  (idempotent). Paste before/after property+unit counts.

### Ticket 2.2 — Read-only integrity report for the classes reconcile doesn't cover
- **Red first:** seed a fixture with each defect, assert the report finds exactly
  them: orphan units (live unit, soft-deleted property), leases referencing
  soft-deleted property/unit, duplicate tenants by ABN and by name, obligations /
  stored documents / charge rules pointing at merged-away or dead records.
- **Implementation:** new **read-only** `scripts/integrity_report.py` (prints
  findings grouped by class + entity, mutates nothing, provider-inert). Mirror the
  reconcile script's structure and entity scoping.
- **Verify:** test green; run against hosted (read-only) and review the real findings.

### Ticket 2.3 — Review-first fixups for what the report finds
- **Red first:** per defect class actually present in the live data, a test that a
  targeted fixup (extend reconcile or a small guarded fixer) repairs it and is
  idempotent.
- **Implementation:** only build fixers for classes that actually appear. Same
  dry-run → backup → apply discipline. Audit-log every mutation.
- **Verify:** report re-run shows the class cleared; full `tests/` suite green.

### Ticket 2.4 — Confirm hosted migrations + audit completeness
- **Implementation:** `alembic current` on hosted == `head`; if behind, upgrade
  (Render start command already runs `alembic upgrade head`). Spot-check that the
  import/backfill/merge actions wrote audit rows.
- **Verify:** hosted at head; audit spot-check documented.

---

## Phase 3 — Real-data MVP-readiness pass (after the register is clean)

Goal: prove SKJ can run their day on it, and turn what doesn't work into a ranked
backlog — this becomes the post-stabilisation roadmap.

### Ticket 3.1 — Drive the golden paths on prod, build a punch-list
- **Golden paths** (run each end-to-end on production with real data, screenshot
  desktop + mobile): (a) Smart Intake a real lease doc → property/unit/tenant/lease
  correct with provenance; (b) Properties/Units register reads right post-dedup;
  (c) Tenants + tenant portal token + account flows; (d) Work — maintenance + arrears
  lifecycle; (e) Money — billing/statement generation + Xero review-first (no
  mutation without approval); (f) Insights/compliance snapshot.
- **Output:** `docs/mvp-readiness-punchlist-2026-06-19.md` — every break, confusing
  copy, slow page, or missing affordance, each tagged Blocker / Annoyance / Polish
  and which golden path it sits on.
- **Verify:** all six paths exercised; punch-list captured with severities.

### Ticket 3.2 — Fix the Blockers (only)
- **Red first:** each Blocker reproduced as a failing test (backend integration or
  frontend smoke) before the fix; CI (from v1) enforces it.
- **Implementation:** fix Blockers in-slice, surgical. Annoyances/Polish go to the
  backlog, not this phase — resist scope creep.
- **Verify:** Blocker tests green in CI; re-run the affected golden path on prod.

---

## Definition of done

- Backend Sentry confirmed capturing prod errors (PII-scrubbed); frontend
  `@sentry/nextjs` live; alerts reaching email/Slack.
- Live SKJ register deduped (building reconcile applied + idempotent) and the
  integrity report comes back clean; hosted at migration head.
- All six golden paths exercised on prod; punch-list written; every Blocker fixed
  with a CI-enforced regression test.
- No feature work, no provider mutation, no destructive hosted change without
  dry-run + backup + review. Docs updated (`deployment.md`, punch-list,
  `next-chat-handover.md`).

## Out of scope

Workflows builder (parked); reporting/Calendar; new features; Annoyance/Polish
punch-list items (deferred to the post-stabilisation backlog that Phase 3 produces).
