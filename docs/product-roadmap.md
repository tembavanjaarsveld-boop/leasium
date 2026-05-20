# Leasium Product Roadmap

Last updated: 2026-05-21

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
- [x] Spreadsheet portfolio import dry-run v1: `.xlsx` source-of-truth workbooks can be parsed into a no-mutation import plan for properties, units, tenants, leases, charge rules, obligations, and operational tasks, with row-level blockers/warnings and feature-candidate flags for vendors, legal entities, head leases, security originals, arrears, and issue/action queues.
- [x] Spreadsheet portfolio Smart Intake review/apply v1: spreadsheet import plans now surface reviewable row actions in Smart Intake, require explicit approved action IDs before Apply, and store workbook filename, sheet, row, action ID, source hint, confidence, and before/after provenance on created/updated records. Pending Remba review.
- [x] Spreadsheet import plan durability v1: dry-runs now persist a server-side review plan ID, Smart Intake Apply can use the stored plan instead of trusting browser-sent action rows, and applied plans keep the approved/ignored IDs plus apply result for audit. New migration: `20260521_0020_register_import_plans`.
- [x] One-off SKJ portfolio workbook production import: the current source-of-truth workbook has been loaded into the hosted register with real properties, units, tenants, leases, charge rules, and obligations, while demo seed rows were archived.
- [x] Post-import Portfolio QA workspace v1: `/portfolio-qa` brings together missing-field checks, tenant contact cleanup, source/import history, batch onboarding readiness, and internal billing draft preparation from the imported portfolio. Portfolio QA now has a primary navigation entry for pre-production cleanup, with final IA still pending Remba review.
- [x] Charge-rule billing draft batch v1: reviewed rent/outgoings charge rules can generate source-linked internal billing drafts and line items with idempotent same-period reuse, synthetic prep source documents, and explicit no-PDF/no-email/no-Xero guardrails.
- [x] Xero posting approval and draft creation v1: approved invoice drafts can receive explicit local Xero posting approval, then create provider-backed Xero draft invoices idempotently when credentials and preview validation pass; unconfigured/provider-missing states are safe skips, and no Xero write runs without approval.
- [x] Xero payment reconciliation v1: provider/imported payment statuses can be previewed and applied to local invoice metadata with idempotency keys, preserving review/audit history and avoiding duplicate reconciliation.
- [x] Xero payment reconciliation review surface v1: Settings now previews provider payment statuses, shows current/proposed local invoice payment metadata, applies a fresh provider pull into Leasium payment metadata only, and keeps Xero/bank mutation guardrails visible. Pending Remba review.
- [x] Xero operator approval UI v1: Settings now turns the provider posting preview into an explicit operator workflow with per-invoice Xero approval/revoke actions, separate batch draft creation, created/skipped/blocked/failed result panels, and guardrails that keep tenant email and payment reconciliation separate. Pending Remba review.
- [x] Provider-backed invoice email delivery v1: approved internal invoice drafts can send the prepared invoice email through SendGrid when configured, attach the stored PDF artifact, record queued/skipped/failed provider receipts, and keep Xero sync as a separate approval.
- [x] Provider invoice dispatch v1: approved invoice drafts can run an explicit combined provider action that creates or reuses the Xero DRAFT first, sends or reuses the SendGrid invoice email second, preserves Xero sync state across email delivery, and leaves payment reconciliation separate.
- [x] Provider dispatch receipts and recovery v1: Xero draft-create/dispatch attempts now persist provider receipts, failed attempts keep retry-safe approval state, dispatch responses include next-action hints, Billing Readiness exposes per-invoice Dispatch/Retry actions, and SendGrid invoice webhooks can record delivered/opened/failed email receipts without changing Xero sync state. Pending Remba review.
- [x] Billing provider history filters v1: Billing Readiness Delivery & payments now filters approved invoice drafts by all/needs action/ready to dispatch/complete/unpaid and shows per-invoice provider history for Xero dispatch attempts plus local payment reconciliation receipts. Pending Remba review.
- [x] Xero sync exception queue v1: Settings now has a read-only local exception queue for connection/mapping blockers, approved-unsynced invoice drafts, failed Xero provider receipts, and payment reconciliation candidates, with guardrails confirming the queue does not refresh tokens or mutate Xero. Pending Remba review.
- [x] Xero sync exception guided actions v1: Settings exception rows now show explicit operator actions for connection, mapping, invoice posting review, provider delivery recovery, and payment reconciliation, reusing the existing review-first Xero/charge-rule flows instead of adding hidden background sync. Pending Remba review.
- [x] Tenant portal self-service v1: `/tenant-portal/[token]` exposes token-scoped tenant onboarding status, lease context, approved invoices/payment summary, document download/upload, compliance status, and notification preferences without operator-only metadata. True tenant identity-provider auth remains future work.
- [x] Maintenance work orders v1: migration-backed work orders now track tenant/property/lease scope, priority, status, contractor assignment, approvals, photos/documents, invoice/source references, soft delete, and audit history.
- [x] Arrears and credit-control v1: migration-backed arrears cases now track aged balances, reminder cadence, dispute status, promise-to-pay notes, escalation queue/status, soft delete, and audit history.
- [x] Operations workspace v1: the former Tasks entry now opens `/operations`, preserving the triage queue while adding Maintenance and Arrears tabs, KPI cards, quick-create panels, approval/start/complete actions for work orders, and reminder/escalation/resolve actions for arrears. Pending Remba review.
- [x] Tenant portal maintenance requests v1: token-scoped tenants can submit maintenance requests from `/tenant-portal/[token]`, see prior portal-submitted requests, attach scoped tenant documents through the API, and create linked Operations work orders without exposing operator-only fields. Pending Remba review.
- [x] Operations maintenance detail v1: maintenance work orders now keep compact activity history, expose quote/approval/contractor/invoice context in an expandable Operations detail panel, link approved invoice drafts, and show portal-safe maintenance request history back to tenants. Pending Remba review.
- [x] Tenant portal account foundation v1: tenants can claim a durable portal account with a signed bearer identity plus an existing portal token, then use bearer-only `/tenant-portal/account/session` for the same scoped self-service data while existing public token links remain available. New migration: `20260520_0019_tenant_portal_accounts`.
- [x] Tenant portal account UI v1: `/tenant-portal/[token]` now shows a Clerk-backed Account Access panel, lets signed-in tenants link the portal once, reloads matching tenants through the account session, and uses bearer auth for account-scoped maintenance requests, document uploads, and notification preferences while preserving token fallback. Pending Remba review.
- [x] Tenant portal maintenance photo upload v1: tenants can attach an inline photo while submitting a maintenance request; the portal stores the photo as a tenant document first, sends its source-linked document ID with the request, shows attached file counts in the portal history, and supports both token and account-scoped auth paths. Pending Remba review.
- [x] Tenant portal account-only entry v1: linked tenants can open `/tenant-portal` or `/tenant-portal/account` without the original token URL, sign in through the tenant account boundary, load the same scoped portal data, and download account-scoped documents through bearer-backed blob downloads. Pending Remba review.
- [x] Tenant portal notification preference receipts v1: saving notification preferences now returns a visible timestamped receipt with the resulting preferred channel, while preserving the no-message-sent guardrail and account/token auth paths. Pending Remba review.
- [x] Tenant portal document provenance/actions v1: tenant-facing document rows now show filename, category, size, source, received timestamp, notes, and an explicit download action for both token and account-scoped portal sessions. Pending Remba review.
- [x] Tenant portal account lifecycle guidance v1: signed-in tenant accounts now have a bearer-backed lifecycle status check, clearer unlinked/revoked/wrong-tenant recovery copy, durable-access guidance after invite expiry, and smoke coverage for relink guidance. Pending Remba review.
- [x] Tenant portal operator access controls v1: tenant detail now lists linked tenant portal accounts, lets operators revoke blocked access or unlink for clean relinking, stores reason/audit metadata, and keeps the unlink path relink-safe. Pending Remba review.
- [x] Tenant portal account recovery receipts v1: operator revoke/unlink/restore actions now keep compact recovery receipts, tenant detail shows the latest staff recovery receipt, revoked accounts can be restored without a fresh link, and tenant account status confirms unlinked/restored recovery state. Pending Remba review.
- [x] Tenant portal fresh-link recovery v1: staff can rotate and resend/copy a fresh portal link for sent onboarding rows, expired tokens stop opening, completed public onboarding can no longer be resubmitted or mutated from the public link, and tenant/profile/property/Portfolio QA surfaces avoid copying stale links. Pending Remba review.
- [x] Operations work-order detail route v1: maintenance rows now open a dedicated work-order page with status, contractor, quote approval, invoice linking, activity history, linked evidence downloads, and contractor quote document upload through the existing document store. Pending Remba review.
- [x] Operations work-order comments v1: the dedicated work-order page now supports structured internal/contractor/tenant comments, stores them in work-order metadata with activity history and audit receipts, and keeps them visible in the work-order timeline. Pending Remba review.
- [x] Tenant-safe maintenance history v1: tenant portal maintenance timelines now show tenant-submitted events and explicitly tenant-visible operator comments only, hiding internal and contractor-only activity while keeping operator work-order history intact. Pending Remba review.
- [x] Maintenance invoice handoff polish v1: work-order detail now renders quote/evidence metadata as a clearer preview list and shows linked invoice draft status, payment state, delivery readiness, preview/PDF actions, and existing prepare/approve controls without adding new persistence. Pending Remba review.
- [x] UX command-center IA pass v1: primary navigation now groups the app around Dashboard, Smart Intake, Portfolio, Work, Billing, Insights, and Settings; Portfolio QA remains discoverable through command search, Dashboard has a ranked daily command center across reviews/billing/onboarding/operations, Billing Readiness uses plain-English billing-run tabs, the Property workspace avoids duplicating the global Work label, and property source history now uses a reusable evidence/source-trail pattern. Pending Remba review.

## Next Build Order

- [ ] Apply the new `20260520_0018_maintenance_arrears_foundations`, `20260520_0019_tenant_portal_accounts`, and `20260521_0020_register_import_plans` migrations in hosted Neon/Render if auto-migrations do not run.
- [ ] Remba review the new Smart Intake spreadsheet import panel, simplified navigation/command center, Portfolio QA command-search placement, reusable evidence/source-trail pattern, tenant portal, tenant fresh-link recovery, invoice email action, and Operations workspace before treating them as UX complete.
- [ ] Continue Operations polish with contractor communications, maintenance invoice exception recovery, and clearer handoff rules between Operations and Billing Readiness.
- [ ] Continue Xero from guided sync exceptions into bank-feed reconciliation depth, accounting snapshot guardrails, and clearer per-invoice handoff between Settings and Billing Readiness.
- [ ] Deepen Portfolio QA cleanup into guided fix flows for contact enrichment, missing owner/billing data, onboarding batch creation, and import-source history.
- [ ] Add branded template management, delivery preview/versioning, and provider receipt configuration for invoice delivery and tenant portal communications.

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

- [ ] Maintenance and arrears workflow depth: tenant-submitted requests, contractor coordination, approval history, invoice linking, legal/escalation notes, and portal-visible status where appropriate.
- [ ] Compliance and inspections: recurring checks, certifications, document expiry, fire/safety obligations, delegated owners, and audit trail.
- [ ] Tenant portal account lifecycle: invite renewal handling, tenant-side account recovery, multi-login management, and change-email support.
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
