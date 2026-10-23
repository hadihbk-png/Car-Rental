// Reads expectations for browser tests straight from driveeasy_qa (seeded by prepare-db.mts).
// Raw SQL on purpose: specs must not import server-only app modules.
import { withClient } from "../../tests/support/qa-db";

export type BranchRow = { id: string; code: string; slug: string; name: string; address: string; city: string; is_active: boolean };

export async function activeBranches(): Promise<BranchRow[]> {
  return withClient(async (c) => (await c.query<BranchRow>("SELECT id, code, slug, name, address, city, is_active FROM branches WHERE is_active ORDER BY name")).rows);
}

/** The seeded 24-hour airport branch (any time of day is bookable). */
export async function airportBranch(): Promise<BranchRow> {
  const all = await activeBranches();
  return all.find((b) => b.code === "DXBAPT") ?? all[0];
}

/** Dubai-local date `days` from today, YYYY-MM-DD. */
export function dubaiDate(days: number): string {
  return new Date(Date.now() + 4 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

/** UTC instant of a Dubai wall-clock time (UTC+4, no DST). */
export function dubaiInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+04:00`);
}

export function searchUrl(p: { branchId: string; from: string; to: string; time?: string; extra?: Record<string, string> }) {
  const q = new URLSearchParams({
    pickupBranch: p.branchId,
    pickupDate: p.from,
    pickupTime: p.time ?? "10:00",
    returnDate: p.to,
    returnTime: p.time ?? "10:00",
    ...p.extra,
  });
  return `/search?${q}`;
}

/** Vehicles the search page should list for a branch and period (mirrors the documented rules). */
export async function expectedAvailable(branchId: string, from: Date, to: Date, where = "", params: unknown[] = []) {
  return withClient(async (c) =>
    (
      await c.query<{ id: string; make: string; model: string; transmission: string; fuel_type: string; seats: number }>(
        `SELECT v.id, v.make, v.model, v.transmission, v.fuel_type, v.seats FROM vehicles v
         WHERE v.branch_id = $1 AND v.status IN ('AVAILABLE','RESERVED','ON_RENT')
           AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.vehicle_id = v.id
               AND (r.status IN ('CONFIRMED','PICKED_UP') OR (r.status = 'PENDING' AND r.hold_expires_at > now()))
               AND r.period && tstzrange($2, $3, '[)'))
           AND NOT EXISTS (SELECT 1 FROM maintenance_blocks m WHERE m.vehicle_id = v.id AND m.period && tstzrange($2, $3, '[)'))
           AND EXISTS (SELECT 1 FROM pricing_rules p WHERE p.is_active AND (p.vehicle_id = v.id OR p.category_id = v.category_id))
           ${where}`,
        [branchId, from, to, ...params],
      )
    ).rows,
  );
}

/** A seeded future CONFIRMED reservation (for calendar checks). */
export async function seededBooking() {
  return withClient(async (c) =>
    (
      await c.query<{ vehicle_id: string; pickup_at: Date; return_at: Date }>(
        `SELECT r.vehicle_id, r.pickup_at, r.return_at FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id
         WHERE r.status = 'CONFIRMED' AND r.pickup_at > now() + interval '1 day' AND r.return_at - r.pickup_at >= interval '48 hours'
           AND v.status <> 'RETIRED'
         ORDER BY r.pickup_at LIMIT 1`,
      )
    ).rows[0],
  );
}

export async function anyVehicleAt(branchId: string) {
  return withClient(async (c) =>
    (await c.query<{ id: string; make: string; model: string }>("SELECT id, make, model FROM vehicles WHERE branch_id = $1 AND status <> 'RETIRED' LIMIT 1", [branchId])).rows[0],
  );
}
