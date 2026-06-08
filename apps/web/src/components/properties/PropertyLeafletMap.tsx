"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useRef } from "react";

import type { PropertyRecord } from "@/lib/api";
import { propertyMapLocation } from "@/lib/property-map";

export type PropertyMapMarker = {
  property: PropertyRecord;
  // Drives the marker fill so lease-risk / vacancy focus reads at a glance.
  tone: "primary" | "warning" | "danger";
};

type PropertyLeafletMapProps = {
  markers: PropertyMapMarker[];
  selectedPropertyId: string;
  onSelect: (propertyId: string) => void;
};

// Token-aligned marker fills. We build the pin with a divIcon instead of the
// default Leaflet PNG (whose asset path 404s under the bundler) so the marker
// inherits the design-system colours and stays crisp.
const TONE_FILL: Record<PropertyMapMarker["tone"], string> = {
  primary: "var(--color-primary, #2563eb)",
  warning: "var(--color-warning, #d97706)",
  danger: "var(--color-danger, #dc2626)",
};

function markerHtml(tone: PropertyMapMarker["tone"], selected: boolean): string {
  const fill = TONE_FILL[tone];
  const ring = selected ? "var(--color-foreground, #0f172a)" : "#ffffff";
  return `<span style="display:block;width:24px;height:24px;border-radius:9999px;background:${fill};border:3px solid ${ring};box-shadow:0 1px 3px rgba(15,23,42,0.35);"></span>`;
}

// Client-only Leaflet canvas. Loaded through next/dynamic with ssr:false so
// the Leaflet runtime (which touches window/document on import) never runs on
// the server.
export default function PropertyLeafletMap({
  markers,
  selectedPropertyId,
  onSelect,
}: PropertyLeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // Tracks the coordinate set the map is currently framed to, so we only
  // re-fit the view when pins are added or removed — never on an unrelated
  // re-render that would otherwise snap away the operator's pan/zoom.
  const viewSignatureRef = useRef<string>("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) {
      return;
    }
    const map = L.map(container, {
      scrollWheelZoom: false,
      attributionControl: true,
    });
    // Default view roughly centres Australia until fitBounds runs.
    map.setView([-25.2744, 133.7751], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const layer = L.layerGroup().addTo(map);
    const coordinates: L.LatLngTuple[] = [];

    for (const { property, tone } of markers) {
      const location = propertyMapLocation(property);
      if (!location) {
        continue;
      }
      const selected = property.id === selectedPropertyId;
      const icon = L.divIcon({
        className: "leasium-map-pin",
        html: markerHtml(tone, selected),
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const marker = L.marker([location.lat, location.lng], {
        icon,
        title: property.name,
        alt: property.name,
        keyboard: true,
      });
      // keyboard:true makes the marker tabbable and fires click on Enter, so a
      // single click handler covers pointer and keyboard activation.
      marker.on("click", () => onSelectRef.current(property.id));
      marker.addTo(layer);
      const element = marker.getElement();
      if (element) {
        element.setAttribute("aria-label", property.name);
        element.setAttribute("role", "button");
      }
      coordinates.push([location.lat, location.lng]);
    }

    const signature = coordinates
      .map((coordinate) => coordinate.join(","))
      .sort()
      .join("|");
    if (signature !== viewSignatureRef.current) {
      viewSignatureRef.current = signature;
      if (coordinates.length === 1) {
        map.setView(coordinates[0], 13);
      } else if (coordinates.length > 1) {
        map.fitBounds(L.latLngBounds(coordinates), {
          padding: [40, 40],
          maxZoom: 14,
        });
      }
    }

    return () => {
      layer.remove();
    };
  }, [markers, selectedPropertyId]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Property portfolio map"
      className="h-full min-h-[420px] w-full"
    />
  );
}
