"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, RefreshCw, Search, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import { Button, Field, Input, SecondaryButton, Select } from "@/components/ui";
import {
  createTenant,
  deleteTenant,
  listEntities,
  listTenants,
  TenantPayload,
  TenantRecord,
  updateTenant,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type TenantForm = {
  legal_name: string;
  trading_name: string;
  abn: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  billing_email: string;
  notes: string;
};

const emptyForm: TenantForm = {
  legal_name: "",
  trading_name: "",
  abn: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  billing_email: "",
  notes: "",
};

function cleanText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function tenantName(tenant: TenantRecord) {
  return tenant.trading_name
    ? `${tenant.trading_name} (${tenant.legal_name})`
    : tenant.legal_name;
}

function formFromTenant(tenant: TenantRecord): TenantForm {
  return {
    legal_name: tenant.legal_name,
    trading_name: tenant.trading_name ?? "",
    abn: tenant.abn ?? "",
    contact_name: tenant.contact_name ?? "",
    contact_email: tenant.contact_email ?? "",
    contact_phone: tenant.contact_phone ?? "",
    billing_email: tenant.billing_email ?? "",
    notes: tenant.notes ?? "",
  };
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function TenantRegister() {
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [search, setSearch] = useState("");
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null);
  const [form, setForm] = useState<TenantForm>(emptyForm);

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const accessibleIds = new Set((entitiesQuery.data ?? []).map((entity) => entity.id));
    const firstEntity = entitiesQuery.data?.[0]?.id ?? "";
    const next = stored && accessibleIds.has(stored) ? stored : firstEntity;
    if (!selectedEntityId && next) {
      setSelectedEntityId(next);
    }
  }, [entitiesQuery.data, selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    }
  }, [selectedEntityId]);

  const tenantsQuery = useQuery({
    queryKey: ["tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const filteredTenants = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return tenantsQuery.data ?? [];
    }
    return (tenantsQuery.data ?? []).filter((tenant) =>
      [
        tenant.legal_name,
        tenant.trading_name,
        tenant.abn,
        tenant.contact_name,
        tenant.contact_email,
        tenant.billing_email,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [search, tenantsQuery.data]);

  const mutation = useMutation({
    mutationFn: (values: TenantForm) => {
      const payload: TenantPayload = {
        entity_id: selectedEntityId,
        legal_name: values.legal_name.trim(),
        trading_name: cleanText(values.trading_name),
        abn: cleanText(values.abn),
        contact_name: cleanText(values.contact_name),
        contact_email: cleanText(values.contact_email),
        contact_phone: cleanText(values.contact_phone),
        billing_email: cleanText(values.billing_email),
        notes: cleanText(values.notes),
      };
      return editingTenant
        ? updateTenant(editingTenant.id, payload)
        : createTenant(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants", selectedEntityId] });
      setEditingTenant(null);
      setForm(emptyForm);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTenant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants", selectedEntityId] });
      setEditingTenant(null);
      setForm(emptyForm);
    },
  });

  function editTenant(tenant: TenantRecord) {
    setEditingTenant(tenant);
    setForm(formFromTenant(tenant));
  }

  function updateField(field: keyof TenantForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntityId || !form.legal_name.trim()) {
      return;
    }
    mutation.mutate(form);
  }

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          aria-label="Entity"
          value={selectedEntityId}
          onChange={(event) => setSelectedEntityId(event.target.value)}
        >
          <option value="">Select entity</option>
          {entitiesQuery.data?.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Tenants</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {filteredTenants.length} visible tenants
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-72 max-w-full">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search tenants"
                  className="pl-9"
                />
              </div>
              <SecondaryButton
                type="button"
                onClick={() => tenantsQuery.refetch()}
                disabled={!selectedEntityId}
              >
                <RefreshCw size={15} />
                Refresh
              </SecondaryButton>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Tenant</th>
                  <th className="px-3 py-2 font-semibold">Contact</th>
                  <th className="px-3 py-2 font-semibold">Billing</th>
                  <th className="w-12 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map((tenant) => (
                  <tr key={tenant.id} className="border-t border-border align-top">
                    <td className="px-3 py-3">
                      <div className="font-medium">{tenantName(tenant)}</div>
                      <div className="text-xs text-muted-foreground">
                        {tenant.abn ?? "No ABN recorded"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div>{tenant.contact_name ?? "-"}</div>
                      <div className="text-muted-foreground">
                        {tenant.contact_email ?? tenant.contact_phone ?? "-"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {tenant.billing_email ?? tenant.contact_email ?? "-"}
                    </td>
                    <td className="px-3 py-3">
                      <SecondaryButton
                        type="button"
                        aria-label={`Edit ${tenant.legal_name}`}
                        onClick={() => editTenant(tenant)}
                        className="h-8 w-8 px-0"
                      >
                        <UserRound size={15} />
                      </SecondaryButton>
                    </td>
                  </tr>
                ))}
                {!tenantsQuery.isLoading && filteredTenants.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-8 text-center text-muted-foreground"
                      colSpan={4}
                    >
                      No tenants match this view.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-md border border-border bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">
              {editingTenant ? "Edit tenant" : "New tenant"}
            </h3>
            {editingTenant ? (
              <SecondaryButton
                type="button"
                onClick={() => {
                  setEditingTenant(null);
                  setForm(emptyForm);
                }}
                className="h-8 w-8 px-0"
                aria-label="Clear tenant form"
              >
                <X size={15} />
              </SecondaryButton>
            ) : null}
          </div>

          <form className="grid gap-3" onSubmit={submitForm}>
            <Field label="Legal name">
              <Input
                value={form.legal_name}
                onChange={(event) => updateField("legal_name", event.target.value)}
              />
            </Field>
            <Field label="Trading as">
              <Input
                value={form.trading_name}
                onChange={(event) => updateField("trading_name", event.target.value)}
              />
            </Field>
            <Field label="ABN">
              <Input
                value={form.abn}
                onChange={(event) => updateField("abn", event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact">
                <Input
                  value={form.contact_name}
                  onChange={(event) => updateField("contact_name", event.target.value)}
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.contact_phone}
                  onChange={(event) => updateField("contact_phone", event.target.value)}
                />
              </Field>
            </div>
            <Field label="Contact email">
              <Input
                type="email"
                value={form.contact_email}
                onChange={(event) => updateField("contact_email", event.target.value)}
              />
            </Field>
            <Field label="Billing email">
              <Input
                type="email"
                value={form.billing_email}
                onChange={(event) => updateField("billing_email", event.target.value)}
              />
            </Field>
            <Field label="Notes">
              <Input
                value={form.notes}
                onChange={(event) => updateField("notes", event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={
                  !selectedEntityId || !form.legal_name.trim() || mutation.isPending
                }
                className="flex-1"
              >
                {editingTenant ? <Check size={16} /> : <Plus size={16} />}
                {editingTenant ? "Save tenant" : "Add tenant"}
              </Button>
              {editingTenant ? (
                <SecondaryButton
                  type="button"
                  aria-label="Archive tenant"
                  onClick={() => {
                    if (window.confirm(`Archive ${editingTenant.legal_name}?`)) {
                      deleteMutation.mutate(editingTenant.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="h-9 w-9 px-0 text-danger"
                >
                  <Trash2 size={15} />
                </SecondaryButton>
              ) : null}
            </div>
            {mutation.error ? (
              <p className="text-sm text-danger">{friendlyError(mutation.error)}</p>
            ) : null}
            {deleteMutation.error ? (
              <p className="text-sm text-danger">
                {friendlyError(deleteMutation.error)}
              </p>
            ) : null}
            {tenantsQuery.error ? (
              <p className="text-sm text-danger">
                {friendlyError(tenantsQuery.error)}
              </p>
            ) : null}
          </form>
        </aside>
      </div>
    </main>
  );
}

export default function TenantsPage() {
  return (
    <QueryProvider>
      <TenantRegister />
    </QueryProvider>
  );
}
