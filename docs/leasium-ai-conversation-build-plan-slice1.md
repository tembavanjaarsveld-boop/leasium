# Leasium AI conversation-first — Build plan, Slice 1

Date 2026-06-15. Concept + Figma: `docs/leasium-ai-conversation-redesign-2026-06-15.md`
(file `PO2jOANgmqgZHfqWZXOZGU`, frames on 01 Foundations x≈11200).

## Decisions (defaults, Temba to override)
- Proposal card IS the confirmation: "Create all records" → inline "Creating…"
  → success turn + undo toast. No extra modal.
- ⌘K is a contextual launcher in v1; cross-page thread history is later.

## Strategy
The backend already does the work. `POST /document-intakes/{id}/apply`
(api: `applyDocumentIntake`) creates Property + Unit(s) + Tenant + Lease +
Obligations from `review_data`, links existing records when ids are passed,
attaches provenance, and fires **no provider mutation**. `askLeasium` answers
questions read-only. So Slice 1 is a **frontend rebuild only** — no API or
schema change. Guardrails are inherited.

## Slice 1 scope (frontend)
Replace the inline document-review detail panel in `/intake`
(`apps/web/src/components/dashboard.tsx`, mode="intake") with a new
conversation-first panel. Keep the existing upload area + review queue.

New component `apps/web/src/components/intake/IntakeConversationPanel.tsx`:
1. **Thread** of the selected `DocumentIntakeRecord`.
2. **Understanding card** built from `extracted_data` (summary + parties /
   properties / key_dates / money_amounts / obligations) with confidence
   badges (HIGH/MED/LOW from `confidence`) and source hints; surface
   `warnings` as amber flags.
3. **Bundled plan card** mapping the extraction → the apply payload:
   Property, Unit(s), Tenant, Lease (+ optional obligations/critical dates),
   each "Create new" or "Link existing". One primary **Create all records** →
   `applyDocumentIntake(intakeId, { reviewData, propertyId?, tenancyUnitId?,
   tenantId?, leaseId? })`.
4. **Created turn** from the apply response (`review_data.applied`): list
   created/linked records, then a **Suggested next steps** card (Sync to Xero,
   Set up rent invoicing, Email tenant) each marked NEEDS APPROVAL — these are
   links to existing gated flows, they do NOT call providers here.
5. **Provider-gate note** (teal) and a **reply composer** wired to
   `askLeasium({ entity_id, question })` for same-thread Q&A.
6. Paid/zero-record documents (e.g. paid invoice): show understanding +
   "file as record / attach / ignore" using the existing apply/ai-session
   endpoints; never imply a provider action.

Build to the Horizon tokens + the Figma frames. Reuse `ui.tsx` primitives.

## Non-goals (later slices)
- Centered global composer Home; global ⌘K agent thread; backend conversation
  model; inline value editing depth; mobile-specific layout polish.

## Verification (iron law: fresh evidence before "done")
- `eslint` + `tsc --noEmit` on touched files (sandbox WASM or DC).
- Smoke: extend `apps/web/tests/smoke` with a spec that opens an intake,
  asserts the understanding + plan render, clicks Create all → asserts
  `applyDocumentIntake` called, and asserts NO provider/xero/email/sms/payment
  calls fire. Run with `NODE_ENV=development`.
- Production `next build`.
- Screenshots at 1440 + 390; run the slop test; fix in-slice.
- pytest/ruff unaffected (no backend change) — confirm a green run on Temba's
  Mac via Desktop Commander before commit.
- Commit on Temba's go, gmail author; update roadmap + design-governance UX log.
