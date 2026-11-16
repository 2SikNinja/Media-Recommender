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
  /** Load the cover right away instead of when it scrolls into view. */
  eager?: boolean;
};

/**
 * A small vinyl record: grooved rings with the album cover as the center label.
 * Covers are usually preloaded (see preloadAlbumArt), so they show straight
 * away. While one is still loading the label is a plain color; only when a song
 * has no cover does it show the artist's initials.
 */
export function RecordArt({ artist, title, imageUrl, size = 56, spinning = false, eager = false }: RecordArtProps) {
  const src = imageUrl ?? albumArtSrc(artist, title);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasCover = failedSrc !== src;

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
        {hasCover ? (
          <img
            src={src}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            onError={() => setFailedSrc(src)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          initialsOf(artist)
        )}
        {/* Spindle hole over the cover, so it still reads as a record. Hidden over initials. */}
        {hasCover && (
          <span className="absolute rounded-full bg-background ring-1 ring-black/40" style={{ width: holeSize, height: holeSize }} />
        )}
      </div>
    </div>
  );
}

/**
 * Loads album covers into the browser cache, so the discs show them as soon as
 * they render. Resolves when every cover has loaded or failed, or after
 * `timeoutMs`, so one slow cover can't hold the page back.
 */
export function preloadAlbumArt(tracks: ReadonlyArray<{ artist: string; title: string; imageUrl?: string | null }>, timeoutMs = 2_500): Promise<void> {
  const loads = tracks.map(
    (track) =>
      new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = track.imageUrl ?? albumArtSrc(track.artist, track.title);
      }),
  );
  return Promise.race([Promise.all(loads).then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}
