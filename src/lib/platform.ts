// Hosting-platform detection and URLs (local, Vercel, Netlify). No secrets here.
//
// Netlify sets URL (production URL), DEPLOY_PRIME_URL / DEPLOY_URL (this deploy), CONTEXT
// (production | deploy-preview | branch-deploy | dev) and NETLIFY=true in builds. Its function
// runtime provides NETLIFY_BLOBS_CONTEXT. Vercel sets VERCEL=1 and VERCEL_URL.

type Env = Record<string, string | undefined>;

export function isNetlify(env: Env = process.env): boolean {
  return env.NETLIFY === "true" || !!env.NETLIFY_BLOBS_CONTEXT || (!!env.SITE_ID && !!env.DEPLOY_ID);
}

export function isVercel(env: Env = process.env): boolean {
  return !!env.VERCEL;
}

/** Running as a deployed production build on a hosting platform (not local `next start`). */
export function isDeployedProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" && (isNetlify(env) || isVercel(env));
}

function origin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).origin;
  } catch {
    return undefined;
  }
}

/**
 * Public base URL of this deployment: BETTER_AUTH_URL / APP_URL when set; on Netlify the deploy's
 * own URL for previews and branch deploys, otherwise URL; on Vercel VERCEL_URL.
 */
export function appBaseUrl(env: Env = process.env): string | undefined {
  const explicit = origin(env.BETTER_AUTH_URL) ?? origin(env.APP_URL);
  if (explicit) return explicit;
  if (isNetlify(env)) {
    const preview = env.CONTEXT === "deploy-preview" || env.CONTEXT === "branch-deploy";
    return (preview ? origin(env.DEPLOY_PRIME_URL) : undefined) ?? origin(env.URL) ?? origin(env.DEPLOY_PRIME_URL);
  }
  if (isVercel(env)) return origin(env.VERCEL_PROJECT_PRODUCTION_URL) ?? origin(env.VERCEL_URL);
  return undefined;
}

/** Every origin this deployment can legitimately be reached on (for auth origin checks). */
export function deploymentOrigins(env: Env = process.env): string[] {
  const out = new Set<string>();
  for (const v of [env.BETTER_AUTH_URL, env.APP_URL, env.URL, env.DEPLOY_PRIME_URL, env.DEPLOY_URL, env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL]) {
    const o = origin(v);
    if (o) out.add(o);
  }
  for (const v of (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",")) {
    const o = origin(v.trim());
    if (o) out.add(o);
  }
  return [...out];
}

/**
 * Request headers that carry the real client IP on this platform (set by the platform's edge,
 * so clients cannot spoof them). AUTH_IP_HEADER (comma-separated) overrides.
 */
export function clientIpHeaders(env: Env = process.env): string[] {
  const configured = (env.AUTH_IP_HEADER ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) return configured;
  if (isNetlify(env)) return ["x-nf-client-connection-ip"];
  if (isVercel(env)) return ["x-real-ip", "x-vercel-forwarded-for"];
  return ["x-forwarded-for"];
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Local disk does not persist on Netlify Functions: refuse with the setting to change. */
export function assertPersistentDiskAvailable(setting: string, fix: string, env: Env = process.env) {
  if (isNetlify(env)) {
    throw new ConfigurationError(
      `${setting} uses the local disk, which does not persist on Netlify. Set ${fix} in the Netlify environment variables.`,
    );
  }
}
