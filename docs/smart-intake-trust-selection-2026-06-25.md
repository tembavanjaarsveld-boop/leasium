# Smart Intake — trust selection at import (confirm / pick / create)

Status: PROPOSED (design, 2026-06-25). Author: pairing with Temba.
Goal: stop lease imports silently filing under the wrong trust, and let an
import land under a brand-new trust without a separate create-then-reassign
dance.

## Problem

The trust an import files under is **locked at upload time**, not chosen from
the lease:

- Upload (`POST /document-intakes`, `documents.py upload_document`) stamps the
  document with `entity_id` = whatever trust is selected in the picker.
- Apply (`POST /document-intakes/{id}/apply`) creates the property / unit /
  lease / tenant under `document.entity_id` (documents.py ~L379), and the
  link helpers (`_property_for_entity`, etc.) **reject** linking a record that
  lives under a different trust.
- The intake match pool is entity-scoped: `listProperties(entityId)` /
  `listTenants(entityId)` (IntakeConversationPanel L707/713) — so it can't even
  see a matching property under another trust.
- The lease's lessor/trust IS extracted (`trust_name` in `lease_intake.py` /
  `document_intake.py`) but only as a **text label** on the property — never
  mapped to an Entity, never used to pick/create one.

Result: every import lands under the selected trust (defaults to the first/
oldest, SJI No 1). Real cases hit this twice on 1642 Anzac Avenue (T004 lease
under SJI No 1 instead of the existing North Lakes under SJI No 5; then T003
the same way). Brand-new trusts aren't handled at all.

## The better way (Temba's idea)

1. **Relby AI runs org-wide.** The intake hero isn't pre-bound to one trust;
   matching looks across all trusts.
2. **Confirm-or-create trust on import.** The review step shows a "File under
   trust" selector, pre-filled with the trust detected from the lease
   (`trust_name` matched to an Entity). The operator can confirm it, pick a
   different existing trust, or **create a new trust** inline — then everything
   files under that choice.

This makes the trust an explicit, reviewed decision (consistent with the
review-first guardrail) and covers existing-other-trust AND new-trust in one
move.

## Design

### Backend (`document_intakes` apply + schemas)
- Apply accepts an optional **`target_entity_id`** plus an optional
  **`create_entity`** payload (`{ name }`) for a new trust.
- Filing entity = `target_entity_id` if given, else `document.entity_id`
  (keeps current behaviour as the default — additive, safe).
- If `create_entity`: create the `Entity` first (review-first, provider-inert —
  a new trust starts unconnected to Xero), then file under it.
- Auth: `assert_entity_role(user, target_entity_id, WRITE_ROLES)`; creating a
  new entity requires the org/platform-admin role (see platform-admin-tier).
- Re-point `document.entity_id` to the chosen trust on apply so document +
  records stay consistent (auth-checked on both source and target).
- Link helpers operate against the **target** entity, not the upload one.
- Add a trust suggestion: normalise-match extracted `trust_name` to an existing
  Entity; return `suggested_entity_id` on the review/extract response.

### Frontend (`IntakeConversationPanel`, intake hero, `api.ts`)
- Match pool org-wide: `listProperties()` / `listTenants()` for matching +
  the manual picker (so a cross-trust match is visible).
- New **"File under trust"** selector in the review: options = all entities +
  "Create new trust…"; default = `suggested_entity_id` (from the lease) else
  current selection.
- Pass `target_entity_id` (+ new-trust name) to `applyDocumentIntake`.
- Relby AI hero defaults to the org-wide ("All entities") context so import
  isn't pre-bound to one trust.

### Edge cases
- Detected trust matches an existing Entity → default-select, operator confirms.
- Detected trust matches nothing → offer "Create '<trust_name>'" pre-filled.
- No trust detected → default to current selection; selector still required
  before Apply.
- Linked property lives under a different trust than selected → the chosen
  target governs; warn if the link and target disagree.
- New trust: Xero unconnected, owner/billing empty — surfaced as normal
  readiness gaps, nothing auto-sent.

### Tests (§2.8)
- Backend: apply with `target_entity_id` ≠ document entity (files under
  target); apply with `create_entity` (new trust then files); auth denial on a
  target without role; link a property under the target; default path
  unchanged when no target given.
- Frontend smoke: review shows the selector, defaults to the detected trust,
  create-new path, Apply posts `target_entity_id`.

### Rollout
- Review-first throughout; Apply stays the single reviewed write (no Xero/
  SendGrid/Twilio). Ship behind a flag if you want a staged cutover.
- Design-facing (new selector) → UX gate: Figma frame or in-loop UX pass at
  1440/390 before "done".

## Build slices (each ships independently, verified)
1. **Backend foundation** — apply accepts `target_entity_id`; files + links
   under it; default unchanged; tests. (No new-entity yet.)
2. **Create-trust-on-import** — `create_entity` payload + auth; tests.
3. **Trust detection** — match `trust_name` → `suggested_entity_id` on review.
4. **Frontend selector** — org-wide match pool + "File under trust"
   (confirm/pick/create) wired to apply; smoke + UX pass.
5. **Relby AI org-wide default** — hero defaults to all-entities context.

## Related
- Immediate workaround until shipped: select the correct trust before dropping
  the lease (the doc binds at upload).
- Pairs with the reassignment engine (1164cac) for cleaning existing mis-files.
- Warning-only stopgap (flag cross-trust match in review) can ship ahead of the
  full flow if a fast win is wanted.
