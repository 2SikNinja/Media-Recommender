import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../scripts/migrate.mjs";

const testPort = 55432;

let server: PGLiteSocketServer;
let client: pg.Client;

/** Runs the real migration script over a real Postgres connection (PGlite behind a socket). */
beforeAll(async () => {
  const db = await PGlite.create();
  server = new PGLiteSocketServer({ db, port: testPort, host: "127.0.0.1" });
  await server.start();
  client = new pg.Client({ host: "127.0.0.1", port: testPort, user: "postgres", database: "postgres" });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
  await server?.stop();
});

describe("runMigrations", () => {
  it("applies the real migrations once and skips them on the next run", async () => {
    expect(await runMigrations(client)).toEqual([
      "0001_init.sql",
      "0002_multiple_picks.sql",
      "0003_album_art.sql",
      "0004_remove_playlist_tracks.sql",
      "0005_rate_limits.sql",
      "0006_artist_feedback.sql",
      "0007_start_options.sql",
    ]);
    expect(await runMigrations(client)).toEqual([]);

    const tables = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "playlist_tracks",
      "playlists",
      "rate_limit_hits",
      "schema_migrations",
      "session_rounds",
      "sessions",
      "track_cache",
    ]);
  });

  it("rolls back a failing migration and doesn't record it", async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), "pickifyMigrations"));
    await writeFile(join(migrationsDir, "0100_good.sql"), "create table migration_test_good (id int);");
    await writeFile(
      join(migrationsDir, "0101_bad.sql"),
      "create table migration_test_partial (id int); select * from table_that_does_not_exist;",
    );

    await expect(runMigrations(client, migrationsDir)).rejects.toThrow("Migration 0101_bad.sql failed");

    const recorded = await client.query("select name from schema_migrations where name like '010%'");
    expect(recorded.rows.map((row) => row.name)).toEqual(["0100_good.sql"]);
    const partialTable = await client.query("select to_regclass('migration_test_partial') as name");
    expect(partialTable.rows[0].name).toBeNull();
  });
});
