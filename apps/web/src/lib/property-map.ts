import type { PropertyRecord } from "@/lib/api";

export type PropertyMapLocation = {
  lat: number;
  lng: number;
  source?: string;
  precision: "exact" | "approximate";
  label?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Latitude / longitude are only valid inside the geographic envelope. We share
// this with the manual coordinate editor so a saved pin and a typed pin obey
// the same bounds.
export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// Reads metadata.map_location off a property. There are no coordinates in the
// API surface yet, so the only source of truth is the metadata bag. Returns
// null when the property has no usable, in-range coordinate.
export function propertyMapLocation(
  property: PropertyRecord | null | undefined,
): PropertyMapLocation | null {
  const metadata = isRecord(property?.metadata) ? property.metadata : {};
  const raw = metadata.map_location;
  if (!isRecord(raw)) {
    return null;
  }
  const lat = toFiniteNumber(raw.lat);
  const lng = toFiniteNumber(raw.lng);
  if (lat === null || lng === null || !isValidLatLng(lat, lng)) {
    return null;
  }
  const source = typeof raw.source === "string" ? raw.source : undefined;
  return { lat, lng, source, precision: "exact" };
}

type ApproximateLocation = {
  lat: number;
  lng: number;
  label: string;
};

const AU_LOCALITY_CENTROIDS: Record<string, ApproximateLocation> = {
  "qld|4000|brisbane city": {
    lat: -27.4698,
    lng: 153.0251,
    label: "Brisbane City QLD 4000",
  },
  "qld|4006|fortitude valley": {
    lat: -27.4565,
    lng: 153.0345,
    label: "Fortitude Valley QLD 4006",
  },
  "qld|4006|newstead": {
    lat: -27.4526,
    lng: 153.0449,
    label: "Newstead QLD 4006",
  },
  "qld|4105|moorooka": {
    lat: -27.5351,
    lng: 153.0248,
    label: "Moorooka QLD 4105",
  },
  "qld|4110|acacia ridge": {
    lat: -27.586,
    lng: 153.028,
    label: "Acacia Ridge QLD 4110",
  },
  "qld|4500|brendale": {
    lat: -27.322,
    lng: 152.985,
    label: "Brendale QLD 4500",
  },
  "qld|4509|north lakes": {
    lat: -27.241,
    lng: 153.017,
    label: "North Lakes QLD 4509",
  },
};

const AU_POSTCODE_CENTROIDS: Record<string, ApproximateLocation> = {
  "qld|4000": AU_LOCALITY_CENTROIDS["qld|4000|brisbane city"],
  "qld|4006": AU_LOCALITY_CENTROIDS["qld|4006|newstead"],
  "qld|4105": AU_LOCALITY_CENTROIDS["qld|4105|moorooka"],
  "qld|4110": AU_LOCALITY_CENTROIDS["qld|4110|acacia ridge"],
  "qld|4500": AU_LOCALITY_CENTROIDS["qld|4500|brendale"],
  "qld|4509": AU_LOCALITY_CENTROIDS["qld|4509|north lakes"],
};

const AU_TEXT_LOCATION_MATCHES: Array<{
  tokens: string[];
  location: ApproximateLocation;
}> = [
  {
    tokens: ["1642 anzac", "north lakes"],
    location: AU_LOCALITY_CENTROIDS["qld|4509|north lakes"],
  },
  {
    tokens: ["north lakes"],
    location: AU_LOCALITY_CENTROIDS["qld|4509|north lakes"],
  },
  {
    tokens: ["205 leitchs", "brendale"],
    location: AU_LOCALITY_CENTROIDS["qld|4500|brendale"],
  },
  {
    tokens: ["leitchs"],
    location: AU_LOCALITY_CENTROIDS["qld|4500|brendale"],
  },
  {
    tokens: ["brendale"],
    location: AU_LOCALITY_CENTROIDS["qld|4500|brendale"],
  },
];

function normaliseLocationPart(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function approximateLocation(
  property: PropertyRecord | null | undefined,
): PropertyMapLocation | null {
  if (!property || property.country_code !== "AU") {
    return null;
  }
  const state = normaliseLocationPart(property.state);
  const postcode = normaliseLocationPart(property.postcode);
  const suburb = normaliseLocationPart(property.suburb);
  const locality = AU_LOCALITY_CENTROIDS[[state, postcode, suburb].join("|")];
  const postcodeLocation = AU_POSTCODE_CENTROIDS[[state, postcode].join("|")];
  const addressText = [
    property.name,
    property.street_address,
    property.suburb,
    property.state,
    property.postcode,
  ]
    .map(normaliseLocationPart)
    .join(" ");
  const textLocation = AU_TEXT_LOCATION_MATCHES.find((entry) =>
    entry.tokens.every((token) => addressText.includes(token)),
  )?.location;
  const location = locality ?? postcodeLocation ?? textLocation;
  if (!location) {
    return null;
  }
  const offset = approximateOffset([property.id, property.name].join(":"));
  return {
    lat: location.lat + offset.lat,
    lng: location.lng + offset.lng,
    source: "locality_centroid",
    precision: "approximate",
    label: location.label,
  };
}

function approximateOffset(seed: string): { lat: number; lng: number } {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 0.008 + ((hash % 7) * 0.0015);
  return {
    lat: Math.cos(angle) * radius,
    lng: Math.sin(angle) * radius,
  };
}

// Exact manually saved pins remain the source of truth. The fallback keeps the
// map useful for seeded/imported AU portfolios before an operator refines each
// property to an address-level pin, without calling a geocoding provider.
export function propertyMapDisplayLocation(
  property: PropertyRecord | null | undefined,
): PropertyMapLocation | null {
  return propertyMapLocation(property) ?? approximateLocation(property);
}

// Builds a Google Maps search deep link for an unmapped property so the
// operator can look the address up and read coordinates back into the editor.
export function propertyAddressMapsUrl(property: PropertyRecord): string {
  const query = [
    property.street_address,
    property.suburb,
    property.state,
    property.postcode,
  ]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query,
  )}`;
}
