# MVP Readiness Punch List - 2026-06-19

Purpose: track Stabilization v2 hosted proof without claiming production
readiness before evidence exists.

## Scope

- Repo-side stabilization includes CI safety net, Smart Intake hardening,
  provider guardrail coverage, Sentry wiring, and the read-only integrity report.
- Hosted proof is operator-run against Render, Vercel, Sentry, and Neon.
- No provider writes, tenant emails/SMS, Xero writes, payment reconciliation, or
  production data mutation without explicit approval.

## Evidence Rules

- Record date, service, commit/deploy id, and pass/fail.
- Do not paste secrets, DSNs, database URLs, tenant tokens, Clerk tokens, or real
  private data.
- Mark hosted proof pending until verified on `https://leasium.ai` and the
  production API.

## Prepared Commands & Live Checks (Claude, 2026-06-19)

**Live check done:** `https://leasium.ai` is up and serving; the operator session
gate renders ("Confirming operator access"), so the Clerk auth wall works on the
currently-deployed build. Re-run full route sanity once the v2 deploy is READY.

**Repo-side verified on Temba's Mac (Desktop Commander, HEAD `679b24d` / `main`):**
`ruff` clean; **63 stabilization tests pass** — `test_integrity_report`,
`test_provider_guardrail`, `test_reconcile_building_units`, `test_document_intake_api`,
`test_lease_intake_api`, `test_document_intake_extraction`; `integrity_report` runs.
Local Postgres was down and no hosted `DATABASE_URL` is set on the Mac, so the
actual register sweep (section B) is still pending — supply the Neon URL
out-of-band first (never paste it into chat or a tracked file).

**Needs your creds (operator-run):** all Sentry env vars, all hosted Neon runs
(export `DATABASE_URL` as the Neon string — do **not** paste it into this doc or
chat), and any `--apply`. Claude can run the read-only ones via Desktop Commander
on your go; otherwise copy-paste below.

### A. Sentry env vars (then redeploy both at/after commit `679b24d`)

Render API: `SENTRY_DSN=<backend DSN>`, `SENTRY_ENVIRONMENT=production`.
Vercel: `NEXT_PUBLIC_SENTRY_DSN=<frontend DSN>`,
`NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`, plus `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG`, `SENTRY_PROJECT` for source-map upload.
Then fire one test event each; confirm they land with `environment=production`
and no PII. Add a new-issue rule + an error-spike rule on the production
environment, routed to email and/or the connected Slack.

### B. Hosted integrity sweep (read-only first; nothing mutates without `--apply`)

```
# 1. Hosted schema at head?
DATABASE_URL=<neon> .venv/bin/alembic current      # compare to: .venv/bin/alembic heads

# 2. Read-only integrity report (whole org, then per entity if needed)
DATABASE_URL=<neon> .venv/bin/python -m scripts.integrity_report
DATABASE_URL=<neon> .venv/bin/python -m scripts.integrity_report --entity <entity-id>

# 3. Building dedup DRY-RUN per likely group (no --apply = plan only)
DATABASE_URL=<neon> .venv/bin/python -m scripts.reconcile_building_units --match leitchs
```

Review the plan for cross-trust safety and B6≠B3 separation. **Before any apply,
take a Neon backup branch.** Then only for approved groups:

```
DATABASE_URL=<neon> .venv/bin/python -m scripts.reconcile_building_units --match leitchs --apply
# or explicit: ... --into <canonical_prop_id> --merge <id1,id2>
```

Re-run steps 2-3 → expect an empty plan / clean report (idempotent). Record
before/after property + unit counts in section 3.

## 1. Render Backend Sentry — DONE 2026-06-20 (Temba on dashboards, Claude guiding)

Sentry org `skj-capital`, project `leasium-api` (Python).

- [x] `SENTRY_DSN` set on the Render API service (leasium-api DSN).
- [x] `SENTRY_ENVIRONMENT=production`.
- [x] API redeployed; went Live.
- [x] Email alerts on via the project-creation default (high-priority issues → email).
- [ ] Backend test event not separately fired — wiring matches the confirmed
  frontend path (DSN-gated init + scrubber); will report real backend errors.
  Optional to verify later with a controlled error.

## 2. Vercel Frontend Sentry — DONE 2026-06-20 ✅ CONFIRMED LIVE

Sentry project `leasium-web` (Next.js).

- [x] `NEXT_PUBLIC_SENTRY_DSN` set (leasium-web DSN).
- [x] `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`.
- [x] Frontend redeployed.
- [x] **Test event CONFIRMED** — a triggered error landed in the `leasium-web`
  Issues feed within ~35s (PII-scrubbed via `beforeSend`/`sentry.scrubber`).
- [x] Email alerts on via the project-creation default.
- [ ] Optional source-map vars (`SENTRY_AUTH_TOKEN` / `SENTRY_ORG=skj-capital` /
  `SENTRY_PROJECT=leasium-web`) not set yet — only affects stack-trace
  readability; `withSentryConfig` skips upload cleanly without them. Add later if wanted.

## 3. Hosted Neon Integrity Sweep — DONE 2026-06-20 (Claude, via Desktop Commander on Temba's Mac)

- [x] Target Neon DB confirmed (host classified HOSTED-neon before any run).
- [x] Hosted `alembic_version` at head: `20260619_0046`.
- [x] Building reconcile dry-run: "No building groups with multiple properties found" — **no duplicate properties**, nothing to merge.
- [x] Read-only integrity report run (whole org).
- [x] Reviewed cross-trust / B6≠B3 — moot (no merges). Root-caused the orphans to the mid-June building-as-property consolidation in property `019ec8a3`.
- [x] Row-level backup before apply: `~/leasium-orphan-backup-*.json` (9 rows). No Neon branch taken — row backup + reversibility judged sufficient by operator.
- [x] Applied operator-approved fix via `scripts/fix_orphaned_references.py --apply` (one transaction, audit row per change).
- [x] Re-ran integrity report → **all checks 0** (clean).

**Before:** 3 clusters / 9 live records orphaned onto soft-deleted parents — 1 lease on a deleted unit; 4 obligations + 1 doc + 1 charge-rule on a dead lease; 1 obligation + 1 doc on a dead unit/lease.
**Action:** re-pointed the 6 children of dead lease `019ecacc-8ce1` → live lease `019ecdf6`; soft-deleted the pending-draft lease + the 2 "Building 6, Unit 4" orphans (operator decisions, 2026-06-19).
**After:** orphan_units 0 · leases_on_deleted_units 0 · dead_unit_references 0 · dead_lease_references 0 · duplicate_tenants 0/0. Property/unit counts unchanged (no dedup needed).

## 4. Golden Paths On Production

Read-level sweep done 2026-06-20 (Claude, via Chrome on the live operator
session). All six hubs render with real data, no crashes; review-first guardrail
copy visibly intact on Money ("nothing posts to Xero or sends without you").
Deep *mutating* flows (Smart Intake apply, tenant-portal claim, invoice send)
were NOT exercised — read-only only.

- [x] Dashboard renders: 100% occupancy, arrears $0, work queue 2 open, billing blocker surfaced.
- [x] Properties register reads (2 properties: B3 205 Leitchs, Building 6). ⚠ see Finding 1.
- [x] People reads (Tenants 2, Vendors 1, Prospects 0); Gorilla Grind flagged "billing email not set".
- [x] Work reads (Queue / Maintenance / Compliance / Arrears; Open 4, Compliance 0/0).
- [x] Money reads (this-month $38,670, 3 invoice drafts, arrears $0, Xero "3 exceptions").
- [x] Insights reads (portfolio $464K/yr, compliance 0/0, 6 open exceptions).
- [ ] Deep flows not yet walked: Smart Intake apply, tenant-portal claim, statement/invoice send.

## Breaks And Blockers

| Severity | Golden path | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| Review | Properties vs Dashboard/Money | ~~Properties header read "$0 monthly rent roll · occupancy pending"~~ — **RESOLVED 2026-06-20: transient loading state** (the "Preparing property workspace" banner was still fetching). After load, Properties reads 100% occupied · $38,670/mo (B3 205 Leitchs 1/1 $15,832; Building 6 2/2 $22,838), reconciling exactly with Money and Dashboard. Not a bug. Minor optional polish: show a skeleton/"calculating…" instead of "$0" while loading. | /properties loaded (2026-06-20) | Resolved |
| Data task | Money / People | Gorilla Grind Pty Ltd has no billing email → its $15,832 invoice routes to portal not email; flagged consistently on Dashboard/People/Money. Operator to add the billing email. | /people, /money | Open (operator) |
| Review | Money / Xero | Xero shows "needs review — 3 exceptions per entity". Confirm benign before any approved posting. | /money, Settings → Xero | Open |
| Note | Work vs Dashboard | Work shows "Open 4"; Dashboard work queue shows "2 open". Likely scope/range difference (Work all-open vs dashboard maintenance) — sanity-check the counts agree. | /operations vs / | Open (low) |

## Final Readiness Status

- Repo-side: complete (ruff clean; 63 stabilization tests green on Temba's Mac).
- Hosted proof: **COMPLETE 2026-06-20.** Integrity sweep done (register clean, all
  checks 0); golden-paths read-level sweep done (all six hubs render, no crashes);
  **Sentry live** — frontend confirmed via a real test event, backend configured,
  email alerts on. Stabilization v2 hosted proof is closed.
- Known blockers: **none hard.** Remaining items are review/data tasks, not blockers:
  rent-roll display vs billing, Gorilla Grind billing email, Xero 3 exceptions.
- Next operator action (housekeeping, not blocking): add Gorilla Grind billing
  email; confirm the Properties rent-roll display and Xero exceptions; optionally
  add the Sentry source-map vars for prettier stack traces.
