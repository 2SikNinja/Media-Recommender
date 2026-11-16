import { describe, expect, it } from "vitest";

import {
  addSimilarTracks,
  buildPlaylist,
  penalizeSkipped,
  pickWeight,
  rejectTracks,
  selectRound,
  type CandidatePool,
} from "./candidatePool";
import { makeTrackKey, type SimilarTrack, type Track } from "./tracks";

function makeTrack(artist: string, title: string): Track {
  return { trackKey: makeTrackKey(artist, title), artist, title, durationSeconds: null, imageUrl: null };
}

function makeSimilar(artist: string, title: string, match: number): SimilarTrack {
  return { ...makeTrack(artist, title), match };
}

/** Pool with `count` songs spread across `artistCount` artists, scored high to low. */
function makePool(count: number, artistCount: number): CandidatePool {
  const similarTracks = Array.from({ length: count }, (_, index) =>
    makeSimilar(`Artist ${index % artistCount}`, `Song ${index}`, 1 - index / (count + 1)),
  );
  return addSimilarTracks({}, similarTracks);
}

function countByArtist(tracks: Track[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of tracks) counts.set(track.artist, (counts.get(track.artist) ?? 0) + 1);
  return counts;
}

describe("addSimilarTracks", () => {
  it("adds up scores and hits when a song is similar to several picks", () => {
    const firstPool = addSimilarTracks({}, [makeSimilar("A", "Shared", 0.5), makeSimilar("B", "Only first", 0.9)]);
    const secondPool = addSimilarTracks(firstPool, [makeSimilar("A", "Shared", 0.8)], 2);

    const sharedEntry = secondPool[makeTrackKey("A", "Shared")];
    expect(sharedEntry.score).toBeCloseTo(0.5 + 0.8 * 2);
    expect(sharedEntry.hits).toBe(2);
    expect(secondPool[makeTrackKey("B", "Only first")].hits).toBe(1);
  });

  it("does not change the pool it was given", () => {
    const originalPool = addSimilarTracks({}, [makeSimilar("A", "Song", 0.5)]);
    addSimilarTracks(originalPool, [makeSimilar("A", "Song", 0.5)]);
    expect(originalPool[makeTrackKey("A", "Song")].score).toBe(0.5);
  });

  it("fills in a missing duration from a later result", () => {
    const firstPool = addSimilarTracks({}, [makeSimilar("A", "Song", 0.5)]);
    const secondPool = addSimilarTracks(firstPool, [{ ...makeSimilar("A", "Song", 0.5), durationSeconds: 200 }]);
    expect(secondPool[makeTrackKey("A", "Song")].track.durationSeconds).toBe(200);
  });
});

describe("pickWeight", () => {
  it("weights later rounds more", () => {
    expect(pickWeight(0)).toBe(1);
    expect(pickWeight(4)).toBeGreaterThan(pickWeight(1));
  });
});

describe("selectRound", () => {
  it("returns the top songs, skipping ones already shown", () => {
    const pool = makePool(30, 30);
    const excludedKey = makeTrackKey("Artist 0", "Song 0");

    const round = selectRound(pool, [excludedKey]);

    expect(round).toHaveLength(10);
    expect(round.map((track) => track.trackKey)).not.toContain(excludedKey);
    expect(round[0].title).toBe("Song 1");
  });

  it("allows at most two songs per artist", () => {
    const round = selectRound(makePool(40, 5), []);
    expect(round).toHaveLength(10);
    for (const count of countByArtist(round).values()) expect(count).toBeLessThanOrEqual(2);
  });

  it("relaxes the artist limit when there aren't enough artists", () => {
    const round = selectRound(makePool(20, 2), []);
    expect(round).toHaveLength(10);
    expect(new Set(round.map((track) => track.trackKey)).size).toBe(10);
  });

  it("returns fewer songs when the pool runs out", () => {
    expect(selectRound(makePool(4, 4), [])).toHaveLength(4);
    expect(selectRound({}, [])).toEqual([]);
  });
});

describe("penalizeSkipped", () => {
  it("lowers skipped songs but not the pick", () => {
    const pool = addSimilarTracks({}, [makeSimilar("A", "Picked", 1), makeSimilar("B", "Skipped", 1)]);
    const pickedKey = makeTrackKey("A", "Picked");
    const skippedKey = makeTrackKey("B", "Skipped");

    const penalizedPool = penalizeSkipped(pool, [pickedKey, skippedKey, "missing::key"], [pickedKey], 0.5);

    expect(penalizedPool[pickedKey].score).toBe(1);
    expect(penalizedPool[skippedKey].score).toBe(0.5);
    expect(penalizedPool["missing::key"]).toBeUndefined();
  });
});

describe("buildPlaylist", () => {
  it("starts with the seed and picks, then fills to 50 without duplicates", () => {
    const seed = makeTrack("Seed Artist", "Seed Song");
    const picks = [makeTrack("Artist 1", "Song 1"), makeTrack("Pick Artist", "Pick Song")];

    const playlist = buildPlaylist({ seed, picks, pool: makePool(100, 40) });

    expect(playlist).toHaveLength(50);
    expect(playlist.slice(0, 3).map((track) => track.title)).toEqual(["Seed Song", "Song 1", "Pick Song"]);
    expect(new Set(playlist.map((track) => track.trackKey)).size).toBe(50);
  });

  it("allows at most three songs per artist when the pool is big enough", () => {
    const playlist = buildPlaylist({ seed: makeTrack("Seed", "Song"), picks: [], pool: makePool(200, 30) });
    for (const count of countByArtist(playlist).values()) expect(count).toBeLessThanOrEqual(3);
  });

  it("returns what it can when the pool is small", () => {
    const playlist = buildPlaylist({ seed: makeTrack("Seed", "Song"), picks: [], pool: makePool(10, 2) });
    expect(playlist).toHaveLength(11);
  });

  it("ranks songs the user skipped below songs they never saw", () => {
    const pool = addSimilarTracks({}, [makeSimilar("A", "Skipped", 1), makeSimilar("B", "Unseen", 0.8)]);
    const skippedKey = makeTrackKey("A", "Skipped");
    const penalizedPool = penalizeSkipped(pool, [skippedKey], ["other::key"]);

    const playlist = buildPlaylist({ seed: makeTrack("Seed", "Song"), picks: [], pool: penalizedPool, size: 2 });

    expect(playlist[1].title).toBe("Unseen");
  });
});

describe("rejectTracks", () => {
  it("keeps rejected songs out of rounds and playlists even after they are suggested again", () => {
    const rejected = makeTrack("A", "Rejected");
    const pool = rejectTracks(addSimilarTracks({}, [makeSimilar("A", "Rejected", 1)]), [rejected]);
    const resuggestedPool = addSimilarTracks(pool, [makeSimilar("A", "Rejected", 1), makeSimilar("B", "Kept", 0.1)], 5);

    expect(selectRound(resuggestedPool, []).map((track) => track.title)).toEqual(["Kept"]);
    expect(
      buildPlaylist({ seed: makeTrack("Seed", "Song"), picks: [], pool: resuggestedPool }).map((track) => track.title),
    ).toEqual(["Song", "Kept"]);
  });

  it("can reject songs that were never in the pool", () => {
    const pool = rejectTracks({}, [makeTrack("A", "Unknown")]);
    expect(pool[makeTrackKey("A", "Unknown")].rejected).toBe(true);
    expect(selectRound(pool, [])).toEqual([]);
  });
});
