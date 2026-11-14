import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeMusicSource } from "@/test/fakeMusicSource";
import { createTestDb } from "@/test/pgliteDb";

import { ApiError } from "./apiErrors";
import type { Db } from "./dbTypes";
import { createSession, getSessionState, rerollRound, submitPick, type SessionState } from "./sessionService";
import type { MusicSource } from "./trackCache";

let db: Db & { close: () => Promise<void> };
let fake: ReturnType<typeof createFakeMusicSource>;
let deps: { db: Db; musicSource: MusicSource };

beforeEach(async () => {
  db = await createTestDb();
  fake = createFakeMusicSource();
  deps = { db, musicSource: fake.musicSource };
});

afterEach(async () => {
  await db.close();
});

const seedInput = { artist: "Seed Artist", title: "Seed Song" };

async function pickFirst(state: SessionState): Promise<SessionState> {
  return submitPick(deps, state.sessionId, {
    roundNumber: state.currentRound as number,
    trackKey: state.candidates[0].trackKey,
  });
}

async function expectApiError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ApiError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("createSession", () => {
  it("starts round 1 with 10 songs that don't include the seed", async () => {
    const state = await createSession(deps, seedInput);

    expect(state).toMatchObject({ status: "picking", currentRound: 1, totalRounds: 5, picks: [], playlistId: null });
    expect(state.candidates).toHaveLength(10);
    expect(state.candidates.map((track) => track.trackKey)).not.toContain(state.seed.trackKey);
    expect(await getSessionState(db, state.sessionId)).toEqual(state);
  });

  it("reuses cached similar tracks for the same seed", async () => {
    await createSession(deps, seedInput);
    await createSession(deps, seedInput);
    expect(fake.calls.getSimilarTracks).toBe(1);
  });

  it("refuses seeds with too few similar songs", async () => {
    fake.noSimilarSongs.add("seed artist::seed song");
    await expectApiError(createSession(deps, seedInput), "noSuggestions");
  });

  it("refuses names with no letters or numbers", async () => {
    await expectApiError(createSession(deps, { artist: "!!!", title: "???" }), "invalidRequest");
  });
});

describe("submitPick", () => {
  it("plays through every round, never repeats a song, and builds a 50-song playlist", async () => {
    let state = await createSession(deps, seedInput);
    const shownKeys = new Set(state.candidates.map((track) => track.trackKey));
    const pickedKeys: string[] = [];

    while (state.status === "picking") {
      pickedKeys.push(state.candidates[0].trackKey);
      state = await pickFirst(state);
      for (const track of state.candidates) {
        expect(shownKeys.has(track.trackKey)).toBe(false);
        shownKeys.add(track.trackKey);
      }
    }

    expect(state).toMatchObject({ status: "complete", currentRound: null, candidates: [] });
    expect(state.picks.map((track) => track.trackKey)).toEqual(pickedKeys);
    expect(pickedKeys).toHaveLength(5);

    const playlistRows = await db.query<{ track_key: string }>(
      "select track_key from playlist_tracks where playlist_id = $1 order by position",
      [state.playlistId],
    );
    expect(playlistRows).toHaveLength(50);
    expect(playlistRows.slice(0, 6).map((row) => row.track_key)).toEqual([state.seed.trackKey, ...pickedKeys]);
    expect(new Set(playlistRows.map((row) => row.track_key)).size).toBe(50);
  });

  it("returns the same state when the same pick is sent twice", async () => {
    const state = await createSession(deps, seedInput);
    const first = await pickFirst(state);
    const retry = await pickFirst(state);
    expect(retry).toEqual(first);
    expect(retry.currentRound).toBe(2);
  });

  it("handles two identical picks arriving at the same time", async () => {
    const state = await createSession(deps, seedInput);
    const [first, second] = await Promise.all([pickFirst(state), pickFirst(state)]);
    expect(first.currentRound).toBe(2);
    expect(second).toEqual(first);
    const rounds = await db.query("select round_number from session_rounds where session_id = $1", [state.sessionId]);
    expect(rounds).toHaveLength(2);
  });

  it("rejects a different pick for a round that already has one", async () => {
    const state = await createSession(deps, seedInput);
    await pickFirst(state);
    await expectApiError(
      submitPick(deps, state.sessionId, { roundNumber: 1, trackKey: state.candidates[1].trackKey }),
      "conflict",
    );
  });

  it("rejects songs that weren't offered and rounds that haven't started", async () => {
    const state = await createSession(deps, seedInput);
    await expectApiError(
      submitPick(deps, state.sessionId, { roundNumber: 1, trackKey: "someone::else" }),
      "invalidRequest",
    );
    await expectApiError(
      submitPick(deps, state.sessionId, { roundNumber: 2, trackKey: state.candidates[0].trackKey }),
      "conflict",
    );
  });

  it("finishes early when there are no songs left to suggest", async () => {
    const tinyFake = createFakeMusicSource({ similarCount: 12, catalogSize: 12, artistCount: 12 });
    const tinyDeps = { db, musicSource: tinyFake.musicSource };
    let state = await createSession(tinyDeps, seedInput);
    while (state.status === "picking") {
      state = await submitPick(tinyDeps, state.sessionId, {
        roundNumber: state.currentRound as number,
        trackKey: state.candidates[0].trackKey,
      });
    }
    expect(state.picks.length).toBeLessThan(5);
    expect(state.playlistId).not.toBeNull();
  });

  it("returns notFound for an unknown session", async () => {
    await expectApiError(getSessionState(db, crypto.randomUUID()), "notFound");
  });
});

describe("rerollRound", () => {
  it("replaces the round with unseen songs and keeps rejected songs out of the playlist", async () => {
    const state = await createSession(deps, seedInput);
    const rejectedKeys = state.candidates.map((track) => track.trackKey);

    const rerolled = await rerollRound(db, state.sessionId, 1);

    expect(rerolled.currentRound).toBe(1);
    expect(rerolled.candidates.length).toBeGreaterThan(0);
    for (const track of rerolled.candidates) expect(rejectedKeys).not.toContain(track.trackKey);

    let finalState = rerolled;
    while (finalState.status === "picking") finalState = await pickFirst(finalState);
    const playlistRows = await db.query<{ track_key: string }>(
      "select track_key from playlist_tracks where playlist_id = $1",
      [finalState.playlistId],
    );
    for (const row of playlistRows) expect(rejectedKeys).not.toContain(row.track_key);
  });

  it("refuses to reroll a round that is already picked", async () => {
    const state = await createSession(deps, seedInput);
    await pickFirst(state);
    await expectApiError(rerollRound(db, state.sessionId, 1), "conflict");
  });
});
