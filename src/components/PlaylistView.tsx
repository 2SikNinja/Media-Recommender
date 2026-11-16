"use client";

import { AudioLines, ExternalLink, LoaderCircle, Play, RotateCcw, Shuffle, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  errorMessage,
  getPlaylist,
  setTrackRemoved,
  type Playlist,
  type YoutubeExport,
  type YoutubeQueue,
} from "@/lib/apiClient";
import { saveToHistory } from "@/lib/history";

import { PagePlayerProvider, PlayerDock, usePagePlayer, type QueueItem } from "./PagePlayer";
import { PreviewDisc } from "./PreviewDisc";
import { PreviewPlayerProvider, usePreviewPlayer } from "./PreviewPlayer";
import { ShareButton } from "./ShareButton";
import { preloadAlbumArt } from "./RecordArt";
import { usePreparedYoutubeLinks } from "./usePreparedYoutubeLinks";

type ExportMode = "inOrder" | "shuffled";
type PlaylistTrack = Playlist["tracks"][number];

/** YouTube Music when YouTube gave us a queue for it, otherwise regular YouTube. */
function queueUrl(queue: YoutubeQueue): string {
  return queue.youtubeMusicUrl ?? queue.youtubeUrl;
}

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
    <PagePlayerProvider>
      <PreviewWithPagePlayer>
        <PlaylistViewContent />
      </PreviewWithPagePlayer>
    </PagePlayerProvider>
  );
}

/** Starting a 30-second preview pauses the page player, so they never play over each other. */
function PreviewWithPagePlayer({ children }: { children: ReactNode }) {
  const { pause } = usePagePlayer();
  return <PreviewPlayerProvider onStart={pause}>{children}</PreviewPlayerProvider>;
}

/** Fisher-Yates shuffle, without changing the original. */
function shuffledCopy<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function PlaylistViewContent() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set while a tap waits for links that weren't ready yet.
  const [waiting, setWaiting] = useState<ExportMode | null>(null);
  // The links last opened, for the note under the buttons.
  const [opened, setOpened] = useState<{ mode: ExportMode; links: YoutubeExport } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [lastRemoved, setLastRemoved] = useState<PlaylistTrack | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const { stop: stopPreview } = usePreviewPlayer();
  const tracksKey = playlist ? playlist.tracks.map((track) => track.position).join(",") : null;
  const { ready: youtubeLinks, getLinks } = usePreparedYoutubeLinks(playlistId, tracksKey);
  const pagePlayer = usePagePlayer();
  // Set while a tap to play on the page waits for the songs to be found on YouTube.
  const [waitingOnPage, setWaitingOnPage] = useState<ExportMode | null>(null);

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

  /** The playlist's songs that YouTube has a video for, in playlist order. */
  function queueFrom(links: YoutubeExport): QueueItem[] {
    const trackByPosition = new Map(playlist?.tracks.map((track) => [track.position, track]));
    return links.queue.flatMap(({ position, videoId }) => {
      const track = trackByPosition.get(position);
      return track ? [{ position, videoId, title: track.title, artist: track.artist }] : [];
    });
  }

  /** Plays on the page, in order or shuffled, or from one song onwards. */
  async function playOnPage(mode: ExportMode, fromPosition?: number) {
    stopPreview();
    setExportError(null);
    setWaitingOnPage(mode);
    try {
      const queue = queueFrom(youtubeLinks ?? (await getLinks()));
      if (queue.length === 0) throw new Error("None of these songs can be played right now.");
      if (mode === "shuffled") {
        pagePlayer.play(shuffledCopy(queue), { shuffled: true });
      } else {
        const startIndex = fromPosition === undefined ? 0 : queue.findIndex((item) => item.position === fromPosition);
        pagePlayer.play(queue, { startIndex: Math.max(0, startIndex) });
      }
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setWaitingOnPage(null);
    }
  }

  /** The links are ready, so the button is a plain link: note what was opened. */
  function onOpened(mode: ExportMode, links: YoutubeExport) {
    stopPreview();
    setExportError(null);
    setOpened({ mode, links });
  }

  /** Tapped before the links were ready: open a tab now and fill it in when they arrive. */
  async function playWhenReady(mode: ExportMode) {
    stopPreview();
    // Open the tab during the tap, while it still counts as a user action, so
    // popup blockers allow it.
    const popup = window.open("about:blank", "_blank");
    setWaiting(mode);
    setExportError(null);
    try {
      const links = await getLinks();
      setOpened({ mode, links });
      if (popup) {
        popup.opener = null;
        popup.location.href = queueUrl(links[mode]);
      }
    } catch (error) {
      popup?.close();
      setExportError(errorMessage(error));
    } finally {
      setWaiting(null);
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
    // The links being opened no longer match; new ones are prepared once edits settle.
    setOpened(null);
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
  const canRemove = playlist.tracks.length > 1 && waiting === null;
  const nowPlayingPosition = pagePlayer.queue?.[pagePlayer.currentIndex]?.position ?? null;
  const playablePositions = youtubeLinks ? new Set(youtubeLinks.queue.map((item) => item.position)) : null;
  const playerOpen = pagePlayer.queue !== null;
  const pageButton = "inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium disabled:opacity-70";

  return (
    <section className={`mx-auto w-full max-w-3xl pt-6 sm:pt-10 ${playerOpen ? "pb-[24rem] sm:pb-20" : "pb-20"}`}>
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
          onClick={() => void playOnPage("inOrder")}
          disabled={waitingOnPage !== null}
          aria-busy={waitingOnPage === "inOrder"}
          className={`${pageButton} bg-accent text-on-accent hover:bg-accent-hover`}
        >
          {waitingOnPage === "inOrder" ? (
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Play size={18} fill="currentColor" aria-hidden="true" />
          )}
          {waitingOnPage === "inOrder" ? "Finding songs on YouTube…" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => void playOnPage("shuffled")}
          disabled={waitingOnPage !== null}
          aria-busy={waitingOnPage === "shuffled"}
          className={`${pageButton} border border-border hover:bg-surface`}
        >
          {waitingOnPage === "shuffled" ? (
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Shuffle size={18} aria-hidden="true" />
          )}
          Shuffle
        </button>
        <PlayControl
          mode="inOrder"
          links={youtubeLinks}
          waiting={waiting}
          onOpened={onOpened}
          onPlayWhenReady={playWhenReady}
          className="border border-border hover:bg-surface"
          icon={<ExternalLink size={18} aria-hidden="true" />}
          label="Open in YouTube Music"
          waitingLabel="Finding songs on YouTube…"
        />
        <ShareButton title={playlist.title} />
      </div>

      <div aria-live="polite">
        {exportError && (
          <p role="alert" className="mt-4 text-danger">
            {exportError}
          </p>
        )}
        {opened && (
          <div className="mt-5 rounded-xl border border-border p-4 text-sm">
            <p>
              Opened {opened.links.trackCount} songs in a new tab.
              {opened.links[opened.mode].youtubeMusicUrl ? (
                <>
                  {" "}
                  Tap Save in YouTube Music to keep it. Rather use YouTube?{" "}
                  <a
                    href={opened.links[opened.mode].youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline underline-offset-4"
                  >
                    Open it on YouTube
                  </a>
                  .
                </>
              ) : null}
            </p>
            {opened.links.unresolvedTracks.length > 0 && (
              <div className="mt-3 text-text-secondary">
                <p>
                  {opened.links.unresolvedTracks.length === 1
                    ? "1 song wasn't found on YouTube, so it's not in the queue:"
                    : `${opened.links.unresolvedTracks.length} songs weren't found on YouTube, so they're not in the queue:`}
                </p>
                <ul className="mt-1 list-inside list-disc">
                  {opened.links.unresolvedTracks.map((track) => (
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
            <span className="flex w-6 shrink-0 justify-end text-sm text-text-secondary tabular-nums">
              {track.position === nowPlayingPosition ? (
                <AudioLines size={16} className="text-accent" aria-label="Now playing" />
              ) : (
                index + 1
              )}
            </span>
            <PreviewDisc track={track} size={40} eager={index < firstScreenTrackCount} />
            <button
              type="button"
              onClick={() => void playOnPage("inOrder", track.position)}
              disabled={playablePositions !== null && !playablePositions.has(track.position)}
              title={playablePositions !== null && !playablePositions.has(track.position) ? "Not found on YouTube" : "Play from here"}
              className="min-w-0 flex-1 rounded-md text-left disabled:cursor-default"
            >
              <span className={`block truncate font-medium ${track.position === nowPlayingPosition ? "text-accent" : ""}`}>
                {track.title}
              </span>
              <span className="block truncate text-sm text-text-secondary">
                {pagePlayer.skippedPositions.has(track.position) ? "Can\u2019t play here. Try YouTube Music." : track.artist}
              </span>
            </button>
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
                    disabled={waiting !== null}
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

      <div
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 z-30 flex justify-center px-5 ${playerOpen ? "bottom-[23rem] sm:bottom-5" : "bottom-5"}`}
      >
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

      <PlayerDock
        openOnYoutubeUrl={youtubeLinks ? queueUrl(pagePlayer.isShuffled ? youtubeLinks.shuffled : youtubeLinks.inOrder) : null}
      />
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

type PlayControlProps = {
  mode: ExportMode;
  /** The prepared links, or null while they're still being prepared. */
  links: YoutubeExport | null;
  waiting: ExportMode | null;
  onOpened: (mode: ExportMode, links: YoutubeExport) => void;
  onPlayWhenReady: (mode: ExportMode) => Promise<void>;
  className: string;
  icon: ReactNode;
  label: string;
  waitingLabel: string;
};

/**
 * A play button. Once the links are ready it's a plain link, so it opens
 * straight away and phones hand it to the YouTube Music app. Before that it's a
 * button that opens a tab and fills it in when the links arrive.
 */
function PlayControl({ mode, links, waiting, onOpened, onPlayWhenReady, className, icon, label, waitingLabel }: PlayControlProps) {
  const base = `inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium ${className}`;
  if (links) {
    return (
      <a
        href={queueUrl(links[mode])}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onOpened(mode, links)}
        className={base}
      >
        {icon}
        {label}
      </a>
    );
  }
  const isWaiting = waiting === mode;
  return (
    <button
      type="button"
      onClick={() => void onPlayWhenReady(mode)}
      disabled={waiting !== null}
      aria-busy={isWaiting}
      className={`${base} disabled:opacity-70`}
    >
      {isWaiting ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : icon}
      {isWaiting ? waitingLabel : label}
    </button>
  );
}
