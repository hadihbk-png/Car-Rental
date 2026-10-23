import { defineConfig } from "drizzle-kit";
import { migrationDatabaseUrl } from "./src/db/urls";

// drizzle-kit does not read .env.local on its own.
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: migrationDatabaseUrl()! },
  strict: true,
});
