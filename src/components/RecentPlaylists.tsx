"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import { forgetFromHistory, historySnapshot, parseHistorySnapshot, subscribeToHistory, type HistoryEntry } from "@/lib/history";

import { RecordArt } from "./RecordArt";

const collapsedCount = 5;

function emptySnapshot() {
  return "[]";
}

function whenText(isoTime: string): string {
  const date = new Date(isoTime);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  if (date.getTime() >= startOfToday.getTime()) return "today";
  if (date.getTime() >= startOfToday.getTime() - dayMs) return "yesterday";
  const sameYear = date.getFullYear() === startOfToday.getFullYear();
  return `on ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" })}`;
}

function entryLink(entry: HistoryEntry): string {
  return entry.kind === "playlist" ? `/playlist/${entry.playlistId}` : `/session/${entry.sessionId}`;
}

function entryTitle(entry: HistoryEntry): string {
  return entry.kind === "playlist" ? entry.title : `Inspired by ${entry.seedTitle}`;
}

function entryDetail(entry: HistoryEntry): string {
  if (entry.kind === "playlist") {
    return `${entry.trackCount} ${entry.trackCount === 1 ? "song" : "songs"}, made ${whenText(entry.createdAt)}`;
  }
  return `Unfinished, round ${entry.round} of ${entry.totalRounds}`;
}

/**
 * Playlists made in this browser, newest first, so they can be found again
 * without an account. Renders nothing until there's at least one.
 */
export function RecentPlaylists() {
  // The server has no history, so it renders nothing and the list appears once the page is in the browser.
  const snapshot = useSyncExternalStore(subscribeToHistory, historySnapshot, emptySnapshot);
  const entries = useMemo(() => parseHistorySnapshot(snapshot), [snapshot]);
  const [showAll, setShowAll] = useState(false);

  if (entries.length === 0) return null;
  const visible = showAll ? entries : entries.slice(0, collapsedCount);

  return (
    <section aria-labelledby="recent-heading" className="mx-auto mt-16 w-full max-w-2xl">
      <h2 id="recent-heading" className="font-display text-2xl font-semibold tracking-tight">
        Your playlists
      </h2>
      <p className="mt-1 text-sm text-text-secondary">Saved in this browser only.</p>

      <ul className="mt-4 flex flex-col gap-1">
        {visible.map((entry) => (
          <li key={entry.sessionId} className="group relative flex items-center gap-4 rounded-xl p-2 hover:bg-surface">
            <RecordArt artist={entry.seedArtist} title={entry.seedTitle} size={44} />
            <Link href={entryLink(entry)} className="min-w-0 flex-1 after:absolute after:inset-0 after:rounded-xl">
              <span className="block truncate font-medium">{entryTitle(entry)}</span>
              <span className={`block truncate text-sm ${entry.kind === "session" ? "text-accent" : "text-text-secondary"}`}>
                {entryDetail(entry)}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => forgetFromHistory(entry.sessionId)}
              aria-label={`Remove ${entryTitle(entry)} from this list`}
              title="Remove from this list"
              className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      {entries.length > collapsedCount && (
        <button
          type="button"
          onClick={() => setShowAll((shown) => !shown)}
          className="mt-2 rounded-full px-3 py-2 text-sm text-text-secondary hover:bg-surface hover:text-text-primary"
        >
          {showAll ? "Show fewer" : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  );
}
