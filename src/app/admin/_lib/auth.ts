import "server-only";
import { requireUserOrRedirect, type Actor } from "@/lib/auth";

/** Page guard: signed-out users go to login, non-admins to the home page. Services re-check. */
export function requireAdminPage(path: string): Promise<Actor> {
  return requireUserOrRedirect(path, "admin");
}
