"use client";

import {
  Building2,
  CalendarClock,
  DoorOpen,
  FileText,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  Field,
  Input,
  SecondaryButton,
  Select,
  StatusBadge,
} from "@/components/ui";
import { cn, friendlyError } from "@/lib/utils";
import {
  applyDocumentIntake,
  askLeasium,
  createConversationThread,
  listProperties,
  listTenants,
  type AskCitationRecord,
  type ConversationThreadRecord,
  type DocumentIntakeExtraction,
  type DocumentIntakeRecord,
  type PropertyRecord,
  type TenantRecord,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Small token-driven primitives (Horizon look: soft borders, 16–20px radii).
// Teal = accent (✦ / source-backed / guardrail). Blue = primary (plan border,
// one CTA). Info-soft = the user bubble fill.
// ---------------------------------------------------------------------------

function AiTurn({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-base font-semibold text-leasium-teal-strong"
      >
        ✦
      </span>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
    </div>
  );
}

function UserTurn({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-info-soft px-4 py-3 text-sm leading-5 text-foreground">
        {children}
      </div>
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-foreground">{children}</p>;
}

type ConfidenceLevel = "high" | "med" | "low";

function confidenceLevel(value: number | null | undefined): ConfidenceLevel {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.8) return "high";
    if (value >= 0.5) return "med";
    return "low";
  }
  return "med";
}

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const tone = level === "high" ? "success" : level === "med" ? "warning" : "danger";
  const label = level === "high" ? "HIGH" : level === "med" ? "MED" : "LOW";
  return (
    <StatusBadge tone={tone} className="text-leasium-micro">
      {label}
    </StatusBadge>
  );
}

// ---------------------------------------------------------------------------
// Extraction → display helpers (self-contained, mirror dashboard semantics).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function items(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function itemConfidence(item: Record<string, unknown>): number | null {
  return num(item.confidence);
}

function reviewExtraction(intake: DocumentIntakeRecord): DocumentIntakeExtraction {
  // Mirror dashboard's intakeReviewData: prefer reviewed edits when present,
  // otherwise the raw extraction. This is the exact shape sent to apply.
  const keys = [
    "document_type",
    "summary",
    "confidence",
    "parties",
    "properties",
    "key_dates",
    "money_amounts",
    "obligations",
    "inspection_findings",
    "suggested_links",
    "warnings",
    "missing_information",
  ];
  const reviewed = keys.some((key) => key in intake.review_data);
  return reviewed
    ? (intake.review_data as DocumentIntakeExtraction)
    : intake.extracted_data;
}

// Match extracted records against what already exists so the plan links
// instead of duplicating. Mirrors the backend find-or-create keys
// (property name/address, tenant abn/legal_name) but resolves the id up
// front so the operator sees "LINK EXISTING" before approving.
type RecordMatch = { id: string; label: string };
function norm(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function matchProperty(
  data: DocumentIntakeExtraction,
  properties: PropertyRecord[],
): RecordMatch | null {
  const property = items(data.properties)[0];
  if (!property) return null;
  // Match on the property NAME only. Buildings on a shared street (e.g. B3 and
  // B6 at "205 Leitchs Road") have identical street addresses, so any
  // address-substring match would wrongly merge a new building into an
  // existing one. Default to NEW unless the names are an exact normalised
  // match; the operator can link explicitly when a re-import truly is the same
  // property.
  const exName = norm(property.name);
  if (exName === "") return null;
  for (const p of properties) {
    if (norm(p.name) === exName) {
      return { id: p.id, label: p.name };
    }
  }
  return null;
}
function matchTenant(
  data: DocumentIntakeExtraction,
  tenants: TenantRecord[],
): RecordMatch | null {
  const tenant = items(data.parties).find((p) => {
    const role = text(p.role)?.toLowerCase() ?? "";
    return role.includes("tenant") || role.includes("lessee");
  });
  if (!tenant) return null;
  const exAbn = norm(tenant.abn);
  const exName = norm(text(tenant.name) ?? text(tenant.legal_name));
  for (const rec of tenants) {
    if (exAbn !== "" && rec.abn && norm(rec.abn) === exAbn) {
      return { id: rec.id, label: rec.legal_name };
    }
    if (exName !== "" && norm(rec.legal_name) === exName) {
      return { id: rec.id, label: rec.legal_name };
    }
  }
  return null;
}

type UnderstandingRow = {
  label: string;
  value: string;
  level: ConfidenceLevel;
};

function moneyLabel(item: Record<string, unknown>): string {
  const amount = num(item.amount);
  const currency = text(item.currency) ?? "";
  const frequency = text(item.frequency);
  const formatted = amount !== null ? `${currency}${amount.toLocaleString()}` : "";
  return [formatted, frequency].filter(Boolean).join(" / ");
}

function buildUnderstanding(
  data: DocumentIntakeExtraction,
  fallbackConfidence: number | null,
): UnderstandingRow[] {
  const rows: UnderstandingRow[] = [];
  const level = (c: number | null) =>
    confidenceLevel(c ?? fallbackConfidence);

  const tenant = items(data.parties).find((p) => {
    const role = text(p.role)?.toLowerCase() ?? "";
    return role.includes("tenant") || role.includes("lessee");
  });
  if (tenant) {
    const name = text(tenant.name) ?? text(tenant.contact) ?? "Unnamed tenant";
    rows.push({ label: "Tenant", value: name, level: level(itemConfidence(tenant)) });
  }

  const property = items(data.properties)[0];
  if (property) {
    const name =
      text(property.name) ?? text(property.address) ?? "Unnamed property";
    rows.push({ label: "Property", value: name, level: level(itemConfidence(property)) });
    const unit = text(property.unit_label);
    if (unit) {
      rows.push({ label: "Unit", value: unit, level: level(itemConfidence(property)) });
    }
  }

  const start = items(data.key_dates).find((d) => {
    const label = text(d.label)?.toLowerCase() ?? "";
    return label.includes("start") || label.includes("commence");
  });
  const expiry = items(data.key_dates).find((d) => {
    const label = text(d.label)?.toLowerCase() ?? "";
    return label.includes("expiry") || label.includes("expir") || label.includes("end");
  });
  if (start || expiry) {
    const startDate = start ? text(start.date) : null;
    const endDate = expiry ? text(expiry.date) : null;
    const value = [startDate, endDate].filter(Boolean).join(" → ");
    rows.push({
      label: "Term",
      value: value || "See dates",
      level: level(itemConfidence(start ?? expiry ?? {})),
    });
  }

  const rent = items(data.money_amounts).find((m) => {
    const label = text(m.label)?.toLowerCase() ?? "";
    return label.includes("rent");
  });
  if (rent) {
    rows.push({ label: "Rent", value: moneyLabel(rent), level: level(itemConfidence(rent)) });
  }

  // Other notable money + dates not already surfaced above.
  items(data.money_amounts).forEach((m) => {
    if (m === rent) return;
    const label = text(m.label) ?? "Amount";
    rows.push({ label, value: moneyLabel(m), level: level(itemConfidence(m)) });
  });
  items(data.key_dates).forEach((d) => {
    if (d === start || d === expiry) return;
    const label = text(d.label) ?? "Date";
    const value = text(d.date) ?? "—";
    rows.push({ label, value, level: level(itemConfidence(d)) });
  });

  return rows;
}

// The lease term the panel already parses for the understanding card, handed to
// apply as an explicit lease block so the backend doesn't have to re-derive the
// dates from an unusual key-date label (and block on "Confirm the lease expiry").
function leaseDatesFrom(data: DocumentIntakeExtraction): {
  commencement_date?: string;
  expiry_date?: string;
} {
  const dates = items(data.key_dates);
  const findDate = (match: (label: string) => boolean) => {
    const row = dates.find((d) => match(text(d.label)?.toLowerCase() ?? ""));
    return row ? text(row.date) : null;
  };
  const out: { commencement_date?: string; expiry_date?: string } = {};
  const start = findDate((l) => l.includes("start") || l.includes("commence"));
  const expiry = findDate(
    (l) => l.includes("expiry") || l.includes("expir") || l.includes("end"),
  );
  if (start) out.commencement_date = start;
  if (expiry) out.expiry_date = expiry;
  return out;
}

// Inline "edit before creating" — confirm/correct the values the operator
// cares about (the lease term, rent, names) before anything is created.
type EditState = {
  propertyName: string;
  propertyAddress: string;
  unitLabel: string;
  tenantName: string;
  commencement: string;
  expiry: string;
  rentAmount: string;
  rentFrequency: string;
};
const RENT_MULTIPLIER: Record<string, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};
function normaliseFrequency(value: string | null): string {
  const v = (value ?? "").toLowerCase();
  if (v.includes("week")) return "weekly";
  if (v.includes("quart")) return "quarterly";
  if (v.includes("year") || v.includes("annu") || v.includes("p.a") || v.includes("pa"))
    return "annual";
  return "monthly";
}
function tenantParty(data: DocumentIntakeExtraction): Record<string, unknown> | null {
  return (
    items(data.parties).find((p) => {
      const role = text(p.role)?.toLowerCase() ?? "";
      return role.includes("tenant") || role.includes("lessee");
    }) ?? null
  );
}
function initialEdits(data: DocumentIntakeExtraction): EditState {
  const prop = items(data.properties)[0] ?? {};
  const tenant = tenantParty(data) ?? {};
  const dates = leaseDatesFrom(data);
  const rent =
    items(data.money_amounts).find((m) =>
      (text(m.label)?.toLowerCase() ?? "").includes("rent"),
    ) ?? {};
  const rentAmount = num(rent.amount);
  return {
    propertyName: text(prop.name) ?? "",
    propertyAddress: text(prop.address) ?? text(prop.street_address) ?? "",
    unitLabel: text(prop.unit_label) ?? "",
    tenantName: text(tenant.name) ?? text(tenant.legal_name) ?? "",
    commencement: dates.commencement_date ?? "",
    expiry: dates.expiry_date ?? "",
    rentAmount: rentAmount != null ? String(rentAmount) : "",
    rentFrequency: normaliseFrequency(text(rent.frequency)),
  };
}
function buildEditedReviewData(
  data: DocumentIntakeExtraction,
  edits: EditState,
  propertyLinked: boolean,
  tenantLinked: boolean,
): DocumentIntakeExtraction {
  const rd: DocumentIntakeExtraction = { ...data };
  const props = items(data.properties);
  const firstProp: Record<string, unknown> = { ...(props[0] ?? {}) };
  if (!propertyLinked) {
    if (edits.propertyName) firstProp.name = edits.propertyName;
    if (edits.propertyAddress) firstProp.street_address = edits.propertyAddress;
  }
  if (edits.unitLabel) firstProp.unit_label = edits.unitLabel;
  rd.properties = [firstProp, ...props.slice(1)];
  if (!tenantLinked && edits.tenantName) {
    const parties = items(data.parties);
    const idx = parties.findIndex((p) => {
      const role = text(p.role)?.toLowerCase() ?? "";
      return role.includes("tenant") || role.includes("lessee");
    });
    rd.parties =
      idx >= 0
        ? parties.map((p, i) =>
            i === idx ? { ...p, name: edits.tenantName } : p,
          )
        : [...parties, { name: edits.tenantName, role: "tenant" }];
  }
  const lease: Record<string, unknown> = {
    ...(isRecord(data.lease) ? data.lease : {}),
  };
  if (edits.commencement) lease.commencement_date = edits.commencement;
  if (edits.expiry) lease.expiry_date = edits.expiry;
  const amount = Number.parseFloat(edits.rentAmount);
  if (Number.isFinite(amount)) {
    const mult = RENT_MULTIPLIER[edits.rentFrequency] ?? 12;
    lease.annual_rent_cents = Math.round(amount * mult * 100);
  }
  if (edits.rentFrequency) lease.rent_frequency = edits.rentFrequency;
  rd.lease = lease;
  return rd;
}

// Plan rows: one per record the apply will create / link.
type PlanRow = {
  key: string;
  icon: ReactNode;
  title: string;
  value: string;
  link: boolean; // LINK EXISTING vs NEW
};

function buildPlan(
  data: DocumentIntakeExtraction,
  propertyMatch: RecordMatch | null,
  tenantMatch: RecordMatch | null,
): PlanRow[] {
  const rows: PlanRow[] = [];

  const property = items(data.properties)[0];
  if (property) {
    rows.push({
      key: "property",
      icon: <Building2 size={16} />,
      title: "Property",
      value:
        propertyMatch?.label ??
        text(property.name) ??
        text(property.address) ??
        "New property",
      link: Boolean(propertyMatch),
    });
    const unit = text(property.unit_label);
    rows.push({
      key: "unit",
      icon: <DoorOpen size={16} />,
      title: "Unit(s)",
      value: unit ?? "Whole-of-property unit",
      link: false,
    });
  }

  const tenant = items(data.parties).find((p) => {
    const role = text(p.role)?.toLowerCase() ?? "";
    return role.includes("tenant") || role.includes("lessee");
  });
  if (tenant) {
    rows.push({
      key: "tenant",
      icon: <UserRound size={16} />,
      title: "Tenant",
      value: tenantMatch?.label ?? text(tenant.name) ?? "New tenant",
      link: Boolean(tenantMatch),
    });
  }

  const docType = text(data.document_type);
  if (docType === "lease" || items(data.key_dates).length > 0) {
    rows.push({
      key: "lease",
      icon: <FileText size={16} />,
      title: "Lease",
      value:
        text((items(data.key_dates)[0] ?? {}).date) != null
          ? "Lease from the dates above"
          : "New lease",
      link: false,
    });
  }

  const obligation = items(data.obligations)[0] ?? items(data.key_dates)[0];
  if (obligation) {
    const title = text(obligation.title) ?? text(obligation.label) ?? "Critical date";
    rows.push({
      key: "critical_date",
      icon: <CalendarClock size={16} />,
      title: "Critical date(s)",
      value: title,
      link: false,
    });
  }

  return rows;
}

// Created turn: read the apply response review_data.applied summary.
type CreatedRow = { label: string; href?: string };
type NextStepRow = { label: string; href: string };

function propertyHref(entityId: string, propertyId: string | null) {
  if (!propertyId) return "/properties";
  const params = new URLSearchParams({
    entity_id: entityId,
    property_id: propertyId,
  });
  return `/properties?${params.toString()}`;
}

function tenantHref(tenantId: string | null) {
  return tenantId ? `/tenants/${encodeURIComponent(tenantId)}` : "/tenants";
}

function nextStepRows(
  applied: Record<string, unknown>,
  entityId: string,
): NextStepRow[] {
  const tenantId = text(applied.tenant_id);
  const xeroParams = new URLSearchParams([
    ["tab", "xero"],
    ["entity_id", entityId],
  ]);
  const billingParams = new URLSearchParams([
    ["entity_id", entityId],
    ["tab", "readiness"],
  ]);
  const commsParams = new URLSearchParams([["entity_id", entityId]]);
  if (tenantId) {
    commsParams.set("target_kind", "tenant");
    commsParams.set("target_id", tenantId);
  }

  return [
    {
      label: "Sync tenant to Xero",
      href: `/settings?${xeroParams.toString()}`,
    },
    {
      label: "Set up monthly rent invoicing",
      href: `/billing-readiness?${billingParams.toString()}`,
    },
    {
      label: "Email the tenant",
      href: `/comms?${commsParams.toString()}`,
    },
  ];
}

function buildCreated(
  applied: Record<string, unknown>,
  entityId: string,
): CreatedRow[] {
  const rows: CreatedRow[] = [];
  const propertyId = text(applied.property_id);
  const propertyLink = propertyHref(entityId, propertyId);
  if (text(applied.property_name) || propertyId) {
    rows.push({
      label: `Property — ${text(applied.property_name) ?? "created"}`,
      href: propertyLink,
    });
  }
  const leaseCount = num(applied.created_lease_count);
  if (leaseCount) {
    rows.push({ label: `${leaseCount} lease`, href: propertyLink });
  }
  const tenantName = text(applied.tenant_name);
  const tenantId = text(applied.tenant_id);
  if (tenantName || tenantId) {
    rows.push({
      label: `Tenant — ${tenantName ?? "created"}`,
      href: tenantHref(tenantId),
    });
  }
  const obligationCount =
    num(applied.obligation_count) ?? (text(applied.obligation_id) ? 1 : null);
  if (obligationCount) {
    rows.push({ label: `${obligationCount} critical date` });
  }
  const workOrderCount = num(applied.work_order_count);
  if (workOrderCount) {
    rows.push({ label: `${workOrderCount} work order draft` });
  }
  if (rows.length === 0) {
    rows.push({ label: "Records created and linked in Leasium." });
  }
  return rows;
}

const GUARDRAIL_PRE =
  "This creates records in Leasium only. I won't sync to Xero, email the tenant, or set up billing unless you ask — that's always a separate yes.";
const GUARDRAIL_POST =
  "I haven't contacted Xero, the tenant, or set up any charges. Nothing sends until you pick one and approve it.";

function GuardrailNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs leading-5 text-leasium-teal-strong">
      <ShieldCheck size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

type AskTurn = {
  question: string;
  answer: string | null;
  citations: AskCitationRecord[];
  error: string | null;
};

export function IntakeConversationPanel({
  entityId,
  intake,
  onApplied,
}: {
  entityId: string;
  intake: DocumentIntakeRecord;
  onApplied?: (rec: DocumentIntakeRecord) => void;
}) {
  const data = useMemo(() => reviewExtraction(intake), [intake]);
  const propertiesQuery = useQuery({
    queryKey: ["intake-match-properties", entityId],
    queryFn: () => listProperties(entityId),
    enabled: Boolean(entityId),
    staleTime: 60_000,
  });
  const tenantsQuery = useQuery({
    queryKey: ["intake-match-tenants", entityId],
    queryFn: () => listTenants(entityId),
    enabled: Boolean(entityId),
    staleTime: 60_000,
  });
  const propertyMatch = useMemo(
    () => matchProperty(data, propertiesQuery.data ?? []),
    [data, propertiesQuery.data],
  );
  const tenantMatch = useMemo(
    () => matchTenant(data, tenantsQuery.data ?? []),
    [data, tenantsQuery.data],
  );
  const understanding = useMemo(
    () => buildUnderstanding(data, intake.confidence),
    [data, intake.confidence],
  );
  const plan = useMemo(
    () => buildPlan(data, propertyMatch, tenantMatch),
    [data, propertyMatch, tenantMatch],
  );
  const summary =
    text(intake.summary) ?? text(data.summary) ?? "I read this document.";
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedRecord, setAppliedRecord] = useState<DocumentIntakeRecord | null>(
    intake.status === "applied" ? intake : null,
  );

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [asks, setAsks] = useState<AskTurn[]>([]);
  const [thread, setThread] = useState<ConversationThreadRecord | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const threadRequestRef = useRef<Promise<ConversationThreadRecord> | null>(null);
  const threadSeed = useMemo(
    () => ({
      entity_id: entityId,
      source: "intake",
      context_route: "/intake",
      context_record_refs: { document_intake_id: intake.id },
      title: intake.filename || intake.summary || "Leasium AI review",
    }),
    [entityId, intake.filename, intake.id, intake.summary],
  );

  async function ensureThread() {
    if (thread) return thread;
    if (!threadRequestRef.current) {
      threadRequestRef.current = createConversationThread(threadSeed);
    }
    const request = threadRequestRef.current;
    try {
      const created = await request;
      setThread(created);
      setThreadError(null);
      return created;
    } catch (error) {
      setThreadError(friendlyError(error));
      return null;
    } finally {
      if (threadRequestRef.current === request) {
        threadRequestRef.current = null;
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setThreadError(null);
    const request = createConversationThread(threadSeed);
    threadRequestRef.current = request;
    request
      .then((created) => {
        if (!cancelled) setThread(created);
      })
      .catch((error) => {
        if (!cancelled) setThreadError(friendlyError(error));
      })
      .finally(() => {
        if (threadRequestRef.current === request) {
          threadRequestRef.current = null;
        }
      });
    return () => {
      cancelled = true;
      if (threadRequestRef.current === request) {
        threadRequestRef.current = null;
      }
    };
  }, [threadSeed]);

  const defaultEdits = useMemo(() => initialEdits(data), [data]);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<EditState>(defaultEdits);
  useEffect(() => {
    setEdits(defaultEdits);
    setEditing(false);
  }, [defaultEdits]);
  const setEdit = (key: keyof EditState, value: string) =>
    setEdits((current) => ({ ...current, [key]: value }));

  async function handleCreateAll() {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    const links = isRecord(data.suggested_links) ? data.suggested_links : {};
    // Always apply the current edits. `edits` is seeded from the extraction, so
    // this is equivalent to the raw extraction when nothing was changed, but it
    // means corrections persist whether or not the edit form is open — closing
    // it with "Done" no longer silently discards them.
    const reviewData = buildEditedReviewData(
      data,
      edits,
      Boolean(propertyMatch),
      Boolean(tenantMatch),
    );
    try {
      const currentThread = await ensureThread();
      if (!currentThread) {
        throw new Error("Couldn't start the conversation thread.");
      }
      // reviewData = the reviewed extraction plus the parsed lease term, so the
      // backend has a confirmed expiry. Link ids are passed through when the
      // property/tenant already exists.
      const result = await applyDocumentIntake(intake.id, {
        reviewData,
        propertyId: propertyMatch?.id ?? text(links.property_id),
        tenancyUnitId: text(links.tenancy_unit_id),
        tenantId: tenantMatch?.id ?? text(links.tenant_id),
        leaseId: text(links.lease_id),
        threadId: currentThread.id,
      });
      setAppliedRecord(result);
      onApplied?.(result);
    } catch (error) {
      setApplyError(friendlyError(error));
    } finally {
      setApplying(false);
    }
  }

  async function handleAsk() {
    const trimmed = question.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setQuestion("");
    const index = asks.length;
    setAsks((current) => [
      ...current,
      { question: trimmed, answer: null, citations: [], error: null },
    ]);
    try {
      const currentThread = await ensureThread();
      if (!currentThread) {
        throw new Error("Couldn't start the conversation thread.");
      }
      const result = await askLeasium({
        entity_id: entityId,
        question: trimmed,
        thread_id: currentThread.id,
      });
      setAsks((current) =>
        current.map((turn, i) =>
          i === index
            ? { ...turn, answer: result.answer, citations: result.citations }
            : turn,
        ),
      );
    } catch (error) {
      const message = friendlyError(error);
      setAsks((current) =>
        current.map((turn, i) =>
          i === index ? { ...turn, error: message } : turn,
        ),
      );
    } finally {
      setAsking(false);
    }
  }

  const applied = appliedRecord
    ? (isRecord(appliedRecord.review_data?.applied)
        ? (appliedRecord.review_data.applied as Record<string, unknown>)
        : {})
    : null;

  return (
    <div
      data-testid="intake-conversation"
      className="mx-auto w-full max-w-[760px] space-y-5"
    >
      {/* 1. User turn — the dropped document. */}
      <UserTurn>
        <div className="mb-1 inline-flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1 text-xs font-medium text-foreground">
          <FileText size={13} />
          {intake.filename}
        </div>
        <div>Added this document.</div>
      </UserTurn>

      {/* 2. AI turn — plain-English read + understanding card. */}
      <AiTurn>
        <Prose>{summary}</Prose>
        {understanding.length > 0 ? (
          <div
            data-testid="intake-understanding"
            className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs"
          >
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                What I understood
              </h3>
              <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-leasium-micro font-semibold text-leasium-teal-strong">
                SOURCE-BACKED
              </span>
            </div>
            <dl className="space-y-2">
              {understanding.map((row, i) => (
                <div key={`${row.label}-${i}`} className="flex items-start gap-3 text-sm">
                  <dt className="w-[120px] shrink-0 text-muted-foreground">
                    {row.label}
                  </dt>
                  <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{row.value}</span>
                    <ConfidenceBadge level={row.level} />
                    <button
                      type="button"
                      className="text-leasium-micro font-medium text-primary hover:underline"
                    >
                      source
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            {warnings.map((warning, i) => (
              <div
                key={`warning-${i}`}
                className="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-strong"
              >
                <span aria-hidden>⚑</span>
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}
      </AiTurn>

      {/* 3. AI turn — bundled plan card (or already-created state). */}
      {!appliedRecord ? (
        <AiTurn>
          <div
            data-testid="intake-plan"
            className="rounded-2xl border-[1.5px] border-primary bg-white p-4 shadow-leasiumXs"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Proposed plan — review before anything is created
              </h3>
              <button
                type="button"
                onClick={() => setEditing((value) => !value)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {editing ? "Done" : "Adjust"}
              </button>
            </div>
            {editing ? (
              <div data-testid="intake-edit-form" className="space-y-3">
                <div className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                      <Building2 size={16} />
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      Property &amp; units
                    </span>
                    {propertyMatch ? (
                      <StatusBadge tone="neutral" className="text-leasium-micro">
                        LINK EXISTING
                      </StatusBadge>
                    ) : null}
                  </div>
                  {propertyMatch ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                      Linking to your existing property{" "}
                      <span className="font-medium text-foreground">
                        {propertyMatch.label}
                      </span>
                      .
                    </p>
                  ) : (
                    <div className="mb-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Property name">
                        <Input
                          value={edits.propertyName}
                          onChange={(e) => setEdit("propertyName", e.target.value)}
                        />
                      </Field>
                      <Field label="Address">
                        <Input
                          value={edits.propertyAddress}
                          onChange={(e) =>
                            setEdit("propertyAddress", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                  )}
                  <Field label="Unit(s)">
                    <Input
                      value={edits.unitLabel}
                      onChange={(e) => setEdit("unitLabel", e.target.value)}
                      placeholder="e.g. Unit 1 & Unit 3"
                    />
                  </Field>
                </div>

                <div className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                      <UserRound size={16} />
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      Tenant
                    </span>
                    {tenantMatch ? (
                      <StatusBadge tone="neutral" className="text-leasium-micro">
                        LINK EXISTING
                      </StatusBadge>
                    ) : null}
                  </div>
                  {tenantMatch ? (
                    <p className="text-xs text-muted-foreground">
                      Linking to your existing tenant{" "}
                      <span className="font-medium text-foreground">
                        {tenantMatch.label}
                      </span>
                      .
                    </p>
                  ) : (
                    <Field label="Legal name">
                      <Input
                        value={edits.tenantName}
                        onChange={(e) => setEdit("tenantName", e.target.value)}
                      />
                    </Field>
                  )}
                </div>

                <div className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                      <FileText size={16} />
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      Lease term &amp; rent
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Start date">
                      <Input
                        type="date"
                        value={edits.commencement}
                        onChange={(e) => setEdit("commencement", e.target.value)}
                      />
                    </Field>
                    <Field label="Expiry date">
                      <Input
                        data-testid="intake-edit-expiry"
                        type="date"
                        value={edits.expiry}
                        onChange={(e) => setEdit("expiry", e.target.value)}
                      />
                    </Field>
                    <Field label="Rent amount (AUD)">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={edits.rentAmount}
                        onChange={(e) => setEdit("rentAmount", e.target.value)}
                      />
                    </Field>
                    <Field label="Frequency">
                      <Select
                        value={edits.rentFrequency}
                        onChange={(e) => setEdit("rentFrequency", e.target.value)}
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              </div>
            ) : plan.length > 0 ? (
              <ul className="space-y-2">
                {plan.map((row) => (
                  <li
                    key={row.key}
                    className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                      {row.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">
                        {row.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.value}
                      </span>
                    </span>
                    <StatusBadge
                      tone={row.link ? "neutral" : "primary"}
                      className="text-leasium-micro"
                    >
                      {row.link ? "LINK EXISTING" : "NEW"}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                I&apos;ll record this document against your portfolio on approval.
              </p>
            )}
            <div className="mt-3">
              <GuardrailNote>{GUARDRAIL_PRE}</GuardrailNote>
            </div>
            {applyError ? (
              <p className="mt-3 text-sm text-danger">{applyError}</p>
            ) : null}
            {threadError ? (
              <p className="mt-3 text-sm text-muted-foreground">{threadError}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                data-testid="intake-create-all"
                onClick={handleCreateAll}
                disabled={applying}
              >
                {applying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create all records"
                )}
              </Button>
              {editing ? (
                <SecondaryButton
                  type="button"
                  disabled={applying}
                  onClick={() => {
                    setEdits(defaultEdits);
                    setEditing(false);
                  }}
                >
                  Cancel
                </SecondaryButton>
              ) : (
                <SecondaryButton
                  type="button"
                  data-testid="intake-edit"
                  disabled={applying}
                  onClick={() => setEditing(true)}
                >
                  Edit before creating
                </SecondaryButton>
              )}
              {!editing ? (
                <button
                  type="button"
                  disabled={applying}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Ignore
                </button>
              ) : null}
            </div>
          </div>
        </AiTurn>
      ) : null}

      {/* 4. Created turn — after a successful apply. */}
      {appliedRecord && applied ? (
        <AiTurn>
          <div
            data-testid="intake-created"
            className="rounded-2xl border-[1.5px] border-success bg-white p-4 shadow-leasiumXs"
          >
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              Done — created in Leasium and linked together
            </h3>
            <ul className="space-y-2">
              {buildCreated(applied, entityId).map((row, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-foreground">{row.label}</span>
                  {row.href ? (
                    <Link
                      href={row.href}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      View →
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div
            data-testid="intake-next-steps"
            className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs"
          >
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              Suggested next steps
            </h3>
            <ul className="space-y-2">
              {nextStepRows(applied, entityId).map((step) => (
                <li
                  key={step.label}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium text-foreground">{step.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-leasium-micro font-semibold text-warning-strong">
                      NEEDS APPROVAL
                    </span>
                    <Link
                      href={step.href}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Review
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <GuardrailNote>{GUARDRAIL_POST}</GuardrailNote>
            </div>
          </div>
        </AiTurn>
      ) : null}

      {/* 5. Ask turns + reply composer. */}
      {asks.map((turn, i) => (
        <div key={i} className="space-y-3">
          <UserTurn>{turn.question}</UserTurn>
          <AiTurn>
            {turn.error ? (
              <Prose>
                <span className="text-danger">{turn.error}</span>
              </Prose>
            ) : turn.answer === null ? (
              <Prose>
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Thinking…
                </span>
              </Prose>
            ) : (
              <>
                <Prose>{turn.answer}</Prose>
                {turn.citations.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {turn.citations.map((citation, ci) => (
                      <span
                        key={ci}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-leasium-micro text-muted-foreground"
                      >
                        <Sparkles size={11} />
                        {text(citation.label) ?? "Source"}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </AiTurn>
        </div>
      ))}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          handleAsk();
        }}
      >
        <input
          data-testid="intake-ask-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a follow-up — e.g. when does this lease end?"
          className="min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
        />
        <Button
          type="submit"
          disabled={asking || !question.trim()}
          className={cn("shrink-0 px-3")}
          aria-label="Send"
        >
          {asking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </form>
    </div>
  );
}
