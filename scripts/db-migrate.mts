// Applies drizzle/ migrations with the direct (unpooled) URL when present (Vercel / Netlify DB).
import { runMigrations } from "../src/db/migrate";
import { databaseNameOf, migrationDatabaseUrl } from "../src/db/urls";

const url = migrationDatabaseUrl();
if (!url) {
  console.error("Set DATABASE_URL_UNPOOLED / DATABASE_URL (or NETLIFY_DATABASE_URL_UNPOOLED / NETLIFY_DATABASE_URL).");
  process.exit(1);
}
const started = Date.now();
await runMigrations(url);
console.log(`Migrations applied (${Date.now() - started} ms) to ${databaseNameOf(url)}`);
