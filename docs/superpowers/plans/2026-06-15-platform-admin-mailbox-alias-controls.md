# Platform Admin Mailbox Alias Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-admin UI for reserving, listing, labelling, enabling, and disabling AI Mailbox virtual client aliases.

**Architecture:** Use the shipped `/api/v1/mailbox-aliases` backend without changing provider, AI, Smart Intake, payment, or reconciliation behavior. Add small frontend API helpers, keep the operator Settings alias display read-only, and place controls in `/admin` beside Clients and Platform integrations.

**Tech Stack:** Next.js App Router, React Query, TypeScript, existing Horizon UI primitives, Playwright smoke tests, Figma source frame `Platform admin · Mailbox aliases`.

---

### Task 1: Frontend API + Smoke Mocks

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/tests/smoke/api-mocks.ts`

- [x] **Step 1: Add platform-admin alias helpers**

Add typed helpers near the existing mailbox alias read helper:

```ts
export type MailboxAliasCreatePayload = {
  organisation_id: string;
  local_part: string;
  domain?: string | null;
  label?: string | null;
};

export type MailboxAliasUpdatePayload = {
  status?: "active" | "disabled";
  label?: string | null;
};

export function listPlatformMailboxAliases(organisationId?: string) {
  const params = new URLSearchParams();
  if (organisationId) params.set("organisation_id", organisationId);
  const query = params.toString();
  return request<MailboxAliasListRecord>(`/mailbox-aliases${query ? `?${query}` : ""}`);
}

export function reservePlatformMailboxAlias(payload: MailboxAliasCreatePayload) {
  return request<MailboxAliasRecord>("/mailbox-aliases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePlatformMailboxAlias(aliasId: string, payload: MailboxAliasUpdatePayload) {
  return request<MailboxAliasRecord>(`/mailbox-aliases/${aliasId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
```

- [x] **Step 2: Add mocked list/create/update routes**

Extend `mockLeasiumApi` so `GET /mailbox-aliases`, `POST /mailbox-aliases`, and `PATCH /mailbox-aliases/:id` mutate the local `mailboxAliases` fixture. Reject duplicate addresses and empty local parts in the mock.

### Task 2: Platform Admin Alias Tab

**Files:**
- Modify: `apps/web/src/app/admin/page.tsx`

- [x] **Step 1: Add the tab and imports**

Add `Mail`, `Plus`, and `ShieldHalf` icons, import the alias helpers/types, and extend `AdminTab` with `"aliases"`.

- [x] **Step 2: Build `MailboxAliasesTab`**

Add a component that:
- loads platform organisations and aliases;
- lets the platform admin reserve an alias for a selected client;
- shows active/disabled rows with organisation name, alias, status, editable label, and enable/disable action;
- keeps guardrail copy explicit: alias changes only affect local routing and do not send providers or apply Smart Intake.

- [x] **Step 3: Wire the tab into `/admin`**

Render the new tab between Clients and Platform integrations. Keep the existing non-admin gate and client Settings read-only behavior unchanged.

### Task 3: Smoke Test

**Files:**
- Modify: `apps/web/tests/smoke/platform-admin.spec.ts`

- [x] **Step 1: Add a failing smoke assertion**

Extend the platform-admin smoke to open the Mailbox aliases tab, verify existing aliases, reserve a new alias, save a label, and disable an alias.

- [x] **Step 2: Verify the smoke passes after implementation**

Run:

```bash
NODE_ENV=development npm --prefix apps/web run test:smoke -- platform-admin.spec.ts --workers=1
```

### Task 4: Docs + UX Gate

**Files:**
- Modify: `docs/design-governance.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Capture screenshots at 1440 and 390**

Use the smoke/browser path to capture `/admin` Mailbox aliases at desktop and mobile widths. Check no obvious overflow, clipped text, or hidden primary action.

- [x] **Step 2: Update source-of-truth docs**

Record the shipped scope, Figma frame IDs, verification evidence, and remove the AI mailbox platform-admin alias controls entry from UX debt if the slice fully covers it.

- [x] **Step 3: Run final verification**

Run focused lint/type/smoke/build checks:

```bash
npx eslint src/app/admin/page.tsx src/lib/api.ts tests/smoke/platform-admin.spec.ts tests/smoke/api-mocks.ts
npx tsc --noEmit
NODE_ENV=development npm --prefix apps/web run test:smoke -- platform-admin.spec.ts --workers=1
npm --prefix apps/web run build
```
