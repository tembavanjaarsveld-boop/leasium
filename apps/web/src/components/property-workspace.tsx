"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  LayoutGrid,
  Link2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Table2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChangeEvent,
  ComponentType,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AppHeader } from "@/components/app-shell";
import {
  EvidenceSourceTrail,
  type EvidenceFieldChange,
  type EvidenceHistoryRow,
  type EvidenceSourceLocation,
} from "@/components/evidence-drawer";
import { InlineEditCell } from "@/components/inline-edit-cell";
import { QueryProvider } from "@/components/query-provider";
import { SavedViewsMenu } from "@/components/saved-views-menu";
import { useUnmountDelay } from "@/lib/use-unmount-delay";
import { cn } from "@/lib/utils";
import {
  Button,
  Field,
  Input,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  applyPropertyImage,
  applyPublicEnrichment,
  applyLeaseIntake,
  cancelTenantOnboarding,
  createChargeRule,
  createDocumentIntake,
  createObligation,
  createLease,
  createLeaseIntake,
  createTenancyUnit,
  createProperty,
  createTenant,
  createTenantOnboarding,
  deleteLease,
  deleteTenancyUnit,
  downloadDocumentBlob,
  EnrichmentSuggestion,
  getLeaseIntake,
  getInsightsOverview,
  InsightsOverviewRecord,
  LeaseRecord,
  LeaseEventRecord,
  LeaseIntakeExtraction,
  LeaseIntakeRecord,
  listChargeRules,
  listObligations,
  listLeasesByProperty,
  listEntities,
  listProperties,
  listRentRoll,
  listTenants,
  listTenantOnboardings,
  listTenancyUnits,
  ObligationRecord,
  PropertyImageCandidateRecord,
  PropertyRecord,
  PropertyType,
  RentRollRow,
  TenantRecord,
  TenantOnboardingRecord,
  TenancyUnitRecord,
  updateObligation,
  previewPublicEnrichment,
  previewPropertyImages,
  updateLease,
  updateTenancyUnit,
  updateProperty,
} from "@/lib/api";
import {
  nextExpiryChipClassName,
  nextExpiryChipLabel,
  occupancyBadgeClassName,
  occupancyBadgeLabel,
  type NextLeaseExpiry,
  type PropertyOccupancy,
  type PropertyOccupancyStatus,
  propertyNextExpiryFromRentRoll,
  propertyOccupancyFromRentRoll,
} from "@/lib/property-occupancy";
import {
  ownershipChipClassName,
  propertyMatchesOwnershipTag,
  propertyOwnerLabels,
  propertyOwnershipBadges,
  propertyOwnershipPaletteMap,
  propertyOwnershipTagDirectory,
  propertyUsesOwnerBilling,
} from "@/lib/property-ownership";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const PROPERTY_STORAGE_KEY = "leasium.property_id";
const PROPERTY_DENSITY_STORAGE_KEY = "leasium.properties.density";

type PropertyRowDensity = "comfortable" | "compact";

const optionalNumber = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().nonnegative().optional(),
);

const optionalInteger = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().int().nonnegative().optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().optional(),
);

const propertySchema = z.object({
  name: z.string().min(1, "Name is required"),
  street_address: z.string().min(1, "Street address is required"),
  suburb: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  property_type: z.enum([
    "commercial_office",
    "commercial_retail",
    "commercial_industrial",
    "mixed_use",
    "vacant_land",
    "childcare",
    "hospitality",
    "residential",
    "other",
  ]),
  building_sqm: optionalNumber,
  parking_spaces: optionalInteger,
  has_solar_pv: z.boolean().default(false),
  ownership_structure: z
    .enum(["current_entity", "property_owner", "trust", "split"])
    .default("current_entity"),
  owner_legal_name: z.string().optional(),
  owner_abn: z.string().optional(),
  trustee_name: z.string().optional(),
  trust_name: z.string().optional(),
  invoice_issuer_name: z.string().optional(),
  billing_contact_name: z.string().optional(),
  billing_email: z.string().optional(),
  invoice_reference: z.string().optional(),
  ownership_split: z.string().optional(),
  owner_gst_registered: z.enum(["", "true", "false"]).default(""),
  xero_contact_id: z.string().optional(),
  xero_tracking_category: z.string().optional(),
});

type PropertyFormValues = z.infer<typeof propertySchema>;
type PropertyWorkspaceTab =
  | "portfolio"
  | "operations"
  | "billing"
  | "documents";
type PropertyPortfolioView = "table" | "board" | "map" | "calendar";

const propertyWorkspaceTabs: Array<{
  id: PropertyWorkspaceTab;
  label: string;
  description: string;
}> = [
  {
    id: "portfolio",
    label: "Portfolio",
    description: "Properties and setup",
  },
  {
    id: "operations",
    label: "Leases & units",
    description: "Dates and occupancy",
  },
  {
    id: "billing",
    label: "Billing",
    description: "Readiness and identity",
  },
  {
    id: "documents",
    label: "Documents",
    description: "Upload and sources",
  },
];

const unitSchema = z.object({
  unit_label: z.string().min(1, "Unit label is required"),
  sqm: optionalNumber,
  parking_spaces: optionalInteger,
});

type UnitFormValues = z.infer<typeof unitSchema>;

const leaseSchema = z
  .object({
    tenancy_unit_id: z.string().min(1, "Unit is required"),
    tenant_id: z.string().optional(),
    new_tenant_legal_name: z.string().optional(),
    new_tenant_trading_name: z.string().optional(),
    status: z.enum([
      "active",
      "pending",
      "expired",
      "terminated",
      "holding_over",
    ]),
    commencement_date: optionalDate,
    expiry_date: optionalDate,
    annual_rent: optionalNumber,
    rent_frequency: z.enum(["annual", "monthly", "weekly"]),
    outgoings_recoverable: z.boolean().default(false),
    next_review_date: optionalDate,
    option_summary: z.string().optional(),
    security_summary: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (values) => values.tenant_id || values.new_tenant_legal_name?.trim(),
    {
      message: "Select a tenant or enter a new tenant name",
      path: ["tenant_id"],
    },
  );

type LeaseFormValues = z.infer<typeof leaseSchema>;

const obligationSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: z.string().min(1, "Category is required"),
  due_date: z.string().min(1, "Due date is required"),
  priority: z.enum(["low", "normal", "high", "critical"]),
  owner_role: z.string().optional(),
  lease_id: z.string().optional(),
  notes: z.string().optional(),
});

type ObligationFormValues = z.infer<typeof obligationSchema>;

const chargeRuleSchema = z.object({
  lease_id: z.string().min(1, "Lease is required"),
  amount: optionalNumber,
  charge_type: z.string().min(1, "Charge type is required"),
  gst_treatment: z.enum(["taxable", "gst_free", "input_taxed", "out_of_scope"]),
  xero_account_code: z.string().optional(),
  xero_tax_type: z.string().optional(),
  next_due_date: z.string().min(1, "Next due is required"),
});

type ChargeRuleFormValues = z.infer<typeof chargeRuleSchema>;

const defaultPropertyFormValues: PropertyFormValues = {
  name: "",
  street_address: "",
  suburb: "",
  state: "QLD",
  postcode: "",
  property_type: "commercial_office",
  building_sqm: undefined,
  parking_spaces: undefined,
  has_solar_pv: false,
  ownership_structure: "current_entity",
  owner_legal_name: "",
  owner_abn: "",
  trustee_name: "",
  trust_name: "",
  invoice_issuer_name: "",
  billing_contact_name: "",
  billing_email: "",
  invoice_reference: "",
  ownership_split: "",
  owner_gst_registered: "",
  xero_contact_id: "",
  xero_tracking_category: "",
};

const defaultUnitFormValues: UnitFormValues = {
  unit_label: "",
  sqm: undefined,
  parking_spaces: undefined,
};

const defaultLeaseFormValues: LeaseFormValues = {
  tenancy_unit_id: "",
  tenant_id: "",
  new_tenant_legal_name: "",
  new_tenant_trading_name: "",
  status: "active",
  commencement_date: undefined,
  expiry_date: undefined,
  annual_rent: undefined,
  rent_frequency: "annual",
  outgoings_recoverable: true,
  next_review_date: undefined,
  option_summary: "",
  security_summary: "",
  notes: "",
};

const defaultObligationFormValues: ObligationFormValues = {
  title: "",
  category: "lease_expiry",
  due_date: "",
  priority: "normal",
  owner_role: "",
  lease_id: "",
  notes: "",
};

const defaultChargeRuleFormValues: ChargeRuleFormValues = {
  lease_id: "",
  amount: undefined,
  charge_type: "base_rent",
  gst_treatment: "taxable",
  xero_account_code: "",
  xero_tax_type: "",
  next_due_date: dateOnly(new Date()),
};

const propertyTypes: { value: PropertyType; label: string }[] = [
  { value: "commercial_office", label: "Office" },
  { value: "commercial_retail", label: "Retail" },
  { value: "commercial_industrial", label: "Industrial" },
  { value: "mixed_use", label: "Mixed use" },
  { value: "vacant_land", label: "Vacant land" },
  { value: "childcare", label: "Childcare" },
  { value: "hospitality", label: "Hospitality" },
  { value: "residential", label: "Residential" },
  { value: "other", label: "Other" },
];

const leaseStatuses = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "holding_over", label: "Holding over" },
  { value: "expired", label: "Expired" },
  { value: "terminated", label: "Terminated" },
] as const;

const rentFrequencies = [
  { value: "annual", label: "Annual" },
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
] as const;

const obligationCategories = [
  { value: "lease_expiry", label: "Lease expiry" },
  { value: "rent_review", label: "Rent review" },
  { value: "option_notice", label: "Option notice" },
  { value: "insurance", label: "Insurance" },
  { value: "bank_guarantee", label: "Bank guarantee" },
  { value: "make_good", label: "Make good" },
  { value: "compliance", label: "Compliance" },
  { value: "maintenance", label: "Maintenance" },
  { value: "other", label: "Other" },
] as const;

const obligationPriorities = [
  { value: "normal", label: "Normal", rank: 2 },
  { value: "high", label: "High", rank: 1 },
  { value: "critical", label: "Critical", rank: 0 },
  { value: "low", label: "Low", rank: 3 },
] as const;

const obligationOwnerRoles = [
  { value: "", label: "Unassigned" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "finance", label: "Finance" },
  { value: "ops", label: "Ops" },
  { value: "agent", label: "Agent" },
] as const;

const chargeTypes = [
  { value: "base_rent", label: "Base rent" },
  { value: "outgoings", label: "Outgoings" },
  { value: "parking", label: "Parking" },
  { value: "storage", label: "Storage" },
  { value: "other", label: "Other" },
] as const;

const gstTreatments = [
  { value: "taxable", label: "Taxable" },
  { value: "gst_free", label: "GST free" },
  { value: "input_taxed", label: "Input taxed" },
  { value: "out_of_scope", label: "Out of scope" },
] as const;

const ownershipStructures = [
  { value: "current_entity", label: "Current portfolio entity" },
  { value: "property_owner", label: "Specific owner" },
  { value: "trust", label: "Trust / trustee" },
  { value: "split", label: "Split ownership" },
] as const;

type PropertySourceCitation = {
  source_hint: string | null;
  citation: string | null;
  confidence: number | null;
  url?: string | null;
};

type PropertyPrimaryImage = {
  title: string;
  imageUrl: string | null;
  documentId: string | null;
  pageUrl: string | null;
  source: PropertySourceCitation | null;
  confidence: number | null;
  notes: string | null;
  selectedAt: string | null;
};

type PropertyApplyChange = {
  field: string;
  before: unknown;
  after: unknown;
  source: PropertySourceCitation | null;
};

type PropertyApplyHistoryEntry = {
  document_intake_id: string | null;
  document_id: string | null;
  document_type: string | null;
  changes: PropertyApplyChange[];
};

const propertyFieldLabels: Record<string, string> = {
  name: "Property name",
  street_address: "Street address",
  suburb: "Suburb",
  state: "State",
  postcode: "Postcode",
  parcel_id: "Parcel ID",
  land_sqm: "Land area",
  building_sqm: "Building area",
  parking_spaces: "Parking",
  ownership_structure: "Ownership path",
  owner_legal_name: "Owner",
  owner_abn: "Owner ABN",
  trustee_name: "Trustee",
  trust_name: "Trust",
  invoice_issuer_name: "Invoice issuer",
  billing_contact_name: "Billing contact",
  billing_email: "Billing email",
  invoice_reference: "Invoice reference",
  ownership_split: "Ownership split",
  owner_gst_registered: "Owner GST registered",
  xero_contact_id: "Xero contact",
  xero_tracking_category: "Xero tracking",
};

function cleanText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const dateValue = value.length === 10 ? `${value}T00:00:00` : value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(dateValue));
}

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isExpiredDateTime(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return new Date(value).getTime() <= Date.now();
}

function daysUntil(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function dueStatus(value: string) {
  const delta = daysUntil(value);
  if (delta < 0) {
    return {
      label: `${Math.abs(delta)}d overdue`,
      className: "bg-danger/10 text-danger",
    };
  }
  if (delta === 0) {
    return {
      label: "Due today",
      className: "bg-accent/15 text-foreground",
    };
  }
  if (delta <= 14) {
    return {
      label: `Due in ${delta}d`,
      className: "bg-accent/10 text-foreground",
    };
  }
  return {
    label: formatDate(value),
    className: "bg-muted text-muted-foreground",
  };
}

function formatRent(
  cents: number | null | undefined,
  frequency: string | null | undefined,
) {
  if (cents === null || cents === undefined) {
    return "-";
  }
  const amount = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
  return frequency ? `${amount} ${frequency}` : amount;
}

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) {
    return "-";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function ownerGstFormValue(value: boolean | null | undefined) {
  if (value === true) {
    return "true" as const;
  }
  if (value === false) {
    return "false" as const;
  }
  return "" as const;
}

function ownerGstPayload(value: PropertyFormValues["owner_gst_registered"]) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function ownershipStructureLabel(value: string | null | undefined) {
  return (
    ownershipStructures.find((structure) => structure.value === value)?.label ??
    "Current portfolio entity"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function propertyMetadata(property: PropertyRecord | null | undefined) {
  return isRecord(property?.metadata) ? property.metadata : {};
}

function sourceCitation(value: unknown): PropertySourceCitation | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = {
    source_hint: textValue(value.source_hint) ?? textValue(value.hint),
    citation: textValue(value.citation) ?? textValue(value.text),
    confidence: numberValue(value.confidence),
    url: textValue(value.url),
  };
  return source.source_hint ||
    source.citation ||
    source.confidence !== null ||
    source.url
    ? source
    : null;
}

function httpsUrl(value: unknown) {
  const url = textValue(value);
  return url?.toLowerCase().startsWith("https://") ? url : null;
}

function directImageUrl(value: unknown) {
  const url = textValue(value);
  if (!url) {
    return null;
  }
  const lowerUrl = url.toLowerCase();
  return lowerUrl.startsWith("http://") ||
    lowerUrl.startsWith("https://") ||
    url.startsWith("/")
    ? url
    : null;
}

function propertyPrimaryImage(
  property: PropertyRecord | null | undefined,
): PropertyPrimaryImage | null {
  const media = propertyMetadata(property).property_media;
  if (!isRecord(media)) {
    return null;
  }
  const primaryImage = media.primary_image;
  if (!isRecord(primaryImage)) {
    return null;
  }
  const documentId =
    textValue(primaryImage.document_id) ??
    textValue(primaryImage.image_document_id) ??
    textValue(primaryImage.thumbnail_document_id);
  const imageUrl =
    directImageUrl(primaryImage.download_url) ??
    directImageUrl(primaryImage.thumbnail_url) ??
    (documentId ? null : httpsUrl(primaryImage.image_url));
  if (!imageUrl && !documentId) {
    return null;
  }
  return {
    title: textValue(primaryImage.title) ?? property?.name ?? "Property image",
    imageUrl,
    documentId,
    pageUrl: httpsUrl(primaryImage.page_url),
    source: sourceCitation(primaryImage.source),
    confidence: numberValue(primaryImage.confidence),
    notes: textValue(primaryImage.notes),
    selectedAt: textValue(primaryImage.selected_at),
  };
}

function useDocumentImageUrl(image: PropertyPrimaryImage | null) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    setObjectUrl(null);
    if (image?.imageUrl || !image?.documentId) {
      return;
    }

    let isCurrent = true;
    let nextObjectUrl: string | null = null;
    downloadDocumentBlob(image.documentId)
      .then((blob) => {
        if (!isCurrent) {
          return;
        }
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      })
      .catch(() => {
        if (isCurrent) {
          setObjectUrl(null);
        }
      });

    return () => {
      isCurrent = false;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [image?.documentId, image?.imageUrl]);

  return image?.imageUrl ?? objectUrl;
}

function StoredPropertyImage({
  image,
  alt,
  className,
  placeholderClassName,
  iconSize = 16,
  testId,
}: {
  image: PropertyPrimaryImage | null;
  alt: string;
  className: string;
  placeholderClassName: string;
  iconSize?: number;
  testId?: string;
}) {
  const imageUrl = useDocumentImageUrl(image);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  if (imageUrl && !imageFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={alt}
        className={className}
        data-testid={testId}
        onError={() => setImageFailed(true)}
        src={imageUrl}
      />
    );
  }

  return (
    <div className={placeholderClassName}>
      <ImageIcon size={iconSize} />
    </div>
  );
}

// Occupancy helpers moved to apps/web/src/lib/property-occupancy.ts so the
// dashboard and any future surfaces can share the same derivation.

function propertySourceCitations(property: PropertyRecord | null | undefined) {
  const citations = propertyMetadata(property).source_citations;
  if (!isRecord(citations)) {
    return [];
  }
  return Object.entries(citations)
    .map(([field, value]) => ({
      field,
      source: sourceCitation(value),
    }))
    .filter(
      (item): item is { field: string; source: PropertySourceCitation } =>
        item.source !== null,
    )
    .sort((a, b) =>
      propertyFieldLabel(a.field).localeCompare(propertyFieldLabel(b.field)),
    );
}

function propertyApplyChange(value: unknown): PropertyApplyChange | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = textValue(value.field);
  if (!field) {
    return null;
  }
  return {
    field,
    before: value.before,
    after: value.after,
    source: sourceCitation(value.source),
  };
}

function propertyApplyHistory(
  property: PropertyRecord | null | undefined,
): PropertyApplyHistoryEntry[] {
  const history = propertyMetadata(property).apply_change_history;
  if (!Array.isArray(history)) {
    return [];
  }
  return history
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const changes = Array.isArray(entry.changes)
        ? entry.changes
            .map((change) => propertyApplyChange(change))
            .filter((change): change is PropertyApplyChange => change !== null)
        : [];
      return {
        document_intake_id: textValue(entry.document_intake_id),
        document_id: textValue(entry.document_id),
        document_type: textValue(entry.document_type),
        changes,
      };
    })
    .filter((entry): entry is PropertyApplyHistoryEntry => entry !== null);
}

function propertyFieldLabel(field: string) {
  return (
    propertyFieldLabels[field] ??
    field
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function propertyDocumentTypeLabel(value: string | null | undefined) {
  if (value === "purchase_contract") {
    return "Purchase contract";
  }
  if (!value) {
    return "Source document";
  }
  return value.replaceAll("_", " ");
}

function confidencePercent(value: number | null | undefined) {
  return value === null || value === undefined
    ? null
    : `${Math.round(value * 100)}% confidence`;
}

function sourceCaption(source: PropertySourceCitation | null | undefined) {
  if (!source) {
    return null;
  }
  return [
    source.source_hint,
    source.citation,
    confidencePercent(source.confidence),
  ]
    .filter(Boolean)
    .join(" - ");
}

function propertyEvidenceSourceLocation(
  source: PropertySourceCitation | null | undefined,
): EvidenceSourceLocation | null {
  if (!source) {
    return null;
  }
  const label = source.source_hint ?? source.citation;
  if (!label) {
    return null;
  }
  return {
    label,
    detail: source.source_hint && source.citation ? source.citation : undefined,
  };
}

function propertyEvidenceChanges(
  entry: PropertyApplyHistoryEntry | null,
): EvidenceFieldChange[] {
  if (!entry) {
    return [];
  }
  return entry.changes.map((change, index) => ({
    id: `${change.field}-${index}`,
    field: change.field,
    label: propertyFieldLabel(change.field),
    before: change.before,
    after: change.after,
    sourceLocation: propertyEvidenceSourceLocation(change.source),
    confidence: change.source?.confidence,
  }));
}

function propertyEvidenceConfidence(
  entry: PropertyApplyHistoryEntry | null,
  sources: Array<{ source: PropertySourceCitation }>,
) {
  const changeConfidence = entry?.changes.find(
    (change) => typeof change.source?.confidence === "number",
  )?.source?.confidence;
  if (changeConfidence !== undefined) {
    return changeConfidence;
  }
  return sources.find((item) => typeof item.source.confidence === "number")
    ?.source.confidence;
}

function propertyEvidenceHistory(
  history: PropertyApplyHistoryEntry[],
  sources: Array<{ field: string; source: PropertySourceCitation }>,
): EvidenceHistoryRow[] {
  return [
    ...history
      .slice()
      .reverse()
      .map((entry, index) => ({
        id: `apply-${entry.document_intake_id ?? index}`,
        label: `Applied ${propertyDocumentTypeLabel(entry.document_type)}`,
        description: `${entry.changes.length} field change${
          entry.changes.length === 1 ? "" : "s"
        } stored against this property.`,
        tone: "success" as const,
      })),
    ...sources.slice(0, 8).map((item) => ({
      id: `citation-${item.field}`,
      label: `Citation stored for ${propertyFieldLabel(item.field)}`,
      description: sourceCaption(item.source) ?? "Source citation stored.",
      tone: "primary" as const,
    })),
  ];
}

function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : null;
}

function intakeReviewHref(
  entityId: string | null | undefined,
  intakeId: string,
) {
  const params = entityId
    ? new URLSearchParams({ entity_id: entityId, review: intakeId })
    : new URLSearchParams({ review: intakeId });
  return `/intake?${params.toString()}`;
}

function billingIdentitySummary(
  property: PropertyRecord | null | undefined,
  currentEntityName?: string | null,
) {
  if (!property) {
    return "Select a property to see billing identity.";
  }
  const owners = propertyOwnerLabels(property, currentEntityName);
  if (!propertyUsesOwnerBilling(property)) {
    const owner = owners[0] ?? currentEntityName;
    return owner
      ? `${owner} is tagged as owner. Invoices still use the portfolio entity unless owner-specific billing is enabled.`
      : "Invoices use the current portfolio entity unless this property needs owner-specific billing.";
  }
  return (
    property.invoice_issuer_name ??
    property.owner_legal_name ??
    owners[0] ??
    property.trust_name ??
    "Ownership setup needs review"
  );
}

function draftAnnualRentCents(lease: LeaseIntakeExtraction["lease"]) {
  if (!lease) {
    return null;
  }
  if (
    lease.annual_rent_cents !== null &&
    lease.annual_rent_cents !== undefined
  ) {
    return lease.annual_rent_cents;
  }
  const dollars = lease.annual_rent_dollars ?? lease.annual_rent;
  return dollars === null || dollars === undefined
    ? null
    : Math.round(dollars * 100);
}

function readinessBlockers(row: {
  gst_readiness_blockers?: string[];
  xero_readiness_blockers?: string[];
  invoice_readiness_blockers?: string[];
}) {
  return [
    ...(row.gst_readiness_blockers ?? []),
    ...(row.xero_readiness_blockers ?? []),
    ...(row.invoice_readiness_blockers ?? []),
  ].filter(Boolean);
}

function leaseIntakeApplyBlockers(params: {
  propertyId: string;
  unitId: string;
  tenantId: string;
  property: LeaseIntakeExtraction["property"] | null;
  unit: LeaseIntakeExtraction["tenancy_unit"] | null;
  tenant: LeaseIntakeExtraction["tenant"] | null;
  lease: LeaseIntakeExtraction["lease"] | null;
}) {
  const blockers: string[] = [];
  if (
    !params.propertyId &&
    !inputString(params.property?.name).trim() &&
    !inputString(
      params.property?.street_address ?? params.property?.address,
    ).trim()
  ) {
    blockers.push(
      "Choose an existing property or enter a property name/address.",
    );
  }
  if (
    !params.unitId &&
    !inputString(params.unit?.unit_label ?? params.unit?.label).trim()
  ) {
    blockers.push("Choose an existing unit or enter a unit label.");
  }
  if (
    !params.tenantId &&
    !inputString(params.tenant?.legal_name ?? params.tenant?.name).trim()
  ) {
    blockers.push("Choose an existing tenant or enter a tenant legal name.");
  }
  if (!inputString(params.lease?.commencement_date).trim()) {
    blockers.push("Confirm the lease start date.");
  }
  if (!inputString(params.lease?.expiry_date).trim()) {
    blockers.push("Confirm the lease expiry date.");
  }
  if (draftAnnualRentCents(params.lease) === null) {
    blockers.push("Confirm the lease rent amount.");
  }
  if (!inputString(params.lease?.rent_frequency).trim()) {
    blockers.push("Confirm the lease rent frequency.");
  }
  return blockers;
}

function tenantDisplayName(tenant: TenantRecord | undefined) {
  if (!tenant) {
    return "Unassigned tenant";
  }
  return tenant.trading_name
    ? `${tenant.trading_name} (${tenant.legal_name})`
    : tenant.legal_name;
}

function intakeExtraction(
  intake: LeaseIntakeRecord | undefined,
): LeaseIntakeExtraction | null {
  return (
    intake?.extracted_data ??
    intake?.extracted ??
    intake?.draft ??
    intake?.review ??
    null
  );
}

function isLeaseIntakeProcessing(intake: LeaseIntakeRecord | undefined) {
  return [
    "created",
    "uploaded",
    "queued",
    "pending",
    "processing",
    "extracting",
  ].includes((intake?.status ?? "").toLowerCase());
}

function isLeaseIntakeFailed(intake: LeaseIntakeRecord | undefined) {
  return ["failed", "error", "extraction_failed", "apply_failed"].includes(
    (intake?.status ?? "").toLowerCase(),
  );
}

function isLeaseIntakeApplied(intake: LeaseIntakeRecord | undefined) {
  return Boolean(
    intake?.applied_at || (intake?.status ?? "").toLowerCase() === "applied",
  );
}

function friendlyStatus(intake: LeaseIntakeRecord | undefined) {
  if (!intake) {
    return "No lease selected";
  }
  if (isLeaseIntakeApplied(intake)) {
    return "Applied";
  }
  if (isLeaseIntakeFailed(intake)) {
    return "Needs another try";
  }
  if (isLeaseIntakeProcessing(intake)) {
    return "Reading lease";
  }
  if (intakeExtraction(intake)) {
    return "Ready to review";
  }
  return intake.status?.replaceAll("_", " ") || "Ready";
}

function presentValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-AU").format(value);
  }
  return String(value);
}

function compactValues(values: Array<unknown>) {
  return values.filter(
    (value) => value !== null && value !== undefined && value !== "",
  );
}

function joinValues(values: Array<unknown>) {
  const parts = compactValues(values).map((value) => String(value));
  return parts.length ? parts.join(", ") : undefined;
}

function cloneExtraction(
  extraction: LeaseIntakeExtraction,
): LeaseIntakeExtraction {
  return JSON.parse(JSON.stringify(extraction)) as LeaseIntakeExtraction;
}

function inputString(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function friendlyError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Something went wrong. Please try again.";
  }
  if (
    error.message.includes("Entity denied") ||
    error.message.includes("You do not have access to this entity")
  ) {
    return "That entity is no longer available. Select another entity to continue.";
  }
  if (error.message.includes("Property not found")) {
    return "That property is no longer available. Select another property to continue.";
  }
  return error.message;
}

function ReviewFields({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: unknown }>;
}) {
  const visibleItems = items.filter(
    (item) =>
      item.value !== null && item.value !== undefined && item.value !== "",
  );
  return (
    <div className="rounded-md border border-border bg-white">
      <div className="border-b border-border px-3 py-2 text-sm font-semibold">
        {title}
      </div>
      <dl className="grid gap-2 p-3 text-sm">
        {visibleItems.length ? (
          visibleItems.map((item) => (
            <div key={item.label} className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="font-medium">{presentValue(item.value)}</dd>
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">
            Nothing found yet.
          </div>
        )}
      </dl>
    </div>
  );
}

function leaseSortValue(lease: LeaseRecord) {
  if (lease.status === "active") {
    return 0;
  }
  if (lease.status === "holding_over") {
    return 1;
  }
  if (lease.status === "pending") {
    return 2;
  }
  return 3;
}

function pickUnitLease(leases: LeaseRecord[] | undefined, unitId: string) {
  return [...(leases ?? [])]
    .filter((lease) => lease.tenancy_unit_id === unitId)
    .sort((a, b) => {
      const statusDelta = leaseSortValue(a) - leaseSortValue(b);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return (b.commencement_date ?? "").localeCompare(
        a.commencement_date ?? "",
      );
    })[0];
}

function obligationSortValue(obligation: ObligationRecord) {
  return obligation.priority;
}

function obligationPriorityLabel(priority: number) {
  if (priority <= 0) {
    return "Critical";
  }
  if (priority === 1) {
    return "High";
  }
  if (priority >= 3) {
    return "Low";
  }
  return "Normal";
}

function obligationPriorityRank(priority: ObligationFormValues["priority"]) {
  return (
    obligationPriorities.find((option) => option.value === priority)?.rank ?? 2
  );
}

function propertyPortfolioViewOptions(): Array<{
  id: PropertyPortfolioView;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> {
  return [
    { id: "table", label: "Table", icon: Table2 },
    { id: "board", label: "Board", icon: LayoutGrid },
    { id: "map", label: "Map", icon: MapPin },
    { id: "calendar", label: "Calendar", icon: CalendarClock },
  ];
}

function propertyRegionLabel(property: PropertyRecord) {
  return [property.suburb, property.state, property.postcode]
    .filter(Boolean)
    .join(" ");
}

function propertyMapPoint(property: PropertyRecord, index: number) {
  const seed = `${property.name}-${property.street_address}-${property.suburb}-${property.postcode}`;
  const total = seed.split("").reduce((sum, character, characterIndex) => {
    return sum + character.charCodeAt(0) * (characterIndex + 1);
  }, index * 97);
  return {
    left: 10 + (total % 76),
    top: 12 + ((total >> 3) % 68),
  };
}

type PropertyMapFocus = "all" | "lease_risk" | "vacancy";

const propertyMapFocusOptions: Array<{
  key: PropertyMapFocus;
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "lease_risk", label: "Lease risk" },
  { key: "vacancy", label: "Vacancy" },
];

type PropertyMapPlanningLane = {
  id: PropertyMapFocus | "stable";
  label: string;
  count: number;
  detail: string;
  tone: "neutral" | "success" | "warning" | "danger" | "primary";
};

function propertyMapFocusMatches({
  focus,
  occupancy,
  expiry,
}: {
  focus: PropertyMapFocus;
  occupancy: PropertyOccupancy | undefined;
  expiry: NextLeaseExpiry | undefined;
}) {
  if (focus === "lease_risk") {
    return Boolean(expiry && expiry.daysUntil <= 90);
  }
  if (focus === "vacancy") {
    return ["vacant", "partial", "unknown"].includes(
      occupancy?.status ?? "unknown",
    );
  }
  return true;
}

function propertyMapPlanningLanes({
  properties,
  occupancyByPropertyId,
  nextExpiryByPropertyId,
}: {
  properties: PropertyRecord[];
  occupancyByPropertyId: Map<string, PropertyOccupancy>;
  nextExpiryByPropertyId: Map<string, NextLeaseExpiry>;
}): PropertyMapPlanningLane[] {
  const leaseRisk = properties.filter((property) =>
    propertyMapFocusMatches({
      focus: "lease_risk",
      occupancy: occupancyByPropertyId.get(property.id),
      expiry: nextExpiryByPropertyId.get(property.id),
    }),
  );
  const vacancy = properties.filter((property) =>
    propertyMapFocusMatches({
      focus: "vacancy",
      occupancy: occupancyByPropertyId.get(property.id),
      expiry: nextExpiryByPropertyId.get(property.id),
    }),
  );
  const stable = properties.filter((property) => {
    const occupancy = occupancyByPropertyId.get(property.id);
    const expiry = nextExpiryByPropertyId.get(property.id);
    return occupancy?.status === "leased" && (!expiry || expiry.daysUntil > 90);
  });

  return [
    {
      id: "lease_risk",
      label: "Lease risk",
      count: leaseRisk.length,
      detail:
        leaseRisk[0]?.name ??
        "No active lease expiries are inside the 90 day window.",
      tone: leaseRisk.length ? "warning" : "success",
    },
    {
      id: "vacancy",
      label: "Vacancy focus",
      count: vacancy.length,
      detail:
        vacancy[0]?.name ??
        "No vacant, partial, or unknown occupancy records are in this view.",
      tone: vacancy.length ? "danger" : "success",
    },
    {
      id: "stable",
      label: "Stable holdings",
      count: stable.length,
      detail:
        stable[0]?.name ??
        "No fully leased properties outside the 90 day expiry window.",
      tone: stable.length ? "primary" : "neutral",
    },
  ];
}

function propertyMapRegionRows({
  properties,
  occupancyByPropertyId,
  nextExpiryByPropertyId,
}: {
  properties: PropertyRecord[];
  occupancyByPropertyId: Map<string, PropertyOccupancy>;
  nextExpiryByPropertyId: Map<string, NextLeaseExpiry>;
}) {
  const rows = new Map<
    string,
    {
      region: string;
      count: number;
      vacancyCount: number;
      leaseRiskCount: number;
    }
  >();

  for (const property of properties) {
    const region = propertyRegionLabel(property) || "No region";
    const occupancy = occupancyByPropertyId.get(property.id);
    const expiry = nextExpiryByPropertyId.get(property.id);
    const row = rows.get(region) ?? {
      region,
      count: 0,
      vacancyCount: 0,
      leaseRiskCount: 0,
    };
    row.count += 1;
    if (
      ["vacant", "partial", "unknown"].includes(occupancy?.status ?? "unknown")
    ) {
      row.vacancyCount += 1;
    }
    if (expiry && expiry.daysUntil <= 90) {
      row.leaseRiskCount += 1;
    }
    rows.set(region, row);
  }

  return Array.from(rows.values()).sort(
    (left, right) =>
      right.leaseRiskCount - left.leaseRiskCount ||
      right.vacancyCount - left.vacancyCount ||
      right.count - left.count ||
      left.region.localeCompare(right.region),
  );
}

function propertyMapPlanningBrief({
  properties,
  focus,
  occupancyByPropertyId,
  nextExpiryByPropertyId,
}: {
  properties: PropertyRecord[];
  focus: PropertyMapFocus;
  occupancyByPropertyId: Map<string, PropertyOccupancy>;
  nextExpiryByPropertyId: Map<string, NextLeaseExpiry>;
}) {
  if (!properties.length) {
    return "No properties match the current map focus.";
  }
  const lines = [
    `Portfolio map brief - ${
      propertyMapFocusOptions.find((option) => option.key === focus)?.label ??
      "All"
    }`,
  ];
  for (const property of properties.slice(0, 20)) {
    const occupancy = occupancyByPropertyId.get(property.id);
    const expiry = nextExpiryByPropertyId.get(property.id);
    lines.push(
      [
        property.name,
        propertyRegionLabel(property) || property.street_address,
        occupancy ? occupancyBadgeLabel(occupancy) : "No occupancy data",
        expiry
          ? `Earliest expiry ${formatDate(expiry.date)} (${nextExpiryChipLabel(expiry)})`
          : "No active lease expiry found",
      ].join(" | "),
    );
  }
  if (properties.length > 20) {
    lines.push(
      `${properties.length - 20} more propert${
        properties.length === 21 ? "y" : "ies"
      }`,
    );
  }
  return lines.join("\n");
}

function leaseEventKindLabel(kind: LeaseEventRecord["kind"]) {
  if (kind === "rent_review") {
    return "Rent review";
  }
  if (kind === "lease_expiry") {
    return "Lease expiry";
  }
  if (kind === "tenant_onboarding") {
    return "Tenant onboarding";
  }
  return "Obligation";
}

function leaseEventTone(kind: LeaseEventRecord["kind"]) {
  if (kind === "lease_expiry") {
    return "warning" as const;
  }
  if (kind === "rent_review") {
    return "primary" as const;
  }
  if (kind === "tenant_onboarding") {
    return "success" as const;
  }
  return "neutral" as const;
}

function rentRollLeaseEventChip(date: string, tenantName: string | null) {
  return [dueStatus(date).label, tenantName].filter(Boolean).join(" · ");
}

function rentRollLeaseEvents(
  rows: RentRollRow[],
  visiblePropertyIds: Set<string>,
) {
  const activeStatuses = new Set(["active", "holding_over", "pending"]);
  const events: LeaseEventRecord[] = [];

  for (const row of rows) {
    if (
      !row.lease_id ||
      !row.property_id ||
      !visiblePropertyIds.has(row.property_id) ||
      !activeStatuses.has(row.lease_status ?? "")
    ) {
      continue;
    }

    const href = `/properties?${new URLSearchParams({
      entity_id: row.entity_id,
      property_id: row.property_id,
      view: "calendar",
    }).toString()}`;
    const target = {
      property_id: row.property_id,
      tenancy_unit_id: row.tenancy_unit_id,
      lease_id: row.lease_id,
      tenant_id: row.tenant_id,
      document_intake_id: null,
      obligation_id: null,
      billing_draft_id: null,
      invoice_draft_id: null,
    };

    if (row.next_review_date) {
      events.push({
        id: `rent-roll-review-${row.lease_id}`,
        kind: "rent_review",
        title: `${row.property_name} ${row.unit_label} rent review`,
        date: row.next_review_date,
        chip: rentRollLeaseEventChip(row.next_review_date, row.tenant_name),
        href,
        target,
        rank: daysUntil(row.next_review_date),
      });
    }

    if (row.expiry_date) {
      events.push({
        id: `rent-roll-expiry-${row.lease_id}`,
        kind: "lease_expiry",
        title: `${row.property_name} ${row.unit_label} lease expiry`,
        date: row.expiry_date,
        chip: rentRollLeaseEventChip(row.expiry_date, row.tenant_name),
        href,
        target,
        rank: daysUntil(row.expiry_date),
      });
    }
  }

  return events;
}

function leaseEventSortValue(event: LeaseEventRecord) {
  return event.date
    ? new Date(`${event.date.slice(0, 10)}T00:00:00`).getTime()
    : Number.POSITIVE_INFINITY;
}

function leaseEventDedupeKey(event: LeaseEventRecord) {
  return `${event.kind}-${event.target.lease_id ?? event.id}-${event.date ?? "undated"}`;
}

function calendarEventDaysUntil(event: LeaseEventRecord) {
  return event.date ? daysUntil(event.date) : Number.POSITIVE_INFINITY;
}

type CalendarHorizonFilter = "all" | "overdue" | "next_30" | "next_90";

type CalendarReviewRow = {
  id: string;
  event: LeaseEventRecord;
  label: string;
  detail: string;
  action: string;
  tone: "neutral" | "primary" | "success" | "warning" | "danger";
  daysUntil: number;
};

type CalendarDecisionLane = {
  key: Extract<LeaseEventRecord["kind"], "rent_review" | "lease_expiry">;
  label: string;
  count: number;
  overdueCount: number;
  immediateCount: number;
  planningCount: number;
  nextEvent: LeaseEventRecord | null;
  action: string;
  tone: "neutral" | "primary" | "warning" | "danger";
};

const calendarHorizonOptions: Array<{
  key: CalendarHorizonFilter;
  label: string;
}> = [
  { key: "all", label: "All dates" },
  { key: "overdue", label: "Overdue" },
  { key: "next_30", label: "Next 30" },
  { key: "next_90", label: "Next 90" },
];

function calendarHorizonMatches(
  event: LeaseEventRecord,
  horizon: CalendarHorizonFilter,
) {
  const days = calendarEventDaysUntil(event);
  if (horizon === "overdue") {
    return days < 0;
  }
  if (horizon === "next_30") {
    return days >= 0 && days <= 30;
  }
  if (horizon === "next_90") {
    return days >= 0 && days <= 90;
  }
  return true;
}

function calendarWorkloadRows(events: LeaseEventRecord[]) {
  const overdue = events.filter((event) => calendarEventDaysUntil(event) < 0);
  const next30 = events.filter((event) => {
    const days = calendarEventDaysUntil(event);
    return days >= 0 && days <= 30;
  });
  const next90 = events.filter((event) => {
    const days = calendarEventDaysUntil(event);
    return days > 30 && days <= 90;
  });
  const later = events.filter((event) => calendarEventDaysUntil(event) > 90);

  return [
    {
      key: "overdue",
      label: "Overdue",
      count: overdue.length,
      detail: overdue[0]?.title ?? "No overdue lease events.",
      tone: overdue.length ? ("danger" as const) : ("success" as const),
    },
    {
      key: "next30",
      label: "Next 30 days",
      count: next30.length,
      detail: next30[0]?.title ?? "No immediate lease events.",
      tone: next30.length ? ("warning" as const) : ("neutral" as const),
    },
    {
      key: "next90",
      label: "31-90 days",
      count: next90.length,
      detail: next90[0]?.title ?? "No near-term lease events.",
      tone: next90.length ? ("primary" as const) : ("neutral" as const),
    },
    {
      key: "later",
      label: "Later",
      count: later.length,
      detail: later[0]?.title ?? "No later lease events in this view.",
      tone: later.length ? ("neutral" as const) : ("success" as const),
    },
  ];
}

function calendarDecisionLanes(
  events: LeaseEventRecord[],
): CalendarDecisionLane[] {
  return (
    [
      {
        key: "rent_review",
        label: "Rent reviews",
        emptyAction: "No rent review dates in this view.",
        action: "Prepare notice pack",
      },
      {
        key: "lease_expiry",
        label: "Lease expiries",
        emptyAction: "No lease expiry dates in this view.",
        action: "Prepare renewal decision",
      },
    ] as const
  ).map((lane) => {
    const laneEvents = events
      .filter((event) => event.kind === lane.key)
      .sort(
        (left, right) =>
          calendarEventDaysUntil(left) - calendarEventDaysUntil(right) ||
          leaseEventSortValue(left) - leaseEventSortValue(right),
      );
    const overdueCount = laneEvents.filter(
      (event) => calendarEventDaysUntil(event) < 0,
    ).length;
    const immediateCount = laneEvents.filter((event) => {
      const days = calendarEventDaysUntil(event);
      return days >= 0 && days <= 30;
    }).length;
    const planningCount = laneEvents.filter((event) => {
      const days = calendarEventDaysUntil(event);
      return days > 30 && days <= 90;
    }).length;
    return {
      key: lane.key,
      label: lane.label,
      count: laneEvents.length,
      overdueCount,
      immediateCount,
      planningCount,
      nextEvent: laneEvents[0] ?? null,
      action: laneEvents.length ? lane.action : lane.emptyAction,
      tone: overdueCount
        ? "danger"
        : immediateCount
          ? "warning"
          : planningCount
            ? "primary"
            : "neutral",
    };
  });
}

function calendarPlanningBrief(events: LeaseEventRecord[]) {
  if (!events.length) {
    return "No rent reviews or lease expiries match the current filters.";
  }
  const lines = ["Portfolio lease calendar"];
  for (const event of events.slice(0, 20)) {
    lines.push(
      `- ${formatDate(event.date)} | ${leaseEventKindLabel(event.kind)} | ${event.title} | ${event.chip}`,
    );
  }
  if (events.length > 20) {
    lines.push(
      `- ${events.length - 20} more event${events.length === 21 ? "" : "s"}`,
    );
  }
  return lines.join("\n");
}

function calendarReviewRow(event: LeaseEventRecord): CalendarReviewRow {
  const days = calendarEventDaysUntil(event);
  const isExpiry = event.kind === "lease_expiry";
  if (days < 0) {
    return {
      id: `review-${event.id}`,
      event,
      label: "Overdue",
      detail:
        "Confirm whether this date was handled, then close or correct the lease record.",
      action: isExpiry ? "Check occupancy status" : "Check review outcome",
      tone: "danger",
      daysUntil: days,
    };
  }
  if (days <= 30) {
    return {
      id: `review-${event.id}`,
      event,
      label: "Immediate",
      detail: isExpiry
        ? "Prepare renewal, holdover, or vacancy decision before the expiry window closes."
        : "Confirm CPI/market basis and prepare the review notice pack.",
      action: isExpiry ? "Prepare expiry decision" : "Prepare review notice",
      tone: "warning",
      daysUntil: days,
    };
  }
  if (days <= 90) {
    return {
      id: `review-${event.id}`,
      event,
      label: "Plan",
      detail: isExpiry
        ? "Book the lease decision checkpoint and gather tenant context."
        : "Schedule the rent review check and confirm evidence required.",
      action: isExpiry ? "Schedule lease checkpoint" : "Schedule review check",
      tone: "primary",
      daysUntil: days,
    };
  }
  return {
    id: `review-${event.id}`,
    event,
    label: "Monitor",
    detail:
      "Keep this in the forward calendar and revisit once it enters the 90 day window.",
    action: "Monitor date",
    tone: "neutral",
    daysUntil: days,
  };
}

function calendarReviewRows(events: LeaseEventRecord[]) {
  return events
    .map((event) => calendarReviewRow(event))
    .sort(
      (left, right) =>
        left.daysUntil - right.daysUntil ||
        leaseEventSortValue(left.event) - leaseEventSortValue(right.event),
    );
}

function calendarReviewBrief(rows: CalendarReviewRow[]) {
  if (!rows.length) {
    return "No rent review or lease expiry follow-ups match the current filters.";
  }
  const lines = ["Portfolio lease follow-up queue"];
  for (const row of rows.slice(0, 20)) {
    lines.push(
      [
        row.label,
        formatDate(row.event.date),
        leaseEventKindLabel(row.event.kind),
        row.action,
        row.event.title,
        row.event.chip,
      ].join(" | "),
    );
  }
  if (rows.length > 20) {
    lines.push(
      `${rows.length - 20} more follow-up${rows.length === 21 ? "" : "s"}`,
    );
  }
  return lines.join("\n");
}

function propertyPortfolioViewFromSearch(): PropertyPortfolioView {
  if (typeof window === "undefined") {
    return "table";
  }
  const view = new URLSearchParams(window.location.search).get("view");
  if (
    view === "board" ||
    view === "table" ||
    view === "map" ||
    view === "calendar"
  ) {
    return view;
  }
  return "table";
}

function Workspace({
  initialView = "table",
}: {
  initialView?: PropertyPortfolioView;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const propertyDocumentInputRef = useRef<HTMLInputElement>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [ownerTagFilter, setOwnerTagFilter] = useState<string>("");
  const [occupancyFilter, setOccupancyFilter] = useState<
    PropertyOccupancyStatus | "all"
  >("all");
  const [propertyView, setPropertyView] =
    useState<PropertyPortfolioView>(initialView);
  // Row-density preference for the desktop properties table (C6).
  // Defaults to "comfortable"; hydrated from localStorage after mount to
  // avoid an SSR mismatch, mirroring the saved-views persistence pattern.
  const [propertyDensity, setPropertyDensity] =
    useState<PropertyRowDensity>("comfortable");
  const [rentRollPropertyId, setRentRollPropertyId] = useState<string>("");
  const [rentRollAsOf, setRentRollAsOf] = useState<string>(() =>
    dateOnly(new Date()),
  );
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<PropertyWorkspaceTab>("portfolio");
  const [editing, setEditing] = useState<PropertyRecord | null>(null);
  const [propertyEditorOpen, setPropertyEditorOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<TenancyUnitRecord | null>(
    null,
  );
  const [editingLease, setEditingLease] = useState<LeaseRecord | null>(null);
  const [leaseEditorOpen, setLeaseEditorOpen] = useState(false);
  const [leaseMoreOpen, setLeaseMoreOpen] = useState(false);
  const [unitEditorOpen, setUnitEditorOpen] = useState(false);
  // Delayed-unmount for the three workspace modals so each plays its
  // exit animation before unmounting. Right-slide drawers (lease,
  // property) hold the Slow=300ms duration; the centred unit editor
  // matches Base=200ms.
  const leaseEditorRender = useUnmountDelay(leaseEditorOpen, 300);
  const propertyEditorRender = useUnmountDelay(propertyEditorOpen, 300);
  const unitEditorRender = useUnmountDelay(unitEditorOpen, 200);
  const [activeLeaseIntakeId, setActiveLeaseIntakeId] = useState<string>("");
  const [leaseReviewDraftId, setLeaseReviewDraftId] = useState<string>("");
  const [leaseReviewDraft, setLeaseReviewDraft] =
    useState<LeaseIntakeExtraction | null>(null);
  const [leaseReviewPropertyId, setLeaseReviewPropertyId] = useState("");
  const [leaseReviewUnitId, setLeaseReviewUnitId] = useState("");
  const [leaseReviewTenantId, setLeaseReviewTenantId] = useState("");
  const [propertyDocumentDropActive, setPropertyDocumentDropActive] =
    useState(false);
  const [copiedOnboardingId, setCopiedOnboardingId] = useState<string>("");
  const [billingProfileOpen, setBillingProfileOpen] = useState(false);
  const [propertyEnrichmentSuggestions, setPropertyEnrichmentSuggestions] =
    useState<EnrichmentSuggestion[]>([]);
  const [propertyImageCandidates, setPropertyImageCandidates] = useState<
    PropertyImageCandidateRecord[]
  >([]);
  const [propertyImageWarnings, setPropertyImageWarnings] = useState<string[]>(
    [],
  );
  const [imagesPanelOpen, setImagesPanelOpen] = useState(false);
  const [applyingPropertyImageUrl, setApplyingPropertyImageUrl] =
    useState<string>("");
  const [
    failedPropertyImageCandidateUrls,
    setFailedPropertyImageCandidateUrls,
  ] = useState<Set<string>>(() => new Set());

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });
  const propertiesQuery = useQuery({
    queryKey: ["properties", selectedEntityId],
    queryFn: () => listProperties(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const tenancyUnitsQuery = useQuery({
    queryKey: ["tenancy-units", selectedPropertyId],
    queryFn: () => listTenancyUnits(selectedPropertyId),
    enabled: Boolean(selectedPropertyId),
  });
  const tenantsQuery = useQuery({
    queryKey: ["tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const leasesQuery = useQuery({
    queryKey: ["leases", selectedPropertyId],
    queryFn: () => listLeasesByProperty(selectedPropertyId),
    enabled: Boolean(selectedPropertyId),
  });
  const obligationsQuery = useQuery({
    queryKey: ["obligations", selectedEntityId, selectedPropertyId],
    queryFn: () =>
      listObligations({
        entity_id: selectedEntityId,
        property_id: selectedPropertyId || undefined,
      }),
    enabled: Boolean(selectedEntityId),
  });
  const rentRollQuery = useQuery({
    queryKey: ["rent-roll", selectedEntityId, rentRollPropertyId, rentRollAsOf],
    queryFn: () =>
      listRentRoll({
        entity_id: selectedEntityId,
        property_id: rentRollPropertyId || undefined,
        as_of: rentRollAsOf,
      }),
    enabled: Boolean(selectedEntityId),
  });
  const calendarRentRollQuery = useQuery({
    queryKey: ["rent-roll-calendar", selectedEntityId, rentRollAsOf],
    queryFn: () =>
      listRentRoll({
        entity_id: selectedEntityId,
        as_of: rentRollAsOf,
      }),
    enabled: Boolean(selectedEntityId && rentRollPropertyId),
  });
  const insightsOverviewQuery = useQuery<InsightsOverviewRecord>({
    queryKey: ["insights-overview", selectedEntityId, rentRollAsOf],
    queryFn: () => getInsightsOverview(selectedEntityId, rentRollAsOf),
    enabled: Boolean(selectedEntityId),
  });
  const chargeRulesQuery = useQuery({
    queryKey: ["charge-rules", selectedEntityId, selectedPropertyId],
    queryFn: () =>
      listChargeRules({
        entity_id: selectedEntityId,
        property_id: selectedPropertyId || undefined,
      }),
    enabled: Boolean(selectedEntityId),
  });
  const tenantOnboardingsQuery = useQuery({
    queryKey: ["tenant-onboarding", selectedEntityId],
    queryFn: () => listTenantOnboardings(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const leaseReviewUnitsQuery = useQuery({
    queryKey: ["lease-review-units", leaseReviewPropertyId],
    queryFn: () => listTenancyUnits(leaseReviewPropertyId),
    enabled: Boolean(leaseReviewPropertyId),
  });
  const leaseIntakeQuery = useQuery({
    queryKey: ["lease-intake", activeLeaseIntakeId],
    queryFn: () => getLeaseIntake(activeLeaseIntakeId),
    enabled: Boolean(activeLeaseIntakeId),
    refetchInterval: (query) =>
      isLeaseIntakeProcessing(query.state.data) ? 2500 : false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ownerTag = params.get("owner_tag") ?? "";
    setOwnerTagFilter((current) => (current === ownerTag ? current : ownerTag));
    const occupancy = params.get("occupancy");
    if (
      occupancy === "all" ||
      occupancy === "leased" ||
      occupancy === "leased_internal" ||
      occupancy === "partial" ||
      occupancy === "vacant" ||
      occupancy === "unknown"
    ) {
      setOccupancyFilter(occupancy);
    }
    setPropertyView(propertyPortfolioViewFromSearch());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (occupancyFilter === "all") {
      url.searchParams.delete("occupancy");
    } else {
      url.searchParams.set("occupancy", occupancyFilter);
    }
    if (propertyView === "table") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", propertyView);
    }
    window.history.replaceState(null, "", url);
  }, [occupancyFilter, propertyView]);

  // Hydrate the row-density preference once on mount (C6).
  useEffect(() => {
    const stored = window.localStorage.getItem(PROPERTY_DENSITY_STORAGE_KEY);
    if (stored === "compact" || stored === "comfortable") {
      setPropertyDensity(stored);
    }
  }, []);

  // Persist the row-density preference whenever it changes (C6).
  useEffect(() => {
    window.localStorage.setItem(PROPERTY_DENSITY_STORAGE_KEY, propertyDensity);
  }, [propertyDensity]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("entity_id");
    const stored =
      window.localStorage.getItem(ENTITY_STORAGE_KEY) ??
      window.localStorage.getItem("stewart.entity_id");
    const firstEntity = entitiesQuery.data?.[0]?.id;
    const accessibleIds = new Set(
      (entitiesQuery.data ?? []).map((entity) => entity.id),
    );
    const preferred = [fromUrl, stored, firstEntity].find(
      (id) => id && accessibleIds.has(id),
    );
    const next = preferred || firstEntity || "";
    if (!selectedEntityId && next) {
      setSelectedEntityId(next);
    }
    if (
      selectedEntityId &&
      accessibleIds.size &&
      !accessibleIds.has(selectedEntityId)
    ) {
      setSelectedEntityId(next);
      setSelectedPropertyId("");
      window.localStorage.removeItem(ENTITY_STORAGE_KEY);
      window.localStorage.removeItem(PROPERTY_STORAGE_KEY);
      const url = new URL(window.location.href);
      if (next) {
        url.searchParams.set("entity_id", next);
      } else {
        url.searchParams.delete("entity_id");
      }
      url.searchParams.delete("property_id");
      window.history.replaceState(null, "", url);
    }
  }, [entitiesQuery.data, selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
      const url = new URL(window.location.href);
      url.searchParams.set("entity_id", selectedEntityId);
      window.history.replaceState(null, "", url);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    setPropertyEnrichmentSuggestions([]);
    setPropertyImageCandidates([]);
    setPropertyImageWarnings([]);
    setApplyingPropertyImageUrl("");
    setFailedPropertyImageCandidateUrls(new Set());
  }, [selectedPropertyId]);

  const selectedEntity = useMemo(
    () => entitiesQuery.data?.find((entity) => entity.id === selectedEntityId),
    [entitiesQuery.data, selectedEntityId],
  );

  const selectedProperty = useMemo(
    () =>
      propertiesQuery.data?.find(
        (property) => property.id === selectedPropertyId,
      ),
    [propertiesQuery.data, selectedPropertyId],
  );
  const selectedPropertyImage = useMemo(
    () => propertyPrimaryImage(selectedProperty),
    [selectedProperty],
  );
  const ownershipPaletteByLabel = useMemo(
    () =>
      propertyOwnershipPaletteMap(
        propertiesQuery.data ?? [],
        selectedEntity?.name,
      ),
    [propertiesQuery.data, selectedEntity?.name],
  );
  const ownershipTags = useMemo(
    () =>
      propertyOwnershipTagDirectory(
        propertiesQuery.data ?? [],
        selectedEntity?.name,
      ),
    [propertiesQuery.data, selectedEntity?.name],
  );
  const activeOwnerTag = useMemo(
    () => ownershipTags.find((tag) => tag.key === ownerTagFilter) ?? null,
    [ownershipTags, ownerTagFilter],
  );
  const occupancyByPropertyId = useMemo(() => {
    const rows = rentRollQuery.data ?? [];
    const map = new Map<string, PropertyOccupancy>();
    const properties = propertiesQuery.data ?? [];
    for (const property of properties) {
      map.set(property.id, propertyOccupancyFromRentRoll(property, rows));
    }
    return map;
  }, [propertiesQuery.data, rentRollQuery.data]);
  const nextExpiryByPropertyId = useMemo(() => {
    const rows = rentRollQuery.data ?? [];
    const map = new Map<string, NextLeaseExpiry>();
    const properties = propertiesQuery.data ?? [];
    for (const property of properties) {
      const expiry = propertyNextExpiryFromRentRoll(property.id, rows);
      if (expiry) {
        map.set(property.id, expiry);
      }
    }
    return map;
  }, [propertiesQuery.data, rentRollQuery.data]);
  const occupancyCounts = useMemo(() => {
    const counts: Record<PropertyOccupancyStatus | "all", number> = {
      all: 0,
      leased: 0,
      leased_internal: 0,
      partial: 0,
      vacant: 0,
      unknown: 0,
    };
    for (const occupancy of occupancyByPropertyId.values()) {
      counts.all += 1;
      counts[occupancy.status] += 1;
    }
    return counts;
  }, [occupancyByPropertyId]);
  const displayedProperties = useMemo(() => {
    const properties = propertiesQuery.data ?? [];
    let filtered = properties;
    if (ownerTagFilter) {
      filtered = filtered.filter((property) =>
        propertyMatchesOwnershipTag(
          property,
          selectedEntity?.name,
          ownerTagFilter,
        ),
      );
    }
    if (occupancyFilter !== "all") {
      filtered = filtered.filter(
        (property) =>
          occupancyByPropertyId.get(property.id)?.status === occupancyFilter,
      );
    }
    return filtered;
  }, [
    occupancyByPropertyId,
    occupancyFilter,
    ownerTagFilter,
    propertiesQuery.data,
    selectedEntity?.name,
  ]);
  // Only show the Area / Parking columns when at least one visible property
  // actually has that data. For portfolios that don't track building_sqm or
  // parking_spaces these rendered as full columns of "-" — dead width and
  // visual noise. Hiding empty columns keeps the table reading as finished.
  const showAreaColumn = displayedProperties.some(
    (property) => property.building_sqm != null,
  );
  const showParkingColumn = displayedProperties.some(
    (property) => property.parking_spaces != null,
  );
  const propertyTableColumnCount =
    4 + (showAreaColumn ? 1 : 0) + (showParkingColumn ? 1 : 0);
  // Compact density trims the table-row vertical padding (C6); the
  // comfortable default keeps the existing py-3.
  const rowCellPadding =
    propertyDensity === "compact" ? "px-3 py-1.5" : "px-3 py-3";
  const leaseCalendarEvents = useMemo(() => {
    const visiblePropertyIds = new Set(
      displayedProperties.map((property) => property.id),
    );
    const insightEvents = (
      insightsOverviewQuery.data?.lease_event_snapshot.next_events ?? []
    ).filter(
      (event) =>
        (event.kind === "rent_review" || event.kind === "lease_expiry") &&
        (!event.target.property_id ||
          visiblePropertyIds.has(event.target.property_id)),
    );
    const rentRollEvents = rentRollLeaseEvents(
      calendarRentRollQuery.data ?? rentRollQuery.data ?? [],
      visiblePropertyIds,
    );
    const mergedEvents = [...insightEvents];
    const seenEventKeys = new Set(mergedEvents.map(leaseEventDedupeKey));

    for (const event of rentRollEvents) {
      const eventKey = leaseEventDedupeKey(event);
      if (!seenEventKeys.has(eventKey)) {
        seenEventKeys.add(eventKey);
        mergedEvents.push(event);
      }
    }

    return mergedEvents.sort((left, right) => {
      return (
        leaseEventSortValue(left) - leaseEventSortValue(right) ||
        left.rank - right.rank
      );
    });
  }, [
    calendarRentRollQuery.data,
    displayedProperties,
    insightsOverviewQuery.data?.lease_event_snapshot.next_events,
    rentRollQuery.data,
  ]);
  const entitiesLoading =
    !entitiesQuery.data &&
    (entitiesQuery.isLoading || entitiesQuery.isFetching);
  const entitySelectionLoading =
    entitiesLoading ||
    (!selectedEntityId && (entitiesQuery.data?.length ?? 0) > 0);
  const propertiesLoading =
    entitySelectionLoading ||
    (Boolean(selectedEntityId) &&
      !propertiesQuery.data &&
      (propertiesQuery.isLoading || propertiesQuery.isFetching));
  const tenancyUnitsLoading =
    Boolean(selectedPropertyId) &&
    !tenancyUnitsQuery.data &&
    (tenancyUnitsQuery.isLoading || tenancyUnitsQuery.isFetching);
  const tenantsLoading =
    Boolean(selectedEntityId) &&
    !tenantsQuery.data &&
    (tenantsQuery.isLoading || tenantsQuery.isFetching);
  const leasesLoading =
    Boolean(selectedPropertyId) &&
    !leasesQuery.data &&
    (leasesQuery.isLoading || leasesQuery.isFetching);
  const obligationsLoading =
    entitySelectionLoading ||
    (Boolean(selectedEntityId) &&
      !obligationsQuery.data &&
      (obligationsQuery.isLoading || obligationsQuery.isFetching));
  const rentRollLoading =
    entitySelectionLoading ||
    (Boolean(selectedEntityId) &&
      !rentRollQuery.data &&
      (rentRollQuery.isLoading || rentRollQuery.isFetching));
  const chargeRulesLoading =
    entitySelectionLoading ||
    (Boolean(selectedEntityId) &&
      !chargeRulesQuery.data &&
      (chargeRulesQuery.isLoading || chargeRulesQuery.isFetching));
  const tenantOnboardingsLoading =
    Boolean(selectedEntityId) &&
    !tenantOnboardingsQuery.data &&
    (tenantOnboardingsQuery.isLoading || tenantOnboardingsQuery.isFetching);
  const unitsWorkspaceLoading =
    Boolean(selectedPropertyId) &&
    (tenancyUnitsLoading ||
      tenantsLoading ||
      leasesLoading ||
      tenantOnboardingsLoading);
  const propertyWorkspaceLoading =
    propertiesLoading ||
    obligationsLoading ||
    rentRollLoading ||
    chargeRulesLoading ||
    unitsWorkspaceLoading;
  const propertyWorkspaceRefreshing =
    Boolean(selectedEntityId) &&
    (propertiesQuery.isFetching ||
      tenancyUnitsQuery.isFetching ||
      tenantsQuery.isFetching ||
      leasesQuery.isFetching ||
      obligationsQuery.isFetching ||
      rentRollQuery.isFetching ||
      chargeRulesQuery.isFetching ||
      tenantOnboardingsQuery.isFetching) &&
    !propertyWorkspaceLoading;
  const propertyWorkspaceError =
    entitiesQuery.error ??
    propertiesQuery.error ??
    tenancyUnitsQuery.error ??
    tenantsQuery.error ??
    leasesQuery.error ??
    obligationsQuery.error ??
    rentRollQuery.error ??
    chargeRulesQuery.error ??
    tenantOnboardingsQuery.error;
  const selectedPropertyApplyHistory = useMemo(
    () => propertyApplyHistory(selectedProperty),
    [selectedProperty],
  );
  const selectedPropertySources = useMemo(
    () => propertySourceCitations(selectedProperty),
    [selectedProperty],
  );
  const latestPropertyApply =
    selectedPropertyApplyHistory[selectedPropertyApplyHistory.length - 1] ??
    null;

  const unitTotals = useMemo(
    () =>
      tenancyUnitsQuery.data?.reduce(
        (totals, unit) => ({
          sqm: totals.sqm + (unit.sqm ?? 0),
          parking: totals.parking + (unit.parking_spaces ?? 0),
        }),
        { sqm: 0, parking: 0 },
      ) ?? { sqm: 0, parking: 0 },
    [tenancyUnitsQuery.data],
  );

  const tenantsById = useMemo(
    () =>
      new Map((tenantsQuery.data ?? []).map((tenant) => [tenant.id, tenant])),
    [tenantsQuery.data],
  );

  const occupancyTotals = useMemo(() => {
    const units = tenancyUnitsQuery.data ?? [];
    return units.reduce(
      (totals, unit) => {
        const lease = pickUnitLease(leasesQuery.data, unit.id);
        if (
          lease &&
          ["active", "holding_over", "pending"].includes(lease.status)
        ) {
          return { ...totals, occupied: totals.occupied + 1 };
        }
        return { ...totals, vacant: totals.vacant + 1 };
      },
      { occupied: 0, vacant: 0 },
    );
  }, [leasesQuery.data, tenancyUnitsQuery.data]);

  const unitsById = useMemo(
    () =>
      new Map((tenancyUnitsQuery.data ?? []).map((unit) => [unit.id, unit])),
    [tenancyUnitsQuery.data],
  );

  const activeObligations = useMemo(
    () =>
      [...(obligationsQuery.data ?? [])]
        .filter(
          (obligation) => !["completed", "waived"].includes(obligation.status),
        )
        .sort((a, b) => {
          const dueDelta = a.due_date.localeCompare(b.due_date);
          if (dueDelta !== 0) {
            return dueDelta;
          }
          return obligationSortValue(a) - obligationSortValue(b);
        }),
    [obligationsQuery.data],
  );

  const rentRollRows = useMemo(
    () =>
      [...(rentRollQuery.data ?? [])].sort((a, b) => {
        const propertyDelta = a.property_name.localeCompare(b.property_name);
        if (propertyDelta !== 0) {
          return propertyDelta;
        }
        return a.unit_label.localeCompare(b.unit_label);
      }),
    [rentRollQuery.data],
  );

  const chargeRulesByLeaseId = useMemo(() => {
    const byLeaseId = new Map<string, number>();
    for (const rule of chargeRulesQuery.data ?? []) {
      byLeaseId.set(
        rule.lease_id,
        (byLeaseId.get(rule.lease_id) ?? 0) + rule.amount_cents,
      );
    }
    return byLeaseId;
  }, [chargeRulesQuery.data]);

  const onboardingByLeaseId = useMemo(
    () =>
      new Map(
        (tenantOnboardingsQuery.data ?? []).map((onboarding) => [
          onboarding.lease_id,
          onboarding,
        ]),
      ),
    [tenantOnboardingsQuery.data],
  );

  const attentionCounts = useMemo(
    () =>
      activeObligations.reduce(
        (totals, obligation) => {
          const delta = daysUntil(obligation.due_date);
          if (delta < 0) {
            return { ...totals, overdue: totals.overdue + 1 };
          }
          if (delta <= 14) {
            return { ...totals, dueSoon: totals.dueSoon + 1 };
          }
          return totals;
        },
        { overdue: 0, dueSoon: 0 },
      ),
    [activeObligations],
  );

  const form = useForm<PropertyFormValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: defaultPropertyFormValues,
  });
  const ownershipStructure = form.watch("ownership_structure");
  const showOwnershipFields = ownershipStructure !== "current_entity";

  const unitForm = useForm<UnitFormValues>({
    resolver: zodResolver(unitSchema),
    defaultValues: defaultUnitFormValues,
  });

  const leaseForm = useForm<LeaseFormValues>({
    resolver: zodResolver(leaseSchema),
    defaultValues: defaultLeaseFormValues,
  });

  const obligationForm = useForm<ObligationFormValues>({
    resolver: zodResolver(obligationSchema),
    defaultValues: {
      ...defaultObligationFormValues,
      due_date: dateOnly(new Date()),
    },
  });

  const chargeRuleForm = useForm<ChargeRuleFormValues>({
    resolver: zodResolver(chargeRuleSchema),
    defaultValues: defaultChargeRuleFormValues,
  });

  useEffect(() => {
    if (!propertiesQuery.data) {
      return;
    }
    const properties = displayedProperties;
    if (properties.length === 0) {
      if (selectedPropertyId) {
        setSelectedPropertyId("");
        window.localStorage.removeItem(PROPERTY_STORAGE_KEY);
        const url = new URL(window.location.href);
        url.searchParams.delete("property_id");
        window.history.replaceState(null, "", url);
        setEditingUnit(null);
        setEditingLease(null);
        setLeaseEditorOpen(false);
        setUnitEditorOpen(false);
        unitForm.reset(defaultUnitFormValues);
        leaseForm.reset(defaultLeaseFormValues);
        chargeRuleForm.reset(defaultChargeRuleFormValues);
        obligationForm.setValue("lease_id", "");
      }
      return;
    }
    if (!properties.some((property) => property.id === selectedPropertyId)) {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("property_id");
      const stored =
        window.localStorage.getItem(PROPERTY_STORAGE_KEY) ??
        window.localStorage.getItem("stewart.property_id");
      const next =
        properties.find((property) => property.id === fromUrl)?.id ??
        properties.find((property) => property.id === stored)?.id ??
        properties[0].id;
      setSelectedPropertyId(next);
      window.localStorage.setItem(PROPERTY_STORAGE_KEY, next);
      const url = new URL(window.location.href);
      url.searchParams.set("property_id", next);
      window.history.replaceState(null, "", url);
      setEditingUnit(null);
      setEditingLease(null);
      setLeaseEditorOpen(false);
      setUnitEditorOpen(false);
      unitForm.reset(defaultUnitFormValues);
      leaseForm.reset(defaultLeaseFormValues);
      chargeRuleForm.reset(defaultChargeRuleFormValues);
      obligationForm.setValue("lease_id", "");
    }
  }, [
    chargeRuleForm,
    displayedProperties,
    leaseForm,
    obligationForm,
    propertiesQuery.data,
    selectedPropertyId,
    unitForm,
  ]);

  const mutation = useMutation({
    mutationFn: (values: PropertyFormValues) => {
      const payload = {
        entity_id: selectedEntityId,
        name: values.name,
        street_address: values.street_address,
        suburb: values.suburb || null,
        state: values.state || null,
        postcode: values.postcode || null,
        country_code: "AU",
        property_type: values.property_type,
        parcel_id: null,
        land_sqm: null,
        building_sqm: values.building_sqm ?? null,
        parking_spaces: values.parking_spaces ?? null,
        has_solar_pv: values.has_solar_pv,
        ownership_structure: values.ownership_structure,
        owner_legal_name: cleanText(values.owner_legal_name),
        owner_abn: cleanText(values.owner_abn),
        trustee_name: cleanText(values.trustee_name),
        trust_name: cleanText(values.trust_name),
        invoice_issuer_name: cleanText(values.invoice_issuer_name),
        billing_contact_name: cleanText(values.billing_contact_name),
        billing_email: cleanText(values.billing_email),
        invoice_reference: cleanText(values.invoice_reference),
        ownership_split: cleanText(values.ownership_split),
        owner_gst_registered: ownerGstPayload(values.owner_gst_registered),
        xero_contact_id: cleanText(values.xero_contact_id),
        xero_tracking_category: cleanText(values.xero_tracking_category),
        metadata: editing?.metadata ?? {},
      };
      return editing
        ? updateProperty(editing.id, payload)
        : createProperty(payload);
    },
    onSuccess: (property) => {
      queryClient.invalidateQueries({
        queryKey: ["properties", selectedEntityId],
      });
      setSelectedPropertyId(property.id);
      setEditing(null);
      setPropertyEditorOpen(false);
      setBillingProfileOpen(false);
      form.reset(defaultPropertyFormValues);
    },
  });

  // Inline-edit handler for property cells. Optimistic patch of the
  // /properties query cache so the table reflects the change instantly;
  // rollback + rethrow on failure so <InlineEditCell> can keep the cell
  // in edit mode with an inline error.
  async function savePropertyField(
    propertyId: string,
    field: "name" | "street_address" | "owner_legal_name" | "trust_name",
    next: string | null,
  ): Promise<void> {
    const queryKey = ["properties", selectedEntityId];
    const previous =
      queryClient.getQueryData<PropertyRecord[]>(queryKey) ?? null;
    if (previous) {
      queryClient.setQueryData<PropertyRecord[]>(
        queryKey,
        previous.map((row) =>
          row.id === propertyId ? { ...row, [field]: next } : row,
        ),
      );
    }
    try {
      await updateProperty(propertyId, { [field]: next });
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
      throw err;
    }
  }

  const previewPropertyEnrichmentMutation = useMutation({
    mutationFn: () => {
      if (!selectedPropertyId) {
        throw new Error("Select a property first.");
      }
      return previewPublicEnrichment({
        target_type: "property",
        target_id: selectedPropertyId,
      });
    },
    onSuccess: (result) => {
      setPropertyEnrichmentSuggestions(result.suggestions);
    },
  });

  const applyPropertyEnrichmentMutation = useMutation({
    mutationFn: () => {
      if (!selectedPropertyId) {
        throw new Error("Select a property first.");
      }
      return applyPublicEnrichment({
        target_type: "property",
        target_id: selectedPropertyId,
        suggestions: propertyEnrichmentSuggestions,
      });
    },
    onSuccess: () => {
      setPropertyEnrichmentSuggestions([]);
      queryClient.invalidateQueries({
        queryKey: ["properties", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "rent-roll",
          selectedEntityId,
          rentRollPropertyId,
          rentRollAsOf,
        ],
      });
    },
  });

  const previewPropertyImagesMutation = useMutation({
    mutationFn: () => {
      if (!selectedPropertyId) {
        throw new Error("Select a property first.");
      }
      return previewPropertyImages({
        property_id: selectedPropertyId,
        requested_count: 4,
      });
    },
    onSuccess: (result) => {
      setPropertyImageCandidates(result.candidates);
      setPropertyImageWarnings(result.warnings);
      setFailedPropertyImageCandidateUrls(new Set());
    },
  });

  const applyPropertyImageMutation = useMutation({
    mutationFn: (candidate: PropertyImageCandidateRecord) => {
      if (!selectedPropertyId) {
        throw new Error("Select a property first.");
      }
      return applyPropertyImage({
        property_id: selectedPropertyId,
        candidate,
      });
    },
    onMutate: (candidate) => {
      setApplyingPropertyImageUrl(candidate.image_url);
    },
    onSuccess: () => {
      setPropertyImageCandidates([]);
      setPropertyImageWarnings([]);
      queryClient.invalidateQueries({
        queryKey: ["properties", selectedEntityId],
      });
    },
    onSettled: () => {
      setApplyingPropertyImageUrl("");
    },
  });

  const unitMutation = useMutation({
    mutationFn: (values: UnitFormValues) => {
      const payload = {
        unit_label: values.unit_label,
        sqm: values.sqm ?? null,
        parking_spaces: values.parking_spaces ?? null,
        metadata: {},
      };
      return editingUnit
        ? updateTenancyUnit(editingUnit.id, payload)
        : createTenancyUnit({ property_id: selectedPropertyId, ...payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenancy-units", selectedPropertyId],
      });
      setEditingUnit(null);
      unitForm.reset(defaultUnitFormValues);
    },
  });

  const deleteUnitMutation = useMutation({
    mutationFn: deleteTenancyUnit,
    onSuccess: (_data, unitId) => {
      queryClient.invalidateQueries({
        queryKey: ["tenancy-units", selectedPropertyId],
      });
      if (editingUnit?.id === unitId) {
        setEditingUnit(null);
        setUnitEditorOpen(false);
        unitForm.reset(defaultUnitFormValues);
      }
      if (leaseForm.getValues("tenancy_unit_id") === unitId) {
        setEditingLease(null);
        setLeaseEditorOpen(false);
        leaseForm.reset(defaultLeaseFormValues);
      }
    },
  });

  const leaseMutation = useMutation({
    mutationFn: async (values: LeaseFormValues) => {
      const tenantId =
        values.tenant_id ||
        (
          await createTenant({
            entity_id: selectedEntityId,
            legal_name: (values.new_tenant_legal_name ?? "").trim(),
            trading_name: cleanText(values.new_tenant_trading_name),
            abn: null,
            contact_name: null,
            contact_email: null,
            contact_phone: null,
            billing_email: null,
            notes: null,
          })
        ).id;

      const payload = {
        tenancy_unit_id: values.tenancy_unit_id,
        tenant_id: tenantId,
        status: values.status,
        commencement_date: values.commencement_date ?? null,
        expiry_date: values.expiry_date ?? null,
        annual_rent_cents:
          values.annual_rent === undefined
            ? null
            : Math.round(values.annual_rent * 100),
        rent_frequency: values.rent_frequency,
        outgoings_recoverable: values.outgoings_recoverable,
        next_review_date: values.next_review_date ?? null,
        option_summary: cleanText(values.option_summary),
        security_summary: cleanText(values.security_summary),
        notes: cleanText(values.notes),
      };

      return editingLease
        ? updateLease(editingLease.id, payload)
        : createLease(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["leases", selectedPropertyId],
      });
      queryClient.invalidateQueries({
        queryKey: ["tenants", selectedEntityId],
      });
      setEditingLease(null);
      setLeaseEditorOpen(false);
      setLeaseMoreOpen(false);
      leaseForm.reset(defaultLeaseFormValues);
    },
  });

  const deleteLeaseMutation = useMutation({
    mutationFn: deleteLease,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["leases", selectedPropertyId],
      });
      setEditingLease(null);
      setLeaseEditorOpen(false);
      setLeaseMoreOpen(false);
      leaseForm.reset(defaultLeaseFormValues);
    },
  });

  const chargeRuleMutation = useMutation({
    mutationFn: (values: ChargeRuleFormValues) =>
      createChargeRule({
        lease_id: values.lease_id,
        charge_type: values.charge_type,
        amount_cents:
          values.amount === undefined ? 0 : Math.round(values.amount * 100),
        frequency: "monthly",
        gst_treatment: values.gst_treatment,
        xero_account_code: cleanText(values.xero_account_code),
        xero_tax_type: cleanText(values.xero_tax_type),
        next_due_date: values.next_due_date,
        arrears_or_advance: "advance",
        metadata: {},
      }),
    onSuccess: (_rule, values) => {
      queryClient.invalidateQueries({
        queryKey: [
          "rent-roll",
          selectedEntityId,
          selectedPropertyId,
          rentRollAsOf,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: ["charge-rules", selectedEntityId, selectedPropertyId],
      });
      chargeRuleForm.reset({
        ...defaultChargeRuleFormValues,
        lease_id: values.lease_id,
      });
    },
  });

  const obligationMutation = useMutation({
    mutationFn: (values: ObligationFormValues) => {
      const lease = leasesQuery.data?.find(
        (item) => item.id === values.lease_id,
      );
      return createObligation({
        entity_id: selectedEntityId,
        property_id: selectedPropertyId || null,
        tenancy_unit_id: lease?.tenancy_unit_id ?? null,
        lease_id: values.lease_id || null,
        title: values.title.trim(),
        category: values.category,
        status: "upcoming",
        due_date: values.due_date,
        priority: obligationPriorityRank(values.priority),
        owner_role: cleanText(values.owner_role),
        notes: cleanText(values.notes),
        metadata: {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["obligations", selectedEntityId, selectedPropertyId],
      });
      obligationForm.reset({
        ...defaultObligationFormValues,
        due_date: dateOnly(new Date()),
      });
    },
  });

  const updateObligationMutation = useMutation({
    mutationFn: ({
      obligation,
      status,
    }: {
      obligation: ObligationRecord;
      status: "completed" | "waived";
    }) =>
      updateObligation(obligation.id, {
        status,
        completed_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["obligations", selectedEntityId, selectedPropertyId],
      });
    },
  });

  const leaseIntakeMutation = useMutation({
    mutationFn: (file: File) =>
      createLeaseIntake({
        entityId: selectedEntityId,
        propertyId: selectedPropertyId || undefined,
        file,
      }),
    onSuccess: (intake) => {
      setActiveLeaseIntakeId(intake.id);
      queryClient.setQueryData(["lease-intake", intake.id], intake);
    },
  });

  const applyLeaseIntakeMutation = useMutation({
    mutationFn: ({
      intakeId,
      reviewedData,
      propertyId,
      tenancyUnitId,
      tenantId,
    }: {
      intakeId: string;
      reviewedData: LeaseIntakeExtraction | null;
      propertyId?: string | null;
      tenancyUnitId?: string | null;
      tenantId?: string | null;
    }) =>
      applyLeaseIntake(intakeId, {
        reviewedData,
        propertyId,
        tenancyUnitId,
        tenantId,
      }),
    onSuccess: (intake) => {
      queryClient.setQueryData(["lease-intake", intake.id], intake);
      queryClient.invalidateQueries({
        queryKey: ["properties", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["tenancy-units"],
      });
      queryClient.invalidateQueries({
        queryKey: ["tenants", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["leases"],
      });
      queryClient.invalidateQueries({
        queryKey: ["obligations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["rent-roll"],
      });
      queryClient.invalidateQueries({
        queryKey: ["charge-rules"],
      });
    },
  });

  const propertyDocumentIntakeMutation = useMutation({
    mutationFn: (file: File) =>
      createDocumentIntake({
        entityId: selectedEntityId,
        file,
      }),
    onSuccess: (intake) => {
      queryClient.invalidateQueries({
        queryKey: ["dashboard-document-intakes", selectedEntityId],
      });
      router.push(intakeReviewHref(selectedEntityId, intake.id));
    },
  });

  const tenantOnboardingMutation = useMutation({
    mutationFn: (leaseId: string) =>
      createTenantOnboarding({ lease_id: leaseId }),
    onSuccess: (onboarding) => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboarding", selectedEntityId],
      });
      void copyOnboardingLink(onboarding);
    },
  });
  const cancelTenantOnboardingMutation = useMutation({
    mutationFn: cancelTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboarding", selectedEntityId],
      });
    },
  });

  function selectProperty(propertyId: string) {
    setSelectedPropertyId(propertyId);
    window.localStorage.setItem(PROPERTY_STORAGE_KEY, propertyId);
    const url = new URL(window.location.href);
    url.searchParams.set("property_id", propertyId);
    window.history.replaceState(null, "", url);
    setEditingUnit(null);
    setEditingLease(null);
    setLeaseEditorOpen(false);
    setUnitEditorOpen(false);
    unitForm.reset(defaultUnitFormValues);
    leaseForm.reset(defaultLeaseFormValues);
    chargeRuleForm.reset(defaultChargeRuleFormValues);
    obligationForm.setValue("lease_id", "");
  }

  function clearOwnerTagFilter() {
    setOwnerTagFilter("");
    const url = new URL(window.location.href);
    url.searchParams.delete("owner_tag");
    window.history.replaceState(null, "", url);
  }

  function applyOwnerTagFilter(tagKey: string) {
    if (!tagKey) {
      return;
    }
    setOwnerTagFilter(tagKey);
    const url = new URL(window.location.href);
    url.searchParams.set("owner_tag", tagKey);
    window.history.replaceState(null, "", url);
  }

  function startEdit(property: PropertyRecord) {
    selectProperty(property.id);
    setEditing(property);
    setPropertyEditorOpen(true);
    form.reset({
      name: property.name,
      street_address: property.street_address,
      suburb: property.suburb ?? "",
      state: property.state ?? "QLD",
      postcode: property.postcode ?? "",
      property_type: property.property_type,
      building_sqm: property.building_sqm ?? undefined,
      parking_spaces: property.parking_spaces ?? undefined,
      has_solar_pv: property.has_solar_pv,
      ownership_structure:
        (property.ownership_structure as PropertyFormValues["ownership_structure"]) ??
        "current_entity",
      owner_legal_name: property.owner_legal_name ?? "",
      owner_abn: property.owner_abn ?? "",
      trustee_name: property.trustee_name ?? "",
      trust_name: property.trust_name ?? "",
      invoice_issuer_name: property.invoice_issuer_name ?? "",
      billing_contact_name: property.billing_contact_name ?? "",
      billing_email: property.billing_email ?? "",
      invoice_reference: property.invoice_reference ?? "",
      ownership_split: property.ownership_split ?? "",
      owner_gst_registered: ownerGstFormValue(property.owner_gst_registered),
      xero_contact_id: property.xero_contact_id ?? "",
      xero_tracking_category: property.xero_tracking_category ?? "",
    });
    setBillingProfileOpen(propertyUsesOwnerBilling(property));
  }

  function startPropertyCreate() {
    setEditing(null);
    setBillingProfileOpen(false);
    form.reset(defaultPropertyFormValues);
    setPropertyEditorOpen(true);
  }

  function closePropertyEditor() {
    setEditing(null);
    setPropertyEditorOpen(false);
    setBillingProfileOpen(false);
    form.reset(defaultPropertyFormValues);
  }

  function startUnitEdit(unit: TenancyUnitRecord) {
    setEditingUnit(unit);
    setUnitEditorOpen(true);
    unitForm.reset({
      unit_label: unit.unit_label,
      sqm: unit.sqm ?? undefined,
      parking_spaces: unit.parking_spaces ?? undefined,
    });
  }

  function startUnitCreate() {
    setEditingUnit(null);
    setUnitEditorOpen(true);
    unitForm.reset(defaultUnitFormValues);
  }

  function closeUnitEditor() {
    setEditingUnit(null);
    setUnitEditorOpen(false);
    unitForm.reset(defaultUnitFormValues);
  }

  function startLeaseEdit(unit: TenancyUnitRecord, lease?: LeaseRecord) {
    setEditingLease(lease ?? null);
    setLeaseEditorOpen(true);
    setLeaseMoreOpen(false);
    chargeRuleForm.reset({
      ...defaultChargeRuleFormValues,
      lease_id: lease?.id ?? "",
    });
    leaseForm.reset(
      lease
        ? {
            tenancy_unit_id: lease.tenancy_unit_id,
            tenant_id: lease.tenant_id,
            new_tenant_legal_name: "",
            new_tenant_trading_name: "",
            status: leaseStatuses.some(
              (status) => status.value === lease.status,
            )
              ? (lease.status as LeaseFormValues["status"])
              : "active",
            commencement_date: lease.commencement_date ?? undefined,
            expiry_date: lease.expiry_date ?? undefined,
            annual_rent:
              lease.annual_rent_cents === null ||
              lease.annual_rent_cents === undefined
                ? undefined
                : lease.annual_rent_cents / 100,
            rent_frequency: rentFrequencies.some(
              (frequency) => frequency.value === lease.rent_frequency,
            )
              ? (lease.rent_frequency as LeaseFormValues["rent_frequency"])
              : "annual",
            outgoings_recoverable: lease.outgoings_recoverable,
            next_review_date: lease.next_review_date ?? undefined,
            option_summary: lease.option_summary ?? "",
            security_summary: lease.security_summary ?? "",
            notes: lease.notes ?? "",
          }
        : {
            ...defaultLeaseFormValues,
            tenancy_unit_id: unit.id,
          },
    );
  }

  function closeLeaseEditor() {
    setEditingLease(null);
    setLeaseEditorOpen(false);
    setLeaseMoreOpen(false);
    leaseForm.reset(defaultLeaseFormValues);
  }

  function requestDeleteUnit(unit: TenancyUnitRecord) {
    if (window.confirm(`Delete ${unit.unit_label}?`)) {
      deleteUnitMutation.mutate(unit.id);
    }
  }

  function requestDeleteLease() {
    if (editingLease && window.confirm("Delete this lease?")) {
      deleteLeaseMutation.mutate(editingLease.id);
    }
  }

  function obligationContext(obligation: ObligationRecord) {
    if (obligation.lease_id) {
      const lease = leasesQuery.data?.find(
        (item) => item.id === obligation.lease_id,
      );
      const unit = lease ? unitsById.get(lease.tenancy_unit_id) : undefined;
      const tenant = lease ? tenantsById.get(lease.tenant_id) : undefined;
      return [unit?.unit_label, tenant ? tenantDisplayName(tenant) : null]
        .filter(Boolean)
        .join(" - ");
    }
    if (obligation.property_id && selectedProperty) {
      return selectedProperty.name;
    }
    return selectedEntity?.name ?? "Entity";
  }

  function leaseOptionLabel(lease: LeaseRecord) {
    const unit = unitsById.get(lease.tenancy_unit_id);
    const tenant = tenantsById.get(lease.tenant_id);
    return [unit?.unit_label ?? "Unit", tenant ? tenantDisplayName(tenant) : ""]
      .filter(Boolean)
      .join(" - ");
  }

  async function copyOnboardingLink(onboarding: TenantOnboardingRecord) {
    try {
      await navigator.clipboard.writeText(onboarding.onboarding_url);
      setCopiedOnboardingId(onboarding.id);
      window.setTimeout(() => setCopiedOnboardingId(""), 2200);
    } catch {
      window.prompt("Copy tenant onboarding link", onboarding.onboarding_url);
    }
  }

  function startTenantOnboarding(lease: LeaseRecord) {
    const existing = onboardingByLeaseId.get(lease.id);
    if (
      existing &&
      existing.status === "sent" &&
      !isExpiredDateTime(existing.expires_at)
    ) {
      void copyOnboardingLink(existing);
      return;
    }
    if (existing) {
      return;
    }
    tenantOnboardingMutation.mutate(lease.id);
  }

  function requestCancelTenantOnboarding(onboarding: TenantOnboardingRecord) {
    if (window.confirm("Cancel this tenant onboarding link?")) {
      cancelTenantOnboardingMutation.mutate(onboarding.id);
    }
  }

  function uploadPropertyDocument(file: File | null | undefined) {
    if (!file || !selectedEntityId) {
      return;
    }
    setActiveLeaseIntakeId("");
    setLeaseReviewDraftId("");
    setLeaseReviewDraft(null);
    setLeaseReviewPropertyId(selectedPropertyId);
    setLeaseReviewUnitId("");
    setLeaseReviewTenantId("");
    applyLeaseIntakeMutation.reset();
    propertyDocumentIntakeMutation.mutate(file);
  }

  function handlePropertyDocumentInput(event: ChangeEvent<HTMLInputElement>) {
    uploadPropertyDocument(event.target.files?.[0]);
    event.target.value = "";
  }

  function handlePropertyDocumentDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setPropertyDocumentDropActive(false);
    uploadPropertyDocument(event.dataTransfer.files?.[0]);
  }

  function updateReviewSection(
    section: "property" | "tenancy_unit" | "tenant" | "lease",
    field: string,
    value: string | number | boolean | null,
  ) {
    setLeaseReviewDraft((current) => ({
      ...(current ?? {}),
      [section]: {
        ...(((current?.[section] as Record<string, unknown> | null) ??
          {}) as Record<string, unknown>),
        [field]: value,
      },
    }));
  }

  function updateReviewObligation(
    index: number,
    field: string,
    value: string | number | null,
  ) {
    setLeaseReviewDraft((current) => {
      const obligations = [...(current?.obligations ?? [])];
      obligations[index] = { ...(obligations[index] ?? {}), [field]: value };
      return { ...(current ?? {}), obligations };
    });
  }

  function addReviewObligation() {
    setLeaseReviewDraft((current) => ({
      ...(current ?? {}),
      obligations: [
        ...(current?.obligations ?? []),
        {
          title: "",
          category: "other",
          due_date: dateOnly(new Date()),
          priority: 2,
          owner_role: "",
          notes: "",
        },
      ],
    }));
  }

  function removeReviewObligation(index: number) {
    setLeaseReviewDraft((current) => ({
      ...(current ?? {}),
      obligations: (current?.obligations ?? []).filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }));
  }

  const activeLeaseIntake =
    leaseIntakeQuery.data ??
    (leaseIntakeMutation.data?.id === activeLeaseIntakeId
      ? leaseIntakeMutation.data
      : undefined);
  const activeLeaseExtraction = intakeExtraction(activeLeaseIntake);

  useEffect(() => {
    if (!activeLeaseIntake?.id || !activeLeaseExtraction) {
      setLeaseReviewDraftId("");
      setLeaseReviewDraft(null);
      setLeaseReviewPropertyId("");
      setLeaseReviewUnitId("");
      setLeaseReviewTenantId("");
      return;
    }
    if (leaseReviewDraftId !== activeLeaseIntake.id) {
      const context = activeLeaseExtraction.context as
        | Record<string, unknown>
        | undefined;
      const contextPropertyId =
        typeof context?.property_id === "string" ? context.property_id : "";
      setLeaseReviewDraftId(activeLeaseIntake.id);
      setLeaseReviewDraft(cloneExtraction(activeLeaseExtraction));
      setLeaseReviewPropertyId(contextPropertyId || selectedPropertyId);
      setLeaseReviewUnitId("");
      setLeaseReviewTenantId("");
    }
  }, [
    activeLeaseExtraction,
    activeLeaseIntake?.id,
    leaseReviewDraftId,
    selectedPropertyId,
  ]);

  useEffect(() => {
    setLeaseReviewUnitId("");
  }, [leaseReviewPropertyId]);

  const reviewExtraction = leaseReviewDraft ?? activeLeaseExtraction;
  const intakeProperty = reviewExtraction?.property ?? null;
  const intakeUnit = reviewExtraction?.tenancy_unit ?? null;
  const intakeTenant = reviewExtraction?.tenant ?? null;
  const intakeLease = reviewExtraction?.lease ?? null;
  const intakeObligations = reviewExtraction?.obligations ?? [];
  const intakeApplyBlockers = leaseIntakeApplyBlockers({
    propertyId: leaseReviewPropertyId,
    unitId: leaseReviewUnitId,
    tenantId: leaseReviewTenantId,
    property: intakeProperty,
    unit: intakeUnit,
    tenant: intakeTenant,
    lease: intakeLease,
  });
  const intakeNotes = [
    ...(activeLeaseExtraction?.warnings ?? []),
    ...(activeLeaseExtraction?.notes ?? []),
  ];
  const intakeReady =
    Boolean(activeLeaseExtraction) &&
    !isLeaseIntakeProcessing(activeLeaseIntake) &&
    !isLeaseIntakeFailed(activeLeaseIntake);
  const intakeStatus = friendlyStatus(activeLeaseIntake);
  const intakeFileName =
    activeLeaseIntake?.file_name ??
    activeLeaseIntake?.filename ??
    leaseIntakeMutation.variables?.name ??
    "Lease file";
  const leaseEditorUnitId = leaseForm.watch("tenancy_unit_id");
  const leaseEditorTenantId = leaseForm.watch("tenant_id");
  const leaseEditorUnit = leaseEditorUnitId
    ? unitsById.get(leaseEditorUnitId)
    : undefined;
  const leaseEditorExistingLease =
    editingLease ??
    (leaseEditorUnit
      ? pickUnitLease(leasesQuery.data, leaseEditorUnit.id)
      : undefined);
  const leaseEditorTenant = leaseEditorExistingLease
    ? tenantsById.get(leaseEditorExistingLease.tenant_id)
    : leaseEditorTenantId
      ? tenantsById.get(leaseEditorTenantId)
      : undefined;

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          aria-label="Entity"
          value={selectedEntityId}
          onChange={(event) => {
            setSelectedEntityId(event.target.value);
            if (ownerTagFilter) {
              clearOwnerTagFilter();
            }
          }}
        >
          <option value="">
            {entitiesLoading ? "Checking entities" : "Select entity"}
          </option>
          {entitiesQuery.data?.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">
                {selectedEntity?.name ?? "Select an entity"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {propertiesQuery.isError
                  ? friendlyError(propertiesQuery.error)
                  : propertiesLoading
                    ? "Checking properties"
                    : ownerTagFilter
                      ? activeOwnerTag
                        ? `${activeOwnerTag.propertyCount} ${
                            activeOwnerTag.propertyCount === 1
                              ? "property"
                              : "properties"
                          } tagged ${activeOwnerTag.label}`
                        : "0 properties for this ownership tag"
                      : `${propertiesQuery.data?.length ?? 0} active properties`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton
                type="button"
                onClick={() => propertiesQuery.refetch()}
                disabled={!selectedEntityId || propertiesQuery.isFetching}
              >
                {propertiesQuery.isFetching && !propertiesLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                {propertiesQuery.isFetching && !propertiesLoading
                  ? "Refreshing…"
                  : "Refresh"}
              </SecondaryButton>
              <Button
                type="button"
                onClick={startPropertyCreate}
                disabled={!selectedEntityId}
              >
                <Plus size={16} />
                New property
              </Button>
            </div>
          </div>

          {propertyWorkspaceError ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">
              <div>
                <div className="font-semibold">
                  Property data did not finish loading.
                </div>
                <div className="mt-1">
                  {friendlyError(propertyWorkspaceError)}
                </div>
              </div>
              <SecondaryButton
                type="button"
                onClick={() => {
                  entitiesQuery.refetch();
                  if (selectedEntityId) {
                    propertiesQuery.refetch();
                    tenantsQuery.refetch();
                    obligationsQuery.refetch();
                    rentRollQuery.refetch();
                    chargeRulesQuery.refetch();
                    tenantOnboardingsQuery.refetch();
                  }
                  if (selectedPropertyId) {
                    tenancyUnitsQuery.refetch();
                    leasesQuery.refetch();
                  }
                }}
              >
                <RefreshCw size={15} />
                Retry
              </SecondaryButton>
            </div>
          ) : null}

          {propertyWorkspaceLoading && !propertyWorkspaceError ? (
            <SectionPanel
              title="Preparing property workspace"
              description={
                selectedProperty
                  ? `Checking units, leases, dates, and billing for ${selectedProperty.name}.`
                  : selectedEntity
                    ? `Checking property records for ${selectedEntity.name}.`
                    : "Connecting to the live portfolio and selecting an entity."
              }
              icon={<Loader2 size={17} className="animate-spin text-primary" />}
              actions={
                <StatusBadge
                  tone={propertyWorkspaceRefreshing ? "primary" : "neutral"}
                >
                  {propertyWorkspaceRefreshing
                    ? "Updating workspace"
                    : "Preparing workspace"}
                </StatusBadge>
              }
              className="mb-4 border-primary/20 bg-primary/5"
            >
              <div className="grid gap-3 p-4 text-sm text-muted-foreground sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-white px-3 py-2">
                  Properties
                </div>
                <div className="rounded-xl border border-border bg-white px-3 py-2">
                  Units & leases
                </div>
                <div className="rounded-xl border border-border bg-white px-3 py-2">
                  Attention dates
                </div>
                <div className="rounded-xl border border-border bg-white px-3 py-2">
                  Billing readiness
                </div>
              </div>
            </SectionPanel>
          ) : null}

          <div
            className="mb-4 grid gap-2 rounded-2xl border border-border bg-white p-2 shadow-leasiumXs md:grid-cols-4"
            role="tablist"
            aria-label="Property workspace sections"
          >
            {propertyWorkspaceTabs.map((tab) => {
              const isActive = activeWorkspaceTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                  className={`grid min-h-16 gap-1 rounded-xl px-3 py-2 text-left transition duration-200 ease-leasium ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-leasiumXs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="text-sm font-semibold">{tab.label}</span>
                  <span
                    className={`text-xs ${
                      isActive ? "text-primary-foreground/80" : ""
                    }`}
                  >
                    {tab.description}
                  </span>
                </button>
              );
            })}
          </div>

          {activeWorkspaceTab === "documents" ? (
            <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumXs">
              <div className="grid gap-4 p-4">
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <FileText size={17} className="text-primary" />
                      <div>
                        <h2 className="text-base font-semibold">
                          Add property document
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Upload setup documents. Nothing is applied until
                          review.
                        </p>
                      </div>
                      {activeLeaseIntake ? (
                        <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary-hover">
                          {intakeStatus}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          propertyDocumentInputRef.current?.click()
                        }
                        disabled={
                          !selectedEntityId ||
                          propertyDocumentIntakeMutation.isPending
                        }
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-60"
                      >
                        <Plus size={15} />
                        New property setup
                      </button>
                      <Link
                        href="/intake"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                      >
                        <UploadCloud size={15} />
                        Review document
                      </Link>
                    </div>
                  </div>
                  <label
                    htmlFor="property-document-file"
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setPropertyDocumentDropActive(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setPropertyDocumentDropActive(true);
                    }}
                    onDragLeave={() => setPropertyDocumentDropActive(false)}
                    onDrop={handlePropertyDocumentDrop}
                    className={`grid min-h-36 cursor-pointer place-items-center gap-3 rounded-2xl border border-dashed px-4 py-8 text-center transition duration-200 ease-leasium ${
                      propertyDocumentDropActive
                        ? "border-primary bg-primary/5"
                        : "border-border bg-muted/35 hover:border-primary/50 hover:bg-primary/5"
                    } ${selectedEntityId ? "" : "cursor-not-allowed opacity-60"}`}
                  >
                    {propertyDocumentIntakeMutation.isPending ? (
                      <Loader2
                        size={24}
                        className="animate-spin text-primary"
                      />
                    ) : (
                      <UploadCloud size={26} className="text-primary" />
                    )}
                    <span className="grid gap-1">
                      <span className="text-sm font-semibold">
                        Drop a property document here
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Lease, purchase contract, tenancy schedule, disclosure
                        pack, handover file, or certificate
                      </span>
                    </span>
                    <input
                      id="property-document-file"
                      ref={propertyDocumentInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      className="sr-only"
                      disabled={
                        !selectedEntityId ||
                        propertyDocumentIntakeMutation.isPending
                      }
                      onChange={handlePropertyDocumentInput}
                    />
                  </label>
                  {selectedProperty ? (
                    <p className="text-xs text-muted-foreground">
                      Leasium will match this document against{" "}
                      {selectedProperty.name} where possible.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Select a property to update it, or upload a setup document
                      to start a new property review.
                    </p>
                  )}
                  {propertyDocumentIntakeMutation.error ? (
                    <p className="text-sm text-danger">
                      {friendlyError(propertyDocumentIntakeMutation.error)}
                    </p>
                  ) : null}
                  {leaseIntakeQuery.error ? (
                    <p className="text-sm text-danger">
                      {friendlyError(leaseIntakeQuery.error)}
                    </p>
                  ) : null}
                </div>

                <div className="min-w-0 rounded-md border border-border bg-muted/25 p-4">
                  {activeLeaseIntake ? (
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">
                            {intakeFileName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Review the extracted details before adding them.
                          </div>
                        </div>
                        <Button
                          type="button"
                          onClick={() =>
                            activeLeaseIntakeId
                              ? applyLeaseIntakeMutation.mutate({
                                  intakeId: activeLeaseIntakeId,
                                  reviewedData: reviewExtraction,
                                  propertyId: leaseReviewPropertyId,
                                  tenancyUnitId: leaseReviewUnitId,
                                  tenantId: leaseReviewTenantId,
                                })
                              : null
                          }
                          disabled={
                            !activeLeaseIntakeId ||
                            !intakeReady ||
                            intakeApplyBlockers.length > 0 ||
                            isLeaseIntakeApplied(activeLeaseIntake) ||
                            applyLeaseIntakeMutation.isPending
                          }
                        >
                          {applyLeaseIntakeMutation.isPending ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Check size={16} />
                          )}
                          {isLeaseIntakeApplied(activeLeaseIntake)
                            ? "Applied"
                            : "Apply lease"}
                        </Button>
                      </div>

                      {isLeaseIntakeFailed(activeLeaseIntake) ? (
                        <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                          {activeLeaseIntake.error ||
                            activeLeaseIntake.error_message ||
                            "This lease could not be read. Try another file."}
                        </div>
                      ) : null}

                      {isLeaseIntakeProcessing(activeLeaseIntake) ? (
                        <div className="flex items-center gap-2 rounded-md border border-border bg-white p-3 text-sm text-muted-foreground">
                          <Loader2 size={16} className="animate-spin" />
                          Reading the lease and preparing the review.
                        </div>
                      ) : null}

                      {activeLeaseExtraction ? (
                        <div className="grid gap-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-white px-4 py-3">
                            <div>
                              <div className="text-sm font-semibold">
                                Review and edit
                              </div>
                              <div className="text-xs text-muted-foreground">
                                These values are what Leasium will apply.
                              </div>
                            </div>
                            <SecondaryButton
                              type="button"
                              onClick={() =>
                                setLeaseReviewDraft(
                                  cloneExtraction(activeLeaseExtraction),
                                )
                              }
                              disabled={isLeaseIntakeApplied(activeLeaseIntake)}
                            >
                              <RefreshCw size={15} />
                              Reset
                            </SecondaryButton>
                          </div>

                          {intakeApplyBlockers.length ? (
                            <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
                              <div className="font-semibold">
                                Before applying
                              </div>
                              <ul className="mt-1 grid gap-1 text-muted-foreground">
                                {intakeApplyBlockers.map((blocker) => (
                                  <li key={blocker}>{blocker}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          <div className="grid gap-4 xl:grid-cols-2">
                            <div className="rounded-md border border-border bg-white">
                              <div className="border-b border-border px-3 py-2 text-sm font-semibold">
                                Property
                              </div>
                              <div className="grid gap-4 p-4">
                                <Field label="Use existing">
                                  <Select
                                    value={leaseReviewPropertyId}
                                    onChange={(event) => {
                                      setLeaseReviewPropertyId(
                                        event.target.value,
                                      );
                                      setLeaseReviewUnitId("");
                                    }}
                                  >
                                    <option value="">Create from review</option>
                                    {propertiesQuery.data?.map((property) => (
                                      <option
                                        key={property.id}
                                        value={property.id}
                                      >
                                        {property.name}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                <Field label="Name">
                                  <Input
                                    value={inputString(intakeProperty?.name)}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "property",
                                        "name",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <Field label="Street address">
                                  <Input
                                    value={inputString(
                                      intakeProperty?.street_address ??
                                        intakeProperty?.address,
                                    )}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "property",
                                        "street_address",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <div className="grid gap-3 sm:grid-cols-3">
                                  <Field label="Suburb">
                                    <Input
                                      value={inputString(
                                        intakeProperty?.suburb,
                                      )}
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "property",
                                          "suburb",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </Field>
                                  <Field label="State">
                                    <Input
                                      value={inputString(intakeProperty?.state)}
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "property",
                                          "state",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </Field>
                                  <Field label="Postcode">
                                    <Input
                                      value={inputString(
                                        intakeProperty?.postcode,
                                      )}
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "property",
                                          "postcode",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </Field>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Field label="Type">
                                    <Select
                                      value={
                                        inputString(
                                          intakeProperty?.property_type,
                                        ) || "other"
                                      }
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "property",
                                          "property_type",
                                          event.target.value,
                                        )
                                      }
                                    >
                                      {propertyTypes.map((type) => (
                                        <option
                                          key={type.value}
                                          value={type.value}
                                        >
                                          {type.label}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                  <Field label="Building sqm">
                                    <Input
                                      type="number"
                                      value={inputString(
                                        intakeProperty?.building_sqm,
                                      )}
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "property",
                                          "building_sqm",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </Field>
                                </div>
                                <details className="rounded-md border border-border bg-muted/25">
                                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
                                    Ownership & billing
                                  </summary>
                                  <div className="grid gap-3 border-t border-border p-3">
                                    <Field label="Invoice from">
                                      <Select
                                        value={
                                          inputString(
                                            intakeProperty?.ownership_structure,
                                          ) || "current_entity"
                                        }
                                        onChange={(event) =>
                                          updateReviewSection(
                                            "property",
                                            "ownership_structure",
                                            event.target.value,
                                          )
                                        }
                                      >
                                        {ownershipStructures.map(
                                          (structure) => (
                                            <option
                                              key={structure.value}
                                              value={structure.value}
                                            >
                                              {structure.label}
                                            </option>
                                          ),
                                        )}
                                      </Select>
                                    </Field>
                                    <Field label="Invoice issuer">
                                      <Input
                                        value={inputString(
                                          intakeProperty?.invoice_issuer_name,
                                        )}
                                        onChange={(event) =>
                                          updateReviewSection(
                                            "property",
                                            "invoice_issuer_name",
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </Field>
                                    <Field label="Legal owner">
                                      <Input
                                        value={inputString(
                                          intakeProperty?.owner_legal_name,
                                        )}
                                        onChange={(event) =>
                                          updateReviewSection(
                                            "property",
                                            "owner_legal_name",
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </Field>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <Field label="ABN">
                                        <Input
                                          value={inputString(
                                            intakeProperty?.owner_abn,
                                          )}
                                          onChange={(event) =>
                                            updateReviewSection(
                                              "property",
                                              "owner_abn",
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </Field>
                                      <Field label="GST">
                                        <Select
                                          value={
                                            intakeProperty?.owner_gst_registered ===
                                            true
                                              ? "true"
                                              : intakeProperty?.owner_gst_registered ===
                                                  false
                                                ? "false"
                                                : ""
                                          }
                                          onChange={(event) =>
                                            updateReviewSection(
                                              "property",
                                              "owner_gst_registered",
                                              event.target.value === ""
                                                ? null
                                                : event.target.value === "true",
                                            )
                                          }
                                        >
                                          <option value="">Not set</option>
                                          <option value="true">
                                            Registered
                                          </option>
                                          <option value="false">
                                            Not registered
                                          </option>
                                        </Select>
                                      </Field>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <Field label="Trustee">
                                        <Input
                                          value={inputString(
                                            intakeProperty?.trustee_name,
                                          )}
                                          onChange={(event) =>
                                            updateReviewSection(
                                              "property",
                                              "trustee_name",
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </Field>
                                      <Field label="Trust">
                                        <Input
                                          value={inputString(
                                            intakeProperty?.trust_name,
                                          )}
                                          onChange={(event) =>
                                            updateReviewSection(
                                              "property",
                                              "trust_name",
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </Field>
                                    </div>
                                    <Field label="Ownership split">
                                      <Input
                                        value={inputString(
                                          intakeProperty?.ownership_split,
                                        )}
                                        onChange={(event) =>
                                          updateReviewSection(
                                            "property",
                                            "ownership_split",
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </Field>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <Field label="Xero issuer">
                                        <Input
                                          value={inputString(
                                            intakeProperty?.xero_contact_id,
                                          )}
                                          onChange={(event) =>
                                            updateReviewSection(
                                              "property",
                                              "xero_contact_id",
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </Field>
                                      <Field label="Tracking">
                                        <Input
                                          value={inputString(
                                            intakeProperty?.xero_tracking_category,
                                          )}
                                          onChange={(event) =>
                                            updateReviewSection(
                                              "property",
                                              "xero_tracking_category",
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </Field>
                                    </div>
                                  </div>
                                </details>
                              </div>
                            </div>

                            <div className="rounded-md border border-border bg-white">
                              <div className="border-b border-border px-3 py-2 text-sm font-semibold">
                                Tenant
                              </div>
                              <div className="grid gap-4 p-4">
                                <Field label="Use existing">
                                  <Select
                                    value={leaseReviewTenantId}
                                    onChange={(event) =>
                                      setLeaseReviewTenantId(event.target.value)
                                    }
                                  >
                                    <option value="">Create from review</option>
                                    {tenantsQuery.data?.map((tenant) => (
                                      <option key={tenant.id} value={tenant.id}>
                                        {tenantDisplayName(tenant)}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                <Field label="Legal name">
                                  <Input
                                    value={inputString(
                                      intakeTenant?.legal_name ??
                                        intakeTenant?.name,
                                    )}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "tenant",
                                        "legal_name",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <Field label="Trading as">
                                  <Input
                                    value={inputString(
                                      intakeTenant?.trading_name,
                                    )}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "tenant",
                                        "trading_name",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <Field label="ABN">
                                  <Input
                                    value={inputString(intakeTenant?.abn)}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "tenant",
                                        "abn",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <Field label="Billing email">
                                  <Input
                                    type="email"
                                    value={inputString(
                                      intakeTenant?.billing_email ??
                                        intakeTenant?.contact_email,
                                    )}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "tenant",
                                        "billing_email",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                              </div>
                            </div>

                            <div className="rounded-md border border-border bg-white">
                              <div className="border-b border-border px-3 py-2 text-sm font-semibold">
                                Lease
                              </div>
                              <div className="grid gap-4 p-4">
                                <Field label="Use existing unit">
                                  <Select
                                    value={leaseReviewUnitId}
                                    onChange={(event) =>
                                      setLeaseReviewUnitId(event.target.value)
                                    }
                                    disabled={!leaseReviewPropertyId}
                                  >
                                    <option value="">Create from review</option>
                                    {leaseReviewUnitsQuery.data?.map((unit) => (
                                      <option key={unit.id} value={unit.id}>
                                        {unit.unit_label}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                <Field label="Unit">
                                  <Input
                                    value={inputString(
                                      intakeUnit?.unit_label ??
                                        intakeUnit?.label,
                                    )}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "tenancy_unit",
                                        "unit_label",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Field label="Start">
                                    <Input
                                      type="date"
                                      value={inputString(
                                        intakeLease?.commencement_date,
                                      )}
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "lease",
                                          "commencement_date",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </Field>
                                  <Field label="Expiry">
                                    <Input
                                      type="date"
                                      value={inputString(
                                        intakeLease?.expiry_date,
                                      )}
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "lease",
                                          "expiry_date",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </Field>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Field label="Annual rent">
                                    <Input
                                      type="number"
                                      value={inputString(
                                        draftAnnualRentCents(intakeLease)
                                          ? (draftAnnualRentCents(
                                              intakeLease,
                                            ) ?? 0) / 100
                                          : "",
                                      )}
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "lease",
                                          "annual_rent_dollars",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </Field>
                                  <Field label="Frequency">
                                    <Select
                                      value={
                                        inputString(
                                          intakeLease?.rent_frequency,
                                        ) || "annual"
                                      }
                                      onChange={(event) =>
                                        updateReviewSection(
                                          "lease",
                                          "rent_frequency",
                                          event.target.value,
                                        )
                                      }
                                    >
                                      {rentFrequencies.map((frequency) => (
                                        <option
                                          key={frequency.value}
                                          value={frequency.value}
                                        >
                                          {frequency.label}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                </div>
                                <Field label="Next review">
                                  <Input
                                    type="date"
                                    value={inputString(
                                      intakeLease?.next_review_date,
                                    )}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "lease",
                                        "next_review_date",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <Field label="Options">
                                  <Input
                                    value={inputString(
                                      intakeLease?.option_summary,
                                    )}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "lease",
                                        "option_summary",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                                <Field label="Security">
                                  <Input
                                    value={inputString(
                                      intakeLease?.security_summary,
                                    )}
                                    onChange={(event) =>
                                      updateReviewSection(
                                        "lease",
                                        "security_summary",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </Field>
                              </div>
                            </div>

                            <div className="rounded-md border border-border bg-white">
                              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                                <div className="text-sm font-semibold">
                                  Obligations
                                </div>
                                <SecondaryButton
                                  type="button"
                                  className="h-8"
                                  onClick={addReviewObligation}
                                >
                                  <Plus size={14} />
                                  Add
                                </SecondaryButton>
                              </div>
                              <div className="grid gap-4 p-4">
                                {intakeObligations.length ? (
                                  intakeObligations.map((obligation, index) => (
                                    <div
                                      key={`${obligation.title ?? "obligation"}-${index}`}
                                      className="grid gap-2 rounded border border-border bg-muted/30 p-2"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs font-semibold text-muted-foreground">
                                          Date {index + 1}
                                        </div>
                                        <SecondaryButton
                                          type="button"
                                          className="h-7 w-7 px-0"
                                          onClick={() =>
                                            removeReviewObligation(index)
                                          }
                                        >
                                          <X size={13} />
                                        </SecondaryButton>
                                      </div>
                                      <Field label="Title">
                                        <Input
                                          value={inputString(obligation.title)}
                                          onChange={(event) =>
                                            updateReviewObligation(
                                              index,
                                              "title",
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </Field>
                                      <div className="grid gap-2 sm:grid-cols-2">
                                        <Field label="Category">
                                          <Select
                                            value={
                                              inputString(
                                                obligation.category,
                                              ) || "other"
                                            }
                                            onChange={(event) =>
                                              updateReviewObligation(
                                                index,
                                                "category",
                                                event.target.value,
                                              )
                                            }
                                          >
                                            {obligationCategories.map(
                                              (category) => (
                                                <option
                                                  key={category.value}
                                                  value={category.value}
                                                >
                                                  {category.label}
                                                </option>
                                              ),
                                            )}
                                          </Select>
                                        </Field>
                                        <Field label="Due">
                                          <Input
                                            type="date"
                                            value={inputString(
                                              obligation.due_date ??
                                                obligation.due,
                                            )}
                                            onChange={(event) =>
                                              updateReviewObligation(
                                                index,
                                                "due_date",
                                                event.target.value,
                                              )
                                            }
                                          />
                                        </Field>
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-sm text-muted-foreground">
                                    No key dates found yet.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {intakeNotes.length ? (
                        <div className="rounded-md border border-border bg-white p-3 text-sm">
                          <div className="mb-1 font-semibold">Check these</div>
                          <ul className="grid gap-1 text-muted-foreground">
                            {intakeNotes.map((note, index) => (
                              <li key={`${note}-${index}`}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {applyLeaseIntakeMutation.error ? (
                        <p className="text-sm text-danger">
                          {friendlyError(applyLeaseIntakeMutation.error)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid min-h-48 place-items-center text-center">
                      <div>
                        <div className="text-sm font-semibold">
                          Document review opens in the inbox
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Nothing is applied until you review and approve the
                          extracted details.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {activeWorkspaceTab === "operations" ? (
            <section className="mb-4 overflow-hidden rounded-md border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ClipboardList size={17} className="text-primary" />
                    <h2 className="text-base font-semibold">Attention</h2>
                    {attentionCounts.overdue > 0 ? (
                      <span className="rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">
                        {attentionCounts.overdue} overdue
                      </span>
                    ) : null}
                    {attentionCounts.dueSoon > 0 ? (
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium">
                        {attentionCounts.dueSoon} due soon
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedProperty
                      ? selectedProperty.name
                      : (selectedEntity?.name ?? "Select an entity")}
                  </p>
                </div>
                <SecondaryButton
                  type="button"
                  onClick={() => obligationsQuery.refetch()}
                  disabled={!selectedEntityId}
                  className="h-8"
                >
                  <RefreshCw size={15} />
                  Refresh
                </SecondaryButton>
              </div>

              <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0 divide-y divide-border">
                  {activeObligations.slice(0, 6).map((obligation) => {
                    const status = dueStatus(obligation.due_date);
                    const isCritical = obligation.priority <= 0;
                    return (
                      <div
                        key={obligation.id}
                        className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {isCritical ? (
                              <AlertTriangle
                                size={15}
                                className="text-danger"
                              />
                            ) : null}
                            <span className="font-medium">
                              {obligation.title}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${status.className}`}
                            >
                              {status.label}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {obligationPriorityLabel(obligation.priority)}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {obligation.category.replaceAll("_", " ")} -{" "}
                            {obligationContext(obligation)}
                            {obligation.owner_role
                              ? ` - ${obligation.owner_role}`
                              : ""}
                          </div>
                          {obligation.notes ? (
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {obligation.notes}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex gap-2 sm:justify-end">
                          <SecondaryButton
                            type="button"
                            aria-label={`Complete ${obligation.title}`}
                            title="Complete"
                            onClick={() =>
                              updateObligationMutation.mutate({
                                obligation,
                                status: "completed",
                              })
                            }
                            disabled={updateObligationMutation.isPending}
                            className="h-8 w-8 px-0"
                          >
                            <CheckCircle2 size={15} className="text-success" />
                          </SecondaryButton>
                          <SecondaryButton
                            type="button"
                            aria-label={`Waive ${obligation.title}`}
                            title="Waive"
                            onClick={() =>
                              updateObligationMutation.mutate({
                                obligation,
                                status: "waived",
                              })
                            }
                            disabled={updateObligationMutation.isPending}
                            className="h-8 w-8 px-0"
                          >
                            <Ban size={15} className="text-danger" />
                          </SecondaryButton>
                        </div>
                      </div>
                    );
                  })}
                  {obligationsLoading ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      Updating attention items
                    </div>
                  ) : null}
                  {!obligationsLoading && activeObligations.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      Nothing needs attention for this selection.
                    </div>
                  ) : null}
                  {activeObligations.length > 6 ? (
                    <div className="px-4 py-2 text-xs text-muted-foreground">
                      Showing 6 of {activeObligations.length} open obligations.
                    </div>
                  ) : null}
                </div>

                <form
                  className="grid gap-3 border-t border-border p-4 lg:border-l lg:border-t-0"
                  onSubmit={obligationForm.handleSubmit((values) =>
                    obligationMutation.mutate(values),
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Quick date</h3>
                    <span className="text-xs text-muted-foreground">
                      {selectedProperty ? "Property" : "Entity"}
                    </span>
                  </div>
                  <Field
                    label="Title"
                    error={obligationForm.formState.errors.title?.message}
                  >
                    <Input
                      placeholder="Insurance renewal"
                      {...obligationForm.register("title")}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Due"
                      error={obligationForm.formState.errors.due_date?.message}
                    >
                      <Input
                        type="date"
                        {...obligationForm.register("due_date")}
                      />
                    </Field>
                    <Field label="Priority">
                      <Select {...obligationForm.register("priority")}>
                        {obligationPriorities.map((priority) => (
                          <option key={priority.value} value={priority.value}>
                            {priority.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Category">
                      <Select {...obligationForm.register("category")}>
                        {obligationCategories.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Lease">
                      <Select
                        {...obligationForm.register("lease_id")}
                        disabled={
                          !selectedPropertyId || !leasesQuery.data?.length
                        }
                      >
                        <option value="">Property level</option>
                        {leasesQuery.data?.map((lease) => (
                          <option key={lease.id} value={lease.id}>
                            {leaseOptionLabel(lease)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Owner">
                      <Select {...obligationForm.register("owner_role")}>
                        {obligationOwnerRoles.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Notes">
                      <Input
                        placeholder="Optional"
                        {...obligationForm.register("notes")}
                      />
                    </Field>
                  </div>
                  <Button
                    type="submit"
                    disabled={!selectedEntityId || obligationMutation.isPending}
                  >
                    <Plus size={16} />
                    Add date
                  </Button>
                  {obligationMutation.error ? (
                    <p className="text-sm text-danger">
                      {obligationMutation.error.message}
                    </p>
                  ) : null}
                  {updateObligationMutation.error ? (
                    <p className="text-sm text-danger">
                      {updateObligationMutation.error.message}
                    </p>
                  ) : null}
                  {obligationsQuery.error ? (
                    <p className="text-sm text-danger">
                      {obligationsQuery.error.message}
                    </p>
                  ) : null}
                </form>
              </div>
            </section>
          ) : null}

          {activeWorkspaceTab === "billing" ? (
            <section className="mb-4 overflow-hidden rounded-md border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ReceiptText size={17} className="text-primary" />
                    <h2 className="text-base font-semibold">
                      Billing readiness
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Charge rules, Xero mapping, and invoice blockers before the
                    invoicing module lands.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={rentRollPropertyId}
                    onChange={(event) =>
                      setRentRollPropertyId(event.target.value)
                    }
                    disabled={!selectedEntityId}
                    className="h-8 min-w-44"
                  >
                    <option value="">All properties</option>
                    {propertiesQuery.data?.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="date"
                    value={rentRollAsOf}
                    onChange={(event) => setRentRollAsOf(event.target.value)}
                    className="h-8 w-36"
                  />
                  <SecondaryButton
                    type="button"
                    onClick={() => rentRollQuery.refetch()}
                    disabled={!selectedEntityId}
                    className="h-8"
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </SecondaryButton>
                </div>
              </div>

              <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm tabular-nums">
                    <thead className="bg-muted text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Tenancy</th>
                        <th className="px-3 py-2 font-semibold">Rent</th>
                        <th className="px-3 py-2 font-semibold">Rules</th>
                        <th className="px-3 py-2 font-semibold">Next due</th>
                        <th className="px-3 py-2 font-semibold">Ready</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rentRollLoading ? (
                        <tr>
                          <td
                            className="px-3 py-8 text-center text-muted-foreground"
                            colSpan={5}
                          >
                            Updating rent roll rows
                          </td>
                        </tr>
                      ) : null}
                      {rentRollRows.slice(0, 8).map((row) => {
                        const blockers = readinessBlockers(row);
                        return (
                          <tr
                            key={`${row.property_id}-${row.tenancy_unit_id}`}
                            className="border-t border-border align-top"
                          >
                            <td className="px-3 py-3">
                              <div className="font-medium">
                                {row.unit_label}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {row.property_name}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {row.tenant_name ?? "Vacant"}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div>
                                {formatRent(
                                  row.annual_rent_cents,
                                  row.rent_frequency,
                                )}
                              </div>
                              <div className="text-muted-foreground">
                                {row.lease_status?.replaceAll("_", " ") ??
                                  "No lease"}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div>
                                {formatMoney(row.charge_rules_total_cents)}
                              </div>
                              <div className="text-muted-foreground">
                                {row.charge_rules?.length ?? 0} rules
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              {formatDate(row.next_due_date)}
                            </td>
                            <td className="px-3 py-3">
                              {blockers.length ? (
                                <div className="grid gap-1">
                                  {blockers.slice(0, 2).map((blocker) => (
                                    <span
                                      key={blocker}
                                      className="rounded bg-accent/10 px-1.5 py-0.5 text-xs"
                                    >
                                      {blocker}
                                    </span>
                                  ))}
                                  {blockers.length > 2 ? (
                                    <span className="text-xs text-muted-foreground">
                                      +{blockers.length - 2} more
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                  Ready
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!rentRollLoading && rentRollRows.length === 0 ? (
                        <tr>
                          <td
                            className="px-3 py-8 text-center text-muted-foreground"
                            colSpan={5}
                          >
                            No rent roll rows for this selection.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                  {rentRollRows.length > 8 ? (
                    <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                      Showing 8 of {rentRollRows.length} rent roll rows.
                    </div>
                  ) : null}
                </div>

                <form
                  className="grid gap-3 border-t border-border p-4 lg:border-l lg:border-t-0"
                  onSubmit={chargeRuleForm.handleSubmit((values) =>
                    chargeRuleMutation.mutate(values),
                  )}
                >
                  <div>
                    <h3 className="text-sm font-semibold">Quick charge rule</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Add the recurring charge that will feed invoices.
                    </p>
                  </div>
                  <Field
                    label="Lease"
                    error={chargeRuleForm.formState.errors.lease_id?.message}
                  >
                    <Select
                      {...chargeRuleForm.register("lease_id")}
                      disabled={
                        !selectedPropertyId ||
                        leasesLoading ||
                        !leasesQuery.data?.length
                      }
                    >
                      <option value="">
                        {leasesLoading ? "Checking leases" : "Select lease"}
                      </option>
                      {leasesQuery.data?.map((lease) => (
                        <option key={lease.id} value={lease.id}>
                          {leaseOptionLabel(lease)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Type">
                      <Select {...chargeRuleForm.register("charge_type")}>
                        {chargeTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Amount"
                      error={chargeRuleForm.formState.errors.amount?.message}
                    >
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        {...chargeRuleForm.register("amount")}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="GST">
                      <Select {...chargeRuleForm.register("gst_treatment")}>
                        {gstTreatments.map((treatment) => (
                          <option key={treatment.value} value={treatment.value}>
                            {treatment.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Next due"
                      error={
                        chargeRuleForm.formState.errors.next_due_date?.message
                      }
                    >
                      <Input
                        type="date"
                        {...chargeRuleForm.register("next_due_date")}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Xero account">
                      <Input
                        placeholder="200"
                        {...chargeRuleForm.register("xero_account_code")}
                      />
                    </Field>
                    <Field label="Tax type">
                      <Input
                        placeholder="OUTPUT"
                        {...chargeRuleForm.register("xero_tax_type")}
                      />
                    </Field>
                  </div>
                  <Button
                    type="submit"
                    disabled={
                      !selectedEntityId ||
                      !selectedPropertyId ||
                      chargeRulesLoading ||
                      leasesLoading ||
                      chargeRuleMutation.isPending
                    }
                  >
                    <Plus size={16} />
                    Add charge
                  </Button>
                  {chargeRuleMutation.error ? (
                    <p className="text-sm text-danger">
                      {friendlyError(chargeRuleMutation.error)}
                    </p>
                  ) : null}
                  {rentRollQuery.error ? (
                    <p className="text-sm text-danger">
                      {friendlyError(rentRollQuery.error)}
                    </p>
                  ) : null}
                  {chargeRulesQuery.error ? (
                    <p className="text-sm text-danger">
                      {friendlyError(chargeRulesQuery.error)}
                    </p>
                  ) : null}
                </form>
              </div>
            </section>
          ) : null}

          {activeWorkspaceTab === "portfolio" ? (
            <div className="grid gap-3">
              {ownerTagFilter ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      Ownership tag
                    </span>
                    <span
                      className={`inline-flex max-w-[18rem] items-center truncate rounded-full border px-2 py-0.5 text-leasium-micro font-semibold leading-4 ${ownershipChipClassName(activeOwnerTag?.palette ?? "slate")}`}
                      title={activeOwnerTag?.label ?? ownerTagFilter}
                    >
                      {activeOwnerTag?.label ?? ownerTagFilter}
                    </span>
                    <span className="text-muted-foreground">
                      Showing properties with this ownership tag.
                    </span>
                  </div>
                  <SecondaryButton
                    type="button"
                    className="h-8 px-2.5"
                    onClick={clearOwnerTagFilter}
                    aria-label="Clear ownership tag filter"
                  >
                    <X size={14} />
                    Clear filter
                  </SecondaryButton>
                </div>
              ) : null}

              {selectedProperty ? (
                <section className="overflow-hidden rounded-md border border-border bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setImagesPanelOpen((open) => !open)}
                      aria-expanded={imagesPanelOpen}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted/40">
                        <StoredPropertyImage
                          alt={`${selectedProperty.name} primary image`}
                          className="h-full w-full object-cover"
                          image={selectedPropertyImage}
                          placeholderClassName="grid h-full w-full place-items-center text-muted-foreground"
                          iconSize={14}
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="flex items-center gap-1 text-sm font-semibold">
                          <ImageIcon size={14} className="text-primary" />
                          Property images
                          {imagesPanelOpen ? (
                            <ChevronUp
                              size={14}
                              className="text-muted-foreground"
                            />
                          ) : (
                            <ChevronDown
                              size={14}
                              className="text-muted-foreground"
                            />
                          )}
                        </h3>
                        <p className="truncate text-xs text-muted-foreground">
                          {selectedPropertyImage
                            ? `Reviewed image saved${
                                propertyImageCandidates.length
                                  ? ` · ${propertyImageCandidates.length} candidate${propertyImageCandidates.length === 1 ? "" : "s"} waiting`
                                  : ""
                              }`
                            : "No reviewed image saved yet."}
                        </p>
                      </div>
                    </button>
                    <SecondaryButton
                      type="button"
                      className="h-9"
                      disabled={
                        !selectedPropertyId ||
                        previewPropertyImagesMutation.isPending
                      }
                      onClick={() => {
                        setImagesPanelOpen(true);
                        previewPropertyImagesMutation.mutate();
                      }}
                    >
                      {previewPropertyImagesMutation.isPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      Find property images
                    </SecondaryButton>
                  </div>
                  {imagesPanelOpen ? (
                    <div className="grid gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                      <div className="min-w-0">
                        <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/40">
                          <StoredPropertyImage
                            alt={`${selectedProperty.name} primary image`}
                            className="h-full w-full object-cover"
                            image={selectedPropertyImage}
                            placeholderClassName="grid h-full place-items-center text-muted-foreground"
                            iconSize={22}
                            testId="selected-property-image"
                          />
                        </div>
                        {selectedPropertyImage ? (
                          <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                            <div className="truncate font-medium text-foreground">
                              {selectedPropertyImage.title}
                            </div>
                            <div>
                              {confidencePercent(
                                selectedPropertyImage.confidence,
                              ) ?? "Reviewed image"}
                            </div>
                            {selectedPropertyImage.pageUrl ? (
                              <a
                                href={selectedPropertyImage.pageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-w-0 items-center gap-1 text-primary hover:text-primary-hover"
                              >
                                <ExternalLink size={12} />
                                <span className="truncate">Source page</span>
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-muted-foreground">
                            No reviewed image saved.
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        {propertyImageCandidates.length ? (
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {propertyImageCandidates.map((candidate) => (
                              <div
                                key={candidate.image_url}
                                className="overflow-hidden rounded-md border border-border bg-white"
                              >
                                <div className="aspect-video bg-muted/40">
                                  {failedPropertyImageCandidateUrls.has(
                                    candidate.image_url,
                                  ) ? (
                                    <div
                                      className="grid h-full place-items-center text-muted-foreground"
                                      data-testid="property-image-candidate-fallback"
                                    >
                                      <ImageIcon size={18} />
                                    </div>
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      alt={candidate.title}
                                      className="h-full w-full object-cover"
                                      data-testid="property-image-candidate-preview"
                                      onError={() =>
                                        setFailedPropertyImageCandidateUrls(
                                          (failedUrls) =>
                                            new Set(failedUrls).add(
                                              candidate.image_url,
                                            ),
                                        )
                                      }
                                      referrerPolicy="no-referrer"
                                      src={candidate.image_url}
                                    />
                                  )}
                                </div>
                                <div className="grid gap-2 p-3 text-xs">
                                  <div className="font-semibold text-foreground">
                                    {candidate.title}
                                  </div>
                                  <div className="text-muted-foreground">
                                    {candidate.source.source_hint} -{" "}
                                    {candidate.source.citation}
                                  </div>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <StatusBadge tone="neutral">
                                      {confidencePercent(candidate.confidence)}
                                    </StatusBadge>
                                    <Button
                                      type="button"
                                      className="h-8 px-2.5 text-xs"
                                      disabled={
                                        applyPropertyImageMutation.isPending
                                      }
                                      onClick={() =>
                                        applyPropertyImageMutation.mutate(
                                          candidate,
                                        )
                                      }
                                    >
                                      {applyingPropertyImageUrl ===
                                      candidate.image_url ? (
                                        <Loader2
                                          size={13}
                                          className="animate-spin"
                                        />
                                      ) : (
                                        <Check size={13} />
                                      )}
                                      Apply image
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
                            Image candidates will appear here for review.
                          </div>
                        )}
                        {propertyImageWarnings.length ? (
                          <div className="mt-3 grid gap-1 text-xs text-warning">
                            {propertyImageWarnings.map((warning) => (
                              <div key={warning}>{warning}</div>
                            ))}
                          </div>
                        ) : null}
                        {previewPropertyImagesMutation.error ||
                        applyPropertyImageMutation.error ? (
                          <div className="mt-3 text-xs text-danger">
                            {friendlyError(
                              previewPropertyImagesMutation.error ??
                                applyPropertyImageMutation.error,
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <SavedViewsMenu
                  surface="properties"
                  currentFilters={{
                    occupancy:
                      occupancyFilter === "all" ? null : occupancyFilter,
                    owner_tag: ownerTagFilter || null,
                  }}
                  onApplyView={(filters) => {
                    const nextOccupancy = filters.occupancy;
                    if (
                      nextOccupancy === "leased" ||
                      nextOccupancy === "leased_internal" ||
                      nextOccupancy === "partial" ||
                      nextOccupancy === "vacant" ||
                      nextOccupancy === "unknown"
                    ) {
                      setOccupancyFilter(
                        nextOccupancy as PropertyOccupancyStatus,
                      );
                    } else {
                      setOccupancyFilter("all");
                    }
                    setOwnerTagFilter(filters.owner_tag ?? "");
                  }}
                />
                <div
                  role="tablist"
                  aria-label="Properties view"
                  className="inline-flex items-center gap-0.5 rounded-full border border-border bg-white p-0.5 text-xs font-medium"
                >
                  {propertyPortfolioViewOptions().map((option) => {
                    const isActive = propertyView === option.id;
                    const OptionIcon = option.icon;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setPropertyView(option.id)}
                        className={cn(
                          "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 py-1 transition",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <OptionIcon size={14} className="inline-block" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {occupancyCounts.all > 0 ? (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {(
                    [
                      { key: "all", label: "All" },
                      { key: "leased", label: "Leased" },
                      { key: "leased_internal", label: "Leased internal" },
                      { key: "partial", label: "Partial" },
                      { key: "vacant", label: "Vacant" },
                      { key: "unknown", label: "No units" },
                    ] as const
                  ).map(({ key, label: optionLabel }) => {
                    const count = occupancyCounts[key];
                    if (key !== "all" && count === 0) {
                      return null;
                    }
                    const isActive = occupancyFilter === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setOccupancyFilter(key)}
                        aria-pressed={isActive}
                        className={`inline-flex min-h-[44px] items-center gap-1 rounded-full border px-2.5 py-1 font-semibold transition ${
                          isActive
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-white text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <span>{optionLabel}</span>
                        <span className="rounded-full bg-black/10 px-1.5 text-leasium-micro font-bold">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {propertyView === "table" ? (
                <>
                  <PropertyMobileListView
                    properties={displayedProperties}
                    occupancyByPropertyId={occupancyByPropertyId}
                    nextExpiryByPropertyId={nextExpiryByPropertyId}
                    selectedEntityName={selectedEntity?.name}
                    selectedPropertyId={selectedPropertyId}
                    ownershipPaletteByLabel={ownershipPaletteByLabel}
                    isLoading={propertiesLoading}
                    isOwnerTagFiltered={Boolean(ownerTagFilter)}
                    hasProperties={(propertiesQuery.data?.length ?? 0) > 0}
                    onSelect={selectProperty}
                    onEdit={startEdit}
                    onOwnerTagFilter={applyOwnerTagFilter}
                  />
                  <div className="hidden justify-end md:flex">
                    <div
                      role="group"
                      aria-label="Table row density"
                      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-white p-0.5 text-xs font-medium"
                    >
                      {(
                        [
                          { id: "comfortable", label: "Comfortable" },
                          { id: "compact", label: "Compact" },
                        ] as const
                      ).map((option) => {
                        const isActive = propertyDensity === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setPropertyDensity(option.id)}
                            className={cn(
                              "inline-flex min-h-[36px] items-center rounded-full px-3 py-1 transition",
                              isActive
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="hidden overflow-x-auto rounded-md border border-border bg-white md:block">
                    <table className="w-full min-w-[640px] border-collapse text-left text-sm tabular-nums">
                      <thead className="bg-muted text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="w-28 px-3 py-2 font-semibold">
                            Image
                          </th>
                          <th className="px-3 py-2 font-semibold">Property</th>
                          <th className="px-3 py-2 font-semibold">Type</th>
                          {showAreaColumn ? (
                            <th className="px-3 py-2 font-semibold">Area</th>
                          ) : null}
                          {showParkingColumn ? (
                            <th className="px-3 py-2 font-semibold">Parking</th>
                          ) : null}
                          <th className="w-12 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {displayedProperties.map((property) => {
                          const isSelected = property.id === selectedPropertyId;
                          const rowImage = propertyPrimaryImage(property);
                          return (
                            <tr
                              key={property.id}
                              className={`cursor-pointer border-t border-border transition hover:bg-muted/70 ${
                                isSelected ? "bg-primary/5" : ""
                              }`}
                              onClick={() => selectProperty(property.id)}
                            >
                              <td className={rowCellPadding}>
                                <StoredPropertyImage
                                  alt={`${property.name} property image`}
                                  className="h-14 w-24 rounded-md border border-border object-cover"
                                  image={rowImage}
                                  placeholderClassName="grid h-14 w-24 place-items-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground"
                                />
                              </td>
                              <td
                                className={rowCellPadding}
                                onClick={(event) => {
                                  // Allow inline-edit clicks inside the cell
                                  // without triggering row selection.
                                  const target = event.target as HTMLElement;
                                  if (target.closest("[data-inline-edit]")) {
                                    event.stopPropagation();
                                  }
                                }}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span data-inline-edit>
                                    <InlineEditCell
                                      value={property.name}
                                      ariaLabel={`Property name for ${property.name}`}
                                      placeholder="Add property name"
                                      className="font-medium"
                                      onSave={(next) =>
                                        savePropertyField(
                                          property.id,
                                          "name",
                                          next,
                                        )
                                      }
                                    />
                                  </span>
                                  {(() => {
                                    const occupancy = occupancyByPropertyId.get(
                                      property.id,
                                    );
                                    if (!occupancy) {
                                      return null;
                                    }
                                    return (
                                      <span
                                        className={occupancyBadgeClassName(
                                          occupancy.status,
                                        )}
                                        title={
                                          occupancy.status === "unknown"
                                            ? "No tenancy units recorded for this property yet."
                                            : `${occupancy.leasedUnits} of ${occupancy.totalUnits} units leased (active or holding over).`
                                        }
                                      >
                                        {occupancyBadgeLabel(occupancy)}
                                      </span>
                                    );
                                  })()}
                                  {(() => {
                                    const expiry = nextExpiryByPropertyId.get(
                                      property.id,
                                    );
                                    if (!expiry) {
                                      return null;
                                    }
                                    return (
                                      <span
                                        className={nextExpiryChipClassName(
                                          expiry.daysUntil,
                                        )}
                                        title={`Earliest active lease expires ${expiry.date}.`}
                                      >
                                        {nextExpiryChipLabel(expiry)}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div
                                  data-inline-edit
                                  className="text-muted-foreground"
                                >
                                  <InlineEditCell
                                    value={property.street_address}
                                    ariaLabel={`Street address for ${property.name}`}
                                    placeholder="Add street address"
                                    formatDisplay={(value) =>
                                      value
                                        ? `${value}, ${property.suburb} ${property.state}`
                                        : ""
                                    }
                                    onSave={(next) =>
                                      savePropertyField(
                                        property.id,
                                        "street_address",
                                        next,
                                      )
                                    }
                                  />
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {propertyOwnershipBadges(
                                    property,
                                    selectedEntity?.name,
                                    ownershipPaletteByLabel,
                                  )
                                    .slice(0, 3)
                                    .map((badge) => {
                                      const chipClassName = `inline-flex max-w-[14rem] items-center truncate rounded-full border px-2 py-0.5 text-leasium-micro font-semibold leading-4 ${ownershipChipClassName(badge.palette)}`;
                                      if (!badge.tagKey) {
                                        return (
                                          <span
                                            key={badge.label}
                                            title={badge.title ?? badge.label}
                                            className={chipClassName}
                                          >
                                            {badge.label}
                                          </span>
                                        );
                                      }
                                      const tagKey = badge.tagKey;
                                      return (
                                        <button
                                          key={badge.label}
                                          type="button"
                                          title={badge.title ?? badge.label}
                                          aria-label={`Filter by ownership tag ${badge.label}`}
                                          className={`${chipClassName} cursor-pointer text-left transition hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            applyOwnerTagFilter(tagKey);
                                          }}
                                        >
                                          {badge.label}
                                        </button>
                                      );
                                    })}
                                </div>
                              </td>
                              <td className={rowCellPadding}>
                                {property.property_type.replaceAll("_", " ")}
                              </td>
                              {showAreaColumn ? (
                                <td className={rowCellPadding}>
                                  {property.building_sqm ?? "-"}
                                </td>
                              ) : null}
                              {showParkingColumn ? (
                                <td className={rowCellPadding}>
                                  {property.parking_spaces ?? "-"}
                                </td>
                              ) : null}
                              <td className={rowCellPadding}>
                                <SecondaryButton
                                  type="button"
                                  aria-label={`Edit ${property.name}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    startEdit(property);
                                  }}
                                  className="h-8 w-8 px-0"
                                >
                                  <Pencil size={15} />
                                </SecondaryButton>
                              </td>
                            </tr>
                          );
                        })}
                        {propertiesLoading ? (
                          <tr>
                            <td
                              className="px-3 py-8 text-center text-muted-foreground"
                              colSpan={propertyTableColumnCount}
                            >
                              Checking properties
                            </td>
                          </tr>
                        ) : ownerTagFilter &&
                          displayedProperties.length === 0 ? (
                          <tr>
                            <td
                              className="px-3 py-8 text-center text-muted-foreground"
                              colSpan={propertyTableColumnCount}
                            >
                              No properties match this ownership tag.
                            </td>
                          </tr>
                        ) : propertiesQuery.data?.length === 0 ? (
                          <tr>
                            <td
                              className="px-3 py-8 text-center text-muted-foreground"
                              colSpan={propertyTableColumnCount}
                            >
                              No active properties yet.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : propertyView === "board" ? (
                <PropertyBoardView
                  properties={displayedProperties}
                  occupancyByPropertyId={occupancyByPropertyId}
                  nextExpiryByPropertyId={nextExpiryByPropertyId}
                  selectedPropertyId={selectedPropertyId}
                  onSelect={selectProperty}
                />
              ) : propertyView === "map" ? (
                <PropertyMapView
                  properties={displayedProperties}
                  occupancyByPropertyId={occupancyByPropertyId}
                  nextExpiryByPropertyId={nextExpiryByPropertyId}
                  selectedPropertyId={selectedPropertyId}
                  onSelect={selectProperty}
                />
              ) : (
                <PropertyCalendarView
                  events={leaseCalendarEvents}
                  isLoading={
                    insightsOverviewQuery.isLoading ||
                    rentRollQuery.isLoading ||
                    calendarRentRollQuery.isLoading
                  }
                />
              )}
            </div>
          ) : null}

          {activeWorkspaceTab === "billing" && selectedProperty ? (
            <section className="mt-4 overflow-hidden rounded-md border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ReceiptText size={17} className="text-primary" />
                    <h2 className="text-base font-semibold">
                      Ownership & billing identity
                    </h2>
                    {(() => {
                      const occupancy = occupancyByPropertyId.get(
                        selectedProperty.id,
                      );
                      if (!occupancy) {
                        return null;
                      }
                      return (
                        <span
                          className={occupancyBadgeClassName(occupancy.status)}
                          title={
                            occupancy.status === "unknown"
                              ? "No tenancy units recorded for this property yet."
                              : `${occupancy.leasedUnits} of ${occupancy.totalUnits} units leased (active or holding over).`
                          }
                        >
                          {occupancyBadgeLabel(occupancy)}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {billingIdentitySummary(
                      selectedProperty,
                      selectedEntity?.name,
                    )}
                  </p>
                </div>
                <SecondaryButton
                  type="button"
                  onClick={() => startEdit(selectedProperty)}
                  className="h-9"
                >
                  <Pencil size={15} />
                  Edit setup
                </SecondaryButton>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1fr]">
                <div className="grid gap-2 text-sm">
                  <div className="flex flex-wrap gap-1">
                    {propertyOwnershipBadges(
                      selectedProperty,
                      selectedEntity?.name,
                      ownershipPaletteByLabel,
                    ).map((badge) => (
                      <span
                        key={badge.label}
                        title={badge.title ?? badge.label}
                        className={`inline-flex max-w-[18rem] items-center truncate rounded-full border px-2.5 py-1 text-xs font-semibold leading-4 ${ownershipChipClassName(badge.palette)}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Owner tags use source-of-truth ownership data from the
                    property record or latest reviewed workbook import.
                  </div>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">
                      Invoice path
                    </dt>
                    <dd>
                      {ownershipStructureLabel(
                        selectedProperty.ownership_structure,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">
                      Owner
                    </dt>
                    <dd>{selectedProperty.owner_legal_name ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">
                      ABN
                    </dt>
                    <dd>{selectedProperty.owner_abn ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">
                      Xero
                    </dt>
                    <dd>
                      {selectedProperty.xero_contact_id
                        ? (selectedProperty.xero_tracking_category ?? "Mapped")
                        : "-"}
                    </dd>
                  </div>
                </dl>
                <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">Public fact suggestions</div>
                    <SecondaryButton
                      type="button"
                      className="h-8"
                      onClick={() => previewPropertyEnrichmentMutation.mutate()}
                      disabled={previewPropertyEnrichmentMutation.isPending}
                    >
                      {previewPropertyEnrichmentMutation.isPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      Suggest
                    </SecondaryButton>
                  </div>
                  {propertyEnrichmentSuggestions.length ? (
                    <div className="grid gap-2">
                      {propertyEnrichmentSuggestions.map((suggestion) => (
                        <div
                          key={`${suggestion.field}-${suggestion.value}`}
                          className="rounded border border-border bg-white px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              <span className="text-xs text-muted-foreground">
                                {suggestion.label}
                              </span>
                              <span className="ml-2 font-medium">
                                {suggestion.value}
                              </span>
                            </span>
                            <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary-hover">
                              {confidencePercent(suggestion.confidence)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {suggestion.source.source_hint} -{" "}
                            {suggestion.source.citation}
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        onClick={() => applyPropertyEnrichmentMutation.mutate()}
                        disabled={applyPropertyEnrichmentMutation.isPending}
                      >
                        {applyPropertyEnrichmentMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Check size={16} />
                        )}
                        Apply reviewed facts
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Missing owner ABNs, suburb, state, postcode, and
                      registered names stay review-first with citations.
                    </div>
                  )}
                  {previewPropertyEnrichmentMutation.error ||
                  applyPropertyEnrichmentMutation.error ? (
                    <div className="text-xs text-danger">
                      {friendlyError(
                        previewPropertyEnrichmentMutation.error ??
                          applyPropertyEnrichmentMutation.error,
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {activeWorkspaceTab === "documents" && selectedProperty ? (
            <section className="mt-4 overflow-hidden rounded-md border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ClipboardList size={17} className="text-primary" />
                    <h2 className="text-base font-semibold">Source history</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Smart Intake changes stored against this property.
                  </p>
                </div>
                {latestPropertyApply?.document_intake_id ? (
                  <Link
                    href={intakeReviewHref(
                      selectedEntityId,
                      latestPropertyApply.document_intake_id,
                    )}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                  >
                    <FileText size={15} />
                    Intake {shortId(latestPropertyApply.document_intake_id)}
                  </Link>
                ) : null}
              </div>
              <div className="p-4">
                <EvidenceSourceTrail
                  title="Evidence drawer"
                  description="Source document, before/after changes, field citations, and apply history for this property."
                  sourceDocument={
                    latestPropertyApply
                      ? {
                          label: propertyDocumentTypeLabel(
                            latestPropertyApply.document_type,
                          ),
                          href: latestPropertyApply.document_intake_id
                            ? intakeReviewHref(
                                selectedEntityId,
                                latestPropertyApply.document_intake_id,
                              )
                            : undefined,
                          detail:
                            shortId(latestPropertyApply.document_intake_id) ??
                            shortId(latestPropertyApply.document_id) ??
                            undefined,
                        }
                      : null
                  }
                  confidence={propertyEvidenceConfidence(
                    latestPropertyApply,
                    selectedPropertySources,
                  )}
                  changes={propertyEvidenceChanges(latestPropertyApply)}
                  history={propertyEvidenceHistory(
                    selectedPropertyApplyHistory,
                    selectedPropertySources,
                  )}
                  emptyMessage="No source evidence has been recorded for this property yet."
                  className="shadow-none"
                />
              </div>
            </section>
          ) : null}

          {activeWorkspaceTab === "operations" ? (
            <section className="mt-5 overflow-hidden rounded-md border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold">
                    {selectedProperty
                      ? `${selectedProperty.name} units`
                      : "Tenancy units"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {unitsWorkspaceLoading
                      ? "Updating units"
                      : `${tenancyUnitsQuery.data?.length ?? 0} units`}
                    {tenancyUnitsQuery.data?.length
                      ? ` - ${unitTotals.sqm} sqm - ${unitTotals.parking} parks`
                      : ""}
                    {tenancyUnitsQuery.data?.length
                      ? ` - ${occupancyTotals.occupied} occupied / ${occupancyTotals.vacant} vacant`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={startUnitCreate}
                    disabled={!selectedPropertyId}
                  >
                    <Plus size={16} />
                    Add unit
                  </Button>
                  <SecondaryButton
                    type="button"
                    onClick={() => {
                      tenancyUnitsQuery.refetch();
                      tenantsQuery.refetch();
                      leasesQuery.refetch();
                    }}
                    disabled={!selectedPropertyId}
                  >
                    <RefreshCw size={16} />
                    Refresh
                  </SecondaryButton>
                </div>
              </div>

              {selectedProperty ? (
                <div>
                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full border-collapse text-left text-sm tabular-nums">
                      <thead className="bg-muted text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Unit</th>
                          <th className="px-3 py-2 font-semibold">Occupant</th>
                          <th className="px-3 py-2 font-semibold">Dates</th>
                          <th className="px-3 py-2 font-semibold">
                            Rent / review
                          </th>
                          <th className="w-24 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {unitsWorkspaceLoading ? (
                          <tr>
                            <td
                              className="px-3 py-8 text-center text-muted-foreground"
                              colSpan={5}
                            >
                              Updating units
                            </td>
                          </tr>
                        ) : null}
                        {!unitsWorkspaceLoading
                          ? tenancyUnitsQuery.data?.map((unit) => {
                              const lease = pickUnitLease(
                                leasesQuery.data,
                                unit.id,
                              );
                              const tenant = lease
                                ? tenantsById.get(lease.tenant_id)
                                : undefined;
                              const onboarding = lease
                                ? onboardingByLeaseId.get(lease.id)
                                : undefined;
                              const canCopyOnboarding =
                                onboarding?.status === "sent" &&
                                !isExpiredDateTime(onboarding.expires_at);
                              const isOccupied =
                                lease &&
                                ["active", "holding_over", "pending"].includes(
                                  lease.status,
                                );
                              return (
                                <tr
                                  key={unit.id}
                                  className="border-t border-border align-top"
                                >
                                  <td className="px-3 py-3">
                                    <div className="font-medium">
                                      {unit.unit_label}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {unit.sqm ?? "-"} sqm -{" "}
                                      {unit.parking_spaces ?? "-"} parks
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                          isOccupied
                                            ? "bg-primary/10 text-primary"
                                            : "bg-muted text-muted-foreground"
                                        }`}
                                      >
                                        {lease
                                          ? lease.status.replaceAll("_", " ")
                                          : "vacant"}
                                      </span>
                                    </div>
                                    <div className="mt-1 font-medium">
                                      {lease
                                        ? tenantDisplayName(tenant)
                                        : "Vacant"}
                                    </div>
                                    {tenant?.contact_name ||
                                    tenant?.contact_email ? (
                                      <div className="text-xs text-muted-foreground">
                                        {[
                                          tenant.contact_name,
                                          tenant.contact_email,
                                        ]
                                          .filter(Boolean)
                                          .join(" - ")}
                                      </div>
                                    ) : null}
                                    {onboarding ? (
                                      <div className="mt-1 text-xs text-primary">
                                        Onboarding{" "}
                                        {onboarding.status.replaceAll("_", " ")}
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-3 text-xs">
                                    <div>
                                      Start:{" "}
                                      {formatDate(lease?.commencement_date)}
                                    </div>
                                    <div>
                                      Expiry: {formatDate(lease?.expiry_date)}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-xs">
                                    <div>
                                      {formatRent(
                                        lease?.annual_rent_cents,
                                        lease?.rent_frequency,
                                      )}
                                    </div>
                                    <div>
                                      Review:{" "}
                                      {formatDate(lease?.next_review_date)}
                                    </div>
                                    {lease?.outgoings_recoverable ? (
                                      <div className="text-muted-foreground">
                                        Outgoings recoverable
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex justify-end gap-2">
                                      <SecondaryButton
                                        type="button"
                                        aria-label={
                                          canCopyOnboarding
                                            ? `Copy onboarding link for ${unit.unit_label}`
                                            : onboarding
                                              ? `Onboarding link unavailable for ${unit.unit_label}`
                                              : `Create onboarding link for ${unit.unit_label}`
                                        }
                                        title={
                                          onboarding && !canCopyOnboarding
                                            ? "Open tenant detail to send a fresh link"
                                            : undefined
                                        }
                                        onClick={() =>
                                          lease
                                            ? startTenantOnboarding(lease)
                                            : null
                                        }
                                        disabled={
                                          !lease ||
                                          tenantOnboardingMutation.isPending ||
                                          Boolean(
                                            onboarding && !canCopyOnboarding,
                                          )
                                        }
                                        className="h-8 w-8 px-0 text-primary"
                                      >
                                        {copiedOnboardingId ===
                                        onboarding?.id ? (
                                          <Check size={15} />
                                        ) : canCopyOnboarding ? (
                                          <Copy size={15} />
                                        ) : (
                                          <Link2 size={15} />
                                        )}
                                      </SecondaryButton>
                                      {onboarding?.status === "sent" ? (
                                        <SecondaryButton
                                          type="button"
                                          aria-label={`Cancel onboarding for ${unit.unit_label}`}
                                          title="Cancel onboarding"
                                          onClick={() =>
                                            requestCancelTenantOnboarding(
                                              onboarding,
                                            )
                                          }
                                          disabled={
                                            cancelTenantOnboardingMutation.isPending
                                          }
                                          className="h-8 w-8 px-0 text-muted-foreground"
                                        >
                                          <Ban size={15} />
                                        </SecondaryButton>
                                      ) : null}
                                      {lease ? (
                                        <SecondaryButton
                                          type="button"
                                          onClick={() =>
                                            startLeaseEdit(unit, lease)
                                          }
                                          className="h-8 px-2"
                                        >
                                          <Pencil size={15} />
                                          Edit lease
                                        </SecondaryButton>
                                      ) : (
                                        <Button
                                          type="button"
                                          onClick={() => startLeaseEdit(unit)}
                                          className="h-8 px-2"
                                        >
                                          <Plus size={15} />
                                          Add lease
                                        </Button>
                                      )}
                                      <SecondaryButton
                                        type="button"
                                        title={`Edit ${unit.unit_label}`}
                                        aria-label={`Edit ${unit.unit_label}`}
                                        className="h-8 w-8 px-0"
                                        onClick={() => startUnitEdit(unit)}
                                      >
                                        <Pencil size={15} />
                                      </SecondaryButton>
                                      <SecondaryButton
                                        type="button"
                                        aria-label={`Delete ${unit.unit_label}`}
                                        onClick={() => requestDeleteUnit(unit)}
                                        disabled={deleteUnitMutation.isPending}
                                        className="h-8 w-8 px-0 text-danger"
                                      >
                                        <Trash2 size={15} />
                                      </SecondaryButton>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          : null}
                        {!unitsWorkspaceLoading &&
                        tenancyUnitsQuery.data?.length === 0 ? (
                          <tr>
                            <td
                              className="px-3 py-8 text-center text-muted-foreground"
                              colSpan={5}
                            >
                              No units recorded for this property.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {propertiesLoading
                    ? "Preparing selected property"
                    : "Select a property."}
                </div>
              )}
            </section>
          ) : null}
        </section>

        {leaseEditorRender.shouldRender ? (
          <div
            className={cn(
              "fixed inset-0 z-50 grid bg-foreground/20 backdrop-blur-[1px] lg:justify-items-end",
              leaseEditorRender.isClosing
                ? "animate-leasium-backdrop-out"
                : "animate-leasium-backdrop-in",
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="lease-editor-title"
          >
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              aria-label="Close lease editor"
              onClick={closeLeaseEditor}
            />
            <form
              className={cn(
                "relative grid h-full w-full max-w-xl grid-rows-[auto_1fr_auto] border-l border-border bg-white shadow-xl",
                leaseEditorRender.isClosing
                  ? "animate-leasium-drawer-out-right"
                  : "animate-leasium-drawer-in-right",
              )}
              onSubmit={leaseForm.handleSubmit((values) =>
                leaseMutation.mutate(values),
              )}
            >
              <div className="border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-1 inline-flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                      <CalendarClock size={13} />
                      {editingLease ? "Lease update" : "New lease"}
                    </div>
                    <h3
                      id="lease-editor-title"
                      className="text-lg font-semibold"
                    >
                      {editingLease ? "Edit lease" : "Add lease"}
                      {leaseEditorUnit
                        ? ` for ${leaseEditorUnit.unit_label}`
                        : ""}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedProperty?.name ?? "Selected property"}
                    </p>
                  </div>
                  <SecondaryButton
                    type="button"
                    aria-label="Close lease editor"
                    onClick={closeLeaseEditor}
                    className="h-8 w-8 px-0"
                  >
                    <X size={15} />
                  </SecondaryButton>
                </div>
              </div>

              <div className="overflow-y-auto px-5 py-4">
                <div className="mb-4 grid gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Unit</div>
                    <div className="font-medium">
                      {leaseEditorUnit?.unit_label ?? "Choose a unit"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Current tenant
                    </div>
                    <div className="font-medium">
                      {leaseEditorTenant
                        ? tenantDisplayName(leaseEditorTenant)
                        : "Vacant"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Rent</div>
                    <div className="font-medium">
                      {formatRent(
                        leaseEditorExistingLease?.annual_rent_cents,
                        leaseEditorExistingLease?.rent_frequency,
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Expiry</div>
                    <div className="font-medium">
                      {formatDate(leaseEditorExistingLease?.expiry_date)}
                    </div>
                  </div>
                </div>

                <div className="grid gap-5">
                  <section className="grid gap-3">
                    <h4 className="text-sm font-semibold">Tenant</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label="Unit"
                        error={
                          leaseForm.formState.errors.tenancy_unit_id?.message
                        }
                      >
                        <Select {...leaseForm.register("tenancy_unit_id")}>
                          <option value="">Select unit</option>
                          {tenancyUnitsQuery.data?.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.unit_label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        label="Tenant"
                        error={leaseForm.formState.errors.tenant_id?.message}
                      >
                        <Select {...leaseForm.register("tenant_id")}>
                          <option value="">New tenant</option>
                          {tenantsQuery.data?.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>
                              {tenantDisplayName(tenant)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    {!leaseEditorTenantId ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Legal name"
                          error={
                            leaseForm.formState.errors.new_tenant_legal_name
                              ?.message
                          }
                        >
                          <Input
                            placeholder="Tenant Pty Ltd"
                            {...leaseForm.register("new_tenant_legal_name")}
                          />
                        </Field>
                        <Field label="Trading as">
                          <Input
                            placeholder="Optional"
                            {...leaseForm.register("new_tenant_trading_name")}
                          />
                        </Field>
                      </div>
                    ) : null}
                  </section>

                  <section className="grid gap-3">
                    <h4 className="text-sm font-semibold">Lease dates</h4>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Start">
                        <Input
                          type="date"
                          {...leaseForm.register("commencement_date")}
                        />
                      </Field>
                      <Field label="Expiry">
                        <Input
                          type="date"
                          {...leaseForm.register("expiry_date")}
                        />
                      </Field>
                      <Field label="Status">
                        <Select {...leaseForm.register("status")}>
                          {leaseStatuses.map((status) => (
                            <option key={status.value} value={status.value}>
                              {status.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  </section>

                  <section className="grid gap-3">
                    <h4 className="text-sm font-semibold">Rent and review</h4>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Rent">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="180000"
                          {...leaseForm.register("annual_rent")}
                        />
                      </Field>
                      <Field label="Frequency">
                        <Select {...leaseForm.register("rent_frequency")}>
                          {rentFrequencies.map((frequency) => (
                            <option
                              key={frequency.value}
                              value={frequency.value}
                            >
                              {frequency.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Review">
                        <Input
                          type="date"
                          {...leaseForm.register("next_review_date")}
                        />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        {...leaseForm.register("outgoings_recoverable")}
                      />
                      Outgoings recoverable
                    </label>
                  </section>

                  <section className="grid gap-3">
                    <button
                      type="button"
                      className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium transition hover:bg-muted"
                      onClick={() => setLeaseMoreOpen((value) => !value)}
                    >
                      More lease details
                      <span className="text-xs text-muted-foreground">
                        {leaseMoreOpen ? "Hide" : "Show"}
                      </span>
                    </button>
                    {leaseMoreOpen ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Options">
                          <Input
                            placeholder="2 x 3 years"
                            {...leaseForm.register("option_summary")}
                          />
                        </Field>
                        <Field label="Security">
                          <Input
                            placeholder="Bank guarantee"
                            {...leaseForm.register("security_summary")}
                          />
                        </Field>
                        <div className="sm:col-span-2">
                          <Field label="Notes">
                            <Input
                              placeholder="Lease notes"
                              {...leaseForm.register("notes")}
                            />
                          </Field>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  {leaseMutation.error ||
                  deleteLeaseMutation.error ||
                  tenantsQuery.error ||
                  leasesQuery.error ? (
                    <p className="text-sm text-danger">
                      {friendlyError(
                        leaseMutation.error ??
                          deleteLeaseMutation.error ??
                          tenantsQuery.error ??
                          leasesQuery.error,
                      )}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
                {editingLease ? (
                  <SecondaryButton
                    type="button"
                    onClick={requestDeleteLease}
                    disabled={deleteLeaseMutation.isPending}
                    className="text-danger"
                  >
                    <Trash2 size={15} />
                    Delete
                  </SecondaryButton>
                ) : (
                  <SecondaryButton type="button" onClick={closeLeaseEditor}>
                    Cancel
                  </SecondaryButton>
                )}
                <Button
                  type="submit"
                  disabled={
                    !selectedEntityId ||
                    !selectedPropertyId ||
                    leaseMutation.isPending
                  }
                >
                  {editingLease ? <Check size={16} /> : <Plus size={16} />}
                  {editingLease ? "Save lease" : "Add lease"}
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {unitEditorRender.shouldRender ? (
          <div
            className={cn(
              "fixed inset-0 z-50 grid place-items-center bg-foreground/20 px-4 backdrop-blur-[1px]",
              unitEditorRender.isClosing
                ? "animate-leasium-backdrop-out"
                : "animate-leasium-backdrop-in",
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unit-editor-title"
          >
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              aria-label="Close unit editor"
              onClick={closeUnitEditor}
            />
            <form
              className={cn(
                "relative w-full max-w-md rounded-md border border-border bg-white shadow-xl",
                unitEditorRender.isClosing
                  ? "animate-leasium-modal-out"
                  : "animate-leasium-modal-in",
              )}
              onSubmit={unitForm.handleSubmit((values) =>
                unitMutation.mutate(values),
              )}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h3 id="unit-editor-title" className="text-lg font-semibold">
                    {editingUnit ? "Edit unit" : "Add unit"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedProperty?.name ?? "Selected property"}
                  </p>
                </div>
                <SecondaryButton
                  type="button"
                  aria-label="Close unit editor"
                  onClick={closeUnitEditor}
                  className="h-8 w-8 px-0"
                >
                  <X size={15} />
                </SecondaryButton>
              </div>
              <div className="grid gap-3 px-5 py-4">
                <Field
                  label="Unit label"
                  error={unitForm.formState.errors.unit_label?.message}
                >
                  <Input
                    placeholder="Suite 1.02"
                    {...unitForm.register("unit_label")}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Sqm"
                    error={unitForm.formState.errors.sqm?.message}
                  >
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      {...unitForm.register("sqm")}
                    />
                  </Field>
                  <Field
                    label="Parking"
                    error={unitForm.formState.errors.parking_spaces?.message}
                  >
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      {...unitForm.register("parking_spaces")}
                    />
                  </Field>
                </div>
                {unitMutation.error || deleteUnitMutation.error ? (
                  <p className="text-sm text-danger">
                    {friendlyError(
                      unitMutation.error ?? deleteUnitMutation.error,
                    )}
                  </p>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                <SecondaryButton type="button" onClick={closeUnitEditor}>
                  Cancel
                </SecondaryButton>
                <Button
                  type="submit"
                  disabled={!selectedPropertyId || unitMutation.isPending}
                >
                  {editingUnit ? <Check size={16} /> : <Plus size={16} />}
                  {editingUnit ? "Save unit" : "Add unit"}
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {propertyEditorRender.shouldRender ? (
          <div
            className={cn(
              "fixed inset-0 z-50 grid bg-foreground/20 backdrop-blur-[1px] lg:justify-items-end",
              propertyEditorRender.isClosing
                ? "animate-leasium-backdrop-out"
                : "animate-leasium-backdrop-in",
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="property-editor-title"
          >
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              aria-label="Close property editor"
              onClick={closePropertyEditor}
            />
            <aside
              className={cn(
                "relative h-full w-full max-w-xl overflow-y-auto border-l border-border bg-white p-4 shadow-xl",
                propertyEditorRender.isClosing
                  ? "animate-leasium-drawer-out-right"
                  : "animate-leasium-drawer-in-right",
              )}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2
                  id="property-editor-title"
                  className="text-base font-semibold"
                >
                  {editing ? "Edit property" : "New property"}
                </h2>
                <SecondaryButton
                  type="button"
                  aria-label="Close property editor"
                  onClick={closePropertyEditor}
                  className="h-8 w-8 px-0"
                >
                  <X size={15} />
                </SecondaryButton>
              </div>

              <form
                className="grid gap-3"
                onSubmit={form.handleSubmit((values) =>
                  mutation.mutate(values),
                )}
              >
                <Field label="Name" error={form.formState.errors.name?.message}>
                  <Input {...form.register("name")} />
                </Field>
                <Field
                  label="Street address"
                  error={form.formState.errors.street_address?.message}
                >
                  <Input {...form.register("street_address")} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Suburb">
                    <Input {...form.register("suburb")} />
                  </Field>
                  <Field label="State">
                    <Input {...form.register("state")} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Postcode">
                    <Input {...form.register("postcode")} />
                  </Field>
                  <Field label="Type">
                    <Select {...form.register("property_type")}>
                      {propertyTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Building sqm">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      {...form.register("building_sqm")}
                    />
                  </Field>
                  <Field label="Parking">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      {...form.register("parking_spaces")}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    {...form.register("has_solar_pv")}
                  />
                  Solar PV
                </label>
                <details
                  className="rounded-xl border border-border bg-muted/25"
                  open={billingProfileOpen}
                  onToggle={(event) =>
                    setBillingProfileOpen(event.currentTarget.open)
                  }
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-semibold">
                    <span>Ownership & billing identity</span>
                    <span className="text-xs font-medium text-muted-foreground">
                      {billingProfileOpen ? "Hide" : "Show"}
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-border px-3 py-3">
                    <Field label="Invoice from">
                      <Select {...form.register("ownership_structure")}>
                        {ownershipStructures.map((structure) => (
                          <option key={structure.value} value={structure.value}>
                            {structure.label}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    {showOwnershipFields ? (
                      <>
                        <Field label="Invoice issuer">
                          <Input
                            placeholder="Trustee Pty Ltd"
                            {...form.register("invoice_issuer_name")}
                          />
                        </Field>
                        <Field label="Legal owner">
                          <Input
                            placeholder="Property Trust or Owner Pty Ltd"
                            {...form.register("owner_legal_name")}
                          />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="ABN">
                            <Input {...form.register("owner_abn")} />
                          </Field>
                          <Field label="GST">
                            <Select {...form.register("owner_gst_registered")}>
                              <option value="">Not set</option>
                              <option value="true">Registered</option>
                              <option value="false">Not registered</option>
                            </Select>
                          </Field>
                        </div>
                        {ownershipStructure === "trust" ? (
                          <div className="grid gap-3">
                            <Field label="Trustee">
                              <Input {...form.register("trustee_name")} />
                            </Field>
                            <Field label="Trust">
                              <Input {...form.register("trust_name")} />
                            </Field>
                          </div>
                        ) : null}
                        {ownershipStructure === "split" ? (
                          <Field label="Ownership split">
                            <Input
                              placeholder="60% Owner A / 40% Owner B"
                              {...form.register("ownership_split")}
                            />
                          </Field>
                        ) : null}
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Xero issuer">
                            <Input
                              placeholder="Contact ID"
                              {...form.register("xero_contact_id")}
                            />
                          </Field>
                          <Field label="Tracking">
                            <Input
                              placeholder="Property or owner"
                              {...form.register("xero_tracking_category")}
                            />
                          </Field>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-md border border-border bg-white p-3 text-sm text-muted-foreground">
                        Owned by the current portfolio entity. Add a specific
                        owner, trust, or split only when invoices need that
                        identity.
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Billing contact">
                        <Input {...form.register("billing_contact_name")} />
                      </Field>
                      <Field label="Billing email">
                        <Input
                          type="email"
                          {...form.register("billing_email")}
                        />
                      </Field>
                    </div>
                    <Field label="Invoice reference">
                      <Input
                        placeholder="Optional prefix or note"
                        {...form.register("invoice_reference")}
                      />
                    </Field>
                  </div>
                </details>
                <Button
                  type="submit"
                  disabled={!selectedEntityId || mutation.isPending}
                >
                  {editing ? <Check size={16} /> : <Plus size={16} />}
                  {editing ? "Save property" : "Add property"}
                </Button>
                {mutation.error ? (
                  <p className="text-sm text-danger">
                    {mutation.error.message}
                  </p>
                ) : null}
              </form>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function PropertyWorkspace({
  initialView = "table",
}: {
  initialView?: PropertyPortfolioView;
}) {
  return (
    <QueryProvider>
      <Workspace initialView={initialView} />
    </QueryProvider>
  );
}

type PropertyBoardViewProps = {
  properties: PropertyRecord[];
  occupancyByPropertyId: Map<string, PropertyOccupancy>;
  nextExpiryByPropertyId: Map<string, NextLeaseExpiry>;
  selectedPropertyId: string;
  onSelect: (propertyId: string) => void;
};

type PropertyMobileListViewProps = PropertyBoardViewProps & {
  selectedEntityName?: string;
  ownershipPaletteByLabel: ReturnType<typeof propertyOwnershipPaletteMap>;
  isLoading: boolean;
  isOwnerTagFiltered: boolean;
  hasProperties: boolean;
  onEdit: (property: PropertyRecord) => void;
  onOwnerTagFilter: (tagKey: string) => void;
};

function PropertyMobileListView({
  properties,
  occupancyByPropertyId,
  nextExpiryByPropertyId,
  selectedEntityName,
  selectedPropertyId,
  ownershipPaletteByLabel,
  isLoading,
  isOwnerTagFiltered,
  hasProperties,
  onSelect,
  onEdit,
  onOwnerTagFilter,
}: PropertyMobileListViewProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground md:hidden">
        Checking properties
      </div>
    );
  }

  if (!properties.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground md:hidden">
        {isOwnerTagFiltered && hasProperties
          ? "No properties match this ownership tag."
          : "No active properties yet."}
      </div>
    );
  }

  return (
    <ul aria-label="Property cards" className="grid gap-3 md:hidden">
      {properties.map((property) => {
        const image = propertyPrimaryImage(property);
        const occupancy = occupancyByPropertyId.get(property.id);
        const expiry = nextExpiryByPropertyId.get(property.id);
        const isSelected = property.id === selectedPropertyId;
        const propertyType = property.property_type.replaceAll("_", " ");
        const areaLabel =
          property.building_sqm === null || property.building_sqm === undefined
            ? "Area not set"
            : `${property.building_sqm} sqm`;
        const parkingLabel =
          property.parking_spaces === null ||
          property.parking_spaces === undefined
            ? "Parking not set"
            : `${property.parking_spaces} parks`;

        return (
          <li
            key={property.id}
            className={cn(
              "rounded-md border bg-white p-3",
              isSelected ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <div className="grid gap-3">
              <div className="flex items-start gap-3">
                <StoredPropertyImage
                  alt={`${property.name} property image`}
                  className="h-20 w-24 shrink-0 rounded-md border border-border object-cover"
                  image={image}
                  placeholderClassName="grid h-20 w-24 shrink-0 place-items-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-sm font-semibold text-foreground">
                    {property.name}
                  </h3>
                  <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                    {property.street_address}
                    {property.suburb || property.state ? ", " : ""}
                    {[property.suburb, property.state]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {occupancy ? (
                      <span
                        className={occupancyBadgeClassName(occupancy.status)}
                        title={
                          occupancy.status === "unknown"
                            ? "No tenancy units recorded for this property yet."
                            : `${occupancy.leasedUnits} of ${occupancy.totalUnits} units leased (active or holding over).`
                        }
                      >
                        {occupancyBadgeLabel(occupancy)}
                      </span>
                    ) : null}
                    {expiry ? (
                      <span
                        className={nextExpiryChipClassName(expiry.daysUntil)}
                        title={`Earliest active lease expires ${expiry.date}.`}
                      >
                        {nextExpiryChipLabel(expiry)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div className="min-w-0">
                  <dt className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                    Type
                  </dt>
                  <dd className="break-words text-foreground">
                    {propertyType}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                    Area
                  </dt>
                  <dd className="break-words text-foreground">{areaLabel}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                    Parking
                  </dt>
                  <dd className="break-words text-foreground">
                    {parkingLabel}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-1">
                {propertyOwnershipBadges(
                  property,
                  selectedEntityName,
                  ownershipPaletteByLabel,
                )
                  .slice(0, 3)
                  .map((badge) => {
                    const chipClassName = `inline-flex min-h-[32px] max-w-full items-center break-words rounded-full border px-2 py-1 text-left text-leasium-micro font-semibold leading-4 ${ownershipChipClassName(badge.palette)}`;
                    if (!badge.tagKey) {
                      return (
                        <span
                          key={badge.label}
                          title={badge.title ?? badge.label}
                          className={chipClassName}
                        >
                          {badge.label}
                        </span>
                      );
                    }
                    const tagKey = badge.tagKey;
                    return (
                      <button
                        key={badge.label}
                        type="button"
                        title={badge.title ?? badge.label}
                        aria-label={`Filter by ownership tag ${badge.label}`}
                        className={`${chipClassName} min-h-[44px] cursor-pointer transition hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary`}
                        onClick={() => onOwnerTagFilter(tagKey)}
                      >
                        {badge.label}
                      </button>
                    );
                  })}
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                <Button
                  type="button"
                  className="min-h-[44px] justify-center"
                  aria-label={`Open property ${property.name}`}
                  onClick={() => onSelect(property.id)}
                >
                  Open property
                </Button>
                <SecondaryButton
                  type="button"
                  aria-label={`Edit ${property.name}`}
                  title={`Edit ${property.name}`}
                  className="h-11 w-11 px-0"
                  onClick={() => onEdit(property)}
                >
                  <Pencil size={16} />
                </SecondaryButton>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const BOARD_COLUMNS: {
  status: PropertyOccupancyStatus | "unknown";
  label: string;
  tone: string;
}[] = [
  { status: "leased", label: "Leased", tone: "bg-success-soft" },
  {
    status: "leased_internal",
    label: "Leased internal",
    tone: "bg-primary-soft",
  },
  { status: "partial", label: "Partial", tone: "bg-warning-soft" },
  { status: "vacant", label: "Vacant", tone: "bg-danger-soft" },
  { status: "unknown", label: "No units", tone: "bg-muted/40" },
];

function PropertyBoardView({
  properties,
  occupancyByPropertyId,
  nextExpiryByPropertyId,
  selectedPropertyId,
  onSelect,
}: PropertyBoardViewProps) {
  const grouped = BOARD_COLUMNS.map((column) => ({
    ...column,
    properties: properties.filter((property) => {
      const occupancy = occupancyByPropertyId.get(property.id);
      const status = occupancy?.status ?? "unknown";
      return status === column.status;
    }),
  })).filter((column) => column.properties.length > 0);

  if (grouped.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No properties match the current filters.
      </div>
    );
  }

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {grouped.map((column) => (
        <section
          key={column.status}
          className="flex flex-col gap-2 self-start rounded-lg border border-border bg-white p-3"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${column.tone}`}
            >
              {column.label}
              <span className="rounded-full bg-black/10 px-1.5 text-leasium-micro font-bold">
                {column.properties.length}
              </span>
            </span>
          </header>
          <div className="grid gap-2">
            {column.properties.map((property) => {
              const image = propertyPrimaryImage(property);
              const expiry = nextExpiryByPropertyId.get(property.id);
              const isSelected = property.id === selectedPropertyId;
              return (
                <button
                  key={property.id}
                  type="button"
                  onClick={() => onSelect(property.id)}
                  className={`grid gap-1 rounded-md border p-2 text-left transition hover:bg-muted/50 ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-white"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <StoredPropertyImage
                      alt={`${property.name} property image`}
                      className="h-12 w-16 shrink-0 rounded-md border border-border object-cover"
                      image={image}
                      placeholderClassName="grid h-12 w-16 shrink-0 place-items-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {property.name}
                      </div>
                      <div className="truncate text-leasium-micro text-muted-foreground">
                        {property.street_address}, {property.suburb}{" "}
                        {property.state}
                      </div>
                    </div>
                  </div>
                  {expiry ? (
                    <div
                      className={nextExpiryChipClassName(expiry.daysUntil)}
                      title={`Earliest active lease expires ${expiry.date}.`}
                    >
                      {nextExpiryChipLabel(expiry)}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function PropertyMapView({
  properties,
  occupancyByPropertyId,
  nextExpiryByPropertyId,
  selectedPropertyId,
  onSelect,
}: PropertyBoardViewProps) {
  const [mapFocus, setMapFocus] = useState<PropertyMapFocus>("all");
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const mapProperties = properties.filter((property) =>
    propertyMapFocusMatches({
      focus: mapFocus,
      occupancy: occupancyByPropertyId.get(property.id),
      expiry: nextExpiryByPropertyId.get(property.id),
    }),
  );
  const leaseRiskCount = properties.filter((property) =>
    propertyMapFocusMatches({
      focus: "lease_risk",
      occupancy: occupancyByPropertyId.get(property.id),
      expiry: nextExpiryByPropertyId.get(property.id),
    }),
  ).length;
  const vacancyFocusCount = properties.filter((property) =>
    propertyMapFocusMatches({
      focus: "vacancy",
      occupancy: occupancyByPropertyId.get(property.id),
      expiry: nextExpiryByPropertyId.get(property.id),
    }),
  ).length;
  const regionRows = propertyMapRegionRows({
    properties,
    occupancyByPropertyId,
    nextExpiryByPropertyId,
  });
  const planningLanes = propertyMapPlanningLanes({
    properties,
    occupancyByPropertyId,
    nextExpiryByPropertyId,
  });
  const copyMapBrief = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Clipboard is not available in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      propertyMapPlanningBrief({
        properties: mapProperties,
        focus: mapFocus,
        occupancyByPropertyId,
        nextExpiryByPropertyId,
      }),
    );
    setCopyReceipt("Map brief copied.");
  };

  if (!properties.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No properties match the current filters.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 rounded-md border border-border bg-white p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="primary">{properties.length} mapped</StatusBadge>
            <StatusBadge tone={leaseRiskCount ? "warning" : "neutral"}>
              {leaseRiskCount} lease risk
            </StatusBadge>
            <StatusBadge tone={vacancyFocusCount ? "danger" : "success"}>
              {vacancyFocusCount} vacancy focus
            </StatusBadge>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {propertyMapFocusOptions.map((option) => {
              const isActive = mapFocus === option.key;
              const count =
                option.key === "lease_risk"
                  ? leaseRiskCount
                  : option.key === "vacancy"
                    ? vacancyFocusCount
                    : properties.length;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setMapFocus(option.key)}
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold transition ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-white text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span>{option.label}</span>
                  <span className="rounded-full bg-black/10 px-1.5 text-leasium-micro font-bold">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          {copyReceipt ? (
            <p className="text-sm font-medium text-success">{copyReceipt}</p>
          ) : null}
        </div>
        <SecondaryButton type="button" onClick={copyMapBrief}>
          <Copy size={15} />
          Copy map brief
        </SecondaryButton>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative min-h-[420px] overflow-hidden rounded-md border border-border bg-muted/30">
          <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,rgba(100,116,139,0.16)_1px,transparent_1px),linear-gradient(to_bottom,rgba(100,116,139,0.16)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="absolute inset-x-4 top-4 rounded-md border border-border bg-white/90 px-3 py-2 text-sm shadow-sm">
            <div className="font-semibold">Portfolio map</div>
            <div className="text-xs text-muted-foreground">
              Address-based view for suburb clustering and expiry focus.
            </div>
          </div>
          {!mapProperties.length ? (
            <div className="absolute inset-x-6 top-28 rounded-md border border-dashed border-border bg-white/90 px-4 py-6 text-center text-sm text-muted-foreground">
              No properties match this map focus.
            </div>
          ) : null}
          {mapProperties.map((property, index) => {
            const point = propertyMapPoint(property, index);
            const occupancy = occupancyByPropertyId.get(property.id);
            const expiry = nextExpiryByPropertyId.get(property.id);
            const isSelected = property.id === selectedPropertyId;
            return (
              <button
                key={property.id}
                type="button"
                onClick={() => onSelect(property.id)}
                className={cn(
                  "absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 shadow-sm transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-white bg-foreground text-background",
                )}
                style={{ left: `${point.left}%`, top: `${point.top}%` }}
                title={`${property.name} - ${propertyRegionLabel(property) || property.street_address}`}
              >
                <MapPin size={18} />
                {expiry ? (
                  <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-warning ring-2 ring-white" />
                ) : null}
                <span className="sr-only">{property.name}</span>
                {occupancy ? (
                  <span className="absolute -bottom-5 whitespace-nowrap rounded-full border border-border bg-white px-1.5 py-0.5 text-leasium-micro font-semibold text-foreground shadow-sm">
                    {occupancy.leasedUnits}/{occupancy.totalUnits}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="grid content-start gap-2">
          <div className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm">
            <div className="font-semibold">Map planning</div>
            {planningLanes.map((lane) => {
              const content = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{lane.label}</span>
                    <StatusBadge tone={lane.tone}>{lane.count}</StatusBadge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {lane.detail}
                  </div>
                </>
              );
              const className =
                "grid gap-1 rounded-md border border-border bg-muted/25 px-2 py-2 text-left transition hover:bg-muted/60";
              if (lane.id === "stable") {
                return (
                  <div key={lane.id} className={className}>
                    {content}
                  </div>
                );
              }
              return (
                <button
                  key={lane.id}
                  type="button"
                  onClick={() => setMapFocus(lane.id as PropertyMapFocus)}
                  className={className}
                >
                  {content}
                </button>
              );
            })}
          </div>
          {regionRows.length ? (
            <div className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm">
              <div className="font-semibold">Regional focus</div>
              {regionRows.slice(0, 4).map((row) => (
                <div
                  key={row.region}
                  className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{row.region}</span>
                    <StatusBadge
                      tone={row.leaseRiskCount ? "warning" : "neutral"}
                    >
                      {row.count}
                    </StatusBadge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.leaseRiskCount} lease risk · {row.vacancyCount} vacancy
                    focus
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {mapProperties.map((property) => {
            const occupancy = occupancyByPropertyId.get(property.id);
            const expiry = nextExpiryByPropertyId.get(property.id);
            const isSelected = property.id === selectedPropertyId;
            return (
              <button
                key={property.id}
                type="button"
                onClick={() => onSelect(property.id)}
                className={cn(
                  "rounded-md border p-3 text-left transition hover:bg-muted/50",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {property.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {propertyRegionLabel(property) || property.street_address}
                    </div>
                  </div>
                  {occupancy ? (
                    <span className={occupancyBadgeClassName(occupancy.status)}>
                      {occupancyBadgeLabel(occupancy)}
                    </span>
                  ) : null}
                </div>
                {expiry ? (
                  <div className="mt-2">
                    <span
                      className={nextExpiryChipClassName(expiry.daysUntil)}
                      title={`Earliest active lease expires ${expiry.date}.`}
                    >
                      {nextExpiryChipLabel(expiry)}
                    </span>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PropertyCalendarView({
  events,
  isLoading,
}: {
  events: LeaseEventRecord[];
  isLoading: boolean;
}) {
  const [eventKindFilter, setEventKindFilter] = useState<
    "all" | "rent_review" | "lease_expiry"
  >("all");
  const [horizonFilter, setHorizonFilter] =
    useState<CalendarHorizonFilter>("all");
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const kindFilteredEvents = events.filter((event) =>
    eventKindFilter === "all" ? true : event.kind === eventKindFilter,
  );
  const filteredEvents = kindFilteredEvents.filter((event) =>
    calendarHorizonMatches(event, horizonFilter),
  );
  const next30Count = events.filter((event) => {
    const days = calendarEventDaysUntil(event);
    return days >= 0 && days <= 30;
  }).length;
  const next90Count = events.filter((event) => {
    const days = calendarEventDaysUntil(event);
    return days >= 0 && days <= 90;
  }).length;
  const reviewCount = events.filter(
    (event) => event.kind === "rent_review",
  ).length;
  const expiryCount = events.filter(
    (event) => event.kind === "lease_expiry",
  ).length;
  const workloadRows = calendarWorkloadRows(kindFilteredEvents);
  const decisionLanes = calendarDecisionLanes(filteredEvents);
  const reviewRows = calendarReviewRows(filteredEvents);
  const groupedEvents = filteredEvents.reduce<
    Array<{ key: string; events: LeaseEventRecord[] }>
  >((groups, event) => {
    const key = event.date
      ? new Intl.DateTimeFormat("en-AU", {
          month: "long",
          year: "numeric",
        }).format(new Date(`${event.date.slice(0, 10)}T00:00:00`))
      : "No date";
    const existing = groups.find((group) => group.key === key);
    if (existing) {
      existing.events.push(event);
    } else {
      groups.push({ key, events: [event] });
    }
    return groups;
  }, []);
  const copyCalendarBrief = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Clipboard is not available in this browser.");
      return;
    }
    await navigator.clipboard.writeText(calendarPlanningBrief(filteredEvents));
    setCopyReceipt("Calendar brief copied.");
  };
  const copyReviewBrief = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Clipboard is not available in this browser.");
      return;
    }
    await navigator.clipboard.writeText(calendarReviewBrief(reviewRows));
    setCopyReceipt("Review queue copied.");
  };

  if (isLoading) {
    return (
      <div className="rounded-md border border-border bg-white p-6 text-center text-sm text-muted-foreground">
        Updating lease events
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No rent reviews or lease expiries match the current filters.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 rounded-md border border-border bg-white p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="primary">{events.length} events</StatusBadge>
            <StatusBadge tone={next30Count ? "warning" : "neutral"}>
              {next30Count} next 30 days
            </StatusBadge>
            <StatusBadge tone={next90Count ? "primary" : "neutral"}>
              {next90Count} next 90 days
            </StatusBadge>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {(
              [
                { key: "all", label: "All", count: events.length },
                {
                  key: "rent_review",
                  label: "Rent reviews",
                  count: reviewCount,
                },
                {
                  key: "lease_expiry",
                  label: "Lease expiries",
                  count: expiryCount,
                },
              ] as const
            ).map((option) => {
              const isActive = eventKindFilter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setEventKindFilter(option.key)}
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold transition ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-white text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span>{option.label}</span>
                  <span className="rounded-full bg-black/10 px-1.5 text-leasium-micro font-bold">
                    {option.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {calendarHorizonOptions.map((option) => {
              const isActive = horizonFilter === option.key;
              const count = kindFilteredEvents.filter((event) =>
                calendarHorizonMatches(event, option.key),
              ).length;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setHorizonFilter(option.key)}
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold transition ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-white text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span>{option.label}</span>
                  <span className="rounded-full bg-black/10 px-1.5 text-leasium-micro font-bold">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          {copyReceipt ? (
            <p className="text-sm font-medium text-success">{copyReceipt}</p>
          ) : null}
        </div>
        <SecondaryButton type="button" onClick={copyCalendarBrief}>
          <Copy size={15} />
          Copy schedule
        </SecondaryButton>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        {workloadRows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() =>
              setHorizonFilter(
                row.key === "next30"
                  ? "next_30"
                  : row.key === "next90"
                    ? "next_90"
                    : row.key === "overdue"
                      ? "overdue"
                      : "all",
              )
            }
            className="grid gap-1 rounded-md border border-border bg-white p-3 text-left transition hover:bg-muted/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{row.label}</span>
              <StatusBadge tone={row.tone}>{row.count}</StatusBadge>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {row.detail}
            </div>
          </button>
        ))}
      </div>

      <section className="grid gap-3 rounded-md border border-border bg-white p-3 lg:grid-cols-2">
        {decisionLanes.map((lane) => (
          <div key={lane.key} className="grid gap-3 rounded-md bg-muted/30 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={leaseEventTone(lane.key)}>
                    {lane.label}
                  </StatusBadge>
                  <StatusBadge tone={lane.tone}>{lane.count} dates</StatusBadge>
                </div>
                <div className="mt-2 text-sm font-semibold">{lane.action}</div>
              </div>
              {lane.nextEvent ? (
                <Link
                  href={lane.nextEvent.href}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover"
                >
                  Open next
                  <ExternalLink size={13} />
                </Link>
              ) : null}
            </div>
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5">
                <span>Overdue</span>
                <StatusBadge tone={lane.overdueCount ? "danger" : "neutral"}>
                  {lane.overdueCount}
                </StatusBadge>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5">
                <span>Next 30</span>
                <StatusBadge tone={lane.immediateCount ? "warning" : "neutral"}>
                  {lane.immediateCount}
                </StatusBadge>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5">
                <span>31-90</span>
                <StatusBadge tone={lane.planningCount ? "primary" : "neutral"}>
                  {lane.planningCount}
                </StatusBadge>
              </div>
            </div>
            <div className="min-h-10 text-xs text-muted-foreground">
              {lane.nextEvent
                ? `${formatDate(lane.nextEvent.date)} - ${lane.nextEvent.title} - ${
                    lane.nextEvent.chip
                  }`
                : "Switch filters or add lease dates to populate this lane."}
            </div>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-md border border-border bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList size={16} className="text-primary" />
              <h3 className="text-sm font-semibold">Review queue</h3>
              <StatusBadge tone={reviewRows.length ? "primary" : "neutral"}>
                {reviewRows.length} follow-up
                {reviewRows.length === 1 ? "" : "s"}
              </StatusBadge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Converts lease dates into practical review actions for the current
              filters.
            </p>
          </div>
          <SecondaryButton
            type="button"
            onClick={copyReviewBrief}
            disabled={!reviewRows.length}
            className="min-h-9"
          >
            <Copy size={15} />
            Copy follow-ups
          </SecondaryButton>
        </header>
        {reviewRows.length ? (
          <div className="grid gap-2 p-3 lg:grid-cols-3">
            {reviewRows.slice(0, 6).map((row) => (
              <Link
                key={row.id}
                href={row.event.href}
                className="grid min-w-0 gap-2 rounded-md border border-border p-3 text-sm transition hover:bg-muted/50"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="line-clamp-2 break-words font-semibold">
                      {row.event.title}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(row.event.date)} ·{" "}
                      {leaseEventKindLabel(row.event.kind)}
                    </div>
                  </div>
                  <span className="shrink-0">
                    <StatusBadge tone={row.tone}>{row.label}</StatusBadge>
                  </span>
                </div>
                <div className="text-xs font-semibold text-foreground">
                  {row.action}
                </div>
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {row.detail}
                </div>
              </Link>
            ))}
            {reviewRows.length > 6 ? (
              <div className="grid place-items-center rounded-md border border-dashed border-border bg-muted/25 p-3 text-center text-xs text-muted-foreground">
                {reviewRows.length - 6} more follow-up
                {reviewRows.length === 7 ? "" : "s"} in the filtered calendar.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No follow-ups match this calendar filter.
          </div>
        )}
      </section>

      {!filteredEvents.length ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No events match this calendar filter.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groupedEvents.map((group) => (
            <section
              key={group.key}
              className="overflow-hidden rounded-md border border-border bg-white"
            >
              <header className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
                <div className="font-semibold">{group.key}</div>
                <StatusBadge tone="primary">
                  {group.events.length} event
                  {group.events.length === 1 ? "" : "s"}
                </StatusBadge>
              </header>
              <div className="grid gap-2 p-3">
                {group.events.map((event) => (
                  <Link
                    key={event.id}
                    href={event.href}
                    className="grid gap-2 rounded-md border border-border p-3 text-sm transition hover:bg-muted/50 md:grid-cols-[96px_minmax(0,1fr)]"
                  >
                    <div className="font-semibold tabular-nums">
                      {formatDate(event.date)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">
                          {event.title}
                        </span>
                        <StatusBadge tone={leaseEventTone(event.kind)}>
                          {leaseEventKindLabel(event.kind)}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {event.chip}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
