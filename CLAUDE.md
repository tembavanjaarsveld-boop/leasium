# CLAUDE.md

Behavioral guidelines for AI coding agents (Claude Code, Codex, etc.)
working on the Leasium repo. Section 1 is the Karpathy/Forrest Chang
behavioural baseline (≈110k★ on GitHub, distilled from Andrej
Karpathy's observations about LLM coding pitfalls). Section 2 is
Leasium-specific direction layered on top.

**Tradeoff:** these guidelines bias toward caution over speed. For
trivial tasks, use judgment.

---

## 1. Behavioural baseline (Karpathy)

### 1.1 Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 1.2 Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?"
If yes, simplify.

### 1.3 Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 1.4 Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria
("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs,
fewer rewrites due to overcomplication, and clarifying questions come
before implementation rather than after mistakes.

### 1.5 Agent-first execution

**Use agents where they can materially help.**

- Default to spawning agents for bounded sidecar work, independent code
  reconnaissance, focused implementation slices with disjoint write sets,
  and review/verification tasks that can run while the main thread keeps
  moving.
- Keep the immediate critical-path blocker local when waiting for an
  agent would slow the work down.
- Give agents exact scope, files or responsibilities, constraints, and
  expected output. Tell coding agents they are not alone in the codebase
  and must not revert unrelated changes.
- Review and verify agent output before claiming status, committing, or
  moving to the next ticket.

---

## 2. Leasium specifics

### 2.1 Provider mutation guardrail (non-negotiable)

Never run a Xero write, SendGrid email, Twilio SMS, tenant email, or
payment reconciliation without explicit operator approval. Smart Intake
and AI surfaces are review-first by design: extract → confidence →
source → approve/edit/ignore → only then mutate. Surface what would
happen, but don't fire the provider call. Tests must mock providers.

### 2.2 UX gate — in-loop, every design-facing slice

UX is first-class, enforced inside each slice — not via an external
reviewer queue. (Remba, the early reviewer persona, produced two
reviews in May 2026 and was retired 2026-06-12; all historical
"Remba-pending" statuses are closed as superseded. See
`docs/design-governance.md`.)

For anything visible to a user — navigation, layout, copy, density,
status chips, workflow ordering, design system tokens:

1. **Design first.** New or restructured surfaces start from an
   approved Figma frame (§2.12); if none exists, create one and get
   Temba's sign-off in Figma before code. That sign-off is the human
   gate.
2. **Build to spec.** Pull design context from the Figma MCP and the
   design source of truth; no ad-hoc tokens or components.
3. **UX pass before "done".** In the same session: run the UX gate
   checklist in `docs/design-governance.md`, review real screenshots
   at desktop (1440px) and mobile (390px), apply the hallmark slop
   test to new surfaces, and fix findings in-slice. A slice with
   unfixed UX findings is not done.
4. **Log it.** One dated line in the UX pass log
   (`docs/design-governance.md`): surface, screens checked, fixes,
   anything deferred to the UX debt register.

Roadmap semantics: `[x]` = shipped with the UX pass done. `[~]` is
retired (historical entries only). Open UX work lives in the UX debt
register, not in a pending-review status.

### 2.3 Internal-first 6 months

SKJ uses Leasium internally for the first 6 months. Deprioritise
branding polish, marketing surfaces, external dark mode, and similar
external-facing aesthetics. Prioritise internal workflow speed,
data integrity, audit clarity, and review-first guardrails.

### 2.4 Operator + ownership

Temba is the operator/founder driving the product solo. Commits land
directly on `main` (no PRs). No co-authors, no `Generated with`
attribution lines in commit bodies — that's a project preference, not
a security thing.

### 2.5 Commit style

Terse imperative subject. Multi-line bodies are welcome and encouraged
for non-trivial slices — list every file touched and why. One feature
per commit when possible; when a consolidated working tree makes
per-topic splits impractical, an honest thematic bundle commit (named
"Tier 2 (f) v1: …") is preferable to silently pretending each commit
is a single feature.

### 2.6 Local tooling

- Python venv at `.venv/` is macOS-aarch64 native; backend `ruff` and
  `pytest` only run on Temba's Mac. The Cowork Linux sandbox cannot
  run them — frontend `eslint` and `tsc` run in the sandbox via the
  bundled Next WASM SWC.
- `uv` is not available; use `.venv/bin/python -m pytest`,
  `.venv/bin/alembic`, `.venv/bin/uvicorn`.
- `make seed` is the minimal local setup. Use `make demo-seed` when a browser
  check needs meaningful app data: it adds the fictional AU Harbour Lane /
  Rivergum portfolio under the dev-auth organisation, with properties, tenants,
  owners, contractors, billing, work, onboarding, and arrears records. It is
  idempotent and provider-inert: no Xero, Basiq, SendGrid, Twilio, payment, or
  reconciliation calls.
- Node.js is installed on Temba's Mac. The default review path for frontend
  changes is the canonical Vercel custom domain at `https://leasium.ai`.
  Treat `https://leasium.vercel.app` as an implementation alias, not a product
  URL.
- The Cowork sandbox can write to git but not unlink under `.git/`.
  Stale lockfiles need to be renamed (`mv .git/index.lock
  .git/index.lock.bak-…`) before each git command. Commits land
  fine; ignore the warnings.

### 2.7 Source-of-truth docs

When shipping a slice, update the right doc:
- `docs/product-roadmap.md` — built features + Next Build Order
  (`[x]`/`[ ]` per item; `[~]` is retired, historical only).
- `docs/design-governance.md` — UX gate checklist, UX pass log, and
  UX debt register for design-facing changes.
- `docs/leasium-codex-design-source-of-truth.md` — brand/frontend
  visual spec.
- `docs/deployment.md` — env/provider setup.
- `docs/next-chat-handover.md` — current state, takeover priority,
  recent commits, active local tree.

### 2.8 Test discipline

Backend integration tests live under `tests/integration/`; frontend
smoke under `apps/web/tests/smoke/` (Playwright with mocked API).
New surfaces should land with: at least one backend test for the
happy path + an error/503/auth path, and a smoke fixture + spec for
the visible flow. Mock OpenAI / Twilio / SendGrid / Xero — never hit
the real provider in tests.

### 2.9 Status sources

`docs/next-chat-handover.md` and the auto-memory index are the
canonical state for "what is shipped and what's in progress". When in
doubt, read them before assuming.

### 2.10 People + Properties IA north star (DoorLoop-informed)

Leasium's information architecture is converging on two spines — borrowed from
DoorLoop's *legibility*, not its feature set: **Properties → Units** and a single
**People** hub holding **Tenants · Owners · Vendors** (and, later, **Prospects**),
tied together by **Leases**. Two durable rules for any agent touching the data model
or navigation:

- **Owner is a first-class entity, not property metadata.** Once the `Owner` entity
  lands, treat the legacy 11 Property owner-fields as a backfill source, not the model
  of record.
- **Navigation stays consolidated.** Honour the 7-item sidebar cap (design source of
  truth §10.5.1); new human/relationship surfaces live under the People hub, not as new
  top-level items. Reuse one consistent record-page shape (header → tabs → same action
  patterns) across Tenant / Owner / Vendor / Property.

Keep what already makes Leasium better than DoorLoop: Smart Intake (document-first AI),
the review-first provider guardrails (§2.1), and AU / Xero / commercial-lease depth.
Localise every US analog (Xero not QuickBooks; PayTo/PayID/BPAY not ACH; REA/Domain;
Equifax/illion). Full benchmark: `docs/doorloop-benchmark-2026-05-31.md`. Design-facing
IA/nav changes go through the in-loop UX gate (§2.2).

### 2.11 Compliance + Insights direction

Insights already exposes a read-only `compliance_snapshot` from existing
insurance, bank guarantee, make-good, and compliance obligations. It is the
portfolio-risk layer for overdue/due-soon counts, evidence status, delegated
owner roles, fire/safety signals, and CSV/copy review packets. Do not duplicate
that roll-up in a new endpoint without a stronger product reason.

The durable recurring compliance register now exists at the backend/API layer:
checks with recurrence, owner role/assigned user, latest certificate/evidence,
current obligation linkage, completion audit/history, and roll-forward to the
next due obligation.

The operator-facing Work UI now exists at `/operations?tab=compliance`. It
combines recurring checks, linked compliance obligations, pending compliance /
inspection Smart Intake rows, and inspection-created work orders, and exports a
local review-only compliance CSV. Next compliance work should move toward
operator-approved completion/evidence actions or richer evidence detail, not
another read-only queue. Keep Smart Intake, comms candidates, and document
evidence linking compatible, but do not change their shipped behavior unless the
slice explicitly requires it.

### 2.12 Figma is the design source for core surfaces

Design starts in Figma, and the approved design lives there. Canonical file:
**"Leasium — Design Source of Truth"**, file key `PO2jOANgmqgZHfqWZXOZGU`.

- Pages: `01 Foundations` (tokens incl. Horizon additions), `02 Components`
  (incl. `Leasium/Horizon/*` approved components), `03 Screens` (the target
  design — Dashboard/Work desktop + mobile are the approved Horizon design;
  other screens are as-built captures), `04 Concept — Horizon` (archive +
  rationale).
- When implementing design-facing work on a surface that exists in `03
  Screens`, pull the target design from Figma via the Figma MCP
  (`get_design_context`, `get_screenshot`) instead of inferring style from
  existing code. Key node IDs are listed in
  `docs/design-governance.md` §Figma-First Design Stage.
- New design-facing slices: add/duplicate a frame in Figma first, get Temba's
  sign-off there, then implement against it.
- `docs/leasium-codex-design-source-of-truth.md` stays the token source of
  record; keep it and Figma `01 Foundations` in sync when tokens change.

---

## How these two sections interact

When section 1 (Karpathy) and section 2 (Leasium) overlap, Leasium
specifics win. For example: 1.2 says "minimum code that solves the
problem", but 2.1 mandates a review-first guardrail layer even when
that adds code — keep the guardrail.
