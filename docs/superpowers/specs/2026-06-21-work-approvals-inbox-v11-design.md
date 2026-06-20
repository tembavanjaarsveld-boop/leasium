# Work Approvals Inbox v1.1 Design

Date: 2026-06-21
Owner: Temba
Surface: `/operations?tab=approvals`

## Goal

Make the shipped Work approvals inbox faster to triage without adding any mutation path. The slice is a read-only refinement: filter the decision queue by decision state and source, keep copy/download scoped to the visible filtered set, and send "Review source" links closer to the originating record where the app already has a stable route.

## Assumptions

- The existing v1 approvals inbox is the approved base. This slice should not change the candidate model, guardrail language, or provider-review posture except where filtering requires clearer count/export behaviour.
- No new backend endpoint is needed. All filters run on the already-loaded candidate list.
- This slice is internal-first: compact controls, scannable counts, and review speed matter more than decorative polish.
- Provider-adjacent candidates remain review-only. Filtering, copying, and downloading must not approve, send, dispatch, post to Xero/Basiq, reconcile payments, or update any source record.

## Experience

1. Add an approval state filter row:
   - All
   - Ready
   - Needs evidence/setup
   - Provider-adjacent
   - Recently safe/no action

2. Add a source selector:
   - All sources
   - Smart Intake
   - Maintenance
   - Invoice drafts
   - Compliance
   - Tenant onboarding
   - Assignment notices

3. Show filtered results inside the same grouped sections. Empty filtered views should say that no candidates match the selected filters, not that the whole inbox is empty.

4. Keep the visible summary honest:
   - Total candidates stays visible.
   - When filters are active, show the visible count against the total.
   - Clear filters appears only when a filter is active.

5. Copy/download approvals CSV exports only the visible filtered list. The guardrail text remains in the CSV.

6. Tighten handoff links where an existing stable route exists:
   - Tenant onboarding opens `/tenants/:tenantId` when `tenant_id` is present, falling back to `/tenants`.
   - Maintenance assignment notices open the existing maintenance detail route.
   - Leave obligation/arrears links on their current stable destinations unless a better existing anchor is already present.

## Non-goals

- No approve/complete/apply buttons.
- No provider/comms/payment/reconciliation calls.
- No new Figma/token work.
- No redesign of the Work tab, queue, calendar, compliance, arrears, or maintenance surfaces.
- No backend changes.

## UX Gate Notes

- Desktop 1440px: filter controls should fit above the candidate groups without pushing row actions into cramped wraps.
- Mobile 390px: controls should stack cleanly; source should use a native select rather than a wide chip rail.
- Hallmark slop test: no marketing copy, no decorative cards, no nested page-section cards, no giant hero typography, no hidden mutation affordance.

## Success Criteria

- Smoke coverage proves filtering by state and source changes the visible candidates.
- Smoke coverage proves copy/export content is scoped to the filtered view.
- Smoke coverage proves onboarding links to a tenant detail route when possible.
- Existing read-only provider traps remain quiet.
- UX screenshots at 1440px and 390px are reviewed and logged.
