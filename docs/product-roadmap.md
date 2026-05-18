# Leasium Product Roadmap

Last updated: 2026-05-19

Leasium is being shaped around a simple operating promise: lease data should turn into work with as little re-keying as possible. Upload the lease, confirm the facts, invite the tenant, set the billing rules, then let the system drive dates, invoices, maintenance, compliance, and reporting.

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

## Next Build Order

- [ ] Finish tenant onboarding delivery: real email sending, branded templates, resend logs, expiry messaging, and tenant-facing upload fields.
- [ ] Deepen tenant detail: property/lease context labels, document uploads, richer activity history, and cleaner submitted-change review UI.
- [ ] Expand billing from readiness into invoice generation: rent periods, line items, invoice drafts, approval, PDF/email delivery, and payment status.
- [ ] Add Xero connection status, chart of accounts/tax mapping, contact sync, invoice sync, and payment reconciliation.
- [ ] Add document storage for leases, insurance certificates, guarantees, onboarding attachments, and generated invoices.
- [ ] Replace temporary tunnels with a stable demo environment and production deployment path.

## Re-Leased Benchmark

Official Re-Leased pages position their product around a few mature modules that should guide Leasium's backlog:

- Xero/accounting: two-way sync for contacts, invoices, bills, credit notes, accounts, tracking categories, and tax rates, with Re-Leased handling lease logic and Xero handling accounting. Source: https://www.re-leased.com/product/xero
- Tenant portal: tenants can view lease details, invoices, documents, rent status, maintenance, compliance, and payment history from a browser portal. Source: https://www.re-leased.com/tenant-portal
- Maintenance and compliance: work orders, contractor coordination, preventive tasks, inspections, audit trails, and lease-driven obligations. Source: https://www.re-leased.com/product/property-operations-maintenance
- Reporting: pre-built and flexible reporting across lease performance, financial operations, arrears, maintenance, and portfolio analytics. Source: https://www.re-leased.com/product/property-management-reporting
- API/integrations: REST API coverage for properties, leases, contacts, invoices, maintenance, inspections, dashboards, and communication tools. Source: https://www.re-leased.com/product/apis

## Later Modules

- [ ] Arrears and credit control: aged balances, reminder schedules, promise-to-pay notes, dispute status, and escalation queues.
- [ ] Maintenance work orders: tenant requests, photos, priorities, contractor assignment, quotes, approvals, invoices, and status updates.
- [ ] Compliance and inspections: recurring checks, certifications, document expiry, fire/safety obligations, delegated owners, and audit trail.
- [ ] Tenant portal: authenticated self-service for onboarding, documents, invoices, maintenance, compliance uploads, and notification preferences.
- [ ] Portfolio reporting: rent roll, lease events, arrears, invoice status, maintenance aging, compliance expiry, and owner/entity dashboards.
- [ ] Communications hub: email templates, outbound logs, tenant/contractor threads, and record-linked correspondence.
- [ ] Approvals and workflow: invoice approval, maintenance spend approval, delegated tasks, reminders, escalation rules, and activity history.
- [ ] Mobile/field workflows for inspections, photos, quick notes, and work order updates.

## UX Principles

- Remba signs off any design-facing navigation, layout, workflow, copy, or visual hierarchy change before it is treated as complete.
- Keep first actions obvious: upload a lease, add a property, invite a tenant, add a charge.
- Prefer review screens and status panels over hidden configuration.
- Make blockers plain English, with the next corrective action beside the blocker.
- Avoid forcing users through accounting concepts until they are needed for invoice readiness.
- Every module should reduce a spreadsheet, email chase, or duplicate entry job.
