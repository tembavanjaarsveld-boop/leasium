# Horizon Smart Intake Mobile Landing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring bare `/intake` on mobile in line with the approved 03 Screens
Smart Intake mobile frame (`PO2jOANgmqgZHfqWZXOZGU`, node `59:521`) while
preserving explicit document-review deep links and review-first mutation
guardrails.

**Architecture:** Keep the existing desktop Horizon Smart Intake landing. On
mobile, render the compact title/subtitle, short dashed drop/snap zone, hidden
filter/export toolbar, and compact review queue rows. Remove the bare-route
auto-open fallback so `/intake` stays landing-first; explicit `?review=...`,
row Review clicks, and upload success still open the review editor.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind utility
classes, Playwright smoke tests.

---

### Task 1: Source And Scope

**Files:**
- Read: Figma Smart Intake mobile frame `59:521`
- Modify: `apps/web/src/components/dashboard.tsx`

- [x] **Step 1: Pull Figma context**

Use the locked 03 Screens Smart Intake mobile frame, not 04 Concept. The first
viewport is landing-first: compact header, drop/snap zone, review queue label,
and three compact cards above the bottom nav.

- [x] **Step 2: Keep bare `/intake` landing-first**

Remove the first-review auto-selection fallback while preserving explicit review
selection from query params, row Review clicks, and upload success.

- [x] **Step 3: Add mobile-only compact presentation**

Use the Figma mobile copy (`Drop it. Review it. Approve it.`, `Drop or snap a
document`, `Take photo`) on phones, hide the mobile filter/export toolbar, and
render compact queue cards with status rails.

### Task 2: Verification

**Files:**
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Write the RED smoke**

Add a 390x844 `/intake` smoke that initially fails because the old mobile route
auto-opens the first review and uses desktop landing copy.

- [x] **Step 2: Run focused smokes**

Observed before commit:
- New Smart Intake mobile smoke passed **1/1**:
  `app-flows.spec.ts --grep "mobile Smart Intake landing keeps the compact Horizon queue first" --workers=1`.
- Smart Intake focused group passed **4/4**:
  `app-flows.spec.ts --grep "smart intake shows Horizon review-first landing|smart intake Horizon document review keeps source preview beside extracted fields without mutations|mobile Smart Intake document review keeps touch guardrails above bottom nav without provider writes|mobile Smart Intake landing keeps the compact Horizon queue first" --workers=1`.
- Mobile production route sweep passed **1/1**:
  `mobile-bottom-nav.spec.ts --grep "mobile production routes keep headings and bottom navigation in frame" --workers=1`.

### Task 3: Docs, Verification, Commit

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Record as Remba-pending**

Update Horizon Mobile Polish notes with the Smart Intake landing-first mobile
follow-up and verification status.

- [x] **Step 2: Complete final verification**

Observed before commit: targeted ESLint passed; `tsc --noEmit --pretty false`
passed; `npm run build` passed; in-app browser QA at 390x844 and 1280x900
confirmed compact mobile landing signals, desktop landing controls, no
horizontal overflow, and no bare-route review auto-open. Local browser data
fetch failed outside the mocked smoke harness, so seeded row fidelity remains
covered by Playwright mocks.

- [ ] **Step 3: Commit, push, and Vercel**

Stage only slice files, commit with the Gmail identity, push `main`, and
confirm the production Vercel deployment is READY. Do not mark this complete
without command/deploy evidence from the current implementation context.
