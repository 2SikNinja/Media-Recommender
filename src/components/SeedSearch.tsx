"use client";

import { Blend, LoaderCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { createSession, errorMessage, searchTracks, type Track } from "@/lib/apiClient";

import { RecordArt } from "./RecordArt";

const minimumQueryLength = 2;
const searchDelayMs = 300;
const maxSeeds = 3;

const roundOptions = [
  { value: 3, label: "Quick", detail: "3 rounds" },
  { value: 5, label: "Standard", detail: "5 rounds" },
  { value: 8, label: "Deep", detail: "8 rounds" },
] as const;
const sizeOptions = [25, 50, 100] as const;
const roundWords: Record<number, string> = { 3: "three", 5: "five", 8: "eight" };

/** Key for the tray's "Start" button in the busy state. */
const trayKey = "tray";

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
  // Songs set aside to blend into one playlist.
  const [tray, setTray] = useState<Track[]>([]);
  const [rounds, setRounds] = useState<number>(5);
  const [playlistSize, setPlaylistSize] = useState<number>(50);

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

  const trayKeys = new Set(tray.map((track) => track.trackKey));
  const trayIsFull = tray.length >= maxSeeds;

  function addToTray(track: Track) {
    setStartError(null);
    setTray((current) =>
      current.some((item) => item.trackKey === track.trackKey) || current.length >= maxSeeds ? current : [...current, track],
    );
  }

  function removeFromTray(trackKey: string) {
    setTray((current) => current.filter((item) => item.trackKey !== trackKey));
  }

  async function start(seeds: Track[], busyKey: string) {
    setCreatingKey(busyKey);
    setStartError(null);
    try {
      const session = await createSession({
        seeds: seeds.map(({ artist, title }) => ({ artist, title })),
        rounds,
        playlistSize,
      });
      startNavigation(() => {
        setNavigatingKey(busyKey);
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
        Pick your favorites from 10 similar songs, {roundWords[rounds]} times over. Your picks become a {playlistSize}-song
        playlist. Or blend up to three songs to start from.
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

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <Choice
          label="Rounds"
          options={roundOptions.map((option) => ({ value: option.value, label: option.label, title: option.detail }))}
          value={rounds}
          onChange={setRounds}
        />
        <Choice
          label="Playlist"
          options={sizeOptions.map((size) => ({ value: size, label: `${size} songs`, title: `${size}-song playlist` }))}
          value={playlistSize}
          onChange={setPlaylistSize}
        />
      </div>

      {tray.length > 0 && (
        <div className="mt-6 rounded-2xl border border-accent/40 bg-accent/5 p-4">
          <p className="text-sm text-text-secondary">
            Blending {tray.length} of up to {maxSeeds} songs
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {tray.map((track) => (
              <li key={track.trackKey} className="flex items-center gap-2 rounded-full bg-surface py-1 pr-1 pl-1">
                <RecordArt artist={track.artist} title={track.title} imageUrl={track.imageUrl} size={28} />
                <span className="max-w-48 truncate text-sm">{track.title}</span>
                <button
                  type="button"
                  onClick={() => removeFromTray(track.trackKey)}
                  disabled={startingKey !== null}
                  aria-label={`Take ${track.title} out of the blend`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void start(tray, trayKey)}
            disabled={startingKey !== null}
            aria-busy={startingKey === trayKey}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-70"
          >
            {startingKey === trayKey && <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />}
            {startingKey === trayKey
              ? "Finding similar songs…"
              : tray.length === 1
                ? "Start with this song"
                : `Start with these ${tray.length}`}
          </button>
        </div>
      )}

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
              const isInTray = trayKeys.has(track.trackKey);
              // With songs set aside, a result joins the blend instead of starting on its own.
              const addsToBlend = tray.length > 0;
              return (
                <li key={track.trackKey} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (addsToBlend ? addToTray(track) : void start([track], track.trackKey))}
                    disabled={startingKey !== null || (addsToBlend && (isInTray || trayIsFull))}
                    aria-busy={isStarting}
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-xl p-2.5 text-left transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 aria-busy:cursor-wait aria-busy:opacity-100"
                  >
                    <RecordArt artist={track.artist} title={track.title} imageUrl={track.imageUrl} size={44} spinning={isStarting} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{track.title}</span>
                      <span className="block truncate text-sm text-text-secondary">{track.artist}</span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-accent">
                      {isStarting
                        ? "Finding similar songs…"
                        : !addsToBlend
                          ? "Start here"
                          : isInTray
                            ? "In the blend"
                            : trayIsFull
                              ? "Blend is full"
                              : "Add to blend"}
                    </span>
                  </button>
                  {!addsToBlend && (
                    <button
                      type="button"
                      onClick={() => addToTray(track)}
                      disabled={startingKey !== null}
                      title="Blend this with other songs"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-60"
                    >
                      <Blend size={14} aria-hidden="true" />
                      Blend
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

type ChoiceProps = {
  label: string;
  options: ReadonlyArray<{ value: number; label: string; title: string }>;
  value: number;
  onChange: (value: number) => void;
};

/** A small row of mutually exclusive options. */
function Choice({ label, options, value, onChange }: ChoiceProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-2">
      <span className="text-text-secondary">{label}</span>
      <div className="flex rounded-full border border-border p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3 py-1 transition-colors ${
              option.value === value ? "bg-surface-hover text-text-primary" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
