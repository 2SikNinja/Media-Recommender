import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import type { Db, Row } from "@/lib/dbTypes";

const migrationsDir = join(__dirname, "..", "..", "db", "migrations");

/** A real Postgres (in memory) with every migration applied, behind the same Db interface the app uses. */
export async function createTestDb(): Promise<Db & { close: () => Promise<void> }> {
  const pglite = await PGlite.create();
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    await pglite.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }

  return {
    query: async <T extends Row>(text: string, params: unknown[] = []) =>
      (await pglite.query<T>(text, params as never[])).rows,
    transaction: (statements) =>
      pglite.transaction(async (transaction) => {
        const results: Row[][] = [];
        for (const { text, params = [] } of statements) {
          results.push((await transaction.query<Row>(text, params as never[])).rows);
        }
        return results;
      }),
    close: () => pglite.close(),
  };
}
