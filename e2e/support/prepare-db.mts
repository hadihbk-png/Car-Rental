// Runs before the Playwright web server starts (see playwright.config.ts):
// clean driveeasy_qa, apply every migration in drizzle/, then seed.
// Set E2E_SKIP_DB_RESET=1 to keep the current QA data (e.g. while debugging).
import { qaDatabaseUrl, resetAndMigrate, seedQaDatabase } from "../../tests/support/qa-db";

if (process.env.E2E_SKIP_DB_RESET === "1") {
  console.log("[qa] E2E_SKIP_DB_RESET=1: keeping existing driveeasy_qa data");
} else {
  const url = qaDatabaseUrl();
  const result = await resetAndMigrate(url);
  console.log(`[qa] driveeasy_qa reset; applied ${result.migrations} migration(s)`);
  const seed = await seedQaDatabase(url);
  console.log(seed.seeded ? "[qa] seeded driveeasy_qa" : `[qa] not seeded: ${seed.reason}`);
}
