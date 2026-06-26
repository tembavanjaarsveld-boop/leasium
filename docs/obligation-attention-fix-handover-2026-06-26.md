# Handover — Lease Attention "Tenancy unit not found" fix (2026-06-26)

## Shipped (pushed to main)
Commit `3aecbf5` — *Fix obligation status update 404 on soft-deleted unit*. Backend-only, gmail-authored, pushed to `origin/main`. Render will auto-deploy (no migration).

**Root cause:** Complete/Waive on the property Lease Attention panel sends a status-only PATCH, but `update_obligation` re-ran full scope validation against the *stored* `tenancy_unit_id`/`lease_id`. When that unit had been soft-deleted (wrong-trust dedup left the ref dangling — e.g. 1642 Anzac), `_unit_for_access` 404'd `"Tenancy unit not found."`, making overdue items un-clearable. The LIST endpoint doesn't validate units, so rows still render — hence "shows 6 of 18" but nothing clears.

**Fix:** `apps/api/routers/obligations.py` `update_obligation` now only calls `_validate_obligation_scope` when the PATCH actually contains a scope key (`entity_id`/`property_id`/`tenancy_unit_id`/`lease_id`). Status/notes/priority edits skip the unit/lease re-check. Write access is still enforced by `_get_obligation_for_user` (`assert_entity_role` on the obligation's entity); scope-changing PATCHes still validate fully.

**Verified:** ruff clean; `tests/integration/test_register_api.py` 26 passed (incl. new `test_status_update_succeeds_when_obligation_unit_soft_deleted`); full integration suite 701 passed, 1 pre-existing skip. Tests use in-memory SQLite (`tests/conftest.py`) so no local Postgres needed (local PG was down this session).

**Operational upshot:** once Render redeploys, the stuck 1642 Anzac items clear straight from the Attention panel — no data migration required.

## Open follow-ups (not done)
1. **UX — mislocated error.** The Complete/Waive (`updateObligationMutation`) error renders down in the Quick date `<form>`, not at the row. `apps/web/src/components/property-workspace.tsx`: buttons ~L5704–5733; error block ~L5851–5855. Move `updateObligationMutation.error` next to the Attention rows. Design-facing → run the in-loop UX gate (1440/390 screenshots + slop test, log in `docs/design-governance.md`).
2. **Prevention — orphaned obligations.** When dedup/reassignment soft-deletes a tenancy unit, obligations still point at it. `stewart/domain/entity_reassignment.py` only re-points obligations across *live* units (~L227, L242–255). Decide policy: when a unit is soft-deleted, re-point its obligations to the surviving unit/property or soft-delete them too. Check other unit soft-delete sites (property delete cascade in `apps/api/routers/properties.py`).
3. **Optional data tidy.** Read-only diagnostic at `outputs/check_orphan_obligations.py` lists which 1642 Anzac obligations reference a dead unit — run against Neon (`DATABASE_URL=<neon> .venv/bin/python ...`). Likely unnecessary now that the UI can clear them.

## Conventions (Leasium)
- Commits land directly on `main`, **gmail-authored** (`tembavanjaarsveld@gmail.com`) — skjcapital.com author blocks the Vercel deploy. Terse imperative subject, body lists files + why, no Claude/Codex attribution, no co-authors.
- Backend ruff/pytest run only on Temba's Mac venv (`.venv/bin/python -m ruff|pytest`); frontend eslint/tsc/build in sandbox. Stage only intended files — working tree carries unrelated unstaged work (`apps/web/tests/smoke/people-hub.spec.ts`) and untracked junk (`.fuse_hidden*`).
- Provider guardrail: no Xero write / SendGrid / Twilio / payment reconciliation without explicit operator approval.
