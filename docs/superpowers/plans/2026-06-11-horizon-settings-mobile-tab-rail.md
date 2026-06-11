# Horizon Settings Mobile Tab Rail Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring mobile `/settings` in line with the approved 03 Screens
Settings mobile frame (`PO2jOANgmqgZHfqWZXOZGU`, node `59:677`) while
preserving desktop Settings tabs and direct notifications deep links.

**Architecture:** Keep `notifications` as a real `SettingsTab` and keep the
existing overview rendering for `activeTab === "notifications"`. Hide only the
Notifications tab button below the desktop breakpoint so the phone tab rail is
Organisation, Security, and Connect.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind utility
classes, Playwright smoke tests.

---

### Task 1: Source And Scope

**Files:**
- Read: Figma Settings mobile frame `59:677`
- Modify: `apps/web/src/app/settings/page.tsx`

- [x] **Step 1: Pull Figma context**

Use the locked 03 Screens Settings mobile frame, not 04 Concept. The first
viewport shows Settings, the selected entity subtitle, and three tabs:
Organisation, Security, and Connect.

- [x] **Step 2: Keep Notifications routable**

Preserve the `notifications` tab state and `/settings?tab=notifications`
rendering so saved/internal links still open Work notifications controls.

- [x] **Step 3: Hide the mobile tab button only**

Hide the Notifications tab button on phones and restore it from the desktop
breakpoint upward.

### Task 2: Verification

**Files:**
- Modify: `apps/web/tests/smoke/settings.spec.ts`

- [x] **Step 1: Write the RED smoke**

Add a 390x844 `/settings` smoke that initially fails because the old mobile
rail exposes four tabs instead of the approved three.

- [x] **Step 2: Run focused smokes**

Observed before final verification:
- New Settings mobile smoke passed **1/1**:
  `settings.spec.ts --grep "mobile settings keeps the approved compact tab rail" --workers=1`.
- Focused Settings group passed **4/4**:
  `settings.spec.ts --grep "settings render the Horizon operator controls without provider mutation on load|settings notifications tab opens the Horizon operator controls directly|mobile settings keeps the approved compact tab rail|mobile settings users and roles use readable cards" --workers=1`.
- Mobile production route sweep hit an EADDRINUSE collision when run in
  parallel, then passed **1/1** when rerun sequentially:
  `mobile-bottom-nav.spec.ts --grep "mobile production routes keep headings and bottom navigation in frame" --workers=1`.

### Task 3: Docs, Verification, Commit

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Record as Remba-pending**

Update Horizon Mobile Polish notes with the Settings three-tab mobile rail
follow-up and verification status.

- [x] **Step 2: Complete final verification**

Run targeted ESLint, `tsc --noEmit --pretty false`, production build, and
browser QA at 390x844 and desktop width before committing.

Observed before commit:
- Targeted ESLint passed for `apps/web/src/app/settings/page.tsx`,
  `apps/web/tests/smoke/settings.spec.ts`, and
  `apps/web/tests/smoke/mobile-bottom-nav.spec.ts`.
- `./node_modules/.bin/tsc --noEmit --pretty false` passed.
- `npm run build` passed.
- In-app browser QA on `http://127.0.0.1:3030/settings` passed at 390x844:
  visible tabs were Organisation, Security, and Connect; Work notifications
  content remained visible; mobile nav was present; horizontal overflow was 0.
- In-app browser QA on `/settings?tab=notifications` at 390x844 confirmed the
  deep link still renders Work notifications while the visible tab rail stays to
  Organisation, Security, and Connect.
- In-app browser QA at 1280x900 confirmed desktop shows Organisation, Security,
  Notifications, and Connect with no horizontal overflow.

- [x] **Step 3: Commit, push, and Vercel**

Stage only slice files, commit with the Gmail identity, push `main`, and
confirm the production Vercel deployment is READY. Do not mark this complete
without command/deploy evidence from the current implementation context.

Observed after commit:
- Implementation commit `5ad3737` pushed to `main`.
- Vercel production deployment
  `dpl_4dvqSXuPv1v1KjoYeAMXwGAnqV6V` reached **READY** with aliases attached to
  `https://leasium.ai`, `https://www.leasium.ai`, and
  `https://leasium.vercel.app`.
- Live HTTP checks returned 200 for `/settings`,
  `/settings?tab=notifications`, `/intake`, and `/`.
