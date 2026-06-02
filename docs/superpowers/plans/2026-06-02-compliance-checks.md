# Compliance Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend recurring compliance-check register that can create current compliance obligations, complete them with evidence, and roll forward to the next due obligation.

**Architecture:** Introduce a `ComplianceCheck` model and `/api/v1/compliance/checks` API that reuses existing `Obligation`, `StoredDocument`, `AuditAction`, and entity-role guardrails. Smart Intake, comms, provider dispatch, Xero/Basiq, payment, and frontend flows remain unchanged in this slice.

**Tech Stack:** FastAPI, SQLAlchemy ORM, Alembic, Pydantic v2, pytest integration tests with in-memory SQLite.

---

### Task 1: Model And Migration

**Files:**
- Modify: `stewart/core/models.py`
- Create: `migrations/versions/20260602_0033_compliance_checks.py`
- Test: `tests/integration/test_compliance_api.py`

- [ ] **Step 1: Write the failing API test**

Create `tests/integration/test_compliance_api.py` with a test named `test_create_compliance_check_creates_current_obligation`. The test should create a property/unit/tenant/lease through existing API routes, call `POST /api/v1/compliance/checks`, and assert the response contains a `current_obligation_id` whose stored obligation has `category=compliance`, the requested due date, owner role, and metadata:

```json
{
  "source": "compliance_check",
  "kind": "fire_safety",
  "recurrence_interval": 1,
  "recurrence_unit": "years"
}
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_compliance_api.py -q
```

Expected: fail because the compliance route/model does not exist.

- [ ] **Step 3: Add model and migration**

Add model enums `ComplianceCheckKind`, `ComplianceCheckStatus`, and `ComplianceRecurrenceUnit`; add `ComplianceCheck` with entity/scope/evidence/current-obligation fields, recurrence, dates, metadata, timestamps, and soft delete. Add Alembic revision `20260602_0033_compliance_checks.py` creating matching enum-backed columns, JSON metadata, foreign keys, and active indexes.

### Task 2: API Create/List/Read/Update/Delete

**Files:**
- Create: `apps/api/schemas/compliance.py`
- Create: `apps/api/routers/compliance.py`
- Modify: `apps/api/main.py`
- Modify: `apps/api/routers/activity_feed.py`
- Test: `tests/integration/test_compliance_api.py`

- [ ] **Step 1: Implement minimal schemas and router**

Expose:

```txt
GET /api/v1/compliance/checks
POST /api/v1/compliance/checks
GET /api/v1/compliance/checks/{check_id}
PATCH /api/v1/compliance/checks/{check_id}
DELETE /api/v1/compliance/checks/{check_id}
```

Create and update must validate every linked property/unit/lease/tenant/document/obligation belongs to the requested entity. Create should create a current `Obligation` when no `current_obligation_id` is supplied. Delete soft-deletes the check only.

- [ ] **Step 2: Run create/list/read/delete tests**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_compliance_api.py -q
```

Expected after implementation: create/list/read/delete checks pass.

### Task 3: Complete And Roll Forward

**Files:**
- Modify: `apps/api/routers/compliance.py`
- Test: `tests/integration/test_compliance_api.py`

- [ ] **Step 1: Add failing completion test**

Add `test_complete_compliance_check_links_evidence_and_rolls_forward`. It should create a check, insert a `StoredDocument`, call `POST /api/v1/compliance/checks/{check_id}/complete`, and assert:

- the previous obligation is `completed`
- the evidence document id appears in previous-obligation metadata
- check history records the completion
- `next_due_date` advances by recurrence
- `current_obligation_id` points at a newly created future compliance obligation
- repeating the same completion request does not create another duplicate obligation

- [ ] **Step 2: Implement completion**

Completion must be provider-inert. It should update only the local check, current obligation, evidence metadata, and audit rows. Recurrence units: days, months, years.

- [ ] **Step 3: Run completion test**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_compliance_api.py -q
```

Expected: all compliance API tests pass.

### Task 4: Guardrails And Docs

**Files:**
- Modify: `tests/integration/test_compliance_api.py`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md`

- [ ] **Step 1: Add cross-entity/auth guard tests**

Add tests that reject evidence documents from another entity and requests by a user without entity access.

- [ ] **Step 2: Update docs**

Record that recurring compliance checks v1 is backend-only, creates/rolls obligations locally, and does not mutate providers or existing Smart Intake/comms behavior.

- [ ] **Step 3: Final verification**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_compliance_api.py -q
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_insights_api.py -q
.venv/bin/python -m ruff check stewart/core/models.py apps/api/routers/compliance.py apps/api/schemas/compliance.py tests/integration/test_compliance_api.py
git diff --check
```

Expected: all commands pass.
