"use client";

import { Volume1, Volume2, VolumeX } from "lucide-react";
import type { CSSProperties } from "react";

import { setVolume, useVolume } from "@/lib/volume";

type VolumeControlProps = {
  /** "compact" for the header; "wide" for the player, where the slider fills the row. */
  variant?: "compact" | "wide";
  className?: string;
};

/**
 * Mute button and volume slider for everything Pickify plays. The slider only
 * shows on devices with a mouse: phones use their volume buttons, and iPhones
 * don't let websites change the volume at all.
 */
export function VolumeControl({ variant = "compact", className = "" }: VolumeControlProps) {
  const volume = useVolume();
  const percent = Math.round(volume.level * 100);
  const isSilent = volume.muted || percent === 0;
  const Icon = isSilent ? VolumeX : percent < 50 ? Volume1 : Volume2;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => setVolume(isSilent && percent === 0 ? { level: 0.5, muted: false } : { muted: !volume.muted })}
        aria-label={isSilent ? "Unmute" : "Mute"}
        aria-pressed={volume.muted}
        title={isSilent ? "Unmute" : "Mute"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text-primary"
      >
        <Icon size={18} aria-hidden="true" />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={volume.muted ? 0 : percent}
        onChange={(event) => setVolume({ level: Number(event.target.value) / 100 })}
        aria-label="Volume"
        aria-valuetext={volume.muted ? "Muted" : `${percent}%`}
        style={{ "--fill": `${volume.muted ? 0 : percent}%` } as CSSProperties}
        className={`volume-slider hidden [@media(hover:hover)_and_(pointer:fine)]:block ${variant === "wide" ? "w-full" : "w-24"}`}
      />
    </div>
  );
}
