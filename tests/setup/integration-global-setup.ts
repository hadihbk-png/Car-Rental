// Vitest globalSetup for the `integration` project: start every run from a
// clean QA database with all migrations in drizzle/ applied.
import type { TestProject } from "vitest/node";
import { qaDatabaseUrl, resetAndMigrate, withClient } from "../support/qa-db";

export default async function setup(project: TestProject) {
  const url = qaDatabaseUrl();
  const started = Date.now();
  const result = await resetAndMigrate(url);
  const tables = await withClient(async (c) =>
    Number((await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'")).rows[0].n),
  );
  console.log(
    `[qa] driveeasy_qa reset; applied ${result.migrations} migration(s)` +
      (result.migrations ? ` (${result.tags.at(-1)})` : result.folderExists ? "" : " - drizzle/ does not exist yet") +
      `; ${tables} table(s) in public; ${Date.now() - started} ms`,
  );
  project.provide("qaMigrations", { count: result.migrations, tags: result.tags, tables });
}

declare module "vitest" {
  export interface ProvidedContext {
    qaMigrations: { count: number; tags: string[]; tables: number };
  }
}
