# Portfolio QA Redesign Brief - 2026-06-28

This is the R3 brief from the full-platform UX cleanup. It follows
`docs/ux-platform-audit-roadmap-2026-06-28.md`,
`docs/ux-route-frame-index-2026-06-28.md`, and
`docs/ux-navigation-deeplink-contract-2026-06-28.md`.

Status: draft Figma source exists. Do not redesign `/portfolio-qa` in code
until Temba approves the desktop and mobile draft frames.

Draft Figma source:

- Desktop: `03 Screens / Portfolio QA Trust Workbench - Draft 2026-06-28`
  (`188:988`).
- Mobile: `03 Screens / Portfolio QA Trust Workbench Mobile - Draft 2026-06-28`
  (`188:1071`).

## Current State

- Route: `/portfolio-qa`.
- IA: hidden operator route, reachable through command search and `G Q`; not a
  primary nav item.
- Current page-level state is client-only, not URL-backed.
- Current lanes: Data QA, Tenant contacts, Source history, Onboarding prep, and
  Billing drafts.
- The first screen shows metric cards plus cleanup readiness, guided fix queue,
  and blocker triage before active tab detail.
- Main implementation: `apps/web/src/app/portfolio-qa/page.tsx`.

## Main UX Debt

- The page still reads like a dense cleanup console rather than a guided trust
  workbench.
- The first viewport has useful counts, but no dominant next safest action.
- Tabs are not URL-backed, so screenshots and state are not reliably auditable.
- Evidence and row detail run long; dense proof should move into drawers or
  expandable rows.
- The desktop audit found recurring sub-44px controls in Portfolio QA.
- Copy such as `Send selected invites` can imply tenant email even when the
  current action creates local invite links only.

## Design Direction

The first viewport should answer, in this order:

1. What blocks launch?
2. What can be cleared now?
3. What evidence supports the next action?

Recommended structure:

- One readiness verdict.
- One primary next safe action.
- Lane status for the five current lanes.
- A compact evidence/confidence rail.
- CSV/copy/export and enrichment queue detail below the first viewport.

## IA Contract

- Keep `/portfolio-qa` command/search only under Portfolio cleanup.
- Do not promote Portfolio QA to primary navigation.
- Make tabs URL-backed as part of R3:
  `?tab=issues|contacts|sources|onboarding|billing-drafts`.
- Keep the five lanes, but clarify the mental model:
  - Action lanes: Data QA, Contacts, Onboarding Prep, Billing Drafts.
  - Evidence lane: Source History.
- Keep enrichment review inside Data QA unless it becomes its own workflow.

## Guardrails

- No Xero, SendGrid, Twilio, tenant email, payment, reconciliation, or provider
  write runs from Portfolio QA cleanup.
- Bulk fixes stay allowlisted, staged, explicit, and audited.
- Public enrichment remains preview -> citation -> review -> apply; never
  auto-apply.
- Onboarding creates local invite links only unless a future explicit send
  approval is designed and implemented.
- Billing drafts remain internal drafts with an explicit Draft trust selector.
- Copy/download actions stay local and review-only.

## Update Targets

- Figma: review and approve the draft Portfolio QA desktop/mobile frames, then
  mark the approved nodes in the route/frame index.
- Repo implementation after approval:
  - `apps/web/src/app/portfolio-qa/page.tsx`
  - `apps/web/tests/smoke/portfolio-qa-guided.spec.ts`
  - `apps/web/tests/smoke/portfolio-qa-ux.spec.ts`
  - `apps/web/tests/smoke/api-mocks.ts`
- Repo docs:
  - `docs/ux-route-frame-index-2026-06-28.md`
  - `docs/ux-navigation-deeplink-contract-2026-06-28.md`
  - `docs/ux-platform-audit-roadmap-2026-06-28.md`
  - `docs/design-governance.md`
  - `docs/product-roadmap.md`
  - `docs/next-chat-handover.md`
