import { timingSafeEqual } from "node:crypto";

import type { Db } from "./dbTypes";

/** Unfinished sessions nobody has touched in this many days are deleted. */
export const abandonedSessionDays = 30;
/** Rate-limit windows older than this many hours are deleted. */
export const rateLimitHistoryHours = 24;

export type CleanupResult = { abandonedSessions: number; rateLimitRows: number };

/**
 * Deletes data that's no longer useful: sessions that were started but never
 * finished, and old rate-limit counters. Finished sessions are kept, since
 * their playlists can still be opened and shared. A session's rounds go with
 * it (on delete cascade).
 */
export async function cleanupOldData(db: Db, now = new Date()): Promise<CleanupResult> {
  const nowIso = now.toISOString();
  const sessions = await db.query<{ id: string }>(
    `delete from sessions
      where status = 'picking'
        and updated_at < $1::timestamptz - make_interval(days => $2)
      returning id`,
    [nowIso, abandonedSessionDays],
  );
  const rateLimitRows = await db.query<{ bucket: string }>(
    `delete from rate_limit_hits
      where window_start < $1::timestamptz - make_interval(hours => $2)
      returning bucket`,
    [nowIso, rateLimitHistoryHours],
  );
  return { abandonedSessions: sessions.length, rateLimitRows: rateLimitRows.length };
}

/**
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` with each cron request.
 * Anything else is refused, including every request when no secret is set.
 */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
