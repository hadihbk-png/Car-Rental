// OVL-*: the database itself must make overlapping active use of one vehicle impossible.
// Raw SQL inserts bypass the services on purpose.
import { beforeEach, describe, expect, it } from "vitest";
import { pgErrorCode, query } from "../support/db";
import { createWorld, future, HOUR, MIN, insertMaintenanceRaw, insertReservationRaw, type World } from "../support/fixtures";

const isOverlapError = (e: unknown) => pgErrorCode(e) === "23P01";

describe("OVL: overlap guarantees in the database", () => {
  let w: World;
  let d1: Date;
  let d3: Date;
  beforeEach(async () => {
    w = await createWorld({ vehicleCount: 2 });
    d1 = future(10, 0); // [D1 10:00-ish, D3)
    d3 = new Date(d1.getTime() + 48 * HOUR);
    await insertReservationRaw(w, d1, d3, "CONFIRMED");
  });

  it("OVL-01 rejects an overlapping CONFIRMED reservation", async () => {
    await expect(insertReservationRaw(w, new Date(d1.getTime() + 24 * HOUR), new Date(d3.getTime() + 24 * HOUR))).rejects.toSatisfy(isOverlapError);
  });

  it("OVL-02 accepts a reservation starting exactly when the previous ends", async () => {
    await expect(insertReservationRaw(w, d3, new Date(d3.getTime() + 48 * HOUR))).resolves.toBeTruthy();
  });

  it("OVL-03 accepts a reservation ending exactly when the next starts", async () => {
    await expect(insertReservationRaw(w, new Date(d1.getTime() - 24 * HOUR), d1)).resolves.toBeTruthy();
  });

  it("OVL-04 rejects contained and containing periods", async () => {
    await expect(insertReservationRaw(w, new Date(d1.getTime() + MIN), new Date(d1.getTime() + HOUR))).rejects.toSatisfy(isOverlapError);
    await expect(insertReservationRaw(w, new Date(d1.getTime() - HOUR), new Date(d3.getTime() + HOUR))).rejects.toSatisfy(isOverlapError);
    // one minute of overlap is still an overlap
    await expect(insertReservationRaw(w, new Date(d3.getTime() - MIN), new Date(d3.getTime() + HOUR))).rejects.toSatisfy(isOverlapError);
  });

  it("OVL-05 the same period on another vehicle is fine", async () => {
    await expect(insertReservationRaw(w, d1, d3, "CONFIRMED", { vehicleId: w.vehicles[1].id })).resolves.toBeTruthy();
  });

  it.each(["CANCELLED", "EXPIRED", "RETURNED", "REFUNDED"] as const)("OVL-06 a %s reservation never blocks", async (status) => {
    const other = await createWorld();
    await insertReservationRaw(other, d1, d3, status);
    await expect(insertReservationRaw(other, d1, d3, "CONFIRMED")).resolves.toBeTruthy();
  });

  it("OVL-07 a live PENDING hold blocks; PICKED_UP blocks", async () => {
    const other = await createWorld();
    await insertReservationRaw(other, d1, d3, "PENDING");
    await expect(insertReservationRaw(other, d1, d3, "CONFIRMED")).rejects.toSatisfy(isOverlapError);
    const third = await createWorld();
    await insertReservationRaw(third, d1, d3, "PICKED_UP");
    await expect(insertReservationRaw(third, d1, d3, "PENDING")).rejects.toSatisfy(isOverlapError);
  });

  it("OVL-08 maintenance blocks cannot overlap each other; back-to-back is fine", async () => {
    const v = w.vehicles[1].id;
    const s = future(30);
    const e = new Date(s.getTime() + 24 * HOUR);
    await insertMaintenanceRaw(v, s, e);
    await expect(insertMaintenanceRaw(v, new Date(s.getTime() + HOUR), new Date(e.getTime() + HOUR))).rejects.toSatisfy(isOverlapError);
    await expect(insertMaintenanceRaw(v, e, new Date(e.getTime() + HOUR))).resolves.toBeTruthy();
  });

  it("OVL-09 a maintenance block cannot overlap an active reservation (database rule)", async () => {
    await expect(insertMaintenanceRaw(w.vehicle.id, new Date(d1.getTime() + HOUR), new Date(d1.getTime() + 2 * HOUR))).rejects.toSatisfy(isOverlapError);
    await expect(insertMaintenanceRaw(w.vehicle.id, d3, new Date(d3.getTime() + HOUR))).resolves.toBeTruthy();
  });

  it("OVL-10 a reservation cannot overlap a maintenance block (database rule)", async () => {
    const v = w.vehicles[1].id;
    const s = future(40);
    await insertMaintenanceRaw(v, s, new Date(s.getTime() + 24 * HOUR));
    await expect(insertReservationRaw(w, new Date(s.getTime() - HOUR), new Date(s.getTime() + HOUR), "CONFIRMED", { vehicleId: v })).rejects.toSatisfy(isOverlapError);
    await expect(insertReservationRaw(w, new Date(s.getTime() - HOUR), new Date(s.getTime() + HOUR), "PENDING", { vehicleId: v })).rejects.toSatisfy(isOverlapError);
    await expect(insertReservationRaw(w, new Date(s.getTime() - HOUR), s, "CONFIRMED", { vehicleId: v })).resolves.toBeTruthy();
  });

  it("OVL-11 a cancelled reservation does not block a maintenance block", async () => {
    const v = w.vehicles[1].id;
    const s = future(50);
    const e = new Date(s.getTime() + 24 * HOUR);
    await insertReservationRaw(w, s, e, "CANCELLED", { vehicleId: v });
    await expect(insertMaintenanceRaw(v, s, e)).resolves.toBeTruthy();
  });

  it("OVL-12 moving a reservation's period onto another, or onto a block, is rejected", async () => {
    const later = await insertReservationRaw(w, new Date(d3.getTime() + 24 * HOUR), new Date(d3.getTime() + 48 * HOUR));
    await expect(
      query(`UPDATE reservations SET pickup_at = $2 WHERE id = $1`, [later.id, new Date(d3.getTime() - HOUR)]),
    ).rejects.toSatisfy(isOverlapError);
    const blockStart = new Date(d3.getTime() + 72 * HOUR);
    await insertMaintenanceRaw(w.vehicle.id, blockStart, new Date(blockStart.getTime() + HOUR));
    await expect(
      query(`UPDATE reservations SET return_at = $2 WHERE id = $1`, [later.id, new Date(blockStart.getTime() + 30 * MIN)]),
    ).rejects.toSatisfy(isOverlapError);
  });

  it("OVL-13 re-activating a cancelled reservation that now overlaps is rejected (reservation and block)", async () => {
    const cancelled = await insertReservationRaw(w, d1, d3, "CANCELLED");
    await expect(query(`UPDATE reservations SET status = 'CONFIRMED' WHERE id = $1`, [cancelled.id])).rejects.toSatisfy(isOverlapError);
    const v = w.vehicles[1].id;
    const s = future(60);
    const e = new Date(s.getTime() + 24 * HOUR);
    const c2 = await insertReservationRaw(w, s, e, "CANCELLED", { vehicleId: v });
    await insertMaintenanceRaw(v, s, e);
    await expect(query(`UPDATE reservations SET status = 'CONFIRMED' WHERE id = $1`, [c2.id])).rejects.toSatisfy(isOverlapError);
  });
});
