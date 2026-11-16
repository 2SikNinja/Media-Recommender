import { createHash } from "node:crypto";

import { unstable_rethrow } from "next/navigation";

import { ApiError } from "./apiErrors";
import type { Db } from "./dbTypes";

type Limit = { limit: number; windowSeconds: number };

/**
 * How many requests one client can make per window, by kind of request. Set
 * well above what a person clicking through the app needs, and low enough
 * that a script can't burn through the Last.fm, Deezer or YouTube quotas.
 */
export const rateLimits = {
  /** Typing in the search box, debounced. */
  search: { limit: 60, windowSeconds: 60 },
  /** Starting a new playlist: several Last.fm calls each. */
  createSession: { limit: 10, windowSeconds: 60 },
  /** Picks and rerolls: Last.fm calls each. */
  sessionAction: { limit: 40, windowSeconds: 60 },
  /** Loading a session or playlist: database only. */
  read: { limit: 120, windowSeconds: 60 },
  /** Removing songs and putting them back. */
  editPlaylist: { limit: 120, windowSeconds: 60 },
  /** Opening in YouTube Music: up to 50 YouTube searches each. */
  youtubeExport: { limit: 10, windowSeconds: 60 },
  /** Covers and previews: a round shows 10 at once, and the CDN absorbs repeats. */
  media: { limit: 300, windowSeconds: 60 },
} satisfies Record<string, Limit>;

export type RateLimitBucket = keyof typeof rateLimits;

/** Old windows are cleaned up on about one request in this many. */
const cleanupEvery = 50;

/**
 * Identifies the client by IP address, hashed so it isn't stored. On Vercel,
 * x-forwarded-for is set by the platform and can't be spoofed by the client.
 */
export function clientKeyFor(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(`pickify:${ip}`).digest("hex").slice(0, 32);
}

type HitRow = { hits: number; retry_after: number };

/**
 * Counts a request against the client's limit for `bucket`, and throws a
 * rateLimited error once it's over. If the database can't be reached the
 * request is allowed, since the real work would fail anyway and a broken
 * limiter shouldn't take the app down with it.
 */
export async function enforceRateLimit(
  db: Db,
  request: Request,
  bucket: RateLimitBucket,
  options: { now?: Date; random?: () => number } = {},
): Promise<void> {
  // Read first and outside the try: during prerendering, reading headers throws
  // Next.js's signal that the route is dynamic, which must not be caught.
  const clientKey = clientKeyFor(request);
  const { limit, windowSeconds } = rateLimits[bucket];
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;

  let row: HitRow | undefined;
  try {
    [row] = await db.query<HitRow>(
      `with hit as (
         insert into rate_limit_hits (bucket, client_key, window_start)
         values ($1, $2, date_bin(make_interval(secs => $3), $4::timestamptz, timestamptz '2000-01-01'))
         on conflict (bucket, client_key, window_start) do update set hits = rate_limit_hits.hits + 1
         returning hits, window_start
       )
       select hits, ceil(extract(epoch from window_start + make_interval(secs => $3) - $4::timestamptz))::int as retry_after
         from hit`,
      [bucket, clientKey, windowSeconds, now.toISOString()],
    );
    if (random() < 1 / cleanupEvery) {
      await db.query("delete from rate_limit_hits where window_start < $1::timestamptz - interval '1 hour'", [now.toISOString()]);
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[rateLimit:${bucket}] couldn't check the limit, allowing the request`, error);
    return;
  }

  if (row && row.hits > limit) {
    throw new ApiError("rateLimited", "You're going a bit fast. Wait a moment and try again.", {
      retryAfterSeconds: Math.max(1, row.retry_after),
    });
  }
}
