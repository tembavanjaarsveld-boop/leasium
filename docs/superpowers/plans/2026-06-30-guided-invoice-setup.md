# Guided Invoice Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a guided per-Entity invoice setup flow in Settings with a live sample invoice preview and a Billing Readiness nudge when setup is incomplete.

**Architecture:** Keep the existing `EntityBranding` table and current invoice renderer for this slice. Add a computed readiness contract to the branding API, expose it through frontend API helpers, render a focused `InvoiceBrandingSetup` component inside the existing Settings `Branding` tab, and have Billing Readiness read the same readiness state before tenant-facing document preparation. No provider send, Xero write, payment, or reconciliation path changes.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, Next.js App Router, React, TanStack Query, existing Relby UI primitives, Playwright smoke tests, pytest integration tests.

---

## File Structure

- Modify `apps/api/schemas/branding.py`: add the readiness fields returned to Settings and Billing Readiness.
- Modify `apps/api/routers/entities.py`: compute readiness from `Entity` + `EntityBranding`, and return it from GET/PUT branding endpoints.
- Modify `tests/integration/test_branding_api.py`: lock the readiness contract and provider-inert save behavior.
- Modify `apps/web/src/lib/api.ts`: add `EntityBrandingRecord`, `EntityBrandingUpdatePayload`, `getEntityBranding`, and `updateEntityBranding`.
- Create `apps/web/src/components/invoice-branding-setup.tsx`: focused guided setup UI and sample invoice preview.
- Modify `apps/web/src/app/settings/page.tsx`: fetch/save branding, route `section=branding` into the Branding tab, and render the guided setup.
- Modify `apps/web/src/app/billing-readiness/page.tsx`: fetch per-entity branding readiness and show the `Finish invoice setup` nudge.
- Modify `apps/web/tests/smoke/api-mocks.ts`: add mock branding state and GET/PUT `/entities/{id}/branding`.
- Modify `apps/web/tests/smoke/settings.spec.ts`: cover the guided setup flow and provider guardrail.
- Modify `apps/web/tests/smoke/billing-readiness-ux.spec.ts`: cover the Billing Readiness setup nudge.
- Modify `docs/design-governance.md`: add the UX pass log after implementation screenshots.

## Scope Boundary

First slice includes initials/monogram, accent colour, business address, contact fields, PayID, BPAY, EFT, footer terms, readiness states, and sample preview.

First slice excludes real logo upload, multiple invoice templates, renderer replacement, tenant email send, Xero posting, payment processing, reconciliation, owner statements, and AI-assisted sample invoice import.

---

### Task 1: Backend Readiness Contract

**Files:**
- Modify: `apps/api/schemas/branding.py`
- Modify: `apps/api/routers/entities.py`
- Test: `tests/integration/test_branding_api.py`

- [ ] **Step 1: Write the failing backend readiness tests**

Append these tests to `tests/integration/test_branding_api.py`:

```python
def test_entity_branding_reports_invoice_setup_readiness(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _seed_entity_id(session)

    initial = client.get(f"/api/v1/entities/{entity_id}/branding")
    assert initial.status_code == 200
    assert initial.json()["readiness_status"] == "not_started"
    assert "business_address" in initial.json()["readiness_missing"]
    assert "payment_method" in initial.json()["readiness_missing"]

    saved = client.put(
        f"/api/v1/entities/{entity_id}/branding",
        json={
            "business_address": "Level 2, 144 Edward St, Brisbane QLD 4000",
            "contact_email": "accounts@skjcapital.example",
            "payment_payid": "accounts@skjcapital.example",
            "footer_terms": "Payment due within 14 days.",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["readiness_status"] == "ready"
    assert saved.json()["readiness_missing"] == []


def test_entity_branding_rejects_unknown_entity_for_user(
    client: TestClient,
) -> None:
    missing = client.get("/api/v1/entities/00000000-0000-0000-0000-000000000000/branding")
    assert missing.status_code in {403, 404}
```

- [ ] **Step 2: Run the focused backend tests and confirm RED**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_branding_api.py -q
```

Expected: FAIL with `KeyError: 'readiness_status'` or a Pydantic response validation error because the API does not return readiness fields yet.

- [ ] **Step 3: Extend the branding schemas**

Replace `apps/api/schemas/branding.py` with:

```python
"""Per-entity invoice branding schemas (local config; no provider calls)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


InvoiceBrandingReadiness = Literal["not_started", "needs_details", "ready"]


class EntityBrandingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    accent_color: str | None = None
    business_address: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    payment_payid: str | None = None
    payment_bpay_biller: str | None = None
    payment_bpay_reference: str | None = None
    payment_bank_bsb: str | None = None
    payment_bank_account: str | None = None
    footer_terms: str | None = None
    readiness_status: InvoiceBrandingReadiness = "not_started"
    readiness_missing: list[str] = []


class EntityBrandingUpdate(BaseModel):
    accent_color: str | None = None
    business_address: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    payment_payid: str | None = None
    payment_bpay_biller: str | None = None
    payment_bpay_reference: str | None = None
    payment_bank_bsb: str | None = None
    payment_bank_account: str | None = None
    footer_terms: str | None = None
```

- [ ] **Step 4: Add readiness helpers in the entities router**

In `apps/api/routers/entities.py`, update the branding schema import to include `InvoiceBrandingReadiness`:

```python
from apps.api.schemas.branding import (
    EntityBrandingRead,
    EntityBrandingUpdate,
    InvoiceBrandingReadiness,
)
```

Then add these helpers immediately below `_entity_branding`:

```python
def _has_text(value: str | None) -> bool:
    return bool(value and value.strip())


def _branding_payment_configured(record: EntityBranding | None) -> bool:
    if record is None:
        return False
    return any(
        [
            _has_text(record.payment_payid),
            _has_text(record.payment_bpay_biller),
            _has_text(record.payment_bank_bsb) and _has_text(record.payment_bank_account),
        ]
    )


def _entity_branding_read(entity: Entity, record: EntityBranding | None) -> EntityBrandingRead:
    missing: list[str] = []
    if not _has_text(entity.name):
        missing.append("legal_name")
    if not _has_text(entity.abn):
        missing.append("abn")
    if record is None or not _has_text(record.business_address):
        missing.append("business_address")
    if record is None or not (_has_text(record.contact_email) or _has_text(record.contact_phone)):
        missing.append("contact")
    if not _branding_payment_configured(record):
        missing.append("payment_method")

    if record is None:
        readiness_status: InvoiceBrandingReadiness = "not_started"
        data: dict[str, object] = {}
    else:
        readiness_status = "ready" if not missing else "needs_details"
        data = EntityBrandingRead.model_validate(record).model_dump(
            exclude={"readiness_status", "readiness_missing"}
        )

    return EntityBrandingRead(
        **data,
        readiness_status=readiness_status,
        readiness_missing=missing,
    )
```

- [ ] **Step 5: Return the computed read model from GET and PUT**

In `get_entity_branding`, replace the existing return block with:

```python
    record = _entity_branding(entity.id, session)
    return _entity_branding_read(entity, record)
```

In `update_entity_branding`, replace the final return with:

```python
    return _entity_branding_read(entity, record)
```

- [ ] **Step 6: Run the focused backend tests and confirm GREEN**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_branding_api.py -q
```

Expected: PASS for all branding API tests.

- [ ] **Step 7: Commit backend contract**

Run:

```bash
git add apps/api/schemas/branding.py apps/api/routers/entities.py tests/integration/test_branding_api.py
git commit -m "Add invoice branding readiness contract"
```

---

### Task 2: Frontend API Helpers And Mock API

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/tests/smoke/api-mocks.ts`

- [ ] **Step 1: Add frontend API types and helpers**

In `apps/web/src/lib/api.ts`, add these types near `Entity`:

```ts
export type EntityBrandingReadiness = "not_started" | "needs_details" | "ready";

export type EntityBrandingRecord = {
  accent_color: string | null;
  business_address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  payment_payid: string | null;
  payment_bpay_biller: string | null;
  payment_bpay_reference: string | null;
  payment_bank_bsb: string | null;
  payment_bank_account: string | null;
  footer_terms: string | null;
  readiness_status: EntityBrandingReadiness;
  readiness_missing: string[];
};

export type EntityBrandingUpdatePayload = {
  accent_color?: string | null;
  business_address?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  payment_payid?: string | null;
  payment_bpay_biller?: string | null;
  payment_bpay_reference?: string | null;
  payment_bank_bsb?: string | null;
  payment_bank_account?: string | null;
  footer_terms?: string | null;
};
```

Add these functions after `listEntities()`:

```ts
export function getEntityBranding(entityId: string) {
  return request<EntityBrandingRecord>(`/entities/${entityId}/branding`);
}

export function updateEntityBranding(
  entityId: string,
  payload: EntityBrandingUpdatePayload,
) {
  return request<EntityBrandingRecord>(`/entities/${entityId}/branding`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
```

- [ ] **Step 2: Add mock branding state**

In `apps/web/tests/smoke/api-mocks.ts`, after the `let entities = jsonClone(initialEntities);` line, add:

```ts
const initialEntityBrandingByEntityId: Record<string, Record<string, JsonBody>> = {
  [entityId]: {
    accent_color: "#15565a",
    business_address: null,
    contact_email: null,
    contact_phone: "(07) 3000 0000",
    payment_payid: null,
    payment_bpay_biller: null,
    payment_bpay_reference: null,
    payment_bank_bsb: null,
    payment_bank_account: null,
    footer_terms: "Payment due within 14 days.",
  },
  [secondaryEntityId]: {
    accent_color: null,
    business_address: null,
    contact_email: null,
    contact_phone: null,
    payment_payid: null,
    payment_bpay_biller: null,
    payment_bpay_reference: null,
    payment_bank_bsb: null,
    payment_bank_account: null,
    footer_terms: null,
  },
};
let entityBrandingByEntityId = jsonClone(initialEntityBrandingByEntityId);
```

Inside `mockLeasiumApi`, reset this state beside the existing `entities = jsonClone(initialEntities);` reset:

```ts
  entityBrandingByEntityId = jsonClone(initialEntityBrandingByEntityId);
```

- [ ] **Step 3: Add mock readiness helpers**

Add these helpers above `export async function mockLeasiumApi`:

```ts
function hasMockText(value: JsonBody | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mockEntityBrandingRead(entity: (typeof initialEntities)[number]) {
  const raw = entityBrandingByEntityId[entity.id] ?? {};
  const missing: string[] = [];
  if (!entity.name.trim()) missing.push("legal_name");
  if (!entity.abn?.trim()) missing.push("abn");
  if (!hasMockText(raw.business_address)) missing.push("business_address");
  if (!hasMockText(raw.contact_email) && !hasMockText(raw.contact_phone)) {
    missing.push("contact");
  }
  if (
    !hasMockText(raw.payment_payid) &&
    !hasMockText(raw.payment_bpay_biller) &&
    !(hasMockText(raw.payment_bank_bsb) && hasMockText(raw.payment_bank_account))
  ) {
    missing.push("payment_method");
  }
  const hasAnyBrandingValue = Object.values(raw).some((value) => hasMockText(value));
  return {
    accent_color: typeof raw.accent_color === "string" ? raw.accent_color : null,
    business_address:
      typeof raw.business_address === "string" ? raw.business_address : null,
    contact_email: typeof raw.contact_email === "string" ? raw.contact_email : null,
    contact_phone: typeof raw.contact_phone === "string" ? raw.contact_phone : null,
    payment_payid:
      typeof raw.payment_payid === "string" ? raw.payment_payid : null,
    payment_bpay_biller:
      typeof raw.payment_bpay_biller === "string" ? raw.payment_bpay_biller : null,
    payment_bpay_reference:
      typeof raw.payment_bpay_reference === "string"
        ? raw.payment_bpay_reference
        : null,
    payment_bank_bsb:
      typeof raw.payment_bank_bsb === "string" ? raw.payment_bank_bsb : null,
    payment_bank_account:
      typeof raw.payment_bank_account === "string"
        ? raw.payment_bank_account
        : null,
    footer_terms: typeof raw.footer_terms === "string" ? raw.footer_terms : null,
    readiness_status: missing.length
      ? hasAnyBrandingValue
        ? "needs_details"
        : "not_started"
      : "ready",
    readiness_missing: missing,
  };
}
```

- [ ] **Step 4: Add mock GET/PUT branding routes**

Inside the main `page.route("**/api/v1/**", ...)` handler, after the `/entities` routes and before `/entities/reassign-suggestions`, add:

```ts
    const entityBrandingMatch = path.match(/^\/entities\/([^/]+)\/branding$/);
    if (entityBrandingMatch && method === "GET") {
      const entity = entities.find((candidate) => candidate.id === entityBrandingMatch[1]);
      if (!entity) {
        await fulfillJson(route, { detail: "Entity denied." }, 403);
        return;
      }
      await fulfillJson(route, mockEntityBrandingRead(entity));
      return;
    }

    if (entityBrandingMatch && method === "PUT") {
      const entity = entities.find((candidate) => candidate.id === entityBrandingMatch[1]);
      if (!entity) {
        await fulfillJson(route, { detail: "Entity denied." }, 403);
        return;
      }
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      entityBrandingByEntityId[entity.id] = {
        ...(entityBrandingByEntityId[entity.id] ?? {}),
        ...payload,
      };
      await fulfillJson(route, mockEntityBrandingRead(entity));
      return;
    }
```

- [ ] **Step 5: Run TypeScript to catch helper mistakes**

Run:

```bash
cd apps/web
./node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit frontend API and mocks**

Run:

```bash
git add apps/web/src/lib/api.ts apps/web/tests/smoke/api-mocks.ts
git commit -m "Add invoice branding frontend contract"
```

---

### Task 3: Guided Setup Component

**Files:**
- Create: `apps/web/src/components/invoice-branding-setup.tsx`

- [ ] **Step 1: Create the focused component file**

Create `apps/web/src/components/invoice-branding-setup.tsx` with this structure:

```tsx
"use client";

import { AlertTriangle, CheckCircle2, CreditCard, FileText, Palette } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  Button,
  EmptyState,
  Field,
  Input,
  SecondaryButton,
  StatusBadge,
} from "@/components/ui";
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
  onSave: (payload: EntityBrandingUpdatePayload) => void;
};

type Draft = Required<EntityBrandingUpdatePayload>;

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
  footer_terms: "Payment due within 14 days. Please use the invoice number as your reference.",
};

function valueOrEmpty(value: string | null | undefined) {
  return value ?? "";
}

function draftFromBranding(branding: EntityBrandingRecord | null | undefined): Draft {
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
    footer_terms: valueOrEmpty(branding?.footer_terms) || EMPTY_DRAFT.footer_terms,
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

function readinessLabel(status: EntityBrandingRecord["readiness_status"] | undefined) {
  if (status === "ready") return "Ready";
  if (status === "needs_details") return "Needs details";
  return "Not started";
}

function readinessTone(status: EntityBrandingRecord["readiness_status"] | undefined) {
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
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-4 grid gap-3">{children}</div>
    </div>
  );
}
```

Then add and export the component:

```tsx
export function InvoiceBrandingSetup({
  entity,
  branding,
  isLoading,
  isSaving,
  error,
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
        done: Boolean(entity?.name && entity?.abn && draft.business_address.trim()),
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
              <h3 className="text-base font-semibold text-foreground">Invoice setup</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Complete these steps and Relby will make your tax invoice look professional.
              </p>
            </div>
            <StatusBadge tone={readinessTone(branding?.readiness_status)}>
              {readinessLabel(branding?.readiness_status)}
            </StatusBadge>
          </div>
          {error ? (
            <div className="mt-3 flex gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 shrink-0" size={16} />
              Invoice setup could not load. Try again before preparing tenant-facing invoice documents.
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
          <h4 className="text-sm font-semibold text-foreground">4. Check and save</h4>
          <div className="mt-3 grid gap-2">
            {checks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 text-sm">
                {check.done ? (
                  <CheckCircle2 className="text-success" size={16} />
                ) : (
                  <AlertTriangle className="text-warning-strong" size={16} />
                )}
                <span className={check.done ? "text-foreground" : "text-muted-foreground"}>
                  {check.label}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={isLoading || isSaving}
              onClick={() => onSave(cleanPayload(draft))}
            >
              {isSaving ? "Saving invoice style..." : "Use this invoice style"}
            </Button>
            <SecondaryButton type="button" disabled={isSaving}>
              Add logo later
            </SecondaryButton>
          </div>
        </div>
      </div>

      <SampleInvoicePreview entity={entity} draft={draft} />
    </div>
  );
}
```

Add the preview component at the bottom of the same file:

```tsx
function SampleInvoicePreview({ entity, draft }: { entity: Entity; draft: Draft }) {
  const accent = draft.accent_color || "#15565a";
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText size={16} />
        Live sample invoice
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-leasiumSm">
        <div style={{ backgroundColor: accent }} className="h-2" />
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="grid h-12 w-12 place-items-center rounded-xl text-base font-bold text-white"
                style={{ backgroundColor: accent }}
              >
                {monogram(entity.name)}
              </div>
              <div>
                <div className="font-semibold text-foreground">{entity.name}</div>
                <div className="text-xs leading-5 text-muted-foreground">
                  ABN {entity.abn ?? "Add ABN"} · {draft.business_address || "Add business address"}
                </div>
                <div className="text-xs leading-5 text-muted-foreground">
                  {[draft.contact_email, draft.contact_phone].filter(Boolean).join(" · ") ||
                    "Add contact details"}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: accent }}>
                Tax invoice
              </div>
              <div className="text-lg font-bold text-foreground">INV-1042</div>
              <div className="text-xs text-muted-foreground">Amount due $10,120.00</div>
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
                className="grid grid-cols-[minmax(0,1fr)_80px_110px] gap-3 border-b border-border py-2"
              >
                <span className="font-medium text-foreground">{description}</span>
                <span className="text-muted-foreground">{gst}</span>
                <span className="text-right tabular-nums text-foreground">{amount}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>$9,200.00</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>GST</span>
                <span>$920.00</span>
              </div>
              <div className="flex justify-between border-t border-foreground pt-2 font-bold" style={{ color: accent }}>
                <span>Total inc GST</span>
                <span>$10,120.00</span>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-2 rounded-xl border border-border bg-muted/20 p-3 text-xs md:grid-cols-3">
            <div>
              <div className="font-semibold uppercase text-muted-foreground">PayID</div>
              <div className="font-semibold text-foreground">
                {draft.payment_payid || "Add later"}
              </div>
            </div>
            <div>
              <div className="font-semibold uppercase text-muted-foreground">BPAY</div>
              <div className="font-semibold text-foreground">
                {draft.payment_bpay_biller
                  ? `Biller ${draft.payment_bpay_biller}`
                  : "Add later"}
              </div>
            </div>
            <div>
              <div className="font-semibold uppercase text-muted-foreground">EFT</div>
              <div className="font-semibold text-foreground">
                {draft.payment_bank_bsb || draft.payment_bank_account
                  ? `BSB ${draft.payment_bank_bsb || "-"}`
                  : "Add later"}
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs leading-5 text-muted-foreground">
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
```

- [ ] **Step 2: Run TypeScript and confirm component compiles**

Run:

```bash
cd apps/web
./node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit guided setup component**

Run:

```bash
git add apps/web/src/components/invoice-branding-setup.tsx
git commit -m "Add guided invoice setup component"
```

---

### Task 4: Settings Integration

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx`
- Test: `apps/web/tests/smoke/settings.spec.ts`

- [ ] **Step 1: Write the failing Settings smoke test**

Append this test to `apps/web/tests/smoke/settings.spec.ts`:

```ts
test("settings guides invoice setup with live preview and local save", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);

  const forbiddenCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = requestPath(request.url());
    const method = request.method();
    if (
      method !== "GET" &&
      /sendgrid|twilio|send-delivery-email|record-delivery|xero|basiq|payment|reconciliation/i.test(
        path,
      )
    ) {
      forbiddenCalls.push(`${method} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ detail: "provider call blocked in invoice setup test" }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/settings?tab=organisation&section=branding&entity_id=entity-1");
  await expect(page.getByRole("heading", { name: "Invoice setup" })).toBeVisible();
  await expect(page.getByText("Complete these steps and Relby will make your tax invoice look professional.")).toBeVisible();
  await expect(page.getByText("Live sample invoice")).toBeVisible();

  await page.getByLabel("Business address").fill("Level 4, 88 Creek St, Brisbane QLD 4000");
  await page.getByLabel("Contact email").fill("invoice-setup@queenstreet.example");
  await page.getByLabel("PayID").fill("payid@queenstreet.example");
  await page.getByRole("button", { name: "Use this invoice style" }).click();

  await expect(page.getByText("Level 4, 88 Creek St, Brisbane QLD 4000")).toBeVisible();
  await expect(page.getByText("payid@queenstreet.example")).toBeVisible();
  expect(forbiddenCalls).toEqual([]);
});
```

- [ ] **Step 2: Run the focused Settings smoke test and confirm RED**

Run:

```bash
cd apps/web
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test tests/smoke/settings.spec.ts -g "settings guides invoice setup" --reporter=line
```

Expected: FAIL because Settings does not yet route to or render the guided setup.

- [ ] **Step 3: Import branding helpers and component**

In `apps/web/src/app/settings/page.tsx`, add `InvoiceBrandingSetup` to local imports:

```ts
import { InvoiceBrandingSetup } from "@/components/invoice-branding-setup";
```

Add API imports:

```ts
  getEntityBranding,
  updateEntityBranding,
  type EntityBrandingUpdatePayload,
```

- [ ] **Step 4: Route section=branding into Organisation -> Comms -> Branding**

Inside the existing `useEffect` that reads URL params, after `const requestedTab = params.get("tab");`, add:

```ts
    const requestedSection = params.get("section");
```

Before the `entityId` block, add:

```ts
    if (requestedSection === "branding" || params.get("setup") === "invoice") {
      setActiveTab("organisation");
      setActiveOrganisationTab("comms");
      setMessageTemplateTab("branding");
    }
```

- [ ] **Step 5: Add branding query and mutation**

After `brandedTemplatesQuery`, add:

```ts
  const entityBrandingQuery = useQuery({
    queryKey: ["entity-branding", selectedEntityId],
    queryFn: () => getEntityBranding(selectedEntityId),
    enabled: Boolean(selectedEntityId) && activeTab === "organisation",
  });

  const updateEntityBrandingMutation = useMutation({
    mutationFn: (payload: EntityBrandingUpdatePayload) =>
      updateEntityBranding(selectedEntityId, payload),
    onSuccess: (branding) => {
      queryClient.setQueryData(["entity-branding", selectedEntityId], branding);
      queryClient.invalidateQueries({ queryKey: ["entity-branding"] });
    },
  });
```

- [ ] **Step 6: Pass branding props into MessageTemplatesPanel**

Extend the `MessageTemplatesPanel` props with:

```ts
  selectedEntity: Entity | null | undefined;
  branding: EntityBrandingRecord | null | undefined;
  brandingLoading: boolean;
  brandingSaving: boolean;
  brandingError: unknown;
  onSaveBranding: (payload: EntityBrandingUpdatePayload) => void;
```

Import `type EntityBrandingRecord` from `@/lib/api` if it is not already imported.

At the call site, pass:

```tsx
                  selectedEntity={selectedEntity}
                  branding={entityBrandingQuery.data}
                  brandingLoading={entityBrandingQuery.isLoading}
                  brandingSaving={updateEntityBrandingMutation.isPending}
                  brandingError={entityBrandingQuery.error}
                  onSaveBranding={(payload) =>
                    updateEntityBrandingMutation.mutate(payload)
                  }
```

- [ ] **Step 7: Replace the Branding empty state**

Inside `MessageTemplatesPanel`, replace the current `activeTab === "branding"` block with:

```tsx
      {activeTab === "branding" ? (
        <div className="p-4">
          <InvoiceBrandingSetup
            entity={selectedEntity}
            branding={branding}
            isLoading={brandingLoading}
            isSaving={brandingSaving}
            error={brandingError}
            onSave={onSaveBranding}
          />
        </div>
      ) : null}
```

- [ ] **Step 8: Run the focused Settings smoke test and confirm GREEN**

Run:

```bash
cd apps/web
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test tests/smoke/settings.spec.ts -g "settings guides invoice setup" --reporter=line
```

Expected: PASS.

- [ ] **Step 9: Commit Settings integration**

Run:

```bash
git add apps/web/src/app/settings/page.tsx apps/web/tests/smoke/settings.spec.ts
git commit -m "Add guided invoice setup to settings"
```

---

### Task 5: Billing Readiness Nudge

**Files:**
- Modify: `apps/web/src/app/billing-readiness/page.tsx`
- Test: `apps/web/tests/smoke/billing-readiness-ux.spec.ts`

- [ ] **Step 1: Write the failing Billing Readiness smoke test**

Append this test to `apps/web/tests/smoke/billing-readiness-ux.spec.ts`:

```ts
test("billing readiness nudges incomplete invoice setup before tenant documents", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);

  await page.goto("/billing-readiness");
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();

  await expect(page.getByText("Finish invoice setup")).toBeVisible();
  await expect(
    page.getByText("Finish invoice setup before preparing tenant-facing invoice documents."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Finish invoice setup" })).toHaveAttribute(
    "href",
    "/settings?tab=organisation&section=branding&entity_id=entity-1",
  );
});
```

- [ ] **Step 2: Run the focused Billing Readiness smoke test and confirm RED**

Run:

```bash
cd apps/web
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test tests/smoke/billing-readiness-ux.spec.ts -g "nudges incomplete invoice setup" --reporter=line
```

Expected: FAIL because Billing Readiness does not fetch branding readiness or show the nudge yet.

- [ ] **Step 3: Import useQueries and branding helper**

In `apps/web/src/app/billing-readiness/page.tsx`, change the TanStack import to include `useQueries`:

```ts
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
```

Add API import:

```ts
  getEntityBranding,
  type EntityBrandingRecord,
```

- [ ] **Step 4: Fetch branding readiness for entities**

After `const billingActionEntityId = ...`, add:

```ts
  const entityBrandingQueries = useQueries({
    queries: (entitiesQuery.data ?? []).map((entity) => ({
      queryKey: ["entity-branding", entity.id],
      queryFn: () => getEntityBranding(entity.id),
      enabled: Boolean(entity.id),
    })),
  });

  const invoiceBrandingByEntityId = useMemo(() => {
    const entries: Array<[string, EntityBrandingRecord]> = [];
    (entitiesQuery.data ?? []).forEach((entity, index) => {
      const branding = entityBrandingQueries[index]?.data;
      if (branding) {
        entries.push([entity.id, branding]);
      }
    });
    return new Map(entries);
  }, [entitiesQuery.data, entityBrandingQueries]);

  const invoiceSetupEntity = entitiesQuery.data?.find(
    (entity) => entity.id === billingActionEntityId,
  );
  const invoiceSetupBranding = billingActionEntityId
    ? invoiceBrandingByEntityId.get(billingActionEntityId)
    : null;
  const invoiceSetupNeedsAttention =
    Boolean(invoiceSetupBranding) &&
    invoiceSetupBranding?.readiness_status !== "ready";
```

- [ ] **Step 5: Render the nudge before billing tabs**

Before the main billing tab content, add:

```tsx
            {invoiceSetupNeedsAttention && invoiceSetupEntity ? (
              <SectionPanel
                title="Finish invoice setup"
                description="Finish invoice setup before preparing tenant-facing invoice documents."
                icon={<AlertTriangle size={17} className="text-warning-strong" />}
                actions={
                  <Link
                    href={`/settings?tab=organisation&section=branding&entity_id=${invoiceSetupEntity.id}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                  >
                    Finish invoice setup
                  </Link>
                }
              >
                <div className="grid gap-2 px-4 py-4 text-sm text-muted-foreground md:grid-cols-2">
                  <div>
                    {invoiceSetupEntity.name} is missing{" "}
                    {invoiceSetupBranding?.readiness_missing.join(", ") || "invoice setup details"}.
                  </div>
                  <div>
                    Draft review can continue, but the tenant-facing invoice document should not be marked ready until setup is complete.
                  </div>
                </div>
              </SectionPanel>
            ) : null}
```

- [ ] **Step 6: Run the focused Billing Readiness smoke test and confirm GREEN**

Run:

```bash
cd apps/web
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test tests/smoke/billing-readiness-ux.spec.ts -g "nudges incomplete invoice setup" --reporter=line
```

Expected: PASS.

- [ ] **Step 7: Commit Billing Readiness nudge**

Run:

```bash
git add apps/web/src/app/billing-readiness/page.tsx apps/web/tests/smoke/billing-readiness-ux.spec.ts
git commit -m "Nudge incomplete invoice setup in billing readiness"
```

---

### Task 6: Full Verification And UX Log

**Files:**
- Modify: `docs/design-governance.md`
- Optional modify: `docs/product-roadmap.md`
- Optional modify: `docs/next-chat-handover.md`

- [ ] **Step 1: Run backend verification**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_branding_api.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend verification**

Run:

```bash
cd apps/web
./node_modules/.bin/eslint src tests/smoke
./node_modules/.bin/tsc --noEmit
NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test tests/smoke/settings.spec.ts tests/smoke/billing-readiness-ux.spec.ts --reporter=line
```

Expected: PASS.

- [ ] **Step 3: Capture UX screenshots**

Run the local app and capture:

```bash
cd apps/web
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs npm run dev
```

In another shell, use Playwright or the existing screenshot helper to capture:

- `/settings?tab=organisation&section=branding&entity_id=entity-1` at 1440px.
- `/settings?tab=organisation&section=branding&entity_id=entity-1` at 390px.
- `/billing-readiness` at 1440px showing the incomplete setup nudge.
- `/billing-readiness` at 390px showing the incomplete setup nudge.

Save outputs under `apps/web/output/playwright/` with names:

- `guided-invoice-setup-settings-1440.png`
- `guided-invoice-setup-settings-390.png`
- `guided-invoice-setup-billing-nudge-1440.png`
- `guided-invoice-setup-billing-nudge-390.png`

- [ ] **Step 4: Run the slop check manually**

Review the screenshots and confirm:

- one primary action is obvious;
- no text overlaps;
- no horizontal overflow at 390px;
- buttons are at least 44px high;
- provider guardrail copy is visible where payment details are entered;
- Billing Readiness nudge names the affected Entity.

- [ ] **Step 5: Add the UX pass log**

Append this line to `docs/design-governance.md` under `## UX Pass Log`:

```markdown
- 2026-06-30 · Guided invoice setup v1 · screenshots reviewed at `apps/web/output/playwright/guided-invoice-setup-settings-1440.png`, `apps/web/output/playwright/guided-invoice-setup-settings-390.png`, `apps/web/output/playwright/guided-invoice-setup-billing-nudge-1440.png`, and `apps/web/output/playwright/guided-invoice-setup-billing-nudge-390.png` · fixes: replaced the empty Settings Branding placeholder with a four-step invoice setup checklist, live sample tax invoice preview, local save flow, readiness state, and Billing Readiness nudge for incomplete setup · no Xero write, tenant email, SMS, payment action, reconciliation, or provider mutation path changed · deferral: real logo upload and renderer replacement stay out of v1 until the approved invoice frame requires them.
```

- [ ] **Step 6: Commit verification docs**

Run:

```bash
git add docs/design-governance.md
git commit -m "Log guided invoice setup UX pass"
```

---

## Self-Review Checklist

- Spec coverage: the plan covers guided setup, readiness states, Settings placement, Billing Readiness nudge, provider guardrails, tests, and UX evidence.
- Out of scope honored: no logo upload, renderer replacement, provider send, Xero post, payment, reconciliation, statements, or template library.
- Type consistency: backend `readiness_status` maps to frontend `EntityBrandingReadiness`; `readiness_missing` is always `string[]`; the frontend uses `EntityBrandingUpdatePayload` for PUT saves.
- Risk: `settings/page.tsx` is already large. The new UI lives in `apps/web/src/components/invoice-branding-setup.tsx` to keep most complexity out of the page file.
