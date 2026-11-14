import "server-only";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cachedSql: NeonQueryFunction<false, false> | null = null;

/**
 * SQL tag for API routes, using Neon's HTTP driver (no connection pool to manage
 * in serverless functions). Values passed in the template are sent as query
 * parameters, never pasted into the SQL text:
 *
 *   const sql = getSql();
 *   const rows = await sql`select * from sessions where id = ${sessionId}`;
 *
 * The "server-only" import makes the build fail if this ends up in browser code.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (cachedSql) return cachedSql;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  cachedSql = neon(databaseUrl);
  return cachedSql;
}
