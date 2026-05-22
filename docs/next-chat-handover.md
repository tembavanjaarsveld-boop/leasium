# Leasium Next Chat Handover

Last updated: 2026-05-21

## Current State

- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.vercel.app`
- Latest pushed commit: `39742fa Refresh next chat handover`
- Current local tree is intentionally dirty with the active Work notification and ownership-tags slice. Do not pull, reset, or rebase until `git status --short` and `git diff --stat` have been inspected.
- Latest live route sanity after push:
  - `/settings` returns `200` after redirecting signed-out users to `/sign-in?redirect_url=%2Fsettings`
  - `/notifications` returns `200` after redirecting signed-out users to `/sign-in?redirect_url=%2Fnotifications`
  - `/onboarding/tenant-token-1` returns `200` and remains public
- Product source of truth: `docs/product-roadmap.md`
- UX governance source of truth: `docs/design-governance.md`
- Brand/frontend source of truth: `docs/leasium-codex-design-source-of-truth.md`
- UX audit (2026-05-22, benchmarked against Linear / Stripe / Notion / Vercel / Re-Leased Credia / AppFolio): `docs/ux-review-2026-05-22.md`. Proposes a tiered roadmap; Tier 1 = sidebar nav, DetailDrawer, dashboard trend deltas + sparklines, URL-persistent filters; Tier 2 = AI Q&A ("Ask Leasium"), activity feed, dark mode, keyboard shortcuts. Highest-leverage single move is AI Q&A.
- Design-facing changes still require Remba review before being treated as complete.

## Takeover Priority

1. Preserve the unstaged local work.
2. Re-run a focused verification pass if more code changes are made.
3. Commit/push the current slice only after checking the final diff and confirming the Remba-pending notes are accurate.
4. Keep all provider actions review-first: no Xero mutation, SendGrid email, Twilio SMS, tenant email, or payment reconciliation should happen without explicit operator approval.

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
- Production frontend: `https://leasium.vercel.app`
- GitHub remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Backend runtime: Python 3.12 with `.venv` already present.
- Frontend dependencies: `apps/web/node_modules` already present.
- `uv` and `pnpm` are not available in this shell right now; use `.venv/bin/python`, `.venv/bin/alembic`, `.venv/bin/uvicorn`, and `apps/web/node_modules/.bin/...` directly.
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

## Active Local Tree

The current unstaged slice is broad but coherent:

- Work notification backend:
  - `apps/api/routers/work_assignment_notifications.py`
  - `apps/api/schemas/work_assignments.py`
  - `apps/api/work_assignments.py`
  - `stewart/integrations/communications.py`
  - `tests/integration/test_maintenance_arrears_api.py`
- Operator/security preferences:
  - `apps/api/routers/security.py`
  - `apps/api/schemas/security.py`
  - `tests/integration/test_security_api.py`
- Notifications and Settings UI:
  - `apps/web/src/app/notifications/page.tsx`
  - `apps/web/src/app/settings/page.tsx`
  - `apps/web/src/lib/api.ts`
  - `apps/web/tests/smoke/api-mocks.ts`
  - `apps/web/tests/smoke/app-flows.spec.ts`
- Ownership tag helper and property workspace reuse:
  - `apps/web/src/lib/property-ownership.ts`
  - `apps/web/src/components/property-workspace.tsx`
- Docs:
  - `docs/deployment.md`
  - `docs/design-governance.md`
  - `docs/next-chat-handover.md`
  - `docs/product-roadmap.md`

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

- `93996cf Add work notification template preview`
  - Settings now shows a compact SendGrid preview for each operator's Work assignment notice and digest templates.
  - Known template keys are translated into plain titles, with version badges, sample subjects, and content summaries.
  - Documented in `docs/product-roadmap.md` and `docs/design-governance.md`.
- `71d6f1d Surface work notification provider history`
  - Notification-center API now exposes compact provider history for Work notices and digest receipts.
  - `/notifications` shows the latest provider event, status, timestamp, template/version, attempt count, and error detail where present.
  - Backend and smoke tests cover digest provider history.
- `08f5dc1 Add work notification recovery cues`
  - `/notifications` now shows plain-English next-action cues for Work notice and digest receipt rows.
  - Cues cover retry-from-Work, send/retry digest, wait-for-provider-receipt, preference cleanup, and no-recovery-needed states.
- Current local slice:
  - Work notification named template catalog v1 adds `/api/v1/work-assignments/notification-templates`.
  - Settings now uses named Work notice/digest template selectors with version inputs and managed/custom preview badges.
  - Existing operator preferences still store key/version only; provider sends remain explicit and review-first.
  - Work notification direct email recovery v1 adds `/api/v1/work-assignments/notification-center/notices/send-email`.
  - `/notifications` now shows `Send notice`/`Retry notice` buttons on actionable Work notice rows and keeps queued/sent notices idempotent.
  - Notification center now includes Email/SMS/In-app channel readiness metadata and a compact readiness strip.
  - Settings Work notifications now stores operator Assignment SMS enabled and reviewed phone preferences in `app_user.notification_preferences`.
- Earlier same-thread Work notification stack is already pushed:
  - `7400d27 Add work notification preferences panel`
  - `618dfd3 Add notification history filters`
  - `1a3ea7f Surface notification channel evidence`
  - `cf229b2 Add work notification template preferences`

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
  - `stewart/ai/enrichment.py` adds an OpenAI web-search backed property image candidate helper.
  - `/api/v1/public-enrichment/property-images/preview` returns reviewable remote image candidates with source/citation/confidence before anything is stored.
  - `/apply` downloads the selected candidate, processes it to a fixed 1600x900 JPEG, creates a property-linked StoredDocument, and stores metadata pointers such as `primary_image.document_id`, `hero_image_document_id`, `image_document_ids`, source/citation/confidence/history.
  - The Portfolio tab renders fixed-size row thumbnails and a selected-property `Property images` panel from the stored-document workflow, with candidate cards and explicit `Apply image` review before apply.
  - This is experimental. If visual quality or source clarity is poor, pull the helper rather than shipping remote metadata-only hotlinks.
  - `.venv/bin/python -m ruff check stewart/ai/enrichment.py apps/api/schemas/enrichment.py apps/api/routers/enrichment.py tests/integration/test_enrichment_api.py`
  - `.venv/bin/python -m pytest tests/integration/test_enrichment_api.py -q` returned `2 passed`
  - `./node_modules/.bin/eslint src/components/property-workspace.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`
  - `./node_modules/.bin/tsc --noEmit`
  - Property workspace smoke passed for the thumbnail, image candidate, apply-image, and owner-tag row-conflict paths.
- Contractor SMS and Xero freshness follow-up:
  - Maintenance work-order contractor delivery now supports a reviewed Twilio SMS action beside SendGrid email, with separate send state, receipts, provider history, template key/version, Twilio status callback ingestion, and contractor-visible comments only after successful reviewed sends.
  - `/api/v1/xero/status` now returns local accounting freshness across contact sync, chart/tax validation, invoice posting/dispatch checkpoints, and payment reconciliation, including stale/missing reconciliation cues for open Xero-linked invoices.
  - Settings shows an accounting freshness metric; Insights and public finance snapshots include an accounting-readiness block for contact/chart/tax/payment freshness.
  - Verification covered focused backend unit/integration tests, TypeScript, ESLint, and smoke flows for maintenance detail, Settings Xero, and Insights/public snapshots.
- Spreadsheet import review polish:
  - `apps/web/src/app/intake/register-import-panel.tsx` and `apps/web/src/app/intake/spreadsheet/page.tsx` now show approve/review/ignored/blocked counts, explicit `Approve recommended` and `Ignore all` controls, and more field-change detail before Apply.
  - `apps/web/tests/smoke/api-mocks.ts` now mocks `POST /register-imports/dry-run` and `POST /register-imports/apply`.
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
- Provider setup still has external-console work:
  - SendGrid templates/event webhook configuration; notification-center readiness shows the bare Work event webhook endpoint only.
  - Twilio SMS callback/template setup; notification-center readiness shows the bare Work status callback endpoint only.
  - Twilio maintenance contractor SMS callback setup should also point at `/api/v1/maintenance/work-orders/webhooks/twilio-status`.
  - Xero app/accounting-side settings
- Public enrichment requires `OPENAI_API_KEY` on the API service. Without it, preview returns a clear 503 and does not mutate records.

## Remba Review Queue

Treat these as pending UX/design sign-off:

- Smart Intake spreadsheet import review/apply panel.
- Portfolio QA IA and command-search placement.
- Reusable evidence/source-trail pattern across Properties, Smart Intake, Tenants, invoices, and maintenance.
- Tenant portal account/self-service surfaces, fresh-link recovery, and document provenance density.
- Billing Readiness provider dispatch/recovery and Xero approval/reconciliation surfaces.
- Operations workspace structure, work assignment controls, workload filters, reminder/escalation cues, provider notice states, and notification center.
- Settings Work notification preferences/named-template/SMS selection and Notifications provider-history/direct email/SMS recovery/channel-readiness density.

## Recommended Next Tickets

1. Finish the current local slice: inspect the full diff, run targeted backend/frontend checks, confirm docs match behavior, then commit and push.
2. Continue Work assignment from rendered message previews into digest coverage, provider-console setup checks, and broader cross-channel receipt coverage.
3. Continue branded communications from registry/preview v1 into editable branded template records, provider receipt setup validation, and tenant-portal outbound communication history.
4. Continue Operations polish with safer edit affordances, deeper activity/audit presentation, owner/tenant completion-review paths, and clearer row density.
5. Continue Xero from accounting freshness into configurable stale windows, richer Settings explanations, and Billing Readiness invoice-level freshness cues.
6. Continue Portfolio QA from guided cleanup v1 into bulk fix review, AI-assisted enrichment candidates, and clearer completion/reporting states.
7. Expand communication template/version evidence into contractor and tenant-portal outbound histories once editable template records exist.

## Resume Checklist

- Start with `git status --short`.
- If the tree is clean, pull latest `main`.
- If there are local edits, inspect them before changing files.
- Use `.venv/bin/python -m pytest ...` for backend tests because `uv` is not available in this shell.
- For frontend checks, use commands from `apps/web/package.json`; the app expects the bundled Next WASM dir in scripts.
- Use `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build` for production web builds.
- Keep Smart Intake review-first: extracted value, confidence, source, approve/edit/ignore, and no mutation until Apply.
- Keep provider actions explicit: no Xero write, SendGrid email, Twilio SMS, or payment reconciliation without reviewed operator approval.
- Keep Remba in the loop for navigation, layout, workflow, copy, density, visual hierarchy, and design system changes.
