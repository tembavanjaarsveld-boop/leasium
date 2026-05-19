# Leasium Product Roadmap

Last updated: 2026-05-19

Leasium is being shaped around a simple operating promise: documents should turn into work with as little re-keying as possible. Drop the contract, lease, invoice, certificate, or guarantee; Leasium reads it, matches it to the portfolio, suggests the changed fields, and only asks a human to review and approve.

Design-facing changes require Remba UX sign-off. See [design-governance.md](design-governance.md).

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

## Next Build Order

- [ ] Continue AI apply beyond lease and billing-prep workflows: acquisition/building contracts create or update property/unit records; billing prep graduates into true draft charge/invoice records; lease apply gains deeper source citations and before/after audit detail.
- [ ] Finish tenant onboarding delivery: real email sending, branded templates, resend logs, expiry messaging, and delivery audit history.
- [ ] Deepen tenant detail: property/lease context labels, richer activity history, safer document provenance/actions, and reviewed-change history.
- [ ] Expand billing from readiness into invoice generation: rent periods, line items, invoice drafts, approval, PDF/email delivery, and payment status.
- [ ] Add Xero connection status, chart of accounts/tax mapping, contact sync, invoice sync, and payment reconciliation.
- [ ] Deepen Insights dashboards: portfolio health, live exceptions, automation activity, billing risk, owner/entity snapshots, and shareable snapshots generated from dashboard data.

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
