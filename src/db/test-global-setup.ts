// Vitest globalSetup for the "engine" project: rebuild driveeasy_test from the migrations.
import { resetLocalDatabase, runMigrations } from "./migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("Engine tests only run against a database whose name ends in _test");
  }
  await resetLocalDatabase(url);
  await runMigrations(url);
}
