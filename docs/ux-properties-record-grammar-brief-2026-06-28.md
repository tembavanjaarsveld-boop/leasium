# Properties And Record Page Grammar Brief - 2026-06-28

This is the R5 brief from the full-platform UX cleanup. It follows
`docs/ux-platform-audit-roadmap-2026-06-28.md`,
`docs/ux-route-frame-index-2026-06-28.md`, and
`docs/ux-navigation-deeplink-contract-2026-06-28.md`.

Status: the 2026-06-28 draft Figma direction was rejected by Temba because it
was visually worse than the current platform and too button-heavy. Do not use
the archived draft nodes as implementation source. Continue from the current
platform record baseline and make only surgical route/state/mobile
improvements.

## Current Figma Source

- Active page: `03 Current Platform`.
- Property record current-platform refresh:
  `03 Current Platform / Property record - current platform refresh 2026-06-28`
  (`203:1114`).
- Property record baseline:
  `03 Current Platform / Property detail - current platform baseline`
  (`58:627`).
- Portfolio workspace baseline: `03 Current Platform / Properties` (`55:2`).
- Mobile portfolio baseline:
  `03 Current Platform / Properties · Mobile` (`59:427`).

Archived/rejected notes only:

- `99 Archive - Rejected Drafts and Loose Concepts / REJECTED - do not
  implement - Record Page Grammar - Draft 2026-06-28` (`190:988`).
- `99 Archive - Rejected Drafts and Loose Concepts / REJECTED - do not
  implement - Property Record Desktop - Draft 2026-06-28` (`190:989`).
- `99 Archive - Rejected Drafts and Loose Concepts / REJECTED - do not
  implement - Property Record Mobile - Draft 2026-06-28` (`190:990`).

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

- Preserve the current header rhythm: back link, property thumbnail, record
  title, metadata, small entity/status chips, and at most one primary command.
- Metadata: address/contact, current relationship, financial/compliance state.
- Tabs: keep the compact current tab treatment for Overview, Lease or
  Agreements, Billing, Documents, Activity/Audit.
- Evidence: source document, confidence, before/after fields, and audit trail.
- Dense proof: drawers or expandable rows, not cramped mini-links.
- Mobile: visible 44px controls and no content hidden behind bottom navigation.
- Do not flatten the page into button rows, approval banners, or internal route
  labels.

## Guardrails

- No Xero, SendGrid, Twilio, tenant email, payment, reconciliation, or provider
  write action should be added by R5 record-page cleanup.
- Source-trail and review actions stay inspection-first until an explicit apply
  flow is designed and approved.
- Existing `/properties?entity_id=...&property_id=...` links must keep working.
- Authenticated mobile evidence is still blocked by operator login/MFA; mobile
  implementation cannot be marked done from Figma cleanup alone.

## Update Targets

- Figma:
  - Keep the archived R5 draft nodes as rejected notes only.
  - Continue from current-platform refresh `203:1114` and change the smallest
    possible visual surface.
  - Keep route index frame `186:988` on the `04 Governance` page aligned with
    the current-platform baseline.
- Repo implementation:
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
