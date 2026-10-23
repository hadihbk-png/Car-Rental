/**
 * Vehicle search filters <-> URL search params.
 * The URL is the source of truth for the search page; these helpers only
 * sanitise formats. Ids/enum values are validated by the domain services.
 */
import { isDateString, isTimeString } from "./datetime";

/** First entry is the default and is omitted from URLs. */
export const SORT_OPTIONS = ["price-asc", "price-desc", "name"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export interface SearchFilters {
  pickupBranch?: string;
  returnBranch?: string;
  pickupDate?: string; // YYYY-MM-DD (branch local)
  pickupTime?: string; // HH:mm (branch local)
  returnDate?: string;
  returnTime?: string;
  /** Category slug. */
  category?: string;
  /** e.g. "AUTOMATIC" (values come from the search service). */
  transmission?: string;
  /** e.g. "PETROL". */
  fuel?: string;
  /** Minimum number of seats. */
  seats?: number;
  /** Daily price bounds in whole AED (the URL stays human-readable). */
  minPrice?: number;
  maxPrice?: number;
  sort?: SortOption;
  page?: number;
}

export type FilterKey = keyof SearchFilters;

/** Param order used when serialising, so URLs are stable (good for caching and sharing). */
export const FILTER_KEYS: readonly FilterKey[] = [
  "pickupBranch",
  "returnBranch",
  "pickupDate",
  "pickupTime",
  "returnDate",
  "returnTime",
  "category",
  "transmission",
  "fuel",
  "seats",
  "minPrice",
  "maxPrice",
  "sort",
  "page",
];

/** Filters that narrow the result list (not the trip itself). */
export const REFINEMENT_KEYS: readonly FilterKey[] = [
  "category",
  "transmission",
  "fuel",
  "seats",
  "minPrice",
  "maxPrice",
];

export type RawSearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/;

function readAll(input: RawSearchParams, key: string): string[] {
  if (input instanceof URLSearchParams) return input.getAll(key);
  const v = input[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function readOne(input: RawSearchParams, key: string): string | undefined {
  const first = readAll(input, key)[0];
  return first === undefined ? undefined : first.trim();
}

function token(value: string | undefined): string | undefined {
  return value && TOKEN_RE.test(value) ? value : undefined;
}

function nonNegativeInt(value: string | undefined, max = 1_000_000): number | undefined {
  if (!value || !/^\d{1,9}$/.test(value)) return undefined;
  const n = Number(value);
  return n <= max ? n : undefined;
}

/** Parses page `searchParams` (or URLSearchParams) into sanitised filters. Invalid values are dropped. */
export function parseSearchFilters(input: RawSearchParams): SearchFilters {
  const f: SearchFilters = {};
  const pickupBranch = token(readOne(input, "pickupBranch"));
  if (pickupBranch) f.pickupBranch = pickupBranch;
  const returnBranch = token(readOne(input, "returnBranch"));
  if (returnBranch) f.returnBranch = returnBranch;

  for (const key of ["pickupDate", "returnDate"] as const) {
    const v = readOne(input, key);
    if (v && isDateString(v)) f[key] = v;
  }
  for (const key of ["pickupTime", "returnTime"] as const) {
    const v = readOne(input, key);
    if (v && isTimeString(v)) f[key] = v;
  }
  for (const key of ["category", "transmission", "fuel"] as const) {
    const v = token(readOne(input, key));
    if (v) f[key] = v;
  }
  const seats = nonNegativeInt(readOne(input, "seats"), 50);
  if (seats) f.seats = seats;
  const minPrice = nonNegativeInt(readOne(input, "minPrice"));
  const maxPrice = nonNegativeInt(readOne(input, "maxPrice"));
  if (minPrice !== undefined) f.minPrice = minPrice;
  if (maxPrice !== undefined) f.maxPrice = maxPrice;
  if (f.minPrice !== undefined && f.maxPrice !== undefined && f.minPrice > f.maxPrice) {
    [f.minPrice, f.maxPrice] = [f.maxPrice, f.minPrice];
  }
  const sort = readOne(input, "sort");
  if (sort && (SORT_OPTIONS as readonly string[]).includes(sort) && sort !== SORT_OPTIONS[0]) {
    f.sort = sort as SortOption;
  }
  const page = nonNegativeInt(readOne(input, "page"), 10_000);
  if (page && page > 1) f.page = page;
  return f;
}

/** Serialises filters in a stable order, omitting empty values and defaults. */
export function serializeSearchFilters(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = filters[key];
    if (v === undefined || v === null || v === "") continue;
    if (key === "sort" && v === SORT_OPTIONS[0]) {
      continue;
    } else if (key === "page" && v === 1) {
      continue;
    } else {
      params.set(key, String(v));
    }
  }
  return params;
}

/** "?a=1&b=2" or "" when empty. */
export function toQueryString(filters: SearchFilters): string {
  const qs = serializeSearchFilters(filters).toString();
  return qs ? `?${qs}` : "";
}

/** Returns new filters with one key changed; any change other than `page` resets to page 1. */
export function withFilter<K extends FilterKey>(
  filters: SearchFilters,
  key: K,
  value: SearchFilters[K] | undefined,
): SearchFilters {
  const next: SearchFilters = { ...filters, [key]: value };
  if (value === undefined || value === "") delete next[key];
  if (key !== "page") delete next.page;
  return next;
}

/** Removes all refinements but keeps the trip (branches, dates, times) and sort. */
export function clearRefinements(filters: SearchFilters): SearchFilters {
  const next: SearchFilters = { ...filters };
  for (const key of REFINEMENT_KEYS) delete next[key];
  delete next.page;
  return next;
}

/** Number of active refinements, for the "Filters (3)" badge. Price range counts once. */
export function countRefinements(filters: SearchFilters): number {
  let n = 0;
  if (filters.category) n++;
  if (filters.transmission) n++;
  if (filters.fuel) n++;
  if (filters.seats) n++;
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) n++;
  return n;
}

/** Plain record of the params (for passing across the server/client boundary). */
export function filtersToRecord(filters: SearchFilters): Record<string, string> {
  return Object.fromEntries(serializeSearchFilters(filters));
}

/** Whether the trip part (pick-up branch and both date-times) is complete enough to search. */
export function hasCompleteTrip(filters: SearchFilters): boolean {
  return Boolean(
    filters.pickupBranch && filters.pickupDate && filters.pickupTime && filters.returnDate && filters.returnTime,
  );
}

/** Builds an href for a path with the given params record (used by Pagination and links). */
export function buildHref(pathname: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
