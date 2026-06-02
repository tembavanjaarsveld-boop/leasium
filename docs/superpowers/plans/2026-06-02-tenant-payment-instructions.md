# Tenant payment instructions foundation

Date: 2026-06-02
Roadmap: DoorLoop refocus P1 — "Tenant self-serve payments on AU rails". This is the
**review-first foundation slice**: operator-entered payment instructions + a tenant-portal
"How to pay" surface + a per-invoice payment reference. **No money movement, no rails
provider** — reconciliation continues to run through the existing Basiq/Xero engine.

## Goal

Let an operator record how tenants should pay (EFT / PayID, optional BPAY, free-text notes)
per entity, and show those instructions + a per-invoice reference in the tenant portal, so
tenants know exactly how and what to pay. Display only.

## Non-goals (this slice)

- No in-portal "pay now", no payment processing, no PayTo/Monoova/Zai/Stripe integration.
- No Basiq/Xero write, no reconciliation change (that engine already exists and is review-first).
- No per-property/per-owner override (per-entity only for v1; override is a later slice).

## Data model

New `EntityPaymentInstruction` (one active row per entity, mirrors the per-entity
`XeroConnection`/`BasiqConnection` pattern):
- id, entity_id→entity
- account_name, bsb, account_number (EFT / bank transfer)
- payid, payid_name (PayID identifier + the registered name tenants verify against)
- bpay_biller_code (optional BPAY)
- instructions (free-text notes)
- updated_by_user_id→app_user, created_at, updated_at, deleted_at, metadata (jsonb)
Unique partial index on `entity_id` where `deleted_at IS NULL`.
Migration `20260602_0036_entity_payment_instructions.py` (down_revision `20260602_0035`).
These are the landlord's *receiving* details the operator chooses to disclose — intended
display, not tenant PII.

## Endpoints (new `apps/api/routers/payments.py`, prefix `/payments`)

- `GET /payments/instructions?entity_id=...` — operator (owner/admin/finance/ops/viewer
  read roles); returns the entity's instructions + `configured` (false when no row/empty).
- `PUT /payments/instructions?entity_id=...` — operator (owner/admin/finance); upsert the
  single active row (trim blanks → null), write an audit row (`payment.instructions.update`),
  no provider call. Register the router in `apps/api/main.py`.

Schemas in `apps/api/schemas/payments.py`: `PaymentInstructionRead`, `PaymentInstructionUpdate`.

## Tenant-portal projection (`apps/api/routers/tenant_portal.py`)

- New `TenantPortalHowToPayRead` (account_name, bsb, account_number, payid, payid_name,
  bpay_biller_code, instructions, methods: list[str], configured: bool).
- `TenantPortalRead` gains `how_to_pay: TenantPortalHowToPayRead | None`; `_portal_read`
  resolves the entity row via `scope.onboarding.entity_id` (None when unconfigured).
- `TenantPortalInvoiceRead` gains `payment_reference: str | None` = `invoice.invoice_number`
  (the reference a tenant quotes); set in `_invoice_read`.
- Add a guardrail line: "Payment instructions are display-only; Leasium does not process
  payments or move money."

## TDD plan

Backend — `tests/integration/test_payments_api.py`:
1. operator PUT then GET round-trips EFT+PayID(+BPAY+notes); blanks normalise to null.
2. GET returns `configured: false` with no row.
3. PUT requires owner/admin/finance (viewer/ops → 403); cross-entity → 403; writes audit.
Tenant portal — extend `tests/integration/test_tenant_portal_api.py`:
4. portal read includes `how_to_pay` (correct fields, `configured: true`) when set, `null`
   when unset; invoices carry `payment_reference == invoice_number`; guardrail present.
5. how_to_pay shows the operator-entered receiving details but no tenant identity/secret leak.

## Frontend (next slice)

Settings → a "Payment instructions" operator form (EFT/PayID/BPAY/notes) using the GET/PUT
client fns; tenant-portal "How to pay" panel rendering `how_to_pay` + each invoice's
`payment_reference`; api.ts types + a Playwright smoke (run with `NODE_ENV=development`).

## Verification

Backend (Mac): `.venv/bin/python -m pytest tests/integration/test_payments_api.py
tests/integration/test_tenant_portal_api.py -q`; ruff on touched files; `alembic heads`
single; migration test. Frontend: eslint + tsc + smoke + next build.

## Guardrails (non-negotiable)

Display only. No payment processing, no rails provider, no Basiq/Xero write, no reconciliation
change, no tenant email/SMS, no provider-history mutation.
