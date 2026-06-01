import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Leasium",
    short_name: "Leasium",
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
    ],
    shortcuts: [
      {
        name: "Smart Intake",
        short_name: "Intake",
        description: "Upload and review lease documents.",
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
        description: "Open billing, statements, Xero, and Basiq.",
        url: "/money",
      },
    ],
  };
}
