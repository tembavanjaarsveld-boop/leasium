# Owner Portal Read-Only First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first read-only owner portal slice: an operator-previewed owner-facing dashboard with owner identity, linked properties, month statement totals, and explicit no-provider/no-send guardrails.

**Architecture:** Add a protected read endpoint at `/api/v1/owner-portal/{owner_id}` that reuses the first-class `Owner` / `PropertyOwner` data and existing owner-statement roll-up. Add a frontend route at `/owner-portal/[ownerId]` that renders a portal-style read-only surface without AppHeader chrome. True owner login/account claiming remains a later slice; this one proves the data contract and UI shape safely.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, pytest, Next.js App Router, React Query, Playwright smoke tests.

---

## Status — 2026-05-31

**Shipped to production.** Code commit: `b47b7a3`.

- Backend: `GET /api/v1/owner-portal/{owner_id}?month=YYYY-MM` returns an
  operator-preview payload scoped by entity role, using first-class
  `Owner`/`PropertyOwner` links and existing owner statement totals.
- Frontend: `/owner-portal/[ownerId]?month=YYYY-MM` renders a portal-style
  read-only view with owner identity, linked property splits, statement totals,
  statement property lines, and explicit no-send/no-provider guardrails.
- Auth boundary: true owner login/account claiming is intentionally deferred.
  This slice creates no owner portal account, sends no owner email, downloads no
  PDFs, writes no Xero data, reconciles no payments, dispatches no invoices,
  refreshes no providers, and mutates no provider history.
- Red/green proof: backend test failed first with 404, then passed after route
  registration; Playwright smoke failed first on the missing page, then passed
  after the route landed.
- Verification run: backend owner portal + owner statement parity/owners tests
  `22 passed`; targeted API ruff clean; targeted frontend eslint clean;
  `tsc --noEmit` clean; owner portal + People record smokes `5 passed`;
  `next build` succeeded.
- Deployment verification before this docs-sync commit: Vercel production deploy
  `dpl_BmDUL3NHvnFheAXA4jxfSwxo2ba9` for `b47b7a3` was READY;
  `https://leasium.ai` returned HTTP 200; Render health reported
  `b47b7a3b10a2b90f267991fd7c229de9ab4a3993` with `source=render`.

## Files

- Create: `apps/api/schemas/owner_portal.py` — response models for the read-only portal payload.
- Create: `apps/api/routers/owner_portal.py` — protected operator-preview read endpoint.
- Modify: `apps/api/main.py` — register the owner portal router.
- Modify: `apps/web/src/lib/api.ts` — owner portal response types + `getOwnerPortal`.
- Create: `apps/web/src/app/owner-portal/[ownerId]/page.tsx` — read-only owner portal page.
- Create: `tests/integration/test_owner_portal_api.py` — endpoint red/green tests.
- Create: `apps/web/tests/smoke/owner-portal.spec.ts` — frontend smoke test.
- Modify: `docs/product-roadmap.md`, `docs/design-governance.md`, `docs/next-chat-handover.md` — mark the slice shipped pending review after verification.

## Task 1: Backend Read Contract

**Files:**
- Create: `tests/integration/test_owner_portal_api.py`
- Create: `apps/api/schemas/owner_portal.py`
- Create: `apps/api/routers/owner_portal.py`
- Modify: `apps/api/main.py`

- [x] **Step 1: Write failing endpoint test**

Add `test_owner_portal_preview_returns_read_only_owner_dashboard` that seeds an owner with two linked properties and approved invoices, then calls:

```python
response = client.get(
    f"/api/v1/owner-portal/{owner.id}",
    params={"month": "2026-05"},
)
assert response.status_code == 200
body = response.json()
assert body["auth"]["mode"] == "operator_preview"
assert body["owner"]["display_name"] == "SKJ Holdings Pty Ltd"
assert [item["property_name"] for item in body["properties"]] == [
    "Queen Street Retail Centre",
    "King Street Offices",
]
assert body["statement"]["month"] == "2026-05"
assert body["statement"]["invoiced_cents"] == 1760000
assert "does not send owner email" in body["guardrails"][0]
```

- [x] **Step 2: Verify red**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_owner_portal_api.py -q
```

Expected: fails with 404 because `/api/v1/owner-portal/{owner_id}` is not registered.

- [x] **Step 3: Implement minimal read endpoint**

Create schemas:

```python
class OwnerPortalAuthRead(BaseModel):
    mode: Literal["operator_preview"]
    boundary: str
    detail: str

class OwnerPortalOwnerRead(BaseModel):
    id: UUID
    entity_id: UUID
    display_name: str
    legal_name: str | None = None
    trust_name: str | None = None
    trustee_name: str | None = None
    billing_contact_name: str | None = None
    billing_email: str | None = None
    abn: str | None = None
    gst_registered: bool | None = None

class OwnerPortalPropertyRead(BaseModel):
    property_id: UUID
    property_name: str
    split_pct: float

class OwnerPortalStatementRead(BaseModel):
    month: str
    owner_identity: str
    invoiced_cents: int
    paid_cents: int
    outstanding_cents: int
    invoice_count: int
    property_count: int

class OwnerPortalRead(BaseModel):
    auth: OwnerPortalAuthRead
    owner: OwnerPortalOwnerRead
    properties: list[OwnerPortalPropertyRead]
    statement: OwnerPortalStatementRead | None = None
    guardrails: list[str]
    generated_at: datetime
```

Create router:

```python
@router.get("/{owner_id}", response_model=OwnerPortalRead)
def get_owner_portal_preview(...):
    owner = session.get(Owner, owner_id)
    if owner is None or owner.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Owner not found.")
    assert_entity_role(session, user, owner.entity_id, READ_ROLES)
    # Load property links, build statement month, match the statement by linked property ids.
```

- [x] **Step 4: Verify green**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_owner_portal_api.py tests/integration/test_owners_api.py -q
.venv/bin/python -m ruff check apps/api/routers/owner_portal.py apps/api/schemas/owner_portal.py tests/integration/test_owner_portal_api.py
```

Expected: all pass; no provider send/write path is called.

## Task 2: Frontend Portal Route

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/app/owner-portal/[ownerId]/page.tsx`
- Create: `apps/web/tests/smoke/owner-portal.spec.ts`

- [x] **Step 1: Write failing smoke**

Create a smoke that mocks `GET /api/v1/owner-portal/owner-1`, opens `/owner-portal/owner-1?month=2026-05`, and asserts:

```ts
await expect(page.getByRole("heading", { name: "Owner portal" })).toBeVisible();
await expect(page.getByText("SKJ Holdings Pty Ltd")).toBeVisible();
await expect(page.getByText("Queen Street Retail Centre")).toBeVisible();
await expect(page.getByText("$17,600")).toBeVisible();
await expect(page.getByText(/does not send owner email/i)).toBeVisible();
```

Also watch requests and assert no `POST /owners/statements/send` request fires.

- [x] **Step 2: Verify red**

Run:

```bash
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/owner-portal.spec.ts --workers=1
```

Expected: fails because `/owner-portal/[ownerId]` does not exist.

- [x] **Step 3: Implement minimal route**

Add `getOwnerPortal(ownerId, month?)` to `apps/web/src/lib/api.ts`.

Render `/owner-portal/[ownerId]` as a client page with:

- Leasium mark + "Owner portal"
- owner display name and billing contact
- KPI strip: linked properties, invoiced, paid, outstanding
- property split list
- statement card for the selected month
- read-only guardrail panel

- [x] **Step 4: Verify green**

Run:

```bash
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/owner-portal.spec.ts --workers=1
cd apps/web && ./node_modules/.bin/eslint src/app/owner-portal/[ownerId]/page.tsx src/lib/api.ts tests/smoke/owner-portal.spec.ts
cd apps/web && ./node_modules/.bin/tsc --noEmit
```

Expected: all pass.

## Task 3: Docs, Review, Deploy

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [ ] **Step 1: Request agent review**

Ask one review agent for spec compliance and one for code-quality risks. Fix Critical/Important issues before commit.

- [ ] **Step 2: Run final verification**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_owner_portal_api.py tests/integration/test_owner_statement_parity.py tests/integration/test_owners_api.py -q
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/owner-portal.spec.ts tests/smoke/people-record-layout.spec.ts --workers=1
cd apps/web && ./node_modules/.bin/eslint src/app/owner-portal/[ownerId]/page.tsx src/lib/api.ts tests/smoke/owner-portal.spec.ts
cd apps/web && ./node_modules/.bin/tsc --noEmit
cd apps/web && NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next build
```

- [ ] **Step 3: Commit, push, verify deploy**

Commit directly to `main`, push, verify Vercel production is READY, `https://leasium.ai` returns 200, and Render health reports the new commit.
