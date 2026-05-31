# Owner Portal Secure Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first secure owner document-share slice to the owner portal without widening owner data access beyond explicitly approved property-level documents.

**Architecture:** Reuse `StoredDocument` and expose only documents whose `document_metadata.owner_portal_visible` flag is `true`, whose `property_id` is linked to the signed-in owner through `PropertyOwner`, and whose tenant/unit/lease/onboarding fields are empty. The portal response lists safe document metadata; binary downloads are bearer-account scoped through `/api/v1/owner-portal/account/documents/{document_id}/download`.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, pytest, Next.js App Router, React Query, Playwright smoke tests.

---

## Guardrails

- No owner email, SendGrid, Twilio, Xero, Basiq, payment reconciliation, invoice dispatch, PDF generation, or provider-history mutation.
- Do not infer owner visibility from property ownership alone. A document must be explicitly flagged with `owner_portal_visible: true`.
- Do not expose tenant, lease, tenancy-unit, tenant-onboarding, or invoice PDF documents in this first slice.
- Keep operator preview read-only. It may show document rows for review, but only owner account sessions get the download endpoint.
- Use agents for bounded review/reconnaissance where useful; verify every agent result locally.

## Files

- Modify: `apps/api/schemas/owner_portal.py` — add `OwnerPortalDocumentRead` and include `documents` on `OwnerPortalRead`.
- Modify: `apps/api/routers/owner_portal.py` — collect owner-visible documents and add account-scoped document download.
- Modify: `tests/integration/test_owner_portal_api.py` — red/green portal document-listing coverage.
- Modify: `tests/integration/test_owner_portal_auth_api.py` — red/green account download scoping coverage.
- Modify: `apps/web/src/lib/api.ts` — add owner document type and account document download helper.
- Modify: `apps/web/src/app/owner-portal/owner-portal-account-ui.tsx` — render owner documents and account-only download action.
- Modify: `apps/web/tests/smoke/owner-portal-account.spec.ts` and `apps/web/tests/smoke/owner-portal.spec.ts` — smoke the account document list/download boundary.
- Modify: `docs/product-roadmap.md`, `docs/design-governance.md`, and `docs/next-chat-handover.md` — record shipped/pending status and verification.

## Task 1: Backend Document Metadata List

- [x] **Step 1: Write the failing portal-list test**

Add a test in `tests/integration/test_owner_portal_api.py` that seeds four documents on/near the linked owner property:

```python
visible_doc = StoredDocument(
    entity_id=entity.id,
    property_id=linked_property.id,
    filename="owner-visible-report.pdf",
    content_type="application/pdf",
    byte_size=len(b"owner visible"),
    file_data=b"owner visible",
    category=DocumentCategory.other,
    notes="Quarterly property report",
    document_metadata={
        "source": "operator_upload",
        "owner_portal_visible": True,
    },
)
hidden_doc = StoredDocument(
    entity_id=entity.id,
    property_id=linked_property.id,
    filename="internal-only.pdf",
    byte_size=1,
    file_data=b"x",
    category=DocumentCategory.other,
    document_metadata={"source": "operator_upload"},
)
tenant_doc = StoredDocument(
    entity_id=entity.id,
    property_id=linked_property.id,
    tenant_id=tenant.id,
    filename="tenant-private.pdf",
    byte_size=1,
    file_data=b"x",
    category=DocumentCategory.other,
    document_metadata={"owner_portal_visible": True},
)
cross_property_doc = StoredDocument(
    entity_id=entity.id,
    property_id=unlinked_property.id,
    filename="other-owner.pdf",
    byte_size=1,
    file_data=b"x",
    category=DocumentCategory.other,
    document_metadata={"owner_portal_visible": True},
)
```

Assert `GET /api/v1/owner-portal/{owner_id}?month=2026-05` returns exactly one document row with filename, category, byte size, source, property name, and no raw `file_data`.

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/integration/test_owner_portal_api.py::test_owner_portal_lists_only_explicit_owner_visible_property_documents -q`

Expected: fail because `documents` is absent from `OwnerPortalRead`.

- [x] **Step 3: Add schema and document query**

Add `OwnerPortalDocumentRead` with `id`, `property_id`, `property_name`, `filename`, `content_type`, `byte_size`, `category`, `notes`, `source`, and `created_at`. In the router, query documents for linked property ids, then filter in Python so only `owner_portal_visible is True` and tenant/unit/lease/onboarding fields are empty.

- [x] **Step 4: Run focused backend test**

Run: `.venv/bin/python -m pytest tests/integration/test_owner_portal_api.py::test_owner_portal_lists_only_explicit_owner_visible_property_documents -q`

Expected: pass.

## Task 2: Account-Scoped Document Download

- [x] **Step 1: Write the failing account download test**

Add a test in `tests/integration/test_owner_portal_auth_api.py` that claims an owner account, seeds one visible property-level document plus one unflagged and one cross-property document, then calls:

```python
download_response = client.get(
    f"/api/v1/owner-portal/account/documents/{visible_doc.id}/download",
    headers={"Authorization": "Bearer owner-subject-one"},
)
```

Assert the visible document downloads with `application/pdf`, while the unflagged and cross-property document ids return `404`. Revoke the account and assert the visible document now returns `401`.

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/integration/test_owner_portal_auth_api.py::test_owner_portal_account_downloads_only_visible_linked_property_documents -q`

Expected: fail with `404` because the download route does not exist.

- [x] **Step 3: Add the download route**

Add `GET /api/v1/owner-portal/account/documents/{document_id}/download`. Resolve the bearer owner account using the existing `_owner_portal_identity`, `_active_owner_portal_account`, and `_owner_for_account` helpers. Reuse the same owner-visible document scope as the list endpoint and return a `Response` with `Content-Disposition: attachment`.

- [x] **Step 4: Run focused backend tests**

Run: `.venv/bin/python -m pytest tests/integration/test_owner_portal_api.py tests/integration/test_owner_portal_auth_api.py -q`

Run: `.venv/bin/python -m ruff check apps/api/routers/owner_portal.py apps/api/schemas/owner_portal.py tests/integration/test_owner_portal_api.py tests/integration/test_owner_portal_auth_api.py`

Expected: all pass cleanly.

## Task 3: Frontend Document Surface

- [x] **Step 1: Write failing smoke coverage**

Extend `apps/web/tests/smoke/owner-portal-account.spec.ts` so the mocked account portal includes one owner-visible document. Assert `/owner-portal?month=2026-05` renders `Shared documents`, shows the filename and property name, and clicking `Download owner-visible-report.pdf` hits `/api/v1/owner-portal/account/documents/document-owner-visible-1/download`. Extend `owner-portal.spec.ts` to prove operator preview shows the document row but no account download button.

- [x] **Step 2: Run smoke to verify it fails**

Run: `cd apps/web && ./node_modules/.bin/playwright test tests/smoke/owner-portal-account.spec.ts tests/smoke/owner-portal.spec.ts --workers=1`

Expected: fail because the UI does not render `documents` and the API type has no document field.

- [x] **Step 3: Add API type/helper and UI**

Add `OwnerPortalDocumentRecord` and `documents: OwnerPortalDocumentRecord[]` to `OwnerPortalRecord`. Add `downloadOwnerPortalAccountDocument(documentId)`. Render a new `Shared documents` panel in `OwnerPortalAccountView`, with account-mode download buttons and operator-preview review copy.

- [x] **Step 4: Run frontend verification**

Run: `cd apps/web && ./node_modules/.bin/eslint 'src/app/owner-portal/**/*.{ts,tsx}' src/lib/api.ts tests/smoke/owner-portal-account.spec.ts tests/smoke/owner-portal.spec.ts`

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit`

Run: `cd apps/web && ./node_modules/.bin/playwright test tests/smoke/owner-portal-account.spec.ts tests/smoke/owner-portal.spec.ts --workers=1`

Expected: all pass cleanly.

## Task 4: Docs, Review, Deploy

- [x] **Step 1: Agent review**

Dispatch one backend reviewer for owner document scoping and one frontend reviewer for account/download UX. Fix Critical and Important findings before commit.

Backend review found a least-privilege issue where full `StoredDocument` rows
could be loaded before owner-visible scope checks; fixed by moving scope into
SQL and fetching file bytes only after the scoped document is verified. Added
download-denial coverage for tenant, unit, lease, onboarding, invoice, unflagged,
cross-property, and revoked-account cases. Frontend review found raw enum/source
leaks and duplicate filename accessibility gaps; fixed with owner-safe auth
labels, API-provided `source_label`, and property-specific download aria labels.

- [x] **Step 2: Final verification**

Run focused backend tests, backend ruff, targeted frontend eslint, `tsc --noEmit`, owner portal smokes, and production-style `next build`.

- [x] **Step 3: Docs**

Update roadmap, design governance, and next-chat handover with the shipped secure document-share scope, guardrails, commit, deploy status, and any local migration caveats.

- [ ] **Step 4: Commit and deploy**

Commit directly on `main`, push, then verify Vercel production deployment and Render health.
