import { Check, ThumbsDown } from "lucide-react";

import type { Track } from "@/lib/apiClient";

import { PreviewDisc } from "./PreviewDisc";

type TrackCardProps = {
  track: Track;
  selected: boolean;
  /** Marked "Not for me": the song and songs like it are pushed down hard. */
  disliked: boolean;
  onToggle: () => void;
  onToggleDislike: () => void;
  disabled?: boolean;
};

/**
 * One choice in a round. The disc plays a preview, the middle of the card is a
 * checkbox (several songs can be picked), and the thumbs-down marks a song the
 * user really doesn't want. Picking a marked song takes the mark off.
 */
export function TrackCard({ track, selected, disliked, onToggle, onToggleDislike, disabled }: TrackCardProps) {
  return (
    <div
      className={`flex min-w-0 items-center gap-4 rounded-xl border p-3 transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : disliked
            ? "border-transparent bg-surface/50"
            : "border-transparent bg-surface hover:border-border hover:bg-surface-hover"
      }`}
    >
      <div className={disliked ? "opacity-40" : undefined}>
        <PreviewDisc track={track} size={52} spinning={selected} eager />
      </div>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        disabled={disabled}
        onClick={onToggle}
        className="-my-3 flex min-w-0 flex-1 items-center gap-4 self-stretch py-3 text-left disabled:cursor-wait"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${disliked ? "text-text-secondary" : "text-text-primary"}`}>
            {track.title}
          </span>
          <span className="block truncate text-sm text-text-secondary">
            {disliked ? "Not for me" : track.artist}
          </span>
        </span>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
            selected ? "border-accent bg-accent text-on-accent" : disliked ? "border-border/50" : "border-border"
          }`}
        >
          {selected && <Check size={14} strokeWidth={3} aria-hidden="true" />}
        </span>
      </button>
      <button
        type="button"
        aria-pressed={disliked}
        aria-label={`Not for me: ${track.title} by ${track.artist}`}
        title={disliked ? "Undo “Not for me”" : "Not for me"}
        disabled={disabled}
        onClick={onToggleDislike}
        className={`-my-1 -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-wait ${
          disliked
            ? "bg-danger/15 text-danger hover:bg-danger/25"
            : "text-text-secondary/60 hover:bg-surface-hover hover:text-text-primary"
        }`}
      >
        <ThumbsDown size={17} aria-hidden="true" fill={disliked ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
