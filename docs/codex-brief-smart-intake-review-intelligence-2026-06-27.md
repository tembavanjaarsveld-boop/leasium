# Codex brief — Smart Intake review intelligence: auto-match, approve-all, duplicate detection (2026-06-27)

> **Status: ready to build.** Delivers the two near-term picks from
> `docs/leasium-ai-capabilities-and-roadmap-2026-06-23.md` (§Near-term):
> "per-field confidence + inline auto-match", "approve-all-high-confidence", and
> "duplicate detection". One brief, three tickets on a **shared scored-candidate
> matcher**, backend-first.

**Owner:** Codex — backend + API client types are Codex-pure; the review-surface
presentation is **design-gated (§2.2)** and lands behind an approved Figma frame.
**Repo:** `/Users/tembavanjaarsveld/Documents/Stewart`, branch `main`, gmail author.

## Mission (one line)

Cut review clicks and stop duplicate records: pre-select the most likely existing
property/tenant for an extracted lease (auto-match), let the operator approve all
clearly-high-confidence rows in one action, and flag likely duplicates (same
document, or a near-identical existing property/tenant) so they **link instead of
create** — all review-first, all internal-only.

## #1 guardrail — the extraction is stable; do NOT rework it

The AI extraction is finally working well. This work sits entirely on the
**review/match layer above it**. Off-limits — do not change:

- the extractors `stewart/ai/document_intake.py`, `stewart/ai/lease_intake.py`
  (or other `stewart/ai/*`), their prompts, schema, or model selection;
- the review-first contract (extract → confidence → source → approve → mutate).

Two consequences:

- **Scoring is deterministic string-similarity, NOT an AI call.** Match/duplicate
  scoring runs over already-extracted fields + existing DB records using
  normalised token-set / sequence similarity (reuse `_building_key` /
  `_street_core`; `difflib.SequenceMatcher` or a small pure-Python token-set ratio
  — **don't add a heavy dependency**; confirm what's already vendored). It must be
  fast, free, deterministic, and **not gated on `OPENAI_API_KEY`**.
- Per-field confidence is an **existing extraction artifact** — reuse it, don't
  recompute it.

## What already exists (reuse — don't rebuild)

- **Per-field confidence + source_hint** are extracted (`document_intake.py`
  `DOCUMENT_INTAKE_SCHEMA` / `extract_document_file`) and **already rendered** as
  high/med/low badges in the review UI (`IntakeConversationPanel.tsx`
  `confidenceLevel()` / `ConfidenceBadge`, `buildUnderstanding()`). So "per-field
  confidence" is **done** — this brief reuses it; only extend a surface that still
  shows doc-level-only.
- **Exact matching + manual link/new toggle:** `_find_matching_property`
  (`document_intakes.py`, building-key + exact name/address), `_find_or_create_tenant`
  (`lease_intakes.py`, exact ABN/legal_name), `_find_or_create_unit`; the operator
  link/new toggle (commits `72bff53`, `83bc3e1`) passes `property_id`/`tenant_id`
  into the apply payload. **Matching is exact-only — no fuzzy/scored candidates.**
- **Lease temporal-overlap guard:** `_assert_no_overlapping_lease` /
  `_has_overlapping_unit_lease` — the only existing dedup; keep it.
- **Apply (the one mutation gate):** `document_intakes.py::_apply_lease_document_intake`
  → `lease_intakes.py::_apply_lease_records`; `target_entity_id` filing-trust logic
  intact. Records are created internal-only (no provider call).

## Shared foundation (Ticket 0, Codex-pure) — scored candidate matcher

A read-only, deterministic scorer reused by all three tickets. Suggested home:
`stewart/domain/intake_match.py`.

- `score_property_candidates(extracted, existing[]) -> [{property_id, score, reason}]`
  — normalised name + `_street_core` address + `_building_key` token overlap.
- `score_tenant_candidates(extracted, existing[]) -> [{tenant_id, score, reason}]`
  — normalised legal/trading name token-set + exact ABN (ABN match = score 1.0).
- Tunable thresholds: `AUTO_MATCH >= ~0.9` (safe pre-select), `DUPLICATE >= ~0.75`
  (warn). Return a short human `reason` ("name + street match"). No mutation, no
  provider/AI call. Unit-tested in isolation with fixture pairs.

## Ticket A — Auto-match + approve-all-high-confidence

**Backend (Codex-pure):**
- `GET /document-intakes/{id}/match-candidates` → top scored existing
  property/tenant candidates (read-only) for the review surface.
- An apply option (e.g. `approve_high_confidence: true`) that applies **only** rows
  where every field is ≥ the confidence threshold **and** the match is unambiguous
  (a single AUTO_MATCH candidate, or a clean new record with no DUPLICATE warning),
  leaving low-confidence / ambiguous / duplicate-suspected rows for manual review.
  Reuse the existing apply path + guards; **approve-all still creates internal
  records only — never a provider call.** Duplicate suspicion (Ticket B) blocks a
  row from the batch.

**Review surface (design-gated, §2.2):** pre-select the top candidate in the
plan's link/new control with a one-click confirm/change; add the "approve all N
high-confidence rows" action. Figma-first: add/duplicate the review frame in the
Design Source of Truth, get Temba's sign-off, build to it, run the same-session UX
pass (1440/390 + slop test), log a UX Pass Log line.

## Ticket B — Duplicate detection

**Backend (Codex-pure):**
- **Exact re-upload:** compare a content hash of the uploaded bytes against prior
  intakes/`StoredDocument` → "you already processed this document" (confirm whether
  a hash column exists; add one if not — additive, no migration risk if stored in
  existing metadata).
- **Near-duplicate records:** use the Ticket 0 scorer at DUPLICATE threshold to
  flag a likely-existing property/tenant; surface via the same
  `match-candidates` read (or a `duplicate-candidates` view).
- On confirm, the operator **links to the existing record** (existing
  `property_id`/`tenant_id` apply payload) instead of creating a new one. Read-only
  until Apply.

**Review surface (design-gated, §2.2):** "Likely duplicate — link instead of
create?" card on the affected plan row (and a document-level "already imported"
banner for an exact hash hit). Same Figma-first flow as Ticket A.

## Guardrails (non-negotiable)

- **§2.1:** scoring + candidate reads mutate nothing and call no provider. Linking/
  merging/approve-all create internal records only at the existing Apply gate. No
  Xero/SendGrid/Twilio/payment.
- **§2.2:** every visible review-surface change goes through the in-loop UX gate
  (Figma-first + same-session UX pass). The backend (Ticket 0 + the endpoints +
  approve-all option) is not design-facing and can land first, behind the current
  surface, fully tested.
- Keep matching **deterministic + offline** (no AI/key dependency); degrade to
  today's manual link/new when no candidate scores high enough.

## Tests (§2.8)

Backend `tests/integration/test_document_intake_api.py` (+ a unit test for the
scorer) — mock OpenAI; assert no provider mutation:
- scorer: name/address/ABN variants score as AUTO_MATCH vs DUPLICATE vs no-match
  (deterministic fixtures);
- `match-candidates`: returns the right ranked existing record for a near-name
  variant; empty when nothing is close;
- approve-all: high-confidence + unambiguous rows apply; a low-confidence row and a
  duplicate-suspected row are **left** unapplied;
- duplicate link: re-import of an existing property/tenant links (no new record
  created); exact re-upload is flagged;
- existing exact-match + overlap-guard tests stay green.

Frontend: Playwright smoke for the auto-match pre-select, approve-all, and
duplicate-link paths once the surface lands; run the UX gate.

## Out of scope

Extraction/prompt/schema changes; conflict detection across lease changes;
provider-readiness validation; the agentic monthly-run assistant (later tier);
any provider send. Per-field confidence *display* (already shipped — reuse).

## Conventions / notes for Codex

- **You are not alone in this tree.** `git fetch` + `git status --short` +
  `git diff --stat` first; run the full backend suite after any concurrent commit;
  stage only this slice's files by explicit path; never revert unrelated changes.
  (There is currently an uncommitted lease-import obligation-date change + doc
  edits in the tree — leave them alone.)
- Backend `ruff`/`pytest` on Temba's Mac via Desktop Commander (sandbox can't run
  the venv); frontend `eslint`/`tsc` via the bundled Next WASM.
- Land Codex-pure backend first (Ticket 0 + endpoints + approve-all option +
  tests). Hold the review-surface UI until the Figma frame is signed off (§2.2).
- Commit: terse imperative subject, file-by-file body, **no** Claude/Codex
  attribution, **gmail author**. Push on Temba's go; verify deploy. Update
  `docs/product-roadmap.md` + `docs/next-chat-handover.md` (and a UX Pass Log line
  for the surface slice).
