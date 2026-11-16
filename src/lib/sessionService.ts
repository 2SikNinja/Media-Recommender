import { ApiError } from "./apiErrors";
import {
  addSimilarTracks,
  buildPlaylist,
  dislikeWeight,
  pickWeight,
  rejectSkipped,
  rejectTracks,
  selectRound,
  skipWeight,
  subtractSimilarTracks,
  updateArtistFeedback,
  type ArtistFeedback,
  type CandidatePool,
} from "./candidatePool";
import type { Db, Statement } from "./dbTypes";
import { getSimilarTracksCached, type MusicSource } from "./trackCache";
import { makeTrackKey, normalizeText, type SimilarTrack, type Track } from "./tracks";

/** Fewer suggestions than this for the seed means Last.fm doesn't know it well enough. */
export const minimumFirstRoundSize = 4;

export type SessionDeps = {
  db: Db;
  musicSource: MusicSource;
  createId?: () => string;
};

export type SessionState = {
  sessionId: string;
  status: "picking" | "complete";
  seed: Track;
  /** The round waiting for a pick, or null once the session is complete. */
  currentRound: number | null;
  totalRounds: number;
  /** The choices for the current round. Empty once the session is complete. */
  candidates: Track[];
  picks: Track[];
  playlistId: string | null;
};

type SessionRow = {
  id: string;
  seed_track_key: string;
  seed_artist: string;
  seed_title: string;
  status: "picking" | "complete";
  current_round: number;
  total_rounds: number;
  candidate_pool: CandidatePool;
  artist_feedback: ArtistFeedback;
};

type RoundRow = {
  round_number: number;
  candidates: Track[];
  picked_track_keys: string[] | null;
};

/** Similar-track lookups for a round's songs run a few at a time to stay under Last.fm's rate limit. */
const similarLookupConcurrency = 4;

/** Similar songs for each track, in the same order. Cached for 30 days, so repeat lookups are free. */
async function lookupSimilar(db: Db, musicSource: MusicSource, tracks: Track[]): Promise<SimilarTrack[][]> {
  const lists: SimilarTrack[][] = [];
  for (let start = 0; start < tracks.length; start += similarLookupConcurrency) {
    const batch = tracks.slice(start, start + similarLookupConcurrency);
    lists.push(...(await Promise.all(batch.map((track) => getSimilarTracksCached(db, musicSource, track)))));
  }
  return lists;
}

/** The round's songs for the given keys, in the round's order. Throws if any key isn't one of them. */
function roundTracksFor(round: RoundRow, keys: string[], message: string): Track[] {
  const keySet = new Set(keys);
  const tracks = round.candidates.filter((track) => keySet.has(track.trackKey));
  if (tracks.length !== keySet.size) throw new ApiError("invalidRequest", message);
  return tracks;
}

type LoadedSession = {
  session: SessionRow;
  rounds: RoundRow[];
  playlistId: string | null;
};

function seedFromRow(session: SessionRow): Track {
  return {
    trackKey: session.seed_track_key,
    artist: session.seed_artist,
    title: session.seed_title,
    durationSeconds: null,
    imageUrl: null,
  };
}

/** Every picked song, round by round, in the order each round showed them. */
function pickedTracks(rounds: RoundRow[]): Track[] {
  return rounds.flatMap((round) => {
    const pickedKeys = new Set(round.picked_track_keys ?? []);
    return round.candidates.filter((track) => pickedKeys.has(track.trackKey));
  });
}

/** Every song shown in a round and not picked, including this round's (whose picks aren't saved yet). */
function skippedKeys(rounds: RoundRow[], pickedThisRound: Set<string>): Set<string> {
  const skipped = new Set<string>();
  for (const round of rounds) {
    const picked = round.picked_track_keys === null ? pickedThisRound : new Set(round.picked_track_keys);
    for (const track of round.candidates) {
      if (!picked.has(track.trackKey)) skipped.add(track.trackKey);
    }
  }
  return skipped;
}

function sameKeys(first: string[], second: string[]): boolean {
  const firstSet = new Set(first);
  const secondSet = new Set(second);
  return firstSet.size === secondSet.size && [...firstSet].every((key) => secondSet.has(key));
}

function toState({ session, rounds, playlistId }: LoadedSession): SessionState {
  const isComplete = session.status === "complete";
  const currentRoundRow = rounds.find((round) => round.round_number === session.current_round);
  return {
    sessionId: session.id,
    status: session.status,
    seed: seedFromRow(session),
    currentRound: isComplete ? null : session.current_round,
    totalRounds: session.total_rounds,
    candidates: isComplete ? [] : (currentRoundRow?.candidates ?? []),
    picks: pickedTracks(rounds),
    playlistId,
  };
}

async function loadSession(db: Db, sessionId: string): Promise<LoadedSession> {
  const sessionRows = await db.query<SessionRow>(
    `select id, seed_track_key, seed_artist, seed_title, status, current_round, total_rounds, candidate_pool, artist_feedback
       from sessions where id = $1`,
    [sessionId],
  );
  const session = sessionRows[0];
  if (!session) {
    throw new ApiError("notFound", "That session doesn't exist or has expired.");
  }

  const [rounds, playlistRows] = await Promise.all([
    db.query<RoundRow>(
      `select round_number, candidates, picked_track_keys
         from session_rounds where session_id = $1 order by round_number`,
      [sessionId],
    ),
    db.query<{ id: string }>("select id from playlists where session_id = $1", [sessionId]),
  ]);
  return { session, rounds, playlistId: playlistRows[0]?.id ?? null };
}

/** Every song shown so far plus the seed, so later rounds never repeat one. */
function seenKeys(session: SessionRow, rounds: RoundRow[]): Set<string> {
  const keys = new Set<string>([session.seed_track_key]);
  for (const round of rounds) {
    for (const track of round.candidates) keys.add(track.trackKey);
  }
  return keys;
}

export async function getSessionState(db: Db, sessionId: string): Promise<SessionState> {
  return toState(await loadSession(db, sessionId));
}

export type CreateSessionInput = { artist: string; title: string };

export async function createSession(deps: SessionDeps, input: CreateSessionInput): Promise<SessionState> {
  const { db, musicSource, createId = () => crypto.randomUUID() } = deps;
  if (!normalizeText(input.artist) || !normalizeText(input.title)) {
    throw new ApiError("invalidRequest", "Enter a song title and artist with letters or numbers in them.");
  }

  // Seeds come from Last.fm search results, so the names are already Last.fm's
  // spelling. Skipping a separate track.getInfo call keeps "Start here" fast.
  const seed: Track = {
    trackKey: makeTrackKey(input.artist, input.title),
    artist: input.artist,
    title: input.title,
    durationSeconds: null,
    imageUrl: null,
  };

  const similarTracks = await getSimilarTracksCached(db, musicSource, seed);
  const pool = addSimilarTracks({}, similarTracks, pickWeight(0));
  const candidates = selectRound(pool, [seed.trackKey]);
  if (candidates.length < minimumFirstRoundSize) {
    throw new ApiError("noSuggestions", "We couldn't find enough songs similar to that one. Try a different song.");
  }

  const sessionId = createId();
  await db.transaction([
    {
      text: `insert into sessions (id, seed_track_key, seed_artist, seed_title, candidate_pool)
             values ($1, $2, $3, $4, $5::jsonb)`,
      params: [sessionId, seed.trackKey, seed.artist, seed.title, JSON.stringify(pool)],
    },
    {
      text: "insert into session_rounds (session_id, round_number, candidates) values ($1, 1, $2::jsonb)",
      params: [sessionId, JSON.stringify(candidates)],
    },
  ]);

  return getSessionState(db, sessionId);
}

export type SubmitPickInput = {
  roundNumber: number;
  trackKeys: string[];
  /** Songs marked "Not for me" in this round. */
  dislikedKeys?: string[];
};

/**
 * Records the picks for a round (one or more songs), then either deals the next
 * round or, after the last round, builds the playlist.
 *
 * Safe to retry: sending the same picks again returns the current state, and
 * every write is guarded so two requests racing on one session can't both
 * advance it.
 */
export async function submitPick(deps: SessionDeps, sessionId: string, input: SubmitPickInput): Promise<SessionState> {
  const { db, musicSource, createId = () => crypto.randomUUID() } = deps;
  const loaded = await loadSession(db, sessionId);
  const { session, rounds } = loaded;
  const requestedKeys = [...new Set(input.trackKeys)];

  const round = rounds.find((candidateRound) => candidateRound.round_number === input.roundNumber);
  if (!round) {
    throw new ApiError("conflict", `Round ${input.roundNumber} hasn't started.`);
  }
  if (round.picked_track_keys !== null) {
    if (sameKeys(round.picked_track_keys, requestedKeys)) return toState(loaded);
    throw new ApiError("conflict", `You already picked songs for round ${input.roundNumber}.`);
  }
  if (session.status !== "picking" || session.current_round !== input.roundNumber) {
    throw new ApiError("conflict", "That round is no longer active. Refresh to see where you are.");
  }
  if (requestedKeys.length === 0) {
    throw new ApiError("invalidRequest", "Pick at least one song.");
  }

  // Keep the round's order so picks read the same way they were shown.
  const requestedKeySet = new Set(requestedKeys);
  const pickedTracksThisRound = roundTracksFor(round, requestedKeys, "One of those songs isn't one of this round's choices.");
  const dislikedTracks = roundTracksFor(
    round,
    [...new Set(input.dislikedKeys ?? [])],
    "One of the songs marked \"Not for me\" isn't one of this round's choices.",
  );
  if (dislikedTracks.some((track) => requestedKeySet.has(track.trackKey))) {
    throw new ApiError("invalidRequest", "A song can't be both picked and marked \"Not for me\".");
  }
  const dislikedKeySet = new Set(dislikedTracks.map((track) => track.trackKey));
  const skippedTracks = round.candidates.filter(
    (track) => !requestedKeySet.has(track.trackKey) && !dislikedKeySet.has(track.trackKey),
  );

  // Picks pull their similar songs up. Skips pull theirs down, gently, and
  // "Not for me" pulls theirs down as strongly as a pick pulls up.
  const [pickedSimilar, skippedSimilar, dislikedSimilar] = await Promise.all([
    lookupSimilar(db, musicSource, pickedTracksThisRound),
    lookupSimilar(db, musicSource, skippedTracks),
    lookupSimilar(db, musicSource, dislikedTracks),
  ]);
  let scoredPool = session.candidate_pool;
  for (const similarTracks of pickedSimilar) {
    scoredPool = addSimilarTracks(scoredPool, similarTracks, pickWeight(input.roundNumber));
  }
  const eachSkipWeight = skipWeight(input.roundNumber, pickedTracksThisRound.length, skippedTracks.length);
  for (const similarTracks of skippedSimilar) {
    scoredPool = subtractSimilarTracks(scoredPool, similarTracks, eachSkipWeight);
  }
  for (const similarTracks of dislikedSimilar) {
    scoredPool = subtractSimilarTracks(scoredPool, similarTracks, dislikeWeight(input.roundNumber));
  }
  const nextPool = rejectSkipped(scoredPool, round.candidates, requestedKeys);
  const artistFeedback = updateArtistFeedback(session.artist_feedback, {
    picked: pickedTracksThisRound,
    skipped: skippedTracks,
    disliked: dislikedTracks,
  });

  const nextRoundNumber = input.roundNumber + 1;
  const nextCandidates =
    input.roundNumber < session.total_rounds ? selectRound(nextPool, seenKeys(session, rounds), { artistFeedback }) : [];
  // Finish early if the pool has run dry rather than show an empty round.
  const isFinalPick = nextCandidates.length === 0;

  const statements: Statement[] = [
    {
      text: `update session_rounds set picked_track_keys = $3::text[], picked_at = now()
              where session_id = $1 and round_number = $2 and picked_track_keys is null`,
      params: [sessionId, input.roundNumber, pickedTracksThisRound.map((track) => track.trackKey)],
    },
    {
      text: `update sessions set candidate_pool = $3::jsonb, current_round = $4, status = $5, artist_feedback = $6::jsonb
              where id = $1 and current_round = $2 and status = 'picking'`,
      params: [
        sessionId,
        input.roundNumber,
        JSON.stringify(nextPool),
        nextRoundNumber,
        isFinalPick ? "complete" : "picking",
        JSON.stringify(artistFeedback),
      ],
    },
  ];

  if (!isFinalPick) {
    statements.push({
      text: `insert into session_rounds (session_id, round_number, candidates)
             select $1, $2, $3::jsonb
              where exists (select 1 from sessions where id = $1 and current_round = $2 and status = 'picking')
             on conflict do nothing`,
      params: [sessionId, nextRoundNumber, JSON.stringify(nextCandidates)],
    });
  } else {
    const seed = seedFromRow(session);
    const playlistTracks = buildPlaylist({
      seed,
      picks: [...pickedTracks(rounds), ...pickedTracksThisRound],
      pool: nextPool,
      // Also covers sessions started before skipped songs were marked in the pool.
      excludedKeys: skippedKeys(rounds, requestedKeySet),
      artistFeedback,
    });
    const playlistId = createId();
    statements.push(
      {
        text: `insert into playlists (id, session_id, title)
               select $1, $2, $3
                where exists (select 1 from sessions where id = $2 and status = 'complete')
               on conflict (session_id) do nothing`,
        params: [playlistId, sessionId, `Inspired by ${seed.title}`.slice(0, 200)],
      },
      {
        text: `insert into playlist_tracks (playlist_id, position, track_key, artist, title)
               select $1, entry.position, entry.track_key, entry.artist, entry.title
                 from jsonb_to_recordset($2::jsonb) as entry(position int, track_key text, artist text, title text)
                where exists (select 1 from playlists where id = $1)`,
        params: [
          playlistId,
          JSON.stringify(
            playlistTracks.map((track, index) => ({
              position: index + 1,
              track_key: track.trackKey,
              artist: track.artist,
              title: track.title,
            })),
          ),
        ],
      },
    );
  }

  await db.transaction(statements);
  return getSessionState(db, sessionId);
}

/**
 * "None of these": swaps the current round's 10 songs for the next best ones.
 * The rejected songs are marked in the pool so they never come back, in later
 * rounds or in the playlist.
 */
export type RerollInput = {
  roundNumber: number;
  /** Songs marked "Not for me" before swapping the round. */
  dislikedKeys?: string[];
};

/**
 * "None of these": swaps the round for unseen songs. The old ones are rejected
 * for good. Songs marked "Not for me" also pull their similar songs down; the
 * rest don't, since passing on a whole round says little about any one song.
 */
export async function rerollRound(deps: SessionDeps, sessionId: string, input: RerollInput): Promise<SessionState> {
  const { db, musicSource } = deps;
  const { roundNumber } = input;
  const { session, rounds } = await loadSession(db, sessionId);
  const round = rounds.find((candidateRound) => candidateRound.round_number === roundNumber);
  if (session.status !== "picking" || session.current_round !== roundNumber || !round || round.picked_track_keys) {
    throw new ApiError("conflict", "That round is no longer active. Refresh to see where you are.");
  }
  const dislikedTracks = roundTracksFor(
    round,
    [...new Set(input.dislikedKeys ?? [])],
    "One of the songs marked \"Not for me\" isn't one of this round's choices.",
  );

  let scoredPool = session.candidate_pool;
  for (const similarTracks of await lookupSimilar(db, musicSource, dislikedTracks)) {
    scoredPool = subtractSimilarTracks(scoredPool, similarTracks, dislikeWeight(roundNumber));
  }
  const nextPool = rejectTracks(scoredPool, round.candidates);
  const artistFeedback = updateArtistFeedback(session.artist_feedback, { disliked: dislikedTracks });

  const nextCandidates = selectRound(nextPool, seenKeys(session, rounds), { artistFeedback });
  if (nextCandidates.length === 0) {
    throw new ApiError("noSuggestions", "There are no more suggestions for this round. Pick one of these to keep going.");
  }

  await db.transaction([
    {
      text: `update session_rounds set candidates = $3::jsonb
              where session_id = $1 and round_number = $2 and picked_track_keys is null and candidates = $4::jsonb`,
      params: [sessionId, roundNumber, JSON.stringify(nextCandidates), JSON.stringify(round.candidates)],
    },
    {
      text: `update sessions set candidate_pool = $3::jsonb, artist_feedback = $4::jsonb
              where id = $1 and current_round = $2 and status = 'picking'`,
      params: [sessionId, roundNumber, JSON.stringify(nextPool), JSON.stringify(artistFeedback)],
    },
  ]);
  return getSessionState(db, sessionId);
}
