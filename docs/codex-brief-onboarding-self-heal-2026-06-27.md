# Codex brief — Onboarding self-heal: signed/executed lease ⇒ complete (2026-06-27)

> Refreshes/supersedes the onboarding-completion fix in
> `codex-brief-leasium-ai-intake-onboarding-2026-06-17.md` — updated for the
> OpenSign swap (`c63d0a8`) and the migrated-tenant path (`6732dd0`/`bb9110d`).
> **Status: ready to build.**

**Owner:** Codex (backend-led; minimal/no frontend).
**Repo:** `/Users/tembavanjaarsveld/Documents/Stewart`, branch `main`, commits land
directly on `main` (gmail author — see Conventions).

## Mission (one line)

A signed/executed lease must resolve its tenant onboarding to **complete
(`applied`)**, and existing rows stuck mid-flow (e.g. "Sign = Done" while
"Lease file = Now / Send pack = Waiting") must **self-heal** — with **no provider
message sent** and **without touching the Smart Intake / AI pipeline.**

## #1 guardrail — do NOT touch the working AI / intake pipeline

The Smart Intake conversation, extraction, confidence/review, and the bundled
apply are finally stable. This slice is a **downstream onboarding-status fix
only.** Off-limits — do not change logic in:

- extraction / AI: `stewart/ai/*`, prompts, model selection;
- intake review/apply: `_apply_lease_document_intake` (`document_intakes.py:~1251`),
  `_apply_lease_records` / `_create_lease` (`lease_intakes.py:~547` / `~871`),
  building-as-property matching, `IntakeConversationPanel`;
- the review-first contract (extract → confidence → source → approve → mutate).

The only contact with that path is **additive and guarded**: after a lease is
applied, *if* the persisted lease is signed/active *and* an onboarding is linked,
sync the onboarding status (Hook A). Do not refactor or re-flow the apply. Because
the AI is "mostly" right, the completion guard must key off the **actual persisted
lease signed/active state — never a raw AI/extracted field** — and must be
**idempotent and safe on partial/odd states.**

## The bug (repro)

Import/bring in an already-executed lease (e.g. an SKJ internal/related-party
lease; tenant has no email/phone). The linked onboarding ends up inconsistent:
status pre-`applied` with **Sign = Done** (e.g. "Signed 17 Jun") but **Lease file
= Now** and **Send pack = Waiting**; tenant shows no email/mobile/contact.
Onboarding is a *linear* flow ending in Sign — you cannot reach Sign without
finishing Lease file and Send pack — so "Sign Done while earlier steps aren't" can
only arise from stamping the terminal signed state without walking the steps. It
is not a real external onboarding.

## State model (verified 2026-06-27 — re-confirm before editing)

- `TenantOnboardingStatus` (`stewart/core/models.py:~201`): `draft, sent,
  submitted, reviewed, applied, cancelled`. **`applied` is the terminal
  "complete" state** (there is no separate "complete"). Timestamps:
  `submitted_at` / `reviewed_at` / `applied_at`.
- Normal flow: `create_tenant_onboarding` (`tenant_onboarding.py:~1566`) → `sent`
  → submit → `submitted` → review → `reviewed` → apply → `applied`.
- **Applied-direct pattern (REUSE THIS):** `build_migrated_onboarding`
  (`stewart/domain/tenant_migration.py:~59`) creates an onboarding **directly
  `applied`** with provenance `review_data["origin"]="migration"`; used by
  `create_migrated_tenant_onboarding` (`tenant_onboarding.py:~1624`) and
  `scripts/migrate_existing_tenants.py`.
- **Signing gap:** OpenSign webhook `record_opensign_signing_event`
  (`tenant_onboarding.py:~1857`) on `completed` calls `mark_lease_agreement_signed`
  (`tenant_lease_agreement.py:~200`) **but does not advance
  `TenantOnboarding.status`.** ← the core gap.
- Smart Intake apply does **not** itself create an onboarding (`lease_intakes.py`
  has no onboarding code). The stuck row arises where an onboarding already
  exists/links to a lease that becomes signed — **confirm the exact link path**
  (`StoredDocument.tenant_onboarding_id` / the tenant-uploaded-lease-match signed
  path) during implementation; don't assume.

## Acceptance criteria

1. **Signed ⇒ applied.** When an onboarding's lease is signed/executed
   (lease-agreement signed and/or `LeaseStatus.active`), the onboarding resolves
   to `applied`; no intermediate step is left Now/Waiting.
2. **Self-heal existing rows.** Pre-existing inconsistent rows (pre-`applied`
   onboarding + signed/active lease) heal to `applied`, **idempotently** — not just
   newly created ones.
3. **Imported executed leases land complete or not at all.** If an already-executed
   import links/creates an onboarding, it lands `applied` (reuse the applied-direct
   pattern); if there is no external tenant to onboard (no contact details), don't
   create one.
4. **Guard — don't over-complete.** Gate on the lease actually being signed/active.
   A genuinely pending onboarding (tenant still needs to sign) keeps the normal
   flow. No blanket-complete of every linked onboarding.
5. **No provider side effects (CLAUDE.md §2.1).** Completing onboarding sends
   nothing — no invite, pack, email, SMS, or Xero write. State resolution only.
   Tests assert zero provider calls.

## Recommended approach (surgical — Codex to confirm in code)

- **Hook A — on signing (primary, additive):** in `record_opensign_signing_event`
  right after `mark_lease_agreement_signed` (and any other place that marks a lease
  signed, e.g. the tenant-uploaded-lease-match signed path), if a linked onboarding
  exists and is pre-`applied`, advance it to `applied` (set `applied_at`, provenance
  reason e.g. `"signed_lease_autocomplete"`), guarded on signed/active. No re-flow
  of surrounding logic.
- **Hook B — self-heal backfill (existing rows):** an idempotent
  `scripts/backfill_*.py` (template: `scripts/migrate_existing_tenants.py`) that
  finds pre-`applied` onboardings whose lease is signed/active and transitions them
  to `applied` with reason `"self_heal_pre_signed_lease"`. Re-run = no-op;
  provider-inert; **dry-run-first + `--apply`** (mirror `scripts/rebrand_relby_data.py`).
- **Avoid mutate-on-GET.** The 2026-06-17 brief said "self-heal on read" — prefer
  write-time sync (Hook A) + the backfill (Hook B) over mutating inside a GET. If
  read-time safety is wanted, make the *display* derive "complete" from a signed
  lease (read-only), but persist the status via A/B.
- Prefer fixing **backend state** so the existing onboarding UI simply renders
  `applied`; minimise/avoid frontend change.

## Tests (CLAUDE.md §2.8)

Backend `tests/integration/test_tenant_onboarding_api.py` (mock
OpenSign/SendGrid/Twilio/Xero; assert **zero** provider calls):

- signed-lease webhook `completed` ⇒ onboarding becomes `applied`;
- **guard:** an unsigned/pending onboarding stays pre-`applied` after a non-signed
  event (normal flow preserved);
- **self-heal:** a seeded stuck row (pre-`applied` + signed/active lease) ⇒
  `applied`; idempotent re-run is a no-op; a legitimately-pending row is untouched;
- (if an import path links an onboarding) executed-import lands `applied` or none —
  never stuck.

Frontend: prefer no change. If an onboarding surface does change, add/adjust a
Playwright smoke and run the in-loop UX gate (§2.2, 1440/390 screenshots).

## Out of scope

AI extraction/review/apply changes; a manual "skip onboarding" button as the
primary mechanism (a secondary escape hatch only, not this slice); provider sends;
building-as-property; the migrate-existing-tenant flow P2–P4 (separate ticket).

## Conventions / notes for Codex

- **You are not alone in this tree.** `git fetch` + `git status --short` +
  `git diff --stat` first; run the full backend suite after any concurrent commit
  lands; never revert or "tidy" unrelated changes. Stage only this slice's files by
  explicit path.
- Backend `ruff`/`pytest` run on Temba's Mac via Desktop Commander (the Cowork
  sandbox can't run the venv); frontend `eslint`/`tsc` via the bundled Next WASM.
- Commit: terse imperative subject, file-by-file body, **no** Claude/Codex
  attribution, **gmail author identity** (private-repo Hobby plan blocks
  `temba@skjcapital.com`-authored deploys). Push only on Temba's go; verify Vercel
  goes READY.
- On ship: update `docs/product-roadmap.md` and `docs/next-chat-handover.md`. Not
  design-facing if the UI just renders `applied` (no UX gate needed); if you change
  an onboarding surface, run §2.2.
