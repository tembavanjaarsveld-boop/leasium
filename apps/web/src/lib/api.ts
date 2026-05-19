export type Entity = {
  id: string;
  organisation_id: string;
  name: string;
  abn: string | null;
  gst_registered: boolean;
};

export type PropertyType =
  | "commercial_office"
  | "commercial_retail"
  | "commercial_industrial"
  | "mixed_use"
  | "vacant_land"
  | "childcare"
  | "hospitality"
  | "other";

export type PropertyRecord = {
  id: string;
  entity_id: string;
  name: string;
  street_address: string;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country_code: string;
  property_type: PropertyType;
  parcel_id: string | null;
  land_sqm: number | null;
  building_sqm: number | null;
  parking_spaces: number | null;
  has_solar_pv: boolean;
  metadata: Record<string, unknown>;
};

export type PropertyPayload = Omit<PropertyRecord, "id" | "metadata"> & {
  metadata?: Record<string, unknown>;
};

export type TenancyUnitRecord = {
  id: string;
  property_id: string;
  unit_label: string;
  sqm: number | null;
  parking_spaces: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  deleted_at: string | null;
};

export type TenancyUnitPayload = {
  property_id: string;
  unit_label: string;
  sqm: number | null;
  parking_spaces: number | null;
  metadata?: Record<string, unknown>;
};

export type TenantRecord = {
  id: string;
  entity_id: string;
  legal_name: string;
  trading_name: string | null;
  abn: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_email: string | null;
  notes: string | null;
};

export type TenantPayload = Omit<TenantRecord, "id">;

export type LeaseRecord = {
  id: string;
  tenancy_unit_id: string;
  tenant_id: string;
  status: string;
  commencement_date: string | null;
  expiry_date: string | null;
  annual_rent_cents: number | null;
  rent_frequency: string;
  outgoings_recoverable: boolean;
  next_review_date: string | null;
  option_summary: string | null;
  security_summary: string | null;
  notes: string | null;
};

export type LeasePayload = Omit<LeaseRecord, "id">;

export type TenantOnboardingRecord = {
  id: string;
  entity_id: string;
  lease_id: string;
  tenant_id: string;
  token: string;
  status: string;
  due_date: string | null;
  expires_at: string | null;
  last_sent_at: string | null;
  resent_at: string | null;
  cancel_reason: string | null;
  onboarding_url: string;
  submitted_data: Record<string, unknown>;
  submitted_at: string | null;
  review_data: Record<string, unknown>;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  applied_at: string | null;
  applied_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type TenantOnboardingPublicRecord = {
  token: string;
  status: string;
  tenant_legal_name: string;
  tenant_trading_name: string | null;
  property_name: string;
  property_address: string | null;
  unit_label: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_email: string | null;
  lease_commencement_date: string | null;
  lease_expiry_date: string | null;
  due_date: string | null;
  expires_at: string | null;
  submitted_at: string | null;
};

export type TenantOnboardingSubmitPayload = {
  legal_name: string;
  trading_name?: string | null;
  abn?: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone?: string | null;
  billing_email?: string | null;
  insurance_confirmed: boolean;
  insurance_expiry_date?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  notes?: string | null;
  accepted: boolean;
};

export type DocumentCategory =
  | "lease"
  | "insurance"
  | "bank_guarantee"
  | "onboarding"
  | "invoice"
  | "other";

export type DocumentRecord = {
  id: string;
  entity_id: string;
  property_id: string | null;
  tenancy_unit_id: string | null;
  tenant_id: string | null;
  lease_id: string | null;
  tenant_onboarding_id: string | null;
  filename: string;
  content_type: string | null;
  byte_size: number;
  category: DocumentCategory;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  deleted_at: string | null;
};

export type ObligationRecord = {
  id: string;
  entity_id: string;
  property_id: string | null;
  tenancy_unit_id: string | null;
  lease_id: string | null;
  title: string;
  category: string;
  status: string;
  due_date: string;
  completed_at: string | null;
  priority: number;
  owner_role: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
};

export type ObligationPayload = Omit<
  ObligationRecord,
  "id" | "completed_at"
> & {
  completed_at?: string | null;
};

export type RentRollRow = {
  entity_id: string;
  entity_name: string;
  property_id: string;
  property_name: string;
  tenancy_unit_id: string;
  unit_label: string;
  lease_id: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  lease_status: string | null;
  commencement_date?: string | null;
  expiry_date?: string | null;
  tenant_billing_email?: string | null;
  annual_rent_cents: number | null;
  rent_frequency?: string | null;
  charge_rules?: Array<{
    id: string;
    charge_type: string;
    amount_cents: number;
    frequency: string;
    gst_treatment: string;
    xero_account_code: string | null;
    xero_tax_type: string | null;
    start_date: string | null;
    end_date: string | null;
    next_due_date: string | null;
    arrears_or_advance: string;
  }>;
  charge_rules_total_cents: number | null;
  next_due_date: string | null;
  gst_readiness_blockers?: string[];
  xero_readiness_blockers?: string[];
  invoice_readiness_blockers?: string[];
};

export type ChargeRuleRecord = {
  id: string;
  lease_id: string;
  charge_type: string;
  amount_cents: number;
  gst_treatment: string;
  xero_account_code: string | null;
  xero_tax_type: string | null;
  next_due_date: string | null;
  frequency?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  arrears_or_advance?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

export type ChargeRulePayload = Omit<
  ChargeRuleRecord,
  "id" | "metadata"
> & {
  metadata?: Record<string, unknown>;
};

export type LeaseIntakeExtraction = {
  property?: (Partial<PropertyPayload> & { address?: string | null }) | null;
  tenancy_unit?:
    | (Partial<TenancyUnitPayload> & {
        label?: string | null;
      })
    | null;
  tenant?: (Partial<TenantPayload> & { name?: string | null }) | null;
  lease?:
    | (Partial<LeasePayload> & {
        annual_rent?: number | null;
        annual_rent_dollars?: number | null;
      })
    | null;
  obligations?:
    | Array<
        Partial<ObligationPayload> & {
          due?: string | null;
        }
      >
    | null;
  notes?: string[] | null;
  warnings?: string[] | null;
  confidence?: number | null;
  [key: string]: unknown;
};

export type LeaseIntakeRecord = {
  id: string;
  entity_id?: string;
  property_id?: string | null;
  file_name?: string | null;
  filename?: string | null;
  status?: string | null;
  extracted?: LeaseIntakeExtraction | null;
  extracted_data?: LeaseIntakeExtraction | null;
  draft?: LeaseIntakeExtraction | null;
  review?: LeaseIntakeExtraction | null;
  error?: string | null;
  error_message?: string | null;
  applied_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text();
    let message = detail || `Request failed with ${response.status}`;
    try {
      const parsed = JSON.parse(detail) as { detail?: unknown };
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
      } else if (Array.isArray(parsed.detail)) {
        message = parsed.detail
          .map((item) =>
            typeof item === "string"
              ? item
              : typeof item === "object" && item && "msg" in item
                ? String((item as { msg: unknown }).msg)
                : String(item),
          )
          .join(" ");
      }
    } catch {
      // Keep the raw response text when the API does not return JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  return parseResponse<T>(response);
}

async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: formData,
  });
  return parseResponse<T>(response);
}

export function listEntities() {
  return request<Entity[]>("/entities");
}

export function listProperties(entityId: string) {
  return request<PropertyRecord[]>(`/premises/by-entity/${entityId}`);
}

export function createProperty(payload: PropertyPayload) {
  return request<PropertyRecord>("/premises", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProperty(
  propertyId: string,
  payload: Partial<PropertyPayload>,
) {
  return request<PropertyRecord>(`/premises/${propertyId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function listTenancyUnits(propertyId: string) {
  const params = new URLSearchParams({ property_id: propertyId });
  return request<TenancyUnitRecord[]>(`/tenancy-units?${params.toString()}`);
}

export function createTenancyUnit(payload: TenancyUnitPayload) {
  return request<TenancyUnitRecord>("/tenancy-units", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTenancyUnit(
  unitId: string,
  payload: Partial<Omit<TenancyUnitPayload, "property_id">>,
) {
  return request<TenancyUnitRecord>(`/tenancy-units/${unitId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTenancyUnit(unitId: string) {
  return request<void>(`/tenancy-units/${unitId}`, {
    method: "DELETE",
  });
}

export function listTenants(entityId: string) {
  const params = new URLSearchParams({ entity_id: entityId });
  return request<TenantRecord[]>(`/tenants?${params.toString()}`);
}

export function getTenant(tenantId: string) {
  return request<TenantRecord>(`/tenants/${tenantId}`);
}

export function createTenant(payload: TenantPayload) {
  return request<TenantRecord>("/tenants", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTenant(
  tenantId: string,
  payload: Partial<TenantPayload>,
) {
  return request<TenantRecord>(`/tenants/${tenantId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTenant(tenantId: string) {
  return request<void>(`/tenants/${tenantId}`, {
    method: "DELETE",
  });
}

export function listLeasesByProperty(propertyId: string) {
  const params = new URLSearchParams({ property_id: propertyId });
  return request<LeaseRecord[]>(`/leases?${params.toString()}`);
}

export function listLeasesByUnit(unitId: string) {
  const params = new URLSearchParams({ unit_id: unitId });
  return request<LeaseRecord[]>(`/leases?${params.toString()}`);
}

export function listLeasesByTenant(tenantId: string) {
  const params = new URLSearchParams({ tenant_id: tenantId });
  return request<LeaseRecord[]>(`/leases?${params.toString()}`);
}

export function createLease(payload: LeasePayload) {
  return request<LeaseRecord>("/leases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateLease(leaseId: string, payload: Partial<LeasePayload>) {
  return request<LeaseRecord>(`/leases/${leaseId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteLease(leaseId: string) {
  return request<void>(`/leases/${leaseId}`, {
    method: "DELETE",
  });
}

export function listTenantOnboardings(entityId: string) {
  const params = new URLSearchParams({ entity_id: entityId });
  return request<TenantOnboardingRecord[]>(
    `/tenant-onboarding?${params.toString()}`,
  );
}

export function createTenantOnboarding(payload: {
  lease_id: string;
  due_date?: string | null;
  expires_at?: string | null;
}) {
  return request<TenantOnboardingRecord>("/tenant-onboarding", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelTenantOnboarding(onboardingId: string) {
  return request<TenantOnboardingRecord>(
    `/tenant-onboarding/${onboardingId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ reason: null }),
    },
  );
}

export function resendTenantOnboarding(onboardingId: string) {
  return request<TenantOnboardingRecord>(
    `/tenant-onboarding/${onboardingId}/resend`,
    {
      method: "POST",
    },
  );
}

export function reviewTenantOnboarding(
  onboardingId: string,
  payload: { approved: boolean; notes?: string | null },
) {
  return request<TenantOnboardingRecord>(
    `/tenant-onboarding/${onboardingId}/review`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function applyTenantOnboarding(onboardingId: string) {
  return request<TenantOnboardingRecord>(
    `/tenant-onboarding/${onboardingId}/apply`,
    {
      method: "POST",
    },
  );
}

export function getPublicTenantOnboarding(token: string) {
  return request<TenantOnboardingPublicRecord>(
    `/tenant-onboarding/public/${token}`,
  );
}

export function submitPublicTenantOnboarding(
  token: string,
  payload: TenantOnboardingSubmitPayload,
) {
  return request<TenantOnboardingPublicRecord>(
    `/tenant-onboarding/public/${token}/submit`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function listObligations(filters: {
  entity_id: string;
  property_id?: string;
}) {
  const params = new URLSearchParams({ entity_id: filters.entity_id });
  if (filters.property_id) {
    params.set("property_id", filters.property_id);
  }
  return request<ObligationRecord[]>(`/obligations?${params.toString()}`);
}

export function createObligation(payload: ObligationPayload) {
  return request<ObligationRecord>("/obligations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateObligation(
  obligationId: string,
  payload: Partial<ObligationPayload>,
) {
  return request<ObligationRecord>(`/obligations/${obligationId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteObligation(obligationId: string) {
  return request<void>(`/obligations/${obligationId}`, {
    method: "DELETE",
  });
}

export function listDocuments(filters: {
  entity_id: string;
  property_id?: string;
  tenancy_unit_id?: string;
  tenant_id?: string;
  lease_id?: string;
  tenant_onboarding_id?: string;
  category?: DocumentCategory;
}) {
  const params = new URLSearchParams({ entity_id: filters.entity_id });
  if (filters.property_id) {
    params.set("property_id", filters.property_id);
  }
  if (filters.tenancy_unit_id) {
    params.set("tenancy_unit_id", filters.tenancy_unit_id);
  }
  if (filters.tenant_id) {
    params.set("tenant_id", filters.tenant_id);
  }
  if (filters.lease_id) {
    params.set("lease_id", filters.lease_id);
  }
  if (filters.tenant_onboarding_id) {
    params.set("tenant_onboarding_id", filters.tenant_onboarding_id);
  }
  if (filters.category) {
    params.set("category", filters.category);
  }
  return request<DocumentRecord[]>(`/documents?${params.toString()}`);
}

export function uploadDocument(payload: {
  entityId: string;
  propertyId?: string;
  tenancyUnitId?: string;
  tenantId?: string;
  leaseId?: string;
  tenantOnboardingId?: string;
  category: DocumentCategory;
  notes?: string | null;
  file: File;
}) {
  const formData = new FormData();
  formData.append("entity_id", payload.entityId);
  if (payload.propertyId) {
    formData.append("property_id", payload.propertyId);
  }
  if (payload.tenancyUnitId) {
    formData.append("tenancy_unit_id", payload.tenancyUnitId);
  }
  if (payload.tenantId) {
    formData.append("tenant_id", payload.tenantId);
  }
  if (payload.leaseId) {
    formData.append("lease_id", payload.leaseId);
  }
  if (payload.tenantOnboardingId) {
    formData.append("tenant_onboarding_id", payload.tenantOnboardingId);
  }
  formData.append("category", payload.category);
  if (payload.notes?.trim()) {
    formData.append("notes", payload.notes.trim());
  }
  formData.append("file", payload.file);
  return requestForm<DocumentRecord>("/documents", formData);
}

export function documentDownloadUrl(documentId: string) {
  return `${API_BASE}/documents/${documentId}/download`;
}

export function deleteDocument(documentId: string) {
  return request<void>(`/documents/${documentId}`, {
    method: "DELETE",
  });
}

export function listPublicOnboardingDocuments(token: string) {
  return request<DocumentRecord[]>(`/tenant-onboarding/public/${token}/documents`);
}

export function uploadPublicOnboardingDocument(payload: {
  token: string;
  category: DocumentCategory;
  notes?: string | null;
  file: File;
}) {
  const formData = new FormData();
  formData.append("category", payload.category);
  if (payload.notes?.trim()) {
    formData.append("notes", payload.notes.trim());
  }
  formData.append("file", payload.file);
  return requestForm<DocumentRecord>(
    `/tenant-onboarding/public/${payload.token}/documents`,
    formData,
  );
}

export function publicOnboardingDocumentDownloadUrl(token: string, documentId: string) {
  return `${API_BASE}/tenant-onboarding/public/${token}/documents/${documentId}/download`;
}

export function deletePublicOnboardingDocument(token: string, documentId: string) {
  return request<void>(`/tenant-onboarding/public/${token}/documents/${documentId}`, {
    method: "DELETE",
  });
}

export function listRentRoll(filters: {
  entity_id: string;
  property_id?: string;
  as_of?: string;
}) {
  const params = new URLSearchParams({ entity_id: filters.entity_id });
  if (filters.property_id) {
    params.set("property_id", filters.property_id);
  }
  if (filters.as_of) {
    params.set("as_of", filters.as_of);
  }
  return request<RentRollRow[]>(`/rent-roll?${params.toString()}`);
}

export function listChargeRules(filters: {
  entity_id?: string;
  property_id?: string;
  lease_id?: string;
}) {
  const params = new URLSearchParams();
  if (filters.entity_id) {
    params.set("entity_id", filters.entity_id);
  }
  if (filters.property_id) {
    params.set("property_id", filters.property_id);
  }
  if (filters.lease_id) {
    params.set("lease_id", filters.lease_id);
  }
  const query = params.toString();
  return request<ChargeRuleRecord[]>(`/charge-rules${query ? `?${query}` : ""}`);
}

export function createChargeRule(payload: ChargeRulePayload) {
  return request<ChargeRuleRecord>("/charge-rules", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateChargeRule(
  chargeRuleId: string,
  payload: Partial<ChargeRulePayload>,
) {
  return request<ChargeRuleRecord>(`/charge-rules/${chargeRuleId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteChargeRule(chargeRuleId: string) {
  return request<void>(`/charge-rules/${chargeRuleId}`, {
    method: "DELETE",
  });
}

export function createLeaseIntake(payload: {
  entityId: string;
  propertyId?: string;
  file: File;
}) {
  const formData = new FormData();
  formData.append("entity_id", payload.entityId);
  if (payload.propertyId) {
    formData.append("property_id", payload.propertyId);
  }
  formData.append("file", payload.file);
  return requestForm<LeaseIntakeRecord>("/lease-intakes", formData);
}

export function getLeaseIntake(intakeId: string) {
  return request<LeaseIntakeRecord>(`/lease-intakes/${intakeId}`);
}

export function applyLeaseIntake(
  intakeId: string,
  payload?: {
    reviewedData?: LeaseIntakeExtraction | null;
    propertyId?: string | null;
    tenancyUnitId?: string | null;
    tenantId?: string | null;
  },
) {
  return request<LeaseIntakeRecord>(`/lease-intakes/${intakeId}/apply`, {
    method: "POST",
    body: JSON.stringify({
      reviewed_data: payload?.reviewedData ?? undefined,
      property_id: payload?.propertyId || undefined,
      tenancy_unit_id: payload?.tenancyUnitId || undefined,
      tenant_id: payload?.tenantId || undefined,
    }),
  });
}
