# Plan — Platform Stabilization v1 (CI safety net + Smart Intake hardening)

Execution brief for Codex. Two thrusts chosen by Temba (2026-06-19), sequenced:
**(1) a regression safety net via CI**, then **(2) harden the most-churned
surface — Smart Intake / Leasium AI document intake**. CI lands first because it
mechanically protects every fix after it. Workflows builder is parked; this is
the stabilization track toward MVP.

## Status — 2026-06-19 (not started)

## Why this plan

Temba is stabilising for MVP, solo, committing straight to `main` with **no CI** —
every `ruff`/`pytest`/`eslint`/`tsc`/`build`/smoke check is manual on his Mac, so
one missed check ships a silent regression. Meanwhile the last ~15 commits are
almost all Smart Intake / Leasium AI, with repeated bug-fixes to the same
property/lease matching logic — that churn is where instability concentrates.

Grounding facts confirmed by recon (so the plan is accurate):

- **Backend tests run on SQLite in-memory** (`tests/conftest.py`: `sqlite+pysqlite:///:memory:`,
  `StaticPool`). Linux CI needs **no Postgres service** — just `pip install -e .` +
  `pytest`. The "Mac-only" limit is only the checked-in aarch64 `.venv` binary.
- **Tests are provider-inert** (§2.8) and already cover the no-`OPENAI_API_KEY`
  soft-fail paths, so **CI needs no secrets** (no OpenAI/Xero/SendGrid/Twilio keys).
- Frontend uses **pnpm** (`apps/web/pnpm-lock.yaml`); Python is a standard
  `[project]` install, `requires-python >=3.12`.
- `apps/web/playwright.config.ts` already branches on `CI` (retries, `forbidOnly`,
  `reuseExistingServer`). Smokes mock `/api/v1/**`, so no real API is needed.
- `tests/integration/test_migrations.py` is `skipif(not TEST_DATABASE_URL)` — a
  Postgres-only migrations test, skipped by default. (Optional CI enhancement below.)

## Iron laws (superpowers methodology — non-negotiable)

1. **No production code without a failing test first.** Each fix in Phase 2 starts red.
2. **No fix without a root cause.** No symptom-patching.
3. **No "done" without fresh evidence** — paste the passing CI run / test / build output.
4. **Review-first guardrail holds** (`CLAUDE.md` §2.1): no Xero write, SendGrid,
   Twilio, tenant email, or payment reconciliation without explicit operator
   approval. Extraction calling OpenAI is allowed (it's a read, not a mutation);
   Apply must never call a provider.
5. **Surgical changes (§1.3).** This is stabilisation — consolidate and harden
   existing code; do not add features or refactor adjacent code. Every changed
   line traces to a named gap below.
6. **Agent-first execution.** Use subagents for review/verification and for the
   disjoint Phase 2 tickets; tell each it is not alone in the codebase and must
   not revert unrelated work; verify every result before shipping.
7. **CI is the definition of green.** Once Phase 1 lands, a change is not done
   until CI passes on it.

## Tooling (Temba's Mac, via Desktop Commander)

- Backend: `.venv/bin/python -m pytest tests/integration/<file> -q`,
  `.venv/bin/python -m ruff check apps stewart tests scripts`, `.venv/bin/alembic upgrade head`.
- Frontend (in `apps/web`): `./node_modules/.bin/eslint src`, `./node_modules/.bin/tsc --noEmit`,
  production build with the bundled Next WASM dir, smokes with **`NODE_ENV=development`**.
- Commits: terse imperative, no Claude/Codex attribution, one topic per commit;
  author frontend-affecting commits with the gmail identity so Vercel deploys.

---

## Phase 1 — CI safety net (no design gate; start immediately)

Goal: every push to `main` runs the full check suite automatically, with a
standing provider-guardrail test, so nothing silently regresses.

### Ticket 1.1 — Backend CI job
- **Implementation:** `.github/workflows/ci.yml` — job `backend` on
  `ubuntu-latest`, Python 3.12. Steps: checkout → setup-python → `pip install -e .`
  + dev tools (`ruff`, `pytest`, `pytest-cov`) → `ruff check apps stewart tests scripts`
  → `pytest -ra` (runs all of `tests/`; the Postgres-only `test_migrations.py`
  self-skips without `TEST_DATABASE_URL`). No services, no secrets.
- **Verify:** push a branch; the job goes green on the current known-good `main`.
  If anything needs a real provider key to pass, that's a test bug — fix the test
  to mock the provider (§2.8), don't add a secret.

### Ticket 1.2 — Frontend CI job
- **Implementation:** same workflow, job `frontend` on `ubuntu-latest`, Node (match
  the engines in `apps/web/package.json`), pnpm via `corepack`. Steps: checkout →
  setup-node + pnpm → `pnpm install --frozen-lockfile` → `eslint src` →
  `tsc --noEmit` → production `next build` (bundled Next WASM dir) →
  `playwright install --with-deps chromium` → `playwright test` with
  **`NODE_ENV=development`**. `CI=true` already tunes the Playwright config.
- **Verify:** job green on current `main`; flake check by re-running once.

### Ticket 1.3 — Standing provider-guardrail test
- **Red first:** a test that asserts no Apply/intake code path emits a
  provider+mutation audit fragment. Generalise the existing
  `_provider_mutation_audit_rows()` helper (in `tests/integration/test_document_intake_api.py`)
  into a shared assertion and apply it across the apply/dispatch paths; prove it
  catches a regression by temporarily wiring a fake provider call and watching it
  fail, then revert.
- **Implementation:** lift the helper into a shared test util; add a focused test
  module `tests/integration/test_provider_guardrail.py` covering each Apply branch
  (lease, purchase, invoice, inspection, obligation).
- **Verify:** green in CI; the deliberate-break check fails as expected.

### Ticket 1.4 — Wire it in + document
- **Implementation:** trigger on `push` to `main` + `pull_request`. Since Temba is
  solo-on-`main`, branch protection is his call — at minimum CI runs and reports on
  every push. Add a `docs/deployment.md` "CI" section (jobs, what runs, no-secrets
  rationale, how to run the same checks locally) and a `next-chat-handover.md` note.
- **Optional enhancement (note, don't build unless asked):** a third job with a
  Postgres service + `TEST_DATABASE_URL` to un-skip `test_migrations.py` and run
  `alembic upgrade head` against real Postgres — catches SQLite-vs-Postgres drift.
- **Verify:** a fresh push shows all jobs green; README/handover updated.

---

## Phase 2 — Smart Intake / Leasium AI hardening (after CI is green)

Each ticket is red-first; CI (Phase 1) now enforces the new regression tests.
Tickets 2.2 and 2.4 are largely disjoint write sets and can run as **parallel
implementation subagents**; 2.1 touches the apply transaction and should land first.

Pipeline reference (from recon): extract = `stewart/ai/document_intake.py` +
`stewart/ai/lease_intake.py`; apply dispatcher = `apply_document_intake()`
(`apps/api/routers/document_intakes.py`); shared lease apply =
`_apply_lease_records()` (`apps/api/routers/lease_intakes.py`).

### Ticket 2.1 — Close the concurrent double-apply race (data integrity, highest priority)
- **Gap:** `apply_document_intake()` guards idempotency with check-then-act
  (`if status == applied: return`). Two parallel applies both pass the check and
  double-create records. No lock / atomic transition.
- **Red first:** test that a re-entrant apply (intake already in an in-flight
  `applying` state, and a second sequential apply after `applied`) creates records
  **exactly once**. (True parallelism isn't deterministic on SQLite — assert the
  guard logic, not OS threads.)
- **Implementation:** atomic, DB-agnostic status transition — a conditional
  `UPDATE document_intake SET status='applying' WHERE id=:id AND status NOT IN ('applying','applied')`
  and proceed only if rowcount == 1; on completion set `applied`, on failure roll
  back to the prior status. Holds under real Postgres concurrency in prod and is
  testable on SQLite. Do **not** rely on `SELECT ... FOR UPDATE` alone (no-op on SQLite).
- **Verify:** red test green; existing apply tests still pass; guardrail test green.

### Ticket 2.2 — Make document-intake property matching building-aware (kills duplicate properties)
- **Gap:** lease-type intakes already match via the building-key helper
  (`_building_key`/`_match_property_by_building_key`, `lease_intakes.py`), but the
  **non-lease** document matcher `_find_matching_property()`
  (`document_intakes.py:1306`) does exact name+address only — so a purchase
  contract / invoice / obligation referencing a unit in an existing multi-unit
  building spawns a **duplicate property**. This is the exact bug class that's been
  patched repeatedly.
- **Red first:** test that a non-lease document intake referencing "Unit X,
  Building 6, <addr>" attaches to the existing Building 6 property instead of
  creating a new one — and that B6 vs B3 at the same address still stay separate
  (no over-merge regression).
- **Implementation:** extract the building-key matcher into one shared helper
  (single source of truth) and call it from both matchers. **Surgical** — do not
  change the lease path's current behaviour; only give the document matcher the
  same awareness. Keep entity scoping.
- **Verify:** red test green; existing lease-intake matching tests unchanged; ruff clean.

### Ticket 2.3 — Surface matching ambiguity instead of silent first-pick
- **Gap:** when multiple properties match, `_find_matching_property()` returns
  `.scalar()` (arbitrary first), silently. Violates the review-first ethos.
- **Red first:** test that two equally-matching candidates route the intake to
  `needs_attention` with both candidates surfaced for operator choice, rather than
  auto-picking.
- **Implementation:** detect >1 candidate; set `needs_attention` + record the
  candidate set in `review_data` for the existing review UI to render. No new UI
  surface — reuse the existing needs-attention/review path.
- **Verify:** red test green; review flow still applies cleanly once disambiguated.

### Ticket 2.4 — Extraction error-path regression coverage
- **Gap:** no tests for missing `OPENAI_API_KEY` (in the intake path specifically),
  OpenAI 503/429, request timeout, malformed/partial JSON, or schema-valid-but-
  missing-required-fields. Most failure handling exists but is **untested**, so CI
  can't protect it; the timeout and schema-incomplete cases have real holes.
- **Red first:** parametrised tests (mocked OpenAI via the existing `_FakeHTTPClient`
  pattern) asserting each failure sets `intake.status = failed` with a clear,
  user-facing `error_message` and **never** half-creates records.
- **Implementation:** fill the two real gaps — catch `httpx` timeout exceptions
  explicitly, and validate extracted JSON against required fields before marking
  ready (incomplete → `needs_attention`, not silently `applied`).
- **Verify:** all parametrised cases green in CI.

### Ticket 2.5 — Guard property creation against garbage/empty identity
- **Gap:** create-fallback names a property from `Path(filename).stem or "Lease property"`;
  a junk filename → a junk property with no real identity.
- **Red first:** test that an intake with no usable property name/address routes to
  `needs_attention` rather than creating a placeholder-named property.
- **Implementation:** require a minimum identity (name or address) before create;
  otherwise needs-attention.
- **Verify:** red test green.

### Ticket 2.6 — (Deferred / optional) OpenAI retry-with-backoff on 503/429
- Note only. A small bounded retry would improve extraction reliability, but it's
  an enhancement, not a stability bug — leave out of v1 unless flakiness is observed.

---

## Definition of done

- `.github/workflows/ci.yml` runs backend (ruff + pytest) and frontend (eslint +
  tsc + build + smokes) green on `main`, with no secrets.
- Standing provider-guardrail test in place and proven to catch a regression.
- Phase 2 tickets 2.1–2.5 landed red→green with CI proof; full `tests/` suite green;
  no duplicate-property or double-apply path remains; ambiguity and extraction
  failures route to `needs_attention`/`failed` with clear messages.
- No new feature, no scheduler, no provider mutation added.
- Docs updated: `deployment.md` (CI section), `next-chat-handover.md`,
  `product-roadmap.md` (stabilisation note). Commits pushed; Vercel READY.

## Sequencing of the other stabilization thrusts (after this lands)

1. **Audit & cut experimental scope** — harden-or-pull decisions on the
   property-image helper, public enrichment, Basiq (UI hidden in `6163e2e`, not
   removed), and any soft-skipping provider stubs. Separate plan.
2. **Data integrity & hosted env** — confirm hosted Neon/Render migrations are
   current, real SKJ-data integrity checks, audit-log completeness, backup/restore
   confidence (pairs well with the optional Postgres CI job in 1.4). Separate plan.

## Out of scope for v1

Workflows builder (parked); customisable reporting + Calendar; new product
features of any kind; the two thrusts listed above (sequenced after).
