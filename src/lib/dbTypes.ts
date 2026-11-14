export type Row = Record<string, unknown>;

export type Statement = {
  text: string;
  params?: unknown[];
};

/**
 * The small slice of a Postgres client the services need. Production uses
 * Neon's HTTP driver (src/lib/db.ts); tests use an in-memory Postgres.
 */
export type Db = {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs all statements in one transaction and returns each one's rows. */
  transaction(statements: Statement[]): Promise<Row[][]>;
};
