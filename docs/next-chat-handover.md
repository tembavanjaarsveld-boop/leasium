# Leasium Next Chat Handover

Last updated: 2026-05-21

## Current State

- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.vercel.app`
- Latest pushed commit: `08f5dc1 Add work notification recovery cues`
- Latest live route sanity after push:
  - `/settings` returns `200` after redirecting signed-out users to `/sign-in?redirect_url=%2Fsettings`
  - `/notifications` returns `200` after redirecting signed-out users to `/sign-in?redirect_url=%2Fnotifications`
  - `/onboarding/tenant-token-1` returns `200` and remains public
- Product source of truth: `docs/product-roadmap.md`
- UX governance source of truth: `docs/design-governance.md`
- Brand/frontend source of truth: `docs/leasium-codex-design-source-of-truth.md`
- Design-facing changes still require Remba review before being treated as complete.

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
  - Maintenance, arrears, critical dates, assignment, reminders, escalation cues, provider notices, digest previews/sends, and notification-center history exist.
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

## Important Deployment Notes

- Vercel connector auth/env mutation was not available in-session.
  - Code is pushed to `main`; Vercel should deploy from GitHub as configured.
  - For a true private-beta wall, set `LEASIUM_ACCESS_PASSWORD` in Vercel and redeploy.
  - For operator auth, keep both Clerk frontend/server env vars configured in Vercel.
- Render start command is expected to run Alembic before the API starts:
  - `.venv/bin/alembic upgrade head && .venv/bin/uvicorn apps.api.main:app --host 0.0.0.0 --port $PORT`
- Hosted Neon/Render should be at least through these migrations:
  - `20260520_0018_maintenance_arrears_foundations`
  - `20260520_0019_tenant_portal_accounts`
  - `20260521_0020_register_import_plans`
  - `20260521_0021_operator_notification_preferences`
- Provider setup still has external-console work:
  - SendGrid templates/event webhook configuration
  - Twilio SMS callback/template setup
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
- Settings Work notification preferences/template preview and Notifications provider-history/recovery cue density.

## Recommended Next Tickets

1. Continue Work assignment from recovery cues into direct per-channel recovery actions, non-email provider wiring, and named template management.
2. Deepen provider receipt configuration for SendGrid/Twilio and turn template keys into operator-friendly template records.
3. Continue Operations polish with safer edit affordances, deeper activity/audit presentation, owner/tenant completion-review paths, and clearer row density.
4. Continue Xero from guided sync exceptions into accounting snapshot guardrails, stale reconciliation indicators, and richer accounting-readiness snapshots.
5. Deepen Portfolio QA cleanup into guided fix flows for contact enrichment, missing owner/billing data, onboarding batch creation, and import-source history.
6. Add branded template management and delivery preview/versioning for invoice delivery, tenant portal communications, contractor messages, and Work notifications.

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
