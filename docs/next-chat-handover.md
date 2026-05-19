# Leasium Next Chat Handover

Last updated: 2026-05-19

## Current State

- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.vercel.app`
- Latest confirmed feature Vercel production deployment before this handover: `e60ee68 Surface property provenance in Smart Intake`, state `READY`.
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
- Smart Intake applied outcomes now read backend apply results for billing draft, pending lease, and draft charge counts.
  - This is design-facing and still needs Remba review.
- AI enrichment for missing fields is in the backlog, not built yet.
  - Target examples: ABN, postcode, suburb/state, registered business details, registered address.
  - Must remain review-first with source citation and confidence before applying.

## Verification

- Backend focused test passed:
  - `.venv/bin/python -m pytest tests/integration/test_document_intake_api.py -q`
  - Result: `17 passed`
- Backend register test passed:
  - `.venv/bin/python -m pytest tests/integration/test_register_api.py -q`
  - Result: `8 passed`
- Full backend test suite passed:
  - `.venv/bin/python -m pytest -q`
  - Result: `52 passed, 1 skipped`
  - Skipped: migration integration smoke test because `TEST_DATABASE_URL` is not configured in this shell.
- Frontend checks passed:
  - `./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/eslint src/components/property-workspace.tsx src/components/dashboard.tsx`
  - `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build`
- Local route smoke passed:
  - Next dev server loaded `/billing-readiness` on `127.0.0.1:3010` and returned `200`.
  - Next dev server loaded `/properties` on `127.0.0.1:3011`, returned `200`, and the in-app browser reported no console errors.
- Vercel production deployment passed:
  - Commit `e60ee68 Surface property provenance in Smart Intake`
  - Deployment `dpl_4DNDh781bqpqL4cVCPqfbHWncQk4`, state `READY`
  - Deployment URL `/properties` and production alias `/properties` returned `200`.
  - Commit `5bd80bc Add invoice draft staging workflow`
  - Deployment `dpl_3SCqotaeA7AzCyRscJJZHq5zV88c`, state `READY`
  - Deployment URL `/billing-readiness` returned `200`.
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
- Twilio/SendGrid delivery code exists, but provider-side webhook/template setup still belongs in the next build order.

## Recommended Next Tickets

1. Enable the temporary Vercel password gate and verify production access behavior.
2. Add richer acquisition schedule blockers, broader non-rent charge draft creation from reviewed rows, and UI surfacing for created pending leases.
3. Add invoice draft approval, PDF preview/generation, and email delivery steps without Xero sync until explicit approval.
4. Finish tenant onboarding delivery polish: branded templates, editable reminder schedules, expiry reminders, and failure recovery.
5. Start Xero connection status and mapping surfaces before full invoice sync.
6. Deepen Insights dashboards for portfolio health, exceptions, automation activity, billing risk, and owner/entity snapshots.

## Resume Checklist

- Start with `git status --short`.
- If the tree is clean, pull latest `main`.
- If there are local edits, inspect them before changing files.
- Use `.venv/bin/python -m pytest ...` for backend tests because `uv` is not available in this shell.
- For frontend checks, use commands from `apps/web/package.json`; the app expects the bundled Next WASM dir in scripts.
- Keep Smart Intake review-first: extracted value, confidence, source, approve/edit/ignore, and no mutation until Apply.
- Keep Remba in the loop for any navigation, layout, flow, copy, density, or visual hierarchy change.
