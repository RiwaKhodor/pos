import type { MetadataRoute } from "next";
import { isOwnerWeb } from "@/lib/host";

export default function manifest(): MetadataRoute.Manifest {
  if (isOwnerWeb()) {
    return {
      name: "VANO German Store",
      short_name: "VANO",
      description: "VANO German Store owner app",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: [
        {
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    };
  }

  return {
    name: "POS Owner Dashboard",
    short_name: "POS",
    description: "Owner dashboard for the store point of sale",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#e8e8e8",
    theme_color: "#1e4f88",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
