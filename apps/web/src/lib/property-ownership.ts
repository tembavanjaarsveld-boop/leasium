import type { PropertyRecord } from "@/lib/api";

export type OwnershipChipPalette =
  | "current"
  | "sky"
  | "teal"
  | "cyan"
  | "lavender"
  | "indigo"
  | "green"
  | "lime"
  | "amber"
  | "rose"
  | "pink"
  | "peach"
  | "slate";

export type OwnershipChip = {
  label: string;
  palette: OwnershipChipPalette;
  tagKey?: string;
  title?: string;
};

export type OwnershipTagProperty = {
  id: string;
  name: string;
  streetAddress: string;
  suburb: string | null;
  state: string | null;
};

export type OwnershipTagSummary = {
  key: string;
  label: string;
  palette: OwnershipChipPalette;
  propertyCount: number;
  properties: OwnershipTagProperty[];
  sources: string[];
};

type OwnerLabelSource = {
  label: string;
  source: string;
};

const ownerChipPaletteCycle: OwnershipChipPalette[] = [
  "teal",
  "indigo",
  "green",
  "rose",
  "cyan",
  "amber",
  "lavender",
  "lime",
  "sky",
  "pink",
  "peach",
];

function metadataTextValue(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normaliseOwnerLabel(value: string) {
  return value.toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();
}

function ownerLabelHash(value: string) {
  let hash = 2166136261;
  for (const char of normaliseOwnerLabel(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function splitOwnershipLabels(value: string | null | undefined) {
  if (!value) {
    return [];
  }
  const cleaned = value
    .replace(/\b\d+(?:\.\d+)?\s*%/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return [];
  }
  return cleaned
    .split(/\s*(?:;|\s\+\s|\s\/\s|\sand\s)\s*/i)
    .map((item) => item.replace(/^[-:]+|[-:]+$/g, "").trim())
    .filter(Boolean);
}

function addUniqueOwnerLabel(
  labels: string[],
  label: string | null | undefined,
) {
  const cleaned = label?.trim();
  if (!cleaned) {
    return;
  }
  if (
    !labels.some(
      (existing) =>
        normaliseOwnerLabel(existing) === normaliseOwnerLabel(cleaned),
    )
  ) {
    labels.push(cleaned);
  }
}

function addOwnerLabelSource(
  entries: OwnerLabelSource[],
  label: string | null | undefined,
  source: string,
) {
  const cleaned = label?.trim();
  if (!cleaned) {
    return;
  }
  const key = normaliseOwnerLabel(cleaned);
  if (
    !entries.some(
      (entry) =>
        normaliseOwnerLabel(entry.label) === key && entry.source === source,
    )
  ) {
    entries.push({ label: cleaned, source });
  }
}

function addUniqueTagSource(sources: string[], source: string) {
  if (!sources.includes(source)) {
    sources.push(source);
  }
}

export function propertyUsesOwnerBilling(
  property: PropertyRecord | null | undefined,
) {
  return ["property_owner", "trust", "split"].includes(
    property?.ownership_structure ?? "current_entity",
  );
}

function propertyOwnerLabelSources(
  property: PropertyRecord,
  currentEntityName?: string | null,
) {
  const entries: OwnerLabelSource[] = [];
  const metadata = property.metadata ?? {};

  if (property.ownership_structure === "split") {
    splitOwnershipLabels(property.ownership_split).forEach((label) =>
      addOwnerLabelSource(entries, label, "Ownership split"),
    );
  }

  addOwnerLabelSource(entries, property.owner_legal_name, "Legal owner");
  addOwnerLabelSource(entries, property.trust_name, "Trust");
  addOwnerLabelSource(
    entries,
    metadataTextValue(metadata, "owning_entity_legal"),
    "Imported legal owner",
  );
  addOwnerLabelSource(
    entries,
    metadataTextValue(metadata, "owning_entity"),
    "Imported owner",
  );

  if (entries.length === 0 && !propertyUsesOwnerBilling(property)) {
    addOwnerLabelSource(
      entries,
      currentEntityName,
      "Current portfolio entity",
    );
  }

  if (entries.length === 0) {
    addOwnerLabelSource(entries, property.invoice_issuer_name, "Invoice issuer");
  }

  return entries;
}

export function propertyOwnerLabels(
  property: PropertyRecord,
  currentEntityName?: string | null,
) {
  const labels: string[] = [];
  for (const entry of propertyOwnerLabelSources(property, currentEntityName)) {
    addUniqueOwnerLabel(labels, entry.label);
  }

  return labels;
}

export function propertyMatchesOwnershipTag(
  property: PropertyRecord,
  currentEntityName: string | null | undefined,
  tagKey: string,
) {
  const normalisedTagKey = normaliseOwnerLabel(tagKey);
  if (!normalisedTagKey) {
    return true;
  }
  const entries = propertyOwnerLabelSources(property, currentEntityName);
  const directoryEntries = entries.length
    ? entries
    : [{ label: "Ownership unknown", source: "Missing ownership data" }];

  return directoryEntries.some(
    (entry) => normaliseOwnerLabel(entry.label) === normalisedTagKey,
  );
}

function ownerPaletteForLabel(
  label: string,
  property: PropertyRecord,
  currentEntityName?: string | null,
  paletteByLabel?: Map<string, OwnershipChipPalette>,
): OwnershipChipPalette {
  if (
    currentEntityName &&
    normaliseOwnerLabel(label) === normaliseOwnerLabel(currentEntityName)
  ) {
    return "current";
  }
  const role = normaliseOwnerLabel(property.ownership_structure ?? "");
  const owner = normaliseOwnerLabel(label);
  if (role.includes("unknown") || owner.includes("unknown")) {
    return "slate";
  }
  const assignedPalette = paletteByLabel?.get(owner);
  if (assignedPalette) {
    return assignedPalette;
  }
  return ownerChipPaletteCycle[
    ownerLabelHash(label) % ownerChipPaletteCycle.length
  ];
}

export function ownershipChipClassName(palette: OwnershipChipPalette) {
  const palettes: Record<OwnershipChipPalette, string> = {
    current: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]",
    sky: "border-[#BAE6FD] bg-[#F0F9FF] text-[#0369A1]",
    teal: "border-[#99F6E4] bg-[#F0FDFA] text-[#0F766E]",
    cyan: "border-[#A5F3FC] bg-[#ECFEFF] text-[#0E7490]",
    lavender: "border-[#DDD6FE] bg-[#F5F3FF] text-[#5B21B6]",
    indigo: "border-[#C7D2FE] bg-[#EEF2FF] text-[#3730A3]",
    green: "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]",
    lime: "border-[#D9F99D] bg-[#F7FEE7] text-[#4D7C0F]",
    amber: "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]",
    rose: "border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C]",
    pink: "border-[#FBCFE8] bg-[#FDF2F8] text-[#BE185D]",
    peach: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]",
    slate: "border-slate-200 bg-slate-100 text-slate-600",
  };
  return palettes[palette];
}

export function propertyOwnershipPaletteMap(
  properties: PropertyRecord[],
  currentEntityName?: string | null,
) {
  const labelsByKey = new Map<string, string>();
  for (const property of properties) {
    for (const label of propertyOwnerLabels(property, currentEntityName)) {
      labelsByKey.set(normaliseOwnerLabel(label), label);
    }
  }

  const assignments = new Map<string, OwnershipChipPalette>();
  const usedPalettes = new Set<OwnershipChipPalette>();
  for (const [key, label] of [...labelsByKey.entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  )) {
    if (currentEntityName && key === normaliseOwnerLabel(currentEntityName)) {
      assignments.set(key, "current");
      continue;
    }

    const startIndex = ownerLabelHash(label) % ownerChipPaletteCycle.length;
    let palette = ownerChipPaletteCycle[startIndex];
    if (usedPalettes.size < ownerChipPaletteCycle.length) {
      for (let offset = 0; offset < ownerChipPaletteCycle.length; offset += 1) {
        const candidate =
          ownerChipPaletteCycle[
            (startIndex + offset) % ownerChipPaletteCycle.length
          ];
        if (!usedPalettes.has(candidate)) {
          palette = candidate;
          break;
        }
      }
    }
    assignments.set(key, palette);
    usedPalettes.add(palette);
  }
  return assignments;
}

export function propertyOwnershipBadges(
  property: PropertyRecord | null | undefined,
  currentEntityName?: string | null,
  paletteByLabel?: Map<string, OwnershipChipPalette>,
) {
  if (!property) {
    return [];
  }
  const labels = propertyOwnerLabels(property, currentEntityName);
  if (labels.length === 0) {
    return [
      {
        label: "Ownership unknown",
        palette: "slate" as const,
      },
    ];
  }

  const visibleLabels = labels.slice(0, 2);
  const badges: OwnershipChip[] = visibleLabels.map((label) => ({
    label,
    palette: ownerPaletteForLabel(
      label,
      property,
      currentEntityName,
      paletteByLabel,
    ),
    tagKey: normaliseOwnerLabel(label),
    title: label,
  }));

  if (labels.length > visibleLabels.length) {
    badges.push({
      label: `+${labels.length - visibleLabels.length}`,
      palette: "slate",
      title: labels.slice(visibleLabels.length).join(", "),
    });
  }

  return badges;
}

export function propertyOwnershipTagDirectory(
  properties: PropertyRecord[],
  currentEntityName?: string | null,
) {
  const paletteByLabel = propertyOwnershipPaletteMap(properties, currentEntityName);
  const tags = new Map<string, OwnershipTagSummary>();

  for (const property of properties) {
    const entries = propertyOwnerLabelSources(property, currentEntityName);
    const directoryEntries = entries.length
      ? entries
      : [{ label: "Ownership unknown", source: "Missing ownership data" }];
    for (const entry of directoryEntries) {
      const key = normaliseOwnerLabel(entry.label);
      const existing = tags.get(key);
      const linkedProperty: OwnershipTagProperty = {
        id: property.id,
        name: property.name,
        streetAddress: property.street_address,
        suburb: property.suburb,
        state: property.state,
      };
      if (existing) {
        if (!existing.properties.some((item) => item.id === property.id)) {
          existing.properties.push(linkedProperty);
          existing.propertyCount += 1;
        }
        addUniqueTagSource(existing.sources, entry.source);
        continue;
      }
      tags.set(key, {
        key,
        label: entry.label,
        palette: paletteByLabel.get(key) ?? "slate",
        propertyCount: 1,
        properties: [linkedProperty],
        sources: [entry.source],
      });
    }
  }

  return [...tags.values()].sort((a, b) => a.label.localeCompare(b.label));
}
