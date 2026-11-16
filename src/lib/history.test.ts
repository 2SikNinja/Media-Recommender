import { describe, expect, it } from "vitest";

import { maxHistoryEntries, readHistory, removeHistoryEntry, upsertHistoryEntry, type HistoryEntry } from "./history";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

function sessionEntry(sessionId: string, round = 1): HistoryEntry {
  return { kind: "session", sessionId, seedArtist: "M83", seedTitle: "Midnight City", updatedAt: "2026-11-15T00:00:00Z", round, totalRounds: 5 };
}

function playlistEntry(sessionId: string): HistoryEntry {
  return {
    kind: "playlist",
    sessionId,
    playlistId: `playlist-${sessionId}`,
    title: "Inspired by Midnight City",
    trackCount: 50,
    createdAt: "2026-11-15T00:00:00Z",
    seedArtist: "M83",
    seedTitle: "Midnight City",
    updatedAt: "2026-11-15T00:00:00Z",
  };
}

describe("upsertHistoryEntry", () => {
  it("puts the newest entry first and keeps one entry per session", () => {
    const storage = memoryStorage();
    upsertHistoryEntry(storage, sessionEntry("a"));
    upsertHistoryEntry(storage, sessionEntry("b"));
    upsertHistoryEntry(storage, sessionEntry("a", 3));
    expect(readHistory(storage).map((entry) => [entry.sessionId, entry.kind === "session" && entry.round])).toEqual([
      ["a", 3],
      ["b", 1],
    ]);
  });

  it("turns a finished session into its playlist", () => {
    const storage = memoryStorage();
    upsertHistoryEntry(storage, sessionEntry("a"));
    upsertHistoryEntry(storage, playlistEntry("a"));
    expect(readHistory(storage)).toEqual([playlistEntry("a")]);
  });

  it("never turns a playlist back into an unfinished session", () => {
    const storage = memoryStorage();
    upsertHistoryEntry(storage, playlistEntry("a"));
    upsertHistoryEntry(storage, sessionEntry("a", 5));
    expect(readHistory(storage)).toEqual([playlistEntry("a")]);
  });

  it(`keeps at most ${maxHistoryEntries} entries`, () => {
    const storage = memoryStorage();
    for (let index = 0; index < maxHistoryEntries + 5; index += 1) upsertHistoryEntry(storage, sessionEntry(String(index)));
    const entries = readHistory(storage);
    expect(entries).toHaveLength(maxHistoryEntries);
    expect(entries[0].sessionId).toBe(String(maxHistoryEntries + 4));
  });

  it("carries on when storage is full", () => {
    const storage = { getItem: () => null, setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
    expect(() => upsertHistoryEntry(storage, sessionEntry("a"))).not.toThrow();
  });
});

describe("readHistory", () => {
  it("ignores unreadable data and malformed entries", () => {
    expect(readHistory(memoryStorage({ "pickify.history.v1": "not json" }))).toEqual([]);
    expect(readHistory(memoryStorage({ "pickify.history.v1": JSON.stringify({ a: 1 }) }))).toEqual([]);
    const mixed = JSON.stringify([sessionEntry("a"), { kind: "playlist", sessionId: "b" }, null, playlistEntry("c")]);
    expect(readHistory(memoryStorage({ "pickify.history.v1": mixed })).map((entry) => entry.sessionId)).toEqual(["a", "c"]);
  });
});

describe("removeHistoryEntry", () => {
  it("removes only that session", () => {
    const storage = memoryStorage();
    upsertHistoryEntry(storage, sessionEntry("a"));
    upsertHistoryEntry(storage, playlistEntry("b"));
    removeHistoryEntry(storage, "b");
    expect(readHistory(storage).map((entry) => entry.sessionId)).toEqual(["a"]);
  });
});
