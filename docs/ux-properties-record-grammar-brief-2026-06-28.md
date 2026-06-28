# Properties And Record Page Grammar Brief - 2026-06-28

This is the R5 brief from the full-platform UX cleanup. It follows
`docs/ux-platform-audit-roadmap-2026-06-28.md`,
`docs/ux-route-frame-index-2026-06-28.md`, and
`docs/ux-navigation-deeplink-contract-2026-06-28.md`.

Status: draft Figma source exists. Do not restructure Properties or People
record pages in code until Temba approves the record grammar and the desktop
plus mobile property record drafts.

## Draft Figma Source

- Shared grammar: `03 Screens / Record Page Grammar - Draft 2026-06-28`
  (`190:988`).
- Property desktop: `03 Screens / Property Record Desktop - Draft 2026-06-28`
  (`190:989`).
- Property mobile: `03 Screens / Property Record Mobile - Draft 2026-06-28`
  (`190:990`).

The desktop and mobile frames were checked with Figma metadata and screenshots
on 2026-06-28. The mobile draft keeps visible two-row tabs and the source-trail
action at 44px height, with no bottom-nav overlap.

## Current State

- `/properties` server-side state currently accepts `action` and `view`.
- `action=new` opens the property drawer.
- `view=cards|board|table|map` chooses the portfolio workspace mode.
- Record selection is query state inside the same workspace:
  `property_id`, optional `entity_id`, plus `occupancy` and `owner_tag`.
- There is no standalone `/properties/[id]` route.
- Detail state is local client state:
  `propertyRecordMode`, `activePropertyDetailTab`, and `activeWorkspaceTab`.
- Property tabs currently include
  `overview|lease|billing|documents|activity`, but they are not URL-backed.
- People records use separate tenant, owner, and vendor routes with the shared
  People record layout and anchor sections.

## Route-State Recommendation

- Preserve existing inbound links:
  `/properties?entity_id=...&property_id=...`.
- If R5 makes property record tabs shareable, use:
  `property_tab=overview|lease|billing|documents|activity`.
- Do not add `/properties/[id]` in the first implementation slice unless Temba
  explicitly approves a dedicated record route.
- Keep portfolio modes under `view=cards|board|table|map`.
- Keep selected-record state distinct from portfolio mode state.

## Record Grammar

The shared record-page grammar should cover Property, Tenant, Owner, and Vendor
records without pretending every record exposes identical data.

- Header: back link, record title, entity/status chips, and primary safe action.
- Metadata: address/contact, current relationship, financial/compliance state.
- Tabs: Overview, Lease or Agreements, Billing, Documents, Activity/Audit.
- Evidence: source document, confidence, before/after fields, and audit trail.
- Dense proof: drawers or expandable rows, not cramped mini-links.
- Mobile: visible 44px controls and no content hidden behind bottom navigation.

## Guardrails

- No Xero, SendGrid, Twilio, tenant email, payment, reconciliation, or provider
  write action should be added by R5 record-page cleanup.
- Source-trail and review actions stay inspection-first until an explicit apply
  flow is designed and approved.
- Existing `/properties?entity_id=...&property_id=...` links must keep working.
- Authenticated mobile evidence is still blocked by operator login/MFA; mobile
  implementation cannot be marked done from draft Figma alone.

## Update Targets

- Figma:
  - Review and approve the R5 record grammar and property record draft frames.
  - Update route index frame `186:988` after approval.
- Repo implementation after approval:
  - `apps/web/src/app/properties/page.tsx`
  - `apps/web/src/components/property-workspace.tsx`
  - `apps/web/src/components/people-record-layout.tsx`
  - `apps/web/src/components/app-shell.tsx` if command/deep-link context changes
  - `apps/web/scripts/live-ux-audit.mjs`
  - `apps/web/tests/smoke/properties-ux.spec.ts`
  - `apps/web/tests/smoke/appearance.spec.ts`
- Repo docs:
  - `docs/ux-route-frame-index-2026-06-28.md`
  - `docs/ux-navigation-deeplink-contract-2026-06-28.md`
  - `docs/ux-platform-audit-roadmap-2026-06-28.md`
  - `docs/design-governance.md`
  - `docs/product-roadmap.md`
  - `docs/next-chat-handover.md`
