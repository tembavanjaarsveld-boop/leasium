# Leasium Next Chat Handover

Last updated: 2026-05-23

## Current State

- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.vercel.app`
- Latest pushed commit: `22f0296 Refresh handover doc + add nav-pattern research note`
- Local tree carries the **tenant portal onboarding v1** slice — uncommitted at takeover time. Backend: new `POST /tenant-onboarding/{id}/send-portal-invite` operator endpoint, new authenticated `POST /tenant-portal/onboarding/submit` endpoint, new `send_tenant_portal_invite` communications helper, new `tenant_portal_invite_template_*` settings, `TenantPortalOnboardingRead` extended with `submitted_data` + `portal_invite_sent_at`, integration tests in `test_tenant_onboarding_api.py` and `test_tenant_portal_api.py`. Frontend: new "Complete your onboarding" panel in the tenant portal dashboard (`tenant-portal-content.tsx`), new "Invite to portal" primary button on the operator tenant page, new `submitTenantPortalOnboarding` / `sendTenantOnboardingPortalInvite` API helpers, retired public `/onboarding/[token]` form replaced with a redirect screen, smoke fixtures + spec updated to cover the new flow. ESLint and `tsc --noEmit` are clean here; Playwright smoke didn't fit the sandbox 45s window — run it on the Mac before treating the slice as fully verified.
- The 2026-05-22 UX-review backlog is fully landed except Tier 2 (g) dark mode (deliberately deprioritised under the SKJ internal-first-6-months direction). All shipped items are marked `[x]` or `[~]` in `docs/product-roadmap.md` and pending Remba review.
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

## Takeover Priority

1. Read `CLAUDE.md` at the repo root before starting. It encodes the behavioural baseline (state assumptions, simplest possible change, surgical edits, verifiable success criteria) plus the Leasium-specific guardrails.
2. Run `git status --short` and `git log --oneline -10` to see what has shipped recently and whether the tree is clean.
3. Pick the next ticket from `docs/product-roadmap.md` "Next Build Order" or the Pre-existing backlog (Operations polish, Xero deepening, Portfolio QA cleanup, Branded templates, Dark mode).
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

Tree is clean apart from one untracked file:

- `docs/nav-pattern-research-2026-05-23.md` — Codex evidence note explaining why the 240px left sidebar is the right pattern for Leasium today (9 top-level modules + nested structure → sidebar; aimed at giving Remba the same evidence base the original UX review used). Safe to commit; not a behaviour change.

No pending code edits.

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
  - **Pending (2026-05-23, Temba waiting on DocuSign developer account): wire DocuSign credentials so `stewart.integrations.docusign.send_lease_for_signature` graduates from scaffold to real envelope-create.** Settings expect `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_RSA_PRIVATE_KEY`. The scaffold soft-fails with a clear `not_configured` error today, so any caller that tries to send a lease for signature returns a stub receipt without an envelope id. Next slice replaces the stub with the real JWT-grant + envelope-create + Connect-webhook plumbing once credentials are in hand. Setup steps documented in `docs/deployment.md`.
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

- Smart Intake spreadsheet import review/apply panel.
- Portfolio QA IA and command-search placement.
- Reusable evidence/source-trail pattern across Properties, Smart Intake, Tenants, invoices, and maintenance.
- Tenant portal account/self-service surfaces, fresh-link recovery, and document provenance density.
- Billing Readiness provider dispatch/recovery and Xero approval/reconciliation surfaces.
- Operations workspace structure, work assignment controls, workload filters, reminder/escalation cues, provider notice states, and notification center.
- Settings Work notification preferences/named-template/SMS selection and Notifications provider-history/direct email/SMS recovery/channel-readiness density.

## Recommended Next Tickets

The 2026-05-22 UX-review backlog is done except dark mode. Pick from these in roughly leverage order for the SKJ internal-first-6-months window:

1. **Operations polish** — deeper activity/audit presentation on the work-order detail page, safer edit affordances on list rows (right now any wrong inline-edit on status/priority is one click + auto-commit; consider a brief undo toast), owner/tenant-facing completion review paths, clearer row density at small viewports. Daily-driver surface, high leverage.
2. **Xero deepening** — accounting snapshot guardrails, stale reconciliation indicators on Billing Readiness invoice rows, richer accounting-readiness snapshots. Finance team will live here every month.
3. **Portfolio QA cleanup** — bulk fix review, AI-assisted enrichment candidates (the helper exists; productise it), clearer completion/reporting state. One-off but high-impact while the SKJ portfolio import is still being shaken out.
4. **AI inbox v2** — currently classify + deep-link only. v2 promotes the approved classification into an actual draft (maintenance work order, arrears case, smart-intake record) so the operator's next click is reviewing the draft, not re-keying. Highest leverage AI follow-up.
5. **Tier 2 (g) Dark mode** — dark tokens in the design source of truth, `.dark` class via system preference + an account-menu toggle, contrast audit across the 5 most-used surfaces. Deliberately deferred during the internal-first-6-months window; revisit when external tenants/contractors land.
6. **Tenant portal UX audit** — predates the sidebar / inline-edit / activity-feed / Leasium AI work. Likely feels visually less polished than the operator side. Worth a Tier-1-style tier-list once more tenants are on it. v2 candidates: tenant-side activity feed scoped to their tenancy, tenant inline edit of their own contact details, tenant maintenance request status visibility.
7. **Multi-view v2 for Properties** — Map view (Leaflet vs Mapbox decision) + Calendar view (rent reviews + lease expiries — although the upcoming-events panel on the Dashboard already covers most of this).
8. **Pre-existing backlog** still valid: branded communications editable templates UI + send-time wiring (deprioritised under internal-first-6-months), Smart Intake spreadsheet improvements, evidence/source-trail pattern reuse expansion, Work assignment digest coverage.

The pending migration list in `docs/product-roadmap.md` (the `20260520_*` / `20260521_*` / `20260522_*` set) still needs to be applied on hosted Neon/Render if auto-migrations don't run. Confirm before declaring any new backend slice "deployed".

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
