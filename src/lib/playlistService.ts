import { ApiError } from "./apiErrors";
import type { Db } from "./dbTypes";
import { ResolverError, type Resolver } from "./resolverClient";
import {
  buildWatchVideosUrl,
  buildYoutubeMusicUrl,
  fetchTemporaryPlaylistId,
  shuffled,
} from "./youtubeLinks";

/** A cached YouTube match is trusted for this long before it's looked up again (uploads get taken down). */
export const youtubeMatchMaxAgeDays = 30;

export type PlaylistTrack = {
  position: number;
  trackKey: string;
  artist: string;
  title: string;
  youtubeVideoId: string | null;
};

export type Playlist = {
  playlistId: string;
  sessionId: string;
  title: string;
  createdAt: string;
  /** The songs that will play, in order. */
  tracks: PlaylistTrack[];
  /** Songs taken out of the playlist, which can be put back. */
  removedTracks: PlaylistTrack[];
};

type PlaylistRow = { id: string; session_id: string; title: string; created_at: Date | string };
type PlaylistTrackRow = {
  position: number;
  is_removed: boolean;
  track_key: string;
  artist: string;
  title: string;
  youtube_video_id: string | null;
};

export async function getPlaylist(db: Db, playlistId: string): Promise<Playlist> {
  const [playlistRows, trackRows] = await Promise.all([
    db.query<PlaylistRow>("select id, session_id, title, created_at from playlists where id = $1", [playlistId]),
    db.query<PlaylistTrackRow>(
      `select position, track_key, artist, title, youtube_video_id, removed_at is not null as is_removed
         from playlist_tracks where playlist_id = $1 order by position`,
      [playlistId],
    ),
  ]);
  const playlist = playlistRows[0];
  if (!playlist) {
    throw new ApiError("notFound", "That playlist doesn't exist.");
  }
  return {
    playlistId: playlist.id,
    sessionId: playlist.session_id,
    title: playlist.title,
    createdAt: new Date(playlist.created_at).toISOString(),
    tracks: trackRows.filter((row) => !row.is_removed).map(toPlaylistTrack),
    removedTracks: trackRows.filter((row) => row.is_removed).map(toPlaylistTrack),
  };
}

function toPlaylistTrack(row: PlaylistTrackRow): PlaylistTrack {
  return {
    position: row.position,
    trackKey: row.track_key,
    artist: row.artist,
    title: row.title,
    youtubeVideoId: row.youtube_video_id,
  };
}

/**
 * Takes a song out of the playlist, or puts it back in its original place.
 * Doing either twice is harmless. The last song can't be removed, so there's
 * always something to play.
 */
export async function setTrackRemoved(db: Db, playlistId: string, position: number, removed: boolean): Promise<Playlist> {
  // Lock the playlist first, so two removals at once can't both take the last song.
  const [, rows] = await db.transaction([
    { text: "select 1 from playlists where id = $1 for update", params: [playlistId] },
    {
      text: `with target as (
       select position from playlist_tracks where playlist_id = $1 and position = $2
     ), updated as (
       update playlist_tracks
          set removed_at = case when $3::boolean then coalesce(removed_at, now()) else null end
        where playlist_id = $1 and position = $2
          and (not $3::boolean
               or (select count(*) from playlist_tracks
                    where playlist_id = $1 and removed_at is null and position <> $2) > 0)
        returning 1
     )
     select exists (select 1 from target) as found, exists (select 1 from updated) as updated`,
      params: [playlistId, position, removed],
    },
  ]);
  const result = rows[0] as { found: boolean; updated: boolean } | undefined;
  if (!result?.found) {
    // Either the playlist or the position doesn't exist; getPlaylist says which.
    await getPlaylist(db, playlistId);
    throw new ApiError("notFound", "That song isn't in this playlist.");
  }
  if (!result.updated) {
    throw new ApiError("conflict", "A playlist needs at least one song.");
  }
  return getPlaylist(db, playlistId);
}

export type YoutubeQueue = {
  /** Always works: opens the songs as a queue on YouTube. */
  youtubeUrl: string;
  /** The same queue in YouTube Music, when YouTube returned a temporary playlist ID. */
  youtubeMusicUrl: string | null;
};

export type YoutubeExport = {
  /** Each playable song's YouTube video, in playlist order, for playing on the page. */
  queue: Array<{ position: number; videoId: string }>;
  /** The playlist in its order. */
  inOrder: YoutubeQueue;
  /** The same songs in a random order. */
  shuffled: YoutubeQueue;
  trackCount: number;
  unresolvedTracks: Array<Pick<PlaylistTrack, "position" | "artist" | "title">>;
};

export type ExportDeps = {
  db: Db;
  resolver: Resolver;
  fetchImpl?: typeof fetch;
  random?: () => number;
};

type CachedMatchRow = { track_key: string; youtube_video_id: string; duration_seconds: number | null };
type DurationRow = { track_key: string; duration_seconds: number | null };

/** Builds the YouTube link for the videos and, when YouTube allows it, the YouTube Music one. */
async function buildQueue(videoIds: string[], fetchImpl: typeof fetch): Promise<YoutubeQueue> {
  const youtubeUrl = buildWatchVideosUrl(videoIds);
  const temporaryPlaylistId = await fetchTemporaryPlaylistId(youtubeUrl, fetchImpl);
  return {
    youtubeUrl,
    youtubeMusicUrl: temporaryPlaylistId ? buildYoutubeMusicUrl(videoIds[0], temporaryPlaylistId) : null,
  };
}

/**
 * Finds a YouTube video for every song in the playlist (cache first, then the
 * resolver), saves the matches, and builds the links for both play modes, so
 * the page can have them ready before anyone taps. Songs that can't be matched
 * are listed instead of failing the whole export.
 */
export async function exportPlaylistToYoutube(deps: ExportDeps, playlistId: string): Promise<YoutubeExport> {
  const { db, resolver, fetchImpl = fetch, random = Math.random } = deps;
  const playlist = await getPlaylist(db, playlistId);
  const videoIdByKey = new Map<string, string>();
  for (const track of playlist.tracks) {
    if (track.youtubeVideoId) videoIdByKey.set(track.trackKey, track.youtubeVideoId);
  }

  const missingTracks = playlist.tracks.filter((track) => !videoIdByKey.has(track.trackKey));
  if (missingTracks.length > 0) {
    const missingKeys = missingTracks.map((track) => track.trackKey);
    const [cachedMatches, durations] = await Promise.all([
      db.query<CachedMatchRow>(
        `select track_key, youtube_video_id, duration_seconds from track_cache
          where track_key = any($1::text[])
            and youtube_video_id is not null
            and youtube_resolved_at > now() - make_interval(days => $2)`,
        [missingKeys, youtubeMatchMaxAgeDays],
      ),
      db.query<DurationRow>("select track_key, duration_seconds from track_cache where track_key = any($1::text[])", [
        missingKeys,
      ]),
    ]);
    for (const match of cachedMatches) videoIdByKey.set(match.track_key, match.youtube_video_id);
    const durationByKey = new Map(durations.map((row) => [row.track_key, row.duration_seconds]));

    const toResolve = missingTracks.filter((track) => !videoIdByKey.has(track.trackKey));
    if (toResolve.length > 0) {
      try {
        const resolved = await resolver(
          toResolve.map((track) => ({
            artist: track.artist,
            title: track.title,
            durationSeconds: durationByKey.get(track.trackKey) ?? null,
          })),
        );
        const newMatches = toResolve
          .map((track, index) => ({ track, result: resolved[index] }))
          .filter(({ result }) => result?.videoId && result.source);
        for (const { track, result } of newMatches) videoIdByKey.set(track.trackKey, result.videoId as string);

        if (newMatches.length > 0) {
          await db.query(
            `insert into track_cache (track_key, artist, title, youtube_video_id, youtube_source, youtube_confidence, youtube_resolved_at)
             select match.track_key, left(match.artist, 200), left(match.title, 200), match.video_id, match.source, match.confidence, now()
               from jsonb_to_recordset($1::jsonb)
                 as match(track_key text, artist text, title text, video_id text, source text, confidence real)
             on conflict (track_key) do update
               set youtube_video_id = excluded.youtube_video_id,
                   youtube_source = excluded.youtube_source,
                   youtube_confidence = excluded.youtube_confidence,
                   youtube_resolved_at = excluded.youtube_resolved_at`,
            [
              JSON.stringify(
                newMatches.map(({ track, result }) => ({
                  track_key: track.trackKey,
                  artist: track.artist,
                  title: track.title,
                  video_id: result.videoId,
                  source: result.source,
                  confidence: result.confidence,
                })),
              ),
            ],
          );
        }
      } catch (error) {
        if (!(error instanceof ResolverError)) throw error;
        // Keep going with whatever is cached. Only fail if there is nothing to play.
        console.error("[exportPlaylistToYoutube] resolver failed", error);
        if (videoIdByKey.size === 0) {
          throw new ApiError("upstreamUnavailable", "We couldn't reach YouTube right now. Try again in a moment.");
        }
      }
    }

    const savedMatches = missingTracks
      .filter((track) => videoIdByKey.has(track.trackKey))
      .map((track) => ({ position: track.position, video_id: videoIdByKey.get(track.trackKey) }));
    if (savedMatches.length > 0) {
      await db.query(
        `update playlist_tracks set youtube_video_id = match.video_id
           from jsonb_to_recordset($2::jsonb) as match(position int, video_id text)
          where playlist_tracks.playlist_id = $1 and playlist_tracks.position = match.position`,
        [playlistId, JSON.stringify(savedMatches)],
      );
    }
  }

  const playableTracks = playlist.tracks.filter((track) => videoIdByKey.has(track.trackKey));
  if (playableTracks.length === 0) {
    throw new ApiError("noSuggestions", "We couldn't find any of these songs on YouTube.");
  }

  const videoIds = playableTracks.map((track) => videoIdByKey.get(track.trackKey) as string);
  const [inOrder, shuffledQueue] = await Promise.all([
    buildQueue(videoIds, fetchImpl),
    buildQueue(shuffled(videoIds, random), fetchImpl),
  ]);

  return {
    queue: playableTracks.map((track) => ({ position: track.position, videoId: videoIdByKey.get(track.trackKey) as string })),
    inOrder,
    shuffled: shuffledQueue,
    trackCount: videoIds.length,
    unresolvedTracks: playlist.tracks
      .filter((track) => !videoIdByKey.has(track.trackKey))
      .map(({ position, artist, title }) => ({ position, artist, title })),
  };
}
