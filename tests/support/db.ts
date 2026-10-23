// Helpers for integration tests that need raw database access next to the
// app's own services (which read DATABASE_URL, set to the QA database by the
// integration project in vitest.config.mts).
import pg from "pg";
import { qaDatabaseUrl } from "./qa-db";

export { truncateAllTables, seedQaDatabase } from "./qa-db";

/** A dedicated connection (its own Postgres backend/session). Close it with end(). */
export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: qaDatabaseUrl() });
  await client.connect();
  return client;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  const client = await connect();
  try {
    return (await client.query<R>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

export type RaceOutcome<T> = { fulfilled: T[]; rejected: unknown[] };

/**
 * Concurrency harness: opens N separate connections, waits until every one is
 * connected, then fires all attempts at the same instant (a shared barrier),
 * so they genuinely race inside Postgres rather than running one after the
 * other. Each attempt gets its own client to use for its transaction.
 *
 * Typical use: two attempts to reserve the same vehicle for overlapping
 * periods; expect exactly one fulfilled and one rejected.
 */
export async function race<T>(attempts: ((client: pg.Client, index: number) => Promise<T>)[]): Promise<RaceOutcome<T>> {
  const clients = await Promise.all(attempts.map(() => connect()));
  try {
    let release!: () => void;
    const barrier = new Promise<void>((r) => (release = r));
    const runs = attempts.map(async (attempt, i) => {
      await barrier;
      return attempt(clients[i], i);
    });
    release();
    const settled = await Promise.allSettled(runs);
    return {
      fulfilled: settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : [])),
      rejected: settled.flatMap((s) => (s.status === "rejected" ? [s.reason] : [])),
    };
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
}

/**
 * Same barrier pattern for code that manages its own connections (e.g. the
 * app's reservation service using the shared pool). Pool size must be >= N
 * for a real race; the app pool default (10) is enough for 2-5 attempts.
 */
export async function raceCalls<T>(calls: (() => Promise<T>)[]): Promise<RaceOutcome<T>> {
  let release!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const runs = calls.map(async (call) => {
    await barrier;
    return call();
  });
  release();
  const settled = await Promise.allSettled(runs);
  return {
    fulfilled: settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : [])),
    rejected: settled.flatMap((s) => (s.status === "rejected" ? [s.reason] : [])),
  };
}

/** Postgres error code helper: 23P01 = exclusion_violation, 23505 = unique_violation, 40001 = serialization_failure. */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
