import type { MetadataRoute } from "next";

/** Lets Pickify be added to a phone's home screen and open like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pickify",
    short_name: "Pickify",
    description: "Start with one song, pick your favorites, and get a playlist to play right away.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0e0f12",
    theme_color: "#0e0f12",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Full-bleed version for Android, which crops icons into circles and other shapes.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
