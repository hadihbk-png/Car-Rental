/** App routes used by navigation (single place to rename a path). */
export const ROUTES = {
  home: "/",
  search: "/search",
  branches: "/branches",
  rentals: "/rentals",
  profile: "/profile",
  admin: "/admin",
  login: "/login",
  register: "/register",
} as const;

/**
 * Returns `next` only when it is a same-origin relative path ("/rentals?x=1"),
 * otherwise the fallback. Blocks "//evil.com", "/\\evil.com", "https://..." and control characters.
 */
export function safeNextPath(next: string | string[] | null | undefined, fallback = "/"): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || typeof value !== "string") return fallback;
  if (value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** "/login?next=%2Frentals" */
export function loginHref(next?: string): string {
  const safe = next ? safeNextPath(next, "") : "";
  return safe && safe !== "/" ? `${ROUTES.login}?next=${encodeURIComponent(safe)}` : ROUTES.login;
}
