# Leasium Next Chat Handover

Last updated: 2026-05-19

## Current State

- Repo: `/Users/tembavanjaarsveld/Documents/Stewart`
- Branch: `main`
- Remote: `https://github.com/tembavanjaarsveld-boop/leasium.git`
- Production frontend: `https://leasium.vercel.app`
- Latest confirmed Vercel production deployment before this handover: `f845a69 Add temporary access password gate`, state `READY`.
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
- AI enrichment for missing fields is in the backlog, not built yet.
  - Target examples: ABN, postcode, suburb/state, registered business details, registered address.
  - Must remain review-first with source citation and confidence before applying.

## Verification

- Backend focused test passed:
  - `.venv/bin/python -m pytest tests/integration/test_document_intake_api.py -q`
  - Result: `16 passed`
- Password gate checks from the prior implementation passed:
  - Access middleware/page/API lint
  - TypeScript no-emit
  - Production Next build with `LEASIUM_ACCESS_PASSWORD` set

## Important Deployment Notes

- Vercel has no exposed env-var mutation tool in this session.
  - To actually hide the public app, set `LEASIUM_ACCESS_PASSWORD` in the Vercel project environment settings and redeploy.
  - After redeploy, verify `/properties` redirects to `/access`, and `/onboarding/<token>` remains public.
- Render/Neon still need the latest database migration applied if auto-migrations are not running:
  - `20260519_0012_property_ownership_billing`
- Twilio/SendGrid delivery code exists, but provider-side webhook/template setup still belongs in the next build order.

## Recommended Next Tickets

1. Enable the temporary Vercel password gate and verify production access behavior.
2. Surface stored property source citations and before/after apply history in the Smart Intake/property UI.
3. Continue purchase contract AI apply with richer tenancy schedule handling.
4. Turn billing prep documents into true draft charge/invoice records, still with no Xero sync until approval.
5. Finish tenant onboarding delivery polish: branded templates, editable reminder schedules, expiry reminders, and failure recovery.
6. Start Xero connection status and mapping surfaces before full invoice sync.
7. Deepen Insights dashboards for portfolio health, exceptions, automation activity, billing risk, and owner/entity snapshots.

## Resume Checklist

- Start with `git status --short`.
- If the tree is clean, pull latest `main`.
- If there are local edits, inspect them before changing files.
- Use `.venv/bin/python -m pytest ...` for backend tests because `uv` is not available in this shell.
- For frontend checks, use commands from `apps/web/package.json`; the app expects the bundled Next WASM dir in scripts.
- Keep Smart Intake review-first: extracted value, confidence, source, approve/edit/ignore, and no mutation until Apply.
- Keep Remba in the loop for any navigation, layout, flow, copy, density, or visual hierarchy change.
