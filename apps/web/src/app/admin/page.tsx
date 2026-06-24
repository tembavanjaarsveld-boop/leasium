"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Loader2,
  Mail,
  PlugZap,
  Plus,
  ShieldCheck,
  ShieldHalf,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { IntegrationsHealthCard } from "@/components/integrations-health-card";
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
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  createPlatformOrganisation,
  createPlatformOrganisationMember,
  getApiHealth,
  getIntegrationStatus,
  listPlatformMailboxAliases,
  listPlatformOrganisationMembers,
  listPlatformOrganisations,
  reservePlatformMailboxAlias,
  resendPlatformOrganisationMemberInvite,
  setPlatformOrganisationActive,
  setPlatformOrganisationOperatingMode,
  updatePlatformMailboxAlias,
  type MailboxAliasRecord,
  updatePlatformOrganisationMember,
  type OperatingMode,
  type PlatformOrganisationRecord,
  type SecurityMemberRecord,
} from "@/lib/api";
import { usePlatformAdmin } from "@/lib/use-platform-admin";

type AdminTab = "clients" | "aliases" | "integrations";

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: "clients", label: "Clients" },
  { id: "aliases", label: "Mailbox aliases" },
  { id: "integrations", label: "Platform integrations" },
];

const OPERATING_MODE_OPTIONS: Array<{ value: OperatingMode; label: string }> = [
  { value: "self_managed_owner", label: "Self-managed owner" },
  { value: "managing_agent", label: "Managing agent" },
  { value: "hybrid", label: "Hybrid" },
];

function accessStatusBadge(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case "login_linked":
      return { label: "Login linked", tone: "success" };
    case "invited":
      return { label: "Invited", tone: "warning" };
    case "disabled":
      return { label: "Disabled", tone: "danger" };
    case "not_linked":
      return { label: "Not linked", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

function ProvisionClientForm() {
  const queryClient = useQueryClient();
  const [organisationName, setOrganisationName] = useState("");
  const [countryCode, setCountryCode] = useState("AU");
  const [timezone, setTimezone] = useState("Australia/Brisbane");
  const [operatorEmail, setOperatorEmail] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createPlatformOrganisation({
        organisation_name: organisationName.trim(),
        operator_email: operatorEmail.trim(),
        operator_display_name: operatorName.trim(),
        country_code: countryCode.trim().toUpperCase(),
        timezone: timezone.trim(),
      }),
    onSuccess: (result) => {
      setReceipt(
        `Created ${result.organisation.name}. ${result.delivery_detail ?? "First-operator invite recorded."}`,
      );
      setOrganisationName("");
      setOperatorEmail("");
      setOperatorName("");
      void queryClient.invalidateQueries({
        queryKey: ["platform-organisations"],
      });
    },
  });

  const canSubmit =
    organisationName.trim().length > 0 &&
    operatorEmail.trim().length > 0 &&
    operatorName.trim().length > 0 &&
    !mutation.isPending;

  return (
    <SectionPanel
      title="Provision client"
      description="Create a client organisation and invite its first operator. The invite is recorded for review-first delivery — no provider send fires here."
      icon={<UserPlus size={17} className="text-primary" />}
    >
      <form
        className="grid gap-3 p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            mutation.mutate();
          }
        }}
      >
        <Field label="Organisation name">
          <Input
            value={organisationName}
            onChange={(event) => setOrganisationName(event.target.value)}
            placeholder="Harbour Lane Holdings"
            required
          />
        </Field>
        <Field label="Country code">
          <Input
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            placeholder="AU"
            maxLength={2}
            required
          />
        </Field>
        <Field label="Timezone">
          <Input
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Australia/Brisbane"
            required
          />
        </Field>
        <Field label="First operator email">
          <Input
            type="email"
            value={operatorEmail}
            onChange={(event) => setOperatorEmail(event.target.value)}
            placeholder="owner@client.example"
            required
          />
        </Field>
        <Field label="First operator name">
          <Input
            value={operatorName}
            onChange={(event) => setOperatorName(event.target.value)}
            placeholder="Client Owner"
            required
          />
        </Field>
        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!canSubmit}>
            {mutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <UserPlus size={14} />
            )}
            Provision client
          </Button>
          {mutation.isError ? (
            <span className="text-xs text-danger" role="alert">
              {(mutation.error as Error).message}
            </span>
          ) : null}
          {receipt ? (
            <span className="text-xs text-muted-foreground" role="status">
              {receipt}
            </span>
          ) : null}
        </div>
      </form>
    </SectionPanel>
  );
}

function ClientOperatorsPanel({
  organisation,
}: {
  organisation: PlatformOrganisationRecord;
}) {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ["platform-organisation-members", organisation.id],
    queryFn: () => listPlatformOrganisationMembers(organisation.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["platform-organisation-members", organisation.id],
    });
    void queryClient.invalidateQueries({ queryKey: ["platform-organisations"] });
  };

  const addMember = useMutation({
    mutationFn: () =>
      createPlatformOrganisationMember(organisation.id, {
        email: inviteEmail.trim(),
        display_name: inviteName.trim(),
      }),
    onSuccess: (result) => {
      setReceipt(
        `Invited ${result.member.email}. ${result.delivery_detail ?? result.member.invite_email_detail}`,
      );
      setInviteEmail("");
      setInviteName("");
      invalidate();
    },
  });

  const resendInvite = useMutation({
    mutationFn: (memberId: string) =>
      resendPlatformOrganisationMemberInvite(organisation.id, memberId),
    onSuccess: (result) => {
      setReceipt(
        `Re-sent invite to ${result.member.email}. ${result.delivery_detail ?? ""}`.trim(),
      );
      invalidate();
    },
  });

  const setMemberActive = useMutation({
    mutationFn: ({
      memberId,
      isActive,
    }: {
      memberId: string;
      isActive: boolean;
    }) =>
      updatePlatformOrganisationMember(organisation.id, memberId, {
        is_active: isActive,
      }),
    onSuccess: (result) => {
      setReceipt(
        `${result.member.email} is now ${result.member.is_active ? "enabled" : "disabled"}.`,
      );
      invalidate();
    },
  });

  const members = membersQuery.data ?? [];
  const canInvite =
    inviteEmail.trim().length > 0 &&
    inviteName.trim().length > 0 &&
    !addMember.isPending;

  return (
    <SectionPanel
      title={`Operators · ${organisation.name}`}
      description="Add or invite operators, resend a pending invite, or disable access. Invites are recorded for review-first delivery."
      icon={<UsersRound size={17} className="text-primary" />}
    >
      <div className="grid gap-3 p-4">
        <form
          className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (canInvite) {
              addMember.mutate();
            }
          }}
        >
          <Field label="Operator email">
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="operator@client.example"
            />
          </Field>
          <Field label="Operator name">
            <Input
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              placeholder="New Operator"
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={!canInvite}>
              {addMember.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <UserPlus size={14} />
              )}
              Invite operator
            </Button>
          </div>
        </form>
        {addMember.isError ? (
          <span className="text-xs text-danger" role="alert">
            {(addMember.error as Error).message}
          </span>
        ) : null}
        {receipt ? (
          <span className="text-xs text-muted-foreground" role="status">
            {receipt}
          </span>
        ) : null}

        {membersQuery.isLoading ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Loading operators.
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon={<UsersRound size={18} />}
            title="No operators yet"
            description="Invite the first operator for this client."
          />
        ) : (
          <ul className="grid gap-2">
            {members.map((member: SecurityMemberRecord) => {
              const badge = accessStatusBadge(member.access_status);
              return (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-white p-3 text-sm"
                >
                  <div className="grid gap-0.5">
                    <span className="font-semibold">{member.display_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    {!member.login_linked ? (
                      <SecondaryButton
                        type="button"
                        className="min-h-11 rounded-md px-2.5 text-xs"
                        disabled={resendInvite.isPending}
                        onClick={() => resendInvite.mutate(member.id)}
                      >
                        Resend invite
                      </SecondaryButton>
                    ) : null}
                    <SecondaryButton
                      type="button"
                      className="min-h-11 rounded-md px-2.5 text-xs"
                      disabled={setMemberActive.isPending}
                      onClick={() =>
                        setMemberActive.mutate({
                          memberId: member.id,
                          isActive: !member.is_active,
                        })
                      }
                    >
                      {member.is_active ? "Disable" : "Enable"}
                    </SecondaryButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionPanel>
  );
}

function ClientsTab() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const organisationsQuery = useQuery({
    queryKey: ["platform-organisations"],
    queryFn: listPlatformOrganisations,
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setPlatformOrganisationActive(id, isActive),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["platform-organisations"],
      });
    },
  });

  const setMode = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: OperatingMode }) =>
      setPlatformOrganisationOperatingMode(id, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["platform-organisations"],
      });
    },
  });

  const organisations = organisationsQuery.data ?? [];

  return (
    <div className="grid gap-5">
      <ProvisionClientForm />
      <SectionPanel
        title="Clients"
        description="Every client organisation Relby hosts, with its operating mode, status, and first-operator access."
        icon={<Building2 size={17} className="text-primary" />}
      >
        <div className="grid gap-3 p-4">
          {organisationsQuery.isLoading ? (
            <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
              Loading clients.
            </div>
          ) : organisations.length === 0 ? (
            <EmptyState
              icon={<Building2 size={18} />}
              title="No clients yet"
              description="Provision the first client to get started."
            />
          ) : (
            <ul className="grid gap-2">
              {organisations.map((org) => (
                <li
                  key={org.id}
                  className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid gap-0.5">
                      <span className="font-semibold">{org.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {org.operator_count}{" "}
                        {org.operator_count === 1 ? "operator" : "operators"}
                        {org.first_operator_email
                          ? ` · ${org.first_operator_email}`
                          : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={org.is_active ? "success" : "danger"}>
                        {org.is_active ? "Active" : "Suspended"}
                      </StatusBadge>
                      <Select
                        aria-label={`Operating mode for ${org.name}`}
                        className="w-auto rounded-md text-xs"
                        value={org.operating_mode}
                        disabled={setMode.isPending}
                        onChange={(event) =>
                          setMode.mutate({
                            id: org.id,
                            mode: event.target.value as OperatingMode,
                          })
                        }
                      >
                        {OPERATING_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                      <SecondaryButton
                        type="button"
                        className="min-h-11 rounded-md px-2.5 text-xs"
                        disabled={setActive.isPending}
                        onClick={() =>
                          setActive.mutate({
                            id: org.id,
                            isActive: !org.is_active,
                          })
                        }
                      >
                        {org.is_active ? "Suspend" : "Restore"}
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        className="min-h-11 rounded-md px-2.5 text-xs"
                        onClick={() =>
                          setExpandedId((current) =>
                            current === org.id ? null : org.id,
                          )
                        }
                        aria-expanded={expandedId === org.id}
                      >
                        {expandedId === org.id
                          ? "Hide operators"
                          : "Manage operators"}
                      </SecondaryButton>
                    </div>
                  </div>
                  {expandedId === org.id ? (
                    <ClientOperatorsPanel organisation={org} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionPanel>
    </div>
  );
}

function mailboxAliasStatusTone(status: MailboxAliasRecord["status"]) {
  return status === "active" ? "success" : "neutral";
}

function MailboxAliasesTab() {
  const queryClient = useQueryClient();
  const [organisationId, setOrganisationId] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [label, setLabel] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

  const organisationsQuery = useQuery({
    queryKey: ["platform-organisations"],
    queryFn: listPlatformOrganisations,
  });
  const aliasesQuery = useQuery({
    queryKey: ["platform-mailbox-aliases"],
    queryFn: () => listPlatformMailboxAliases(),
  });

  const organisations = useMemo(
    () => organisationsQuery.data ?? [],
    [organisationsQuery.data],
  );
  const aliases = useMemo(
    () => aliasesQuery.data?.aliases ?? [],
    [aliasesQuery.data?.aliases],
  );
  const organisationById = useMemo(
    () => new Map(organisations.map((org) => [org.id, org.name])),
    [organisations],
  );
  const activeAliasCount = aliases.filter(
    (alias) => alias.status === "active",
  ).length;

  useEffect(() => {
    if (!organisationId && organisations[0]) {
      setOrganisationId(organisations[0].id);
    }
  }, [organisationId, organisations]);

  useEffect(() => {
    setLabelDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const alias of aliases) {
        if (next[alias.id] === undefined) {
          next[alias.id] = alias.label ?? "";
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [aliases]);

  const invalidateAliases = () => {
    void queryClient.invalidateQueries({
      queryKey: ["platform-mailbox-aliases"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["mailbox-aliases-mine"],
    });
  };

  const reserveAlias = useMutation({
    mutationFn: () =>
      reservePlatformMailboxAlias({
        organisation_id: organisationId,
        local_part: localPart.trim(),
        label: label.trim() || null,
      }),
    onSuccess: (alias) => {
      setLocalPart("");
      setLabel("");
      setReceipt(`Reserved ${alias.email_address}.`);
      invalidateAliases();
    },
  });

  const updateAlias = useMutation({
    mutationFn: ({
      aliasId,
      payload,
    }: {
      aliasId: string;
      payload: { status?: MailboxAliasRecord["status"]; label?: string | null };
    }) => updatePlatformMailboxAlias(aliasId, payload),
    onSuccess: (alias) => {
      setReceipt(`Updated ${alias.email_address}.`);
      invalidateAliases();
    },
  });

  const canReserve =
    Boolean(organisationId) &&
    localPart.trim().length > 0 &&
    !reserveAlias.isPending;

  return (
    <div className="grid gap-5">
      <SectionPanel
        title="Mailbox aliases"
        description="Reserve and manage inbox.leasium.ai routing aliases for client organisations. These controls change local routing only."
        icon={<Mail size={17} className="text-primary" />}
        actions={
          <StatusBadge tone={activeAliasCount ? "success" : "neutral"}>
            {activeAliasCount} active
          </StatusBadge>
        }
      >
        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(280px,340px)_1fr]">
          <form
            className="grid content-start gap-3 rounded-md border border-border bg-muted/20 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (canReserve) {
                reserveAlias.mutate();
              }
            }}
          >
            <div className="grid gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reserve client alias
              </p>
              <p className="text-sm leading-5 text-muted-foreground">
                The alias chooses the organisation before sender trust, AI
                review, or attachment promotion.
              </p>
            </div>
            <Field label="Client organisation">
              <Select
                value={organisationId}
                disabled={organisationsQuery.isLoading}
                onChange={(event) => setOrganisationId(event.target.value)}
                required
              >
                {organisations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Alias">
              <div className="flex min-h-11 overflow-hidden rounded-xl border border-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                <input
                  className="min-w-0 flex-1 px-3 text-sm outline-none"
                  value={localPart}
                  pattern="[a-z0-9]([a-z0-9._-]*[a-z0-9])?"
                  placeholder="skj"
                  onChange={(event) =>
                    setLocalPart(event.target.value.toLowerCase())
                  }
                  required
                />
                <span className="flex items-center border-l border-border bg-muted px-3 text-xs font-semibold text-muted-foreground">
                  @inbox.leasium.ai
                </span>
              </div>
            </Field>
            <Field label="Label">
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="SKJ intake"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!canReserve}>
                {reserveAlias.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Reserve alias
              </Button>
              {reserveAlias.isError ? (
                <span className="text-xs text-danger" role="alert">
                  {(reserveAlias.error as Error).message}
                </span>
              ) : null}
            </div>
          </form>

          <div className="grid content-start gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Client mailbox aliases
                </p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Disabled aliases quarantine future mail as evidence and never
                  run AI or extraction.
                </p>
              </div>
            </div>
            {aliasesQuery.isLoading ? (
              <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
                Loading aliases.
              </div>
            ) : aliases.length === 0 ? (
              <EmptyState
                icon={<Mail size={18} />}
                title="No aliases reserved"
                description="Reserve the first client alias before asking operators to forward mail."
              />
            ) : (
              <ul className="grid gap-2">
                {aliases.map((alias) => {
                  const draftLabel = labelDrafts[alias.id] ?? "";
                  const labelChanged = draftLabel !== (alias.label ?? "");
                  const nextStatus =
                    alias.status === "active" ? "disabled" : "active";
                  return (
                    <li
                      key={alias.id}
                      className="grid gap-3 rounded-md border border-border bg-white p-3 text-sm md:grid-cols-[minmax(210px,1fr)_120px_minmax(180px,260px)_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">
                          {organisationById.get(alias.organisation_id) ??
                            "Unknown organisation"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {alias.email_address}
                        </p>
                      </div>
                      <StatusBadge tone={mailboxAliasStatusTone(alias.status)}>
                        {alias.status === "active" ? "Active" : "Disabled"}
                      </StatusBadge>
                      <label className="grid gap-1.5 text-sm">
                        <span className="font-medium text-foreground">
                          Label
                        </span>
                        <Input
                          aria-label={`Label for ${alias.email_address}`}
                          value={draftLabel}
                          onChange={(event) =>
                            setLabelDrafts((current) => ({
                              ...current,
                              [alias.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                        <SecondaryButton
                          type="button"
                          className="min-h-11 rounded-md px-2.5 text-xs"
                          disabled={!labelChanged || updateAlias.isPending}
                          onClick={() =>
                            updateAlias.mutate({
                              aliasId: alias.id,
                              payload: { label: draftLabel.trim() || null },
                            })
                          }
                        >
                          Save label
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          className="min-h-11 rounded-md px-2.5 text-xs"
                          disabled={updateAlias.isPending}
                          onClick={() =>
                            updateAlias.mutate({
                              aliasId: alias.id,
                              payload: { status: nextStatus },
                            })
                          }
                        >
                          {alias.status === "active" ? "Disable" : "Enable"}
                        </SecondaryButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {updateAlias.isError ? (
              <span className="text-xs text-danger" role="alert">
                {(updateAlias.error as Error).message}
              </span>
            ) : null}
          </div>
        </div>
      </SectionPanel>

      <SectionPanel>
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {[
            [
              "Resolve organisation first",
              "Alias routing selects the client before trust checks or AI context loading.",
            ],
            [
              "Trusted sender still required",
              "An active alias never bypasses the SPF/DKIM and allowlist gates.",
            ],
            [
              "No provider mutation",
              "Changing aliases does not send email, apply Smart Intake, move money, or reconcile.",
            ],
          ].map(([title, detail]) => (
            <div
              key={title}
              className="grid gap-2 rounded-md border border-border bg-muted/20 p-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldHalf size={15} className="text-accent-foreground" />
                {title}
              </div>
              <p className="text-sm leading-5 text-muted-foreground">
                {detail}
              </p>
            </div>
          ))}
        </div>
      </SectionPanel>

      {receipt ? (
        <div className="rounded-full bg-accent-soft px-4 py-2 text-center text-sm font-semibold text-accent-foreground">
          {receipt}
        </div>
      ) : null}
    </div>
  );
}

function PlatformIntegrationsTab() {
  const integrationStatusQuery = useQuery({
    queryKey: ["integration-status"],
    queryFn: getIntegrationStatus,
  });
  const apiHealthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: getApiHealth,
    retry: false,
  });

  return (
    <IntegrationsHealthCard
      apiHealth={apiHealthQuery.data}
      integrations={integrationStatusQuery.data}
      isApiHealthLoading={apiHealthQuery.isLoading}
      isLoading={integrationStatusQuery.isLoading}
    />
  );
}

function AdminWorkspace() {
  const { isPlatformAdmin, isResolved } = usePlatformAdmin();
  const [activeTab, setActiveTab] = useState<AdminTab>("clients");

  return (
    <main className="min-h-screen">
      <AppHeader />
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <PageHeader
          title="Platform admin"
          description="Provision and manage Relby client organisations and review platform integration health. No property management lives here."
          actions={
            <StatusBadge tone="primary">
              <ShieldCheck size={13} className="mr-1 inline" />
              Platform tier
            </StatusBadge>
          }
        />
        {!isResolved ? (
          <SectionPanel>
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Checking platform access.
            </div>
          </SectionPanel>
        ) : !isPlatformAdmin ? (
          <SectionPanel>
            <div className="p-4">
              <EmptyState
                icon={<ShieldCheck size={18} />}
                title="Platform admin access required"
                description="This area is for Relby platform administrators. Your operator account does not have platform-admin access."
              />
            </div>
          </SectionPanel>
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Platform admin sections"
              className="flex flex-wrap gap-2"
            >
              {TABS.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.id)}
                    className={
                      active
                        ? "inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary bg-primary-soft px-4 text-sm font-semibold text-primary"
                        : "inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-slate transition hover:bg-muted"
                    }
                  >
                    {tab.id === "clients" ? (
                      <Building2 size={15} />
                    ) : tab.id === "aliases" ? (
                      <Mail size={15} />
                    ) : (
                      <PlugZap size={15} />
                    )}
                    {tab.label}
                  </button>
                );
              })}
            </div>
            {activeTab === "clients" ? <ClientsTab /> : null}
            {activeTab === "aliases" ? <MailboxAliasesTab /> : null}
            {activeTab === "integrations" ? <PlatformIntegrationsTab /> : null}
          </>
        )}
      </div>
    </main>
  );
}

export default function AdminPage() {
  return (
    <QueryProvider>
      <AdminWorkspace />
    </QueryProvider>
  );
}
