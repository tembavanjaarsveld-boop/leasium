# Leasium Next Chat Handover

Last updated: 2026-05-19

## Current State

- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.vercel.app`
- Latest confirmed Vercel production deployment in this handover: `9fbadb5 Add Xero readiness and mapping surface`, deployment `dpl_72LoYjVEiVEHsfzuQkzUZz1Yv234`, state `READY`.
- Product source of truth: `docs/product-roadmap.md`
- UX governance source of truth: `docs/design-governance.md`; design-facing changes still need Remba review.

## Closed And Updated

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
  - Shareable owner/finance/lease-event snapshots are still backlog work generated from this live overview data.
  - This is design-facing and still needs Remba review.
- Smart Intake applied outcomes now read backend apply results for billing draft, pending lease, and draft charge counts.
  - This is design-facing and still needs Remba review.
## Verification

- Insights overview focused checks passed:
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
  - Commit `9fbadb5 Add Xero readiness and mapping surface`
  - Vercel deployment `dpl_72LoYjVEiVEHsfzuQkzUZz1Yv234`, state `READY`
  - Production alias route `/settings` returned `200` with the Xero readiness bundle deployed.
  - Production API health returned `{"status":"ok","app":"Leasium"}`.
  - Production OpenAPI exposes `/api/v1/xero/status` and `/api/v1/xero/connection/{entity_id}`.
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

## Important Deployment Notes

- Vercel has no exposed env-var mutation tool in this session.
  - To actually hide the public app, set `LEASIUM_ACCESS_PASSWORD` in the Vercel project environment settings and redeploy.
  - After redeploy, verify `/properties` redirects to `/access`, and `/onboarding/<token>` remains public.
- Neon production is confirmed migrated through `20260519_0014` on project `snowy-boat-02653440`, branch `production` (`br-soft-rice-aqp2uyx1`), database `neondb`.
  - Verified `invoice_draft_status`, `invoice_draft`, and `invoice_draft_line` exist.
- Xero readiness v1 uses existing columns only and does not need a new database migration.
- Twilio/SendGrid delivery code exists, but provider-side webhook/template setup still needs to be configured outside the codebase.
- Public enrichment requires `OPENAI_API_KEY` on the API service. Without it, preview returns a clear 503 and does not mutate records.

## Recommended Next Tickets

1. Enable the temporary Vercel password gate and verify production access behavior.
2. Complete provider-backed Xero OAuth/contact sync, invoice posting approvals, and payment reconciliation on top of the readiness queue.
3. Add shareable owner, finance, and lease-event snapshots generated from the live Insights overview data.
4. Add provider-backed invoice email delivery and Xero posting approvals on top of internal invoice drafts.
5. Build tenant portal authentication and self-service for onboarding, documents, invoices, compliance uploads, and notification preferences.
6. Start maintenance work orders and arrears/credit-control queues.

## Resume Checklist

- Start with `git status --short`.
- If the tree is clean, pull latest `main`.
- If there are local edits, inspect them before changing files.
- Use `.venv/bin/python -m pytest ...` for backend tests because `uv` is not available in this shell.
- For frontend checks, use commands from `apps/web/package.json`; the app expects the bundled Next WASM dir in scripts.
- Keep Smart Intake review-first: extracted value, confidence, source, approve/edit/ignore, and no mutation until Apply.
- Keep Remba in the loop for any navigation, layout, flow, copy, density, or visual hierarchy change.
