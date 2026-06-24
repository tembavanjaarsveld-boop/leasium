# Plan — Workflows Builder v1 (DoorLoop benchmark P2, review-queue engine)

Execution brief for Codex. Read this top-to-bottom before writing code.
This is a **design-facing** feature, so Phase 0 (Figma + Temba sign-off) gates
all code. Companion docs you MUST read first:
`docs/automation-strategy-2026-05-23.md` (the design bible — the comms queue is
the skeleton this generalises), `docs/doorloop-benchmark-2026-05-31.md` (§lines
73, 253 define the gap), `CLAUDE.md` §2.1/§2.2/§2.7, and
`docs/design-governance.md` (UX gate + Figma-first stage).

## Status — 2026-06-21 (Phase 0 draft framed; pending sign-off)

P0/P1 of the DoorLoop refocus are shipped; tenant payments are parked. Phase 0
Figma draft frames now exist in the canonical design file for the rules list,
rule editor, and review queue, with desktop and mobile screenshots checked and
wrapping fixes applied. This is still pre-code: Temba's Figma sign-off on Work
hub placement and the review-first v1 trigger/action catalog is required before
implementation starts.

This remains the **Workflows builder** portion of the P2 item
("Customisable reporting, a Calendar surface, and a Workflows builder").
Reporting and Calendar are out of scope for this plan.

## Why this plan

DoorLoop ships a visual **Workflows** engine (Triggers → Conditions → Actions →
Monitoring) that lets operators automate repetitive sequences without code.
Leasium today has *point* comms automations (arrears reminders, escalation cues,
work-assignment notices) but no general builder — benchmarked "🟡 comms
automations, no builder". This plan closes that gap with the **smallest design
that fits Leasium's architecture**, decided with Temba:

- **Review-queue engine, no scheduler.** Leasium has **no background worker,
  cron, or queue** anywhere. We do not add one. Rules are evaluated **on-demand**
  (page load / explicit "evaluate"), exactly like the existing read-only comms
  queue (`apps/api/routers/comms.py`: *"derives candidates from existing records
  on each call ... never mutates anything, never sends a provider message"*).
- **Review-first by construction (§2.1).** A workflow never sends. Internal
  actions (create task, notify operator) execute on per-proposal operator
  approval; any comms action only *hands a draft to the existing comms queue*
  for a second review-and-send. There is **no code path** from a workflow to
  SendGrid/Twilio/Xero/tenant email. Tests must prove this.

## Iron laws (superpowers methodology — non-negotiable)

1. **No production code without a failing test first.** Each ticket starts red.
2. **No fix without a root cause.** No symptom-patching.
3. **No "done" without fresh evidence** — paste the passing test / lint / build output.
4. **Review-first guardrail holds** (`CLAUDE.md` §2.1): no Xero write, SendGrid,
   Twilio, tenant email, or payment reconciliation without explicit operator
   approval. A workflow action MAY create an internal record or a *reviewable
   comms draft*; it MUST NOT call a provider.
5. **No scheduler, no background worker.** Evaluation is request-driven only.
   If you think you need a cron, stop and re-read §Why — you don't for v1.
6. **Additive + reversible.** New tables only; no destructive migration. Reuse
   existing models (Task/Obligation, ArrearsCase, Lease, comms drafts) — do not
   fork them.
7. **Agent-first execution.** Use subagents for parallel reconnaissance, bounded
   implementation slices with disjoint write sets, and review/verification. Keep
   immediate blockers local; verify every agent result before shipping. Tell each
   agent it is **not alone in the codebase** and must not revert unrelated work.

## Tooling (Temba's Mac, via Desktop Commander)

- Backend (Mac only — venv is not portable; the Cowork sandbox cannot run pytest/ruff):
  `.venv/bin/python -m pytest tests/integration/<file> -q`,
  `.venv/bin/python -m ruff check apps stewart tests scripts`,
  `.venv/bin/alembic upgrade head`.
- Frontend (in `apps/web`): `./node_modules/.bin/eslint src`,
  `./node_modules/.bin/tsc --noEmit`, production build with the bundled Next WASM
  dir. Run Playwright smokes with **`NODE_ENV=development`** (prod default
  crash-loops next-dev's webServer); clear any stale prod `.next` first.
- Browser checks: `make demo-seed` for meaningful app data (idempotent,
  provider-inert).
- Commits land directly on `main`, one feature per commit, terse imperative
  subject, no Claude/Codex attribution. **Author frontend-affecting commits with
  the gmail identity** so Vercel doesn't block the deploy; verify the deployment
  goes READY. In the sandbox, rename a stale `.git/index.lock` before each git
  command if present.

---

## Phase 0 — Design doc + Figma sign-off (HUMAN GATE — do first)

No surface code until this clears. This is the §2.2 in-loop UX gate, step 1.

### Ticket 0.1 — Frame the surface in Figma, get Temba's sign-off
- **Placement recommendation:** a **Work hub sub-tab** at `/operations?tab=workflows`
  (automation of operational sequences sits next to existing reminders/escalation;
  honours the §10.5.1 seven-item sidebar cap — do **not** add a top-level hub).
  Settings is the fallback if Temba prefers "configuration" framing. **Confirm
  placement with Temba at sign-off — do not assume.**
- **Frames to design** (Figma file `PO2jOANgmqgZHfqWZXOZGU`, pull tokens from
  `01 Foundations`, reuse `02 Components`): (a) Workflows **rules list** (enabled
  rules, trigger summary, last-evaluated, on/off); (b) **rule editor** drawer
  (name, trigger + its config, action(s) from the catalog); (c) **review queue**
  (proposed actions grouped by rule, each with source/evidence + Approve / Dismiss).
  Desktop 1440 + mobile 390 for each.
- **Verify:** Temba signs off in Figma. Record the node IDs in
  `docs/design-governance.md` §Figma-First Design Stage. **That sign-off is the
  gate — Phases 3+ cannot start without it.** (Backend Phases 1–2 may start in
  parallel since they're not visual.)

---

## Phase 1 — Backend: `WorkflowRule` config + CRUD (no engine yet)

### Ticket 1.1 — `WorkflowRule` model + migration
- **Red first:** `tests/integration/test_workflows_api.py::test_workflow_rule_crud`
  — create a rule, read it back, patch it, soft-delete it; assert trigger/action
  config round-trips. Write before the model exists (fails to import).
- **Model** (`stewart/core/models.py`, follow the ArrearsCase/Owner pattern):
  `WorkflowRule` — `id` (uuid7), `entity_id` (FK `Entity`, org scoping),
  `name`, `description`, `trigger_type` (enum), `trigger_config` (JsonbCompat),
  `actions` (JsonbCompat — list of `{type, config}`), `enabled: bool` (default
  False), `last_evaluated_at: datetime | None`, `workflow_metadata` (JsonbCompat),
  `created_at`/`updated_at`/`deleted_at`. SQLite-compat (mirror existing
  JSONB/enum compat helpers).
- **Trigger catalog v1 (fixed, validated server-side):** `lease_expiring`
  (`{days_before:int}`), `arrears_threshold` (`{min_amount_cents?:int,
  min_days_overdue?:int}`), `compliance_due` (`{days_before:int}`). These map to
  the indexed date/amount columns the recon found (lease end/review dates,
  `ArrearsCase`, `Obligation`/compliance next-due).
- **Action catalog v1 (fixed):** `create_task` (internal), `notify_operator`
  (in-app cue, internal), `queue_comms_draft` (hands a draft to the existing
  comms queue — **never sends**). **No direct provider action exists in v1.**
- **Migration:** new Alembic revision (head is currently `20260616_0045`; use the
  next free number, e.g. `20260619_0046_workflow_rules`) — create the table, FK,
  indexes on (`entity_id`, `enabled`). No data move.
- **Verify:** `alembic upgrade head` clean on a scratch DB; red test green; ruff clean.

### Ticket 1.2 — `/api/v1/workflows/rules` CRUD API
- **Red first:** API tests for list/create/patch/soft-delete with entity-role auth
  (happy path + 403 wrong-role path), plus a **422 catalog-validation** path
  (unknown trigger_type / action type / malformed config is rejected).
- **Implementation:** router (`apps/api/routers/workflows.py`) + schemas
  (`apps/api/schemas/workflows.py`) mirroring the arrears/owners routers; register
  in `apps/api/main.py` under `/api/v1`. Validate trigger/action configs against
  the v1 catalog (reject anything off-catalog). `audit_log(...)` every mutation
  with `target_table="workflow_rule"`.
- **Verify:** backend tests green; ruff clean.

---

## Phase 2 — Backend: evaluation engine + review queue (read-first, guardrail-critical)

> Spawn a **recon subagent** before 2.2 to confirm the exact query patterns and
> date/threshold fields used by `apps/api/routers/comms.py` candidate generation
> and the arrears/obligation/lease reads — the engine must reuse those, not
> reinvent them. Verify its findings against the files yourself.

### Ticket 2.1 — `WorkflowProposalDecision` model + migration
- **Red first:** `test_dismiss_persists_and_suppresses` — dismissing a proposal
  records a decision and the same proposal does not reappear on re-evaluation.
- **Model:** `WorkflowProposalDecision` — `id`, `entity_id`, `rule_id` (FK),
  `dedupe_key` (str, unique per `(rule_id, dedupe_key)`), `target_table`,
  `target_id`, `action_type`, `decision` (enum: `approved | dismissed`),
  `decided_by_user_id`, `decided_at`, `execution_result` (JsonbCompat | None),
  timestamps. `dedupe_key` = stable hash of `(rule_id, target_ref, action_type,
  period_bucket)` so a given trigger fires once per period, not every page load.
- **Migration:** next free revision (e.g. `20260619_0047_workflow_proposal_decisions`).
- **Verify:** `alembic upgrade head` clean; red test green; ruff clean.

### Ticket 2.2 — `GET /api/v1/workflows/queue` (read-only evaluation)
- **Red first:** `test_queue_derives_proposals_and_is_read_only` — seed a lease 80
  days from expiry + a `lease_expiring{days_before:90}` rule; assert the queue
  returns one proposal with source/evidence (lease id, expiry date, rule id) and
  **the call mutates nothing** (no new rows besides none; no provider client
  invoked — assert via mocked provider that it was never called).
- **Implementation:** an engine module (`stewart/automations/` or
  `apps/api/workflows_engine.py`) that, for each enabled rule in the operator's
  entity scope, queries current data with the **same patterns as comms.py**,
  builds proposed actions, computes `dedupe_key`, and **subtracts** anything with
  an existing `WorkflowProposalDecision` or whose effect already exists (e.g. an
  open task tagged `metadata.workflow_rule_id == rule.id` on that target).
  Read-only: copy the comms.py module docstring guarantee verbatim in spirit.
- **Verify:** red test green; a guardrail test asserts no provider module is
  imported/called from the engine; ruff clean.

### Ticket 2.3 — Approve / dismiss actions (the only write path)
- **Red first, three tests:** (a) approving a `create_task` proposal creates one
  internal task tagged with the rule id, records an `approved` decision, audits
  it, and is **idempotent** (second approve = no dup); (b) approving a
  `queue_comms_draft` proposal creates a **draft in the existing comms queue** and
  asserts **no SendGrid/Twilio call fired** (mocked providers, asserted
  uncalled); (c) dismiss records a decision and suppresses re-proposal.
- **Implementation:** `POST /api/v1/workflows/queue/approve` and `/dismiss`
  (proposal identified by `rule_id` + `dedupe_key` + target). Internal actions
  execute immediately via the existing Task/Obligation + notification helpers.
  `queue_comms_draft` calls the existing comms-draft creation only — the operator
  still reviews + sends from `/comms` under the existing guardrail (double gate).
  `audit_log(...)` every approve/dismiss/execution.
- **Verify:** all three tests green; ruff clean. **Run the full
  `tests/integration/` suite** to prove nothing regressed.

---

## Phase 3 — Frontend: Workflows surface (gated on Phase 0 sign-off)

> After the shared `api.ts` types land (3.1), the rule editor and the review
> queue are disjoint write sets — they may be built as **two parallel
> implementation subagents**. Give each exact file scope and the Figma node IDs.

### Ticket 3.1 — api.ts client + rules list + rule editor
- **Red first:** smoke `apps/web/tests/smoke/workflows.spec.ts` (+ fixtures in
  `api-mocks.ts`) — the surface renders the rules list; "New workflow" opens the
  editor; saving a `lease_expiring → create_task` rule shows it enabled in the list.
- **Implementation:** add typed fetchers + types to `apps/web/src/lib/api.ts`
  (mirror the existing `request<T>()` pattern). Build the surface under the
  approved placement using shared `ui.tsx` primitives (`SectionPanel`/`Surface`,
  `Button`/`SecondaryButton`, `StatusBadge`, `EmptyState`, `SkeletonRows`,
  `Field`/`Select`). Trigger/action pickers are simple selects bound to the v1
  catalog (no free-form node editor). URL state via `?tab=workflows`.
- **Verify:** smoke green (`NODE_ENV=development`); `eslint`/`tsc` clean.

### Ticket 3.2 — Review queue UI + UX gate pass
- **Red first:** smoke — the review queue lists proposed actions with their
  source/evidence; Approve removes the row and shows a success state; Dismiss
  removes it; empty/loading/error states render in plain language.
- **Implementation:** reuse the evidence/source-trail pattern already used across
  Properties/Smart Intake/maintenance. One clear primary action per row.
- **UX gate (same session, §2.2):** review real screenshots at **1440 and 390**,
  run the **hallmark slop test** (`docs/external-skills/`), fix findings in-slice,
  and add one dated line to the **UX Pass Log** in `docs/design-governance.md`.
  No horizontal overflow; 44px tap targets.
- **Verify:** smokes green; `eslint`/`tsc`/production `next build` clean; UX Pass
  Log line written.

---

## Phase 4 — Review, docs, ship

### Ticket 4.1 — Review-agent pass (spec + guardrail audit)
- Spawn **review subagents**: one for spec compliance + React/App-Router risks,
  one dedicated **guardrail audit** that greps the workflow backend for any
  import of/call to the SendGrid/Twilio/Xero/tenant-email send helpers and
  confirms there is **no direct path** (only `queue_comms_draft` → existing comms
  queue). Fix P1/P2 findings before claiming done. Verify agent output yourself.

### Ticket 4.2 — Source-of-truth docs (§2.7)
- `docs/product-roadmap.md`: under the P2 line 1470 item, mark the Workflows
  builder portion shipped with a sub-note describing the review-queue engine +
  the v1 trigger/action catalog; leave reporting + Calendar open.
- `docs/automation-strategy-2026-05-23.md`: record that the comms-queue pattern
  is now generalised by the workflows engine.
- `docs/design-governance.md`: UX Pass Log line (from 3.2) + Figma node IDs.
- `docs/next-chat-handover.md`: current state, recent commits, active tree.
- Commit per-topic (gmail identity for frontend deploys); verify Vercel READY.

---

## Definition of done

- Every ticket landed red→green with pasted passing test/lint/build evidence.
- Backend: `pytest tests/integration/test_workflows_api.py` green + full suite
  green; `ruff` clean; `alembic upgrade head` clean.
- Frontend: workflows smokes green (`NODE_ENV=development`); `eslint`, `tsc`, and
  production `next build` clean.
- **Guardrail proven:** a test and the review-agent audit both confirm no
  workflow code path calls a provider; comms actions only create reviewable drafts.
- No scheduler/worker/cron was added.
- Figma sign-off recorded; UX Pass Log line written; source-of-truth docs updated.
- Commits pushed to `main`; Vercel deployment READY.

## Explicitly out of scope for v1

Customisable reporting and the Calendar surface (separate plans); a background
scheduler / auto-firing rules (the "Scheduler + auto-run" option Temba did not
pick); a free-form visual node editor with user-defined conditions; any direct
provider send from a workflow; conditions beyond the trigger config (add a
`conditions` block in v2 only if rules prove too coarse in real use).
