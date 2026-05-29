# Tenant Lifecycle Two-Day Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tenant-uploaded leases, tenant-uploaded insurance, and DocuSign lease signing materially usable within two days while keeping every mutation review-first or explicitly operator-approved.

**Architecture:** Reuse the existing tenant portal upload, Smart Intake, onboarding lease-pack, and lease-agreement metadata paths. Tenant uploads are promoted into Smart Intake automatically, reviewed insurance applies update tenant metadata and renewal obligations, and DocuSign is wired through the existing operator-approved Send lease pack action with provider completion and signed-PDF retention.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, pytest, Next.js App Router, React Query, existing `StoredDocument` / `DocumentIntake` / `TenantOnboarding.delivery_data` metadata, DocuSign eSignature REST API.

---

## File Structure

- Modify `apps/api/routers/tenant_portal.py`: promote tenant-uploaded lease/insurance documents into Smart Intake and block local Leasium signing when a DocuSign envelope is active.
- Modify `apps/api/routers/document_intakes.py`: when reviewed tenant-scoped insurance is applied, update tenant insurance metadata/history in addition to creating the renewal obligation.
- Modify `apps/api/routers/tenant_onboarding.py`: require an attached lease document before Send lease pack, call DocuSign from that explicit action, persist a reviewable DocuSign receipt, accept DocuSign completion webhooks, and retain the completed signed PDF.
- Modify `apps/api/tenant_lease_agreement.py`: expose DocuSign signing status/envelope metadata in lease agreement reads.
- Modify `apps/api/schemas/tenant_portal.py`: include optional signing provider/status fields in tenant portal lease agreement payloads.
- Test `tests/integration/test_tenant_portal_api.py`: tenant uploads, Smart Intake promotion, and pending DocuSign local-sign block.
- Test `tests/integration/test_document_intake_api.py`: reviewed insurance apply updates scoped tenant metadata.
- Test `tests/integration/test_tenant_onboarding_api.py`: lease document requirement and DocuSign receipt persistence.
- Test `tests/unit/test_docusign.py`: mocked JWT grant, envelope create, and completed document download.
- Test `tests/integration/test_system_api.py`: DocuSign readiness appears in system integration status.
- Next backend slice: modify `stewart/integrations/docusign.py` to replace the scaffold with JWT grant + envelope create.
- Next frontend slice: modify `apps/web/src/app/tenants/[tenantId]/page.tsx` and `apps/web/src/lib/api.ts` to show lifecycle review status.

## Task 1: Tenant Uploads Enter Review Queue

- [x] **Step 1: Write failing tenant lease upload promotion test**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_upload_promotes_document_to_smart_intake -q
```

Expected before implementation: fails because no `DocumentIntake` is created for the uploaded lease document.

- [x] **Step 2: Implement tenant upload promotion**

In `upload_tenant_portal_document`, after storing a supported `lease` or `insurance` upload, create a `DocumentIntake` with `status=uploaded`, empty extraction data, review metadata naming the tenant/onboarding/lease scope, and a guardrail that no record/provider mutation has happened.

- [x] **Step 3: Verify lease and insurance promotion**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_upload_promotes_document_to_smart_intake tests/integration/test_tenant_portal_api.py::test_tenant_portal_insurance_upload_promotes_document_to_smart_intake -q
```

Expected: both pass.

## Task 2: Reviewed Insurance Auto-Updates Tenant Metadata

- [x] **Step 1: Write failing scoped insurance apply test**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_updates_scoped_tenant_metadata -q
```

Expected before implementation: fails because Smart Intake creates an insurance obligation but does not update the tenant metadata.

- [x] **Step 2: Implement apply-time metadata update**

When `document_type == "insurance_certificate"` and the source document is scoped to a tenant, extract the reviewed expiry date, set `insurance_confirmed`, `insurance_expiry_date`, `insurance_document_id`, and append a compact `insurance_auto_update_history[]` entry.

- [x] **Step 3: Verify metadata and obligation behavior**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_updates_scoped_tenant_metadata tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_uses_existing_document_scope -q
```

Expected: both pass.

## Task 3: DocuSign Receipt Hook Through Send Lease Pack

- [x] **Step 1: Write failing lease document requirement and receipt tests**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_after_apply_records_delivery tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_requires_attached_lease_document -q
```

Expected before implementation: one fails because DocuSign is not called, and one fails because the API allows sending without a lease document.

- [x] **Step 2: Implement backend lease document gate and DocuSign receipt**

Find the latest `StoredDocument` for the onboarding with `category=lease`; reject send if absent. Pass that document to `send_lease_for_signature`, persist the receipt under `delivery_data.lease_pack.docusign`, and persist active envelope metadata under `delivery_data.lease_agreement.signing`.

- [x] **Step 3: Block local signing while DocuSign is pending**

If `delivery_data.lease_agreement.signing.provider == "docusign"` and status is `queued` or `sent`, reject `/tenant-portal/lease-agreement/sign` until the provider completion path marks it signed.

- [x] **Step 4: Verify DocuSign receipt gates**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_after_apply_records_delivery tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_requires_attached_lease_document tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_signing_rejects_pending_docusign_envelope -q
```

Expected: all pass.

## Task 4: Real DocuSign Envelope Create

- [x] **Step 1: Add unit tests around DocuSign HTTP client**

Create `tests/unit/test_docusign.py` with tests for missing config, JWT token request payload, envelope create payload, and provider error mapping.

- [x] **Step 2: Implement JWT grant and envelope create**

Replace the configured-path stub in `stewart/integrations/docusign.py` with a testable `httpx.Client` flow: create JWT assertion with `pyjwt`, exchange for access token, call `/v2.1/accounts/{account_id}/envelopes`, include document bytes as base64, signer recipient, sign-here tabs, and custom fields for onboarding/lease/document ids.

- [x] **Step 3: Verify no network in tests**

Run:

```bash
.venv/bin/python -m pytest tests/unit/test_docusign.py -q
```

Expected: all tests pass with mocked HTTP.

## Task 5: DocuSign Completion Webhook

- [x] **Step 1: Write integration tests for provider completion**

Add tests in `tests/integration/test_tenant_onboarding_api.py` for completed webhook, replay/idempotency, ignored unknown envelope, and optional shared-secret rejection.

- [x] **Step 2: Implement webhook route**

Add `POST /api/v1/tenant-onboarding/webhooks/docusign`; verify shared secret if configured, find onboarding by envelope id, and mark `delivery_data.lease_agreement.signing` completed with `signed_at`, `provider="docusign"`, and completion payload summary.

- [x] **Step 3: Verify local signing remains blocked until completion**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_signing_rejects_pending_docusign_envelope -q
```

Expected: pass.

## Task 6: Operator UI Lifecycle Review

- [x] **Step 1: Surface upload review status**

In tenant detail, show tenant-uploaded lease/insurance documents as promoted to Smart Intake when `smart_intake_id` metadata exists, and link to review.

- [x] **Step 2: Surface DocuSign status**

In the lease pack panel, show attached lease document, DocuSign queued/skipped/failed receipt, signed-completion status, and a direct signed lease PDF download when retention has stored the completed document.

Also show the review-safe activation state from DocuSign completion: pending leases are marked ready for explicit activation review, while already-active leases are called out without changing status automatically.

When activation review is ready, tenant detail exposes an explicit operator action to activate the pending lease. This is the only path that changes `Lease.status` after DocuSign completion.

- [x] **Step 3: Smoke test the visible flow**

Run:

```bash
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail sends lease pack"
```

Expected: pass with updated mocks.

## Task 7: Signed DocuSign PDF Retention

- [x] **Step 1: Add retention tests**

Add DocuSign unit coverage for downloading the `combined` completed PDF and tenant-onboarding webhook coverage that stores one signed lease document on completion without duplicating on replay.

- [x] **Step 2: Implement retention**

Add `download_signed_lease_document`, call it from completed DocuSign webhook handling, store the returned PDF as a lease `StoredDocument` scoped to entity/tenant/lease/onboarding, and stamp `signed_document_id` plus retention status under `delivery_data.lease_agreement.signing`.

Stamp `lease_activation_review` under the same signing record so completion can drive operator review without automatically changing `Lease.status`.

Add `POST /api/v1/tenant-onboarding/{id}/activate-lease` to activate only applied onboarding rows with completed signing and a pending lease, stamping lease metadata and signing activation history for auditability.

- [x] **Step 3: Verify retention**

Run:

```bash
.venv/bin/python -m pytest tests/unit/test_docusign.py tests/integration/test_tenant_onboarding_api.py -q -k 'download_signed_lease_document or docusign_webhook_marks'
```

Expected: pass.

## Task 8: DocuSign Readiness Visibility

- [x] **Step 1: Add integration-status tests**

Add `tests/integration/test_system_api.py` coverage that DocuSign appears as not configured by default and reports configured credentials with a webhook-secret reminder before live Connect testing.

- [x] **Step 2: Surface readiness in Settings**

Add DocuSign to `IntegrationStatusRead`, `/api/v1/system/integration-status`, the web API type, and the Settings Integrations card.

- [x] **Step 3: Verify readiness surface**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_system_api.py -q
```

Expected: pass.

## Task 9: Tenant Upload Auto-Extraction

- [x] **Step 1: Add configured-extraction test**

Add `tests/integration/test_tenant_portal_api.py` coverage that a tenant-uploaded insurance document is promoted and extracted into a ready-for-review Smart Intake item when OpenAI is configured, with the extractor mocked.

- [x] **Step 2: Implement guarded background extraction**

Tenant upload promotion now schedules a background Smart Intake extraction only when OpenAI is configured. Missing OpenAI keeps the existing promoted `uploaded` queue row behavior. Extraction updates the same intake row, stamps document metadata, and audits the OpenAI extraction without mutating tenant metadata or lease state.

- [x] **Step 3: Verify upload behavior**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_upload_promotes_document_to_smart_intake tests/integration/test_tenant_portal_api.py::test_tenant_portal_insurance_upload_promotes_document_to_smart_intake tests/integration/test_tenant_portal_api.py::test_tenant_portal_insurance_upload_extracts_when_openai_is_configured -q
```

Expected: pass.

## Task 10: Tenant Lease Upload Match Recommendation

- [x] **Step 1: Add lease match recommendation test**

Add `tests/integration/test_tenant_portal_api.py` coverage that a tenant-uploaded lease extraction stamps a `lease_auto_match` recommendation against the scoped lease.

- [x] **Step 2: Implement review-only comparison**

When a tenant-uploaded lease extracts successfully, compare extracted lease start, expiry, and annual rent against the scoped lease. Store matched fields, differences, missing fields, and a guardrail in `extracted_data["lease_auto_match"]`; do not mutate lease status or register data.

- [x] **Step 3: Verify upload match behavior**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_upload_extraction_adds_match_recommendation -q
```

Expected: pass.

## Task 11: Smart Intake Match Recommendation UI

- [x] **Step 1: Add smoke coverage**

Update the Smart Intake mock lease document with a `lease_auto_match` recommendation and add a Playwright smoke that opens `/intake`, reviews the document, and expects the match status, counts, and no-mutation guardrail.

- [x] **Step 2: Surface match recommendation**

Render a compact `Lease upload match` card in the document review panel when `draft.lease_auto_match` is present, showing matched/different/missing counts plus differences and the guardrail.

- [x] **Step 3: Verify UI**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "smart intake shows tenant lease upload match recommendation"
```

Expected: pass.

## Task 12: Accept Tenant Lease Match

- [x] **Step 1: Add no-mutation backend test**

Add coverage that accepting a matched tenant-uploaded lease marks the intake applied, links the uploaded document to the existing lease, does not mutate the lease row, and does not create a `LeaseIntake`.

- [x] **Step 2: Implement accept-match endpoint and UI action**

Add `POST /api/v1/document-intakes/{id}/accept-lease-match` for matched lease recommendations only, and wire the Smart Intake `Lease upload match` card to an **Accept match** button.

- [x] **Step 3: Verify accept-match flow**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_document_intake_accepts_tenant_lease_match_without_mutating_lease -q
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "smart intake shows tenant lease upload match recommendation"
```

Expected: pass.

## Task 13: Accepted Match Activation Review

- [x] **Step 1: Extend no-mutation test**

Expand the accept-match backend coverage so a pending applied onboarding row receives completed tenant-upload signing metadata, a ready-for-review activation marker, and can then be explicitly activated through the existing onboarding activation endpoint.

- [x] **Step 2: Reuse existing activation guardrail**

Accepting a matched tenant-uploaded lease now stamps `delivery_data.lease_agreement.signing` with `provider="tenant_upload"`, signed document/intake ids, signed-at state, and `lease_activation_review`. The existing activation endpoint derives activation source from the signing provider so DocuSign remains `tenant_onboarding_docusign` and tenant uploads become `tenant_uploaded_lease_match`.

- [x] **Step 3: Verify activation handoff**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_document_intake_accepts_tenant_lease_match_without_mutating_lease tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_activate_lease_after_docusign_completion -q
```

Expected: pass.

## Task 14: Accept-Match Guardrails

- [x] **Step 1: Add rejection tests**

Add backend coverage that accept-match rejects a contradictory `matched` payload when differences remain, and rejects operator-uploaded Smart Intake lease documents that are not tenant-portal/onboarding scoped.

- [x] **Step 2: Tighten endpoint checks**

`accept-lease-match` now requires tenant portal source metadata, an onboarding scope, `auto_match_candidate="tenant_uploaded_lease"`, and zero differences/missing fields.

- [x] **Step 3: Verify guardrails**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_document_intake_accepts_tenant_lease_match_without_mutating_lease tests/integration/test_tenant_portal_api.py::test_document_intake_accept_lease_match_rejects_differences tests/integration/test_tenant_portal_api.py::test_document_intake_accept_lease_match_rejects_operator_uploaded_documents -q
```

Expected: pass.

## Task 15: Tenant Insurance Source Visibility

- [x] **Step 1: Add tenant-detail smoke expectation**

Extend the tenant-detail smoke mock with applied insurance metadata and assert the tenant page shows the Insurance summary, confirmed expiry, and Smart Intake source.

- [x] **Step 2: Render insurance summary**

Tenant detail now reads `insurance_confirmed`, `insurance_expiry_date`, `insurance_document_id`, `insurance_document_intake_id`, and `insurance_auto_updated_at` from tenant metadata and renders a compact Insurance card with source document/review links when available.

- [x] **Step 3: Verify visible insurance status**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail shows portal access recovery actions"
```

Expected: pass.

## Task 16: DocuSign Connect Webhook Readiness

- [x] **Step 1: Add integration-status URL expectation**

Extend system status coverage so configured DocuSign with `PUBLIC_API_URL` returns the public Connect webhook URL without exposing credentials or webhook secrets.

- [x] **Step 2: Surface the webhook target in Settings**

`/api/v1/system/integration-status` now includes a non-secret `webhook_url` for DocuSign when `PUBLIC_API_URL` is set, and Settings > Organisation > Integrations renders it as the DocuSign Connect webhook target.

- [x] **Step 3: Document live console verification**

Deployment and handover notes now call out the DocuSign JWT variables, shared webhook secret, Connect URL, completed-envelope test, signed PDF retention check, and explicit operator Activate lease review.

- [x] **Step 4: Verify readiness surface**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_system_api.py -q
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "settings shows Xero readiness"
```

Expected: pass.

## Task 17: DocuSign Provider Edge States

- [x] **Step 1: Add declined webhook coverage**

Add backend coverage that a declined DocuSign Connect event updates the onboarding signing record with status, last event, and provider event history without marking the lease signed, retaining a PDF, or creating an activation review.

- [x] **Step 2: Persist non-completion provider events**

DocuSign webhook handling now writes non-completed provider statuses back into `delivery_data.lease_agreement.signing`; only `completed` uses the signed-document retention and `mark_lease_agreement_signed` path.

- [x] **Step 3: Surface terminal provider statuses**

Tenant detail now treats DocuSign `failed`, `declined`, `voided`, and `deleted` statuses as attention states so older queued send receipts cannot hide the current provider state.

- [x] **Step 4: Keep delivered envelopes on the provider path**

Tenant portal Leasium signing now remains blocked while a DocuSign envelope is `queued`, `sent`, or `delivered`.

- [x] **Step 5: Verify edge states**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_docusign_webhook_records_declined_envelope tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_signing_rejects_delivered_docusign_envelope -q
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail flags declined DocuSign envelope"
```

Expected: pass.

## Task 18: DocuSign Retry After Provider Attention

- [x] **Step 1: Add tenant-detail retry smoke coverage**

Extend the declined DocuSign smoke so a declined envelope with an attached lease document shows **Send again**, posts the existing send-lease-pack action, and returns to a fresh pending DocuSign envelope.

- [x] **Step 2: Enable resendable terminal states**

Tenant detail now enables the Send lease pack action again when the latest DocuSign signing status is `declined`, `voided`, `deleted`, `failed`, or `skipped`; the button label becomes **Send again**.

- [x] **Step 3: Add backend retry-history coverage**

Backend integration coverage now verifies that sending a lease pack after a declined envelope creates a fresh DocuSign signing record and preserves the previous lease-pack attempt in `lease_pack_history`.

- [x] **Step 4: Verify retry flow**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_retries_after_declined_docusign -q
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail flags declined DocuSign envelope"
```

Expected: pass.

## Task 19: Prevent Duplicate Active DocuSign Envelopes

- [x] **Step 1: Add active-envelope rejection coverage**

Add backend coverage that **Send lease pack** rejects an already-active DocuSign signing record (`queued`, `sent`, or `delivered`) before calling the DocuSign provider.

- [x] **Step 2: Add server-side active status guard**

`POST /tenant-onboarding/{id}/send-lease-pack` now blocks duplicate operator sends while a DocuSign envelope is waiting for completion, matching the tenant-side local signing guard.

- [x] **Step 3: Verify retry remains available**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_rejects_active_docusign_envelope tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_retries_after_declined_docusign -q
```

Expected: pass.

## Task 20: Prevent Competing Signing Sources

- [x] **Step 1: Add accept-match active DocuSign rejection coverage**

Add backend coverage that accepting a matched tenant-uploaded lease is rejected while the same onboarding has an active DocuSign signing record (`queued`, `sent`, or `delivered`).

- [x] **Step 2: Add cross-path signing guard**

`POST /document-intakes/{id}/accept-lease-match` now checks the onboarding lease agreement signing metadata and blocks tenant-upload signing completion until the active DocuSign envelope is resolved.

- [x] **Step 3: Verify tenant-upload accept still works**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_document_intake_accept_lease_match_rejects_active_docusign_envelope tests/integration/test_tenant_portal_api.py::test_document_intake_accepts_tenant_lease_match_without_mutating_lease -q
```

Expected: pass.

## Task 21: Smart Intake Signing Conflict Feedback

- [x] **Step 1: Add operator-visible conflict smoke coverage**

Add Playwright coverage that Smart Intake shows the backend conflict message when **Accept match** is blocked by an active DocuSign envelope, and does not show the accepted success notice.

- [x] **Step 2: Exercise the real shared smoke API error shape**

Extend the shared smoke API mock with an explicit active-envelope conflict mode for accept-match so the browser receives the same 409 `detail` payload as the backend.

- [x] **Step 3: Verify conflict feedback**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "smart intake explains active DocuSign conflict"
```

Expected: pass.

## Task 22: DocuSign Webhook Hardening

- [x] **Step 1: Add webhook safety regressions**

Add backend coverage that DocuSign Connect events are rejected when `DOCUSIGN_WEBHOOK_SECRET` is not configured, and that a `completed` event cannot move a declined envelope into signed/activation-review state.

- [x] **Step 2: Require signed Connect delivery and valid transitions**

`POST /tenant-onboarding/webhooks/docusign` now requires the configured shared secret via `x-docusign-webhook-secret`, `x-leasium-webhook-secret`, or `token`. Completion events are only applied when the current signing record is `provider="docusign"`, the envelope id matches, and the existing status is active (`queued`, `sent`, or `delivered`). Replays of already-completed events do not re-download the signed PDF.

- [x] **Step 3: Verify webhook hardening**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py -q -k docusign_webhook
```

Expected: pass.

## Task 23: Smart Intake Smoke State Isolation

- [x] **Step 1: Reproduce order-dependent smoke failure**

Run the lease-match success and active-DocuSign conflict Smart Intake smokes in one worker. Expected before the fix: the first test mutates the shared intake queue and the second cannot find the review row.

- [x] **Step 2: Reset intake mock state per test**

Clone the initial Smart Intake mock rows inside `mockLeasiumApi()` so each smoke test starts with a fresh review queue while still allowing each individual test to mutate its own local rows.

- [x] **Step 3: Verify sequential smoke stability**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "smart intake shows tenant lease upload match recommendation|smart intake explains active DocuSign conflict" --workers=1
```

Expected: pass.

## Task 24: Tenant Upload Provenance Hardening

- [x] **Step 1: Add category-stability regression**

Add backend coverage for a tenant-selected insurance upload that OpenAI classifies as `unknown`; the stored document must stay in the tenant-selected insurance category until operator review/apply.

- [x] **Step 2: Store AI classification as proposed metadata**

Tenant upload extraction now keeps `StoredDocument.category` unchanged and writes the extractor's proposed category to `document_metadata.proposed_document_category`, alongside the extracted `document_type`.

- [x] **Step 3: Verify category stability**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_upload_extraction_keeps_tenant_selected_category_until_review -q
```

Expected: pass.

## Task 25: Lease Match Scope Hardening

- [x] **Step 1: Add malformed-scope rejection**

Add backend coverage that a tenant-uploaded lease match cannot be accepted when the stored document is missing the lease scope, even if the match payload names a valid lease.

- [x] **Step 2: Require document and onboarding scope agreement**

`accept-lease-match` now requires the stored document's lease, tenant, unit, property, and entity scope to match the accepted lease, and requires the onboarding row to exist and point at the same lease/tenant/entity before the document can be linked or the signing handoff can be stamped.

- [x] **Step 3: Verify scope guard and happy path**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_document_intake_accept_lease_match_rejects_missing_document_lease_scope tests/integration/test_tenant_portal_api.py::test_document_intake_accepts_tenant_lease_match_without_mutating_lease -q
```

Expected: pass.

## Task 26: DocuSign Send Receipt Smoke

- [x] **Step 1: Exercise queued DocuSign send receipt**

Update the tenant-detail send-pack smoke so the send action returns a queued DocuSign receipt and active signing record, then assert the operator sees the DocuSign waiting notice, pending state, and disabled duplicate-send button.

- [x] **Step 2: Preserve completion and activation coverage**

The smoke then simulates provider completion through the refreshed onboarding payload and continues through the signed lease download and explicit **Activate lease** path.

- [x] **Step 3: Verify receipt path**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail sends lease pack"
```

Expected: pass.

## Task 27: Insurance Apply Tenant Scope Hardening

- [x] **Step 1: Add mismatched tenant regression**

Add backend coverage for a lease-scoped insurance document whose stored tenant id points at a different tenant. Applying the reviewed insurance certificate must update the lease tenant, not the stale document tenant.

- [x] **Step 2: Derive metadata tenant from lease scope**

When applying reviewed insurance metadata, if the document has a lease scope, derive the tenant from that lease and correct `StoredDocument.tenant_id` before writing insurance metadata/history.

- [x] **Step 3: Verify insurance apply scope**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_uses_lease_tenant_for_metadata tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_updates_scoped_tenant_metadata tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_uses_existing_document_scope -q
```

Expected: pass.

## Task 28: DocuSign Envelope Provenance Fields

- [x] **Step 1: Add envelope payload provenance regression**

Extend DocuSign unit coverage so the created envelope custom fields include `tenant_onboarding_id` and `document_id`, not just the lease/entity/property fields.

- [x] **Step 2: Pass provenance from Send lease pack**

`LeaseSignatureRequest` now carries onboarding id and source lease-document id. The Send lease pack API passes those ids to the provider boundary, and DocuSign custom fields store them as hidden text fields for Connect/admin traceability.

- [x] **Step 3: Verify provider and route wiring**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_after_apply_records_delivery tests/unit/test_docusign.py::test_send_lease_for_signature_creates_envelope -q
```

Expected: pass.

## Task 29: DocuSign Webhook Custom Field Validation

- [x] **Step 1: Add mismatched custom-field regression**

Add backend coverage that a completed Connect event with a matching envelope id but mismatched Leasium custom fields does not mark the lease signed, retain a PDF, or create activation review.

- [x] **Step 2: Validate optional Leasium fields when present**

DocuSign webhook handling now parses `customFields.textCustomFields` from the payload, data section, or envelope summary. If DocuSign sends `tenant_onboarding_id`, `lease_id`, `document_id`, or `entity_id`, each present field must match the active Leasium signing record. Omitted fields remain allowed so Connect configurations that do not echo custom fields keep working.

- [x] **Step 3: Verify guarded and legacy completion paths**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_docusign_webhook_ignores_mismatched_custom_fields tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_docusign_webhook_marks_lease_signed -q
```

Expected: pass.

## Task 30: Tenant Upload Activation Review Comms

- [x] **Step 1: Add tenant-upload lifecycle queue regression**

Add backend coverage that an accepted tenant-uploaded lease match with a
ready-for-review activation marker appears in the comms queue as
`tenant_lifecycle_stall`.

- [x] **Step 2: Include tenant-upload activation reviews**

The tenant lifecycle scanner now accepts `tenant_upload` completed signing
records for activation-review candidates while keeping DocuSign waiting/retry
states scoped to active DocuSign envelopes only.

- [x] **Step 3: Verify comms lifecycle coverage**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py -q
```

Expected: pass.

## Task 31: Tenant Lifecycle Queue Smoke Coverage

- [x] **Step 1: Add failing tenant-upload comms smoke expectation**

Extend the focused comms queue smoke so the Tenant lifecycle tab and CSV export
expect both a DocuSign retry draft and a tenant-upload activation-review draft.

- [x] **Step 2: Update shared smoke fixture**

The shared web API mock now returns two `tenant_lifecycle_stall` candidates:
one for DocuSign retry review and one for the accepted tenant-uploaded lease
activation review.

- [x] **Step 3: Verify browser coverage**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "comms queue approves inbound SMS with a phone recipient"
```

Expected: pass.

## Task 32: Tenant Lifecycle Urgency Smoke Parity

- [x] **Step 1: Add urgent-count smoke expectation**

Extend the focused comms smoke to expect two urgent lifecycle drafts, matching
the backend `danger` severity for DocuSign retry and activation-review work.

- [x] **Step 2: Align fixture severity with backend scanner**

The shared comms smoke fixture now marks the DocuSign retry and tenant-upload
activation-review drafts as `danger`, and `/comms/queue/counts` reports
`urgent: 2`.

- [x] **Step 3: Verify urgency parity**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "comms queue approves inbound SMS with a phone recipient"
```

Expected: pass.

## Task 33: Tenant Lifecycle Count Contract

- [x] **Step 1: Add backend queue-count coverage**

Add integration coverage that a declined DocuSign envelope and a tenant-upload
activation review both flow through `/comms/queue/counts` as urgent tenant
lifecycle drafts.

- [x] **Step 2: Verify scanner parity**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_queue_counts_include_urgent_tenant_lifecycle_reviews -q
```

Expected: pass if the count endpoint is already reusing the same lifecycle
scanner and severity rules as `/comms/queue`; otherwise fix the shared scanner
path until this passes.

## Task 34: API Release Stamp

- [x] **Step 1: Add healthcheck release coverage**

Add smoke coverage that `/health` still reports OK locally and includes a
non-secret release block with an `unknown` local fallback.

- [x] **Step 2: Report deployed commit metadata**

Teach `/health` to surface `RENDER_GIT_COMMIT` as `release.commit`, with common
commit environment variable fallbacks, so production API verification can prove
which backend revision is live.

- [x] **Step 3: Verify release stamp**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_smoke_workflows.py::test_healthcheck_smoke tests/integration/test_smoke_workflows.py::test_healthcheck_reports_deployed_commit -q
```

Expected: pass.

## Task 35: Settings API Release Visibility

- [x] **Step 1: Add Settings smoke expectation**

Extend the Settings smoke so Organisation > Integrations expects an API release
row with the live health commit source and short commit hash.

- [x] **Step 2: Fetch and render `/health` in Settings**

Add a web API helper for the API root `/health` endpoint and render a compact
non-secret release row above provider integration cards.

- [x] **Step 3: Verify Settings visibility**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "settings shows Xero readiness"
```

Expected: pass.

## Task 36: Settings Release Status Hardening

- [x] **Step 1: Add unavailable release smoke coverage**

Add Settings smoke coverage where `/health` is unavailable, while the provider
integration status endpoint still responds.

- [x] **Step 2: Badge degraded release states**

Render explicit badges for API release states: Render/current commit,
local/unknown release, loading, and unavailable.

- [x] **Step 3: Verify degraded and happy paths**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "settings shows Xero readiness|settings keeps provider readiness"
```

Expected: pass.

## Task 37: API Health OpenAPI Contract

- [x] **Step 1: Add health contract coverage**

Add smoke coverage that `/openapi.json` describes `/health` as a typed
`ApiHealthRead` response with a nested `ApiReleaseRead` release block.

- [x] **Step 2: Type the health endpoint**

Add named system schemas for the health response and wire `/health` with a
`response_model`, preserving the existing non-secret release payload.

- [x] **Step 3: Verify health contract**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_smoke_workflows.py::test_healthcheck_smoke tests/integration/test_smoke_workflows.py::test_healthcheck_reports_deployed_commit tests/integration/test_smoke_workflows.py::test_healthcheck_contract_is_typed_in_openapi -q
```

Expected: pass.

## Task 38: Lease Match Missing-Field Guardrail

- [x] **Step 1: Add missing-field regression**

Add tenant portal coverage for an otherwise matching uploaded lease where the
extractor omits annual rent; the recommendation must remain `needs_review`.

- [x] **Step 2: Tighten auto-match status**

Treat either differences or missing fields as operator-review states so
`matched` only appears when all compared fields are present and equal.

- [x] **Step 3: Verify accept-match parity**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_upload_extraction_adds_match_recommendation tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_upload_extraction_marks_missing_fields_for_review tests/integration/test_tenant_portal_api.py::test_document_intake_accepts_tenant_lease_match_without_mutating_lease tests/integration/test_tenant_portal_api.py::test_document_intake_accept_lease_match_rejects_differences tests/integration/test_tenant_portal_api.py::test_document_intake_accept_lease_match_rejects_operator_uploaded_documents -q
```

Expected: pass.

## Task 39: Insurance Expiry Apply Guardrail

- [x] **Step 1: Add scoped insurance expiry regression**

Add Smart Intake coverage for a tenant-scoped insurance certificate with a dated
follow-up obligation but no reviewed policy expiry. Applying must fail without
creating obligations, marking the intake applied, or changing tenant metadata.

- [x] **Step 2: Block insurance apply without expiry**

Require `_insurance_due_date(reviewed)` before the insurance apply path creates
obligations or writes tenant insurance metadata.

- [x] **Step 3: Verify insurance apply behavior**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_requires_reviewed_expiry_for_tenant_update tests/integration/test_document_intake_api.py::test_document_intake_apply_rejects_insurance_without_expiry tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_updates_scoped_tenant_metadata tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_uses_lease_tenant_for_metadata tests/integration/test_document_intake_api.py::test_document_intake_apply_insurance_uses_existing_document_scope -q
```

Expected: pass.

## Task 40: DocuSign Production Endpoint Readiness

- [x] **Step 1: Add demo-endpoint readiness regression**

Add system integration coverage where DocuSign credentials, webhook secret, and
public API URL are configured but the REST/auth URLs still point at demo.

- [x] **Step 2: Require production DocuSign hosts for live-ready**

Treat DocuSign as live-ready only when credentials, webhook secret, public API
URL, `DOCUSIGN_BASE_URL=https://www.docusign.net/restapi`, and
`DOCUSIGN_AUTH_BASE_URL=https://account.docusign.com` are all set.

- [x] **Step 3: Verify readiness states**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_system_api.py -q
```

Expected: pass.

## Task 41: Settings DocuSign Endpoint Warning

- [x] **Step 1: Add Settings smoke coverage**

Add a Settings smoke state where DocuSign credentials, webhook secret, and public
API URL are configured but the DocuSign REST/auth URLs are still demo endpoints.

- [x] **Step 2: Mirror backend readiness payload in mocks**

Update the shared smoke API mock so Settings receives the same non-secret
`DOCUSIGN_BASE_URL` and `DOCUSIGN_AUTH_BASE_URL` blocker detail that the API
now returns.

- [x] **Step 3: Verify Settings visibility**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "settings explains DocuSign demo endpoint readiness"
```

Expected: pass.

## Task 42: DocuSign Demo Endpoint Send Guard

- [x] **Step 1: Add provider boundary regressions**

Add unit coverage that configured DocuSign credentials with demo REST/auth URLs
skip live envelope sends and signed-document downloads before any network call.

- [x] **Step 2: Guard provider actions**

Require `DOCUSIGN_BASE_URL=https://www.docusign.net/restapi` and
`DOCUSIGN_AUTH_BASE_URL=https://account.docusign.com` inside the DocuSign
provider boundary before sending live lease envelopes or downloading retained
signed PDFs.

- [x] **Step 3: Verify provider behavior**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/unit/test_docusign.py -q
```

Expected: pass.

## Task 43: DocuSign Skipped Send Audit Outcome

- [x] **Step 1: Add skipped-send audit regression**

Add onboarding coverage that a skipped DocuSign send with a setup error keeps a
reviewable receipt but records the DocuSign audit event as `error`.

- [x] **Step 2: Preserve queued success behavior**

Change the DocuSign send audit outcome to use the provider error message rather
than only the `failed` status, so skipped setup failures are visible while
queued/sent envelopes remain success events.

- [x] **Step 3: Verify send audit paths**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_audits_skipped_docusign_as_error tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_send_lease_pack_after_apply_records_delivery -q
```

Expected: pass.

## Task 44: Tenant Detail Skipped DocuSign Send Visibility

- [x] **Step 1: Add skipped-send UI smoke**

Add tenant detail smoke coverage for an applied onboarding with an attached
lease where sending the lease pack returns a skipped DocuSign receipt because
production endpoints are not configured.

- [x] **Step 2: Mirror skipped provider receipt in mocks**

Update the shared smoke API mock so the send-lease-pack response includes the
same skipped DocuSign receipt and setup error that the provider boundary now
returns.

- [x] **Step 3: Verify operator-visible state**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail shows skipped DocuSign setup"
```

Expected: pass.
