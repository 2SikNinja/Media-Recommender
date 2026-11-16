/**
 * One volume for everything Pickify plays (the page player and previews),
 * remembered in this browser. Components read it with useVolume and change it
 * with setVolume; every listener, in every open tab, follows along.
 */

import { useSyncExternalStore } from "react";

export type Volume = {
  /** 0 to 1. */
  level: number;
  muted: boolean;
};

export const defaultVolume: Volume = { level: 0.8, muted: false };

const storageKey = "pickify.volume.v1";
const changeEvent = "pickify-volume-change";

function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : defaultVolume.level;
}

/** Reads a stored volume, falling back to the default for anything unreadable. */
export function parseVolume(stored: string | null): Volume {
  if (!stored) return defaultVolume;
  try {
    const value = JSON.parse(stored) as Partial<Volume>;
    return {
      level: typeof value.level === "number" ? clampLevel(value.level) : defaultVolume.level,
      muted: value.muted === true,
    };
  } catch {
    return defaultVolume;
  }
}

/** What the audio should actually play at, from 0 to 1. */
export function effectiveLevel(volume: Volume): number {
  return volume.muted ? 0 : volume.level;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

let cachedRaw: string | null | undefined;
let cachedVolume: Volume = defaultVolume;

/** The current volume. Returns the same object until it changes, as useSyncExternalStore needs. */
export function getVolume(): Volume {
  if (typeof window === "undefined") return defaultVolume;
  const raw = readStored();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedVolume = parseVolume(raw);
  }
  return cachedVolume;
}

export function setVolume(change: Partial<Volume>): void {
  const next: Volume = { ...getVolume(), ...change };
  next.level = clampLevel(next.level);
  // Turning the volume up from zero unmutes, the way system volume controls do.
  if (change.level !== undefined && change.level > 0 && change.muted === undefined) next.muted = false;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Storage blocked: the change still applies for this page view.
    cachedRaw = JSON.stringify(next);
    cachedVolume = next;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function subscribeToVolume(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey) onChange();
  };
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useVolume(): Volume {
  return useSyncExternalStore(subscribeToVolume, getVolume, () => defaultVolume);
}
