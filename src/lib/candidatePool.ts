import { makeArtistKey, type SimilarTrack, type Track } from "./tracks";

/**
 * The candidate pool is every song suggested so far, with a score.
 *
 * Each time the user picks a song, its Last.fm similar tracks are merged in and
 * their similarity scores are added up. A song that is similar to several picks
 * climbs to the top, so later rounds lean toward what the user keeps choosing.
 *
 * It is a plain object so it can be stored as JSON in sessions.candidate_pool.
 */
export type PoolEntry = {
  track: Track;
  score: number;
  /** How many seed or picked songs listed this one as similar. */
  hits: number;
  /**
   * Set when the user passed on this song: it was shown in a round and not
   * picked, or swapped out with "none of these". It stays out of later rounds
   * and the playlist for good.
   */
  rejected?: boolean;
};

export type CandidatePool = Record<string, PoolEntry>;

/**
 * What the user has shown about each artist, keyed by artist key: picks count
 * for (+1), skips against (-1) and "Not for me" strongly against (-2).
 */
export type ArtistFeedback = Record<string, number>;

export const defaultRoundSize = 10;
export const defaultPlaylistSize = 50;
const defaultRoundArtistLimit = 2;
const defaultPlaylistArtistLimit = 3;

/**
 * How strongly skipped songs push their similar songs down. All of a round's
 * skips together weigh this fraction of the round's picks, so skipping 8 songs
 * can't outweigh picking 2: a skip only says "less than the ones I picked".
 */
export const skipStrength = 0.5;
/** "Not for me" pushes similar songs down as strongly as a pick pushes them up. */
export const dislikeStrength = 1;

/** Each step below zero in artist feedback scales the artist's songs by this much, down to the floor. */
const artistPenaltyStep = 0.75;
const artistPenaltyFloor = 0.25;

/** Later picks reflect the user's taste better than the seed, so they count a bit more. */
export function pickWeight(roundNumber: number): number {
  return 1 + 0.25 * Math.max(roundNumber, 0);
}

export function addSimilarTracks(pool: CandidatePool, similarTracks: SimilarTrack[], weight = 1): CandidatePool {
  const nextPool: CandidatePool = { ...pool };
  for (const similarTrack of similarTracks) {
    const { match, ...track } = similarTrack;
    const existingEntry = nextPool[track.trackKey];
    nextPool[track.trackKey] = existingEntry
      ? {
          ...existingEntry,
          track: {
            ...existingEntry.track,
            durationSeconds: existingEntry.track.durationSeconds ?? track.durationSeconds,
            imageUrl: existingEntry.track.imageUrl ?? track.imageUrl,
          },
          score: existingEntry.score + match * weight,
          hits: existingEntry.hits + 1,
        }
      : { track, score: match * weight, hits: 1 };
  }
  return nextPool;
}

/**
 * The opposite of addSimilarTracks: lowers the songs similar to one the user
 * passed on. Songs not in the pool yet are added with a negative score, so a
 * later pick has to outweigh it before they can show up. Doesn't count as a hit.
 */
export function subtractSimilarTracks(pool: CandidatePool, similarTracks: SimilarTrack[], weight: number): CandidatePool {
  const nextPool: CandidatePool = { ...pool };
  for (const similarTrack of similarTracks) {
    const { match, ...track } = similarTrack;
    const existingEntry = nextPool[track.trackKey];
    nextPool[track.trackKey] = existingEntry
      ? { ...existingEntry, score: existingEntry.score - match * weight }
      : { track, score: -match * weight, hits: 0 };
  }
  return nextPool;
}

/** The weight for each skipped song in a round, so the round's skips add up to skipStrength of its picks. */
export function skipWeight(roundNumber: number, pickCount: number, skipCount: number): number {
  if (pickCount === 0 || skipCount === 0) return 0;
  return skipStrength * pickWeight(roundNumber) * Math.min(1, pickCount / skipCount);
}

/** The weight for each song marked "Not for me". */
export function dislikeWeight(roundNumber: number): number {
  return dislikeStrength * pickWeight(roundNumber);
}

/**
 * Updates the artist feedback after a round. Skips and dislikes are counted
 * first, then picks, so picking an artist's song cancels earlier skips of them.
 */
export function updateArtistFeedback(
  feedback: ArtistFeedback,
  { picked = [], skipped = [], disliked = [] }: { picked?: Track[]; skipped?: Track[]; disliked?: Track[] },
): ArtistFeedback {
  const next: ArtistFeedback = { ...feedback };
  const change = (track: Track, amount: number) => {
    const artistKey = makeArtistKey(track.artist);
    next[artistKey] = (next[artistKey] ?? 0) + amount;
  };
  for (const track of skipped) change(track, -1);
  for (const track of disliked) change(track, -2);
  for (const track of picked) {
    const artistKey = makeArtistKey(track.artist);
    next[artistKey] = Math.max(next[artistKey] ?? 0, 0) + 1;
  }
  return next;
}

/** How much an artist's songs are scaled by: 1 unless the user has passed on them more than picked them. */
export function artistMultiplier(feedback: ArtistFeedback, artist: string): number {
  const net = feedback[makeArtistKey(artist)] ?? 0;
  return net >= 0 ? 1 : Math.max(artistPenaltyFloor, artistPenaltyStep ** -net);
}

/**
 * Marks the songs shown in a round but not picked as rejected, so they stay
 * out of the playlist. Passing on a song is a clear "not this one".
 */
export function rejectSkipped(pool: CandidatePool, shownTracks: Track[], pickedKeys: Iterable<string>): CandidatePool {
  const picked = new Set(pickedKeys);
  return rejectTracks(pool, shownTracks.filter((track) => !picked.has(track.trackKey)));
}

/**
 * Marks songs as rejected ("none of these"). They keep their place in the pool
 * so a later pick that lists them as similar can't bring them back.
 */
export function rejectTracks(pool: CandidatePool, tracks: Track[]): CandidatePool {
  const nextPool: CandidatePool = { ...pool };
  for (const track of tracks) {
    const existingEntry = nextPool[track.trackKey];
    nextPool[track.trackKey] = existingEntry
      ? { ...existingEntry, rejected: true }
      : { track, score: 0, hits: 0, rejected: true };
  }
  return nextPool;
}

/**
 * Songs that can still be suggested, best first. Leaves out rejected songs and
 * songs whose score skips have pushed to zero or below, and scales each score
 * by the artist feedback.
 */
function rankEntries(pool: CandidatePool, artistFeedback: ArtistFeedback = {}): PoolEntry[] {
  return Object.values(pool)
    .filter((entry) => !entry.rejected && entry.score > 0)
    .map((entry) => ({ entry, rank: entry.score * artistMultiplier(artistFeedback, entry.track.artist) }))
    .sort(
      (first, second) =>
        second.rank - first.rank ||
        second.entry.hits - first.entry.hits ||
        first.entry.track.trackKey.localeCompare(second.entry.track.trackKey),
    )
    .map(({ entry }) => entry);
}

function takeWithArtistLimit(
  rankedEntries: PoolEntry[],
  count: number,
  excludedKeys: Set<string>,
  artistCounts: Map<string, number>,
  artistLimit: number,
): Track[] {
  const chosen: Track[] = [];
  for (const entry of rankedEntries) {
    if (chosen.length >= count) break;
    const { track } = entry;
    if (excludedKeys.has(track.trackKey)) continue;

    const artistKey = makeArtistKey(track.artist);
    const artistCount = artistCounts.get(artistKey) ?? 0;
    if (artistCount >= artistLimit) continue;

    chosen.push(track);
    excludedKeys.add(track.trackKey);
    artistCounts.set(artistKey, artistCount + 1);
  }
  return chosen;
}

export type SelectRoundOptions = {
  roundSize?: number;
  maxPerArtist?: number;
  artistFeedback?: ArtistFeedback;
};

/**
 * The next set of choices: the highest-scoring songs the user hasn't seen yet,
 * with at most a couple per artist so the round stays varied. If the artist
 * limit leaves the round short, it is filled without the limit.
 */
export function selectRound(
  pool: CandidatePool,
  excludedKeys: Iterable<string>,
  { roundSize = defaultRoundSize, maxPerArtist = defaultRoundArtistLimit, artistFeedback }: SelectRoundOptions = {},
): Track[] {
  const rankedEntries = rankEntries(pool, artistFeedback);
  const usedKeys = new Set(excludedKeys);
  const artistCounts = new Map<string, number>();

  const chosen = takeWithArtistLimit(rankedEntries, roundSize, usedKeys, artistCounts, maxPerArtist);
  if (chosen.length < roundSize) {
    chosen.push(...takeWithArtistLimit(rankedEntries, roundSize - chosen.length, usedKeys, artistCounts, Infinity));
  }
  return chosen;
}

export type BuildPlaylistInput = {
  /** The seed songs, which start the playlist. */
  seeds: Track[];
  picks: Track[];
  pool: CandidatePool;
  /** Songs to leave out even if the pool still ranks them, such as songs passed on in earlier rounds. */
  excludedKeys?: Iterable<string>;
  artistFeedback?: ArtistFeedback;
  size?: number;
  maxPerArtist?: number;
};

/**
 * The final playlist: the seeds and every pick first, then the best-scoring songs
 * from the pool that the user never passed on, ranked with the artist feedback. Uses the same artist limit and
 * fallback as selectRound. When the pool runs short, the playlist is shorter
 * rather than padded with songs the user didn't want.
 */
export function buildPlaylist({
  seeds,
  picks,
  pool,
  excludedKeys = [],
  artistFeedback,
  size = defaultPlaylistSize,
  maxPerArtist = defaultPlaylistArtistLimit,
}: BuildPlaylistInput): Track[] {
  const playlist: Track[] = [];
  const usedKeys = new Set<string>();
  const artistCounts = new Map<string, number>();
  const leftOut = new Set(excludedKeys);

  for (const track of [...seeds, ...picks]) {
    if (playlist.length >= size || usedKeys.has(track.trackKey)) continue;
    playlist.push(track);
    usedKeys.add(track.trackKey);
    const artistKey = makeArtistKey(track.artist);
    artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
  }

  const rankedEntries = rankEntries(pool, artistFeedback).filter((entry) => !leftOut.has(entry.track.trackKey));
  playlist.push(...takeWithArtistLimit(rankedEntries, size - playlist.length, usedKeys, artistCounts, maxPerArtist));
  if (playlist.length < size) {
    playlist.push(...takeWithArtistLimit(rankedEntries, size - playlist.length, usedKeys, artistCounts, Infinity));
  }
  return playlist;
}
