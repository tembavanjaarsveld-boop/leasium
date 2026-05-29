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

## Task 45: Skipped DocuSign Setup Comms Candidate

- [x] **Step 1: Add skipped setup comms regression**

Add backend comms coverage that a skipped DocuSign send with a provider setup
error appears as an urgent tenant lifecycle candidate.

- [x] **Step 2: Route skipped sends into lifecycle review**

Treat DocuSign `skipped` as a retry/setup state in the tenant lifecycle scanner,
with subject/detail/body copy that points at provider setup before resending.

- [x] **Step 3: Verify comms retry parity**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_queue_returns_skipped_docusign_setup_retry_candidate tests/integration/test_comms_api.py::test_comms_queue_returns_declined_or_failed_docusign_retry_candidate -q
```

Expected: pass.

## Task 46: Skipped DocuSign Comms Smoke Parity

- [x] **Step 1: Add comms smoke expectation**

Extend the Comms queue smoke to expect the skipped DocuSign setup draft in the
Tenant lifecycle tab, CSV export, overall draft count, and urgent count.

- [x] **Step 2: Update shared comms fixture**

Add a third tenant lifecycle mock candidate for `DocuSign skipped` setup work
and align `/comms/queue/counts` with five total drafts and three urgent drafts.

- [x] **Step 3: Verify browser coverage**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "comms queue approves inbound SMS with a phone recipient"
```

Expected: pass.

## Task 47: Tenant-Safe Skipped DocuSign Comms Copy

- [x] **Step 1: Add tenant-safe copy regression**

Extend skipped DocuSign setup comms coverage so the internal candidate detail
keeps the production endpoint blocker while the tenant-facing body omits setup
variable names and raw provider configuration guidance.

- [x] **Step 2: Keep setup detail internal**

Keep the provider error in operator detail and use neutral tenant body copy that
says provider setup needs attention before a fresh lease pack is sent.

- [x] **Step 3: Verify focused DocuSign comms checks**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_queue_returns_skipped_docusign_setup_retry_candidate tests/integration/test_comms_api.py::test_comms_queue_returns_declined_or_failed_docusign_retry_candidate -q
```

Expected: pass.

## Task 48: Skipped DocuSign Counts Guardrail

- [x] **Step 1: Extend urgent lifecycle counts coverage**

Add a skipped DocuSign setup onboarding to the existing comms counts regression
so declined DocuSign, tenant-upload activation review, and skipped setup all
contribute to the tenant lifecycle urgent badge.

- [x] **Step 2: Keep implementation unchanged**

The existing counts endpoint already reuses the tenant lifecycle scanner, so no
production change is needed for skipped setup to be counted.

- [x] **Step 3: Verify focused counts coverage**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_queue_counts_include_urgent_tenant_lifecycle_reviews -q
```

Expected: pass.

## Task 49: Tenant Insurance Upload Apply Guardrail

- [x] **Step 1: Add cross-router insurance regression**

Cover the full tenant-uploaded insurance lifecycle: portal upload, Smart Intake
auto-extraction, operator apply, scoped tenant metadata update, and refreshed
tenant portal compliance due date/latest document.

- [x] **Step 2: Keep implementation unchanged**

The existing portal upload promotion, Smart Intake apply, and portal compliance
paths already compose correctly, so no production change is needed.

- [x] **Step 3: Verify focused insurance handoff coverage**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_insurance_upload_apply_refreshes_compliance_status -q
```

Expected: pass.

## Task 50: Signed Document Activation Guardrail

- [x] **Step 1: Add missing-retention activation regression**

Add backend coverage that a completed DocuSign signing record with skipped or
missing signed-document retention cannot activate a pending lease.

- [x] **Step 2: Require retained signed document**

Tighten the onboarding activation helper so explicit lease activation requires
both a completed signing timestamp and a retained `signed_document_id`.

- [x] **Step 3: Verify activation guardrails**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_activate_lease_after_docusign_completion tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_activate_lease_rejects_unsigned_agreement tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_activate_lease_rejects_missing_signed_document -q
```

Expected: pass.

## Task 51: Already-Signed Lease Match Guardrail

- [x] **Step 1: Add signed-state accept-match regression**

Add backend coverage that accepting a tenant-uploaded lease match is rejected
when the scoped onboarding lease agreement is already signed through DocuSign.

- [x] **Step 2: Preserve existing signing metadata**

Block `accept-lease-match` before mutating intake/document state when the
onboarding signing record already has `signed_at`, preventing tenant-uploaded
lease acceptance from overwriting DocuSign completion metadata.

- [x] **Step 3: Verify accept-match guardrails**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_document_intake_accept_lease_match_rejects_already_signed_lease_agreement tests/integration/test_tenant_portal_api.py::test_document_intake_accept_lease_match_rejects_active_docusign_envelope tests/integration/test_tenant_portal_api.py::test_document_intake_accepts_tenant_lease_match_without_mutating_lease -q
```

Expected: pass.

## Task 52: Lease Question Apply Block Smoke

- [x] **Step 1: Add operator blocking smoke**

Add tenant-detail smoke coverage for submitted onboarding with an open lease
question, asserting the operator sees `Questions open`, the apply-block reason,
and `Mark reviewed` instead of applying immediately.

- [x] **Step 2: Mock question resolution handoff**

Extend the smoke route for that test so resolving the lease question returns an
updated onboarding row with `open_question_count=0` and `ready_to_sign`, then
allows the reviewed onboarding to apply.

- [x] **Step 3: Verify focused smoke**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail blocks onboarding apply until lease questions are resolved"
```

Expected: pass.

## Task 53: DocuSign Session Signing Lock

- [x] **Step 1: Add tenant portal session regression**

Add backend coverage that a claimed tenant portal session with active DocuSign
signing metadata (`queued`, `sent`, or `delivered`) does not report the lease
agreement as ready for Leasium signing.

- [x] **Step 2: Share the active DocuSign lock rule**

Centralise the active DocuSign statuses and lock reason in
`apps/api/tenant_lease_agreement.py`, use it in the lease agreement read model,
and keep the existing `/tenant-portal/lease-agreement/sign` conflict aligned.

- [x] **Step 3: Verify tenant portal guardrails**

Run:

```bash
.venv/bin/pytest tests/integration/test_tenant_portal_api.py -q
.venv/bin/ruff check apps/api/tenant_lease_agreement.py apps/api/routers/tenant_portal.py tests/integration/test_tenant_portal_api.py
```

Expected: pass.

## Task 54: Inbound Email Attachment Smart Intake Routing

- [x] **Step 1: Add SendGrid attachment regression**

Add backend coverage that a multipart SendGrid inbound email with an attachment
persists the inbound message, stores the attachment as a `StoredDocument`, and
creates a Smart Intake `uploaded` row tied back to the inbound message and
attributed tenant.

- [x] **Step 2: Route attachments without provider mutation**

Read SendGrid attachment file fields from the already-parsed form payload,
store each non-empty attachment within the configured document size limit, and
create a review-only Smart Intake row with a guardrail explaining that no tenant
data, lease data, provider action, or payment record changes until operator
review.

- [x] **Step 3: Surface operator handoff**

Add the attachment count to inbound email comms candidate detail and extend the
`/comms` smoke fixture/CSV coverage with an inbound email attachment draft.

- [x] **Step 4: Verify attachment routing**

Run:

```bash
.venv/bin/pytest tests/integration/test_comms_api.py::test_inbound_webhook_routes_attachments_to_smart_intake -q
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "comms queue approves inbound SMS with a phone recipient"
```

Expected: pass.

## Task 55: SendGrid Inbound Shared Secret Guard

- [x] **Step 1: Add webhook secret regressions**

Add backend coverage that a configured `SENDGRID_INBOUND_SECRET` rejects missing
secrets before persisting an inbound message, and accepts a matching shared
secret from the Leasium custom header.

- [x] **Step 2: Add optional secret verification**

Add the API setting and verify requests when configured. Accept `token`,
`secret`, `X-Leasium-SendGrid-Inbound-Secret`, or
`X-SendGrid-Inbound-Secret` so SendGrid can be configured either via URL or
headers. Keep local/dev behaviour unchanged when the setting is blank.

- [x] **Step 3: Document live setup**

Update `.env.example`, `docs/deployment.md`, the roadmap, and handover with the
tokenized inbound parse URL and the “set the secret before enabling MX” warning.

- [x] **Step 4: Verify inbound guardrails**

Run:

```bash
.venv/bin/pytest tests/integration/test_comms_api.py -k "shared_secret" -q
```

Expected: pass.

## Task 56: Inbound Attachment Auto-Extraction

- [x] **Step 1: Add extraction regressions**

Add backend coverage that SendGrid inbound attachments are extracted into
Smart Intake when `OPENAI_API_KEY` is configured, while the OpenAI-off path
continues to leave the review row as `uploaded`.

- [x] **Step 2: Add soft-fail extraction**

Reuse the existing Smart Intake extractor boundary for inbound attachment
intakes. Successful extraction stamps document type, summary, confidence,
extracted data, OpenAI response id, and proposed document category. Extraction
errors leave the stored attachment and intake visible with a failed status and
error metadata.

- [x] **Step 3: Update handover and roadmap**

Record that inbound email attachments now optionally pre-extract and remain
review-first.

- [x] **Step 4: Verify inbound attachment extraction**

Run:

```bash
.venv/bin/pytest tests/integration/test_comms_api.py -k "inbound_webhook_extracts_attachment_when_openai_is_configured or inbound_webhook_keeps_attachment_intake_when_extraction_fails or inbound_webhook_routes_attachments_to_smart_intake" -q
```

Expected: pass.

## Task 57: Inbound Attachment Smart Intake Operator Copy

- [x] **Step 1: Add review-queue smoke coverage**

Add a Smart Intake smoke fixture for a SendGrid-routed inbound email attachment
and assert the review queue shows its inbound source, email subject, reviewed
document facts, and no-mutation guardrail.

- [x] **Step 2: Preserve extracted facts beside metadata**

Treat review metadata such as inbound source, subject, and guardrail as
metadata unless the review payload contains actual extraction keys, so the
review panel continues to render the extracted policy dates and summary.

- [x] **Step 3: Surface operator source copy**

Show an "Inbound email attachment" badge plus email subject in the review queue
and review panel, with the guardrail visible before operators apply anything.

- [x] **Step 4: Verify Smart Intake copy**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "smart intake labels inbound email attachments"
```

Expected: pass.

## Task 58: Tenant Lifecycle Comms Handoffs

- [x] **Step 1: Add operator handoff smoke coverage**

Extend the Comms queue smoke so tenant lifecycle cards must link to the tenant
review page and inbound email attachment cards must link to Smart Intake.

- [x] **Step 2: Add contextual handoff links**

Render "Open tenant review" on tenant lifecycle stall drafts when the candidate
has a tenant id, and "Open Smart Intake" on inbound email drafts that mention
Smart Intake routing.

- [x] **Step 3: Verify comms handoffs**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "comms queue approves inbound SMS with a phone recipient"
```

Expected: pass.

## Task 59: Activation Review Guardrail Copy

- [x] **Step 1: Add tenant-detail activation review smoke coverage**

Extend the DocuSign completion tenant-detail smoke so the signed-lease panel
must show the activation transition and the stored no-auto-activation guardrail
before the operator clicks Activate lease.

- [x] **Step 2: Surface activation review metadata**

Render the current-to-recommended lease status transition and guardrail from
`lease_activation_review` in the signed-lease panel.

- [x] **Step 3: Verify activation review copy**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail sends lease pack after onboarding approval"
```

Expected: pass.

## Task 60: Tenant Upload Signed Label

- [x] **Step 1: Add tenant-upload activation review smoke coverage**

Add tenant-detail smoke coverage for an onboarding signed through
`provider="tenant_upload"`, requiring the signed panel to show
"Tenant upload accepted" plus the existing activation-review guardrail.

- [x] **Step 2: Distinguish tenant-upload signing**

Label signed tenant-upload matches as "Tenant upload accepted" instead of
generic "Signed", while leaving DocuSign completions labelled separately.

- [x] **Step 3: Verify tenant-upload label**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail labels tenant-uploaded lease activation review"
```

Expected: pass.

## Task 61: Tenant Upload Smart Intake Handoff

- [x] **Step 1: Add handoff smoke coverage**

Extend the tenant-upload activation review smoke so an accepted upload with
`document_intake_id` must expose an "Open Smart Intake review" link to
`/intake?review=<id>`.

- [x] **Step 2: Thread intake id into signing status**

Read `signing.document_intake_id` into the tenant-detail signing status model
and render the Smart Intake review handoff in the signed-lease panel only when
the id is present.

- [x] **Step 3: Verify tenant-upload handoff**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail labels tenant-uploaded lease activation review"
```

Expected: pass.

## Task 62: Insurance Smart Intake Handoff Label

- [x] **Step 1: Add insurance handoff smoke coverage**

Extend the tenant-detail portal-access smoke so the confirmed insurance source
card must expose an `Open Smart Intake review` link to the applied insurance
intake.

- [x] **Step 2: Align insurance source copy**

Rename the insurance source Smart Intake action from generic `Review` to
`Open Smart Intake review`.

- [x] **Step 3: Verify insurance handoff label**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail shows portal access recovery actions"
```

Expected: pass.

## Task 63: Tenant Upload Activation Notice

- [x] **Step 1: Add source-aware notice smoke coverage**

Update the tenant-upload activation review smoke so activating a lease from a
tenant-uploaded match expects `Lease activated after tenant-uploaded lease
review.` instead of the generic signed-lease notice.

- [x] **Step 2: Read activation source from returned signing metadata**

After activation, inspect the returned onboarding signing metadata. Use the
tenant-upload-specific notice when the provider/source identifies
`tenant_upload` / `tenant_uploaded_lease_match`; keep the existing generic
notice for other signed-lease activation paths.

- [x] **Step 3: Verify tenant-upload activation notice**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail labels tenant-uploaded lease activation review"
```

Expected: pass.

## Task 64: DocuSign Setup Packet and Readiness Truthfulness

- [x] **Step 1: Add setup packet and missing-public-URL coverage**

Extend the Settings readiness smoke so the DocuSign integration card must copy
and download a provider setup packet with the Connect webhook URL, required env
vars, production endpoints, and review-only guardrail. Add system API coverage
for the case where DocuSign credentials, webhook secret, and production
endpoints are present but `PUBLIC_API_URL` is missing.

- [x] **Step 2: Surface copy/download packet and truthful detail**

Render compact DocuSign setup-packet actions in the existing Settings
Integrations card using only the already-loaded integration status response.
Tighten the API detail copy so missing `PUBLIC_API_URL` explains that DocuSign
Connect cannot reach the Leasium webhook yet.

- [x] **Step 3: Verify DocuSign readiness handoff**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_system_api.py::test_integration_status_reports_docusign_missing_public_api_url tests/integration/test_system_api.py::test_integration_status_reports_docusign_live_ready -q
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "settings shows Xero readiness and records mappings"
```

Expected: pass.

## Task 65: Backend Activation Review Gate

- [x] **Step 1: Add missing-review regression coverage**

Add an onboarding activation integration test where signing metadata looks
completed and has a retained signed document, but does not include
`lease_activation_review.status = "ready_for_review"`.

- [x] **Step 2: Require explicit activation-review readiness**

In the signed-lease activation helper, reject activation unless the signing
metadata carries the review marker created by DocuSign completion or accepted
tenant-uploaded lease match. Keep the existing signed timestamp, signed
document, and pending-lease checks.

- [x] **Step 3: Verify activation paths**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_activate_lease_rejects_missing_activation_review tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_activate_lease_after_docusign_completion tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_activate_lease_rejects_missing_signed_document -q
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_upload_extraction_adds_match_recommendation -q
```

Expected: pass.

## Task 66: Tenant-Uploaded Insurance Provenance

- [x] **Step 1: Add provenance-preservation coverage**

Extend the tenant portal insurance extraction test so successful OpenAI
extraction must preserve the tenant portal review metadata: source, candidate,
tenant/lease scope, and no-mutation guardrail.

- [x] **Step 2: Preserve review metadata and label Smart Intake rows**

Stop clearing `DocumentIntake.review_data` after tenant-upload extraction, and
extend Smart Intake source labeling so tenant portal uploads show a visible
`Tenant portal upload` badge with insurance-specific review detail and the
stored guardrail.

- [x] **Step 3: Verify insurance provenance**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_tenant_portal_insurance_upload_extracts_when_openai_is_configured tests/integration/test_tenant_portal_api.py::test_tenant_portal_lease_upload_extraction_adds_match_recommendation -q
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "smart intake labels inbound email attachments"
```

Expected: pass.

## Task 67: Operations Exact Smart Intake Handoff

- [x] **Step 1: Add exact-link smoke coverage**

Extend the Operations queue smoke so the tenant-uploaded insurance Smart Intake
row links to `/intake?review=<intake-id>` instead of the generic Smart Intake
workspace.

- [x] **Step 2: Build review-specific intake links**

Generate queue item links for document intakes with the review id query string,
and reuse that same href for the row Review action.

- [x] **Step 3: Verify Operations handoff**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "operations workspace surfaces maintenance and arrears work"
```

Expected: pass.

## Task 68: DocuSign Historical Docs Truth Pass

- [x] **Step 1: Find stale DocuSign wording**

Search the automation strategy and 5-day report for phrases that still describe
DocuSign as scaffold-only or imply provider/webhook completion auto-activates a
lease.

- [x] **Step 2: Align docs with shipped review-first behavior**

Update stale wording so DocuSign completion retains the signed PDF and creates
an explicit activation review, tenant-uploaded lease matches do not
auto-activate, and remaining work is production readiness with real credentials,
webhook secret, public API URL, production endpoints, and live-envelope smoke.

- [x] **Step 3: Verify stale wording is gone**

Run:

```bash
rg -n "DocuSign \\(scaffold\\)|Scaffold complete|DocuSign real plumbing|DocuSign scaffold ready|updates lease status to active|lease auto-activates|Then: annual rent increases, owner statements, DocuSign, WhatsApp" docs/automation-strategy-2026-05-23.md Leasium-5-day-report.md
git diff --check
```

Expected: `rg` exits with no matches, and diff check passes.

## Task 69: Entity-Safe Smart Intake Deep Links

- [x] **Step 1: Add wrong-saved-entity smoke coverage**

Add a Smart Intake smoke where local storage points at a different accessible
entity, then navigate to `/intake?entity_id=<entity>&review=<intake-id>` and
expect the intake workspace to select the URL entity and open the requested
review.

- [x] **Step 2: Respect entity_id and emit entity-aware links**

When the intake workspace loads, prefer a valid `entity_id` URL parameter over
the stored entity. Generate Smart Intake review links from Dashboard and
Operations with both `entity_id` and `review` query parameters.

- [x] **Step 3: Verify entity-safe links**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "smart intake deep link selects the review entity|operations workspace surfaces maintenance and arrears work|smart intake labels inbound email attachments"
```

Expected: pass.

## Task 70: Tenant Detail Entity-Safe Intake Links and Activation Audit

- [x] **Step 1: Add tenant-detail link and audit regressions**

Extend tenant-detail smoke coverage so insurance and tenant-uploaded lease
handoffs expect `/intake?entity_id=<entity>&review=<intake-id>`. Extend the
tenant-uploaded accept-match backend coverage so accepting signing evidence
must append a tenant-onboarding audit row for the activation review.

- [x] **Step 2: Harden tenant detail handoffs and backend audit trail**

Generate tenant detail Smart Intake handoff links with both entity and review
context, including insurance source cards, document review rows, signed
tenant-upload panels, reviewed source history, and the post-upload review
redirect. When a tenant-uploaded lease match is accepted, append a
`tenant_onboarding` audit event that says activation review is ready and the
lease was not activated.

- [x] **Step 3: Verify focused tenant lifecycle parity**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_portal_api.py::test_document_intake_accepts_tenant_lease_match_without_mutating_lease -q
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail shows portal access recovery actions"
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "tenant detail labels tenant-uploaded lease activation review"
```

Expected: pass.

## Task 71: Compliance Evidence Upload Back-Attribution

- [x] **Step 1: Add compliance evidence attribution regression**

Add backend coverage for a manual `/documents` upload from a `/comms`
compliance obligation candidate. The upload must preserve existing obligation
metadata, add the stored document id to `evidence_document_ids[]`, append a
compact `evidence_history[]` row, and stamp the document metadata with the
manual comms evidence source and source obligation id.

- [x] **Step 2: Thread obligation context through manual evidence upload**

Teach the document upload endpoint to accept optional `obligation_id`, validate
entity/scope consistency, derive missing property/unit/lease/tenant scope from
the obligation when safe, and back-attribute the uploaded document to the
obligation metadata. Update `/comms` so manual compliance evidence uploads pass
the candidate's obligation id and show linked-audit follow-up copy.

- [x] **Step 3: Verify compliance evidence handoff**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py::test_comms_queue_returns_compliance_obligation_candidate tests/integration/test_comms_api.py::test_compliance_evidence_upload_links_document_to_obligation -q
.venv/bin/ruff check apps/api/routers/documents.py tests/integration/test_comms_api.py
cd apps/web && ./node_modules/.bin/eslint src/app/comms/page.tsx src/lib/api.ts
cd apps/web && ./node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: pass.

## Task 72: AI Inbox Lease-Change Intake Link Parity

- [x] **Step 1: Add entity-aware promote URL regression**

Update AI inbox lease-change promote coverage so soft-failed and extracted
Smart Intake drafts expect `/intake?entity_id=<entity>&review=<intake-id>`
instead of the older `/intake?intake_id=<intake-id>` convention.

- [x] **Step 2: Return exact Smart Intake review links**

Change the `lease_change` promote response to include the same entity-aware
Smart Intake review URL used by Dashboard, Operations, and tenant detail
handoffs. No provider mutation or frontend routing change is required.

- [x] **Step 3: Verify lease-change promote parity**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_ai_triage_api.py::test_promote_lease_change_soft_fails_without_openai_key tests/integration/test_ai_triage_api.py::test_promote_lease_change_pre_extracts_fields_when_available -q
.venv/bin/ruff check apps/api/routers/ai.py tests/integration/test_ai_triage_api.py
git diff --check
```

Expected: pass.

## Task 73: Insights Smart Intake Link Parity

- [x] **Step 1: Add Insights live-exception URL regression**

Extend the Insights overview integration test so Smart Intake live exceptions
must link to `/intake?entity_id=<entity>&review=<intake-id>`.

- [x] **Step 2: Return entity-aware Insights handoffs**

Update the Insights overview Smart Intake exception href to include the current
entity id beside the review id, matching the rest of the exact-review handoff
work.

- [x] **Step 3: Verify Insights parity**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_insights_api.py::test_insights_overview_summarises_live_operations_without_leaking_tool_inputs -q
.venv/bin/ruff check apps/api/routers/insights.py tests/integration/test_insights_api.py
git diff --check
```

Expected: pass.

## Task 74: Property Workspace Intake Link Parity

- [x] **Step 1: Add property source-history URL regression**

Extend the property workspace source-trail smoke so the latest Smart Intake
history link must include both `entity_id` and `review`.

- [x] **Step 2: Harden property workspace handoffs**

Generate entity-aware Smart Intake review URLs for property document upload
redirects, the Source history header link, and the evidence drawer source
document link.

- [x] **Step 3: Verify property workspace parity**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "property workspace shows the evidence source trail"
cd apps/web && ./node_modules/.bin/eslint src/components/property-workspace.tsx tests/smoke/app-flows.spec.ts
cd apps/web && ./node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: pass.

## Task 75: Portfolio QA Intake Link Parity

- [x] **Step 1: Add Portfolio QA source-history URL regression**

Extend the Portfolio QA source-trail smoke so Smart Intake apply/source rows
must link to `/intake?entity_id=<entity>&review=<intake-id>`.

- [x] **Step 2: Harden Portfolio QA Smart Intake handoffs**

Generate entity-aware Smart Intake review URLs for property apply-history rows,
their evidence drawer source document links, open Smart Intake issue rows, and
standalone Smart Intake source rows.

- [x] **Step 3: Verify Portfolio QA parity**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "portfolio QA guides cleanup fixes and source trails"
cd apps/web && ./node_modules/.bin/eslint src/app/portfolio-qa/page.tsx tests/smoke/app-flows.spec.ts
cd apps/web && ./node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: pass.

## Task 76: Billing Readiness Intake Link Parity

- [x] **Step 1: Add Billing Readiness source URL regression**

Extend the Dashboard to Billing Readiness smoke so the Smart Intake source link
inside the billing draft review table must include both `entity_id` and
`review`.

- [x] **Step 2: Harden Billing Readiness Smart Intake handoffs**

Generate entity-aware Smart Intake review URLs for billing draft source links,
while preserving the review-only fallback when no entity is selected.

- [x] **Step 3: Verify Billing Readiness parity**

Run:

```bash
cd apps/web && PORT=3001 ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts --grep "dashboard shows the mocked portfolio and opens billing readiness"
cd apps/web && ./node_modules/.bin/eslint src/app/billing-readiness/page.tsx tests/smoke/app-flows.spec.ts
cd apps/web && ./node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: pass.

## Task 77: Twilio Inbound SMS Signature Guard

- [x] **Step 1: Add signed-webhook regressions**

Extend inbound SMS webhook coverage so, when `TWILIO_AUTH_TOKEN` is configured,
missing signatures are rejected before persistence and valid
`X-Twilio-Signature` headers are accepted, including signatures generated
against the configured public API URL behind a proxy.

- [x] **Step 2: Validate Twilio signatures before storage**

Compute Twilio's HMAC-SHA1 signature from the request/public URL plus sorted
form fields, compare with `secrets.compare_digest`, and keep the no-token
local/dev setup path unchanged.

- [x] **Step 3: Verify inbound SMS hardening**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_comms_api.py::test_twilio_inbound_webhook_persists_and_attributes_by_phone tests/integration/test_comms_api.py::test_twilio_inbound_webhook_rejects_missing_signature_when_token_configured tests/integration/test_comms_api.py::test_twilio_inbound_webhook_accepts_valid_signature_when_token_configured tests/integration/test_comms_api.py::test_twilio_inbound_webhook_accepts_public_api_url_signature -q
.venv/bin/ruff check apps/api/routers/comms.py tests/integration/test_comms_api.py
git diff --check
```

Expected: pass.

## Task 78: Tenant Onboarding Twilio Status Signature Guard

- [x] **Step 1: Add tenant status callback signature regressions**

Extend tenant-onboarding receipt coverage so, when `TWILIO_AUTH_TOKEN` is
configured, unsigned Twilio SMS status callbacks cannot move delivery receipts,
and signatures generated against the configured public API URL are accepted.

- [x] **Step 2: Authenticate tenant Twilio status callbacks**

Keep the existing `COMMUNICATIONS_WEBHOOK_SECRET` path, add Twilio
HMAC-SHA1 signature validation as an alternate provider-auth path, and fail
closed when a Twilio token is configured but neither path validates.

- [x] **Step 3: Verify tenant Twilio receipt hardening**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_twilio_status_rejects_unsigned_when_token_configured tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_twilio_status_accepts_public_api_url_signature -q
.venv/bin/ruff check apps/api/routers/tenant_onboarding.py tests/integration/test_tenant_onboarding_api.py
git diff --check
```

Expected: pass.

## Task 79: Maintenance And Work Twilio Status Signature Guards

- [x] **Step 1: Add remaining status callback signature regressions**

Extend maintenance contractor SMS and Work assignment SMS receipt coverage so,
when `TWILIO_AUTH_TOKEN` is configured, unsigned Twilio status callbacks cannot
move delivery receipts and signatures generated against `PUBLIC_API_URL` are
accepted.

- [x] **Step 2: Authenticate remaining Twilio status callbacks**

Keep the existing `COMMUNICATIONS_WEBHOOK_SECRET` path, add Twilio
HMAC-SHA1 signature validation as an alternate provider-auth path for both
callback endpoints, and fail closed when a Twilio token is configured but
neither path validates.

- [x] **Step 3: Verify maintenance and Work callback hardening**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/integration/test_maintenance_arrears_api.py::test_maintenance_work_order_sends_contractor_sms_and_records_receipt tests/integration/test_maintenance_arrears_api.py::test_maintenance_twilio_status_rejects_unsigned_when_token_configured tests/integration/test_maintenance_arrears_api.py::test_maintenance_twilio_status_accepts_public_api_url_signature tests/integration/test_maintenance_arrears_api.py::test_notification_center_can_send_assignment_notice_sms_without_clobbering_email tests/integration/test_maintenance_arrears_api.py::test_work_assignment_twilio_status_rejects_unsigned_when_token_configured tests/integration/test_maintenance_arrears_api.py::test_work_assignment_twilio_status_accepts_public_api_url_signature -q
.venv/bin/ruff check apps/api/routers/maintenance.py apps/api/routers/work_assignment_notifications.py tests/integration/test_maintenance_arrears_api.py
git diff --check
```

Expected: pass.

## Task 80: Shared Twilio Webhook Auth Helper

- [x] **Step 1: Add helper-level auth coverage**

Add focused unit coverage for the shared webhook secret helper and Twilio
signature helper, including signatures generated against `PUBLIC_API_URL`.

- [x] **Step 2: Consolidate callback signature checks**

Move the duplicated shared-token and Twilio HMAC-SHA1 verification logic into
`apps/api/webhook_auth.py`, then have comms, tenant onboarding, maintenance,
and Work assignment callback handlers call the shared helper while preserving
their existing fail-open local/dev path when provider secrets are not
configured.

- [x] **Step 3: Refresh callback verification**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/unit/test_webhook_auth.py tests/integration/test_comms_api.py::test_twilio_inbound_webhook_persists_and_attributes_by_phone tests/integration/test_comms_api.py::test_twilio_inbound_webhook_rejects_missing_signature_when_token_configured tests/integration/test_comms_api.py::test_twilio_inbound_webhook_accepts_valid_signature_when_token_configured tests/integration/test_comms_api.py::test_twilio_inbound_webhook_accepts_public_api_url_signature tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_twilio_status_rejects_unsigned_when_token_configured tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_twilio_status_accepts_public_api_url_signature tests/integration/test_maintenance_arrears_api.py::test_maintenance_work_order_sends_contractor_sms_and_records_receipt tests/integration/test_maintenance_arrears_api.py::test_maintenance_twilio_status_rejects_unsigned_when_token_configured tests/integration/test_maintenance_arrears_api.py::test_maintenance_twilio_status_accepts_public_api_url_signature tests/integration/test_maintenance_arrears_api.py::test_notification_center_can_send_assignment_notice_sms_without_clobbering_email tests/integration/test_maintenance_arrears_api.py::test_work_assignment_twilio_status_rejects_unsigned_when_token_configured tests/integration/test_maintenance_arrears_api.py::test_work_assignment_twilio_status_accepts_public_api_url_signature -q
.venv/bin/ruff check apps/api/webhook_auth.py apps/api/routers/comms.py apps/api/routers/tenant_onboarding.py apps/api/routers/maintenance.py apps/api/routers/work_assignment_notifications.py tests/unit/test_webhook_auth.py tests/integration/test_comms_api.py tests/integration/test_tenant_onboarding_api.py tests/integration/test_maintenance_arrears_api.py
git diff --check
```

Expected: pass.

## Task 81: Shared SendGrid Webhook Secret Guard

- [x] **Step 1: Add helper-level assertion coverage**

Extend `apps/api/webhook_auth.py` coverage so the shared webhook-token helper
also exposes the 401 assertion shape used by SendGrid receipt callbacks.

- [x] **Step 2: Consolidate SendGrid receipt secret checks**

Have invoice delivery, operator invite, tenant onboarding, maintenance
contractor, and Work assignment SendGrid receipt endpoints call the shared
webhook-token helper while preserving the current local/dev path when no
`COMMUNICATIONS_WEBHOOK_SECRET` is configured.

- [x] **Step 3: Add endpoint guard coverage**

Add focused integration coverage proving that each SendGrid receipt endpoint
rejects missing shared tokens when configured and still accepts the configured
`x-leasium-webhook-secret` header.

- [x] **Step 4: Verify SendGrid receipt hardening**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/unit/test_webhook_auth.py tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_sendgrid_receipt_updates_delivery_data tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_sendgrid_receipt_requires_configured_secret tests/integration/test_document_intake_api.py::test_document_intake_apply_invoice_prepares_billing_work tests/integration/test_document_intake_api.py::test_invoice_sendgrid_receipt_requires_configured_secret tests/integration/test_security_api.py::test_operator_invite_sendgrid_receipt_updates_member_status tests/integration/test_security_api.py::test_operator_invite_sendgrid_receipt_requires_configured_secret tests/integration/test_maintenance_arrears_api.py::test_maintenance_work_order_sends_contractor_email_and_records_receipt tests/integration/test_maintenance_arrears_api.py::test_maintenance_sendgrid_receipt_requires_configured_secret tests/integration/test_maintenance_arrears_api.py::test_notification_center_can_retry_assignment_notice_email tests/integration/test_maintenance_arrears_api.py::test_work_assignment_sendgrid_receipt_requires_configured_secret tests/integration/test_maintenance_arrears_api.py::test_work_assignment_digest_delivery_requires_approval_and_records_receipts -q
.venv/bin/ruff check apps/api/webhook_auth.py apps/api/routers/charge_rules.py apps/api/routers/security.py apps/api/routers/tenant_onboarding.py apps/api/routers/maintenance.py apps/api/routers/work_assignment_notifications.py tests/unit/test_webhook_auth.py tests/integration/test_tenant_onboarding_api.py tests/integration/test_document_intake_api.py tests/integration/test_security_api.py tests/integration/test_maintenance_arrears_api.py
git diff --check
```

Expected: pass.

## Task 82: DocuSign Webhook Secret Helper Alignment

- [x] **Step 1: Add provider-header helper coverage**

Extend the shared webhook-token helper so callers can declare provider-specific
header aliases while preserving `x-leasium-webhook-secret` and `token` support.

- [x] **Step 2: Move DocuSign webhook auth onto the helper**

Have `POST /tenant-onboarding/webhooks/docusign` use the shared helper with
`x-docusign-webhook-secret` and `x-leasium-webhook-secret` header aliases,
while keeping the fail-closed "secret not configured" behavior.

- [x] **Step 3: Verify DocuSign auth parity**

Run:

```bash
OPENAI_API_KEY= .venv/bin/python -m pytest tests/unit/test_webhook_auth.py tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_docusign_webhook_rejects_unconfigured_secret tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_docusign_webhook_rejects_invalid_secret tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_docusign_webhook_accepts_shared_secret_header tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_docusign_webhook_records_declined_envelope tests/integration/test_tenant_onboarding_api.py::test_tenant_onboarding_docusign_webhook_marks_lease_signed -q
.venv/bin/ruff check apps/api/webhook_auth.py apps/api/routers/tenant_onboarding.py tests/unit/test_webhook_auth.py tests/integration/test_tenant_onboarding_api.py
git diff --check
```

Expected: pass.
