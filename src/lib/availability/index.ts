import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { branches, vehicleCategories, vehicles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { loadVehicleCards, type VehicleCard } from "@/lib/fleet/catalog";
import { rentalDays, vatOn, vatRateBps } from "@/lib/pricing/calc";
import { dailyRateFor, loadRateRules, oneWayFeeFils, rentalWindowSchema } from "@/lib/pricing/quote";
import { parseInput, zId, zLocalDate } from "@/lib/validation";
import { addDaysToDate, localDate, zonedTimeToUtc } from "./time";

export * from "./time";

/** SQL condition: reservation row `r` currently blocks its vehicle. */
function blockingReservation(now: Date): SQL {
  return sql`(r.status IN ('CONFIRMED', 'PICKED_UP') OR (r.status = 'PENDING' AND r.hold_expires_at > ${now}::timestamptz))`;
}

/**
 * Marks PENDING holds whose hold expired and that overlap the period as EXPIRED, so they stop
 * blocking (the database exclusion constraint still counts them until then).
 * Payments/deposits of those holds are voided by the release job.
 */
export async function expireStaleHolds(tx: DbOrTx, vehicleId: string, from: Date, to: Date, now: Date): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(sql`
    UPDATE reservations SET status = 'EXPIRED', updated_at = ${now}::timestamptz
    WHERE vehicle_id = ${vehicleId}
      AND status = 'PENDING'
      AND hold_expires_at <= ${now}::timestamptz
      AND period && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')
    RETURNING id`);
  for (const { id } of result.rows) {
    await audit(
      { actor: "system", action: "reservation.expired", entityType: "reservation", entityId: id, data: { reason: "stale hold" } },
      tx,
    );
  }
  return result.rows.map((r) => r.id);
}

export type Conflicts = { reservations: number; maintenance: number };

export async function findConflicts(
  tx: DbOrTx,
  vehicleId: string,
  from: Date,
  to: Date,
  options: { now?: Date; excludeReservationId?: string } = {},
): Promise<Conflicts> {
  const now = options.now ?? new Date();
  const exclude = options.excludeReservationId ? sql`AND r.id <> ${options.excludeReservationId}` : sql``;
  const result = await tx.execute<{ reservations: number; maintenance: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM reservations r
        WHERE r.vehicle_id = ${vehicleId} AND ${blockingReservation(now)} ${exclude}
          AND r.period && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')) AS reservations,
      (SELECT count(*)::int FROM maintenance_blocks m
        WHERE m.vehicle_id = ${vehicleId}
          AND m.period && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')) AS maintenance`);
  return result.rows[0];
}

export async function isVehicleAvailable(
  tx: DbOrTx,
  vehicleId: string,
  from: Date,
  to: Date,
  options: { now?: Date; excludeReservationId?: string } = {},
): Promise<boolean> {
  const c = await findConflicts(tx, vehicleId, from, to, options);
  return c.reservations === 0 && c.maintenance === 0;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchInputSchema = z
  .object({
    pickupBranchId: zId,
    returnBranchId: zId.optional(),
    pickupAt: z.coerce.date().optional(),
    returnAt: z.coerce.date().optional(),
    categoryId: zId.optional(),
    categorySlug: z.string().max(60).optional(),
    transmission: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
    fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]).optional(),
    minSeats: z.number().int().min(1).max(15).optional(),
    /** Daily-rate bounds in fils. */
    minDailyRateFils: z.number().int().min(0).optional(),
    maxDailyRateFils: z.number().int().min(0).optional(),
    sort: z.enum(["price_asc", "price_desc", "name"]).default("price_asc"),
  })
  .refine((s) => (s.pickupAt === undefined) === (s.returnAt === undefined), {
    message: "Give both pick-up and return times, or neither",
    path: ["returnAt"],
  });
export type SearchInput = z.input<typeof searchInputSchema>;

export type SearchResultVehicle = VehicleCard & {
  dailyRateFils: number;
  rentalDays: number;
  /** dailyRate x days. */
  rentalFils: number;
  /** Rental + one-way fee + VAT, before extras. The checkout quote is authoritative. */
  estimatedTotalFils: number;
};

export type SearchResult = {
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date | null;
  returnAt: Date | null;
  timezone: string;
  rentalDays: number;
  oneWayFeeFils: number;
  /** Whether results were filtered by real availability for the dates. */
  datesApplied: boolean;
  vehicles: SearchResultVehicle[];
  /** Daily-rate range across results before the price filter (for the slider). */
  priceRange: { minFils: number; maxFils: number } | null;
};

/** Vehicle search with filters and real availability for the requested period. Public. */
export async function searchVehicles(input: SearchInput, now: Date = new Date()): Promise<SearchResult> {
  const s = parseInput(searchInputSchema, input);
  const returnBranchId = s.returnBranchId ?? s.pickupBranchId;
  const [pickupBranch] = await db.select().from(branches).where(eq(branches.id, s.pickupBranchId));
  if (!pickupBranch || !pickupBranch.isActive) throw new DomainError("NOT_FOUND", "Pick-up branch not found.");

  let pickupAt: Date | null = null;
  let returnAt: Date | null = null;
  if (s.pickupAt && s.returnAt) {
    const w = parseInput(rentalWindowSchema, { pickupBranchId: s.pickupBranchId, pickupAt: s.pickupAt, returnAt: s.returnAt });
    if (w.pickupAt.getTime() < now.getTime() - 60_000) {
      throw new DomainError("VALIDATION", "Pick-up time must be in the future.", { pickupAt: ["Must be in the future"] });
    }
    pickupAt = w.pickupAt;
    returnAt = w.returnAt;
  }
  const days = pickupAt && returnAt ? rentalDays(pickupAt, returnAt) : 1;
  const fee = await oneWayFeeFils(db, s.pickupBranchId, returnBranchId);

  const filters: SQL[] = [
    eq(vehicles.branchId, s.pickupBranchId),
    inArray(vehicles.status, ["AVAILABLE", "RESERVED", "ON_RENT"]),
  ];
  if (s.categoryId) filters.push(eq(vehicles.categoryId, s.categoryId));
  if (s.categorySlug) filters.push(eq(vehicleCategories.slug, s.categorySlug));
  if (s.transmission) filters.push(eq(vehicles.transmission, s.transmission));
  if (s.fuelType) filters.push(eq(vehicles.fuelType, s.fuelType));
  if (s.minSeats) filters.push(sql`${vehicles.seats} >= ${s.minSeats}`);
  if (pickupAt && returnAt) {
    filters.push(sql`NOT EXISTS (SELECT 1 FROM reservations r WHERE r.vehicle_id = ${vehicles.id}
      AND ${blockingReservation(now)}
      AND r.period && tstzrange(${pickupAt}::timestamptz, ${returnAt}::timestamptz, '[)'))`);
    filters.push(sql`NOT EXISTS (SELECT 1 FROM maintenance_blocks m WHERE m.vehicle_id = ${vehicles.id}
      AND m.period && tstzrange(${pickupAt}::timestamptz, ${returnAt}::timestamptz, '[)'))`);
  }
  const candidates = await db
    .select({ id: vehicles.id, categoryId: vehicles.categoryId })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(and(...filters));

  const rules = await loadRateRules(db, {
    vehicleIds: candidates.map((c) => c.id),
    categoryIds: [...new Set(candidates.map((c) => c.categoryId))],
  });
  const ratePickup = pickupAt ?? now;
  const priced = candidates
    .map((c) => ({ ...c, rate: dailyRateFor(rules, c, pickupBranch, ratePickup, days) }))
    .filter((c): c is typeof c & { rate: number } => c.rate !== null);
  const priceRange = priced.length
    ? { minFils: Math.min(...priced.map((p) => p.rate)), maxFils: Math.max(...priced.map((p) => p.rate)) }
    : null;
  const inRange = priced.filter(
    (p) =>
      (s.minDailyRateFils === undefined || p.rate >= s.minDailyRateFils) &&
      (s.maxDailyRateFils === undefined || p.rate <= s.maxDailyRateFils),
  );
  const cards = await loadVehicleCards(inRange.map((p) => p.id));
  const vat = vatRateBps();
  const results: SearchResultVehicle[] = cards.map((card) => {
    const rate = inRange.find((p) => p.id === card.id)!.rate;
    const rentalFils = rate * days;
    return {
      ...card,
      dailyRateFils: rate,
      rentalDays: days,
      rentalFils,
      estimatedTotalFils: rentalFils + fee + vatOn(rentalFils + fee, vat),
    };
  });
  results.sort((a, b) =>
    s.sort === "name"
      ? a.name.localeCompare(b.name)
      : s.sort === "price_desc"
        ? b.dailyRateFils - a.dailyRateFils || a.name.localeCompare(b.name)
        : a.dailyRateFils - b.dailyRateFils || a.name.localeCompare(b.name),
  );
  return {
    pickupBranchId: s.pickupBranchId,
    returnBranchId,
    pickupAt,
    returnAt,
    timezone: pickupBranch.timezone,
    rentalDays: days,
    oneWayFeeFils: fee,
    datesApplied: !!pickupAt,
    vehicles: results,
    priceRange,
  };
}

// ---------------------------------------------------------------------------
// Availability calendar
// ---------------------------------------------------------------------------

export const calendarInputSchema = z.object({
  vehicleId: zId,
  /** First local date (branch time zone). Defaults to today. */
  from: zLocalDate.optional(),
  days: z.number().int().min(1).max(180).default(60),
});

export type BusyInterval = { start: Date; end: Date; kind: "reserved" | "maintenance" };
export type CalendarDay = { date: string; status: "available" | "partial" | "unavailable" };
export type AvailabilityCalendar = {
  vehicleId: string;
  timezone: string;
  from: string;
  to: string; // exclusive local date
  /** Half-open [start, end) busy intervals. No customer details. */
  busy: BusyInterval[];
  days: CalendarDay[];
};

/** Per-vehicle availability calendar in the vehicle branch's time zone. Public. */
export async function getAvailabilityCalendar(
  input: z.input<typeof calendarInputSchema>,
  now: Date = new Date(),
): Promise<AvailabilityCalendar> {
  const c = parseInput(calendarInputSchema, input);
  const [row] = await db
    .select({ timezone: branches.timezone, status: vehicles.status })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, c.vehicleId));
  if (!row || row.status === "RETIRED") throw new DomainError("NOT_FOUND", "Vehicle not found.");
  const tz = row.timezone;
  const from = c.from ?? localDate(now, tz);
  const to = addDaysToDate(from, c.days);
  const rangeStart = zonedTimeToUtc(from, "00:00", tz);
  const rangeEnd = zonedTimeToUtc(to, "00:00", tz);

  const result = await db.execute<{ start: Date; end: Date; kind: "reserved" | "maintenance" }>(sql`
    SELECT r.pickup_at AS start, r.return_at AS end, 'reserved' AS kind FROM reservations r
      WHERE r.vehicle_id = ${c.vehicleId} AND ${blockingReservation(now)}
        AND r.period && tstzrange(${rangeStart}::timestamptz, ${rangeEnd}::timestamptz, '[)')
    UNION ALL
    SELECT m.starts_at, m.ends_at, 'maintenance' FROM maintenance_blocks m
      WHERE m.vehicle_id = ${c.vehicleId}
        AND m.period && tstzrange(${rangeStart}::timestamptz, ${rangeEnd}::timestamptz, '[)')
    ORDER BY 1`);
  const busy = result.rows.map((r) => ({ start: new Date(r.start), end: new Date(r.end), kind: r.kind }));

  const days: CalendarDay[] = [];
  for (let i = 0; i < c.days; i++) {
    const date = addDaysToDate(from, i);
    const dayStart = zonedTimeToUtc(date, "00:00", tz).getTime();
    const dayEnd = zonedTimeToUtc(addDaysToDate(date, 1), "00:00", tz).getTime();
    // Merge the overlapping parts of busy intervals and measure coverage of the day.
    const parts = busy
      .map((b) => [Math.max(dayStart, b.start.getTime()), Math.min(dayEnd, b.end.getTime())] as const)
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let cursor = dayStart;
    for (const [s, e] of parts) {
      const start = Math.max(s, cursor);
      if (e > start) {
        covered += e - start;
        cursor = e;
      }
    }
    days.push({ date, status: covered === 0 ? "available" : covered >= dayEnd - dayStart ? "unavailable" : "partial" });
  }
  return { vehicleId: c.vehicleId, timezone: tz, from, to, busy, days };
}
