# Leasium Next Chat Handover

Last updated: 2026-05-31

## Codex continuation — 2026-05-31 (latest)

Continuation from the Codex takeover. Branch `main` was current at `b7ec1f7`
before the Ticket 2.2 slice.

### Prod checks completed
- Render health endpoint is serving `d2e590798e09c89bee402c81c2600efce5148946`
  with `source=render`.
- Live OpenAPI includes `/api/v1/owners`, `/api/v1/owners/{owner_id}`,
  `/api/v1/owners/{owner_id}/properties`, and `/api/v1/owners/statements`.
- Neon production project `snowy-boat-02653440` is at Alembic
  `20260531_0029`; `owner` and `property_owner` tables exist.
- Prod owner backfill was run additively through Neon: **17 owners** and
  **20 property_owner links** for **20 active properties**. A second idempotence
  run created `0` owners and `0` links.
- Local backfill could not run in this desktop session because Docker is not
  installed and local Postgres on `localhost:5432` refused connections. Run
  `.venv/bin/python -m scripts.backfill_owners` locally once the DB is up.

### Phase 3 slice
- Sidebar consolidated to 7 primary hubs + Settings:
  Dashboard · Smart Intake · Properties · People · Work · Money · Insights.
- `/people` now has Tenants and Vendors inline instead of link-out actions;
  Owners remains backed by `/api/v1/owners`; Prospects remains a stub.
- New `/money` hub groups Billing · Statements · Xero · Basiq with review-first
  handoffs to the existing finance workspaces.
- Work is active for `/comms`, and hub alias redirects were added:
  `/people/tenants`, `/people/vendors`, `/work`, `/work/comms`,
  `/money/billing`, `/money/statements`, `/money/xero`, `/money/basiq`.
- Existing heavy workspaces (`/tenants`, `/contractors`, `/billing-readiness`,
  `/statements`, `/comms`) remain reachable for deep links and detailed work.
- New smoke: `apps/web/tests/smoke/nav-consolidation.spec.ts`.

### Verification for this slice
- Red-green: `./node_modules/.bin/playwright test tests/smoke/nav-consolidation.spec.ts --workers=1`
  failed first for missing People/Money/inline tabs, then passed **3 passed**.
- Adjacent smokes:
  `people-hub.spec.ts` + dashboard entity bootstrap **2 passed**; app-shell
  command/comms/shortcut checks **3 passed**.
- Frontend checks: focused `eslint` clean, `./node_modules/.bin/tsc --noEmit`
  clean, `git diff --check` clean, production-style
  `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  succeeded.

### Ticket 1.3 slice
- `/api/v1/owners/statements` now groups statement buckets from
  `Owner`/`PropertyOwner` links instead of the legacy `Property.owner_*`
  identity tuple. Legacy fields remain as a backfill source only. Code commit:
  `d1822ef`.
- Properties with no active `PropertyOwner` link remain visible under a single
  `Unattributed` statement bucket, even when legacy owner text is still present
  on the property.
- Distinct Owner rows that share the same display label now get disambiguated
  statement identities so PDF download and dispatch review can target each one.
- Statement PDF, ZIP pack, dispatch receipt, SendGrid guardrail, and no-provider
  mutation behaviour were left unchanged.
- Agent-first operating rule is now recorded in `CLAUDE.md`, this handover, and
  the active superpowers plan.
- Red-green proof:
  `test_owner_statements_group_by_owner_entity_not_legacy_tuple` and
  `test_owner_statements_unattributed_bucket` failed under the legacy grouping,
  then passed after the cutover.
- Verification:
  `tests/integration/test_owner_statement_parity.py tests/integration/test_owners_api.py`
  passed **18 passed**; owner-adjacent integration slice passed **30 passed**;
  targeted `ruff check` passed; full backend integration passed **346 passed /
  1 skipped**.
- Deployment verification: Vercel production deploy for `d1822ef` is **READY**
  on `leasium.ai`; Render health reports
  `d1822ef99e5c357a8fbcdc9b7418283a8f0c0fe2` from `api.leasium.ai`.

### Ticket 2.2 slice
- Tenant, Owner, and Vendor detail records now share the same People record
  shell: header/actions plus Overview · Financials · Tasks · Notes · Files ·
  Activity section links.
- Code commit: `aa4374b` (`Align people record pages`).
- New shared component: `apps/web/src/components/people-record-layout.tsx`.
  The links are plain in-page anchors, not ARIA tab widgets.
- Tenant detail keeps its existing inner panels and now exposes stable section
  anchors for the shared shell.
- New detail routes:
  `/owners/[ownerId]` reads `getOwner(ownerId)` and stays read-only/provider-safe;
  `/contractors/[contractorId]` reads contractor lists across entities and repairs
  stale selected-entity state before showing a vendor record.
- `/people` inline Tenant/Owner/Vendor rows now link into their records, and the
  sidebar marks `/owners/*` as part of People.
- Review agents found two functional issues before commit: missing tenant anchor
  targets and stale-entity vendor lookup. Both are now covered in
  `apps/web/tests/smoke/people-record-layout.spec.ts`.
- Later follow-up resolved: owner and vendor detail pages now use the shared
  `ApiError` status contract for calm record-level 404 states; see the slices
  below.
- Verification:
  `people-record-layout.spec.ts` passed **4 passed**; adjacent
  `people-hub.spec.ts` + `nav-consolidation.spec.ts` passed **8 passed**;
  targeted `eslint` clean; `./node_modules/.bin/tsc --noEmit` clean;
  production-style
  `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  succeeded.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_A7xtmu8hdZ3ftHpi7hegNd2ohXyA` for `aa4374b` was **READY** and aliased to
  `leasium.ai`; `https://leasium.ai` returned HTTP 200; Render health reported
  `aa4374b9cc05d52582aab57884b2d43a33e8410d` with `source=render`.

### Owner portal read-only first slice
- First owner portal slice is shipped. Code commit: `b47b7a3`
  (`Add read-only owner portal preview`).
- Backend: new `GET /api/v1/owner-portal/{owner_id}?month=YYYY-MM` returns a
  read-only `operator_preview` payload scoped by the signed-in operator's
  entity role. It uses first-class `Owner` / `PropertyOwner` links and the
  existing owner-statement roll-up for monthly totals and property lines.
- Frontend: new `/owner-portal/[ownerId]?month=YYYY-MM` portal-style route
  renders owner identity, billing contact/email, linked property splits,
  statement KPIs, statement property lines, and access-boundary guardrails.
- Guardrails: this slice creates no owner portal account, sends no owner email,
  downloads/sends no PDFs, writes no Xero data, reconciles no payments,
  dispatches no invoices, refreshes no providers, and mutates no provider
  history. True owner login/account claiming is intentionally deferred to the
  next owner-portal auth slice.
- Red-green proof: backend test failed first with 404, then passed after
  registration. Playwright smoke failed first on the missing route, then passed
  after the page landed.
- Verification: owner portal + owner statement parity/owner tests
  **22 passed**; targeted API ruff clean; targeted frontend eslint clean;
  `./node_modules/.bin/tsc --noEmit` clean; owner portal + People record smokes
  **5 passed**; `./node_modules/.bin/next build` succeeded.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_BmDUL3NHvnFheAXA4jxfSwxo2ba9` for `b47b7a3` was **READY**; `https://leasium.ai`
  returned HTTP 200; Render health reported
  `b47b7a3b10a2b90f267991fd7c229de9ab4a3993` with `source=render`.

### Owner portal account-auth slice
- First true owner-account boundary is implemented after the read-only preview.
- Backend: migration `20260531_0030_owner_portal_accounts.py` adds
  `owner_portal_invite` and `owner_portal_account` tables. Invites store only a
  SHA-256 token hash; the raw token is returned once in the operator response.
- New backend routes:
  `POST /api/v1/owner-portal/{owner_id}/invite`,
  `GET /api/v1/owner-portal/invites/{token}/preview`,
  `POST /api/v1/owner-portal/account/claim`,
  `GET /api/v1/owner-portal/account/status`, and
  `GET /api/v1/owner-portal/account/session?month=YYYY-MM`.
- Frontend: `/owner-portal/invite/[token]` renders only safe claim context
  before account claim, and `/owner-portal` opens an already linked owner
  account without an owner id in the URL. Existing
  `/owner-portal/[ownerId]?month=YYYY-MM` remains operator-preview only.
- Guardrails: owner invite creation is local only; no owner email, PDF
  generation/dispatch, Xero write, Basiq/provider refresh, payment
  reconciliation, invoice dispatch, or provider-history mutation is triggered.
- Red-green proof: backend auth tests failed first on missing account models /
  endpoints; frontend smoke failed first on missing account routes, then passed.
- Verification so far: focused owner backend slice passed **26 passed**; targeted
  backend ruff clean; frontend owner account + preview smokes passed **4
  passed**; targeted frontend eslint clean; `./node_modules/.bin/tsc --noEmit`
  clean; production-style `next build` succeeded; Postgres offline migration SQL
  for `20260531_0029:20260531_0030` generated successfully; in-app browser
  sanity checked the safe invite page and account dashboard against a local mock.
  Local `alembic upgrade head` still needs a running local Postgres (the desktop
  session refused `localhost:5432`).
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_3Gk5FKHGQXo1xgJiGuftCddsZhGY` for `ae6fabb` was **READY** and aliased to
  `leasium.ai`; `https://leasium.ai/owner-portal` returned HTTP 200; Render
  health reported `ae6fabb14efe14110d15fe60d062d67454359762` with
  `source=render`; live OpenAPI includes all five account/invite routes; the
  public invite preview endpoint returned a clean 404 for a fake token, which
  confirms migration `20260531_0030` is applied enough for the new table read
  path instead of failing with a missing-table error.

### Owner portal secure-documents slice
- First owner document-share slice is shipped. Code commit: `8c4ae0e`
  (`Add owner portal secure documents`).
- Backend: `OwnerPortalRead` now includes `documents`, populated only from
  property-level `StoredDocument` rows whose
  `document_metadata.owner_portal_visible` is exactly `true`, whose
  `property_id` is linked to the owner through `PropertyOwner`, and whose
  tenant/unit/lease/onboarding fields are empty. Invoice-category documents are
  excluded from this first slice.
- Backend: signed-in owner accounts can download those files through
  `GET /api/v1/owner-portal/account/documents/{document_id}/download`. The route
  reuses the owner portal bearer account boundary; unflagged, cross-property,
  tenant/lease/onboarding, deleted, and revoked-account access stays blocked.
- Frontend: `/owner-portal` and operator preview `/owner-portal/[ownerId]` show
  a `Shared documents` panel with owner-safe source labels. Account sessions get
  a download button; operator preview shows `Account download only`.
- Guardrails: no owner email, SendGrid/Twilio send, Xero/Basiq/provider write,
  provider refresh, payment reconciliation, invoice dispatch, owner-statement
  PDF generation, upload, or provider-history mutation was added.
- Red-green proof: backend document-list test first failed with missing
  `documents`; backend account-download test first failed with 404; frontend
  smokes first failed on missing `Shared documents`. All passed after the slice.
- Verification: owner portal backend + auth + statement parity tests
  **11 passed**; targeted backend ruff clean; targeted frontend eslint clean;
  `./node_modules/.bin/tsc --noEmit` clean; owner portal account/preview smokes
  **4 passed**; production-style `next build` succeeded. A parallel attempt to
  run Playwright and `next build` corrupted `.next`; rerunning them sequentially
  after clearing the generated cache passed cleanly.
- Deployment verification: Render health reports
  `8c4ae0eef985e114ef94fe95b3e9b66632f6485c` with `source=render`; live OpenAPI
  includes `/api/v1/owner-portal/account/documents/{document_id}/download`;
  `https://leasium.ai/owner-portal` returns HTTP 200. Vercel API auth is not
  available in this desktop session, so frontend production proof used the
  public URL and deployed static chunks; those chunks include `Shared documents`,
  `Owner account`, `Operator preview`, `source_label`, and the account document
  download path.

### Owner statement split-allocation slice
- Shipped in this continuation. Code commit: `4305533`
  (`Allocate owner statements by ownership split`). Plan:
  `docs/superpowers/plans/2026-05-31-owner-statement-split-allocation.md`.
- Backend: `/api/v1/owners/statements` now carries `PropertyOwner.split_pct`
  into statement aggregation, so shared-property invoice totals are allocated
  by owner split instead of duplicated into every linked owner. Unlinked
  properties still fall into `Unattributed` at 100%.
- The allocated values flow through owner statement JSON, owner portal
  statement projections, owner statement PDFs, statement pack manifests, and
  invoice evidence CSVs because they all read from the same statement builder.
- Guardrails unchanged: this is a read-path change only; statement send/dispatch
  remains explicit approval only, and no owner email, Xero/Basiq/provider write,
  payment reconciliation, provider refresh, or provider-history mutation was
  added.
- Red-green proof:
  `test_owner_statements_allocates_shared_property_totals_by_split_pct` first
  failed because both 60/40 owners received the full invoice, then passed after
  allocation. Owner portal expectations were updated for the fixture's 40/60
  linked-property splits.
- Rounding guard: `test_owner_statements_allocates_split_rounding_residue_once`
  covers a one-cent 50/50 split so allocation cannot create duplicate cents.
- Review fixes: allocated invoice evidence now keeps
  `paid_cents + outstanding_cents == total_cents` whenever the source invoice
  balances, caps allocated paid cents at each owner's allocated total for tiny
  split percentages, normalises invalid over-100 linked split totals defensively
  so they cannot duplicate full invoices, and owner statements include a stable
  `owner_id` so owner portal previews match duplicate-label co-owners on the
  same shared property by id rather than by display text alone.
- Verification:
  `.venv/bin/python -m pytest tests/integration/test_owners_api.py tests/integration/test_owner_portal_api.py tests/integration/test_owner_portal_auth_api.py tests/integration/test_owner_statement_parity.py -q`
  passed **35 passed**; targeted backend ruff passed; web `tsc --noEmit` and
  targeted `eslint src/lib/api.ts` passed; `apps/web` statements smoke passed
  **3 passed**.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_5G4GWVCp1Q8gXyQpkpujX6JwMcov` for `4305533` was **READY**;
  `https://leasium.ai/statements` returned HTTP 200; Render health reported
  `43055333993c3575581bc66a1411d4b12188256f` with `source=render`; live
  OpenAPI includes `/api/v1/owners/statements`.

### Owner detail 404 polish slice
- Shipped in this continuation after the split-allocation deploy.
- Frontend API errors now preserve HTTP status through `ApiError` while keeping
  the existing `Error.message` contract for `friendlyError` callers.
- `/owners/[ownerId]` now shows a calm `Owner not found` People-record state for
  404s, with a return action to the owner directory. Non-404 failures still use
  the existing `Owner unavailable` error path.
- Red-green proof: the new People-record smoke first failed because the generic
  unavailable state rendered for a mocked 404, then passed after the status-aware
  branch landed.
- Verification: `people-record-layout.spec.ts` passed **5 passed**; targeted
  `eslint`, web `tsc --noEmit`, and `git diff --check` passed. Review agent
  approved with no P1/P2 findings.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_BT5PUVTzN7YvabAZqwaDE6yo1sYQ` for `5b14961` was **READY**;
  `https://leasium.ai/owners/missing-owner` returned HTTP 200 through the
  dynamic `/owners/[ownerId]` route; Render health reported
  `5b1496164e95d46b5756471f5dea77136bc5e78b` with `source=render`.

### Vendor detail read + 404 polish slice
- Shipped in this continuation after the owner-detail polish.
- Backend: `GET /api/v1/contractors/{contractor_id}` returns one non-deleted
  vendor/contractor record through the existing `READ_ROLES` role check. It is
  read-only: no audit write, provider send, provider mutation, or dispatch path.
- Frontend: `/contractors/[contractorId]` now reads the direct contractor detail
  endpoint instead of searching contractor lists across every entity. After load
  it still repairs stale selected-entity state to the contractor's `entity_id`.
- 404s now render a record-level `Vendor not found` People-record state with a
  return action to the vendor directory. Non-404 failures use the
  `Vendor unavailable` error path.
- Red-green proof: backend detail tests first failed with **405** before the
  route existed, then passed. The new vendor not-found smoke first failed
  because the page had no record-level `Vendor not found` heading, then passed.
- Verification: `tests/integration/test_contractors_api.py` passed **4 passed**;
  People-record smoke passed **6 passed**; targeted backend ruff, frontend
  `eslint`, web `tsc --noEmit`, and `git diff --check` passed. Review agent
  approved with no P1/P2 findings.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_A7r27oinhtNVSXA84cuqh7PTmBQn` for `b4af4b4` was **READY**;
  `https://leasium.ai/contractors/missing-vendor` returned HTTP 200 through the
  dynamic `/contractors/[contractorId]` route; Render health reported
  `b4af4b49f03a903276b85930a694483992ceb093` with `source=render`; live OpenAPI
  includes `/api/v1/contractors/{contractor_id}`.

### Tenant detail status-aware error polish slice
- Shipped 2026-06-01 after the owner/vendor record-level error states.
- `/tenants/[tenantId]` now imports the shared `ApiError` status contract and
  uses it on the primary tenant and tenant-detail reads. 404s render a
  People-record `Tenant not found` state with a return action to the People
  tenants directory; non-404 primary load failures render `Tenant unavailable`
  with the API message instead of being mislabeled as missing records.
- The slice leaves tenant child queries (portal accounts, leases, documents,
  correspondence, intakes) on their existing paths and touches no provider,
  email, Xero, Basiq, reconciliation, or backend mutation code.
- Red-green proof: the new tenant People-record smoke first failed because the
  page did not expose the expected record-level heading/description and generic
  failures did not reach `Tenant unavailable`; after the status-aware branch,
  the focused smoke passed **3 passed**, including the review-found mixed
  500/404 primary-read edge case where the non-404 API message must win.

### Maintenance detail status-aware error polish slice
- Shipped 2026-06-01 after the Tenant detail status-aware slice.
- `/operations/maintenance/[workOrderId]` now imports the shared `ApiError`
  status contract and uses it on the primary work-order read. 404s render a
  `Work order not found` page/header with a return action to Work; non-404
  failures render `Work order unavailable` with the API message.
- The slice leaves correspondence, documents, invoice drafts, properties, and
  tenants child queries on their existing paths and touches no provider, email,
  SMS, Xero, Basiq, reconciliation, or backend mutation code.
- Red-green proof: the new Operations smoke first failed because both mocked
  404 and 500 primary-read failures stayed on the generic unavailable card/page
  heading; after the status-aware branch, the focused smoke passed **2 passed**.
  A follow-up review found cached data could coexist with a primary-read error;
  the added refresh regression failed red on stale `Air conditioning fault`
  content, then passed after primary-read errors began suppressing cached
  work-order data.

### Account operating-mode frontend gate slice
- Shipped after the vendor-detail polish. Backend commit `cb4704f` already
  added `Organisation.operating_mode` (default `self_managed_owner`) plus the
  owner/admin-gated `PATCH /api/v1/security/organisation/operating-mode`.
- Frontend commit `1996aa7` gates the People → Owners hub by operating mode:
  `self_managed_owner` hides the Owners tab and falls back from
  `/people?tab=owners` to Tenants; `managing_agent` and `hybrid` keep the Owners
  tab and default the People hub to Owners.
- Settings → Organisation now has an owner/admin operating-mode selector. For
  self-managed accounts, owner-entity CRUD remains reachable in Settings under
  **Your entities & trusts** using the shared `OwnersDirectory`; this keeps
  owner/entity data available without framing those records as third-party owner
  clients.
- AppHeader now hides owner-statement command-palette and `G F` shortcut entry
  points for self-managed accounts. Commit `ce271e1` adds explicit smoke
  coverage for those command/shortcut gates and a Settings provider-call guard.
- Commit `add20ac` gates the deeper owner-statement dispatch surface by operating
  mode. Self-managed accounts keep `/statements` as **Entity statements** for
  local trust/entity reporting, while owner email send controls, dispatch drafts,
  dispatch approval queues, and dispatch receipt reads are available only to
  `managing_agent`/`hybrid` accounts. Missing owner billing emails no longer block
  self-managed local statement signoff.
- Commit `147eae1` gates the owner-portal surface by operating mode. Self-managed
  accounts cannot open operator owner-portal previews, create owner portal
  invites, claim owner portal accounts, read linked owner account status/session
  data, or download owner-visible account documents. Managing-agent and hybrid
  accounts keep the existing owner portal behavior; the public invite preview
  remains safe pre-claim context only.
- Guardrails: the frontend write is limited to the local organisation
  operating-mode PATCH. The tests assert the Settings mode change does not call
  SendGrid, Twilio, Xero, Basiq, provider dispatch/refresh, or provider-history
  endpoints. The statement dispatch guard returns 403 before SendGrid for
  self-managed accounts, and the self-managed smoke asserts no
  `/owners/statements/dispatch` or `/owners/statements/send` request leaves the
  page. The owner-portal guard returns 403 before invite/account mutations,
  `last_seen_at` writes, or document byte responses in self-managed mode, and
  the self-managed smoke asserts no operator preview request leaves the page.
- Remaining follow-up: gate deeper agent-only modules that are still directly
  reachable, especially disbursement/trust-accounting entry points once those
  route surfaces exist.
- Verification:
  `./node_modules/.bin/playwright test tests/smoke/people-hub.spec.ts tests/smoke/settings.spec.ts tests/smoke/app-flows.spec.ts --grep "operating mode|people hub|keyboard" --workers=1`
  passed **6 passed**; `./node_modules/.bin/tsc --noEmit` passed; targeted
  frontend `eslint` passed; `.venv/bin/python -m pytest tests/integration/test_security_api.py -q`
  passed **14 passed**; targeted backend `ruff` passed; `git diff --check`
  passed. For `add20ac`:
  `./node_modules/.bin/playwright test tests/smoke/statements.spec.ts tests/smoke/nav-consolidation.spec.ts tests/smoke/owner-statement-dispatch.spec.ts tests/smoke/app-flows.spec.ts --grep "self-managed|money hub|owner statement dispatch|keyboard|dashboard shows" --workers=1`
  passed **8 passed**; `./node_modules/.bin/tsc --noEmit` passed; targeted
  frontend `eslint` passed; `.venv/bin/python -m pytest tests/integration/test_owners_api.py -q -k "send_owner_statement"`
  passed **5 passed / 19 deselected**; targeted backend `ruff` passed; `git diff --check`
  passed. Review agent found and rechecked two P2s; follow-up review found no
  P1/P2 issues. For `147eae1`:
  `.venv/bin/python -m pytest tests/integration/test_owner_portal_api.py tests/integration/test_owner_portal_auth_api.py -q`
  passed **16 passed**; `./node_modules/.bin/playwright test tests/smoke/owner-portal.spec.ts tests/smoke/owner-portal-account.spec.ts --workers=1`
  passed **5 passed**; frontend `tsc --noEmit`, targeted frontend `eslint`,
  targeted backend `ruff`, and `git diff --check` passed. Review agent found no
  P1/P2 issues and the hybrid green-path test gap was closed before commit.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_EV1PJhmj9ckaMJEyGbasZMA5Tap9` for `ce271e1` was **READY**;
  `https://leasium.ai/people` and `https://leasium.ai/settings` returned HTTP
  200; Render health reported
  `ce271e174c41ea00fe46748becbf42abc9e6a0dd` with `source=render`.
  Deep-gate code deploy `dpl_4Bq154R6tULSkvW5CkzGWppB3htp` for `add20ac` is
  **READY**; Render health reports
  `add20ac43e3382607b70d030ab749030a3219178`; `https://leasium.ai/statements`
  and `https://leasium.ai/money` returned HTTP 200. Owner-portal deep-gate code
  deploy `dpl_ATgTm2j74BDy86R7KKi1JWPnbqQJ` for `147eae1` is **READY** and
  aliased to `leasium.ai`; Render health reports
  `147eae15d3209bc021c7bcc2c43a45798ff803e5`; `https://leasium.ai/owner-portal`,
  `https://leasium.ai/owner-portal/owner-1?month=2026-05`, and
  `https://leasium.ai/statements` returned HTTP 200.

### Next
1. Test production owner invites and secure document downloads with a real Clerk
   owner account before broad owner rollout.
   This is blocked in Codex without operator input: it needs a real operator
   Clerk session, a chosen production owner, a matching owner Clerk account, an
   eligible `owner_portal_visible` document, and explicit approval because invite
   creation/account claim mutate production state, even though they send no
   owner email and touch no providers.
2. Add richer owner dashboard sections after the shared-document boundary is
   reviewed on real SKJ files.
3. Decide whether to continue the status-aware not-found pattern into property
   workspace and tenant portal preview routes. Owner, Vendor, Tenant, and
   maintenance work-order detail now use the shared `ApiError` contract.

### Operating rule
- Use agents wherever they can materially advance the work: parallel
  reconnaissance, bounded implementation slices with disjoint write sets, and
  review/verification lanes. Keep immediate blockers local, and review/verify
  agent output before claiming status or committing.

## Codex Takeover — 2026-05-31 (READ THIS FIRST)

Handover from a Cowork (Claude) session. Prod is healthy and current. Everything below is **on `main` and deployed** unless marked DEFERRED/TODO.

### Prod state (verified this session)
- `main` tip before this doc-sync commit: `65c1da8`. The Vercel **production** deploy for `65c1da8` is **READY** and serving `leasium.ai` (verified via the Vercel API).
- Commits newest→oldest: `65c1da8` darken canvas · `d0bd122` People hub · `ff00a18` dashboard heading polish (Temba) · `5685c90` Owner entity backend · `a524ba6` UX polish + DoorLoop research docs.

### What shipped this session (DoorLoop benchmark P0)
1. **Owner is a first-class entity** (`5685c90`): `stewart/core/models.py` `Owner` (mirrors the 11 legacy `Property.owner_*` fields) + `PropertyOwner` (`split_pct`, unique `(property_id, owner_id)`), `Entity.owners`/`Property.owner_links`; migration `20260531_0029_owner_entity.py`; `apps/api/routers/owner_entities.py` + `schemas/owner_entities.py` → `/api/v1/owners` CRUD + `POST/DELETE /owners/{id}/properties` (registered AFTER `owners.router` so `/owners/statements*` keeps route priority); `stewart/core/owner_backfill.py` + `scripts/backfill_owners.py`.
2. **People hub** (`d0bd122`): `apps/web/src/app/people/page.tsx` — Owners directory (live on the API), Tenants/Vendors compact + link-out, Prospects stub, `?tab=` URL state; Owner client in `apps/web/src/lib/api.ts`; palette + `G E` in `app-shell.tsx`; smoke `apps/web/tests/smoke/people-hub.spec.ts`.
3. **Darker canvas** (`65c1da8`): `--leasium-bg` #f6f8fb→#edf0f6, `--leasium-slate-100` #f2f4f7→#e9edf3 (globals.css). Cards lift; hierarchy preserved (cards > canvas > muted > border). Light mode only.

### Verification
- Backend: full integration suite **344 passed / 1 skipped**, ruff clean (Temba's Mac via Desktop Commander).
- Frontend: eslint + tsc clean; **Vercel prod build passed** (strongest signal). Caveat: the People hub Playwright smoke is written but its *local* run times out on Next cold-compile (the known x64-Node WASM-SWC edge-runtime issue documented later in this file) — re-run `cd apps/web && ./node_modules/.bin/playwright test tests/smoke/people-hub.spec.ts` after the arm64-Node fix.

### DO FIRST
1. `git pull` (tip should be this doc-sync commit on top of `65c1da8`).
2. Confirm **Render** deployed `5685c90`+ and migration `20260531_0029` applied (owner/property_owner tables in prod Neon). The frontend was verified; the backend (Render) was not checked this session.
3. **Populate owners** in each env: `.venv/bin/python -m scripts.backfill_owners` (local) and against prod once Render is healthy. Until then `/people` Owners shows empty with a "run backfill" hint — expected, not a bug.

### HISTORICAL NEXT TICKETS (superseded by latest sections above) — plan: `docs/superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md`
These were the takeover tasks at the start of 2026-05-31. Phase 3, Ticket 1.3,
Ticket 2.2, and the read-only owner portal slice have now shipped; use the
latest "Next" block above for current continuation.

1. **Phase 3 — nav consolidation to 7 hubs.** Fold Tenants + Vendors *inline* under `/people` (they link out today), add a **Money** hub (Billing · Statements · Xero · Basiq), route Comms under **Work**, promote People to the sidebar and drop the standalone Tenants item → Dashboard · Smart Intake · Properties · People · Work · Money · Insights (+ Settings). Honour the §10.5.1 seven-item cap; add redirects for moved routes. Test-first.
2. **Ticket 1.3 — `/owners/statements` read-path swap (DEFERRED; do with eyes on real data).** Change ONLY the grouping in `_build_owner_statements` (`apps/api/routers/owners.py`) to group by `Owner`/`PropertyOwner`, with an unattributed fallback for properties lacking an owner link. Keep `tests/integration/test_owner_statement_parity.py` green — it is the safety net. Requires the backfill to have run.
3. **Ticket 2.2 — consistent people record-page shape** (Tenant/Owner/Vendor share header → tabs → actions).
4. P1: owner portal (read-only) → tenant payments (AU rails: PayTo/PayID/BPAY) → installable PWA.

### GUARDRAILS (non-negotiable — `CLAUDE.md`)
- Review-first providers: no Xero write / SendGrid / Twilio / tenant email / payment reconciliation without explicit operator approval.
- `Owner` is the model of record; legacy `Property.owner_*` fields are a **backfill source only**.
- Additive + test-first (no production code without a failing test). Commits land directly on `main`, no PRs, no Claude/Codex attribution lines.
- Agent-first execution: use agents for bounded parallel work whenever useful,
  while keeping immediate blockers local and verifying every agent result.

### TOOLCHAIN (Temba's Mac, via Desktop Commander)
- Backend: `.venv/bin/python -m pytest`, `.venv/bin/python -m ruff check ...`, `.venv/bin/alembic upgrade head` (`uv` unavailable).
- Frontend (in `apps/web`): `./node_modules/.bin/{eslint,tsc,playwright,next}`. Local Playwright/`next dev` hits the x64-Node WASM-SWC edge-runtime issue — prefer arm64 LTS Node + clean `pnpm install`; the Vercel build is the reliable frontend gate. Verify prod deploys via the Vercel API (team `team_5auiJ5DlpnIlF4Qyb3uA6dEz`, project `prj_8fAMsCvYv1Pm728oFXLVFE9ccgRZ`).
- Local infra: `docker compose up -d` → `.venv/bin/alembic upgrade head` → `.venv/bin/python -m scripts.seed`.

## Current State

- 2026-05-31 frontend Speed Insights slice (THIS SESSION): Vercel Speed
  Insights is wired in the Next root layout with
  `@vercel/speed-insights/next`, the pnpm lockfile records the dependency, and
  a static Playwright smoke test guards the root-layout mount. Verified the
  new smoke test red -> green locally. This is non-Basiq and only starts
  collecting Core Web Vitals after the next Vercel deployment with Speed
  Insights enabled for the project.
- 2026-05-31 Comms keyboard review flow (THIS SESSION): `/comms` draft cards
  now render as a scoped focusable review list. `j`/`k` and Arrow Up/Down move
  between focused draft rows, Enter focuses the first editable field, and the
  handler exits inside inputs, textareas, selects, links, and buttons so body
  editing and approval controls keep native behaviour. Smoke coverage verifies
  keyboard movement and confirms no comms mutation request fires.
- 2026-05-31 Dashboard motion polish (THIS SESSION): command-center rows and
  activity-feed rows now use the shared 200ms `ease-leasium` transition timing
  for list feedback, and Upcoming lease-event rows now join Activity feed on
  the reduced-motion-safe row-enter animation. The command-center hero keeps
  instant first paint. Source smoke guards the token pattern; this stayed
  frontend-only and did not touch provider or Basiq paths.
- 2026-05-31 Dashboard event urgency/progressive-disclosure polish (THIS
  SESSION): upcoming
  lease-event rows now derive near-term urgency labels from the event date, so
  same-bucket chips read `Due today`, `Due tomorrow`, or `Due in Nd` instead of
  repeating raw `Tomorrow` text across rent-review / expiry rows. The same
  panel now keeps long event lists to the first five rows until the operator
  clicks `Show all`, matching the Recent activity feed's disclosure pattern.
  Recent activity's existing `Show all` control also now uses the 44px
  touch-target baseline. Browser smoke covers the repeated-tomorrow, long-list,
  and Recent activity disclosure cases; no provider, Basiq, or API mutation
  path touched.
- 2026-05-31 Dashboard Leasium AI touch-target polish (THIS SESSION): the
  read-only suggestion chips and citation source links now use the 44px target
  baseline and shared motion timing. The smoke keeps proving the cited-answer
  flow; no AI/provider mutation path changed.
- 2026-05-31 Dashboard entity-title de-duplication (THIS SESSION): the live
  dashboard no longer renders the selected entity name as a giant content H1.
  The AppHeader entity selector remains the source of entity context, the visible
  dashboard starts with Daily command center, and the compact demo/refresh
  controls now sit in that panel header. A screen-reader-only Dashboard H1
  preserves page structure. Smoke coverage verifies the selector still holds
  `entity-1` while `Acme Holdings Pty Ltd` is absent as a content heading.
- 2026-05-31 saved views touch-target polish (THIS SESSION):
  `<SavedViewsMenu>` now uses 44px interactive targets and shared motion timing
  for the trigger, saved-view row actions, save form, and close control. The
  close action now sits in the menu header so it cannot intercept first-row
  Delete/Rename clicks, and the tenants smoke flow checks those actions while
  still proving saved filters re-apply through existing tenant filter state/URL
  semantics. Frontend-only; no Basiq, provider, bank-feed, comms dispatch, or
  API mutation path touched.
- 2026-05-31 Clerk auth light-appearance guard (THIS SESSION): the shared
  `clerkEmailOnlyAppearance` now pins light Clerk variables plus Leasium
  card/input/button/link classes for Sign in / Sign up, preserving email-only
  auth while preventing stale dark OS/browser appearance from bleeding into the
  light auth shell. Source smoke guards the tokens. No auth routing, Clerk
  session, invite, Basiq, provider, or API mutation path changed.
- 2026-05-31 App shell mobile drawer close target (THIS SESSION): the mobile
  drawer's Close navigation button now uses the same 44px target baseline and
  shared motion timing as the hamburger/utility controls. The mobile header
  smoke opens the drawer and measures both open and close targets. Frontend-only;
  no Basiq, provider, bank-feed, comms dispatch, or API mutation path touched.
- 2026-05-31 maintenance detail loading-state polish (THIS SESSION):
  `/operations/maintenance/[workOrderId]` now reuses `SkeletonRows` for the
  initial work-order load and Correspondence panel load, replacing the raw
  spinner-plus-copy rows. The Operations UX smoke delays both reads and guards
  the accessible skeleton pattern. Frontend-only; no Basiq, provider, bank-feed,
  comms dispatch, or API mutation path touched.
- 2026-05-31 Notifications filter touch-target polish (THIS SESSION):
  the Work notice and Digest history filter buttons now use the 44px target
  baseline instead of the prior 40px filter-chip compromise. The mobile smoke
  measures every status/channel filter in both panels plus the existing Open
  work/Open Work links, without clicking send, retry, export, refresh, or
  mark-reviewed actions.
- 2026-05-31 Operations workload filter touch-target polish (THIS SESSION):
  the queue workload filters now use the 44px target baseline for Open,
  Unassigned, Follow-up due, My work, and per-member filter buttons. Team
  workload / Assigned chips match that height for visual alignment. The smoke
  measures stable filters only and does not click digest, assignment, notice,
  provider, or mutation actions.
- 2026-05-31 Billing Readiness delivery-filter touch-target polish (THIS
  SESSION): Dispatch & reconcile filter buttons now use the 44px target baseline
  for All, Needs action, Ready to dispatch, Complete, and Unpaid. The smoke
  measures and clicks only those read-only filters under a no-mutation request
  guard, then measures existing recovery/payment/statement and mobile invoice
  handoffs without clicking dispatch, email, payment, provider, or
  reconciliation actions.
- 2026-05-31 owner-tag chevron polish (THIS SESSION): property ownership chips
  now render raw chain labels like `A -> B -> C` as cleaner `A › B › C` display
  text while keeping the original string in the chip title and normalized
  `owner_tag` filter key. This closes the deferred C2 craft item without
  changing property data, matching, or URL semantics.
- 2026-05-31 helper consolidation (THIS SESSION): after re-checking Claude's
  UX audit/source notes, `/contractors`, `/inbox`, `/insights`,
  `/notifications`, `/intake/spreadsheet`, and the embedded Smart Intake
  register-import panel, `/operations` plus maintenance detail,
  `/portfolio-qa`, `/tenants`, tenant detail, `/statements`, and the dashboard
  shell now use shared `friendlyError` and/or `StatusTone` imports instead of
  local redeclarations. This follows the deferred external-review cleanup item.
  The property workspace also delegates generic Error-message handling to the
  shared helper while keeping its entity/property-specific recovery copy; no
  visible UX or provider behavior changed.
- 2026-05-31 live Basiq connection foundation (THIS SESSION): commits `7bcabfb`
  (backend — `BasiqConnection` model + migration `20260531_0028`, server-token +
  accounts/transactions fetch behind the soft-skip, connect/status/revoke routes,
  provider-source wired to the active connection) and `424caa8` (Settings connect
  UI + provider-source toggle). Inert and READ-ONLY until a Basiq developer app +
  `BASIQ_API_KEY` are configured; the consent step is an explicit operator click,
  the key stays server-side. **Hosted Neon/Render must apply migration
  `20260531_0028`.** Full sweep green: ruff clean, pytest 366 passed / 1 skipped,
  `eslint src` + `tsc` clean, production `next build` succeeded. Committed locally;
  push to deploy (stays inert until the Basiq env is set).
- 2026-05-30 bank-feed + observability slice (THIS SESSION, after the dispatch/UX
  push): commits `d78cf27` (bank-feed v1 backend + Sentry scaffolding) and
  `c3ef6d6` (bank-feed review UI), then this docs commit. Bank-feed reconciliation
  v1 is review-first and INERT until `BASIQ_ENABLED` + `BASIQ_API_KEY` are set:
  `/api/v1/basiq/reconciliation-preview|apply` reuse the Xero reconciliation engine
  (no fork; local-metadata-only, explicit per-row `approved_idempotency_keys`), with
  a Settings → Bank feed panel for operator-imported transactions. No new migration.
  Backend Sentry init is a no-op unless `SENTRY_DSN` is set and can never break
  startup. Full sweep green: ruff clean, pytest 352 passed / 1 skipped, `eslint src`
  + `tsc` clean, production `next build` succeeded. Committed locally; push to deploy
  (bank-feed + Sentry stay inert until their env is configured).
- 2026-05-30 dispatch + UX slice (THIS SESSION): seven feature commits on `main`
  ending `2815dc9`, then this docs commit. Shipped — comms badge-counts
  summary-only fast path (`6e36ffa`); owner statement review-first SendGrid
  dispatch backend (`486e6cf`) + UI (`63fad2e`); Portfolio QA per-blocker bulk
  review (`75952c7`); Smart Intake inbound-attachment sender/received cues
  (`42f8fae`); world-class-audit Phase B-E close-out (`2815dc9`). Full sweep
  green: backend ruff clean + `pytest` **345 passed / 1 skipped**; frontend
  `eslint src` + `tsc --noEmit` clean + production `next build` (WASM)
  succeeded. New migration `20260530_0027_owner_statement_dispatch` must be
  applied in hosted Neon/Render before the dispatch endpoints work there. Owner
  statement dispatch is OFF by default (`owner_statement_email_enabled`) and
  never sends without explicit per-owner approval (`approve=true`).
- Verification sweep (2026-05-30): working tree is **clean** at HEAD
  `1c2cc08 Add live verifier for review-queue card overflow`. Full
  health pass green — backend `ruff check apps stewart tests scripts`
  passed, `.venv/bin/python -m pytest` returned **340 passed, 1 skipped**
  (the skip is `test_migrations` with no `TEST_DATABASE_URL`), frontend
  `eslint src` + `tsc --noEmit` clean, and the production `next build`
  (WASM SWC) succeeded. The older "this slice is uncommitted" notes
  below predate this HEAD — those slices have since landed; treat the
  clean tree as the current truth.
- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.ai` (Vercel). Treat `https://leasium.vercel.app` as a provider alias only, not a product URL.
- Production API: `https://api.leasium.ai/api/v1` (Render custom domain). `https://leasium-api.onrender.com` is a provider fallback only.
- Domain cutover note: `api.leasium.ai` now resolves and serves the Render API certificate. Production frontend/API/env/provider links should use `leasium.ai` and `api.leasium.ai`.
- MVP performance note (2026-05-30): production Vercel should now set
  `NEXT_PUBLIC_API_BASE_URL=/api/v1`; `apps/web/vercel.json` rewrites same-origin
  `/api/v1` and `/health` requests to the Render API to reduce browser
  cross-origin/preflight overhead. Keep `PUBLIC_API_URL=https://api.leasium.ai`
  on the API service for provider callbacks and generated external links.
- Dashboard speed pass (2026-05-30): the home screen now has
  `GET /api/v1/dashboard/overview` for first-paint counts and command-center
  data, starts from stored `leasium.entity_id`, uses a root React Query cache,
  warms/dedupes Clerk tokens, and disables persistent shell prefetch. The
  overview endpoint is an accelerator only; if it fails during a staggered
  deploy, the dashboard falls back to the existing detailed queries.
- Live UX audit harness (2026-05-30): run
  `npm --prefix apps/web run audit:live -- --login` once to save a signed-in
  browser state, then run
  `LEASIUM_AUDIT_URL=https://leasium.ai npm --prefix apps/web run audit:live`.
  Reports land under `output/playwright/live-audit/` with screenshots,
  slow-request notes, console errors, and overflow checks.
- Infra snappiness note (2026-05-30): local/product fixes made the site
  noticeably faster, but remaining delay is likely Render/Neon/Auth/CORS/observability
  rather than layout. Backend now reuses the Clerk JWKS client, exposes
  `server-timing` and `x-request-id`, and has configurable DB pool env vars.
  Next infra checks: confirm Render plan is always-on, API and Neon are in a
  sensible shared region, DB pool vars match plan limits, and add Speed
  Insights plus a log drain/Sentry/OpenTelemetry before broad MVP traffic.
- Detailed record: `docs/mvp-ux-performance-review-2026-05-30.md`.
- Live audit continuation (2026-05-30, signed-in): ran the harness against
  `leasium.ai` as `temba@skjcapital.com` across the seven MVP routes, desktop +
  mobile. No horizontal overflow, no page/console errors, visual layer in good
  shape. Dominant latency is `GET /api/v1/comms/queue/counts` at ~6.5-8.1s on
  every page (it runs the full eight-scanner queue scan just for the sidebar
  badge count). Applied a surgical frontend fix in `app-shell.tsx`
  (`refetchOnWindowFocus: false`, `staleTime` 60s -> 5min) so the scan stops
  re-firing on tab focus/navigation; eslint + tsc clean. Backend follow-up to
  make the counts endpoint actually cheap (count-only queries or ~60s entity
  cache) is flagged as the top remaining snappiness win - left for a review-first
  pass since the scanners are shared with the live comms queue. Screenshots +
  route report under `output/playwright/live-audit/`. This slice is uncommitted.
- World-class UX pass (2026-05-30): full audit in
  `docs/leasium-ux-world-class-audit-2026-05-30.md` (benchmark reset to
  Linear/Stripe/Ramp; verdict: visual craft already B+/A-, the gap is FEEL —
  perceived speed, editorial focus, flow). Phase A + B kickoff shipped this
  session, uncommitted, eslint/tsc/ruff/pytest-clean (frontend Playwright smoke
  blocked in-sandbox by a Next middleware edge-runtime EvalError — run on Mac):
  (1) `/comms/queue/counts` now per-entity TTL-cached 45s so the badge stops
  re-running the 8-scanner scan every navigation (+ cache test; 47 comms tests
  green); (2) nav links prefetch route bundles on hover/focus intent in
  `app-shell.tsx`; (3) dashboard hero de-duplicated — removed the command-center
  right-rail summary that duplicated the metric strip; command center now
  full-width with an inline review-first guardrail (`DashboardCommandCenter.tsx`).
  Phase B progressive disclosure is now covered for Recent activity and
  Upcoming lease events; remaining UX-audit follow-ups start at Phase C
  (craft punch-list), D (keyboard/flow), and E (motion). Blast radius this
  session: comms.py, test_comms_api.py, app-shell.tsx,
  DashboardCommandCenter.tsx plus dashboard panel follow-ups.
- Clerk cutover note: live Vercel was previously serving a publishable key that decoded to `clerk.leasium.vercel.app`. That creates split-domain sessions. The canonical target is a Clerk setup anchored to `leasium.ai` (prefer `clerk.leasium.ai` via Clerk DNS/CNAME, or exact `https://leasium.ai/__clerk` proxy if enabled in Clerk Dashboard and Vercel env).
- **Latest pushed commit:** run `git log --oneline -12` to confirm before editing. This handover is kept current by the Codex continuation slices, but the local log is the source of truth.
- **Working tree:** expected clean after each pushed slice. If not, inspect with `git status --short` before editing.
- **Mac tooling change (2026-05-24):** Node v26 installed via Homebrew; Desktop Commander MCP server (`@wonderwhy-er/desktop-commander`) is configured in Claude Desktop. Future Claude sessions in this workspace have `mcp__Desktop_Commander__*` tools available — they execute commands directly on the Mac (pytest, ruff, alembic, git, next dev, playwright). Sandbox-can't-write-git and no-local-Node constraints from prior sessions no longer apply.
- The 2026-05-22 UX-review backlog is fully landed except Tier 2 (g) dark mode (deliberately deprioritised under the SKJ internal-first-6-months direction). All shipped items are marked `[x]` or `[~]` in `docs/product-roadmap.md`. Known dark-mode issue for that later pass: re-check real Clerk auth widget rendering under dark OS/browser settings. The local shared Clerk appearance now pins light variables/classes, but the full dark-mode pass should still validate live Clerk-rendered states.
- Visual polish + brand sweep (2026-05-23): nine commits resolving Tickets 1-5 of the polish plan after the competitive UX rating identified visual polish as Leasium's weakest dimension vs Re-Leased / PropertyMe / PropertyTree. Codex source-of-truth amendments in §3 (owner tag palette + two-tier naming), §4 (Body Compact 15px + Micro 11px), §5 (motion scale 150/200/300 + ease-in/toggle), §8 (empty-state convention), §9 (chip system). Tailwind config gained 36 owner-tag tokens, 11 short-alias variants, transition durations, exit easings, four custom fontSize steps. `globals.css` gained six @keyframes (drawer in/out left/right, modal in/out, backdrop in/out) and matching utility classes. New `useUnmountDelay` hook drives drawer/modal exit animations on 8 surfaces. New `chipClass()` helper in `components/ui.tsx` collapses every chip/pill/badge declaration through one tone × density × bordered surface. EmptyState component gained an `icon` slot; ~40 high-traffic empty states opt-in. Remba had been retired from the loop ("forget Remba, this is a prototype" at slice mid-point) so commits land without the [~] pending markers used in earlier slices.
- 2026-05-23 Remba sign-off note: the Token consistency pass v1 + Motion polish v1 items in `docs/design-governance.md` flipped `[~]` → `[x]` mid-session before Remba was retired. The follow-up Polish v2-v7 work landed without governance markers per the prototype-mode call.
- Behavioural baseline added at `CLAUDE.md` (repo root): the Forrest Chang / Andrej Karpathy four-principle file (~110k stars) plus Leasium-specific guardrails (provider mutation rule, Remba review, internal-first-6-months, push-to-Vercel review path, Mac/venv tooling notes). Future Claude Code / Codex sessions pick it up automatically.
- Latest live route sanity after push:
  - `/settings` returns `200` after redirecting signed-out users to `/sign-in?redirect_url=%2Fsettings`
  - `/notifications` returns `200` after redirecting signed-out users to `/sign-in?redirect_url=%2Fnotifications`
  - `/onboarding/tenant-token-1` now renders the retired-form redirect screen (still public, still `200`). Tenants land on a "Your onboarding has moved into your Leasium account" card with an "Open the tenant portal" CTA pointing to `/tenant-portal/{token}`.
- Product source of truth: `docs/product-roadmap.md`
- UX governance source of truth: `docs/design-governance.md`
- Mobile UX review (2026-05-23): `docs/mobile-ux-review-2026-05-23.md` — code-driven audit of operator + tenant surfaces at 360-480px, with prioritised backlog. First slice (Tenants list mobile card view) shipped alongside; remaining items are Remba-pending follow-ups.
- Automation strategy (2026-05-23): `docs/automation-strategy-2026-05-23.md` — names the controlling design principle ("take work off the operator; every screen should ask what to *approve*, not what to *enter*"), inventories current automation, and lists the full backlog from scheduled comms loop through DocuSign, WhatsApp, voice transcription, vacancy marketing, predictive maintenance, year-end tax pack. The product-roadmap.md "Automation backlog" section is the working list; this doc is the framing rationale.
- Brand/frontend source of truth: `docs/leasium-codex-design-source-of-truth.md`
- UX audit (2026-05-22): `docs/ux-review-2026-05-22.md` — the tiered roadmap is now fully shipped except dark mode.
- Nav-pattern research (2026-05-23): `docs/nav-pattern-research-2026-05-23.md` — captures the evidence behind the sidebar choice so Remba sign-off has the same reasoning the original review used.
- Design-facing changes still require Remba review before being treated as complete.
- 2026-05-26 continuation: owner statements now have an authenticated
  review-only per-owner PDF endpoint/download action plus a full-pack ZIP
  export, and Portfolio QA has a cleanup completion report, AI-assisted
  enrichment candidate queue, and reviewed bulk staging/saving for
  tenant-contact and owner-billing fixes. Both are review-first and do
  not run Xero, email, payment, or provider mutations.
- 2026-05-26 tenant onboarding simplification: onboarding remains
  account-first, but the invite gate now uses prefilled Clerk email-code
  sign-in/sign-up, the confirmation form is trimmed to 4 required fields
  plus optional details, the tenant checklist is now confirm/docs →
  review → sign, operator review/apply is combined into **Approve &
  apply**, and lease signing has focused `/tenant-portal/lease` and
  `/tenant-portal/[token]/lease` routes plus an operator-triggered
  **Send lease pack** action. The full tenant portal stays locked until
  lease signing is complete, and lease-pack emails use the account-scoped
  `/tenant-portal/lease` route so expired invite tokens do not block
  signing.
- Hosted sanity on 2026-05-26: `https://api.leasium.ai/health` returned
  200 with `{"status":"ok","app":"Leasium"}`. The public tenant invite
  preview route executed and returned a clean 404 for `tenant-token-1`
  rather than a schema error, which confirms the deployed API can read
  the `tenant_onboarding.token_consumed_at` column. Exact Render deploy
  log grepping for `20260524_0025` / `20260524_0026` still needs Render
  dashboard or MCP access.
- 2026-05-27 live verification: Neon production is at Alembic
  `20260524_0026`; `tenant_onboarding.token_consumed_at` exists; the
  `property_type` enum includes `residential`; `tenant-token-1` correctly
  shows the public "Invite not found" state. The prior stale-link 409
  concern appears resolved: production has one active tenant portal
  account linked to a non-deleted tenant. Temba's current live onboarding
  row is already claimed, submitted, reviewed, and applied; the remaining
  live blocker is attaching a custom lease file and explicitly clicking
  **Send lease pack** from the tenant detail page. Do not trigger this
  provider email without operator approval and the correct lease file.
- 2026-05-28 Xero Monday readiness: commits through `cf2a2f9` are pushed to
  `origin/main` and Vercel production deployment `dpl_HvcCaXcHErC2DQV6kuZnHktMWTnT`
  is ready on `https://leasium.ai`. The API health check passes, production
  OpenAPI includes `/api/v1/xero/connection-diagnostics`, and an unauthenticated
  diagnostics request returns 401 instead of the earlier 404, proving the route
  is live and protected. Chrome production verification found the signed-in
  Clerk email was `tembavj@outlook.com`; production Neon has active accepted
  operator access for `temba@skjcapital.com` on `SKJ Property Pty Ltd`, but no
  `app_user` row for `tembavj@outlook.com`. The UI therefore shows
  `Unknown Clerk user.` and no entity selector options. Do not start Xero OAuth
  until Temba either signs in with `temba@skjcapital.com` or explicitly approves
  adding/linking `tembavj@outlook.com` as an operator. Production currently has
  no Xero connection row for `SKJ Property Pty Ltd`.
- Follow-up verification after Temba signed into Chrome as `temba@skjcapital.com`:
  the production app now loads `SKJ Property Pty Ltd` and Settings → Xero reaches
  the diagnostics panel. The next blocker is API provider configuration: the UI
  reports missing `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, and
  `XERO_TOKEN_ENCRYPTION_KEY`, and disables Connect with Xero. Configure these
  on the Render API service, with
  `XERO_REDIRECT_URI=https://api.leasium.ai/api/v1/xero/oauth/callback`, before
  starting OAuth. `XERO_STATE_SECRET` is still recommended, although the current
  code can fall back to the client secret/Clerk secret for state signing. No
  Xero OAuth or provider mutation was started during this check.
- 2026-05-28 finance/Xero continuation: Xero connection diagnostics now include
  a read-only provider setup preflight block with required env vars, missing
  env vars, expected redirect URI, required scopes, and a setup checklist.
  Owner statements now include invoice-level evidence in JSON/PDF and an
  `INVOICE-EVIDENCE-{month}.csv` inside accountant ZIP packs, and the
  Statements finance checklist can download a local CSV. These are all
  review-only; no Xero refresh/write, email, payment reconciliation, provider
  attachment, or delivery-history mutation is performed.
- 2026-05-28 finance UI continuation: Settings Xero now surfaces the provider
  setup preflight in the diagnostics card, and `/statements` shows invoice
  evidence rows inside the selected owner statement preview. Both are
  read-only operator review surfaces; Connect with Xero still follows the
  diagnostics capability gate, and owner dispatch remains separate.
- 2026-05-28 finance UI continuation 2: Settings Xero can copy a provider setup
  packet containing the expected redirect URI, env vars, scopes, checklist, and
  guardrails for the Render/Xero handoff. Owner statement invoice evidence can
  be downloaded as a selected-owner CSV from the preview. Both are local UI
  conveniences only; no Xero, SendGrid, payment, owner dispatch, or provider
  history mutation is triggered.
- 2026-05-28 handoff export continuation: `/statements` now has a local
  month-end signoff CSV download, and Portfolio QA has a local cleanup report
  CSV download beside the existing copyable report. Both reuse already-loaded
  review data and do not call providers or mutate records.
- 2026-05-28 Operations continuation: completed maintenance work orders now
  show local copy actions for owner, tenant, and contractor completion
  communications beside the existing review receipts. These buttons copy the
  already-rendered closeout text only and show a "No message sent" receipt;
  they do not call SendGrid, Twilio, portal messaging, Xero, or provider
  history endpoints.
- 2026-05-28 Operations continuation 2: maintenance Activity now includes
  local forwarding drafts for tenant-to-contractor and contractor-to-tenant
  updates, derived from the latest visible timeline row for each side. The
  copy buttons are local only and do not send email/SMS, write portal messages,
  touch providers, or mutate work-order history.
- 2026-05-28 finance PDF continuation: owner statement PDFs now wrap long
  property names, invoice references, Xero IDs, bank references, and
  reconciliation IDs across readable lines/pages. Coverage lives in
  `tests/integration/test_owners_api.py`. The endpoints remain review-only
  GETs with no Xero, SendGrid, dispatch, delivery history, or payment
  reconciliation mutation.
- 2026-05-28 Portfolio QA continuation: the cleanup readiness report now has a
  row-level Blocker drilldown for active bulk groups, and
  `portfolio-qa-cleanup-report.csv` includes matching `Blocker drilldown` rows.
  This stays frontend/local-data only and does not run enrichment, onboarding,
  billing draft generation, Xero, email/SMS, or provider-history mutations.
- 2026-05-28 Xero exception export continuation: Settings -> Xero exception
  queue now has a passive copyable review packet and
  `xero-exception-review.csv` download from already-loaded exception rows.
  The export does not start OAuth, preview/apply mappings, post invoices,
  dispatch providers, refresh Xero, send email, or reconcile payments.
- 2026-05-28 Portfolio QA enrichment continuation: the enrichment queue now has
  a local `portfolio-qa-enrichment-queue.csv` download beside `Copy queue`,
  exporting candidate type, record label, missing fields, priority, impact,
  reason, action, and review guardrail text. It does not run enrichment
  preview/apply, OpenAI, SerpAPI, Xero, SendGrid, Twilio, onboarding, or
  billing draft mutations.
- 2026-05-28 Operations maintenance continuation: the completion review packet
  now has a local `maintenance-completion-review-{workOrderId}.csv` download
  beside `Copy packet`, generated from already-rendered work-order review data.
  It includes closeout evidence counts, recipient review statuses, billing
  handoff, latest activity, open review items, forwarding draft readiness, and
  review-only guardrail text. It does not send contractor email/SMS, update
  work-order status, write closeout or review metadata, touch Xero, tenant
  portal messaging, provider dispatch, billing, or provider history.
- 2026-05-28 Notifications continuation: Work notice center now has a local
  `work-notification-provider-readiness.csv` download from the already-loaded
  notification-center response. It exports Email/SendGrid, SMS/Twilio, and
  In-app/Leasium readiness, setup-check statuses, next actions, center
  guardrails, and no-send/no-mutation guardrail text. It does not exercise
  send, retry, SMS, digest send, mark-read, provider dispatch, refresh-token,
  provider-history, or read-state mutation paths.
- 2026-05-28 Comms continuation: `/comms` now has a local
  `comms-queue-review-{date}.csv` download from already-loaded
  `queueQuery.data?.candidates`, before any approve/dismiss/send interaction.
  It exports candidate kind, tenant/property/unit, channel, recipient readiness,
  severity, due/generated timestamps, subject/body preview, detail, session
  counts, and no-send/no-mutation guardrail text. It does not call comms
  dispatch, dismiss, evidence upload, SendGrid/Twilio sends, provider-history
  writes, candidate settlement, queue mutation, or provider refresh paths.
- 2026-05-28 Contractor directory continuation: `/contractors` now has a local
  `contractor-directory-readiness.csv` download from already-loaded contractor
  rows. It exports name, company, priority, categories, email/phone readiness,
  service radius, notes, AI-suggest readiness, and review-only guardrail text.
  It does not send contractor email/SMS, run maintenance AI classification,
  assign/update work-order contractors, create/update/delete contractors, write
  provider history, or dispatch receipts.
- 2026-05-28 Billing Readiness continuation: the Month-end handoff panel now has
  a local `billing-month-end-handoff-{month}.csv` download beside `Copy handoff`,
  generated from the already-built `MonthEndHandoff` object. It exports
  entity/month/status, approved invoice totals, provider dispatch
  readiness/recovery, payment review, owner statement readiness/missing
  recipients, open items, and review-only guardrail text. It does not run Xero
  draft creation, payment reconciliation preview/apply, tenant/owner email
  dispatch, billing draft generation, invoice dispatch, provider refresh, or
  provider-history mutation.
- 2026-05-28 Settings continuation: Settings Organisation now has a local
  `communication-template-overrides.csv` download from the Communication
  templates panel. It exports runtime template keys, stored override
  names/keys/versions/providers, active/inactive and system/override state,
  coverage status, and review-only guardrail text. It does not wire stored
  templates into send paths, add edit controls, send notifications/digests,
  send invoices/onboarding/contractor messages, mutate preferences, or write
  provider history.
- 2026-05-28 Insights continuation: `/insights` now has a local
  `insights-review-packet-{as_of}.csv` download from already-loaded overview and
  snapshot history. It exports live exceptions, automation activity,
  finance/accounting readiness, owner/entity gaps, lease events, saved snapshot
  status, overview guardrails, and review-only guardrail text. It does not add a
  backend export endpoint, create/revoke snapshots, refresh Xero/accounting,
  send providers, apply reconciliation, dispatch, or write provider history.
- 2026-05-28 Tenant portal continuation: the read-only operator preview route
  now has a local `tenant-portal-preview-{tenant}.csv` download generated from
  `getTenantPortalOperatorPreview()` response data. It exports tenant, lease,
  onboarding status, checklist rows, uploaded document names/counts, visible
  invoice/payment rows, maintenance rows, contact-change requests, preview
  guardrails, and no-mutation guardrail text. It does not call
  resend/fresh-link/send-portal-invite/apply/review, tenant portal
  claim/submit/contact-change apply/dismiss, SendGrid/Twilio, Xero, document
  upload/delete, provider dispatch, provider refresh, or provider-history
  writes.
- 2026-05-28 Operations continuation 3: `/operations` now has a local
  `operations-work-queue-review.csv` download from the currently visible queue
  rows. It exports item kind, title, property/tenant context, due date, urgency
  chip, completion state, assignee, notification status, reminder/escalation
  cues, and review-only guardrail text. It does not call notification
  sends/digests, maintenance/arrears update mutations, backend export endpoints,
  Xero, invoice dispatch, payment reconciliation, onboarding send/resend,
  billing draft generation, provider refresh, or provider history.
- 2026-05-28 Statements continuation: `/statements` now has a local
  `owner-statement-dispatch-review-{month}.csv` download from existing
  `StatementDispatchReviewRow` data. It exports queue summary, approval runway,
  owner, status, recipient/missing recipient, subject, invoice/property counts,
  outstanding amount, and review-only guardrails. It does not call owner
  PDF/PDF-pack downloads, comms dispatch, invoice dispatch, Xero
  preview/apply/create-draft, payment reconciliation, owner email paths,
  provider refresh, or provider-history endpoints.
- 2026-05-28 Statements continuation 2: the selected owner Dispatch review panel
  now has a local `owner-statement-dispatch-draft-{month}-{owner}.txt`
  download beside `Copy dispatch draft`, reusing the selected owner's
  already-loaded statement data. It includes recipient/missing-recipient,
  subject, owner-facing body, owner totals, and a guardrail line. It does not
  call owner email, comms dispatch, PDF/PDF-pack downloads, Xero, payment
  reconciliation, invoice dispatch, provider refresh, or provider-history
  endpoints.
- 2026-05-28 Settings Xero continuation: Settings → Xero provider setup
  preflight now has a local `xero-provider-setup-packet.txt` download beside
  `Copy setup packet`, reusing `xeroProviderSetupPacket(xeroDiagnostics)`.
  It exports expected redirect URI, required/missing env vars, scopes, setup
  checklist, and diagnostics guardrails. It does not call OAuth, Xero
  preview/apply/create-draft, SendGrid, Twilio, invoice dispatch, payment
  reconciliation, provider refresh, or provider-history endpoints.
- 2026-05-28 Settings Xero continuation 2: Settings Xero accounting freshness
  snapshot now has a local `xero-accounting-freshness.csv` export from the
  already-loaded `/xero/status` freshness snapshot and computed next accounting
  step. It includes checkpoint timestamps, stale/current reconciliation state,
  readiness counts, payment cues, freshness guardrails, and export guardrails.
  It also fixes the singular next-step copy to read `invoice needs`. It does not
  refresh Xero, preview/apply reconciliation, create Xero drafts, dispatch
  invoices, send email/SMS, refresh providers, or mutate provider history.
- 2026-05-28 Settings Xero continuation 3: the same Accounting freshness
  snapshot now has `Copy freshness packet`, reusing the already-loaded
  `status.accounting_freshness` and computed `accountingStep` data. The smoke
  test reads clipboard text and verifies the packet contains status/stale
  reconciliation/next-step/guardrail content. It does not add a backend route,
  refetch status, invalidate queries, refresh Xero, preview/apply
  reconciliation, create Xero drafts, dispatch invoices, send email/SMS, refresh
  providers, or mutate provider history.
- 2026-05-28 Settings Xero continuation 4: Connection diagnostics now has a
  local `xero-connection-diagnostics.csv` export from the already-loaded
  `xeroDiagnostics` block. It includes connection source, tenant/org context,
  token expiry, readiness gates, provider/missing config, redirect URI, required
  env vars/scopes, next steps, diagnostics guardrails, and an export guardrail.
  It does not start OAuth, call or refresh Xero, preview/apply reconciliation,
  create Xero drafts, dispatch invoices/providers, send email/SMS, refresh
  providers, or mutate provider history.
- 2026-05-29 tenant lifecycle push: tenant portal `lease` and `insurance`
  uploads now auto-promote supported PDF/DOCX/TXT/MD files into Smart Intake
  with tenant/onboarding/lease scope and review-first guardrails. When OpenAI
  is configured, promoted tenant uploads now auto-extract in the background so
  the operator gets a ready-to-review Smart Intake item; when OpenAI is absent,
  the upload remains a normal promoted queue row. Extracted tenant lease uploads
  now include a `lease_auto_match` recommendation against the scoped lease,
  with matched fields, differences, missing fields, and a no-mutation guardrail.
  Smart Intake now renders that match recommendation in the review panel so the
  operator can see whether the tenant-uploaded lease matches the scoped lease
  before applying anything. Matched tenant lease uploads can now be accepted via
  `POST /api/v1/document-intakes/{id}/accept-lease-match`; that marks the
  intake applied, links the document to the existing lease, stamps onboarding
  signing as completed by `tenant_upload`, and queues the existing
  activation-review handoff for pending leases without mutating lease
  status/register values or creating a `LeaseIntake`. The accept endpoint is
  deliberately narrow: tenant-portal source only, onboarding-scoped only, and
  blocked if differences or missing fields remain. It also requires the stored
  document and onboarding scope to match the accepted lease before relinking the
  upload or stamping the signing handoff. It also now blocks while an active
  DocuSign envelope is queued/sent/delivered for the same onboarding so
  tenant-uploaded signing cannot silently supersede an unresolved provider
  envelope. Reviewed scoped
  `insurance_certificate` applies now update tenant insurance metadata
  (`insurance_confirmed`, expiry, source document/intake ids, review history)
  in addition to creating the renewal obligation. If the reviewed document is
  lease-scoped, insurance metadata follows that lease tenant and corrects stale
  document tenant scope before writing history. Upload/extraction keeps the
  tenant-selected document category stable, preserves tenant-portal source/
  candidate/scope/guardrail metadata through extraction, labels tenant-uploaded
  insurance rows in Smart Intake as tenant portal uploads, and stores AI
  classification only as proposed metadata until review/apply. Tenant detail
  now shows the confirmed insurance expiry plus source document/review links.
  **Send lease pack** now
  requires an attached lease document server-side, calls the DocuSign signature
  helper, stores a DocuSign receipt in `delivery_data.lease_pack.docusign`,
  stores queued/sent envelope metadata under `delivery_data.lease_agreement.signing`,
  and blocks tenant-side Leasium click-signing while a DocuSign envelope is
  queued/sent. The tenant portal session read model now also fails closed for
  active DocuSign signing metadata (`queued`, `sent`, or `delivered`): it
  reports `not_ready`, exposes the DocuSign provider/status fields, and tells
  tenants to complete DocuSign instead of enabling Leasium signing.
  `stewart.integrations.docusign.send_lease_for_signature` now
  performs JWT grant + envelope create when the four required DocuSign env vars
  are configured, and soft-skips when config or signer email is missing. The
  DocuSign Connect endpoint `POST /api/v1/tenant-onboarding/webhooks/docusign`
  now requires `DOCUSIGN_WEBHOOK_SECRET`, rejects unsigned Connect events, and
  marks completed envelopes signed idempotently only when the current signing
  record is an active DocuSign envelope. On completion it downloads DocuSign's
  completed combined PDF and stores it once as a signed lease document scoped to
  the tenant/onboarding/lease. Envelope create now includes hidden custom fields
  for lease id, tenant onboarding id, source document id, entity id, property,
  and unit so provider-console traces can be matched back to Leasium. If
  DocuSign echoes those Leasium custom fields in Connect payloads, the webhook
  validates each present id before accepting completion; omitted fields remain
  allowed for simpler Connect configurations.
  Non-completion events such as declined/voided are
  now retained as provider events and shown as DocuSign attention states without
  marking the lease signed or downloading a PDF; delivered envelopes stay
  blocked from duplicate operator **Send lease pack** attempts and local Leasium
  signing until DocuSign completes or an operator resolves the provider state.
  Tenant detail now offers **Send again** for
  declined/voided/failed/skipped DocuSign states when the lease document is
  still attached, creating a fresh envelope and preserving the previous
  lease-pack attempt in history. Tenant detail now surfaces promoted Smart Intake
  upload status, DocuSign signing status, and a direct signed lease download
  when retention succeeds. Completion also stamps a review-safe
  `lease_activation_review` marker; pending leases are shown as ready for
  explicit activation review, but `Lease.status` is not changed automatically.
  Operators can now click an explicit tenant-detail **Activate lease** action
  after signed completion; that route activates only pending leases and stamps
  lease metadata/signing history. The backend activation route now also
  requires `lease_activation_review.status = ready_for_review`, so malformed or
  legacy signed-looking metadata cannot bypass the review marker. Settings >
  Organisation > Integrations now
  reports DocuSign readiness, shows the Connect webhook URL when
  `PUBLIC_API_URL` is set, warns when credentials are present but
  `DOCUSIGN_WEBHOOK_SECRET` is still missing, warns specifically when
  `PUBLIC_API_URL` is the remaining Connect blocker, and provides local
  copy/download actions for a review-only DocuSign provider setup packet. Next
  slice is provider-console
  verification with real DocuSign credentials: configure the DocuSign JWT app,
  RSA key, account GUID, integration key, and impersonated service-user GUID;
  set `DOCUSIGN_WEBHOOK_SECRET`; point DocuSign Connect at
  `https://api.leasium.ai/api/v1/tenant-onboarding/webhooks/docusign`; complete
  one test envelope; confirm the signed PDF is retained once under the
  tenant/onboarding/lease scope; then review and explicitly click tenant-detail
  **Activate lease**. Keep this operator-approved and provider-scoped: do not
  expose secrets, do not send a lease pack without the correct attached lease
  file, and do not treat webhook completion as automatic lease activation.
  Plan: `docs/superpowers/plans/2026-05-29-tenant-lifecycle-two-day-push.md`.
- 2026-05-28 Settings Xero continuation 5: Connection diagnostics now has a
  local `Copy diagnostics packet` action beside `Download diagnostics CSV`,
  reusing the already-loaded `xeroDiagnostics` block. The smoke test reads the
  clipboard and verifies connection context, readiness gates, provider setup,
  env vars, diagnostics guardrails, and the export guardrail. It does not add a
  backend route, refetch diagnostics, start OAuth, call/refresh Xero,
  preview/apply reconciliation, create drafts, dispatch invoices/providers, send
  email/SMS, refresh providers, or mutate provider history.
- 2026-05-28 Settings Xero continuation 6: Connection diagnostics now has a
  local `Download diagnostics packet` text export beside
  `Copy diagnostics packet`, using the same
  `xeroConnectionDiagnosticsPacket(xeroDiagnostics)` content and filename
  `xero-connection-diagnostics.txt`. The smoke test downloads the TXT and
  verifies the same packet content and guardrails. It does not add a backend
  route, refetch diagnostics, start OAuth, call/refresh Xero, preview/apply
  reconciliation, create drafts, dispatch invoices/providers, send email/SMS,
  refresh providers, or mutate provider history.
- 2026-05-28 Settings Xero continuation 7: Connection diagnostics readiness
  rows now include short local reasons for each provider action gate, derived
  only from the already-loaded `xeroDiagnostics` response. The smoke test
  confirms the unconnected fixture keeps Draft creation `Blocked` and explains
  that Xero must be connected before provider previews and draft creation are
  available. It does not derive readiness from `/xero/status`, invoice drafts,
  exception queues, local UI mutation state, or optimistic state, and it does
  not start OAuth, refresh tokens, call Xero, create drafts, dispatch providers,
  send email/SMS, reconcile payments, write provider history, or change local
  approval state.
- 2026-05-28 Settings Xero continuation 8: the readiness explainer now has a
  mock-only smoke fixture for diagnostics where `can_create_xero_drafts=true`.
  The test confirms the Draft creation readiness card shows `Ready` and the
  reviewed-action reason only from the diagnostics fixture. It does not start
  OAuth, refresh tokens, call Xero, create drafts, dispatch providers, send
  email/SMS, reconcile payments, write provider history, or change local
  approval state.
- 2026-05-28 Settings Xero continuation 9: the same draft-ready diagnostics
  smoke now downloads `xero-connection-diagnostics.csv` and
  `xero-connection-diagnostics.txt`, asserting provider/source context, Draft
  creation `Ready`, Payments `Blocked`, local readiness reasons, next steps, and
  review-only guardrails. The CSV/TXT exports now reuse the readiness explainer
  details. It remains test/export coverage only: no OAuth start, token refresh,
  Xero API call, draft creation, provider dispatch, email/SMS, payment
  reconciliation, or provider-history write.
- 2026-05-28 Settings Xero continuation 10: the draft-ready diagnostics smoke
  now also clicks `Copy diagnostics packet`, reads the clipboard, and asserts it
  contains provider/source details, Draft creation `Ready`, Payments `Blocked`,
  the local readiness reason, and the review-only diagnostics guardrail. The
  same test now traps forbidden provider endpoints during CSV/TXT/copy actions,
  proving those local exports do not start OAuth, preview contacts/chart/tax,
  preview posting, create Xero drafts, dispatch providers, or run payment
  reconciliation.
- 2026-05-28 Settings Xero continuation 11: the unconnected diagnostics section
  in `settings shows Xero readiness and records mappings` now has the same
  forbidden-request trap around CSV/TXT/copy actions, scoped before the later
  manual tenant save and reviewed provider workflow. It proves local diagnostics
  exports do not start OAuth, preview contacts/chart/tax, preview posting, create
  Xero drafts, dispatch providers, or run payment reconciliation before the test
  intentionally exercises reviewed provider flows.
- 2026-05-28 Settings Xero continuation 12: the Settings smoke now uses a shared
  forbidden-provider-request watcher for review-only Xero exports. Exception
  queue copy/download, accounting freshness CSV/copy, unconnected diagnostics
  CSV/TXT/copy, and draft-ready diagnostics CSV/TXT/copy all assert no OAuth
  start, contact/chart/tax/posting preview, draft creation, provider dispatch, or
  payment reconciliation request occurs during local export actions.
- 2026-05-28 Settings Xero continuation 13: provider setup preflight export
  smoke coverage now asserts `Copy setup packet` clipboard content and
  `Download setup packet` TXT content both include env vars, expected redirect
  URI, required scopes, setup checklist, and diagnostics guardrails. The same
  forbidden-provider-request watcher proves setup packet copy/download does not
  start OAuth, call Xero previews, create drafts, dispatch providers, or run
  payment reconciliation.
- 2026-05-28 Settings Xero continuation 14: backend diagnostics contract
  coverage now asserts `GET /api/v1/xero/connection-diagnostics` returns stable
  provider setup preflight fields, including required/missing env vars, expected
  redirect URI, required scopes, setup checklist, and diagnostics guardrails.
  The checklist now explicitly tells operators to set
  `XERO_REDIRECT_URI=<expected callback>` and `XERO_STATE_SECRET` before
  production OAuth. The focused backend coverage monkeypatches provider actions
  to fail if touched and confirms diagnostics remains local/read-only with no
  token refresh, Xero API call, draft creation, provider dispatch, email/SMS,
  payment reconciliation, provider-history write, or audit mutation.
- 2026-05-28 Settings Xero continuation 15: frontend smoke coverage now mocks
  `/api/v1/xero/connection-diagnostics` as unavailable and proves Settings Xero
  fails closed. The diagnostics query does not retry in this operator flow; the
  UI shows the API error plus "Provider actions stay disabled until Xero
  diagnostics reload.", hides diagnostics/setup exports, keeps Connect with
  Xero plus contact/chart-tax/invoice/payment provider previews disabled, and
  asserts no OAuth, Xero preview/apply, draft creation, provider dispatch, or
  payment reconciliation request fires.
- 2026-05-29 Settings Xero continuation 16: frontend smoke coverage now also
  mocks `GET /api/v1/xero/connection-diagnostics` returning 401 (missing Clerk
  bearer token) and 403 (operator access required). Both paths prove Settings
  Xero fails closed: diagnostics/setup exports stay hidden, provider actions
  remain disabled, and no OAuth, Xero preview/apply, draft creation, provider
  dispatch, or payment reconciliation request fires. This is mock-only safety
  coverage; the live Xero rehearsal still needs production credentials.
- 2026-05-29 comms automation continuation: SendGrid inbound email attachments
  are now routed into Stored Documents plus Smart Intake review rows tied back
  to the inbound message and attributed tenant when the sender matches a tenant
  email. When `OPENAI_API_KEY` is configured, attachment intakes are
  pre-extracted into `ready_for_review`/`needs_attention`; extraction failures
  soft-fail the intake as `failed` without losing the stored attachment or
  inbound message. The comms queue candidate detail calls out the attachment
  count routed to Smart Intake, and the `/comms` smoke fixture now includes an
  inbound email attachment draft plus CSV coverage. This remains review-first:
  no tenant data, lease data, provider action, payment record, SendGrid reply,
  or Twilio message is changed until an operator approves the next step.
- 2026-05-29 comms automation continuation 2: SendGrid inbound parse can now be
  protected with `SENDGRID_INBOUND_SECRET`. When configured, the webhook rejects
  missing/wrong secrets before persisting an inbound message; SendGrid can pass
  the value as `token`, `secret`, `X-Leasium-SendGrid-Inbound-Secret`, or
  `X-SendGrid-Inbound-Secret`. Deployment docs now show the tokenized inbound
  parse URL, so live DNS/MX should not be enabled until that env var is set.
- Sidecar recommendation for the next slice: add operator-facing Smart Intake
  filters/copy for inbound-email attachment rows, or move to the next
  tenant-lifecycle guardrail.

## Takeover Priority

1. Read `CLAUDE.md` at the repo root before starting. It encodes the behavioural baseline (state assumptions, simplest possible change, surgical edits, verifiable success criteria) plus the Leasium-specific guardrails.
2. Run `git status --short` and `git log --oneline -10` to confirm the tree is clean and the tip includes the latest Codex continuation slices.
3. Production schema verification is complete as of 2026-05-27:
   `alembic_version` is `20260524_0026`, `token_consumed_at` exists, and
   `residential` is present in `property_type`.
4. **Outstanding live tenant step:** Temba's active onboarding is already
   claimed/submitted/reviewed/applied. Open tenant
   `019e6272-9879-786a-aa88-abfd1aa9fa48`, attach the intended custom
   lease file, then explicitly send the lease pack. This is a real
   provider email, so it requires operator approval.
5. **Top priority (2026-05-31): the DoorLoop benchmark refocus (P0).** Start with the People-hub + IA execution plan at [`docs/superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md`](superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md), Ticket 1.1 (the `Owner` entity, red test first). Backlog context: `docs/product-roadmap.md` → "DoorLoop benchmark refocus". The older candidates (owner-statement PDF formatting, Portfolio QA bulk review, Operations mobile live-review) drop below this.
6. Keep all provider actions review-first: no Xero mutation, SendGrid email, Twilio SMS, tenant email, or payment reconciliation should happen without explicit operator approval.

## Project Map

- `apps/api`: FastAPI app, routers, request/response schemas, and API entrypoint.
- `stewart/core`: settings, auth, SQLAlchemy models, audit helpers, database setup, IDs.
- `stewart/ai`: document, lease, and public enrichment extraction helpers.
- `stewart/integrations`: provider adapters for communications, storage, Xero, Slack, and email.
- `migrations/versions`: Alembic revisions. Hosted deployments must include the full tree.
- `apps/web`: Next.js 15 App Router frontend.
- `apps/web/src/app`: route surfaces such as Dashboard, Smart Intake, Properties, Tenants, Operations, Settings, Notifications, Billing Readiness, Insights, tenant onboarding, and tenant portal.
- `apps/web/src/components`: shared UI and workspace components.
- `apps/web/src/lib/api.ts`: frontend API client and shared response types.
- `tests/integration`: backend workflow coverage.
- `apps/web/tests/smoke`: Playwright smoke coverage with API fixtures.
- `docs/product-roadmap.md`: built roadmap and next build order.
- `docs/design-governance.md`: Remba review queue and design-facing change log.
- `docs/deployment.md`: deployment/env/provider setup details.

## Local Connection And Tooling

- Local repo path: `/Users/tembavanjaarsveld/Documents/Stewart`
- Local API: `http://localhost:8000`
- Local web app: `http://localhost:3000`
- Local API base for web: `http://localhost:8000/api/v1`
- Production frontend: `https://leasium.ai`
- Vercel provider alias: `https://leasium.vercel.app`
- Production API base for the web app: `https://api.leasium.ai/api/v1`
- GitHub remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Backend runtime: Python 3.12 with `.venv` already present.
- Frontend dependencies: `apps/web/node_modules` already present.
- `uv` and `pnpm` are not available in this shell right now; use `.venv/bin/python`, `.venv/bin/alembic`, `.venv/bin/uvicorn`, and `apps/web/node_modules/.bin/...` directly.
- `make lint` is the fast merge gate: Ruff + frontend ESLint + frontend TypeScript.
- `make typecheck` includes Python mypy and currently represents tracked strict-mode debt, not the day-to-day merge gate.
- Xero Monday priority: connect OAuth in production, verify contact preview, chart/tax preview, invoice posting preview, approved Xero draft creation, and payment reconciliation preview/apply with explicit operator approvals.
- Local services come from `docker-compose.yml`: Postgres on `5432`, Redis on `6379`, MinIO on `9000`, MinIO console on `9001`.
- Dev auth defaults to `AUTH_MODE=dev` with the deterministic Temba operator values in `.env.example`.
- Clerk mode is used in production/staging operator auth. Public tenant onboarding, tenant portal tokens, first setup, invite acceptance, sign-in/sign-up, and access gate pages remain public.

Useful commands:

```bash
# Start local infra
docker compose up -d

# Apply migrations
.venv/bin/alembic upgrade head

# Seed local data
.venv/bin/python -m scripts.seed

# Start API
.venv/bin/uvicorn apps.api.main:app --reload --host 0.0.0.0 --port 8000

# Start web app from apps/web
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next dev

# Backend checks
.venv/bin/python -m ruff check apps stewart tests scripts
.venv/bin/python -m pytest

# Frontend checks from apps/web
./node_modules/.bin/eslint src
./node_modules/.bin/tsc --noEmit
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build
./node_modules/.bin/playwright test
```

## Xero Monday Verification

Use this as the production rehearsal path after the environment variables and Xero app redirect URI are confirmed:

1. Open Settings -> Xero for the production entity and confirm connection diagnostics show provider config, role/scope readiness, and no hidden Xero calls on load.
2. Connect OAuth through Xero and return to Settings with the `Xero connected` callback feedback visible.
3. Run contact preview and confirm contacts are previewed or safely return zero results without applying mappings automatically.
4. Run chart/tax validation preview and confirm every charge rule has an account and tax mapping before invoice posting review.
5. Run invoice posting preview and confirm payloads/blockers are visible without posting to Xero.
6. Explicitly approve only the intended invoice drafts for Xero posting.
7. Create Xero DRAFT invoices only after operator approval; verify retry/idempotency does not duplicate drafts.
8. Run provider dispatch only when both Xero draft creation and tenant email delivery are explicitly approved.
9. Run payment reconciliation preview/apply only as a reviewed local Leasium metadata update; do not create or edit Xero bank transactions.

Local proof set:

```bash
.venv/bin/python -m pytest tests/integration/test_xero_api.py -q
.venv/bin/python -m pytest \
  tests/integration/test_xero_api.py::test_xero_connection_diagnostics_configured_without_connection_is_read_only \
  tests/integration/test_xero_api.py::test_xero_connection_diagnostics_full_scopes_unlock_provider_actions \
  tests/integration/test_xero_api.py::test_xero_connection_diagnostics_viewer_cannot_use_provider_actions \
  tests/integration/test_xero_api.py::test_xero_oauth_callback_records_provider_connection \
  tests/integration/test_xero_api.py::test_xero_contact_sync_preview_suggests_matches_without_applying \
  tests/integration/test_xero_api.py::test_xero_chart_tax_validation_preview_checks_provider_accounts_and_tax_rates \
  tests/integration/test_xero_api.py::test_xero_invoice_posting_preview_builds_payload_without_posting \
  tests/integration/test_xero_api.py::test_xero_invoice_posting_preview_requires_provider_connection \
  tests/integration/test_xero_api.py::test_xero_invoice_posting_preview_blocks_connected_invoice_with_missing_mapping \
  tests/integration/test_xero_api.py::test_xero_invoice_draft_create_requires_explicit_posting_approval_before_write \
  tests/integration/test_xero_api.py::test_xero_posting_approval_then_draft_create_is_idempotent \
  tests/integration/test_xero_api.py::test_xero_provider_dispatch_creates_xero_then_sends_email_idempotently \
  tests/integration/test_xero_api.py::test_xero_provider_dispatch_persists_failed_attempt_and_retries \
  tests/integration/test_xero_api.py::test_xero_payment_reconciliation_preview_and_apply_are_idempotent \
  tests/integration/test_xero_api.py::test_xero_provider_payment_reconciliation_fetches_xero_invoices \
  -q
```

Hard guardrail: never run Xero draft creation, provider dispatch, tenant email, payment apply, or any payment reconciliation against production data without explicit operator approval at that moment.

## Active Local Tree

2026-05-24 (later): **Tenant portal soft-switch claim gate.** Closes the magic-link weakness on `/tenant-portal/{token}` — the bare URL no longer reveals portal data without a Clerk session.

Backend
- New alembic migration `20260524_0026` adds `tenant_onboarding.token_consumed_at` (nullable timestamp; Postgres `op.add_column`, SQLite no-op happens through the same path).
- `TenantOnboarding` model gains the matching field.
- `_portal_scope` in `apps/api/routers/tenant_portal.py` now refuses tokens where `token_consumed_at is not null` with **HTTP 410 Gone**. Every token-scoped data endpoint (session, documents, maintenance, payments, onboarding submit, notification prefs) flows through this helper, so they all gate at once.
- `_portal_scope` gains an `allow_consumed=False` flag. Only `claim_tenant_portal_account` passes `allow_consumed=True` — and then enforces its own check: a consumed token may only be re-claimed by a Clerk user who already has an active `TenantPortalAccount` linked to the same tenant. Anyone else gets 410.
- `claim_tenant_portal_account` stamps `token_consumed_at = now()` on first successful claim (idempotent on re-claim).
- New public `GET /api/v1/tenant-portal/invites/{token}/preview` endpoint returns the minimum-viable context for the claim gate: property name, property address, tenant display name, expiry, claimable boolean. Never returns financial data / contact details / documents. Used by the unauthenticated gate to show "you've been invited to {property}" before the tenant signs in.

Frontend
- `/tenant-portal/{token}` now renders a full-page claim gate via `apps/web/src/app/tenant-portal/tenant-portal-content.tsx`. When `token && !accountPortal` the page shows ONLY the invite preview + Clerk sign-in/sign-up. After Clerk auth a top-level `gateClaimMutation` auto-fires `claimTenantPortalAccount(token, authToken)`, links the `TenantPortalAccount`, and the existing portal content takes over.
- The unauthenticated `portalQuery` (token-scoped `/tenant-portal/session`) is disabled entirely (`enabled: false`) — every data read flows through `getTenantPortalAccountSession(authToken)` post-claim.
- Gate handles four states cleanly: preview loading, invite not found / expired, "this invite has been used" (claimable=false), and "linking your account…" (signed-in claim in flight).
- `apps/web/src/lib/api.ts` gains `TenantPortalInvitePreviewRecord` + `getTenantPortalInvitePreview(token)`.

Tests
- `tests/integration/test_tenant_portal_api.py` — the existing `test_tenant_portal_account_claim_links_account_and_returns_account_scoped_portal` test had an explicit "after claim, the bare token still works" assertion that contradicts the soft switch. Flipped to assert `token_consumed_at is not None` + token endpoint now returns **410 Gone**.

Files touched: `migrations/versions/20260524_0026_tenant_portal_token_consumed.py` (new), `stewart/core/models.py`, `apps/api/routers/tenant_portal.py`, `apps/api/schemas/tenant_portal.py`, `apps/web/src/app/tenant-portal/tenant-portal-content.tsx`, `apps/web/src/lib/api.ts`, `tests/integration/test_tenant_portal_api.py`.

Sandbox ESLint + tsc clean. Backend pytest pending Mac-side run.

Mac-side verification for the soft-switch claim gate:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m ruff check apps/api/routers/tenant_portal.py apps/api/schemas/tenant_portal.py stewart/core/models.py migrations/versions/20260524_0026_tenant_portal_token_consumed.py tests/integration/test_tenant_portal_api.py
.venv/bin/alembic upgrade head
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py -q
```

Hosted Neon/Render needs migration `20260524_0026` applied next deploy. The migration is non-destructive (additive nullable column) so a rollback is safe.

Behavioural change for tenants on existing invite links: any link sent before this deploy still works for first claim. After they sign in once and claim, the link goes dead — they must use their Clerk-linked account from then on. No data migration required.

Behavioural change for operators: the "Preview as tenant" affordance (which opens the token URL) now lands on a sign-in wall — operators can't shadow a tenant by opening their invite URL. If you need a tenant-perspective view, build a read-only operator-side preview as a separate slice.

---

2026-05-24 (three small UX/data-model fixes, all unstaged):

**(c) Residential property type + ABN contextual on tenant forms.** New `residential` value added to `PropertyType` enum (Postgres ALTER TYPE migration `20260524_0025`; SQLite is a no-op since enums store as TEXT). Lease intake schema gets the new value. Frontend `PropertyType` union extended; `propertyTypes` label map gets "Residential"; the zod `property_type` enum in property-workspace also picks up the new value. `TenantLeaseContextRead` projection now carries `property_type` (backend + frontend types). Tenant detail edit form computes `tenantIsResidential = any lease is on a residential property` and hides the Trading-as + ABN fields in both the edit form and the read-only Profile panel when true — residential rentals don't carry those. Other tenant surfaces (list, DetailDrawer) still show ABN as `-` when blank, which is fine.

**(b) Smarter Unit picker on Send invite.** `/tenants` Send invite form now adapts to the property's unit count: 0 units → picker hidden, "Auto: Main premises will be created on send" hint shown, and the submit handler calls `createTenancyUnit({property_id, unit_label: "Main premises", sqm: null, parking_spaces: null})` before `createLease`. 1 unit → auto-selected, shown as a non-interactive chip. 2+ → required dropdown stays as before. `canSubmitInvite` updated to accept the auto-create + auto-select modes. Lease editor in property-workspace was surveyed but didn't need the same logic (the editor opens from a specific unit row so the operator already has one selected).

**(a) Tenant delete affordance on `/tenants/[tenantId]`.** Added a "Delete tenant" SecondaryButton next to the existing "Edit profile" button in the detail-page header. window.confirm() pattern matches the contractor remove flow; confirm message includes a warning about active leases that will lose their tenant link. Hits the existing `DELETE /api/v1/tenants/{id}` (soft delete via deleted_at). On success invalidates tenants / tenant / tenant-detail caches and `router.push("/tenants")`.

Frontend ESLint + tsc clean in the sandbox. Files touched: `apps/web/src/{app/tenants/page.tsx,app/tenants/[tenantId]/page.tsx,components/property-workspace.tsx,lib/api.ts}` + `stewart/core/models.py` + `stewart/ai/lease_intake.py` + `apps/api/schemas/register.py` + `apps/api/routers/tenants.py` + new `migrations/versions/20260524_0025_residential_property_type.py`.

Mac-side verification for slices (b) + (c):

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m ruff check stewart/core/models.py stewart/ai/lease_intake.py apps/api/schemas/register.py apps/api/routers/tenants.py migrations/versions/20260524_0025_residential_property_type.py
.venv/bin/alembic upgrade head  # local sqlite no-op for the enum; postgres ALTER TYPE runs in autocommit block
.venv/bin/python -m pytest tests/integration/test_register_api.py tests/integration/test_tenant_portal_api.py -q  # spot-check the projection change didn't break anything
```

Hosted Neon/Render will need the new migration applied. The autocommit block handles the `ALTER TYPE ... ADD VALUE` requirement for older Postgres versions; on 12+ it's redundant but harmless.

Previously this session — 2026-05-23 (even-later-still same day): AI inbox v2.2 — contractor/vendor matching + promote. Unstaged slice on top of v2.1:

- New `stewart/ai/vendor_intake.py` — strict-JSON extractor returning name / company_name / email / phone / categories / notes / confidence / warnings for promoting an unmatched vendor message into a draft Contractor row.
- `stewart/ai/inbox.py` — schema gains `suggested_contractor_id` (optional, null when unmatched). Prompt instructs the model to copy verbatim ids from the new `entity_index["contractors"]` block.
- `apps/api/schemas/ai.py` — `InboxTriageRead` gains `suggested_contractor`. `InboxPromoteKind` extended with `vendor_or_contractor`. `InboxPromoteTargetKind` extended with `contractor`. `InboxPromoteRequest` gains `contractor_id`.
- `apps/api/routers/ai.py` — entity index helper includes contractors (`_contractor_label` shows `"name (company)"`). New `_contractor_in_entity` validator. Promote endpoint vendor branch: matched contractor → no draft, target_href `/contractors`; unmatched → run vendor extractor, create Contractor row at priority=3 with extracted fields; soft-fail when extractor raises → minimal Contractor seeded from triage summary with `contractor_metadata["extraction_error"]`. Categories drawn from `stewart/ai/maintenance.MAINTENANCE_CATEGORIES` so new entries plug into the maintenance dispatch matcher.
- `tests/integration/test_ai_triage_api.py` — existing triage tests updated for the new `suggested_contractor_id` schema field + audit input key. Four new tests: matched-vendor-routes-no-draft, unmatched-vendor-extracts-new-contractor, extractor-soft-fails-to-minimal-row, cross-entity-contractor-rejected. Total file now 14 cases.
- `apps/web/src/lib/api.ts` — types + promote payload extended.
- `apps/web/src/app/inbox/page.tsx` — promote panel swaps property/tenant/lease pickers for a single Contractor dropdown when kind is `vendor_or_contractor` (empty option = "Create new contractor"). Button label switches between "Open contractor profile" and "Add to contractor directory" based on selection.
- `apps/web/tests/smoke/api-mocks.ts` — triage mock includes `suggested_contractor: null`.
- `apps/web/tests/smoke/app-flows.spec.ts` — new spec exercises the vendor classification path via per-test route overrides; asserts the contractor dropdown is shown (not the property/tenant ones) and Promote routes to `/contractors`.
- Docs: `docs/product-roadmap.md` AI inbox v2.2 entry marked `[~]`.

Sandbox ESLint + tsc clean. Backend pytest + Playwright pending Mac-side run.

Mac-side verification for v2.2:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m ruff check stewart/ai/vendor_intake.py stewart/ai/inbox.py apps/api/schemas/ai.py apps/api/routers/ai.py tests/integration/test_ai_triage_api.py
.venv/bin/python -m pytest tests/integration/test_ai_triage_api.py -q
# Expect: 14 passing.

cd apps/web
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs \
  ./node_modules/.bin/playwright test --grep "AI inbox"
# Expect: 3 passing (deep-link + maintenance promote + vendor contractor picker).
```

---

Previously this session: 2026-05-23 (even later same day): AI inbox v2.1 — pre-extract lease-change facts at promote time. Unstaged slice on top of v2:

- New `stewart/ai/lease_change.py` — strict-JSON OpenAI extractor that returns parties / properties / key_dates / money_amounts / proposed_actions / summary / confidence / warnings shaped to the existing `DocumentIntakeExtraction` keys.
- `apps/api/routers/ai.py` — promote endpoint now takes `settings` Depends; lease_change branch builds a compact `_lease_snapshot(...)` (current expiry / current rent / next review) from the operator-matched lease, calls the extractor, stamps `extracted_data` / `summary` / `confidence` / `openai_response_id` on the DocumentIntake, and chooses `ready_for_review` vs `needs_attention` from the confidence score. Soft-fails to v2.0 behaviour (uploaded status, `review_data["extraction_error"]`) when the API key is unset or the call raises.
- `tests/integration/test_ai_triage_api.py` — existing `test_promote_lease_change_creates_intake_with_text_document` renamed to `test_promote_lease_change_soft_fails_without_openai_key` and assertions updated for the soft-fail path. Three new tests added: pre-extracts-fields-when-available (asserts ready_for_review + extracted_data + lease_snapshot was passed through), low-confidence-lands-needs_attention, soft-fails-when-extractor-raises. Total file now 10 cases (was 7 after v2).
- Zero frontend changes (intake review UI already renders the populated groups).
- Docs at the time: `docs/product-roadmap.md` AI inbox v2.1 entry marked
  `[~]`; later closeout below marks v2.1 `[x]` after focused verification.

Mac-side verification for v2.1: `.venv/bin/python -m pytest tests/integration/test_ai_triage_api.py -q` — expect 10 passing.

---

Previously this session (v2, now committed and pushed): AI inbox v2 — promote classifications into drafts. Spanning:

Backend
- `stewart/ai/inbox.py` — extended prompt + JSON schema to accept an `entity_index` (properties / tenants / active leases) and return optional `suggested_property_id` / `suggested_tenant_id` / `suggested_lease_id`. Signature now `triage_inbox(*, body, settings, entity_index=None)`.
- `apps/api/schemas/ai.py` — new `InboxTriageMatch` model; `InboxTriageRead` gains `suggested_property/tenant/lease`. New `InboxPromoteKind`, `InboxPromoteTargetKind`, `InboxPromoteRequest`, `InboxPromoteRead`.
- `apps/api/routers/ai.py` — `/triage` now builds the entity index, passes it through, and validates returned uuids against it (invented ids dropped silently). New `POST /ai/triage/promote` creates the right draft per kind. Three pre-existing `assert_entity_role` arity bugs fixed at the same time (`(user, entity_id, roles)` → `(session, user, entity_id, roles)` on `/ask`, `/triage`, and new `/promote`).
- `tests/integration/test_ai_triage_api.py` — updated existing classification test (entity_index assertions + new audit-input keys), added drop-invented-ids test, added promote tests for each of the three actionable kinds + cross-entity rejection.

Frontend
- `apps/web/src/lib/api.ts` — `InboxTriageMatch`, new `suggested_*` fields on `InboxTriageRecord`, `InboxPromoteKind`/`InboxPromoteTargetKind`/`InboxPromoteRecord`, `promoteInboxMessage(...)` client.
- `apps/web/src/app/inbox/page.tsx` — new Promote-to-draft panel below the deep-link CTA when the classified kind is actionable. Property + tenant dropdowns (plus lease for `lease_change`) pre-filled from the AI suggestions; operator can override before clicking Promote. On success the router pushes the operator into the new draft's detail page.
- `apps/web/tests/smoke/api-mocks.ts` — triage mock now returns suggested_property/tenant; new promote mock.
- `apps/web/tests/smoke/app-flows.spec.ts` — new spec asserts the promote panel pre-fills and that clicking Promote routes into `/operations/maintenance/{id}`.

Docs
- `docs/product-roadmap.md` — Tier 3 AI-inbox entry gained an "v2: promote classifications into drafts" line marked `[~]`.

Frontend ESLint + tsc clean in the Cowork sandbox. **Playwright smoke + backend pytest deferred to Mac-side verification** (sandbox can't boot `next dev` within the 45s bash cap, and the macOS-aarch64 `.venv` doesn't run on Linux). See "Mac-side verification" block below.

No pending code edits prior to this slice. `docs/external-skills/` (Vercel + Anthropic + Hallmark reference markdown, ~830K) is committed to the repo.

### Mac-side verification for the AI inbox v2 slice (2026-05-23)

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m ruff check stewart/ai/inbox.py apps/api/schemas/ai.py apps/api/routers/ai.py tests/integration/test_ai_triage_api.py
.venv/bin/python -m pytest tests/integration/test_ai_triage_api.py -q
# Expect: all tests pass — 5 cases total (existing classification + drops-invented-ids
# + 3 promote tests + cross-entity rejection).

cd apps/web
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs \
  ./node_modules/.bin/playwright test --grep "AI inbox"
# Expect: 2 passing (existing deep-link spec + new promote-to-maintenance spec).
```

## Workspace Cleanup

- Removed stale generated folders from the local checkout:
  - `.pytest_cache`
  - `apps/web/.next`
  - Python `__pycache__` folders under `apps/`, `migrations/`, `scripts/`, `stewart/`, and `tests/`
- Removed unrelated Brewery scratch files that were untracked and intentionally not part of Leasium:
  - `docs/Brewery_Invoice_Approval_Cost_Comparison.docx`
  - `docs/brewery-approval-cost-comparison.md`
  - `docs/brewery-invoice-approval-research.md`

## Recently Shipped

The 2026-05-22 UX-review sweep + supporting work. All commits on `main`.

UX review Tier 1 (foundation, visible-impact):
- `6302b0a Tier 1 (d): URL-persistent filters across tables` — `?occupancy`, `?owner_tag` on Properties; `?tenant_filter`, `?q` on Tenants; `?tab`, `?assignee`, `?maintenance_status`, `?maintenance_priority`, `?arrears_status` on Operations.
- `bd08fb3 Tier 1 (c) v1: Dashboard metric trend deltas + sparklines` — `DashboardMetricCard` accepts a `trend` prop; 7-day SVG sparkline + Stripe-style delta badge; wired on the Operations urgent-obligations card.
- `d032fc9 Tier 1 (b) v1: DetailDrawer + Tenants quick view` — new generic `<DetailDrawer>` at `apps/web/src/components/detail-drawer.tsx`; Tenants table row click opens it.
- `418d0c7 Tier 1 (a) v1: convert top-bar nav to fixed left sidebar` — 240px navy fixed sidebar, brand at top, icon + label per module, hamburger drawer on <lg. AppHeader toggles `body.app-shell-active` so auth/setup pages stay full-width.
- `b77a16f Remove G-shortcut chips from sidebar nav items` — followup operator feedback.

UX review Tier 2 (strategic):
- `c1b2a7c Ask Leasium v1 backend` + `e7b5cce Ask Leasium v2 frontend` — Tier 2 (e) Leasium AI Q&A surface on the Dashboard. `POST /api/v1/ai/ask` with bounded context, strict-JSON citations, 503 when `OPENAI_API_KEY` unset.
- `1f16485 Tier 2 (f) v1: cross-property activity feed` — Dashboard panel pulling from the append-only `audit_action` table via `GET /api/v1/activity-feed`. Time-bucketed (Today / Yesterday / Earlier / Older), 60-second background refresh.
- `d90afad Tier 2 (h) v1: keyboard shortcuts + cheatsheet` — Linear-style `G + letter` navigation (D/I/M/P/T/O/B/N/Q/S), `?` cheatsheet modal, `Esc` closes anything.

UX review Tier 3 (bigger bets):
- `ad51b4a Tier 3 v1: inline-editable Contact cells on Tenants` + `dd70a26 Tier 3 v2 + v3: inline editing on Properties + Operations` — reusable `<InlineEditCell>` (text + select variants); Tenants contact name/email/phone, Properties name/address, Operations status/priority chips. Optimistic React Query with rollback.
- `f74e5dd Tier 3 v1: saved views on Tenants / Properties / Operations` — localStorage-backed named filter combinations via `<SavedViewsMenu>` chip. Promote to backend table when a second operator comes online.
- `c63c7a6 Tier 3 v1: multi-view (Table/Board) for Properties` + `83d3c8a Board column alignment + collapsible Property images panel` — Notion-style table/board toggle with `?view=board` persistence; board groups properties by occupancy bucket. Operator-feedback fixes: column alignment + collapsing the always-open images panel to a 40×56 thumbnail with chevron.
- `c546ed6 Tier 3 v1: AI inbox processor at /inbox` — Re-Leased Credia equivalent. `POST /api/v1/ai/triage` classifies a pasted message (7 kinds) and suggests the next Leasium surface. Read-only; deep-link only, no auto-create in v1.
- `78f4e5e Tier 3 v1: mobile responsive audit pass` — entity selector drops to a wrap row on phones, dashboard metric grid promoted to `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`, Properties table now horizontally scrollable.

Tenant + AI polish:
- `e3e7a9b Preview as tenant button on tenant detail` — opens the tenant's `portal_url` (already projected on `TenantOnboardingRead`) in a new tab. No new endpoint needed.
- `7c8d029 Rebrand Ask panel to Leasium AI with distinct styling` — operator feedback: AI surfaces (Dashboard + /inbox) now share a gradient hero treatment (blue-soft → teal-soft, primary border accent, gradient Sparkles badge, Beta pill) so they read as AI at a glance.

Behavioural baseline:
- `d0823cf Add merged CLAUDE.md (Karpathy baseline + Leasium specifics)` — `CLAUDE.md` at the repo root combines the Forrest Chang / Andrej Karpathy four-principle file with Leasium-specific guardrails (provider mutation rule, Remba review, internal-first-6-months, push-to-Vercel review path, Mac/venv tooling notes).

2026-05-23 visual polish + brand sweep (commits hash-prefixed by their `git log` ID; run `git log --oneline -12` after the next pull to see them):

- `Add external agent-skills as in-repo reference` — Vendored Vercel react-best-practices, web-design-guidelines, composition-patterns + Anthropic frontend-design + Nutlope/hallmark (with full `references/` tree). Reference markdown only at `docs/external-skills/`; not runtime code.
- `Token consistency v1: Micro step, slate ramp, radii, tabular-nums` — Codex SoT §4 gained Micro 11px step; §7 gained matching Tailwind fontSize. 35 ad-hoc `text-[11px]` / `text-[10px]` callers migrated. Slate ramp extended to 200/150/100/50. borderRadius extension added. 13 `<table>` elements gained `tabular-nums` className. DashboardMetricCard sparkline hex literals extracted to `SPARKLINE_STROKE` const.
- `Motion polish v1: drawer backdrop easing + form focus-visible` — Two no-decision items: DetailDrawer backdrop got `ease-leasium`; 62 form-input focus styles migrated from `focus:` to `focus-visible:` so mouse clicks no longer flash the ring.
- `Motion polish v2: scale 150/200/300, ease-in + ease-toggle, drawer/modal enters` — Codex SoT §5 motion scale aligned with Tailwind defaults; `ease-leasiumIn` + `ease-leasiumToggle` added; three @keyframes (drawer-in-right/left, modal-fade-scale, backdrop-fade-in) wired. DetailDrawer + EvidenceDrawer + command palette + cheatsheet animate on mount.
- `Polish v3: owner-tag tokens, Body Compact, mobile + workspace modal animations` — Codex SoT §3 gained Owner tag palette section (12 entries ratifying existing colours); §4 gained Body Compact 15px step; 12 inline hex chip strings in `lib/property-ownership.ts` migrated to `leasium-ownertag-*` tokens; 7 `text-[15px]` callers migrated to `text-leasium-body-compact`; mobile nav + 3 property-workspace modals animate on mount.
- `Polish v4: alias drift resolution + checkbox focus-visible + two-tier docs` — Codex SoT §3 documented the two-tier naming convention (short aliases for common cases, `leasium-*` for explicit shades). Tailwind config gained root-level short aliases for soft/strong/hover state variants (`primary-hover`, `primary-soft`, `success`/`-soft`/`-strong`, etc.). 150+ `leasium-blue-*` / `leasium-success-*` / `leasium-warning-*` / `leasium-danger-*` / `leasium-info-*` callers migrated to short aliases. One checkbox `focus:` → `focus-visible:` carve-out finished.
- `Polish v5: drawer/modal exit animations via useUnmountDelay hook` — New `lib/use-unmount-delay.ts` hook keeps drawers/modals mounted long enough for the exit keyframe to play. Three exit @keyframes added (drawer-out-right/left, modal-fade-scale-out, backdrop-fade-out) using the new ease-in token. Applied to 8 surfaces: DetailDrawer, EvidenceDrawer, command palette, cheatsheet, mobile nav, lease/property/unit editors.
- `Polish v6: chip system consolidation` — New `chipClass(tone, options?)` helper in `components/ui.tsx` is the single source of truth for chip/pill/badge className strings. StatusBadge is a thin wrapper. `lib/property-occupancy.ts` and inline chip declarations migrated; Codex SoT §9 documents the density × tone × bordered matrix.
- `Polish v7: EmptyState icons + Codex empty-state convention` — EmptyState component gained an `icon` slot (36×36 rounded-leasiumLg with bg-primary-soft + text-primary). High-traffic empty states across Dashboard, Notifications, Insights, Operations, Settings, Billing Readiness, Tenants, Portfolio QA, Operations/Maintenance, Snapshots, Intake, Statements, Inbox, Contractors, Comms migrated to use semantic icons (CheckCircle2 for positive empty, Clock3 for time, Activity for feeds, Building2 for entity selection, etc.). Codex SoT §8 documents the icon semantic mapping.
- `Polish v8: remaining EmptyState icon opt-ins + slop-test + a11y audit fixes` — Final pass: filled icons on the remaining ~30 callers (skipped dynamic-title cases). Ran Hallmark 65-gate slop test on Dashboard surface — found and fixed gate 62 (added `overflow-x: clip` on html/body in globals.css) and gate 16 (narrowed form-input transitions to `transition-colors` so focus rings stay instant). Ran web-design-guidelines a11y audit on Notifications + opportunistically across the codebase — fixed 30+ loading-state strings missing the typographic ellipsis (`"Sending"` → `"Sending…"`, `"Loading"` → `"Loading…"`, etc.).

## Product State Snapshot

- Operator auth and workspace access are live enough for pre-production:
  - Clerk-backed operator login is working.
  - Protected frontend routes redirect signed-out users to Clerk sign-in.
  - Render API requires Clerk bearer tokens for protected workspace APIs.
  - Public tenant onboarding remains reachable.
- The SKJ portfolio workbook has been imported into the hosted register.
  - Real properties, units, tenants, leases, charge rules, and obligations are in the platform.
  - Demo seed rows were archived during the import work.
- Smart Intake remains the product center of gravity:
  - Spreadsheet import has server-stored review plans and reviewed Apply.
  - Purchase contracts can drive property/unit/tenant/lease/task/draft-charge creation with provenance.
  - Billing/admin documents create reviewed internal billing drafts and invoice drafts.
- Portfolio QA is available for cleanup but still needs final IA/Remba review.
- Xero is review-first:
  - OAuth connection foundation exists.
  - Contact preview/apply, chart/tax validation, posting preview, explicit Xero approval, draft creation, provider dispatch, and payment reconciliation preview/apply are built.
  - No Xero write runs without explicit operator approval.
- Tenant portal is beyond the token-only MVP:
  - Token-scoped self-service works.
  - Tenant account linking, account-only entry, documents, maintenance requests/photos, preferences, lifecycle controls, and operator revoke/unlink/restore exist.
- Operations/Work is now a real workspace:
  - Maintenance, arrears, critical dates, assignment, reminders, escalation cues, provider notices, SMS send/retry, digest previews/sends, and notification-center history exist.
  - Contractor communication, work-order completion, closeout notes/photos, invoice handoff, recovery, and provider history are built.

## Verification From Latest Work

- Work notification template preview:
  - Frontend lint passed.
  - TypeScript no-emit passed.
  - Settings smoke passed.
  - Production Next build passed.
  - Live route sanity passed.
- Work notification provider history:
  - `.venv/bin/python -m ruff check apps/api/schemas/work_assignments.py apps/api/routers/work_assignment_notifications.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py -q` returned `9 passed`
  - Frontend lint passed.
  - TypeScript no-emit passed.
  - Notifications smoke passed.
  - Production Next build passed.
  - Live route sanity passed.
- Work notification recovery cues:
  - Frontend lint passed.
  - TypeScript no-emit passed.
  - Notifications smoke passed.
  - Production Next build passed.
  - Live route sanity passed.
- Work notification named template catalog:
  - `.venv/bin/python -m ruff check apps/api/schemas/work_assignments.py apps/api/routers/work_assignment_notifications.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py -q` returned `10 passed`
  - `./node_modules/.bin/eslint src/app/settings/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Settings smoke passed.
- Work notification direct email recovery:
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py -q` returned `11 passed`
  - Backend ruff passed for Work assignment files.
  - Frontend lint passed for Notifications/API smoke files.
  - TypeScript no-emit passed.
  - Notifications smoke passed.
- Work notification channel readiness:
  - Backend ruff passed for Work assignment files.
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py -q` returned `11 passed`
  - Frontend lint passed for Notifications/API smoke files.
- Work SMS preference modelling:
  - Backend ruff passed for Security/Work assignment files.
  - `.venv/bin/python -m pytest tests/integration/test_security_api.py tests/integration/test_maintenance_arrears_api.py -q` returned `18 passed`
  - Frontend lint passed for Settings/Notifications/API smoke files.
- Work SMS send/retry wiring:
  - `.venv/bin/python -m ruff check stewart/integrations/communications.py apps/api/work_assignments.py apps/api/routers/work_assignment_notifications.py apps/api/schemas/work_assignments.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `19 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed for Work notices/digest receipts including SMS recovery.
- Work notification channel receipts:
  - Additive `channel_receipts` projection now returns Email and SMS receipt evidence on Work notice rows while legacy top-level email and `sms_*` fields remain.
  - `.venv/bin/python -m ruff check apps/api/schemas/work_assignments.py apps/api/routers/work_assignment_notifications.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `19 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed for the normalized channel receipt path.
- Work notification receipt evidence disclosure:
  - Notifications now exposes full Email/SMS provider receipt evidence through inline `Receipt evidence` disclosures instead of the unfinished drawer path.
  - Email notice send attempts now persist `attempt_count`/`delivery_attempt_count`, and SendGrid webhook receipts reuse that count so notification-center channel receipts do not inflate retries from receipt rows.
  - `.venv/bin/python -m ruff check apps/api/work_assignments.py apps/api/routers/work_assignment_notifications.py apps/api/schemas/work_assignments.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `19 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed for Work notices/digest receipts.
  - Live `/notifications` route loaded on the local dev server; the live seed had no receipt rows, so disclosure rendering is covered by the smoke fixture.
- Work notification rendered message previews:
  - `stewart/integrations/communications.py` now exposes rendered Work notice email, Work notice SMS, and Work digest email preview helpers, and provider sends reuse those helpers for subject/text bodies so preview and delivery stay aligned.
  - Notification-center Email/SMS channel receipts now include `rendered_message_preview`; digest receipts store and project a rendered digest preview at generation time.
  - Notifications renders collapsed `Message preview` disclosures for receipt-linked notice previews and digest previews.
  - `.venv/bin/python -m ruff check stewart/integrations/communications.py apps/api/work_assignments.py apps/api/routers/work_assignment_notifications.py apps/api/schemas/work_assignments.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `19 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed after tightening title assertions around hidden preview text.
  - Live `/notifications` route loaded on the local dev server; the local seed still has no receipt rows, so preview expansion is covered by the smoke fixture.
- Work notification provider setup checks:
  - Notification-center channel readiness now carries additive `setup_checks` for Work email, SendGrid sender/webhook, operator SMS preferences, Twilio messaging/callback, and Leasium in-app receipts.
  - Notifications renders those checks inside a collapsed `Provider setup checks` disclosure in the Work notice center, keeping provider-console detail out of each notice row.
  - The API returns bare Work webhook endpoints for SendGrid/Twilio review but never returns provider API keys, webhook secrets, or tokenized callback URLs.
  - `.venv/bin/python -m ruff check apps/api/routers/work_assignment_notifications.py apps/api/schemas/work_assignments.py tests/integration/test_maintenance_arrears_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_security_api.py -q` returned `20 passed`
  - `./node_modules/.bin/eslint src/app/notifications/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Notifications smoke passed for the provider setup disclosure and bare endpoint rows.
  - Live `/notifications` loaded on the local web server, but this desktop session did not have the API server listening on port 8000, so entity-backed live hydration was covered by the smoke fixture instead.
- Ownership tags directory:
  - `apps/web/src/lib/property-ownership.ts` now centralises property owner/billing identity label extraction, chip palettes, and tag aggregation so Properties and Settings use the same computed owner chips.
  - Settings Organisation now shows an `Ownership tags` panel with one row per unique owner/billing identity label, visible source context, property counts, links back to matching properties, and tag-level links into a filtered Properties view.
  - `/properties?owner_tag=...` now applies a client-side owner-tag filter, keeps selected property detail aligned with the filtered row list, exposes a clear filter action, and can be applied directly from property-row owner chips.
  - Smoke fixtures now include multiple properties across shared and separate owner tags, so the chip-click path catches row-selection bubbling and non-matching property visibility regressions.
  - This is still a read-only aggregation of property fields/import metadata, not a new first-class owner/entity table.
- Property image helper experiment:
  - The original OpenAI web-search v1 was pulled after it returned listing page URLs instead of verified direct image file URLs; the current helper is the SerpAPI Google Images v2.
  - `stewart/ai/enrichment.py` now routes property image candidates through `stewart/integrations/serpapi_image_search.py`.
  - `/api/v1/public-enrichment/property-images/preview` returns reviewable remote image candidates with source/citation/confidence before anything is stored.
  - `/apply` downloads the selected candidate, processes it to a fixed 1600x900 JPEG, creates a property-linked StoredDocument, and stores metadata pointers such as `primary_image.document_id`, `hero_image_document_id`, `image_document_ids`, source/citation/confidence/history.
  - The Portfolio tab renders fixed-size row thumbnails and a selected-property `Property images` panel from the stored-document workflow, with candidate cards and explicit `Apply image` review before apply.
  - This is experimental. If visual quality or source clarity is poor, pull the helper rather than shipping remote metadata-only hotlinks.
  - `.venv/bin/python -m ruff check stewart/ai/enrichment.py apps/api/schemas/enrichment.py apps/api/routers/enrichment.py tests/integration/test_enrichment_api.py`
  - Current local verification: `.venv/bin/python -m pytest tests/integration/test_enrichment_api.py -k property_image -q` returned `4 passed, 3 deselected`.
  - Current browser verification: `npx playwright test tests/smoke/app-flows.spec.ts -g "property workspace shows the evidence source trail" --workers=1` returned `1 passed`, covering the thumbnail, image candidate, apply-image, and owner-tag row-conflict paths.
- Contractor SMS and Xero freshness follow-up:
  - Maintenance work-order contractor delivery now supports a reviewed Twilio SMS action beside SendGrid email, with separate send state, receipts, provider history, template key/version, Twilio status callback ingestion, and contractor-visible comments only after successful reviewed sends.
  - `/api/v1/xero/status` now returns local accounting freshness across contact sync, chart/tax validation, invoice posting/dispatch checkpoints, and payment reconciliation, including stale/missing reconciliation cues for open Xero-linked invoices.
  - Settings shows an accounting freshness metric; Insights and public finance snapshots include an accounting-readiness block for contact/chart/tax/payment freshness.
  - Verification covered focused backend unit/integration tests, TypeScript, ESLint, and smoke flows for maintenance detail, Settings Xero, and Insights/public snapshots.
- Spreadsheet import review polish:
  - `apps/web/src/app/intake/register-import-panel.tsx` and `apps/web/src/app/intake/spreadsheet/page.tsx` now show approve/review/ignored/blocked counts, explicit `Approve recommended` and `Ignore all` controls, and more field-change detail before Apply.
  - Smart Intake now also offers `Download template` before upload. The API returns an authenticated `leasium-migration-template.xlsx` workbook with instructions, supported import tabs, richer migration fields, and source/confidence hint columns while preserving no-mutation dry-run/apply behaviour.
  - `apps/web/tests/smoke/api-mocks.ts` now mocks the template download plus `POST /register-imports/dry-run` and `POST /register-imports/apply`.
  - `apps/web/tests/smoke/app-flows.spec.ts` covers the focused spreadsheet import review, bulk ignore, re-approve recommended, and apply outcome.

## Important Deployment Notes

- Vercel connector auth/env mutation was not available in-session.
  - Committed code through `39742fa` is pushed to `main`; the current local Work notification/ownership-tags slice is not committed or pushed yet.
  - Vercel should deploy from GitHub once the next commit is pushed.
  - For a true private-beta wall, set `LEASIUM_ACCESS_PASSWORD` in Vercel and redeploy.
  - For operator auth, keep both Clerk frontend/server env vars configured in Vercel.
- Render start command is expected to run Alembic before the API starts:
  - `.venv/bin/alembic upgrade head && .venv/bin/uvicorn apps.api.main:app --host 0.0.0.0 --port $PORT`
- Hosted Neon/Render should be at least through these migrations:
  - `20260520_0018_maintenance_arrears_foundations`
  - `20260520_0019_tenant_portal_accounts`
  - `20260521_0020_register_import_plans`
  - `20260521_0021_operator_notification_preferences`
  - `20260522_0022_branded_communication_templates`
  - `20260523_0023_inbound_messages`
  - `20260523_0024_contractors`
- Provider setup still has external-console work:
  - SendGrid templates/event webhook configuration; notification-center readiness shows the bare Work event webhook endpoint only.
  - **Pending external-console verification:** configure the DocuSign JWT app and Connect webhook with `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_RSA_PRIVATE_KEY`, `DOCUSIGN_WEBHOOK_SECRET`, and `PUBLIC_API_URL`. The code path now performs JWT grant, envelope create, Connect event validation, signed-PDF retention, and explicit activation review; remaining work is live provider-console proof with real credentials. Setup steps documented in `docs/deployment.md`, and Settings > Organisation > Integrations can copy/download a DocuSign provider setup packet from the current API readiness state.
  - **Pending (2026-05-23, when Twilio numbers are provisioned): point the inbound SMS webhook at each entity's Twilio number.** In the Twilio console, set each per-entity number's *Messaging → A message comes in* webhook to `https://<API_HOST>/api/v1/comms/webhooks/twilio-inbound?entity_id=<UUID>` (HTTP POST). The webhook is live and tested; it just won't see inbound SMS until the Twilio side is wired. Steps in `docs/deployment.md`.
  - **Pending (2026-05-23, Temba waiting on tokens): configure SendGrid Inbound Parse for the comms inbound webhook.** Add MX record on a subdomain pointing to `mx.sendgrid.net`, then in the SendGrid console add an Inbound Parse setting per entity mapping the subdomain to `https://<API_HOST>/api/v1/comms/webhooks/sendgrid-inbound?entity_id=<UUID>`. Steps + rationale documented in `docs/deployment.md`.
  - **Pending (2026-05-23, Temba waiting on tokens, ETA a couple of days): create the SendGrid template `tenant_portal_invite` v1 used by the new tenant portal onboarding invite slice.** Copy should explain "Your Leasium tenant portal is ready", with brand name placeholder, property + unit label, due date, expiry, and a single primary CTA linking to the onboarding URL. Template key + version are overridable via `TENANT_PORTAL_INVITE_TEMPLATE_KEY` / `TENANT_PORTAL_INVITE_TEMPLATE_VERSION` env vars on the API service if the SendGrid template name doesn't match. Until this template exists, the Invite-to-portal button still fires the send pipe but SendGrid will fall back to a generic delivery and the receipt path will record a soft failure. Backend code, dashboard panel, and operator CTA all ship in commit `5aa5f8e` + `9af7462`.
  - Twilio SMS callback/template setup; notification-center readiness shows the bare Work status callback endpoint only.
  - Twilio maintenance contractor SMS callback setup should also point at `/api/v1/maintenance/work-orders/webhooks/twilio-status`.
  - Xero app/accounting-side settings
- Public enrichment requires `OPENAI_API_KEY` on the API service. Without it, preview returns a clear 503 and does not mutate records.

### Mac-side verification for the tenant portal onboarding slice (2026-05-23)

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py tests/integration/test_tenant_portal_api.py -q
# Expect: all tests pass, including the four new ones —
#   test_tenant_onboarding_send_portal_invite_records_delivery_and_audits
#   test_tenant_onboarding_send_portal_invite_rejects_submitted_or_expired
#   test_tenant_portal_onboarding_submit_writes_submitted_data
#   test_tenant_portal_onboarding_submit_rejects_non_sent_status

cd apps/web
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs \
  ./node_modules/.bin/playwright test --grep "tenant portal shows scoped self-service"
# Expect: 1 passing. The spec now also asserts that "Complete your onboarding"
# renders, Submit-for-review is disabled until acceptance, and after submit
# the panel collapses to "your property manager will review and confirm".
```

Live route sanity after Vercel deploys:
- `/tenant-portal/tenant-token-1` still loads.
- `/onboarding/tenant-token-1` now returns the retired-form redirect screen ("Your onboarding has moved into your Leasium account") with a button pointing to `/tenant-portal/tenant-token-1`.

## Remba Review Queue

Treat these as pending UX/design sign-off:

- Smart Intake spreadsheet import review/apply panel and migration-template download.
- Portfolio QA IA and command-search placement.
- Reusable evidence/source-trail pattern across Properties, Smart Intake, Tenants, invoices, and maintenance.
- Tenant portal account/self-service surfaces, fresh-link recovery, and document provenance density.
- Billing Readiness provider dispatch/recovery and Xero approval/reconciliation surfaces.
- Operations workspace structure, work assignment controls, workload filters, reminder/escalation cues, provider notice states, and notification center.
- Settings Work notification preferences/named-template/SMS selection and Notifications provider-history/direct email/SMS recovery/channel-readiness density.

## Recommended Next Tickets

**Top priority as of 2026-05-31 — DoorLoop benchmark refocus (P0).** Make Owner a
first-class entity, gather people into one **People** hub (Tenants · Owners · Vendors ·
later Prospects), and consolidate the sidebar to 7 hubs. This is the keystone that unlocks
the owner portal, owner reporting, and distributions. Execution plan (test-first tickets):
[`docs/superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md`](superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md);
full analysis: [`docs/doorloop-benchmark-2026-05-31.md`](doorloop-benchmark-2026-05-31.md).
The list below is the prior backlog, now secondary:

The 2026-05-22 UX-review backlog is done except dark mode. The AI inbox v2 stack through v2.3 (promote → lease-change extraction → contractor matching → tenant-contact promote) and the tenant portal soft-switch are now shipped. Claim-gate polish, co-tenant/additional-login invites, and the operator-side read-only tenant portal preview are also complete. Pick from these in roughly leverage order for the SKJ internal-first-6-months window:

1. **Xero deepening** — Billing Readiness row-level stale reconciliation cues, the month-end checklist, and the Owner statements handoff are shipped. Continue into PDF statement preview/export, statement dispatch review, and finance checklist automation. Finance team will live here every month.
2. **Portfolio QA cleanup** — bulk fix review, AI-assisted enrichment candidates (the helper exists; productise it), clearer completion/reporting state. One-off but high-impact while the SKJ portfolio import is still being shaken out.
3. **Operations live review** — the small-viewport row-density pass is implemented; Temba/Remba should sanity-check the new `Work controls` and `Work-order actions` disclosures on a real phone, plus review the inline-edit undo toast, activity audit strip, and completion recipient-review cards.
4. **Tier 2 (g) Dark mode** — dark tokens in the design source of truth, `.dark` class via system preference + an account-menu toggle, contrast audit across the 5 most-used surfaces. Deliberately deferred during the internal-first-6-months window; revisit when external tenants/contractors land.
5. **Tenant portal UX audit** — predates the sidebar / inline-edit / activity-feed / Leasium AI work. v2 candidates: tenant-side activity feed scoped to their tenancy, tenant inline edit of their own contact details, tenant maintenance request status visibility.
6. **Multi-view v2 for Properties** — Map view (Leaflet vs Mapbox decision) + Calendar view (rent reviews + lease expiries — although the upcoming-events panel on the Dashboard already covers most of this).
7. **Pre-existing backlog** still valid: branded communications editable templates UI + send-time wiring (deprioritised under internal-first-6-months), Smart Intake spreadsheet improvements, evidence/source-trail pattern reuse expansion, Work assignment digest coverage.

Hosted Neon/Render migrations as of `08c23d1`: latest required revisions are `20260524_0025` (residential property_type) and `20260524_0026` (tenant_onboarding.token_consumed_at) on top of the earlier `20260520_*` / `20260521_*` / `20260522_*` / `20260523_*` set. Render's start command runs `alembic upgrade head` so these should apply automatically — verify by grepping the deploy log for those revision IDs.

## Resume Checklist

- Start with `git status --short` + `git log --oneline -10`. Tip should include the latest Operations row-density commit if this handover was pushed; `90bd99b` was the pre-slice tip.
- If there are local edits, inspect them before changing files.
- **Tooling on Temba's Mac (current as of 2026-05-24):**
  - Node v26 installed via Homebrew (`brew install node`).
  - Desktop Commander MCP server configured in `~/Library/Application Support/Claude/claude_desktop_config.json`. Claude sessions in this workspace have `mcp__Desktop_Commander__*` tools that run real shell commands on the Mac.
  - macOS-aarch64 `.venv` at `.venv/`; use `.venv/bin/python -m pytest ...`, `.venv/bin/python -m ruff check ...`, `.venv/bin/alembic upgrade head`, `.venv/bin/uvicorn apps.api.main:app --reload`.
  - Frontend tooling: `apps/web/node_modules/.bin/{next,playwright,eslint,tsc}` — runs on the Mac via Node.
- Keep Smart Intake review-first: extracted value, confidence, source, approve/edit/ignore, and no mutation until Apply.
- Keep provider actions explicit: no Xero write, SendGrid email, Twilio SMS, or payment reconciliation without reviewed operator approval.
- Remba was retired mid-session on 2026-05-23 ("forget about Remba, this is a prototype, just fling it"). Subsequent commits land without `[~]` Remba-pending markers. If Temba reverses that direction, re-introduce the markers for new visible-impact slices and rebuild the queue in `docs/design-governance.md`.
- For destructive/mutating commands (writes, commits, force-pushes, deletes), show before running. Pre-approval like "just go" or "yeah commit + push" means batch execution is fine. Tests + linters + reads — run directly, output is the deliverable.

## Session 2026-05-24 summary (handing back to Codex)

Eight slices shipped, all on `main`:

1. **AI inbox v2** (`1666a96`) — `POST /api/v1/ai/triage/promote` creates the right draft per kind: `maintenance_request` → MaintenanceWorkOrder, `payment_or_arrears` → ArrearsCase, `lease_change` → synthetic StoredDocument + DocumentIntake. Triage now passes entity_index and validates suggested property/tenant/lease ids. Three latent `assert_entity_role` arity bugs fixed in the same file.
2. **AI inbox v2.1** (`a9f4e84`) — new `stewart/ai/lease_change.py` pre-extracts proposed change shaped to `DocumentIntakeExtraction` keys (parties / properties / key_dates / money_amounts / proposed_actions). DocumentIntake lands `ready_for_review` (or `needs_attention` < 0.5 confidence), soft-fails to `uploaded` when extractor errors. Zero frontend change — existing Smart Intake renders the populated groups.
3. **AI inbox v2.2** (bundled in `1666a96` per commit message) — new `stewart/ai/vendor_intake.py`. Triage gains `suggested_contractor`. `vendor_or_contractor` becomes promotable: matched contractor → deep-link only, unmatched → new Contractor row at priority=3 with extracted name/company/email/phone/categories. Frontend promote panel swaps property/tenant/lease pickers for a Contractor dropdown.
4. **Delete tenant button** (`fd5e7e5`) — SecondaryButton next to Edit profile on `/tenants/[id]`, uses `window.confirm()`, warns about active leases that will lose their tenant link.
5. **Smarter Unit picker on Send invite** (`b84c223`) — 0 units → auto-create "Main premises", 1 unit → auto-select + chip, 2+ → required dropdown.
6. **Residential property_type + contextual ABN** (`b84c223`) — alembic `20260524_0025` adds `residential` to PropertyType. TenantLeaseContextRead projects `property_type`. Tenant detail edit form hides Trading-as + ABN when any of the tenant's leases is on a residential property.
7. **Tenant portal soft-switch claim gate** (`35b1f4a` + fix `638eeed`) — alembic `20260524_0026` adds `tenant_onboarding.token_consumed_at`. `_portal_scope` rejects consumed tokens with 410 Gone. `claim_tenant_portal_account` stamps consumption and gates a consumed-token reclaim to "same Clerk user with prior history". New public `GET /api/v1/tenant-portal/invites/{token}/preview` for context-only data on the unauthenticated gate. Frontend `/tenant-portal/{token}` renders a full-page claim gate (preview + Clerk widget) and auto-claims after sign-in. Disabled the unauthenticated token-scoped portalQuery entirely.
8. **Tenant invite email copy** (`08c23d1`) — subject "Complete tenant onboarding" → "Set up your tenant portal", body intro reframed for the sign-in-first flow, CTA "Complete onboarding" → "Sign in to continue", postscript explains the link is single-use.

Verified Mac-side: `pytest tests/integration/test_tenant_portal_api.py -q` shows 13 passing. Sandbox-side: ESLint + tsc clean on every touched file. Render needs migrations 0025 + 0026 applied (auto-runs via alembic on deploy).

Open items at session end:
- Temba was hitting a 409 "already linked to another tenant" on the live deploy because his Clerk account had a prior portal link on an older Tenant row. He attempted "delete tenant" which doesn't unlink the portal account; the actual fix is `/tenants/{id}` → "Portal access" → **Unlink** button. He may have figured it out before the session ended — verify if the v2.3 work picks up before re-sending another test invite.

## Codex continuation 2026-05-24

- Operations small-viewport row-density pass implemented on `/operations`: assignable queue rows now collapse assignment + row actions into `Work controls` below `xl`; maintenance rows collapse assignment + completion/detail actions into `Work-order actions` below `xl`; desktop columns are unchanged.
- Added smoke coverage for the 390px compact path in `apps/web/tests/smoke/app-flows.spec.ts`.
- Docs updated in `docs/product-roadmap.md` and `docs/design-governance.md`; Recommended Next Tickets now promote Xero deepening and leave Operations as live-review only.
- Billing Readiness Xero freshness cues implemented: Delivery & payments now reads `/xero/status`, shows a local accounting-freshness strip, and flags Xero-linked unpaid invoice rows with `Payment check missing` / `Reconciliation stale` plus a `Review payments` handoff to Settings. Settings fresh state now says `Reconciliation current` for consistency with Billing Readiness, Insights, and snapshots.
- Verification for the Xero slice: focused Playwright smoke `settings shows Xero readiness`, ESLint on touched frontend files, and `tsc --noEmit` all pass.
- Billing Readiness month-end finance checklist implemented: Delivery & payments now derives five local rows from invoice/Xero state — Accounting setup, Invoice approvals, Provider dispatch, Payment reconciliation, Month-end pack — with targeted handoffs and no provider mutation.
- Follow-up finance artifacts: Statements can download `owner-statement-checklist-{month}.csv`; owner statement JSON/PDF/ZIP includes invoice evidence behind owner totals; Xero diagnostics exposes a provider setup preflight block for Monday env/redirect/scope checks.
- Verification for the checklist slice: focused Playwright smokes `dashboard shows the mocked portfolio and opens billing readiness` + `settings shows Xero readiness`, ESLint on touched frontend files, and `tsc --noEmit` all pass.

## Codex continuation 2026-05-25

- Owner statements Billing handoff implemented: Billing Readiness month-end pack now opens `/statements` with entity, invoice month, `from=billing-readiness`, and close status. Statements reads those query params instead of defaulting to the previous month.
- Tenant onboarding account-first simplification shipped: tenant confirm-details now shows only the core contact fields by default with optional details collapsed; submitted/reviewed copy stays tenant-friendly ("In review" / lease-pack handoff) instead of exposing internal review/apply state. The required-documents checklist now treats "no requested documents" as not required/complete instead of telling tenants to upload files that were never requested.
- Operator tenant detail onboarding approval is streamlined: submitted rows show one primary action, choosing between Approve & apply, Approve for signing, or Mark reviewed depending on lease-signing blockers. Reviewed rows still expose Apply once ready. Frontend typecheck/lint/build passed for the slices.
- Operator tenant portal preview now mirrors the tenant-friendly `In review` wording and shows a "Not required" checklist row when no onboarding documents are requested.
- Tenant portal maintenance cards now show a plain-language status detail for requested/triaged/assigned/approval/approved/in-progress/completed/cancelled states; the operator preview mirrors the same copy.
- Full tenant portal Compliance panel now shows "Not required" and an explicit empty row when no compliance checklist exists, while keeping optional document upload available.
- Full tenant portal now has a tenant-side Recent Activity panel in the side rail. It derives the latest onboarding, lease-signing, lease-question, document-upload, maintenance-history, contact-change, and notification-preference events from the existing portal payload; no new backend feed table or mutation path was added. The operator preview now mirrors those rows for local browser proof.
- Full tenant portal side rail now also shows tenant Contact Details after the full portal unlocks, keeping the tenant's own legal/contact/billing details visible without reopening the setup form. It is read-only for now; tenant-initiated edits should go through a later reviewed proposal path.
- Tenant-initiated contact change requests are now wired as a reviewed proposal path: tenants can request contact-name/email/phone/billing-email changes from the full portal after unlock; Leasium stores the request in tenant metadata, shows persistent in-review/applied/dismissed status back in the tenant portal and operator portal preview, blocks duplicate pending submissions, surfaces it on tenant detail as `Tenant requests`, and operators explicitly click `Apply request` or `Dismiss` before the request closes.
- `/statements` now shows a Statement pack readiness panel with ready/incomplete/unpaid/blocked state derived from owner statement totals, local invoice payment metadata, and Xero accounting freshness. The panel links back to Billing Readiness and keeps PDF/export/email as future explicit actions.
- `/statements` now also has an owner-selectable Statement preview panel for finance review: owner contact context, monthly totals, property lines, copyable review summary, and print/save-PDF action. Owner dispatch remains separate and explicit.
- Statement preview now includes a dispatch review panel: recipient readiness from owner billing email, owner-facing subject/body draft, copy-to-clipboard, and an explicit no-send guardrail. Still no owner email, PDF attachment, SendGrid mutation, or provider history write.
- Billing Readiness month-end checklist now fetches the owner-statement roll-up for the statement month and adds an Owner statements checkpoint before the Month-end pack row. It shows owner/statement invoice readiness and flags missing owner billing emails before dispatch review.
- Smoke mocks now include `GET /owners/statements`; focused smoke covers Dashboard → Billing Readiness → Open statements and verifies the readiness panel/owner statement render.

## Codex continuation 2026-05-26

- Tenant onboarding live account flow was debugged through Clerk/session issues and Vercel deployment. The submit path now refreshes Clerk tokens immediately before account-scoped tenant portal actions, avoiding stale-session failures.
- Tenant detail onboarding workflow now shows a compact six-step progress strip: invite, tenant details, approval, lease file, send pack, sign.
- Added a custom lease bypass on tenant detail: operators can upload a lease document scoped to the exact tenant, lease, and onboarding. **Send lease pack** stays disabled until a lease file is attached.
- Tenant lease-signing panel now shows attached lease documents and download actions before the tenant confirms signing.
- Backend portal document reads now expose `lease_id` and `tenant_onboarding_id`, and operator document upload validates that supplied tenant/lease/onboarding scope is consistent.
- Verification: frontend ESLint + `tsc --noEmit`, backend `ruff` on touched API files, and focused Playwright smoke `tenant detail sends lease pack after onboarding approval`.

## Codex continuation 2026-05-29

- Tenant lifecycle push shipped tenant-uploaded lease auto-match, tenant-uploaded insurance auto-update, DocuSign provider runway/webhook guardrails, SendGrid inbound secret guard, inbound email attachment routing, and optional inbound attachment auto-extraction.
- Smart Intake now labels SendGrid-routed inbound email attachment rows in the review queue, shows the email subject and no-mutation guardrail in the review panel, and preserves extracted document facts even when review metadata is present.
- The Comms queue now gives operators direct handoffs from tenant lifecycle drafts to the tenant review page, and from inbound email attachment drafts to Smart Intake, so the drafted email is no longer a dead end when the real work is an internal review.
- Tenant detail now shows the lease activation review transition (`Pending -> Active`) and the stored no-auto-activation guardrail beside the Activate lease action after DocuSign completion.
- Tenant detail now labels accepted tenant-uploaded lease matches as `Tenant upload accepted` instead of the generic `Signed`, while keeping the same activation-review guardrail and Activate lease handoff.
- Tenant-uploaded lease signing panels now link back to the source Smart Intake review when `document_intake_id` is present, so operators can audit the accepted match before activation.
- The tenant insurance source card now uses the same explicit `Open Smart Intake review` handoff label for reviewed insurance certificates.
- Tenant-uploaded insurance extraction now preserves tenant portal provenance through OpenAI extraction, and Smart Intake labels those review rows as `Tenant portal upload` with insurance-specific review detail.
- Dashboard, Operations, and tenant detail Smart Intake review links now include `entity_id` plus `review`, and the intake workspace prefers a valid URL entity over saved local selection, so review links open the exact item even after working in another entity.
- Accepting a tenant-uploaded lease match now appends a tenant-onboarding audit row that the signing evidence was accepted, activation review is ready, and the lease was not activated automatically.
- Manual evidence uploads from `/comms` compliance obligation cards now pass the source obligation id through `/documents`, back-attribute the stored document id into `obligation_metadata.evidence_document_ids[]`, append `evidence_history[]`, and stamp document metadata with the manual comms evidence source.
- AI inbox lease-change promotion now returns entity-aware Smart Intake review links (`/intake?entity_id=...&review=...`) for both extracted and soft-failed promote paths, matching Dashboard/Operations/tenant-detail handoffs.
- Insights Smart Intake live-exception links now also include `entity_id` plus `review`, so overview drilldowns no longer depend on the operator's saved entity selection.
- Property workspace Smart Intake source-history links and document-upload redirects now include `entity_id` plus `review`, matching the exact-review handoff convention.
- Portfolio QA Smart Intake source-history, issue, and evidence links now include `entity_id` plus `review`, so cleanup drilldowns open the exact review row.
- Billing Readiness Smart Intake billing-draft source links now include `entity_id` plus `review`, so draft-review drilldowns open the exact Smart Intake item.
- Inbound Twilio SMS now verifies `X-Twilio-Signature` whenever `TWILIO_AUTH_TOKEN` is configured, rejecting unsigned/invalid provider posts before an `inbound_message` row is persisted.
- Tenant onboarding Twilio SMS status callbacks now also verify signed provider callbacks when `TWILIO_AUTH_TOKEN` is configured, while preserving the existing shared `COMMUNICATIONS_WEBHOOK_SECRET` path.
- Maintenance contractor SMS and Work assignment SMS status callbacks now follow the same signed Twilio callback pattern, with `PUBLIC_API_URL` support for production proxy signatures and the existing shared webhook-secret path preserved.
- Twilio webhook authentication is now centralized in `apps/api/webhook_auth.py`, with helper-level coverage for shared webhook tokens and `PUBLIC_API_URL` Twilio signatures so future callback endpoints do not grow divergent signing logic.
- SendGrid receipt webhook shared-secret checks now also use `apps/api/webhook_auth.py`, with endpoint coverage for tenant onboarding, invoice delivery, operator invite, maintenance contractor, and Work assignment receipt callbacks rejecting missing shared tokens when `COMMUNICATIONS_WEBHOOK_SECRET` is configured.
- DocuSign Connect webhook secret validation now uses the same shared helper with DocuSign-specific and Leasium shared header aliases, while still failing closed when `DOCUSIGN_WEBHOOK_SECRET` is missing.
- Tenant-uploaded insurance apply now merges extracted certificate facts with tenant-upload provenance metadata on empty Apply, and tenant insurance metadata updates write a dedicated tenant audit row with source intake/document/expiry evidence.
- Tenant-uploaded lease activation now carries the source Smart Intake review id through to `lease.lease_metadata.activation` and the lease activation audit row, so accepted tenant-upload evidence remains traceable after the final Activate lease action.
- Tenant-uploaded lease/insurance Smart Intake promotion audits now include the source onboarding, tenant, lease, and candidate type, so the first promotion event has the same scope evidence as later apply/activation events.
- DocuSign lease activation now carries the provider envelope id through to `lease.lease_metadata.activation` and the lease activation audit row, so the final Activate lease action remains traceable back to the completed DocuSign envelope.
- Skipped or failed DocuSign Send lease pack attempts now stamp `delivery_data.lease_agreement.signing` with the provider error, so real setup/send failures enter the urgent tenant lifecycle comms queue instead of only appearing on the tenant detail receipt.
- Tenant-uploaded Smart Intake extraction audits now include the source intake id, extracted document type, OpenAI response id, proposed category, and review status, so extraction evidence ties directly to the review state operators see.
- Failed tenant-uploaded Smart Intake extraction audits now also include the source intake id and failed status, so extraction errors remain traceable to the exact review row.
- Smart Intake's review queue now has a compact `Review filter` for all reviews, tenant portal uploads, inbound email attachments, lease matches, insurance, and leases, so tenant lifecycle evidence is findable without scanning the generic first-five list.
- Smart Intake's filtered review queue now has a local `Download queue CSV` handoff containing already-loaded review rows and source/detail evidence, with no provider send or review mutation.
- Inbound email attachment Smart Intake extraction audits now match tenant-upload audit evidence, carrying source intake id, extraction outcome fields, response id on success, and failed status/error on failure.
- Inbound email attachment Smart Intake promotion audits now include source inbound message, tenant attribution, candidate type, attachment field, document id, and intake id before extraction starts.
- Tenant-uploaded Smart Intake extraction audits now also carry candidate, onboarding, tenant, and lease scope on both successful and failed extraction paths.
- Tenant-uploaded Smart Intake promotion audits now include the promoted intake id alongside document, onboarding, tenant, lease, and candidate scope, matching inbound attachment promotion evidence.
- Final tenant-onboarding activation audits now carry the signed document id plus DocuSign envelope id or tenant-upload Smart Intake id, matching the lease activation audit source evidence.
- DocuSign Connect receipt audits now carry onboarding id, lease id, envelope id, and retained signed document id after completed webhook processing.
- DocuSign Connect receipt audits now also state whether the webhook event was applied, or safely ignored with a reason such as custom-field mismatch.
- DocuSign Connect receipt audits now carry the original lease document id from the envelope send metadata, including declined events that never produce a retained signed PDF.
- DocuSign Connect receipt audits for ignored event-state conflicts now include the current signing status and last event, so completed-after-declined callbacks explain why they were not applied.
- Duplicate completed DocuSign webhooks now audit as `applied=false` with `ignored_reason=already_completed`, while preserving the signed document and source document ids in the receipt.
- Unknown DocuSign envelope callbacks now write targetless receipt audits with `ignored_reason=unknown_envelope` instead of disappearing silently.
- Signed DocuSign callbacks missing an envelope id or status now write targetless receipt audits with `missing_envelope_id` or `missing_status` instead of returning without evidence.
- Signed DocuSign callbacks with non-object JSON now write targetless receipt audits with `ignored_reason=invalid_payload` and the payload type.
- Signed DocuSign callbacks with syntactically invalid JSON now write targetless receipt audits with `ignored_reason=invalid_json` instead of escaping before audit.
- Signed DocuSign callbacks with a known envelope id but missing status now scope the `missing_status` receipt audit to the matching onboarding, lease, entity, and source document.
- Signed DocuSign callbacks missing an envelope id can now scope the `missing_envelope_id` receipt audit from DocuSign custom fields when they carry tenant onboarding, lease, and source document context.
- Tenant-uploaded lease activation now shows a source-aware success notice: `Lease activated after tenant-uploaded lease review.`
- Historical DocuSign docs were cleaned up so the automation strategy and 5-day report no longer describe the flow as scaffold-only or say completion auto-activates leases; they now reflect signed-PDF retention, explicit activation review, and remaining production-readiness work.
- DocuSign live provider-console verification remains parked until the real integration key/user/account/private key/webhook secret are available. Local provider boundaries and webhook state handling are covered.

## Codex continuation 2026-05-30

- Inspection report intake v1 shipped as a Smart Intake extension. `inspection_report`
  documents can carry reviewed `inspection_findings`; the review panel now has an
  Inspections filter and editable finding rows.
- Applying a reviewed inspection report creates requested maintenance work orders
  with source document links, optional photo document ids, property/unit/tenant/lease
  scope, finding confidence/source metadata, and a no-dispatch/no-provider guardrail.
- The inspection intake path does not send contractor email/SMS, write provider
  history, create billing drafts, touch Xero, or mutate external providers. Work
  orders are created only after operator Apply.
- Verification: `pytest tests/integration/test_document_intake_api.py -k inspection`,
  backend `ruff` on touched files, and frontend `tsc --noEmit` via
  `apps/web/node_modules/.bin/tsc`.
- Broader continuation verification: `pytest tests/integration/test_document_intake_api.py tests/integration/test_maintenance_arrears_api.py -q`
  passed 47 tests, and `npm run lint -- --max-warnings=0` passed for the web app.
- Follow-up smoke coverage added for the Smart Intake inspection review path:
  the mocked queue includes an inspection report, Apply creates mocked
  work-order rows, the CSV contains the inspection row, and the smoke asserts no
  contractor/assignment provider dispatch endpoints are hit. Verification:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "smart intake applies inspection findings"`.
- The post-Apply outcome now names the created requested work orders, repeats
  the no-provider/no-billing/no-Xero guardrail, and includes an `Open Operations`
  handoff to `/operations?tab=maintenance`; the focused smoke clicks through and
  confirms the created inspection work order is visible in Operations.
- Owner statement invoice evidence UI v1 was closed from `[~]` to `[x]` after
  hardening coverage: the selected-owner invoice evidence CSV now includes the
  local/Xero/reconciliation source trail shown in the table, the smoke test
  reads the downloaded CSV contents, and backend owner-statement coverage now
  checks older Xero invoice id and reconciliation-history metadata fallbacks.
  Remba/accountant review remains open for density and inline-vs-disclosure
  presentation.
- AI Inbox v1/v2/v2.2 verification is now complete on this Mac run:
  `pytest tests/integration/test_ai_triage_api.py -q` passed 18 tests, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "AI inbox"` passed the
  four browser flows for classify, maintenance promote, vendor/contractor
  promote, and tenant-contact promote. Roadmap status moved those items to
  `[x]`; Remba review remains open.
- Spreadsheet migration template download is now verified and marked `[x]`:
  `pytest tests/integration/test_register_import_api.py -q` passed 4 tests, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "spreadsheet"` passed
  the browser flow that downloads `leasium-migration-template.xlsx` before the
  reviewed dry-run/apply path. Remba/SKJ tuning remains open for workbook tabs,
  field order, and whether extra AI-fill guidance belongs in-app.
- Tenant onboarding simplification is still not marked `[x]` because the
  Clerk-enabled tenant account smoke proof remains external-config dependent.
  Fresh local verification did pass backend/API coverage
  (`pytest tests/integration/test_tenant_onboarding_api.py tests/integration/test_tenant_portal_api.py tests/unit/test_docusign.py -q`
  passed 94 tests), backend lint on the touched onboarding/portal/DocuSign
  files, focused web lint, and the non-Clerk/public/operator subset of the
  tenant smoke (5 passed, 5 skipped when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  was absent). A fake `pk_test_ZHVtbXk` key was not sufficient: account-scoped
  tenant portal tests hung at Clerk "Checking sign-in", so final closure still
  needs a real Clerk publishable key/session or a dedicated mocked-auth harness.
- Tenant quick-win closeout: added smoke coverage for the tenant detail Delete
  button, smarter Send invite unit picker, and residential lease business-field
  hiding. `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant send invite adapts|tenant detail delete|tenant detail hides business identity"`
  passed 3 tests, and `tsc --noEmit` plus focused eslint passed. Roadmap moved
  all three tenant quick-win items to `[x]`.
- Properties multi-view v1 is now verified and marked `[x]`: `npx playwright test tests/smoke/app-flows.spec.ts -g "Properties multi-view"`
  passed, with focused web typecheck/eslint also passing. Remba review remains
  open for board density and whether map/calendar should follow later.
- DetailDrawer / tenant quick-view v1 is now verified and marked `[x]`:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant list opens the quick-view detail drawer"`
  passed, with `tsc --noEmit` and focused eslint passing. The larger Properties
  detail-drawer conversion remains a documented follow-up.
- AppHeader compact utility toolbar follow-up is now verified and marked `[x]`:
  the dashboard smoke asserts the selected entity, command search, keyboard
  shortcuts, notifications, and appearance controls are grouped inside the
  `Workspace utilities` toolbar. Verification: web `tsc --noEmit`, focused
  eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "dashboard shows the mocked portfolio"`.
- AppHeader mobile touch-target polish is now fixed and marked `[x]`: the
  shared utility button style now uses 44px controls, the Clerk wrapper/sign-in
  baseline is 44px, and the keyboard-cheatsheet control no longer leaks visible
  below `sm`. Verification: web `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "mobile header keeps utility touch targets"`.
- AI Inbox mobile touch-target polish is now verified and marked `[x]`: the
  classify-and-deep-link smoke runs at 390px width and measures the "Take it
  from here" handoff link as a 44px target. Verification: web `tsc --noEmit`,
  focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "AI inbox classifies a pasted message"`.
- Billing Readiness mobile touch-target polish is now fixed and marked `[x]`:
  month-end checklist links, payment-review handoffs, Open statements, Preview,
  PDF, and month-end handoff buttons sit on 44px targets. Verification: web
  `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "billing readiness mobile actions"`.
- Settings mobile tab touch-target polish is now verified and marked `[x]`: the
  Security, Organisation, and Xero tabs are measured at 390px width. Verification:
  web `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "settings mobile tabs"`.
- Notifications mobile touch-target polish is now verified and marked `[x]`:
  the 390px smoke measures the 44px Work notice and Digest history filter
  controls plus the per-row `Open work` and bottom `Open Work` links.
  Verification: web
  `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "notifications mobile actions"`.
- Operations mobile touch-target polish is now verified and marked `[x]`: the
  390px workspace smoke measures Queue/Maintenance/Arrears tabs, 44px workload
  filter chips, Open tenants, Review, and Review completion; the 390px
  maintenance-detail smoke measures Operations, Recover in Billing, Preview,
  and PDF. Verification: web `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "operations workspace keeps mobile rows compact|maintenance detail mobile billing actions"`.
- Operations mobile row-density follow-up is also marked `[x]` off the same
  focused smoke: it verifies closed `Work controls` / `Work-order actions`
  summaries at 390px, hidden controls before expansion, and the visible
  completion handoff after expansion. Remba/live-phone review remains open.
- Tenant detail provider-detail mobile polish is now fixed and marked `[x]`:
  below `md`, provider detail is a closed `Provider detail` disclosure with a
  44px summary; at desktop width the same detail is inline. Verification: web
  `tsc --noEmit`, focused eslint, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail collapses provider detail"`.
- Tenants list mobile card view is now verified and marked `[x]`: the 390px
  smoke checks the table is visually hidden, the Bright Cafe card shows contact
  + due state, and tapping it opens the quick-view drawer with full-record
  handoff. Verification used the same focused typecheck/eslint pass and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant list opens the quick-view detail drawer"`.
- Inspection report intake v1 is now verified and marked `[x]`: focused
  backend tests cover inspection work-order creation and cross-entity photo
  guardrails, backend lint is clean, web typecheck passes, and the Smart Intake
  smoke applies inspection findings into Operations. Verification:
  `pytest tests/integration/test_document_intake_api.py -k inspection -q`,
  backend `ruff`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "smart intake applies inspection findings"`.
- Inbound email attachment Smart Intake v1 is now verified and marked `[x]` for
  the local app path. Backend inbound webhook tests passed, comms lint is clean,
  web typecheck passes, and the Smart Intake smoke verifies filter/CSV/review
  labels, extracted policy facts, and the no-mutation guardrail. Verification:
  `pytest tests/integration/test_comms_api.py -k "inbound" -q`, backend
  `ruff`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "smart intake labels inbound email attachments"`.
  Live MX/SendGrid setup remains an external environment follow-up.
- Tenant-uploaded insurance auto-update v1 is now verified and marked `[x]`.
  Backend coverage proves tenant insurance uploads promote into scoped Smart
  Intake rows, optionally auto-extract with OpenAI, audit extraction failures,
  apply reviewed expiry data into tenant insurance metadata, refresh portal
  compliance status, reject missing expiry dates, and correct stale document
  tenant ids from lease scope. Browser coverage proves tenant-uploaded insurance
  reviews are labelled/filterable in Smart Intake, entity-aware review links
  open the exact intake, Operations queue links preserve `entity_id` + `review`,
  and tenant detail shows confirmed insurance expiry plus the Smart Intake
  source link. Verification: `pytest tests/integration/test_tenant_portal_api.py -k "insurance_upload or upload_extraction_failure_audits_source_intake" -q`,
  `pytest tests/integration/test_document_intake_api.py -k "apply_insurance or rejects_insurance_without_expiry" -q`,
  backend `ruff`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "operations workspace surfaces maintenance and arrears work|tenant detail shows portal access recovery actions|smart intake labels inbound email attachments in review queue|smart intake deep link selects the review entity"`.
- Tenant-uploaded lease auto-match runway v1 is now verified and marked `[x]`.
  Backend coverage proves lease uploads promote into scoped Smart Intake rows,
  OpenAI extraction adds matched/missing-field recommendations, accepting a
  clean match stamps tenant-upload signing evidence and activation-review audit
  without mutating lease status/register values or creating `LeaseIntake`, and
  acceptance is blocked for differences, active DocuSign envelopes, already
  signed agreements, missing document scope, or operator-uploaded documents.
  Browser coverage proves the Smart Intake match panel, no-mutation guardrail,
  Accept match success path, active DocuSign conflict copy, tenant detail
  `Tenant upload accepted` label, Smart Intake source link, and explicit
  Activate lease handoff. Verification:
  `pytest tests/integration/test_tenant_portal_api.py -k "lease_upload or accept_lease_match" -q`,
  backend `ruff`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "smart intake shows tenant lease upload match recommendation|smart intake explains active DocuSign conflict before accepting lease match|tenant detail labels tenant-uploaded lease activation review"`.
- Portfolio QA completion report + bulk staging v1 is now verified and marked
  `[x]`, including the continuation summary item. The smoke proof covers the
  cleanup readiness report, AI-assisted enrichment candidate queue, enrichment
  CSV, blocked follow-ups, final-readiness verdict, row-level blocker drilldown,
  cleanup report CSV, reviewed owner-billing staging, reviewed tenant-contact
  staging, onboarding blocker review, billing cleanup blockers, and source-trail
  search. Verification: web `tsc --noEmit`, focused `eslint`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "portfolio QA guides cleanup fixes and source trails"`.
  Live SKJ tuning remains the follow-up; no automatic enrichment, provider
  action, or batch mutation runs from the report exports.
- Comms local channel items closed after scout-assisted verification:
  Inbound SMS via Twilio webhook, Inbound email AI classification v1, Inbound
  email parsing v1, and SMS outbound dispatch through Twilio Messaging are all
  marked `[x]`. Backend coverage passed for SendGrid inbound parse/tenant
  attribution/shared-secret checks, AI classification stamping, attachment
  Smart Intake routing/extraction/failure retention, Twilio inbound
  persistence/phone attribution/signature validation, and inbound-SMS dispatch
  through Twilio. Browser coverage passed for `/comms` SMS approval with phone
  recipient/no subject/SMS guide/receipt and Smart Intake inbound attachment
  review labels/CSV/filtering. Verification: two focused
  `pytest tests/integration/test_comms_api.py::...` runs (`7 passed` and
  `5 passed`), backend `ruff`, web `tsc --noEmit`, focused `eslint`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS with a phone recipient|smart intake labels inbound email attachments in review queue" --workers=1`.
  At that point the larger Scheduled comms loop umbrella and several
  compliance/rent-review subitems still needed follow-up; later closeout notes
  below record the local fixes and newly closed subitems.
- Xero/Billing/Owner statements local closeout: Xero connection diagnostics
  and callback feedback, Billing Readiness Xero freshness cues, Billing
  Readiness month-end finance checklist, Owner statements Billing handoff,
  Owner monthly statements v1 backend, Owner monthly statements v2 frontend,
  and the Continue Xero summary are now marked `[x]`. Backend coverage passed
  for local connection diagnostics and owner statement grouping/month
  filtering/paid-outstanding/unattributed/evidence behavior; browser coverage
  passed for Settings diagnostics/OAuth callback feedback/fail-closed provider
  actions, Billing Readiness handoffs, and Statements invoice evidence,
  dispatch-review CSV, and review-only dispatch draft downloads. Verification:
  `pytest tests/integration/test_xero_api.py -k connection_diagnostics -q`
  (`8 passed`), `pytest tests/integration/test_owners_api.py -q` (`11 passed`),
  backend `ruff`, web `tsc --noEmit`, focused `eslint`,
  `npx playwright test tests/smoke/app-flows.spec.ts -g "dashboard shows the mocked portfolio and opens billing readiness|settings shows Xero readiness and records mappings|settings shows Xero OAuth callback success feedback|settings shows Xero OAuth callback error feedback without tab param|settings disables Xero provider actions when diagnostics block capabilities|settings fails closed when Xero diagnostics|settings shows Xero draft creation ready only from diagnostics" --workers=1`
  (`9 passed`), and `npx playwright test tests/smoke/statements.spec.ts --workers=1`
  (`3 passed`). Owner statement PDF export remains `[~]` until the
  Remba/accountant formatting review is done; live Xero provider-console
  validation remains external.
- Maintenance/Contractors local closeout: Maintenance activity audit v1,
  Maintenance status forwarding drafts v1, Maintenance completion recipient
  review v1, Maintenance categorisation v2, and Contractor directory v1 are now
  marked `[x]`. The maintenance detail smoke covers the audit strip, audience
  badges, provider evidence, closeout trail, no-send forwarding drafts,
  recipient review notes, copy-only completion communications, review-only CSV
  packet, and Billing handoff. Contractor coverage proves CRUD and the
  review-only readiness CSV; classifier coverage proves AI category metadata,
  matched contractor suggestion, missing-key 503, and no-match null suggestion.
  Verification: `pytest tests/integration/test_contractors_api.py -q`
  (`4 passed`), focused `pytest tests/integration/test_maintenance_arrears_api.py::...`
  (`3 passed`), backend `ruff`, web `tsc --noEmit`, focused `eslint`,
  `npx playwright test tests/smoke/app-flows.spec.ts -g "maintenance detail route shows quote evidence" --workers=1`
  (`1 passed`), and `npx playwright test tests/smoke/contractors.spec.ts -g "contractor directory exports readiness CSV" --workers=1`
  (`1 passed`). Follow-up closeout added the missing focused smoke for
  Maintenance categorisation v3: it clicks Classify with AI, renders the
  stamped HVAC confidence, Same-day badge, warning, suggested contractor
  card/contact details, no-dispatch guardrail copy, and Apply-to-contractor
  Applied state. Verification: red run failed on missing `hvac · 82%` after
  clicking Classify with AI; after adding the smoke API classify response,
  `npx playwright test tests/smoke/app-flows.spec.ts -g "maintenance detail AI classification suggests and applies a contractor" --workers=1`
  passed (`1 passed`). Maintenance categorisation v3 is now `[x]`.
- Maintenance status forwarding automation closeout: the forwarding automation
  item is now `[x]`. `/api/v1/comms/queue` now emits
  `maintenance_contractor_forward` and `maintenance_tenant_forward` candidates
  from the latest tenant-visible and contractor-visible work-order timeline
  rows, `/comms` labels them as contractor/tenant forwards with an `Open work
  order` handoff, and Approve resolves the maintenance work order through the
  existing explicit Comms dispatch path before any SendGrid send attempt.
  Queue fetch and CSV export stay read-only. Verification:
  `pytest tests/integration/test_comms_api.py -q` (`43 passed`), backend
  `ruff`, web `eslint`, web `tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS" --workers=1`
  (`1 passed`).
- Comms compliance/rent-review closeout: Evidence attach on `/comms`
  compliance candidates, Compliance obligation tracking v1, and Annual rent
  reviews v1 are now marked `[x]`. The backend now honors
  `comms_dismiss`/`next_eligible_on` metadata for both `rent_review` lease
  candidates and `compliance_obligation` obligation candidates, so reviewed
  dispatches/dismissals do not immediately resurface on the next queue scan.
  Backend coverage proves rent-review formula/no-formula/far-future queue
  behavior, rent-review dispatch and dismiss stamps that clear the queue,
  compliance candidate generation, compliance evidence document linking, and
  compliance dispatch/dismiss stamps that clear the queue. Browser coverage now
  includes the compliance reminder card inside `/comms`, the Smart Intake
  handoff, manual `fire-safety.pdf` evidence upload receipt, and the reviewed
  SendGrid approval path while SendGrid is unconfigured. Verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py -k "rent_review or compliance_obligation or compliance_evidence" -q`
  (`9 passed, 32 deselected`), backend `ruff`, web `tsc --noEmit`, focused
  `eslint`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS with a phone recipient" --workers=1`
  (`1 passed`). The broader Scheduled comms loop item remains `[~]` for
  Remba/operator review of queue density and daily CSV handoff copy.
- In-app comms badge closeout: the sidebar Work-nav badge item is now `[x]`.
  Backend `/api/v1/comms/queue/counts` reuses the queue scanners and focused
  coverage proves urgent/by-kind totals (`1 passed, 40 deselected`). Browser
  smoke now verifies the Work nav label announces `7 drafts in the comms queue,
  3 urgent` after the `/comms` mock includes SMS, email, compliance, rent
  review, and tenant-lifecycle candidates. This keeps the broad Scheduled
  comms loop `[~]` only for Remba/operator review of density/copy.
- AI Inbox local closeout: AI inbox v2.1 lease-change pre-extraction and v2.3
  tenant-contact promote are now `[x]`. Fresh verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_ai_triage_api.py -k "lease_change or tenant_contact" -q`
  (`8 passed, 10 deselected`, with existing FastAPI 422 deprecation warnings),
  backend `ruff` for `apps/api/routers/ai.py`, `stewart/ai/lease_change.py`,
  `stewart/ai/tenant_contact.py`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "AI inbox tenant contact classification applies selected fields" --workers=1`
  (`1 passed`). Lease-change remains zero-frontend-change because Smart Intake
  already renders populated extraction groups from the promoted intake.
- DocuSign local runway closeout: DocuSign integration runway v1 is now `[x]`.
  The stale provider-helper docstring was updated to describe the real JWT +
  envelope-create path rather than the old scaffold-only state. Fresh local
  verification: `pytest tests/unit/test_docusign.py tests/integration/test_system_api.py tests/integration/test_tenant_onboarding_api.py -k "docusign or activate_lease or send_lease_pack" -q`
  (`40 passed, 15 deselected`),
  `OPENAI_API_KEY= pytest tests/integration/test_tenant_portal_api.py tests/integration/test_document_intake_api.py tests/integration/test_comms_api.py -k "docusign or active_docusign or DocuSign" -q`
  (`8 passed, 101 deselected`), and
  `pytest tests/unit/test_webhook_auth.py -q` (`4 passed`), plus
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail sends lease pack after onboarding approval|tenant detail shows skipped DocuSign setup after lease pack send|tenant detail flags declined DocuSign envelope|settings shows Xero readiness and records mappings|settings explains DocuSign demo endpoint readiness" --workers=1`
  (`5 passed`). Live DocuSign provider-console verification remains external
  and is still tracked in `docs/deployment.md` plus
  `docs/tenant-lifecycle-production-smoke.md`.
- Tenant portal compliance empty-state closeout: the compliance empty-state
  item is now `[x]`. The API now treats an explicit empty
  `tenant_metadata["portal_compliance_checklist"]` as no required tenant
  checklist while keeping upload categories/supporting files available, and
  operator preview CSVs include the no-required-documents row. Verification:
  `OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_allows_empty_compliance_checklist -q`
  (`1 passed`) and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant portal operator preview shows contact review" --workers=1`
  (`1 passed`). The tenant portal contact-edit umbrella item remains `[~]`;
  scouts found an account-scoped contact-edit caveat that should not be
  hand-waved.
- Tenant portal maintenance status clarity closeout: the status clarity item is
  now `[x]`. A focused operator-preview smoke uses a maintenance status matrix
  to prove requested, triaged, assigned, awaiting approval, approved, in
  progress, completed, and cancelled wording renders in the tenant-visible
  preview without creating portal accounts or mutating provider/tenant state.
  Verification:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant portal operator preview explains every maintenance status" --workers=1`
  (`1 passed`).
- Tenant portal activity feed closeout: the activity feed item is now `[x]`.
  The operator preview mirrors the same derived Recent Activity feed used by
  the tenant portal side rail and exports activity rows in the preview CSV, so
  browser proof no longer depends on a live Clerk tenant account. The focused
  smoke covers invite, document upload, contact request, maintenance history,
  and notification-preference events plus the copy-summary control and CSV
  rows. Verification:
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant portal operator preview shows recent activity feed" --workers=1`
  (`1 passed`).
- Settings Work notifications density pass: the Security tab's Work
  notifications section now renders each operator as a compact notification
  row with identity, email toggle, SMS toggle/phone save, digest cadence, and a
  collapsed Template defaults disclosure. The latest digest receipt in Settings
  is deliberately reduced to the scan-critical "Last digest" + send state; the
  richer receipt/provider history remains in Notifications. Focused smoke now
  asserts the default row stays at or below 170px wide-desktop height and that
  Template preview content remains hidden until the disclosure opens.
  Verification: `./node_modules/.bin/eslint src/app/settings/page.tsx tests/smoke/app-flows.spec.ts`,
  `./node_modules/.bin/tsc --noEmit`, and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "settings shows Xero readiness and records mappings" --workers=1`
  (`1 passed`).
- Communications hub local history v1: tenant detail now has a read-only
  Correspondence panel after Activity, fed by
  `/api/v1/comms/correspondence/tenants/{tenant_id}`. The endpoint combines
  stored inbound messages with reviewed comms audit dispatch/dismiss receipts
  tied to the tenant, lease, onboarding, arrears, maintenance, and obligation
  records. The panel shows the latest event type, direction, timestamp,
  channel, counterparty, subject, summary/body preview, provider badge, and
  explicit guardrails that opening it does not send email/SMS or mutate queue or
  tenant state. Regression coverage now excludes cross-entity inbound rows and
  generic non-comms dispatch audit rows, and asserts newest-first ordering. The
  broad Communications hub roadmap item stays open for templates, full outbound
  logs, contractor threads, and record-linked thread workflows.
  Verification: `.venv/bin/python -m pytest tests/integration/test_comms_api.py -q`
  (`44 passed`), `.venv/bin/python -m ruff check apps/api/routers/comms.py apps/api/schemas/comms.py tests/integration/test_comms_api.py`,
  `./node_modules/.bin/eslint 'src/app/tenants/[tenantId]/page.tsx' src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`,
  `./node_modules/.bin/tsc --noEmit`,
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail shows portal access recovery actions" --workers=1`
  (`1 passed`), and
  `npx playwright test tests/smoke/app-flows.spec.ts -g "settings shows Xero readiness and records mappings" --workers=1`
  (`1 passed`).
- Tenant correspondence CSV export v1: the tenant detail Correspondence panel
  now has a local `Download correspondence CSV` action beside the event count.
  It exports the already-loaded timeline only, with event type, direction,
  timestamp, channel, counterparty, subject, summary, status, provider, target,
  endpoint guardrails, and an explicit no-send/no-mutation export guardrail.
  Formula-leading cells are prefixed before CSV quoting so inbound addresses or
  subjects cannot execute spreadsheet formulas when opened in Excel/Sheets. No
  backend route, provider call, queue refresh, or tenant mutation is involved.
  Verification: red/green
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail shows portal access recovery actions" --workers=1`
  (`1 passed`), `./node_modules/.bin/eslint 'src/app/tenants/[tenantId]/page.tsx' tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts src/lib/api.ts`,
  `./node_modules/.bin/tsc --noEmit`, and
  `.venv/bin/python -m pytest tests/integration/test_comms_api.py -q`
  (`44 passed`).
- Tenant correspondence record links v1: correspondence events now derive a
  local open-record link from `target_kind`/`target_id` where the destination is
  safely known: arrears opens the Work arrears tab, maintenance opens the work
  order detail, inbound messages open the Comms queue, tenant/onboarding/lease
  targets return to the tenant workflow, and obligations open Work. This keeps
  the tenant timeline read-only while making record-linked correspondence less
  of a dead end.
  Verification: red/green
  `npx playwright test tests/smoke/app-flows.spec.ts -g "tenant detail shows portal access recovery actions" --workers=1`
  (`1 passed`), `./node_modules/.bin/eslint 'src/app/tenants/[tenantId]/page.tsx' tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts src/lib/api.ts`,
  and `./node_modules/.bin/tsc --noEmit`.
- Comms outbound log v1: `/api/v1/comms/outbound-log?entity_id=...` now
  returns a read-only, entity-scoped list of stored comms dispatch receipts from
  `AuditAction`, using the existing candidate-id guard to exclude dismissals,
  generic workflow dispatches, mismatched candidate rows, and cross-entity
  receipts. `/comms` shows the log below the metric cards with compact rows,
  provider/channel/status context, local target links, guardrail copy, and a
  review-only CSV export. Viewing/downloading the log does not dispatch,
  dismiss, upload evidence, refresh providers, or mutate queue state.
  Verification: red/green
  `.venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_outbound_log_returns_recent_dispatch_receipts -q`
  (`1 passed`),
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS with a phone recipient" --workers=1`
  (`1 passed`), `.venv/bin/python -m pytest tests/integration/test_comms_api.py -q`
  (`45 passed`), `.venv/bin/python -m ruff check apps/api/routers/comms.py apps/api/schemas/comms.py tests/integration/test_comms_api.py`,
  `./node_modules/.bin/eslint src/app/comms/page.tsx src/lib/api.ts tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts`,
  and `./node_modules/.bin/tsc --noEmit`.
- Comms outbound log filters v1: the `/comms` outbound log now has compact
  local filters for all receipts, needs-attention receipts, email, and SMS.
  The visible count updates by filter, the rows are filtered client-side from
  the already-loaded audit receipt response, and the CSV export now receives the
  same visible receipt set plus a filter summary. The panel remains read-only:
  filtering and exporting do not dispatch, dismiss, upload evidence, refresh
  providers, mutate queue state, or write provider history.
  Verification: red/green
  `npx playwright test tests/smoke/app-flows.spec.ts -g "comms queue approves inbound SMS with a phone recipient" --workers=1`
  (`1 passed`), `./node_modules/.bin/eslint src/app/comms/page.tsx tests/smoke/app-flows.spec.ts`,
  and `./node_modules/.bin/tsc --noEmit`.
- Maintenance correspondence panel v1:
  `/api/v1/comms/correspondence/maintenance-work-orders/{work_order_id}` now
  returns a read-only target-linked timeline of stored Comms dispatch/dismiss
  receipts for `maintenance_contractor_forward` and
  `maintenance_tenant_forward`, excluding generic workflow dispatches,
  mismatched candidate ids, wrong-target rows, and cross-entity receipts. The
  audit receipt helper now accepts real `comms.dismiss` rows as well as the
  older `comms.queue` test seed shape. Maintenance detail shows a compact
  Correspondence panel in the right-side context column with provider/channel
  status, recipients, Comms/tenant handoffs, guardrails, and a local
  `maintenance-correspondence-{work_order_id}.csv` export. Viewing/exporting
  does not dispatch, dismiss, upload evidence, refresh providers, mutate queue
  state, or mutate the work order.
  Verification: red/green
  `.venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_maintenance_correspondence_returns_work_order_receipts -q`
  (`1 passed`),
  `npx playwright test tests/smoke/app-flows.spec.ts -g "maintenance detail route shows quote evidence" --workers=1`
  (`1 passed`), `.venv/bin/python -m pytest tests/integration/test_comms_api.py -q`
  (`46 passed`), `.venv/bin/python -m ruff check apps/api/routers/comms.py apps/api/schemas/comms.py tests/integration/test_comms_api.py`,
  `./node_modules/.bin/eslint 'src/app/operations/maintenance/[workOrderId]/page.tsx' src/lib/api.ts tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts`,
  and `./node_modules/.bin/tsc --noEmit`.

## Cowork session 2026-05-31 — DoorLoop benchmark + refocus

Research + planning session (no app code changed; **docs only**). Studied DoorLoop's
product, UX, and information architecture and refocused the backlog around it.

Added/updated (all uncommitted — docs only, additive, safe to review then commit):
- **NEW** `docs/doorloop-benchmark-2026-05-31.md` — full DoorLoop vs Leasium benchmark +
  gap analysis (People/Properties IA, feature matrix, AU-localisation, what not to copy).
- **NEW** `docs/superpowers/plans/2026-05-31-people-hub-and-ia-refocus.md` — test-first P0
  execution plan (Owner entity → People hub → nav consolidation), with a P1 preview.
- `docs/product-roadmap.md` — new top section in Next Build Order: "DoorLoop benchmark
  refocus (2026-05-31)" with P0–P3 `[ ]` items.
- `docs/design-governance.md` — new "2026-05-31 DoorLoop Benchmark — IA + UX Direction"
  (prototype-mode direction, not a Remba gate) + a Standing UX Direction bullet.
- `docs/leasium-codex-design-source-of-truth.md` — §11 nav model refreshed to the shipped
  nav + the People/Money target; §10.5.1 cap note updated to the People-hub path to 7.
- `CLAUDE.md` — new §2.10 "People + Properties IA north star (DoorLoop-informed)".

Where to start next session: the People-hub plan, **Ticket 1.1 — `Owner` + `PropertyOwner`
models + migration** (red test first). Keep it additive — the legacy Property owner-fields
stay as the backfill source until the Owner read path is proven at parity (Ticket 1.3).

Awaiting Temba: go-ahead to begin building P0; optional calls on the AU payment rail
(Monoova / Zai / Stripe AU) and whether to formalise a `leasium-ux-standard` skill. The
literal DoorLoop tutorial transcript could not be machine-pulled (YouTube blocked in the
sandbox, no browser connected) — the benchmark was reconstructed from DoorLoop's own docs.

## Cowork session 2026-05-31 (cont.) — P0 build started: Owner entity + CRUD API

Built and verified on Temba's Mac via Desktop Commander, **all uncommitted** — review then commit. Additive only; no existing behaviour changed.

**Ticket 1.1 — Owner + PropertyOwner models + migration (DONE, green):**
- `stewart/core/models.py` (+81): new `Owner` (mirrors the 11 `Property` owner fields) + `PropertyOwner` association (`split_pct`, unique `(property_id, owner_id)`); added `Entity.owners` and `Property.owner_links` relationships.
- `migrations/versions/20260531_0029_owner_entity.py`: creates `owner` + `property_owner`. `alembic heads` → single head `20260531_0029`; offline `--sql` emits correct DDL. **NOT applied to a live DB** — local Postgres/Docker was down. Apply with `docker compose up -d && .venv/bin/alembic upgrade head`.
- `tests/integration/test_owner_entity.py`: 2 ORM tests (split round-trip, default split). Red→green.

**Ticket 1.4 — Owner CRUD API (DONE, green):**
- `apps/api/schemas/owner_entities.py` + `apps/api/routers/owner_entities.py`: list / create / detail / patch / soft-delete at `/api/v1/owners`; `OwnerRead` surfaces linked properties + count. Registered AFTER `owners.router` in `main.py` (+2) so the literal `/owners/statements*` paths keep priority over `/owners/{owner_id}`.
- `tests/integration/test_owner_entity_api.py`: 4 tests incl. a guard that `/owners/statements` still resolves.

**Evidence:** ruff clean on all changed files; **full integration suite 337 passed / 1 skipped** (was 333; +4 new), no regressions.

**Update (same session, cont.) — Ticket 1.2 + Ticket 1.3 de-risk also done + green (still uncommitted):**

- **Ticket 1.2 — Owner backfill (DONE):** `stewart/core/owner_backfill.py` — idempotent `backfill_owners(session, entity_id=None)` groups by the same identity tuple as the statements router, creates one Owner per identity, links each property at 100%, skips unattributed. Entrypoint `scripts/backfill_owners.py` (`python -m scripts.backfill_owners`). Tests `tests/integration/test_owner_backfill.py` (dedupe/link + idempotency).
- **Ticket 1.3 — parity proven, endpoint swap DEFERRED:** `tests/integration/test_owner_statement_parity.py` proves the backfilled Owner/PropertyOwner data reproduces the legacy `_owner_identity_tuple` clusters exactly (attributed clusters match; unlinked == unattributed). The live `/owners/statements` endpoint is **unchanged** — the actual read-path swap (`_build_owner_statements` grouping via Owner with an unattributed fallback) is left for review against the real SKJ portfolio; this parity test is its safety net.

Full integration suite now **340 passed / 1 skipped**, ruff clean. Remaining P0: the reviewed statements swap, then Phase 2 (People hub UI — design-facing, paused for your direction). To apply migration + run backfill once Docker is up: `docker compose up -d && .venv/bin/alembic upgrade head && .venv/bin/python -m scripts.backfill_owners`.

## Cowork session 2026-05-31 (cont.) — process note: commit `ae6fabb` bundled extra work

`ae6fabb "Add Leasium-vs-PropertyMe take-on strategy"` unintentionally bundled **17 files of the
owner-portal-account-auth slice** (`owner_portal.py`, schemas, account UI, invite page, migration
`20260531_0030_owner_portal_accounts`, `models.py`, auth tests, `api.ts`) with the one intended file
(`market-research/Leasium_vs_PropertyMe_Strategy.md`). Cause: that work was already **staged in the
git index**, and a bare `git commit` commits the whole index. No history harm (single local repo, no
divergence); the commit **built green on Vercel and is live on leasium.ai**, and the slice's own doc
updates were inside the same commit, so the work IS documented — only the commit **subject**
under-describes it. History was **not** rewritten (amend/force-push on shared `main` is the dangerous
move). **TODO: confirm Render applied migration `20260531_0030`** for the owner-portal-account backend.
**Process fix going forward:** commit with **explicit pathspecs** (`git commit -- <path>`), never a bare
`git commit`, so a shared index is never swept again.

## Cowork session 2026-05-31 (cont.) — competitor teardowns (:Different, Ailo)

Added `market-research/Leasium_vs_Different_Ailo_Teardown.md`. Key finding: **neither is a
self-managing-owner SaaS rival.** Ailo = a modern B2B *agency* platform (a PropertyMe challenger, NPP
payments, ~200k users, agencies 100–500 doors). :Different = a tech-enabled PM *service* (done-for-you),
now largely white-labelling service delivery to agencies. So Leasium's "software for DIY owners" lane is
open; its real competitor is the **decision to outsource** (an agency / :Different) and inertia
(spreadsheets) — position against the **management fee**, and match the **NPP real-time + owner-app
transparency** bar Ailo set. Next AU comparisons still open: Kolmeo.
