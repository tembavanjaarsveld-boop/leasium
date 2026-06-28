# Settings And Message Templates Refresh Brief - 2026-06-28

This is the R4 brief from the full-platform UX cleanup. It follows
`docs/ux-platform-audit-roadmap-2026-06-28.md`,
`docs/ux-route-frame-index-2026-06-28.md`, and
`docs/ux-navigation-deeplink-contract-2026-06-28.md`.

Status: Figma source is stale. Do not restructure Settings or Message Templates
from code-only inference.

## Current State

- `/settings` defaults to Organisation.
- `/settings?tab=security|notifications|activity|connect` is supported.
- `/settings?tab=xero` opens the integrations/Xero area as a legacy alias.
- `/money/xero` and `/money/basiq` redirect into Settings.
- Organisation subtabs are client-only:
  `overview|payments|comms|entities`.
- Message Templates subtabs are client-only:
  `messages|branding|receipts|advanced`.
- Selected entity can be seeded with `entity_id`, then persists in local storage.

## Source Status

- Existing Figma frames:
  - Settings desktop `55:439`.
  - Settings mobile `59:677`.
- Repo route index marks `/settings` and top-level Settings tabs as stale
  source.
- Organisation subtabs and Message Templates need committed desktop/mobile Figma
  frames.
- The shipped two-pane Settings workspace and Message Templates redesign are
  ahead of the current Figma source.

## Mobile Risks

- Authenticated mobile platform evidence is still blocked by expired login.
- Existing mocked 390px checks are useful but not enough for R4 closure.
- Message Template inner tab buttons currently use a smaller target than the
  44px Relby standard.
- The authenticated desktop audit sampled small-target debt on Settings
  Organisation Comms.

## URL-State Recommendation

- Keep `tab` for top-level Settings only.
- Add a secondary param for nested state during R4, for example:
  `/settings?tab=organisation&section=comms&template=advanced`.
- Preserve `/settings` as the clean Organisation Overview default.
- Preserve `?tab=xero` as a legacy alias to Integrations until a deliberate
  migration is designed.
- Add any new R4 Settings states to the live audit platform preset when code
  changes land.

## Guardrails

Settings template preview, edit, and export must not:

- send SendGrid or Twilio messages;
- dispatch or dismiss comms;
- run digests;
- send invoices, onboarding messages, or contractor updates;
- mutate provider history;
- touch Xero, Basiq, payments, or reconciliation.

## Update Targets

- Figma:
  - Refresh Settings `55:439`.
  - Refresh Settings Mobile `59:677`.
  - Add committed Message Templates desktop and mobile frames.
  - Update route index frame `186:988`.
- Repo implementation after approval:
  - `apps/web/src/app/settings/page.tsx`
  - `apps/web/tests/smoke/settings.spec.ts`
  - `apps/web/scripts/live-ux-audit.mjs`
- Repo docs:
  - `docs/ux-route-frame-index-2026-06-28.md`
  - `docs/ux-platform-audit-roadmap-2026-06-28.md`
  - `docs/design-governance.md`
  - `docs/product-roadmap.md`
  - `docs/next-chat-handover.md`
