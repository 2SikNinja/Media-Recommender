"use client";

import { LoaderCircle, Play, Shuffle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { errorMessage, exportToYoutube, getPlaylist, type Playlist, type YoutubeExport } from "@/lib/apiClient";

import { RecordArt } from "./RecordArt";

type ExportMode = "inOrder" | "shuffled";

export function PlaylistView() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportMode | null>(null);
  const [exportResult, setExportResult] = useState<YoutubeExport | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    getPlaylist(playlistId).then(
      (loaded) => isCurrent && setPlaylist(loaded),
      (error: unknown) => isCurrent && setLoadError(errorMessage(error)),
    );
    return () => {
      isCurrent = false;
    };
  }, [playlistId]);

  async function play(mode: ExportMode) {
    // Open the tab now, while the click still counts as a user action, so popup
    // blockers allow it. It gets its address once the link is ready.
    const popup = window.open("about:blank", "_blank");
    setExporting(mode);
    setExportError(null);
    try {
      const result = await exportToYoutube(playlistId, mode === "shuffled");
      setExportResult(result);
      if (popup) {
        popup.opener = null;
        popup.location.href = result.youtubeMusicUrl ?? result.youtubeUrl;
      }
    } catch (error) {
      popup?.close();
      setExportError(errorMessage(error));
    } finally {
      setExporting(null);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl pt-16">
        <h1 className="font-display text-3xl font-semibold">This playlist can&rsquo;t be opened</h1>
        <p className="mt-3 text-text-secondary">{loadError}</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-accent px-5 py-2.5 font-medium text-on-accent hover:bg-accent-hover">
          Start a new playlist
        </Link>
      </div>
    );
  }

  if (!playlist) {
    return <PlaylistSkeleton />;
  }

  const seedTrack = playlist.tracks[0];

  return (
    <section className="mx-auto w-full max-w-3xl pt-6 sm:pt-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        {seedTrack && <RecordArt artist={seedTrack.artist} imageUrl={null} size={128} />}
        <div className="min-w-0">
          <p className="text-text-secondary">Your playlist, {playlist.tracks.length} songs</p>
          <h1 className="mt-1 font-display text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
            {playlist.title}
          </h1>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void play("inOrder")}
          disabled={exporting !== null}
          aria-busy={exporting === "inOrder"}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-70"
        >
          {exporting === "inOrder" ? (
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Play size={18} fill="currentColor" aria-hidden="true" />
          )}
          {exporting === "inOrder" ? "Finding songs on YouTube…" : "Play on YouTube Music"}
        </button>
        <button
          type="button"
          onClick={() => void play("shuffled")}
          disabled={exporting !== null}
          aria-busy={exporting === "shuffled"}
          className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 font-medium hover:bg-surface disabled:opacity-70"
        >
          {exporting === "shuffled" ? (
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Shuffle size={18} aria-hidden="true" />
          )}
          Shuffle play
        </button>
      </div>

      <div aria-live="polite">
        {exportError && (
          <p role="alert" className="mt-4 text-danger">
            {exportError}
          </p>
        )}
        {exportResult && (
          <div className="mt-5 rounded-xl border border-border p-4 text-sm">
            <p>
              Opened {exportResult.trackCount} songs in a new tab. If nothing opened, use{" "}
              <a href={exportResult.youtubeMusicUrl ?? exportResult.youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-4">
                this link
              </a>
              {exportResult.youtubeMusicUrl ? (
                <>
                  {" "}
                  or{" "}
                  <a href={exportResult.youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-4">
                    open it on YouTube
                  </a>
                </>
              ) : null}
              .{exportResult.youtubeMusicUrl ? " Tap Save in YouTube Music to keep it." : ""}
            </p>
            {exportResult.unresolvedTracks.length > 0 && (
              <div className="mt-3 text-text-secondary">
                <p>
                  {exportResult.unresolvedTracks.length === 1
                    ? "1 song wasn't found on YouTube, so it's not in the queue:"
                    : `${exportResult.unresolvedTracks.length} songs weren't found on YouTube, so they're not in the queue:`}
                </p>
                <ul className="mt-1 list-inside list-disc">
                  {exportResult.unresolvedTracks.map((track) => (
                    <li key={track.position}>
                      {track.title} by {track.artist}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <ol className="mt-10 flex flex-col">
        {playlist.tracks.map((track) => (
          <li key={track.position} className="flex items-center gap-4 border-b border-border/60 py-3 last:border-b-0">
            <span className="w-6 shrink-0 text-right text-sm text-text-secondary tabular-nums">{track.position}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{track.title}</span>
              <span className="block truncate text-sm text-text-secondary">{track.artist}</span>
            </span>
          </li>
        ))}
      </ol>

      <Link href="/" className="mt-10 inline-block rounded-full border border-border px-5 py-2.5 font-medium hover:bg-surface">
        Start a new playlist
      </Link>
    </section>
  );
}

export function PlaylistSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading your playlist" className="mx-auto w-full max-w-3xl pt-6 sm:pt-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="h-32 w-32 shrink-0 rounded-full bg-surface" />
        <div className="h-14 w-2/3 rounded-lg bg-surface" />
      </div>
      <div className="mt-8 h-12 w-80 max-w-full rounded-full bg-surface" />
      <div className="mt-10 flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    </section>
  );
}
