# Relby Next Chat Handover

Last updated: 2026-06-26

This file is the short current-state handover. The full historical log that used
to live here is preserved at
[docs/handover/archive/next-chat-handover-2026-06-26-pre-trim.md](handover/archive/next-chat-handover-2026-06-26-pre-trim.md).

## Read This First

- Work lands directly on `main`; no PRs, no co-authors, no generated-with lines.
- This trim was based on feature tip
  `8886226 Remove intake landing trust pre-pick`; always start with
  `git status --short` and `git log --oneline -12` before editing.
- Provider guardrail is non-negotiable: never run a Xero write, SendGrid email,
  Twilio SMS, tenant email, payment action, or reconciliation without explicit
  operator approval. Tests must mock providers.
- UX-facing work uses the in-loop UX gate in
  [docs/design-governance.md](design-governance.md): design source, screenshots,
  slop check, fixes, and dated UX-pass log.
- Source-of-truth status lives in this file, the top of
  [docs/product-roadmap.md](product-roadmap.md), and the UX debt register in
  [docs/design-governance.md](design-governance.md).

## Current State

- Relby AI no-prepick document upload is shipped. `/intake` accepts document
  upload/drop without forcing a trust pick first; extraction detects the trust
  and the review-side `File under trust` selector remains the filing decision.
- Relby AI toolbar follow-up is shipped in `8886226`: the initial landing
  composer no longer shows `Ask about` / `Select entity`, even on
  `/intake?entity_id=...`. The scope picker appears only once the operator is
  actually asking a question.
- Backend/data Relby brand pass is shipped. Recipient-visible backend defaults,
  prompts, PDFs, comms copy, mailbox defaults, and platform seeds now say Relby.
  `scripts/rebrand_relby_data.py` exists for stored rows; it dry-runs by default
  and should be reviewed against a Neon branch before any `--apply`.
- People Owners all-entities fan-out is shipped. `/people` can show owners from
  all readable trusts while Settings/single-trust owner writes remain scoped.
- Lease Attention error placement and unit-orphan prevention are shipped.
  Deleting a tenancy unit now soft-deletes its live leases, charge rules, and
  scoped obligations; property entity reassignment catches legacy obligations
  pointing through soft-deleted units/leases.
- Properties calendar removal is shipped. Calendar lives under Work; Properties
  exposes Cards, Table, and Map, and stale `?view=calendar` falls back to Cards.
- Properties map address-only fallback is shipped. Exact `metadata.map_location`
  pins remain preferred, but AU address/postcode-only rows now render approximate
  local pins with a "needs pin" refinement list, so `/properties?view=map` no
  longer starts as an empty unmapped planner.
- Switcher-removal work has multiple shipped slices across Portfolio QA,
  snapshots/drafts, Contractors, Tenants, Operations, row-trust Comms, and
  Billing Readiness. Before starting the next piece, read the current roadmap and
  recent commits because several older handover notes are now superseded.
- Planning and market-research briefs were added in `5e13465`, including the
  intake trust-detection brief, switcher-removal plan, backend rebrand handover,
  competitor landscape, GTM plan, and video script.

## Recent Feature Commits

- `8886226` Remove intake landing trust pre-pick
- `5e13465` Add planning and market research briefs
- `237d285` Ignore FUSE hidden temp files
- `ca608f2` Rebrand backend data copy to Relby
- `0d33f97` Allow intake uploads without trust pre-pick
- `8716875` Fix People owners all-entities view
- `040f38f` Remove Properties calendar view
- `5780c61` Fix Lease Attention errors and unit orphan cleanup
- `ded8f9b` Row-trust comms + billing per-row dispatch in all-mode
- `3aecbf5` Fix obligation status update 404 on soft-deleted unit
- `2032580` Fix Relby AI landing stuck loader + dark-mode sm:bg-white panel
- `510f5c7` Close notification-center + billing-recovery all-mode gaps

## Next Sensible Work

1. Verify the latest Relby AI deploy on `https://leasium.ai/intake`: initial
   composer should show Files + Approval first + disabled Ask, with no trust
   picker until ask activity starts.
2. Run `scripts/rebrand_relby_data.py` as a dry-run against a Neon branch and
   review the printed row diffs before considering `--apply`.
3. Continue switcher-removal cleanup only after checking
   [docs/product-roadmap.md](product-roadmap.md) and
   [docs/superpowers/switcher-removal-completion-plan-2026-06-25.md](superpowers/switcher-removal-completion-plan-2026-06-25.md)
   against the latest commits.
4. Keep Smart Intake/document filing work review-first: extract, confidence,
   source, approve/edit/ignore, then mutate locally only after approval.
5. Keep the handover compact. New shipped slices should add a short current-state
   bullet here only if they affect takeover; detailed proof belongs in commit
   bodies, roadmap entries, UX logs, tests, or a dated brief.

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

Use focused Playwright/pytest runs for small slices, then broaden when the slice
touches shared flows or provider guardrails.

## Key Docs

- [docs/product-roadmap.md](product-roadmap.md) - built features and next build
  order.
- [docs/design-governance.md](design-governance.md) - UX gate, pass log, and UX
  debt register.
- [docs/leasium-codex-design-source-of-truth.md](leasium-codex-design-source-of-truth.md)
  - visual/product source of truth.
- [docs/codex-brief-intake-detect-trust-2026-06-26.md](codex-brief-intake-detect-trust-2026-06-26.md)
  - Relby AI trust-detection brief.
- [docs/relby-backend-rebrand-handover-2026-06-26.md](relby-backend-rebrand-handover-2026-06-26.md)
  - backend/data rebrand detail.
- [docs/handover/archive/next-chat-handover-2026-06-26-pre-trim.md](handover/archive/next-chat-handover-2026-06-26-pre-trim.md) - full historical handover snapshot.

## Handover Hygiene

- Target length: under 300 lines.
- Keep newest, actionable context in this file; move old chronology into
  `docs/handover/archive/`.
- Prefer links to detailed docs over copying long test logs or implementation
  narratives.
- When this file grows beyond quick-read size again, archive the old version and
  replace it with a fresh current-state brief.
