import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the red Next.js "Issues" badge so it isn't mistaken for an app error
  devIndicators: false,
};

export default nextConfig;
