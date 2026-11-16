"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { createSession, errorMessage, searchTracks, type Track } from "@/lib/apiClient";

import { RecordArt } from "./RecordArt";

const minimumQueryLength = 2;
const searchDelayMs = 300;

type SearchResult = { forQuery: string; tracks: Track[] } | { forQuery: string; error: string };

export function SeedSearch() {
  const router = useRouter();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Navigation runs in a transition so its busy state ends when the next page
  // shows. Next.js keeps this page alive in the background, so anything still
  // marked busy here would come back as a stuck spinner on Back.
  const [isNavigating, startNavigation] = useTransition();
  const [navigatingKey, setNavigatingKey] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const isLongEnough = trimmedQuery.length >= minimumQueryLength;

  useEffect(() => {
    if (!isLongEnough) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchTracks(trimmedQuery, controller.signal)
        .then(({ tracks }) => setResult({ forQuery: trimmedQuery, tracks }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setResult({ forQuery: trimmedQuery, error: errorMessage(error) });
        });
    }, searchDelayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedQuery, isLongEnough]);

  // Only show results that belong to what's in the box right now.
  const currentResult = isLongEnough && result?.forQuery === trimmedQuery ? result : null;
  const isSearching = isLongEnough && !currentResult;

  const startingKey = creatingKey ?? (isNavigating ? navigatingKey : null);

  async function start(track: Track) {
    setCreatingKey(track.trackKey);
    setStartError(null);
    try {
      const session = await createSession({ artist: track.artist, title: track.title });
      startNavigation(() => {
        setNavigatingKey(track.trackKey);
        setCreatingKey(null);
        router.push(`/session/${session.sessionId}`);
      });
    } catch (error) {
      setStartError(errorMessage(error));
      setCreatingKey(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl pt-10 sm:pt-20">
      <h1 className="font-display text-5xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-7xl">
        Start with one song.
      </h1>
      <p className="mt-5 max-w-xl text-lg text-pretty text-text-secondary">
        Pick your favorites from 10 similar songs, five times over. Your picks become a 50-song playlist you can play on
        YouTube Music.
      </p>

      <div className="mt-10">
        <label htmlFor={inputId} className="sr-only">
          Search for a song
        </label>
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
          {isSearching ? (
            <LoaderCircle size={20} className="shrink-0 animate-spin text-text-secondary" aria-hidden="true" />
          ) : (
            <Search size={20} className="shrink-0 text-text-secondary" aria-hidden="true" />
          )}
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Song title, like Midnight City"
            autoComplete="off"
            spellCheck={false}
            className="h-14 w-full bg-transparent text-lg text-text-primary placeholder:text-text-secondary/70 focus-visible:outline-none"
          />
        </div>
      </div>

      {startError && (
        <p role="alert" className="mt-4 text-danger">
          {startError}
        </p>
      )}

      <div aria-live="polite" className="mt-4">
        {currentResult && "error" in currentResult && (
          <p role="alert" className="text-danger">
            {currentResult.error}
          </p>
        )}

        {currentResult && "tracks" in currentResult && currentResult.tracks.length === 0 && (
          <p className="text-text-secondary">
            No songs match &ldquo;{currentResult.forQuery}&rdquo;. Check the spelling or try fewer words.
          </p>
        )}

        {currentResult && "tracks" in currentResult && currentResult.tracks.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {currentResult.tracks.map((track) => {
              const isStarting = startingKey === track.trackKey;
              return (
                <li key={track.trackKey}>
                  <button
                    type="button"
                    onClick={() => start(track)}
                    disabled={startingKey !== null}
                    aria-busy={isStarting}
                    className="flex w-full items-center gap-4 rounded-xl p-2.5 text-left transition-colors hover:bg-surface disabled:cursor-wait disabled:opacity-60 aria-busy:opacity-100"
                  >
                    <RecordArt artist={track.artist} title={track.title} imageUrl={track.imageUrl} size={44} spinning={isStarting} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{track.title}</span>
                      <span className="block truncate text-sm text-text-secondary">{track.artist}</span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-accent">
                      {isStarting ? "Finding similar songs…" : "Start here"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
