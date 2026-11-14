import "server-only";

import { neon } from "@neondatabase/serverless";

import type { Db } from "./dbTypes";

let cachedDb: Db | null = null;

/**
 * Database for API routes, using Neon's HTTP driver (no connection pool to
 * manage in serverless functions). Values are always passed as parameters,
 * never pasted into the SQL text.
 *
 * The "server-only" import makes the build fail if this ends up in browser code.
 */
export function getDb(): Db {
  if (cachedDb) return cachedDb;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(databaseUrl);
  cachedDb = {
    query: async (text, params = []) => (await sql.query(text, params)) as never,
    transaction: async (statements) =>
      (await sql.transaction(statements.map(({ text, params = [] }) => sql.query(text, params)))) as never,
  };
  return cachedDb;
}
