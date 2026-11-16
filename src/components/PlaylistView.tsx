"use client";

import { LoaderCircle, Play, RotateCcw, Shuffle, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  errorMessage,
  exportToYoutube,
  getPlaylist,
  setTrackRemoved,
  type Playlist,
  type YoutubeExport,
} from "@/lib/apiClient";
import { saveToHistory } from "@/lib/history";

import { PreviewDisc } from "./PreviewDisc";
import { PreviewPlayerProvider, usePreviewPlayer } from "./PreviewPlayer";
import { preloadAlbumArt } from "./RecordArt";

type ExportMode = "inOrder" | "shuffled";
type PlaylistTrack = Playlist["tracks"][number];

/** Moves songs between the playing list and the removed list, keeping both in playlist order. */
function withTrackRemoved(playlist: Playlist, track: PlaylistTrack, removed: boolean): Playlist {
  const byPosition = (a: PlaylistTrack, b: PlaylistTrack) => a.position - b.position;
  const others = (list: PlaylistTrack[]) => list.filter((item) => item.position !== track.position);
  return {
    ...playlist,
    tracks: removed ? others(playlist.tracks) : [...playlist.tracks, track].sort(byPosition),
    removedTracks: removed ? [...playlist.removedTracks, track].sort(byPosition) : others(playlist.removedTracks),
  };
}

/** About how many rows fit on a tall screen, plus the seed's large disc. */
const firstScreenTrackCount = 12;
const toastSeconds = 6;

export function PlaylistView() {
  return (
    <PreviewPlayerProvider>
      <PlaylistViewContent />
    </PreviewPlayerProvider>
  );
}

function PlaylistViewContent() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportMode | null>(null);
  const [exportResult, setExportResult] = useState<YoutubeExport | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [lastRemoved, setLastRemoved] = useState<PlaylistTrack | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const { stop: stopPreview } = usePreviewPlayer();

  useEffect(() => {
    let isCurrent = true;
    getPlaylist(playlistId).then(
      async (loaded) => {
        // Covers for the songs visible on arrival load before the list shows;
        // the rest load as they scroll into view.
        await preloadAlbumArt(loaded.tracks.slice(0, firstScreenTrackCount));
        if (isCurrent) setPlaylist(loaded);
      },
      (error: unknown) => isCurrent && setLoadError(errorMessage(error)),
    );
    return () => {
      isCurrent = false;
    };
  }, [playlistId]);

  async function play(mode: ExportMode) {
    stopPreview();
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

  // Remember the playlist, so it can be found again from the home page.
  useEffect(() => {
    if (!playlist) return;
    const seed = [...playlist.tracks, ...playlist.removedTracks].sort((a, b) => a.position - b.position)[0];
    saveToHistory({
      kind: "playlist",
      sessionId: playlist.sessionId,
      playlistId: playlist.playlistId,
      title: playlist.title,
      trackCount: playlist.tracks.length,
      createdAt: playlist.createdAt,
      seedArtist: seed?.artist ?? "",
      seedTitle: seed?.title ?? "",
      updatedAt: new Date().toISOString(),
    });
  }, [playlist]);

  // The undo prompt and edit errors go away on their own after a few seconds.
  useEffect(() => {
    if (!lastRemoved && !editError) return;
    const timer = setTimeout(() => {
      setLastRemoved(null);
      setEditError(null);
    }, toastSeconds * 1000);
    return () => clearTimeout(timer);
  }, [lastRemoved, editError]);

  async function changeTrack(track: PlaylistTrack, removed: boolean) {
    if (!playlist) return;
    const previous = playlist;
    // Show the change right away; the server's answer replaces it, or it's undone on failure.
    setPlaylist(withTrackRemoved(playlist, track, removed));
    setLastRemoved(removed ? track : null);
    setEditError(null);
    // The YouTube links no longer match the playlist.
    setExportResult(null);
    try {
      setPlaylist(await setTrackRemoved(playlistId, track.position, removed));
    } catch (error) {
      setPlaylist(previous);
      setLastRemoved(null);
      setEditError(errorMessage(error));
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

  // The seed is always the first song, even if it was taken out of the list.
  const seedTrack = [...playlist.tracks, ...playlist.removedTracks].sort((a, b) => a.position - b.position)[0];
  const canRemove = playlist.tracks.length > 1 && exporting === null;

  return (
    <section className="mx-auto w-full max-w-3xl pt-6 pb-20 sm:pt-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        {seedTrack && <PreviewDisc track={seedTrack} size={128} eager />}
        <div className="min-w-0">
          <p className="text-text-secondary">
            Your playlist, {playlist.tracks.length} {playlist.tracks.length === 1 ? "song" : "songs"}
          </p>
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
        {playlist.tracks.map((track, index) => (
          <li key={track.position} className="group flex items-center gap-4 border-b border-border/60 py-3 last:border-b-0">
            <span className="w-6 shrink-0 text-right text-sm text-text-secondary tabular-nums">{index + 1}</span>
            <PreviewDisc track={track} size={40} eager={index < firstScreenTrackCount} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{track.title}</span>
              <span className="block truncate text-sm text-text-secondary">{track.artist}</span>
            </span>
            {canRemove && (
              <button
                type="button"
                onClick={() => void changeTrack(track, true)}
                aria-label={`Remove ${track.title} by ${track.artist}`}
                title="Remove from playlist"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface hover:text-text-primary focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ol>

      {playlist.removedTracks.length > 0 && (
        <div className="mt-6 rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setShowRemoved((shown) => !shown)}
            aria-expanded={showRemoved}
            className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm text-text-secondary hover:text-text-primary"
          >
            <span>
              {playlist.removedTracks.length === 1 ? "1 song removed" : `${playlist.removedTracks.length} songs removed`}
            </span>
            <span className="text-accent">{showRemoved ? "Hide" : "Show"}</span>
          </button>
          {showRemoved && (
            <ul className="border-t border-border px-4">
              {playlist.removedTracks.map((track) => (
                <li key={track.position} className="flex items-center gap-4 border-b border-border/60 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate text-text-primary">{track.title}</span>
                    <span className="block truncate text-text-secondary">{track.artist}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void changeTrack(track, false)}
                    disabled={exporting !== null}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50"
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    Put back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-10 flex justify-center px-5">
        {editError ? (
          <p role="alert" className="pointer-events-auto rounded-full border border-border bg-surface px-5 py-3 text-sm text-danger shadow-lg">
            {editError}
          </p>
        ) : lastRemoved ? (
          <div className="pointer-events-auto flex max-w-full items-center gap-4 rounded-full border border-border bg-surface py-2 pr-2 pl-5 text-sm shadow-lg">
            <span className="min-w-0 truncate">
              Removed <span className="text-text-primary">{lastRemoved.title}</span>
            </span>
            <button
              type="button"
              onClick={() => void changeTrack(lastRemoved, false)}
              className="shrink-0 rounded-full px-3 py-1.5 font-medium text-accent hover:bg-surface-hover"
            >
              Undo
            </button>
          </div>
        ) : null}
      </div>

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
