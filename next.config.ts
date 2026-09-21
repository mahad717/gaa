import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export → served by the Cloudflare Worker via Static Assets
  // (single deploy: edge SEO/security layer + frontend, one URL).
  output: "export",
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
