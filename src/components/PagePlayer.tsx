"use client";

import { ChevronDown, ExternalLink, LoaderCircle, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { announcePagePlayerStarted } from "@/lib/playbackEvents";
import { useVolume, type Volume } from "@/lib/volume";

import { VolumeControl } from "./VolumeControl";

/** The parts of YouTube's IFrame Player API that this player uses. */
type YoutubePlayer = {
  loadPlaylist: (videoIds: string[], index?: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  nextVideo: () => void;
  previousVideo: () => void;
  getPlaylistIndex: () => number;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  stopVideo: () => void;
  destroy: () => void;
  getPlayerState: () => number;
};

type YoutubeNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: (event: { data: number }) => void;
      };
    },
  ) => YoutubePlayer;
};

declare global {
  interface Window {
    YT?: YoutubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// YT.PlayerState values.
const playerState = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

/** How often the dock re-checks YouTube's actual state, in case an event was missed. */
const resyncIntervalMs = 1_000;
/** How long a new song may sit unstarted before the dock offers a Play button (autoplay was blocked). */
const autoplayGraceMs = 2_500;

let apiPromise: Promise<YoutubeNamespace> | null = null;

/** Loads YouTube's player script once per page. */
function loadYoutubeApi(): Promise<YoutubeNamespace> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube's player couldn't load."));
    };
    document.head.append(script);
  });
  return apiPromise;
}

/** Sets YouTube's player to the site-wide volume. YouTube takes 0 to 100 and a separate mute. */
function applyVolume(player: YoutubePlayer | null, volume: Volume) {
  if (!player) return;
  player.setVolume(Math.round(volume.level * 100));
  if (volume.muted) player.mute();
  else player.unMute();
}

export type QueueItem = { position: number; videoId: string; title: string; artist: string };

type PlayerStatus = "loading" | "playing" | "paused" | "ended";

type PagePlayer = {
  /** The songs in play order, or null when the player is closed. */
  queue: QueueItem[] | null;
  currentIndex: number;
  status: PlayerStatus;
  /** Playlist positions YouTube wouldn't play here (removed, or not allowed in other sites). */
  skippedPositions: ReadonlySet<number>;
  isShuffled: boolean;
  play: (queue: QueueItem[], options?: { startIndex?: number; shuffled?: boolean }) => void;
  togglePause: () => void;
  next: () => void;
  previous: () => void;
  pause: () => void;
  close: () => void;
  /** Where the player mounts its video. */
  setVideoElement: (element: HTMLDivElement | null) => void;
};

const PagePlayerContext = createContext<PagePlayer | null>(null);

/**
 * Plays a queue of YouTube videos right on the page, through YouTube's
 * official embedded player. One player is shared by the page; playing a new
 * queue replaces the old one.
 */
export function PagePlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [isShuffled, setIsShuffled] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [skippedPositions, setSkippedPositions] = useState<ReadonlySet<number>>(() => new Set());
  const playerRef = useRef<YoutubePlayer | null>(null);
  const volume = useVolume();
  const volumeRef = useRef<Volume>(volume);
  const videoElementRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<QueueItem[] | null>(null);
  // When the last queue was loaded, to tell "still starting" from "autoplay was blocked".
  const loadedAtRef = useRef(0);
  // A queue asked for before the player was ready.
  const pendingRef = useRef<{ videoIds: string[]; startIndex: number } | null>(null);

  const syncIndex = useCallback(() => {
    const index = playerRef.current?.getPlaylistIndex();
    if (typeof index === "number" && index >= 0) setCurrentIndex(index);
  }, []);

  /**
   * Updates what the dock shows from YouTube's actual state. Used for every
   * state event and by a once-a-second check, so the dock can't stay wrong.
   */
  const syncFromState = useCallback(
    (state: number) => {
      syncIndex();
      if (state === playerState.playing) setStatus("playing");
      else if (state === playerState.paused) setStatus("paused");
      else if (state === playerState.buffering) setStatus("loading");
      else if (state === playerState.ended) {
        const index = playerRef.current?.getPlaylistIndex() ?? -1;
        if (index >= (queueRef.current?.length ?? 0) - 1) setStatus("ended");
      } else if (
        (state === playerState.unstarted || state === playerState.cued) &&
        Date.now() - loadedAtRef.current > autoplayGraceMs
      ) {
        // The browser blocked autoplay: offer the Play button instead of spinning forever.
        setStatus("paused");
      }
    },
    [syncIndex],
  );

  const createPlayer = useCallback(async () => {
    const youtube = await loadYoutubeApi();
    const element = videoElementRef.current;
    if (!element || playerRef.current) return;
    const mount = document.createElement("div");
    element.replaceChildren(mount);
    playerRef.current = new youtube.Player(mount, {
      width: "100%",
      height: "100%",
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 1 },
      events: {
        onReady: () => {
          applyVolume(playerRef.current, volumeRef.current);
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending) playerRef.current?.loadPlaylist(pending.videoIds, pending.startIndex);
        },
        onStateChange: ({ data }) => {
          syncFromState(data);
          // Whatever started it (our buttons, Space, or YouTube's own controls), previews stop.
          if (data === playerState.playing) announcePagePlayerStarted();
        },
        onError: () => {
          // The video is gone or its owner doesn't allow playing it on other
          // sites. Note it and move on, rather than stopping the whole queue.
          const player = playerRef.current;
          const index = player?.getPlaylistIndex() ?? -1;
          const item = queueRef.current?.[index];
          if (item) setSkippedPositions((positions) => new Set(positions).add(item.position));
          if (index >= 0 && index < (queueRef.current?.length ?? 0) - 1) player?.nextVideo();
          else setStatus("ended");
        },
      },
    });
  }, [syncFromState]);

  const play = useCallback<PagePlayer["play"]>(
    (nextQueue, { startIndex = 0, shuffled = false } = {}) => {
      queueRef.current = nextQueue;
      setQueue(nextQueue);
      setIsShuffled(shuffled);
      setCurrentIndex(startIndex);
      setStatus("loading");
      loadedAtRef.current = Date.now();
      const videoIds = nextQueue.map((item) => item.videoId);
      if (playerRef.current) {
        playerRef.current.loadPlaylist(videoIds, startIndex);
      } else {
        pendingRef.current = { videoIds, startIndex };
      }
    },
    [],
  );

  // The video element appears once the dock opens; create the player then.
  const setVideoElement = useCallback(
    (element: HTMLDivElement | null) => {
      videoElementRef.current = element;
      if (element && !playerRef.current) void createPlayer().catch(() => setStatus("ended"));
    },
    [createPlayer],
  );

  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);
  // Decides from what YouTube is actually doing, not from what the dock shows.
  const togglePause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    const state = player.getPlayerState();
    if (state === playerState.playing || state === playerState.buffering) player.pauseVideo();
    else player.playVideo();
  }, []);

  // While a queue is open, re-check YouTube's state every second.
  useEffect(() => {
    if (!queue) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (player && typeof player.getPlayerState === "function") syncFromState(player.getPlayerState());
    }, resyncIntervalMs);
    return () => clearInterval(timer);
  }, [queue, syncFromState]);
  const next = useCallback(() => playerRef.current?.nextVideo(), []);
  const previous = useCallback(() => playerRef.current?.previousVideo(), []);
  const close = useCallback(() => {
    playerRef.current?.destroy();
    playerRef.current = null;
    pendingRef.current = null;
    queueRef.current = null;
    setQueue(null);
  }, []);

  // Follow the site-wide volume, from this player's slider or the header's.
  useEffect(() => {
    volumeRef.current = volume;
    applyVolume(playerRef.current, volume);
  }, [volume]);

  useEffect(() => () => playerRef.current?.destroy(), []);

  const value = useMemo(
    () => ({
      queue,
      currentIndex,
      status,
      skippedPositions,
      isShuffled,
      play,
      togglePause,
      next,
      previous,
      pause,
      close,
      setVideoElement,
    }),
    [queue, currentIndex, status, skippedPositions, isShuffled, play, togglePause, next, previous, pause, close, setVideoElement],
  );
  return <PagePlayerContext value={value}>{children}</PagePlayerContext>;
}

export function usePagePlayer(): PagePlayer {
  const player = useContext(PagePlayerContext);
  if (!player) throw new Error("usePagePlayer must be used inside PagePlayerProvider");
  return player;
}

/**
 * The player docked at the bottom of the screen: the video, what's playing,
 * and controls. YouTube requires the video to stay visible (at least 200px
 * each way) while it plays, so it can be shrunk to a bar only by pausing.
 */
export function PlayerDock({ openOnYoutubeUrl }: { openOnYoutubeUrl: string | null }) {
  const { queue, currentIndex, status, isShuffled, togglePause, next, previous, close, setVideoElement, pause } =
    usePagePlayer();
  const [collapsed, setCollapsed] = useState(false);
  const isOpen = queue !== null;

  /**
   * Space plays and pauses while the player is open, the way it does on other
   * music sites. Without this, Space presses whatever button was clicked last,
   * like a preview or a Play button. Ignored while typing, and when focus is
   * inside YouTube's own player (which handles Space itself).
   */
  const onSpace = useEffectEvent((event: KeyboardEvent) => {
    if (collapsed) setCollapsed(false);
    event.preventDefault();
    togglePause();
  });
  useEffect(() => {
    if (!isOpen) return;
    let handled = false;
    const isSpace = (event: KeyboardEvent) =>
      (event.code === "Space" || event.key === " ") && !event.ctrlKey && !event.metaKey && !event.altKey;
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      target.closest("input:not([type=range]), textarea, select, [contenteditable='true']") !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpace(event) || isTyping(event.target)) return;
      handled = true;
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      onSpace(event);
    };
    // Browsers press a focused button when Space is released, so swallow that too.
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isSpace(event) || !handled) return;
      handled = false;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isOpen]);

  if (!queue) return null;

  const current = queue[currentIndex];
  const isPlaying = status === "playing";
  const iconButton =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-primary hover:bg-surface-hover disabled:opacity-40";

  return (
    <section
      aria-label="Player"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[380px] sm:rounded-2xl sm:border"
    >
      {/* Hidden, not removed, when collapsed, so the player keeps its place in the queue. */}
      <div className={collapsed ? "hidden" : "p-3 pb-0"}>
        <div ref={setVideoElement} className="aspect-video w-full min-h-[200px] overflow-hidden rounded-xl bg-black" />
      </div>
      <div className="flex items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" aria-live="polite">
            {current ? current.title : "Loading…"}
          </p>
          <p className="truncate text-xs text-text-secondary">{current ? current.artist : ""}</p>
        </div>
        <button type="button" onClick={previous} disabled={currentIndex === 0} aria-label="Previous song" className={iconButton}>
          <SkipBack size={18} fill="currentColor" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={togglePause}
          disabled={status === "loading" || status === "ended" || collapsed}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {status === "loading" ? (
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
          ) : isPlaying ? (
            <Pause size={18} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={18} fill="currentColor" className="translate-x-px" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={next}
          disabled={currentIndex >= queue.length - 1}
          aria-label="Next song"
          className={iconButton}
        >
          <SkipForward size={18} fill="currentColor" aria-hidden="true" />
        </button>
      </div>
      {/* Pickify's own volume, since YouTube's slider is hard to reach in a small player. */}
      <VolumeControl variant="wide" className="-mt-1 pr-4 pb-1 pl-2 [@media(hover:none)]:hidden" />
      <div className="flex items-center justify-between gap-2 px-3 pb-3 text-xs">
        <span className="pl-1 text-text-secondary tabular-nums">
          {currentIndex + 1} of {queue.length}
          {isShuffled ? ", shuffled" : ""}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              // The video has to stay visible while it plays, so hiding it pauses.
              if (!collapsed) pause();
              setCollapsed((value) => !value);
            }}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <ChevronDown size={14} className={collapsed ? "rotate-180" : undefined} aria-hidden="true" />
            {collapsed ? "Show video" : "Hide video"}
          </button>
          {openOnYoutubeUrl && (
            <a
              href={openOnYoutubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={pause}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              <ExternalLink size={13} aria-hidden="true" />
              YouTube Music
            </a>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close player"
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
