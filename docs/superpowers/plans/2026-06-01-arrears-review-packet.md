# Arrears Review Packet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a read-only arrears review packet to each visible case in the Operations Arrears tab.

**Architecture:** Keep the slice frontend-only. Extend the existing Operations smoke first, then add packet helpers and a compact packet component inside `apps/web/src/app/operations/page.tsx`, deriving all data from already-loaded arrears, tenant, property, and assignment state. Export/copy are browser-local only and must not call existing arrears mutation endpoints.

**Tech Stack:** Next.js App Router, React, TypeScript, TanStack Query, Playwright smoke tests, existing Leasium UI primitives.

---

## Files

- Modify: `apps/web/tests/smoke/app-flows.spec.ts` — extend the existing Operations smoke with failing arrears packet assertions and forbidden mutation tracking.
- Modify: `apps/web/src/app/operations/page.tsx` — add packet types/helpers, text/CSV exporters, row component, and render call.
- Modify: `docs/product-roadmap.md` — record shipped arrears review packet under Maintenance and arrears workflow depth.
- Modify: `docs/design-governance.md` — add design note near Maintenance And Arrears Foundations.
- Modify: `docs/next-chat-handover.md` — record shipped scope and verification.

No backend files should change.

---

### Task 1: Red Smoke Test

**Files:**
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Add forbidden mutation tracking to the existing Operations smoke**

Inside `test("operations workspace surfaces maintenance and arrears work", ...)`, after `await page.goto("/operations");`, add:

```ts
  const arrearsPacketMutationPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== "GET" &&
      (url.pathname.includes("/api/v1/arrears") ||
        url.pathname.includes("/api/v1/comms/dispatch") ||
        url.pathname.includes("/api/v1/comms/dismiss") ||
        url.pathname.includes("/api/v1/xero") ||
        url.pathname.includes("/api/v1/basiq") ||
        url.pathname.includes("/api/v1/invoice-drafts"))
    ) {
      arrearsPacketMutationPaths.push(`${request.method()} ${url.pathname}`);
    }
  });
```

- [x] **Step 2: Add failing arrears packet assertions**

After the test clicks the Arrears tab and before the existing `Escalate` click, add:

```ts
  const arrearsPacket = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Arrears and credit control" }) })
    .locator("[data-testid='arrears-review-packet-arrears-1']");
  await expect(arrearsPacket).toBeVisible();
  await expect(
    arrearsPacket.getByText("Review dispute before reminder"),
  ).toBeVisible();
  await expect(arrearsPacket.getByText("Balance age")).toBeVisible();
  await expect(arrearsPacket.getByText("1-30 $8,800")).toBeVisible();
  await expect(arrearsPacket.getByText("Reminder")).toBeVisible();
  await expect(arrearsPacket.getByText("Dispute")).toBeVisible();
  await expect(arrearsPacket.getByText("raised")).toBeVisible();
  await expect(arrearsPacket.getByText("Escalation")).toBeVisible();
  await expect(arrearsPacket.getByText("Promise")).toBeVisible();
  await expect(arrearsPacket.getByText("Assignment")).toBeVisible();
  await expect(
    arrearsPacket.getByRole("link", { name: "Open tenant" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  await expect(
    arrearsPacket.getByRole("link", { name: "Open queue" }),
  ).toHaveAttribute("href", "/operations?tab=queue");
  await arrearsPacket.getByRole("button", { name: "Copy packet" }).click();
  await expect(
    arrearsPacket.getByText("Arrears review packet copied."),
  ).toBeVisible();

  const arrearsPacketDownloadPromise = page.waitForEvent("download");
  await arrearsPacket
    .getByRole("button", { name: "Download packet CSV" })
    .click();
  const arrearsPacketDownload = await arrearsPacketDownloadPromise;
  expect(arrearsPacketDownload.suggestedFilename()).toBe(
    "arrears-review-packet-arrears-1.csv",
  );
  const arrearsPacketPath = await arrearsPacketDownload.path();
  expect(arrearsPacketPath).not.toBeNull();
  const arrearsPacketCsv = await readFile(arrearsPacketPath!, "utf8");
  expect(arrearsPacketCsv).toContain("Bright Cafe");
  expect(arrearsPacketCsv).toContain("$8,800");
  expect(arrearsPacketCsv).toContain("Review dispute before reminder");
  expect(arrearsPacketCsv).toContain(
    "Review-only arrears packet: downloading or copying this file does not send email, SMS, tenant messages, owner messages, provider dispatch, Xero/Basiq writes, payment reconciliation, invoice updates, arrears status changes, reminder updates, escalation updates, or assignment updates.",
  );
  expect(arrearsPacketMutationPaths).toEqual([]);
```

- [x] **Step 3: Run the focused smoke and verify RED**

Run:

```bash
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts -g "operations workspace surfaces maintenance and arrears work" --workers=1
```

Expected: fail because `[data-testid='arrears-review-packet-arrears-1']` does not exist.

---

### Task 2: Packet Helpers and Exporters

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Add packet types and guardrail**

Near the existing type definitions after `type WorkAssignment`, add:

```ts
type ArrearsReviewPacketEvidenceRow = {
  label: string;
  statusLabel: string;
  detail: string;
  tone: StatusTone;
};

type ArrearsReviewPacket = {
  nextAction: string;
  nextActionDetail: string;
  nextActionTone: StatusTone;
  evidenceRows: ArrearsReviewPacketEvidenceRow[];
};
```

Near `OPERATIONS_QUEUE_EXPORT_GUARDRAIL`, add:

```ts
const ARREARS_REVIEW_PACKET_GUARDRAIL =
  "Review-only arrears packet: downloading or copying this file does not send email, SMS, tenant messages, owner messages, provider dispatch, Xero/Basiq writes, payment reconciliation, invoice updates, arrears status changes, reminder updates, escalation updates, or assignment updates.";
```

- [x] **Step 2: Add deterministic next-action and packet builders**

After `arrearsTone`, add:

```ts
function arrearsReviewNextAction(arrearsCase: ArrearsCaseRecord) {
  if (!arrearsIsOpen(arrearsCase)) {
    return {
      label: "Closed - audit only",
      detail: "Use this packet for history; reopen the case before changing credit-control state.",
      tone: "neutral" as StatusTone,
    };
  }
  if (["queued", "in_progress", "referred"].includes(arrearsCase.escalation_status)) {
    return {
      label: "Review escalation path",
      detail: "Escalation is already active or queued. Confirm the next credit-control owner before sending more reminders.",
      tone: "danger" as StatusTone,
    };
  }
  if (["raised", "under_review", "escalated"].includes(arrearsCase.dispute_status)) {
    return {
      label: "Review dispute before reminder",
      detail: "A dispute is recorded, so review the case context before the next arrears follow-up.",
      tone: "warning" as StatusTone,
    };
  }
  if (dueRank(arrearsCase.next_reminder_on) < 0) {
    return {
      label: "Send or log arrears follow-up",
      detail: "The next reminder date is overdue. Use the case actions when ready to mutate reminder history.",
      tone: "danger" as StatusTone,
    };
  }
  if (arrearsCase.promise_to_pay_date && dueRank(arrearsCase.promise_to_pay_date) >= 0) {
    return {
      label: "Monitor promise to pay",
      detail: "A future promise-to-pay date is recorded. Monitor the case until that date before escalating.",
      tone: "primary" as StatusTone,
    };
  }
  if (arrearsCase.total_balance_cents > 0 && !arrearsCase.next_reminder_on) {
    return {
      label: "Schedule arrears reminder",
      detail: "A positive balance is open and no next reminder date is recorded.",
      tone: "warning" as StatusTone,
    };
  }
  if (arrearsCase.total_balance_cents > 0) {
    return {
      label: "Monitor next reminder",
      detail: `Next reminder is ${dueLabel(arrearsCase.next_reminder_on)}.`,
      tone: "neutral" as StatusTone,
    };
  }
  return {
    label: "Monitor arrears case",
    detail: "No immediate arrears blocker is showing. Continue normal review.",
    tone: "neutral" as StatusTone,
  };
}

function buildArrearsReviewPacket(arrearsCase: ArrearsCaseRecord): ArrearsReviewPacket {
  const nextAction = arrearsReviewNextAction(arrearsCase);
  const assignment = workAssignment(arrearsCase.metadata);
  return {
    nextAction: nextAction.label,
    nextActionDetail: nextAction.detail,
    nextActionTone: nextAction.tone,
    evidenceRows: [
      {
        label: "Balance age",
        statusLabel: formatMoney(arrearsCase.total_balance_cents, arrearsCase.currency),
        detail: [
          `Current ${formatMoney(arrearsCase.balance_current_cents, arrearsCase.currency)}`,
          `1-30 ${formatMoney(arrearsCase.balance_1_30_cents, arrearsCase.currency)}`,
          `31-60 ${formatMoney(arrearsCase.balance_31_60_cents, arrearsCase.currency)}`,
          `61-90 ${formatMoney(arrearsCase.balance_61_90_cents, arrearsCase.currency)}`,
          `90+ ${formatMoney(arrearsCase.balance_90_plus_cents, arrearsCase.currency)}`,
        ].join(" - "),
        tone: arrearsCase.total_balance_cents > 0 ? "warning" : "success",
      },
      {
        label: "Reminder",
        statusLabel: dueLabel(arrearsCase.next_reminder_on),
        detail: arrearsCase.last_reminder_at
          ? `Last reminder ${formatDateTime(arrearsCase.last_reminder_at)}. Stage ${arrearsCase.reminder_stage}.`
          : `No reminder has been logged yet. Stage ${arrearsCase.reminder_stage}.`,
        tone: dueRank(arrearsCase.next_reminder_on) <= 0 ? "warning" : "neutral",
      },
      {
        label: "Dispute",
        statusLabel: label(arrearsCase.dispute_status),
        detail:
          arrearsCase.dispute_status === "none"
            ? "No dispute is recorded."
            : "Review dispute context before follow-up.",
        tone: arrearsCase.dispute_status === "none" ? "neutral" : "warning",
      },
      {
        label: "Escalation",
        statusLabel: label(arrearsCase.escalation_status),
        detail:
          arrearsCase.escalation_status === "none"
            ? "No escalation is active."
            : `Escalation queue: ${arrearsCase.escalation_queue ?? "not recorded"}.`,
        tone: arrearsCase.escalation_status === "none" ? "neutral" : "danger",
      },
      {
        label: "Promise",
        statusLabel: arrearsCase.promise_to_pay_date
          ? formatDate(arrearsCase.promise_to_pay_date)
          : "No promise",
        detail: arrearsCase.promise_to_pay_amount_cents
          ? `Promised amount ${formatMoney(arrearsCase.promise_to_pay_amount_cents, arrearsCase.currency)}.`
          : "No promise-to-pay amount is recorded.",
        tone: arrearsCase.promise_to_pay_date ? "primary" : "neutral",
      },
      {
        label: "Assignment",
        statusLabel: assignment?.assignedName ?? "Unassigned",
        detail: assignment?.notificationStatus
          ? `Assignment notice ${label(assignment.notificationStatus)}.`
          : "No assignment notice is ready.",
        tone: assignment?.assignedName ? "primary" : "neutral",
      },
    ],
  };
}
```

- [x] **Step 3: Add text and CSV exporters**

After `buildArrearsReviewPacket`, add:

```ts
function arrearsReviewPacketText({
  arrearsCase,
  tenantLabel,
  propertyLabel,
  packet,
}: {
  arrearsCase: ArrearsCaseRecord;
  tenantLabel: string;
  propertyLabel: string;
  packet: ArrearsReviewPacket;
}) {
  return [
    "Arrears review packet",
    `Tenant: ${tenantLabel}`,
    `Property: ${propertyLabel}`,
    `Balance: ${formatMoney(arrearsCase.total_balance_cents, arrearsCase.currency)}`,
    `Status: ${label(arrearsCase.status)}`,
    `Next action: ${packet.nextAction}`,
    packet.nextActionDetail,
    "",
    "Evidence:",
    ...packet.evidenceRows.map(
      (row) => `- ${row.label}: ${row.statusLabel} - ${row.detail}`,
    ),
    "",
    ARREARS_REVIEW_PACKET_GUARDRAIL,
  ].join("\n");
}

function arrearsReviewPacketCsv({
  arrearsCase,
  tenantLabel,
  propertyLabel,
  packet,
}: {
  arrearsCase: ArrearsCaseRecord;
  tenantLabel: string;
  propertyLabel: string;
  packet: ArrearsReviewPacket;
}) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Category", "Item", "Status", "Detail", "Guardrail"],
    [
      "Arrears case",
      tenantLabel,
      `${formatMoney(arrearsCase.total_balance_cents, arrearsCase.currency)} / ${label(arrearsCase.status)}`,
      `${propertyLabel}. Next action: ${packet.nextAction}. ${packet.nextActionDetail}`,
      ARREARS_REVIEW_PACKET_GUARDRAIL,
    ],
    ...packet.evidenceRows.map((row) => [
      "Evidence",
      row.label,
      row.statusLabel,
      row.detail,
      ARREARS_REVIEW_PACKET_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "",
      "Review-only",
      ARREARS_REVIEW_PACKET_GUARDRAIL,
      ARREARS_REVIEW_PACKET_GUARDRAIL,
    ],
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
```

---

### Task 3: Packet Component and Render

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Add the row-level component**

Before `function ArrearsActions`, add:

```tsx
function ArrearsReviewPacketPanel({
  arrearsCase,
  tenantLabel,
  propertyLabel,
}: {
  arrearsCase: ArrearsCaseRecord;
  tenantLabel: string;
  propertyLabel: string;
}) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const packet = buildArrearsReviewPacket(arrearsCase);
  const copyPacket = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      arrearsReviewPacketText({ arrearsCase, tenantLabel, propertyLabel, packet }),
    );
    setReceipt("Arrears review packet copied.");
  };
  const downloadPacketCsv = () => {
    saveBlob(
      new Blob(
        [arrearsReviewPacketCsv({ arrearsCase, tenantLabel, propertyLabel, packet })],
        { type: "text/csv;charset=utf-8" },
      ),
      `arrears-review-packet-${arrearsCase.id}.csv`,
    );
    setReceipt("Arrears review packet CSV downloaded.");
  };

  return (
    <div
      data-testid={`arrears-review-packet-${arrearsCase.id}`}
      className="grid gap-3 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="font-semibold text-foreground">Review packet</div>
          <div className="text-muted-foreground">{packet.nextActionDetail}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={packet.nextActionTone}>{packet.nextAction}</StatusBadge>
          <SecondaryButton type="button" className="min-h-9 rounded-lg px-3 text-xs" onClick={copyPacket}>
            <ClipboardList size={14} />
            Copy packet
          </SecondaryButton>
          <SecondaryButton type="button" className="min-h-9 rounded-lg px-3 text-xs" onClick={downloadPacketCsv}>
            <Download size={14} />
            Download packet CSV
          </SecondaryButton>
        </div>
      </div>
      {receipt ? <p className="text-xs font-medium text-success">{receipt}</p> : null}
      <div className="grid gap-2 md:grid-cols-3">
        {packet.evidenceRows.map((row) => (
          <div key={row.label} className="grid gap-1 rounded-md border border-border bg-white px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">{row.label}</span>
              <StatusBadge tone={row.tone}>{row.statusLabel}</StatusBadge>
            </div>
            <div className="text-xs leading-5 text-muted-foreground">{row.detail}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs hover:bg-muted" href={`/tenants/${encodeURIComponent(arrearsCase.tenant_id)}`}>
          <Link2 size={13} />
          Open tenant
        </Link>
        <Link className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs hover:bg-muted" href="/operations?tab=queue">
          <Link2 size={13} />
          Open queue
        </Link>
      </div>
      <p className="rounded-md bg-white px-2 py-2 text-xs text-muted-foreground">
        {ARREARS_REVIEW_PACKET_GUARDRAIL}
      </p>
    </div>
  );
}
```

- [x] **Step 2: Render the packet inside each arrears case row**

In the arrears row map, after the right-side action column `</div>` and before
the closing `</div>` for the `key={arrearsCase.id}` row wrapper, add this
full-width sibling:

```tsx
                        <div className="xl:col-span-2">
                          <ArrearsReviewPacketPanel
                            arrearsCase={arrearsCase}
                            tenantLabel={tenantName(tenants, arrearsCase.tenant_id)}
                            propertyLabel={propertyName(properties, arrearsCase.property_id)}
                          />
                        </div>
```

- [x] **Step 3: Run the focused smoke and verify GREEN**

Run:

```bash
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts -g "operations workspace surfaces maintenance and arrears work" --workers=1
```

Expected: pass.

---

### Task 4: Docs and Verification

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Update docs**

Add a short shipped note to the roadmap under Maintenance and arrears workflow depth, add a design-governance note near Maintenance And Arrears Foundations, and add a latest handover note under the current 2026-06-01 section.

- [x] **Step 2: Run final verification**

Run:

```bash
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts -g "operations workspace surfaces maintenance and arrears work" --workers=1
cd apps/web && ./node_modules/.bin/eslint src/app/operations/page.tsx tests/smoke/app-flows.spec.ts
cd apps/web && ./node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: all pass.

- [x] **Step 3: Stage only intended files and commit**

Run:

```bash
git add -- apps/web/src/app/operations/page.tsx \
  apps/web/tests/smoke/app-flows.spec.ts \
  docs/product-roadmap.md \
  docs/design-governance.md \
  docs/next-chat-handover.md \
  docs/superpowers/plans/2026-06-01-arrears-review-packet.md
git diff --cached --name-only
git commit -m "Add arrears review packet" -- apps/web/src/app/operations/page.tsx \
  apps/web/tests/smoke/app-flows.spec.ts \
  docs/product-roadmap.md \
  docs/design-governance.md \
  docs/next-chat-handover.md \
  docs/superpowers/plans/2026-06-01-arrears-review-packet.md
```

Expected staged files: exactly the six files above. Do not stage `market-research/*`.
