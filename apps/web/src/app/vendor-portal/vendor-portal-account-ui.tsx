"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardList,
  MessageSquarePlus,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { LeasiumMark } from "@/components/brand";
import {
  Button,
  EmptyState,
  SectionPanel,
  SecondaryButton,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import {
  acceptVendorPortalWorkOrder,
  commentVendorPortalWorkOrder,
  uploadVendorPortalWorkOrderPhoto,
  type VendorPortalRecord,
  type VendorPortalWorkOrderItemRecord,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

type AuthTokenGetter = () => Promise<string | null>;

export function formatVendorPortalDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatVendorPortalDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function VendorPortalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <LeasiumMark />
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-6">Leasium</p>
            <p className="text-sm text-muted-foreground">Vendor portal</p>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

export function VendorPortalLoading({ title = "Vendor portal" }: { title?: string }) {
  return (
    <VendorPortalShell>
      <div className="mx-auto max-w-5xl px-5 py-8">
        <SectionPanel title={title}>
          <SkeletonRows rows={5} />
        </SectionPanel>
      </div>
    </VendorPortalShell>
  );
}

export function VendorPortalNotice({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "danger"
      ? "border-danger/30 bg-danger/5"
      : tone === "warning"
        ? "border-warning/30 bg-warning/5"
        : "border-border bg-white";
  return (
    <VendorPortalShell>
      <div className="mx-auto grid max-w-2xl gap-4 px-5 py-10">
        <section className={`rounded-md border p-6 shadow-leasiumCard ${toneClass}`}>
          <h1 className="text-2xl font-semibold leading-8">{title}</h1>
          <div className="mt-4 grid gap-3 text-sm leading-6 text-slate">{children}</div>
        </section>
      </div>
    </VendorPortalShell>
  );
}

function WorkOrderActionCard({
  item,
  getAuthToken,
  requiresAuthToken,
  onResult,
}: {
  item: VendorPortalWorkOrderItemRecord;
  getAuthToken: AuthTokenGetter;
  requiresAuthToken: boolean;
  onResult: (portal: VendorPortalRecord) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  async function run(
    action: (token: string | null) => Promise<VendorPortalRecord>,
  ) {
    setPending(true);
    setError(null);
    try {
      let token: string | null = null;
      if (requiresAuthToken) {
        token = await getAuthToken();
        if (!token) {
          throw new Error("Sign in again to continue.");
        }
      }
      onResult(await action(token));
      return true;
    } catch (caught) {
      setError(friendlyError(caught));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function onPostComment() {
    const body = comment.trim();
    if (!body) {
      return;
    }
    const ok = await run((token) =>
      commentVendorPortalWorkOrder(item.id, body, token),
    );
    if (ok) {
      setComment("");
    }
  }

  function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    void run((token) => uploadVendorPortalWorkOrderPhoto(item.id, file, token));
  }

  return (
    <article className="grid gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6">{item.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{item.property_name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={item.priority === "urgent" ? "warning" : "neutral"}>
            {item.priority}
          </StatusBadge>
          <StatusBadge tone="primary">{titleCase(item.status)}</StatusBadge>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Due
          </dt>
          <dd className="mt-1">{formatVendorPortalDate(item.due_date)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Requested
          </dt>
          <dd className="mt-1">{formatVendorPortalDateTime(item.requested_at)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Photos
          </dt>
          <dd className="mt-1">{item.photo_count}</dd>
        </div>
      </dl>

      {item.comments.length > 0 ? (
        <div className="grid gap-2 rounded-lg border border-border bg-white p-3">
          {item.comments.map((entry) => (
            <div
              key={`${entry.timestamp ?? "comment"}-${entry.body}`}
              className={`grid gap-0.5 rounded-md border p-2.5 ${
                entry.author === "contractor"
                  ? "border-primary/20 bg-primary/5"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {entry.author === "contractor"
                    ? "You"
                    : (entry.author_label ?? "Property team")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatVendorPortalDateTime(entry.timestamp)}
                </span>
              </div>
              <p className="text-sm leading-6 text-slate">{entry.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {item.status !== "in_progress" ? (
            <Button type="button" disabled={pending} onClick={() => void run((token) => acceptVendorPortalWorkOrder(item.id, token))}>
              <CheckCircle2 size={16} />
              Accept job
            </Button>
          ) : (
            <StatusBadge tone="success">
              <CheckCircle2 size={13} />
              Accepted — in progress
            </StatusBadge>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted">
            <Camera size={16} />
            Add photo
            <input
              accept="image/*"
              className="sr-only"
              disabled={pending}
              onChange={onPhotoChange}
              type="file"
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Post an update
            </span>
            <textarea
              className="min-h-[44px] rounded-lg border border-border bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
              disabled={pending}
              onChange={(event) => setComment(event.target.value)}
              placeholder="e.g. On my way, ETA 30 minutes."
              rows={2}
              value={comment}
            />
          </label>
          <SecondaryButton
            type="button"
            disabled={pending || comment.trim().length === 0}
            onClick={() => void onPostComment()}
          >
            <MessageSquarePlus size={16} />
            Post update
          </SecondaryButton>
        </div>
        <p className="text-xs text-muted-foreground">
          Messages stay in this portal — no email or SMS is sent.
        </p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </article>
  );
}

export function VendorPortalAccountView({
  portal,
  getAuthToken,
  requiresAuthToken,
}: {
  portal: VendorPortalRecord;
  getAuthToken: AuthTokenGetter;
  requiresAuthToken: boolean;
}) {
  const [data, setData] = useState<VendorPortalRecord>(portal);
  useEffect(() => {
    setData(portal);
  }, [portal]);

  const vendor = data.vendor;
  const workOrders = data.work_orders.items;

  return (
    <VendorPortalShell>
      <div className="mx-auto grid max-w-5xl gap-5 px-5 py-6">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-9">Your jobs</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {vendor.company_name ?? vendor.name}
            </p>
          </div>
          <StatusBadge tone="success">Signed in</StatusBadge>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Open jobs
            </p>
            <p className="mt-2 text-2xl font-semibold leading-8">
              {data.work_orders.open_count}
            </p>
          </div>
          <div className="rounded-lg border border-warning/25 bg-warning/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Urgent
            </p>
            <p className="mt-2 text-2xl font-semibold leading-8">
              {data.work_orders.urgent_count}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Overdue
            </p>
            <p className="mt-2 text-2xl font-semibold leading-8">
              {data.work_orders.overdue_count}
            </p>
          </div>
        </section>

        <SectionPanel title="Jobs shared with you" icon={<ClipboardList size={17} />}>
          {workOrders.length === 0 ? (
            <EmptyState
              title="No jobs right now."
              description="When the property team shares a job with you it will appear here."
              icon={<Wrench size={18} />}
            />
          ) : (
            <div>
              {workOrders.map((item) => (
                <WorkOrderActionCard
                  getAuthToken={getAuthToken}
                  item={item}
                  key={item.id}
                  onResult={setData}
                  requiresAuthToken={requiresAuthToken}
                />
              ))}
            </div>
          )}
        </SectionPanel>

        <SectionPanel title="What stays private" icon={<ShieldCheck size={17} />}>
          <div className="grid gap-3 p-4">
            {data.guardrails.map((guardrail) => (
              <div
                key={guardrail}
                className="flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-6 text-slate"
              >
                <CheckCircle2 className="mt-0.5 shrink-0 text-primary" size={17} />
                <p>{guardrail}</p>
              </div>
            ))}
          </div>
        </SectionPanel>

        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle size={14} />
          Updated {formatVendorPortalDateTime(data.generated_at)}
        </p>
      </div>
    </VendorPortalShell>
  );
}
