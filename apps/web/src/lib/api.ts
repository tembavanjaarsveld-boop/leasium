export type Entity = {
  id: string;
  organisation_id: string;
  name: string;
  abn: string | null;
  gst_registered: boolean;
  xero_tenant_id: string | null;
  xero_connected_at: string | null;
  xero_last_sync_at: string | null;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type SecurityRole =
  | "owner"
  | "admin"
  | "finance"
  | "ops"
  | "viewer"
  | "agent";

export type SecurityRoleAssignment = {
  entity_id: string;
  role: SecurityRole;
};

export type SecurityEntityRoleRecord = SecurityRoleAssignment & {
  entity_name: string;
};

export type SecurityMemberRecord = {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  login_linked: boolean;
  invite_email_status:
    | "not_sent"
    | "sent"
    | "accepted"
    | "expired"
    | "revoked"
    | "failed"
    | "skipped"
    | string;
  invite_email_detail: string;
  invite_sent_at: string | null;
  invite_expires_at: string | null;
  invite_accepted_at: string | null;
  created_at: string;
  roles: SecurityEntityRoleRecord[];
};

export type SecurityAuthStatusRecord = {
  auth_mode: string;
  dev_auth_active: boolean;
  clerk_secret_configured: boolean;
  clerk_jwks_configured: boolean;
  operator_login_enforced: boolean;
  login_boundary: string;
  next_steps: string[];
};

export type SecurityWorkspaceRecord = {
  auth: SecurityAuthStatusRecord;
  current_user: {
    id: string;
    organisation_id: string;
    email: string;
    display_name: string;
  };
  organisation: {
    id: string;
    name: string;
    country_code: string;
    timezone: string;
    created_at: string;
  };
  members: SecurityMemberRecord[];
  current_user_roles: SecurityEntityRoleRecord[];
  can_manage_security: boolean;
};

export type SecurityMeRecord = {
  auth: SecurityAuthStatusRecord;
  current_user: SecurityWorkspaceRecord["current_user"];
  organisation: SecurityWorkspaceRecord["organisation"];
  roles: SecurityEntityRoleRecord[];
  can_manage_security: boolean;
};

export type SecurityMemberPayload = {
  email: string;
  display_name: string;
  roles: SecurityRoleAssignment[];
  is_active?: boolean;
};

export type SecurityMemberUpdatePayload = {
  display_name?: string;
  is_active?: boolean;
  roles?: SecurityRoleAssignment[];
};

export type SecurityMemberInviteRecord = {
  member: SecurityMemberRecord;
  delivery_status: string;
  delivery_detail: string | null;
};

export type SecurityInviteAcceptPayload = {
  token: string;
  auth_provider_id: string;
  email: string;
  display_name?: string | null;
};

export type SecurityInviteAcceptRecord = {
  member: SecurityMemberRecord;
  accepted: boolean;
};

export type SecurityBootstrapStatusRecord = {
  available: boolean;
  reason: string;
  auth: SecurityAuthStatusRecord;
  organisation_count: number;
  entity_count: number;
  operator_count: number;
};

export type SecurityBootstrapPayload = {
  organisation_name: string;
  entity_name: string;
  email: string;
  display_name?: string | null;
  country_code?: string;
  timezone?: string;
  entity_abn?: string | null;
  gst_registered?: boolean;
};

export type SecurityBootstrapRecord = {
  accepted: boolean;
  organisation: SecurityWorkspaceRecord["organisation"];
  entity: {
    id: string;
    organisation_id: string;
    name: string;
    abn: string | null;
    gst_registered: boolean;
  };
  member: SecurityMemberRecord;
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
  ownership_structure: string | null;
  owner_legal_name: string | null;
  owner_abn: string | null;
  trustee_name: string | null;
  trust_name: string | null;
  invoice_issuer_name: string | null;
  billing_contact_name: string | null;
  billing_email: string | null;
  invoice_reference: string | null;
  ownership_split: string | null;
  owner_gst_registered: boolean | null;
  xero_contact_id: string | null;
  xero_tracking_category: string | null;
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
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type TenantPayload = Omit<
  TenantRecord,
  "id" | "metadata" | "created_at" | "updated_at" | "deleted_at"
> & {
  metadata?: Record<string, unknown>;
};

export type TenantLeaseContextRecord = {
  lease_id: string;
  status: string;
  property_id: string;
  property_name: string;
  property_address: string | null;
  tenancy_unit_id: string;
  unit_label: string;
  commencement_date: string | null;
  expiry_date: string | null;
  annual_rent_cents: number | null;
  rent_frequency: string | null;
  outgoings_recoverable: boolean;
  next_review_date: string | null;
};

export type TenantActivityItemRecord = {
  occurred_at: string;
  kind: string;
  label: string;
  detail: string | null;
  source: string;
  related_id: string | null;
  tone: "neutral" | "primary" | "success" | "warning" | "danger" | string;
};

export type TenantReviewedFieldChangeRecord = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
};

export type TenantReviewedChangeRecord = {
  occurred_at: string;
  source: string;
  source_label: string;
  source_id: string | null;
  status: string;
  notes: string | null;
  changes: TenantReviewedFieldChangeRecord[];
};

export type TenantDetailRecord = {
  tenant: TenantRecord;
  leases: TenantLeaseContextRecord[];
  activity: TenantActivityItemRecord[];
  reviewed_changes: TenantReviewedChangeRecord[];
};

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
  delivery_data: OnboardingDeliveryData;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  applied_at: string | null;
  applied_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type DeliveryChannelRecord = {
  channel?: string;
  status?: string;
  provider?: string;
  attempted_at?: string | null;
  receipt_at?: string | null;
  last_event?: string | null;
  recipient?: string | null;
  provider_message_id?: string | null;
  error?: string | null;
};

export type OnboardingReminderStep = {
  key?: string;
  label?: string;
  after_days?: number;
  scheduled_at?: string | null;
  status?: string | null;
  sent_at?: string | null;
  channels?: Record<string, DeliveryChannelRecord>;
};

export type OnboardingReminderData = {
  enabled?: boolean;
  paused?: boolean;
  paused_reason?: string | null;
  schedule?: OnboardingReminderStep[];
  next_reminder_at?: string | null;
  last_reminder_sent_at?: string | null;
  completed_at?: string | null;
  completed_reason?: string | null;
};

export type OnboardingDeliveryData = {
  last_attempted_at?: string | null;
  last_reason?: string | null;
  channels?: {
    email?: DeliveryChannelRecord;
    sms?: DeliveryChannelRecord;
  };
  history?: Array<Record<string, unknown>>;
  receipts?: Array<Record<string, unknown>>;
  reminders?: OnboardingReminderData;
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

export type TenantPortalAuthRecord = {
  mode: "tenant_portal_token" | "tenant_portal_token_dev_fallback";
  token_source: "header" | "query" | "form";
  tenant_auth_configured: boolean;
  dev_fallback: boolean;
  boundary: string;
  detail: string;
};

export type TenantPortalTenantRecord = {
  id: string;
  legal_name: string;
  trading_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_email: string | null;
};

export type TenantPortalLeaseRecord = {
  lease_id: string;
  status: string;
  property_name: string;
  property_address: string | null;
  unit_label: string;
  commencement_date: string | null;
  expiry_date: string | null;
  next_review_date: string | null;
};

export type TenantPortalOnboardingRecord = {
  id: string;
  status: string;
  due_date: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  last_sent_at: string | null;
  document_count: number;
};

export type TenantPortalDocumentRecord = {
  id: string;
  filename: string;
  content_type: string | null;
  byte_size: number;
  category: DocumentCategory;
  notes: string | null;
  source: string;
  created_at: string;
};

export type TenantPortalComplianceItemRecord = {
  key: string;
  label: string;
  status: "missing" | "received" | "expired" | "not_on_file";
  document_count: number;
  latest_document: TenantPortalDocumentRecord | null;
  due_date: string | null;
};

export type TenantPortalComplianceRecord = {
  uploads_enabled: boolean;
  accepted_categories: DocumentCategory[];
  items: TenantPortalComplianceItemRecord[];
  uploaded_documents: TenantPortalDocumentRecord[];
};

export type TenantPortalInvoiceLineRecord = {
  id: string;
  description: string;
  amount_cents: number;
  gst_cents: number;
  currency: string;
};

export type TenantPortalInvoiceRecord = {
  id: string;
  invoice_number: string | null;
  title: string;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  paid_cents: number;
  outstanding_cents: number;
  payment_status: string;
  pdf_document_id: string | null;
  lines: TenantPortalInvoiceLineRecord[];
};

export type TenantPortalPaymentSummaryRecord = {
  invoice_count: number;
  total_cents: number;
  paid_cents: number;
  outstanding_cents: number;
  overdue_count: number;
  next_due_date: string | null;
  status: "no_invoices" | "paid" | "unpaid" | "overdue";
  manual_only: boolean;
};

export type TenantPortalNotificationPreferencesRecord = {
  email_enabled: boolean;
  sms_enabled: boolean;
  billing_email_enabled: boolean;
  compliance_reminders_enabled: boolean;
  preferred_channel: "email" | "sms" | "both" | "none";
  updated_at: string | null;
};

export type TenantPortalNotificationPreferencesPayload = {
  email_enabled?: boolean;
  sms_enabled?: boolean;
  billing_email_enabled?: boolean;
  compliance_reminders_enabled?: boolean;
};

export type TenantPortalMaintenanceRequestRecord = {
  id: string;
  title: string;
  description: string | null;
  status: MaintenanceWorkOrderStatus;
  priority: MaintenancePriority;
  requested_at: string;
  source_reference: string | null;
  due_date: string | null;
  completed_at: string | null;
  document_ids: string[];
  photo_document_ids: string[];
  created_at: string;
};

export type TenantPortalMaintenanceRequestPayload = {
  title: string;
  description: string;
  priority?: MaintenancePriority;
  source_reference?: string | null;
  document_ids?: string[];
  photo_document_ids?: string[];
};

export type TenantPortalRecord = {
  auth: TenantPortalAuthRecord;
  tenant: TenantPortalTenantRecord;
  lease: TenantPortalLeaseRecord;
  onboarding: TenantPortalOnboardingRecord;
  compliance: TenantPortalComplianceRecord;
  invoices: TenantPortalInvoiceRecord[];
  payment_summary: TenantPortalPaymentSummaryRecord;
  maintenance_requests: TenantPortalMaintenanceRequestRecord[];
  notification_preferences: TenantPortalNotificationPreferencesRecord;
  guardrails: string[];
};

export type MaintenancePriority = "low" | "normal" | "high" | "urgent";

export type MaintenanceWorkOrderStatus =
  | "requested"
  | "triaged"
  | "assigned"
  | "awaiting_approval"
  | "approved"
  | "in_progress"
  | "completed"
  | "cancelled";

export type MaintenanceApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "declined";

export type MaintenanceWorkOrderRecord = {
  id: string;
  entity_id: string;
  property_id: string | null;
  tenancy_unit_id: string | null;
  tenant_id: string | null;
  lease_id: string | null;
  title: string;
  description: string | null;
  status: MaintenanceWorkOrderStatus;
  priority: MaintenancePriority;
  requested_at: string;
  contractor_name: string | null;
  contractor_email: string | null;
  contractor_phone: string | null;
  contractor_assigned_at: string | null;
  approval_required: boolean;
  approval_status: MaintenanceApprovalStatus;
  approval_limit_cents: number | null;
  quote_amount_cents: number | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  source_document_id: string | null;
  invoice_draft_id: string | null;
  invoice_reference: string | null;
  invoice_amount_cents: number | null;
  source_reference: string | null;
  due_date: string | null;
  completed_at: string | null;
  notes: string | null;
  document_ids: string[];
  photo_document_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MaintenanceWorkOrderPayload = {
  entity_id: string;
  title: string;
  description?: string | null;
  property_id?: string | null;
  tenancy_unit_id?: string | null;
  tenant_id?: string | null;
  lease_id?: string | null;
  status?: MaintenanceWorkOrderStatus;
  priority?: MaintenancePriority;
  requested_at?: string | null;
  contractor_name?: string | null;
  contractor_email?: string | null;
  contractor_phone?: string | null;
  contractor_assigned_at?: string | null;
  approval_required?: boolean;
  approval_status?: MaintenanceApprovalStatus;
  approval_limit_cents?: number | null;
  quote_amount_cents?: number | null;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  approval_notes?: string | null;
  source_document_id?: string | null;
  invoice_draft_id?: string | null;
  invoice_reference?: string | null;
  invoice_amount_cents?: number | null;
  source_reference?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  document_ids?: string[];
  photo_document_ids?: string[];
  metadata?: Record<string, unknown>;
};

export type ArrearsCaseStatus =
  | "monitoring"
  | "active"
  | "resolved"
  | "written_off"
  | "closed";

export type ArrearsDisputeStatus =
  | "none"
  | "raised"
  | "under_review"
  | "resolved"
  | "escalated";

export type ArrearsEscalationStatus =
  | "none"
  | "queued"
  | "in_progress"
  | "referred"
  | "closed";

export type ArrearsCaseRecord = {
  id: string;
  entity_id: string;
  property_id: string | null;
  tenancy_unit_id: string | null;
  tenant_id: string;
  lease_id: string | null;
  status: ArrearsCaseStatus;
  currency: string;
  as_of: string;
  balance_current_cents: number;
  balance_1_30_cents: number;
  balance_31_60_cents: number;
  balance_61_90_cents: number;
  balance_90_plus_cents: number;
  total_balance_cents: number;
  oldest_unpaid_invoice_date: string | null;
  last_invoice_date: string | null;
  source_reference: string | null;
  reminder_stage: number;
  reminder_frequency_days: number | null;
  next_reminder_on: string | null;
  last_reminder_at: string | null;
  reminder_paused_until: string | null;
  dispute_status: ArrearsDisputeStatus;
  dispute_notes: string | null;
  promise_to_pay_date: string | null;
  promise_to_pay_amount_cents: number | null;
  promise_to_pay_notes: string | null;
  escalation_status: ArrearsEscalationStatus;
  escalation_queue: string | null;
  escalated_at: string | null;
  assigned_user_id: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ArrearsCasePayload = {
  entity_id: string;
  tenant_id: string;
  property_id?: string | null;
  tenancy_unit_id?: string | null;
  lease_id?: string | null;
  status?: ArrearsCaseStatus;
  currency?: string;
  as_of?: string;
  balance_current_cents?: number;
  balance_1_30_cents?: number;
  balance_31_60_cents?: number;
  balance_61_90_cents?: number;
  balance_90_plus_cents?: number;
  total_balance_cents?: number;
  oldest_unpaid_invoice_date?: string | null;
  last_invoice_date?: string | null;
  source_reference?: string | null;
  reminder_stage?: number;
  reminder_frequency_days?: number | null;
  next_reminder_on?: string | null;
  last_reminder_at?: string | null;
  reminder_paused_until?: string | null;
  dispute_status?: ArrearsDisputeStatus;
  dispute_notes?: string | null;
  promise_to_pay_date?: string | null;
  promise_to_pay_amount_cents?: number | null;
  promise_to_pay_notes?: string | null;
  escalation_status?: ArrearsEscalationStatus;
  escalation_queue?: string | null;
  escalated_at?: string | null;
  assigned_user_id?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

export type DocumentIntakeExtraction = {
  document_type?: string | null;
  summary?: string | null;
  confidence?: number | null;
  parties?: Array<Record<string, unknown>> | null;
  properties?: Array<Record<string, unknown>> | null;
  key_dates?: Array<Record<string, unknown>> | null;
  money_amounts?: Array<Record<string, unknown>> | null;
  obligations?: Array<Record<string, unknown>> | null;
  suggested_links?: Record<string, unknown> | null;
  warnings?: string[] | null;
  missing_information?: string[] | null;
  proposed_actions?: Array<Record<string, unknown>> | null;
  [key: string]: unknown;
};

export type DocumentIntakeRecord = {
  id: string;
  entity_id: string;
  document_id: string;
  status: string;
  document_type: string | null;
  summary: string | null;
  confidence: number | null;
  extracted_data: DocumentIntakeExtraction;
  review_data: Record<string, unknown>;
  openai_response_id: string | null;
  error_message: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  applied_at: string | null;
  applied_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  filename: string;
  content_type: string | null;
  byte_size: number;
  category: DocumentCategory;
};

export type RegisterImportSeverity = "info" | "warning" | "blocker";
export type RegisterImportOperation =
  | "create"
  | "match"
  | "update"
  | "skip"
  | "review";
export type RegisterImportDecision = "approve" | "ignore" | "review";
export type RegisterImportApplyStatus = "applied" | "skipped" | "blocked";

export type RegisterImportSheetSummary = {
  name: string;
  rows: number;
  columns: string[];
};

export type RegisterImportFinding = {
  severity: RegisterImportSeverity;
  message: string;
  sheet: string | null;
  row: number | null;
  field: string | null;
  source_value: unknown;
};

export type RegisterImportActionSummary = {
  target: string;
  create: number;
  match: number;
  update: number;
  skip: number;
  review: number;
};

export type RegisterImportFeatureCandidate = {
  key: string;
  label: string;
  reason: string;
  source_sheet: string;
  source_count: number;
  priority: "now" | "next" | "later";
};

export type RegisterImportSourceContext = {
  filename: string;
  sheet: string;
  row: number | null;
  source_hint: string | null;
  confidence: number | null;
};

export type RegisterImportFieldChange = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  source: RegisterImportSourceContext | null;
};

export type RegisterImportActionItem = {
  id: string;
  target: string;
  operation: RegisterImportOperation;
  label: string;
  summary: string;
  source: RegisterImportSourceContext;
  changes: RegisterImportFieldChange[];
  payload: Record<string, unknown>;
  blockers: string[];
  warnings: string[];
  default_decision: RegisterImportDecision;
};

export type RegisterImportDryRunRecord = {
  entity_id: string;
  filename: string;
  sheets: RegisterImportSheetSummary[];
  actions: RegisterImportActionSummary[];
  action_items: RegisterImportActionItem[];
  findings: RegisterImportFinding[];
  feature_candidates: RegisterImportFeatureCandidate[];
  totals: Record<string, number>;
  importable: boolean;
  summary: string;
};

export type RegisterImportApplyItemResult = {
  action_id: string;
  target: string;
  operation: RegisterImportOperation;
  status: RegisterImportApplyStatus;
  message: string;
  target_table: string | null;
  target_id: string | null;
  created: Record<string, number>;
  updated: Record<string, number>;
};

export type RegisterImportApplyRecord = {
  entity_id: string;
  filename: string;
  applied_at: string;
  requested: number;
  applied: number;
  skipped: number;
  blocked: number;
  created: Record<string, number>;
  updated: Record<string, number>;
  ignored_action_ids: string[];
  results: RegisterImportApplyItemResult[];
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

export type ChargeRulePayload = Omit<ChargeRuleRecord, "id" | "metadata"> & {
  metadata?: Record<string, unknown>;
};

export type XeroConnectionStatusRecord = {
  entity_id: string;
  entity_name: string;
  connected: boolean;
  xero_tenant_id: string | null;
  tenant_name: string | null;
  tenant_type: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_contact_sync_at: string | null;
  provider_configured: boolean;
  provider_connection_id: string | null;
  connection_source: "provider" | "manual" | "none";
  status_label: string;
  next_action: string;
};

export type XeroProviderConfigRecord = {
  configured: boolean;
  missing_config: string[];
  redirect_uri: string;
  scopes: string[];
};

export type XeroOAuthStartRecord = XeroProviderConfigRecord & {
  authorization_url: string | null;
  state_expires_at: string | null;
};

export type XeroReadinessSummaryRecord = {
  total: number;
  ready: number;
  missing: number;
};

export type XeroInvoiceSyncSummaryRecord = {
  total_invoice_drafts: number;
  approved_unsynced: number;
  synced: number;
  blocked: number;
};

export type XeroPaymentSummaryRecord = {
  unpaid: number;
  partially_paid: number;
  paid: number;
  reconciliation_ready: number;
};

export type XeroMappingIssueRecord = {
  id: string;
  kind: "connection" | "contact" | "chart" | "tax" | "invoice_sync" | "payment";
  severity: "blocker" | "warning" | "info";
  label: string;
  detail: string;
  action: string;
  property_id: string | null;
  property_name: string | null;
  tenancy_unit_id: string | null;
  unit_label: string | null;
  lease_id: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  charge_rule_id: string | null;
  charge_type: string | null;
  current_account_code: string | null;
  current_tax_type: string | null;
  suggested_account_code: string | null;
  suggested_tax_type: string | null;
};

export type XeroStatusRecord = {
  provider: XeroProviderConfigRecord;
  connection: XeroConnectionStatusRecord;
  contact_mapping: XeroReadinessSummaryRecord;
  chart_mapping: XeroReadinessSummaryRecord;
  tax_mapping: XeroReadinessSummaryRecord;
  invoice_sync: XeroInvoiceSyncSummaryRecord;
  payment_reconciliation: XeroPaymentSummaryRecord;
  issues: XeroMappingIssueRecord[];
  guardrails: string[];
};

export type XeroContactMatchRecord = {
  target_type: "tenant" | "property";
  target_id: string;
  target_name: string;
  current_xero_contact_id: string | null;
  xero_contact_id: string;
  xero_contact_name: string;
  xero_email: string | null;
  match_reason: string;
  confidence: number;
};

export type XeroContactSyncPreviewRecord = {
  entity_id: string;
  xero_tenant_id: string;
  tenant_name: string | null;
  fetched_contacts: number;
  suggested_matches: XeroContactMatchRecord[];
  last_contact_sync_at: string;
  guardrails: string[];
};

export type XeroContactApplyPreviewMappingPayload = {
  target_type: "tenant" | "property";
  target_id: string;
  xero_contact_id: string;
  xero_contact_name: string;
  xero_email?: string | null;
  confidence?: number | null;
  match_reason?: string | null;
};

export type XeroContactApplyPreviewMappingResult = {
  target_type: "tenant" | "property";
  target_id: string;
  target_name: string;
  previous_xero_contact_id: string | null;
  xero_contact_id: string;
  xero_contact_name: string;
  status: "applied" | "skipped";
  reason: string;
};

export type XeroContactApplyPreviewRecord = {
  entity_id: string;
  applied_mappings: XeroContactApplyPreviewMappingResult[];
  skipped_mappings: XeroContactApplyPreviewMappingResult[];
  guardrails: string[];
  applied_at: string;
};

export type XeroChartTaxValidationResultRecord = {
  charge_rule_id: string;
  charge_type: string;
  property_name: string | null;
  unit_label: string | null;
  tenant_name: string | null;
  account_code: string | null;
  account_name: string | null;
  account_status: string | null;
  account_valid: boolean;
  tax_type: string | null;
  tax_name: string | null;
  tax_valid: boolean;
  suggested_account_code: string | null;
  suggested_tax_type: string | null;
  status: "ready" | "needs_mapping" | "not_found";
  blockers: string[];
};

export type XeroChartTaxValidationPreviewRecord = {
  entity_id: string;
  xero_tenant_id: string;
  tenant_name: string | null;
  fetched_accounts: number;
  fetched_tax_rates: number;
  checked_rules: number;
  results: XeroChartTaxValidationResultRecord[];
  validated_at: string;
  guardrails: string[];
};

export type XeroInvoicePostingPreviewLineItemRecord = {
  description: string;
  quantity: number;
  unit_amount: number;
  account_code: string | null;
  tax_type: string | null;
  line_amount: number;
  source_line_id: string | null;
};

export type XeroInvoicePostingPreviewResultRecord = {
  invoice_draft_id: string;
  invoice_number: string | null;
  title: string;
  status: "ready" | "blocked";
  xero_contact_id: string | null;
  contact_name: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  total_cents: number;
  line_count: number;
  line_items: XeroInvoicePostingPreviewLineItemRecord[];
  blockers: string[];
  payload_preview: Record<string, unknown>;
};

export type XeroInvoicePostingPreviewRecord = {
  entity_id: string;
  xero_tenant_id: string;
  tenant_name: string | null;
  checked_invoices: number;
  ready_count: number;
  blocked_count: number;
  results: XeroInvoicePostingPreviewResultRecord[];
  prepared_at: string;
  guardrails: string[];
};

export type InsightsEntityRecord = {
  id: string;
  name: string;
  gst_registered: boolean;
  xero_connected: boolean;
  xero_last_sync_at: string | null;
};

export type PortfolioHealthRecord = {
  property_count: number;
  tenant_count: number;
  unit_count: number;
  active_lease_count: number;
  vacant_unit_count: number;
  overdue_obligation_count: number;
  due_soon_obligation_count: number;
  open_obligation_count: number;
  smart_intake_waiting_count: number;
  tenant_onboarding_waiting_count: number;
};

export type InsightTargetRecord = {
  property_id: string | null;
  tenancy_unit_id: string | null;
  lease_id: string | null;
  tenant_id: string | null;
  document_intake_id: string | null;
  obligation_id: string | null;
  billing_draft_id: string | null;
  invoice_draft_id: string | null;
};

export type LiveExceptionRecord = {
  id: string;
  kind:
    | "obligation"
    | "tenant_onboarding"
    | "smart_intake"
    | "billing_readiness"
    | "xero_readiness";
  severity: "danger" | "warning" | "primary" | "neutral";
  title: string;
  detail: string;
  chip: string;
  due_date: string | null;
  source: string;
  href: string;
  target: InsightTargetRecord;
  rank: number;
};

export type AutomationActivityRecord = {
  id: string;
  occurred_at: string;
  kind: string;
  label: string;
  detail: string | null;
  source: string;
  target_table: string | null;
  target_id: string | null;
  outcome: string;
};

export type BillingRiskRecord = {
  ready_to_bill_count: number;
  blocked_row_count: number;
  blocker_count: number;
  configured_charges_cents: number;
  billing_draft_counts: Record<string, number>;
  invoice_draft_counts: Record<string, number>;
  xero_issue_count: number;
  xero_blocker_count: number;
  approved_unsynced_invoice_count: number;
  unpaid_invoice_count: number;
};

export type FinanceSnapshotRecord = {
  configured_charges_cents: number;
  ready_to_bill_count: number;
  blocked_row_count: number;
  approved_unsynced_invoice_count: number;
  unpaid_invoice_count: number;
  billing_draft_counts: Record<string, number>;
  invoice_draft_counts: Record<string, number>;
};

export type OwnerEntitySnapshotRecord = {
  ownership_profile_counts: Record<string, number>;
  missing_invoice_issuer_count: number;
  missing_owner_abn_count: number;
  missing_trustee_count: number;
  missing_ownership_split_count: number;
  missing_xero_contact_count: number;
  entity_gst_registered: boolean;
  xero_connected: boolean;
  xero_last_sync_at: string | null;
};

export type LeaseEventRecord = {
  id: string;
  kind: "rent_review" | "lease_expiry" | "obligation" | "tenant_onboarding";
  title: string;
  date: string | null;
  chip: string;
  href: string;
  target: InsightTargetRecord;
  rank: number;
};

export type LeaseEventSnapshotRecord = {
  active_lease_count: number;
  next_review_count: number;
  next_expiry_count: number;
  overdue_obligation_count: number;
  due_soon_obligation_count: number;
  tenant_onboarding_waiting_count: number;
  next_events: LeaseEventRecord[];
};

export type InsightsOverviewRecord = {
  entity: InsightsEntityRecord;
  as_of: string;
  portfolio_health: PortfolioHealthRecord;
  live_exceptions: LiveExceptionRecord[];
  automation_activity: AutomationActivityRecord[];
  billing_risk: BillingRiskRecord;
  finance_snapshot: FinanceSnapshotRecord;
  owner_entity_snapshot: OwnerEntitySnapshotRecord;
  lease_event_snapshot: LeaseEventSnapshotRecord;
  guardrails: string[];
};

export type InsightsSnapshotType = "owner" | "finance" | "lease_events";

export type InsightsSnapshotRecord = {
  id: string;
  entity_id: string;
  snapshot_type: InsightsSnapshotType;
  as_of: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  payload: InsightsOverviewRecord;
  share_url: string | null;
};

export type InsightsSnapshotCreateRecord = InsightsSnapshotRecord & {
  token: string;
  share_url: string;
};

export type InsightsSnapshotPublicRecord = {
  id: string;
  snapshot_type: InsightsSnapshotType;
  as_of: string;
  created_at: string;
  expires_at: string | null;
  payload: InsightsOverviewRecord;
  guardrails: string[];
};

export type BillingDraftStatus = "draft" | "needs_review" | "approved" | "void";

export type BillingDraftLineRecord = {
  id: string;
  billing_draft_id: string;
  description: string;
  amount_cents: number;
  currency: string;
  source_hint: string | null;
  confidence: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  deleted_at: string | null;
};

export type BillingDraftRecord = {
  id: string;
  entity_id: string;
  property_id: string | null;
  tenancy_unit_id: string | null;
  tenant_id: string | null;
  lease_id: string | null;
  document_id: string;
  document_intake_id: string | null;
  status: BillingDraftStatus;
  title: string;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  total_cents: number;
  notes: string | null;
  metadata: Record<string, unknown>;
  lines: BillingDraftLineRecord[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type BillingDraftBatchSkippedRecord = {
  lease_id: string | null;
  tenant_name: string | null;
  property_name: string | null;
  unit_label: string | null;
  reason: string;
};

export type BillingDraftBatchRecord = {
  created: number;
  existing: number;
  skipped: number;
  drafts: BillingDraftRecord[];
  skipped_rows: BillingDraftBatchSkippedRecord[];
};

export type InvoiceDraftStatus =
  | "draft"
  | "ready_for_approval"
  | "approved"
  | "void";

export type InvoiceDraftLineRecord = {
  id: string;
  invoice_draft_id: string;
  billing_draft_line_id: string | null;
  description: string;
  amount_cents: number;
  gst_cents: number;
  currency: string;
  source_hint: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  deleted_at: string | null;
};

export type InvoiceDraftRecord = {
  id: string;
  entity_id: string;
  billing_draft_id: string;
  property_id: string | null;
  tenancy_unit_id: string | null;
  tenant_id: string | null;
  lease_id: string | null;
  document_id: string;
  document_intake_id: string | null;
  status: InvoiceDraftStatus;
  invoice_number: string | null;
  title: string;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  issuer_name: string | null;
  issuer_abn: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  lines: InvoiceDraftLineRecord[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type EnrichmentTargetType = "property" | "tenant";

export type EnrichmentSource = {
  source_hint: string;
  citation: string;
  confidence: number;
  url: string | null;
};

export type EnrichmentSuggestion = {
  field: string;
  label: string;
  value: string;
  source: EnrichmentSource;
  confidence: number;
  notes: string | null;
};

export type EnrichmentPreviewRecord = {
  target: {
    target_type: EnrichmentTargetType;
    target_id: string;
    entity_id: string;
    display_name: string;
    missing_fields: string[];
  };
  suggestions: EnrichmentSuggestion[];
  warnings: string[];
  openai_response_id: string | null;
};

export type EnrichmentApplyRecord = {
  target: EnrichmentPreviewRecord["target"];
  applied: Array<{
    field: string;
    label: string;
    before: unknown;
    after: unknown;
    source: EnrichmentSource;
    storage: "record_field" | "metadata";
  }>;
  skipped: Array<{ field: string; value: string | null; reason: string }>;
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
  obligations?: Array<
    Partial<ObligationPayload> & {
      due?: string | null;
    }
  > | null;
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

let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setApiAuthTokenProvider(
  provider: (() => Promise<string | null>) | null,
) {
  authTokenProvider = provider;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = authTokenProvider ? await authTokenProvider() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

async function requestWithAuthOption<T>(
  path: string,
  init: RequestInit | undefined,
  includeAuth: boolean,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (includeAuth) {
    for (const [key, value] of Object.entries(await authHeaders())) {
      headers.set(key, value);
    }
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  return parseResponse<T>(response);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestWithAuthOption<T>(path, init, true);
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return requestWithAuthOption<T>(path, init, false);
}

async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const headers = new Headers(await authHeaders());
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: formData,
    headers,
  });
  return parseResponse<T>(response);
}

async function publicRequestForm<T>(
  path: string,
  formData: FormData,
  headersInit?: HeadersInit,
): Promise<T> {
  const headers = new Headers(headersInit);
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: formData,
    headers,
  });
  return parseResponse<T>(response);
}

export function listEntities() {
  return request<Entity[]>("/entities");
}

export function getSecurityWorkspace() {
  return request<SecurityWorkspaceRecord>("/security/workspace");
}

export function getCurrentOperator() {
  return request<SecurityMeRecord>("/me");
}

export function createSecurityMember(payload: SecurityMemberPayload) {
  return request<SecurityMemberRecord>("/security/members", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSecurityMember(
  memberId: string,
  payload: SecurityMemberUpdatePayload,
) {
  return request<SecurityMemberRecord>(`/security/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function resendSecurityMemberInvite(memberId: string) {
  return request<SecurityMemberInviteRecord>(
    `/security/members/${memberId}/invite`,
    {
      method: "POST",
    },
  );
}

export async function acceptSecurityInvitation(
  payload: SecurityInviteAcceptPayload,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await publicRequest<SecurityInviteAcceptRecord>(
      "/security/invitations/accept",
      {
        method: "POST",
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        "Invite linking timed out. Refresh the page and try again.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function getSecurityBootstrapStatus() {
  return request<SecurityBootstrapStatusRecord>("/security/bootstrap/status");
}

export function createSecurityBootstrapWorkspace(
  payload: SecurityBootstrapPayload,
) {
  return request<SecurityBootstrapRecord>("/security/bootstrap", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getXeroStatus(entityId: string) {
  const params = new URLSearchParams({ entity_id: entityId });
  return request<XeroStatusRecord>(`/xero/status?${params.toString()}`);
}

export function updateXeroConnection(
  entityId: string,
  payload: { connected: boolean; xero_tenant_id?: string | null },
) {
  return request<XeroConnectionStatusRecord>(`/xero/connection/${entityId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function startXeroOAuth(entityId: string) {
  const params = new URLSearchParams({ entity_id: entityId });
  return request<XeroOAuthStartRecord>(
    `/xero/oauth/start?${params.toString()}`,
  );
}

export function previewXeroContactSync(entityId: string) {
  return request<XeroContactSyncPreviewRecord>(
    `/xero/contacts/sync-preview/${entityId}`,
    {
      method: "POST",
    },
  );
}

export function applyXeroContactPreview(
  entityId: string,
  mappings: XeroContactApplyPreviewMappingPayload[],
) {
  return request<XeroContactApplyPreviewRecord>(
    `/xero/contacts/apply-preview/${entityId}`,
    {
      method: "POST",
      body: JSON.stringify({ mappings }),
    },
  );
}

export function previewXeroChartTaxValidation(entityId: string) {
  return request<XeroChartTaxValidationPreviewRecord>(
    `/xero/chart-tax/validate-preview/${entityId}`,
    {
      method: "POST",
    },
  );
}

export function previewXeroInvoicePosting(entityId: string) {
  return request<XeroInvoicePostingPreviewRecord>(
    `/xero/invoices/posting-preview/${entityId}`,
    {
      method: "POST",
    },
  );
}

export function getInsightsOverview(entityId: string, asOf?: string) {
  const params = new URLSearchParams({ entity_id: entityId });
  if (asOf) {
    params.set("as_of", asOf);
  }
  return request<InsightsOverviewRecord>(
    `/insights/overview?${params.toString()}`,
  );
}

export function createInsightsSnapshot(payload: {
  entity_id: string;
  snapshot_type: InsightsSnapshotType;
  as_of?: string;
  expires_in_days?: number;
}) {
  return request<InsightsSnapshotCreateRecord>("/insights/snapshots", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listInsightsSnapshots(entityId: string) {
  const params = new URLSearchParams({ entity_id: entityId });
  return request<InsightsSnapshotRecord[]>(
    `/insights/snapshots?${params.toString()}`,
  );
}

export function revokeInsightsSnapshot(snapshotId: string) {
  return request<InsightsSnapshotRecord>(
    `/insights/snapshots/${snapshotId}/revoke`,
    {
      method: "POST",
    },
  );
}

export function getPublicInsightsSnapshot(token: string) {
  return request<InsightsSnapshotPublicRecord>(
    `/insights/snapshots/public/${token}`,
  );
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

export function getTenantDetail(tenantId: string) {
  return request<TenantDetailRecord>(`/tenants/${tenantId}/detail`);
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

export function runTenantOnboardingReminders(entityId: string) {
  const params = new URLSearchParams({ entity_id: entityId });
  return request<{
    checked: number;
    sent: number;
    skipped: number;
    onboarding_ids: string[];
  }>(`/tenant-onboarding/reminders/run?${params.toString()}`, {
    method: "POST",
  });
}

export function updateTenantOnboardingReminders(
  onboardingId: string,
  payload: {
    reminders?: {
      enabled?: boolean;
      paused?: boolean;
      paused_reason?: string | null;
      schedule?: Array<{
        key: string;
        label?: string | null;
        after_days?: number | null;
        scheduled_at?: string | null;
        status?: string | null;
      }>;
    };
    expiry_reminders?: {
      enabled?: boolean;
      paused?: boolean;
      paused_reason?: string | null;
      schedule?: Array<{
        key: string;
        label?: string | null;
        after_days?: number | null;
        scheduled_at?: string | null;
        status?: string | null;
      }>;
    };
  },
) {
  return request<TenantOnboardingRecord>(
    `/tenant-onboarding/${onboardingId}/reminders`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
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

export function listMaintenanceWorkOrders(filters: {
  entity_id: string;
  property_id?: string;
  tenant_id?: string;
  status?: MaintenanceWorkOrderStatus;
  priority?: MaintenancePriority;
}) {
  const params = new URLSearchParams({ entity_id: filters.entity_id });
  if (filters.property_id) {
    params.set("property_id", filters.property_id);
  }
  if (filters.tenant_id) {
    params.set("tenant_id", filters.tenant_id);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.priority) {
    params.set("priority", filters.priority);
  }
  return request<MaintenanceWorkOrderRecord[]>(
    `/maintenance/work-orders?${params.toString()}`,
  );
}

export function createMaintenanceWorkOrder(payload: MaintenanceWorkOrderPayload) {
  return request<MaintenanceWorkOrderRecord>("/maintenance/work-orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMaintenanceWorkOrder(
  workOrderId: string,
  payload: Partial<MaintenanceWorkOrderPayload>,
) {
  return request<MaintenanceWorkOrderRecord>(
    `/maintenance/work-orders/${workOrderId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteMaintenanceWorkOrder(workOrderId: string) {
  return request<void>(`/maintenance/work-orders/${workOrderId}`, {
    method: "DELETE",
  });
}

export function listArrearsCases(filters: {
  entity_id: string;
  tenant_id?: string;
  status?: ArrearsCaseStatus;
  dispute_status?: ArrearsDisputeStatus;
  escalation_status?: ArrearsEscalationStatus;
}) {
  const params = new URLSearchParams({ entity_id: filters.entity_id });
  if (filters.tenant_id) {
    params.set("tenant_id", filters.tenant_id);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.dispute_status) {
    params.set("dispute_status", filters.dispute_status);
  }
  if (filters.escalation_status) {
    params.set("escalation_status", filters.escalation_status);
  }
  return request<ArrearsCaseRecord[]>(`/arrears/cases?${params.toString()}`);
}

export function createArrearsCase(payload: ArrearsCasePayload) {
  return request<ArrearsCaseRecord>("/arrears/cases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateArrearsCase(
  arrearsCaseId: string,
  payload: Partial<ArrearsCasePayload>,
) {
  return request<ArrearsCaseRecord>(`/arrears/cases/${arrearsCaseId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteArrearsCase(arrearsCaseId: string) {
  return request<void>(`/arrears/cases/${arrearsCaseId}`, {
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
  return request<DocumentRecord[]>(
    `/tenant-onboarding/public/${token}/documents`,
  );
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

export function publicOnboardingDocumentDownloadUrl(
  token: string,
  documentId: string,
) {
  return `${API_BASE}/tenant-onboarding/public/${token}/documents/${documentId}/download`;
}

export function deletePublicOnboardingDocument(
  token: string,
  documentId: string,
) {
  return request<void>(
    `/tenant-onboarding/public/${token}/documents/${documentId}`,
    {
      method: "DELETE",
    },
  );
}

function tenantPortalHeaders(token: string) {
  return { "X-Tenant-Portal-Token": token };
}

export function getTenantPortal(token: string) {
  return publicRequest<TenantPortalRecord>("/tenant-portal/session", {
    headers: tenantPortalHeaders(token),
  });
}

export function updateTenantPortalNotificationPreferences(
  token: string,
  payload: TenantPortalNotificationPreferencesPayload,
) {
  return publicRequest<TenantPortalNotificationPreferencesRecord>(
    "/tenant-portal/notification-preferences",
    {
      method: "PATCH",
      headers: tenantPortalHeaders(token),
      body: JSON.stringify(payload),
    },
  );
}

export function createTenantPortalMaintenanceRequest(
  token: string,
  payload: TenantPortalMaintenanceRequestPayload,
) {
  return publicRequest<TenantPortalMaintenanceRequestRecord>(
    "/tenant-portal/maintenance-requests",
    {
      method: "POST",
      headers: tenantPortalHeaders(token),
      body: JSON.stringify(payload),
    },
  );
}

export function uploadTenantPortalDocument(payload: {
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
  return publicRequestForm<TenantPortalDocumentRecord>(
    "/tenant-portal/documents",
    formData,
    tenantPortalHeaders(payload.token),
  );
}

export function tenantPortalDocumentDownloadUrl(
  token: string,
  documentId: string,
) {
  const params = new URLSearchParams({ portal_token: token });
  return `${API_BASE}/tenant-portal/documents/${documentId}/download?${params.toString()}`;
}

export function listDocumentIntakes(entityId: string) {
  return request<DocumentIntakeRecord[]>(
    `/document-intakes?entity_id=${entityId}`,
  );
}

export function dryRunRegisterImport(payload: {
  entityId: string;
  file: File;
}) {
  const formData = new FormData();
  formData.append("entity_id", payload.entityId);
  formData.append("file", payload.file);
  return requestForm<RegisterImportDryRunRecord>(
    "/register-imports/dry-run",
    formData,
  );
}

export function applyRegisterImportPlan(payload: {
  entityId: string;
  filename: string;
  actionItems: RegisterImportActionItem[];
  approvedActionIds: string[];
  ignoredActionIds?: string[];
  notes?: string | null;
}) {
  return request<RegisterImportApplyRecord>("/register-imports/apply", {
    method: "POST",
    body: JSON.stringify({
      entity_id: payload.entityId,
      filename: payload.filename,
      action_items: payload.actionItems,
      approved_action_ids: payload.approvedActionIds,
      ignored_action_ids: payload.ignoredActionIds ?? [],
      notes: payload.notes ?? undefined,
    }),
  });
}

export function createDocumentIntake(payload: {
  entityId: string;
  file: File;
  extract?: boolean;
}) {
  const formData = new FormData();
  formData.append("entity_id", payload.entityId);
  if (payload.extract === false) {
    formData.append("extract", "false");
  }
  formData.append("file", payload.file);
  return requestForm<DocumentIntakeRecord>("/document-intakes", formData);
}

export function getDocumentIntake(intakeId: string) {
  return request<DocumentIntakeRecord>(`/document-intakes/${intakeId}`);
}

export function extractDocumentIntake(intakeId: string) {
  return request<DocumentIntakeRecord>(
    `/document-intakes/${intakeId}/extract`,
    {
      method: "POST",
    },
  );
}

export function createDocumentIntakeFromDocument(documentId: string) {
  return request<DocumentIntakeRecord>(
    `/document-intakes/from-document/${documentId}`,
    {
      method: "POST",
    },
  );
}

export function reviewDocumentIntake(
  intakeId: string,
  payload: { reviewData: DocumentIntakeExtraction },
) {
  return request<DocumentIntakeRecord>(`/document-intakes/${intakeId}/review`, {
    method: "POST",
    body: JSON.stringify({
      review_data: payload.reviewData,
    }),
  });
}

export function applyDocumentIntake(
  intakeId: string,
  payload: {
    reviewData?: DocumentIntakeExtraction | null;
    propertyId?: string | null;
    tenancyUnitId?: string | null;
    tenantId?: string | null;
    leaseId?: string | null;
  },
) {
  return request<DocumentIntakeRecord>(`/document-intakes/${intakeId}/apply`, {
    method: "POST",
    body: JSON.stringify({
      review_data: payload.reviewData ?? undefined,
      property_id: payload.propertyId || undefined,
      tenancy_unit_id: payload.tenancyUnitId || undefined,
      tenant_id: payload.tenantId || undefined,
      lease_id: payload.leaseId || undefined,
    }),
  });
}

export function deleteDocumentIntake(intakeId: string) {
  return request<void>(`/document-intakes/${intakeId}`, {
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
  return request<ChargeRuleRecord[]>(
    `/charge-rules${query ? `?${query}` : ""}`,
  );
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

export function listBillingDrafts(filters: {
  entity_id: string;
  property_id?: string;
  lease_id?: string;
  document_intake_id?: string;
  draft_status?: BillingDraftStatus;
}) {
  const params = new URLSearchParams({ entity_id: filters.entity_id });
  if (filters.property_id) {
    params.set("property_id", filters.property_id);
  }
  if (filters.lease_id) {
    params.set("lease_id", filters.lease_id);
  }
  if (filters.document_intake_id) {
    params.set("document_intake_id", filters.document_intake_id);
  }
  if (filters.draft_status) {
    params.set("draft_status", filters.draft_status);
  }
  return request<BillingDraftRecord[]>(`/billing-drafts?${params.toString()}`);
}

export function updateBillingDraft(
  billingDraftId: string,
  payload: { status?: BillingDraftStatus; notes?: string | null },
) {
  return request<BillingDraftRecord>(`/billing-drafts/${billingDraftId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function createBillingDraftsFromChargeRules(payload: {
  entity_id: string;
  lease_ids?: string[];
  as_of?: string | null;
}) {
  return request<BillingDraftBatchRecord>("/billing-drafts/from-charge-rules", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listInvoiceDrafts(filters: {
  entity_id: string;
  billing_draft_id?: string;
  draft_status?: InvoiceDraftStatus;
}) {
  const params = new URLSearchParams({ entity_id: filters.entity_id });
  if (filters.billing_draft_id) {
    params.set("billing_draft_id", filters.billing_draft_id);
  }
  if (filters.draft_status) {
    params.set("draft_status", filters.draft_status);
  }
  return request<InvoiceDraftRecord[]>(`/invoice-drafts?${params.toString()}`);
}

export function createInvoiceDraftFromBillingDraft(billingDraftId: string) {
  return request<InvoiceDraftRecord>(
    `/billing-drafts/${billingDraftId}/invoice-drafts`,
    {
      method: "POST",
    },
  );
}

export function prepareInvoiceDraftDelivery(invoiceDraftId: string) {
  return request<InvoiceDraftRecord>(
    `/invoice-drafts/${invoiceDraftId}/prepare-delivery`,
    {
      method: "POST",
    },
  );
}

export function recordInvoiceDraftDelivery(
  invoiceDraftId: string,
  payload: {
    method?: "manual";
    sent_at?: string | null;
    notes?: string | null;
  },
) {
  return request<InvoiceDraftRecord>(
    `/invoice-drafts/${invoiceDraftId}/record-delivery`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function sendInvoiceDraftDeliveryEmail(invoiceDraftId: string) {
  return request<InvoiceDraftRecord>(
    `/invoice-drafts/${invoiceDraftId}/send-delivery-email`,
    {
      method: "POST",
    },
  );
}

export function updateInvoiceDraftPaymentStatus(
  invoiceDraftId: string,
  payload: {
    status: "unpaid" | "partially_paid" | "paid";
    paid_cents?: number | null;
    paid_at?: string | null;
    notes?: string | null;
  },
) {
  return request<InvoiceDraftRecord>(
    `/invoice-drafts/${invoiceDraftId}/payment-status`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function invoiceDraftPreviewUrl(invoiceDraftId: string) {
  return `${API_BASE}/invoice-drafts/${invoiceDraftId}/preview`;
}

export function updateInvoiceDraft(
  invoiceDraftId: string,
  payload: { status?: InvoiceDraftStatus; notes?: string | null },
) {
  return request<InvoiceDraftRecord>(`/invoice-drafts/${invoiceDraftId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
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

export function previewPublicEnrichment(payload: {
  target_type: EnrichmentTargetType;
  target_id: string;
  requested_fields?: string[] | null;
}) {
  return request<EnrichmentPreviewRecord>("/public-enrichment/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function applyPublicEnrichment(payload: {
  target_type: EnrichmentTargetType;
  target_id: string;
  suggestions: EnrichmentSuggestion[];
}) {
  return request<EnrichmentApplyRecord>("/public-enrichment/apply", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
