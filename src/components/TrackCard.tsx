import { Check } from "lucide-react";

import type { Track } from "@/lib/apiClient";

import { RecordArt } from "./RecordArt";

type TrackCardProps = {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  tabIndex?: number;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef?: (element: HTMLButtonElement | null) => void;
};

/** One choice in a round. Behaves as a radio button inside the round's radio group. */
export function TrackCard({ track, selected, onSelect, disabled, tabIndex, onKeyDown, buttonRef }: TrackCardProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
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
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
          selected ? "border-accent bg-accent text-on-accent" : "border-border"
        }`}
      >
        {selected && <Check size={14} strokeWidth={3} aria-hidden="true" />}
      </span>
    </button>
  );
}
