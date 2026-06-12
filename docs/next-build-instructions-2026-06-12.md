# Next Build Instructions — 2026-06-12

Provenance: Codex's "Highest-Value Product Gaps" list, verified against the
repo on 2026-06-12 (three parallel read-only recon agents). Two of Codex's
five claims needed correction; tickets below reflect actual repo state.

These instructions assume the CLAUDE.md baseline: review-first provider
guardrail (§2.1), the in-loop UX gate for design-facing changes (§2.2),
test discipline (§2.8), and agent-first execution (§1.5).

---

## How to execute each ticket (agent workflow)

Per CLAUDE.md §1.5 and the adopted superpowers methodology:

1. **Recon agent first.** Spawn a read-only Explore agent to map the exact
   files, existing patterns, and test fixtures the ticket touches before
   writing anything. Paste its file list into the plan.
2. **Plan before code.** For tickets marked [L] (large), write a short design
   note in `docs/superpowers/plans/` and get Temba's sign-off before
   implementing. [S]/[M] tickets can go straight to a stated plan in-chat.
3. **Subagent implementation slices.** Where a ticket has disjoint write sets
   (e.g. backend router + frontend page), run them as parallel agents with
   exact file scope, and tell each agent it is not alone in the codebase and
   must not revert unrelated changes. Keep the critical-path slice local.
4. **Two-stage review.** After implementation, spawn a separate review agent
   to check the diff against the ticket scope and guardrails before
   verification. Don't let the implementing agent review itself.
5. **Verification before completion.** Backend: ruff + targeted pytest, then
   full pytest. Frontend: eslint + tsc + targeted smokes + production build
   (Desktop Commander on the Mac; smokes need `NODE_ENV=development`).
   No completion claim without fresh evidence.
6. **Working-tree hygiene.** `git status --short` before starting and before
   committing; stage only the ticket's files (other sessions may have
   in-flight edits). Commit per the repo's style: terse imperative subject,
   file-by-file body, gmail author identity for Vercel deploys.

---

## Ticket 1 [M] — Communications: send-time template consumption

**Verified state:** queue, dispatch, logs, inbound email/SMS all shipped.
Branded template CRUD exists (`apps/api/routers/branded_templates.py`, seeded
system templates, per-entity overrides). But `POST /comms/dispatch`
(`apps/api/routers/comms.py` ~2755-2884) sends the operator's edited
subject/body as-is — stored templates are never consumed at send time, and
there is no variable-preview endpoint.

**Scope:**
- Dispatch path optionally resolves a branded template + context variables at
  send time, with the operator's reviewed text still winning when edited.
- Render-preview endpoint exposing substituted variables against sample/real
  context, surfaced in the comms draft UI as a collapsed preview.
- Receipts record which template/version was consumed.

**Guardrails:** no auto-send; dispatch stays explicit operator approval.
Template resolution must never change a reviewed body silently — if the
operator edited the draft, send the edit.

**Tests:** backend happy path + template-missing/version-mismatch path;
smoke fixture for the preview disclosure.

**Why first:** smallest gap on a nearly-finished surface; finishes the
existing branded-templates investment.

---

## Ticket 2 [L] — Tenant payments: AU rail provider decision, then adapter

**Verified state:** display-only. `apps/api/routers/payments.py` explicitly
moves no money; `stewart/integrations/payment_rails.py` is a scaffold naming
Monoova/Zai/Stripe AU as candidates. Tenant portal shows payment status and
landlord receiving details but has no real "Pay now" rail.

**Step 1 — decision brief (research agents, no code):** spawn 2-3 parallel
research agents to compare Monoova vs Zai vs Stripe AU on: PayTo/PayID/BPAY
coverage, per-transaction + monthly cost at SKJ volume (~44 tenancies),
onboarding/KYC effort for a single landlord group, settlement timing, webhook
quality, and AU trust-account compatibility. Output one comparison doc in
`docs/` with a recommendation. **Temba makes the provider call — agents must
not create provider accounts or accept provider terms.**

**Step 2 — adapter ([L], after decision):**
- `stewart/integrations/payment_rails.py` becomes a real adapter behind the
  existing `configured_rail(settings)` seam; env-gated, absent = current
  display-only behaviour (clear 503, no mutation — same pattern as
  enrichment/OPENAI_API_KEY).
- Payment-intent model + webhook receipt rows with provenance, idempotent on
  provider event id (mirror the SendGrid/Twilio receipt pattern).
- In-portal "Pay now" on the tenant portal for due/overdue invoices.
- Reconciliation stays review-first: provider receipts surface as *candidates*
  against invoice drafts; operator approves before any paid-status mutation
  or Xero action.

**Guardrails (non-negotiable):** no live provider call in tests (mock the
adapter); no payment execution without the tenant's explicit action in
portal; no reconciliation apply without operator approval; webhook endpoints
authenticated the same way as existing SendGrid/Twilio webhooks.

**Tests:** adapter unit tests with mocked provider; integration tests for
intent creation, webhook receipt idempotency, and the 503 unconfigured path;
tenant-portal smoke for the Pay now surface (mocked API). Tenant portal UI is
design-facing → in-loop UX gate + UX Pass Log entry (design-governance.md).

---

## Ticket 3 [S] — Vendor portal: message notifications (NOT messaging itself)

**Correction to Codex:** vendor↔operator messaging is already shipped and
tested in-app (`apps/api/routers/vendor_portal.py` accept/comment/photo/
messages endpoints; visibility-scoped threads;
`tests/integration/test_vendor_portal_messages_api.py`). The marked seam is
`vendor_portal.py` ~line 994: "Future notify hook goes here (in-app only in
v1; no SendGrid/Twilio call)".

**Scope:** notify the contractor (email, optionally SMS) when the operator
posts a contractor-visible comment, and notify the operator in-app when the
contractor replies. Reuse the Work-notification named-template +
receipt/attempt-count machinery rather than inventing a new path.

**Guardrails:** provider sends remain explicit/review-first per the existing
Work-notification preference model (operator preferences in
`app_user.notification_preferences`); respect contractor contact preferences.

**Tests:** notification-skipped vs queued paths; no provider call without
preference + approval; smoke for the notification cue.

---

## Ticket 4 [L] — Owner/agent: disbursement execution + trust surfaces (parked until agent-mode GTM)

**Correction to Codex:** distributions and management-fee deduction are
BUILT — `OwnerDistribution` snapshots, fee compute with GST handling
(`stewart/services/owner_distributions.py`), review/PDF endpoints, statement
dispatch receipts, owner portal accounts. What's open: payment execution
(`POST /owners/distributions/{id}/pay` deliberately absent), a trust-account
ledger surface, and disbursement↔provider reconciliation.

**Constraints that bind any work here:**
- `docs/account-operating-mode-ia.md`: self-managed accounts (SKJ today) must
  not see Owners-hub/disbursement/trust surfaces; everything gates on
  `operating_mode`.
- `docs/multi-entity-xero-ia.md`: Structure A (manager = account identity
  only) is current; inter-entity fee invoicing (Structure B) stays parked
  until the managing-agent GTM phase.

**Instruction:** do not build this for SKJ internal use. Pick it up when
third-party managing agents are onboarding. Disbursement execution should
then reuse the Ticket 2 payment-rail adapter rather than a second rail.

---

## Ticket 5 [partially shipped] — AI Mailbox Intake

**Verified state:** Temba explicitly revived this slice on 2026-06-12.
Backend foundations are shipped: `trusted_sender`, `InboundMessage.source`,
`auth_result`, `trust_state`, `original_sender`, ai@ mailbox routing/auth,
trusted-sender APIs, quarantine-before-AI, raw-email evidence storage, and
role-scoped read APIs. `/inbox` now has an AI Mailbox panel with copy address,
trusted queue, quarantine bucket, selected-message provenance, auth detail,
raw-email link, and local trust/discard decisions. Trust sender is available
only for authenticated `sender_not_trusted` quarantines and trusts the
authenticated `from_address`; failed-auth rows can be discarded but not
trusted from that email. AI mailbox rows stay out of the generic Comms reply
queue/dispatch path. The visible UI/action placement is review-pending.

**Instruction:** next work should start from the shipped read-only state, not
from the old migration plan. Remaining slices are Settings trusted-sender
management and reviewed promote/apply actions. Do not add acknowledgement
replies, provider sends, Smart Intake apply, tenant email, Xero/Basiq, payment,
or reconciliation mutation without explicit operator approval.

---

## Suggested order

1 (comms templates) → 3 (vendor notifications) → AI Mailbox Settings/promote
actions if Temba keeps this slice active. Payments step 1/2 remains deferred
per Temba's latest instruction; Ticket 4 stays parked until managing-agent GTM.

Perf follow-up from 2026-06-12 (separate track, pick up if any page still
feels slow): extend org-wide list scope to the remaining fan-out endpoints —
tenants, properties, billing-drafts, maintenance, arrears, compliance-checks,
invoice-drafts, contractors — using the `readable_entity_ids` +
`orgWideQueryFn` pattern from commit 3516cd5.
