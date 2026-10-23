import { getSession } from "@/lib/auth";
import { SiteHeader } from "./site-header";

/** Reads the session (request-time) and renders the header. Wrap in <Suspense fallback={<SiteHeader user={null} pending />}>. */
export async function SessionHeader() {
  const actor = await getSession();
  return <SiteHeader user={actor ? { name: actor.name, email: actor.email, role: actor.role } : null} />;
}
