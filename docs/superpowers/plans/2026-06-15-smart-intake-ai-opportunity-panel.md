# Smart Intake AI Opportunity Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing Smart Intake document review panel into a review-first AI opportunity workspace: infer useful next steps from extracted document facts, ask one focused question at a time, store answers in local review metadata, and preview a local proposed output without creating invoices, Xero mutations, emails, SMS, payments, or reconciliations.

**Architecture:** Add a namespaced `review_data["ai_opportunity_session"]` contract to `DocumentIntake`; derive opportunities deterministically from existing `proposed_actions` and extracted facts; add one backend merge endpoint; add one frontend opportunity/chat panel inside `DocumentIntakeReviewPanel`; verify with backend integration tests, Playwright smoke, desktop/mobile screenshots, and the Leasium UX gate.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, pytest, Next.js App Router, React, TypeScript, TanStack Query, Tailwind-style utility classes, Playwright smoke tests.

---

## File Map

Backend:
- Modify: `apps/api/schemas/document_intake.py`
- Modify: `apps/api/routers/document_intakes.py`
- Modify: `tests/integration/test_document_intake_api.py`

Frontend:
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/dashboard.tsx`
- Modify: `apps/web/tests/smoke/api-mocks.ts`
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

Documentation and UX gate:
- Modify: `docs/design-governance.md`
- Modify: `docs/leasium-codex-design-source-of-truth.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md`

Current-tree care:
- Preserve the existing unmatched-notice Smart Intake changes already present in `apps/web/src/components/dashboard.tsx`, `apps/web/tests/smoke/api-mocks.ts`, `apps/web/tests/smoke/app-flows.spec.ts`, `docs/design-governance.md`, and `docs/next-chat-handover.md`.
- Do not touch unrelated untracked files outside this plan.

## Task 1: Backend Opportunity Session Contract

**Files:**
- Modify: `apps/api/schemas/document_intake.py`
- Modify: `apps/api/routers/document_intakes.py`
- Modify: `tests/integration/test_document_intake_api.py`

- [x] **Step 1: Add failing backend tests**

Add these tests near the existing Smart Intake tests in `tests/integration/test_document_intake_api.py`:

1. `test_document_intake_ai_opportunity_session_stores_review_only_metadata`
   - Upload and extract `_fake_invoice_extraction()`.
   - POST `/api/v1/document-intakes/{intake_id}/ai-opportunity-session` with:

```python
{
    "review_data": _fake_invoice_extraction(),
    "selected_opportunity_id": "action-1",
    "answers": [
        {
            "question_id": "billing-scope",
            "question": "Which property or lease should this billing setup use?",
            "answer": "Use Scope Plaza, Suite 8 lease.",
            "structured_facts": {"property_name": "Scope Plaza", "unit_label": "Suite 8"},
        }
    ],
    "proposed_output": {
        "kind": "billing_review",
        "title": "Review billing setup",
        "summary": "Prepare a local billing review from the uploaded invoice.",
        "rows": [
            {"label": "Amount", "value": "AUD 2,750.50", "source": "Amount due"}
        ],
        "guardrail": "No invoice is approved, posted, emailed, or synced to Xero.",
    },
    "status": "open",
}
```

Assert:
- response status is `200`
- `body["status"]` remains `ready_for_review` or `needs_attention`
- `body["review_data"]["ai_opportunity_session"]["selected_opportunity_id"] == "action-1"`
- `applied_at` is `None`
- counts for `Obligation`, `BillingDraft`, and `MaintenanceWorkOrder` do not increase
- no audit row reports a provider send, sync, payment update, or reconciliation

2. `test_document_intake_ai_opportunity_session_preserves_existing_review_data`
   - Review an intake first through `/review` with `_fake_invoice_extraction()`.
   - POST the session endpoint with one answer.
   - Assert top-level reviewed fields such as `document_type`, `summary`, and `money_amounts` remain intact.
   - Assert only `ai_opportunity_session` is added or replaced.

3. `test_document_intake_ai_opportunity_session_rejects_unready_or_applied_intake`
   - Create an intake with `extract=false`; POST the session endpoint and assert `409`.
   - Apply a ready intake through the existing `/apply` path; POST the session endpoint and assert `409`.

4. `test_document_intake_ai_opportunity_session_flags_provider_candidates_without_writes`
   - Use review data with `proposed_actions` containing:

```python
[
    {
        "action": "match_xero_contact",
        "target": "xero_contact",
        "summary": "Map the extracted creditor to a Xero contact.",
        "confidence": 0.91,
    },
    {
        "action": "send_tenant_email",
        "target": "tenant_email",
        "summary": "Prepare a tenant notice email from this document.",
        "confidence": 0.64,
    },
]
```

Assert the stored opportunities include `provider_mutations` for `xero` and `tenant_email`, `requires_explicit_operator_approval` is true for those rows, and no provider mutation records are created.

Run:

`.venv/bin/python -m pytest tests/integration/test_document_intake_api.py -q -k "ai_opportunity_session"`

Expected before implementation: the tests fail because the endpoint and schemas do not exist.

- [x] **Step 2: Add schemas**

In `apps/api/schemas/document_intake.py`:
- Change imports to include `Literal`.
- Add `Field` from `pydantic`.
- Add these request models after `DocumentIntakeReviewRequest`:

```python
AiOpportunityDecision = Literal["pending", "answered", "accepted_for_review", "ignored"]


class DocumentIntakeAiOpportunityAnswerRequest(ApiModel):
    question_id: str
    question: str
    answer: str
    structured_facts: dict[str, Any] = Field(default_factory=dict)


class DocumentIntakeAiOpportunityDecisionRequest(ApiModel):
    opportunity_id: str
    decision: AiOpportunityDecision = "pending"
    title: str | None = None
    summary: str | None = None
    notes: str | None = None


class DocumentIntakeAiOpportunityOutputRowRequest(ApiModel):
    label: str
    value: str
    source: str | None = None


class DocumentIntakeAiOpportunityOutputRequest(ApiModel):
    kind: str
    title: str
    summary: str
    rows: list[DocumentIntakeAiOpportunityOutputRowRequest] = Field(default_factory=list)
    guardrail: str


class DocumentIntakeAiOpportunitySessionRequest(ApiModel):
    review_data: dict[str, Any] | None = None
    selected_opportunity_id: str | None = None
    answers: list[DocumentIntakeAiOpportunityAnswerRequest] = Field(default_factory=list)
    proposed_output: DocumentIntakeAiOpportunityOutputRequest | None = None
    decisions: list[DocumentIntakeAiOpportunityDecisionRequest] = Field(default_factory=list)
    status: Literal["open", "reviewed"] = "open"
    notes: str | None = Field(default=None, max_length=2000)
```

- [x] **Step 3: Add deterministic opportunity helpers**

In `apps/api/routers/document_intakes.py`:
- Import `DocumentIntakeAiOpportunitySessionRequest`.
- Add `AI_OPPORTUNITY_SESSION_KEY = "ai_opportunity_session"` near router constants.
- Add these helpers near `_reviewed_data()`:

```python
def _ai_opportunity_title(action: str | None, target: str | None) -> str:
    text = (action or target or "review_document").replace("_", " ").strip()
    return text[:1].upper() + text[1:] if text else "Review document"


def _provider_mutations_for_opportunity(
    action: str | None,
    target: str | None,
    summary: str | None,
) -> list[str]:
    haystack = f"{action or ''} {target or ''} {summary or ''}".lower()
    providers: list[str] = []
    if "xero" in haystack:
        providers.append("xero")
    if "sendgrid" in haystack:
        providers.append("sendgrid")
    if "twilio" in haystack or "sms" in haystack:
        providers.append("twilio")
    if "tenant_email" in haystack or "tenant email" in haystack or "send email" in haystack:
        providers.append("tenant_email")
    if "payment" in haystack or "reconciliation" in haystack:
        providers.append("payment_reconciliation")
    return providers


def _build_ai_opportunities(
    intake: DocumentIntake,
    reviewed: dict[str, Any],
) -> list[dict[str, Any]]:
    rows = _records(reviewed.get("proposed_actions"))
    opportunities: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        action = _str(row.get("action"))
        target = _str(row.get("target"))
        summary = _str(row.get("summary")) or "Review this document-backed opportunity."
        providers = _provider_mutations_for_opportunity(action, target, summary)
        opportunities.append(
            {
                "id": f"action-{index + 1}",
                "kind": action or "review_document",
                "title": _ai_opportunity_title(action, target),
                "summary": summary,
                "confidence": _confidence(row.get("confidence")),
                "source_path": f"proposed_actions.{index}",
                "source_hint": _str(row.get("source_hint")) or _str(row.get("summary")),
                "target_kind": target,
                "provider_mutations": providers,
                "requires_explicit_operator_approval": bool(providers),
                "decision": "pending",
                "notes": None,
            }
        )
    if opportunities:
        return opportunities

    document_type = _str(reviewed.get("document_type")) or intake.document_type
    first_money = _first_money_record(reviewed)
    if first_money is not None:
        opportunities.append(
            {
                "id": "action-1",
                "kind": "set_up_billing_pattern",
                "title": "Set up billing pattern",
                "summary": "Use the source-backed amount and date to prepare local billing review questions.",
                "confidence": _confidence(first_money.get("confidence")) or intake.confidence,
                "source_path": "money_amounts.0",
                "source_hint": _str(first_money.get("source_hint")),
                "target_kind": "billing",
                "provider_mutations": [],
                "requires_explicit_operator_approval": False,
                "decision": "pending",
                "notes": None,
            }
        )
    if document_type == "notice" or _records(reviewed.get("key_dates")):
        opportunities.append(
            {
                "id": f"action-{len(opportunities) + 1}",
                "kind": "create_follow_up_task",
                "title": "Create follow-up task",
                "summary": "Turn the document date or notice wording into a local review task.",
                "confidence": intake.confidence,
                "source_path": "key_dates.0",
                "source_hint": None,
                "target_kind": "task",
                "provider_mutations": [],
                "requires_explicit_operator_approval": False,
                "decision": "pending",
                "notes": None,
            }
        )
    return opportunities
```

- Add `_merge_ai_opportunity_decisions()` that overlays matching `opportunity_id` decisions onto the opportunity dictionaries.
- Add `_ai_opportunity_guardrails()` returning these strings:
  - `No invoice is approved, posted, emailed, or synced to Xero from this panel.`
  - `No Xero contacts are created, updated, or deleted from this panel.`
  - `No email, SMS, payment, or reconciliation action is sent from this panel.`
- Add `_ai_opportunity_output_dict()` to convert a `DocumentIntakeAiOpportunityOutputRequest | None` to a plain dictionary with `kind`, `title`, `summary`, `rows`, and `guardrail`.

- [x] **Step 4: Add the merge endpoint**

In `apps/api/routers/document_intakes.py`, place this endpoint between `/review` and `/apply`:

```python
@router.post("/{intake_id}/ai-opportunity-session", response_model=DocumentIntakeRead)
def update_document_intake_ai_opportunity_session(
    intake_id: UUID,
    payload: DocumentIntakeAiOpportunitySessionRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> DocumentIntakeRead:
    intake = _get_intake(intake_id, user, session, WRITE_ROLES)
    if intake.status == DocumentIntakeStatus.applied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Applied document intakes cannot store AI opportunity sessions.",
        )
    if intake.status not in {
        DocumentIntakeStatus.ready_for_review,
        DocumentIntakeStatus.needs_attention,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document intake is not ready for AI opportunity review.",
        )

    reviewed = _reviewed_data(intake, payload.review_data)
    opportunities = _merge_ai_opportunity_decisions(
        _build_ai_opportunities(intake, reviewed),
        payload.decisions,
    )
    now = utcnow()
    existing_review = dict(_dict(intake.review_data))
    existing_review[AI_OPPORTUNITY_SESSION_KEY] = {
        "version": 1,
        "status": payload.status,
        "selected_opportunity_id": payload.selected_opportunity_id,
        "opportunities": opportunities,
        "answers": [answer.model_dump(mode="json") for answer in payload.answers],
        "proposed_output": _ai_opportunity_output_dict(payload.proposed_output),
        "guardrails": _ai_opportunity_guardrails(),
        "notes": payload.notes,
        "updated_at": now.isoformat(),
        "updated_by_user_id": str(user.id),
    }
    intake.review_data = existing_review
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=intake.entity_id,
        action="review",
        target_table="document_intake",
        target_id=intake.id,
        tool_name="smart_intake_ai_opportunity_session",
        tool_input={"document_intake_id": str(intake.id)},
        tool_output_summary=(
            "Stored Smart Intake AI opportunity session; no provider mutation ran."
        ),
    )
    session.commit()
    session.refresh(intake)
    return _read_intake(intake)
```

- [x] **Step 5: Run backend verification**

Run:

`.venv/bin/python -m pytest tests/integration/test_document_intake_api.py -q -k "ai_opportunity_session or document_intake_apply_invoice_prepares_billing_work"`

Expected after implementation: selected tests pass.

Commit:

`git add apps/api/schemas/document_intake.py apps/api/routers/document_intakes.py tests/integration/test_document_intake_api.py && git commit -m "Add Smart Intake AI opportunity session"`

## Task 2: Frontend API Types and Opportunity Panel

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/dashboard.tsx`

- [x] **Step 1: Add TypeScript API contract**

In `apps/web/src/lib/api.ts`, add these types near `DocumentIntakeExtraction`:

```ts
export type DocumentIntakeOpportunityDecision =
  | "pending"
  | "answered"
  | "accepted_for_review"
  | "ignored";

export type DocumentIntakeOpportunityRecord = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  confidence?: number | null;
  source_path: string;
  source_hint?: string | null;
  target_kind?: string | null;
  provider_mutations?: string[];
  requires_explicit_operator_approval?: boolean;
  decision?: DocumentIntakeOpportunityDecision;
  notes?: string | null;
};

export type DocumentIntakeOpportunityAnswerInput = {
  question_id: string;
  question: string;
  answer: string;
  structured_facts?: Record<string, unknown>;
};

export type DocumentIntakeOpportunityOutputRecord = {
  kind: string;
  title: string;
  summary: string;
  rows: Array<{ label: string; value: string; source?: string | null }>;
  guardrail: string;
};

export type DocumentIntakeOpportunitySessionRecord = {
  version: number;
  status: "open" | "reviewed";
  selected_opportunity_id?: string | null;
  opportunities: DocumentIntakeOpportunityRecord[];
  answers: DocumentIntakeOpportunityAnswerInput[];
  proposed_output?: DocumentIntakeOpportunityOutputRecord | null;
  guardrails: string[];
  notes?: string | null;
  updated_at?: string | null;
  updated_by_user_id?: string | null;
};
```

Change `DocumentIntakeExtraction.proposed_actions` from `Array<Record<string, unknown>> | null` to `DocumentIntakeOpportunityRecord[] | null`.

Add:

```ts
export function updateDocumentIntakeAiOpportunitySession(
  intakeId: string,
  payload: {
    reviewData?: DocumentIntakeExtraction | null;
    selectedOpportunityId?: string | null;
    answers?: DocumentIntakeOpportunityAnswerInput[];
    proposedOutput?: DocumentIntakeOpportunityOutputRecord | null;
    decisions?: Array<{
      opportunity_id: string;
      decision?: DocumentIntakeOpportunityDecision;
      title?: string | null;
      summary?: string | null;
      notes?: string | null;
    }>;
    status?: "open" | "reviewed";
    notes?: string | null;
  },
) {
  return request<DocumentIntakeRecord>(
    `/document-intakes/${intakeId}/ai-opportunity-session`,
    {
      method: "POST",
      body: JSON.stringify({
        review_data: payload.reviewData ?? undefined,
        selected_opportunity_id: payload.selectedOpportunityId ?? undefined,
        answers: payload.answers ?? [],
        proposed_output: payload.proposedOutput ?? undefined,
        decisions: payload.decisions ?? [],
        status: payload.status ?? "open",
        notes: payload.notes ?? undefined,
      }),
    },
  );
}
```

- [x] **Step 2: Add panel helpers**

In `apps/web/src/components/dashboard.tsx`:
- Add `updateDocumentIntakeAiOpportunitySession` and the new opportunity types to the API import.
- Add helpers before `DocumentIntakeReviewPanel`:
  - `documentIntakeOpportunitySession(intake: DocumentIntakeRecord)`
  - `documentIntakeOpportunityCards(draft: DocumentIntakeExtraction, intake: DocumentIntakeRecord)`
  - `defaultOpportunityQuestion(opportunity: DocumentIntakeOpportunityRecord)`
  - `proposedOutputForOpportunity(opportunity, answer, draft)`
  - `opportunityCardTone(confidence)`

Required deterministic question rules:
- `set_up_billing_pattern` and `prepare_billing_review`: ask `Which property, unit, tenant, or lease should this billing setup use?`
- `match_xero_contact`: ask `Should this contact map to a tenant, owner, vendor, or invoice issuer?`
- `create_follow_up_task`: ask `Who should own this follow-up and what due date should we use?`
- `store_historical_evidence`: ask `Which record should this source document be linked to?`
- fallback: ask `What should Leasium use this document for next?`

Required proposed output guardrails:
- Billing: `No invoice is approved, posted, emailed, or synced to Xero.`
- Xero contact mapping: `No Xero contacts are created, updated, or deleted.`
- Evidence: `No provider, payment, lease, tenant, or billing state is changed beyond the reviewed local link.`
- Follow-up task: `No email, SMS, provider dispatch, payment, or reconciliation action is sent.`

- [x] **Step 3: Add `DocumentIntakeOpportunityPanel`**

Add a component before `DocumentIntakeReviewPanel` with props:

```ts
{
  intake: DocumentIntakeRecord;
  draft: DocumentIntakeExtraction;
  reviewedDraft: DocumentIntakeExtraction;
  disabled: boolean;
  selectedEntityId: string;
  onNotice: (message: string | null) => void;
  onError: (message: string | null) => void;
}
```

Component behavior:
- Show nothing if no opportunities are available.
- Render peer panels inside one `data-testid="document-intake-opportunity-panel"` wrapper:
  - `data-testid="document-intake-opportunity-cards"` for compact opportunity buttons.
  - `data-testid="document-intake-opportunity-chat"` for the selected question and answer field.
  - `data-testid="document-intake-opportunity-output"` for the review-only proposed output card.
- Select the stored `selected_opportunity_id` when present; otherwise select the first card.
- Use one local answer input.
- On submit, append an answer to the session, build a deterministic proposed output preview, call `updateDocumentIntakeAiOpportunitySession`, invalidate `["dashboard-document-intakes", selectedEntityId]`, and show `AI opportunity session saved.`
- Do not call `reviewDocumentIntake`, `applyDocumentIntake`, `acceptDocumentIntakeLeaseMatch`, Xero, email, SMS, payment, or reconciliation APIs.
- Label the save button `Save answer`.
- Disable all controls when `disabled` is true or the mutation is pending.

- [x] **Step 4: Mount the panel in the review flow**

Inside `DocumentIntakeReviewPanel`, after the source/fields split and before the editable summary, render:

```tsx
<DocumentIntakeOpportunityPanel
  intake={intake}
  draft={draft}
  reviewedDraft={reviewedDraft}
  disabled={demo || saving || applying || clearing}
  selectedEntityId={intake.entity_id}
  onNotice={() => undefined}
  onError={() => undefined}
/>
```

Then update `DocumentIntakeReviewPanel` props and its call site so the real dashboard passes `setIntakeNotice` and `setIntakeError` through:

```tsx
onOpportunityNotice={setIntakeNotice}
onOpportunityError={setIntakeError}
```

Use those props instead of the no-op callbacks in the final mounted panel.

- [x] **Step 5: Run frontend type and lint checks**

Run:

`npm --prefix apps/web run lint -- src/lib/api.ts src/components/dashboard.tsx`

Run:

`cd apps/web && npx tsc --noEmit --pretty false`

Expected after implementation: both commands exit `0`.

Commit:

`git add apps/web/src/lib/api.ts apps/web/src/components/dashboard.tsx && git commit -m "Add Smart Intake opportunity panel"`

## Task 3: Smoke Fixtures and Browser Coverage

**Files:**
- Modify: `apps/web/tests/smoke/api-mocks.ts`
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Extend smoke mock data**

In `apps/web/tests/smoke/api-mocks.ts`:
- Add a `proposed_actions` array to the unmatched notice fixture created when `includeUnmatchedNoticeIntake` is true:

```ts
proposed_actions: [
  {
    id: "action-1",
    kind: "create_follow_up_task",
    action: "create_follow_up_task",
    target: "task",
    title: "Create follow-up task",
    summary: "Create a local review task for the overdue final notice.",
    confidence: 0.86,
    source_path: "key_dates.0",
    source_hint: "Due date",
  },
  {
    id: "action-2",
    kind: "set_up_billing_pattern",
    action: "set_up_billing_pattern",
    target: "billing",
    title: "Set up billing pattern",
    summary:
      "Use the amount and due date as clues, then ask for property, lease, recurrence, and GST context before any local billing draft.",
    confidence: 0.72,
    source_path: "money_amounts.0",
    source_hint: "Amount due",
  },
]
```

- Add a mock handler for `POST /document-intakes/{id}/ai-opportunity-session` before the `/apply` handler:
  - find the intake
  - merge `ai_opportunity_session` into `intake.review_data`
  - set `updated_at`
  - do not change top-level `reviewed_at` or `reviewed_by_user_id` for an open AI question session
  - return the intake
  - do not change `status`, `applied_at`, work orders, obligations, billing drafts, provider receipts, or Xero fixture data

- [x] **Step 2: Add desktop smoke**

In `apps/web/tests/smoke/app-flows.spec.ts`, add:

`test("smart intake shows AI opportunity cards and saves one answer without provider mutations", async ({ page }) => { /* implement the flow below */ })`

Test flow:
- `await mockLeasiumApi(page, { includeUnmatchedNoticeIntake: true });`
- Track forbidden requests matching:
  - `/document-intakes/{id}/apply`
  - `/document-intakes/{id}/review`
  - `/document-intakes/{id}/accept-lease-match`
  - `/xero`
  - `/sendgrid`
  - `/twilio`
  - `/payment`
  - `/reconciliation`
- Open `/intake?entity_id=entity-1&review=intake-unmatched-notice-1` at `1440x900`.
- Assert the opportunity panel, `Set up billing pattern`, current question, answer textbox, `Save answer`, and `Review-only proposed output` are visible.
- Fill the answer textbox with `Use Scope Plaza, Suite 8. Monthly outgoings, GST review needed.`
- Click `Save answer`.
- Assert `AI opportunity session saved.` appears.
- Assert the proposed output guardrail includes `No invoice is approved, posted, emailed, or synced to Xero.`
- Assert forbidden requests array is empty.
- Assert no horizontal overflow.
- Save screenshot `../../output/playwright/smart-intake-ai-opportunity-panel-1440.png`.

- [x] **Step 3: Add mobile smoke**

Add:

`test("mobile Smart Intake AI opportunity panel keeps one-question flow touch-safe", async ({ page }) => { /* implement the flow below */ })`

Test flow:
- Use the same fixture and route at `390x844`.
- Assert the opportunity panel appears before long extracted-field editing sections by comparing bounding boxes for `document-intake-opportunity-panel` and the first visible reviewed group.
- Check the opportunity button and `Save answer` button have height at least `44`.
- Assert sticky review actions still sit above the mobile primary nav.
- Assert no horizontal overflow.
- Save screenshots:
  - `../../output/playwright/smart-intake-ai-opportunity-panel-390.png`
  - `../../output/playwright/smart-intake-ai-opportunity-panel-390-question.png`

- [x] **Step 4: Add 503 smoke**

Add a mock option `documentIntakeOpportunitySessionUnavailable?: boolean`.

When true, the session endpoint returns `503` with:

```ts
{ detail: "AI opportunity session is unavailable." }
```

Add:

`test("smart intake AI opportunity save failure keeps review output local", async ({ page }) => { /* implement the flow below */ })`

Assert error copy appears, no provider or apply requests fire, and the sticky `Apply reviewed items` action remains disabled only by the existing workflow blockers.

- [x] **Step 5: Run smoke verification**

Run:

`NODE_ENV=development npm --prefix apps/web run test:smoke -- app-flows.spec.ts -g "AI opportunity|unmatched notices" --workers=1`

Expected after implementation: all targeted smoke tests pass and screenshots are written.

Commit:

`git add apps/web/tests/smoke/api-mocks.ts apps/web/tests/smoke/app-flows.spec.ts output/playwright/smart-intake-ai-opportunity-panel-1440.png output/playwright/smart-intake-ai-opportunity-panel-390.png output/playwright/smart-intake-ai-opportunity-panel-390-question.png && git commit -m "Cover Smart Intake opportunity panel smoke"`

## Task 4: UX Gate and Documentation

**Files:**
- Modify: `docs/design-governance.md`
- Modify: `docs/leasium-codex-design-source-of-truth.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Confirm Figma source**

Use Figma MCP screenshots for:
- Smart Intake desktop `55:166`
- Document review `58:352`
- Smart Intake mobile `59:521`

Confirm the implemented opportunity panel keeps the existing Horizon review shape:
- opportunity cards are peer review panels
- selected opportunity and current question appear before long field editing on mobile
- proposed output remains visible after an answer
- no provider-looking action is introduced inside the opportunity panel

- [x] **Step 2: Update design source of truth**

In `docs/leasium-codex-design-source-of-truth.md`, update `## 13. Smart Intake UX` with durable rules:
- Smart Intake review can show an AI opportunity panel inside the existing document review surface.
- Opportunity cards are inferred from source-backed extraction and remain peer panels.
- Questions are one-at-a-time and chat-like; structured controls are used for precise record choices.
- Proposed outputs are preview cards only until an existing review/apply action is explicitly approved.
- Guardrail copy must state the exact local-only and no-provider-write behavior.
- Mobile orders opportunity, question, and proposed output before long extracted-field editing.

- [x] **Step 3: Update design governance**

In `docs/design-governance.md`, add the UX pass log line:

```md
- 2026-06-15 · Smart Intake AI opportunity panel · Figma Smart Intake `55:166`, Document review `58:352`, and Smart Intake mobile `59:521` checked with Figma MCP · screens checked at 1440/390 (`output/playwright/smart-intake-ai-opportunity-panel-1440.png`, `smart-intake-ai-opportunity-panel-390.png`, `smart-intake-ai-opportunity-panel-390-question.png`) · fixes: opportunity cards sit as peer review panels, selected opportunity/current question stay visible, proposed output remains visible, guardrail copy states local-only/no Xero invoice/email/payment/reconciliation side effects, mobile orders opportunity/question before long extracted-field editing, and smoke coverage proves no horizontal overflow or sub-44px actions · deferred: none.
```

- [x] **Step 4: Update roadmap and handover**

In `docs/product-roadmap.md`, add a Built entry describing the shipped Smart Intake AI opportunity panel and its review-first provider guardrails.

In `docs/next-chat-handover.md`, add a top continuation with:
- scope shipped
- endpoint added
- frontend panel behavior
- verification commands
- screenshot paths
- explicit note that no provider writes are triggered

- [ ] **Step 5: Final verification**

Run:

`.venv/bin/python -m pytest tests/integration/test_document_intake_api.py -q -k "ai_opportunity_session or document_intake_apply_invoice_prepares_billing_work"`

Run:

`npm --prefix apps/web run lint -- src/lib/api.ts src/components/dashboard.tsx tests/smoke/api-mocks.ts tests/smoke/app-flows.spec.ts`

Run:

`cd apps/web && npx tsc --noEmit --pretty false`

Run:

`NODE_ENV=development npm --prefix apps/web run test:smoke -- app-flows.spec.ts -g "AI opportunity|unmatched notices" --workers=1`

Run:

`npm --prefix apps/web run build`

Run:

`git diff --check`

Expected final state: all commands exit `0`; screenshots exist; docs record the UX pass; provider guardrails remain intact.

Commit:

`git add docs/design-governance.md docs/leasium-codex-design-source-of-truth.md docs/product-roadmap.md docs/next-chat-handover.md && git commit -m "Document Smart Intake opportunity panel"`
