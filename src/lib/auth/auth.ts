import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { appBaseUrl, clientIpHeaders, deploymentOrigins } from "@/lib/platform";

// Better Auth server instance. Reads BETTER_AUTH_SECRET from the environment. The base URL is
// BETTER_AUTH_URL, else APP_URL, else the platform URL (Netlify URL / deploy-preview URL, Vercel URL).

function trustedOrigins(): string[] {
  const origins = new Set(deploymentOrigins());
  if (process.env.NODE_ENV !== "production") {
    // Local team ports: App 3000, QA 3100, DB engine 3200.
    for (const port of [3000, 3100, 3200]) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return [...origins];
}

export const auth = betterAuth({
  appName: "DriveEasy",
  baseURL: appBaseUrl(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),
  advanced: {
    database: { generateId: "uuid" },
    cookiePrefix: "driveeasy",
    // Rate limits key on the client IP; read it only from headers the platform edge sets
    // (Netlify x-nf-client-connection-ip, Vercel x-real-ip), so clients cannot spoof it.
    ipAddress: { ipAddressHeaders: clientIpHeaders() },
  },
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      // Never settable by the client (input: false); admins are promoted in the database.
      role: { type: "string", required: false, defaultValue: "customer", input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  // nextCookies must be the last plugin.
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
