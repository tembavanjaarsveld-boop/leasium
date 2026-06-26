# Communication Templates Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the key-heavy Settings communication-template grid with a Horizon-native message-first control surface that makes preview/edit paths clear while preserving provider guardrails.

**Architecture:** Keep the existing Settings page data sources and add a focused `MessageTemplatesPanel` inside `apps/web/src/app/settings/page.tsx`. Runtime templates open a read-only preview drawer; stored branded templates use the existing `CommsTemplateEditorDrawer` and already-shipped branded-template mutations. Advanced keys keep the current coverage/export details behind a tab.

**Tech Stack:** Next.js App Router, React, TanStack Query, Playwright smoke tests, existing Leasium UI primitives.

---

### Task 1: Red Smoke Coverage

**Files:**
- Modify: `apps/web/tests/smoke/settings.spec.ts`

- [x] **Step 1: Update the Settings comms smoke test**

Replace the expectations inside `settings exports communication template override review CSV` after entering `Organisation -> Comms` so the test requires the simplified panel:

```ts
await expect(page.getByText("Message templates")).toBeVisible();
await expect(page.getByRole("tab", { name: "Messages" })).toHaveAttribute(
  "aria-selected",
  "true",
);
await expect(page.getByRole("tab", { name: "Branding" })).toBeVisible();
await expect(page.getByRole("tab", { name: "Delivery receipts" })).toBeVisible();
await expect(page.getByRole("tab", { name: "Advanced" })).toBeVisible();
await expect(page.getByText("Tenant onboarding invite")).toBeVisible();
await expect(page.getByText("Invoice delivery")).toBeVisible();
await expect(page.getByText("Standard assignment notice")).toBeVisible();
await expect(page.getByText("tenant_onboarding_invite")).toHaveCount(0);
await page.getByRole("tab", { name: "Advanced" }).click();
await expect(page.getByText("Stored template overrides")).toBeVisible();
await expect(page.getByText("tenant_onboarding_invite")).toBeVisible();
```

- [x] **Step 2: Run the focused smoke test and confirm RED**

Run:

```bash
cd apps/web
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test tests/smoke/settings.spec.ts -g "settings exports communication template override review CSV" --reporter=line
```

Expected: FAIL because `Message templates` and the new tabs do not exist yet.

### Task 2: Replace The Settings Template Grid

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx`

- [x] **Step 1: Add the small state and imports**

Add `Eye`, `Pencil`, and `Sparkles` lucide imports if not already present. Import `DetailDrawer`, `CommsTemplateEditorDrawer`, branded-template mutation helpers, and `CommsTemplateEditorAction`.

- [x] **Step 2: Add local panel state and mutations**

Near existing `templateOverrideExportReceipt`, add local state for the selected template tab, runtime preview drawer, and branded template editor drawer. Reuse the mutation pattern from `/comms` for create/update/save-version/delete and invalidate `["branded-communication-templates", selectedEntityId]`.

- [x] **Step 3: Replace the `Communication templates` SectionPanel**

Replace the current card grid and always-visible stored override subsection with `MessageTemplatesPanel`, passing runtime templates, branded templates, coverage, entity name, copy/download callbacks, and editor/preview callbacks.

- [x] **Step 4: Add focused helper components below the existing template helpers**

Add:

```ts
type MessageTemplateTab = "messages" | "branding" | "receipts" | "advanced";
```

Then add focused functions/components for `matchingBrandedTemplate`, `messageTemplateSourceBadge`, `MessageTemplatesPanel`, `MessageTemplateRow`, `RuntimeTemplatePreviewDrawer`, and `AdvancedTemplateKeysPanel`. Keep them local to `settings/page.tsx` and use existing `SectionPanel`, `StatusBadge`, `SecondaryButton`, `EmptyState`, and `DetailDrawer`.

- [x] **Step 5: Run the focused smoke test and confirm GREEN**

Run the same Playwright command from Task 1. Expected: PASS.

### Task 3: UX Verification And Docs

**Files:**
- Modify: `docs/design-governance.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md` only if the change materially affects takeover state.

- [x] **Step 1: Run frontend checks**

Run:

```bash
cd apps/web
./node_modules/.bin/eslint src tests/smoke
./node_modules/.bin/tsc --noEmit
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test tests/smoke/settings.spec.ts --reporter=line
```

- [x] **Step 2: Capture desktop/mobile screenshots**

Use the existing Playwright setup to capture `/settings` with `Organisation -> Comms` at 1440px and 390px, including the default `Messages` tab and the `Advanced` tab.

- [x] **Step 3: Log the UX pass and roadmap**

Add one dated UX pass log line to `docs/design-governance.md` and add/adjust a concise shipped bullet in `docs/product-roadmap.md` for the Settings communication-template redesign.
