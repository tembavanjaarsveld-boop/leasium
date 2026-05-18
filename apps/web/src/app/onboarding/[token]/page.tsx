"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import { Button, Field, Input, SecondaryButton } from "@/components/ui";
import {
  getPublicTenantOnboarding,
  submitPublicTenantOnboarding,
  TenantOnboardingSubmitPayload,
} from "@/lib/api";

export default function TenantOnboardingPage() {
  return (
    <QueryProvider>
      <TenantOnboardingContent />
    </QueryProvider>
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
  const [form, setForm] = useState<TenantOnboardingSubmitPayload>({
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
  });

  useEffect(() => {
    if (!onboarding) {
      return;
    }
    setForm((current) => ({
      ...current,
      legal_name: onboarding.tenant_legal_name ?? "",
      trading_name: onboarding.tenant_trading_name ?? "",
      contact_name: onboarding.contact_name ?? "",
      contact_email: onboarding.contact_email ?? "",
      contact_phone: onboarding.contact_phone ?? "",
      billing_email: onboarding.billing_email ?? onboarding.contact_email ?? "",
    }));
  }, [onboarding]);

  const submitMutation = useMutation({
    mutationFn: () => submitPublicTenantOnboarding(token, form),
    onSuccess: () => onboardingQuery.refetch(),
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

  if (onboardingQuery.isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <Loader2 className="animate-spin text-primary" size={28} />
      </main>
    );
  }

  if (onboardingQuery.error || !onboarding) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-md rounded-md border border-border bg-white p-6 text-center">
          <LeasiumMark className="mx-auto mb-4" />
          <h1 className="text-lg font-semibold">Link unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask the property team for a fresh tenant onboarding link.
          </p>
        </div>
      </main>
    );
  }

  const submitted = onboarding.status === "submitted";

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-5 py-4">
          <LeasiumMark />
          <div>
            <h1 className="text-lg font-semibold">Leasium</h1>
            <p className="text-sm text-muted-foreground">Tenant onboarding</p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-4xl gap-5 px-5 py-6">
        {submitted ? (
          <section className="rounded-md border border-border bg-white p-6 text-center">
            <CheckCircle2 className="mx-auto text-primary" size={34} />
            <h2 className="mt-3 text-xl font-semibold">Thanks, all received</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The property team can now review your onboarding details.
            </p>
          </section>
        ) : (
          <form
            className="grid gap-5 rounded-md border border-border bg-white p-5"
            onSubmit={submit}
          >
            <div>
              <h2 className="text-xl font-semibold">Confirm tenant details</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Lease dates: {onboarding.lease_commencement_date ?? "-"} to{" "}
                {onboarding.lease_expiry_date ?? "-"}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Legal name">
                <Input
                  required
                  value={form.legal_name}
                  onChange={(event) => setField("legal_name", event.target.value)}
                />
              </Field>
              <Field label="Trading name">
                <Input
                  value={form.trading_name ?? ""}
                  onChange={(event) => setField("trading_name", event.target.value)}
                />
              </Field>
              <Field label="ABN">
                <Input
                  value={form.abn ?? ""}
                  onChange={(event) => setField("abn", event.target.value)}
                />
              </Field>
              <Field label="Primary contact">
                <Input
                  required
                  value={form.contact_name}
                  onChange={(event) => setField("contact_name", event.target.value)}
                />
              </Field>
              <Field label="Contact email">
                <Input
                  required
                  type="email"
                  value={form.contact_email}
                  onChange={(event) => setField("contact_email", event.target.value)}
                />
              </Field>
              <Field label="Billing email">
                <Input
                  type="email"
                  value={form.billing_email ?? ""}
                  onChange={(event) => setField("billing_email", event.target.value)}
                />
              </Field>
              <Field label="Contact phone">
                <Input
                  value={form.contact_phone ?? ""}
                  onChange={(event) => setField("contact_phone", event.target.value)}
                />
              </Field>
              <Field label="Insurance expiry">
                <Input
                  type="date"
                  value={form.insurance_expiry_date ?? ""}
                  onChange={(event) =>
                    setField("insurance_expiry_date", event.target.value)
                  }
                />
              </Field>
              <Field label="Emergency contact">
                <Input
                  value={form.emergency_contact_name ?? ""}
                  onChange={(event) =>
                    setField("emergency_contact_name", event.target.value)
                  }
                />
              </Field>
              <Field label="Emergency phone">
                <Input
                  value={form.emergency_contact_phone ?? ""}
                  onChange={(event) =>
                    setField("emergency_contact_phone", event.target.value)
                  }
                />
              </Field>
            </div>

            <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <input
                className="mt-1 h-4 w-4 accent-primary"
                type="checkbox"
                checked={form.insurance_confirmed}
                onChange={(event) =>
                  setField("insurance_confirmed", event.target.checked)
                }
              />
              <span>I confirm current insurance details will be provided.</span>
            </label>
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

            {submitMutation.error ? (
              <p className="text-sm text-danger">{submitMutation.error.message}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <SecondaryButton type="button" onClick={() => onboardingQuery.refetch()}>
                Reset
              </SecondaryButton>
              <Button type="submit" disabled={submitMutation.isPending}>
                {submitMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : null}
                Submit details
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
