import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/smart-intake",
        destination: "/intake",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
