"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, MapPin, Plus, X } from "lucide-react";
import { useState } from "react";

import { Input, SecondaryButton, StatusBadge } from "@/components/ui";
import { updateProperty, type PropertyRecord } from "@/lib/api";
import { isValidLatLng, propertyAddressMapsUrl } from "@/lib/property-map";

type PropertyMapUnmappedPanelProps = {
  entityId: string | null;
  properties: PropertyRecord[];
};

function regionLabel(property: PropertyRecord): string {
  return (
    [property.suburb, property.state, property.postcode]
      .filter(Boolean)
      .join(" ") || property.street_address
  );
}

// Lists portfolio properties that have no exact map_location yet. Each row
// carries a Google Maps lookup link plus an inline editor that writes a manual
// pin back into property metadata. The PATCH replaces metadata wholesale on the
// backend, so every save spreads the property's existing metadata first.
export function PropertyMapUnmappedPanel({
  entityId,
  properties,
}: PropertyMapUnmappedPanelProps) {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const saveLocation = useMutation({
    mutationFn: ({
      property,
      lat,
      lng,
    }: {
      property: PropertyRecord;
      lat: number;
      lng: number;
    }) =>
      updateProperty(property.id, {
        metadata: {
          ...property.metadata,
          map_location: { lat, lng, source: "manual" },
        },
      }),
    onSuccess: (property) => {
      setOpenId(null);
      setLatInput("");
      setLngInput("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["property", property.id] });
    },
  });

  if (!properties.length) {
    return null;
  }

  const openEditor = (property: PropertyRecord) => {
    setOpenId(property.id);
    setLatInput("");
    setLngInput("");
    setError(null);
  };

  const submit = (property: PropertyRecord) => {
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (!latInput.trim() || !lngInput.trim() || Number.isNaN(lat) || Number.isNaN(lng)) {
      setError("Enter a latitude and longitude.");
      return;
    }
    if (!isValidLatLng(lat, lng)) {
      setError("Latitude must be -90 to 90 and longitude -180 to 180.");
      return;
    }
    setError(null);
    saveLocation.mutate({ property, lat, lng });
  };

  return (
    <section className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">Needs exact pin</div>
        <StatusBadge tone="warning">{properties.length}</StatusBadge>
      </div>
      <p className="text-xs text-muted-foreground">
        Approximate pins use local suburb or postcode data when available. Look
        the address up, then save a precise pin locally on the property.
      </p>
      <ul className="grid gap-2">
        {properties.map((property) => {
          const isOpen = openId === property.id;
          const isSaving =
            saveLocation.isPending &&
            saveLocation.variables?.property.id === property.id;
          return (
            <li
              key={property.id}
              className="grid gap-2 rounded-md border border-border bg-muted/25 p-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{property.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {regionLabel(property)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={propertyAddressMapsUrl(property)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-white px-3 text-xs font-semibold text-primary transition hover:bg-primary/10"
                  >
                    Google Maps
                    <ExternalLink size={13} />
                  </a>
                  {isOpen ? (
                    <SecondaryButton
                      type="button"
                      onClick={() => {
                        setOpenId(null);
                        setError(null);
                      }}
                      aria-label={`Cancel location for ${property.name}`}
                    >
                      <X size={15} />
                      Cancel
                    </SecondaryButton>
                  ) : (
                    <SecondaryButton
                      type="button"
                      onClick={() => openEditor(property)}
                      aria-label={`Set location for ${property.name}`}
                    >
                      <MapPin size={15} />
                      Set location
                    </SecondaryButton>
                  )}
                </div>
              </div>
              {isOpen ? (
                <div className="grid gap-2 rounded-md border border-border bg-white p-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <label className="grid gap-1 text-xs font-medium">
                    Latitude
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={latInput}
                      onChange={(event) => setLatInput(event.target.value)}
                      aria-label={`Latitude for ${property.name}`}
                      placeholder="-27.4698"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium">
                    Longitude
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={lngInput}
                      onChange={(event) => setLngInput(event.target.value)}
                      aria-label={`Longitude for ${property.name}`}
                      placeholder="153.0251"
                    />
                  </label>
                  <SecondaryButton
                    type="button"
                    onClick={() => submit(property)}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Plus size={15} />
                    )}
                    Save pin
                  </SecondaryButton>
                  {error ? (
                    <p className="text-xs font-medium text-danger sm:col-span-3">
                      {error}
                    </p>
                  ) : null}
                  {saveLocation.isError ? (
                    <p className="text-xs font-medium text-danger sm:col-span-3">
                      Could not save the pin. Try again.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
