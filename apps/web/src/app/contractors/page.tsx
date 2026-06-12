"use client";

/**
 * /contractors — Maintenance contractor directory (v1).
 *
 * Operator-managed list of contractors per entity. v2 wires the AI
 * maintenance categorisation classifier to suggest a contractor on
 * each work order based on the work-order category overlapping with
 * the contractor's categories.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  Download,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { EntityPicker } from "@/components/entity-picker";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  CONTRACTOR_CATEGORIES,
  createContractor,
  type ContractorCategory,
  type ContractorRecord,
  deleteContractor,
  listContractors,
  listEntities,
} from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import {
  ENTITY_STORAGE_KEY,
  defaultEntitySelection,
  isAllEntities,
  scopeEntityId,
} from "@/lib/entity-selection";
import { useEntityFanOut } from "@/lib/use-entity-fan-out";
import { friendlyError } from "@/lib/utils";

const PRIORITY_LABEL: Record<number, string> = {
  1: "Preferred",
  2: "Normal",
  3: "Backup",
};

const PRIORITY_TONE: Record<number, StatusTone> = {
  1: "success",
  2: "neutral",
  3: "warning",
};

function contactReadiness(value: string | null | undefined, label: string) {
  return value?.trim() ? `${label} ready` : `${label} missing`;
}

function aiSuggestReadiness(contractor: ContractorRecord) {
  if (!contractor.categories.length) {
    return "AI suggest blocked: add at least one category";
  }
  if (!contractor.email && !contractor.phone) {
    return "AI suggest needs contact details";
  }
  return "AI suggest ready";
}

function contractorDirectoryCsv(contractors: ContractorRecord[]) {
  const guardrail =
    "Review-only export: copying or downloading this file does not send contractor email or SMS, run maintenance AI classification, assign work-order contractors, create/update/delete contractors, write provider history, dispatch receipts, call SendGrid or Twilio, call Xero or Basiq, apply payments, or reconcile payments.";
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Category",
      "Name",
      "Company",
      "Priority",
      "Categories",
      "Email",
      "Email readiness",
      "Phone",
      "Phone readiness",
      "Service radius",
      "AI suggest readiness",
      "Notes",
      "Guardrail",
    ],
    ...contractors.map((contractor) => [
      "Contractor",
      contractor.name,
      contractor.company_name,
      PRIORITY_LABEL[contractor.priority] ?? `Priority ${contractor.priority}`,
      contractor.categories.join("; "),
      contractor.email,
      contactReadiness(contractor.email, "Email"),
      contractor.phone,
      contactReadiness(contractor.phone, "Phone"),
      contractor.service_radius_km == null
        ? "No radius set"
        : `${contractor.service_radius_km} km`,
      aiSuggestReadiness(contractor),
      contractor.notes,
      guardrail,
    ]),
    [
      "Export guardrail",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      guardrail,
      guardrail,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export default function ContractorsPage() {
  return (
    <QueryProvider>
      <ContractorsContent />
    </QueryProvider>
  );
}

function ContractorsContent() {
  const queryClient = useQueryClient();
  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  const [selectedEntityId, setSelectedEntityId] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) setSelectedEntityId(stored);
  }, []);
  useEffect(() => {
    if (!selectedEntityId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
  }, [selectedEntityId]);
  useEffect(() => {
    if (selectedEntityId) return;
    const fallback = defaultEntitySelection(entitiesQuery.data ?? []);
    if (fallback) setSelectedEntityId(fallback);
  }, [entitiesQuery.data, selectedEntityId]);

  const allMode = isAllEntities(selectedEntityId);
  const scopedEntityId = scopeEntityId(selectedEntityId);
  const entityNameById = useMemo(
    () =>
      new Map(
        (entitiesQuery.data ?? []).map((entity) => [entity.id, entity.name]),
      ),
    [entitiesQuery.data],
  );

  const contractorsQuery = useQuery({
    queryKey: ["contractors", scopedEntityId],
    queryFn: () => listContractors(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const contractorsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["contractors"],
    queryFn: listContractors,
    orgWideQueryFn: () => listContractors(),
  });
  const contractors = allMode
    ? contractorsFanOut.data
    : (contractorsQuery.data ?? []);
  const contractorsLoading = allMode
    ? contractorsFanOut.isLoading
    : contractorsQuery.isLoading;
  const contractorsError = allMode
    ? contractorsFanOut.error
    : contractorsQuery.error;

  const [showCreate, setShowCreate] = useState(false);
  const [directoryReceipt, setDirectoryReceipt] = useState<string | null>(null);
  const directoryCsv = contractorDirectoryCsv(contractors);
  const copyDirectoryCsv = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setDirectoryReceipt("Copy unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(directoryCsv);
      setDirectoryReceipt("Contractor directory CSV copied.");
    } catch {
      setDirectoryReceipt("Copy unavailable in this browser.");
    }
  };
  const downloadDirectoryCsv = () => {
    saveBlob(
      new Blob([directoryCsv], {
        type: "text/csv;charset=utf-8",
      }),
      "contractor-directory-readiness.csv",
    );
    setDirectoryReceipt("Contractor directory CSV downloaded.");
  };

  return (
    <main className="min-h-screen">
      <AppHeader>
        <EntityPicker
          entities={entitiesQuery.data}
          loading={entitiesQuery.isLoading}
          value={selectedEntityId}
          onChange={setSelectedEntityId}
        />
      </AppHeader>

      <div className="mx-auto grid max-w-5xl gap-4 px-5 py-6">
        <PageHeader
          title="Contractor directory"
          description="Trusted contractors organised by category and priority. AI maintenance categorisation will suggest a contractor from this directory once it ships."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton
                type="button"
                onClick={copyDirectoryCsv}
                disabled={contractors.length === 0}
              >
                <Copy size={15} />
                Copy directory CSV
              </SecondaryButton>
              <SecondaryButton
                type="button"
                onClick={downloadDirectoryCsv}
                disabled={contractors.length === 0}
              >
                <Download size={15} />
                Download directory CSV
              </SecondaryButton>
              <Button
                type="button"
                onClick={() => setShowCreate((prev) => !prev)}
                disabled={!scopedEntityId}
                title={
                  allMode
                    ? "Select a single entity to add a contractor"
                    : undefined
                }
              >
                <Plus size={16} />
                {showCreate ? "Close form" : "Add contractor"}
              </Button>
            </div>
          }
        />

        {directoryReceipt ? (
          <p className="text-sm font-medium text-success">{directoryReceipt}</p>
        ) : null}

        {showCreate ? (
          <AddContractorForm
            entityId={scopedEntityId}
            onSaved={() => {
              setShowCreate(false);
              queryClient.invalidateQueries({
                queryKey: ["contractors"],
              });
            }}
          />
        ) : null}

        {contractorsLoading ? (
          <SectionPanel>
            <SkeletonRows rows={4} />
          </SectionPanel>
        ) : null}

        {contractorsError ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {friendlyError(contractorsError)}
          </p>
        ) : null}

        {!contractorsLoading &&
        contractors.length === 0 &&
        !contractorsError ? (
          <EmptyState
            icon={<Wrench size={18} />}
            title="No contractors yet."
            description="Add your trusted electrical, plumbing, hvac, and other trade contacts so they're one click away when a work order needs dispatch."
          />
        ) : null}

        {contractors.map((contractor) => (
          <ContractorCard
            key={contractor.id}
            contractor={contractor}
            entityName={
              allMode ? entityNameById.get(contractor.entity_id) : undefined
            }
            onChanged={() =>
              queryClient.invalidateQueries({
                queryKey: ["contractors"],
              })
            }
          />
        ))}
      </div>
    </main>
  );
}

function AddContractorForm({
  entityId,
  onSaved,
}: {
  entityId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [categories, setCategories] = useState<ContractorCategory[]>([]);
  const [priority, setPriority] = useState(2);
  const [serviceRadiusKm, setServiceRadiusKm] = useState<string>("");
  const [notes, setNotes] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createContractor({
        entity_id: entityId,
        name: name.trim(),
        company_name: companyName.trim() || null,
        categories,
        email: email.trim() || null,
        phone: phone.trim() || null,
        service_radius_km: serviceRadiusKm
          ? Number(serviceRadiusKm)
          : null,
        priority,
        notes: notes.trim() || null,
      }),
    onSuccess: () => onSaved(),
  });

  const canSubmit = Boolean(entityId && name.trim());
  const error = createMutation.error as Error | null;

  function toggleCategory(category: ContractorCategory) {
    setCategories((current) =>
      current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category],
    );
  }

  return (
    <SectionPanel
      title="Add contractor"
      icon={<UserPlus size={17} />}
      description="Categories drive AI suggest later — pick at least one if you know it."
    >
      <form
        className="grid gap-3 p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) createMutation.mutate();
        }}
      >
        <Field label="Name">
          <Input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Bright Sparks Electrical"
          />
        </Field>
        <Field label="Company (optional)">
          <Input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Bright Sparks Pty Ltd"
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ops@example.com"
          />
        </Field>
        <Field label="Phone">
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+61 400 000 000"
          />
        </Field>
        <Field label="Priority">
          <Select
            value={String(priority)}
            onChange={(event) => setPriority(Number(event.target.value))}
          >
            <option value="1">1 — Preferred</option>
            <option value="2">2 — Normal</option>
            <option value="3">3 — Backup</option>
          </Select>
        </Field>
        <Field label="Service radius (km, optional)">
          <Input
            type="number"
            inputMode="numeric"
            value={serviceRadiusKm}
            onChange={(event) => setServiceRadiusKm(event.target.value)}
            placeholder="20"
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Categories">
            <div className="flex flex-wrap gap-2">
              {CONTRACTOR_CATEGORIES.map((category) => {
                const isOn = categories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className={
                      isOn
                        ? "inline-flex min-h-11 items-center gap-1 rounded-full border border-primary/30 bg-primary-soft px-3 text-xs font-semibold text-primary-hover transition"
                        : "inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    }
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="After-hours emergency contact, prefers WhatsApp, etc."
              className="min-h-20 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
            />
          </Field>
        </div>
        {error ? (
          <p className="md:col-span-2 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <AlertTriangle size={16} />
            {friendlyError(error)}
          </p>
        ) : null}
        <div className="md:col-span-2 flex items-center justify-end">
          <Button
            type="submit"
            disabled={!canSubmit || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            {createMutation.isPending ? "Saving…" : "Save contractor"}
          </Button>
        </div>
      </form>
    </SectionPanel>
  );
}

function ContractorCard({
  contractor,
  entityName,
  onChanged,
}: {
  contractor: ContractorRecord;
  entityName?: string;
  onChanged: () => void;
}) {
  const deleteMutation = useMutation({
    mutationFn: () => deleteContractor(contractor.id),
    onSuccess: () => onChanged(),
  });

  const tone = PRIORITY_TONE[contractor.priority] ?? "neutral";
  return (
    <SectionPanel
      title={contractor.name}
      icon={<Wrench size={17} />}
      description={[contractor.company_name, contractor.email, contractor.phone]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {entityName ? (
            <StatusBadge tone="neutral">{entityName}</StatusBadge>
          ) : null}
          <StatusBadge tone={tone}>
            {PRIORITY_LABEL[contractor.priority] ?? `Priority ${contractor.priority}`}
          </StatusBadge>
          {contractor.service_radius_km != null ? (
            <StatusBadge tone="neutral">
              {contractor.service_radius_km} km
            </StatusBadge>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-3 p-4">
        {contractor.categories.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {contractor.categories.map((category) => (
              <span
                key={category}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {category}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No categories set — AI suggest will skip this contractor until at
            least one category is set.
          </p>
        )}
        {contractor.notes ? (
          <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-foreground">
            {contractor.notes}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Created {new Date(contractor.created_at).toLocaleDateString()}
            {contractor.updated_at !== contractor.created_at
              ? ` · updated ${new Date(contractor.updated_at).toLocaleDateString()}`
              : ""}
          </p>
          <SecondaryButton
            type="button"
            onClick={() => {
              if (
                typeof window === "undefined" ||
                window.confirm(`Remove ${contractor.name} from the directory?`)
              ) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Trash2 size={15} />
            )}
            Remove
          </SecondaryButton>
        </div>
      </div>
    </SectionPanel>
  );
}
