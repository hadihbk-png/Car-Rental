import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// node-postgres for both local PostgreSQL and Neon. In production DATABASE_URL is Neon's
// pooled URL; interactive transactions with SELECT ... FOR UPDATE need a real connection,
// so the Neon HTTP driver is deliberately not used.

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle (same query API as Db). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { driveEasyPool?: Pool; driveEasyDb?: Db };

function createPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 10_000,
  });
  // An idle client erroring (e.g. the server restarted) must not crash the process.
  pool.on("error", (err) => console.error(JSON.stringify({ level: "error", msg: "pg pool error", error: err.message })));
  return pool;
}

export const pool: Pool = globalForDb.driveEasyPool ?? createPool();
export const db: Db = globalForDb.driveEasyDb ?? drizzle(pool, { schema });

if (process.env.NODE_ENV !== "production") {
  // Survive Next.js dev hot reloads without leaking pools.
  globalForDb.driveEasyPool = pool;
  globalForDb.driveEasyDb = db;
}

export { schema };
