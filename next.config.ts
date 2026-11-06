import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the red Next.js "Issues" badge so it isn't mistaken for an app error
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  // Menu and tab links do not prefetch, so each open uses `dynamic`.
  // 0 means the browser does not reuse the last copy of that screen.
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 30,
    },
  },
  ...(process.env.VANO_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),
};

export default nextConfig;
