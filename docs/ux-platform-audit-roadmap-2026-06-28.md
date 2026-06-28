# Relby Full-Platform UX Audit Roadmap - 2026-06-28

## Purpose

This is the cleanup roadmap before design or code changes start. It converts the
live production scan, Figma source-of-truth check, and world-class UX benchmark
standards into an ordered plan.

The governing rule is unchanged: design-facing changes start in Figma, get
Temba sign-off there, and only then move into Relby code. Provider mutation
guardrails stay review-first throughout; UX polish must not make Xero,
SendGrid, Twilio, tenant email, payments, or reconciliation easier to trigger
without explicit operator approval.

## Evidence Pack

- Production app reviewed: `https://www.relby.ai`, signed in as the SKJ Property
  operator account in Chrome.
- Desktop first-viewport screenshots: `output/ux/live-platform-audit-2026-06-28/desktop/`.
- Desktop full-page screenshots: `output/ux/live-platform-audit-2026-06-28/desktop-fullpage/`.
- Desktop audit JSON: `output/ux/live-platform-audit-2026-06-28/desktop-audit.json`.
- Desktop full-page audit JSON:
  `output/ux/live-platform-audit-2026-06-28/desktop-fullpage-audit.json`.
- Contact sheet:
  `output/ux/live-platform-audit-2026-06-28/desktop-contact-sheet.png`.
- Existing repeatable Playwright harness:
  `apps/web/scripts/live-ux-audit.mjs`.
- R0 route/frame index:
  `docs/ux-route-frame-index-2026-06-28.md`.
- Figma route/frame index:
  `04 Governance / Route Frame Index - 2026-06-28` (`186:988`).
- R1 navigation/deep-link contract:
  `docs/ux-navigation-deeplink-contract-2026-06-28.md`.
- Figma navigation/deep-link contract:
  `04 Governance / Navigation Deep-Link Contract - 2026-06-28` (`187:997`).
- R3 Portfolio QA brief:
  `docs/ux-portfolio-qa-redesign-brief-2026-06-28.md`.
- R3 rejected Figma draft notes:
  `99 Archive - Rejected Drafts and Loose Concepts / REJECTED - do not
  implement - Portfolio QA Trust Workbench - Draft 2026-06-28` (`188:988`)
  and the matching mobile frame (`188:1071`).
- R4 Settings and Message Templates brief:
  `docs/ux-settings-message-templates-refresh-brief-2026-06-28.md`.
- R4 active Figma source:
  `03 Current Platform / Settings - current platform refresh 2026-06-28`
  (`203:938`), `03 Current Platform / Settings - current platform baseline`
  (`55:439`), and `03 Current Platform / Settings · Mobile` (`59:677`).
  Rejected draft notes are archived at `188:1109` and `188:1173`.
- R5 Properties and record grammar brief:
  `docs/ux-properties-record-grammar-brief-2026-06-28.md`.
- R5 active Figma source:
  `03 Current Platform / Property record - current platform refresh 2026-06-28`
  (`203:1114`), `03 Current Platform / Property detail - current platform
  baseline` (`58:627`), `03 Current Platform / Properties` (`55:2`), and
  `03 Current Platform / Properties · Mobile` (`59:427`). Rejected draft notes
  are archived at `190:988`, `190:989`, and `190:990`.

Important limitation: the authenticated desktop pass is current. The saved
Playwright storage state was checked again on 2026-06-28 and is expired for
both desktop and mobile, so current screenshots from
`output/playwright/live-audit/` and `output/playwright/live-audit-r0-auth-check/`
are signed-out gates and must not be used as authenticated evidence. The first
cleanup lane refreshes that session and reruns desktop plus mobile before any
UX slice is marked done.

## R0 Progress - 2026-06-28

- Added `platform` route coverage to `apps/web/scripts/live-ux-audit.mjs` so
  the repeatable harness can cover primary routes, hidden operator routes, tab
  states, and redirect aliases.
- Added `LEASIUM_AUDIT_OUTPUT_DIR` so timestamped or lane-specific evidence
  folders can be created without moving the saved login state.
- Changed the default audit URL to the canonical Relby domain
  `https://relby.ai`.
- Added `npm run audit:live:test` for the provider-inert harness unit check.
- Added Figma route/frame index `04 Governance / Route Frame Index - 2026-06-28`
  (`186:988`).
- 2026-06-28 cleanup: Temba rejected the button-heavy R3/R4/R5 draft direction.
  The draft nodes were moved to
  `99 Archive - Rejected Drafts and Loose Concepts` and renamed
  `REJECTED - do not implement - ...`. Fresh current-platform frames were added:
  Settings refresh `203:938` and Property record refresh `203:1114`.
- Added repo route/frame contract at
  `docs/ux-route-frame-index-2026-06-28.md`.

### R0 Commands

Refresh the signed-in session:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
LEASIUM_AUDIT_URL=https://www.relby.ai npm run audit:live -- --login
```

Run the platform audit:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
LEASIUM_AUDIT_URL=https://www.relby.ai \
LEASIUM_AUDIT_ROUTE_PRESET=platform \
LEASIUM_AUDIT_OUTPUT_DIR=../../output/playwright/live-audit-r0-platform \
npm run audit:live
```

Run the harness unit check:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
npm run audit:live:test
```

## Benchmark Principles Used

Relby should feel calm to a first-time property operator and fast for the
operator who lives in it every day. The benchmark is not visual novelty; it is
obvious navigation, reliable state, low cognitive load, and expert speed once
the basics are learned.

- Apple HIG accessibility guidance and long-standing iOS convention set a
  practical 44px/44pt baseline for tap targets:
  https://developer.apple.com/design/human-interface-guidelines/accessibility
- Material accessibility guidance pushes touch targets toward a 48dp baseline:
  https://m2.material.io/design/usability/accessibility.html
- WCAG 2.2 Target Size Minimum is the legal/accessibility floor, not Relby's
  ambition ceiling:
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG 2.2 Focus Appearance reinforces visible keyboard focus as a core
  interaction requirement:
  https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- Linear's command/shortcut model is a useful benchmark for expert SaaS speed
  after navigation is understandable:
  https://linear.app/docs/keyboard-shortcuts
- Mobile navigation patterns should favor visible, predictable primary routes
  and avoid hiding core tasks inside mystery menus:
  https://www.nngroup.com/articles/mobile-navigation-patterns/

## What Is Working

- The Horizon shell is materially stronger than the older prototype UI: the
  sidebar, header utility cluster, app canvas, card rhythm, and typography are
  calm and coherent across the main modules.
- The desktop authenticated scan found no horizontal overflow across the 51
  requested route/tab states.
- Every captured desktop state has a page heading.
- Operations and Billing Readiness already model the right pattern for
  URL-backed tabs, with direct links like `?tab=compliance` and
  `?tab=delivery`.
- Smart Intake and Relby AI are correctly review-first in tone: they explain
  that AI can read and suggest before anything changes.
- Settings' shipped two-pane workspace is a big improvement for a complex
  admin surface, even though Figma now needs to catch up.

## Findings

### P0 - Source Of Truth Drift

Figma is the required design source for core surfaces, but the metadata check is
not clean. The documented screen node IDs still resolve, including Dashboard,
Smart Intake, People, and Workflows frames. However, the Figma top-level
metadata listing exposed only `01 Foundations` and `02 Components`, while
`docs/design-governance.md` depends on `03 Screens` as the canonical screen
page.

This is a discoverability and governance risk. If future agents cannot reliably
find the approved frames, they will infer from code and drift the product again.

2026-06-28 update: direct Figma Plugin API inspection can see the active pages,
and the Figma file now has `04 Governance / Route Frame Index - 2026-06-28`
(`186:988`).
The remaining risk is connector/metadata discoverability and keeping the repo
route index in sync with the Figma index.

### P0 - Authenticated Mobile Evidence Gap

The current live desktop pass is signed in and usable. The repeatable
desktop/mobile Playwright harness exists, but the saved mobile auth state is
expired. Mobile cleanup must not proceed from signed-out screenshots or code
inspection alone.

### P0 - Live Insights Error State

The production Insights page rendered `Insights could not load Field required`
in the authenticated desktop pass. That is more than visual polish: a portfolio
risk page cannot show a schema/error message in the main experience. It should
be triaged before or alongside any Insights visual cleanup.

2026-06-28 update: fixed in
`apps/web/src/app/insights/page.tsx`. All-entities mode now sends an explicit
entity id for the entity-scoped overview, and the overview error state shows
plain recovery guidance instead of raw API details. Verified with
`apps/web/tests/smoke/insights.spec.ts`, eslint, and screenshots:
`output/playwright/insights-overview-error-1440.png` and
`output/playwright/insights-overview-error-390.png`.

### P1 - Route And Tab State Contract Is Inconsistent

Strong pattern:
- Work: `?tab=queue|approvals|workflows|calendar|maintenance|compliance|arrears`.
- Billing Readiness: `?tab=readiness|billing-drafts|delivery`.

Weak pattern:
- Portfolio QA tabs are client-state only.
- Settings organisation subtabs and Message templates subtabs are client-state
  only.
- Properties workspace modes are mixed with `?view=` and `property_id` state in
  a way that reads like a portfolio table, not a clean property record.
- `/tasks` redirects to `/operations`; this is probably correct, but it should
  be named as a legacy alias in the IA contract.
- `/people?tab=owners` redirects/falls back to Tenants for the current
  self-managed account mode. The gating decision is right, but the user
  experience should make the reason intentional instead of feeling like a
  broken deep link.

### P1 - Touch Target Debt Remains In People And Portfolio QA

The scan found no desktop overflow, but touch target sampling flagged repeated
sub-44px controls:

- People Tenants/Owners: 14 sampled targets below the Relby 44px standard,
  mostly compact open-card icons and entity label controls.
- Portfolio QA: 13 sampled targets across the Data QA and related tabs, mostly
  compact links and disclosure controls deep in the report.

This is especially important because both surfaces are likely to be used under
attention pressure: People for contact/billing lookup, Portfolio QA for cleanup
and data trust.

### P1 - Portfolio QA Still Feels Like A Cleanup Console

Portfolio QA is valuable, but it has not received the same Horizon design
treatment as Dashboard, Work, Properties, Smart Intake, People, Money, Insights,
and Settings. It shows useful data, but the mental model is still "many checks
and rows" rather than "what can I safely clear next?"

This should be the flagship redesign candidate, because it is directly tied to
trust in imported data and first-run onboarding confidence.

### P1 - Properties Needs A Cleaner Record Model

The current audited "property detail" path is really the Properties workspace
with portfolio modes: Portfolio, Leases & units, Billing, Documents. That is
not the same as the People/Properties north-star record shape: header, tabs,
consistent actions, activity/audit trail, and stable deep links per record.

The current workspace is usable, but the route/state model should be clarified
before adding more property-specific work.

### P2 - Production Prototype Cues

The authenticated Dashboard still includes `View demo portfolio`. That may be
useful for internal testing, but it reads like a product demo cue inside a live
operator account. Decide whether it belongs behind an admin/dev affordance.

### P2 - Loading/Error Copy Needs A Shared Pass

The Comms Queue automated scan flagged one loading-copy match, while the
screenshot looked visually settled. This needs a targeted check, not an
immediate redesign. More broadly, loading/empty/error copy should be audited as
a system so operators see plain recovery guidance, never implementation detail.

## Roadmap

### R0 - Lock Evidence And Source Of Truth

Goal: make the cleanup process repeatable before changing UI.

- Refresh the Playwright audit login session for `https://www.relby.ai`.
- Extend or parameterize `apps/web/scripts/live-ux-audit.mjs` so the same route
  inventory covers all primary pages, hidden operator routes, and tab states.
- Rerun desktop 1440-ish and mobile 390 authenticated screenshots.
- Add a Figma audit/index frame or table inside the canonical file that maps
  each production route to its approved frame, node ID, status, and owner.
- Fix the `03 Screens` discoverability drift so future Figma metadata reads
  match `docs/design-governance.md`.

Done means: signed-in desktop and mobile evidence exists, the Figma frame map is
findable, and every cleanup ticket can name its source frame before code.

Current R0 state:

- Done: route preset, output directory parameter, canonical Relby URL default,
  harness unit command, repo route/frame index, and Figma route/frame index.
- Blocked/back of queue: refreshed signed-in desktop/mobile evidence, because
  the saved Playwright storage state is expired and operator login/MFA is needed.
- Still to verify after login refresh: run the `platform` preset and confirm
  the output has authenticated desktop and mobile screenshots for the route
  inventory.

### R1 - Define The Navigation And Deep-Link Contract In Figma

Goal: every route and tab should feel intentional, shareable, and recoverable.

- Create a route inventory covering primary nav, command-only routes, legacy
  redirects, gated routes, and record routes.
- Standardize URL-backed tabs:
  - top-level module tabs use `?tab=...`;
  - nested module sections use an agreed secondary param only when deep linking
    is genuinely useful;
  - gated tabs show a designed explanation or redirect contract.
- Design states for `/people?tab=owners` in self-managed mode: either hide from
  normal nav and redirect with intentional copy, or land on a clear "Owners are
  for managing-agent accounts" state.
- Document `/tasks -> /operations` as a legacy redirect or remove it from
  command/search surfaces.

Done means: Figma and docs define the route contract before code changes.

2026-06-28 update: the repo contract now exists at
`docs/ux-navigation-deeplink-contract-2026-06-28.md`, with Figma mirror
`04 Governance / Navigation Deep-Link Contract - 2026-06-28` (`187:997`). It
locks the current hub, alias, URL-state, command-search, and mobile-nav
contract. Remaining R1 choices are queued as design decisions: self-managed
Owners gating, Portfolio QA URL-backed tabs, Settings nested URL state,
property record tab grammar, `/contractors` legacy status, and `/tasks` alias
wording.

### R2 - Authenticated Mobile System Pass

Goal: mobile should be thumb-readable in five seconds and tap-accurate on the
first try.

- Capture authenticated mobile screenshots for all primary surfaces and the
  highest-risk hidden routes: AI Inbox, Comms Queue, Billing Readiness,
  Portfolio QA, Settings, Notifications, and record pages.
- Check bottom nav, More drawer, sticky actions, safe-area clearance, keyboard
  behavior, and full-page scroll.
- Lift People and Portfolio QA targets to the 44px Relby minimum, unless the
  redesign in R3 replaces the affected controls.
- Add smoke coverage for any fixed mobile target or overflow issue.

Done means: no mobile horizontal overflow, no blocked content behind fixed nav,
and no recurring action/control under 44px on touched surfaces.

### R3 - Redesign Portfolio QA In Figma First

Goal: turn Portfolio QA from a cleanup console into a guided trust workbench.

Brief: `docs/ux-portfolio-qa-redesign-brief-2026-06-28.md`.

Design direction:
- First viewport answers: "What is blocking launch?", "What can be cleared
  now?", and "What evidence supports this?"
- Use clear lanes: Data QA, Contacts, Source History, Onboarding Prep, Billing
  Drafts.
- Add a persistent review summary that shows ready/review/blocked counts and
  the next safest action.
- Move dense row evidence into a detail drawer or expandable row pattern with
  44px controls.
- Make tabs URL-backed once the Figma direction is approved.
- Keep exports and copy actions local/review-only.

Done means: approved Figma frame exists for desktop and mobile, then code
implements that design with smoke coverage and a UX pass log entry.

2026-06-28 update: the draft Figma frames (`188:988`, `188:1071`) were rejected
and archived. R3 remains open, but the next design pass must start from the
current Relby shell and avoid the rejected button-field dashboard treatment.

### R4 - Refresh Settings And Message Templates In Figma

Goal: make Settings a governed workspace, not a patchwork of shipped panels.

Brief: `docs/ux-settings-message-templates-refresh-brief-2026-06-28.md`.

- Update canonical Settings frame `55:439` to match the shipped two-pane
  workspace.
- Add the Organisation -> Comms -> Message templates subsection as a committed
  Figma frame.
- Decide which nested sections deserve URL state and which should stay local.
- Verify category pane, workspace tabs, entity selector, and template controls
  on mobile.

Done means: future Settings slices pull from Figma instead of reverse
engineering the shipped code.

2026-06-28 update: the button-heavy draft refresh frames (`188:1109`,
`188:1173`) were rejected and archived. A fresh current-platform Settings frame
now exists at `203:938`; future R4 work should start there and preserve the
two-pane workspace.

### R5 - Clarify Properties And Record Pages

Goal: make Properties and People share one record-page grammar.

Brief: `docs/ux-properties-record-grammar-brief-2026-06-28.md`.

- In Figma, define the property record shape: header, core metadata, tabs,
  primary action lane, documents/evidence, and activity/audit.
- Decide whether the current Properties workspace modes stay as portfolio modes
  or become record tabs.
- Ensure Tenant, Owner, Vendor, and Property records use consistent tab/action
  placement without adding top-level sidebar items.
- Add deep links for property-specific sections only after the design is signed
  off.

Done means: the user can tell the difference between "portfolio list/workspace"
and "this property record" immediately.

2026-06-28 update: the record grammar/property draft frames (`190:988`,
`190:989`, `190:990`) were rejected and archived. A fresh current-platform
property record frame now exists at `203:1114`; future R5 work should preserve
the current record rhythm and add route/mobile improvements underneath it.

### R6 - System Polish For Best-In-Class Feel

Goal: make the product feel obvious for new users and fast for expert users.

- Command/search: ensure common jobs resolve to one clear destination, with
  aliases for real operator language.
- Keyboard: preserve visible focus, predictable shortcut help, and command menu
  discoverability.
- Empty states: every empty state should say what it means and what the safest
  next step is.
- Loading states: never expose backend or schema language.
- Error states: user-facing pages show recovery, not implementation detail.
- Density: keep operational screens compact, but never at the cost of scan
  order, target size, or source/evidence clarity.

Done means: the app passes a first-time operator walkthrough and an expert
keyboard/command walkthrough without new design debt.

## Success Criteria For Cleanup

- Every design-facing slice names the Figma frame first.
- Desktop and mobile screenshots are reviewed before marking the slice done.
- No core route has horizontal overflow.
- Repeated touch targets meet the 44px Relby minimum.
- Page, tab, and record URLs are shareable or intentionally local.
- Gated routes explain why the requested surface is unavailable.
- Provider mutations remain explicitly reviewed and approved.
- UX pass log entries land in `docs/design-governance.md` for each shipped
  slice.

## Immediate Next Build Order

1. R0: refresh mobile auth evidence and Figma route/frame index.
2. R1: Figma-first navigation/deep-link contract.
3. R3: create a fresh current-platform Portfolio QA Figma pass, because the
   archived draft direction was rejected.
4. R4: continue from Settings current-platform refresh `203:938`, preserving
   the shipped two-pane workspace.
5. R5: continue from Property record current-platform refresh `203:1114`,
   preserving the current record rhythm.
6. R2 targeted fixes can happen opportunistically when backed by authenticated
   mobile screenshots and a narrow Figma/design-system decision.
