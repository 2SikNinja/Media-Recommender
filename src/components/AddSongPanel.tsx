"use client";

import { LoaderCircle, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { addTrackToPlaylist, errorMessage, searchTracks, type Playlist, type Track } from "@/lib/apiClient";

import { RecordArt } from "./RecordArt";

const searchDelayMs = 300;
const maxResults = 5;

/**
 * "Add a song": a search box under the playlist. Each result has an Add button
 * that puts the song at the end of the playlist. Stays open for adding more.
 */
export function AddSongPanel({ playlistId, onAdded }: { playlistId: string; onAdded: (playlist: Playlist) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The last finished search. Results only show while they match what's typed.
  const [found, setFound] = useState<{ query: string; tracks: Track[] }>({ query: "", tracks: [] });
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const trimmed = query.trim();
  const canSearch = trimmed.length >= 2;
  const results = canSearch && found.query === trimmed ? found.tracks : [];
  const searching = canSearch && found.query !== trimmed;

  useEffect(() => {
    if (!canSearch) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchTracks(trimmed, controller.signal).then(
        ({ tracks }) => setFound({ query: trimmed, tracks: tracks.slice(0, maxResults) }),
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setFound({ query: trimmed, tracks: [] });
          setMessage({ text: errorMessage(error), isError: true });
        },
      );
    }, searchDelayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, canSearch]);

  async function add(track: Track) {
    setAddingKey(track.trackKey);
    setMessage(null);
    try {
      onAdded(await addTrackToPlaylist(playlistId, { artist: track.artist, title: track.title }));
      setMessage({ text: `Added ${track.title} to the end.`, isError: false });
      setQuery("");
      inputRef.current?.focus();
    } catch (error) {
      setMessage({ text: errorMessage(error), isError: true });
    } finally {
      setAddingKey(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-accent hover:bg-surface"
      >
        <Plus size={16} aria-hidden="true" />
        Add a song
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search for a song to add</span>
          <Search size={18} aria-hidden="true" className="absolute top-1/2 left-3.5 -translate-y-1/2 text-text-secondary" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
            placeholder="Search for a song to add"
            aria-controls={resultsId}
            autoComplete="off"
            className="w-full rounded-full border border-border bg-surface py-2.5 pr-4 pl-10 text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close song search"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface hover:text-text-primary"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <ul id={resultsId} aria-busy={searching} className="mt-2">
        {results.map((track) => (
          <li key={track.trackKey} className="flex items-center gap-3 py-2">
            <RecordArt artist={track.artist} title={track.title} imageUrl={track.imageUrl} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{track.title}</span>
              <span className="block truncate text-sm text-text-secondary">{track.artist}</span>
            </span>
            <button
              type="button"
              onClick={() => void add(track)}
              disabled={addingKey !== null}
              aria-label={`Add ${track.title} by ${track.artist}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface disabled:opacity-60"
            >
              {addingKey === track.trackKey ? (
                <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus size={14} aria-hidden="true" />
              )}
              Add
            </button>
          </li>
        ))}
      </ul>
      {searching && results.length === 0 && <p className="py-2 text-sm text-text-secondary">Searching&hellip;</p>}
      {!searching && canSearch && results.length === 0 && !message?.isError && (
        <p className="py-2 text-sm text-text-secondary">No songs found. Try the title and artist.</p>
      )}
      <p aria-live="polite" className={`text-sm ${message?.isError ? "text-danger" : "text-text-secondary"}`}>
        {message?.text}
      </p>
    </div>
  );
}
