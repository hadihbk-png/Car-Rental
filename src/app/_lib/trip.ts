import "server-only";
import { listBranches, type BranchSummary } from "@/lib/fleet/catalog";
import { parseOpeningHours } from "@/lib/ui/branch-hours";
import { zonedTimeToUtc } from "@/lib/ui/datetime";
import { serializeSearchFilters, type SearchFilters } from "@/lib/ui/search-params";
import type { BranchOption } from "@/components/search/filter-panel";

/** Branch for forms: the URL uses the branch slug as its id. */
export function toBranchOption(b: BranchSummary): BranchOption {
  const hours = parseOpeningHours(b.openingHours);
  return {
    id: b.slug,
    name: b.city && !b.name.includes(b.city) ? `${b.name}, ${b.city}` : b.name,
    timeZone: b.timezone,
    openTime: hours?.open,
    closeTime: hours?.close,
  };
}

export interface ResolvedTrip {
  pickupBranch: BranchSummary | null;
  returnBranch: BranchSummary | null;
  /** UTC instants, only when both date-times are present and valid. */
  pickupAt: Date | null;
  returnAt: Date | null;
  /** True when the user gave some but not all of the date/time fields. */
  partialDates: boolean;
}

/** Resolves branch slugs and converts branch-local dates/times to UTC. */
export function resolveTrip(filters: SearchFilters, branches: readonly BranchSummary[]): ResolvedTrip {
  const find = (slug?: string) => (slug ? (branches.find((b) => b.slug === slug || b.id === slug) ?? null) : null);
  const pickupBranch = find(filters.pickupBranch);
  const returnBranch = find(filters.returnBranch) ?? pickupBranch;
  const fields = [filters.pickupDate, filters.pickupTime, filters.returnDate, filters.returnTime];
  const given = fields.filter(Boolean).length;
  let pickupAt: Date | null = null;
  let returnAt: Date | null = null;
  if (pickupBranch && given === 4) {
    pickupAt = zonedTimeToUtc(filters.pickupDate!, filters.pickupTime!, pickupBranch.timezone);
    returnAt = zonedTimeToUtc(filters.returnDate!, filters.returnTime!, pickupBranch.timezone);
  }
  return { pickupBranch, returnBranch, pickupAt, returnAt, partialDates: given > 0 && given < 4 };
}

/** Only the trip part of the filters (branches, dates, times). */
export function tripFilters(filters: SearchFilters): SearchFilters {
  const { pickupBranch, returnBranch, pickupDate, pickupTime, returnDate, returnTime } = filters;
  return { pickupBranch, returnBranch, pickupDate, pickupTime, returnDate, returnTime };
}

/** Link to a vehicle page carrying the trip. */
export function vehicleHref(vehicleId: string, filters: SearchFilters): string {
  const qs = serializeSearchFilters(tripFilters(filters)).toString();
  return `/vehicles/${vehicleId}${qs ? `?${qs}` : ""}`;
}

/** Time zone for times not tied to a branch (e.g. upload dates): the first active branch's zone. */
export async function defaultTimeZone(): Promise<string> {
  const branches = await listBranches();
  return branches[0]?.timezone ?? "UTC";
}
