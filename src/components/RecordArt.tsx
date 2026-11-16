"use client";

/* eslint-disable @next/next/no-img-element -- Covers come from Deezer's CDN through a redirect; a plain img keeps that simple. */

import { useState } from "react";

/** Center-label colors. Muted so the teal accent stays the only bright color on the page. */
const labelColors = ["#2a6f68", "#6b4f8a", "#8a5a3c", "#3f5f8a", "#7a3f52", "#5a6b3a", "#2f6b8a", "#8a7a3c"];

function hashText(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash;
}

function initialsOf(artist: string): string {
  const words = artist
    .replace(/^the\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]] : [words[0] ?? "?"];
  return letters.map((word) => Array.from(word)[0]?.toUpperCase() ?? "").join("");
}

export function albumArtSrc(artist: string, title: string): string {
  return `/api/art?${new URLSearchParams({ artist, title }).toString()}`;
}

type RecordArtProps = {
  artist: string;
  title: string;
  imageUrl?: string | null;
  size?: number;
  spinning?: boolean;
};

/**
 * A small vinyl record: grooved rings with the album cover as the center label.
 * Until the cover loads, or when there isn't one, the label shows the artist's
 * initials on a color picked from the artist's name.
 */
export function RecordArt({ artist, title, imageUrl, size = 56, spinning = false }: RecordArtProps) {
  const src = imageUrl ?? albumArtSrc(artist, title);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasCover = loadedSrc === src;

  const labelColor = labelColors[hashText(artist.toLowerCase()) % labelColors.length];
  const labelSize = Math.round(size * 0.62);
  const holeSize = Math.max(3, Math.round(size * 0.06));

  return (
    <div
      aria-hidden="true"
      className={`relative shrink-0 rounded-full ${spinning ? "animate-[spin_2.4s_linear_infinite]" : ""}`}
      style={{
        width: size,
        height: size,
        background: "repeating-radial-gradient(circle at center, #131519 0 1.5px, #22262d 1.5px 3px), #131519",
        boxShadow: "inset 0 0 0 1px #2a2e35",
      }}
    >
      <div
        className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full font-display font-semibold text-white/90"
        style={{ width: labelSize, height: labelSize, background: labelColor, fontSize: Math.max(11, Math.round(labelSize * 0.34)) }}
      >
        {initialsOf(artist)}
        {failedSrc !== src && (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setLoadedSrc(src)}
            onError={() => setFailedSrc(src)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              hasCover ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
        {/* Spindle hole over the cover, so it still reads as a record. Hidden over initials. */}
        {hasCover && (
          <span className="absolute rounded-full bg-background ring-1 ring-black/40" style={{ width: holeSize, height: holeSize }} />
        )}
      </div>
    </div>
  );
}
