"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Loader2,
  Phone,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserRound,
} from "lucide-react";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import { Button, Field, Input, SecondaryButton, Select } from "@/components/ui";
import {
  deletePublicOnboardingDocument,
  DocumentCategory,
  getPublicTenantOnboarding,
  listPublicOnboardingDocuments,
  publicOnboardingDocumentDownloadUrl,
  submitPublicTenantOnboarding,
  TenantOnboardingPublicRecord,
  TenantOnboardingSubmitPayload,
  uploadPublicOnboardingDocument,
} from "@/lib/api";

export default function TenantOnboardingPage() {
  return (
    <QueryProvider>
      <TenantOnboardingContent />
    </QueryProvider>
  );
}

const emptyForm: TenantOnboardingSubmitPayload = {
  legal_name: "",
  trading_name: "",
  abn: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  billing_email: "",
  insurance_confirmed: false,
  insurance_expiry_date: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  notes: "",
  accepted: false,
};

function formFromOnboarding(
  onboarding: TenantOnboardingPublicRecord,
): TenantOnboardingSubmitPayload {
  return {
    ...emptyForm,
    legal_name: onboarding.tenant_legal_name ?? "",
    trading_name: onboarding.tenant_trading_name ?? "",
    contact_name: onboarding.contact_name ?? "",
    contact_email: onboarding.contact_email ?? "",
    contact_phone: onboarding.contact_phone ?? "",
    billing_email: onboarding.billing_email ?? onboarding.contact_email ?? "",
  };
}

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function payloadFromForm(
  form: TenantOnboardingSubmitPayload,
): TenantOnboardingSubmitPayload {
  return {
    legal_name: form.legal_name.trim(),
    trading_name: cleanText(form.trading_name),
    abn: cleanText(form.abn),
    contact_name: form.contact_name.trim(),
    contact_email: form.contact_email.trim(),
    contact_phone: cleanText(form.contact_phone),
    billing_email: cleanText(form.billing_email),
    insurance_confirmed: form.insurance_confirmed,
    insurance_expiry_date: cleanText(form.insurance_expiry_date),
    emergency_contact_name: cleanText(form.emergency_contact_name),
    emergency_contact_phone: cleanText(form.emergency_contact_phone),
    notes: cleanText(form.notes),
    accepted: form.accepted,
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const documentCategories: Array<{ value: DocumentCategory; label: string }> = [
  { value: "insurance", label: "Insurance certificate" },
  { value: "bank_guarantee", label: "Bank guarantee" },
  { value: "lease", label: "Signed lease" },
  { value: "onboarding", label: "Other onboarding file" },
];

function documentCategoryLabel(value: DocumentCategory) {
  return documentCategories.find((item) => item.value === value)?.label ?? "Document";
}

function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <LeasiumMark />
          <div>
            <h1 className="text-lg font-semibold">Leasium</h1>
            <p className="text-sm text-muted-foreground">Tenant onboarding</p>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

function TenantOnboardingContent() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const onboardingQuery = useQuery({
    queryKey: ["public-tenant-onboarding", token],
    queryFn: () => getPublicTenantOnboarding(token),
    enabled: Boolean(token),
  });
  const onboarding = onboardingQuery.data;
  const [form, setForm] = useState<TenantOnboardingSubmitPayload>(emptyForm);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentCategory, setDocumentCategory] = useState<DocumentCategory>("insurance");
  const [documentNotes, setDocumentNotes] = useState("");

  const documentsQuery = useQuery({
    queryKey: ["public-onboarding-documents", token],
    queryFn: () => listPublicOnboardingDocuments(token),
    enabled: Boolean(token && onboarding),
  });

  useEffect(() => {
    if (!onboarding) {
      return;
    }
    setForm(formFromOnboarding(onboarding));
  }, [onboarding]);

  const submitMutation = useMutation({
    mutationFn: () => submitPublicTenantOnboarding(token, payloadFromForm(form)),
    onSuccess: () => onboardingQuery.refetch(),
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: () => {
      if (!documentFile) {
        throw new Error("Choose a file first.");
      }
      return uploadPublicOnboardingDocument({
        token,
        category: documentCategory,
        notes: documentNotes,
        file: documentFile,
      });
    },
    onSuccess: () => {
      setDocumentFile(null);
      setDocumentNotes("");
      documentsQuery.refetch();
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: (documentId: string) => deletePublicOnboardingDocument(token, documentId),
    onSuccess: () => documentsQuery.refetch(),
  });

  function setField<K extends keyof TenantOnboardingSubmitPayload>(
    field: K,
    value: TenantOnboardingSubmitPayload[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitMutation.mutate();
  }

  function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    uploadDocumentMutation.mutate();
  }

  if (onboardingQuery.isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <Loader2 className="animate-spin text-primary" size={28} />
      </main>
    );
  }

  if (onboardingQuery.error || !onboarding) {
    return (
      <OnboardingShell>
        <div className="grid min-h-[70vh] place-items-center px-5 py-8">
          <div className="max-w-md rounded-md border border-border bg-white p-6 text-center">
            <LeasiumMark className="mx-auto mb-4" />
            <h2 className="text-lg font-semibold">Link unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask the property team for a fresh tenant onboarding link.
            </p>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  const submitted = onboarding.status === "submitted";
  const documents = documentsQuery.data ?? [];
  const canSubmit =
    form.legal_name.trim() &&
    form.contact_name.trim() &&
    form.contact_email.trim() &&
    form.accepted;

  return (
    <OnboardingShell>
      <div className="mx-auto grid max-w-5xl gap-5 px-5 py-6">
        {submitted ? (
          <section className="rounded-md border border-border bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto text-primary" size={38} />
            <h2 className="mt-3 text-2xl font-semibold">Thanks, all received</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              Your details and documents are with the property team for review.
              They will contact you if anything else is needed.
            </p>
            {onboarding.submitted_at ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Submitted {formatDateTime(onboarding.submitted_at)}
              </p>
            ) : null}
            {documents.length ? (
              <div className="mx-auto mt-5 grid max-w-xl gap-2 text-left">
                {documents.map((document) => (
                  <a
                    key={document.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                    href={publicOnboardingDocumentDownloadUrl(token, document.id)}
                  >
                    <span className="min-w-0 truncate">{document.filename}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {documentCategoryLabel(document.category)}
                      <Download size={14} />
                    </span>
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <section className="rounded-md border border-border bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-primary">Tenant onboarding</p>
                  <h2 className="mt-1 text-2xl font-semibold">
                    Confirm your details for {onboarding.property_name}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    Review the lease context, confirm your business and contact details,
                    and submit them to the property team.
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  {onboarding.due_date
                    ? `Due ${formatDate(onboarding.due_date)}`
                    : "Open request"}
                </div>
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
              <aside className="grid gap-4 self-start lg:sticky lg:top-4">
                <section className="rounded-md border border-border bg-white p-4">
                  <div className="flex items-center gap-2">
                    <Building2 size={18} className="text-primary" />
                    <h3 className="font-semibold">Lease context</h3>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Property</dt>
                      <dd className="font-medium">{onboarding.property_name}</dd>
                      {onboarding.property_address ? (
                        <dd className="text-muted-foreground">
                          {onboarding.property_address}
                        </dd>
                      ) : null}
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Unit</dt>
                      <dd className="font-medium">{onboarding.unit_label}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Lease dates</dt>
                      <dd className="font-medium">
                        {formatDate(onboarding.lease_commencement_date)} to{" "}
                        {formatDate(onboarding.lease_expiry_date)}
                      </dd>
                    </div>
                    {onboarding.expires_at ? (
                      <div>
                        <dt className="text-muted-foreground">Link expires</dt>
                        <dd className="font-medium">
                          {formatDateTime(onboarding.expires_at)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </section>

                <section className="rounded-md border border-border bg-white p-4">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck size={18} className="text-primary" />
                    <h3 className="font-semibold">What happens next</h3>
                  </div>
                  <ol className="mt-4 grid gap-3 text-sm">
                    {["Confirm details", "Property team reviews", "They follow up if needed"].map(
                      (item, index) => (
                        <li key={item} className="flex items-center gap-3">
                          <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                            {index + 1}
                          </span>
                          <span>{item}</span>
                        </li>
                      ),
                    )}
                  </ol>
                </section>
              </aside>

              <form className="grid gap-4" onSubmit={submit}>
                <section className="rounded-md border border-border bg-white p-5">
                  <div className="flex items-center gap-2">
                    <Building2 size={18} className="text-primary" />
                    <h3 className="text-lg font-semibold">Business details</h3>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="Legal name">
                      <Input
                        required
                        autoComplete="organization"
                        value={form.legal_name}
                        onChange={(event) => setField("legal_name", event.target.value)}
                      />
                    </Field>
                    <Field label="Trading name">
                      <Input
                        autoComplete="organization"
                        value={form.trading_name ?? ""}
                        onChange={(event) => setField("trading_name", event.target.value)}
                      />
                    </Field>
                    <Field label="ABN">
                      <Input
                        inputMode="numeric"
                        placeholder="11 222 333 444"
                        value={form.abn ?? ""}
                        onChange={(event) => setField("abn", event.target.value)}
                      />
                    </Field>
                  </div>
                </section>

                <section className="rounded-md border border-border bg-white p-5">
                  <div className="flex items-center gap-2">
                    <UserRound size={18} className="text-primary" />
                    <h3 className="text-lg font-semibold">Contact and billing</h3>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="Primary contact">
                      <Input
                        required
                        autoComplete="name"
                        value={form.contact_name}
                        onChange={(event) => setField("contact_name", event.target.value)}
                      />
                    </Field>
                    <Field label="Contact email">
                      <Input
                        required
                        type="email"
                        autoComplete="email"
                        value={form.contact_email}
                        onChange={(event) => setField("contact_email", event.target.value)}
                      />
                    </Field>
                    <Field label="Contact phone">
                      <Input
                        type="tel"
                        autoComplete="tel"
                        value={form.contact_phone ?? ""}
                        onChange={(event) => setField("contact_phone", event.target.value)}
                      />
                    </Field>
                    <Field label="Billing email">
                      <Input
                        type="email"
                        autoComplete="email"
                        value={form.billing_email ?? ""}
                        onChange={(event) => setField("billing_email", event.target.value)}
                      />
                    </Field>
                  </div>
                </section>

                <section className="rounded-md border border-border bg-white p-5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-primary" />
                    <h3 className="text-lg font-semibold">Insurance</h3>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="Insurance expiry">
                      <Input
                        type="date"
                        value={form.insurance_expiry_date ?? ""}
                        onChange={(event) =>
                          setField("insurance_expiry_date", event.target.value)
                        }
                      />
                    </Field>
                    <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm md:mt-7">
                      <input
                        className="mt-1 h-4 w-4 accent-primary"
                        type="checkbox"
                        checked={form.insurance_confirmed}
                        onChange={(event) =>
                          setField("insurance_confirmed", event.target.checked)
                        }
                      />
                      <span>Current insurance details are available if requested.</span>
                    </label>
                  </div>
                </section>

                <section className="rounded-md border border-border bg-white p-5">
                  <div className="flex items-center gap-2">
                    <FileText size={18} className="text-primary" />
                    <h3 className="text-lg font-semibold">Upload documents</h3>
                  </div>
                  <form className="mt-4 grid gap-4" onSubmit={submitDocument}>
                    <label className="grid min-h-28 cursor-pointer place-items-center rounded-md border border-dashed border-border bg-muted/30 px-4 py-5 text-center transition hover:border-primary hover:bg-primary/5">
                      <input
                        type="file"
                        className="sr-only"
                        onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                      />
                      <span className="grid justify-items-center gap-2">
                        <UploadCloud size={22} className="text-primary" />
                        <span className="text-sm font-semibold">
                          {documentFile ? documentFile.name : "Choose a document"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Insurance, guarantees, signed files, PDF or image up to 15 MB
                        </span>
                      </span>
                    </label>
                    <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                      <Field label="Type">
                        <Select
                          value={documentCategory}
                          onChange={(event) =>
                            setDocumentCategory(event.target.value as DocumentCategory)
                          }
                        >
                          {documentCategories.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Notes">
                        <Input
                          placeholder="Optional"
                          value={documentNotes}
                          onChange={(event) => setDocumentNotes(event.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="submit"
                        disabled={!documentFile || uploadDocumentMutation.isPending}
                      >
                        {uploadDocumentMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <UploadCloud size={16} />
                        )}
                        Upload file
                      </Button>
                      {documentFile ? (
                        <SecondaryButton
                          type="button"
                          onClick={() => setDocumentFile(null)}
                        >
                          Remove
                        </SecondaryButton>
                      ) : null}
                    </div>
                    {uploadDocumentMutation.error ? (
                      <p className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
                        {uploadDocumentMutation.error.message}
                      </p>
                    ) : null}
                  </form>
                  <div className="mt-4 grid gap-2">
                    {documents.map((document) => (
                      <div
                        key={document.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{document.filename}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {documentCategoryLabel(document.category)} -{" "}
                            {formatBytes(document.byte_size)}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <a
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted"
                            href={publicOnboardingDocumentDownloadUrl(token, document.id)}
                            aria-label={`Download ${document.filename}`}
                          >
                            <Download size={15} />
                          </a>
                          <SecondaryButton
                            type="button"
                            className="h-8 w-8 px-0 text-danger"
                            aria-label={`Delete ${document.filename}`}
                            onClick={() => deleteDocumentMutation.mutate(document.id)}
                            disabled={deleteDocumentMutation.isPending}
                          >
                            <Trash2 size={15} />
                          </SecondaryButton>
                        </div>
                      </div>
                    ))}
                    {!documentsQuery.isLoading && documents.length === 0 ? (
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                        No files uploaded yet.
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-md border border-border bg-white p-5">
                  <div className="flex items-center gap-2">
                    <Phone size={18} className="text-primary" />
                    <h3 className="text-lg font-semibold">Emergency contact</h3>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="Emergency contact">
                      <Input
                        autoComplete="name"
                        value={form.emergency_contact_name ?? ""}
                        onChange={(event) =>
                          setField("emergency_contact_name", event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Emergency phone">
                      <Input
                        type="tel"
                        autoComplete="tel"
                        value={form.emergency_contact_phone ?? ""}
                        onChange={(event) =>
                          setField("emergency_contact_phone", event.target.value)
                        }
                      />
                    </Field>
                  </div>
                </section>

                <section className="rounded-md border border-border bg-white p-5">
                  <div className="flex items-center gap-2">
                    <CalendarDays size={18} className="text-primary" />
                    <h3 className="text-lg font-semibold">Final check</h3>
                  </div>
                  <div className="mt-4 grid gap-4">
                    <Field label="Notes for the property team">
                      <textarea
                        className="min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                        value={form.notes ?? ""}
                        onChange={(event) => setField("notes", event.target.value)}
                      />
                    </Field>
                    <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
                      <input
                        className="mt-1 h-4 w-4 accent-primary"
                        type="checkbox"
                        required
                        checked={form.accepted}
                        onChange={(event) => setField("accepted", event.target.checked)}
                      />
                      <span>I confirm these details are accurate.</span>
                    </label>
                  </div>
                </section>

                {submitMutation.error ? (
                  <p className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
                    {submitMutation.error.message}
                  </p>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2 rounded-md border border-border bg-white p-4">
                  <SecondaryButton
                    type="button"
                    onClick={() => setForm(formFromOnboarding(onboarding))}
                  >
                    Reset
                  </SecondaryButton>
                  <Button
                    type="submit"
                    disabled={submitMutation.isPending || !canSubmit}
                  >
                    {submitMutation.isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : null}
                    Submit details
                  </Button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </OnboardingShell>
  );
}
