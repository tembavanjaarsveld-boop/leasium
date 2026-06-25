# Codex brief — Entity-as-dimension, backend last mile (2026-06-25)

**Owner:** Codex (backend + API client types only).
**Companion plan:** `docs/multi-entity-dimension-plan-2026-06-25.md` (read it first).
**Do NOT touch:** the entity switcher UI / page layouts — that's design-gated
(CLAUDE.md §2.2) and handled separately. You own API + `apps/web/src/lib/api.ts`
types only.

## Mission

Finish making `Entity` a pure *filterable dimension* on the backend. Most of this
is already done — the org-wide-by-default pattern, the `readable_entity_ids`
helper, and `tests/integration/test_org_wide_scope_api.py` already exist and cover
12 endpoints. Your job is the **last mile**: confirm every list/read endpoint is
org-wide-by-default or intentionally entity-scoped, add an org-wide read path for
the **two holdouts** (comms + work-assignment notification center), cover it with
tests, and expose the client types.

## Ground rules (read before writing code)

- **You are not alone in this codebase.** Temba commits the *same Mac working
  tree* concurrently. Before you start and after any pause: `git fetch` + check
  `git status --short` and `git diff --stat`. Run the **full** backend suite after
  any concurrent commit lands — a past incident swept an uncommitted router change
  into someone else's commit and broke prod for ~9 min. Never revert or "tidy"
  unrelated changes.
- **Surgical only** (§1.3). Every changed line traces to this brief. Match
  existing style. Don't refactor adjacent code. If you spot unrelated dead code,
  mention it — don't delete it.
- **TDD** (§1.4): write the failing test first, then make it pass. No completion
  claim without fresh test evidence.
- **§2.1 provider guardrail:** everything here is **read-only**. No Xero write,
  SendGrid email, Twilio SMS, or reconciliation. The org-wide aggregates must not
  trigger any provider call. Writes keep requiring `entity_id` in the body —
  leave them alone.
- **Commit style:** terse imperative subject, multi-line body listing files +
  why, one feature per commit, no Claude/Codex attribution lines.
- **git lockfile quirk:** if a `.git/index.lock` blocks a command, rename it
  (`mv .git/index.lock .git/index.lock.bak-<ts>`) and retry; commits land fine.

## The pattern to copy (don't invent a new one)

Helper — `stewart/core/auth.py:338`:
```python
def readable_entity_ids(session, user, allowed_roles) -> list[UUID]:
    # live entities in user's org where they hold an allowed role
```

Canonical list endpoint — `apps/api/routers/properties.py:36` (and tenants.py:251,
obligations.py:165, contractors.py:56):
```python
statement = select(Model)
if entity_id is not None:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = statement.where(Model.entity_id == entity_id)
else:
    statement = statement.where(
        Model.entity_id.in_(readable_entity_ids(session, user, READ_ROLES))
    )
```
Reference test harness — `tests/integration/test_org_wide_scope_api.py`
(`_seed_entity_records` seeds two entities; grants role on one; asserts org-wide
lists return only the readable entity's rows). Extend this file; don't fork it.

---

## Ticket B1 — Audit + close list/read stragglers

**Goal:** every `GET` list/read endpoint is org-wide-by-default *or* intentionally
entity-scoped, with no list endpoint hard-requiring `entity_id`.

**Steps:**
1. Enumerate `GET` routes across `apps/api/routers/*.py`. For each, classify:
   org-wide-default (✓), intentionally entity-scoped (write/action/sub-resource —
   leave), or **straggler** (a list/read that still requires `entity_id`).
   - Ignore internal helpers (`_property_for_entity`, `_validate_*`, `_send_*`,
     `_queue_candidates`) and the per-entity alias `list_premises_by_entity`
     (`properties.py:216`, delegates to org-wide `list_properties` — fine).
2. For each genuine straggler, apply the copy pattern above (optional `entity_id`,
   org-wide via `readable_entity_ids` when omitted).
3. Write/extend a failing test in `test_org_wide_scope_api.py` asserting the
   straggler returns the readable entity's rows and excludes the unreadable one.

**Done when:** no list/read endpoint requires `entity_id`; new assertions pass;
full suite green. **Deliver the audit table in the commit body** (route → verdict)
so the classification is reviewable.

## Ticket B2 — Org-wide read path for the two holdouts

These two pages still fan out client-side (they do **not** pass `orgWideQueryFn`):
- `comms/page.tsx` → queue candidates + outbound log
- `notifications/page.tsx` → work-assignment notification center

**Confirm-then-add:**
1. Read the existing per-entity implementations first
   (`apps/api/routers/comms.py` candidate/outbound builders incl.
   `_queue_candidates(entity_id, session)` ~line 3225; the notification-center
   reads in `apps/api/routers/work_assignment_notifications.py`).
2. If an org-wide path already exists (accepts `entity_id=None`), stop — just do
   B4. If not, add an org-wide read: when `entity_id` is omitted, aggregate across
   `readable_entity_ids(session, user, READ_ROLES)` in **one** request and return
   **entity-tagged** rows (each row carries `entity_id`, matching
   `EntityTaggedCandidate` / `EntityTaggedCommsEvent` /
   `WorkAssignmentNotificationCenterRecord` on the frontend).
3. These lists are *computed* per-entity (not a plain table select), so looping
   `readable_entity_ids` server-side is acceptable — the win is collapsing N HTTP
   round-trips into one and removing the concurrency cap. Keep it read-only.

**Done when:** `GET` with no `entity_id` returns aggregated, entity-tagged rows
for comms candidates, comms outbound log, and the notification center; explicit
`?entity_id=` still works and still checks the entity role.

## Ticket B3 — Tests

In `tests/integration/test_org_wide_scope_api.py` (and the comms/notification
test files if richer fixtures are needed):
1. Org-wide happy path for each B2 endpoint (two entities, role on one → only that
   entity's rows returned).
2. Explicit `?entity_id=<unreadable>` → 403 (role still enforced).
3. Any B1 straggler covered.

**Done when:**
`.venv/bin/python -m pytest tests/integration/test_org_wide_scope_api.py -q` green,
then full suite green.

## Ticket B4 — API client types

In `apps/web/src/lib/api.ts` add the org-wide read functions + response types the
holdout pages will call (mirror the existing org-wide client fns for
properties/tenants). **Types/functions only — do not edit page components or the
switcher.** That's Track B/C, design-gated.

**Done when:** `eslint src` and `tsc --noEmit` pass; the new fns are exported and
typed; no page/component files touched.

---

## Verification (run on Temba's Mac before claiming any ticket done)

Backend:
```
.venv/bin/python -m ruff check apps stewart tests scripts
.venv/bin/python -m pytest tests/integration/test_org_wide_scope_api.py -q
.venv/bin/python -m pytest -q          # full suite before the final commit
```
Frontend (api.ts only):
```
cd apps/web
./node_modules/.bin/eslint src
./node_modules/.bin/tsc --noEmit
```
After concurrent commits land: `git fetch`, re-run the full backend suite.

## Out of scope (hands off)

- The entity switcher UI, page layouts, row density, copy — design-gated (§2.2).
- Any new `Portfolio` table/grouping construct.
- Any change to write/posting entity scoping.
- Any provider send or Xero write.
- Deleting `useEntityFanOut` from pages (that's Track B, after B2/B4 land).

## Suggested commits

1. `Make <straggler list endpoints> org-wide by default` (B1 + tests).
2. `Add org-wide comms candidate/outbound reads` (B2 comms + tests).
3. `Add org-wide work notification center read` (B2 notifications + tests).
4. `Add org-wide comms/notification client types` (B4).
