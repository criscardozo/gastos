import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully client-rendered app behind a static shell — no server features needed.
  reactStrictMode: true,
};

export default nextConfig;
