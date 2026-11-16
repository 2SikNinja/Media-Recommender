import type { Db } from "./dbTypes";
import type { SimilarTrack, Track } from "./tracks";

/** Similar-track lists change slowly, so a cached list is reused for this long. */
export const similarTracksMaxAgeDays = 30;

export type MusicSource = {
  getSimilarTracks(artist: string, title: string, limit?: number): Promise<SimilarTrack[]>;
};

type CachedSimilarRow = { similar_tracks: SimilarTrack[] | null };

/**
 * Last.fm similar tracks for a song, served from track_cache when the cached
 * list is fresh. A fetch failure is not cached, so the next call retries.
 */
export async function getSimilarTracksCached(db: Db, musicSource: MusicSource, track: Track): Promise<SimilarTrack[]> {
  const cachedRows = await db.query<CachedSimilarRow>(
    `select similar_tracks
       from track_cache
      where track_key = $1
        and similar_tracks is not null
        and similar_fetched_at > now() - make_interval(days => $2)`,
    [track.trackKey, similarTracksMaxAgeDays],
  );
  if (cachedRows[0]?.similar_tracks) {
    return cachedRows[0].similar_tracks;
  }

  const similarTracks = await musicSource.getSimilarTracks(track.artist, track.title);
  await db.query(
    `insert into track_cache (track_key, artist, title, duration_seconds, image_url, similar_tracks, similar_fetched_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, now())
     on conflict (track_key) do update
       set similar_tracks = excluded.similar_tracks,
           similar_fetched_at = excluded.similar_fetched_at,
           duration_seconds = coalesce(track_cache.duration_seconds, excluded.duration_seconds),
           image_url = coalesce(track_cache.image_url, excluded.image_url)`,
    [
      track.trackKey,
      track.artist.slice(0, 200),
      track.title.slice(0, 200),
      track.durationSeconds,
      track.imageUrl,
      JSON.stringify(similarTracks),
    ],
  );
  return similarTracks;
}
