/** URL state for the booking flow: vehicle + trip + extras ("extras=<id>:<qty>,<id>:<qty>"). */
import { parseSearchFilters, serializeSearchFilters, type RawSearchParams, type SearchFilters } from "./search-params";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExtraSelection {
  extraId: string;
  quantity: number;
}

export interface BookingParams {
  vehicleId: string | null;
  trip: Pick<SearchFilters, "pickupBranch" | "returnBranch" | "pickupDate" | "pickupTime" | "returnDate" | "returnTime">;
  extras: ExtraSelection[];
}

export function serializeExtras(extras: readonly ExtraSelection[]): string {
  return extras
    .filter((e) => e.quantity > 0)
    .map((e) => `${e.extraId}:${e.quantity}`)
    .join(",");
}

export function parseExtras(value: string | null | undefined): ExtraSelection[] {
  if (!value) return [];
  const out: ExtraSelection[] = [];
  for (const part of value.split(",").slice(0, 20)) {
    const [id, qty = "1"] = part.split(":");
    const quantity = /^\d{1,2}$/.test(qty) ? Number(qty) : 0;
    if (UUID_RE.test(id) && quantity >= 1 && quantity <= 10 && !out.some((e) => e.extraId === id)) {
      out.push({ extraId: id.toLowerCase(), quantity });
    }
  }
  return out;
}

function first(input: RawSearchParams, key: string): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  const v = input[key];
  return Array.isArray(v) ? v[0] : v;
}

export function parseBookingParams(input: RawSearchParams): BookingParams {
  const f = parseSearchFilters(input);
  const vehicle = first(input, "vehicle");
  return {
    vehicleId: vehicle && UUID_RE.test(vehicle) ? vehicle.toLowerCase() : null,
    trip: {
      pickupBranch: f.pickupBranch,
      returnBranch: f.returnBranch,
      pickupDate: f.pickupDate,
      pickupTime: f.pickupTime,
      returnDate: f.returnDate,
      returnTime: f.returnTime,
    },
    extras: parseExtras(first(input, "extras")),
  };
}

/** "?vehicle=...&pickupBranch=...&extras=..." */
export function bookingQuery(params: { vehicleId: string; trip: BookingParams["trip"]; extras: readonly ExtraSelection[] }): string {
  const sp = new URLSearchParams({ vehicle: params.vehicleId });
  for (const [k, v] of serializeSearchFilters(params.trip)) sp.set(k, v);
  const extras = serializeExtras(params.extras);
  if (extras) sp.set("extras", extras);
  return `?${sp.toString()}`;
}
