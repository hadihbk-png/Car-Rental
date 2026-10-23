// SRCH-*: search with real availability and filters. CAL-*: availability calendar.
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { branches, pricingRules, vehicles } from "@/db/schema";
import { getAvailabilityCalendar, searchVehicles, zonedTimeToUtc } from "@/lib/availability";
import { getBranch, listBranches } from "@/lib/fleet/catalog";
import { createReservation } from "@/lib/reservations";
import { bookingInput, createWorld, HOUR, installFakePayments, insertMaintenanceRaw, insertReservationRaw, PRICES, type World } from "../support/fixtures";

beforeAll(() => {
  installFakePayments();
});

/** Local Dubai date `n` days from today, as YYYY-MM-DD. */
function dubaiDate(n: number) {
  const d = new Date(Date.now() + 4 * HOUR + n * 24 * HOUR);
  return d.toISOString().slice(0, 10);
}
const at = (date: string, time: string) => zonedTimeToUtc(date, time, "Asia/Dubai");

describe("SRCH: search", () => {
  let w: World;
  let d: string[];
  beforeAll(async () => {
    w = await createWorld({ vehicleCount: 4 }); // 0: auto petrol 5 seats; 1: manual diesel 7; 2: auto petrol 5; 3: manual diesel 7
    d = Array.from({ length: 12 }, (_, i) => dubaiDate(10 + i));
    // vehicle 0 booked [D2 10:00, D4 10:00)
    await insertReservationRaw(w, at(d[2], "10:00"), at(d[4], "10:00"), "CONFIRMED", { vehicleId: w.vehicles[0].id });
    // vehicle 1 under maintenance [D2 00:00, D3 00:00)
    await insertMaintenanceRaw(w.vehicles[1].id, at(d[2], "00:00"), at(d[3], "00:00"));
    // vehicle 3 retired
    await db.update(vehicles).set({ status: "RETIRED" }).where(eq(vehicles.id, w.vehicles[3].id));
    // vehicle 2 costs more (vehicle-specific rule)
    await db.insert(pricingRules).values({ name: "QA premium", vehicleId: w.vehicles[2].id, dailyRateFils: 35_000 });
  });
  const ids = (r: Awaited<ReturnType<typeof searchVehicles>>) => r.vehicles.map((v) => v.id);
  const search = (from: string, to: string, more: Record<string, unknown> = {}) =>
    searchVehicles({ pickupBranchId: w.branchA.id, pickupAt: at(from.split(" ")[0], from.split(" ")[1]), returnAt: at(to.split(" ")[0], to.split(" ")[1]), ...more });

  it("SRCH-02 a booked vehicle is excluded only for overlapping periods ([) boundaries)", async () => {
    expect(ids(await search(`${d[1]} 10:00`, `${d[3]} 10:00`))).not.toContain(w.vehicles[0].id);
    expect(ids(await search(`${d[4]} 10:00`, `${d[6]} 10:00`))).toContain(w.vehicles[0].id); // starts when booking ends
    expect(ids(await search(`${d[0]} 10:00`, `${d[2]} 10:00`))).toContain(w.vehicles[0].id); // ends when booking starts
    expect(ids(await search(`${d[3]} 09:00`, `${d[3]} 11:00`))).not.toContain(w.vehicles[0].id);
  });

  it("SRCH-03 a vehicle in maintenance is excluded for overlapping periods", async () => {
    expect(ids(await search(`${d[2]} 12:00`, `${d[2]} 18:00`))).not.toContain(w.vehicles[1].id);
    expect(ids(await search(`${d[3]} 00:00`, `${d[4]} 00:00`))).toContain(w.vehicles[1].id);
  });

  it("SRCH-04 RETIRED vehicles never appear", async () => {
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`))).not.toContain(w.vehicles[3].id);
    expect(ids(await searchVehicles({ pickupBranchId: w.branchA.id }))).not.toContain(w.vehicles[3].id);
  });

  it("SRCH-01 results carry the period price; one-way fee and estimate follow the server rules", async () => {
    const r = await search(`${d[8]} 10:00`, `${d[11]} 10:00`, { returnBranchId: w.branchB.id });
    expect(r).toMatchObject({ rentalDays: 3, oneWayFeeFils: PRICES.oneWayAtoB, timezone: "Asia/Dubai", datesApplied: true });
    const v0 = r.vehicles.find((v) => v.id === w.vehicles[0].id)!;
    // 3 x 20000 + 15000 = 75000; VAT 3750 -> 78750
    expect(v0).toMatchObject({ dailyRateFils: 20_000, rentalFils: 60_000, estimatedTotalFils: 78_750 });
    expect(r.vehicles.find((v) => v.id === w.vehicles[2].id)?.dailyRateFils).toBe(35_000);
  });

  it("SRCH-06 filters: transmission, fuel, seats, category, price range (alone and combined)", async () => {
    const all = await search(`${d[8]} 10:00`, `${d[9]} 10:00`);
    expect(ids(all).sort()).toEqual([w.vehicles[0].id, w.vehicles[1].id, w.vehicles[2].id].sort());
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { transmission: "MANUAL" }))).toEqual([w.vehicles[1].id]);
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { fuelType: "PETROL" })).sort()).toEqual([w.vehicles[0].id, w.vehicles[2].id].sort());
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { minSeats: 6 }))).toEqual([w.vehicles[1].id]);
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { categoryId: w.category.id })).length).toBe(3);
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { categorySlug: w.category.slug })).length).toBe(3);
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { maxDailyRateFils: 25_000 })).sort()).toEqual([w.vehicles[0].id, w.vehicles[1].id].sort());
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { minDailyRateFils: 30_000 }))).toEqual([w.vehicles[2].id]);
    expect(ids(await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { fuelType: "PETROL", maxDailyRateFils: 25_000 }))).toEqual([w.vehicles[0].id]);
    expect(all.priceRange).toEqual({ minFils: 20_000, maxFils: 35_000 });
  });

  it("SRCH-07 filters that match nothing return an empty list (not an error)", async () => {
    const r = await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { fuelType: "ELECTRIC" });
    expect(r.vehicles).toEqual([]);
  });

  it("SRCH-08 invalid searches are VALIDATION errors", async () => {
    await expect(search(`${d[3]} 10:00`, `${d[2]} 10:00`)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(search(`${d[3]} 10:00`, `${d[3]} 10:00`)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      searchVehicles({ pickupBranchId: w.branchA.id, pickupAt: new Date(Date.now() - 3 * HOUR), returnAt: new Date(Date.now() + 24 * HOUR) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(searchVehicles({ pickupBranchId: w.branchA.id, pickupAt: at(d[2], "10:00") })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(searchVehicles({ pickupBranchId: "00000000-0000-4000-8000-000000000009" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("SRCH-11 sorting by price ascending / descending / name", async () => {
    const asc = await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { sort: "price_asc" });
    const desc = await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { sort: "price_desc" });
    expect(asc.vehicles.map((v) => v.dailyRateFils)).toEqual([20_000, 20_000, 35_000]);
    expect(desc.vehicles.map((v) => v.dailyRateFils)).toEqual([35_000, 20_000, 20_000]);
    const byName = await search(`${d[8]} 10:00`, `${d[9]} 10:00`, { sort: "name" });
    const names = byName.vehicles.map((v) => v.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("SRCH-05 a live hold blocks search; SRCH-09 times are interpreted in the branch zone (10:00 Dubai = 06:00Z)", async () => {
    expect(at(d[5], "10:00").toISOString().slice(11, 16)).toBe("06:00");
    const v = await createReservation(w.customer, bookingInput(w, at(d[5], "10:00"), at(d[6], "10:00"), { vehicleId: w.vehicles[2].id }));
    expect(v.status).toBe("PENDING");
    expect(ids(await search(`${d[5]} 12:00`, `${d[5]} 14:00`))).not.toContain(w.vehicles[2].id);
  });

  it("SRCH-10 inactive branches are hidden from the public list; branch lookup by slug and code", async () => {
    const x = await createWorld();
    await db.update(branches).set({ isActive: false }).where(eq(branches.id, x.branchB.id));
    const list = await listBranches();
    expect(list.map((b) => b.id)).toContain(x.branchA.id);
    expect(list.map((b) => b.id)).not.toContain(x.branchB.id);
    expect((await getBranch(x.branchA.slug)).id).toBe(x.branchA.id);
    expect((await getBranch(x.branchA.code)).id).toBe(x.branchA.id);
    await expect(searchVehicles({ pickupBranchId: x.branchB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("CAL: availability calendar", () => {
  it("CAL-01/02 days are available / partial / unavailable in branch time; busy intervals expose no customer data", async () => {
    const w = await createWorld();
    const d = Array.from({ length: 10 }, (_, i) => dubaiDate(20 + i));
    await insertReservationRaw(w, at(d[2], "10:00"), at(d[4], "10:00"), "CONFIRMED");
    await insertMaintenanceRaw(w.vehicle.id, at(d[6], "00:00"), at(d[7], "00:00"));
    const cal = await getAvailabilityCalendar({ vehicleId: w.vehicle.id, from: d[0], days: 9 });
    const status = Object.fromEntries(cal.days.map((x) => [x.date, x.status]));
    expect(status[d[1]]).toBe("available");
    expect(status[d[2]]).toBe("partial"); // from 10:00
    expect(status[d[3]]).toBe("unavailable");
    expect(status[d[4]]).toBe("partial"); // free from 10:00
    expect(status[d[5]]).toBe("available");
    expect(status[d[6]]).toBe("unavailable"); // whole-day maintenance, exactly midnight to midnight
    expect(status[d[7]]).toBe("available"); // block ends at 00:00 ([) boundary)
    expect(cal.timezone).toBe("Asia/Dubai");
    expect(cal.busy.map((b) => b.kind).sort()).toEqual(["maintenance", "reserved"]);
    for (const b of cal.busy) expect(Object.keys(b).sort()).toEqual(["end", "kind", "start"]);
    // Booking from exactly 10:00 on D4 (when the booking ends) succeeds.
    const ok = await createReservation(w.other, bookingInput(w, at(d[4], "10:00"), at(d[5], "10:00")));
    expect(ok.status).toBe("PENDING");
  });

  it("CAL-04 calendar for a retired or unknown vehicle is NOT_FOUND; out-of-range days are VALIDATION", async () => {
    const w = await createWorld();
    await expect(getAvailabilityCalendar({ vehicleId: w.vehicle.id, days: 181 })).rejects.toMatchObject({ code: "VALIDATION" });
    await db.update(vehicles).set({ status: "RETIRED" }).where(eq(vehicles.id, w.vehicle.id));
    await expect(getAvailabilityCalendar({ vehicleId: w.vehicle.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
