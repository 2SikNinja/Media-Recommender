import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@/test/pgliteDb";

import { cleanupOldData, isAuthorizedCron } from "./cleanup";
import type { Db } from "./dbTypes";

let db: Db & { close: () => Promise<void> };

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

const now = new Date("2026-12-20T12:00:00Z");

async function addSession(status: "picking" | "complete", updatedAt: string): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into sessions (seed_track_key, seed_artist, seed_title, status, current_round, updated_at)
     values ('illenium::feel something', 'Illenium', 'Feel Something', $1, $2, $3) returning id`,
    [status, status === "complete" ? 6 : 2, updatedAt],
  );
  await db.query(
    `insert into session_rounds (session_id, round_number, candidates) values ($1, 1, '[]'::jsonb)`,
    [row.id],
  );
  return row.id;
}

describe("cleanupOldData", () => {
  it("deletes unfinished sessions untouched for 30 days, with their rounds", async () => {
    const abandoned = await addSession("picking", "2026-11-01T00:00:00Z");
    const recent = await addSession("picking", "2026-12-10T00:00:00Z");
    const finished = await addSession("complete", "2026-10-01T00:00:00Z");

    const result = await cleanupOldData(db, now);

    expect(result.abandonedSessions).toBe(1);
    const left = await db.query<{ id: string }>("select id from sessions order by id");
    expect(left.map((row) => row.id).sort()).toEqual([recent, finished].sort());
    const rounds = await db.query("select 1 from session_rounds where session_id = $1", [abandoned]);
    expect(rounds).toHaveLength(0);
  });

  it("deletes rate-limit windows older than a day and keeps recent ones", async () => {
    await db.query(
      `insert into rate_limit_hits (bucket, client_key, window_start) values
         ('search', 'a', '2026-12-18T12:00:00Z'),
         ('search', 'a', '2026-12-20T11:59:00Z')`,
    );

    const result = await cleanupOldData(db, now);

    expect(result.rateLimitRows).toBe(1);
    const left = await db.query<{ window_start: Date }>("select window_start from rate_limit_hits");
    expect(left).toHaveLength(1);
  });
});

describe("isAuthorizedCron", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron("Bearer s3cret-value", "s3cret-value")).toBe(true);
    expect(isAuthorizedCron("Bearer wrong", "s3cret-value")).toBe(false);
    expect(isAuthorizedCron(null, "s3cret-value")).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer anything", "")).toBe(false);
  });
});
