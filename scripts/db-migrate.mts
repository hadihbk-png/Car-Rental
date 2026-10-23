// Applies drizzle/ migrations. Uses the unpooled (direct) URL when present, as on Vercel/Neon.
import { runMigrations } from "../src/db/migrate";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");
  process.exit(1);
}
const started = Date.now();
await runMigrations(url);
console.log(`Migrations applied (${Date.now() - started} ms) to ${new URL(url).pathname.slice(1)}`);
