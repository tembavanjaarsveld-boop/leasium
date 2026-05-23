"use client";

import { SignInButton, SignUpButton, useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  Field,
  Input,
  SecondaryButton,
  StatusBadge,
} from "@/components/ui";
import {
  createSecurityBootstrapWorkspace,
  getSecurityBootstrapStatus,
  type SecurityBootstrapRecord,
} from "@/lib/api";

type SetupForm = {
  organisation_name: string;
  entity_name: string;
  email: string;
  display_name: string;
  country_code: string;
  timezone: string;
  entity_abn: string;
  gst_registered: boolean;
};

const defaultForm: SetupForm = {
  organisation_name: "",
  entity_name: "",
  email: "",
  display_name: "",
  country_code: "AU",
  timezone: "Australia/Brisbane",
  entity_abn: "",
  gst_registered: true,
};

function SetupShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-leasium-bg px-5 py-10 text-foreground">
      <section className="mx-auto grid w-full max-w-2xl gap-5">
        <div className="flex items-center gap-3">
          <LeasiumMark className="h-12 w-12" />
          <div>
            <div className="text-sm font-semibold text-primary">
              Leasium operator setup
            </div>
            <h1 className="text-2xl font-semibold">First workspace setup</h1>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}

function ClerkNotConfigured() {
  return (
    <SetupShell>
      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4">
        <AlertTriangle className="mt-0.5 text-warning" size={19} />
        <div>
          <h2 className="text-base font-semibold">Clerk is not configured yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the Clerk publishable key before a production operator can sign
            in and create the first workspace.
          </p>
        </div>
      </div>
      <Link
        className="text-sm font-semibold text-primary transition hover:text-primary-hover"
        href="/sign-in"
      >
        Back to sign in
      </Link>
    </SetupShell>
  );
}

function LoadingState({ label = "Checking setup status." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/35 p-4 text-sm text-muted-foreground">
      <Loader2 className="animate-spin text-primary" size={16} />
      {label}
    </div>
  );
}

function SignedOutState() {
  return (
    <>
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary-soft p-2 text-primary">
            <ShieldCheck size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              Sign in to create the first workspace
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The bootstrap window is open. Use the production operator account
              that should become the workspace owner.
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <SignInButton mode="redirect" fallbackRedirectUrl="/setup">
          <Button type="button">Sign in</Button>
        </SignInButton>
        <SignUpButton mode="redirect" fallbackRedirectUrl="/setup">
          <SecondaryButton type="button">Create login</SecondaryButton>
        </SignUpButton>
      </div>
    </>
  );
}

function UnavailableState({
  reason,
  organisationCount,
  entityCount,
  operatorCount,
  nextSteps,
  retry,
}: {
  reason: string;
  organisationCount?: number;
  entityCount?: number;
  operatorCount?: number;
  nextSteps?: string[];
  retry?: () => void;
}) {
  return (
    <>
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-muted p-2 text-muted-foreground">
            <Building2 size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold">Workspace setup is unavailable</h2>
            <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
          </div>
        </div>
      </div>

      {organisationCount !== undefined ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              Organisations
            </div>
            <div className="mt-1 text-2xl font-semibold">{organisationCount}</div>
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-semibold text-muted-foreground">Entities</div>
            <div className="mt-1 text-2xl font-semibold">{entityCount ?? 0}</div>
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="text-xs font-semibold text-muted-foreground">Operators</div>
            <div className="mt-1 text-2xl font-semibold">{operatorCount ?? 0}</div>
          </div>
        </div>
      ) : null}

      {nextSteps?.length ? (
        <div className="rounded-xl border border-border bg-white p-4">
          <div className="text-sm font-semibold">Next steps</div>
          <ul className="mt-2 grid gap-2 text-sm text-muted-foreground">
            {nextSteps.map((step) => (
              <li key={step} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          href="/sign-in"
        >
          Sign in
        </Link>
        {retry ? (
          <SecondaryButton onClick={retry} type="button">
            Check again
          </SecondaryButton>
        ) : null}
      </div>
    </>
  );
}

function WorkspaceCreatedState({ result }: { result: SecurityBootstrapRecord }) {
  return (
    <>
      <div className="flex items-center gap-2 text-success">
        <CheckCircle2 size={18} />
        <span className="font-semibold">Workspace created</span>
      </div>
      <div>
        <h2 className="text-xl font-semibold">{result.organisation.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.member.display_name} can now open Leasium as the first owner
          operator.
        </p>
      </div>
      <Link
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover"
        href="/"
      >
        Open workspace
      </Link>
    </>
  );
}

function AvailableSetupForm() {
  const { user } = useUser();
  const [form, setForm] = useState<SetupForm>(defaultForm);
  const [created, setCreated] = useState<SecurityBootstrapRecord | null>(null);
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const displayName = user?.fullName ?? email;

  useEffect(() => {
    setForm((current) => ({
      ...current,
      email: current.email || email,
      display_name: current.display_name || displayName,
    }));
  }, [displayName, email]);

  const mutation = useMutation({
    mutationFn: () =>
      createSecurityBootstrapWorkspace({
        organisation_name: form.organisation_name.trim(),
        entity_name: form.entity_name.trim(),
        email: form.email.trim(),
        display_name: form.display_name.trim() || null,
        country_code: form.country_code.trim() || "AU",
        timezone: form.timezone.trim() || "Australia/Brisbane",
        entity_abn: form.entity_abn.trim() || null,
        gst_registered: form.gst_registered,
      }),
    onSuccess: (result) => setCreated(result),
  });

  function updateField<K extends keyof SetupForm>(key: K, value: SetupForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  if (created) {
    return <WorkspaceCreatedState result={created} />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="success">Bootstrap available</StatusBadge>
        <span className="text-sm text-muted-foreground">
          Create the first organisation, entity, and owner operator.
        </span>
      </div>

      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation name">
            <Input
              autoFocus
              onChange={(event) =>
                updateField("organisation_name", event.target.value)
              }
              placeholder="Acme Holdings"
              required
              value={form.organisation_name}
            />
          </Field>
          <Field label="First entity name">
            <Input
              onChange={(event) => updateField("entity_name", event.target.value)}
              placeholder="Acme Holdings Pty Ltd"
              required
              value={form.entity_name}
            />
          </Field>
          <Field label="Operator email">
            <Input
              autoComplete="email"
              onChange={(event) => updateField("email", event.target.value)}
              required
              type="email"
              value={form.email}
            />
          </Field>
          <Field label="Display name">
            <Input
              autoComplete="name"
              onChange={(event) => updateField("display_name", event.target.value)}
              value={form.display_name}
            />
          </Field>
          <Field label="Country code">
            <Input
              onChange={(event) => updateField("country_code", event.target.value)}
              required
              value={form.country_code}
            />
          </Field>
          <Field label="Timezone">
            <Input
              onChange={(event) => updateField("timezone", event.target.value)}
              required
              value={form.timezone}
            />
          </Field>
          <Field label="Entity ABN">
            <Input
              onChange={(event) => updateField("entity_abn", event.target.value)}
              placeholder="Optional"
              value={form.entity_abn}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm">
            <input
              checked={form.gst_registered}
              className="h-4 w-4 accent-primary"
              onChange={(event) =>
                updateField("gst_registered", event.target.checked)
              }
              type="checkbox"
            />
            <span className="font-medium">GST registered</span>
          </label>
        </div>

        {mutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Could not create the workspace."}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={
              mutation.isPending ||
              !form.organisation_name.trim() ||
              !form.entity_name.trim() ||
              !form.email.trim()
            }
            type="submit"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Creating
              </>
            ) : (
              "Create workspace"
            )}
          </Button>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
            href="/sign-in"
          >
            Back to sign in
          </Link>
        </div>
      </form>
    </>
  );
}

function SetupContent() {
  const { isLoaded, isSignedIn } = useUser();
  const statusQuery = useQuery({
    queryKey: ["security-bootstrap-status"],
    queryFn: getSecurityBootstrapStatus,
  });

  if (statusQuery.isLoading) {
    return <LoadingState />;
  }

  if (statusQuery.error) {
    return (
      <UnavailableState
        reason={
          statusQuery.error instanceof Error
            ? statusQuery.error.message
            : "Could not load setup status."
        }
        retry={() => void statusQuery.refetch()}
      />
    );
  }

  if (statusQuery.data && !statusQuery.data.available) {
    return (
      <UnavailableState
        entityCount={statusQuery.data.entity_count}
        nextSteps={statusQuery.data.auth.next_steps}
        operatorCount={statusQuery.data.operator_count}
        organisationCount={statusQuery.data.organisation_count}
        reason={statusQuery.data.reason}
      />
    );
  }

  if (!isLoaded) {
    return <LoadingState label="Checking signed-in operator." />;
  }

  if (!isSignedIn) {
    return <SignedOutState />;
  }

  return <AvailableSetupForm />;
}

function SetupPageWithClerk() {
  return (
    <QueryProvider>
      <SetupShell>
        <SetupContent />
      </SetupShell>
    </QueryProvider>
  );
}

export default function SetupPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <ClerkNotConfigured />;
  }

  return <SetupPageWithClerk />;
}
