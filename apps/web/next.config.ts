import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  async redirects() {
    return [
      {
        source: "/smart-intake",
        destination: "/intake",
        permanent: true,
      },
      {
        // The operator dashboard lives at the root route.
        source: "/dashboard",
        destination: "/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
