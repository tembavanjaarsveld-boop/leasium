# Relby Next Chat Handover

Last updated: 2026-06-28

Generated from Obsidian: `/Users/tembavanjaarsveld/Documents/Temba OS/10_Projects/Relby`
Generator: `scripts/generate_obsidian_handover.py`

The vault is canonical for product direction, active priorities, durable
decisions, and AI handover context. This repo remains canonical for exact
code, tests, migrations, deployment setup, recent commits, and
implementation proof. If direction conflicts, surface the mismatch before
editing; if code behavior conflicts, inspect the repo and tests.

Refresh checklist: [docs/obsidian-mirror-checklist.md](obsidian-mirror-checklist.md).

## Read This First

- Work lands directly on `main`; no PRs, no co-authors, no generated-with lines.
- Start with the Obsidian notes listed in the mirror checklist, then inspect
  `git status --short` and `git log --oneline -12`.
- Provider guardrail is non-negotiable: no Xero write, SendGrid email, Twilio
  SMS, tenant email, payment action, or reconciliation without explicit
  operator approval.
- UX-facing work uses the in-loop UX gate in
  [docs/design-governance.md](design-governance.md).
- Repo path: `/Users/tembavanjaarsveld/Documents/Stewart`.

## Product Promise

Documents should turn into work with as little re-keying as possible. Drop the
contract, lease, invoice, certificate, guarantee, or handover pack; Relby reads
it, matches it to the portfolio, suggests changed fields, and asks a human to
review and approve before anything is committed.

## Current Shipped State

- Smart Intake property duplicate guard is shipped.
- Smart Intake tenant setup path is shipped.
- Smart Intake tenant email role inference is shipped.
- Smart Intake review intelligence and matcher review UI are shipped.
- Relby AI no-prepick document upload is shipped.
- Relby AI toolbar follow-up is shipped.
- Lease imports skip historical lease-derived obligations and import only
  due-today or future attention items.
- Tenant onboarding signed-lease self-heal is shipped.
- Source history evidence trails are redesigned.
- Settings communication-template UX is redesigned.
- Backend/data Relby brand pass is shipped.
- People Owners all-entities fan-out is shipped.
- Lease Attention error placement and unit-orphan prevention are shipped.
- Properties calendar removal and map address-only fallback are shipped.
- Switcher-removal cleanup state is reconciled; old all-mode gap lists are
  historical unless a fresh scoped bug is opened.
- Customisable reporting v1 is scoped as Saved Report Views under Insights,
  using existing review packets and exports.
- Tenant portal account lifecycle v2 is scoped around invite renewal, tenant
  recovery, multi-login management, and email-change handling.
- Approvals and workflow depth is scoped as source-screen approval receipts:
  the Work approvals inbox stays read-only.

## Active Work Now

1. Use [[../BUILD_QUEUE]] as the current Relby build-priority source.
2. Verify the latest Relby AI deploy on `https://relby.ai/intake`.
   Expected: initial composer shows Files + Approval first + disabled Ask, with
   no trust picker until ask activity starts.
   Latest check: unauthenticated read-only verification on 2026-06-27 reached
   the operator-login gate. See [[INTAKE_PRODUCTION_VERIFICATION_2026-06-27]].
3. Run `scripts/rebrand_relby_data.py` as a dry-run against a Neon branch before
   any reviewed apply.
   Latest check: dry-run attempted without `--apply` on 2026-06-27, but the
   Neon database URL was not configured. See
   [[REBRAND_DATA_DRY_RUN_2026-06-27]].
4. Keep Smart Intake and document filing work review-first.
5. For design-review cleanup, follow
   [[UX_PLATFORM_AUDIT_ROADMAP_2026-06-28]]. R0 source mapping is now repaired;
   the remaining R0 evidence refresh waits for an operator login/MFA session.

## Current Active Tracks

| Track | State | Notes |
| --- | --- | --- |
| Build queue | canonical v1 exists | [[../BUILD_QUEUE]] is now the short operator queue; repo roadmap remains the implementation record. |
| Obsidian repo mirror | first generator proven | `scripts/generate_obsidian_handover.py` rebuilds `docs/next-chat-handover.md`; GitHub Actions run `28303215963` passed on `a457b38`. Broader repo mirroring still pending. |
| Platform stabilization v1 | proven on main | Commit `a34696c` passed backend, frontend, and all four smoke shards in GitHub Actions run `28302894535`. |
| Switcher removal | reconciled | Old 103-failure plan and all-mode follow-up are historical. Start only fresh scoped all-mode bugs. |
| Reporting v1 | scope defined | Build as Saved Report Views under Insights using existing review packets; no duplicate compliance roll-up. |
| Tenant portal lifecycle | scope defined | Build on shipped account foundation; focus invite renewal, recovery, multi-login management, and email-change handling. |
| Approval action depth | scope defined | Keep Approvals inbox read-only; deepen source-screen maintenance approvals, delegated reminders/escalations, and activity receipts. |
| Relby brand/data pass | code shipped, stored-row review pending | Backend/data code pass is shipped. Stored Neon rows require dry-run branch review before any `--apply`. |
| Smart Intake review intelligence | shipped | Backend and matcher review UI are now shipped. Do not rework extraction. |
| Full-platform UX cleanup | R0 partly repaired | Signed-in desktop evidence exists; the audit harness now has a `platform` preset, and Figma/repo route indexes exist. Mobile evidence refresh is waiting on operator login/MFA. |
| Navigation/deep-link contract | source-defined | R1 is defined in [[UX_NAVIGATION_DEEPLINK_CONTRACT_2026-06-28]]; apply open choices only inside their matching Figma-first slices. |

## Current Cautions

- Do not mutate Xero, SendGrid, Twilio, tenant email, payment, or reconciliation
  without explicit operator approval.
- Do not treat repo docs as fully mirrored from the vault yet.
- Do not touch extraction prompts/schema/model choices unless a slice explicitly
  requires it.
- Design-facing changes require the in-loop UX gate.
- UX cleanup must be evidence-first and Figma-first: do not use stale
  signed-out mobile captures or code-only inference as the source for design
  fixes.

## Operating Guardrails

### Provider Mutation Guardrail

Never run a Xero write, SendGrid email, Twilio SMS, tenant email, payment
action, or reconciliation without explicit operator approval.

Smart Intake and AI surfaces are review-first:

extract -> confidence -> source -> approve/edit/ignore -> mutate only after
approval.

Tests must mock providers.

### Design Gate

Design-facing changes use the in-loop UX gate:

- Figma-first for new or restructured core surfaces.
- Build to the design source of truth.
- Review screenshots at desktop and mobile.
- Run the slop check.
- Fix findings in-slice.
- Log the UX pass in `docs/design-governance.md`.

The old Remba queue is retired. Do not re-open historical Remba-pending work.

## Local Git State

- ` M CLAUDE.md`
- `?? docs/codex-brief-matcher-review-ui-2026-06-27.md`

## Recent Feature Commits

- `57887c2` Add Relby R5 record grammar draft
- `43a93cf` Refresh Relby UX draft handover
- `f99f2a3` Document Relby Figma UX drafts
- `3bc29ee` Refresh Relby UX handover
- `4162f7c` Lock Relby UX audit source map
- `a457b38` Refresh Obsidian handover mirror
- `991c6bc` Add Obsidian handover mirror
- `a34696c` Stabilize Relby smoke handoffs
- `96cb298` Guard Smart Intake property duplicates
- `c0ca8a5` Add Smart Intake tenant setup path
- `4cbde98` Infer tenant emails from Smart Intake contact text
- `379db21` Fix Workflows queue entity scope

## Next Actions Now

- Use [[BUILD_QUEUE]] as the current Relby build-priority source.
- Verify the latest Relby AI deploy on `https://relby.ai/intake`.
- Run `scripts/rebrand_relby_data.py` as a dry-run against a Neon branch before
  considering any reviewed apply.
- Keep Smart Intake/document filing work review-first.
- Use [[Brain/CURRENT_BRAIN_STATE]] as the first Relby AI entry point.
- For Relby design-review cleanup, continue
  [[Brain/UX_PLATFORM_AUDIT_ROADMAP_2026-06-28]] R0 from the repaired
  route/frame index: refresh the signed-in audit session and rerun the platform
  desktop/mobile capture when operator login/MFA is available.

## Next Actions Later

- Rebuild Portfolio QA from the current Relby platform language; archived draft
  frames `188:988` and `188:1071` are rejected notes only.
- Extend Settings and Message Templates from current-platform Figma frame
  `203:938`; archived draft frames `188:1109` and `188:1173` are rejected
  notes only.
- Continue Properties record work from current-platform Figma frame `203:1114`;
  archived draft frames `190:988`, `190:989`, and `190:990` are rejected notes
  only.
- Use [[Brain/UX_PORTFOLIO_QA_REDESIGN_BRIEF_2026-06-28]] and
  [[Brain/UX_SETTINGS_MESSAGE_TEMPLATES_REFRESH_BRIEF_2026-06-28]] and
  [[Brain/UX_PROPERTIES_RECORD_GRAMMAR_BRIEF_2026-06-28]] when reviewing or
  implementing those Figma lanes.
- Apply the open R1 route decisions from
  [[Brain/UX_NAVIGATION_DEEPLINK_CONTRACT_2026-06-28]] only inside their
  matching Figma-first slices.
- Expand the generator beyond `docs/next-chat-handover.md` only if repeated
  sessions show useful context is still missing from the generated handover.
- Distil more SKJ property ops lessons into Relby product insight notes only,
  without moving raw SKJ property data into Relby.

## Verification Cheatsheet

Backend:

```bash
.venv/bin/python -m ruff check apps stewart tests scripts
.venv/bin/python -m pytest
```

Frontend:

```bash
cd apps/web
./node_modules/.bin/eslint src tests/smoke
./node_modules/.bin/tsc --noEmit
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test tests/smoke/intake-conversation.spec.ts --reporter=line
```

Use focused checks for small slices, then broaden when touching shared flows
or provider guardrails.

## Key Docs

- [docs/product-roadmap.md](product-roadmap.md) - shipped features and next
  build order.
- [docs/design-governance.md](design-governance.md) - UX gate, pass log, and
  UX debt register.
- [docs/leasium-codex-design-source-of-truth.md](leasium-codex-design-source-of-truth.md) - visual/product source.
- [docs/obsidian-mirror-checklist.md](obsidian-mirror-checklist.md) - mirror
  refresh protocol.

## Handover Hygiene

- Target length: under 300 lines.
- Keep newest, actionable context here; keep long history in the vault or
  `docs/handover/archive/`.
- Regenerate this file instead of hand-copying Obsidian state.
