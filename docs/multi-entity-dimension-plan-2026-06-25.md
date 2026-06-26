# Entity as a filterable dimension (not a hard switcher) — build plan (2026-06-25)

## Decision

Keep `Entity` as the legal/accounting object (one Xero org per entity — an ATO
requirement, unchanged). **Stop presenting it as a mode you switch *into*.**
Present the portfolio as one unified workspace where the entity is a *filterable
dimension* (a tag/chip), defaulting to "All entities", with single-entity as an
optional drill-down — not a required selection.

Backs onto `docs/multi-entity-xero-ia.md` (which already called the cross-entity
rollup "the payoff") and `docs/account-operating-mode-ia.md` (self-managed owner
sees a unified portfolio; the hard-isolation case is the future managing-agent
mode, where entities are *different clients*).

External research (2026-06-25, switcher-vs-unified): the two closest analogs both
vote unified-with-filter — **Re-Leased** (one Xero org per entity, exactly our
setup, defaults to an "All Companies" view) and **Stessa** (self-managing owner,
multiple trusts/LLCs, combined dashboard by default). **Slack** rebuilt away from
a workspace-per-segment switcher to unified-with-filter at great cost. **Xero's**
own refusal to offer a cross-org view (13 years, ~267 votes, a third-party
consolidation industry) is the cautionary tale, not the pattern to copy.

**Scope decision (confirmed with Temba):** full backend sweep (not a pilot);
**Entity-as-filter only** — no new `Portfolio` table; Codex owns the **backend +
API client types**, the switcher→filter **UI is design-gated** (§2.2).

## Surprising current state — read this before planning work

The backend has **already largely converged on entity-as-dimension.** This is a
finish-the-last-mile + flip-the-frontend-default job, not a 37-router rewrite.
Evidence in-tree today:

- **Shared helper exists:** `readable_entity_ids(session, user, roles)` —
  `stewart/core/auth.py:338`. Resolves "all live entities in the org the user can
  read" for org-wide queries.
- **12 list endpoints already default org-wide** when `entity_id` is omitted, and
  are locked in by `tests/integration/test_org_wide_scope_api.py`: properties,
  tenants, contractors, rent-roll, obligations, tenant-onboarding,
  document-intakes, compliance/checks, arrears/cases, maintenance/work-orders,
  billing-drafts, invoice-drafts. Pattern (from `properties.py:36`):
  ```python
  if entity_id is not None:
      assert_entity_role(session, user, entity_id, READ_ROLES)
      statement = statement.where(Property.entity_id == entity_id)
  else:
      statement = statement.where(
          Property.entity_id.in_(readable_entity_ids(session, user, READ_ROLES))
      )
  ```
- **Responses are already entity-tagged:** `TenantRead`, `PropertyRead`,
  `MaintenanceWorkOrderRead`, `ArrearsCaseRead` etc. all carry `entity_id`. No
  schema changes needed for tagging.
- **Writes already take `entity_id` in the body** and validate via
  `assert_entity_role` (e.g. `tenants.py:267`, `arrears.py:323`). Correct — entity
  stays mandatory at write time. Leave these alone.
- **7 of 9 fan-out pages already issue ONE org-wide call** in all-entities mode
  (they pass `orgWideQueryFn` to `useEntityFanOut`): dashboard, operations,
  tenants, people, contractors, billing-readiness, portfolio-qa.

So the per-entity pain is now concentrated in **two backend/data holdouts and the
frontend default**, not the data model.

## What's actually left

### Track A — Backend last mile  →  Codex (`docs/codex-brief-entity-dimension-backend-2026-06-25.md`)

1. **Audit + close stragglers.** Walk every router; confirm each *list/read*
   endpoint is either org-wide-by-default or *intentionally* entity-scoped
   (writes, actions, sub-resource fetches). Flip any genuine list endpoint that
   still hard-requires `entity_id`. (Most `entity_id: UUID` grep hits are internal
   helpers/validators/writes — correct as-is.)
2. **Add org-wide read path for the two holdouts** that still fan out
   client-side: **comms** (queue candidates + outbound log) and the
   **work-assignment notification center**. Confirm-then-add: if an org-wide path
   already exists, just wire types; if not, aggregate across
   `readable_entity_ids` server-side in one request. Read-only — no provider
   calls, §2.1 untouched.
3. **Extend `test_org_wide_scope_api.py`** to cover the holdouts + any flipped
   straggler, plus the "explicit `?entity_id=` still checks entity role" path.
4. **API client types** (`apps/web/src/lib/api.ts`): add the org-wide read
   functions/types the holdout pages will call.

### Track B — Frontend fan-out removal (small, mechanical, low design risk)

Wire `comms/page.tsx` and `notifications/page.tsx` to the new org-wide single
call; drop their `useEntityFanOut` usage; keep rows entity-tagged. This deletes
the last client-side N-request fan-out (the `MAX_CONCURRENT_FAN_OUT_REQUESTS = 6`
cap and its 30s-tail history). Not design-facing beyond data wiring — but if row
density/labels change, it goes through Track C's gate.

### Track C — Switcher → filter (DESIGN-GATED, §2.2 — the real UX shift)

This is the piece that actually resolves Temba's "more troublesome than helpful":

- **Default everywhere to All entities (portfolio).** `defaultEntitySelection`
  already does this for multi-entity orgs; make the *picker* read as an optional
  filter chip/pin, not a context you're locked into.
- **Entity becomes an optional persistent filter** (a pin you can set and clear),
  not a required selection that gates the page.
- **Inline entity attribution at every write/data-entry point** — "Adding to
  *[Entity]* — change?" on create forms, Smart Intake apply, etc. This is the fix
  for the recurring wrong-trust import (the data-entry twin of "which workspace am
  I in?"); see `docs/smart-intake-trust-selection-2026-06-25.md`.
- **Keep entity-scoped surfaces scoped** where it's *correct*: Xero connect, tax,
  entity statements, posting previews ("posts to *[Entity]*'s Xero").

Figma-first per §2.2: add/duplicate the affected frames in the Design Source of
Truth, get Temba's sign-off, build to spec, run the same-session UX pass
(checklist + 1440/390 screenshots + slop test), log a UX Pass Log line in
`docs/design-governance.md`.

## Guardrails preserved

- **§2.1 provider mutation:** entity stays mandatory at write/posting; the new
  org-wide reads mutate nothing and call no provider. No Xero/SendGrid/Twilio
  behaviour changes.
- **§2.2 UX gate:** Track C is design-gated; Tracks A/B are not design-facing
  (data/types/wiring) beyond any visible density change, which defers to C.
- **Xero per-entity, operating-mode, Entity≠Owner≠owner-label** semantics all
  unchanged. No `Portfolio` table.

## Explicitly NOT doing

- No new `Portfolio` grouping construct (Entity-as-filter only).
- No removal/merging of entities.
- No change to write/posting entity scoping.
- No provider-send changes.

## Verification (per track, Temba's tooling)

Backend (Temba's Mac / Codex):
```
.venv/bin/python -m ruff check apps stewart tests scripts
.venv/bin/python -m pytest tests/integration/test_org_wide_scope_api.py -q
.venv/bin/python -m pytest -q   # full suite before claiming done
```
Frontend (sandbox or Mac):
```
./node_modules/.bin/eslint src
./node_modules/.bin/tsc --noEmit
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test
```

## Status

Plan recorded 2026-06-25. **SHIPPED — verified 2026-06-27:** Track A in `2218e6e`
(backend org-wide reads + B1 audit table + `test_org_wide_scope_api.py`) and
`10a4252` (API types); Track B in `10a4252` (comms + notifications wired to the
org-wide single call); Track C (switcher → filterable trust tag) across `99b308f`/
`beab8a9`/`31f31d1`/`91527d6` (trust-tag filters), `aeeefb5` (Dashboard org-wide,
no switcher), and `d617c2d` (remove global trust pills). The earlier "Track C is
design-gated / pending" note is stale — it shipped.
