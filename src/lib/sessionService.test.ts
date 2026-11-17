import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeMusicSource } from "@/test/fakeMusicSource";
import { createTestDb } from "@/test/pgliteDb";

import { ApiError } from "./apiErrors";
import type { Db } from "./dbTypes";
import {
  createSession,
  getSessionState,
  playlistTitle,
  remixPlaylist,
  rerollRound,
  submitPick,
  type SessionState,
} from "./sessionService";
import type { MusicSource } from "./trackCache";
import { makeTrackKey, type SimilarTrack } from "./tracks";

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

const seedInput = { seeds: [{ artist: "Seed Artist", title: "Seed Song" }] };

async function pickFirst(state: SessionState): Promise<SessionState> {
  return submitPick(deps, state.sessionId, {
    roundNumber: state.currentRound as number,
    trackKeys: [state.candidates[0].trackKey],
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
    await expectApiError(createSession(deps, { seeds: [{ artist: "!!!", title: "???" }] }), "invalidRequest");
  });
});

describe("start options", () => {
  const twoSeeds = {
    seeds: [
      { artist: "Seed Artist", title: "Seed Song" },
      { artist: "Second Artist", title: "Second Song" },
    ],
  };

  async function finish(state: SessionState): Promise<SessionState> {
    let current = state;
    while (current.status === "picking") current = await pickFirst(current);
    return current;
  }

  async function playlistRows(playlistId: string | null) {
    return db.query<{ position: number; track_key: string }>(
      "select position, track_key from playlist_tracks where playlist_id = $1 order by position",
      [playlistId],
    );
  }

  it("blends several seeds: their suggestions are pooled and the playlist starts with all of them", async () => {
    const state = await createSession(deps, twoSeeds);
    expect(state.seeds.map((seed) => seed.title)).toEqual(["Seed Song", "Second Song"]);
    expect(state.seed.title).toBe("Seed Song");
    expect(state.candidates.map((track) => track.trackKey)).not.toContain("second artist::second song");
    expect(fake.calls.getSimilarTracks).toBe(2);

    const done = await finish(state);
    const rows = await playlistRows(done.playlistId);
    expect(rows.slice(0, 2).map((row) => row.track_key)).toEqual(["seed artist::seed song", "second artist::second song"]);
    const [playlist] = await db.query<{ title: string }>("select title from playlists where id = $1", [done.playlistId]);
    expect(playlist.title).toBe("Inspired by Seed Song and Second Song");
  });

  it("ignores the same seed chosen twice", async () => {
    const state = await createSession(deps, { seeds: [twoSeeds.seeds[0], twoSeeds.seeds[0]] });
    expect(state.seeds).toHaveLength(1);
  });

  it("plays the chosen number of rounds and builds a playlist of the chosen length", async () => {
    const quick = await createSession(deps, { ...seedInput, rounds: 3, playlistSize: 25 });
    expect(quick.totalRounds).toBe(3);
    expect(quick.playlistSize).toBe(25);
    const done = await finish(quick);
    expect(done.picks).toHaveLength(3);
    expect(await playlistRows(done.playlistId)).toHaveLength(25);
  });

  it("can build a 100-song playlist", async () => {
    const deep = await createSession(deps, { ...seedInput, rounds: 8, playlistSize: 100 });
    const done = await finish(deep);
    const rows = await playlistRows(done.playlistId);
    expect(rows).toHaveLength(100);
    expect(rows.at(-1)?.position).toBe(100);
  });

  it("names playlists after every seed", () => {
    const track = (title: string) => ({ trackKey: title, artist: "A", title, durationSeconds: null, imageUrl: null });
    expect(playlistTitle([track("One")])).toBe("Inspired by One");
    expect(playlistTitle([track("One"), track("Two"), track("Three")])).toBe("Inspired by One, Two and Three");
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

  it("rejects different picks for a round that already has them", async () => {
    const state = await createSession(deps, seedInput);
    await pickFirst(state);
    await expectApiError(
      submitPick(deps, state.sessionId, { roundNumber: 1, trackKeys: [state.candidates[1].trackKey] }),
      "conflict",
    );
  });

  it("rejects songs that weren't offered and rounds that haven't started", async () => {
    const state = await createSession(deps, seedInput);
    await expectApiError(
      submitPick(deps, state.sessionId, { roundNumber: 1, trackKeys: ["someone::else"] }),
      "invalidRequest",
    );
    await expectApiError(
      submitPick(deps, state.sessionId, { roundNumber: 2, trackKeys: [state.candidates[0].trackKey] }),
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
        trackKeys: [state.candidates[0].trackKey],
      });
    }
    expect(state.picks.length).toBeLessThan(5);
    expect(state.playlistId).not.toBeNull();
  });

  it("returns notFound for an unknown session", async () => {
    await expectApiError(getSessionState(db, crypto.randomUUID()), "notFound");
  });
});

describe("submitPick with several songs", () => {
  it("records every pick, in the order the round showed them, and puts them all in the playlist", async () => {
    let state = await createSession(deps, seedInput);
    const [second, fifth, eighth] = [state.candidates[1], state.candidates[4], state.candidates[7]];

    state = await submitPick(deps, state.sessionId, {
      roundNumber: 1,
      trackKeys: [fifth.trackKey, second.trackKey, eighth.trackKey],
    });

    expect(state.currentRound).toBe(2);
    expect(state.picks.map((track) => track.trackKey)).toEqual([second.trackKey, fifth.trackKey, eighth.trackKey]);

    while (state.status === "picking") state = await pickFirst(state);
    const playlistRows = await db.query<{ track_key: string }>(
      "select track_key from playlist_tracks where playlist_id = $1 order by position",
      [state.playlistId],
    );
    const pickedKeys = state.picks.map((track) => track.trackKey);
    expect(pickedKeys).toHaveLength(7);
    expect(playlistRows.slice(0, 8).map((row) => row.track_key)).toEqual([state.seed.trackKey, ...pickedKeys]);
  });

  it("keeps the round's order for picks no matter what order they were sent in", async () => {
    const state = await createSession(deps, seedInput);
    const next = await submitPick(deps, state.sessionId, {
      roundNumber: 1,
      trackKeys: [state.candidates[6].trackKey, state.candidates[2].trackKey],
    });
    expect(next.picks.map((track) => track.trackKey)).toEqual([state.candidates[2].trackKey, state.candidates[6].trackKey]);
  });

  it("treats a retry with the same songs in a different order as the same pick", async () => {
    const state = await createSession(deps, seedInput);
    const keys = [state.candidates[0].trackKey, state.candidates[3].trackKey];
    const first = await submitPick(deps, state.sessionId, { roundNumber: 1, trackKeys: keys });
    const retry = await submitPick(deps, state.sessionId, { roundNumber: 1, trackKeys: [...keys].reverse() });
    expect(retry).toEqual(first);
  });

  it("ignores duplicate songs in one request", async () => {
    const state = await createSession(deps, seedInput);
    const key = state.candidates[0].trackKey;
    const next = await submitPick(deps, state.sessionId, { roundNumber: 1, trackKeys: [key, key] });
    expect(next.picks.map((track) => track.trackKey)).toEqual([key]);
  });

  it("rejects the whole request if any song wasn't offered", async () => {
    const state = await createSession(deps, seedInput);
    await expectApiError(
      submitPick(deps, state.sessionId, { roundNumber: 1, trackKeys: [state.candidates[0].trackKey, "someone::else"] }),
      "invalidRequest",
    );
    expect((await getSessionState(db, state.sessionId)).currentRound).toBe(1);
  });

  it("rejects an empty pick", async () => {
    const state = await createSession(deps, seedInput);
    await expectApiError(submitPick(deps, state.sessionId, { roundNumber: 1, trackKeys: [] }), "invalidRequest");
  });

  it("can pick all 10 songs in a round", async () => {
    const state = await createSession(deps, seedInput);
    const next = await submitPick(deps, state.sessionId, {
      roundNumber: 1,
      trackKeys: state.candidates.map((track) => track.trackKey),
    });
    expect(next.picks).toHaveLength(10);
    expect(next.currentRound).toBe(2);
    expect(fake.calls.getSimilarTracks).toBe(11);
  });
});

describe("songs passed on in a round", () => {
  it("never end up in the playlist", async () => {
    let state = await createSession(deps, seedInput);
    const skippedKeys = new Set<string>();
    while (state.status === "picking") {
      const [picked, ...skipped] = state.candidates;
      for (const track of skipped) skippedKeys.add(track.trackKey);
      state = await submitPick(deps, state.sessionId, { roundNumber: state.currentRound as number, trackKeys: [picked.trackKey] });
    }

    const playlistKeys = await db.query<{ track_key: string }>(
      "select track_key from playlist_tracks where playlist_id = $1",
      [state.playlistId],
    );
    expect(skippedKeys.size).toBe(45);
    expect(playlistKeys).toHaveLength(50);
    expect(playlistKeys.filter((row) => skippedKeys.has(row.track_key))).toEqual([]);
  });

  it("stay out of the playlist for sessions started before they were marked as passed on", async () => {
    let state = await createSession(deps, seedInput);
    const firstRoundSkipped = state.candidates.slice(1).map((track) => track.trackKey);
    state = await pickFirst(state);

    // Older sessions only lowered skipped songs' scores. Undo the mark to imitate one.
    const [{ candidate_pool: pool }] = await db.query<{ candidate_pool: Record<string, { rejected?: boolean; score: number }> }>(
      "select candidate_pool from sessions where id = $1",
      [state.sessionId],
    );
    for (const key of firstRoundSkipped) {
      delete pool[key].rejected;
      pool[key].score = 100;
    }
    await db.query("update sessions set candidate_pool = $2::jsonb where id = $1", [state.sessionId, JSON.stringify(pool)]);

    while (state.status === "picking") state = await pickFirst(state);
    const playlistKeys = await db.query<{ track_key: string }>(
      "select track_key from playlist_tracks where playlist_id = $1",
      [state.playlistId],
    );
    expect(playlistKeys.filter((row) => firstRoundSkipped.includes(row.track_key))).toEqual([]);
  });
});

describe("skips and \"Not for me\"", () => {
  // A tiny catalog where every connection is known. The seed suggests S1 to S10
  // (round 1) plus Liked, Shared, NearSkip and SameArtist. Picking S1 suggests
  // Liked and Shared. Marking S2 "Not for me" suggests Shared. Skipping S3
  // suggests NearSkip. SameArtist is by S4's artist, who gets skipped.
  const similarByKey: Record<string, Array<[string, string, number]>> = {
    "seed artist::seed song": [
      ...Array.from({ length: 10 }, (_, i): [string, string, number] => [`Artist ${i + 1}`, `S${i + 1}`, 0.9 - i * 0.04]),
      ["Fan Favorite", "Liked", 0.1],
      ["Middle Ground", "Shared", 0.1],
      ["Lookalike", "NearSkip", 0.1],
      ["Artist 4", "SameArtist", 0.1],
    ],
    "artist 1::s1": [
      ["Fan Favorite", "Liked", 1],
      ["Middle Ground", "Shared", 1],
    ],
    "artist 2::s2": [["Middle Ground", "Shared", 1]],
    "artist 3::s3": [["Lookalike", "NearSkip", 1]],
  };
  const catalogSource: MusicSource = {
    async getSimilarTracks(artist, title) {
      return (similarByKey[makeTrackKey(artist, title)] ?? []).map(
        ([similarArtist, similarTitle, match]): SimilarTrack => ({
          trackKey: makeTrackKey(similarArtist, similarTitle),
          artist: similarArtist,
          title: similarTitle,
          durationSeconds: null,
          imageUrl: null,
          match,
        }),
      );
    },
  };
  const key = (artist: string, title: string) => makeTrackKey(artist, title);

  async function playRoundOne(dislikedKeys: string[]) {
    const catalogDeps = { db, musicSource: catalogSource };
    const state = await createSession(catalogDeps, seedInput);
    expect(state.candidates.map((track) => track.title)).toEqual(Array.from({ length: 10 }, (_, i) => `S${i + 1}`));
    const next = await submitPick(catalogDeps, state.sessionId, {
      roundNumber: 1,
      trackKeys: [key("Artist 1", "S1")],
      dislikedKeys,
    });
    const [row] = await db.query<{ candidate_pool: Record<string, { score: number }>; artist_feedback: Record<string, number> }>(
      "select candidate_pool, artist_feedback from sessions where id = $1",
      [state.sessionId],
    );
    return { next, pool: row.candidate_pool, feedback: row.artist_feedback };
  }

  it("lets a pick pull up its similar songs while \"Not for me\" pulls down its own, at full strength", async () => {
    const { pool } = await playRoundOne([key("Artist 2", "S2")]);
    const roundOneWeight = 1.25;
    expect(pool[key("Fan Favorite", "Liked")].score).toBeCloseTo(0.1 + roundOneWeight);
    // Suggested by the pick and by the disliked song equally, so it's back where the seed left it.
    expect(pool[key("Middle Ground", "Shared")].score).toBeCloseTo(0.1);
  });

  it("pulls songs near a skipped one down gently, so all skips together weigh half the picks", async () => {
    const { pool, next } = await playRoundOne([]);
    // One pick and nine skips: each skip weighs half a pick, split nine ways.
    const eachSkip = (0.5 * 1.25) / 9;
    expect(pool[key("Lookalike", "NearSkip")].score).toBeCloseTo(0.1 - eachSkip);
    expect(next.candidates.map((track) => track.title)).toContain("NearSkip");
  });

  it("drops songs out of rounds once the skips outweigh everything that suggested them", async () => {
    const { pool, next } = await playRoundOne([key("Artist 3", "S3")]);
    expect(pool[key("Lookalike", "NearSkip")].score).toBeLessThan(0);
    expect(next.candidates.map((track) => track.title)).not.toContain("NearSkip");
  });

  it("counts the round against skipped and disliked artists, and for picked ones", async () => {
    const { feedback, next } = await playRoundOne([key("Artist 2", "S2")]);
    expect(feedback).toMatchObject({ "artist 1": 1, "artist 2": -2, "artist 4": -1 });
    // SameArtist ties Shared on score but is by a skipped artist, so it comes after.
    const titles = next.candidates.map((track) => track.title);
    expect(titles.indexOf("SameArtist")).toBeGreaterThan(titles.indexOf("Shared"));
  });

  it("rejects \"Not for me\" songs that aren't in the round or are also picked", async () => {
    const catalogDeps = { db, musicSource: catalogSource };
    const state = await createSession(catalogDeps, seedInput);
    await expectApiError(
      submitPick(catalogDeps, state.sessionId, { roundNumber: 1, trackKeys: [key("Artist 1", "S1")], dislikedKeys: ["nope::nope"] }),
      "invalidRequest",
    );
    await expectApiError(
      submitPick(catalogDeps, state.sessionId, {
        roundNumber: 1,
        trackKeys: [key("Artist 1", "S1")],
        dislikedKeys: [key("Artist 1", "S1")],
      }),
      "invalidRequest",
    );
  });

  it("applies \"Not for me\" when the round is swapped with \"None of these\"", async () => {
    const catalogDeps = { db, musicSource: catalogSource };
    const state = await createSession(catalogDeps, seedInput);
    await rerollRound(catalogDeps, state.sessionId, { roundNumber: 1, dislikedKeys: [key("Artist 2", "S2")] });
    const [row] = await db.query<{ candidate_pool: Record<string, { score: number }>; artist_feedback: Record<string, number> }>(
      "select candidate_pool, artist_feedback from sessions where id = $1",
      [state.sessionId],
    );
    expect(row.candidate_pool[key("Middle Ground", "Shared")].score).toBeCloseTo(0.1 - 1.25);
    expect(row.artist_feedback).toEqual({ "artist 2": -2 });
  });
});

describe("rerollRound", () => {
  it("replaces the round with unseen songs and keeps rejected songs out of the playlist", async () => {
    const state = await createSession(deps, seedInput);
    const rejectedKeys = state.candidates.map((track) => track.trackKey);

    const rerolled = await rerollRound(deps, state.sessionId, { roundNumber: 1 });

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
    await expectApiError(rerollRound(deps, state.sessionId, { roundNumber: 1 }), "conflict");
  });
});

describe("remixPlaylist", () => {
  async function finishedPlaylistId(): Promise<string> {
    let state = await createSession(deps, {
      seeds: [
        { artist: "Seed Artist", title: "Seed Song" },
        { artist: "Second Artist", title: "Second Song" },
      ],
      rounds: 2,
      playlistSize: 25,
    });
    while (state.status === "picking") state = await pickFirst(state);
    return state.playlistId as string;
  }

  it("starts a new session with the same seeds, rounds and length", async () => {
    const playlistId = await finishedPlaylistId();
    const original = await db.query<{ session_id: string }>("select session_id from playlists where id = $1", [playlistId]);

    const remix = await remixPlaylist(deps, playlistId);

    expect(remix.sessionId).not.toBe(original[0].session_id);
    expect(remix).toMatchObject({ status: "picking", currentRound: 1, totalRounds: 2, playlistSize: 25, picks: [] });
    expect(remix.seeds.map((seed) => seed.title)).toEqual(["Seed Song", "Second Song"]);
    expect(remix.candidates).toHaveLength(10);
  });

  it("refuses a playlist that doesn't exist", async () => {
    await expectApiError(remixPlaylist(deps, "00000000-0000-4000-8000-000000000000"), "notFound");
  });
});

describe("playlist reasons", () => {
  it("saves why each song is in the finished playlist", async () => {
    let state = await createSession(deps, { ...seedInput, rounds: 1 });
    state = await pickFirst(state);
    const playlistId = state.playlistId as string;

    const rows = await db.query<{ position: number; reason: { kind: string } | null }>(
      "select position, reason from playlist_tracks where playlist_id = $1 order by position",
      [playlistId],
    );
    expect(rows[0].reason).toEqual({ kind: "seed" });
    expect(rows[1].reason).toEqual({ kind: "pick" });
    expect(rows.slice(2).every((row) => row.reason?.kind === "similar")).toBe(true);
  });
});
