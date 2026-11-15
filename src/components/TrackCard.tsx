import { Check } from "lucide-react";

import type { Track } from "@/lib/apiClient";

import { RecordArt } from "./RecordArt";

type TrackCardProps = {
  track: Track;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

/** One choice in a round. Behaves as a checkbox, so several songs can be picked. */
export function TrackCard({ track, selected, onToggle, disabled }: TrackCardProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onToggle}
      className={`group flex w-full items-center gap-4 rounded-xl border p-3 text-left transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : "border-transparent bg-surface hover:border-border hover:bg-surface-hover"
      } disabled:cursor-wait`}
    >
      <RecordArt artist={track.artist} imageUrl={track.imageUrl} size={52} spinning={selected} />
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
  );
}
