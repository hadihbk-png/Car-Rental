// Auth helpers against Better Auth's standard email/password endpoints.
// Adjust paths/payloads here once src/app/api/auth/[...all]/route.ts exists.
import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { withClient } from "../../tests/support/qa-db";

export const AUTH = {
  signUp: "/api/auth/sign-up/email",
  signIn: "/api/auth/sign-in/email",
  signOut: "/api/auth/sign-out",
  session: "/api/auth/get-session",
};

export const DEFAULT_PASSWORD = "Qa-Passw0rd!2026";

export type TestUser = { id?: string; name: string; email: string; password: string; role: "customer" | "admin" };

export function newUser(role: TestUser["role"] = "customer", label: string = role): TestUser {
  const tag = randomUUID().slice(0, 8);
  return { name: `QA ${label} ${tag}`, email: `qa+${label}-${tag}@driveeasy.test`, password: DEFAULT_PASSWORD, role };
}

/** Better Auth checks Origin on cookie-carrying POSTs; send the app's own origin. */
function originHeaders(baseURL: string) {
  return { origin: new URL(baseURL).origin };
}

/** Registers via the API. The request context's cookie jar receives the session cookie. */
export async function registerViaApi(request: APIRequestContext, baseURL: string, user: TestUser) {
  const res = await request.post(AUTH.signUp, {
    headers: originHeaders(baseURL),
    data: { name: user.name, email: user.email, password: user.password },
  });
  expect(res.ok(), `sign-up ${res.status()}: ${await res.text()}`).toBe(true);
  const body = await res.json().catch(() => ({}));
  user.id = body?.user?.id ?? user.id;
  return res;
}

export async function signInViaApi(request: APIRequestContext, baseURL: string, user: TestUser) {
  const res = await request.post(AUTH.signIn, {
    headers: originHeaders(baseURL),
    data: { email: user.email, password: user.password },
  });
  expect(res.ok(), `sign-in ${res.status()}: ${await res.text()}`).toBe(true);
  return res;
}

export async function signOutViaApi(request: APIRequestContext, baseURL: string) {
  return request.post(AUTH.signOut, { headers: originHeaders(baseURL), data: {} });
}

/**
 * Admins cannot self-register (role defaults to customer), so QA promotes a
 * freshly registered user directly in driveeasy_qa. Table/column names follow
 * docs/architecture.md (`users.role`); adjust if the schema differs.
 */
export async function promoteToAdmin(email: string) {
  await withClient(async (c) => {
    const res = await c.query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
    if (res.rowCount !== 1) throw new Error(`promoteToAdmin: no user ${email}`);
  });
}

/** UI login through the real login page. Selectors are placeholders until the page exists. */
export async function loginViaUi(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}
