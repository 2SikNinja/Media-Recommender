"use client";

import { LoaderCircle, Pause, Play, VolumeX } from "lucide-react";

import { usePreviewPlayer } from "./PreviewPlayer";
import { RecordArt } from "./RecordArt";

type PreviewDiscProps = {
  track: { trackKey: string; artist: string; title: string; imageUrl?: string | null };
  size: number;
  /** Spins the disc even when nothing is playing, e.g. for a picked song. */
  spinning?: boolean;
  eager?: boolean;
};

/**
 * The record art as a play button for the song's 30-second preview. While it
 * plays, the disc spins and a ring around it fills up with the clip's progress.
 */
export function PreviewDisc({ track, size, spinning = false, eager = false }: PreviewDiscProps) {
  const { statusOf, progress, toggle } = usePreviewPlayer();
  const status = statusOf(track.trackKey);
  const isActive = status === "playing" || status === "loading";

  const ringSize = size + 8;
  const radius = ringSize / 2 - 1.5;
  const circumference = 2 * Math.PI * radius;
  const iconSize = Math.max(14, Math.round(size * 0.32));

  const label =
    status === "unavailable"
      ? `No preview for ${track.title} by ${track.artist}`
      : isActive
        ? `Stop preview of ${track.title}`
        : `Play preview of ${track.title} by ${track.artist}`;

  return (
    <button
      type="button"
      onClick={() => toggle(track)}
      disabled={status === "unavailable"}
      aria-label={label}
      title={status === "unavailable" ? "No preview available" : undefined}
      className="group/disc relative shrink-0 rounded-full disabled:cursor-not-allowed"
      style={{ width: size, height: size }}
    >
      <RecordArt
        artist={track.artist}
        title={track.title}
        imageUrl={track.imageUrl}
        size={size}
        spinning={spinning || status === "playing"}
        eager={eager}
      />

      {isActive && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute -rotate-90"
          width={ringSize}
          height={ringSize}
          style={{ top: -4, left: -4 }}
        >
          <circle cx={ringSize / 2} cy={ringSize / 2} r={radius} fill="none" strokeWidth={2} className="stroke-border" />
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - (status === "playing" ? progress : 0))}
            className="stroke-accent transition-[stroke-dashoffset] duration-300 ease-linear"
          />
        </svg>
      )}

      <span
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white transition-opacity ${
          isActive ? "opacity-100" : "opacity-0 group-hover/disc:opacity-100 group-focus-visible/disc:opacity-100"
        } ${status === "unavailable" ? "text-white/60" : ""}`}
      >
        {status === "loading" && <LoaderCircle size={iconSize} className="animate-spin" />}
        {status === "playing" && <Pause size={iconSize} fill="currentColor" />}
        {status === "idle" && <Play size={iconSize} fill="currentColor" className="translate-x-[1px]" />}
        {status === "unavailable" && <VolumeX size={iconSize} />}
      </span>

      {/* A small play badge, so the disc reads as playable without hovering (and on touch screens). */}
      {status === "idle" && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -bottom-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-background text-text-primary transition-opacity group-hover/disc:opacity-0"
        >
          <Play size={9} fill="currentColor" className="translate-x-[0.5px]" />
        </span>
      )}
    </button>
  );
}
