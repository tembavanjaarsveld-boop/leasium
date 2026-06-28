# Settings And Message Templates Refresh Brief - 2026-06-28

This is the R4 brief from the full-platform UX cleanup. It follows
`docs/ux-platform-audit-roadmap-2026-06-28.md`,
`docs/ux-route-frame-index-2026-06-28.md`, and
`docs/ux-navigation-deeplink-contract-2026-06-28.md`.

Status: the 2026-06-28 button-heavy Figma refresh was rejected by Temba. Do
not restructure Settings or Message Templates from the archived draft nodes.
Continue from the current two-pane Settings workspace and preserve the calmer
platform visual language.

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
  - `03 Current Platform / Settings - current platform refresh 2026-06-28`
    (`203:938`).
  - `03 Current Platform / Settings - current platform baseline` (`55:439`).
  - `03 Current Platform / Settings · Mobile` (`59:677`).
- Archived/rejected notes only:
  - `99 Archive - Rejected Drafts and Loose Concepts / REJECTED - do not
    implement - Settings Message Templates Refresh - Draft 2026-06-28`
    (`188:1109`).
  - `99 Archive - Rejected Drafts and Loose Concepts / REJECTED - do not
    implement - Settings Message Templates Mobile - Draft 2026-06-28`
    (`188:1173`).
- Organisation subtabs and Message Templates can still get nested URL state and
  touch-target cleanup, but the visual treatment must come from the current
  Settings baseline rather than rows of equal-weight buttons.
- The shipped two-pane Settings workspace is now the active source.

## Mobile Risks

- Authenticated mobile platform evidence is still blocked by expired login.
- Existing mocked 390px checks are useful but not enough for R4 closure.
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
- Preserve the current Settings hierarchy: account/entity selector, settings
  category pane, selected workspace content, and quiet section cards. Avoid
  adding button rows for every nested section.

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
  - Keep rejected frames `188:1109` and `188:1173` archived.
  - Continue from `Settings - current platform refresh 2026-06-28` (`203:938`)
    for desktop and `Settings · Mobile` (`59:677`) for mobile.
  - Keep route index frame `186:988` on the `04 Governance` page aligned with
    the current-platform baseline.
- Repo implementation:
  - `apps/web/src/app/settings/page.tsx`
  - `apps/web/tests/smoke/settings.spec.ts`
  - `apps/web/scripts/live-ux-audit.mjs`
- Repo docs:
  - `docs/ux-route-frame-index-2026-06-28.md`
  - `docs/ux-platform-audit-roadmap-2026-06-28.md`
  - `docs/design-governance.md`
  - `docs/product-roadmap.md`
  - `docs/next-chat-handover.md`
