import type { PropertyRecord } from "@/lib/api";

export type PropertyMapLocation = {
  lat: number;
  lng: number;
  source?: string;
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
  return { lat, lng, source };
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
