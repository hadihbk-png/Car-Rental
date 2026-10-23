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

/** On narrow viewports the header actions live in a menu. */
export async function openMenuIfCollapsed(page: Page) {
  const toggle = page.getByRole("button", { name: "Open menu" });
  if (await toggle.isVisible()) await toggle.click();
}

/** UI login through the real login page (labels from the App Agent: Email, Password, "Log in"). */
export async function loginViaUi(page: Page, user: Pick<TestUser, "email" | "password">, path = "/login") {
  await page.goto(path);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

/** UI registration (labels: Full name, Email, Password, "Create account"). */
export async function registerViaUi(page: Page, user: TestUser) {
  await page.goto("/register");
  await page.getByLabel("Full name", { exact: true }).fill(user.name);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
}

export async function logoutViaUi(page: Page) {
  await openMenuIfCollapsed(page);
  await page.getByRole("button", { name: "Log out" }).first().click();
}

export function seedLogin(role: "admin" | "customer") {
  const email = role === "admin" ? (process.env.SEED_ADMIN_EMAIL || "admin@driveeasy.test") : (process.env.SEED_CUSTOMER_EMAIL || "customer@driveeasy.test");
  const password = role === "admin" ? process.env.SEED_ADMIN_PASSWORD : process.env.SEED_CUSTOMER_PASSWORD;
  if (!password) throw new Error("SEED_*_PASSWORD not set in .env.local");
  return { email: email.toLowerCase(), password };
}
