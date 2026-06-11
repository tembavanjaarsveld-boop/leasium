# Horizon Dark Mode Token Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the shipped Horizon dark theme with the approved Dashboard · Dark Figma frame (`62:696`) and its Leasium Color dark token values without changing app behaviour or mutation paths.

**Architecture:** Keep the existing `data-theme="dark"` approach and update the global token remap layer in `globals.css` for shared colour utilities. Limit route-level edits to the two visual QA blockers that cannot be solved by token remaps alone: Settings inactive-tab text and Properties card media. Add smoke assertions that prove the important dark Figma tokens resolve through real Tailwind utility classes and core routes.

**Tech Stack:** Next.js App Router, Tailwind CSS, CSS custom properties, Playwright smoke tests.

---

### Task 1: Dark Token Remap

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [x] **Step 1: Align accent-soft with Figma**

Change the dark `.bg-accent-soft` remap to `--leasium-teal-soft` (`#0f3a37`) and keep translucent `.bg-accent/10` and `.bg-accent/15` on the same accent family.

- [x] **Step 2: Align primary text/background classes**

Add dark overrides so `.bg-primary` resolves to `--leasium-blue` (`#8ea5ff`), `.hover:bg-primary-hover:hover` resolves to `--leasium-blue-hover`, `.text-primary` resolves to `--leasium-blue`, and `.text-primary-hover` resolves to `--leasium-blue-hover`.

- [x] **Step 3: Preserve exact primary borders**

Make `.border-primary` resolve to `--leasium-blue` in dark mode while keeping the opacity-style primary border utilities mixed against the dark card border.

### Task 2: Route Dark Polish And Appearance Smoke Coverage

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx`
- Modify: `apps/web/src/components/property-workspace.tsx`
- Modify: `apps/web/tests/smoke/appearance.spec.ts`

- [x] **Step 1: Fix visual QA blockers**

Use tokenized muted text for inactive Settings tabs and add a dark-mode media
scrim to Properties cards so loaded imagery cannot become a bright slab on the
dark canvas.

- [x] **Step 2: Add Figma token utility probes**

Extend the dark-mode smoke to create temporary probe elements for `bg-primary`, `bg-accent-soft`, `text-primary`, `text-primary-hover`, and `border-primary`, then assert they resolve to the Figma dark token RGB values.

- [x] **Step 3: Keep route regression coverage intact**

Run the existing desktop/mobile dark route sweep after the token assertions and keep all no-provider assumptions unchanged.

### Task 3: Docs And Handover

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/leasium-codex-design-source-of-truth.md`

- [x] **Step 1: Record the slice as Remba-pending**

Add a design-facing log entry for Horizon Dark Mode Token Alignment v1, referencing Figma `62:696` and the token values.

- [x] **Step 2: Update the implementation brief**

Mark the dark-mode slice as shipped pending Remba review once verification is complete.

### Task 4: Verify, Commit, Push, Deploy

**Files:**
- No new app files beyond Tasks 1-3.

- [x] **Step 1: Verify locally**

Run targeted ESLint, `tsc --noEmit`, the appearance smoke, relevant route smokes, production build, and browser checks at 1280x900 and 390x844 in light and dark.

- [ ] **Step 2: Commit and push**

Stage only the dark-mode slice files, commit with the Gmail identity, push `main`, and confirm the Vercel deployment for the commit is READY.
