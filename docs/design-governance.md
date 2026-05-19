# Leasium Design Governance

Last updated: 2026-05-19

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
- Insights is the portfolio dashboard layer: live health, exceptions, automation activity, and shareable snapshots generated later from the same data.
- Property work belongs in the property workspace: lease intake, units, leases, obligations, rent roll, and property-level billing readiness.
- Tenant work belongs in the tenant workspace: tenant search, contact/billing details, onboarding state, leases, documents, and activity.
- New modules should earn their own page when they become repeated work, not be squeezed into an existing page.
- Leasium should feel like modern tooling for operators: calm, fast, clear, and confident.

## Current Remba Review

Status: pass with fixes. Remba approved the tenant onboarding command center and
tenant detail direction on 2026-05-19, provided tenant workflow stays in the
tenant workspace rather than being added to the crowded property workspace.

Required fixes before major new feature work:

- Split `/properties` into clearer task zones or tabs instead of one long control panel.
- Move always-visible create/edit forms into contextual drawers or focused panels.
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

Status: pending Remba review. The Billing Readiness workspace now surfaces prepared billing drafts with approve/void status actions. Keep the guardrails visible: this is draft review only, with no invoice posting, tenant email, PDF generation, or Xero sync.

## Invoice Draft Staging Surface

Status: pending Remba review. Billing Readiness now creates and lists internal invoice drafts from approved billing drafts. Keep the staging language explicit: this is internal invoice preparation only, with readiness blockers visible and no PDF generation, tenant email, or Xero sync from this step.

## Invoice Delivery Prep Surface

Status: pending Remba review. Billing Readiness now stores internal invoice PDF artifacts, prepares branded email draft metadata, records manual tenant delivery receipts after approval, and tracks payment status. Keep the boundary explicit: Leasium is preparing and recording internal invoice work, provider-backed email sending is manual/recorded for now, and no Xero sync or external posting runs from this surface.

## AI Enrichment Surface

Status: pending Remba review. Property and tenant workspaces now expose public-fact suggestions for missing fields such as ABN, suburb/state/postcode, registered names, and registered addresses. Keep it review-first: show suggested value, citation, source hint, confidence, and any warning before Apply; never overwrite an existing field from enrichment; and keep unsupported/private facts out of the flow.

## Tenant Onboarding Delivery Polish

Status: pending Remba review. Tenant onboarding delivery now includes brand/template metadata, editable reminder schedules through the API, expiry reminders, provider receipt states, and contact/configuration recovery hints. Keep this in the tenant workspace and avoid turning reminder setup into a hidden configuration page.

## Tenant Detail Deepening

Status: pending Remba review. Tenant detail now surfaces property/unit/lease context, richer activity history, safer document provenance/actions, and reviewed-change history. Keep the page focused on the tenant record and avoid duplicating the full property workspace.

## Xero Readiness Surface

Status: pending Remba review. Settings now includes a Xero readiness workspace for entity connection state, contact readiness, charge-rule account/tax mapping, approved invoice sync queues, and payment reconciliation counts. Keep the boundary explicit: this is readiness and manual mapping only, not OAuth, live contact sync, invoice posting, or automatic reconciliation.

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
