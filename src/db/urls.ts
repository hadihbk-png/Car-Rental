// Database connection strings for every platform, in one place.
//   Local / Vercel (Neon via Marketplace): DATABASE_URL (pooled), DATABASE_URL_UNPOOLED (direct)
//   Netlify DB (Neon):                     NETLIFY_DATABASE_URL (pooled), NETLIFY_DATABASE_URL_UNPOOLED
// Explicit DATABASE_URL* settings always win over the Netlify-provided ones.

type Env = Record<string, string | undefined>;

/** Pooled URL for application requests. */
export function appDatabaseUrl(env: Env = process.env): string | undefined {
  return env.DATABASE_URL || env.NETLIFY_DATABASE_URL || undefined;
}

/** Direct (unpooled) URL for migrations; falls back to the pooled one. */
export function migrationDatabaseUrl(env: Env = process.env): string | undefined {
  return (
    env.DATABASE_URL_UNPOOLED || env.NETLIFY_DATABASE_URL_UNPOOLED || env.DATABASE_URL || env.NETLIFY_DATABASE_URL || undefined
  );
}

/** Database name for log lines (never the credentials). */
export function databaseNameOf(url: string): string {
  try {
    return new URL(url).pathname.slice(1) || "(default)";
  } catch {
    return "(unparseable url)";
  }
}
