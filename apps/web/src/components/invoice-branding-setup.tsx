"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  FileText,
  Palette,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, EmptyState, Field, Input, StatusBadge } from "@/components/ui";
import type {
  Entity,
  EntityBrandingRecord,
  EntityBrandingUpdatePayload,
} from "@/lib/api";

type Props = {
  entity: Entity | null | undefined;
  branding: EntityBrandingRecord | null | undefined;
  isLoading: boolean;
  isSaving: boolean;
  error: unknown;
  saveError?: unknown;
  onSave: (payload: EntityBrandingUpdatePayload) => void;
};

type Draft = {
  [Key in keyof Required<EntityBrandingUpdatePayload>]: string;
};

const EMPTY_DRAFT: Draft = {
  accent_color: "#15565a",
  business_address: "",
  contact_email: "",
  contact_phone: "",
  payment_payid: "",
  payment_bpay_biller: "",
  payment_bpay_reference: "",
  payment_bank_bsb: "",
  payment_bank_account: "",
  footer_terms:
    "Payment due within 14 days. Please use the invoice number as your reference.",
};

function valueOrEmpty(value: string | null | undefined) {
  return value ?? "";
}

function draftFromBranding(
  branding: EntityBrandingRecord | null | undefined,
): Draft {
  return {
    accent_color: branding?.accent_color ?? EMPTY_DRAFT.accent_color,
    business_address: valueOrEmpty(branding?.business_address),
    contact_email: valueOrEmpty(branding?.contact_email),
    contact_phone: valueOrEmpty(branding?.contact_phone),
    payment_payid: valueOrEmpty(branding?.payment_payid),
    payment_bpay_biller: valueOrEmpty(branding?.payment_bpay_biller),
    payment_bpay_reference: valueOrEmpty(branding?.payment_bpay_reference),
    payment_bank_bsb: valueOrEmpty(branding?.payment_bank_bsb),
    payment_bank_account: valueOrEmpty(branding?.payment_bank_account),
    footer_terms:
      valueOrEmpty(branding?.footer_terms) || EMPTY_DRAFT.footer_terms,
  };
}

function cleanPayload(draft: Draft): EntityBrandingUpdatePayload {
  return Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [
      key,
      value.trim() ? value.trim() : null,
    ]),
  ) as EntityBrandingUpdatePayload;
}

function monogram(name: string | null | undefined) {
  const parts = (name ?? "")
    .split(/\s+/)
    .filter((part) => /^[a-z0-9]/i.test(part));
  if (!parts.length) return "IN";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function readinessLabel(
  status: EntityBrandingRecord["readiness_status"] | undefined,
) {
  if (status === "ready") return "Ready";
  if (status === "needs_details") return "Needs details";
  return "Not started";
}

function readinessTone(
  status: EntityBrandingRecord["readiness_status"] | undefined,
) {
  if (status === "ready") return "success" as const;
  if (status === "needs_details") return "warning" as const;
  return "neutral" as const;
}

function hasPayment(draft: Draft) {
  return Boolean(
    draft.payment_payid.trim() ||
    draft.payment_bpay_biller.trim() ||
    (draft.payment_bank_bsb.trim() && draft.payment_bank_account.trim()),
  );
}

function paymentSummary(draft: Draft) {
  const methods = [];
  if (draft.payment_payid.trim()) methods.push("PayID");
  if (draft.payment_bpay_biller.trim()) methods.push("BPAY");
  if (draft.payment_bank_bsb.trim() && draft.payment_bank_account.trim()) {
    methods.push("EFT");
  }
  return methods.length ? methods.join(", ") : "Add PayID, BPAY, or EFT";
}

function FieldGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <div className="mt-4 grid gap-3">{children}</div>
    </div>
  );
}

export function InvoiceBrandingSetup({
  entity,
  branding,
  isLoading,
  isSaving,
  error,
  saveError,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftFromBranding(branding));

  useEffect(() => {
    setDraft(draftFromBranding(branding));
  }, [branding]);

  const checks = useMemo(
    () => [
      {
        label: "Sender details",
        done: Boolean(
          entity?.name && entity?.abn && draft.business_address.trim(),
        ),
      },
      {
        label: "Contact details",
        done: Boolean(draft.contact_email.trim() || draft.contact_phone.trim()),
      },
      {
        label: "Payment details",
        done: hasPayment(draft),
      },
      {
        label: "No provider action",
        done: true,
      },
    ],
    [draft, entity?.abn, entity?.name],
  );

  if (!entity) {
    return (
      <EmptyState
        icon={<FileText size={18} />}
        title="Choose an entity"
        description="Choose an entity before setting up invoice branding."
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
      <div className="grid gap-4">
        <div className="rounded-xl border border-border bg-primary-soft/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Invoice setup
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Complete these steps and Relby will make your tax invoice look
                professional.
              </p>
            </div>
            <StatusBadge tone={readinessTone(branding?.readiness_status)}>
              {readinessLabel(branding?.readiness_status)}
            </StatusBadge>
          </div>
          {error ? (
            <div className="mt-3 flex gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 shrink-0" size={16} />
              Invoice setup could not load. Try again before preparing
              tenant-facing invoice documents.
            </div>
          ) : null}
        </div>

        <FieldGroup
          title="1. Who sends the invoice?"
          description="These details appear at the top and bottom of your tax invoice."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Legal name">
              <Input value={entity.name} readOnly />
            </Field>
            <Field label="ABN">
              <Input value={entity.abn ?? ""} readOnly />
            </Field>
          </div>
          <Field label="Business address">
            <Input
              value={draft.business_address}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  business_address: event.target.value,
                }))
              }
              placeholder="Level 2, 144 Edward St, Brisbane QLD 4000"
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Contact email">
              <Input
                type="email"
                value={draft.contact_email}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    contact_email: event.target.value,
                  }))
                }
                placeholder="accounts@example.com"
              />
            </Field>
            <Field label="Contact phone">
              <Input
                value={draft.contact_phone}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    contact_phone: event.target.value,
                  }))
                }
                placeholder="(07) 3000 0000"
              />
            </Field>
          </div>
        </FieldGroup>

        <FieldGroup
          title="2. What should it look like?"
          description="Start with one polished invoice style. Logo upload can come after initials work well."
        >
          <div className="grid gap-3 md:grid-cols-[120px_minmax(0,1fr)]">
            <div className="grid min-h-24 place-items-center rounded-xl border border-border bg-muted/30">
              <div
                className="grid h-14 w-14 place-items-center rounded-xl text-lg font-bold text-white"
                style={{ backgroundColor: draft.accent_color || "#15565a" }}
              >
                {monogram(entity.name)}
              </div>
            </div>
            <div className="grid gap-3">
              <Field label="Accent colour">
                <Input
                  value={draft.accent_color}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      accent_color: event.target.value,
                    }))
                  }
                  placeholder="#15565a"
                />
              </Field>
              <Field label="Footer terms">
                <Input
                  value={draft.footer_terms}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      footer_terms: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
          </div>
        </FieldGroup>

        <FieldGroup
          title="3. How should tenants pay?"
          description="Shown on invoices only. Relby does not take payment from this setup."
        >
          <Field label="PayID">
            <Input
              value={draft.payment_payid}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  payment_payid: event.target.value,
                }))
              }
              placeholder="accounts@example.com"
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="BPAY biller code">
              <Input
                value={draft.payment_bpay_biller}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    payment_bpay_biller: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="BPAY reference">
              <Input
                value={draft.payment_bpay_reference}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    payment_bpay_reference: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="EFT BSB">
              <Input
                value={draft.payment_bank_bsb}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    payment_bank_bsb: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="EFT account">
              <Input
                value={draft.payment_bank_account}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    payment_bank_account: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
        </FieldGroup>

        <div className="rounded-xl border border-border bg-white p-4">
          <h4 className="text-sm font-semibold text-foreground">
            4. Check and save
          </h4>
          <div className="mt-3 grid gap-2">
            {checks.map((check) => (
              <div
                key={check.label}
                className="flex items-center gap-2 text-sm"
              >
                {check.done ? (
                  <CheckCircle2 className="text-success" size={16} />
                ) : (
                  <AlertTriangle className="text-warning-strong" size={16} />
                )}
                <span
                  className={
                    check.done ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {check.label}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={isLoading || isSaving || Boolean(error)}
              onClick={() => onSave(cleanPayload(draft))}
            >
              {isSaving ? "Saving invoice style..." : "Use this invoice style"}
            </Button>
            <p className="flex min-h-11 items-center text-sm leading-6 text-muted-foreground">
              Logo upload can come later. Initials are enough for this setup.
            </p>
          </div>
          {saveError ? (
            <div className="mt-3 flex gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 shrink-0" size={16} />
              Invoice setup could not save. Nothing was sent to providers.
            </div>
          ) : null}
        </div>
      </div>

      <SampleInvoicePreview entity={entity} draft={draft} />
    </div>
  );
}

function SampleInvoicePreview({
  entity,
  draft,
}: {
  entity: Entity;
  draft: Draft;
}) {
  const accent = draft.accent_color || "#15565a";
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText size={16} />
        Live sample invoice
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-leasiumSm">
        <div style={{ backgroundColor: accent }} className="h-2" />
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-base font-bold text-white"
                style={{ backgroundColor: accent }}
              >
                {monogram(entity.name)}
              </div>
              <div className="min-w-0">
                <div className="break-words font-semibold text-foreground">
                  {entity.name}
                </div>
                <div className="break-words text-xs leading-5 text-muted-foreground">
                  ABN {entity.abn ?? "Add ABN"} -{" "}
                  {draft.business_address || "Add business address"}
                </div>
                <div className="break-words text-xs leading-5 text-muted-foreground">
                  {[draft.contact_email, draft.contact_phone]
                    .filter(Boolean)
                    .join(" - ") || "Add contact details"}
                </div>
              </div>
            </div>
            <div className="min-w-0 text-left sm:text-right">
              <div
                className="break-words text-xs font-bold uppercase tracking-wide"
                style={{ color: accent }}
              >
                Tax invoice
              </div>
              <div className="break-words text-lg font-bold text-foreground">
                INV-1042
              </div>
              <div className="break-words text-xs text-muted-foreground">
                Amount due $10,120.00
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-2 text-sm">
            {[
              ["Base rent - June 2026", "GST 10%", "$8,000.00"],
              ["Outgoings recovery", "GST 10%", "$1,200.00"],
              ["Water usage", "GST-free", "$0.00"],
            ].map(([description, gst, amount]) => (
              <div
                key={description}
                className="grid gap-1 border-b border-border py-2 sm:grid-cols-[minmax(0,1fr)_80px_110px] sm:gap-3"
              >
                <span className="min-w-0 break-words font-medium text-foreground">
                  {description}
                </span>
                <span className="min-w-0 break-words text-muted-foreground">
                  {gst}
                </span>
                <span className="min-w-0 break-words tabular-nums text-foreground sm:text-right">
                  {amount}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-64 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>$9,200.00</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>GST</span>
                <span>$920.00</span>
              </div>
              <div
                className="flex justify-between border-t border-foreground pt-2 font-bold"
                style={{ color: accent }}
              >
                <span>Total inc GST</span>
                <span>$10,120.00</span>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-2 rounded-xl border border-border bg-muted/20 p-3 text-xs md:grid-cols-3">
            <div className="min-w-0">
              <div className="font-semibold uppercase text-muted-foreground">
                PayID
              </div>
              <div className="break-words font-semibold text-foreground">
                {draft.payment_payid || "Add later"}
              </div>
            </div>
            <div className="min-w-0">
              <div className="font-semibold uppercase text-muted-foreground">
                BPAY
              </div>
              {draft.payment_bpay_biller || draft.payment_bpay_reference ? (
                <div className="space-y-0.5 font-semibold text-foreground">
                  <div className="break-words">
                    Biller {draft.payment_bpay_biller || "-"}
                  </div>
                  <div className="break-words">
                    Ref {draft.payment_bpay_reference || "-"}
                  </div>
                </div>
              ) : (
                <div className="font-semibold text-foreground">Add later</div>
              )}
            </div>
            <div className="min-w-0">
              <div className="font-semibold uppercase text-muted-foreground">
                EFT
              </div>
              {draft.payment_bank_bsb || draft.payment_bank_account ? (
                <div className="space-y-0.5 font-semibold text-foreground">
                  <div className="break-words">
                    BSB {draft.payment_bank_bsb || "-"}
                  </div>
                  <div className="break-words">
                    Account {draft.payment_bank_account || "-"}
                  </div>
                </div>
              ) : (
                <div className="font-semibold text-foreground">Add later</div>
              )}
            </div>
          </div>

          <p className="mt-4 break-words text-xs leading-5 text-muted-foreground">
            {draft.footer_terms || EMPTY_DRAFT.footer_terms}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge tone={hasPayment(draft) ? "success" : "warning"}>
              <CreditCard size={12} /> {paymentSummary(draft)}
            </StatusBadge>
            <StatusBadge tone="primary">
              <Palette size={12} /> One invoice style
            </StatusBadge>
          </div>
        </div>
      </div>
    </div>
  );
}
