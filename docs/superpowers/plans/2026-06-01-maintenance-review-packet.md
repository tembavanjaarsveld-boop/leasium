# Maintenance Review Packet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a read-only maintenance review packet to each work-order detail page.

**Architecture:** Derive the packet client-side from data the maintenance detail route already loads: work order, documents, invoice drafts, correspondence, vendor portal metadata, and completion review rows. Add no backend route in v1. The packet renders a compact summary, deterministic next-action cue, evidence checklist, safe handoff links, copy action, and CSV export.

**Tech Stack:** Next.js App Router, React, TypeScript, TanStack Query, Playwright smoke tests, existing Leasium UI primitives.

---

## Files

- Modify: `apps/web/tests/smoke/app-flows.spec.ts` — extend the existing maintenance detail smoke with failing review-packet assertions.
- Modify: `apps/web/src/app/operations/maintenance/[workOrderId]/page.tsx` — add packet helpers, CSV/text exporters, component, and render call.
- Modify: `docs/product-roadmap.md` — record shipped maintenance review packet under maintenance/work depth.
- Modify: `docs/design-governance.md` — add prototype-mode design-facing note.
- Modify: `docs/next-chat-handover.md` — record shipped scope, verification, and guardrails.

No backend files should change. If a missing API field is discovered, stop and add a failing backend integration test before modifying API code.

---

### Task 1: Red Smoke Test

**Files:**
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Add failing assertions to the existing maintenance detail smoke**

In `test("maintenance detail route shows quote evidence", ...)`, keep the existing `commsCorrespondenceMutationRequests` check and add a second counter for review-packet forbidden mutations:

```ts
  const reviewPacketMutationPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== "GET" &&
      (url.pathname.includes("/api/v1/maintenance/work-orders/work-order-1/contractor-") ||
        url.pathname.includes("/api/v1/maintenance/work-orders/work-order-1/vendor-portal") ||
        url.pathname.includes("/api/v1/invoice-drafts/") ||
        url.pathname.includes("/api/v1/comms/dispatch") ||
        url.pathname.includes("/api/v1/comms/dismiss") ||
        url.pathname.includes("/api/v1/xero") ||
        url.pathname.includes("/api/v1/basiq"))
    ) {
      reviewPacketMutationPaths.push(
        `${request.method()} ${url.pathname}`,
      );
    }
  });
```

After the existing channel-evidence assertions and before the test fills `Operational note`, add:

```ts
  const reviewPacket = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Review packet" }) });
  await expect(reviewPacket).toBeVisible();
  await expect(reviewPacket.getByText("Review and approve quote")).toBeVisible();
  await expect(reviewPacket.getByText("Quote evidence")).toBeVisible();
  await expect(reviewPacket.getByText("1 linked")).toBeVisible();
  await expect(reviewPacket.getByText("Invoice handoff")).toBeVisible();
  await expect(reviewPacket.getByText("No linked invoice")).toBeVisible();
  await expect(reviewPacket.getByText("Vendor portal")).toBeVisible();
  await expect(reviewPacket.getByText("Hidden")).toBeVisible();
  await expect(reviewPacket.getByRole("link", { name: "Open Comms" })).toHaveAttribute(
    "href",
    "/comms",
  );
  await expect(reviewPacket.getByRole("link", { name: "Open tenant" })).toHaveAttribute(
    "href",
    "/tenants/tenant-1",
  );
  await reviewPacket.getByRole("button", { name: "Copy packet" }).click();
  await expect(reviewPacket.getByText("Maintenance review packet copied.")).toBeVisible();

  const reviewPacketDownloadPromise = page.waitForEvent("download");
  await reviewPacket.getByRole("button", { name: "Download packet CSV" }).click();
  const reviewPacketDownload = await reviewPacketDownloadPromise;
  expect(reviewPacketDownload.suggestedFilename()).toBe(
    "maintenance-review-packet-work-order-1.csv",
  );
  const reviewPacketPath = await reviewPacketDownload.path();
  expect(reviewPacketPath).not.toBeNull();
  const reviewPacketCsv = await readFile(reviewPacketPath!, "utf8");
  expect(reviewPacketCsv).toContain("Air conditioning fault");
  expect(reviewPacketCsv).toContain("Review and approve quote");
  expect(reviewPacketCsv).toContain(
    "Review-only packet: downloading or copying this file does not send email, SMS, portal messages, provider dispatch, invoice updates, Xero/Basiq writes, payment reconciliation, document uploads, or maintenance mutations.",
  );
  expect(reviewPacketMutationPaths).toEqual([]);
```

- [x] **Step 2: Run the focused smoke and verify RED**

Run:

```bash
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts -g "maintenance detail route shows quote evidence" --workers=1
```

Expected: fail because the `Review packet` panel does not exist.

---

### Task 2: Client-Side Packet Helpers

**Files:**
- Modify: `apps/web/src/app/operations/maintenance/[workOrderId]/page.tsx`

- [x] **Step 1: Add packet types, guardrail, and deterministic next-action helper**

Near the existing review helper types, add:

```ts
type MaintenanceReviewPacketEvidenceRow = {
  label: string;
  statusLabel: string;
  detail: string;
  tone: StatusTone;
};

type MaintenanceReviewPacketLink = {
  label: string;
  href: string;
};

type MaintenanceReviewPacket = {
  nextAction: string;
  nextActionDetail: string;
  nextActionTone: StatusTone;
  evidenceRows: MaintenanceReviewPacketEvidenceRow[];
  links: MaintenanceReviewPacketLink[];
};

const MAINTENANCE_REVIEW_PACKET_GUARDRAIL =
  "Review-only packet: downloading or copying this file does not send email, SMS, portal messages, provider dispatch, invoice updates, Xero/Basiq writes, payment reconciliation, document uploads, or maintenance mutations.";
```

Add:

```ts
function maintenanceReviewNextAction({
  workOrder,
  quoteDocumentCount,
  linkedInvoiceDraft,
  linkedInvoiceRecoveryReasons,
  vendorPortalIsVisible,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  quoteDocumentCount: number;
  linkedInvoiceDraft: InvoiceDraftRecord | null;
  linkedInvoiceRecoveryReasons: string[];
  vendorPortalIsVisible: boolean;
}) {
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    return {
      label: "Closed - audit only",
      detail: "Use this packet for review history; reopen the job before changing operational state.",
      tone: "neutral" as StatusTone,
    };
  }
  if (workOrder.approval_status === "pending" && quoteDocumentCount === 0) {
    return {
      label: "Attach quote evidence before approval",
      detail: "Approval is pending and no quote/supporting document is linked yet.",
      tone: "warning" as StatusTone,
    };
  }
  if (workOrder.approval_status === "pending") {
    return {
      label: "Review and approve quote",
      detail: "Quote evidence is present; review the approval panel before approving.",
      tone: "warning" as StatusTone,
    };
  }
  if (
    (workOrder.status === "approved" || workOrder.status === "in_progress") &&
    !linkedInvoiceDraft
  ) {
    return {
      label: "Link or prepare billing handoff",
      detail: "Operations can continue, but Billing has no linked invoice draft yet.",
      tone: "primary" as StatusTone,
    };
  }
  if (linkedInvoiceRecoveryReasons.length > 0) {
    return {
      label: "Recover in Billing Readiness",
      detail: linkedInvoiceRecoveryReasons.join(" "),
      tone: "danger" as StatusTone,
    };
  }
  if (vendorPortalIsVisible) {
    return {
      label: "Monitor vendor portal visibility",
      detail: "This job is visible to the selected vendor through the read-only portal preview.",
      tone: "primary" as StatusTone,
    };
  }
  return {
    label: "Monitor work order",
    detail: "No urgent review-packet blocker is showing. Continue normal operations review.",
    tone: "neutral" as StatusTone,
  };
}
```

- [x] **Step 2: Add packet builder and exporters**

Add:

```ts
function buildMaintenanceReviewPacket({
  workOrder,
  quoteDocumentCount,
  linkedInvoiceDraft,
  linkedInvoiceHandoff,
  linkedInvoiceRecoveryReasons,
  correspondenceCount,
  correspondenceTenantId,
  completionReviewRows,
  channelReceiptCount,
  vendorPortalIsVisible,
  vendorPortalPreviewHref,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  quoteDocumentCount: number;
  linkedInvoiceDraft: InvoiceDraftRecord | null;
  linkedInvoiceHandoff: ReturnType<typeof invoiceBillingHandoff> | null;
  linkedInvoiceRecoveryReasons: string[];
  correspondenceCount: number;
  correspondenceTenantId: string | null;
  completionReviewRows: CompletionReviewRow[];
  channelReceiptCount: number;
  vendorPortalIsVisible: boolean;
  vendorPortalPreviewHref: string | null;
}): MaintenanceReviewPacket {
  const nextAction = maintenanceReviewNextAction({
    workOrder,
    quoteDocumentCount,
    linkedInvoiceDraft,
    linkedInvoiceRecoveryReasons,
    vendorPortalIsVisible,
  });
  const reviewedCompletionCount = completionReviewRows.filter(
    (row) => row.reviewedAt,
  ).length;
  const evidenceRows: MaintenanceReviewPacketEvidenceRow[] = [
    {
      label: "Quote evidence",
      statusLabel: `${quoteDocumentCount} linked`,
      detail:
        quoteDocumentCount > 0
          ? "Quote/supporting documents are linked below."
          : "No quote/supporting documents are linked yet.",
      tone: quoteDocumentCount > 0 ? "success" : "warning",
    },
    {
      label: "Invoice handoff",
      statusLabel: linkedInvoiceDraft
        ? label(linkedInvoiceDraft.status)
        : "No linked invoice",
      detail:
        linkedInvoiceHandoff?.message ??
        "No Billing Readiness invoice draft is linked to this job.",
      tone: linkedInvoiceHandoff?.tone ?? "neutral",
    },
    {
      label: "Correspondence",
      statusLabel: `${correspondenceCount} event${correspondenceCount === 1 ? "" : "s"}`,
      detail:
        correspondenceCount > 0
          ? "Linked Comms receipts are available below."
          : "No linked Comms receipts are recorded yet.",
      tone: correspondenceCount > 0 ? "primary" : "neutral",
    },
    {
      label: "Completion reviews",
      statusLabel: completionReviewRows.length
        ? `${reviewedCompletionCount}/${completionReviewRows.length} reviewed`
        : "Not ready",
      detail: completionReviewRows.length
        ? "Owner, tenant, and contractor completion copy can be reviewed below."
        : "Completion copy unlocks after job closeout.",
      tone:
        completionReviewRows.length === 0
          ? "neutral"
          : reviewedCompletionCount === completionReviewRows.length
            ? "success"
            : "warning",
    },
    {
      label: "Contractor receipts",
      statusLabel: `${channelReceiptCount} receipt${channelReceiptCount === 1 ? "" : "s"}`,
      detail:
        channelReceiptCount > 0
          ? "Contractor email/SMS receipt evidence is attached."
          : "No contractor provider receipt evidence is attached.",
      tone: channelReceiptCount > 0 ? "success" : "neutral",
    },
    {
      label: "Vendor portal",
      statusLabel: vendorPortalIsVisible ? "Visible" : "Hidden",
      detail: vendorPortalIsVisible
        ? "This job is visible in the read-only vendor portal preview."
        : "This job is not shared to the vendor portal.",
      tone: vendorPortalIsVisible ? "success" : "neutral",
    },
  ];
  const links: MaintenanceReviewPacketLink[] = [
    linkedInvoiceHandoff
      ? { label: "Open Billing", href: linkedInvoiceHandoff.href }
      : null,
    { label: "Open Comms", href: "/comms" },
    correspondenceTenantId
      ? {
          label: "Open tenant",
          href: `/tenants/${encodeURIComponent(correspondenceTenantId)}`,
        }
      : null,
    vendorPortalPreviewHref
      ? { label: "Open vendor preview", href: vendorPortalPreviewHref }
      : null,
  ].filter((link): link is MaintenanceReviewPacketLink => Boolean(link));

  return {
    nextAction: nextAction.label,
    nextActionDetail: nextAction.detail,
    nextActionTone: nextAction.tone,
    evidenceRows,
    links,
  };
}
```

Add text and CSV helpers:

```ts
function maintenanceReviewPacketText({
  workOrder,
  packet,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  packet: MaintenanceReviewPacket;
}) {
  return [
    "Maintenance review packet",
    `Work order: ${workOrder.title}`,
    `Status: ${label(workOrder.status)} / ${label(workOrder.priority)}`,
    `Next action: ${packet.nextAction}`,
    packet.nextActionDetail,
    "",
    "Evidence:",
    ...packet.evidenceRows.map(
      (row) => `- ${row.label}: ${row.statusLabel} - ${row.detail}`,
    ),
    "",
    MAINTENANCE_REVIEW_PACKET_GUARDRAIL,
  ].join("\n");
}

function maintenanceReviewPacketCsv({
  workOrder,
  packet,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  packet: MaintenanceReviewPacket;
}) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Category", "Item", "Status", "Detail", "Guardrail"],
    [
      "Work order",
      workOrder.title,
      `${label(workOrder.status)} / ${label(workOrder.priority)}`,
      `Next action: ${packet.nextAction}. ${packet.nextActionDetail}`,
      MAINTENANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    ...packet.evidenceRows.map((row) => [
      "Evidence",
      row.label,
      row.statusLabel,
      row.detail,
      MAINTENANCE_REVIEW_PACKET_GUARDRAIL,
    ]),
    ...packet.links.map((link) => [
      "Handoff link",
      link.label,
      link.href,
      "Safe navigation only.",
      MAINTENANCE_REVIEW_PACKET_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "",
      "Review-only",
      MAINTENANCE_REVIEW_PACKET_GUARDRAIL,
      MAINTENANCE_REVIEW_PACKET_GUARDRAIL,
    ],
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
```

---

### Task 3: Render The Panel

**Files:**
- Modify: `apps/web/src/app/operations/maintenance/[workOrderId]/page.tsx`

- [x] **Step 1: Add the component**

Add:

```tsx
function MaintenanceReviewPacketPanel({
  workOrder,
  packet,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  packet: MaintenanceReviewPacket;
}) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const copyPacket = async () => {
    const copied = await copyTextToClipboard(
      maintenanceReviewPacketText({ workOrder, packet }),
    );
    setReceipt(
      copied
        ? "Maintenance review packet copied."
        : "Copy unavailable in this browser.",
    );
  };
  const downloadPacketCsv = () => {
    saveBlob(
      new Blob([maintenanceReviewPacketCsv({ workOrder, packet })], {
        type: "text/csv;charset=utf-8",
      }),
      `maintenance-review-packet-${workOrder.id}.csv`,
    );
    setReceipt("Maintenance review packet CSV downloaded.");
  };

  return (
    <SectionPanel
      title="Review packet"
      description="Read-only handoff summary for this maintenance job."
      icon={<ClipboardCheck size={17} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={packet.nextActionTone}>
            {packet.nextAction}
          </StatusBadge>
          <SecondaryButton type="button" onClick={copyPacket}>
            <ClipboardCheck size={15} />
            Copy packet
          </SecondaryButton>
          <SecondaryButton type="button" onClick={downloadPacketCsv}>
            <Download size={15} />
            Download packet CSV
          </SecondaryButton>
        </div>
      }
    >
      <div className="grid gap-3 p-4 text-sm">
        {receipt ? (
          <p className="font-medium text-success">{receipt}</p>
        ) : null}
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="font-semibold text-foreground">
            {packet.nextAction}
          </div>
          <div className="text-muted-foreground">
            {packet.nextActionDetail}
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {packet.evidenceRows.map((row) => (
            <div
              key={row.label}
              className="grid gap-1 rounded-md border border-border bg-white px-3 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  {row.label}
                </span>
                <StatusBadge tone={row.tone}>{row.statusLabel}</StatusBadge>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {row.detail}
              </p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {packet.links.map((link) => (
            <Link
              key={`${link.label}-${link.href}`}
              href={link.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs hover:bg-muted"
            >
              <ArrowUpRight size={14} />
              {link.label}
            </Link>
          ))}
        </div>
        <p className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
          {MAINTENANCE_REVIEW_PACKET_GUARDRAIL}
        </p>
      </div>
    </SectionPanel>
  );
}
```

- [x] **Step 2: Build the packet in `MaintenanceDetailRoute`**

After `linkedInvoiceRecoveryPath`, derive:

```ts
  const reviewPacketTenantId =
    correspondenceQuery.data?.events
      .map((event) => correspondenceMetadataString(event, "tenant_id"))
      .find((value): value is string => Boolean(value)) ??
    workOrder?.tenant_id ??
    null;
  const maintenanceReviewPacket =
    workOrder !== null
      ? buildMaintenanceReviewPacket({
          workOrder,
          quoteDocumentCount: quoteDocuments.length,
          linkedInvoiceDraft,
          linkedInvoiceHandoff,
          linkedInvoiceRecoveryReasons,
          correspondenceCount: correspondenceQuery.data?.events.length ?? 0,
          correspondenceTenantId: reviewPacketTenantId,
          completionReviewRows,
          channelReceiptCount: workOrder.channel_receipts.length,
          vendorPortalIsVisible,
          vendorPortalPreviewHref,
        })
      : null;
```

- [x] **Step 3: Render it near the top of the work-order page**

After `<LiveActionDock items={liveActionReviewItems} />`, add:

```tsx
            {maintenanceReviewPacket ? (
              <MaintenanceReviewPacketPanel
                workOrder={workOrder}
                packet={maintenanceReviewPacket}
              />
            ) : null}
```

- [x] **Step 4: Run the focused smoke and verify GREEN**

Run:

```bash
cd apps/web && ./node_modules/.bin/playwright test tests/smoke/app-flows.spec.ts -g "maintenance detail route shows quote evidence" --workers=1
```

Expected: pass.

---

### Task 4: Documentation And Verification

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Update product roadmap**

Under `Later Modules` → `Maintenance and arrears workflow depth`, add:

```md
  - [~] Maintenance review packet v1: work-order detail now has a read-only
    Review packet summarising next action, status/approval, quote evidence,
    invoice handoff, correspondence, completion review, contractor receipt
    evidence, vendor portal visibility, safe links, copy summary, and local CSV
    export. Copy/export uses already-loaded page data only and does not send
    email/SMS, mutate vendor portal state, prepare/approve invoices, upload
    documents, refresh providers, write Xero/Basiq data, reconcile payments, or
    mutate maintenance records.
```

- [x] **Step 2: Update design governance**

Under the 2026-05-30/31 prototype-mode section, add:

```md
- Maintenance review packet on work-order detail: a compact read-only summary
  for next action, evidence, correspondence, billing handoff, and portal
  visibility. It uses existing page data, copy/CSV export only, and no provider
  or record mutation.
```

- [x] **Step 3: Update handover**

At the top of `docs/next-chat-handover.md`, under the 2026-06-01 latest section,
add:

```md
### Maintenance review packet v1
- Work-order detail now has a read-only Review packet near the top of the page,
  deriving next action, evidence rows, safe links, copy summary, and CSV export
  from already-loaded work-order, document, invoice, correspondence, and vendor
  portal state.
- Guardrails: copy/download do not send email/SMS, mutate vendor portal state,
  prepare/approve invoices, upload documents, refresh providers, write
  Xero/Basiq data, reconcile payments, or mutate maintenance records.
- Verification: focused maintenance detail smoke passed; targeted frontend
  eslint, `tsc --noEmit`, and `git diff --check` passed.
```

- [x] **Step 4: Run focused verification**

Run:

```bash
cd apps/web && ./node_modules/.bin/eslint 'src/app/operations/maintenance/[workOrderId]/page.tsx' tests/smoke/app-flows.spec.ts
cd apps/web && ./node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: all pass.

- [x] **Step 5: Commit**

Use explicit pathspecs:

```bash
git add -- apps/web/src/app/operations/maintenance/[workOrderId]/page.tsx apps/web/tests/smoke/app-flows.spec.ts docs/product-roadmap.md docs/design-governance.md docs/next-chat-handover.md docs/superpowers/plans/2026-06-01-maintenance-review-packet.md
git commit -m "Add maintenance review packet"
```

---

## Self-Review

- Spec coverage: the plan covers the read-only packet, deterministic next-action cue, evidence checklist, safe links, copy/CSV export, no backend route, error tolerance via already-loaded data, smoke coverage, and docs.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: helper names and props use existing `MaintenanceWorkOrderRecord`, `InvoiceDraftRecord`, `StatusTone`, `CompletionReviewRow`, `invoiceBillingHandoff`, `correspondenceMetadataString`, `saveBlob`, and `copyTextToClipboard`.
