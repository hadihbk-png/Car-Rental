import "server-only";
import type { Actor } from "@/lib/auth";
import { listBranches, listCategories } from "@/lib/fleet/catalog";
import { listFleet } from "@/lib/fleet/admin";

/** Select options for the pricing rule form. */
export async function ruleOptions(actor: Actor) {
  const [categories, fleet, branches] = await Promise.all([listCategories(), listFleet(actor), listBranches({ includeInactive: true })]);
  return {
    categories: categories.map((c) => ({ value: c.id, label: c.name })),
    vehicles: fleet.map((v) => ({ value: v.id, label: `${v.make} ${v.model} · ${v.plateNumber}` })),
    branches: branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` })),
  };
}
