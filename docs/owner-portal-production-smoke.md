# Owner Portal Production Smoke

Use this runbook before broad owner portal rollout. It covers the owner account
database invariant, a read-only live Clerk owner account smoke, and the
separately approved invite-claim pass. Do not paste real database URLs, Clerk
tokens, invite tokens, document bytes, or owner private data into shared notes.

## Production URLs

- Frontend: `https://leasium.ai`
- API base: `https://api.leasium.ai/api/v1`
- Owner account entry: `https://leasium.ai/owner-portal`
- Owner invite claim link: `https://leasium.ai/owner-portal/invite/<token>`

## 1. Migration Preflight

Run this against the target database before applying migration `20260601_0032`.
It must return zero rows.

```sql
SELECT
  auth_provider,
  auth_provider_id,
  COUNT(*) AS active_count,
  array_agg(id ORDER BY updated_at DESC) AS account_ids,
  array_agg(owner_id ORDER BY updated_at DESC) AS owner_ids
FROM owner_portal_account
WHERE status = 'active'
  AND revoked_at IS NULL
  AND deleted_at IS NULL
GROUP BY auth_provider, auth_provider_id
HAVING COUNT(*) > 1;
```

Success: zero rows.

Failure: stop rollout. Pick the correct active owner account with the operator,
then revoke or soft-delete duplicates before applying the migration. Do not hard
delete rows unless the operator explicitly approves it.

Example reviewed cleanup:

```sql
UPDATE owner_portal_account
SET
  status = 'revoked',
  revoked_at = now(),
  updated_at = now(),
  metadata = metadata || jsonb_build_object(
    'rollout_cleanup', 'revoked before 20260601_0032 active-provider invariant'
  )
WHERE id = '<duplicate-owner-portal-account-id>';
```

Apply/verify the migration through the normal deployment path. If running
Alembic directly, keep the database URL out of logs and shell history.

```bash
.venv/bin/alembic upgrade head
```

Verify:

```sql
SELECT version_num FROM alembic_version;
```

Success: `20260601_0032`.

## 2. Clerk Guard Preflight

Run the public/protected route guard before owner-account testing.

```bash
cd apps/web
PLAYWRIGHT_BASE_URL=https://leasium.ai \
LEASIUM_SMOKE_CLERK_GUARD=1 \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=present \
CLERK_SECRET_KEY=present \
./node_modules/.bin/playwright test tests/smoke/clerk-guard.spec.ts --workers=1
```

Success: protected workspace routes load for the client auth bridge and public
routes do not redirect to operator sign-in.

## 3. Save A Live Owner Session

Use a real owner Clerk account already linked to the intended owner portal
account. This storage file is local only.

```bash
cd apps/web
LEASIUM_AUDIT_URL=https://leasium.ai/owner-portal \
LEASIUM_AUDIT_STORAGE=/tmp/leasium-owner-clerk.json \
npm run audit:live -- --login
```

Success: the browser lands on the owner portal or linked owner account state,
and the storage file is saved.

## 4. Read-Only Owner Account Smoke

This smoke does not create invites, consume claim links, send owner email,
generate owner statement PDFs, call providers, write Xero/Basiq data, reconcile
payments, or mutate provider history. It allows only:

- `GET /api/v1/owner-portal/account/status`
- `GET /api/v1/owner-portal/account/session`
- optional `GET /api/v1/owner-portal/account/documents/<id>/download` when an
  expected owner-visible filename is supplied

Run without `LEASIUM_SMOKE_OWNER_PORTAL_EXPECT_DOCUMENT` to avoid downloading
document bytes.

```bash
cd apps/web
PLAYWRIGHT_BASE_URL=https://leasium.ai \
LEASIUM_SMOKE_OWNER_PORTAL_ACCOUNT_LIVE=1 \
LEASIUM_SMOKE_OWNER_PORTAL_STORAGE=/tmp/leasium-owner-clerk.json \
LEASIUM_SMOKE_OWNER_PORTAL_MONTH=2026-05 \
LEASIUM_SMOKE_OWNER_PORTAL_EXPECT_OWNER_NAME="<owner display name>" \
./node_modules/.bin/playwright test tests/smoke/owner-portal-account.spec.ts \
  -g "live Clerk owner account opens read-only owner portal without mutations" --workers=1
```

To also prove a shared-document download, first confirm the selected owner has a
property-level document explicitly marked `owner_portal_visible`, then add:

```bash
LEASIUM_SMOKE_OWNER_PORTAL_EXPECT_DOCUMENT="<owner-visible filename>"
```

Success: the page shows `Owner portal`, `Owner account`, the expected owner when
provided, the access boundary, local packet CSV download works, optional shared
document download works, and the forbidden-request trap stays empty. The
Playwright trap aborts any other `/api/v1` request in this lane.

Do not set `LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_LIVE` or
`LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_TOKEN` in this read-only lane.

## 5. Separately Approved Claim Pass

Claiming mutates production owner portal rows. Run this only with explicit
operator approval, one chosen production owner, and a matching owner Clerk email.

1. Save an operator Clerk session:

   ```bash
   cd apps/web
   LEASIUM_AUDIT_URL=https://leasium.ai \
   LEASIUM_AUDIT_STORAGE=/tmp/leasium-operator-clerk.json \
   npm run audit:live -- --login
   ```

2. From the operator UI, create one local no-send owner portal invite for the
   chosen owner. Confirm no owner email, statement PDF, provider sync, or Xero
   action is triggered.
3. Use either the optional Playwright claim lane below or open the claim link
   manually with the matching owner Clerk account and complete the claim.
4. Re-run the read-only owner account smoke above against that owner account.
5. Do not paste the raw invite token into shared evidence. Record only the owner
   id, the claim timestamp, and whether the owner account status/session and
   optional shared-document download passed.

### Optional Playwright Claim Lane

This lane is production-mutating. It consumes exactly one disposable owner
invite token and creates or updates the matching `owner_portal_account` row. Run
it only after explicit operator approval for one chosen owner, with the matching
owner Clerk account saved in `LEASIUM_SMOKE_OWNER_PORTAL_STORAGE`.

Allowed API calls in this lane:

- `GET /api/v1/owner-portal/invites/<token>/preview`
- `POST /api/v1/owner-portal/account/claim`
- matching `OPTIONS` preflights

The Playwright trap aborts any other `/api/v1` request in this lane, including
owner-portal reads/mutations outside the allowlist plus owner statement
send/dispatch/PDF, Comms, Xero, Basiq, payment, and reconciliation paths.

```bash
cd apps/web
printf "Owner claim token: "
read -r -s LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_TOKEN
printf "\n"
export LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_TOKEN

PLAYWRIGHT_BASE_URL=https://leasium.ai \
LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_LIVE=1 \
LEASIUM_SMOKE_OWNER_PORTAL_STORAGE=/tmp/leasium-owner-clerk.json \
LEASIUM_SMOKE_OWNER_PORTAL_EXPECT_OWNER_NAME="<owner display name>" \
./node_modules/.bin/playwright test tests/smoke/owner-portal-account.spec.ts \
  -g "live Clerk owner invite claim consumes disposable claim token" --workers=1

unset LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_TOKEN
```

Success: the claim page shows `Owner Account Setup`, keeps statement/property
data hidden before claim, sends exactly one bearer-authenticated claim request,
then renders `Owner portal`, `Owner account`, `Owner-visible packet`, `Access
boundary`, and `Read-only owner portal`. The forbidden-request trap stays empty.

After success, immediately unset the claim env vars and rerun the Section 4
read-only smoke against the same owner session. Record only owner id, claim
timestamp, expected owner name, read-only smoke result, and whether optional
shared-document download passed. Do not record the raw token.

Failure handling:

- `401 Owner portal account not found`: the owner account is not linked; use the
  approved claim pass or choose the correct owner login.
- Test skipped: one of `PLAYWRIGHT_BASE_URL`,
  `LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_LIVE=1`, owner storage, or
  `LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_TOKEN` is missing.
- `401` or redirect to sign-in: owner storage is stale or for the wrong Clerk
  account.
- `404 Owner portal invite not found`: token is wrong, expired, revoked, or from
  another environment.
- `403 Owner portal login email must match this invite`: signed-in Clerk email
  does not match the invite claim email; the invite should remain unconsumed.
- `403 owner portal access`: the organisation is likely self-managed; switch to
  managing-agent/hybrid only with operator approval.
- `403 Owner portal access...managing-agent or hybrid`: stop; do not switch
  operating mode without operator approval.
- `409 Owner billing email is required`: fix the owner billing email before
  creating the invite.
- `409 already linked to another owner`: use a separate owner login or revoke
  the incorrect active owner portal account after review.
- `410 invite has been used`: do not reuse the token; sign in as the account
  that claimed it or create a fresh no-send invite after approval.
- `404 document not found`: the document is not linked to this owner property,
  is tenant/private scoped, or is missing `owner_portal_visible`.
- Forbidden-request trap failure: stop rollout, capture the method/path, and do
  not retry with another token until reviewed.
