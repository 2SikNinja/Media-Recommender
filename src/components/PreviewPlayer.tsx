"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export function previewSrc(artist: string, title: string): string {
  return `/api/preview?${new URLSearchParams({ artist, title }).toString()}`;
}

type PreviewStatus = "idle" | "loading" | "playing" | "unavailable";

type PreviewPlayer = {
  /** Status of one song's preview. */
  statusOf: (trackKey: string) => PreviewStatus;
  /** 0 to 1 through the clip that's playing now. */
  progress: number;
  /** Plays the song's preview, or stops it if it's the one playing. */
  toggle: (track: { trackKey: string; artist: string; title: string }) => void;
  stop: () => void;
};

const PreviewPlayerContext = createContext<PreviewPlayer | null>(null);

/**
 * Plays 30-second previews through a single audio element, so starting one
 * song stops the last. Songs without a preview are remembered as unavailable.
 */
export function PreviewPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Removes the error listener of the clip that's loading, so a later clip's
  // failure (or clearing the source) isn't blamed on it.
  const clearPendingRef = useRef<() => void>(() => {});
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [unavailableKeys, setUnavailableKeys] = useState<ReadonlySet<string>>(() => new Set());

  const stop = useCallback(() => {
    clearPendingRef.current();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setCurrentKey(null);
    setIsPlaying(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;

    const onPlaying = () => setIsPlaying(true);
    const onTimeUpdate = () => setProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0);
    const onEnded = () => {
      setCurrentKey(null);
      setIsPlaying(false);
      setProgress(0);
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      clearPendingRef.current();
      audio.pause();
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, []);

  const toggle = useCallback<PreviewPlayer["toggle"]>(
    ({ trackKey, artist, title }) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (currentKey === trackKey) {
        stop();
        return;
      }

      clearPendingRef.current();
      audio.pause();
      audio.src = previewSrc(artist, title);
      setCurrentKey(trackKey);
      setIsPlaying(false);
      setProgress(0);

      const markUnavailable = () => {
        setUnavailableKeys((keys) => new Set(keys).add(trackKey));
        setCurrentKey((key) => (key === trackKey ? null : key));
      };
      const clearPending = () => {
        audio.removeEventListener("error", markUnavailable);
        audio.removeEventListener("playing", clearPending);
      };
      audio.addEventListener("error", markUnavailable, { once: true });
      audio.addEventListener("playing", clearPending, { once: true });
      clearPendingRef.current = clearPending;

      audio.play().catch((error: unknown) => {
        // A newer toggle or stop interrupted this one; that's not a missing preview.
        if (error instanceof DOMException && error.name === "AbortError") return;
        clearPending();
        markUnavailable();
      });
    },
    [currentKey, stop],
  );

  const statusOf = useCallback(
    (trackKey: string): PreviewStatus => {
      if (unavailableKeys.has(trackKey)) return "unavailable";
      if (trackKey !== currentKey) return "idle";
      return isPlaying ? "playing" : "loading";
    },
    [currentKey, isPlaying, unavailableKeys],
  );

  const value = useMemo(() => ({ statusOf, progress, toggle, stop }), [statusOf, progress, toggle, stop]);
  return <PreviewPlayerContext value={value}>{children}</PreviewPlayerContext>;
}

export function usePreviewPlayer(): PreviewPlayer {
  const player = useContext(PreviewPlayerContext);
  if (!player) throw new Error("usePreviewPlayer must be used inside PreviewPlayerProvider");
  return player;
}
