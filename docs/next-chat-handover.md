# Leasium Next Chat Handover

Last updated: 2026-05-20

## Current State

- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.vercel.app`
- Latest confirmed app-code production deployment: `991c4bb Add tenant portal account entry`, Vercel deployment `dpl_EuTmsajEMsQkKzWM1hv2RHQz2TMV`, state `READY`; `/settings` redirects signed-out operators to `/sign-in`, `/tenant-portal` and `/tenant-portal/account` return `200`, and Render API health is live.
- Product source of truth: `docs/product-roadmap.md`
- Brand/frontend design source of truth: `docs/leasium-codex-design-source-of-truth.md`
- UX governance source of truth: `docs/design-governance.md`; design-facing changes still need Remba review.

## Closed And Updated

- Codex design source of truth has been imported into the project.
  - Source file now lives at `docs/leasium-codex-design-source-of-truth.md`.
  - `docs/design-governance.md` and `docs/product-roadmap.md` link to it for future design-facing work.
- Operator security and settings arena v1 is built on this branch.
  - New `/api/v1/me` returns the current operator, organisation, entity roles, auth boundary, and owner/admin management flag.
  - New `/api/v1/security/workspace` returns Settings-ready auth, organisation, member, and role data.
  - Owner/admin users can create or update operator access records, assign entity-scoped roles, and activate/deactivate teammates through `/api/v1/security/members`.
  - Operator invites now use hashed one-time tokens, SendGrid delivery when configured, resend actions, status tracking, and `/api/v1/security/invitations/accept`.
  - `/accept-invite` links a signed-in Clerk user to the existing Leasium operator record.
  - Settings now has Security, Organisation, and Xero sections; Security exposes dev-auth/Clerk readiness without exposing secrets.
  - This is design-facing and still needs Remba review.
  - Production rollout still needs Clerk/SendGrid env vars configured, first invite acceptance verified, and `AUTH_MODE` switched from dev to clerk.
- First workspace setup foundation is built on this branch.
  - New public `/api/v1/security/bootstrap/status` reports whether a clean database can be bootstrapped.
  - New `/api/v1/security/bootstrap` creates the first organisation, primary entity, and owner operator only when the database has no organisations, entities, or operators.
  - Bootstrap requires `AUTH_MODE=clerk`, `CLERK_JWKS_URL`, and a signed-in Clerk bearer token; Clerk mode now fails closed without JWKS unless `CLERK_ALLOW_LEGACY_TOKEN_MAPPING=true` is explicitly set for legacy/testing use.
  - New `/setup` frontend flow handles Clerk-not-configured, signed-out, unavailable, and signed-in setup states, and `/setup` stays public through the temporary password gate.
  - Commit `f15beef`, Vercel deployment `dpl_7f8GngXJk4NQ7PsYhFSyJPuyfmMF`, state `READY`; deployment URL `/setup`, production alias `/setup`, and production alias `/sign-in` returned `200`.
  - This is design-facing and still needs Remba review.
- Operator workspace sign-in guard is built on this branch.
  - When both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set on the web app, middleware redirects signed-out protected workspace requests to `/sign-in` before workspace API calls run.
  - If only the publishable key is present, the client shell still shows a friendly signed-out operator guard.
  - Public `/setup`, `/accept-invite`, `/sign-in`, `/sign-up`, `/access`, and `/onboarding/...` routes remain open.
  - The smoke suite includes request-level Clerk middleware coverage that is skipped unless `LEASIUM_SMOKE_CLERK_GUARD`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY` are provided.
  - Commit `7cfc027`, Vercel deployment `dpl_GCM9ajy5Bk9izW4v7ENsbAY1bh6q`, state `READY`; production alias `/setup` and `/sign-in` returned `200`.
  - Production alias `/settings` currently returns `200`, which means the web app is not yet enforcing the server-side Clerk middleware in production. Set both Clerk web env vars and redeploy before treating production as login-protected.
  - This is design-facing and still needs Remba review.
- Temporary private-beta password gate is built and pushed in `f845a69`.
  - `LEASIUM_ACCESS_PASSWORD` controls whether the gate is active.
  - When unset or blank, the frontend remains open for local/dev convenience.
  - `/onboarding/...` stays public so tenant onboarding links are not blocked.
  - Vercel code is deployed, but the live site is only protected after the env var is set in Vercel and redeployed.
- Property ownership and billing identity is listed as built.
  - Includes owner/trust/split fields, property-level chips, collapsible setup, billing blockers, and Smart Intake extraction/apply support.
- Smart Intake property provenance v1 is now listed as built.
  - Purchase contract apply stores source citations, before/after property changes, apply history, and property audit logs.
- Smart Intake property provenance UI is built on this branch.
  - Purchase-contract apply outcomes show property before/after changes returned by the backend.
  - The Property workspace now surfaces latest source history, field citations, confidence, and deep links back to the source intake.
  - This is design-facing and still needs Remba review.
- Smart Intake acquisition tenancy schedule v1 is built on this branch.
  - Extraction schema includes `tenancy_schedule`.
  - Purchase contract apply now prefers schedule rows for unit creation/linking.
  - Tenant/rent/lease facts are stored on `TenancyUnit.metadata.tenancy_schedule` and history.
  - Complete reviewed schedule rows now create/link tenants and create pending leases after Apply.
  - Lease expiry, rent review, option notice, and security review tasks are generated from schedule dates with source metadata.
  - Reviewed annual rent and outgoings rows now seed draft-marked charge rules for the created pending leases.
  - Incomplete or overlapping rows are skipped with plain blockers in the applied summary.
- Smart Intake acquisition tenancy schedule v2 is built on this branch.
  - Extraction schema now asks purchase-contract tenancy schedules for parking, storage, utilities, promotion levy, and other charge amounts/frequencies.
  - Apply now creates draft-marked non-rent charge rules from reviewed complete rows, still with no invoice posting and no Xero sync.
  - Invalid rows are skipped before tenant creation when core lease facts are blocked, including expiry-before-start and zero-rent checks.
  - Purchase-contract apply outcomes now surface pending lease IDs, draft charge detail, and skipped schedule row blockers.
  - This is design-facing and still needs Remba review.
- Smart Intake billing drafts v1 is built on this branch.
  - `invoice_admin` apply still creates the source-linked billing review task.
  - It now also creates `billing_draft` and `billing_draft_line` records from reviewed money amounts.
  - Drafts support reviewed status updates such as approved or void.
  - Drafts are still no-posting/no-PDF/no-email/no-Xero-sync.
- Billing Readiness now surfaces Smart Intake billing drafts.
  - The page lists amount, due date, status, line/source context, and approve/void actions.
  - Approve/void only changes draft status; it still does not post invoices, send tenant emails, generate PDFs, or sync to Xero.
  - This is design-facing and still needs Remba review.
- Invoice draft staging v1 is built and migrated.
  - Approved billing drafts can create internal `invoice_draft` and `invoice_draft_line` records.
  - Billing Readiness lists invoice drafts with recipient, amount, due date, readiness blockers, source billing draft, and no-PDF/no-email/no-Xero guardrails.
  - Invoice draft creation is idempotent per billing draft and blocked until the billing draft is approved.
  - This is design-facing and still needs Remba review.
- Invoice draft delivery preparation v1 is built on this branch.
  - Internal invoice drafts can prepare an HTML invoice preview and tenant email draft metadata.
  - Delivery preparation stores blocker state and keeps `pdf_generated`, `tenant_email_sent`, and `xero_synced` false.
  - Drafts move to `ready_for_approval` only when delivery blockers are clear, and API approval is blocked until delivery prep is ready.
  - Billing Readiness now shows preview/email/Xero state plus Prepare, Preview, Approve, and Void actions.
  - This is design-facing and still needs Remba review.
- Invoice generation and delivery v1 is built on this branch.
  - Delivery prep now stores a source-linked PDF artifact document and keeps branded email draft metadata.
  - Approved invoice drafts can record manual tenant delivery receipts.
  - Invoice drafts track unpaid/part-paid/paid payment status and approval-safe posting preparation.
  - Xero sync remains explicitly off; no external posting action exists yet.
  - This is design-facing and still needs Remba review.
- Public AI enrichment v1 is built on this branch.
  - New `/api/v1/public-enrichment/preview` and `/api/v1/public-enrichment/apply` routes support property and tenant targets.
  - Supported facts include ABN, suburb/state/postcode, owner/legal names, trust/trustee names, invoice issuer name, tenant registered address, and tenant business names.
  - Preview calls OpenAI web search with trusted-source instructions and returns value, source hint, citation, confidence, warnings, and response id.
  - Apply refuses existing non-blank fields, stores public enrichment metadata/source citations/apply history, and audits the reviewed apply.
  - Property and tenant workspaces expose the review-first suggestion/apply surface.
  - This is design-facing and still needs Remba review.
- Tenant onboarding delivery polish v1 is built on this branch.
  - Delivery attempts store brand/template metadata from settings.
  - Reminder schedules can be edited with `PATCH /api/v1/tenant-onboarding/{id}/reminders`.
  - Expiry reminders are planned before link expiry, and reminder runs handle normal and expiry reminders.
  - Contact/configuration recovery hints remain visible from delivery status.
  - This is design-facing and still needs Remba review.
- Tenant detail deepening v1 is built on this branch.
  - New `/api/v1/tenants/{tenant_id}/detail` returns property/unit/lease labels, activity, and reviewed-change history.
  - Tenant detail now shows richer lease context, activity, reviewed changes, and public-fact enrichment.
  - Applied source documents and submitted onboarding documents are protected from unsafe deletion.
  - This is design-facing and still needs Remba review.
- Xero readiness and mapping v1 is built on this branch.
  - New `/api/v1/xero/status` reports entity connection state, contact readiness, chart/account mapping gaps, tax mapping gaps, approved invoice sync queue counts, payment reconciliation counts, and explicit no-sync guardrails.
  - New `/api/v1/xero/connection/{entity_id}` records or clears the entity Xero tenant ID with audit logging; `xero_last_sync_at` remains read-only until a real sync worker exists.
  - Settings now surfaces the readiness queue and can apply reviewed charge-rule account/tax mappings through the existing charge-rule API.
  - No OAuth, Xero API call, invoice posting, contact sync, or payment reconciliation runs from this surface yet.
  - This is design-facing and still needs Remba review.
- Insights overview v1 is built on this branch.
  - New `/api/v1/insights/overview` returns portfolio health, live exceptions, automation activity, billing risk, and owner/entity snapshots from existing register, rent-roll, Xero readiness, and audit data.
  - The endpoint is read-only and does not expose audit `tool_input`.
  - `/insights` now uses the overview API instead of stitching together many separate client-side queries.
  - This is design-facing and still needs Remba review.
- Shareable Insights snapshots v1 is built on this branch.
  - The overview payload now includes finance and lease-event snapshots alongside owner/entity snapshot data.
  - New `/api/v1/insights/snapshots` creates hashed-token, expiring, revocable frozen snapshots from the live overview.
  - New `/api/v1/insights/snapshots/public/{token}` serves the frozen public snapshot without recomputing live portfolio data.
  - `/insights` can generate owner, finance, or lease-event snapshot links and revoke saved snapshots.
  - New public `/snapshots/<token>` renders the shared snapshot as a read-only frozen view, and the operator sign-in guard leaves this public path open.
  - This is design-facing and still needs Remba review.
- Dashboard and Insights loading-state polish is built on this branch.
  - Dashboard now shows a clear live-portfolio loading panel while entity/data
    queries are waking up, keeps prior data during refetches, and shows a
    consolidated retry state if live data fails.
  - The Dashboard attention panel no longer shows a false `No urgent dates`
    empty state while obligations are still loading.
  - Insights now shows explicit loading, retry, and defensive empty states for
    the overview request instead of leaving the first viewport looking blank.
- Properties and Billing Readiness loading-state polish is built on this branch.
  - Properties now has a page-level loading panel, consolidated retry state,
    refresh indicator, and guarded table/empty states for properties, units,
    attention dates, rent roll, and charge-rule setup.
  - Billing Readiness now has a page-level loading panel, consolidated retry
    state, refresh indicator, and guarded empty states for rent roll blockers,
    billing drafts, and invoice drafts.
  - This closes the broad loading-state priority fix from the 2026-05-20 Remba
    scan; remaining Remba work is mainly workspace structure, tabs, and crowded
    page hierarchy.
- Property workspace task-zone split is built on this branch.
  - `/properties` now has Portfolio, Operations, Billing, and Documents tabs so
    document intake, dates/units/leases, rent roll, billing identity, source
    history, and the property table no longer compete in one long page.
  - Property create/edit now opens in a focused overlay instead of an
    always-visible side rail.
  - This is design-facing and still needs Remba review.
- Billing Readiness task-zone split is built on this branch.
  - `/billing-readiness` now has Readiness, Billing drafts, Invoice prep, and
    Delivery & payments tabs so blocker cleanup, Smart Intake draft review,
    invoice preparation/approval, and manual delivery/payment recording no
    longer compete in one long workspace.
  - The Readiness tab keeps the action queue with rent-roll checks so operators
    can see the next blocker to fix before an invoice run.
  - Invoice prep remains approval-safe, and Delivery & payments keeps the
    no-tenant-email-send/no-Xero-sync guardrails explicit.
  - This is design-facing and still needs Remba review.
- Smart Intake applied outcomes now read backend apply results for billing draft, pending lease, and draft charge counts.
  - This is design-facing and still needs Remba review.
- Overnight build bundle is implemented and documented in `docs/product-roadmap.md`.
  - Spreadsheet portfolio import moved from backend dry-run to Smart Intake review/apply with explicit approved action IDs, source workbook/sheet/row provenance, confidence/source hints, and before/after metadata where feasible.
  - Portfolio QA is now surfaced from Insights as the cleanup IA entry point, still pending Remba review.
  - Xero now supports explicit local posting approval, idempotent provider-backed draft invoice creation, and payment reconciliation preview/apply into local invoice metadata.
  - Approved invoice drafts can send prepared invoice emails through SendGrid when configured, attach stored PDF artifacts, and record provider delivery status while keeping Xero sync separate.
  - Tenant portal self-service v1 is available at `/tenant-portal/[token]` for token-scoped onboarding status, documents, approved invoices/payment summary, compliance uploads, and notification preferences. True tenant identity-provider auth is still future work.
  - Maintenance work orders and arrears/credit-control cases now have migration-backed APIs and audit-friendly metadata. Operator UI workspaces are next.
  - New migration: `20260520_0018_maintenance_arrears_foundations`.
- Operations workspace v1 is built on this branch.
  - The top-nav Tasks entry is now Operations and points to `/operations`; `/tasks` redirects to `/operations`.
  - The original triage queue remains, with maintenance and arrears added into the prioritized operational queue.
  - Maintenance tab lists work orders, supports quick creation, filtering by status/priority, and approval/start/complete status actions.
  - Arrears tab lists ageing, reminders, disputes, promise-to-pay, and escalation state, with reminder/escalate/resolve actions.
  - This is design-facing and still needs Remba review.
- Tenant portal maintenance requests v1 is built on this branch.
  - `/tenant-portal/[token]` now includes a Maintenance panel where token-scoped tenants can submit a request, choose priority, add details/location reference, and see prior portal-submitted requests.
  - `/api/v1/tenant-portal/session` includes `maintenance_requests`, and new `GET`/`POST /api/v1/tenant-portal/maintenance-requests` endpoints create scoped `maintenance_work_order` rows.
  - Request creation infers entity/property/unit/tenant/lease context from the portal token, marks the work order as `requested`, stores tenant-portal provenance metadata, validates blank text, and validates attached document/photo IDs through the portal document boundary.
  - The response intentionally exposes only portal-safe fields; operator-only fields remain in `/operations`.
  - This is design-facing and still needs Remba review.
- Operations maintenance detail v1 is built on this branch.
  - Operator maintenance create/update now appends compact `metadata.activity_history` entries when tracked fields change.
  - Tenant portal submissions start with a `tenant_submitted` history entry, and tenant portal reads expose a safe history list without actor/source/raw metadata.
  - `/operations` maintenance rows can expand to show approval/quote, contractor, invoice, attachments, notes, and activity detail.
  - Operators can link/unlink approved invoice drafts to work orders through the Operations detail panel; the API already validates invoice drafts by entity.
  - This is design-facing and still needs Remba review.
- Xero operator approval UI v1 is built on this branch.
  - Settings now turns the provider invoice posting preview into an operator workflow.
  - Ready invoice drafts can be explicitly approved or revoked for Xero posting from the preview result.
  - Xero draft creation remains a separate action and returns created/skipped/blocked/failed outcome panels with provider IDs/status where available.
  - The copy keeps tenant email delivery and payment reconciliation separate from Xero draft creation.
  - This is design-facing and still needs Remba review.
- Tenant portal account foundation v1 is built on this branch.
  - New `tenant_portal_account` model and migration `20260520_0019_tenant_portal_accounts` store tenant-linked bearer identities without using operator `app_user` or entity-role access.
  - `POST /api/v1/tenant-portal/account/claim` requires a valid bearer identity plus an existing portal token before linking the signed tenant identity.
  - `GET /api/v1/tenant-portal/account/session` is bearer-only and returns the existing tenant portal read shape with `auth.mode = tenant_portal_account`.
  - Existing public `/tenant-portal/[token]`, `/api/v1/tenant-portal/session`, document, maintenance, and onboarding token paths remain available.
  - Tenant portal account UI v1 is now built too.
    - `/tenant-portal/[token]` shows Account Access when Clerk is configured.
    - Signed-in tenants can link the token-scoped portal once, then reload matching portal data through the account session.
    - Account-scoped maintenance requests, document uploads, notification preferences, and document downloads are accepted by the API through bearer auth, while the token path remains available.
    - The UI avoids overriding the page with an account linked to a different tenant and asks the tenant to switch accounts instead.
  - Tenant portal maintenance photo upload v1 is now built too.
    - Tenants can choose a photo inside the maintenance request form.
    - The portal stores the photo as a tenant document first, sends the returned document ID as `photo_document_ids`, and then creates the maintenance request.
    - The flow works for both token-scoped portal links and linked tenant account bearer sessions.
    - Portal maintenance history shows attached file counts while keeping operator-only metadata hidden.
  - Tenant portal account-only entry v1 is now built too.
    - `/tenant-portal` and `/tenant-portal/account` open a tenant account entry screen instead of requiring the old token URL.
    - Signed-in linked tenants load the same account-scoped portal data through `/tenant-portal/account/session`.
    - Account-scoped invoice/document downloads use bearer-backed blob downloads because plain links cannot send the tenant bearer token.
    - `/tenant-portal/[token]` remains the link-and-token fallback path.
  - This is design-facing and still needs Remba review.
## Verification

- Tenant portal account-only entry checks passed:
  - `./node_modules/.bin/eslint 'src/app/tenant-portal/[token]/page.tsx' src/app/tenant-portal/page.tsx src/app/tenant-portal/account/page.tsx src/app/tenant-portal/tenant-portal-content.tsx src/lib/api.ts src/lib/operator-routes.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts tests/smoke/clerk-guard.spec.ts --ext .ts,.tsx`
  - `./node_modules/.bin/tsc --noEmit`
  - `PORT=3005 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts` (`7 passed`, `3 skipped`)
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  - `git diff --check`
  - Production Vercel deployment `dpl_EuTmsajEMsQkKzWM1hv2RHQz2TMV` is `READY`.
  - Production Vercel `/tenant-portal` and `/tenant-portal/account` returned `200`, `/settings` returned `307` to `/sign-in`, and Render `/health` returned `200`.
- Tenant portal maintenance photo upload checks passed:
  - `./node_modules/.bin/eslint 'src/app/tenant-portal/[token]/page.tsx' tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts --ext .ts,.tsx`
  - `./node_modules/.bin/tsc --noEmit`
  - `PORT=3005 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts` (`7 passed`, `1 skipped`)
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  - `git diff --check`
  - Production Vercel deployment `dpl_2vUVQYbi6cze9QNgQCDNqGNGs8Wf` is `READY`.
  - Production Vercel `/settings` returned `307` to `/sign-in`, `/tenant-portal/not-a-real-token` returned `200`, and Render `/health` returned `200`.
- Tenant portal account UI checks passed:
  - `.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py -q` (`7 passed`)
  - `./node_modules/.bin/eslint 'src/app/tenant-portal/[token]/page.tsx' src/lib/api.ts tests/smoke/api-mocks.ts --ext .ts,.tsx`
  - `./node_modules/.bin/tsc --noEmit`
  - `PORT=3005 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant portal shows scoped self-service data"` (`1 passed`)
  - Production Vercel deployment `dpl_EZUjAdCB87dAoJhD74h5sdRnUe8P` is `READY`.
  - Production Vercel `/settings` returned `307` to `/sign-in`, and `/tenant-portal/not-a-real-token` returned `200`.
  - Production Render `/health` returned `200`, and OpenAPI now lists `authorization` on tenant portal account session/claim plus portal maintenance, preference, upload, and download actions.
- Tenant portal account foundation checks passed:
  - `.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py tests/integration/test_tenant_onboarding_api.py -q` (`14 passed`)
  - `.venv/bin/python -m pytest -q` (`94 passed`, `1 skipped`; migration smoke skipped because `TEST_DATABASE_URL` is not configured)
  - `.venv/bin/python -m ruff check migrations/versions/20260520_0019_tenant_portal_accounts.py tests/integration/test_tenant_portal_api.py apps/api/routers/tenant_portal.py apps/api/schemas/tenant_portal.py stewart/core/models.py`
  - `./node_modules/.bin/eslint tests/smoke/clerk-guard.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - `git diff --check`
  - Production Vercel `/settings` returned `307` to `/sign-in`, and `/tenant-portal/not-a-real-token` returned `200`.
  - Production Render `/health` returned `200`, and OpenAPI includes `/api/v1/tenant-portal/account/claim`, `/api/v1/tenant-portal/account/session`, `TenantPortalAccountClaimCreate`, and `tenant_portal_account` auth mode.
- Xero operator approval UI checks passed:
  - `.venv/bin/python -m pytest tests/integration/test_xero_api.py -q` (`14 passed`)
  - `./node_modules/.bin/eslint src/app/settings/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts --ext .ts,.tsx`
  - `./node_modules/.bin/tsc --noEmit`
  - `PORT=3004 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "settings shows Xero"` (`1 passed`)
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
- Operations maintenance detail checks passed:
  - `.venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py tests/integration/test_tenant_portal_api.py -q` (`8 passed`)
  - `.venv/bin/python -m ruff check apps/api/routers/maintenance.py apps/api/routers/tenant_portal.py apps/api/schemas/tenant_portal.py tests/integration/test_maintenance_arrears_api.py tests/integration/test_tenant_portal_api.py`
  - `./node_modules/.bin/eslint src/app/operations/page.tsx 'src/app/tenant-portal/[token]/page.tsx' src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts --ext .ts,.tsx`
  - `./node_modules/.bin/tsc --noEmit`
  - `.venv/bin/python -m pytest -q` (`92 passed`, `1 skipped`; migration smoke skipped because `TEST_DATABASE_URL` is not configured)
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  - `PORT=3004 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts` (`7 passed`, `1 skipped`; Clerk guard remains environment-gated)
- Tenant portal maintenance request checks passed:
  - `.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py -q` (`5 passed`)
  - `.venv/bin/python -m ruff check apps/api/routers/tenant_portal.py apps/api/schemas/tenant_portal.py tests/integration/test_tenant_portal_api.py`
  - `./node_modules/.bin/eslint 'src/app/tenant-portal/[token]/page.tsx' src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts --ext .ts,.tsx`
  - `./node_modules/.bin/tsc --noEmit`
  - `.venv/bin/python -m pytest -q` (`92 passed`, `1 skipped`; migration smoke skipped because `TEST_DATABASE_URL` is not configured)
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  - `PORT=3004 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts` (`7 passed`, `1 skipped`; Clerk guard remains environment-gated)
  - Production Vercel `/tenant-portal/not-a-real-token` returned `200`.
  - Production Render `/health` returned `200`, and `/api/v1/tenant-portal/maintenance-requests` returned `401` without a portal token as expected.
  - Production Render OpenAPI now includes `/api/v1/tenant-portal/maintenance-requests`.
  - Production Render OpenAPI now includes `TenantPortalMaintenanceHistoryItemRead`, `XeroInvoicePostingApprovalRead`, `XeroInvoiceDraftCreateRead`, and `/api/v1/xero/invoices/draft-create/{entity_id}`.
- Overnight build bundle checks passed:
  - `.venv/bin/python -m pytest tests/integration/test_register_import_api.py tests/integration/test_tenant_portal_api.py tests/integration/test_maintenance_arrears_api.py tests/integration/test_xero_api.py tests/integration/test_document_intake_api.py::test_document_intake_apply_invoice_prepares_billing_work -q` (`23 passed`)
  - `.venv/bin/ruff check` on the changed backend routers/schemas/domain/integration/tests (`all checks passed`)
  - `./node_modules/.bin/tsc --noEmit`
  - `.venv/bin/python -m pytest -q` (`90 passed`, `1 skipped`; migration smoke skipped because `TEST_DATABASE_URL` is not configured)
  - `./node_modules/.bin/eslint src --ext .ts,.tsx`
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
- Operations workspace focused checks passed:
  - `./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/eslint src/app/operations/page.tsx src/app/tasks/page.tsx src/components/app-shell.tsx src/components/dashboard.tsx src/app/portfolio-qa/page.tsx src/app/insights/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts --ext .ts,.tsx`
- Insights overview focused checks passed:
  - Dashboard/Insights loading-state polish checks passed:
    - `./node_modules/.bin/eslint src/components/dashboard.tsx src/app/insights/page.tsx`
    - `./node_modules/.bin/tsc --noEmit`
    - `git diff --check`
    - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
    - Local `next start` route smoke returned `200` for `/` and `/insights` with the bundled WASM path.
  - Properties/Billing Readiness loading-state polish checks passed:
    - `./node_modules/.bin/eslint src/app/billing-readiness/page.tsx src/components/property-workspace.tsx`
    - `./node_modules/.bin/tsc --noEmit`
    - `git diff --check`
    - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
    - Local `next start` route smoke returned `200` for `/properties` and `/billing-readiness` with the bundled WASM path.
  - Property workspace task-zone split checks passed:
    - `./node_modules/.bin/eslint src/components/property-workspace.tsx`
    - `./node_modules/.bin/tsc --noEmit`
    - `git diff --check`
    - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
    - Local browser smoke confirmed `/properties` shows the Portfolio/Operations/Billing/Documents tabs and each tab switches to the expected workspace section.
  - Billing Readiness task-zone split checks passed:
    - `./node_modules/.bin/eslint src/app/billing-readiness/page.tsx tests/smoke/app-flows.spec.ts tests/smoke/api-mocks.ts`
    - `./node_modules/.bin/tsc --noEmit`
    - `git diff --check`
    - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
    - `./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts -g "dashboard shows"`
    - Local Playwright smoke confirmed Dashboard opens Billing Readiness, the Readiness/Billing drafts/Invoice prep/Delivery & payments tabs render, and each new tab exposes the expected mocked billing state.
  - `.venv/bin/python -m ruff check apps/api/routers/insights.py apps/api/schemas/insights.py apps/api/main.py tests/integration/test_insights_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_insights_api.py tests/integration/test_xero_api.py -q`
  - Result: `2 passed`
  - `./node_modules/.bin/eslint src/app/insights/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
- Backend focused tests passed:
  - `.venv/bin/python -m pytest tests/integration/test_enrichment_api.py tests/integration/test_document_intake_api.py tests/integration/test_tenant_onboarding_api.py tests/integration/test_register_api.py -q`
  - Result: `34 passed`
- Xero readiness focused tests passed:
  - `.venv/bin/python -m pytest tests/integration/test_xero_api.py tests/integration/test_register_api.py -q`
  - Result: `9 passed`
  - `xero_last_sync_at` is not client-writable from the manual connection endpoint.
- Backend lint passed:
  - `.venv/bin/python -m ruff check apps/api/routers/tenant_onboarding.py apps/api/routers/charge_rules.py apps/api/routers/enrichment.py apps/api/routers/tenants.py apps/api/schemas/register.py apps/api/schemas/enrichment.py apps/api/schemas/tenant_onboarding.py stewart/ai/enrichment.py stewart/integrations/communications.py tests/integration/test_document_intake_api.py tests/integration/test_tenant_onboarding_api.py`
- Frontend targeted checks passed:
  - `./node_modules/.bin/eslint src/app/billing-readiness/page.tsx 'src/app/tenants/[tenantId]/page.tsx' src/components/property-workspace.tsx src/lib/api.ts`
  - `./node_modules/.bin/tsc --noEmit`
- Full backend test suite passed:
  - `.venv/bin/python -m pytest -q`
  - Result: `56 passed, 1 skipped`
  - Skipped: migration integration smoke test because `TEST_DATABASE_URL` is not configured in this shell.
- Full frontend lint/build passed:
  - `./node_modules/.bin/eslint .`
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
- Insights browser smoke passed:
  - Local Next dev loaded `/insights` against a throwaway mock API on `127.0.0.1`.
  - The page showed the overview cards, Live Exceptions, Billing Risk, Automation Activity, and Owner / Entity Snapshot sections, with no browser console errors.
- Settings/Xero browser smoke passed:
  - Local Next dev loaded `/settings` against a throwaway mock API on `127.0.0.1`.
  - The page showed the Xero readiness workspace, recorded a mock connection, applied a charge-rule tax mapping, and reported no browser console errors.
  - The package lists Playwright smoke tests, but `apps/web/node_modules/.bin/playwright` is not installed in this checkout.
- Local route smoke passed:
  - Next dev server loaded `/billing-readiness`, `/properties`, and `/tenants` on `127.0.0.1:3014`.
  - Each route returned `200`, showed expected Leasium screen text, and the in-app browser reported no console errors.
- Production deployment verification passed:
  - Commit `74576ed Split billing readiness into task zones`
  - Vercel deployment `dpl_7EcR9WD6tmwWQHuUjVagxMt24gsj`, state `READY`
  - Production alias route `/billing-readiness` and exact deployment route returned `200`.
  - Production browser smoke confirmed the Readiness, Billing drafts, Invoice prep, and Delivery & payments tabs render and switch on the live site.
  - Production Readiness tab shows the rent-roll readiness and billing action queue sections; draft/prep/delivery tabs show calm empty states and explicit no-posting/no-Xero guardrails for the current seeded data.
  - Commit `f767853 Split property workspace into task zones`
  - Vercel deployment `dpl_3xA7GEpWGe2R36nQ2XKfmUN8M5nh`, state `READY`
  - Production alias route `/properties` and exact deployment route returned `200`.
  - Production `/properties` includes the Portfolio, Operations, Billing, and Documents workspace tabs.
  - Production browser smoke confirmed each tab switches to the expected section, and `New property` opens the focused property editor overlay.
  - Commit `d116f2b Polish property billing loading states`
  - Vercel deployment `dpl_FYaPZPJeGMR9JSvxAGPk7ZL8P48s`, state `READY`
  - Production alias routes `/properties` and `/billing-readiness` returned `200`.
  - Production alias pages include `Loading property workspace` and `Loading billing workspace`.
  - Commit `0d50513 Add Insights overview dashboard`
  - Vercel deployment `dpl_HJ5bGeVpqLt5JymC1pDCr9gh7n43`, state `READY`
  - Production alias route `/insights` returned `200`.
  - Production API health returned `{"status":"ok","app":"Leasium"}`.
  - Production OpenAPI exposes `/api/v1/insights/overview`, `/api/v1/xero/status`, and `/api/v1/xero/connection/{entity_id}`.
  - Production `/api/v1/insights/overview` returned `200` for the seeded entity.
  - Earlier production alias route `/settings` returned `200` with the Xero readiness bundle deployed.
  - Earlier production alias routes `/billing-readiness`, `/properties`, and `/tenants` returned `200` with expected Leasium screen text.
  - Earlier production OpenAPI verification exposed the public enrichment, invoice delivery/payment, onboarding reminder, and tenant detail routes.
- Previous verification before this branch:
  - Backend focused test passed:
    - `.venv/bin/python -m pytest tests/integration/test_document_intake_api.py -q`
    - Result: `18 passed`
  - Backend lint passed:
    - `.venv/bin/python -m ruff check apps/api/routers/charge_rules.py tests/integration/test_document_intake_api.py`
- Backend register test passed:
  - `.venv/bin/python -m pytest tests/integration/test_register_api.py -q`
  - Result: `8 passed`
- Full backend test suite passed:
  - `.venv/bin/python -m pytest -q`
  - Result: `52 passed, 1 skipped`
  - Skipped: migration integration smoke test because `TEST_DATABASE_URL` is not configured in this shell.
- Frontend checks passed:
  - `./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/eslint src/app/billing-readiness/page.tsx src/lib/api.ts`
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
- Local route smoke passed:
  - Next dev server loaded `/billing-readiness` on `127.0.0.1:3010` and returned `200`.
  - Next dev server loaded `/properties` on `127.0.0.1:3011`, returned `200`, and the in-app browser reported no console errors.
  - Next dev server loaded `/intake` on `127.0.0.1:3012`, returned `200`, showed `Smart Intake` and `Review queue`, and the in-app browser reported no console errors.
  - Next dev server loaded `/billing-readiness` on `127.0.0.1:3013` against a throwaway seeded API database; invoice delivery Prepare moved a smoke invoice to preview/email-draft ready, the Preview link served HTML, and the in-app browser reported no console errors.
- Vercel production deployment passed:
  - Commit `6ff7c0b Expand acquisition schedule apply`
  - Deployment `dpl_51Y9Jq9FKDvRMuGpnYtetq7f8uNR`, state `READY`
  - Deployment URL `/intake` and production alias `/intake` returned `200`.
  - Commit `e60ee68 Surface property provenance in Smart Intake`
  - Deployment `dpl_4DNDh781bqpqL4cVCPqfbHWncQk4`, state `READY`
  - Deployment URL `/properties` and production alias `/properties` returned `200`.
  - Commit `5bd80bc Add invoice draft staging workflow`
  - Deployment `dpl_3SCqotaeA7AzCyRscJJZHq5zV88c`, state `READY`
  - Deployment URL `/billing-readiness` returned `200`.
  - Commit `c8d2cce Prepare invoice draft delivery previews`
  - Deployment `dpl_F6J6pD8qPvgq4y4sj7gALpJfkLJy`, state `READY`
  - Production alias `/billing-readiness` returned `200`.
- Password gate checks from the prior implementation passed:
  - Access middleware/page/API lint
  - TypeScript no-emit
  - Production Next build with `LEASIUM_ACCESS_PASSWORD` set
- First workspace setup and Clerk safety checks passed:
  - `.venv/bin/python -m ruff check stewart/core/auth.py stewart/core/settings.py apps/api/routers/security.py apps/api/schemas/security.py tests/unit/test_auth.py tests/integration/test_security_api.py`
  - `.venv/bin/python -m pytest tests/unit/test_auth.py tests/integration/test_security_api.py -q` (`12 passed`)
  - `./node_modules/.bin/eslint src/app/setup/page.tsx 'src/app/sign-in/[[...sign-in]]/page.tsx' 'src/app/sign-up/[[...sign-up]]/page.tsx' src/middleware.ts src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  - `LEASIUM_ACCESS_PASSWORD=secret ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts -g "setup explains Clerk configuration"`
  - `PORT=3003 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts` (`5 passed`)
- Operator workspace sign-in guard checks passed locally before commit:
  - `./node_modules/.bin/eslint src/middleware.ts src/components/operator-auth-provider.tsx src/lib/operator-routes.ts tests/smoke/app-flows.spec.ts tests/smoke/clerk-guard.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Started a manual smoke server with `LEASIUM_SMOKE_CLERK_GUARD=1 NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuZXhhbXBsZS5jb20k CLERK_SECRET_KEY=sk_live_fake NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3004`
  - Ran `LEASIUM_SMOKE_CLERK_GUARD=1 NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuZXhhbXBsZS5jb20k CLERK_SECRET_KEY=sk_live_fake PLAYWRIGHT_BASE_URL=http://127.0.0.1:3004 ./node_modules/.bin/playwright test tests/smoke/clerk-guard.spec.ts` (`2 passed`)
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  - `PORT=3003 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts` (`5 passed`, `1 skipped` for the real-Clerk browser guard)
- Operator workspace sign-in guard production deployment passed:
  - Commit `7cfc027 Guard operator workspace with Clerk middleware`
  - Vercel deployment `dpl_GCM9ajy5Bk9izW4v7ENsbAY1bh6q`, state `READY`
  - Production alias `/setup` returned `200`.
  - Production alias `/sign-in` returned `200`.
  - Production alias `/settings` returned `200` because Clerk server env vars are not enabled on Vercel yet; after enabling both Clerk keys and redeploying, it should redirect signed-out users to `/sign-in`.
- Shareable Insights snapshots v1 checks passed:
  - `.venv/bin/python -m ruff check apps/api/routers/insights.py apps/api/schemas/insights.py stewart/core/models.py migrations/versions/20260520_0016_insights_snapshots.py tests/integration/test_insights_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_insights_api.py tests/integration/test_xero_api.py -q` (`4 passed`)
  - `.venv/bin/python -m pytest -q` (`67 passed`, `1 skipped`; migration smoke skipped because `TEST_DATABASE_URL` is not configured)
  - `./node_modules/.bin/eslint src/app/insights/page.tsx 'src/app/snapshots/[token]/page.tsx' src/lib/api.ts src/lib/operator-routes.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
  - `PORT=3003 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts` (`5 passed`, `1 skipped` for the real-Clerk browser guard)
- Shareable Insights snapshots production deployment passed:
  - Commit `dfb4d63 Add shareable Insights snapshots`
  - Vercel deployment `dpl_7K8jpA5HTKATiRn9pTpT36JPxndG`, state `READY`
  - Production alias `/insights` returned `200`.
  - Production alias `/snapshots/example-token` returned `200` for the public snapshot page shell.
  - Production API health returned `{"status":"ok","app":"Leasium"}`.
  - Production API `/api/v1/insights/snapshots/public/not-a-real-token` returned `404` with `Insights snapshot not found.`, confirming the route is deployed and the `insights_snapshot` table is available.

## Important Deployment Notes

- Render/Alembic packaging fragility was investigated on 2026-05-20.
  - Production API recovered by changing the Render start command to
    `.venv/bin/alembic upgrade head && .venv/bin/uvicorn apps.api.main:app --host 0.0.0.0 --port $PORT`,
    canceling the stuck deploy, and clearing the build cache for commit
    `3891223`.
  - `pyproject.toml` now force-includes `alembic.ini` and the full `migrations/`
    tree in wheel builds, so installed artifacts can resolve
    `20260520_0015_operator_invites`.
  - Alembic still needs to run from the repository or extracted artifact root
    because `alembic.ini` uses `script_location = migrations`.
  - If Render has already advanced production to `20260520_0015`, recover by
    redeploying the same or newer commit that contains that migration. Avoid
    booting an older backend against the advanced database unless the database is
    restored, downgraded, or stamped back to a revision present in that artifact.
- Vercel has no exposed env-var mutation tool in this session.
  - To actually hide the public app, set `LEASIUM_ACCESS_PASSWORD` in the Vercel project environment settings and redeploy.
  - After redeploy, verify `/properties` redirects to `/access`, while `/setup`, `/accept-invite`, `/onboarding/<token>`, and `/tenant-portal/<token>` remain public.
  - To enforce operator login, set both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on the Vercel web app and redeploy.
  - After the Clerk redeploy, verify `/settings` redirects to `/sign-in`, while `/setup`, `/accept-invite`, `/sign-in`, `/sign-up`, `/access`, `/onboarding/<token>`, and `/tenant-portal/<token>` remain public.
- Neon production was previously confirmed migrated through `20260520_0016` on project `snowy-boat-02653440`, branch `production` (`br-soft-rice-aqp2uyx1`), database `neondb`.
  - Verified earlier: `invoice_draft_status`, `invoice_draft`, and `invoice_draft_line` exist.
  - Verified now: the live public snapshot endpoint can query `insights_snapshot` and returns a clean not-found response for an invalid token.
- The overnight bundle adds `20260520_0018_maintenance_arrears_foundations`, and the tenant account slice adds `20260520_0019_tenant_portal_accounts`. Render's documented start command runs `.venv/bin/alembic upgrade head` before the API starts, so production should apply these migrations during backend deploy. If Render does not pick up the deploy, run the same Alembic command against the hosted API environment before using maintenance, arrears, or tenant portal account endpoints.
- Xero readiness v1 uses existing columns only and does not need a new database migration.
- Twilio/SendGrid delivery code exists, but provider-side webhook/template setup still needs to be configured outside the codebase.
- Public enrichment requires `OPENAI_API_KEY` on the API service. Without it, preview returns a clear 503 and does not mutate records.

## Recommended Next Tickets

1. Verify the tenant account production deploy and confirm Neon has advanced through `20260520_0019`.
2. Remba review the Smart Intake spreadsheet import panel, Portfolio QA IA link, invoice email action, tenant portal, and Operations workspace.
3. Deepen Operations with dedicated work-order detail routes, contractor quote document upload/preview, richer comments, and maintenance invoice approval handoff.
4. Continue tenant portal with notification preference receipts, safer invite/link lifecycle, and clearer tenant document provenance/actions.
5. Continue Xero from operator draft creation into webhook/provider status receipts, better failed-post recovery, per-invoice Billing Readiness actions, and full accounting reconciliation guardrails.
6. Add provider receipt webhooks and branded template management for invoice delivery and tenant portal communications.

## Resume Checklist

- Start with `git status --short`.
- If the tree is clean, pull latest `main`.
- If there are local edits, inspect them before changing files.
- Use `.venv/bin/python -m pytest ...` for backend tests because `uv` is not available in this shell.
- For frontend checks, use commands from `apps/web/package.json`; the app expects the bundled Next WASM dir in scripts.
- Keep Smart Intake review-first: extracted value, confidence, source, approve/edit/ignore, and no mutation until Apply.
- Keep Remba in the loop for any navigation, layout, flow, copy, density, or visual hierarchy change.
