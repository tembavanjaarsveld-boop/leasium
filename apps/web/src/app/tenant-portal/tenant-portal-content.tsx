"use client";

import {
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/nextjs";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  ImagePlus,
  Link2,
  Loader2,
  LogIn,
  ReceiptText,
  Send,
  ShieldCheck,
  UploadCloud,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  Field,
  Input,
  SecondaryButton,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  claimTenantPortalAccount,
  createTenantPortalAccountMaintenanceRequest,
  createTenantPortalMaintenanceRequest,
  DocumentCategory,
  downloadTenantPortalAccountDocument,
  getTenantPortal,
  getTenantPortalAccountSession,
  getTenantPortalAccountStatus,
  MaintenancePriority,
  tenantPortalDocumentDownloadUrl,
  TenantPortalDocumentRecord,
  TenantPortalMaintenanceRequestPayload,
  TenantPortalNotificationPreferencesRecord,
  TenantPortalNotificationPreferencesPayload,
  TenantPortalRecord,
  updateTenantPortalAccountNotificationPreferences,
  updateTenantPortalNotificationPreferences,
  uploadTenantPortalAccountDocument,
  uploadTenantPortalDocument,
} from "@/lib/api";

export function TenantPortalPage({ token = null }: { token?: string | null }) {
  return (
    <QueryProvider>
      <TenantPortalContent token={token} />
    </QueryProvider>
  );
}

const categoryLabels: Record<DocumentCategory, string> = {
  lease: "Lease",
  insurance: "Insurance",
  bank_guarantee: "Bank guarantee",
  onboarding: "Onboarding",
  invoice: "Invoice",
  other: "Other",
};

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

function formatMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function maintenanceEventLabel(value: string) {
  if (value === "tenant_submitted") {
    return "Request submitted";
  }
  if (value === "comment_added") {
    return "Team update";
  }
  return label(value);
}

function paymentTone(status: TenantPortalRecord["payment_summary"]["status"]) {
  if (status === "paid") {
    return "success" as const;
  }
  if (status === "overdue") {
    return "danger" as const;
  }
  if (status === "unpaid") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function complianceTone(status: string) {
  if (status === "received") {
    return "success" as const;
  }
  if (status === "expired") {
    return "danger" as const;
  }
  if (status === "missing") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function maintenanceTone(status: string) {
  if (status === "completed") {
    return "success" as const;
  }
  if (status === "cancelled") {
    return "danger" as const;
  }
  if (
    ["awaiting_approval", "approved", "assigned", "in_progress"].includes(
      status,
    )
  ) {
    return "primary" as const;
  }
  return "warning" as const;
}

function priorityTone(priority: MaintenancePriority) {
  if (priority === "urgent") {
    return "danger" as const;
  }
  if (priority === "high") {
    return "warning" as const;
  }
  if (priority === "low") {
    return "neutral" as const;
  }
  return "primary" as const;
}

function portalScopeLabel(portal: TenantPortalRecord) {
  if (portal.auth.mode === "tenant_portal_account") {
    return "Account scoped";
  }
  return portal.auth.dev_fallback ? "Token fallback" : "Token scoped";
}

function tenantDisplayName(tenant: TenantPortalRecord["tenant"]) {
  return tenant.trading_name || tenant.legal_name;
}

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
          <LeasiumMark />
          <div>
            <h1 className="text-lg font-semibold">Leasium</h1>
            <p className="text-sm text-muted-foreground">Tenant portal</p>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {detail ? (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function TenantDocumentSummary({
  document,
}: {
  document: TenantPortalDocumentRecord;
}) {
  return (
    <>
      <span className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <FileText size={15} className="shrink-0 text-primary" />
          <span className="truncate font-medium">{document.filename}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {categoryLabels[document.category]} - {formatBytes(document.byte_size)} -{" "}
          {label(document.source)} - {formatDateTime(document.created_at)}
        </span>
        {document.notes ? (
          <span className="text-xs text-muted-foreground">{document.notes}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2 justify-self-start text-xs font-semibold text-muted-foreground md:justify-self-end">
        Download
        <Download size={14} />
      </span>
    </>
  );
}

function Panel({
  title,
  icon,
  actions,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function PreferencesForm({
  token,
  portal,
  accountAuthToken,
  onSaved,
}: {
  token: string | null;
  portal: TenantPortalRecord;
  accountAuthToken?: string | null;
  onSaved: () => void;
}) {
  const [preferences, setPreferences] =
    useState<TenantPortalNotificationPreferencesPayload>(
      portal.notification_preferences,
    );

  useEffect(() => {
    setPreferences(portal.notification_preferences);
  }, [portal.notification_preferences]);

  const saveMutation = useMutation({
    mutationFn: () =>
      accountAuthToken
        ? updateTenantPortalAccountNotificationPreferences(
            preferences,
            accountAuthToken,
          )
        : token
          ? updateTenantPortalNotificationPreferences(token, preferences)
          : Promise.reject(
              new Error("Sign in to a linked tenant account before saving."),
            ),
    onSuccess: onSaved,
  });

  function setField<K extends keyof TenantPortalNotificationPreferencesPayload>(
    field: K,
    value: boolean,
  ) {
    setPreferences((current) => ({ ...current, [field]: value }));
  }

  const savedReceipt: TenantPortalNotificationPreferencesRecord | null =
    saveMutation.data ??
    (portal.notification_preferences.updated_at
      ? portal.notification_preferences
      : null);

  return (
    <Panel
      title="Notification Preferences"
      icon={<Bell size={18} />}
      actions={
        <StatusBadge tone="neutral">
          {label(portal.notification_preferences.preferred_channel)}
        </StatusBadge>
      }
    >
      <div className="grid gap-3 p-4">
        {[
          ["email_enabled", "Email updates"],
          ["sms_enabled", "SMS updates"],
          ["billing_email_enabled", "Billing notices"],
          ["compliance_reminders_enabled", "Compliance reminders"],
        ].map(([key, text]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>{text}</span>
            <input
              className="h-4 w-4 accent-primary"
              type="checkbox"
              checked={Boolean(
                preferences[
                  key as keyof TenantPortalNotificationPreferencesPayload
                ],
              )}
              onChange={(event) =>
                setField(
                  key as keyof TenantPortalNotificationPreferencesPayload,
                  event.target.checked,
                )
              }
            />
          </label>
        ))}
        {savedReceipt ? (
          <div className="rounded-md border border-success/25 bg-success/5 px-3 py-2 text-sm text-success">
            Saved {formatDateTime(savedReceipt.updated_at)}. Preferred channel:{" "}
            {label(savedReceipt.preferred_channel)}. No message sent.
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            No preference receipt yet.
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saveMutation.error ? (
            <span className="text-sm text-danger">
              {saveMutation.error.message}
            </span>
          ) : null}
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function TenantAccountPanel({
  token,
  tokenTenantId,
  tokenTenantName,
  tokenExpiresAt,
  onAccountPortal,
}: {
  token: string | null;
  tokenTenantId: string | null;
  tokenTenantName: string | null;
  tokenExpiresAt: string | null;
  onAccountPortal: (
    portal: TenantPortalRecord | null,
    authToken: string | null,
  ) => void;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const returnTo = token
    ? `/tenant-portal/${encodeURIComponent(token)}`
    : "/tenant-portal";
  const accountQuery = useQuery({
    queryKey: ["tenant-portal-account-session", tokenTenantId],
    queryFn: async () => {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Sign in before opening the tenant account.");
      }
      const portal = await getTenantPortalAccountSession(authToken);
      return { authToken, portal };
    },
    enabled: isLoaded && isSignedIn,
    retry: false,
  });
  const accountStatusQuery = useQuery({
    queryKey: ["tenant-portal-account-status"],
    queryFn: async () => {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Sign in before checking this tenant account.");
      }
      return getTenantPortalAccountStatus(authToken);
    },
    enabled: isLoaded && isSignedIn,
    retry: false,
  });
  const accountPortal = accountQuery.data?.portal ?? null;
  const accountStatus = accountStatusQuery.data ?? null;
  const accountTenantMatches =
    Boolean(accountPortal) &&
    (!tokenTenantId || accountPortal?.tenant.id === tokenTenantId);
  const tokenExpiryCopy = tokenExpiresAt
    ? `This portal link expires ${formatDateTime(tokenExpiresAt)}.`
    : "If the original link expired or was lost, ask the property team for a fresh portal link.";

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      onAccountPortal(null, null);
      return;
    }
    if (accountQuery.data && accountTenantMatches) {
      onAccountPortal(accountQuery.data.portal, accountQuery.data.authToken);
      return;
    }
    if (accountQuery.isError || (accountQuery.data && !accountTenantMatches)) {
      onAccountPortal(null, null);
    }
  }, [
    accountQuery.data,
    accountQuery.isError,
    accountTenantMatches,
    isLoaded,
    isSignedIn,
    onAccountPortal,
  ]);

  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error("Open your tenant invite link once before linking.");
      }
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Sign in before linking this portal.");
      }
      const portal = await claimTenantPortalAccount(token, authToken);
      return { authToken, portal };
    },
    onSuccess: (result) => {
      onAccountPortal(result.portal, result.authToken);
      accountQuery.refetch();
    },
  });

  if (!isLoaded) {
    return (
      <Panel title="Account Access" icon={<UserRound size={18} />}>
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin text-primary" />
          Checking sign-in.
        </div>
      </Panel>
    );
  }

  if (!isSignedIn) {
    return (
      <Panel title="Account Access" icon={<UserRound size={18} />}>
        <div className="grid gap-3 p-4 text-sm">
          <p className="text-muted-foreground">
            {token
              ? "Create or sign in to a tenant login, then link this portal once. Linked accounts keep working after the original link expires."
              : "Create or sign in to a tenant login to open your linked portal. If your link expired or was lost, ask the property team for a fresh one."}
          </p>
          <div className="flex flex-wrap gap-2">
            <SignUpButton mode="redirect" fallbackRedirectUrl={returnTo}>
              <Button type="button">
                <LogIn size={16} />
                Create login
              </Button>
            </SignUpButton>
            <SignInButton mode="redirect" fallbackRedirectUrl={returnTo}>
              <SecondaryButton type="button">Sign in</SecondaryButton>
            </SignInButton>
          </div>
        </div>
      </Panel>
    );
  }

  if (accountQuery.isLoading) {
    return (
      <Panel title="Account Access" icon={<UserRound size={18} />}>
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin text-primary" />
          Checking linked account.
        </div>
      </Panel>
    );
  }

  if (accountStatus?.status === "revoked" && !accountPortal) {
    return (
      <Panel
        title="Account Access"
        icon={<UserRound size={18} />}
        actions={<UserButton />}
      >
        <div className="grid gap-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="danger">Access revoked</StatusBadge>
            {accountStatus.tenant_name ? (
              <span className="text-muted-foreground">
                {accountStatus.tenant_name}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground">
            {accountStatus.recovery_hint}
          </p>
          {accountStatus.revoked_at ? (
            <p className="text-xs text-muted-foreground">
              Revoked {formatDateTime(accountStatus.revoked_at)}
            </p>
          ) : null}
          {accountStatus.recovery_at ? (
            <p className="text-xs text-muted-foreground">
              Staff recovery updated {formatDateTime(accountStatus.recovery_at)}
            </p>
          ) : null}
        </div>
      </Panel>
    );
  }

  if (accountPortal && !accountTenantMatches) {
    return (
      <Panel
        title="Account Access"
        icon={<UserRound size={18} />}
        actions={<UserButton />}
      >
        <div className="grid gap-2 p-4 text-sm">
          <StatusBadge tone="warning">Different tenant</StatusBadge>
          <p className="text-muted-foreground">
            This login is already linked to another tenant portal.
          </p>
          <p className="text-muted-foreground">
            Sign out and choose the login for {tokenTenantName ?? "this tenant"},
            or ask the property team to unlink and relink this account.
          </p>
          <p className="text-xs text-muted-foreground">{tokenExpiryCopy}</p>
        </div>
      </Panel>
    );
  }

  if (accountPortal && accountTenantMatches) {
    return (
      <Panel
        title="Account Access"
        icon={<UserRound size={18} />}
        actions={<UserButton />}
      >
        <div className="grid gap-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="success">Account linked</StatusBadge>
            <span className="text-muted-foreground">
              {user?.primaryEmailAddress?.emailAddress ??
                user?.fullName ??
                "Signed in"}
            </span>
          </div>
          <p className="text-muted-foreground">
            Future portal sessions can use this tenant account boundary, even
            after the original portal link expires.
          </p>
          {accountStatus?.recovery_action === "restored" &&
          accountStatus.recovery_at ? (
            <p className="text-xs text-muted-foreground">
              Access restored by the property team{" "}
              {formatDateTime(accountStatus.recovery_at)}.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            If this account should move to another tenant, ask the property team
            to unlink it before relinking.
          </p>
        </div>
      </Panel>
    );
  }

  if (!token) {
    return (
      <Panel
        title="Account Access"
        icon={<UserRound size={18} />}
        actions={<UserButton />}
      >
        <div className="grid gap-2 p-4 text-sm">
          <StatusBadge tone="warning">No portal linked</StatusBadge>
          <p className="text-muted-foreground">
            Open your original tenant portal link once to connect this login.
          </p>
          <p className="text-xs text-muted-foreground">
            {accountStatus?.recovery_hint ??
              "If the link expired or was lost, ask the property team for a fresh tenant portal link."}
          </p>
          {accountStatus?.recovery_at ? (
            <p className="text-xs text-muted-foreground">
              Staff recovery updated {formatDateTime(accountStatus.recovery_at)}
            </p>
          ) : null}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Account Access"
      icon={<UserRound size={18} />}
      actions={<UserButton />}
    >
      <div className="grid gap-3 p-4 text-sm">
        <p className="text-muted-foreground">
          Link this portal to your signed-in tenant account.
        </p>
        <p className="text-xs text-muted-foreground">
          {tokenExpiryCopy} Once linked, you can come back through the tenant
          portal entry without the original invite link.
        </p>
        {claimMutation.error ? (
          <div className="grid gap-1 rounded-md border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
            <span>{claimMutation.error.message}</span>
            <span className="text-muted-foreground">
              {accountStatus?.status === "revoked"
                ? accountStatus.recovery_hint
                : "If this is the wrong tenant or the link has expired, ask the property team to send a fresh portal link."}
            </span>
          </div>
        ) : null}
        <Button
          type="button"
          onClick={() => claimMutation.mutate()}
          disabled={claimMutation.isPending}
        >
          {claimMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Link2 size={16} />
          )}
          Link portal
        </Button>
      </div>
    </Panel>
  );
}

function TenantPortalContent({ token }: { token: string | null }) {
  const portalQuery = useQuery({
    queryKey: ["tenant-portal", token],
    queryFn: () => {
      if (!token) {
        throw new Error("Tenant portal token is required.");
      }
      return getTenantPortal(token);
    },
    enabled: Boolean(token),
  });
  const [accountPortal, setAccountPortal] = useState<TenantPortalRecord | null>(
    null,
  );
  const [accountAuthToken, setAccountAuthToken] = useState<string | null>(null);
  const handleAccountPortal = useCallback(
    (nextPortal: TenantPortalRecord | null, nextAuthToken: string | null) => {
      setAccountPortal(nextPortal);
      setAccountAuthToken(nextPortal ? nextAuthToken : null);
    },
    [],
  );
  const tokenPortal = portalQuery.data;
  const portal = accountPortal ?? tokenPortal;
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] =
    useState<DocumentCategory>("insurance");
  const [uploadNotes, setUploadNotes] = useState("");
  const [maintenanceTitle, setMaintenanceTitle] = useState("");
  const [maintenancePriority, setMaintenancePriority] =
    useState<MaintenancePriority>("normal");
  const [maintenanceDescription, setMaintenanceDescription] = useState("");
  const [maintenanceSourceReference, setMaintenanceSourceReference] =
    useState("");
  const [maintenancePhotoFile, setMaintenancePhotoFile] = useState<File | null>(
    null,
  );
  const [maintenancePhotoInputKey, setMaintenancePhotoInputKey] = useState(0);
  const tenantAccountAuthEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  const accountScoped = portal?.auth.mode === "tenant_portal_account";

  useEffect(() => {
    handleAccountPortal(null, null);
  }, [handleAccountPortal, token]);

  const refreshPortal = useCallback(() => {
    if (
      accountAuthToken &&
      accountPortal?.auth.mode === "tenant_portal_account"
    ) {
      return getTenantPortalAccountSession(accountAuthToken)
        .then((nextPortal) => setAccountPortal(nextPortal))
        .catch(() => portalQuery.refetch());
    }
    return portalQuery.refetch();
  }, [accountAuthToken, accountPortal?.auth.mode, portalQuery]);

  useEffect(() => {
    if (
      !portal ||
      portal.compliance.accepted_categories.includes(uploadCategory)
    ) {
      return;
    }
    setUploadCategory(portal.compliance.accepted_categories[0] ?? "insurance");
  }, [portal, uploadCategory]);

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!uploadFile) {
        throw new Error("Choose a file first.");
      }
      if (accountAuthToken && accountScoped) {
        return uploadTenantPortalAccountDocument({
          category: uploadCategory,
          notes: uploadNotes,
          file: uploadFile,
          authToken: accountAuthToken,
        });
      }
      if (!token) {
        throw new Error("Sign in to a linked tenant account before uploading.");
      }
      return uploadTenantPortalDocument({
        token,
        category: uploadCategory,
        notes: uploadNotes,
        file: uploadFile,
      });
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadNotes("");
      refreshPortal();
    },
  });

  const maintenanceMutation = useMutation({
    mutationFn: async () => {
      const title = maintenanceTitle.trim();
      const description = maintenanceDescription.trim();
      const payload: TenantPortalMaintenanceRequestPayload = {
        title,
        description,
        priority: maintenancePriority,
        source_reference: maintenanceSourceReference.trim() || null,
      };
      if (!payload.title || !payload.description) {
        throw new Error("Add a title and details before submitting.");
      }

      if (maintenancePhotoFile) {
        const notes = `Maintenance photo: ${title}`;
        const document =
          accountAuthToken && accountScoped
            ? await uploadTenantPortalAccountDocument({
                category: "other",
                notes,
                file: maintenancePhotoFile,
                authToken: accountAuthToken,
              })
            : token
              ? await uploadTenantPortalDocument({
                  token,
                  category: "other",
                  notes,
                  file: maintenancePhotoFile,
                })
              : null;
        if (!document) {
          throw new Error(
            "Sign in to a linked tenant account before submitting.",
          );
        }
        payload.photo_document_ids = [document.id];
      }

      if (accountAuthToken && accountScoped) {
        return createTenantPortalAccountMaintenanceRequest(
          payload,
          accountAuthToken,
        );
      }
      if (!token) {
        throw new Error(
          "Sign in to a linked tenant account before submitting.",
        );
      }
      return createTenantPortalMaintenanceRequest(token, payload);
    },
    onSuccess: () => {
      setMaintenanceTitle("");
      setMaintenancePriority("normal");
      setMaintenanceDescription("");
      setMaintenanceSourceReference("");
      setMaintenancePhotoFile(null);
      setMaintenancePhotoInputKey((current) => current + 1);
      refreshPortal();
    },
  });

  const visibleCategories = useMemo(
    () =>
      (portal?.compliance.accepted_categories ?? []).filter(
        (category) => category !== "invoice",
      ),
    [portal?.compliance.accepted_categories],
  );
  const openMaintenanceCount = useMemo(
    () =>
      (portal?.maintenance_requests ?? []).filter(
        (request) => !["completed", "cancelled"].includes(request.status),
      ).length,
    [portal?.maintenance_requests],
  );

  const documentDownloadMutation = useMutation({
    mutationFn: async ({
      documentId,
      filename,
    }: {
      documentId: string;
      filename: string;
    }) => {
      if (!accountAuthToken) {
        throw new Error("Sign in to download this document.");
      }
      const blob = await downloadTenantPortalAccountDocument(
        documentId,
        accountAuthToken,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    },
  });

  if (!token && !portal) {
    return (
      <PortalShell>
        <div className="mx-auto grid max-w-xl gap-5 px-5 py-8">
          <section className="rounded-md border border-border bg-white p-5">
            <p className="text-sm font-medium text-primary">Tenant Portal</p>
            <h2 className="mt-1 text-2xl font-semibold">Open your portal</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with the tenant login linked to your Leasium portal.
            </p>
          </section>
          {tenantAccountAuthEnabled ? (
            <TenantAccountPanel
              token={null}
              tokenTenantId={null}
              tokenTenantName={null}
              tokenExpiresAt={null}
              onAccountPortal={handleAccountPortal}
            />
          ) : (
            <Panel title="Account Access" icon={<UserRound size={18} />}>
              <div className="grid gap-2 p-4 text-sm">
                <StatusBadge tone="warning">
                  Tenant login not configured
                </StatusBadge>
                <p className="text-muted-foreground">
                  Ask the property team for your tenant portal link.
                </p>
              </div>
            </Panel>
          )}
        </div>
      </PortalShell>
    );
  }

  if (portalQuery.isLoading && !portal) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <Loader2 className="animate-spin text-primary" size={28} />
      </main>
    );
  }

  if ((portalQuery.error && !accountPortal) || !portal) {
    return (
      <PortalShell>
        <div className="grid min-h-[70vh] place-items-center px-5 py-8">
          <div className="max-w-md rounded-md border border-border bg-white p-6 text-center">
            <LeasiumMark className="mx-auto mb-4" />
            <h2 className="text-lg font-semibold">Portal unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask the property team for a fresh tenant portal link.
            </p>
          </div>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
        <section className="rounded-md border border-border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-primary">Tenant Portal</p>
              <h2 className="mt-1 text-2xl font-semibold">
                {portal.tenant.trading_name || portal.tenant.legal_name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {portal.lease.property_name} - {portal.lease.unit_label}
              </p>
            </div>
            <div className="grid gap-2 text-right">
              <StatusBadge
                tone={portal.auth.dev_fallback ? "warning" : "primary"}
              >
                {portalScopeLabel(portal)}
              </StatusBadge>
              <span className="text-xs text-muted-foreground">
                {portal.auth.boundary}
              </span>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="Onboarding"
            value={label(portal.onboarding.status)}
            detail={
              portal.onboarding.submitted_at
                ? `Submitted ${formatDateTime(portal.onboarding.submitted_at)}`
                : portal.onboarding.due_date
                  ? `Due ${formatDate(portal.onboarding.due_date)}`
                  : undefined
            }
          />
          <Metric
            label="Outstanding"
            value={formatMoney(portal.payment_summary.outstanding_cents)}
            detail={`${portal.payment_summary.invoice_count} invoice${
              portal.payment_summary.invoice_count === 1 ? "" : "s"
            }`}
          />
          <Metric
            label="Next Due"
            value={formatDate(portal.payment_summary.next_due_date)}
            detail={label(portal.payment_summary.status)}
          />
          <Metric
            label="Documents"
            value={String(portal.compliance.uploaded_documents.length)}
            detail="Tenant files"
          />
          <Metric
            label="Maintenance"
            value={String(portal.maintenance_requests.length)}
            detail="Submitted requests"
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-5">
            <Panel
              title="Payments"
              icon={<ReceiptText size={18} />}
              actions={
                <StatusBadge tone={paymentTone(portal.payment_summary.status)}>
                  {label(portal.payment_summary.status)}
                </StatusBadge>
              }
            >
              <div className="grid gap-3 p-4">
                {portal.invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate font-semibold">
                          {invoice.invoice_number ?? invoice.title}
                        </div>
                        <StatusBadge
                          tone={
                            invoice.outstanding_cents ? "warning" : "success"
                          }
                        >
                          {label(invoice.payment_status)}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Due {formatDate(invoice.due_date)} - Total{" "}
                        {formatMoney(invoice.total_cents, invoice.currency)}
                      </div>
                      {invoice.invoice_number ? (
                        <div className="mt-1 text-sm">{invoice.title}</div>
                      ) : null}
                      {invoice.lines.length ? (
                        <div className="mt-3 grid gap-1 text-sm">
                          {invoice.lines.map((line) => (
                            <div
                              key={line.id}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="truncate">
                                {line.description}
                              </span>
                              <span className="shrink-0">
                                {formatMoney(
                                  line.amount_cents + line.gst_cents,
                                  line.currency,
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="grid content-start justify-items-end gap-2 text-sm">
                      <div className="font-semibold">
                        {formatMoney(
                          invoice.outstanding_cents,
                          invoice.currency,
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatMoney(invoice.paid_cents, invoice.currency)} paid
                      </div>
                      {invoice.pdf_document_id && accountScoped ? (
                        <button
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                          type="button"
                          disabled={documentDownloadMutation.isPending}
                          onClick={() =>
                            documentDownloadMutation.mutate({
                              documentId: invoice.pdf_document_id ?? "",
                              filename: `${invoice.invoice_number ?? invoice.title}.pdf`,
                            })
                          }
                        >
                          <Download size={15} />
                          PDF
                        </button>
                      ) : invoice.pdf_document_id && token ? (
                        <a
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold hover:bg-muted"
                          href={tenantPortalDocumentDownloadUrl(
                            token,
                            invoice.pdf_document_id,
                          )}
                        >
                          <Download size={15} />
                          PDF
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!portal.invoices.length ? (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                    No approved invoices are available.
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel
              title="Maintenance"
              icon={<Wrench size={18} />}
              actions={
                <StatusBadge
                  tone={openMaintenanceCount ? "primary" : "neutral"}
                >
                  {openMaintenanceCount} open
                </StatusBadge>
              }
            >
              <div className="grid gap-4 p-4">
                <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                    <Field label="Request title">
                      <Input
                        value={maintenanceTitle}
                        onChange={(event) =>
                          setMaintenanceTitle(event.target.value)
                        }
                        placeholder="Air conditioning fault"
                      />
                    </Field>
                    <Field label="Priority">
                      <Select
                        value={maintenancePriority}
                        onChange={(event) =>
                          setMaintenancePriority(
                            event.target.value as MaintenancePriority,
                          )
                        }
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Details">
                    <textarea
                      className="min-h-28 w-full resize-y rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition duration-200 ease-leasium focus:border-primary focus:ring-2 focus:ring-primary/15"
                      value={maintenanceDescription}
                      onChange={(event) =>
                        setMaintenanceDescription(event.target.value)
                      }
                      placeholder="What is happening, where is it, and when did it start?"
                    />
                  </Field>
                  <Field label="Location or reference">
                    <Input
                      value={maintenanceSourceReference}
                      onChange={(event) =>
                        setMaintenanceSourceReference(event.target.value)
                      }
                      placeholder="Front counter, rear entry, invoice reference..."
                    />
                  </Field>
                  <Field label="Photo">
                    <div className="grid gap-2">
                      <Input
                        key={maintenancePhotoInputKey}
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setMaintenancePhotoFile(
                            event.target.files?.[0] ?? null,
                          )
                        }
                      />
                      {maintenancePhotoFile ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <ImagePlus
                              size={15}
                              className="shrink-0 text-primary"
                            />
                            <span className="truncate">
                              {maintenancePhotoFile.name}
                            </span>
                          </span>
                          <SecondaryButton
                            type="button"
                            onClick={() => {
                              setMaintenancePhotoFile(null);
                              setMaintenancePhotoInputKey(
                                (current) => current + 1,
                              );
                            }}
                          >
                            <X size={15} />
                            Clear
                          </SecondaryButton>
                        </div>
                      ) : null}
                    </div>
                  </Field>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {maintenanceMutation.error ? (
                      <span className="text-sm text-danger">
                        {maintenanceMutation.error.message}
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => maintenanceMutation.mutate()}
                      disabled={maintenanceMutation.isPending}
                    >
                      {maintenanceMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}
                      Submit request
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  {portal.maintenance_requests.map((request) => (
                    <div
                      key={request.id}
                      className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate font-semibold">
                            {request.title}
                          </div>
                          <StatusBadge tone={maintenanceTone(request.status)}>
                            {label(request.status)}
                          </StatusBadge>
                          <StatusBadge tone={priorityTone(request.priority)}>
                            {label(request.priority)}
                          </StatusBadge>
                        </div>
                        {request.description ? (
                          <div className="mt-2 text-sm text-muted-foreground">
                            {request.description}
                          </div>
                        ) : null}
                        {request.source_reference ? (
                          <div className="mt-2 text-sm">
                            {request.source_reference}
                          </div>
                        ) : null}
                        {request.history.length ? (
                          <div className="mt-3 grid gap-2 rounded-md border border-border bg-muted/30 p-2">
                            {request.history.map((entry, index) => (
                              <div
                                key={`${request.id}-${entry.event}-${entry.timestamp}-${index}`}
                                className="grid gap-1 text-xs"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">
                                    {maintenanceEventLabel(entry.event)}
                                  </span>
                                  {entry.status ? (
                                    <StatusBadge
                                      tone={maintenanceTone(entry.status)}
                                    >
                                      {label(entry.status)}
                                    </StatusBadge>
                                  ) : null}
                                  <span className="text-muted-foreground">
                                    {formatDateTime(entry.timestamp)}
                                  </span>
                                </div>
                                <div className="text-muted-foreground">
                                  {entry.summary}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid content-start justify-items-end gap-1 text-xs text-muted-foreground">
                        <span>
                          Requested {formatDateTime(request.requested_at)}
                        </span>
                        {request.completed_at ? (
                          <span>
                            Completed {formatDateTime(request.completed_at)}
                          </span>
                        ) : null}
                        {request.document_ids.length ||
                        request.photo_document_ids.length ? (
                          <span>
                            {request.document_ids.length +
                              request.photo_document_ids.length}{" "}
                            file
                            {request.document_ids.length +
                              request.photo_document_ids.length ===
                            1
                              ? ""
                              : "s"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!portal.maintenance_requests.length ? (
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                      No maintenance requests are open.
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>

            <Panel title="Compliance" icon={<ShieldCheck size={18} />}>
              <div className="grid gap-3 p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  {portal.compliance.items.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-md border border-border p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold">{item.label}</div>
                        <StatusBadge tone={complianceTone(item.status)}>
                          {label(item.status)}
                        </StatusBadge>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {item.document_count} file
                        {item.document_count === 1 ? "" : "s"}
                        {item.due_date ? ` - ${formatDate(item.due_date)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                  <Field label="Document">
                    <Input
                      type="file"
                      onChange={(event) =>
                        setUploadFile(event.target.files?.[0] ?? null)
                      }
                    />
                  </Field>
                  <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                    <Field label="Type">
                      <Select
                        value={uploadCategory}
                        onChange={(event) =>
                          setUploadCategory(
                            event.target.value as DocumentCategory,
                          )
                        }
                      >
                        {visibleCategories.map((category) => (
                          <option key={category} value={category}>
                            {categoryLabels[category]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Notes">
                      <Input
                        value={uploadNotes}
                        onChange={(event) => setUploadNotes(event.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {uploadMutation.error ? (
                      <span className="text-sm text-danger">
                        {uploadMutation.error.message}
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => uploadMutation.mutate()}
                      disabled={!uploadFile || uploadMutation.isPending}
                    >
                      {uploadMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <UploadCloud size={16} />
                      )}
                      Upload
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  {portal.compliance.uploaded_documents.map((document) =>
                    accountScoped ? (
                      <button
                        key={document.id}
                        aria-label={`Download ${document.filename}`}
                        className="grid gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                        type="button"
                        disabled={documentDownloadMutation.isPending}
                        onClick={() =>
                          documentDownloadMutation.mutate({
                            documentId: document.id,
                            filename: document.filename,
                          })
                        }
                      >
                        <TenantDocumentSummary document={document} />
                      </button>
                    ) : token ? (
                      <a
                        key={document.id}
                        aria-label={`Download ${document.filename}`}
                        className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                        href={tenantPortalDocumentDownloadUrl(
                          token,
                          document.id,
                        )}
                      >
                        <TenantDocumentSummary document={document} />
                      </a>
                    ) : null,
                  )}
                  {documentDownloadMutation.error ? (
                    <span className="text-sm text-danger">
                      {documentDownloadMutation.error.message}
                    </span>
                  ) : null}
                  {!portal.compliance.uploaded_documents.length ? (
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                      No tenant documents are available.
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>
          </div>

          <aside className="grid content-start gap-5">
            <Panel title="Lease" icon={<Building2 size={18} />}>
              <dl className="grid gap-3 p-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Property</dt>
                  <dd className="font-medium">{portal.lease.property_name}</dd>
                  {portal.lease.property_address ? (
                    <dd className="text-muted-foreground">
                      {portal.lease.property_address}
                    </dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-muted-foreground">Unit</dt>
                  <dd className="font-medium">{portal.lease.unit_label}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Lease dates</dt>
                  <dd className="font-medium">
                    {formatDate(portal.lease.commencement_date)} to{" "}
                    {formatDate(portal.lease.expiry_date)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Next review</dt>
                  <dd className="font-medium">
                    {formatDate(portal.lease.next_review_date)}
                  </dd>
                </div>
              </dl>
            </Panel>

            {tenantAccountAuthEnabled ? (
              <TenantAccountPanel
                token={token}
                tokenTenantId={tokenPortal?.tenant.id ?? null}
                tokenTenantName={
                  tokenPortal ? tenantDisplayName(tokenPortal.tenant) : null
                }
                tokenExpiresAt={tokenPortal?.onboarding.expires_at ?? null}
                onAccountPortal={handleAccountPortal}
              />
            ) : null}

            <PreferencesForm
              token={token}
              portal={portal}
              accountAuthToken={
                portal.auth.mode === "tenant_portal_account"
                  ? accountAuthToken
                  : null
              }
              onSaved={refreshPortal}
            />

            <Panel
              title="Access Boundary"
              icon={<ShieldCheck size={18} />}
              actions={
                <StatusBadge
                  tone={portal.auth.dev_fallback ? "warning" : "primary"}
                >
                  {label(portal.auth.mode)}
                </StatusBadge>
              }
            >
              <div className="grid gap-2 p-4 text-sm text-muted-foreground">
                <p>{portal.auth.detail}</p>
                {portal.guardrails.map((guardrail) => (
                  <p key={guardrail}>{guardrail}</p>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </PortalShell>
  );
}
