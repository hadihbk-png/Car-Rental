// Local only: drops every table in DATABASE_URL's database. Run `pnpm db:migrate` afterwards.
import { isLocalDatabaseUrl, resetLocalDatabase } from "../src/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (!isLocalDatabaseUrl(url) || process.env.VERCEL || process.env.NODE_ENV === "production") {
  console.error("db:reset refuses to run against a non-localhost database or in production.");
  process.exit(1);
}
await resetLocalDatabase(url);
console.log(`Reset ${new URL(url).pathname.slice(1)}: public schema and migration journal dropped.`);
