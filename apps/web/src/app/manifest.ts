import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Relby",
    short_name: "Relby",
    description: "Review-first automation for lease and tenant workflows.",
    lang: "en-AU",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#edf0f6",
    theme_color: "#245bff",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icons/relby-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/relby-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/relby-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Relby AI",
        short_name: "AI",
        description: "Ask Relby AI with lease and property documents.",
        url: "/intake",
      },
      {
        name: "People",
        short_name: "People",
        description: "Open owners, tenants, vendors, and prospects.",
        url: "/people",
      },
      {
        name: "Money",
        short_name: "Money",
        description: "Open billing, statements, and Xero.",
        url: "/money",
      },
    ],
  };
}
