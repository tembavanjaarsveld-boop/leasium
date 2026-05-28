# Xero Monday Runway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Leasium's Xero connection and month-end accounting workflow provably usable by Monday while keeping the development runway honest and fast.

**Execution status, 2026-05-28:** Tasks 1-4 are implemented and committed/in-flight locally: development checks are stable, Xero diagnostics/checklist are added, Settings now shows callback feedback plus diagnostics-gated actions, and the Monday provider path has a documented verification set with backend coverage for diagnostics, OAuth, previews, approval-gated draft creation, dispatch ordering/idempotency, and payment reconciliation. Task 5 remains the live production rehearsal and must not run Xero writes, provider dispatch, tenant email, or payment reconciliation without explicit operator approval at that moment.

**Architecture:** Preserve the existing review-first Xero architecture: OAuth stores encrypted provider tokens, previews read from Xero, local approvals gate any Xero draft creation, and payment reconciliation only updates Leasium metadata. Add go-live diagnostics and operator-facing recovery around that path instead of broad refactors.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, pytest, Next.js 15 App Router, React Query, Playwright smoke tests, Xero OAuth/Accounting API, SendGrid only where invoice dispatch is explicitly approved.

---

## File Structure

- Modify `Makefile`: stop pointing day-to-day commands at unavailable `uv`/`pnpm`; use the checked-in `.venv` and `apps/web/node_modules/.bin/*` paths documented in the handover.
- Modify `docs/next-chat-handover.md`: record the current command truth and Xero Monday priority.
- Modify `docs/deployment.md`: add the Xero go-live checklist: redirect URI, token encryption key, state secret, scopes, branded API URL, and post-connect verification.
- Modify `apps/api/routers/xero.py`: tighten OAuth/refresh error reporting and add a non-mutating connection diagnostic read if needed.
- Modify `apps/api/schemas/xero.py`: add the diagnostic response type if the router needs it.
- Modify `apps/web/src/lib/api.ts`: add any new Xero diagnostic client type/function.
- Modify `apps/web/src/app/settings/page.tsx`: make Xero connect success/failure visible after redirect and make next actions clearer.
- Modify `tests/integration/test_xero_api.py`: cover OAuth failure/recovery and any new diagnostic endpoint.
- Modify `apps/web/tests/smoke/app-flows.spec.ts` and `apps/web/tests/smoke/api-mocks.ts`: cover the visible Xero connect/readiness path.

---

### Task 1: Development Runway Truth

**Files:**
- Modify: `Makefile`
- Modify: `docs/next-chat-handover.md`

- [ ] **Step 1: Reproduce current backend style failure**

Run:

```bash
.venv/bin/python -m ruff check apps stewart tests scripts
```

Expected: FAIL with import sorting and `datetime.UTC` issues in `apps/api/routers/comms.py`, `apps/api/routers/maintenance.py`, `apps/api/routers/system.py`, `scripts/enroll_from_workbook.py`, `tests/integration/test_ai_ask_api.py`, and `tests/integration/test_branded_templates_api.py`.

- [ ] **Step 2: Apply only safe Ruff fixes**

Run:

```bash
.venv/bin/python -m ruff check apps stewart tests scripts --fix
```

Expected: Ruff rewrites import order and the `datetime.UTC` alias only.

- [ ] **Step 3: Update Makefile commands to match this Mac**

Replace the command bodies with:

```makefile
install:
	.venv/bin/python -m pip install -e '.[dev]'
	cd apps/web && npm install

migrate:
	.venv/bin/alembic upgrade head

seed:
	.venv/bin/python -m scripts.seed

dev:
	(.venv/bin/uvicorn apps.api.main:app --reload --host $${API_HOST:-0.0.0.0} --port $${API_PORT:-8000}) & \
	(cd apps/web && NEXT_PUBLIC_API_BASE_URL=$${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8000/api/v1} NEXT_TEST_WASM_DIR=$$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next dev)

test:
	.venv/bin/python -m pytest

lint:
	.venv/bin/python -m ruff check apps stewart tests scripts
	cd apps/web && ./node_modules/.bin/eslint . && ./node_modules/.bin/tsc --noEmit

typecheck:
	.venv/bin/python -m mypy apps stewart scripts tests
	cd apps/web && ./node_modules/.bin/tsc --noEmit

format:
	.venv/bin/python -m ruff format apps stewart tests scripts
	.venv/bin/python -m ruff check apps stewart tests scripts --fix
	cd apps/web && ./node_modules/.bin/prettier --write .
```

Keep `typecheck` separate because Python mypy currently reports known strict-mode debt.

- [ ] **Step 4: Update handover command truth**

Add a short note under `docs/next-chat-handover.md` `Local Connection And Tooling`:

```markdown
- `make lint` is the fast merge gate: Ruff + frontend ESLint + frontend TypeScript.
- `make typecheck` includes Python mypy and currently represents tracked strict-mode debt, not the day-to-day merge gate.
- Xero Monday priority: connect OAuth in production, verify contact preview, chart/tax preview, invoice posting preview, approved Xero draft creation, and payment reconciliation preview/apply with explicit operator approvals.
```

- [ ] **Step 5: Verify runway checks**

Run:

```bash
.venv/bin/python -m ruff check apps stewart tests scripts
.venv/bin/python -m pytest -q
cd apps/web && ./node_modules/.bin/eslint . && ./node_modules/.bin/tsc --noEmit
```

Expected: Ruff passes; pytest passes with the existing migrations skip if `TEST_DATABASE_URL` is unset; frontend lint and TypeScript pass.

- [ ] **Step 6: Commit**

```bash
git add Makefile docs/next-chat-handover.md apps/api/routers/comms.py apps/api/routers/maintenance.py apps/api/routers/system.py scripts/enroll_from_workbook.py tests/integration/test_ai_ask_api.py tests/integration/test_branded_templates_api.py
git commit -m "Stabilise local development checks"
```

---

### Task 2: Xero Go-Live Checklist And Non-Mutating Diagnostics

**Files:**
- Modify: `docs/deployment.md`
- Modify: `apps/api/schemas/xero.py`
- Modify: `apps/api/routers/xero.py`
- Test: `tests/integration/test_xero_api.py`

- [ ] **Step 1: Write the failing diagnostic test**

Add to `tests/integration/test_xero_api.py`:

```python
def test_xero_connection_diagnostics_report_config_and_connection_state(
    client: TestClient,
    session: Session,
    entity_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _provider_settings()
    _fake_xero_provider(monkeypatch)
    app.dependency_overrides[get_settings] = lambda: settings

    response = client.get(f"/api/v1/xero/connection-diagnostics?entity_id={entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["provider_configured"] is True
    assert body["connected"] is False
    assert body["can_start_oauth"] is True
    assert body["can_preview_contacts"] is False
    assert body["can_create_xero_drafts"] is False
    assert body["redirect_uri"].endswith("/api/v1/xero/oauth/callback")
    assert "No Xero provider connection is stored" in body["next_steps"]
```

Expected before implementation: FAIL because the route does not exist.

- [ ] **Step 2: Add the diagnostic schema**

Add to `apps/api/schemas/xero.py`:

```python
class XeroConnectionDiagnosticsRead(BaseModel):
    provider_configured: bool
    missing_config: list[str]
    redirect_uri: str
    scopes: list[str]
    connected: bool
    connection_source: Literal["provider", "manual", "none"]
    xero_tenant_id: str | None
    tenant_name: str | None
    token_expires_at: datetime | None
    can_start_oauth: bool
    can_preview_contacts: bool
    can_validate_chart_tax: bool
    can_preview_invoice_posting: bool
    can_create_xero_drafts: bool
    can_preview_payment_reconciliation: bool
    next_steps: list[str]
    guardrails: list[str]
```

- [ ] **Step 3: Implement the diagnostic route**

Add imports and a read-only route to `apps/api/routers/xero.py`:

```python
from apps.api.schemas.xero import XeroConnectionDiagnosticsRead


@router.get("/connection-diagnostics", response_model=XeroConnectionDiagnosticsRead)
def xero_connection_diagnostics(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    entity_id: Annotated[UUID, Query()],
) -> XeroConnectionDiagnosticsRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    provider = _provider(settings)
    connection = _connection(entity, session, settings)
    provider_connection = _active_xero_connection(session, entity.id)
    has_provider_connection = provider_connection is not None
    has_tenant = bool(connection.xero_tenant_id)
    next_steps: list[str] = []
    if not provider.configured:
        next_steps.append("Set the missing Xero environment variables before starting OAuth.")
    if not has_provider_connection:
        next_steps.append("No Xero provider connection is stored. Start OAuth from Settings.")
    if has_provider_connection:
        next_steps.append("Run contact preview, chart/tax preview, and invoice posting preview.")

    return XeroConnectionDiagnosticsRead(
        provider_configured=provider.configured,
        missing_config=provider.missing_config,
        redirect_uri=provider.redirect_uri,
        scopes=provider.scopes,
        connected=connection.connected,
        connection_source=connection.connection_source,
        xero_tenant_id=connection.xero_tenant_id,
        tenant_name=connection.tenant_name,
        token_expires_at=provider_connection.token_expires_at if provider_connection else None,
        can_start_oauth=provider.configured,
        can_preview_contacts=has_provider_connection,
        can_validate_chart_tax=has_provider_connection,
        can_preview_invoice_posting=has_provider_connection,
        can_create_xero_drafts=has_provider_connection and has_tenant,
        can_preview_payment_reconciliation=has_provider_connection and has_tenant,
        next_steps=next_steps,
        guardrails=[
            "This diagnostic route does not refresh tokens or call Xero.",
            "Xero draft creation still requires explicit invoice posting approval.",
            "Payment reconciliation apply only updates local Leasium metadata.",
        ],
    )
```

- [ ] **Step 4: Document the Xero go-live checklist**

Add to `docs/deployment.md`:

```markdown
## Xero Go-Live Checklist

Before Monday's production Xero test:

- Xero app redirect URI is exactly `https://api.leasium.ai/api/v1/xero/oauth/callback`.
- Render has `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `XERO_STATE_SECRET`, and `XERO_TOKEN_ENCRYPTION_KEY`.
- `XERO_TOKEN_ENCRYPTION_KEY` is a Fernet key generated once with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
- `PUBLIC_API_URL=https://api.leasium.ai` and `FRONTEND_URL=https://leasium.ai`.
- Xero scopes include offline access, contacts, settings, transactions, and accounting reports needed by the current workflow.
- After connecting, Settings Xero must show provider connected, contact preview must return or safely show zero contacts, chart/tax preview must run, invoice posting preview must run, Xero draft creation must remain approval-gated, and payment reconciliation preview/apply must be explicit.
```

- [ ] **Step 5: Verify diagnostics**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_xero_api.py::test_xero_connection_diagnostics_report_config_and_connection_state -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/deployment.md apps/api/schemas/xero.py apps/api/routers/xero.py tests/integration/test_xero_api.py
git commit -m "Add Xero connection diagnostics"
```

---

### Task 3: Xero Settings Operator Feedback

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app/settings/page.tsx`
- Test: `apps/web/tests/smoke/api-mocks.ts`
- Test: `apps/web/tests/smoke/app-flows.spec.ts`

- [ ] **Step 1: Write the smoke expectation**

Add a Settings smoke assertion that visits:

```ts
await page.goto("/settings?tab=xero&xero_connected=1&xero_tenant_id=tenant-provider-123");
await expect(page.getByText("Xero connected")).toBeVisible();
await expect(page.getByText("Run contact preview next")).toBeVisible();
```

Expected before implementation: FAIL because the callback banner is not visible.

- [ ] **Step 2: Add the diagnostic API client**

Add to `apps/web/src/lib/api.ts`:

```ts
export type XeroConnectionDiagnosticsRecord = {
  provider_configured: boolean;
  missing_config: string[];
  redirect_uri: string;
  scopes: string[];
  connected: boolean;
  connection_source: "provider" | "manual" | "none";
  xero_tenant_id: string | null;
  tenant_name: string | null;
  token_expires_at: string | null;
  can_start_oauth: boolean;
  can_preview_contacts: boolean;
  can_validate_chart_tax: boolean;
  can_preview_invoice_posting: boolean;
  can_create_xero_drafts: boolean;
  can_preview_payment_reconciliation: boolean;
  next_steps: string[];
  guardrails: string[];
};

export function getXeroConnectionDiagnostics(entityId: string) {
  const params = new URLSearchParams({ entity_id: entityId });
  return request<XeroConnectionDiagnosticsRecord>(
    `/xero/connection-diagnostics?${params.toString()}`,
  );
}
```

- [ ] **Step 3: Render redirect result and diagnostics in Settings**

In `apps/web/src/app/settings/page.tsx`, read query params near the existing tab/entity parsing:

```tsx
const [xeroCallbackNotice, setXeroCallbackNotice] = useState<{
  kind: "success" | "error";
  message: string;
} | null>(null);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("xero_connected") === "1") {
    setActiveTab("xero");
    setXeroCallbackNotice({
      kind: "success",
      message: "Xero connected. Run contact preview next.",
    });
  }
  const xeroError = params.get("xero_error");
  if (xeroError) {
    setActiveTab("xero");
    setXeroCallbackNotice({
      kind: "error",
      message: `Xero connection did not complete: ${xeroError.replaceAll("_", " ")}.`,
    });
  }
}, []);
```

Render the notice at the top of the Xero tab:

```tsx
{xeroCallbackNotice ? (
  <SectionPanel
    title={xeroCallbackNotice.kind === "success" ? "Xero connected" : "Xero connection needs attention"}
    description={xeroCallbackNotice.message}
  >
    <p className="text-sm text-slate-600">
      Leasium has not posted invoices, sent tenant email, or reconciled payments from this connection step.
    </p>
  </SectionPanel>
) : null}
```

- [ ] **Step 4: Mock diagnostics in smoke fixtures**

Add to `apps/web/tests/smoke/api-mocks.ts`:

```ts
await route.fulfill({
  json: {
    provider_configured: true,
    missing_config: [],
    redirect_uri: "https://api.leasium.ai/api/v1/xero/oauth/callback",
    scopes: ["offline_access", "accounting.contacts.read"],
    connected: true,
    connection_source: "provider",
    xero_tenant_id: "tenant-provider-123",
    tenant_name: "SKJ Capital",
    token_expires_at: "2026-05-28T05:00:00Z",
    can_start_oauth: true,
    can_preview_contacts: true,
    can_validate_chart_tax: true,
    can_preview_invoice_posting: true,
    can_create_xero_drafts: true,
    can_preview_payment_reconciliation: true,
    next_steps: ["Run contact preview, chart/tax preview, and invoice posting preview."],
    guardrails: ["This diagnostic route does not refresh tokens or call Xero."],
  },
});
```

- [ ] **Step 5: Verify Settings**

Run:

```bash
cd apps/web
./node_modules/.bin/eslint src/app/settings/page.tsx src/lib/api.ts tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts
./node_modules/.bin/tsc --noEmit
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test --grep "Xero"
```

Expected: lint, typecheck, and Xero smoke pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/app/settings/page.tsx apps/web/tests/smoke/api-mocks.ts apps/web/tests/smoke/app-flows.spec.ts
git commit -m "Clarify Xero connection status"
```

---

### Task 4: Xero End-To-End Provider Path Verification

**Files:**
- Modify: `tests/integration/test_xero_api.py`
- Modify: `docs/next-chat-handover.md`

- [ ] **Step 1: Run focused Xero tests**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_xero_api.py -q
```

Expected: all Xero integration tests pass.

- [ ] **Step 2: Run critical provider-path tests by name**

Run:

```bash
.venv/bin/python -m pytest \
  tests/integration/test_xero_api.py::test_xero_oauth_callback_records_provider_connection \
  tests/integration/test_xero_api.py::test_xero_contact_sync_preview_suggests_matches_without_applying \
  tests/integration/test_xero_api.py::test_xero_chart_tax_validation_preview_checks_provider_accounts_and_tax_rates \
  tests/integration/test_xero_api.py::test_xero_invoice_posting_preview_requires_provider_connection \
  tests/integration/test_xero_api.py::test_xero_posting_approval_then_draft_create_is_idempotent \
  tests/integration/test_xero_api.py::test_xero_provider_dispatch_creates_xero_then_sends_email_idempotently \
  -q
```

Expected: PASS. These prove OAuth, contact preview, chart/tax preview, posting preview, approval-gated draft creation, and provider dispatch idempotency.

- [ ] **Step 3: Add Monday verification note**

Add to `docs/next-chat-handover.md`:

```markdown
## Xero Monday Verification

Target path:

1. Settings → Xero → Connect Xero opens the Xero OAuth URL.
2. Callback returns to `/settings?tab=xero&xero_connected=1`.
3. Settings shows provider connected.
4. Contact preview reads provider contacts and applies only selected local mappings.
5. Chart/tax preview reads provider accounts/tax rates and does not mutate Xero.
6. Invoice posting preview builds payloads without posting.
7. Posting approval records local approval only.
8. Draft creation creates/reuses Xero DRAFT invoices only for approved drafts.
9. Payment reconciliation preview reads provider invoice/payment state and apply updates local invoice metadata only.

Never run draft creation, provider dispatch, tenant email, or payment apply against production data without explicit operator approval in the moment.
```

- [ ] **Step 4: Verify full fast gate**

Run:

```bash
.venv/bin/python -m ruff check apps stewart tests scripts
.venv/bin/python -m pytest -q
cd apps/web && ./node_modules/.bin/eslint . && ./node_modules/.bin/tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/test_xero_api.py docs/next-chat-handover.md
git commit -m "Document Xero Monday verification"
```

---

### Task 5: Production Xero Connect Rehearsal

**Files:**
- Modify only docs if new production facts are discovered.

- [ ] **Step 1: Confirm production environment values**

Verify in Render/Vercel dashboards:

```text
PUBLIC_API_URL=https://api.leasium.ai
FRONTEND_URL=https://leasium.ai
NEXT_PUBLIC_API_BASE_URL=https://api.leasium.ai/api/v1
XERO_REDIRECT_URI=https://api.leasium.ai/api/v1/xero/oauth/callback
XERO_CLIENT_ID is set
XERO_CLIENT_SECRET is set
XERO_STATE_SECRET is set
XERO_TOKEN_ENCRYPTION_KEY is set
```

Expected: all are present. Missing values are a deploy blocker.

- [ ] **Step 2: Confirm Xero app redirect URI**

In the Xero developer console, confirm the redirect URI exactly matches:

```text
https://api.leasium.ai/api/v1/xero/oauth/callback
```

Expected: exact match.

- [ ] **Step 3: Run live non-mutating checks**

From production UI:

```text
Settings → Xero → Connect Xero
Settings → Xero → Preview contacts
Settings → Xero → Validate chart/tax
Settings → Xero → Preview invoice posting
Settings → Xero → Preview payments
```

Expected: connection and previews complete or return clear recovery messages. No Xero draft creation, SendGrid tenant email, payment apply, or provider dispatch is run without explicit operator approval.

- [ ] **Step 4: Record results**

Add only factual outcomes to `docs/next-chat-handover.md`:

```markdown
Live Xero rehearsal YYYY-MM-DD:
- OAuth connect: pass/fail + tenant name.
- Contact preview: pass/fail + fetched contact count.
- Chart/tax preview: pass/fail + blocker count.
- Invoice posting preview: pass/fail + ready/blocked count.
- Payment preview: pass/fail + ready/blocked count.
- Mutations run: none, unless separately approved in the moment.
```

- [ ] **Step 5: Commit if docs changed**

```bash
git add docs/next-chat-handover.md
git commit -m "Record Xero production rehearsal"
```

---

## Scope Notes

- Do not start bank-feed/Basiq before Monday unless Xero OAuth and provider previews are already proven in production.
- Do not build dark mode during this run.
- Do not refactor monolithic frontend pages except where directly required for Xero Monday readiness.
- Do not run real Xero draft creation, SendGrid invoice email, tenant email, Twilio SMS, or payment apply without explicit approval at that moment.

## Self-Review

- Spec coverage: covers runway checks, Xero diagnostics, operator feedback, focused Xero verification, and production rehearsal.
- Placeholder scan: no TBD/TODO/fill-in markers.
- Type consistency: route/schema/client names use `XeroConnectionDiagnostics*` consistently.
- Scope check: this is one implementation plan; broader bank-feed, DocuSign, dark mode, and large refactors are excluded.
