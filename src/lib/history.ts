/**
 * The playlists (and unfinished sessions) made in this browser, kept in
 * localStorage so they can be found again without an account. One entry per
 * session: an unfinished session becomes a playlist entry once it's done.
 */

export type HistoryEntry = {
  sessionId: string;
  seedArtist: string;
  seedTitle: string;
  /** ISO time of the last visit, used for ordering. */
  updatedAt: string;
} & (
  | { kind: "session"; round: number; totalRounds: number }
  | { kind: "playlist"; playlistId: string; title: string; trackCount: number; createdAt: string }
);

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const storageKey = "pickify.history.v1";
const changeEvent = "pickify-history-change";
export const maxHistoryEntries = 30;

function isEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const common =
    typeof entry.sessionId === "string" &&
    typeof entry.seedArtist === "string" &&
    typeof entry.seedTitle === "string" &&
    typeof entry.updatedAt === "string";
  if (!common) return false;
  if (entry.kind === "session") return typeof entry.round === "number" && typeof entry.totalRounds === "number";
  if (entry.kind === "playlist") {
    return (
      typeof entry.playlistId === "string" &&
      typeof entry.title === "string" &&
      typeof entry.trackCount === "number" &&
      typeof entry.createdAt === "string"
    );
  }
  return false;
}

/** Saved entries, newest first. Anything unreadable is ignored rather than breaking the page. */
export function readHistory(storage: StorageLike): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function writeHistory(storage: StorageLike, entries: HistoryEntry[]): void {
  try {
    storage.setItem(storageKey, JSON.stringify(entries.slice(0, maxHistoryEntries)));
  } catch {
    // Storage can be full or blocked (private browsing). History is a convenience, so carry on.
  }
}

/**
 * Adds or updates the entry for a session and moves it to the top. A playlist
 * entry is never turned back into an unfinished session.
 */
export function upsertHistoryEntry(storage: StorageLike, entry: HistoryEntry): HistoryEntry[] {
  const entries = readHistory(storage);
  const existing = entries.find((item) => item.sessionId === entry.sessionId);
  if (existing?.kind === "playlist" && entry.kind === "session") return entries;
  const next = [entry, ...entries.filter((item) => item.sessionId !== entry.sessionId)];
  writeHistory(storage, next);
  return next;
}

export function removeHistoryEntry(storage: StorageLike, sessionId: string): HistoryEntry[] {
  const next = readHistory(storage).filter((item) => item.sessionId !== sessionId);
  writeHistory(storage, next);
  return next;
}

// Browser helpers: the functions above take the storage as an argument so they
// can be tested without a browser.

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function notifyChange() {
  window.dispatchEvent(new Event(changeEvent));
}

export function saveToHistory(entry: HistoryEntry): void {
  const storage = browserStorage();
  if (!storage) return;
  upsertHistoryEntry(storage, entry);
  notifyChange();
}

export function forgetFromHistory(sessionId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  removeHistoryEntry(storage, sessionId);
  notifyChange();
}

/** For useSyncExternalStore: fires on changes from this tab and from other tabs. */
export function subscribeToHistory(onChange: () => void): () => void {
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

/** For useSyncExternalStore: the raw stored text, which is stable between changes. */
export function historySnapshot(): string {
  try {
    return browserStorage()?.getItem(storageKey) ?? "[]";
  } catch {
    return "[]";
  }
}

export function parseHistorySnapshot(snapshot: string): HistoryEntry[] {
  return readHistory({ getItem: () => snapshot, setItem: () => {} });
}
