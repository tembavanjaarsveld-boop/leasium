# Plan — People Hub + IA Refocus (DoorLoop benchmark P0)

Created: 2026-05-31
Owner: Temba (solo, commits direct to `main`)
Source: [`docs/doorloop-benchmark-2026-05-31.md`](../../doorloop-benchmark-2026-05-31.md)
Backlog: `docs/product-roadmap.md` → "DoorLoop benchmark refocus (2026-05-31)"

## Status — 2026-05-31 (shipped to prod)

- Ticket 1.1 (Owner + PropertyOwner models + migration `20260531_0029`): **SHIPPED** (`5685c90`).
- Ticket 1.4 (Owner CRUD API) + owner↔property link endpoints: **SHIPPED** (`5685c90`).
- Ticket 1.2 (idempotent backfill + `scripts.backfill_owners`): **SHIPPED** (`5685c90`).
- Ticket 1.3 (statement read-path cutover): **SHIPPED** — `/owners/statements`
  groups by `Owner`/`PropertyOwner`, with unlinked properties in an
  `Unattributed` fallback; parity test still guards the backfilled SKJ data.
- Ticket 2.1 (`/people` hub): **SHIPPED** (`d0bd122`) — Owners directory live; Tenants/Vendors now inline after Phase 3; Prospects stub.
- Ticket 2.2 (consistent people record-page shape): **SHIPPED pending Remba review** —
  Tenant, Owner, and Vendor records share one People record shell with the same
  Overview · Financials · Tasks · Notes · Files · Activity section links.
- Phase 3 (nav consolidation to 7 hubs): **SHIPPED pending Remba review** — sidebar is Dashboard · Smart Intake · Properties · People · Work · Money · Insights (+ Settings); `/money` hub added; Comms routes under Work; hub alias redirects added.
- P1 owner portal read-only first: **SHIPPED pending Remba review** (`b47b7a3`) —
  operator-preview `/api/v1/owner-portal/{owner_id}` and
  `/owner-portal/[ownerId]` use first-class Owner links plus existing statement
  totals; true owner account/login remains deferred.
- P1 vendor portal read-only foundations: **SHIPPED pending Remba review** —
  operator-preview `/api/v1/vendor-portal/{contractor_id}` and
  `/vendor-portal/[contractorId]` expose only explicitly vendor-visible work
  with no provider sends/writes and no vendor account/login yet.
- P1 vendor portal operator visibility controls: **SHIPPED pending Remba review** —
  maintenance work-order detail can share/hide a job from the read-only vendor
  portal with an explicit vendor-safe title and optional vendor-visible note;
  backend commands mutate local metadata/audit only.

Verified: P0 backend 344 passed / 1 skipped + ruff clean; frontend eslint/tsc + Vercel prod build green. Owner portal focused verification is tracked in `2026-05-31-owner-portal-readonly-first.md`. Migration applies on Render deploy; run `scripts.backfill_owners` to populate owners.

## Why this plan

DoorLoop's legibility comes from two spines — **Properties → Units** and one **People**
hub (Tenants · Owners · Vendors · later Prospects), tied by **Leases**. Leasium has the
data but not the structure: **Owner is not an entity** (it's 11 fields on `Property`),
people are scattered across Tenants / Contractors / Statements, and there's no Prospect
concept. This plan delivers the **P0 keystone** — make Owner a real entity, gather people
into one hub, consolidate the nav — which unlocks the owner portal, owner-level reporting,
and distributions (P1+). Net-new feature count is low; it's mostly a structural move.

## Iron laws (superpowers methodology — non-negotiable)

1. **No production code without a failing test first.** Each ticket starts red.
2. **No fix without a root cause.** No symptom-patching.
3. **No "done" without fresh evidence** — paste the passing test / lint / build output.
4. **Review-first guardrail holds** (`CLAUDE.md` §2.1): no Xero write, SendGrid, Twilio,
   tenant email, or payment reconciliation without explicit operator approval.
5. **Additive + reversible**: legacy Property owner-fields remain as backfill source
   fields; no destructive migration in this plan.
6. **Agent-first execution**: use agents wherever they can materially help with
   parallel reconnaissance, bounded implementation, or review/verification; keep
   immediate blockers local and verify every agent result before shipping.

## Tooling (Temba's Mac, via Desktop Commander)

- Backend: `.venv/bin/python -m pytest tests/integration/<file> -q`, `.venv/bin/python -m ruff check ...`, `.venv/bin/alembic upgrade head`.
- Frontend (in `apps/web`): `./node_modules/.bin/eslint src`, `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/playwright test`, production build with the bundled Next WASM dir.
- Frontend surfaces should run through the UI skills in `docs/external-skills/` (web-design-guidelines, composition-patterns, hallmark slop-test).

---

## Phase 1 — Owner as a first-class entity (the keystone)

### Ticket 1.1 — `Owner` + `PropertyOwner` models + migration
- **Red first:** `tests/integration/test_owner_api.py::test_owner_crud_and_property_link`
  — create an Owner, link two Properties with ownership splits (60/40), assert the link
  and split round-trip. (Write it before the model exists; it fails to import.)
- **Model** (`stewart/core/models.py`): `Owner` — `id`, `entity_id` (FK `Entity`),
  `legal_name`, `abn`, `trustee_name`, `trust_name`, `invoice_issuer_name`,
  `billing_contact_name`, `billing_email`, `invoice_reference`, `gst_registered: bool`,
  `xero_contact_id`, `owner_metadata: JSONB`, `created_at`/`updated_at`/`deleted_at`.
  Add `PropertyOwner` association (`property_id`, `owner_id`, `split_pct: Decimal`,
  unique on (property_id, owner_id)) to support shared ownership.
- **Migration:** new Alembic revision `2026053?_00??_owner_entity` — create both tables,
  FKs, indexes. **No data move yet.** SQLite-compat (mirror existing JSONB/IntArray compat).
- **Verify:** `alembic upgrade head` clean on a scratch DB; the red test goes green.

### Ticket 1.2 — Backfill owners from Property fields (idempotent data migration)
- **Red first:** `test_owner_backfill_dedupes_by_identity_tuple` — seed 3 properties, two
  sharing the same owner identity tuple (`owner_legal_name`+`trustee_name`+`trust_name`+
  `invoice_issuer_name`, case-folded); run backfill; assert 2 Owner rows, correct
  `PropertyOwner` links, `ownership_split` carried into `split_pct`.
- **Implementation:** a guarded backfill (management script or migration data step) that
  groups existing properties on the same owner-identity tuple the statement compiler uses
  today, creates one Owner per group, links properties, copies `ownership_split`. Idempotent
  (re-run = no dupes). Unattributed properties → no Owner link (skip, don't invent).
- **Verify:** run on a seeded copy of the SKJ import; row counts match distinct owners.

### Ticket 1.3 — Owner-statement read path cutover at parity
- **Red first:** `test_owner_statements_parity_owner_entity_vs_legacy_tuple` — for the
  seeded month, statements computed from `Owner` rows == statements computed from the
  legacy property-tuple grouping (same owners, same property lines, same totals).
- **Implementation:** shipped. `/api/v1/owners/statements` now reads from
  `Owner`/`PropertyOwner` while leaving the legacy fields intact as backfill
  source only. Dispatch/PDF behaviour and the no-send guardrail stayed unchanged.
- **Follow-up:** split-aware allocation is deliberately out of scope for this
  grouping cutover. Before shared-ownership statements are used in production,
  add a separate ticket to apply `PropertyOwner.split_pct` to property-line and
  owner totals.
- **Verify:** parity test green; existing `test_owner_statements*` still pass.

### Ticket 1.4 — Owner CRUD API + minimal Owner detail
- **Red first:** API tests for list/create/patch/soft-delete `/api/v1/owners` with
  entity-role auth (happy path + 403 path).
- **Implementation:** router + schemas mirroring the contractor/tenant pattern. Owner detail
  returns linked properties + computed portfolio totals (read-only).
- **Verify:** backend tests green; ruff clean.

---

## Phase 2 — People hub IA

### Ticket 2.1 — `/people` surface with Tenants · Owners · Vendors (+ Prospects stub)
- **Red first:** Playwright smoke `apps/web/tests/smoke/people-hub.spec.ts` — `/people`
  renders 4 tabs; default tab = Tenants; switching to Owners lists owners with property
  counts; switching to Vendors lists contractors; Prospects shows a "coming soon" stub.
- **Implementation:** new route reusing the existing Tenants list and Contractors list
  components; new Owners directory bound to `/api/v1/owners`. Tab state in the URL
  (`?tab=owners`) matching the existing URL-filter pattern.
- **Verify:** smoke green; `eslint`/`tsc` clean.

### Ticket 2.2 — Consistent people record-page shape
- **Status:** Shipped pending Remba review. `PeopleRecordLayout` now wraps the tenant
  detail page and powers new `/owners/[ownerId]` and `/contractors/[contractorId]`
  detail routes. `/people` inline rows link into those records, People owns `/owners`
  in the sidebar, and vendor detail recovers if a stale selected entity points at the
  wrong contractor list.
- **Red first:** smoke asserts Tenant, Owner, and Vendor detail pages all expose the same
  tab set (Overview / Financials / Tasks / Notes / Files / Activity) in the same order.
- **Implementation:** extract a shared `PeopleRecordLayout` (header → tabs → actions);
  adopt it on tenant detail, the new owner detail, and contractor detail. Don't rebuild the
  inner panels — wrap the existing ones.
- **Verify:** smoke green; adjacent People/nav smoke green; `eslint`, `tsc`, and
  production-style `next build` green. Review agents checked spec and React/App Router
  risks; P1/P2 functional findings were fixed.

---

## Phase 3 — Navigation consolidation to 7 hubs

### Ticket 3.1 — Sidebar → Dashboard · Smart Intake · Properties · People · Work · Money · Insights (+ Settings)
- **Status:** Shipped pending Remba review. Smoke `apps/web/tests/smoke/nav-consolidation.spec.ts`
  guards the seven-hub sidebar, inline People tabs, Money hub, and legacy finance
  links. Existing heavy workspaces remain reachable while the hubs become the
  primary IA.
- **Red first:** smoke asserts the sidebar shows exactly 7 primary items + Settings, that
  **People** and **Money** hubs navigate, and that legacy deep links (`/tenants`,
  `/contractors`, `/statements`, `/billing-readiness`) still resolve (redirect or hub
  sub-route).
- **Implementation:** update `apps/web/src/components/app-shell.tsx` nav, `SHORTCUT_NAV`,
  and `commandActions`. **Money** = Billing · Invoices · Owner statements · Xero · Bank
  feeds; **Work** absorbs Comms. Keep palette-only destinations for anything past the cap
  (§10.5.1). Add redirects for moved routes so bookmarks/G-shortcuts don't break.
- **Verify:** smoke green; `tsc`/`eslint`/production build clean. Update design source of
  truth §11 "shipped" block once this lands.

---

## P1 preview (after P0 lands — separate plan)

- **Owner portal (read-only first):** first operator-preview slice shipped:
  owner identity, linked properties/splits, monthly statement totals and
  statement property lines, with no-send/no-provider guardrails. Next slice
  should add proper owner account/token auth before this becomes a public owner
  login surface.
- **Tenant self-serve payments (AU rails):** PayTo / PayID / BPAY / direct debit; pay
  in-portal, reconcile review-first via the existing Basiq/Xero engine.
- **Vendor portal (read-only first):** operator-preview slice shipped for safe
  work visibility, and operators can now explicitly share/hide maintenance
  work orders from that preview. Next vendor step is auth/invite design, not
  email/SMS or provider dispatch.
- **Installable PWA** for operator field use + tenant portal on a phone.

## Definition of done for P0

- Owner is a queryable entity with property links + splits; backfill verified on the SKJ
  import; owner statements at parity from the new read path.
- `/people` hub live with 4 tabs and one consistent record-page shape.
- Sidebar at 7 hubs; no broken deep links; design source of truth §11 "shipped" updated.
- Every ticket landed test-first with pasted green evidence; review-first guardrails intact.
