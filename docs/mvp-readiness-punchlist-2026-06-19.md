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

## 3. Hosted Neon Integrity Sweep

- [ ] Confirm target Neon database identity before any apply.
- [ ] Confirm hosted `alembic_version` is at head.
- [ ] Run building reconcile dry-runs for likely duplicate groups:
  `.venv/bin/python -m scripts.reconcile_building_units --match <group>`.
- [ ] Run the read-only integrity report:
  `.venv/bin/python -m scripts.integrity_report --entity <entity-id>`.
- [ ] Review output for cross-trust safety and B6/B3 separation.
- [ ] Take a Neon backup branch before any approved `--apply`.
- [ ] Apply only approved building reconcile/fixup commands.
- [ ] Rerun dry-runs/reports and record before/after property/unit counts.
- [ ] Spot-check audit rows for approved hosted mutations.

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

- Repo-side: complete locally after Stabilization v2 verification; commit/push
  recorded in git history once this bundle lands.
- Hosted proof: pending.
- Known blockers: none recorded yet.
- Next operator action: enable Sentry envs, verify alerts, then run hosted
  integrity dry-runs.
