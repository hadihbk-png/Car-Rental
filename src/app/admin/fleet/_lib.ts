import "server-only";
import { listBranches, listCategories, listFeatures } from "@/lib/fleet/catalog";

/** Select options for the vehicle form. */
export async function vehicleFormOptions() {
  const [branches, categories, features] = await Promise.all([listBranches({ includeInactive: true }), listCategories(), listFeatures()]);
  return {
    branches: branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` })),
    categories: categories.map((c) => ({ value: c.id, label: c.name })),
    features: features.map((f) => ({ value: f.id, label: f.name })),
    timeZones: Object.fromEntries(branches.map((b) => [b.id, b.timezone])) as Record<string, string>,
  };
}
