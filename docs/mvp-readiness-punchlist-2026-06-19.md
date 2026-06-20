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

## 1. Render Backend Sentry

- [ ] Confirm `SENTRY_DSN` is set on the Render API service.
- [ ] Confirm `SENTRY_ENVIRONMENT=production`.
- [ ] Redeploy API at or after the Stabilization v2 commit.
- [ ] Confirm `/health` passes.
- [ ] Trigger one controlled backend test event.
- [ ] Confirm the event appears in Sentry with production environment, request
  id/context, and no sensitive payload.
- [ ] Confirm new-issue and error-spike alert routing reaches email and/or
  Slack.

## 2. Vercel Frontend Sentry

- [ ] Confirm `NEXT_PUBLIC_SENTRY_DSN`.
- [ ] Confirm `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`.
- [ ] Confirm source-map upload vars: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
  `SENTRY_PROJECT`.
- [ ] Redeploy frontend at or after the Stabilization v2 commit.
- [ ] Trigger one controlled frontend test event.
- [ ] Confirm the event appears in Sentry.
- [ ] Confirm source maps resolve minified stack frames.
- [ ] Confirm no tenant, document, provider, or payment payload is captured.

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

- [ ] Smart Intake a real lease document; confirm property/unit/tenant/lease and
  provenance.
- [ ] Properties/Units register reads correctly after dedup.
- [ ] Tenants, tenant portal token, and account flows.
- [ ] Work: maintenance plus arrears lifecycle.
- [ ] Money: billing/statement generation plus Xero review-first checks, with no
  provider mutation without approval.
- [ ] Insights/compliance snapshot.

## Breaks And Blockers

| Severity | Golden path | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| Blocker | TBD | TBD | TBD | Open |

## Final Readiness Status

- Repo-side: complete (ruff clean; 63 stabilization tests green on Temba's Mac).
- Hosted proof: **integrity sweep DONE 2026-06-20 — register clean, all checks 0.**
  Sentry envs/alerts (sections 1–2) and the golden-paths walkthrough (section 4)
  still pending.
- Known blockers: none.
- Next operator action: set Sentry envs on Render + Vercel and verify alerts,
  then walk the production golden paths.
