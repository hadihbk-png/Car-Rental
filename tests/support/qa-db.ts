// QA database utilities shared by the Vitest integration project and the
// Playwright server bootstrap. Everything here refuses to run against any
// database other than the QA one (name must end in "_qa"), because it drops
// schemas.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// process.cwd(), not import.meta: Playwright loads this file as CommonJS. Both runners start in the project root.
export const PROJECT_ROOT = process.cwd();
export const MIGRATIONS_FOLDER = path.join(PROJECT_ROOT, "drizzle");

/** Loads .env.local into process.env without overriding values already set. */
export function loadLocalEnv() {
  try {
    process.loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));
  } catch {
    // No .env.local (e.g. CI with real env vars). Fine.
  }
}

/** Returns QA_DATABASE_URL after checking it points at a *_qa database. */
export function qaDatabaseUrl(): string {
  loadLocalEnv();
  const url = process.env.QA_DATABASE_URL;
  if (!url) throw new Error("QA_DATABASE_URL is not set (see .env.example).");
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!/_qa$/.test(dbName)) {
    throw new Error(`Refusing to use database "${dbName}": QA tooling only runs against a database named *_qa.`);
  }
  return url;
}

export async function withClient<T>(fn: (client: pg.Client) => Promise<T>, url = qaDatabaseUrl()): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Drops every non-system schema owned by the current user (public, drizzle's
 * migration journal schema, anything else the migrations created) and
 * recreates an empty public schema. Extensions installed in public (e.g.
 * btree_gist) are dropped too, on purpose: the migrations must install what
 * they need on a clean database, exactly like a fresh Neon branch.
 */
export async function resetQaSchema(url = qaDatabaseUrl()): Promise<void> {
  await withClient(async (client) => {
    const { rows } = await client.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
          AND (nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
               OR nspname IN ('public', 'drizzle'))`,
    );
    for (const { nspname } of rows) {
      await client.query(`DROP SCHEMA IF EXISTS ${pg.escapeIdentifier(nspname)} CASCADE`);
    }
    await client.query("CREATE SCHEMA public");
  }, url);
}

export type MigrationResult = { folderExists: boolean; migrations: number; tags: string[] };

/** Reads drizzle/meta/_journal.json, if any, without touching the database. */
export function readMigrationJournal(): MigrationResult {
  const journal = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  if (!existsSync(journal)) return { folderExists: existsSync(MIGRATIONS_FOLDER), migrations: 0, tags: [] };
  const entries = (JSON.parse(readFileSync(journal, "utf8")).entries ?? []) as { tag: string }[];
  return { folderExists: true, migrations: entries.length, tags: entries.map((e) => e.tag) };
}

/** Applies whatever migrations exist in drizzle/ using drizzle's own migrator. */
export async function runMigrations(url = qaDatabaseUrl()): Promise<MigrationResult> {
  const info = readMigrationJournal();
  if (info.migrations === 0) return info;
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
  return info;
}

/** Clean schema + all migrations. Used before every integration run and e2e run. */
export async function resetAndMigrate(url = qaDatabaseUrl()): Promise<MigrationResult> {
  await resetQaSchema(url);
  return runMigrations(url);
}

/**
 * Empties every table in public (keeps schema and migration journal). Faster
 * than a full reset between test files.
 */
export async function truncateAllTables(url = qaDatabaseUrl()): Promise<void> {
  await withClient(async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    if (rows.length === 0) return;
    const list = rows.map((r) => `public.${pg.escapeIdentifier(r.tablename)}`).join(", ");
    await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }, url);
}

/**
 * Seed hook (phase B). Runs the project's seed script against the QA database
 * if one exists (`db:seed` in package.json). The Database Engine Agent owns
 * the seed; QA only points it at driveeasy_qa.
 */
export async function seedQaDatabase(url = qaDatabaseUrl()): Promise<{ seeded: boolean; reason?: string }> {
  const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  if (!pkg.scripts?.["db:seed"]) return { seeded: false, reason: "no db:seed script yet" };
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("pnpm", ["run", "db:seed"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`db:seed failed with exit code ${result.status}`);
  return { seeded: true };
}
