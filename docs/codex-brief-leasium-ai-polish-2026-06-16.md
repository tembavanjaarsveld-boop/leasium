# Codex Brief — Leasium AI conversation-first: remaining polish (run non-stop)

**Date:** 2026-06-16. **Owner agent:** Codex. **Mode:** autonomous,
self-replenishing queue — work the slices in order, verify each to the iron
law before moving on, do not idle waiting on Temba except where a slice is
explicitly marked **DECISION-GATED**.

## Status correction you must read first

The 2026-06-12 perf "fan-out follow-up" backlog (tenants, properties,
billing-drafts, maintenance, arrears, compliance-checks, invoice-drafts,
contractors) is **fully shipped** — commits `21f5134`, `97b654f`, `2d1f167`,
`8535d16`, `9b5d666`, `fb3fadd` (plus properties/tenants in `3516cd5`). Do
**not** pick that work up; it's done. Likewise the AI Mailbox in-loop UX pass
(`codex-brief-ai-mailbox-ux-2026-06-14.md`) shipped — see the UX Pass Log
entries dated 2026-06-14/15. The conversation-first Slice 1
(`IntakeConversationPanel`) and the AI Inbox conversation review
(`InboxConversationPanel`) are both shipped too.

**The one genuinely-open frontier** is the "Leasium AI conversation-first —
remaining polish" entry in `docs/design-governance.md` §UX Debt Register:

> Still pending from the concept: the full approved Home layout (centered
> composer + right-rail queue, rather than the current stacked page), real
> deep-links to the created records and the gated next-step actions (Xero /
> invoicing / email), and a ⌘K agent that carries full page context as a
> persistent thread.

Concept + approved Figma: `docs/leasium-ai-conversation-redesign-2026-06-15.md`
(file `PO2jOANgmqgZHfqWZXOZGU`, frames on page `01 Foundations` x≈11200).

## Baseline (CLAUDE.md — non-negotiable)

- **§2.1 provider guardrail.** Internal records (property/unit/tenant/lease/
  tasks/critical dates) are created on confirm via the existing apply path.
  **No Xero post, SendGrid email, Twilio SMS, tenant email, payment, or
  reconciliation** without a separate explicit operator approval. Next-step
  cards are **links into existing gated flows only** — they must never fire a
  provider call. Tests mock providers.
- **§2.2 in-loop UX gate** for any design-facing slice: build to the approved
  Figma frame, run the gate checklist in `docs/design-governance.md`, capture
  real 1440px + 390px screenshots, apply the hallmark slop test, fix in-slice,
  log one UX Pass Log line.
- **§2.6 tooling.** Frontend `eslint`/`tsc`/smokes/`next build` run on Temba's
  Mac via Desktop Commander; the Cowork sandbox can't. Smokes need
  `NODE_ENV=development` (prod default crash-loops next-dev) — clear stale prod
  `.next` first. No backend `pytest`/`ruff` in sandbox.
- **§2.8 test discipline.** Each slice lands with a smoke fixture + spec; the
  no-provider-call guard below is mandatory in every conversation-first smoke.
- **§2.4/§2.5 commits.** Terse imperative subject, file-by-file body, **no**
  Claude/Codex attribution, **gmail author identity** (private-repo Hobby plan
  blocks `temba@skjcapital.com` deploys). Stage only the slice's files;
  `git status --short` first; if `.git/index.lock` is stale, rename don't
  unlink. Push only on Temba's go; verify Vercel goes READY.

## Per-slice workflow (superpowers loop)

1. State a one-line plan in-chat (these are all [S]/[M]; no design doc needed
   except the DECISION-GATED slices).
2. RED first: write/extend the smoke so it fails for the missing behaviour.
3. Implement against the named files below; reuse `ui.tsx` primitives + Horizon
   tokens (`docs/leasium-codex-design-source-of-truth.md`). No ad-hoc tokens.
4. GREEN: eslint + tsc on touched files, targeted smoke, `next build`,
   screenshots 1440/390, slop test. Fresh evidence before "done".
5. Update `docs/product-roadmap.md`, `docs/design-governance.md` (UX Pass Log +
   trim the Debt Register entry), `docs/next-chat-handover.md`.
6. Commit (gmail author). Move to the next slice. Keep going.

---

## Surface map (verified 2026-06-16 — use these exact targets)

**Components:**
- `apps/web/src/components/intake/IntakeConversationPanel.tsx` — exported
  `IntakeConversationPanel` (~line 549), props `{ entityId, intake:
  DocumentIntakeRecord, onApplied? }`.
  - Applied summary read at ~688-692 from `appliedRecord.review_data.applied`.
  - **Created card** `data-testid="intake-created"` (~1001-1025); rows built by
    `buildCreated(applied)` (~491-524), `type CreatedRow = { label: string;
    href?: string }`. Today property rows link to `/properties` and tenant
    rows to `/tenants` (index pages, not record detail).
  - **Next-steps card** `data-testid="intake-next-steps"` (~1027-1062). Three
    hardcoded rows: `Sync tenant to Xero → /finance`, `Set up monthly rent
    invoicing → /finance`, `Email the tenant → /tenants`, each with a
    `NEEDS APPROVAL` badge + `Review` link. **Currently inert/static** — no
    context (no entity/property/tenant/lease query params) is carried.
- `apps/web/src/components/intake/InboxConversationPanel.tsx` — mirror surface
  for the AI Inbox; apply the same deep-link treatment where it renders created
  records / next steps.

**Apply response shape (`apps/web/src/lib/api.ts` ~5774-5794):**
`applyDocumentIntake(intakeId, { reviewData?, propertyId?, tenancyUnitId?,
tenantId?, leaseId? })` → `DocumentIntakeRecord` (type ~1547-1569). The created
ids land in `review_data.applied` (`Record<string, unknown>`) with keys:
`property_id`, `property_name`, `created_lease_count`, `tenant_id`,
`tenant_name`, `obligation_count`, `work_order_count`.

**Deep-link target routes (App Router):**
- Tenant detail exists: `apps/web/src/app/tenants/[tenantId]/page.tsx` →
  `/tenants/{tenant_id}`.
- Properties is a workspace index `/properties` (query params `?action=new&
  view=...`); confirm whether a single-property deep link exists (e.g. a
  `?property=` selector on the workspace) before pointing there — if there's no
  detail route, link to the index and pre-select via existing query param, do
  not invent a route.
- Finance/Money: `/money` (alias `/finance`), sub-routes `/money/xero`,
  `/money/billing`, `/money/basiq`, `/money/statements`.
- Comms: `/comms` (alias `/work/comms`).

**Gated next-step flows (link targets — never call directly):**
- Xero: `/money/xero`; send is `dispatchXeroInvoiceProviders(entityId, …)`
  (api.ts ~4123) — operator-only, do not call from intake.
- Rent invoicing: `/money/billing`; rent-roll context via `listRentRoll({
  entity_id, property_id, as_of })` (api.ts ~5811).
- Tenant email: `/comms`; send is `dispatchCommsDraft(payload)` (api.ts ~7260,
  `CommsDispatchPayload` ~6174) — operator-only, do not call from intake.

**Smoke harness:** `apps/web/tests/smoke/intake-conversation.spec.ts` +
`apps/web/tests/smoke/api-mocks.ts`. The mandatory no-provider guard already
exists as `isForbiddenProviderRequest(method, path)` (~103-130) and the assert
`expect(forbiddenApiCalls).toEqual([])`; the only allowed mutation is the
`/document-intakes/{id}/apply` POST. **Reuse this guard in every new spec.**

---

## The queue (work top to bottom, non-stop)

### Slice A [S] — Created-record deep-links → record detail
**No new decision. Design already approved.** Make the `intake-created` rows
link to the actual created record, not the index. Tenant rows →
`/tenants/{tenant_id}` (route exists). Property rows → the real property detail/
selected-workspace deep link (verify the param first; if none exists, keep the
index link and note it in the Debt Register rather than inventing a route).
Mirror in `InboxConversationPanel`.
- **Smoke:** extend the existing spec to assert each created row's `href`
  resolves to the record id from `review_data.applied`. No-provider guard must
  still pass.

### Slice B [S] — Next-step cards carry context into the gated flows
**No new decision.** Wire the three `intake-next-steps` rows so the `Review`
link pre-selects the just-created entity/property/tenant in its destination via
the existing query params (e.g. `/money/billing?entity_id=…&property_id=…`,
`/comms?target_kind=tenant&target_id=…`, `/money/xero?entity_id=…`). Use only
query params the destination already reads — confirm each in the destination
page before wiring. Keep the `NEEDS APPROVAL` badge; the link must land the
operator on the gated surface, never auto-fire.
- **Guardrail check:** the smoke's `isForbiddenProviderRequest` must record
  zero calls — clicking `Review` is a navigation, not a dispatch.
- **Smoke:** assert each `Review` href contains the correct pre-select params;
  assert `forbiddenApiCalls` stays empty across the click.

### Slice C [S] — Mobile issue-toast placement
**No new decision.** From the Debt Register: the fixed red issue toast overlaps
the mobile bottom nav / lower content at 390px. Reposition so it clears the
bottom nav. Scope is the toast/notification positioning only — do **not** fold
it into intake semantics.
- **Smoke:** 390px spec asserting the toast does not overlap the bottom-nav
  region; screenshot evidence at 390.

### Slice D [M] — Full approved Home layout (centered composer + right-rail queue)
**Build to the EXISTING approved Figma frame — no new sign-off needed**, but
confirm the frame node with Temba if ambiguous. Replace the current stacked
intake landing with the approved Home: centered conversation composer ("drop a
document, ask a question, or tell me what to do"), quick-action chips, the
Read→Propose→Approve explainer, recent threads, and the AI review queue as a
right-rail with status chips. Pull the target from Figma `Home (desktop) 148:52`
and `Home (mobile) 158:52` via the Figma MCP (`get_design_context`,
`get_screenshot`) — don't infer from current code.
- Full in-loop UX gate (§2.2): 1440 + 390 screenshots, slop test, UX Pass Log
  line. Keep the upload area + review queue behaviour intact.
- **Smoke:** landing renders the centered composer + right-rail queue;
  selecting a queue item still opens the conversation panel; no-provider guard.

### Slice E [L] — DECISION-GATED — ⌘K persistent agent thread w/ page context
**Do NOT start without Temba.** This needs open decision #4 from the concept:
where the thread/transcript persists — `review_data` vs a first-class
conversation record — which determines "Recent" + cross-device history, and how
much page context the global ⌘K agent carries in v1 (full thread vs contextual
launcher). Write a short design note in `docs/superpowers/plans/` and get
sign-off first. If you reach this slice before Temba has decided, stop and flag
it — do not guess the data model.

### Also DECISION-GATED — Portfolio QA IA redesign
Oldest standing UX flag; needs a **new** Figma frame (none exists in `03
Screens`) + Temba sign-off before code. Not part of the non-stop queue; pick up
only after a frame is approved.

---

## Suggested order
A → B → C → D, non-stop with per-slice verification. E and Portfolio QA stay
parked behind their decisions. If all of A–D land and Temba hasn't unblocked E,
the next autonomous work is the deferred perf note's *remaining* tail (if any
endpoint still fans out — re-check, most are done) or trimming the UX Debt
Register's smaller standing items; surface options rather than starting a
decision-gated slice.
