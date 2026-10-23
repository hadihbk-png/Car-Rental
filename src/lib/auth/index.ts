import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DomainError } from "@/lib/errors";
import { auth } from "./auth";
import type { Actor, Role } from "./types";

export { auth } from "./auth";
export type { Actor, Role } from "./types";
export { isAdmin } from "./types";

/** The current user, or null when signed out. Reads the request cookies (request-time only). */
export async function getSession(requestHeaders?: Headers): Promise<Actor | null> {
  const result = await auth.api.getSession({ headers: requestHeaders ?? (await headers()) });
  if (!result) return null;
  const { user } = result;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: (user as { role?: string }).role === "admin" ? "admin" : "customer",
  };
}

/** The current user; throws DomainError("UNAUTHENTICATED") when signed out. */
export async function requireUser(requestHeaders?: Headers): Promise<Actor> {
  const actor = await getSession(requestHeaders);
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.");
  return actor;
}

/** The current admin; throws UNAUTHENTICATED / FORBIDDEN otherwise. */
export async function requireAdmin(requestHeaders?: Headers): Promise<Actor> {
  const actor = await requireUser(requestHeaders);
  if (actor.role !== "admin") throw new DomainError("FORBIDDEN", "Administrator access required.");
  return actor;
}

/** For pages: redirect to /login?next=<path> when signed out (and to / when not an admin). */
export async function requireUserOrRedirect(nextPath: string, role: Role = "customer"): Promise<Actor> {
  const actor = await getSession();
  if (!actor) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (role === "admin" && actor.role !== "admin") redirect("/");
  return actor;
}
