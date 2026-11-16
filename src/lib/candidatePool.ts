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
  /** Set when the user rerolled past this song. It stays out of rounds and the playlist for good. */
  rejected?: boolean;
};

export type CandidatePool = Record<string, PoolEntry>;

export const defaultRoundSize = 10;
export const defaultPlaylistSize = 50;
const defaultRoundArtistLimit = 2;
const defaultPlaylistArtistLimit = 3;
const defaultSkippedPenalty = 0.6;

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
 * Lowers the score of songs that were shown in a round but not picked. They are
 * already excluded from later rounds, so this only matters for the final playlist.
 */
export function penalizeSkipped(
  pool: CandidatePool,
  shownKeys: string[],
  pickedKeys: Iterable<string>,
  penalty = defaultSkippedPenalty,
): CandidatePool {
  const picked = new Set(pickedKeys);
  const nextPool: CandidatePool = { ...pool };
  for (const shownKey of shownKeys) {
    const entry = nextPool[shownKey];
    if (!picked.has(shownKey) && entry) {
      nextPool[shownKey] = { ...entry, score: entry.score * penalty };
    }
  }
  return nextPool;
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

function rankEntries(pool: CandidatePool): PoolEntry[] {
  return Object.values(pool).filter((entry) => !entry.rejected).sort(
    (first, second) =>
      second.score - first.score ||
      second.hits - first.hits ||
      first.track.trackKey.localeCompare(second.track.trackKey),
  );
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
};

/**
 * The next set of choices: the highest-scoring songs the user hasn't seen yet,
 * with at most a couple per artist so the round stays varied. If the artist
 * limit leaves the round short, it is filled without the limit.
 */
export function selectRound(
  pool: CandidatePool,
  excludedKeys: Iterable<string>,
  { roundSize = defaultRoundSize, maxPerArtist = defaultRoundArtistLimit }: SelectRoundOptions = {},
): Track[] {
  const rankedEntries = rankEntries(pool);
  const usedKeys = new Set(excludedKeys);
  const artistCounts = new Map<string, number>();

  const chosen = takeWithArtistLimit(rankedEntries, roundSize, usedKeys, artistCounts, maxPerArtist);
  if (chosen.length < roundSize) {
    chosen.push(...takeWithArtistLimit(rankedEntries, roundSize - chosen.length, usedKeys, artistCounts, Infinity));
  }
  return chosen;
}

export type BuildPlaylistInput = {
  seed: Track;
  picks: Track[];
  pool: CandidatePool;
  size?: number;
  maxPerArtist?: number;
};

/**
 * The final playlist: the seed and every pick first, then the best-scoring songs
 * from the pool. Uses the same artist limit and fallback as selectRound.
 */
export function buildPlaylist({
  seed,
  picks,
  pool,
  size = defaultPlaylistSize,
  maxPerArtist = defaultPlaylistArtistLimit,
}: BuildPlaylistInput): Track[] {
  const playlist: Track[] = [];
  const usedKeys = new Set<string>();
  const artistCounts = new Map<string, number>();

  for (const track of [seed, ...picks]) {
    if (playlist.length >= size || usedKeys.has(track.trackKey)) continue;
    playlist.push(track);
    usedKeys.add(track.trackKey);
    const artistKey = makeArtistKey(track.artist);
    artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
  }

  const rankedEntries = rankEntries(pool);
  playlist.push(...takeWithArtistLimit(rankedEntries, size - playlist.length, usedKeys, artistCounts, maxPerArtist));
  if (playlist.length < size) {
    playlist.push(...takeWithArtistLimit(rankedEntries, size - playlist.length, usedKeys, artistCounts, Infinity));
  }
  return playlist;
}
