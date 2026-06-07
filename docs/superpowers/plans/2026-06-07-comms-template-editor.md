# Comms branded-template editor UI (operator CRUD surface)

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `CLAUDE.md` at the repo root first. **Hard guardrail (§2.1): creating/editing/deleting a template must never send a message — no SendGrid/Twilio/dispatch call from any code path in this slice. Tests must trap and forbid send paths.** Do not run git commands until the final commit step; never push without the operator's go.

## Goal

The branded-communication-template backend already has full CRUD (commit `4b3aea9`,
`apps/api/routers/branded_templates.py`): POST creates an operator (`is_system=false`)
template with 409 on duplicate active `(entity, key, version)`; PATCH edits
name/subject/body/action/notes/is_active/metadata (key/version/channel/provider/entity are
immutable); DELETE soft-deletes, with 409 for system templates ("deactivate instead").
Write roles: owner/admin/finance. The frontend only has a read-only catalog. Build the
operator editor on `/comms`.

## Where things are

- Catalog UI: `apps/web/src/app/comms/page.tsx` (~1,910 lines), `TemplateCatalogPanel`
  around lines 1114–1240; catalog query at ~line 684
  (`["comms-template-catalog", selectedEntityId]` → `listBrandedCommunicationTemplates`),
  filtered to `is_active && !deleted_at` at ~line 763.
- API client: `apps/web/src/lib/api.ts` — `BrandedCommunicationTemplateRecord` (~line 105),
  `listBrandedCommunicationTemplates` (~line 4331, supports `includeInactive`). `ApiError`
  (~line 2920) already carries `status` + FastAPI `detail` as `message`.
- Reusable drawer: `apps/web/src/components/detail-drawer.tsx`. UI primitives in
  `apps/web/src/components/ui.tsx` (Field/Input/Select/Button/SecondaryButton/StatusBadge).
- Smoke fixtures: `apps/web/tests/smoke/api-mocks.ts` — `brandedCommunicationTemplates`
  fixture at ~line 884 (operator `branded-template-1` invoice_delivery + system
  `branded-template-2` maintenance_contractor_update); GET handler at ~line 8036. No
  mutation handlers yet.
- Existing specs to keep green: `apps/web/tests/smoke/comms-template-catalog.spec.ts`
  (rejects any non-GET once its export flow starts — do not add editor steps there) and
  `apps/web/tests/smoke/settings.spec.ts` (needs the GET shape preserved).

## Ticket 1 — api.ts helpers

- [ ] **Step 1:** In `apps/web/src/lib/api.ts` next to `listBrandedCommunicationTemplates`,
  add `BrandedCommunicationTemplateCreatePayload` / `...UpdatePayload` types mirroring
  `apps/api/schemas/branded_templates.py`, and `createBrandedCommunicationTemplate` (POST),
  `updateBrandedCommunicationTemplate` (PATCH `/{id}`), `deleteBrandedCommunicationTemplate`
  (DELETE `/{id}`) via the existing `request<BrandedCommunicationTemplateRecord>` helper.
  Verify: `tsc --noEmit`.

## Ticket 2 — red-first smoke spec + mocks

- [ ] **Step 1 (red):** New `apps/web/tests/smoke/comms-template-editor.spec.ts`. Register a
  whole-test forbidden watcher before navigation: any non-GET `/api/v1` request is recorded
  unless the path is `/branded-communication-templates` or
  `/branded-communication-templates/{id}`; explicitly trap `email|sms|sendgrid|twilio|
  dispatch|dismiss|notification-center|invoice` paths; assert the list is `[]` at test end.
  Tests: (a) create flow — "New template" → fill key/version/channel/provider/name/subject/
  body → save → new card visible + POST payload asserted; (b) edit flow — Edit on
  "SKJ invoice delivery" → change subject/body → save → card updates; (c) system guard —
  open "Contractor update default" → Delete absent/disabled with "deactivate instead" copy →
  Deactivate → drops from the active list; (d) duplicate create surfaces the backend 409
  detail string. Run it; it must fail because the buttons do not exist.
- [ ] **Step 2:** In `api-mocks.ts`, make the template fixture stateful (reset per
  `mockLeasiumApi` call, following the `tenantPortalNotificationPreferences` pattern at
  ~line 880) and add POST (201 append `is_system:false`; 409 + "An active template already
  exists for this key and version. Edit it or use a new version." on duplicate active),
  PATCH (merge editable fields, bump `updated_at`, 409 on reactivation conflict), DELETE
  (409 + "System templates cannot be deleted; deactivate them instead." when `is_system`,
  else soft-delete). Confirm `comms-template-catalog.spec.ts` and `settings.spec.ts` still
  pass.

## Ticket 3 — editor drawer component

- [ ] **Step 1:** New `apps/web/src/components/comms-template-editor-drawer.tsx` built on
  `DetailDrawer`. Props: `open`, `mode: "create" | "edit"`, `template`, `entityId`,
  `onClose`, `onSaved`. Edit mode: editable name/subject/body(textarea)/action label/action
  URL/notes/active toggle; key/version/channel/provider read-only. Create mode: key input
  with a datalist of known runtime keys (`invoice_delivery`,
  `maintenance_contractor_update`, work-notification keys — read them from the fixture/
  settings catalog) plus free text, version defaulting `v1`, channel Select
  (email/sms/in_app), provider Select defaulting by channel (sendgrid/twilio/in_app).
  Footer actions: Save; Deactivate/Reactivate; Delete behind a confirm step, hidden for
  `is_system` with the "deactivate instead" hint. Render `ApiError.message` inline for
  409/403. Mandatory footer note: "Editing or creating a template never sends a message;
  provider sends stay behind the review-first dispatch queue."

## Ticket 4 — wire into /comms

- [ ] **Step 1:** In `comms/page.tsx`: switch the catalog query to `includeInactive: true`
  but derive `activeTemplates` for the existing CSV export and the "N active templates"
  badge (the catalog spec asserts "2 active templates" — keep that true). Show inactive
  templates in a collapsed "Inactive" group or with an Inactive badge so they can be
  reactivated. Add drawer state + three `useMutation`s (create/update/delete) invalidating
  `["comms-template-catalog", selectedEntityId]`, an Edit button per card, and a
  "New template" button in the panel header (min-h-11 touch targets).
- [ ] **Step 2 (green):** Run the new spec until all tests pass; rerun
  `comms-template-catalog.spec.ts` + `settings.spec.ts`.

## Ticket 5 — docs + verification + commit

- [ ] **Step 1:** `docs/product-roadmap.md`: move the Communications hub templates item to
  reflect the shipped editor (`[~]`, prototype review pending). `docs/design-governance.md`:
  dated prototype-mode entry. `docs/next-chat-handover.md`: session section.
- [ ] **Step 2:** Full verification from `apps/web`: `eslint` on touched files,
  `tsc --noEmit`,
  `NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs
  ./node_modules/.bin/playwright test tests/smoke/comms-template-editor.spec.ts
  tests/smoke/comms-template-catalog.spec.ts tests/smoke/settings.spec.ts --workers=1`,
  and a production `next build`.
- [ ] **Step 3:** One commit (terse imperative subject, body listing files + why; no
  attribution lines). Push only with the operator's explicit go.

## Risks / notes

- `comms/page.tsx` is large — keep the drawer in its own component; do not host the editor
  in `settings/page.tsx`.
- No client-side role gating exists; render controls and surface the 403 detail inline.
- **Coordination:** `apps/web/tests/smoke/api-mocks.ts` is also being touched by the
  Portfolio QA enrichment slice in another session. If both are in flight, land this one
  first or expect a trivial merge in that file.
