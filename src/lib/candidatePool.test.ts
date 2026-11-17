import { describe, expect, it } from "vitest";

import {
  addSimilarTracks,
  artistMultiplier,
  buildPlaylist,
  dislikeWeight,
  pickWeight,
  playlistReasons,
  rejectSkipped,
  rejectTracks,
  selectRound,
  skipWeight,
  subtractSimilarTracks,
  updateArtistFeedback,
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

describe("rejectSkipped", () => {
  it("rejects the songs shown but not picked, and leaves the picks alone", () => {
    const pool = addSimilarTracks({}, [makeSimilar("A", "Picked", 1), makeSimilar("B", "Skipped", 1)]);
    const picked = makeTrack("A", "Picked");
    const skipped = makeTrack("B", "Skipped");

    const nextPool = rejectSkipped(pool, [picked, skipped], [picked.trackKey]);

    expect(nextPool[picked.trackKey].rejected).toBeUndefined();
    expect(nextPool[skipped.trackKey]).toMatchObject({ rejected: true, score: 1 });
  });

  it("keeps skipped songs out even when a later pick suggests them again", () => {
    const skipped = makeTrack("B", "Skipped");
    let pool = rejectSkipped(addSimilarTracks({}, [makeSimilar("B", "Skipped", 1)]), [skipped], []);
    pool = addSimilarTracks(pool, [makeSimilar("B", "Skipped", 1), makeSimilar("C", "Unseen", 0.1)], 2);

    const playlist = buildPlaylist({ seeds: [makeTrack("Seed", "Song")], picks: [], pool });
    expect(playlist.map((track) => track.title)).toEqual(["Song", "Unseen"]);
  });
});

describe("subtractSimilarTracks", () => {
  it("lowers songs already in the pool without counting a hit", () => {
    const pool = addSimilarTracks({}, [makeSimilar("A", "Song", 1)], 2);
    const lowered = subtractSimilarTracks(pool, [makeSimilar("A", "Song", 0.5)], 1);
    expect(lowered[makeTrackKey("A", "Song")]).toMatchObject({ score: 1.5, hits: 1 });
  });

  it("adds new songs with a negative score that a later pick has to outweigh", () => {
    let pool = subtractSimilarTracks({}, [makeSimilar("B", "Song", 1)], 1);
    expect(pool[makeTrackKey("B", "Song")]).toMatchObject({ score: -1, hits: 0 });
    expect(selectRound(pool, [])).toEqual([]);

    pool = addSimilarTracks(pool, [makeSimilar("B", "Song", 1)], 2);
    expect(selectRound(pool, []).map((track) => track.title)).toEqual(["Song"]);
  });
});

describe("skipWeight", () => {
  it("makes a round's skips add up to half its picks", () => {
    const eachSkip = skipWeight(2, 2, 8);
    expect(eachSkip * 8).toBeCloseTo(0.5 * 2 * pickWeight(2));
  });

  it("gives each skip half a pick's weight when there are fewer skips than picks", () => {
    expect(skipWeight(2, 8, 2)).toBeCloseTo(0.5 * pickWeight(2));
  });

  it("is zero without picks or skips", () => {
    expect(skipWeight(1, 0, 10)).toBe(0);
    expect(skipWeight(1, 10, 0)).toBe(0);
  });

  it("is always weaker than \"Not for me\"", () => {
    expect(skipWeight(3, 9, 1)).toBeLessThan(dislikeWeight(3));
  });
});

describe("artist feedback", () => {
  it("counts skips against an artist and \"Not for me\" twice as much", () => {
    const feedback = updateArtistFeedback({}, {
      skipped: [makeTrack("Skipped", "One")],
      disliked: [makeTrack("Disliked", "One")],
    });
    expect(artistMultiplier(feedback, "Skipped")).toBe(0.75);
    expect(artistMultiplier(feedback, "Disliked")).toBe(0.5625);
    expect(artistMultiplier(feedback, "Someone else")).toBe(1);
  });

  it("never scales an artist below a quarter", () => {
    const feedback = updateArtistFeedback({}, { disliked: Array.from({ length: 5 }, (_, i) => makeTrack("A", `Song ${i}`)) });
    expect(artistMultiplier(feedback, "A")).toBe(0.25);
  });

  it("lets a pick cancel earlier skips, even in the same round", () => {
    let feedback = updateArtistFeedback({}, { skipped: [makeTrack("A", "One"), makeTrack("A", "Two")] });
    feedback = updateArtistFeedback(feedback, { picked: [makeTrack("A", "Three")], skipped: [makeTrack("A", "Four")] });
    expect(feedback).toEqual({ a: 1 });
    expect(artistMultiplier(feedback, "A")).toBe(1);
  });

  it("ranks an artist the user keeps passing on below a slightly weaker match", () => {
    const pool = addSimilarTracks({}, [makeSimilar("Passed On", "Song", 1), makeSimilar("Fresh", "Song", 0.8)]);
    const feedback = updateArtistFeedback({}, { skipped: [makeTrack("Passed On", "Other")] });
    expect(selectRound(pool, [], { artistFeedback: feedback }).map((track) => track.artist)).toEqual(["Fresh", "Passed On"]);
    expect(buildPlaylist({ seeds: [makeTrack("Seed", "Song")], picks: [], pool, artistFeedback: feedback })[1].artist).toBe("Fresh");
  });
});

describe("buildPlaylist", () => {
  it("starts with the seed and picks, then fills to 50 without duplicates", () => {
    const seed = makeTrack("Seed Artist", "Seed Song");
    const picks = [makeTrack("Artist 1", "Song 1"), makeTrack("Pick Artist", "Pick Song")];

    const playlist = buildPlaylist({ seeds: [seed], picks, pool: makePool(100, 40) });

    expect(playlist).toHaveLength(50);
    expect(playlist.slice(0, 3).map((track) => track.title)).toEqual(["Seed Song", "Song 1", "Pick Song"]);
    expect(new Set(playlist.map((track) => track.trackKey)).size).toBe(50);
  });

  it("allows at most three songs per artist when the pool is big enough", () => {
    const playlist = buildPlaylist({ seeds: [makeTrack("Seed", "Song")], picks: [], pool: makePool(200, 30) });
    for (const count of countByArtist(playlist).values()) expect(count).toBeLessThanOrEqual(3);
  });

  it("returns what it can when the pool is small", () => {
    const playlist = buildPlaylist({ seeds: [makeTrack("Seed", "Song")], picks: [], pool: makePool(10, 2) });
    expect(playlist).toHaveLength(11);
  });

  it("leaves out excluded songs, even when the pool still ranks them", () => {
    const pool = addSimilarTracks({}, [makeSimilar("A", "Skipped earlier", 1), makeSimilar("B", "Unseen", 0.2)]);
    const playlist = buildPlaylist({
      seeds: [makeTrack("Seed", "Song")],
      picks: [],
      pool,
      excludedKeys: [makeTrackKey("A", "Skipped earlier")],
    });
    expect(playlist.map((track) => track.title)).toEqual(["Song", "Unseen"]);
  });

  it("is shorter rather than padded when only excluded songs are left", () => {
    const pool = makePool(30, 30);
    const excludedKeys = Object.keys(pool).slice(0, 25);
    expect(buildPlaylist({ seeds: [makeTrack("Seed", "Song")], picks: [], pool, excludedKeys })).toHaveLength(6);
  });
});

describe("rejectTracks", () => {
  it("keeps rejected songs out of rounds and playlists even after they are suggested again", () => {
    const rejected = makeTrack("A", "Rejected");
    const pool = rejectTracks(addSimilarTracks({}, [makeSimilar("A", "Rejected", 1)]), [rejected]);
    const resuggestedPool = addSimilarTracks(pool, [makeSimilar("A", "Rejected", 1), makeSimilar("B", "Kept", 0.1)], 5);

    expect(selectRound(resuggestedPool, []).map((track) => track.title)).toEqual(["Kept"]);
    expect(
      buildPlaylist({ seeds: [makeTrack("Seed", "Song")], picks: [], pool: resuggestedPool }).map((track) => track.title),
    ).toEqual(["Song", "Kept"]);
  });

  it("can reject songs that were never in the pool", () => {
    const pool = rejectTracks({}, [makeTrack("A", "Unknown")]);
    expect(pool[makeTrackKey("A", "Unknown")].rejected).toBe(true);
    expect(selectRound(pool, [])).toEqual([]);
  });
});

describe("suggestion sources", () => {
  it("remembers which songs suggested each entry, without repeats", () => {
    let pool = addSimilarTracks({}, [makeSimilar("A", "Shared", 0.5)], 1, "seed::one");
    pool = addSimilarTracks(pool, [makeSimilar("A", "Shared", 0.5)], 1, "pick::two");
    pool = addSimilarTracks(pool, [makeSimilar("A", "Shared", 0.5)], 1, "seed::one");
    expect(pool[makeTrackKey("A", "Shared")].from).toEqual(["pick::two", "seed::one"]);
  });

  it("leaves sources out when none is given", () => {
    const pool = addSimilarTracks({}, [makeSimilar("A", "Song", 0.5)]);
    expect(pool[makeTrackKey("A", "Song")].from).toBeUndefined();
  });
});

describe("playlistReasons", () => {
  const seed = makeTrack("Illenium", "Feel Something");
  const firstPick = makeTrack("Slander", "First Time");
  const laterPick = makeTrack("Dabin", "Hollow");

  it("names the seed, the picks, and what each other song is similar to", () => {
    let pool = addSimilarTracks({}, [makeSimilar("Zedd", "Clarity", 0.9)], 1, seed.trackKey);
    pool = addSimilarTracks(pool, [makeSimilar("Zedd", "Clarity", 0.9), makeSimilar("Kaskade", "Atmosphere", 0.8)], 1, firstPick.trackKey);
    pool = addSimilarTracks(pool, [makeSimilar("Zedd", "Clarity", 0.9)], 1, laterPick.trackKey);
    const playlist = [seed, firstPick, laterPick, makeTrack("Zedd", "Clarity"), makeTrack("Kaskade", "Atmosphere")];

    expect(playlistReasons(playlist, { seeds: [seed], picks: [firstPick, laterPick], pool })).toEqual([
      { kind: "seed" },
      { kind: "pick" },
      { kind: "pick" },
      {
        kind: "similar",
        to: [
          { artist: "Dabin", title: "Hollow", kind: "pick" },
          { artist: "Slander", title: "First Time", kind: "pick" },
        ],
      },
      { kind: "similar", to: [{ artist: "Slander", title: "First Time", kind: "pick" }] },
    ]);
  });

  it("falls back to the seed, and to nothing when the pool doesn't know", () => {
    const pool = addSimilarTracks({}, [makeSimilar("Zedd", "Clarity", 0.9)], 1, seed.trackKey);
    const playlist = [makeTrack("Zedd", "Clarity"), makeTrack("Old", "Entry")];

    expect(playlistReasons(playlist, { seeds: [seed], picks: [], pool })).toEqual([
      { kind: "similar", to: [{ artist: "Illenium", title: "Feel Something", kind: "seed" }] },
      null,
    ]);
  });
});
