// Calls Next.js route handlers directly (no server) with real Better Auth sessions.
import { randomUUID } from "node:crypto";
import { POST as authPost, GET as authGet } from "@/app/api/auth/[...all]/route";

export const APP_ORIGIN = "http://localhost:3100";

export type Session = { cookie: string; userId: string; email: string; password: string };

function cookieHeaderFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

export function authRequest(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers = new Headers({ origin: APP_ORIGIN });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${APP_ORIGIN}/api/auth${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Signs up through the real Better Auth handler and returns the session cookie. */
export async function signUp(extra: Record<string, unknown> = {}): Promise<Session & { status: number; json: unknown }> {
  const email = `qa-http-${randomUUID().slice(0, 8)}@qa.test`;
  const password = "Qa-Passw0rd!";
  const res = await authPost(authRequest("/sign-up/email", { body: { name: "QA Http", email, password, ...extra } }));
  const json = await res.json().catch(() => null);
  return {
    status: res.status,
    json,
    cookie: cookieHeaderFrom(res),
    userId: (json as { user?: { id?: string } })?.user?.id ?? "",
    email,
    password,
  };
}

export async function signIn(email: string, password: string) {
  const res = await authPost(authRequest("/sign-in/email", { body: { email, password } }));
  return { status: res.status, cookie: cookieHeaderFrom(res), json: await res.json().catch(() => null) };
}

export async function signOut(cookie: string) {
  return authPost(authRequest("/sign-out", { body: {}, cookie }));
}

export async function getSessionJson(cookie: string) {
  const res = await authGet(authRequest("/get-session", { method: "GET", cookie }));
  return res.json().catch(() => null);
}

export function getWithCookie(url: string, cookie?: string): Request {
  return new Request(new URL(url, APP_ORIGIN), { headers: cookie ? { cookie } : {} });
}
