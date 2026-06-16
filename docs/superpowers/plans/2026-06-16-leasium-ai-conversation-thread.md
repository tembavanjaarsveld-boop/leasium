# Leasium AI Conversation Thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Leasium AI as a first-class, org-scoped conversation thread that can be started from Cmd-K with page context and reused by intake/inbox conversation surfaces.

**Architecture:** Add `ConversationThread` and `ConversationTurn` as dedicated SQLAlchemy models and API resources. `review_data` remains the per-intake apply/review payload only; conversation transcript state moves to the new tables. The frontend creates or resumes a thread, appends turns as the operator asks/acts, and reads recent threads from the new list endpoint.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, pytest, Next.js App Router frontend, Playwright smoke tests.

**Status:** Approved by Temba on 2026-06-16 and implemented in Slice E. This note records the agreed first-class conversation-thread design and v1 cut line.

---

## Decision Record

Temba's decision for open decision #4 in `docs/leasium-ai-conversation-redesign-2026-06-15.md`: persist Leasium AI transcript state as first-class conversation records. Do not store ongoing turns in `DocumentIntake.review_data`. `review_data` stays scoped to intake review/apply payloads such as extracted values, review edits, matched record ids, and final `applied` summaries.

## Cut Line

Included in v1:
- Cmd-K can start a contextual Leasium AI thread from the current page.
- The thread stores route context and optional record refs.
- `/intake` can render/use a persisted thread for landing questions, selected document conversations, created turns, and next-step cards.
- `InboxConversationPanel` can persist forwarded-email, understanding, proposed action, and done turns.
- Home "Recent threads" reads the list endpoint and opens the selected thread in `/intake?thread_id=...`.

Deferred from v1:
- Full cross-page transcript overlay/drawer.
- Thread search.
- Thread renaming/editing beyond server-generated titles.
- Streaming responses.
- Multi-thread sidebar in every route.
- Provider execution from thread turns. Provider next steps remain links into gated flows only.

## Data Model

Create two models in `stewart/core/models.py`.

### ConversationThread

Table: `conversation_thread`

Fields:
- `id UUID primary key default uuid7`
- `organisation_id UUID not null foreign key organisation.id`
- `entity_id UUID nullable foreign key entity.id`
- `created_by_user_id UUID nullable foreign key app_user.id`
- `source Text not null default "cmdk"` - examples: `cmdk`, `intake`, `inbox`
- `context_route Text nullable` - page route at creation, for example `/properties`, `/tenants/tenant-1`, `/intake`
- `context_record_refs JsonbCompat not null default dict` - normalized optional ids, for example `{ "property_id": "...", "tenant_id": "...", "document_intake_id": "..." }`
- `title Text not null`
- `thread_metadata JsonbCompat not null default dict` - future-safe display metadata, not transcript state
- `created_at DateTime(timezone=True) not null default utcnow`
- `updated_at DateTime(timezone=True) not null default utcnow onupdate=utcnow`
- `deleted_at DateTime(timezone=True) nullable`

Relationships:
- `entity`
- `created_by_user`
- `turns` ordered by `ConversationTurn.created_at`, then `ConversationTurn.id`

Indexes:
- `conversation_thread_org_recent_idx` on `(organisation_id, updated_at)` where `deleted_at IS NULL`
- `conversation_thread_entity_recent_idx` on `(entity_id, updated_at)` where `deleted_at IS NULL`
- `conversation_thread_created_by_idx` on `created_by_user_id`

Scope rule:
- Explicit `entity_id` threads require `assert_entity_role(session, user, entity_id, READ_ROLES)` for reads and `WRITE_ROLES` for create/append.
- Org-wide threads have `entity_id = null`, `organisation_id = user.organisation_id`, and are readable/writable only by users who have at least one readable/writable entity in that organisation through `readable_entity_ids`.
- List recent threads is org-wide: return threads where `organisation_id == user.organisation_id`, `deleted_at IS NULL`, and either `entity_id IS NULL` or `entity_id IN readable_entity_ids(session, user, READ_ROLES)`.
- Get thread checks the same rule. If a thread has an entity outside readable ids, return 403.

### ConversationTurn

Table: `conversation_turn`

Fields:
- `id UUID primary key default uuid7`
- `thread_id UUID not null foreign key conversation_thread.id`
- `role ConversationTurnRole not null` - `user` or `ai`
- `kind ConversationTurnKind not null` - `text`, `understanding`, `plan`, `created`, `question`
- `payload JsonbCompat not null default dict`
- `created_at DateTime(timezone=True) not null default utcnow`

Enums:
- `ConversationTurnRole(enum.StrEnum)`: `user`, `ai`
- `ConversationTurnKind(enum.StrEnum)`: `text`, `understanding`, `plan`, `created`, `question`

Indexes:
- `conversation_turn_thread_created_idx` on `(thread_id, created_at, id)`

Payload conventions:
- `kind=text`: `{ "text": "...", "citations": [], "guardrails": [] }`
- `kind=understanding`: `{ "summary": "...", "confidence": 0.9, "source": { ... }, "rows": [...] }`
- `kind=plan`: `{ "actions": [...], "provider_gate": true }`
- `kind=created`: `{ "applied": { "property_id": "...", "tenant_id": "..." }, "links": [...] }`
- `kind=question`: `{ "prompt": "...", "suggestions": [...] }`

Provider guardrail:
- Turns may store text and links describing a gated next step.
- Turns must not execute Xero, SendGrid, Twilio, tenant email, payment, reconciliation, or provider dispatch.

## Migration

Create `migrations/versions/20260616_0045_conversation_threads.py`.

Migration shape:
- `down_revision = "20260614_0044"`
- Create Postgres enum types for `conversation_turn_role` and `conversation_turn_kind` when using PostgreSQL; use Alembic/SQLAlchemy enum handling consistent with existing model enum migrations.
- Create `conversation_thread` with FKs to `organisation`, `entity`, and `app_user`.
- Create `conversation_turn` with FK to `conversation_thread`.
- Use JSONB on PostgreSQL and JSON on SQLite, matching the `JsonbCompat` migration pattern from `20260612_0043_ai_mailbox_intake_foundation.py`.
- Add the indexes listed above, with `postgresql_where` and `sqlite_where` for soft-delete indexes.
- Downgrade drops turn table, thread table, indexes, and enum types.

## API Contract

Create:
- `apps/api/schemas/conversation_threads.py`
- `apps/api/routers/conversation_threads.py`
- Include the router in `apps/api/main.py` under `/api/v1`.

Roles:
- `READ_ROLES = owner/admin/finance/ops/viewer`
- `WRITE_ROLES = owner/admin/finance/ops`

Routes:
- `POST /conversation-threads`
  - Request:
    ```json
    {
      "entity_id": "uuid-or-null",
      "source": "cmdk",
      "context_route": "/properties",
      "context_record_refs": { "property_id": "..." },
      "title": "Add lease for Queen Street",
      "initial_turn": {
        "role": "user",
        "kind": "text",
        "payload": { "text": "Add the lease for these tenants" }
      }
    }
    ```
  - Response: `ConversationThreadRead` with `turns`.
  - Behaviour: create thread, optionally create the initial turn, commit once.

- `POST /conversation-threads/{thread_id}/turns`
  - Request:
    ```json
    {
      "role": "ai",
      "kind": "understanding",
      "payload": { "summary": "I found a retail lease...", "confidence": 0.9 }
    }
    ```
  - Response: `ConversationThreadRead` with all turns.
  - Behaviour: scope-check the thread, append one turn, update thread `updated_at`, commit.

- `GET /conversation-threads`
  - Query: optional `entity_id`, optional `limit` default 10 max 25.
  - Behaviour:
    - If `entity_id` is supplied, require read access and list that entity's threads plus org-wide threads if useful for the Home "Recent" view.
    - If no `entity_id`, use `readable_entity_ids` and return org-wide recent threads across readable entities.
  - Response: list of `ConversationThreadSummaryRead` with `turn_count`, `last_turn_at`, and a short `last_turn_preview`.

- `GET /conversation-threads/{thread_id}`
  - Response: `ConversationThreadRead` with ordered turns.
  - Behaviour: same readable-scope check.

Schemas:
- `ConversationTurnInput`
- `ConversationTurnRead`
- `ConversationThreadCreateRequest`
- `ConversationTurnCreateRequest`
- `ConversationThreadSummaryRead`
- `ConversationThreadRead`

Validation:
- `source` max 40 chars.
- `context_route` max 300 chars, must start with `/` when present.
- `title` max 120 chars; server fallback title is first 80 chars of initial user text, else "Leasium AI thread".
- `payload` accepts JSON object only.
- `context_record_refs` accepts JSON object only; server strips non-scalar values or rejects with 422. Prefer reject if shape is not a dict.

## Existing Flow Attachment

### askLeasium

Current endpoint: `POST /api/v1/ai/ask`.

Plan:
- Add optional `thread_id` and optional `context` to `AskRequest`.
- If `thread_id` is provided:
  - Scope-check the thread.
  - Append the user question as `ConversationTurn(role=user, kind=text)`.
  - Run the existing read-only `ask_leasium`.
  - Append the answer as `ConversationTurn(role=ai, kind=text)` with citations, warnings, guardrails, and `response_id`.
  - Keep existing audit behaviour.
- If no `thread_id`, keep the current behaviour exactly so older callers remain safe.
- Do not persist answer text in `AuditAction`; the conversation table is now the transcript store.

### applyDocumentIntake

Current endpoint: `POST /api/v1/document-intakes/{intake_id}/apply`.

Plan:
- Add optional `thread_id` to `DocumentIntakeApplyRequest`.
- Keep review/apply data in `DocumentIntake.review_data`.
- After successful apply and before commit, append an AI `created` turn to the supplied thread with:
  - `applied` summary from `review_data.applied`
  - display links for property/lease/tenant rows
  - provider next-step link metadata only, marked `provider_gate: true`
- Do not create provider jobs or dispatches.
- If `thread_id` is invalid or unreadable for the intake entity, return 403.

### IntakeConversationPanel

Plan:
- Accept optional `threadId` prop or internally create/load a thread when opening an intake.
- On first render for a selected intake, ensure a thread exists with:
  - `source=intake`
  - `entity_id`
  - `context_route=/intake`
  - `context_record_refs.document_intake_id=intake.id`
  - title from filename or summary
- Render existing deterministic understanding/plan cards as before, but also append equivalent `understanding`, `plan`, and `question` turns once per intake/thread.
- On "Create all records", pass `thread_id` to `applyDocumentIntake`.
- After apply, prefer the returned thread turns when available; otherwise keep the current local created card so the UI is resilient during the API transition.

### InboxConversationPanel

Plan:
- Ensure a thread exists with:
  - `source=inbox`
  - `entity_id`
  - `context_route=/inbox`
  - `context_record_refs.inbound_message_id` when present in panel props or promoted payload metadata
  - title from sender/subject/classification summary
- Persist forwarded-email and understanding/proposed-action/done turns.
- Promote actions stay local draft creation only and do not send email/SMS/Xero.

## Cmd-K V1 Scope

Current Cmd-K behaviour in `apps/web/src/components/app-shell.tsx` routes typed text to `/intake?ask=...`.

New v1:
- Cmd-K typed action still appears first.
- On select, route to `/intake?ask=...&context_route=...&context_record_refs=...`.
- `/intake` creates a `ConversationThread` with `source=cmdk`, selected/current entity, current route, and optional record refs, then calls `askLeasium` with the new `thread_id`.
- Record refs should be inferred conservatively from the current URL:
  - `/properties?property_id=...` -> `{ "property_id": "..." }`
  - `/tenants/[tenantId]` -> `{ "tenant_id": "..." }`
  - `/operations/maintenance/[workOrderId]` -> `{ "maintenance_work_order_id": "..." }`
  - `/intake?review=...` -> `{ "document_intake_id": "..." }`
- If no record id is obvious, store only `context_route`.

Cut line:
- Cmd-K v1 is a contextual launcher into `/intake`, not a global drawer.
- Recent thread summaries appear on `/intake` Home.
- Reopening a recent thread shows the transcript in `/intake`.
- Full cross-page history surfacing is a follow-up.

## Frontend API Additions

Modify `apps/web/src/lib/api.ts`:
- Add `ConversationTurnRole`, `ConversationTurnKind`, `ConversationTurnRecord`, `ConversationThreadSummaryRecord`, `ConversationThreadRecord`.
- Add:
  - `createConversationThread(payload)`
  - `appendConversationTurn(threadId, payload)`
  - `listConversationThreads(params?)`
  - `getConversationThread(threadId)`
- Extend `askLeasium(payload)` with optional `thread_id`.
- Extend `applyDocumentIntake(intakeId, payload)` with optional `threadId` serialized as `thread_id`.

## Frontend Surfaces

Modify:
- `apps/web/src/components/app-shell.tsx`
  - Include current route and conservative record refs when building the top "Ask Leasium AI" action.
  - Keep the modal shape and existing keyboard behaviour.
- `apps/web/src/components/dashboard.tsx`
  - `/intake` Home reads `listConversationThreads({ entity_id: selectedEntityId })`.
  - Replace placeholder/static Recent content with API-backed Recent threads.
  - Handle `thread_id` and `ask` query params.
- `apps/web/src/components/intake/IntakeConversationPanel.tsx`
  - Thread creation/loading and turn append integration.
  - Keep provider next-step rows as links only.
- `apps/web/src/components/intake/InboxConversationPanel.tsx`
  - Thread creation/loading and turn append integration.

No new top-level navigation item. The seven-hub cap remains intact.

## Backend Tests

Create `tests/integration/test_conversation_threads_api.py`.

Required tests:
- `test_create_thread_and_append_turns`
  - Create a thread with `entity_id`, route context, initial user turn.
  - Append AI `understanding` turn.
  - Assert ordered turns, org id, entity id, title, payloads.
- `test_thread_scope_rejects_unreadable_entity`
  - Seed hidden entity in same organisation without user role.
  - `POST /conversation-threads` with hidden `entity_id` returns 403.
  - `GET /conversation-threads/{id}` for a hidden thread returns 403.
- `test_org_wide_recent_threads_only_returns_readable_entities`
  - Seed accessible, readable peer, and hidden entity threads.
  - `GET /conversation-threads` returns accessible/readable and org-wide threads, not hidden.
- `test_ask_leasium_appends_turns_without_provider_mutation`
  - Mock `ask_leasium`.
  - Call `/api/v1/ai/ask` with `thread_id`.
  - Assert user and AI text turns are appended.
  - Assert no provider audit rows.
- `test_document_intake_apply_appends_created_turn_without_provider_mutation`
  - Use existing intake apply fixture pattern.
  - Pass `thread_id`.
  - Assert `review_data.applied` still exists on intake.
  - Assert thread has AI `created` turn.
  - Assert provider mutation audit guard stays empty.

Commands:
- `.venv/bin/python -m ruff check stewart/core/models.py apps/api/schemas/conversation_threads.py apps/api/routers/conversation_threads.py apps/api/routers/ai.py apps/api/routers/document_intakes.py tests/integration/test_conversation_threads_api.py`
- `.venv/bin/python -m pytest tests/integration/test_conversation_threads_api.py -q`
- `.venv/bin/python -m pytest tests/integration/test_ai_ask_api.py tests/integration/test_document_intake_api.py tests/integration/test_org_wide_scope_api.py -q`
- Full backend pass before commit: `.venv/bin/python -m pytest`

## Frontend Tests

Modify or add Playwright smoke coverage:
- `apps/web/tests/smoke/intake-conversation.spec.ts`
  - Mock conversation-thread create/list/get/append endpoints.
  - Assert selected intake creates/uses a thread.
  - Assert `applyDocumentIntake` receives `thread_id`.
  - Reuse `isForbiddenProviderRequest`; expected forbidden calls remain `[]`.
- `apps/web/tests/smoke/app-flows.spec.ts`
  - Cmd-K typed ask carries `context_route` and opens `/intake`.
  - `/intake` creates a thread and renders answer from persisted turns.
  - Home Recent threads reads list endpoint and opens `/intake?thread_id=...`.
  - 1440 and 390 screenshots after visible changes.
- `apps/web/tests/smoke/api-mocks.ts`
  - Add default handlers for conversation thread list/get/create/append.

Frontend commands:
- `NODE_ENV=development npm --prefix apps/web run test:smoke -- intake-conversation.spec.ts`
- `NODE_ENV=development npm --prefix apps/web run test:smoke -- app-flows.spec.ts --grep "Leasium AI|Command|Recent threads"`
- `npm --prefix apps/web run lint`
- `cd apps/web && npx tsc --noEmit --pretty false`
- `npm --prefix apps/web run build`

UX gate:
- Capture `/intake` screenshots at 1440 and 390 after Recent threads becomes API-backed.
- Apply the slop test: no overlapping text, no horizontal overflow, Recent threads does not crowd the AI review queue, mobile bottom nav stays clear.
- Add one dated line to `docs/design-governance.md` UX Pass Log.

## Documentation Updates

Update after implementation:
- `docs/product-roadmap.md`
  - Mark Slice E shipped only after backend/frontend verification passes.
- `docs/design-governance.md`
  - UX Pass Log line with 1440/390 screenshots.
  - Trim the Leasium AI remaining-polish debt entry if persistent thread is fully shipped.
- `docs/next-chat-handover.md`
  - Add latest continuation with commit hash, verification evidence, guardrails, and remaining follow-ups.
- Keep `docs/leasium-ai-conversation-redesign-2026-06-15.md` as the concept record. If changed, update open decision #4 to reference the accepted first-class thread decision.

## Implementation Tasks

### Task 1: Backend Schema Red Test

**Files:**
- Create: `tests/integration/test_conversation_threads_api.py`

- [ ] Write failing tests for create/get/list/append, unreadable entity 403, org-wide recent scope, ask append, and intake apply append.
- [ ] Run `.venv/bin/python -m pytest tests/integration/test_conversation_threads_api.py -q`.
- [ ] Expected: fails because `/api/v1/conversation-threads` does not exist and models are absent.

### Task 2: Models and Migration

**Files:**
- Modify: `stewart/core/models.py`
- Create: `migrations/versions/20260616_0045_conversation_threads.py`

- [ ] Add `ConversationTurnRole`, `ConversationTurnKind`, `ConversationThread`, and `ConversationTurn`.
- [ ] Add Alembic migration with tables, FKs, JSONB/JSON fields, enums, and indexes.
- [ ] Run `.venv/bin/alembic upgrade head`.
- [ ] Run `.venv/bin/python -m pytest tests/integration/test_migrations.py -q`.

### Task 3: Conversation API

**Files:**
- Create: `apps/api/schemas/conversation_threads.py`
- Create: `apps/api/routers/conversation_threads.py`
- Modify: `apps/api/main.py`

- [ ] Add Pydantic schemas and route handlers.
- [ ] Implement readable/writable scope helpers using `assert_entity_role` and `readable_entity_ids`.
- [ ] Run `.venv/bin/python -m pytest tests/integration/test_conversation_threads_api.py -q`.
- [ ] Expected: create/get/list/append and scope tests pass; ask/apply integration tests still fail until Tasks 4 and 5.

### Task 4: Attach Ask Leasium Turns

**Files:**
- Modify: `apps/api/schemas/ai.py`
- Modify: `apps/api/routers/ai.py`

- [ ] Add optional `thread_id` to `AskRequest`.
- [ ] Append user and AI text turns around the existing read-only `ask_leasium` call.
- [ ] Preserve 503 behaviour when OpenAI is unavailable.
- [ ] Run `.venv/bin/python -m pytest tests/integration/test_ai_ask_api.py tests/integration/test_conversation_threads_api.py -q`.

### Task 5: Attach Intake Apply Created Turn

**Files:**
- Modify: `apps/api/schemas/document_intake.py`
- Modify: `apps/api/routers/document_intakes.py`

- [ ] Add optional `thread_id` to `DocumentIntakeApplyRequest`.
- [ ] Append AI `created` turn after successful local apply.
- [ ] Keep provider next steps as metadata/links only.
- [ ] Run `.venv/bin/python -m pytest tests/integration/test_document_intake_api.py tests/integration/test_conversation_threads_api.py -q`.

### Task 6: Frontend API and Cmd-K Context

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/tests/smoke/api-mocks.ts`

- [ ] Add conversation thread types and client functions.
- [ ] Extend `askLeasium` and `applyDocumentIntake` payloads with optional thread ids.
- [ ] Add conservative route context to Cmd-K's ask action.
- [ ] Add smoke mocks for conversation-thread endpoints.

### Task 7: Intake and Inbox Thread Integration

**Files:**
- Modify: `apps/web/src/components/dashboard.tsx`
- Modify: `apps/web/src/components/intake/IntakeConversationPanel.tsx`
- Modify: `apps/web/src/components/intake/InboxConversationPanel.tsx`
- Modify: `apps/web/tests/smoke/intake-conversation.spec.ts`
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [ ] Add Recent threads list from `listConversationThreads`.
- [ ] Support `/intake?thread_id=...`.
- [ ] Persist selected intake and inbox conversation turns.
- [ ] Pass `thread_id` through ask/apply calls.
- [ ] Keep local fallback rendering for resilience.
- [ ] Reuse `isForbiddenProviderRequest` in touched smokes.

### Task 8: Verification, Docs, Commit

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`
- Optionally modify: `docs/leasium-ai-conversation-redesign-2026-06-15.md`

- [ ] Run backend ruff and targeted pytest.
- [ ] Run frontend eslint, tsc, targeted smokes, and `next build`.
- [ ] Capture 1440/390 screenshots and run the slop test.
- [ ] Update docs with verification evidence and remaining follow-ups.
- [ ] Stage only Slice E files.
- [ ] Commit with Gmail author identity and a file-by-file body.
- [ ] Push only after Temba explicitly says go; then verify Vercel READY.

## Self-Review

Spec coverage:
- First-class thread records: covered by Data Model, Migration, API Contract.
- `review_data` stays intake apply payload only: covered by Decision Record and Existing Flow Attachment.
- Org/entity scoping via `readable_entity_ids`: covered by Data Model and API Contract.
- Create/append/list/get endpoints: covered by API Contract and tests.
- Existing apply + ask attach turns: covered by Existing Flow Attachment and Tasks 4/5.
- Cmd-K v1 contextual launcher: covered by Cmd-K V1 Scope and Task 6.
- Full cross-page surfacing cut line: covered by Cut Line and Cmd-K V1 Scope.
- Guardrails and verification: covered by Backend Tests, Frontend Tests, UX gate, and Task 8.

Placeholder scan:
- No implementation placeholders are intentional. Deferred items are explicitly out of v1 scope.

Type consistency:
- Model names, schema names, endpoint paths, and enum values are consistent across the plan.
