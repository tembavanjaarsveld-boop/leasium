# Leasium Design Governance

Last updated: 2026-05-24

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
- 2026-05-25: Full tenant portal side rail now includes a tenant-scoped
  Recent Activity panel so tenants can see the latest onboarding, lease,
  document, maintenance, and preference updates without the page turning into
  a crowded admin dashboard. This remains pending Remba review.
- 2026-05-25 follow-up: Full tenant portal side rail now also shows confirmed
  Contact Details. v1 is deliberately read-only so tenant edits do not bypass
  the reviewed onboarding/change-control path. This remains pending Remba
  review.
- 2026-05-25 follow-up 2: Tenant portal Contact Details now includes a
  reviewed change-request flow for contact name/email/phone/billing email.
  The tenant portal shows persistent in-review/applied status after submission.
  Operators review and apply the request from tenant detail; legal/trading
  identity remains operator-controlled. This remains pending Remba review.
- 2026-05-25 follow-up 3: Operators can now dismiss tenant contact-change
  requests without mutating the tenant record, and the tenant portal shows the
  request as reviewed/closed. This remains pending Remba review.
- 2026-05-25 follow-up 4: Tenant portal now blocks duplicate pending contact
  change requests and hides the request form while a request is in review. This
  remains pending Remba review.
- 2026-05-25 follow-up 5: Operator portal preview now mirrors tenant contact
  change request status so property teams can see the same in-review/applied/
  dismissed state without opening the live tenant portal. This remains pending
  Remba review.
- 2026-05-25 follow-up 6: Owner statements now include a finance review
  preview with owner selection, owner contact context, monthly totals,
  property lines, a copied review summary, and print/save-PDF action. Owner
  dispatch remains separate and explicit. This remains pending Remba review.
- 2026-05-25 follow-up 7: Owner statement preview now includes dispatch review:
  recipient readiness, owner-facing subject/body preview, copy-to-clipboard,
  and a no-send guardrail. This remains pending Remba review before provider
  delivery is wired.

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

2026-05-21 update: invoice delivery prep now records the configured invoice template key/version plus a normalized rendered message preview in delivery metadata, and Billing Readiness shows the template/version badge with a collapsed email preview. Settings Organisation now has a communication template registry that lists current template keys, preview copy, review-first delivery rules, and provider receipt endpoints for invoice delivery, tenant onboarding, Work notices/digests, contractor email/SMS, and tenant portal preferences. 2026-05-27 follow-up: Settings also shows active stored `branded_communication_template` override rows in a read-only review panel with coverage against runtime template keys, keeping editing and send-time consumption paused for the internal-first period. Remba should review whether this belongs under Organisation or should become a dedicated Communications settings area once editable branded templates exist.

## AI Enrichment Surface

Status: pending Remba review. Property and tenant workspaces now expose public-fact suggestions for missing fields such as ABN, suburb/state/postcode, registered names, and registered addresses. Keep it review-first: show suggested value, citation, source hint, confidence, and any warning before Apply; never overwrite an existing field from enrichment; and keep unsupported/private facts out of the flow.

## Tenant Onboarding Delivery Polish

Status: pending Remba review. Tenant onboarding delivery now includes brand/template metadata, editable reminder schedules through the API, expiry reminders, provider receipt states, and contact/configuration recovery hints. Keep this in the tenant workspace and avoid turning reminder setup into a hidden configuration page.

## Tenant Detail Deepening

Status: pending Remba review. Tenant detail now surfaces property/unit/lease context, richer activity history, safer document provenance/actions, reviewed-change history, and compact tenant portal account access controls for revoke/unlink recovery. Keep the page focused on the tenant record and avoid duplicating the full property workspace or turning access recovery into a broad security page.

2026-05-25 update: tenant onboarding has been tightened around the account-first flow. The tenant form now exposes only the core contact fields by default, optional details sit behind a disclosure, and tenant-facing review copy avoids exposing the internal `reviewed` state. The required-documents step now reads as not required when no checklist exists, instead of implying the tenant is blocked. Tenant detail now gives operators one primary onboarding action for the common path: Approve & apply when clear, Approve for signing when lease signing is next, or Mark reviewed when questions still block signing. Remba should review whether those action labels make the sequence obvious without hiding the review-first guardrail.

2026-05-25 preview follow-up: the read-only operator tenant portal preview now uses the same tenant-friendly `In review` label and shows an explicit "Not required" checklist row when no onboarding documents are requested, instead of leaving the checklist empty.

2026-05-25 maintenance follow-up: tenant maintenance request cards now show a plain-language status line beside the existing status and priority badges. The copy explains what requested, triaged, assigned, awaiting approval, approved, in progress, completed, and cancelled mean from the tenant's point of view, and the operator preview mirrors it. Remba should review whether this is enough or whether maintenance needs a full tenant-side activity feed.

2026-05-25 compliance follow-up: the full tenant portal Compliance panel now mirrors the onboarding room's empty state. If no compliance checklist exists, the panel shows a "Not required" badge and explicit empty row while leaving optional supporting upload available.

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

2026-05-24 update: Billing Readiness Delivery & payments now brings that same accounting-freshness snapshot into the invoice-run surface. A compact strip explains the local accounting state and guardrails, while Xero-linked unpaid invoice rows show `Payment check missing` or `Reconciliation stale` with a Settings handoff for payment review. Settings fresh-state copy now says `Reconciliation current`, matching Billing Readiness, Insights, and snapshots. Remba should review whether the strip belongs above the dispatch filters and whether the row cue is clear enough without making every unpaid invoice feel like an error.

2026-05-27 update: Settings now adds a `Next accounting step` card inside the accounting freshness snapshot. It translates local freshness and exception counts into one operator path: resolve blockers, create approved Xero drafts, review Xero-linked payments, review warnings, or continue to Billing Readiness for month-end review. The card does not refresh Xero, post invoices, send tenant email, or reconcile payments on load; the payment path remains an explicit operator preview action. Remba should review whether this next-step copy is decisive enough without hiding the underlying checkpoint grid and guardrails.

2026-05-24 follow-up: Delivery & payments now also has a month-end finance checklist built from the same local state. It keeps the close process to five scan rows: Accounting setup, Invoice approvals, Provider dispatch, Payment reconciliation, and Month-end pack. The checklist points operators to Xero review, dispatch recovery, ready-to-dispatch rows, or Insights only when relevant, and it does not trigger any provider action. Remba should review whether this belongs in Billing Readiness long-term or should graduate into a dedicated month-end/owner-statements workflow once reporting deepens.

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

2026-05-24 update: Operations row-density follow-up keeps queue and maintenance rows scannable on small screens by collapsing assignment-heavy controls behind mobile-only disclosures below `xl`: `Work controls` in the queue and `Work-order actions` on maintenance rows. Closed summaries now carry assignee state plus work context (queue chip, maintenance priority/status, and notice state when present), so the collapsed row still explains why it matters. Desktop keeps the existing full control columns. Remba/Temba should review this on a real phone to confirm the disclosure labels feel obvious and that hiding controls by default does not slow daily operators down.

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

2026-05-24 update: completion communication drafts now have separate owner, tenant, and contractor review paths. Each recipient card has its own reviewed state, review note, and explicit `Mark reviewed` action, while preserving the no-send guardrail: the panel never sends email, writes to the tenant portal, or contacts the contractor. Remba should review whether the three-card review pattern is enough for SKJ now, or whether closeout copy should move into a dedicated communications approval queue once provider-backed owner/tenant sends exist.

2026-05-24 update: the Activity section on maintenance work-order detail now opens with a compact audit strip for latest update, external visibility, provider evidence, and closeout trail. Timeline rows also carry audience badges so operators can distinguish tenant-visible comments, contractor-visible comments, provider evidence, and internal/system audit rows at a glance. Remba should review whether the labels are plain-English enough for property managers and whether closeout/source evidence should be promoted from the completion panel into the unified activity timeline.

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

Fortieth 2026-05-22 follow-up: the Xero payment reconciliation stale window is now operator-configurable via the `XERO_RECONCILIATION_STALE_AFTER_DAYS` env var (defaults to 7). The configured value flows through `_accounting_freshness` and is surfaced in `accounting_freshness.stale_after_days` on `/xero/status`, Billing Readiness, the Insights overview, and the public finance snapshot. Fresh states now use `Reconciliation current` copy, while stale states show the configured window. Remba should review whether environment-only configuration is enough or whether the value needs an editable Settings control.

Forty-first 2026-05-22 follow-up: the maintenance work-order page now offers a contractor SMS template selector with attendance-window, status-update, completion-check, and billing-documents canned bodies, mirroring the existing contractor email templates. Operator edits reset the selector back to Custom; provider dispatch stays operator-controlled. Remba should review whether the SMS template copy is concise enough (SMS bodies are limited to 800 chars and need to stay direct) and whether the email + SMS template selectors should be visually grouped.

Forty-second 2026-05-22 follow-up: Settings Organisation tab now opens with a new `Integrations` card that lists the configured/not status of SerpAPI, OpenAI, SendGrid, Twilio, and Xero. The card consumes a new `/system/integration-status` endpoint which returns only booleans plus label/purpose/detail copy — no API keys, webhook secrets, or account IDs leak. Remba should review whether the card belongs above the Organisation profile section (current placement) or in a dedicated future "Provider setup" tab once the integration list grows.

Forty-third 2026-05-22 follow-up: the Properties table now shows an occupancy status badge inline beside each property name (Leased / Partial / Vacant / No units), derived from existing rent-roll rows. Active and holding-over leases count as occupied; pending/expired/terminated do not. A pill-row filter above the table lets operators show only properties in a chosen state, with counts per state visible at all times. Remba should review the badge palette (success / warning / danger / neutral) and whether the Internal-vs-external lease distinction should be a separate badge alongside, a colour modifier, or a dedicated filter pill once that data model exists.

Forty-fourth 2026-05-22 follow-up: the occupancy badge now distinguishes `Leased internal` (purple, leasium-blue palette) from `Leased` (green). Internal status is auto-derived by matching the rent-roll tenant name against the property's `owner_legal_name`, `trustee_name`, `trust_name`, or `invoice_issuer_name` (case-insensitive, trimmed). A property is `Leased internal` only when every unit is leased AND every lease is internal; mixed cases stay on `Leased` with an "N internal" suffix. Filter pills gain a `Leased internal` option. Remba should review whether the purple badge reads as a distinct state versus just a tone variant of Leased, and whether mixed cases need their own pill colour rather than the `Leased + internal suffix` treatment.

Forty-fifth 2026-05-22 follow-up: the Dashboard now opens with an `Upcoming lease events` panel surfacing the next 120 days of expiries, rent reviews, obligations, and onboarding follow-ups (sourced from the existing `/insights/overview` lease event snapshot). Each row deep-links to its property/lease. Panel header summarises counts per category (expiries / reviews / overdue / due soon / onboarding). Remba should review whether this should sit above or below the metric-card row, and whether the count badge palette differentiation between `lease_expiry` (danger) and `rent_review` (warning) reads clearly.

Sixty-fourth 2026-05-23 follow-up: Mobile UX review note at [`docs/mobile-ux-review-2026-05-23.md`](mobile-ux-review-2026-05-23.md). Code-driven audit (not a live phone walkthrough) over the main operator and tenant surfaces at 360-480px. Lists what already works (mobile sidebar drawer, 44px primary buttons, full-width inputs, `flex-wrap` action clusters, `md:grid-cols-2` form collapse), what is verified rough (Tenants list, header icon-only buttons at 40px, Tenant detail onboarding row density, Settings tab strip), and what needs a real phone before redesign (Notifications, Operations, Billing Readiness, AI Inbox). Recommends a prioritised mobile-polish-v2 backlog and flags the tenant portal onboarding panel sectioning as Remba-pending because it is the most-visible external surface. First slice — Tenants list mobile card view — shipped alongside.

Ninety-first 2026-05-23 follow-up: Maintenance categorisation v3 — frontend AI classification panel. New `AiClassificationPanel` between Approval and Contractor on the work-order detail page. When no classification yet: empty-state explains the categoriser, with a single Classify-with-AI SecondaryButton. After classification: category badge with confidence pct (palette: urgent=danger, plumbing/electrical=primary, other=neutral), AI summary in a quoted block, Same-day badge when `is_urgent`, classification timestamp, warnings list when present, and a primary-blue suggestion card showing the matched contractor name + email + phone. Apply-to-contractor button copies the suggested name onto `contractor_name` via the existing PATCH endpoint; an Applied StatusBadge replaces the button when the work order's contractor matches the suggestion. Fallback message when no contractor matched the category, with an inline link to `/contractors` so the operator can add a contractor and re-classify in one trip. Re-classify is a single click. Soft-fails inline with the 503 detail message. The backend metadata stamp now also includes `suggested_contractor_email` and `_phone` so a future v4 can apply all three fields at once. Remba should review (a) panel order (between Approval and Contractor today — could move above Approval since the AI suggestion drives the contractor pick that influences whether Approval should fire), (b) whether the suggestion card should auto-collapse once Applied, (c) the urgent badge copy ("Same-day" vs "Urgent" vs "Priority"), and (d) whether re-classification should require confirmation when an Applied suggestion is in place.

Ninetieth 2026-05-23 follow-up: Maintenance categorisation v2 — AI classifier + contractor suggest. New `stewart/ai/maintenance.py` with a 10-category enum mirroring `CONTRACTOR_CATEGORIES` (electrical / plumbing / hvac / locks / structural / appliance / cleaning / pest / urgent / other). OpenAI strict-JSON schema returns `{category, confidence, summary, is_urgent, warnings}`. `POST /api/v1/maintenance/work-orders/{id}/classify` runs the categoriser against title + description, picks the top-priority contractor whose `categories` overlap with the AI's chosen category, stamps `work_order_metadata.ai_classification = {category, confidence, summary, is_urgent, warnings, suggested_contractor_id, suggested_contractor_name, classified_at, model_response_id}`. Soft-fails 503 when OPENAI_API_KEY is unset. Audit records category + confidence + suggested contractor id (never the description body). No UI yet — v3 surfaces the suggestion on the work-order detail with Approve / Override. Remba should review (a) the AI prompt copy (does "Pick exactly one category" + "Reserve urgent for safety-critical" + "Australian context" capture the operator intent), (b) whether low-confidence (<0.5) should withhold the suggestion until manual pick, (c) whether `is_urgent` true should also fire a sidebar notification badge, and (d) whether contractor matching should consider service_radius_km against the property location (today it doesn't — geocoding deferred until v3).

Eighty-ninth 2026-05-23 follow-up: Contractor directory v1. New `contractor` table (migration `20260523_0024_contractors.py`) per-entity with name, company_name, categories list (electrical / plumbing / hvac / locks / structural / appliance / cleaning / pest / urgent / other), email, phone, service_radius_km, priority (1=preferred, 2=normal, 3=backup), notes. CRUD at `/api/v1/contractors` (list sorted priority asc + name asc, POST create, PATCH update, DELETE soft-delete). Operator-facing `/contractors` page with Add form (category pill multi-select), per-contractor card (priority badge, service-radius badge, category chips, notes block, Remove with confirm), empty state guiding operators to add contractors before AI suggest kicks in. Sidebar Contractors entry (HardHat icon, between Work and Billing, `G R` shortcut). v2 layers the AI maintenance classifier on top to suggest a contractor per work order. Remba should review (a) the priority labels and tones (Preferred=success, Normal=neutral, Backup=warning), (b) the category list (will likely grow — keep as plain strings or move to a separate seeds table), and (c) whether the directory page should also surface usage stats (last assigned, total work orders, average response time) once v2 ships.

Eighty-eighth 2026-05-23 follow-up: Owner monthly statements v2 — operator-facing `/statements` page. Reads the v1 JSON, renders month selector (defaults to previous calendar month), portfolio totals strip (owners count + invoiced + paid + outstanding + invoice count), and one `SectionPanel` per owner with trust/trustee/billing-email description, status badges for property count + invoice count + outstanding tone, owner-level metric grid, and a per-property table sorted by invoiced desc with overdue amounts highlighted in danger red. Inline footnote explains paid totals come from Xero reconciliation receipts and outgoings + management fees are a future roll-up. Empty state copy guides the operator toward Billing Readiness to approve invoices before they appear here. Sidebar nav gains a Statements entry (Receipt icon, between Insights and Portfolio QA, `G F` keyboard shortcut). No PDF export or send-by-email — v3 / v4 follow-ups. Remba should review (a) whether the Statements nav entry is in the right spot or should sit under Billing instead, (b) the per-owner card density (could feel heavy with many owners — pagination or accordion-collapse may be needed at scale), (c) the table column ordering (today: Property / Invoiced / Paid / Outstanding / Invoices), and (d) whether the portfolio totals strip should sticky-pin on scroll so it stays visible while reviewing.

2026-05-25 update: Billing Readiness now hands its month-end pack action into `/statements` with entity, invoice month, and close status. Owner statements reads that handoff, preserves the selected month instead of falling back to the previous calendar month, and shows a statement-pack readiness panel for ready/incomplete/unpaid/blocked states using local statement totals, invoice payment metadata, and Xero accounting freshness. Remba should review whether this creates the right mental model: Billing Readiness closes the run, Statements reviews the pack, and PDF/email export remain explicit future approvals.

2026-05-25 follow-up: Billing Readiness now fetches the owner-statement roll-up for the statement month and adds an Owner statements checkpoint to the month-end checklist. The checkpoint calls out owner count, statement invoice count, and missing owner billing emails before the Month-end pack row can read as fully clear. Remba should review whether this belongs in Billing Readiness or should move into a dedicated close/owner-statements workspace once dispatch is provider-backed.

Eighty-eighth 2026-05-24 follow-up: AI inbox v2.3 tenant-contact promote. `tenant_contact` classifications now get a review-first promote path instead of only a deep link. The operator confirms the tenant, clicks Prepare updates, sees current vs proposed contact values, ticks the fields to trust, and applies only those fields to the tenant record. The extractor is scoped to contact name, contact email, contact phone, and billing email; legal/trading identity changes stay out of scope. No provider send happens. Remba should review (a) whether the two-step Prepare -> Apply flow is the right guardrail for AI cost and review clarity, (b) whether billing email should be selected by default when it duplicates contact email, and (c) whether applying contact changes should route to tenant detail or keep the operator on `/inbox` with a success state.

Eighty-seventh 2026-05-23 follow-up: Owner monthly statements v1 — backend compile endpoint. Audit established that no `owner` table is needed; the existing 11 owner-identification fields on `Property` cover it. `GET /api/v1/owners/statements?entity_id=...&month=YYYY-MM` groups properties by an owner-identity tuple, aggregates approved InvoiceDraft totals for the target month, reads paid totals from `invoice_metadata.paid_cents`, returns a structured per-owner statement with per-property breakdowns. Read-only; no PDFs or email yet — v2 frontend page, v3 PDF generation via reportlab, v4 dispatch through the comms queue with PDF attached. Remba should review (a) the per-owner / per-property aggregation shape — is "invoiced + paid + outstanding" the right v1 financial summary or should outgoings + management fees roll up too, (b) whether the operator surface should default to "previous calendar month" (current behaviour) or "current calendar month to date", and (c) the statement format ahead of accountant sign-off, since the v3 PDF freezes whatever the operator surface settles on.

Eighty-sixth 2026-05-23 follow-up: Annual rent reviews v1 as a comms queue candidate kind. Data-model audit established that the existing `Lease` model has everything needed (`annual_rent_cents`, `next_review_date`, `lease_metadata` JSONB) so no migration. The increase formula lives at `lease_metadata["rent_review"] = {kind, increase_pct, cap_pct, formula_notes}`; v1 supports `kind: "fixed_pct"` with optional `cap_pct`. The comms queue scans active leases with `next_review_date` within 60 days (or overdue), computes the new rent, and drafts a tenant notice referencing current rent + proposed new rent + formula label. Severity steps: danger (overdue), warning (≤30 days), info (≤60 days). Leases without a formula surface with detail "needs increase rule" so the operator can set one before approving. Dispatch + dismiss work through the existing lease-targeted branch. Remba should review (a) whether the proposed-new-rent line should call out the percentage increase visibly in the email body or keep it embedded in the formula label, (b) whether overdue rent reviews should also fire as a sidebar nav badge alert (today they show up in the comms-queue counts but don't separately flag), and (c) whether SKJ wants v2 (CPI feed) prioritised over v3 (batch-approval surface) or v4 (auto-generate charge_rule on dispatch).

Eighty-fifth 2026-05-23 follow-up: Hide `UpcomingLeaseEventsPanel` on Smart Intake. The Dashboard component is rendered by both `/` (Dashboard) and `/intake` (Smart Intake) with a `mode="intake"` prop that already branches several sections via `!isIntakeWorkspace`. `UpcomingLeaseEventsPanel` was missing that guard so it rendered on both — operationally noisy on the focused document-workflow surface that Smart Intake is meant to be. Now wrapped with `{!isIntakeWorkspace ? ... : null}` matching the existing pattern at line 3876 (`DashboardCommandCenter`). Two other panels are still shared between the two surfaces and could follow the same treatment in a future slice — `AskLeasiumPanel` and `ActivityFeedPanel`. Remba should review (a) whether all three operational panels should leave Smart Intake (consistent "Smart Intake is focused" treatment), or (b) whether Smart Intake should keep Ask Leasium + Activity Feed because they can be useful during document review even though they don't drive the intake workflow.

Eighty-fourth 2026-05-23 follow-up: SMS outbound dispatch through Twilio Messaging. `/api/v1/comms/dispatch` now branches by candidate kind: `inbound_sms` candidates send via Twilio Messaging (new local `_send_comms_sms` helper that mirrors the SendGrid `_send_comms_email` shape, validates E.164 format, soft-fails when Twilio is not configured), everything else continues through SendGrid. Closes the inbound SMS reply loop end-to-end — operators can now Approve an inbound SMS candidate and actually reply via SMS, not email. The `/comms` card now treats inbound SMS as a phone-recipient/Twilio review, posts `recipient_phone` on approval, hides the email-only subject editor, uses SMS-specific skipped-provider copy, and shows a 160-character body guide before approval. Successful dispatches mark `inbound_message.processed_at` so the candidate clears from the queue. Audit log records `channel` + `tool_name = "twilio.twilio"` so receipts and sends are filterable. Remba should review (a) whether the operator UI should further distinguish SMS receipts from email receipts in the dispatched-status banner, (b) whether the 160-character guide should become a hard cap or remain a warning, and (c) whether the dispatch should offer to fall back to email when SMS sends fail.

Eighty-third 2026-05-23 follow-up: Inbound SMS via Twilio. New `POST /api/v1/comms/webhooks/twilio-inbound?entity_id=...` accepts Twilio's PascalCase form payload (`From`, `To`, `Body`, `MessageSid`, `FromCountry`), persists as `inbound_message` with `channel="sms"` + `provider="twilio"`, attributes by digits-only phone-number suffix match (so `+61400111222`, `0400111222`, and `+61 400 111 222` all map to the same tenant), and runs the same `/ai/triage` classifier when `OPENAI_API_KEY` is set. The comms queue gains a new `inbound_sms` candidate kind with SMS-appropriate copy (no subject line, no quoted snippet, short reply body). The existing inbound-email candidate path is unchanged. Dispatch + dismiss resolvers accept either `inbound_email` or `inbound_sms` against `inbound_message` targets. Setup steps documented in `docs/deployment.md`. Remba should review (a) the SMS reply copy ("Hi {name}, thanks for your message — we've got it and will follow up shortly") which is intentionally generic, (b) whether the SMS dispatch should fire through Twilio Messaging (today the dispatch endpoint only sends email — SMS dispatch is a follow-up slice), and (c) whether the queue should visually distinguish SMS cards from email cards (e.g. an SMS icon on the card header) to make the channel obvious.

2026-05-27 comms follow-up: `/comms` now includes per-kind filter tabs above the draft cards. Global totals remain visible, while operators can narrow to SMS replies, rent reviews, inbound email, compliance reminders, or other active candidate kinds without changing dispatch behavior. The page header surfaces queue-generated freshness, and draft cards also surface due and drafted timing chips so operators can see why a candidate is appearing now before editing the message. Remba should review whether these tabs are enough for SKJ volume or whether high-volume portfolios need persistent saved views.

Eighty-fifth 2026-05-24 follow-up: Tenant onboarding room v1 — full portal hidden until lease signing is complete. This is a UX-first correction to Tenant portal onboarding v1. After the account-first invite gate, tenants whose onboarding status is not yet `applied`, or whose onboarding is applied but lease signing is still incomplete, now land in a focused onboarding room rather than the general tenant portal dashboard. The first viewport answers one job: "Let's get your tenancy ready," with tenant/property/due context and account-ready/onboarding-status chips. The main column carries the existing review-first onboarding form/status and a required-documents panel for onboarding uploads only. The side column carries a compact checklist (tenant account, confirm details, required documents, property-team review, lease pack/signing), a lease snapshot, and "what happens next" copy. Payments, maintenance, notification preferences, invoice metrics, and access-boundary/guardrail panels are deliberately hidden until lease signing is complete. The public `/onboarding/[token]` page now avoids token-scoped data fetches and simply hands tenants to the account-first portal gate. Remba should review (a) checklist wording and statuses, (b) whether the details form should split into Identity / Insurance / Emergency sections, (c) whether the lease pack/signing step needs its own enabled state before full portal unlock, and (d) whether commercial vs residential document rules should be template-driven before broader beta use.

Eighty-second 2026-05-23 follow-up: DocuSign integration scaffold. `stewart/integrations/docusign.py` adds the typed dataclasses (`LeaseSignatureRequest`, `LeaseSignatureResult`) and `send_lease_for_signature` stub that mirrors the existing SendGrid `DeliveryResult` shape. Soft-fails with a clear `not_configured` error until the four DocuSign env vars (`DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_RSA_PRIVATE_KEY`) are populated on the API service; once configured, returns a `queued` stub with no envelope id until the next slice replaces the body with the real JWT-grant + envelope-create + Connect-webhook plumbing. No operator-facing endpoint exposed yet — this is integration plumbing only. Settings entries, deployment doc note, and handover pending-setup entry land alongside. Remba should review (a) whether DocuSign should be the only e-signature path or whether HelloSign / Adobe Sign should also be scaffolded behind a common interface, and (b) where the lease-send-for-signature operator action should appear in the UI once the scaffold is wired (lease detail page, Operations workspace, or a dedicated Signature surface).

Eighty-first 2026-05-23 follow-up: Evidence attach on `/comms` compliance candidates. Compliance obligation cards now show a dedicated Attach evidence panel between the body editor and the Approve/Dismiss row. The primary action is a prominent "Upload via Smart Intake" Link that takes the operator to `/intake` (per Temba's direction — Smart Intake's AI extraction + auto-attribution is the recommended path, not direct manual upload). A secondary muted SecondaryButton "Or attach a file manually" opens a hidden file picker and uploads through the existing `uploadDocument` endpoint with `category=other`, attributed to entity + tenant. v1 lands the file in StoredDocument but does not yet back-attribute the upload to `obligation_metadata.evidence_document_ids[]` — operators see the file under the tenant's documents tab, and v2 wires the formal attribution. Inline help text explicitly tells operators "finish review in Smart Intake to formally link" so the manual fallback's limitation is visible at the moment of use. Remba should review (a) whether the manual fallback should be hidden behind a disclosure instead of always visible (since the user direction was last-resort), (b) the accepted file types (currently pdf / png / jpeg), and (c) whether the success message should include a Link directly to the tenant documents tab so the operator can verify the upload landed.

Eightieth 2026-05-23 follow-up: Sidebar badge on the Comms nav entry. New `/api/v1/comms/queue/counts` endpoint returns a lightweight `{total, urgent, by_kind}` summary using the same scanners as the full queue. AppHeader sidebar reads localStorage for `leasium.entity_id` (matching the pattern other pages already use) and queries the counts on mount with a 60-second staleTime so navigation doesn't thrash the API. When the queue has any drafts, the Comms nav item renders a small badge — danger-red with the urgent count when `urgent > 0`, otherwise a muted white badge with the total count. The badge satisfies the user's "compliance reminders fire as in-app notifications" direction by making the operator see the queue count from anywhere in the app rather than having to remember to open /comms. Remba should review (a) the badge palette (danger-red vs. primary-blue for non-urgent), (b) whether the badge should also show on the `/notifications` entry once a notification queue ingests compliance reminders, and (c) whether mobile-collapsed sidebar should keep the badge visible alongside the icon.

Seventy-ninth 2026-05-23 follow-up: Mobile pass on /comms. Code-driven audit at 360-480px after the comms queue page shipped earlier today. Honest finding: the page is already mobile-correct as written. The metric grid uses `grid gap-3 sm:grid-cols-2 lg:grid-cols-4` (1 column on phones, 2 at sm, 4 at lg). The subject + recipient row is `grid gap-3 md:grid-cols-[1fr_220px]` which collapses to single column on mobile. The body textarea has `min-h-[180px]` which is tall enough to compose a real reply without being intrusive on a phone. Approve & send / Dismiss buttons inherit Button + SecondaryButton baselines so they're already 44px Apple HIG. Severity badge + detail row uses `flex flex-wrap items-center gap-2` so the detail string wraps cleanly under the badge on narrow widths. The status banner that appears after dispatch uses `flex items-center gap-2` which wraps correctly. No surgical fixes needed; this is the first new operator surface that landed mobile-clean on the first pass, which is the bar I want every future surface to clear. Remba should review whether the body textarea height is too large at 180px on a phone (could promote to `md:min-h-[180px] min-h-[120px]` if it feels intrusive) and whether the action button cluster at the bottom of each card should pin to a sticky footer on mobile so it stays in thumb reach.

Seventy-eighth 2026-05-23 follow-up: Compliance obligation tracking v1 in the comms queue. The existing `Obligation` model already covered insurance / bank_guarantee / make_good / compliance categories with a due_date + status lifecycle, so the comms queue piggybacks on it rather than introducing a new table. New `compliance_obligation` candidate kind sweeps obligations in `upcoming`, `due_soon`, or `overdue` status whose due_date is within 45 days (or already overdue). Severity tier matches urgency (overdue = danger, due_soon = warning, upcoming = info). Drafts a tenant-facing reminder when the obligation has a lease + tenant attached; otherwise the recipient is empty and the operator routes it manually before approving. Dispatch + dismiss extended to handle the new kind — both stamp a `comms_dismiss` key on `obligation_metadata` so future scans can honour the deferral. Remba should review (a) whether 45 days is the right window for compliance vs. 30 or 60, (b) whether the operator should be able to attach evidence (insurance certificate, fire-safety report) from the comms card itself rather than navigating to the property page, and (c) whether compliance reminders should also fire as in-app notifications, not just email.

Seventy-seventh 2026-05-23 follow-up: Inbound email AI classification v1. When `OPENAI_API_KEY` is set, the inbound webhook now runs the existing `/ai/triage` classifier against each inbound email body and stamps `classification_kind`, `classification_confidence`, `classification_summary`, and `classification_target_kind` on the `inbound_message` row. Soft-fails (no classification, row still persisted) when the key is missing or the call errors — the operator can classify manually from the comms queue. The comms queue's `inbound_email` candidate surfaces the classification in the detail line ("AI: payment or arrears (84%)") and elevates severity to `danger` for `payment_or_arrears` and `warning` for `maintenance_request`. Audit log records the classification kind only, never the body, matching the existing /ai/triage guardrail. Remba should review (a) whether the classification kind should also drive the suggested action label (e.g. "Open in Operations" vs. "Open in Arrears" buttons inline), and (b) whether the queue should default-sort by AI confidence rather than recency.

Seventy-sixth 2026-05-23 follow-up: Inbound email parsing v1. New `inbound_message` table (migration `20260523_0023_inbound_messages.py`) persists each parsed inbound channel message — email today, SMS/WhatsApp later. `POST /api/v1/comms/webhooks/sendgrid-inbound?entity_id=...` accepts the SendGrid Inbound Parse form payload, stores the structured fields (from/to/subject/text/html) plus the raw form for debugging, and attempts tenant attribution by matching the from-address against `contact_email` / `billing_email`. The comms queue surfaces unprocessed rows as `inbound_email` candidates with a "Re: <subject>" draft body. Approve dispatches a reply through the same SendGrid pipe used by the other kinds and marks the inbound row `processed_at`; dismiss archives the inbound row. v1 has no AI classification — the operator reviews the snippet and edits the reply themselves. v2 wires the existing `/ai/triage` classifier. Webhook is provider-only (unauthenticated path); v1 trusts the `entity_id` in the query because Inbound Parse is configured per-MX-domain at the provider. Remba should review (a) whether the inbound_email candidate should sit at the top of the queue (currently it does, ahead of arrears/insurance/lease) or alongside, (b) the placeholder reply body — should it be a richer template that surfaces the original message inline, and (c) whether SMS inbound should also funnel through `inbound_message` or get its own table.

Seventy-fifth 2026-05-23 follow-up: Comms dispatch v1 — operator-facing approve / edit / dismiss page. New `/comms` route renders each draft candidate from `/api/v1/comms/queue` as an editable card with severity badge (Urgent / Due soon / Heads up), kind label, tenant + property + unit attribution, detail explainer, editable subject / recipient / body, and Dismiss + Approve buttons. Approve fires `POST /comms/dispatch` which sends through SendGrid — the click is the explicit operator approval that satisfies the provider-mutation guardrail. The local `_send_comms_email` helper soft-fails to a `skipped` receipt when SendGrid is not configured. Dismiss fires `POST /comms/dismiss` and stamps a deferral (arrears: `reminder_paused_until`, tenant / lease: a `comms_dismiss` metadata key). Sidebar gains a Comms entry between Tenants and Billing with a `G C` shortcut. Backend additionally extends the queue to scan `insurance_expiry` (tenant_metadata.insurance_expiry_date within 45 days) and `lease_renewal` (active leases expiring within 120 days, severity stepped by 30 / 60 / 120-day buckets) candidates. Remba should review (a) the queue page layout — single column of cards vs. table-style rows + drawer for detail, (b) whether the inline edit affordance should be a Pencil chip on the subject / body rather than always-editable inputs, (c) whether the "Sent — status queued" success banner should auto-dismiss after a few seconds or stay until the page is refetched, and (d) whether the queue should default to a per-kind filter pill at the top rather than mixing all kinds together.

Seventy-fourth 2026-05-23 follow-up: Automation strategy note added at [`docs/automation-strategy-2026-05-23.md`](automation-strategy-2026-05-23.md). Captures the controlling design principle — Leasium's purpose is to take work off the operator, every screen should ask "what does the operator need to approve right now" rather than "what data does the operator need to enter right now" — and lists the automation backlog from near-term (scheduled comms loop, inbound email/SMS, compliance reminders, maintenance forwarding) through medium-term (rent increase batches, owner statements, bank-feed reconciliation, DocuSign, inspection intake) and big bets (WhatsApp, voice/Whisper, vacancy marketing copy + applicant triage, predictive maintenance, year-end tax pack, council comms routing, tenant self-serve rent adjustment, automated lease termination). Every entry in the backlog ships under the same operating rules: provider-mutation guardrail, audit by default, soft-fail when providers are missing, review-first surfaces, inline edit at approval time, Remba review for each visible queue/surface change. The product-roadmap.md now carries the full backlog under a new "Automation backlog" section. Remba should review the controlling-principle framing itself, the sequencing of near-term items (currently #1 is scheduled comms loop, #2 inbound email, #3 inbound SMS, #4 compliance reminders, #5 bank-feed, #6 folder-watch), and whether any of the "big bets" should be re-tiered up given SKJ's actual workflow.

Seventy-third 2026-05-23 follow-up: Tenants page CTA reframed from "+ Add tenant" to "+ Send invite". The old button opened an 8-field form (legal name / trading name / ABN / contact name / contact email / billing email / contact phone / notes) that only created a tenant record — the agent then had to navigate elsewhere to add a lease, create an onboarding row, and click Invite to portal. Four steps to start. The new flow is one step: the form asks where the tenant is going (Property + Unit dropdowns), who they are (Tenant name + Contact email, plus optional Contact name and Onboarding due-date), and the submit button is the explicit operator approval that satisfies the provider-mutation guardrail. On submit the frontend chains `createTenant` → `createLease` (status `pending`, all dates null — the data model already allows this) → `createTenantOnboarding` → `sendTenantOnboardingPortalInvite`. The tenant fills the remaining tenant-record fields themselves via the portal "Complete your onboarding" panel shipped earlier today, gated by Clerk sign-up so submitted data is bound to an authenticated identity rather than just a token-in-email — a real auth-boundary improvement over the legacy public-form path. Smart Intake remains the parallel rich-data path (contract upload → AI extraction → operator review); inline edit cells on the Tenants list remain the incremental-update path. Remba should review (a) whether the form should ask for the Property + Unit, or whether it should ask for just the email and let the operator assign-to-lease later as a separate step, (b) whether the "Onboarding due (optional)" field should be replaced with a "Send the invite now" / "Save as draft, send later" toggle so operators can stage invites in advance, and (c) whether the inline help text under the Send invite button is clear enough about what fires on submit.

Seventy-second 2026-05-23 follow-up: Mobile-polish v2 — AI Inbox classification CTA. On `/inbox`, the "Take it from here" Link inside the classification card is the operator's primary handoff button — it deep-links to whichever Leasium surface the AI suggested (Operations, Tenants, Properties, etc.) so the reviewed workflow takes over. It was rendered with `px-3 py-1.5 text-xs` (~32px tall), which is well below 44px HIG and feels small even on desktop given its weight. Bumped to `min-h-11 px-3 text-sm` so it sits at 44px and matches other primary actions. No other change on the surface — Try sample / Reset / Classify use Button/SecondaryButton baselines that already meet HIG. Remba should review whether the "Take it from here" button should also gain a primary-blue background (currently `bg-primary/5`, a faint tint) given its weight in the user's flow.

Seventy-first 2026-05-23 follow-up: Mobile-polish v2 — Billing Readiness surface touch targets. Same code-driven HIG pass as Operations and Notifications. Six primary action Links across `/billing-readiness` (the Open recovery anchor in the dispatch block, the Recover-in-Billing variants in the prep section, the Preview/PDF actions per invoice draft, and the bottom-of-section foundation links) move from `min-h-9` to `min-h-11`. The single delivery-status filter pill (Approved / Sent / Failed / Skipped switching) moves from `min-h-9` to `min-h-10`, matching the filter-chip compromise already used in `/notifications` and `/operations`. The dense `SecondaryButton` action rows with `min-h-9 rounded-lg px-3` overrides on invoice draft cards were verified as dead code — `SecondaryButton` baseline `min-h-11` wins — so no visible change in those clusters. Remba should review (a) whether the filter pill should also reach 44px on mobile only via a `min-h-10 md:min-h-9` pattern (for full HIG on touch while keeping desktop density), and (b) whether the per-invoice action rows should also wrap or stack at narrow widths now that buttons are uniformly 44px.

Seventieth 2026-05-23 follow-up: Mobile-polish v2 — Operations surface touch targets. `/operations` and `/operations/maintenance/[workOrderId]` get the same code-driven touch-target pass as Notifications. On the queue page: three primary action Links (Open tenants for onboarding rows, Review for document intake rows, Review completion on maintenance rows) move `min-h-9` → `min-h-11`; seven workload filter pill chips (Open / Unassigned / Assigned / Follow-up due / My work / per-member workload buttons) move `min-h-9` → `min-h-10`, the same filter-chip compromise used in `/notifications`. On the work-order detail page: the Operations back link moves `min-h-10` → `min-h-11`; four invoice-handoff Links (Open in Billing, Recover in Billing, Preview, PDF) and the documents Download anchor move `min-h-9` → `min-h-11`. The dense `SecondaryButton` action rows with `min-h-9 px-3` overrides were verified as dead code — `SecondaryButton` baseline is `min-h-11` and CSS `min-height` wins — so no visual change there. The three-tab Operations strip (Queue / Maintenance / Arrears) was already mobile-correct (`min-h-16` per tile, single-column stacking on mobile). Remba should review (a) whether the 40px workload chip compromise feels consistent across Operations + Notifications or if those chips should also reach 44px on mobile only, and (b) whether the invoice-handoff cluster on the work-order detail page wants a tighter layout once buttons are uniformly 44px tall.

Sixty-ninth 2026-05-23 follow-up: Mobile-polish v2 — Notifications surface touch targets. Three buttons in `/notifications` now meet 44px Apple HIG: the unread/group filter chip (line 534) went `min-h-9` → `min-h-10` (40px, deliberate filter-pill compromise — taller would make the filter row feel heavy with multiple chips); the per-row "Open work" Link (line 938) went `min-h-9` → `min-h-11` (primary action, full HIG); the bottom-of-page "Open Work" Link (line 1482) went `min-h-10` → `min-h-11`. A wider audit of the row's `SecondaryButton` instances with `h-9 px-2.5` overrides showed those are dead code — `SecondaryButton` baseline is `min-h-11` and CSS `min-height` wins over `height`, so the buttons are already 44px tall. No visible layout or density change. Code-driven only; the broader phone-walk review of Notifications, Operations, Billing Readiness, and AI Inbox in [`docs/mobile-ux-review-2026-05-23.md`](mobile-ux-review-2026-05-23.md) still pending. Remba should review whether the filter-chip 40px compromise feels right or whether the chips should also sit at 44px on mobile only (`min-h-10 md:min-h-9`).

Sixty-eighth 2026-05-23 follow-up: Mobile-polish v2 — Tenant detail onboarding row collapses provider detail on mobile. Below `md`, the Delivery / Reminders / Expires / Applied 4-column sub-grid + onboarding delivery detail copy + reminder schedule sub-card + delivery timeline strip are now wrapped in a closed-by-default `<details>` disclosure labelled "Provider detail" (chevron-down icon that rotates on open). The onboarding row's status badge, due date, action button cluster (Copy onboarding link / Resend / Cancel / Apply / Invite to portal), and Submitted-for-review section all remain always visible. Desktop ≥md still renders the metadata always-on in its existing layout — the same JSX is reused via a `providerDetail` const inside the map iteration so the two modes don't drift. Remba should review (a) the `Provider detail` summary copy — is it the right shorthand for that bundle of metadata, or should it be `Delivery + reminders`?, (b) whether the disclosure should also collapse on `<sm` tablets rather than just `<md`, and (c) whether collapsing makes the onboarding row feel like data is hidden vs. just decluttered.

Sixty-seventh 2026-05-23 follow-up: Mobile-polish v2 — Settings tab buttons now meet the 44px Apple HIG touch target (`min-h-11` instead of `min-h-10`). The audit recommendation in [`docs/mobile-ux-review-2026-05-23.md`](mobile-ux-review-2026-05-23.md) had flagged horizontal-scroll-on-overflow as a concern, but the actual code uses `flex-wrap` and only renders three tabs, which wraps cleanly without overflow — so no scroll behaviour was added; only the touch target. Remba should review whether the tab buttons should also gain stronger active-state contrast given the navy/blue sidebar already anchors the active surface.

Sixty-sixth 2026-05-23 follow-up: Mobile-polish v2 — `AppHeader` icon-only buttons (mobile hamburger, search, keyboard-cheatsheet, notifications) now sit at `h-11 w-11` (44px) instead of `h-10 w-10` (40px), meeting the Apple HIG touch target minimum that the audit in [`docs/mobile-ux-review-2026-05-23.md`](mobile-ux-review-2026-05-23.md) flagged. The Clerk `OperatorUserControl` wrapper at the right end of the cluster also bumps to `h-11` so the cluster sits on a consistent baseline. The icon size (15px) is unchanged. No design-language change — purely target-size.

Sixty-fifth 2026-05-23 follow-up: Mobile-polish v2, Tenants list mobile card view. Below `md` the Tenants table at `/tenants` is hidden and a single-column stacked card list takes its place, one card per tenant. Each card surfaces (1) tenant name as a primary anchor, (2) onboarding status badge to the right, (3) contact email/phone fallback as muted secondary text, (4) due-date chip — red when overdue, (5) an inline "Contact needs fixing — open to update" warning when `onboardingNeedsContactFix` is true. The whole card is a single tap target opening the existing `TenantQuickViewDrawer`; action buttons (Copy link, Resend, Cancel, Invite to portal) are intentionally not duplicated on the card — the drawer's "Open full record" CTA leads to the full tenant page where they live. Desktop ≥md retains the existing five-column table unchanged. Remba should review (a) whether the status badge should sit above the name rather than to the right (current layout puts the badge at the trailing edge of the title row), (b) whether the due-date chip should always render even when "not set" so the row height stays consistent, and (c) whether to add a second tap target — e.g. a chevron icon — to telegraph that the whole card is interactive.

Sixty-third 2026-05-23 follow-up: Tenant portal onboarding v1 — account-only onboarding through the tenant portal. The operator's primary onboarding CTA on the tenant detail page is now an "Invite to portal" button (sits at the top of the existing row-action cluster alongside Copy onboarding link, Resend, Fresh link, Cancel). Clicking it fires the new `POST /tenant-onboarding/{id}/send-portal-invite` endpoint, which builds a dedicated `tenant_portal_invite` SendGrid + Twilio template pointed at `/tenant-portal/[token]` rather than the public form. Tenants who click the email link sign in through Clerk and land on the existing portal dashboard, where a new "Complete your onboarding" panel sits above Payments. The panel renders the same fields the public form used (legal name, ABN, contact name/email/phone, billing email, insurance confirmed + expiry, emergency contact, notes) with prefill from `submitted_data` or the existing tenant record, a single acceptance checkbox, and a primary "Submit for review" button. After submission the panel collapses to a read-only "Submitted X. Your property manager will review and confirm shortly." state. The existing operator review/apply remains the only path that writes to the canonical tenant record — the dashboard submit only ever updates `submitted_data`. The standalone `/onboarding/[token]` public form is retired; old links now show a small redirect screen pointing tenants to the portal. Remba should review (a) the CTA hierarchy on the tenant page — "Invite to portal" is now the primary Button while "Copy onboarding link" / "Resend" / "Fresh link" stay as SecondaryButtons, and the existing reminder/delivery chips remain in place; (b) the portal panel density — 10 fields in a 2-col grid plus two checkboxes and a notes textarea may feel heavy for a first-time tenant, vs. splitting into "Identity" / "Insurance" / "Emergency contact" subsections; (c) the retired-form redirect screen, currently a one-card explainer with an "Open the tenant portal" CTA — whether it needs a stronger visual or a "request a fresh invite from your property manager" fallback for tenants whose old link's token is no longer valid; (d) whether the portal panel should also surface the lease download link inline rather than relying on the Compliance section below it.

Sixty-second 2026-05-23 follow-up: nav pattern evidence note added at [`docs/nav-pattern-research-2026-05-23.md`](nav-pattern-research-2026-05-23.md). Documents the UX evidence supporting the just-shipped Tier 1 (a) v1 left sidebar — item count + nesting depth argument, NN/g and Baymard references, Linear/Stripe/Notion/Vercel comparison set, and the conditions under which the decision should be revisited. No design change is proposed; this is evidence for Remba's Tier 1 (a) sign-off and a durable record for the next maintainer who asks `why a sidebar and not a top bar`. Remba should treat the note as supporting context for the existing Tier 1 (a) review, not as a separate review item.

Sixty-first 2026-05-22 follow-up: Tier 3 v1 multi-view for Properties. A tab strip above the Properties workspace lets the operator switch between Table (existing) and Board (new) views, persisted via `?view=board` URL param so a bookmark survives. Board view inline component `<PropertyBoardView>` groups the same filtered property set (occupancy + owner_tag filters still apply) into five occupancy columns: Leased (success-soft), Leased internal (blue-soft), Partial (warning-soft), Vacant (danger-soft), No units (muted). Columns with zero matches hide. Each card renders the property thumbnail, name, truncated address, and next-expiry chip; clicking selects the property the same way the table row does. Map and Calendar variants noted as v2 — Map needs a library decision (Leaflet vs Mapbox); Calendar's natural surface is upcoming lease events on the Dashboard, not properties themselves. Remba should review (a) whether five columns wrap cleanly on smaller screens (currently lg:grid-cols-2, 2xl:grid-cols-3), (b) whether the Leased-internal column should fold into Leased with a chip rather than be its own bucket, and (c) whether the board should support drag-to-reorder once a status workflow exists for property lifecycle states.

Sixtieth 2026-05-22 follow-up: Tier 3 v1 mobile responsive audit pass. Surveyed every primary operator surface at <480px and 480-1024px viewport widths and shipped three concrete fixes: (a) AppHeader utility row is now `flex-wrap` — the entity selector drops to a full-width second row on mobile (order-last + sm:order-none) instead of cramming the icon cluster, and the Keyboard cheatsheet button is hidden below sm because phone operators don't drive by keyboard. (b) Dashboard metric grid promoted from `md:grid-cols-2 xl:grid-cols-6` to `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6` so the six cards don't stall at two-wide on a 1280px laptop. (c) Properties workspace table is now horizontally scrollable (`overflow-x-auto`, `min-w-[640px]`) on phones rather than clipping under the inline-edit cells. Operations / Notifications / Tenant portal / Tenants pages already used responsive patterns (`flex-wrap`, `md:grid-cols-`, `overflow-x-auto`) that reflow correctly — no changes needed and the audit confirmed they read on phones. Remba should review (a) whether the bottom-row entity selector on mobile feels right or should sit inside the sidebar drawer instead, (b) whether the 6-metric dashboard row should drop entirely on phones in favour of a stacked single-column metric stack, and (c) whether tenant portal needs a dedicated mobile review now that more tenants will use the platform.

Fifty-ninth 2026-05-22 follow-up: Tier 3 v1 — AI inbox processor at `/inbox`. New surface where the operator pastes an inbound email or message body; OpenAI returns a strict-JSON classification (one of seven kinds), a confidence score, a one-line paraphrased summary, an imperative suggested next action, a `suggested_target_kind` enum mapped to a deep-link, and up to 6 key fact label/value pairs. Frontend renders the classification with a kind chip + confidence chip, a Suggested next step card with the "Take it from here" deep-link button, a Key facts strip, an inline warnings strip, and a collapsed Guardrails disclosure. Empty state explains the contract: read-only, no automatic record creation, personal details paraphrased not echoed. Sample button seeds a realistic maintenance message so operators can try the surface without finding a real email. Backend audits body length + kind + confidence (deliberately not the body itself, since pasted messages can contain sensitive contact info). New AI Inbox row added to the sidebar (Inbox icon, between Smart Intake and Properties) and `G M` shortcut wired into the keyboard navigation. Remba should review (a) sidebar placement of Smart Intake vs. AI Inbox — they're conceptually different intake paths, (b) whether v2 should auto-create a draft work order/arrears case after operator approval rather than just deep-linking, and (c) whether kind/confidence/target should be inline-editable before the operator hands off.

2026-05-24 Operations follow-up: Operations maintenance inline edits now get a brief undo toast after status or priority changes. The toast names the changed field, shows the previous value, lets the operator undo the PATCH immediately, and auto-dismisses after a short window. The shared `<InlineEditCell>` select path was also fixed so the committed value is the newly selected dropdown value rather than the stale value from the prior render. Smoke coverage now exercises status change → undo → restored awaiting-approval state. Remba should review (a) whether a bottom-right toast is the right placement for dense Operations work, (b) whether nine seconds is enough recovery time, and (c) whether status/priority chips still need a more explicit "edited" audit marker in the row itself.

Fifty-eighth 2026-05-22 follow-up, superseded 2026-05-24: Operator tenant portal preview is now a dedicated read-only operator route rather than opening the tenant invite URL. Each lease row with an active, non-expired onboarding links to `/tenants/{tenantId}/portal-preview/{onboardingId}`. The API endpoint `GET /api/v1/tenant-portal/operator-preview/{onboarding_id}` resolves the same tenant-visible portal payload through the signed-in operator session and marks `auth.mode = operator_preview`, with guardrails that no tenant portal account/session is created. The preview shows tenant-visible lease, checklist, documents, payments, maintenance, contact, and guardrail sections, with no tenant submit/upload/maintenance mutation actions. Remba should review (a) whether this is enough of a tenant-perspective mimic without sharing the full tenant-side component tree, (b) whether document download links should stay available in preview, and (c) whether preview access should write an audit row despite being a read-only GET.

Fifty-seventh 2026-05-22 follow-up: Tier 3 v1 saved views — operators can now name and recall filter combinations on Tenants, Properties, and Operations. New helper `apps/web/src/lib/saved-views.ts` stores views per surface in `window.localStorage` (`leasium.saved_views.tenants` / `properties` / `operations`). New `<SavedViewsMenu>` component renders a Bookmark chip above each filterable table that shows the active view name when filters match, "Custom view" when they don't, or a saved-views-empty fallback. Click → popover lists saved views with Apply / Rename / Delete; an inline "Save current as…" form captures whatever filter combination is currently active. Saved view filters re-apply by calling each page's existing setState setters so URL persistence + page state stay aligned. v1 is local-only so a saved view does not yet sync across devices — fine while SKJ is the only operator on the platform, but we'll promote to a backend `saved_view` table once a second operator comes online. Remba should review (a) chip placement (above the filter pills vs. inline with the pills), (b) whether "Custom view" should auto-prompt for a name after a filter change, and (c) whether saved views should also serialise the search term (currently they do for Tenants `q`, but pulled out of the URL for Properties because there's no Properties search input).

Fifty-sixth 2026-05-22 follow-up: Tier 3 v2 + v3 — inline editing extended to Properties and Operations. `<InlineEditCell>` gained an `options[]` prop so callers can render a select dropdown instead of a text input; the dropdown auto-commits on change. Properties workspace table now uses InlineEditCell for property name (font-medium variant) and street address (with a formatDisplay callback that composes "street, suburb state" for the read-only view). Operations Maintenance list now uses InlineEditCell select for both status (8 options: requested → cancelled) and priority (4 options: low → urgent), wrapped in a soft chip frame so the inline-edit affordance still looks like a state pill. All updates flow through optimistic React Query cache patches against the existing PATCH endpoints with rollback on failure. Remba should review (a) the chip frame around the Operations selects vs. preserving the original coloured StatusBadge tone, (b) whether the address formatter should also surface suburb/state as separate editable fields, and (c) whether property name editing on a row that's currently selected (the row click also selects → load detail) should trigger a refresh of any open detail panels.

Fifty-fifth 2026-05-22 follow-up: Tier 3 v1 — inline-editable cells on the Tenants table. New reusable `<InlineEditCell>` lives at `apps/web/src/components/inline-edit-cell.tsx` and follows the Linear/Notion/Stripe inline-edit contract: read-only display with a subtle pencil affordance on hover/focus, click to edit, Enter or blur to commit, Escape to cancel, loading spinner during save, inline error message + retry-without-losing-typed-value on failure. `/tenants` Contact column now uses three InlineEditCells (contact_name, contact_email, contact_phone) backed by the existing PATCH `/api/v1/tenants/{id}` endpoint. Updates are optimistic — the React Query cache patches immediately, with rollback on failure so the operator never sees a "saved then reverted" flash. The backend audit log captures every change. Remba should review (a) the pencil-on-hover affordance vs. an always-visible edit hint, (b) whether the inline error should be a toast or stay inline beside the cell, and (c) whether the drawer's Contact section should also become inline-editable in v2 or whether the drawer should stay strictly read-only with all editing flowing through the table + full record.

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

## External Design Review 2026-05-23

Status: pending Remba review. An external structural design pass produced
`docs/external-design-review-2026-05-23.md` covering navigation drift, typographic
hierarchy collapse, monolithic page files, dashboard density, public onboarding
first-impression, container hierarchy, mobile/tablet IA, and accessibility
heading levels. The review was code + design-doc only; a live-pixel pass on
Vercel should follow before the larger items ship.

### Nav trim — 13 → 8 primary items

Status: pending Remba review. The sidebar `navItems` in
`apps/web/src/components/app-shell.tsx` has been trimmed to Dashboard,
Smart Intake, Properties, Tenants, Work, Billing, Insights, and Settings.
Removed from the sidebar but reachable from the Cmd-K command palette and
the keyboard G-shortcuts: AI Inbox, Contractors, Comms, Statements, and
Portfolio QA. The G-letter shortcuts for removed items still work so
operators keep their muscle memory while the IA settles. The
Properties + Tenants → Portfolio consolidation (toward the 7-item target
in the 2026-05-21 nav simplification note) is deferred until a Portfolio
landing exists to host both. Remba should review whether the 8-item nav
reads as calmer on laptop sidebars, whether the Cmd-K palette is
discoverable enough as the new home for removed items, and whether the
keyboard cheatsheet should distinguish nav items from palette-only
destinations.

### Typography hierarchy — restore page/section ladder

Status: pending Remba review. `apps/web/src/components/ui.tsx` now exports
`PageTitle` (`<h1>`, 30/36/600, tracking-tight) and `SectionTitle` (`<h2>`,
18/28/600, tracking-tight) and uses them inside `PageHeader` and
`SectionPanel` respectively. Previous values were `text-xl` (20px) at h2
for page titles and `text-[15px]` at h3 for section titles, a 38–44% gap
versus the SoT scale and a flat document outline. Headings are also now
correctly nested (h1 → h2 inside a workspace page) instead of starting
at h2. Remba should review whether 30px page titles read as appropriately
operator-mode rather than marketing-heavy on dense pages like
`/properties`, `/operations`, `/billing-readiness`, whether 18px section
titles bump the panel rhythm enough without dominating, and whether
sub-section text inside panel bodies needs a third reusable heading
(`RowTitle`/`SubsectionTitle` at 15px) for full coverage.

### Dashboard reshape — metric grid 6 → 4, Smart Intake hoisted

Status: pending Remba review. The Dashboard metric grid in
`apps/web/src/components/dashboard.tsx` has been trimmed from six
cards (`xl:grid-cols-6`) to four operational cards (`lg:grid-cols-4`):
Operations / Billing blockers / Needs review / Blocked docs. The
Properties and Tenants cards were removed because they were
navigational counts rather than "act now" metrics, and the sidebar
already links to both surfaces. Operator awareness of property/tenant
totals now lives in the sidebar nav and in the underlying workspaces;
if this regresses awareness in practice, we can add a quieter
secondary strip below the operational metrics. Orphaned helpers
(`propertiesLoading`, `tenantsLoading`, `displayPropertiesCount`,
`displayTenantsCount`, `portfolioOccupancy`, `propertiesOccupancySummary`)
and the now-unused `portfolioOccupancyTotals` / `propertyOccupancyFromRentRoll`
imports were cleaned up.

The two-column Smart Intake + Needs attention section was hoisted
from below Activity feed (position 8) to right after the Daily command
center (position 2). The new dashboard order is: Command center →
Smart Intake + Needs attention → Metric grid → Upcoming lease events
→ Ask Leasium → Activity feed. The drop zone is now in the first
viewport at common laptop sizes, which is what the SoT hero-workflow
language asked for. The same two-column section is reused in intake
mode, so `/intake` benefits from the same lift.

Remba should review whether the four operational metrics feel like
the right "what needs me right now?" set; whether removing Properties
and Tenants from the metric strip is a regression in portfolio
awareness; whether the two-column Smart Intake block at position 2
makes the dashboard feel more active or more cluttered; and whether
the metric strip should sit above or below the two-column block in
a future iteration once Remba has eyes on Vercel.

### Public onboarding first-impression — `/onboarding/[token]`

Status: pending Remba review. The page at
`apps/web/src/app/onboarding/[token]/page.tsx` has been rewritten from
a 60-line "Your onboarding has moved into your Leasium account"
redirect stub into a real first-impression surface. The page still
hands the tenant off to the portal — it does not restore the public
onboarding form, since the Tenant portal onboarding v1 work
intentionally retired that — but it now welcomes the tenant by name,
identifies the property (and unit, where one is on file), shows the
onboarding status with due-date and link-expiry reassurance, includes
a calm "your property manager only sees what you submit, nothing is
applied until they review and confirm" trust line, and offers a
single prominent "Continue to portal" CTA.

Context is loaded via the existing `getTenantPortal(token)` public
endpoint — no new API surface. The token used here and on
`/tenant-portal/[token]` is the same value, so the same record
resolves. Three render states: skeleton while the token resolves,
the full welcome card when the API returns, and a calm fallback
("You're invited to onboard") when the token is missing, expired, or
the API errors. A separate "already submitted" path turns the CTA
into "Open your portal" and drops the property/due-date block so the
page doesn't ask the tenant to act when they don't need to.

Remba should review the welcome-by-name copy, whether the property
chip placement reads as helpful context or visual clutter, whether
the trust line at the bottom should sit inside or outside the card,
whether the "Invitation active" status pill is the right wording
versus simpler labels like "Ready", and whether the expired/error
fallback ("If your invitation link has expired, your property manager
can send a fresh one") needs an explicit "request fresh link" path
later.

### Active-nav surface tone + chip token cleanup

Status: pending Remba review. Two small wins bundled:

1. Sidebar active-nav state in `apps/web/src/components/app-shell.tsx`
   was `bg-leasium-blue-soft/10` (`#EAF0FF` at 10% opacity) on a
   navy-900 sidebar — perceptually invisible. Replaced with
   `bg-white/[0.12]` so the row reads as a real surface tone, not just
   the 2px left rail. Hover also bumped from `hover:bg-white/5` to
   `hover:bg-white/[0.06]` so cursor-on-row is detectable. Active rail
   and text color unchanged.

2. Status chip text colors were hardcoded hex literals (`text-[#027A48]`,
   `text-[#B54708]`, `text-[#B42318]`) in 12 files (40 occurrences) —
   `apps/web/tailwind.config.ts` now defines named tokens
   `leasium-success-strong`, `leasium-warning-strong`, and
   `leasium-danger-strong` matching those values, and the literals have
   been bulk-replaced with `text-leasium-success-strong` /
   `-warning-strong` / `-danger-strong` across the codebase. **Side
   effect:** several files already referenced
   `border-leasium-success-strong/30` / `-warning-strong/30` /
   `-danger-strong/30` expecting the tokens to exist; those borders
   were silently dead before this commit and will start rendering now
   that the tokens resolve. The drift is in the original author's
   favour — visible borders are what they wrote.

The primary chip text (`text-leasium-blue-hover` reused for both link
hover and chip text) was deferred — that's a smaller separate concern
worth its own naming pass once we know whether they should diverge.

Remba should review whether the new active-nav tone reads as
"selected" without being too prominent; whether hover/active feel
distinct enough; and whether any previously-dead chip borders look
wrong now that they render (worst case: walk them back to no border
in StatusBadge or the per-page chip primitives).

### Loading-state polish — SkeletonRows primitive + adoption

Status: pending Remba review. `apps/web/src/components/ui.tsx` now
exports `SkeletonLine` + `SkeletonRows` primitives. Pulse-animated
rows mimicking the eventual list/table content, separated by
`divide-y` like real rows, with `aria-busy="true"` and `aria-label="Loading"`
for screen readers.

Replaced the most-visible `<EmptyState title="Loading X." />` loaders
with `<SkeletonRows>` in:

- Dashboard (4 spots: Smart Intake review queue, Needs attention,
  Upcoming events, Billing readiness)
- `/contractors`, `/comms`, `/statements` (one each — wrapped in
  `<SectionPanel>` since they were originally rendered as a
  full-width centered empty card)
- `/tenants` (table-cell fallback row + mobile card list)
- `/tenants/[tenantId]` (full-page loading state)

Did NOT touch: the structured `<SectionPanel title="Loading X">`
+ `<Loader2>` patterns on Dashboard, Properties, Operations,
Insights, Billing Readiness — those are already informative
section-level loaders, not the thin-text-in-empty-card pattern that
was flagged. They stay as-is.

Did NOT touch: the four monolithic page files
(`property-workspace.tsx`, `settings/page.tsx`,
`operations/page.tsx`, `billing-readiness/page.tsx`) for non-trivial
loading-state replacements — those are still in the file-split queue
and changes there should go in once the extraction starts.

Remba should review whether the 3- or 5-row skeleton matches the
real content density on each surface, whether the pulse animation
speed reads as "loading" rather than "broken", and whether mobile
contractors/comms/statements loading needs a different (shorter) row
count.

### Container hierarchy — Surface archetype + typography drift fixes

Status: pending Remba review. `apps/web/src/components/ui.tsx` now
exports a `<Surface>` component as a sibling to `<SectionPanel>`.
Surface has no card chrome (no border, radius, or shadow) — just a
heading, optional description, optional actions, and a divider rule.
Use for the main workspace body (tables, lists, dense data on a
continuous canvas) where SectionPanel's card chrome was producing
the "stack of look-alike white cards" pattern flagged in §4 of the
external review.

Adoption note: `<Surface>` was added but not retrofitted into the
existing workspace pages. The four monolithic page files
(`property-workspace.tsx`, `settings/page.tsx`,
`operations/page.tsx`, `billing-readiness/page.tsx`) are in the
page-file split queue, and Surface adoption is best done during
those extractions, not as a separate pass that touches enormous
files. New workspace surfaces should default to `<Surface>` for
body content from now on.

Same-commit typography drift cleanup: three small pages
(`/contractors`, `/comms`, `/statements`) were carrying raw
`<h1 className="text-2xl font-semibold">` page titles (the 20px-era
pattern, 4px below the 30px PageTitle the typography ladder fix
established). Replaced with `<PageHeader>` so they render at the
canonical 30px h1 with the description and actions slot used
correctly.

Remba should review the Surface component's exact treatment
(divider rule weight, header pt-4 spacing, header-less variant);
whether the typography upgrade on the three list pages reads as
calmer or marketing-heavy at 30px on small pages; and whether
Surface should ever auto-collapse its divider when it's the only
section on a page.

### Mobile/tablet IA — sidebar collapse at md

Status: pending Remba review. The fixed sidebar in
`apps/web/src/components/app-shell.tsx` previously disappeared
entirely below `lg` (1024px), forcing tablet operators (iPad at
768/810, Android tablets in the 800-900 range, landscape phones)
into the hamburger-drawer experience even though they had room for
persistent nav.

Now the sidebar has three states:

- sub-md (<768px): hidden, hamburger drawer overlay (unchanged).
- md (768-1023px): collapsed to 64px icon-only rail. Brand text,
  nav labels, comms count, and shortcuts text all hide via
  `md:hidden lg:inline`/`lg:block` classes. `title` attributes on
  every nav link provide native hover tooltips so labels stay
  discoverable on hover-capable devices.
- lg+ (≥1024px): full 240px sidebar (unchanged).

`globals.css` adjusts `body.app-shell-active` padding-left to match
(0/64/240px across breakpoints). The active-nav state at md drops
the 2px left rail since it clashes with a 64px-wide square row; the
`bg-white/[0.12]` surface tone alone signals the selected row at
icon-only width.

Deliberately deferred (per CLAUDE.md §2.3 internal-first guidance):
- Bottom-nav for the most-used five destinations at sub-md (review
  §8.2). Hamburger drawer is enough for the internal beta.
- Tablet-specific tap-target sizing pass on the icon rail.

Remba should review whether 64px is the right icon-rail width,
whether the `title` hover tooltip is enough discovery for tablet
users (some tablets can hover via stylus or pointer mode; others
can't), whether the active state needs a different signal at
icon-only width, and whether the mobile drawer's labels-always-show
behaviour holds up when the drawer is wide enough to span much of
a 480-700px viewport.

### Reduced-motion global override

Status: pending Remba review. The SoT (and the 2026-05-23 external
review §9 a11y pass) called for respecting `prefers-reduced-motion`
but the CSS wasn't there. `apps/web/src/app/globals.css` now ships a
global `@media (prefers-reduced-motion: reduce)` rule that pins every
transition/animation to ~0.01ms and forces `scroll-behavior: auto`.

Behaviour for users with "Reduce Motion" set in their OS (macOS:
System Settings → Accessibility → Display → Reduce motion; iOS:
Settings → Accessibility → Motion → Reduce Motion; Windows: Settings
→ Accessibility → Visual effects → Animation effects): all hover
fades, sidebar slides, modal/drawer transitions, spinners, etc.
become instant. The information is still conveyed — buttons still
change colour, panels still appear and disappear — just without the
visual delay.

SoT §10.5.7a documents the rule and the `motion-safe:` opt-out path
for any component whose animation is genuinely load-bearing
(currently none in the codebase). Pending Remba review of whether
any existing animation should opt back in via `motion-safe:`.

### Dashboard order — metric strip up to position 2 (operator override)

Status: pending Remba review. Per direct operator request 2026-05-23,
the four-up metric strip on `/` (Operations, Billing blockers, Needs
review, Blocked docs) moved from position 3 to position 2.

Previous order (set earlier this review per §3 of the external
review):

1. Daily Command Center
2. Two-column Smart Intake + Needs Attention
3. Metric strip
4. Upcoming lease events
5. Ask Leasium
6. Activity feed

New order:

1. Daily Command Center
2. **Metric strip** (was 3)
3. Two-column Smart Intake + Needs Attention (was 2)
4. Upcoming lease events
5. Ask Leasium
6. Activity feed

Rationale: the operational-metric cards already carry status chips
("Act now" / "Blocked" / "Empty" / "Clear"), 7-day trend deltas, and
a "next action" line per card. They're status-with-action, not
summary stats. Putting them adjacent to the Command Center makes the
at-a-glance scan land in one continuous first-viewport read.

This is a deliberate revision of the §3.1 + §3.2 ordering call
earlier in this review. SoT §10.5.6 updated to match — the original
"Smart Intake at position 2" rule the SoT recorded was based on the
review's "hero workflow" reading; the operator's actual day-to-day
preference is the metric scan first. SoT now records the override
with explicit rationale so future authors don't re-flip it.

Remba should confirm whether this order reads as calmer in
practice, and whether the Smart Intake drop zone still feels
discoverable at position 3.

### Page-file split — dashboard.tsx phase 3

Status: pending Remba review. Third extraction slice.
`DashboardCommandCenter` (the first-viewport ranked-actions panel on
the dashboard) plus its `CommandCenterItem` and
`CommandCenterCounts` types moved to
`src/components/dashboard/DashboardCommandCenter.tsx` (214 lines).
Parent imports both types + the component.

`commandCenterSort` stays in dashboard.tsx because it leans on the
parent-local `dueRank` date helper. Promoting `dueRank` / `dateOnly`
/ `dueLabel` / `formatDate` / `formatMoney` / `intakeStatusTone` /
`obligationTone` to `src/lib/` is queued as a separate slice — those
are general-purpose helpers and several other operator pages
duplicate them.

Net: dashboard.tsx 3,751 → 3,577 lines (−174). Cumulative across
phases 1+2+3: 4,463 → 3,577 lines (−886, 20% reduction).

Phase 4+ queue:
- `DocumentIntakeApplyOutcomeCard` (248 lines, fairly self-contained
  reviewed-apply outcome card)
- `DocumentIntakeReviewPanel` (646 lines, biggest single piece —
  takes many props from parent state; will require careful prop
  threading)
- General-purpose date/money/tone helpers → `src/lib/` and migrate
  the duplicated copies across operator pages.

### Page-file split — dashboard.tsx phase 2

Status: pending Remba review. Second extraction slice. Two more
panel families pulled out of `dashboard.tsx`:

- `DashboardMetricCard` + its `DashboardMetricTrend` type + the
  `MetricSparkline` and `MetricDeltaBadge` sub-helpers +
  `computeOpenObligationTrend` (the 7-day roll-up the parent uses
  to pass a trend prop into the Operations card) →
  `src/components/dashboard/DashboardMetricCard.tsx` (217 lines).
- `UpcomingLeaseEventsPanel` + its `leaseEventKindLabel` and
  `leaseEventKindTone` helpers →
  `src/components/dashboard/UpcomingLeaseEventsPanel.tsx` (138
  lines).

Parent imports both via the now-established
`src/components/dashboard/` directory. Behaviour unchanged.
Orphaned `LeaseEventRecord` type import from `@/lib/api` cleaned up.
`InsightsOverviewRecord` import retained — still used by the parent's
useQuery generic.

Net: dashboard.tsx 4,048 → 3,751 lines (−297). Cumulative across
phases 1+2: 4,463 → 3,751 (−712, 16% reduction).

Phase 3+ queue (in order of bounded-ness):
- `DashboardCommandCenter` (159 lines + CommandCenterItem /
  CommandCenterCounts types + commandCenterSort helper)
- `DocumentIntakeApplyOutcomeCard` (248 lines, fairly self-contained)
- `DocumentIntakeReviewPanel` (646 lines, biggest single piece, has
  many props from parent state)
- Remaining helpers (intakeStatusTone, obligationTone, dueRank,
  formatDate, formatMoney, etc.) — these are general enough to live
  in `src/lib/` rather than dashboard sub-components.

### Page-file split — dashboard.tsx phase 1

Status: pending Remba review. First slice of the page-file extraction
queue. `apps/web/src/components/dashboard.tsx` is still the largest
component file in the repo (4,500+ lines after the metric/order
reshape earlier this review). This commit establishes the
co-located `src/components/dashboard/` directory pattern and pulls
out the two cleanly-bounded panels that already had simple prop
contracts:

- `AskLeasiumPanel` (227 lines, including its citation-kind helper
  + suggestion-chip constant) → `src/components/dashboard/AskLeasiumPanel.tsx`
- `ActivityFeedPanel` (180 lines, including its action-kind tone
  map + relative-time/time-bucket helpers) →
  `src/components/dashboard/ActivityFeedPanel.tsx`

dashboard.tsx imports both from the new files. Behavior is
unchanged — exact same JSX rendered with the same props from the
parent Dashboard component. Net: dashboard.tsx 4,463 → 4,048 lines
(−415), pattern established for the remaining extractions.

Same-commit drift consolidation: two small helpers that were
duplicated across many operator pages now have a canonical home:

- `friendlyError(error: unknown) => string` is now in
  `apps/web/src/lib/utils.ts`. Was reimplemented inline in 15 page
  files. New extractions import it from there; existing inline
  copies will be migrated opportunistically.
- `StatusTone` union (the chip-tone union used to type the value
  side of per-domain tone maps) is now an exported type from
  `apps/web/src/components/ui.tsx` and also drives `StatusBadge`'s
  `tone` prop. Was reimplemented inline as `type StatusTone =
  "neutral" | "success" | "warning" | "danger" | "primary"` in 7
  page files. Same opportunistic-migration plan.

Remba should review whether the co-located
`src/components/dashboard/` directory is the right home for these
extractions (alternatives: `src/app/_components/`, an in-route
co-located folder once the dashboard moves into `/dashboard`), and
whether extractions should aim to bring the parent file under 400
lines per the SoT §10.5.3 cap or accept that some orchestrator
files will stay larger.

### Deferred from the external review

Not addressed yet, queued for follow-up:

- Page-file split phase 2+ — extract `DashboardCommandCenter`,
  `UpcomingLeaseEventsPanel`, `DocumentIntakeApplyOutcomeCard`,
  `DocumentIntakeReviewPanel`, and `DashboardMetricCard` from
  dashboard.tsx (~1,500 more lines).
- Page-file split for `property-workspace.tsx` (6,120 lines),
  `settings/page.tsx` (4,517 lines), `operations/page.tsx` (4,694
  lines). Surface adoption rides with each.
- Migration of inline `friendlyError` / `StatusTone` redeclarations
  in the remaining 15 / 7 pages.
- Mobile bottom-nav at sub-md (review §8.2) — deferred per
  internal-first scope.
- Container hierarchy — introduce a workspace `<Surface>` distinct from
  the aside `<SectionPanel>` so dense table pages stop reading as a stack
  of look-alike white cards.
- Mobile/tablet IA — collapse sidebar at `md` instead of disappearing at
  `lg`; consider a bottom-nav for the top 5 destinations on sub-`md`.
- Loading-state polish — replace remaining `... Loading` text-string
  loaders with section-level skeletons.
- Chip-color token cleanup — replace hex literals in `StatusBadge` with
  named `leasium-success-strong` / `leasium-warning-strong` /
  `leasium-danger-strong` tokens.
- Active-nav surface tone in sidebar — replace the
  `bg-leasium-blue-soft/10` tint (effectively invisible on navy-900) with
  a real surface tone.

### Token consistency pass v1 (2026-05-23) — Remba approved

Slice landed against the Visual polish + brand gap surfaced by the
competitive rating against Re-Leased / PropertyMe / PropertyTree. Driven
by Ticket 1 of the polish-skill plan (`docs/external-skills/hallmark/`
and `docs/external-skills/anthropic-frontend-design/` informed the
rubric; Codex SoT remains the source of truth). All six items below
are visible and Remba-approved 2026-05-23 alongside the Motion polish v1
slice (commit bb65224).

- [x] Added `Micro: 11px / 14px / 600 / 0.01em` step to Codex SoT §4
  Typography. New Tailwind utility `text-leasium-micro`. Migrated all 35
  ad-hoc `text-[11px]` and `text-[10px]` usages (13 files: app-shell,
  property-workspace, dashboard, dashboard/*, saved-views-menu,
  property-occupancy, plus 6 page files). The 6 `text-[10px]` callers
  bumped up 1px to align on the new token — Remba confirmed the bump
  in chip/kbd contexts reads correctly.
- [x] Mirrored full Codex slate ramp (200 / 150 / 100 / 50) into
  `tailwind.config.ts`. Previously truncated at slate-300.
- [x] Added Codex `borderRadius` extension to `tailwind.config.ts`
  (`leasiumXs` through `leasium2xl`). Previously missing entirely;
  `rounded-leasium*` consumers silently fell through to Tailwind defaults.
- [x] Added missing CSS vars in `globals.css`:
  `--leasium-radius-xs/-xl/-2xl` and `--leasium-shadow-md/-lg`. Now
  available for non-Tailwind contexts (inline styles, SVG, third-party
  embeds).
- [x] Added `tabular-nums` at the `<table>` className level across 13
  table elements in 6 files (billing-readiness, tenants,
  intake/spreadsheet, settings, property-workspace, statements). Numbers
  now align in arrears, rent roll, statements, and intake review.
- [x] Extracted hardcoded sparkline colours in
  `DashboardMetricCard.tsx` into a `SPARKLINE_STROKE` const referencing
  Codex tokens. SVG stroke props can't take Tailwind classes, so the
  const stays in the file with a pointer to lift it to a shared module
  if other charts need it.

Verified: ESLint + tsc clean on all 18 touched files; Playwright smoke
re-run on Temba's Mac and passed.

### Motion polish v1 (2026-05-23) — Remba approved

Two no-decision items from Ticket 3 of the polish plan, shipped in
commit bb65224.

- [x] Added `ease-leasium` to the DetailDrawer backdrop opacity
  transition. The one outlier across 80 transitions that paired
  `duration-200` without an easing token; backdrop fade now matches
  the panel ease.
- [x] Migrated `focus:` → `focus-visible:` on 62 className occurrences
  across 11 files for the form-input pattern (`outline-none` paired
  with `focus:border-primary` / `focus:ring-2` / `focus:ring-primary`).
  Form inputs no longer flash a focus ring on mouse click; keyboard
  navigation behaviour is unchanged. One checkbox case
  (`focus:ring-primary` without `outline-none`) intentionally left for
  a follow-up.

### Motion polish v2 (2026-05-23) — Remba pending

Four decision-needed items from Ticket 3 of the polish plan, shipped
after Remba pre-approved the recommendations.

- [~] Codex SoT §5 motion scale amended to Fast 150 / Base 200 /
  Slow 300 (was 120 / 180 / 260). Aligns with Tailwind stock durations
  so the 80 existing `duration-200` callers continue to read as Codex
  Base without a token migration. New authoring guidance: prefer
  `duration-leasiumFast/Base/Slow` tokens for new work so future scale
  changes are one config edit, not 80.
- [~] Added two new easings to Codex SoT §5 alongside the existing
  Enter (`ease-leasium`): Exit (`ease-leasiumIn`,
  `cubic-bezier(0.7, 0, 0.84, 0)`) for elements leaving and Toggle
  (`ease-leasiumToggle`, `cubic-bezier(0.65, 0, 0.35, 1)`) for
  symmetric state changes. Mirrored as CSS vars
  (`--leasium-ease-in`, `--leasium-ease-toggle`) and Tailwind tokens.
- [~] Added three @keyframes blocks to `globals.css`:
  `leasiumDrawerSlideInRight`, `leasiumModalFadeScale`, and
  `leasiumBackdropFadeIn`. Surfaced as Tailwind-style utility classes
  `animate-leasium-drawer-in-right`, `animate-leasium-modal-in`, and
  `animate-leasium-backdrop-in`. All animate `transform` and `opacity`
  only (GPU-composited, no layout trigger).
- [~] Applied the enter animations to four high-traffic surfaces:
  DetailDrawer (`components/detail-drawer.tsx`), EvidenceDrawer
  (`components/evidence-drawer.tsx`), the keyboard cheatsheet modal,
  and the command palette modal (both in `components/app-shell.tsx`).
  Drawer entries slide in from the right at Slow=300ms; modal entries
  fade and gently scale at Base=200ms; backdrops fade in at Base.
  Reduced-motion preference still collapses everything to 0.01ms via
  the existing global escape hatch.

Remba should review: animation feel (too long? too snappy?),
direction (right-slide for drawers is correct for the workspace
layout), and modal scale magnitude (0.97 → 1 — barely perceptible).

### Finance and Portfolio QA polish (2026-05-26) — Remba pending

- [~] Owner statement PDF export v1 adds an authenticated Download PDF
  action to `/statements`, a full-pack ZIP export, and a
  backend-generated review pack. The ZIP now includes an accountant
  manifest CSV with owner totals, recipient readiness, outstanding
  amounts, and review status. Review the PDF hierarchy, property table
  density, owner identity copy, manifest fields, and whether the
  print/download affordances should collapse into a single statement
  export menu before owner email dispatch is wired.
- [~] Portfolio QA completion report + bulk staging v1 adds readiness
  scoring across data QA, tenant contacts, owner billing identity,
  onboarding prep, billing drafts, and source trails, plus a compact
  AI-assisted enrichment candidate queue and a blocked-followups queue
  for the next cleanup rows. Tenant contact and owner billing sections
  now also have "Stage suggestions" and "Save staged fixes" actions.
  Follow-up: Onboarding prep now opens with an invite blocker review
  that separates ready invites, contact blockers, expired links,
  existing invite workflows, and setup blockers before batch creation.
  Billing drafts now opens with a billing cleanup blocker review for
  owner identity fixes, rent-roll readiness blockers, and existing
  internal drafts before new draft generation.
  Second follow-up: the completion report now carries a final-readiness
  verdict so the operator sees whether the register is still blocked,
  ready after enrichment review, or ready for live SKJ tuning.
  Review whether the percentage model feels operationally honest,
  whether the staging language is clear enough, whether the blocked
  followups are prioritised correctly, whether the blocker summaries
  feel useful or too dense, whether the final-report wording feels
  decisive enough, and whether the enrichment queue belongs above or
  inside the Data QA tab.

### Tenant onboarding simplification (2026-05-26) — Remba pending

- [~] Tenant onboarding now keeps the account-first guardrail but makes
  first touch lighter: email-code Clerk gate with invite-email prefill,
  4 required confirmation fields, optional disclosure for extra details,
  a 3-step tenant checklist, and no tenant-facing `reviewed` state.
  Review the account gate copy, optional-details wording, checklist
  sequencing, and whether the focused lease-signing route feels distinct
  enough from initial onboarding.
- [~] Operator onboarding review now exposes **Approve & apply** as the
  routine primary action and a post-approval **Send lease pack** action
  from the tenant detail page. The lease pack points tenants to the
  account-scoped lease page, the full portal unlocks only after signing,
  and operators can answer lease questions raised after approval but
  before signing. Review whether the combined approval copy still makes
  the review-first guardrail obvious and whether the lease pack CTA
  belongs in the onboarding panel or a broader lease panel.
- [~] Tenant detail now shows onboarding progress as invite → tenant
  details → approval → lease file → send pack → sign, and adds a
  custom lease bypass upload scoped to the exact onboarding/lease before
  **Send lease pack** is enabled. The tenant lease-signing panel now
  surfaces attached lease documents for download before the tenant
  confirms signing. Review whether the custom-lease bypass wording is
  clear enough until property lease templates/generation land, and
  whether the send button should remain disabled until a lease file is
  attached.

### Deferred from Motion polish v2 — pending decision

- Mobile nav drawer (`app-shell.tsx:497`) slides in from the LEFT;
  needs a separate `drawerSlideInLeft` keyframe or a CSS variable
  flip. Deferred per CLAUDE.md §2.3 (mobile is below the
  internal-first laptop priority).
- Three property-workspace modals (`property-workspace.tsx:5385/5680/5775`)
  still pop in instantly. Deferred until the planned page-file split
  for `property-workspace.tsx` (6,120 lines) lands.
- Exit / close animations not yet implemented. Drawers and modals
  unmount on close in a single render cycle. Hallmark recommends
  ~75% of enter duration for exits; Codex SoT §5 now documents the
  exit easing token but no surface uses it yet.

### Deferred from the token consistency pass — pending decision

- Ownership tag palette (12 chip colour combos in
  `lib/property-ownership.ts`) still uses non-Codex hex literals. Needs
  an explicit "Owner tag palette" section added to Codex SoT §3 before
  migration. Remba decision: pick 8–12 distinguishable owner-tag colours
  from a Codex-aligned palette, or accept the current ad-hoc set as the
  spec.
- `text-[15px]` (7 callers in dashboard / AskLeasiumPanel /
  CommandCenter) is between Codex Body Small (14) and Body (16). Remba
  decision: which step to migrate to per surface. Defer until those
  panels are next being touched.
- Token alias drift — `tailwind.config.ts` exposes both `leasium-*`
  tokens and shadcn-ish short aliases (`primary`, `accent`, `foreground`,
  `muted`, etc.); components use a mix. Remba decision: standardize on
  one naming layer (recommend short aliases as the public API and
  `leasium-*` for hover/pressed variants).
