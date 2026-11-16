import { Check } from "lucide-react";

import type { Track } from "@/lib/apiClient";

import { PreviewDisc } from "./PreviewDisc";

type TrackCardProps = {
  track: Track;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

/**
 * One choice in a round. The disc plays a preview; the rest of the card is a
 * checkbox, so several songs can be picked.
 */
export function TrackCard({ track, selected, onToggle, disabled }: TrackCardProps) {
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border p-3 transition-colors ${
        selected ? "border-accent bg-accent/10" : "border-transparent bg-surface hover:border-border hover:bg-surface-hover"
      }`}
    >
      <PreviewDisc track={track} size={52} spinning={selected} eager />
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        disabled={disabled}
        onClick={onToggle}
        className="-my-3 -mr-3 flex min-w-0 flex-1 items-center gap-4 self-stretch rounded-r-xl py-3 pr-3 text-left disabled:cursor-wait"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-text-primary">{track.title}</span>
          <span className="block truncate text-sm text-text-secondary">{track.artist}</span>
        </span>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
            selected ? "border-accent bg-accent text-on-accent" : "border-border"
          }`}
        >
          {selected && <Check size={14} strokeWidth={3} aria-hidden="true" />}
        </span>
      </button>
    </div>
  );
}
