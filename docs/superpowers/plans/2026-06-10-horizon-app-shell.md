# Horizon App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Horizon app shell from Figma 02 Components nodes `44:117` and `44:301` without changing provider mutation paths.

**Architecture:** Keep navigation ownership in `apps/web/src/components/app-shell.tsx`, because the current app already centralizes primary nav, command search, mobile drawer, bottom nav, active route logic, and utility controls there. Move the per-page `AppHeader` children into the sidebar entity switcher slot, keep search/notifications/appearance in the top utility bar, and preserve route/prefetch behavior.

**Tech Stack:** Next.js App Router, React client components, Tailwind classes backed by existing Leasium CSS variables, Playwright smoke tests.

---

### Task 1: Lock The Expected Shell Behavior

**Files:**
- Modify: `apps/web/tests/smoke/mobile-bottom-nav.spec.ts`
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] Add desktop shell assertions for the Horizon sidebar entity card, `2 entities - switch`, seven primary hubs plus Settings, active row, and bottom operator card.
- [x] Add mobile bottom-nav assertions for Home, Properties, Work, Money, and the center Smart Intake FAB.
- [x] Update existing utility-toolbar assertions so `Entity` is expected in the sidebar/drawer switcher rather than the top toolbar.
- [x] Run the focused smoke and confirm it fails against the pre-Horizon shell.

Run:
`PORT=3031 npm run test:smoke -- tests/smoke/mobile-bottom-nav.spec.ts --grep "Horizon"`

Expected:
The new assertions fail because the old shell still shows the Leasium brand block, no `SKJ Property` switcher card, no bottom operator card, and no center FAB.

### Task 2: Implement The Horizon Sidebar

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/app/globals.css` only if body gutters need to match Figma width.

- [x] Replace the desktop sidebar brand block with a Horizon entity switcher card that renders `AppHeader` children when present and falls back to static workspace context.
- [x] Restyle primary nav rows to match Figma: dark navy shell, 232px desktop width, teal active rail, `Dashboard / Smart Intake / Properties / People / Work / Money / Insights`, then Settings near the bottom.
- [x] Add a bottom user card using `/me` data when available, with a sign-in fallback when not.
- [x] Keep `shellLinkProps`, active route matching, platform-admin visibility, comms badge labeling, and shortcut behavior intact.

### Task 3: Implement The Horizon Mobile Shell

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`

- [x] Update the mobile bottom nav to four text tabs around a center Smart Intake upload/FAB.
- [x] Keep the full mobile drawer available from the hamburger and reuse the same Horizon sidebar content.
- [x] Preserve overlay spacing for command search, keyboard shortcuts, and the `G` shortcut hint.

### Task 4: Verify And Polish

**Files:**
- Modify only files already touched if verification finds a shell-specific issue.

- [x] Run targeted lint on `app-shell.tsx` and modified specs.
- [x] Run `npm exec -- tsc --noEmit`.
- [x] Run focused smokes: `mobile-bottom-nav.spec.ts`, app-shell prefetch spec, and broad route checks covering Dashboard, Work, Properties, People, Money, Insights, Settings.
- [x] Run `npm run build`.
- [x] Browser-check `/operations` at desktop and `390x844`, light/system-dark, with no horizontal overflow.

### Task 5: Ship The Slice

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [x] Mark the shell slice `[~]` / Remba-pending.
- [ ] Commit with a terse imperative subject and a body listing files and why.
- [ ] Push to `main`.
- [ ] Verify the Vercel production deployment for the pushed commit is `READY` and `https://leasium.ai/operations` returns HTTP 200.
