# Horizon Implementation Brief (for Codex / coding agents)

Last updated: 2026-06-11. Owner: Temba. Status: Horizon Money v1 is
Remba-pending; this brief covers the remaining Horizon
implementation.

## The one rule

**The Figma file is the design source of truth.** File key `PO2jOANgmqgZHfqWZXOZGU`
("Leasium — Design Source of Truth"). Before writing any UI code, pull the target
frame via the Figma MCP (`get_design_context` + `get_screenshot` with the node IDs
below). Do not infer style from existing code — existing code is the *old* design.
See `CLAUDE.md` §2.12 and `docs/design-governance.md` §Figma-First Design Stage.

## Target frames (03 Screens)

| Surface | Node ID | Notes |
|---|---|---|
| Dashboard | 45:2 | v2 hero/bento polish shipped; Remba review remains |
| Work | 45:168 | triage lanes, severity rails, right rail |
| Properties | 55:2 | card grid, stat strip, view switcher |
| Smart Intake | 55:166 | hero dropzone, queue rails, provenance |
| Notifications | 55:307 | channel health, needs-you/receipts split |
| Settings | 55:439 | tab cards, per-operator notification cards |
| Document review | 58:352 | source preview + field approval flow |
| Property detail | 58:627 | header/tabs/bento/lease/activity |
| People | 61:580 | tenant/vendor cards; v1 shipped pending Remba review |
| Money | 61:842 | billing readiness + approve-run; v1 shipped pending Remba review |
| Insights | 61:1063 | value flow, compliance, what-changed |
| Mobile set | Dashboard 45:371; Work 45:461; Properties 59:427; Smart Intake 59:521; Notifications 59:594; Settings 59:677; Tenant portal 61:1251 | 390×844, bottom nav + FAB |
| Dashboard · Dark | 62:696 | dark-mode reference |

Components (02 Components): Horizon Sidebar 44:117, Command bar 44:155, Hero focus
card 44:179, Bento metric card 44:193, Work card 44:238, Trust ribbon 44:274,
Segmented control 44:282, Bottom nav 44:301, Button set 50:156, Skeleton 50:157,
Empty state 50:163, Input 56:156, Select 56:157, Modal 56:163, Drawer 56:173,
Toast 56:209. Component→code mapping table: `docs/design-governance.md`.

Tokens: Figma variable collection **Leasium Color** (27 tokens, Light/Dark modes,
readable via `get_variable_defs`). CSS variables in `globals.css` are the code
counterpart; Dashboard v1 added the Horizon canvas/card-border/hero-wash set —
extend the same pattern, never hardcode hex in components.

## Slice order (one verified slice per commit)

1. **Work desktop** (45:168) — triage lanes, severity rails, team-workload rail.
   Largest user value after Dashboard; no shell changes needed.
2. **Horizon app shell** (sidebar 44:117: entity switcher top, user card bottom,
   teal active rail) — separate slice, wide blast radius; verify every route +
   mobile drawer/bottom nav after.
3. **Properties** (55:2) then **Property detail** (58:627).
4. **Smart Intake** (55:166) then **Document review** (58:352) — the review-first
   centrepiece; reuse Input/Modal primitives.
5. **Notifications** (55:307) + **Settings** (55:439).
6. **Mobile polish pass v1** against the 03 Screens mobile frames — shipped
   pending Remba review for Work tabs/range targets, Notifications compact
   channel chips, Settings compact tabs/touch targets, and Document review
   source/action/bottom-nav safety.
7. **Dark mode token alignment v1** — shipped pending Remba review. The dark
   Leasium Color values from Dashboard · Dark `62:696` are wired through the
   existing `data-theme="dark"` CSS layer; next dark work should be visual
   polish only if Remba finds frame-match gaps.
8. **Dashboard hero/bento polish v2** — shipped pending Remba review. The
   Dashboard `45:2` first screen now uses the approved hero, four live bento
   cards, lower Lease horizon / Onboarding / Smart Intake row, and centered
   trust ribbon.
9. **People v1** (`61:580`) — shipped pending Remba review. The `/people`
   first screen now uses the approved header, count pills, tenant/vendor cards,
   roadmap prospect tile, and touch-safe add handoffs while keeping
   operating-mode owner gating intact.
10. **Money v1** (`61:842`) — shipped pending Remba review. The `/money`
    first screen now uses the approved billing cockpit, metric cards,
    invoice-run approval panel, trust ribbon, and review-route handoffs.
11. **Insights v1** (`61:1063`) — next remaining production Horizon desktop
    slice.

## Non-negotiable guardrails (from CLAUDE.md)

- Review-first: no Xero write, SendGrid email, Twilio SMS, tenant email, or payment
  reconciliation without explicit operator approval. UI changes must not alter any
  mutation path. Tests mock providers.
- Surgical slices: touch only what the slice needs; app shell is its own slice.
- Per slice verification: targeted eslint + `tsc --noEmit` + relevant Playwright
  smokes (`NODE_ENV=development`; full `npm run lint` currently false-fails on
  generated playwright-report assets — exclude or ignore) + production build +
  browser check at 1280×900 and 390×844, light and dark.
- Smokes assert accessible headings/copy — update fixtures/specs with each slice.
- Commit style: terse imperative subject, body lists files + why, no attribution
  lines. Commit with the gmail author identity so Vercel deploys aren't blocked.
- Update `docs/product-roadmap.md`, `docs/design-governance.md` (design-facing log)
  and `docs/next-chat-handover.md` with each slice.

## Definition of done per slice

Figma frame and shipped page match at a glance (same hierarchy, spacing rhythm,
chips/rails, one primary CTA); all checks green; docs updated; pushed to main and
Vercel deployment READY.
