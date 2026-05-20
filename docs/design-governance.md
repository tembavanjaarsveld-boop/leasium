# Leasium Design Governance

Last updated: 2026-05-21

Design source of truth: [leasium-codex-design-source-of-truth.md](leasium-codex-design-source-of-truth.md). Use it for brand, tokens, component styling, app shell expectations, copy tone, and frontend implementation direction. This governance file records Remba review gates and sign-off status.

Remba is the required UX sign-off for design-facing changes. Any change that affects navigation, page layout, forms, density, interaction flow, dashboard content, visual hierarchy, empty/loading/error states, or customer-facing copy needs a Remba review before it is considered complete.

## Remba Review Gate

- [ ] Remba has reviewed the affected screen or flow.
- [ ] The change keeps the primary job obvious within the first viewport.
- [ ] The screen has one clear purpose, not a pile of unrelated admin tools.
- [ ] Frequent actions are faster than rare configuration actions.
- [ ] Empty, loading, error, and success states are written in plain language.
- [ ] The UI uses familiar controls and icons instead of explanatory walls of text.
- [ ] Tables and dense work areas remain scannable on laptop-size screens.
- [ ] New pages fit the product structure: dashboard, property workspace, tenant workspace, or a clear module page.

## Standing UX Direction

- Home is a dashboard: quick adds, notifications, events, updates, and operational health.
- Insights is the portfolio dashboard layer: live health, exceptions, automation activity, and shareable snapshots generated from the same data.
- Property work belongs in the property workspace: lease intake, units, leases, obligations, rent roll, and property-level billing readiness.
- Tenant work belongs in the tenant workspace: tenant search, contact/billing details, onboarding state, leases, documents, and activity.
- New modules should earn their own page when they become repeated work, not be squeezed into an existing page.
- Leasium should feel like modern tooling for operators: calm, fast, clear, and confident.

## Current Remba Review

Status: pass with fixes. Remba approved the tenant onboarding command center and
tenant detail direction on 2026-05-19, provided tenant workflow stays in the
tenant workspace rather than being added to the crowded property workspace.

## Remba Platform Scan - 2026-05-20

Status: conditional pass with priority fixes.

Scope: live production desktop/laptop scan of Dashboard, Smart Intake,
Properties, Tenants, Tenant Detail, Tasks/Operations, Billing Readiness, Insights,
Settings, and one public tenant onboarding link. The scan confirmed the live
API data is reachable and visible in the platform, and no browser console
errors appeared during the reviewed flows.

What is working:

- The global navigation labels now match the document-first product model.
- Dashboard, Tasks/Operations, Tenants, Billing Readiness, Settings, and Insights all load
  the seeded live portfolio once the entity query settles.
- Tenant workspace and tenant detail are much calmer than the old property
  workspace approach and should remain the home for onboarding/contact work.
- Operations is correctly acting as a triage surface, not a second review workflow.
- Insights is read-only and links users back toward the owning workspaces.
- Billing Readiness keeps the no-posting/no-Xero-sync guardrails visible.

Priority fixes before treating the current UX as signed off:

- Properties is still overloaded: document intake, attention dates, billing
  readiness, property table, unit table, and always-visible create form compete
  in one long workspace. Split this into clearer task zones or tabs, and move
  create/edit forms into contextual drawers or focused panels.
- Loading states need one more polish pass. Dashboard, Smart Intake, Properties,
  Billing Readiness, and Insights should avoid large blank areas or repeated
  `... Loading` cards after an entity is known. Use stable prior values,
  section-level skeletons, or a clear page-level loading panel instead.
- Insights can show a mostly blank first viewport while the overview request is
  loading. Add an explicit loading panel so the page does not look broken on a
  slow API wake-up.
- Billing Readiness needs Remba re-review now that its first-pass task-zone
  split is in place. Confirm the Readiness, Billing drafts, Invoice prep, and
  Delivery & payments tabs each make the primary next action obvious.
- Tenant detail still shows placeholder lease context such as `Property context
  pending` and `Unit context pending` even when the tenant is linked to the
  seeded portfolio. Fix the context label or underlying detail payload before
  treating tenant detail as fully signed off.
- Public onboarding should identify the tenant/business in the first viewport
  and provide clearer due/expiry reassurance. The current first impression is
  property-led and can feel like a blank form.
- The desktop global navigation is now wide. A mobile/tablet pass should verify
  whether it needs a collapsed menu before broader beta use.

Progress notes:

- 2026-05-20: Dashboard and Insights now have explicit live-data loading,
  retry, and defensive empty states so API wake-up does not look like missing
  portfolio data. Broader loading-state polish remains needed for Properties
  and Billing Readiness.
- 2026-05-20: Properties and Billing Readiness now have page-level loading
  panels, consolidated retry states, refresh indicators that preserve prior
  data, and quieter empty states while entity-scoped queries are waking up.
  Further Remba work should focus on splitting crowded workspaces into clearer
  zones or tabs.
- 2026-05-20: `/properties` now has task-zone tabs for Portfolio,
  Operations, Billing, and Documents, and the property create/edit form has
  moved out of the always-visible side rail into a focused overlay. This is a
  first-pass fix for the overloaded workspace and remains pending Remba review.
- 2026-05-20: `/billing-readiness` now has task-zone tabs for Readiness,
  Billing drafts, Invoice prep, and Delivery & payments. The blocker action
  queue lives with rent-roll readiness, while preparation/approval work is
  separated from manual delivery/payment recording. This remains pending Remba
  review.
- 2026-05-20: Delivery & payments now includes per-invoice provider
  Dispatch/Retry controls, Xero receipt/retry state, and provider-complete
  messaging once both the Xero draft and tenant email are recorded. This remains
  pending Remba review, especially around whether dispatch should live here,
  Settings, or both during pre-production.

Remba decision:

The platform is coherent enough for private pre-production work, but the
current design-facing surfaces should remain marked `pending Remba review`
until the priority fixes above are resolved. Tenant workspace and the original task
queue direction remain
directionally approved.

Required fixes before major new feature work:

- Remba re-review the `/properties` task-zone split and focused property editor overlay.
- Make dashboard cards and rows actionable, with clear drill-ins to the relevant workspace.
- Add tenant profile/detail surfaces beyond the tenant table and side form.
- Rework public onboarding into calmer guided sections with better context and next-step reassurance.

Completed in the tenant workspace slice:

- `/tenants` now acts as a tenant onboarding command center with counts, search, status filters, and an action queue.
- `/tenants/[tenantId]` now owns the tenant profile, linked leases, onboarding actions, document placeholder, and activity history.
- The always-visible tenant create/edit form has been replaced with focused create/edit panels.
- Public tenant onboarding now shows property, unit, lease context, guided sections, notes, proper reset behavior, and next-step reassurance without adding upload UI before storage is ready.

Standing additions from Remba:

- No new major feature may be added to a crowded page without deciding its home first.
- Tables are for scanning; forms are for focused action.
- Every dashboard item should answer what happened, whether it is urgent, and what to do next.
- Icon-only actions need labels via tooltips or menus unless the icon is universally obvious.
- Public tenant screens must feel calmer and more guided than internal admin screens.

## Smart Intake Apply Sign-Off

Status: pass. Remba approved extending Smart Intake apply beyond insurance certificates on 2026-05-19, provided the flow stays review-first, target scope is plain-language, and the user sees a compact post-apply outcome card showing what was created. Remba also approved the lease apply extension with an Apply plan rather than a lease mega-form.

## Spreadsheet Import Review

Status: pending Remba review. Spreadsheet portfolio imports now create persisted review plan IDs before Apply, so operators can approve against a server-stored plan rather than a browser-only copy. Keep the UI review-first: source workbook, sheet/row, blockers, approve/ignore decisions, and clear applied outcomes should stay visible before this becomes a broader import/resume workspace.

## Billing Prep Sign-Off

Status: pass. Remba approved invoice/billing documents as the next Smart Intake direction on 2026-05-19 with strict guardrails: call it prepared billing work, not invoice creation; show that nothing is posted or synced to Xero; link the source document; and surface remaining billing/Xero/tax blockers in plain language.

## Billing Draft Review Surface

Status: pending Remba review. The Billing Readiness tabbed workspace now surfaces prepared billing drafts with approve/void status actions. Keep the guardrails visible: this is draft review only, with no invoice posting, tenant email, PDF generation, or Xero sync.

## Invoice Draft Staging Surface

Status: pending Remba review. Billing Readiness now creates and lists internal invoice drafts from approved billing drafts inside the Invoice prep tab. Keep the staging language explicit: this is internal invoice preparation only, with readiness blockers visible and no tenant email send or Xero sync from this step.

## Invoice Delivery Prep Surface

Status: pending Remba review. Billing Readiness now stores internal invoice PDF artifacts, prepares branded email draft metadata, can send explicitly approved provider-backed invoice emails through SendGrid, records manual/provider tenant delivery receipts after approval, ingests SendGrid invoice delivery webhooks, and tracks payment status across the Invoice prep and Delivery & payments tabs. Keep the boundary explicit: Leasium is preparing and delivering approved invoice work, Xero sync remains a separate approval, and provider failures/skips must stay visible.

## AI Enrichment Surface

Status: pending Remba review. Property and tenant workspaces now expose public-fact suggestions for missing fields such as ABN, suburb/state/postcode, registered names, and registered addresses. Keep it review-first: show suggested value, citation, source hint, confidence, and any warning before Apply; never overwrite an existing field from enrichment; and keep unsupported/private facts out of the flow.

## Tenant Onboarding Delivery Polish

Status: pending Remba review. Tenant onboarding delivery now includes brand/template metadata, editable reminder schedules through the API, expiry reminders, provider receipt states, and contact/configuration recovery hints. Keep this in the tenant workspace and avoid turning reminder setup into a hidden configuration page.

## Tenant Detail Deepening

Status: pending Remba review. Tenant detail now surfaces property/unit/lease context, richer activity history, safer document provenance/actions, reviewed-change history, and compact tenant portal account access controls for revoke/unlink recovery. Keep the page focused on the tenant record and avoid duplicating the full property workspace or turning access recovery into a broad security page.

## Operations Work-Order Detail

Status: pending Remba review. The dedicated work-order page now carries quote/evidence upload, invoice linking, approval context, and structured internal/contractor/tenant comments in the activity timeline. Keep this page focused on resolving one maintenance job, with comments and evidence supporting the job rather than becoming a general message center.

## Xero Readiness Surface

Status: pending Remba review. Settings now includes a Xero readiness workspace for entity connection state, contact readiness, charge-rule account/tax mapping, approved invoice sync queues, and payment reconciliation counts. Keep the boundary explicit: this is readiness and manual mapping only, not OAuth, live contact sync, invoice posting, or automatic reconciliation.

## Xero Provider Connection Surface

Status: pending Remba review. Settings now extends the Xero workspace with provider OAuth connect, contact sync preview controls, and reviewed local contact mapping apply. Keep the copy careful: provider-backed contact pulls can suggest tenant/property matches, reviewed applies only update local contact mappings, invoices are not posted, tenant emails are not sent, and payment reconciliation is not automatic.

## Xero Contact Mapping Apply

Status: pending Remba review. Reviewed local Xero contact mapping apply is built behind an explicit apply-preview contract that returns applied mappings, skipped mappings, guardrails, and applied time. Keep the surface review-first and compact: operators should see which tenant/property mapping will change locally, why anything was skipped, and that no invoice posting, tenant email, or payment reconciliation is triggered.

## Provider Invoice Dispatch

Status: pending Remba review. Provider invoice dispatch now combines two approved external actions for one invoice: create or reuse the Xero DRAFT first, then send or reuse the SendGrid tenant email. Billing Readiness exposes per-invoice Dispatch/Retry actions, all/needs action/ready/complete/unpaid delivery filters, and provider history rows for Xero attempts plus local payment reconciliation receipts, while backend responses include next-action hints for failed or blocked dispatch. Keep the UI copy explicit that payment reconciliation is separate, retries are idempotent, and skipped/failed provider receipts need operator attention.

## Xero Sync Exception Queue

Status: pending Remba review. Settings now has a local Xero exception queue near the top of the Xero workspace. It groups connection, contact, chart/tax, approved invoice sync, provider receipt, and payment reconciliation exceptions without refreshing Xero tokens, calling Xero APIs, posting invoices, sending email, or reconciling payments on load. Queue rows now expose guided operator actions that reuse existing review-first flows: connect/review provider setup, apply a visible charge-rule suggestion, open posting preview, open provider delivery recovery, or open payment reconciliation review. Keep the queue compact and operator-focused: it should show the blocker, the affected invoice/property/tenant where known, the current/suggested mapping where relevant, the next action, and the guardrail that provider actions still require explicit review.

## Xero Chart/Tax Validation Preview

Status: pending Remba review. Provider-backed chart/tax validation preview is built behind `/api/v1/xero/chart-tax/validate-preview/{entity_id}` and returns checked-rule totals, per-charge-rule validation results, blockers, provider chart/tax context, and guardrails. Keep the surface preview-only and review-first: operators should see whether local account codes and tax types match provider settings before future invoice posting approvals exist, with explicit copy that no invoice posting, tenant email, or payment reconciliation is run.

## Xero Invoice Posting Preview

Status: pending Remba review. Provider-backed invoice posting preview is built behind `/api/v1/xero/invoices/posting-preview/{entity_id}` and returns approved unsynced invoice draft counts, per-draft ready/blocked results, draft Xero payload previews, line-item account/tax snapshots, blockers, and guardrails. Keep the surface dense and operational: operators should understand exactly what would be posted later while seeing that this step does not post invoices, mutate Xero, email tenants, or reconcile payments.

## Xero Posting Approval And Reconciliation

Status: pending Remba review. The backend now supports explicit local Xero posting approval, idempotent provider-backed Xero draft invoice creation, and payment reconciliation preview/apply into local invoice metadata. Settings exposes operator review for invoice posting and provider payment reconciliation: each ready invoice can be approved or revoked for Xero, draft creation remains a separate action, provider payment statuses can be previewed before applying local metadata updates, and result panels show created/skipped/blocked/applied outcomes plus provider IDs when available. Remba should review whether these controls belong in Settings long-term or should move per-invoice into Billing Readiness, and keep the copy clear that tenant email delivery, Xero draft creation, and payment reconciliation remain separate approvals.

## Operator Security And Settings Arena

Status: pending Remba review. Settings now has Security, Organisation, and Xero sections; Security shows the current auth mode, Clerk readiness, current operator, members, entity-role controls, and operator invite lifecycle. Keep the language clear that dev auth and the temporary password gate are pre-production safeguards until Clerk and SendGrid production env vars are configured and `AUTH_MODE` is switched deliberately.

## First Workspace Setup

Status: pending Remba review. `/setup` now gives a clean Clerk-backed database a first-owner path to create the organisation, primary entity, and owner operator. Keep the page sparse and operational: it should only appear before workspace data exists, explain blockers plainly, and avoid becoming a general onboarding tour.

## Operator Workspace Sign-In Guard

Status: pending Remba review. When Clerk server and publishable keys are configured, protected workspace routes redirect signed-out visitors to operator sign-in before loading workspace data, with a friendly client fallback state if the app shell renders first. Keep the state calm and action-oriented with Sign in, Create login, and First workspace setup actions; do not block public onboarding, setup, invite acceptance, or the temporary access gate.

## Insights Overview Surface

Status: pending Remba review. Insights now uses a backend overview for portfolio health, live exceptions, automation activity, billing risk, owner/entity snapshots, finance snapshots, and lease-event snapshots. Operators can generate revocable public links for owner, finance, and lease-event snapshot views. Keep the internal page read-only, keep public snapshot pages clearly frozen/read-only, and avoid turning shared snapshots into live portals.

## Spreadsheet Portfolio Import Surface

Status: pending Remba review. Smart Intake now includes a spreadsheet import review/apply surface for `.xlsx` portfolio source-of-truth workbooks. It stages row-level actions, default approve/review/ignore decisions, blockers, warnings, workbook sheet/row provenance, and an explicit Apply step before any records are written. Remba should review the panel density, placement inside Smart Intake, the optional `/intake/spreadsheet` focused page, and whether the Apply outcome is clear enough for large workbooks.

## Portfolio QA IA

Status: pending Remba review. Portfolio QA remains a cleanup workspace at `/portfolio-qa` and now has a primary navigation entry for pre-production cleanup work. The header must wrap cleanly rather than clipping the right-side search/settings controls, because the primary nav is now intentionally fuller. Remba should confirm whether cleanup belongs as a top-level item long term, should move back under Insights, needs a secondary nav, or should graduate into its own module once operators use it repeatedly.

2026-05-21 update: the primary navigation has been simplified to Dashboard, Smart Intake, Portfolio, Work, Billing, Insights, and Settings. Portfolio QA is no longer a top-level nav item; it remains reachable through command search as Data cleanup / Portfolio QA and still appears contextually from supporting workspaces. Remba should review whether this improves laptop fit and whether Portfolio QA should stay as command/search only, sit under Portfolio, or appear under Insights.

## Dashboard Command Center

Status: pending Remba review. Dashboard now has a first-viewport daily command center that ranks Smart Intake reviews/failed reads, billing blockers, submitted or due onboarding, and urgent operations/key dates before the metric cards. Keep it action-routing only: it should explain what needs attention, why it matters, and where to go next without applying data, posting invoices, or mutating records from the dashboard.

Related 2026-05-21 IA copy cleanup: the Property workspace tab previously labelled Operations is now Leases & units so it does not compete with the global Work destination. Billing Readiness tabs now read like a billing run: Fix blockers, Review drafts, Approve invoices, and Dispatch & reconcile. Remba should review whether the labels are clearer for non-technical operators before beta.

## Tenant Portal Surface

Status: pending Remba review. `/tenant-portal/[token]` now gives tenants a scoped self-service surface for onboarding status, lease context, approved invoices/payment summary, compliance/document upload and download, maintenance request submission/status, inline maintenance photo upload, and notification preferences with timestamped save receipts. Tenant document rows now show category, size, source, received timestamp, notes, and an explicit download action. The page now includes an Account Access panel when Clerk is configured, allowing a signed-in tenant to link the portal once, reload matching portal data through bearer auth, and continue maintenance requests, uploads, notification preferences, and protected document downloads through the tenant account boundary while the original token link remains available. Linked tenants can also return through `/tenant-portal` or `/tenant-portal/account` without the original token URL, and signed-in account status now distinguishes unlinked, revoked, restored, and wrong-tenant recovery states with plain guidance. Remba should review first-viewport tenant context, portal trust language, account-link placement, account-only entry copy, invite-expiry/recovery tone, upload/request density, document provenance density, preference receipt tone, invoice/payment clarity, and whether maintenance belongs before or after compliance for tenants.

Tenant maintenance history now hides internal and contractor-only operator activity unless the update is explicitly marked tenant-visible. Tenant-visible operator comments render as `Team update` in the portal timeline. Remba should review whether this wording is warm enough and whether tenant-visible work-order status changes should get a dedicated event label later.

## Tenant Portal Account Lifecycle

Status: pending Remba review. Operators can now see linked tenant portal accounts from tenant detail and choose revoke for blocked access, restore for staff-approved recovery, or unlink when the tenant should reconnect with the same login. The panel shows the latest recovery receipt with staff action, timestamp, and reason. Keep the action language plain and calm, keep the distinction between revoke, restore, and unlink obvious, and review whether recovery receipts should stay in tenant detail or move into a dedicated account recovery panel.

Tenant fresh-link recovery is now available from tenant detail for sent onboarding/portal links: staff can rotate the token, renew the expiry, send/copy a fresh portal URL, and avoid stale-link copying from tenant, property, and Portfolio QA surfaces. Remba should review whether this action belongs in Portal access, Onboarding workflow, or both, and whether the expiry/recovery language is calm enough for operators under support pressure.

## Maintenance And Arrears Foundations

Status: pending Remba review. The backend now has migration-backed maintenance work orders and arrears/credit-control cases, and the first operator surface lives in `/operations`. Future screens should avoid crowding Properties or Tenants by deciding which work stays in the shared Operations queue and which work earns dedicated detail pages.

## Operations Workspace

Status: pending Remba review. `/operations` now replaces the top-nav Tasks entry while preserving `/tasks` as a redirect. It keeps the original triage queue and adds Maintenance and Arrears tabs with KPI cards, quick-create panels, tenant-portal submitted requests, expandable maintenance detail, quote approval context, invoice draft linking, activity history, and status actions for approvals, work starts, completion, reminders, escalation, and resolution. Maintenance rows now also link to a dedicated work-order route for deeper contractor quote evidence, invoice context, and activity history. Remba should review whether Operations is the right long-term IA home, whether the first viewport is too dense on laptops, and whether maintenance/arrears detail pages should become the default pattern over expandable rows.

2026-05-21 update: maintenance detail now shows a read-only Operations-to-Billing handoff panel for linked invoice drafts, and Billing Readiness can open from that handoff with the invoice highlighted plus a return link to the work order. Remba should review whether this makes ownership clear enough: Operations owns contractor/quote/approval/completion, while Billing Readiness owns invoice delivery prep, tenant email, Xero dispatch, and payment reconciliation.

The dedicated maintenance work-order route now also surfaces quote/evidence rows from stored quote metadata and gives linked invoice drafts a compact handoff panel with status, payment state, delivery readiness, preview, PDF download, prepare, and approve actions. Remba should check whether invoice controls inside maintenance feel helpful or whether the final approval step should stay visually anchored in Billing Readiness.

## Property Provenance Surface

Status: pending Remba review. Smart Intake apply outcomes and the Property workspace now expose purchase-contract source history, field citations, confidence, and before/after property changes. Keep this review-first and factual: show what changed and where it came from, without implying the document source is automatically authoritative.

2026-05-21 update: property source history now uses a reusable Evidence Source Trail pattern that can carry source document, source location, confidence, before/after field changes, field citations, and audit history. Remba should review the density, labels, and whether this pattern should become the standard evidence drawer across Smart Intake, tenant detail, invoices, maintenance, and Portfolio QA.

Second 2026-05-21 update: the same source-trail pattern now appears in Smart Intake acquisition apply outcomes and tenant detail source history. The tenant version combines reviewed onboarding changes, document/Smart Intake provenance, and public enrichment citations. Remba should check whether this unified pattern reduces provenance confusion without making tenant detail feel too dense.

## Acquisition Schedule Outcome Surface

Status: pending Remba review. Smart Intake purchase-contract apply outcomes now show created pending lease IDs, draft charge detail, and skipped tenancy schedule rows with blockers. Keep it compact and operational: this is a review outcome, not a completion certificate, and any skipped row should point the operator back to the specific schedule fact that needs correction.

## Acquisition Apply Sign-Off

Status: pass. Remba approved acquisition/building contract apply on 2026-05-19 as a property-first workflow. The Apply plan must separate link existing, fill blanks only, create reviewed records, skip optional units, link the source document, and create milestone tasks. It must not imply acquisition completion, financial posting, or destructive overwrites.

## Smart Intake Naming Sign-Off

Status: pass. Remba approved replacing `Lease Inbox` with `Smart Intake` on 2026-05-19 because the intake flow now handles leases, purchase contracts, invoices, certificates, handover files, tenant documents, and property setup packs. Keep the `/intake` route for now. Use `Review queue` for the waiting-list area and keep `Nothing is applied until you review it` as the trust signal.

## Tasks Smart Intake Sign-Off

Status: pass. Remba approved adding Smart Intake items to Tasks on 2026-05-19 as a triage-only queue. Use a single `Smart Intake` filter, rows labelled `Document waiting for review`, `Document needs match`, `Document could not be read`, or `Document still processing`, and a single row action: `Review in Smart Intake`. Do not build review controls inside Tasks or show applied documents as tasks.

Applied UX guardrails:

- Keep confirmation in the review panel area rather than a modal.
- Show what changed, target scope, first due date, source document, and ignored item count.
- Use `Portfolio level`, `No unit scope`, and `No lease scope` wording for intentional scope choices.
- Provide one clear next action to review created work in Tasks.
- For lease documents, show the Apply plan before apply: property, unit, tenant, lease, and task outcomes.
- Say `Link only` when an existing record is selected and no mutation is intended.
- Block lease apply until property/unit/tenant can be linked or created, and start, expiry, and rent are confirmed.
- Treat low confidence, missing option/security detail, and no extracted obligations as warnings rather than blockers.
- After lease apply, offer both property workspace and task follow-up actions.
