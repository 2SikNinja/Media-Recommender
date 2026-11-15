import type { Db } from "./dbTypes";
import { isDeezerImageUrl } from "./deezer";
import { makeTrackKey } from "./tracks";

const lastfmImageHosts = new Set(["lastfm.freetls.fastly.net", "lastfm-img.freetls.fastly.net"]);

/**
 * Cover URLs the art endpoint may redirect to: Deezer's image servers, and
 * Last.fm's (some songs already have a Last.fm cover saved from search or
 * similar-track results). An explicit list keeps the endpoint from being usable
 * as a redirect to arbitrary sites.
 */
export function isAllowedArtUrl(value: unknown): value is string {
  if (isDeezerImageUrl(value)) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && lastfmImageHosts.has(url.hostname);
  } catch {
    return false;
  }
}

/** A lookup that found no cover is retried after this long, in case Deezer adds one. */
export const missingArtRetryDays = 30;

export type ArtFinder = (artist: string, title: string) => Promise<string | null>;

type ArtRow = { image_url: string | null; art_is_fresh: boolean };

/**
 * The album cover for a song, from track_cache when it has been looked up
 * before, otherwise from `findArt`, with the result (found or not) saved.
 * Errors from `findArt` are not cached, so the next request tries again.
 */
export async function getAlbumArtUrl(db: Db, findArt: ArtFinder, artist: string, title: string): Promise<string | null> {
  const trackKey = makeTrackKey(artist, title);
  const rows = await db.query<ArtRow>(
    `select image_url,
            art_checked_at > now() - make_interval(days => $2) as art_is_fresh
       from track_cache where track_key = $1`,
    [trackKey, missingArtRetryDays],
  );
  const cached = rows[0];
  if (isAllowedArtUrl(cached?.image_url)) return cached.image_url;
  if (cached?.art_is_fresh) return null;

  const imageUrl = await findArt(artist, title);
  await db.query(
    `insert into track_cache (track_key, artist, title, image_url, art_checked_at)
     values ($1, left($2, 200), left($3, 200), $4, now())
     on conflict (track_key) do update
       set image_url = coalesce(excluded.image_url, track_cache.image_url),
           art_checked_at = excluded.art_checked_at`,
    [trackKey, artist, title, imageUrl],
  );
  return imageUrl;
}
