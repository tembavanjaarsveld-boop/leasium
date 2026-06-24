# Codex brief — Hosted register integrity sweep (read-only first)

Run the live-register data-integrity sweep that Stabilization v2 prepared
(`scripts/integrity_report.py`, `scripts/reconcile_building_units.py`). This is
hosted, operator-run work against the real SKJ Neon register.

**The whole job is: read-only checks → report findings to Temba → STOP. Do not
mutate anything until Temba approves specific merges.**

## Guardrails (non-negotiable)

- **Read-only / dry-run only.** `integrity_report` and `reconcile_building_units`
  *without* `--apply` mutate nothing. Run only these in the first pass.
- **No `--apply` without Temba's explicit, per-command go.** This is review-first
  (CLAUDE.md §2.1). Surface the plan; do not execute it.
- **Secret hygiene.** The Neon URL is a credential. Keep it in the gitignored
  `.env.neon` (already created + gitignored) or an env var. **Never print it,
  never commit it, never put it in a tracked file, commit message, or PR.** Pipe
  command output through the redactor below so a stray traceback can't leak it.
- **Provider-inert.** These scripts touch no Xero/SendGrid/Twilio/payment paths.

## Preconditions

- Repo on `main` at the v2 HEAD (`679b24d` or later). Migration head is
  `20260619_0046`.
- Put the real Neon connection string in `.env.neon`:
  `DATABASE_URL=postgresql+psycopg://<neondb_owner:REALPASS@ep-...neon.tech/neondb>?sslmode=require`
  (use the `+psycopg` driver prefix).

## Step 1 — load URL + confirm you're pointed at Neon (no secret echoed)

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
export DATABASE_URL="$(grep -E '^DATABASE_URL=.+' .env.neon | tail -1 | cut -d= -f2- | tr -d '\r')"
[ -n "$DATABASE_URL" ] || { echo "no DATABASE_URL in .env.neon"; exit 1; }
.venv/bin/python -c 'import os;from urllib.parse import urlparse;h=urlparse(os.environ["DATABASE_URL"]).hostname or "";print("target:", "HOSTED-neon" if "neon" in h else "STOP-not-neon")'
```

If target isn't `HOSTED-neon`, **stop** — wrong/empty URL.

## Step 2 — read-only checks (redact URLs from all output)

```bash
RED() { sed -E 's#postgres(ql)?(\+[a-z0-9]+)?://[^[:space:]]*#<redacted-url>#g'; }
.venv/bin/alembic current 2>&1 | RED      # expect: 20260619_0046 (head)
.venv/bin/alembic heads   2>&1 | RED
.venv/bin/python -m scripts.integrity_report 2>&1 | RED
.venv/bin/python -m scripts.reconcile_building_units 2>&1 | RED   # DRY-RUN (no --apply)
```

(Narrow the dry-run with `--match <building-name>` if the plan is large.)

## Step 3 — report to Temba, then STOP

- Is hosted `alembic current` == `20260619_0046`? If behind, flag it (Render's
  start command runs `alembic upgrade head`, so a mismatch means a deploy issue).
- Integrity findings, grouped: orphan units, leases on soft-deleted property/unit,
  duplicate tenants (by ABN / by name), obligations / documents / charge-rules
  pointing at merged-away or dead records.
- The reconcile dry-run plan: which properties merge into which canonical; units,
  obligations, documents re-pointed; emptied dupes soft-deleted. **Sanity-check
  the plan: no cross-entity (cross-trust) merges, and B6 ≠ B3 stay separate.**
- Do **not** apply. Wait for Temba to approve specific groups.

## Step 4 — ONLY after Temba approves specific merges

1. Take a **Neon backup branch** first (Launch plan supports branching).
2. Apply only approved groups:
   `.venv/bin/python -m scripts.reconcile_building_units --match <group> --apply`
   or explicit: `... --into <canonical_prop_id> --merge <id1,id2> --apply`
3. Re-run Step 2 → expect a clean report / empty plan (idempotent). Record
   before/after property + unit counts in
   `docs/mvp-readiness-punchlist-2026-06-19.md` (section 3).
4. Spot-check that audit rows exist for the applied merges.

## Not in scope for Codex (Temba does these via dashboards / manually)

Sentry env vars on Render + Vercel and alert routing; the production golden-path
walkthrough. These are in the punch-list (`mvp-readiness-punchlist-2026-06-19.md`).

## Already verified on Temba's Mac (so you can trust the tooling)

`ruff` clean; 63 stabilization tests pass (`test_integrity_report`,
`test_provider_guardrail`, `test_reconcile_building_units`, intake + extraction);
`integrity_report --help` runs. Local Postgres was down and no hosted URL was
configured during that check, which is why the hosted data run is still pending.
