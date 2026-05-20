# Leasium Product Roadmap

Last updated: 2026-05-20

Leasium is being shaped around a simple operating promise: documents should turn into work with as little re-keying as possible. Drop the contract, lease, invoice, certificate, or guarantee; Leasium reads it, matches it to the portfolio, suggests the changed fields, and only asks a human to review and approve.

Design-facing changes require Remba UX sign-off. See [design-governance.md](design-governance.md) and the brand/frontend source of truth in [leasium-codex-design-source-of-truth.md](leasium-codex-design-source-of-truth.md).

## Built

- [x] Multi-entity foundation with organisation, entity, property, tenancy unit, tenant, lease, and obligation registers.
- [x] Entity-scoped roles, audit logging, dev auth, and Clerk adapter boundary.
- [x] Leasium rebrand with basic logo mark, palette, API app name, and web metadata.
- [x] Lease upload intake for PDF, DOCX, text, and Markdown files.
- [x] AI lease extraction into editable property, unit, tenant, lease, and obligation data.
- [x] Lease intake apply flow that creates register records only after review.
- [x] Friendly stale entity/property recovery in the dashboard.
- [x] Tenant onboarding links with public web form and tenant record update on submit.
- [x] Billing-readiness slice: charge rules, rent roll API, readiness blockers, and dashboard panel.
- [x] Lease intake matching: reuse existing property, unit, and tenant records from the review step.
- [x] Lease intake apply validation for missing critical fields and overlapping unit lease ranges.
- [x] Asynchronous lease intake extraction with upload returning immediately and review polling for completion.
- [x] Tenant onboarding cancellation so stale public links can be retired and recreated.
- [x] Navigation split: dashboard home, property operations page, and tenant register page.
- [x] Tenant workspace upgrade: onboarding command center, status filters, prioritized queue, and tenant profile route.
- [x] Property workspace task-zone split: `/properties` now separates Portfolio, Operations, Billing, and Documents, and property create/edit opens in a focused overlay instead of an always-visible side rail.
- [x] Billing Readiness task-zone split: `/billing-readiness` now separates Readiness, Billing drafts, Invoice prep, and Delivery & payments, with the blocker action queue and no-posting/no-Xero guardrails kept visible.
- [x] Managed onboarding backend workflow: expiry, resend, cancel reason, review, apply, and audit-friendly timestamps.
- [x] Public tenant onboarding refresh: property/unit context, guided sections, notes field, clearer reset/submit states, and next-step reassurance.
- [x] Stable hosted demo path: Vercel frontend, Render API, Neon Postgres, CORS, seeded data, and no temporary tunnel dependency.
- [x] MVP tenant document storage: upload, list, download, soft-delete, and tenant profile UI for insurance, guarantees, leases, invoices, and onboarding files.
- [x] Tenant onboarding uploads and review-first apply: public token document uploads, staff review documents, labelled submitted details, and no profile mutation before Apply.
- [x] Smart Intake Inbox first slice: dashboard drag/drop, stored source document, generic AI classification/extraction envelope, review status queue, summary groups, confidence, warnings, and no automatic record mutation.
- [x] Focused Smart Intake review surface: approve/edit/ignore item decisions, visible confidence and source hints, ignored-item filtering, insurance apply target matching, and explicit change summary before Apply.
- [x] Smart Intake document-to-task apply: approved certificates, compliance docs, bank guarantees, and notices create scoped obligations/tasks, link the source document, and show a calm post-apply outcome.
- [x] Smart Intake lease apply: reviewed lease documents can create/reuse property, unit, tenant, lease, source document links, and lease obligations through an Apply plan that keeps humans in control.
- [x] Smart Intake billing prep: reviewed invoice/admin documents prepare source-linked billing review tasks with money context and clear no-invoice/no-Xero-sync guardrails.
- [x] Smart Intake acquisition apply: reviewed purchase contracts can create or link property records, optionally create/link reviewed units, attach the source document, and create milestone tasks without posting financials.
- [x] Smart Intake acquisition tenancy schedule v1: purchase contracts can extract reviewed schedule rows, create/link multiple units, preserve tenant/rent/lease facts on unit provenance metadata, create pending tenant/lease records for complete reviewed rows after Apply, generate lease expiry/rent review/option/security tasks, and seed draft-marked base rent/outgoings charge rules from reviewed rows.
- [x] Smart Intake acquisition tenancy schedule v2: reviewed rows can now capture parking, storage, utilities, promotion levy, and other charge amounts; Apply creates draft-marked non-rent charge rules, skips invalid rows with clearer blockers, and the post-apply outcome surfaces pending lease IDs, draft charge detail, and skipped schedule rows.
- [x] Smart Intake billing drafts v1: reviewed invoice/admin documents now create source-linked draft billing documents and lines, support reviewed draft status updates, and preserve the no-posting/no-Xero-sync guardrail.
- [x] Billing draft review surface: Billing Readiness now lists source-linked Smart Intake billing drafts with status, due date, amount, source context, and approve/void actions that still do not post invoices, email tenants, or sync to Xero.
- [x] Invoice draft staging v1: approved billing drafts can create internal source-linked invoice drafts and lines, surface recipient/readiness blockers in Billing Readiness, and preserve no-PDF/no-email/no-Xero-sync guardrails.
- [x] Invoice draft delivery preparation v1: internal invoice drafts can prepare an approval-safe invoice preview and tenant email draft metadata, show delivery blockers, move complete drafts to ready for approval, and keep PDF storage, tenant sending, and Xero sync explicitly off.
- [x] Invoice generation and delivery v1: internal invoice drafts now store source-linked PDF artifacts, keep branded email draft metadata, record manual tenant delivery receipts after approval, maintain approval-safe posting preparation, and track unpaid/part-paid/paid status with no Xero sync.
- [x] Smart Intake naming pass: global navigation and workspace copy now reflect the broader document-first workflow instead of lease-only inbox wording.
- [x] Smart Intake task queue: open document reviews, match issues, processing states, and failed reads now appear in Tasks with a dedicated filter and deep links back to Smart Intake.
- [x] Smart Intake applied outcome counts: the applied outcome panel now surfaces returned billing draft, pending lease, and draft charge counts from the backend apply result.
- [x] Tenant onboarding delivery foundation: Twilio SendGrid email and Twilio SMS delivery are wired into create/resend with channel status, audit logs, and safe skipped states when a channel is not configured.
- [x] Tenant onboarding reminders and receipts v1: reminder schedules, manual due-reminder runner, SendGrid/Twilio receipt ingestion, delivery timeline, and contact-fix actions.
- [x] Tenant onboarding delivery polish v1: outbound delivery stores brand/template metadata, reminder schedules can be edited through the API, expiry reminders are scheduled before link expiry, and contact/configuration recovery hints stay visible.
- [x] Tenant detail deepening v1: tenant detail now has property/unit/lease context, richer activity history, safer document provenance/actions, reviewed onboarding change history, and public-fact enrichment suggestions.
- [x] Public AI enrichment v1: property and tenant records can request safe public facts such as ABN, suburb/state/postcode, registered names, and registered addresses from trusted web sources, show citation/confidence, and apply only reviewed suggestions.
- [x] Property ownership and billing identity: owner/trust/split profile fields, quiet property-level chips, collapsible setup, billing-readiness blockers, and Smart Intake extraction/apply support.
- [x] Smart Intake property provenance v1: purchase contract applies now store source citations, before/after property field changes, apply history, and property audit logs.
- [x] Smart Intake property provenance UI: purchase-contract apply outcomes show property before/after changes, and the Property workspace surfaces stored field citations, latest apply history, confidence, and deep links back to the source intake.
- [x] Temporary private-beta access gate: Vercel frontend supports an env-controlled password screen while tenant onboarding links remain publicly reachable.
- [x] Operator security and settings arena v1: Settings now has Security, Organisation, and Xero sections; `/api/v1/me` and `/api/v1/security/workspace` expose the current operator, organisation, roles, auth boundary, and members; owner/admin users can add operator access records, adjust entity roles, and activate/deactivate teammates over the existing user/entity-role foundation.
- [x] Operator invite and Clerk linking v1: owner/admin users can send SendGrid-backed operator invite emails, invite links are stored as hashed one-time tokens with expiry/status, `/accept-invite` links a signed-in Clerk user to the existing Leasium operator record, and backend Clerk mode can verify sessions against JWKS before mapping the Clerk subject to `app_user.auth_provider_id`.
- [x] First workspace setup foundation: clean Clerk-backed databases can create the first organisation, entity, and owner operator through a reviewable `/setup` flow, and Clerk mode now fails closed unless JWKS verification is configured or an explicit legacy test flag is enabled.
- [x] Operator workspace sign-in guard: when Clerk server and publishable keys are configured, middleware redirects signed-out protected workspace requests to operator sign-in before dashboard/API loading; the client shell also shows a friendly sign-in required state, while public onboarding, setup, invite, and access-gate routes remain open.
- [x] Production operator-login rollout: the first operator invite/account has been linked, Vercel protected routes redirect signed-out users to Clerk sign-in, tenant onboarding remains public, and the Render API now enforces Clerk bearer tokens for protected workspace APIs.
- [x] Xero readiness and mapping v1: Settings now surfaces entity connection state, contact readiness, chart/account mapping gaps, tax mapping gaps, approved invoice sync queues, and payment reconciliation counts, with suggested charge-rule mappings and no live Xero posting.
- [x] Xero provider connection foundation v1: Settings can start a Xero OAuth connection, the API stores encrypted provider tokens in a per-entity connection record, records the selected Xero organisation, and can run a provider-backed contact sync preview that suggests tenant/property matches without applying mappings, posting invoices, or reconciling payments.
- [x] Reviewed local Xero contact mapping apply: provider contact preview suggestions can now be applied locally after review through an explicit apply-preview contract, with skipped mappings and no invoice posting, tenant email, or payment reconciliation side effects. Pending Remba review.
- [x] Provider-backed Xero chart/tax validation preview: `/api/v1/xero/chart-tax/validate-preview/{entity_id}` can validate local charge-rule account and tax mappings against provider chart/tax settings, returning checked-rule totals, per-rule results, and guardrails without invoice posting or payment reconciliation. Pending Remba review.
- [x] Provider-backed Xero invoice posting preview: `/api/v1/xero/invoices/posting-preview/{entity_id}` prepares reviewed Xero draft invoice payloads and blocker lists for approved unsynced invoice drafts, with provider contact/chart/tax checks and no invoice posting, tenant email, Xero mutation, or payment reconciliation. Pending Remba review.
- [x] Insights overview v1: the Insights workspace now has a read-only backend overview for portfolio health, live exceptions, automation activity, billing risk, and owner/entity snapshots, with no record mutation, invoice posting, or Xero sync.
- [x] Shareable Insights snapshots v1: operators can freeze owner, finance, and lease-event snapshots from the live Insights overview into revocable public links with hashed tokens, expiry, public read-only rendering, and no live portfolio mutation.

## Next Build Order

- [ ] Continue provider-backed Xero from invoice posting preview into explicit posting approval, idempotent Xero draft creation, and then payment reconciliation.
- [ ] Add provider-backed invoice email delivery and Xero posting approvals on top of the internal invoice draft/PDF/payment workflow.
- [ ] Build tenant portal authentication and self-service for onboarding, documents, invoices, compliance uploads, and notification preferences.
- [ ] Add maintenance work orders with tenant requests, photos, priorities, contractor assignment, approvals, invoices, and status tracking.
- [ ] Start arrears and credit control with aged balances, reminder schedules, dispute status, promise-to-pay notes, and escalation queues.

## Smart Intake North Star

Smart Intake is the primary Leasium workflow: users drag documents into the platform and Leasium creates a reviewable work item. The system should classify the file, extract structured facts, match existing records, highlight proposed changes, show confidence and blockers in plain English, then apply updates only after approval. Manual forms stay available, but the default path is upload, review, approve.

Target document jobs:

- New building or acquisition: purchase contract, disclosure pack, title, tenancy schedule, and management handover files become property, unit, tenant, lease, document, and obligation drafts.
- New tenant lease: lease PDF/DOCX becomes tenant, lease, rent, option, security, outgoings, insurance, and critical date drafts.
- Tenant onboarding: insurance certificates, guarantees, and supporting documents attach to the onboarding and update expiry/security fields after review.
- Billing/admin: invoices, rent schedules, outgoings budgets, and Xero-ready details become invoice or charge-rule drafts.
- Compliance: certificates, fire/safety reports, insurance renewals, and inspection reports become document records plus recurring obligations.

## Re-Leased Benchmark

Official Re-Leased pages position their product around a few mature modules that should guide Leasium's backlog:

- Xero/accounting: two-way sync for contacts, invoices, bills, credit notes, accounts, tracking categories, and tax rates, with Re-Leased handling lease logic and Xero handling accounting. Source: https://www.re-leased.com/product/xero
- Tenant portal: tenants can view lease details, invoices, documents, rent status, maintenance, compliance, and payment history from a browser portal. Source: https://www.re-leased.com/tenant-portal
- Maintenance and compliance: work orders, contractor coordination, preventive tasks, inspections, audit trails, and lease-driven obligations. Source: https://www.re-leased.com/product/property-operations-maintenance
- Insights and shareable snapshots: live dashboards should come first, with owner and finance snapshots generated from the same lease performance, financial operations, arrears, maintenance, and portfolio analytics data. Source benchmark: https://www.re-leased.com/product/property-management-reporting
- API/integrations: REST API coverage for properties, leases, contacts, invoices, maintenance, inspections, dashboards, and communication tools. Source: https://www.re-leased.com/product/apis

## Later Modules

- [ ] Arrears and credit control: aged balances, reminder schedules, promise-to-pay notes, dispute status, and escalation queues.
- [ ] Maintenance work orders: tenant requests, photos, priorities, contractor assignment, quotes, approvals, invoices, and status updates.
- [ ] Compliance and inspections: recurring checks, certifications, document expiry, fire/safety obligations, delegated owners, and audit trail.
- [ ] Tenant portal: authenticated self-service for onboarding, documents, invoices, maintenance, compliance uploads, and notification preferences.
- [ ] Portfolio Insights: rent roll health, lease events, arrears, invoice status, maintenance aging, compliance expiry, owner/entity dashboards, and shareable snapshots.
- [ ] Communications hub: email templates, outbound logs, tenant/contractor threads, and record-linked correspondence.
- [ ] Approvals and workflow: invoice approval, maintenance spend approval, delegated tasks, reminders, escalation rules, and activity history.
- [ ] Mobile/field workflows for inspections, photos, quick notes, and work order updates.

## UX Principles

- Remba signs off any design-facing navigation, layout, workflow, copy, or visual hierarchy change before it is treated as complete.
- Keep first actions obvious: upload a lease, add a property, invite a tenant, add a charge.
- Prefer document-first workflows over manual field entry whenever a source document exists.
- Every extracted field needs provenance: which document, where it came from, confidence, and what will change.
- Prefer review screens and status panels over hidden configuration.
- Make blockers plain English, with the next corrective action beside the blocker.
- Avoid forcing users through accounting concepts until they are needed for invoice readiness.
- Every module should reduce a spreadsheet, email chase, or duplicate entry job.
- Prefer live dashboards and exception queues over static report pages; exports should be generated from dashboards when needed.
