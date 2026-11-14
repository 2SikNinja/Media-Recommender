import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const migrationsDir = join(__dirname, "migrations");

let db: PGlite;

/** Runs every migration in order against an in-memory Postgres. */
beforeAll(async () => {
  db = new PGlite();
  const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  for (const migrationFile of migrationFiles) {
    await db.exec(readFileSync(join(migrationsDir, migrationFile), "utf8"));
  }
});

async function createSession(): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into sessions (seed_track_key, seed_artist, seed_title) values ('a::b', 'A', 'B') returning id",
  );
  return result.rows[0].id;
}

describe("schema", () => {
  it("enables row level security on every table", async () => {
    const result = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace",
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true });
  });

  it("only allows one row per session round", async () => {
    const sessionId = await createSession();
    const insertRound = "insert into session_rounds (session_id, round_number, candidates) values ($1, 1, '[]')";
    await db.query(insertRound, [sessionId]);
    await expect(db.query(insertRound, [sessionId])).rejects.toThrow();
  });

  it("requires a pick to have both a track and a time", async () => {
    const sessionId = await createSession();
    await db.query("insert into session_rounds (session_id, round_number, candidates) values ($1, 1, '[]')", [sessionId]);
    await expect(
      db.query("update session_rounds set picked_track_key = 'x::y' where session_id = $1", [sessionId]),
    ).rejects.toThrow();
  });

  it("rejects invalid or incomplete YouTube matches", async () => {
    await expect(
      db.query(
        "insert into track_cache (track_key, artist, title, youtube_video_id, youtube_source, youtube_resolved_at) values ('a::1', 'a', '1', 'not-an-id', 'ytmusicSongs', now())",
      ),
    ).rejects.toThrow();
    await expect(
      db.query("insert into track_cache (track_key, artist, title, youtube_video_id) values ('a::2', 'a', '2', 'dQw4w9WgXcQ')"),
    ).rejects.toThrow();
    await db.query(
      "insert into track_cache (track_key, artist, title, youtube_video_id, youtube_source, youtube_resolved_at) values ('a::3', 'a', '3', 'dQw4w9WgXcQ', 'ytmusicVideos', now())",
    );
  });

  it("caps playlists at 50 positions with no repeated songs", async () => {
    const sessionId = await createSession();
    const playlist = await db.query<{ id: string }>(
      "insert into playlists (session_id, title) values ($1, 'Test') returning id",
      [sessionId],
    );
    const playlistId = playlist.rows[0].id;
    const insertTrack =
      "insert into playlist_tracks (playlist_id, position, track_key, artist, title) values ($1, $2, $3, 'A', 'B')";

    await db.query(insertTrack, [playlistId, 1, "a::b"]);
    await expect(db.query(insertTrack, [playlistId, 2, "a::b"])).rejects.toThrow();
    await expect(db.query(insertTrack, [playlistId, 51, "a::c"])).rejects.toThrow();
  });

  it("deletes rounds and playlists along with their session", async () => {
    const sessionId = await createSession();
    await db.query("insert into session_rounds (session_id, round_number, candidates) values ($1, 1, '[]')", [sessionId]);
    await db.query("insert into playlists (session_id, title) values ($1, 'Test')", [sessionId]);

    await db.query("delete from sessions where id = $1", [sessionId]);

    const remaining = await db.query<{ count: number }>(
      "select (select count(*) from session_rounds where session_id = $1) + (select count(*) from playlists where session_id = $1) as count",
      [sessionId],
    );
    expect(Number(remaining.rows[0].count)).toBe(0);
  });
});
