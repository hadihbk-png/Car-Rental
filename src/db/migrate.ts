import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../drizzle");

/** Applies every pending migration in drizzle/ to the given database. Safe to re-run. */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

/** True for localhost / 127.0.0.1 / ::1 connection strings. */
export function isLocalDatabaseUrl(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Drops everything in public and the migration journal. Local databases only. */
export async function resetLocalDatabase(connectionString: string): Promise<void> {
  if (!isLocalDatabaseUrl(connectionString)) {
    throw new Error("Refusing to reset a non-local database");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}
