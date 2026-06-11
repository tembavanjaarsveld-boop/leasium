# Horizon Properties Mobile Compact Board Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the default mobile Properties board in line with the approved
03 Screens Properties mobile frame (`PO2jOANgmqgZHfqWZXOZGU`, node `59:427`)
while preserving the shipped desktop Horizon cards and existing Table/Map/
Calendar workflows.

**Architecture:** Keep the desktop `PropertyCardsView` as the `md+` card grid.
Add a mobile-only compact row list for the default board, reduce the mobile
stat strip to the two Figma-visible metrics, and hide the board view switcher
and New property action from the default mobile first viewport. Direct
`?view=map` and `?view=calendar` mobile routes keep the view switcher visible.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind utility
classes, Playwright smoke tests.

---

### Task 1: Source And Scope

**Files:**
- Read: Figma Properties mobile frame `59:427`
- Modify: `apps/web/src/components/property-workspace.tsx`

- [x] **Step 1: Pull Figma context**

Use the locked 03 Screens Properties mobile frame, not 04 Concept. The first
viewport uses a compact title/subtitle, two stat cards, and dense property
rows above the Horizon bottom nav.

- [x] **Step 2: Add the mobile compact board**

Render the default board as mobile-only compact property rows with occupancy
severity rails, suburb/state + ownership context, and rent roll summary.
Preserve the existing desktop image-card grid at `md+`.

- [x] **Step 3: Keep alternate mobile views intact**

Hide the board controls only for default mobile board mode. Preserve the
Cards/Table/Map/Calendar switcher on direct mobile Map and Calendar URLs.

### Task 2: Verification

**Files:**
- Modify: `apps/web/tests/smoke/properties-ux.spec.ts`
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Strengthen Properties mobile smoke**

Extend the default mobile Properties smoke to assert no visible image-card
media, no visible Occupancy stat card, visible Rent roll and Renewals stat
cards, and compact row content/touch targets.

- [x] **Step 2: Strengthen Notifications touch-target guard**

Extend the existing Notifications mobile action smoke to assert Retry notice,
Send SMS, and Send digest controls keep the 44px touch floor.

- [x] **Step 3: Run focused smokes**

Observed before commit:
- Properties mobile group passed **3/3**:
  `properties-ux.spec.ts --grep "mobile properties default uses cards instead of a panning table|mobile properties calendar view keeps filters and review actions touch safe|mobile properties map view keeps focus controls touch safe" --workers=1`.
- App-flow guard group passed **2/2**:
  `app-flows.spec.ts --grep "notifications mobile actions keep intended touch targets|Properties multi-view toggles between cards and table" --workers=1`.

### Task 3: Docs, Verification, Commit

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Record as Remba-pending**

Update the Horizon Mobile Polish notes with the Properties compact mobile board
follow-up and the Notifications send/retry touch-target smoke guard.

- [x] **Step 2: Complete final verification**

Observed before commit: targeted ESLint passed; `tsc --noEmit --pretty false`
passed; `npm run build` passed; in-app browser QA at 390x844 and 1280x900
confirmed Properties heading visibility, mobile Map/Calendar tab preservation,
desktop controls, and no horizontal overflow. A dark mobile browser pass also
confirmed the heading, mobile nav, no visible image-card media, and no
horizontal overflow. Local browser data fetch failed outside the mocked smoke
harness, so seeded row fidelity remains covered by Playwright mocks.

- [ ] **Step 3: Commit, push, and Vercel**

Stage only slice files, commit with the Gmail identity, push `main`, and
confirm the production Vercel deployment is READY. Do not mark this complete
without command/deploy evidence from the current implementation context.
