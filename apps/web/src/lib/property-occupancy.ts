import type { PropertyRecord } from "@/lib/api";

export type PropertyOccupancyStatus =
  | "vacant"
  | "partial"
  | "leased"
  | "leased_internal"
  | "unknown";

export type PropertyOccupancy = {
  status: PropertyOccupancyStatus;
  leasedUnits: number;
  internalLeasedUnits: number;
  totalUnits: number;
};

// Active or holding-over leases count as occupied. Pending/expired/terminated
// don't.
const OCCUPIED_LEASE_STATUSES = new Set(["active", "holding_over"]);

function normaliseName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function internalNameSet(property: PropertyRecord): Set<string> {
  const names: Array<unknown> = [
    property.owner_legal_name,
    property.trustee_name,
    property.trust_name,
    property.invoice_issuer_name,
  ];
  return new Set(
    names.map(normaliseName).filter((value): value is string => Boolean(value)),
  );
}

export type RentRollOccupancyRow = {
  property_id: string;
  tenancy_unit_id: string;
  lease_id: string | null;
  lease_status: string | null;
  tenant_name: string | null;
};

export function propertyOccupancyFromRentRoll(
  property: PropertyRecord,
  rentRollRows: ReadonlyArray<RentRollOccupancyRow>,
): PropertyOccupancy {
  const rows = rentRollRows.filter((row) => row.property_id === property.id);
  if (!rows.length) {
    return {
      status: "unknown",
      leasedUnits: 0,
      internalLeasedUnits: 0,
      totalUnits: 0,
    };
  }
  const internalNames = internalNameSet(property);
  type UnitState = { occupied: boolean; internalCount: number };
  const unitState = new Map<string, UnitState>();
  for (const row of rows) {
    const occupied = Boolean(
      row.lease_id &&
        row.lease_status &&
        OCCUPIED_LEASE_STATUSES.has(row.lease_status),
    );
    const tenantName = normaliseName(row.tenant_name);
    const isInternal = Boolean(
      occupied && tenantName && internalNames.has(tenantName),
    );
    const prev = unitState.get(row.tenancy_unit_id) ?? {
      occupied: false,
      internalCount: 0,
    };
    unitState.set(row.tenancy_unit_id, {
      occupied: prev.occupied || occupied,
      internalCount: prev.internalCount + (isInternal ? 1 : 0),
    });
  }
  const totalUnits = unitState.size;
  const leasedUnits = Array.from(unitState.values()).filter(
    (state) => state.occupied,
  ).length;
  const internalLeasedUnits = Array.from(unitState.values()).filter(
    (state) => state.occupied && state.internalCount > 0,
  ).length;
  if (leasedUnits === 0) {
    return {
      status: "vacant",
      leasedUnits,
      internalLeasedUnits,
      totalUnits,
    };
  }
  if (leasedUnits === totalUnits) {
    if (internalLeasedUnits === totalUnits) {
      return {
        status: "leased_internal",
        leasedUnits,
        internalLeasedUnits,
        totalUnits,
      };
    }
    return {
      status: "leased",
      leasedUnits,
      internalLeasedUnits,
      totalUnits,
    };
  }
  return {
    status: "partial",
    leasedUnits,
    internalLeasedUnits,
    totalUnits,
  };
}

export function occupancyBadgeClassName(status: PropertyOccupancyStatus) {
  switch (status) {
    case "leased":
      return "inline-flex items-center rounded-full border border-success-strong/30 bg-success-soft px-2 py-0.5 text-leasium-micro font-semibold leading-4 text-success-strong";
    case "leased_internal":
      return "inline-flex items-center rounded-full border border-primary/30 bg-primary-soft px-2 py-0.5 text-leasium-micro font-semibold leading-4 text-primary-hover";
    case "vacant":
      return "inline-flex items-center rounded-full border border-danger-strong/30 bg-danger-soft px-2 py-0.5 text-leasium-micro font-semibold leading-4 text-danger-strong";
    case "partial":
      return "inline-flex items-center rounded-full border border-warning-strong/30 bg-warning-soft px-2 py-0.5 text-leasium-micro font-semibold leading-4 text-warning-strong";
    default:
      return "inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-leasium-micro font-semibold leading-4 text-muted-foreground";
  }
}

export function occupancyBadgeLabel(occupancy: PropertyOccupancy) {
  if (occupancy.status === "unknown") {
    return "No units";
  }
  if (occupancy.status === "vacant") {
    return `Vacant · ${occupancy.totalUnits} ${occupancy.totalUnits === 1 ? "unit" : "units"}`;
  }
  if (occupancy.status === "partial") {
    const suffix =
      occupancy.internalLeasedUnits > 0
        ? ` · ${occupancy.internalLeasedUnits} internal`
        : "";
    return `Partial · ${occupancy.leasedUnits} / ${occupancy.totalUnits}${suffix}`;
  }
  if (occupancy.status === "leased_internal") {
    return `Leased internal · ${occupancy.leasedUnits} / ${occupancy.totalUnits}`;
  }
  const suffix =
    occupancy.internalLeasedUnits > 0
      ? ` · ${occupancy.internalLeasedUnits} internal`
      : "";
  return `Leased · ${occupancy.leasedUnits} / ${occupancy.totalUnits}${suffix}`;
}

export type NextLeaseExpiry = {
  date: string;
  daysUntil: number;
  unitId: string;
};

export type PortfolioOccupancyTotals = {
  total: number;
  leased: number;
  leasedInternal: number;
  partial: number;
  vacant: number;
  unknown: number;
};

export function propertyNextExpiryFromRentRoll(
  propertyId: string,
  rentRollRows: ReadonlyArray<
    RentRollOccupancyRow & {
      expiry_date?: string | null;
    }
  >,
  windowDays: number = 120,
  asOf: Date = new Date(),
): NextLeaseExpiry | null {
  let best: NextLeaseExpiry | null = null;
  for (const row of rentRollRows) {
    if (row.property_id !== propertyId) continue;
    if (!row.lease_id || !row.lease_status) continue;
    if (!OCCUPIED_LEASE_STATUSES.has(row.lease_status)) continue;
    const rawDate = row.expiry_date;
    if (typeof rawDate !== "string" || !rawDate) continue;
    const parsed = new Date(`${rawDate.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) continue;
    const daysUntil = Math.round(
      (parsed.getTime() - asOf.getTime()) / 86_400_000,
    );
    if (daysUntil < 0 || daysUntil > windowDays) continue;
    if (!best || daysUntil < best.daysUntil) {
      best = {
        date: rawDate.slice(0, 10),
        daysUntil,
        unitId: row.tenancy_unit_id,
      };
    }
  }
  return best;
}

export function nextExpiryChipClassName(daysUntil: number) {
  if (daysUntil < 30) {
    return "inline-flex items-center rounded-full border border-danger-strong/30 bg-danger-soft px-2 py-0.5 text-leasium-micro font-semibold leading-4 text-danger-strong";
  }
  if (daysUntil < 60) {
    return "inline-flex items-center rounded-full border border-warning-strong/30 bg-warning-soft px-2 py-0.5 text-leasium-micro font-semibold leading-4 text-warning-strong";
  }
  return "inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-leasium-micro font-semibold leading-4 text-muted-foreground";
}

export function nextExpiryChipLabel(expiry: NextLeaseExpiry) {
  if (expiry.daysUntil === 0) {
    return "Expires today";
  }
  if (expiry.daysUntil === 1) {
    return "Expires in 1 day";
  }
  return `Expires in ${expiry.daysUntil} days`;
}

export function portfolioOccupancyTotals(
  occupancies: Iterable<PropertyOccupancy>,
): PortfolioOccupancyTotals {
  const totals: PortfolioOccupancyTotals = {
    total: 0,
    leased: 0,
    leasedInternal: 0,
    partial: 0,
    vacant: 0,
    unknown: 0,
  };
  for (const occupancy of occupancies) {
    totals.total += 1;
    switch (occupancy.status) {
      case "leased":
        totals.leased += 1;
        break;
      case "leased_internal":
        totals.leasedInternal += 1;
        break;
      case "partial":
        totals.partial += 1;
        break;
      case "vacant":
        totals.vacant += 1;
        break;
      default:
        totals.unknown += 1;
    }
  }
  return totals;
}
