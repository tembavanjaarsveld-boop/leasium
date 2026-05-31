# Owner Portal Account Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add true owner portal account/token auth so `/owner-portal` can become a secure owner login surface instead of only an operator preview.

**Architecture:** Reuse the tenant portal account pattern, but scope it to first-class `Owner` records. Operators generate a local, no-send owner claim link; the public claim link exposes only minimal context, Clerk bearer auth creates an `OwnerPortalAccount`, the one-time invite is consumed, and future reads use bearer-only `/owner-portal/account/session`.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Clerk bearer verification via `stewart.core.auth`, Next.js App Router, React Query, Playwright smoke tests.

---

## Files

- Modify: `stewart/core/models.py` — add `OwnerPortalAccountStatus`, `OwnerPortalInvite`, and `OwnerPortalAccount`.
- Create: `migrations/versions/20260531_0030_owner_portal_accounts.py` — create owner portal invite/account tables and indexes.
- Modify: `apps/api/schemas/owner_portal.py` — add invite preview, claim, lifecycle, and invite response schemas; widen auth metadata.
- Modify: `apps/api/routers/owner_portal.py` — add invite creation, public invite preview, account claim, lifecycle status, and bearer session routes.
- Test: `tests/integration/test_owner_portal_auth_api.py` — red/green backend auth coverage.
- Modify: `apps/web/src/lib/api.ts` — owner portal account/invite types and client helpers.
- Create: `apps/web/src/app/owner-portal/page.tsx` — signed-in owner account entry.
- Create: `apps/web/src/app/owner-portal/invite/[token]/page.tsx` — one-time claim gate.
- Modify: `apps/web/src/app/owner-portal/[ownerId]/page.tsx` — keep operator preview intact and reuse shared rendering if extracted.
- Test: `apps/web/tests/smoke/owner-portal-account.spec.ts` — account entry + claim gate smoke with mocked API.
- Modify: `apps/web/tests/smoke/api-mocks.ts` — mock owner invite/account endpoints.
- Modify: `docs/product-roadmap.md`, `docs/design-governance.md`, `docs/next-chat-handover.md` — record shipped/pending status and stale handover correction.

## Task 1: Backend Schema

- [x] **Step 1: Write the failing migration/model test**

Add a focused test in `tests/integration/test_owner_portal_auth_api.py` that imports `OwnerPortalAccount`, `OwnerPortalAccountStatus`, and `OwnerPortalInvite`, creates an invite/account row, and asserts the token hash is stored without the raw token.

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/integration/test_owner_portal_auth_api.py -q`

Expected: import failure for the new owner portal account models.

- [x] **Step 3: Add model + migration**

Add `OwnerPortalAccountStatus(active, revoked)`, `OwnerPortalInvite`, and `OwnerPortalAccount`. The account unique active index is on `(auth_provider, auth_provider_id, owner_id)`, which lets one Clerk login claim more than one Owner record while preventing duplicate active links to the same Owner.

- [~] **Step 4: Run migration and test**

Backend tests pass. Local Alembic upgrade is pending a running local Postgres;
this desktop session refused `localhost:5432`, so verify migration application
through Render/Neon deploy checks before broad owner rollout.

Run: `.venv/bin/alembic upgrade head`

Run: `.venv/bin/python -m pytest tests/integration/test_owner_portal_auth_api.py -q`

Expected: schema test passes.

## Task 2: Backend Account Claim And Session

- [x] **Step 1: Write failing API tests**

Add tests for:

- operator invite creation returns a claim URL/token and stores only a hash;
- public invite preview returns owner display name, claim email, expiry, and claimable;
- wrong Clerk email rejects claim and leaves invite unconsumed;
- matching Clerk email creates `OwnerPortalAccount`, consumes invite, and returns `auth.mode == "owner_portal_account"`;
- bearer `/owner-portal/account/session?month=YYYY-MM` reads the owner portal without requiring the owner id in the URL;
- consumed invite preview is marked unclaimable and a different Clerk account cannot claim it;
- revoked accounts cannot open the bearer session.

- [x] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/integration/test_owner_portal_auth_api.py -q`

Expected: 404s for new endpoints and missing model behavior.

- [x] **Step 3: Implement minimal routes**

Add these routes under `apps/api/routers/owner_portal.py`:

- `POST /api/v1/owner-portal/{owner_id}/invite` for operators; no email is sent.
- `GET /api/v1/owner-portal/invites/{token}/preview` public safe preview.
- `POST /api/v1/owner-portal/account/claim` Clerk bearer + token claim.
- `GET /api/v1/owner-portal/account/status` Clerk bearer lifecycle status.
- `GET /api/v1/owner-portal/account/session?month=YYYY-MM` Clerk bearer read-only portal.

Reuse `_clerk_identity`, `_normalise_email`, and `_verified_emails_from_clerk_user` from `stewart.core.auth`; do not add a second Clerk verifier.

- [x] **Step 4: Run focused backend verification**

Run: `.venv/bin/python -m pytest tests/integration/test_owner_portal_auth_api.py tests/integration/test_owner_portal_api.py tests/integration/test_owner_statement_parity.py -q`

Run: `.venv/bin/python -m ruff check apps/api/routers/owner_portal.py apps/api/schemas/owner_portal.py stewart/core/models.py tests/integration/test_owner_portal_auth_api.py`

Expected: all pass cleanly.

## Task 3: Frontend Owner Claim Gate And Account Entry

- [x] **Step 1: Write failing smoke tests**

Create `apps/web/tests/smoke/owner-portal-account.spec.ts` covering:

- `/owner-portal/invite/owner-token-one` shows only claim context before sign-in;
- after mocked Clerk sign-in, claim completes and the owner portal renders with `owner_portal_account`;
- `/owner-portal` opens an already linked owner account without an owner id in the URL;
- revoked/unlinked states show recovery copy without rendering financial rows.

- [x] **Step 2: Run smoke to verify it fails**

Run: `cd apps/web && ./node_modules/.bin/playwright test tests/smoke/owner-portal-account.spec.ts --workers=1`

Expected: route not found / missing API helpers.

- [x] **Step 3: Add API helpers and routes**

Add owner portal helpers in `apps/web/src/lib/api.ts`:

- `getOwnerPortalInvitePreview(token)`
- `claimOwnerPortalAccount(token, authToken)`
- `getOwnerPortalAccountStatus(authToken)`
- `getOwnerPortalAccountSession(month, authToken)`
- `createOwnerPortalInvite(ownerId)`

Create `/owner-portal` for account entry and `/owner-portal/invite/[token]` for the claim gate. Keep the existing `/owner-portal/[ownerId]` operator preview route, and keep the month requirement for statement reads.

- [x] **Step 4: Run frontend verification**

Run: `cd apps/web && ./node_modules/.bin/eslint 'src/app/owner-portal/**/*.{ts,tsx}' src/lib/api.ts tests/smoke/owner-portal-account.spec.ts`

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit`

Run: `cd apps/web && ./node_modules/.bin/playwright test tests/smoke/owner-portal-account.spec.ts tests/smoke/owner-portal.spec.ts --workers=1`

Expected: all pass cleanly.

## Task 4: Review, Docs, Deploy

- [~] **Step 1: Request agent review**

Two review agents were dispatched for backend auth scope and frontend account UX,
but both exceeded the useful review window and were closed. The coordinator
completed the final local review pass and full verification directly.

Dispatch one reviewer for backend auth scope and one reviewer for frontend/account UX. Fix Critical and Important findings before continuing.

- [x] **Step 2: Final verification**

Focused backend tests, backend ruff, targeted frontend eslint, `tsc --noEmit`,
owner portal smokes, production-style `next build`, Postgres offline migration
SQL generation, and in-app browser sanity checks passed.

Run focused backend tests, backend ruff, frontend eslint, `tsc --noEmit`, owner portal smokes, and `next build`.

- [x] **Step 3: Docs**

Update:

- `docs/product-roadmap.md` — owner portal account/token auth `[~]` pending prototype/Remba review.
- `docs/design-governance.md` — record public owner account gate and no-provider/no-send boundary.
- `docs/next-chat-handover.md` — latest status, commits, verification, and remove/annotate stale Phase 3 "next" pointer.

- [ ] **Step 4: Commit, push, verify deploy**

Commit directly on `main`, push, then verify Vercel production deployment and Render health.
