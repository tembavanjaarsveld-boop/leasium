# Codex brief — Relby AI: detect the trust from the document (drop the pre-pick)

Date: 2026-06-26
Author handoff: Temba → Codex (work delegated)
Status: ready to build

## Problem

On the Relby AI landing (`/intake`, rendered by `apps/web/src/components/dashboard.tsx`
in `mode === "intake"`), the **"Adding to <trust>"** picker forces the operator to
choose a single trust **before they can drop a file or ask**:

- The **Files** button is `disabled={!selectedEntityId || documentIntakeMutation.isPending}`.
- The **Ask** button is `disabled={landingAsking || !selectedEntityId}`.
- The drop handler bails on `!selectedEntityId`, and `documentIntakeMutation`
  posts `entityId: selectedEntityId`, so the upload is **bound to that pre-pick**.

This is the "bound at upload, not the lease's" pattern behind the recurring
wrong-trust imports (e.g. 1642 Anzac): the operator has to *guess* the trust
before the system has read the document that actually determines it. The lease
should drive the trust, not a manual guess.

## Desired behaviour

**Uploads:** the operator drops a lease/invoice/contract **without pre-picking a
trust**. The system reads it, detects the lease's trust, and the operator
**confirms or adjusts the trust in the review** before anything is applied. No
trust is committed to a real record until the review-first **Apply** step.

**Ask (chat):** the Ask flow stays entity-scoped (the backend builds answer
context from one trust's records — `apps/api/routers/ai.py` `POST /ask`). It
still needs a trust, so keep a trust affordance for Ask — but it must not gate
the file-drop path.

## What already exists (reuse it — do not rebuild)

Slice 4 of the Smart Intake trust-selection work already shipped the review-side
machinery:

- `apps/api/routers/document_intakes.py`
  - `_suggested_entity_id(intake, session)` — normalises the extracted trust
    name and matches it to an existing `Entity` in the **org**, returning the
    detected trust (or `None`). Surfaced as `DocumentIntakeRead.suggested_entity_id`.
    NOTE: it currently scopes the org via `intake.entity_id` → see backend change below.
  - Apply re-pointing: `DocumentIntakeApplyRequest.target_entity_id` (file under a
    chosen existing trust) and `create_entity_name` (mint a new trust on apply,
    provider-inert). `target_entity_id` wins; WRITE is enforced on the chosen trust.
- `IntakeConversationPanel` (`apps/web/src/components/intake/IntakeConversationPanel.tsx`)
  already renders a **"File under trust"** selector in the review that defaults to
  `suggested_entity_id` when accessible, with a "Create new trust…" inline option,
  and disables Approve until a trust is chosen.
- Cross-trust apply fix (`document_intakes.py`, commit `ab5909bc`): the
  conversation thread can be bound to one entity while the document files under
  another — already handled.

So the **review + apply** side is done. This brief is only about removing the
**pre-pick gate on the landing** and letting the trust be detected.

## Recommended approach — provisional entity at create, confirm at review (no schema change)

`DocumentIntake` / `StoredDocument` require a non-null `entity_id` (FK), and the
ask/thread/storage/audit paths are entity-scoped. A true "null-entity intake"
means a migration + touching every entity-scoped read — **out of scope / too
risky for this slice**. Instead:

1. **Frontend — ungate the file drop (`dashboard.tsx`):**
   - Remove `!selectedEntityId` from the **Files** button `disabled` and from the
     drop/`handleFile` guard.
   - On drop, resolve a **provisional** entity for the create call:
     `selectedEntityId` (if the operator did pick one or arrived via `?entity_id`),
     else the first accessible entity (`entitiesQuery.data?.[0]?.id`). The provisional
     entity is only a holding pen — it is **always in the operator's org**, so
     detection still works across every org trust.
   - Re-frame the **"Adding to <trust>"** control: it is no longer a required
     pre-pick. Either (a) hide it until after upload and show
     **"Filed under <detected/ provisional trust> — change"** in the review, or
     (b) keep it as an *optional* override that defaults empty ("Detect from the
     document"). Pick whichever reads cleaner; the review's File-under-trust
     selector remains the authoritative confirm.
   - After create + extract, route the operator into the review where
     `suggested_entity_id` defaults the File-under-trust selector (already built).
     The operator confirms; **Apply** re-points via `target_entity_id` if the
     detected/chosen trust differs from the provisional one.

2. **Backend — make detection independent of the pre-pick (`document_intakes.py`):**
   - `_suggested_entity_id` currently derives the org from `intake.entity_id`.
     That still works with a provisional entity (same org), but make it robust:
     scope the candidate `Entity` search by the **document's organisation via the
     requesting user** (the user is org-scoped) rather than assuming
     `intake.entity_id` is meaningful. This keeps detection correct even when the
     provisional entity is arbitrary.
   - No migration. No new endpoint. `entity_id` stays required on create; the
     provisional value is corrected on Apply (existing `target_entity_id`).

3. **Ask flow (`dashboard.tsx` `handleLandingAsk`):**
   - Keep Ask entity-scoped. If the file path no longer requires `selectedEntityId`,
     Ask still does — so either keep a small trust affordance for Ask, or default
     Ask to the first accessible trust with a visible, changeable
     "Asking about <trust>" label. Do **not** silently ask the wrong trust.
   - Clean up the now-stale TODO comment at `handleLandingAsk` ("surface a trust
     picker in the composer…") — the picker exists.

## Guardrails (non-negotiable — CLAUDE.md §2.1)

- **Review-first stays intact.** Detecting/ provisioning a trust must not mutate
  any real record. The trust is only committed to property/unit/tenant/lease/
  billing records at the existing **Apply** step, after the operator confirms.
- **No provider calls** anywhere in this flow (no Xero write, SendGrid, Twilio,
  tenant email, reconciliation). Upload + detect + review are local-only.
- The detected trust is a **default, never an auto-apply** — the operator must be
  able to see and change it before Apply.

## Tests / verification

- Backend (`tests/integration/test_document_intake_api.py`): a create with a
  provisional entity + a document whose extracted trust name matches a *different*
  org trust → `suggested_entity_id` returns the detected trust; Apply with
  `target_entity_id` files under it; access control still enforced (WRITE on the
  chosen trust). Keep the existing slice-1/4 tests green.
- Frontend smoke (`apps/web/tests/smoke/intake-conversation.spec.ts` +
  `app-flows.spec.ts` smart-intake specs): a file can be dropped on the landing
  **without** first choosing a trust; the review shows the detected
  "File under trust" default; Apply files under the confirmed trust. Update the
  fixture/mocks so the landing no longer requires a pre-pick.
- `eslint src` + `tsc --noEmit` clean; production `next build` clean.
- Backend `ruff` + `pytest tests/integration/test_document_intake_api.py` on Temba's
  Mac (the venv is Mac-only; the Cowork sandbox can run eslint/tsc but not pytest).

## Out of scope

- True null-entity intakes / schema migration (revisit only if the provisional
  approach proves leaky).
- The Ask flow's deeper "ask across all trusts" (org-wide answer context) — that's
  a separate backend change; this slice only stops Ask from sharing the file gate.
- The concurrent calendar-view-removal slice and the `people-hub` Owners-tab
  failure (both unrelated, untouched).

## Notes for Codex

- You are not alone in this tree. There is an **uncommitted calendar-view-removal
  slice** (property-workspace.tsx, properties/page.tsx, calendar.py, api.ts,
  api-mocks.ts, properties specs, docs). **Do not revert or sweep it** — stage
  only the files you change, by explicit path.
- Commit gmail-authored (`tembavanjaarsveld@gmail.com`) so Vercel deploys; terse
  imperative subject, no Claude/Codex attribution.
- This is a design-facing change (landing composer behaviour + copy) → run the
  in-loop UX gate (docs/design-governance.md) and log a UX-pass line.
