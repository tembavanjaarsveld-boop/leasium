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
- Tenant detail still shows placeholder lease context such as `Property context pending`
  and `Unit context pending` even when the tenant is linked to the seeded
  portfolio. Fix the context label or underlying detail payload before
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
- 2026-05-21: Property rows now use source-backed owner/entity chips instead
  of repeating `Owned by current entity`. Current-entity ownership shows the
  active entity name, workbook/imported owner names use stable soft pastel
  chips, split ownership collapses after two labels, and unknown ownership uses
  a neutral slate chip. Remba reviewed the direction and asked that tags stay
  compact metadata, not warnings or decorative rainbow labels.
- 2026-05-21 follow-up: owner tag colours now distribute across the loaded
  owner/entity set with collision avoidance, so different owners are easier to
  identify by colour while the same owner keeps the same soft tag colour.
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

2026-05-21 update: the embedded Smart Intake panel and focused `/intake/spreadsheet` page now show approve/review/ignored/blocked counts, explicit `Approve recommended` and `Ignore all` controls, and multiple field changes per action instead of hiding everything behind the first changed field. Remba should review whether the bulk controls are safe enough for large workbooks, whether `Ignore all` feels too destructive despite being only a review decision, and whether the focused page should become the default for imports.

## Billing Prep Sign-Off

Status: pass. Remba approved invoice/billing documents as the next Smart Intake direction on 2026-05-19 with strict guardrails: call it prepared billing work, not invoice creation; show that nothing is posted or synced to Xero; link the source document; and surface remaining billing/Xero/tax blockers in plain language.

## Billing Draft Review Surface

Status: pending Remba review. The Billing Readiness tabbed workspace now surfaces prepared billing drafts with approve/void status actions. Keep the guardrails visible: this is draft review only, with no invoice posting, tenant email, PDF generation, or Xero sync.

## Invoice Draft Staging Surface

Status: pending Remba review. Billing Readiness now creates and lists internal invoice drafts from approved billing drafts inside the Invoice prep tab. Keep the staging language explicit: this is internal invoice preparation only, with readiness blockers visible and no tenant email send or Xero sync from this step.

## Invoice Delivery Prep Surface

Status: pending Remba review. Billing Readiness now stores internal invoice PDF artifacts, prepares branded email draft metadata, can send explicitly approved provider-backed invoice emails through SendGrid, records manual/provider tenant delivery receipts after approval, ingests SendGrid invoice delivery webhooks, and tracks payment status across the Invoice prep and Delivery & payments tabs. Keep the boundary explicit: Leasium is preparing and delivering approved invoice work, Xero sync remains a separate approval, and provider failures/skips must stay visible.

2026-05-21 update: invoice delivery prep now records the configured invoice template key/version plus a normalized rendered message preview in delivery metadata, and Billing Readiness shows the template/version badge with a collapsed email preview. Settings Organisation now has a communication template registry that lists current template keys, preview copy, review-first delivery rules, and provider receipt endpoints for invoice delivery, tenant onboarding, Work notices/digests, contractor email/SMS, and tenant portal preferences. Remba should review whether this belongs under Organisation or should become a dedicated Communications settings area once editable branded templates exist.

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

2026-05-21 update: Xero status now carries a local accounting-freshness summary for contact sync, chart/tax validation, invoice posting/dispatch checkpoints, and payment reconciliation. Settings, Insights, and public finance snapshots show stale/missing payment reconciliation for open Xero-linked invoices without calling Xero on load. Remba should review whether freshness belongs in Settings as a top metric, whether the public snapshot wording is understandable to owners, and whether the stale window should be configurable.

## Xero Chart/Tax Validation Preview

Status: pending Remba review. Provider-backed chart/tax validation preview is built behind `/api/v1/xero/chart-tax/validate-preview/{entity_id}` and returns checked-rule totals, per-charge-rule validation results, blockers, provider chart/tax context, and guardrails. Keep the surface preview-only and review-first: operators should see whether local account codes and tax types match provider settings before future invoice posting approvals exist, with explicit copy that no invoice posting, tenant email, or payment reconciliation is run.

## Xero Invoice Posting Preview

Status: pending Remba review. Provider-backed invoice posting preview is built behind `/api/v1/xero/invoices/posting-preview/{entity_id}` and returns approved unsynced invoice draft counts, per-draft ready/blocked results, draft Xero payload previews, line-item account/tax snapshots, blockers, and guardrails. Keep the surface dense and operational: operators should understand exactly what would be posted later while seeing that this step does not post invoices, mutate Xero, email tenants, or reconcile payments.

## Xero Posting Approval And Reconciliation

Status: pending Remba review. The backend now supports explicit local Xero posting approval, idempotent provider-backed Xero draft invoice creation, and payment reconciliation preview/apply into local invoice metadata. Settings exposes operator review for invoice posting and provider payment reconciliation: each ready invoice can be approved or revoked for Xero, draft creation remains a separate action, provider payment statuses can be previewed before applying local metadata updates, and result panels show created/skipped/blocked/applied outcomes plus provider IDs when available. Remba should review whether these controls belong in Settings long-term or should move per-invoice into Billing Readiness, and keep the copy clear that tenant email delivery, Xero draft creation, and payment reconciliation remain separate approvals.

Update 2026-05-21: Settings Xero posting, draft creation, payment reconciliation, and guided exception rows now include invoice-specific handoff links into Billing Readiness Delivery & payments with the matching invoice/filter selected. Remba should review whether this makes the ownership split clear enough: Settings owns accounting setup and Xero approval, while Billing Readiness owns dispatch recovery, payment follow-up, and invoice-level operations.

Update 2026-05-21: payment reconciliation rows now show match method, confidence, amount delta, bank/reference evidence, and explicit no-bank-write guardrails. Applied reconciliation receipts carry the same evidence into Billing Readiness provider history. Remba should review whether this extra accounting context helps operators trust local payment updates, and whether confidence/amount-delta badges should be quieter once true bank-feed imports arrive.

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

2026-05-21 update: spreadsheet import review now has first-class bulk review controls and denser action provenance. The focused page uses blocked action counts rather than finding counts for the review metric, while findings remain visible separately. Remba should review whether this distinction is clear to operators.

## Portfolio QA IA

Status: pending Remba review. Portfolio QA remains a cleanup workspace at `/portfolio-qa` and now has a primary navigation entry for pre-production cleanup work. The header must wrap cleanly rather than clipping the right-side search/settings controls, because the primary nav is now intentionally fuller. Remba should confirm whether cleanup belongs as a top-level item long term, should move back under Insights, needs a secondary nav, or should graduate into its own module once operators use it repeatedly.

2026-05-21 update: the primary navigation has been simplified to Dashboard, Smart Intake, Portfolio, Work, Billing, Insights, and Settings. Portfolio QA is no longer a top-level nav item; it remains reachable through command search as Data cleanup / Portfolio QA and still appears contextually from supporting workspaces. Remba should review whether this improves laptop fit and whether Portfolio QA should stay as command/search only, sit under Portfolio, or appear under Insights.

Second 2026-05-21 update: Portfolio QA now has guided cleanup paths rather than only issue links. Data QA includes inline owner/billing identity fixes, Tenant contacts can be fixed from the QA flow, Onboarding prep supports per-row and batch invite creation with blocked-row fix actions, and Source history expands register import rows, Smart Intake apply history, field citations, and public enrichment history through the reusable Evidence Source Trail. Remba should review whether this is too much for one workspace or whether guided cleanup should become the default pre-production register review flow.

## Dashboard Command Center

Status: pending Remba review. Dashboard now has a first-viewport daily command center that ranks Smart Intake reviews/failed reads, billing blockers, submitted or due onboarding, and urgent operations/key dates before the metric cards. Keep it action-routing only: it should explain what needs attention, why it matters, and where to go next without applying data, posting invoices, or mutating records from the dashboard.

Related 2026-05-21 IA copy cleanup: the Property workspace tab previously labelled Operations is now Leases & units so it does not compete with the global Work destination. Billing Readiness tabs now read like a billing run: Fix blockers, Review drafts, Approve invoices, and Dispatch & reconcile. Remba should review whether the labels are clearer for non-technical operators before beta.

2026-05-21 typography update: the app now loads Geist explicitly through Next font variables, Dashboard list rows use a quieter 15px/20px hierarchy, overdue badges are kept on one line, and the Smart Intake drop zone/review queue styling is softened. Remba should review whether the Dashboard now feels calmer without losing urgency in overdue items.

2026-05-21 command-center alignment update: Daily command center rows now use a fixed rank/content/action grid. Rank numbers are attached to the row, titles lead the hierarchy, status/date metadata sits beneath the title, and the action/link control is grouped on the right. Remba reviewed the direction and asked that rows remain compact, operational, and clearly non-gamified.

2026-05-21 urgency hierarchy update: Dashboard command-center rows, Needs attention, Events, and the Work open queue now rely on overdue/status pills for warning emphasis while row titles use a calmer medium weight and metadata uses muted regular text. Remba should review whether urgency remains obvious without the task titles feeling heavier than the surrounding interface.

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

2026-05-21 update: the Contractor card on maintenance detail now includes an explicit provider-backed email action, latest send/receipt badges, editable subject/message fields, and a work-order activity receipt. Queued provider messages become contractor-visible comments for operator history, while tenant portal timelines continue hiding contractor-only activity. Remba should review whether contractor communication belongs in the first-viewport card, whether the SendGrid receipt language is too operational, and whether retry/recovery should be visually separate from ordinary updates.

2026-05-21 update: contractor delivery recovery now changes failed/skipped/attention states into a visible recovery note and `Retry update` action, with attempt numbers and no duplicate contractor comment unless the operator edits the message. Maintenance-linked invoice exceptions now show a compact recovery panel in Billing Readiness and a recovery prompt on the work-order invoice card. Remba should review whether the warning color and retry placement feel urgent enough without overwhelming the job detail page.

2026-05-21 update: linked maintenance invoice cards now include a Billing recovery path panel so operators can see whether the next step is invoice approval, delivery prep, provider retry, dispatch, or payment follow-up. Billing Readiness provider-failure rows now include linked work-order status, approval state, contractor name, and the retry/return path. Remba should review whether this extra context helps operators recover exceptions faster or makes the Delivery & payments row too dense.

2026-05-21 update: maintenance work-order detail now includes a Job completion handoff checklist with job completion, approval, contractor, evidence, invoice linkage, invoice delivery readiness, and provider recovery checks. The same panel carries Start job and Complete job actions, while making clear that Billing Readiness owns invoice dispatch and payment follow-up after Operations closes the job. Remba should review whether this panel belongs between the summary cards and evidence/activity, whether the checklist density is right for first-use operators, and whether Complete job should be more visually restrained.

2026-05-21 update: the Contractor card now includes a contractor update template selector for attendance windows, quote follow-up, completion evidence, and billing documents. The templates prefill subject and message only; the operator still reviews the copy and explicitly sends or retries the provider-backed email. Remba should review template wording, whether the selector belongs above the subject field, and whether template use should be shown in provider history.

2026-05-21 update: contractor delivery attempts now store provider template key/version on receipts and attempt history, and the Contractor card surfaces the current and historical template/version used. Remba should review whether this technical label is helpful for support/debugging or should be tucked behind provider history once templates stabilize.

2026-05-21 update: the Job completion handoff panel now lets operators record a closeout note and attach an optional closeout photo at the moment they complete a maintenance job. The note is stored as closeout metadata rather than overwriting the general work-order note, and photo evidence stays source-linked through the document store. Remba should review whether closeout capture belongs inside the completion panel, whether the optional photo control is too prominent for simple jobs, and whether saved closeout evidence needs a stronger audit/history treatment.

2026-05-21 update: maintenance detail now includes an edit-details panel for basic work-order corrections, a Reopen job action for completed/cancelled work orders, and an Owner completion review receipt beside the generated owner-facing closeout copy. Basic edits now appear in backend activity tracking, reopen history is kept separate from closeout history, and owner review remains a no-send receipt. Remba should review whether edit controls are too prominent on the detail page, whether Reopen belongs in the page header, and whether owner review should eventually move into a dedicated owner communication workflow.

2026-05-21 update: contractor communication now shows a compact provider history in the Contractor card, combining recent SendGrid attempts and receipts with status, attempt number, timestamp, and provider detail. Remba should review whether this operational history is understandable enough for property managers, and whether it should be collapsed behind a disclosure once the history grows.

2026-05-21 update: the Contractor card now also supports reviewed Twilio SMS sends with a separate body field, send/retry button, provider receipts, status callback ingestion, and template key/version history stored beside email delivery. Remba should review whether Email and SMS should sit as separate stacked forms, whether SMS retry language should differ from email, and whether contractor phone numbers should require E.164 formatting in the UI before send.

2026-05-21 update: closeout capture now appends a compact closeout history entry and shows recent closeout history below the saved closeout note/photos. Remba should review whether this audit context is useful in the completion panel or whether it should move into the broader work-order activity timeline once closeout edits/reopens are supported.

2026-05-21 update: closeout history entries now resolve stored closeout photo document IDs into source evidence links beside the audit row. Remba should review whether source links inside the completion panel are useful enough there, or whether closeout evidence should move into a dedicated Evidence section once work orders support reopen/edit history.

2026-05-21 update: completion now stores review-only owner, contractor, and tenant communication drafts in closeout metadata and shows them beside closeout history. No message is sent automatically. Remba should review whether the copy is useful for operators after closeout, whether tenant-facing completion text belongs here or in the tenant portal timeline, and whether owner updates need a separate approval/send workflow.

2026-05-21 update: the Work queue and Maintenance/Arrears rows now include member assignment controls for maintenance jobs, arrears cases, and critical-date obligations. Assignment stores a compact history and an in-app notification-ready receipt in record metadata; it does not send provider email/SMS automatically. Remba should review whether assignment belongs in queue rows, row detail, or a side panel; whether the control density is acceptable on laptops; and whether `Notification ready` is clear enough before provider-backed notifications are added.

2026-05-21 follow-up: the Work queue now includes an assignee workload strip and queue-level filters for all open work, unassigned work, current-operator work, and selected member work. The strip surfaces unassigned/assigned totals plus urgent load for assigned members without changing assignment persistence. Remba should review whether the workload strip helps accountability or adds too much density above the queue, and whether assignee filtering should also appear inside the Maintenance and Arrears tabs.

Second 2026-05-21 follow-up: new assignment metadata now prepares an in-app reminder date and escalation watch date, and the Work queue can filter to assignment follow-ups due. The row control shows `Reminder` and `Escalate` badges beside `Notification ready` while explicitly stating that no email/SMS has been sent. Remba should review whether these badges make ownership clearer or overload the assignment control, and whether follow-up filtering should become a first-class Work tab once provider-backed notifications exist.

Third 2026-05-21 follow-up: assignment controls now include explicit `Log reminder` and `Queue escalation` actions. Both actions update assignment metadata/history only; they do not send provider email/SMS. Remba should review whether these actions belong inline with the assignee select or behind a secondary menu, and whether `Reminder logged`/`Escalation queued` receipts are plain enough for operators.

Fourth 2026-05-21 follow-up: assignment controls now include explicit `Send notice`/`Retry notice` actions for provider-backed SendGrid email to the assigned operator. The controls show `Email queued`/failed/skipped receipts and keep the send action human-triggered. Remba should review whether provider notices belong inline, whether `Send notice` is the right operator-facing copy, and whether receipt state should expand into a side panel once webhook receipts and notification preferences are added.

Fifth 2026-05-21 follow-up: assignment notices now accept SendGrid receipt events and can move from queued into delivered/opened/failed provider history across maintenance, arrears, and critical-date work. Remba should review whether the inline `Email delivered` badge is enough for operators or whether provider receipt history needs a compact disclosure once more notification channels exist.

Sixth 2026-05-21 follow-up: Settings now includes a per-operator Work email on/off control, and Work assignment provider notices record `Email skipped` when an assignee has muted work email. Remba should review whether notification preferences belong in the Users and roles table or a dedicated notification/settings panel once batch sends and more channels are added.

Seventh 2026-05-21 follow-up: the Work queue now includes a `Send ready notices` batch action for the currently filtered queue, while individual assignment rows tuck provider/email/history receipts into a compact `Recent activity` disclosure. Remba should review whether the batch action is visible enough without feeling risky, whether the count beside it is clear, and whether the collapsed history pattern is calmer than always showing provider detail inline.

Eighth 2026-05-21 follow-up: the Work queue now includes a compact `Notice inbox` strip that respects the current assignee filter and groups assignment notices into attention, ready, in-flight, and done states. Recent receipt rows link back to the underlying work item instead of creating a separate notification page. Remba should review whether this inbox helps operators trust provider receipts without adding another queue, and whether the status grouping should become a global notification center later.

Ninth 2026-05-21 follow-up: Settings now adds a Work digest cadence selector (`daily`, `weekly`, or `off`) beside each operator's Work email toggle. This stores preference only; no scheduled digest is generated yet. Remba should review whether digest cadence belongs in the Users and roles table, whether the wording is clear enough before digest delivery exists, and whether notification preferences need their own settings section once more channels are added.

Tenth 2026-05-21 follow-up: Operations can now generate a review-only Work digest preview for the selected daily or weekly cadence. The preview groups assigned work by operator, shows follow-up and provider-notice counts, links back to source work, and keeps a visible `No messages sent` guardrail. Remba should review whether digest generation belongs in the queue header, whether the preview is too dense for the first viewport, and whether this should move to a global notifications area once cron sending is introduced.

Eleventh 2026-05-21 follow-up: generated Work digests now store per-operator preview receipts in notification preferences, including cadence, counts, follow-up count, delivery status `previewed`, and `message_sent: false`. Remba should review whether these receipts should become visible in Settings immediately or wait until cron/provider delivery is active.

Twelfth 2026-05-21 follow-up: Settings now surfaces the latest Work digest preview receipt beside each operator's notification controls, including preview time, item count, follow-up count, cadence, and a `No messages sent` guardrail. Remba should review whether this compact receipt treatment is calm enough for the operator table or should move into a dedicated notification history panel before scheduled delivery is enabled.

Thirteenth 2026-05-21 follow-up: a global Notifications page and top-bar bell now collect Work assignment notice states and digest preview receipts across maintenance, arrears, and critical-date work. The page is read-only, keeps explicit guardrails, and links back to Work for action. Remba should review whether the bell placement adds pressure to the already dense header, whether Notifications should be a full nav item later, and whether the page needs read/unread state before provider delivery expands beyond email.

Fourteenth 2026-05-21 follow-up: Notifications now includes per-operator unread counts and a `Mark reviewed` action that records the entity-specific review timestamp in notification preferences. Remba should review whether the unread count creates helpful urgency or too much inbox pressure, and whether review state should be visible from the bell itself once real delivery scheduling is enabled.

Fifteenth 2026-05-21 follow-up: Work digests now have an explicit `Send digest` action in Operations, and scheduled digest endpoints only send provider-backed SendGrid emails when `send_email_approved` is present. Settings and Notifications show digest delivery receipts as `Email queued` or `No messages sent`, with delivery detail when available. Remba should review whether the second digest button feels clear enough beside `Generate digest`, and whether digest delivery history belongs in Notifications, Settings, or a dedicated notification preferences panel.

Sixteenth 2026-05-21 follow-up: Notifications digest history now shows a direct `Send digest` / `Retry digest` recovery action on digest receipts that have not sent. The action uses the same explicit approved-send path and then refreshes receipt state. Remba should review whether the recovery copy makes it clear that the current cadence digest is sent to matching operators, not only the single historical receipt row.

Seventeenth 2026-05-21 follow-up: digest recovery receipts now carry delivery trigger, source digest timestamp, provider attempt history, and delivery attempt count. Notifications uses the count in recovery copy when applicable. Remba should review whether attempt numbers help operators trust recovery without making the notification center feel like a technical log.

Eighteenth 2026-05-21 follow-up: Settings now moves Work email and digest cadence controls into a dedicated Work notifications panel, with per-operator assignment email toggles, digest cadence, latest digest receipt, and panel-level enabled counts. The Users and roles table is now focused on access, invite, and activation work. Remba should review whether notification preferences should remain inside Security, whether the compact receipt belongs here or in Notifications, and whether future channels need their own notification settings tab.

Nineteenth 2026-05-21 follow-up: Notifications now has segmented filters for Work notices and digest receipt history. Notice filters cover attention, in-flight, ready, follow-up due, and failed email states; digest filters cover needs-send, sent, failed, skipped, and recovery receipts. Remba should review whether the filter labels are operational enough, whether the count chips create useful confidence, and whether these filters should become saved views once non-email channels are added.

Twentieth 2026-05-21 follow-up: notification-center data now exposes channel, provider, template key, and template version evidence for Work notice and digest receipts, and Notifications adds channel filters for notices and digest history. Remba should review whether channel filtering is useful before SMS/push Work delivery exists, whether template/version text is too technical for operators, and whether this evidence should move into a receipt detail drawer later.

Twenty-first 2026-05-21 follow-up: Settings now lets owner/admin operators edit per-member Work assignment notice and digest template key/version defaults. Provider sends still require explicit Send/Retry approval, and receipts expose the template used. Remba should review whether template keys are too implementation-heavy for this panel, whether these should become named template choices, and whether template editing belongs in Security or a future Communications settings tab.

Twenty-second 2026-05-21 follow-up: the Work notifications panel now adds a compact template preview beside the editable notice/digest template defaults. It translates known keys into a plain title, shows the version badge, sample subject, delivery channel, and the content summary included in each email. Remba should review whether this is enough reassurance before saving or whether template management needs a dedicated preview modal with rendered email content.

Twenty-third 2026-05-21 follow-up: Notifications now exposes the latest provider history row for Work notices and digest receipts, including provider status, event name, timestamp, template/version, attempt count, and error detail where present. Remba should review whether this evidence should stay inline, collapse into a receipt details drawer, or become a support-only disclosure as non-email channels arrive.

Twenty-fourth 2026-05-21 follow-up: Notifications now adds a plain-English `Next action` cue to Work notice and digest receipt rows, covering retry-from-Work, send/retry digest, wait-for-provider-receipt, preference cleanup, and no-recovery-needed states. Remba should review whether these cues reduce ambiguity or add too much row text, and whether future direct recovery actions should replace the cues once channel-specific actions are ready.

Twenty-fifth 2026-05-21 follow-up: Settings now fetches a named Work notification template catalog from the API and uses named assignment notice/digest selectors with version badges and managed/custom preview labels. Stored operator preferences still save the underlying key/version, and provider sends remain explicit. Remba should review whether this makes template setup legible enough inside Security or whether named templates belong in a future Communications settings area.

Twenty-sixth 2026-05-21 follow-up: Notifications now adds explicit `Send notice` and `Retry notice` actions to actionable Work notice rows. The action uses a generic notification-center endpoint, respects operator email preferences, preserves SendGrid receipt history, and does not resend notices already queued/sent/delivered/opened. Remba should review whether direct recovery belongs in Notifications, whether the inline buttons add too much row density, and how this should adapt once non-email Work channels exist.

Twenty-seventh 2026-05-21 follow-up: Notifications now includes a compact channel readiness strip for Work notices: Email is actionable, SMS is blocked until operator phone/preference storage exists, and In-app is read-only. Remba should review whether this helps explain why only email has direct recovery today or whether blocked future channels should stay out of the first viewport until wiring starts.

Twenty-eighth 2026-05-21 follow-up: Settings now lets owner/admin users capture an operator-level Assignment SMS toggle and reviewed phone number inside Work notification preferences. Notifications uses that data to change SMS readiness copy from missing phone to Twilio/configuration or not-wired guidance, but no SMS is sent yet. Remba should review whether SMS setup belongs in the Security Work notifications panel or should wait for a future Communications settings surface.

Twenty-ninth 2026-05-21 follow-up: Notifications now adds explicit `Send SMS` / `Retry SMS` actions for Work notices when the assigned operator has reviewed SMS preferences. SMS attempts are recorded as channel-specific Twilio receipts so the existing SendGrid email notice state remains stable. Remba should review whether email and SMS recovery actions can live side by side in the row, whether skipped Twilio configuration receipts are clear enough, and whether channel receipt detail should move into a drawer before more communication channels are added.

Thirtieth 2026-05-21 follow-up: Work notice responses now expose additive `channel_receipts` for Email and SMS, and Notifications renders non-email receipt cards from that reusable projection while keeping the existing email summary and SMS compatibility fields. Remba should review whether showing sidecar channel receipts inline is understandable, or whether the normalized evidence should become a compact receipt drawer before digest, contractor, or tenant communication channels join the same pattern.

Thirty-first 2026-05-21 follow-up: Notifications now keeps full Work notice receipt/provider evidence in inline `Receipt evidence` disclosures instead of opening a separate drawer. The row still shows the latest provider event and channel summary, while timestamps, message IDs, recipients, templates, and full provider history stay one click deeper. Remba should review whether this disclosure pattern is calm enough for support evidence or whether a future dedicated drawer is still needed once more communication channels share the same receipt shape.

Thirty-second 2026-05-21 follow-up: Notifications now adds collapsed `Message preview` disclosures for Work notice Email/SMS receipts and Work digest receipts. The previews are rendered from the same communication template helpers used for provider sends, so operators can review subject, recipient, template, body text, and action link before choosing Send/Retry. Remba should review whether rendered copy belongs inline on every notice row, or whether previews should become a support-only or modal detail once contractor, tenant, and invoice communication previews join the same pattern.

Thirty-third 2026-05-21 follow-up: Notifications now adds a collapsed `Provider setup checks` section inside the Work notice center channel readiness area. It shows Work email, SendGrid sender/webhook, operator SMS preference, Twilio messaging, Twilio callback, and Leasium receipt readiness without exposing provider tokens, webhook secrets, or tokenized callback URLs. Remba should review whether provider-console checklist language belongs in Notifications or should move to a future Communications settings surface.

Thirty-fourth 2026-05-21 follow-up: Settings Organisation now includes an `Ownership tags` directory that aggregates the owner/billing identity chips from property rows, shows source context, property counts, links back to matching properties, opens tag-level filtered Properties views, and lets property-row owner chips apply the same filter. Remba should review whether this belongs beside Entity access map or should become a fuller Properties/Ownership directory, especially before these free-text owner labels become first-class records.

Thirty-fifth 2026-05-21 follow-up: Properties now has an experimental `Property images` helper that asks public enrichment for online image candidates, shows fixed-ratio remote previews with source/citation/confidence, and only saves an image after operator review. Apply is a backend-cached stored-document workflow: the selected candidate is downloaded, processed to a fixed 1600x900 JPEG, linked to the property as a StoredDocument, and referenced through metadata pointers such as `primary_image.document_id`, `hero_image_document_id`, `image_document_ids`, source/citation/confidence/history. Remba should be especially strict here: if candidates feel generic, legally unclear, or visually cheap, pull the helper before beta rather than relying on remote metadata-only hotlinks.

Thirty-sixth 2026-05-22 follow-up: Work digest receipt rows now carry the same additive `channel_receipts` projection used by Work notices, so Notifications renders a single normalized email Receipt evidence disclosure beside the existing top-level digest summary and rendered message preview. The disclosure surfaces recipient, template, attempt count, last event, sent/attempted timestamps, and provider history without changing the digest row's main copy. Remba should review whether the disclosure adds useful evidence on the digest row or whether it duplicates the inline provider history strip too much.

Thirty-seventh 2026-05-22 follow-up: the experimental `Property images` helper has been pulled. In production the OpenAI web-search helper returned commercial listing page URLs as image candidates instead of verified direct image file URLs, so candidate cards rendered without thumbnails and the panel felt broken. Per the original Remba guidance ("if candidates feel generic, legally unclear, or visually cheap, pull the helper before beta"), the `/property-images/preview` and `/apply` routes, the OpenAI helper, the property workspace image panel and row thumbnails, the Pillow dependency, and the related smoke fixtures and tests were removed. A future operator-driven image upload feature can reuse the stored-document pipeline if Remba wants property thumbnails back; the existing `property_media` metadata on previously-applied properties stays in place as orphaned data until that lands.

Thirty-eighth 2026-05-22 follow-up: the `Property images` panel is back, this time backed by SerpAPI's Google Images endpoint instead of OpenAI web search. The search source change is the only meaningful difference — SerpAPI returns verified direct image URLs (the failure mode from v1), so candidate cards render real thumbnails and Apply continues to use the SSRF-guarded download + Pillow 1600x900 stored-document pipeline. The preview returns a 503 with a clear "SerpAPI key is not configured" message when `SERPAPI_API_KEY` is unset, and no records mutate in that state. Remba should review whether candidate quality is now acceptable for production beta and whether confidence-from-position needs a more visible explanation in the UI.

Thirty-ninth 2026-05-22 follow-up: the maintenance work-order detail page now shows a `Channel evidence` disclosure inside the Contractor card, fed by a new `channel_receipts` projection on `MaintenanceWorkOrderRead`. The projection mirrors the shape used by Work notice channel receipts (recipient, template key/version, attempt count, last event, sent/attempted/receipt timestamps, provider history, and a rendered message preview) so future communication channels (tenant portal, owner updates) can plug in the same UI without another rebuild. The disclosure sits below the existing inline send/retry controls and provider history strip, intentionally additive rather than replacing — Remba should review whether the duplication is calm enough or whether the inline contractor UI should eventually consume the normalized projection instead.

Fortieth 2026-05-22 follow-up: the Xero payment reconciliation stale window is now operator-configurable via the `XERO_RECONCILIATION_STALE_AFTER_DAYS` env var (defaults to 7). The configured value flows through `_accounting_freshness` and is surfaced in `accounting_freshness.stale_after_days` on `/xero/status`, the Insights overview, and the public finance snapshot. Settings now always renders the configured value as a neutral `Stale window: N days` badge (warning copy stays for the actually-stale state). Remba should review whether environment-only configuration is enough or whether the value needs an editable Settings control.

Forty-first 2026-05-22 follow-up: the maintenance work-order page now offers a contractor SMS template selector with attendance-window, status-update, completion-check, and billing-documents canned bodies, mirroring the existing contractor email templates. Operator edits reset the selector back to Custom; provider dispatch stays operator-controlled. Remba should review whether the SMS template copy is concise enough (SMS bodies are limited to 800 chars and need to stay direct) and whether the email + SMS template selectors should be visually grouped.

Forty-second 2026-05-22 follow-up: Settings Organisation tab now opens with a new `Integrations` card that lists the configured/not status of SerpAPI, OpenAI, SendGrid, Twilio, and Xero. The card consumes a new `/system/integration-status` endpoint which returns only booleans plus label/purpose/detail copy — no API keys, webhook secrets, or account IDs leak. Remba should review whether the card belongs above the Organisation profile section (current placement) or in a dedicated future "Provider setup" tab once the integration list grows.

Forty-third 2026-05-22 follow-up: the Properties table now shows an occupancy status badge inline beside each property name (Leased / Partial / Vacant / No units), derived from existing rent-roll rows. Active and holding-over leases count as occupied; pending/expired/terminated do not. A pill-row filter above the table lets operators show only properties in a chosen state, with counts per state visible at all times. Remba should review the badge palette (success / warning / danger / neutral) and whether the Internal-vs-external lease distinction should be a separate badge alongside, a colour modifier, or a dedicated filter pill once that data model exists.

Forty-fourth 2026-05-22 follow-up: the occupancy badge now distinguishes `Leased internal` (purple, leasium-blue palette) from `Leased` (green). Internal status is auto-derived by matching the rent-roll tenant name against the property's `owner_legal_name`, `trustee_name`, `trust_name`, or `invoice_issuer_name` (case-insensitive, trimmed). A property is `Leased internal` only when every unit is leased AND every lease is internal; mixed cases stay on `Leased` with an "N internal" suffix. Filter pills gain a `Leased internal` option. Remba should review whether the purple badge reads as a distinct state versus just a tone variant of Leased, and whether mixed cases need their own pill colour rather than the `Leased + internal suffix` treatment.

Forty-fifth 2026-05-22 follow-up: the Dashboard now opens with an `Upcoming lease events` panel surfacing the next 120 days of expiries, rent reviews, obligations, and onboarding follow-ups (sourced from the existing `/insights/overview` lease event snapshot). Each row deep-links to its property/lease. Panel header summarises counts per category (expiries / reviews / overdue / due soon / onboarding). Remba should review whether this should sit above or below the metric-card row, and whether the count badge palette differentiation between `lease_expiry` (danger) and `rent_review` (warning) reads clearly.

Fifty-fourth 2026-05-22 follow-up: Tier 1 (a) v1 — top-bar nav converted to a 240px fixed left sidebar matching the design source-of-truth's command-centre spec. AppHeader now renders an `<aside>` with navy `#0B1020` background, brand + module list (Dashboard / Smart Intake / Properties / Tenants / Work / Billing / Insights / Portfolio QA / Settings, each with a Lucide icon and a `G X` shortcut chip on xl+ widths), and a "Keyboard shortcuts" footer link that opens the cheatsheet. Active state is a blue left rail + soft-blue tint. Top bar is now a slim sticky utility row (right-aligned entity selector children, search, cheatsheet, notifications, user) — no nav rows. On <lg widths the sidebar hides and a hamburger button in the top bar opens a left drawer with the same nav (backdrop + Escape close). To avoid pushing auth/setup/tenant-portal pages 240px right, AppHeader toggles a `body.app-shell-active` class on mount so the 240px gutter applies only to operator surfaces. Remba should review (a) the navy-to-soft-grey contrast at the seam between sidebar and content, (b) whether the right-aligned utility row should still be sticky now that the sidebar anchors navigation, (c) the chosen icon set per module (Home / FileSpreadsheet / Building2 / Users / Wrench / Wallet / Sparkles / HelpCircle / Settings), and (d) whether Properties and Tenants should remain separate sidebar entries or collapse back to a single "Portfolio" group with a sub-section pattern.

Fifty-third 2026-05-22 follow-up: Tier 2 (h) v1 — Linear-style keyboard shortcuts beyond Cmd+K. AppHeader's existing keydown listener now also handles a `G then letter` "go to" pattern (D/I/P/T/O/B/N/Q/S → Dashboard / Smart Intake / Properties / Tenants / Operations / Billing Readiness / Notifications / Portfolio QA / Settings), and `?` opens a cheatsheet modal listing Global + Go-to shortcuts. A bottom-centre toast confirms the 1.5-second G window is active. All single-letter shortcuts skip when the focused element is an input/textarea/select/contenteditable, so typing in any text field is unaffected. New header button (Keyboard icon, beside Search) opens the cheatsheet for discoverability. Remba should review (a) the toast placement vs. an inline header chip, (b) whether the letter map should match Linear/Stripe convention exactly (e.g. `M` for messages, but Leasium has no messages surface), and (c) whether `C` should alias Cmd+K to open the command palette (currently only Cmd/Ctrl+K does).

Fifty-second 2026-05-22 follow-up: Tier 2 (f) v1 — Cross-property activity feed on the Dashboard. New `GET /api/v1/activity-feed?entity_id=...` endpoint projects rows from the append-only `audit_action` table into a presentation-friendly shape: actor (joined from `app_user.display_name`), coarse `action_kind` (Created / Updated / Applied / Reviewed / Approved / Sent / Reminded / Revoked / Asked / Removed / Changed), summary (from `tool_output_summary` when written, otherwise synthesised), target label (batched lookup against property / tenant / lease / invoice_draft / maintenance_work_order / arrears_case / document_intake / tenant_onboarding / obligation), and deep-link href. `<ActivityFeedPanel>` renders below Ask Leasium grouped into Today / Yesterday / Earlier this week / Older buckets with a 60-second background refetch; success/failure outcomes are chipped distinctly and rows with errors surface the audit `error_message`. Read-only by design — no double-write, no separate feed model, no eventual consistency. Remba should review (a) whether the four-bucket time grouping is the right scaling pattern as audit volume grows or whether the feed needs date-range pagination instead, (b) whether the coarse `action_kind` palette is rich enough for operator scanning vs. surfacing the raw verb, and (c) whether the activity panel should anchor the top of the dashboard (above metric cards) since it's the closest analogue to the Vercel "what changed" surface.

Fifty-first 2026-05-22 follow-up: Tier 2 (e) v2 — "Ask Leasium" now has a dedicated Dashboard panel sitting directly under Upcoming lease events. The panel renders a question input with an "Ask" button, four suggestion chips (lease expiries / vacancies / open work / arrears > $5k) that submit the question on click, an answer card with whitespace-preserved text, a Sources strip rendering each citation as a deep-link chip (`Property · Queen Street Retail Centre` → `/properties?property_id=…`, etc.), an inline warnings strip, a collapsed Guardrails disclosure, and a Reset button to clear state. Errors (503 OpenAI-not-configured, network) render in a danger-toned inline alert. The fallback message when an answer arrives with zero citations explicitly warns the operator to treat it as unverified. Remba should review (a) whether the suggestion-chip set captures the 80% of queries this should answer, (b) whether panel placement under Upcoming lease events is the right anchor or whether it belongs above the metric-card row as a primary surface, and (c) whether the empty-state copy ("Answers stay grounded in your portfolio…") is clear enough about the read-only contract.

Fiftieth 2026-05-22 follow-up: Tier 2 (e) v1 backend — "Ask Leasium" AI Q&A. New `POST /api/v1/ai/ask` endpoint takes a natural-language question + entity_id, builds a bounded context dump of the operator's properties, units, tenants, leases, obligations, maintenance work orders, and arrears cases, and calls OpenAI with a strict-JSON schema requiring per-claim citations (kind + target_id + label). Citations are post-validated against the context so the model can't invent record IDs that don't exist in the operator's portfolio. Read-only by design — no provider mutations. Returns 503 cleanly when `OPENAI_API_KEY` isn't configured and audits every question (with citation kinds, not the answer body, to avoid logging paraphrased tenant detail). Frontend dashboard panel ships in the next commit. Remba should review the prompt's guardrail tone and the structured-JSON schema before this surface goes live to operators.

Forty-ninth 2026-05-22 follow-up: Tier 1 (b) v1 — new generic `DetailDrawer` component (`apps/web/src/components/detail-drawer.tsx`) lives as a right-side 560px panel with a sticky header, scrollable body, optional primary-action footer, Escape close, body-scroll lock, and backdrop click to close. Tenants table row click now opens a quick-view drawer showing contact (name/email/phone/billing email), active-lease summary chip, and the latest onboarding status with delivery copy; `/tenants/[id]` stays alive via an "Open full record" footer link for everything the drawer doesn't show (lease editing, documents, payment history). Property workspace already renders selected-property detail inline below the table — porting that to a drawer is a larger restructure deferred to a follow-up. Remba should review whether drawer width should match Linear's 720px tablet-friendly default and whether row-click is the right trigger vs. an explicit "Quick view" button per row.

Forty-eighth 2026-05-22 follow-up: Tier 1 (c) v1 — `DashboardMetricCard` now accepts a `trend` prop and renders a 7-day SVG sparkline + Stripe-style delta badge ("↓ 2 vs last week"). Sparkline colour swaps to green when the delta is moving the right way (configurable per-metric via `direction: higher-better | lower-better`). v1 wires the Operations urgent-obligations card; other cards stay un-trended until a `/dashboard/metric-trends` backend endpoint lands so the data is consistent rather than derived inconsistently per surface. Remba should review the SVG sparkline visual density (22px tall × 72px wide) and the delta-badge typography in the dashboard grid context.

Forty-seventh 2026-05-22 follow-up: Tier 1 (d) URL-persistent filters from the UX review now apply across Properties (`occupancy`, `owner_tag`), Tenants (`tenant_filter`, `q`), and Operations (`tab`, `assignee`, `maintenance_status`, `maintenance_priority`, `arrears_status`). Filter state hydrates from the query string on mount and writes back via `history.replaceState`, so operators can bookmark and share filtered views. Remba should review whether the search field also persisting via `?q=` is helpful or noisy.

Forty-sixth 2026-05-22 follow-up: a full UX audit lives at [`docs/ux-review-2026-05-22.md`](ux-review-2026-05-22.md), benchmarking Leasium against Linear, Stripe Dashboard, Notion, Vercel, Re-Leased Credia, and AppFolio Performance Platform. Strengths called out: review-first automation language, consistent status chip palette, mature disclosure pattern, Cmd+K command palette already in place, 65 distinct `<EmptyState>` usages, the just-shipped filter pills and occupancy badges, and the brand discipline that avoids "revolutionary AI" hype. Gap list (ordered by visible impact): top-bar nav vs. the design source-of-truth's left sidebar; no AI Q&A surface (single biggest competitive gap vs. Credia Advise); read-only tables vs. inline editing; only one right-side detail panel exists vs. the design SoT's expectation; metric cards lack trend deltas + sparklines; filters not URL-persistent and there are no saved views; keyboard model stops at Cmd+K; no dark mode; no multi-view (table/board/calendar) for the same data set. The review proposes a tiered roadmap: Tier 1 (sidebar, generic DetailDrawer, trend deltas + sparklines, URL-persistent filters) as the first concrete design-facing changes; Tier 2 (AI Q&A, activity feed, dark mode, expanded keyboard shortcuts) as the strategic next bet — with "Ask Leasium" Q&A flagged as the single highest-leverage move. Remba should treat the review as input only and decide which Tier 1 items enter the next implementation pass.

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
