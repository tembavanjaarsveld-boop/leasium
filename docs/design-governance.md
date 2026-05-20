# Leasium Design Governance

Last updated: 2026-05-20

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

## Billing Prep Sign-Off

Status: pass. Remba approved invoice/billing documents as the next Smart Intake direction on 2026-05-19 with strict guardrails: call it prepared billing work, not invoice creation; show that nothing is posted or synced to Xero; link the source document; and surface remaining billing/Xero/tax blockers in plain language.

## Billing Draft Review Surface

Status: pending Remba review. The Billing Readiness tabbed workspace now surfaces prepared billing drafts with approve/void status actions. Keep the guardrails visible: this is draft review only, with no invoice posting, tenant email, PDF generation, or Xero sync.

## Invoice Draft Staging Surface

Status: pending Remba review. Billing Readiness now creates and lists internal invoice drafts from approved billing drafts inside the Invoice prep tab. Keep the staging language explicit: this is internal invoice preparation only, with readiness blockers visible and no tenant email send or Xero sync from this step.

## Invoice Delivery Prep Surface

Status: pending Remba review. Billing Readiness now stores internal invoice PDF artifacts, prepares branded email draft metadata, can send explicitly approved provider-backed invoice emails through SendGrid, records manual/provider tenant delivery receipts after approval, and tracks payment status across the Invoice prep and Delivery & payments tabs. Keep the boundary explicit: Leasium is preparing and delivering approved invoice work, Xero sync remains a separate approval, and provider failures/skips must stay visible.

## AI Enrichment Surface

Status: pending Remba review. Property and tenant workspaces now expose public-fact suggestions for missing fields such as ABN, suburb/state/postcode, registered names, and registered addresses. Keep it review-first: show suggested value, citation, source hint, confidence, and any warning before Apply; never overwrite an existing field from enrichment; and keep unsupported/private facts out of the flow.

## Tenant Onboarding Delivery Polish

Status: pending Remba review. Tenant onboarding delivery now includes brand/template metadata, editable reminder schedules through the API, expiry reminders, provider receipt states, and contact/configuration recovery hints. Keep this in the tenant workspace and avoid turning reminder setup into a hidden configuration page.

## Tenant Detail Deepening

Status: pending Remba review. Tenant detail now surfaces property/unit/lease context, richer activity history, safer document provenance/actions, reviewed-change history, and compact tenant portal account access controls for revoke/unlink recovery. Keep the page focused on the tenant record and avoid duplicating the full property workspace or turning access recovery into a broad security page.

## Xero Readiness Surface

Status: pending Remba review. Settings now includes a Xero readiness workspace for entity connection state, contact readiness, charge-rule account/tax mapping, approved invoice sync queues, and payment reconciliation counts. Keep the boundary explicit: this is readiness and manual mapping only, not OAuth, live contact sync, invoice posting, or automatic reconciliation.

## Xero Provider Connection Surface

Status: pending Remba review. Settings now extends the Xero workspace with provider OAuth connect, contact sync preview controls, and reviewed local contact mapping apply. Keep the copy careful: provider-backed contact pulls can suggest tenant/property matches, reviewed applies only update local contact mappings, invoices are not posted, tenant emails are not sent, and payment reconciliation is not automatic.

## Xero Contact Mapping Apply

Status: pending Remba review. Reviewed local Xero contact mapping apply is built behind an explicit apply-preview contract that returns applied mappings, skipped mappings, guardrails, and applied time. Keep the surface review-first and compact: operators should see which tenant/property mapping will change locally, why anything was skipped, and that no invoice posting, tenant email, or payment reconciliation is triggered.

## Xero Chart/Tax Validation Preview

Status: pending Remba review. Provider-backed chart/tax validation preview is built behind `/api/v1/xero/chart-tax/validate-preview/{entity_id}` and returns checked-rule totals, per-charge-rule validation results, blockers, provider chart/tax context, and guardrails. Keep the surface preview-only and review-first: operators should see whether local account codes and tax types match provider settings before future invoice posting approvals exist, with explicit copy that no invoice posting, tenant email, or payment reconciliation is run.

## Xero Invoice Posting Preview

Status: pending Remba review. Provider-backed invoice posting preview is built behind `/api/v1/xero/invoices/posting-preview/{entity_id}` and returns approved unsynced invoice draft counts, per-draft ready/blocked results, draft Xero payload previews, line-item account/tax snapshots, blockers, and guardrails. Keep the surface dense and operational: operators should understand exactly what would be posted later while seeing that this step does not post invoices, mutate Xero, email tenants, or reconcile payments.

## Xero Posting Approval And Reconciliation

Status: pending Remba review. The backend now supports explicit local Xero posting approval, idempotent provider-backed Xero draft invoice creation, and payment reconciliation preview/apply into local invoice metadata. Settings now exposes the first operator approval surface from the invoice posting preview: each ready invoice can be approved or revoked for Xero, draft creation remains a separate action, and the result panel shows created/skipped/blocked/failed outcomes plus provider IDs when available. Remba should review whether this belongs in Settings long-term or should move per-invoice into Billing Readiness, and keep the copy clear that tenant email delivery and payment reconciliation remain separate approvals.

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

Status: pending Remba review. Portfolio QA remains a cleanup workspace at `/portfolio-qa` and is now surfaced from Insights as the IA entry point for portfolio cleanup rather than being added to the already-wide top navigation. Remba should confirm whether cleanup belongs under Insights long term, needs a secondary nav, or should graduate into its own module once operators use it repeatedly.

## Tenant Portal Surface

Status: pending Remba review. `/tenant-portal/[token]` now gives tenants a scoped self-service surface for onboarding status, lease context, approved invoices/payment summary, compliance/document upload and download, maintenance request submission/status, inline maintenance photo upload, and notification preferences with timestamped save receipts. Tenant document rows now show category, size, source, received timestamp, notes, and an explicit download action. The page now includes an Account Access panel when Clerk is configured, allowing a signed-in tenant to link the portal once, reload matching portal data through bearer auth, and continue maintenance requests, uploads, notification preferences, and protected document downloads through the tenant account boundary while the original token link remains available. Linked tenants can also return through `/tenant-portal` or `/tenant-portal/account` without the original token URL, and signed-in account status now distinguishes unlinked, revoked, restored, and wrong-tenant recovery states with plain guidance. Remba should review first-viewport tenant context, portal trust language, account-link placement, account-only entry copy, invite-expiry/recovery tone, upload/request density, document provenance density, preference receipt tone, invoice/payment clarity, and whether maintenance belongs before or after compliance for tenants.

## Tenant Portal Account Lifecycle

Status: pending Remba review. Operators can now see linked tenant portal accounts from tenant detail and choose revoke for blocked access, restore for staff-approved recovery, or unlink when the tenant should reconnect with the same login. The panel shows the latest recovery receipt with staff action, timestamp, and reason. Keep the action language plain and calm, keep the distinction between revoke, restore, and unlink obvious, and review whether recovery receipts should stay in tenant detail or move into a dedicated account recovery panel.

## Maintenance And Arrears Foundations

Status: pending Remba review. The backend now has migration-backed maintenance work orders and arrears/credit-control cases, and the first operator surface lives in `/operations`. Future screens should avoid crowding Properties or Tenants by deciding which work stays in the shared Operations queue and which work earns dedicated detail pages.

## Operations Workspace

Status: pending Remba review. `/operations` now replaces the top-nav Tasks entry while preserving `/tasks` as a redirect. It keeps the original triage queue and adds Maintenance and Arrears tabs with KPI cards, quick-create panels, tenant-portal submitted requests, expandable maintenance detail, quote approval context, invoice draft linking, activity history, and status actions for approvals, work starts, completion, reminders, escalation, and resolution. Maintenance rows now also link to a dedicated work-order route for deeper contractor quote evidence, invoice context, and activity history. Remba should review whether Operations is the right long-term IA home, whether the first viewport is too dense on laptops, and whether maintenance/arrears detail pages should become the default pattern over expandable rows.

## Property Provenance Surface

Status: pending Remba review. Smart Intake apply outcomes and the Property workspace now expose purchase-contract source history, field citations, confidence, and before/after property changes. Keep this review-first and factual: show what changed and where it came from, without implying the document source is automatically authoritative.

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
