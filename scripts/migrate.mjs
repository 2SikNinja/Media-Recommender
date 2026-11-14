/**
 * Applies the SQL files in db/migrations that haven't run yet, in name order.
 *
 * Usage: npm run db:migrate
 *
 * Reads DATABASE_URL_UNPOOLED (preferred for schema changes) or DATABASE_URL
 * from the environment or .env.local. Each file runs in its own transaction and
 * is recorded in schema_migrations, so running this twice is safe.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

const defaultMigrationsDir = fileURLToPath(new URL("../db/migrations/", import.meta.url));

// Arbitrary constant so two migration runs can't overlap.
const migrationLockId = 7461923;

/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} client
 * @param {string} [migrationsDir]
 * @returns {Promise<string[]>} names of the migrations that were applied
 */
export async function runMigrations(client, migrationsDir = defaultMigrationsDir) {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  await client.query("select pg_advisory_lock($1)", [migrationLockId]);
  try {
    const appliedResult = await client.query("select name from schema_migrations");
    const appliedNames = new Set(appliedResult.rows.map((row) => row.name));

    const migrationFiles = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
    const newlyApplied = [];

    for (const migrationFile of migrationFiles) {
      if (appliedNames.has(migrationFile)) continue;

      const migrationSql = await readFile(join(migrationsDir, migrationFile), "utf8");
      await client.query("begin");
      try {
        await client.query(migrationSql);
        await client.query("insert into schema_migrations (name) values ($1)", [migrationFile]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${migrationFile} failed: ${error.message}`, { cause: error });
      }
      newlyApplied.push(migrationFile);
    }
    return newlyApplied;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [migrationLockId]);
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED) in .env.local first.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const appliedNames = await runMigrations(client);
    if (appliedNames.length === 0) {
      console.log("Database is up to date.");
    } else {
      for (const name of appliedNames) console.log(`Applied ${name}`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
