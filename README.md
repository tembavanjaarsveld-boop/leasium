# Leasium

Leasium is an AI-native lease operations platform for multi-entity Australian property portfolios. It turns lease documents into structured property, tenant, lease, obligation, onboarding, and billing-readiness records with review before anything is committed.

The living product roadmap is tracked in [docs/product-roadmap.md](docs/product-roadmap.md).
Design-facing changes go through the in-loop UX gate (Figma-first +
same-session UX pass) defined in
[docs/design-governance.md](docs/design-governance.md).
Deployment notes are tracked in [docs/deployment.md](docs/deployment.md).
The latest MVP UX/performance pass is recorded in
[docs/mvp-ux-performance-review-2026-05-30.md](docs/mvp-ux-performance-review-2026-05-30.md).

## Quick Start

```bash
cp .env.example .env
make install
docker compose up -d
make migrate
make seed
# Optional, but recommended for local product demos and manual browser QA:
make demo-seed
make dev
```

The API runs on `http://localhost:8000` and the web app runs on `http://localhost:3000`.
`make seed` creates the minimal local setup. `make demo-seed` adds a fictional
AU portfolio — Harbour Lane Property Group / Rivergum Property Holdings Pty Ltd
with Brisbane properties, tenants, owners, contractors, billing, work, and
arrears examples — so local browser checks exercise real API-backed data instead
of empty frames. The demo seed is local-only, idempotent, and does not call Xero,
Basiq, SendGrid, Twilio, payment, or reconciliation providers.
Lease intake extraction reads `OPENAI_API_KEY` from `.env.local` or `.env` and uses
`OPENAI_MODEL` for the direct Responses API call.
Tenant onboarding delivery reads `SENDGRID_*` and `TWILIO_*` settings for email
and SMS. Missing communication credentials are recorded as skipped delivery
states so local development can still create onboarding links. `PUBLIC_API_URL`
and `COMMUNICATIONS_WEBHOOK_SECRET` enable delivery receipts from Twilio SMS
callbacks and SendGrid Event Webhooks.

## Deployment

Vercel should deploy the frontend from `apps/web`. Set
`NEXT_PUBLIC_API_BASE_URL=/api/v1` in Vercel so the frontend uses the same-origin
API rewrite from `apps/web/vercel.json`. The FastAPI API is deployed separately
and must set `FRONTEND_URL=https://leasium.ai`.
Set `LEASIUM_ACCESS_PASSWORD` in Vercel to enable the temporary private-beta
password gate. Leave it blank locally to skip the gate.

## Make Targets

- `make install` installs backend and frontend dependencies.
- `make migrate` applies Alembic migrations.
- `make seed` creates local sample data.
- `make demo-seed` creates the richer fictional AU demo portfolio for local
  browser demos and manual QA.
- `make dev` runs the API and web app together.
- `make test` runs the Python test suite.
- `make lint` runs backend and frontend lint checks.
- `make format` formats backend and frontend files.
- `npm --prefix apps/web run audit:live` runs the repeatable live UX/performance
  audit after a signed-in storage state has been saved.

## Modules

- Foundation: organisation, entity, property, tenancy unit, tenant, lease, obligation, charge rule, and tenant onboarding records with entity-scoped auth and audit logging.
- Lease intake: upload a bounded PDF/text lease file, extract setup data with OpenAI,
  poll for the review result, match existing property/unit/tenant records, then
  apply the intake into lease and obligation records.
- Tenant onboarding: create a public onboarding link from a lease, let the tenant confirm contact, billing, insurance, and emergency details, then update the tenant record.
- Billing readiness: maintain recurring rent/charge rules and inspect rent roll rows for invoice, GST, and Xero blockers before invoice generation is built.
- Dashboard and registers: `/` focuses on quick actions, attention items, events, onboarding, and billing updates; `/insights` shows live portfolio health and exceptions; `/properties` holds property/lease operations; `/tenants` holds tenant search and contact/billing management.

## Auth Modes

`AUTH_MODE=dev` uses deterministic local user settings from `.env` and is the default for local development and tests.

`AUTH_MODE=clerk` keeps the adapter boundary in place for Clerk verification. Real Clerk verification is intentionally minimal in Phase 0 and should be hardened before staging access.
