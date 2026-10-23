// CON-*: concurrent attempts for the same vehicle. Every race repeats 10 times;
// any run with two winners is a double booking (P1).
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { reservations } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createMaintenanceBlock } from "@/lib/fleet/admin";
import { createReservation, modifyReservationDates, payReservation } from "@/lib/reservations";
import { pgErrorCode, race, raceCalls } from "../support/db";
import { bookingInput, createDriver, createWorld, future, HOUR, installFakePayments, key, MIN } from "../support/fixtures";

const RUNS = 10;

async function activeCount(vehicleId: string) {
  const rows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.vehicleId, vehicleId), inArray(reservations.status, ["PENDING", "CONFIRMED", "PICKED_UP"])));
  return rows.length;
}

beforeAll(() => {
  installFakePayments();
});

describe("CON: concurrent reservations", () => {
  it(`CON-01 two customers race createReservation for overlapping periods: exactly one wins (x${RUNS})`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const w = await createWorld();
      const p = future(10 + run);
      const outcome = await raceCalls([
        () => createReservation(w.customer, bookingInput(w, p, new Date(p.getTime() + 48 * HOUR))),
        () => createReservation(w.other, bookingInput(w, new Date(p.getTime() + 24 * HOUR), new Date(p.getTime() + 72 * HOUR))),
      ]);
      expect(outcome.fulfilled, `run ${run}`).toHaveLength(1);
      expect(outcome.rejected[0], `run ${run}`).toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
      expect(await activeCount(w.vehicle.id)).toBe(1);
    }
  });

  it(`CON-02 raw transactions on separate connections (lock, check, insert, sleep, commit): one commits (x${RUNS})`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const w = await createWorld();
      const p = future(10 + run);
      const r = new Date(p.getTime() + 24 * HOUR);
      const outcome = await race(
        [0, 1].map(() => async (client) => {
          await client.query("BEGIN");
          try {
            await client.query("SELECT id FROM vehicles WHERE id = $1 FOR UPDATE", [w.vehicle.id]);
            const { rows } = await client.query(
              `SELECT count(*)::int AS n FROM reservations WHERE vehicle_id = $1
               AND status IN ('PENDING','CONFIRMED','PICKED_UP') AND period && tstzrange($2, $3, '[)')`,
              [w.vehicle.id, p, r],
            );
            if (rows[0].n > 0) throw Object.assign(new Error("unavailable"), { code: "QA_UNAVAILABLE" });
            await client.query(
              `INSERT INTO reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id, pickup_at, return_at, status,
                 hold_expires_at, idempotency_key, daily_rate_fils, rental_days, rental_fils, extras_fils, one_way_fee_fils, vat_rate_bps, tax_fils, total_fils, deposit_fils)
               VALUES ('DE-' || upper(substr(md5(random()::text), 1, 6)), $1, $2, $3, $3, $4, $5, 'PENDING', now() + interval '15 minutes', $6,
                 20000, 1, 20000, 0, 0, 500, 1000, 21000, 150000)`,
              [w.customer.id, w.vehicle.id, w.branchA.id, p, r, key("raw")],
            );
            await client.query("SELECT pg_sleep(0.1)");
            await client.query("COMMIT");
            return "committed";
          } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
          }
        }),
      );
      expect(outcome.fulfilled, `run ${run}`).toEqual(["committed"]);
      expect(["QA_UNAVAILABLE", "23P01"]).toContain(pgErrorCode(outcome.rejected[0]) ?? (outcome.rejected[0] as { code: string }).code);
      expect(await activeCount(w.vehicle.id)).toBe(1);
    }
  });

  it("CON-02b without the app's lock, the exclusion constraint alone still stops the second insert", async () => {
    for (let run = 0; run < RUNS; run++) {
      const w = await createWorld();
      const p = future(10 + run);
      const r = new Date(p.getTime() + 24 * HOUR);
      const outcome = await race(
        [0, 1].map(() => async (client) => {
          await client.query("BEGIN");
          try {
            await client.query(
              `INSERT INTO reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id, pickup_at, return_at, status,
                 idempotency_key, daily_rate_fils, rental_days, rental_fils, extras_fils, one_way_fee_fils, vat_rate_bps, tax_fils, total_fils, deposit_fils)
               VALUES ('DE-' || upper(substr(md5(random()::text), 1, 6)), $1, $2, $3, $3, $4, $5, 'CONFIRMED', $6,
                 20000, 1, 20000, 0, 0, 500, 1000, 21000, 150000)`,
              [w.customer.id, w.vehicle.id, w.branchA.id, p, r, key("raw")],
            );
            await client.query("SELECT pg_sleep(0.1)");
            await client.query("COMMIT");
            return "committed";
          } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
          }
        }),
      );
      expect(outcome.fulfilled).toHaveLength(1);
      expect(pgErrorCode(outcome.rejected[0])).toBe("23P01");
    }
  });

  it(`CON-03 five overlapping attempts: exactly one wins (x${RUNS})`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const w = await createWorld();
      const drivers = [w.customer, w.other, await createDriver(), await createDriver(), await createDriver()];
      const p = future(10 + run);
      const outcome = await raceCalls(
        drivers.map((d, i) => () => createReservation(d, bookingInput(w, new Date(p.getTime() + i * HOUR), new Date(p.getTime() + (24 + i) * HOUR)))),
      );
      expect(outcome.fulfilled, `run ${run}`).toHaveLength(1);
      expect(outcome.rejected).toHaveLength(4);
      for (const e of outcome.rejected) expect(e).toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
      expect(await activeCount(w.vehicle.id)).toBe(1);
    }
  });

  it(`CON-04 adjacent periods [D1,D3) and [D3,D5) race: both win (x${RUNS})`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const w = await createWorld();
      const p = future(10 + run);
      const mid = new Date(p.getTime() + 48 * HOUR);
      const outcome = await raceCalls([
        () => createReservation(w.customer, bookingInput(w, p, mid)),
        () => createReservation(w.other, bookingInput(w, mid, new Date(mid.getTime() + 48 * HOUR))),
      ]);
      expect(outcome.rejected, `run ${run}`).toEqual([]);
      expect(await activeCount(w.vehicle.id)).toBe(2);
    }
  });

  it(`CON-05 a stale (expired, unreleased) hold is expired in-transaction; one of two new attempts wins (x${RUNS})`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const w = await createWorld();
      const p = future(10 + run);
      const ret = new Date(p.getTime() + 24 * HOUR);
      const t0 = new Date(Date.now() - 20 * MIN);
      const stale = await createReservation(w.customer, bookingInput(w, p, ret), t0); // hold expired 5 min ago
      const third = await createDriver();
      const outcome = await raceCalls([
        () => createReservation(w.other, bookingInput(w, p, ret)),
        () => createReservation(third, bookingInput(w, p, ret)),
      ]);
      expect(outcome.fulfilled, `run ${run}`).toHaveLength(1);
      expect(outcome.rejected[0]).toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
      const [s] = await db.select().from(reservations).where(eq(reservations.id, stale.id));
      expect(s.status).toBe("EXPIRED");
      expect(await activeCount(w.vehicle.id)).toBe(1);
    }
  });

  it(`CON-06 date change vs new booking for the same new dates: exactly one wins (x${RUNS})`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const w = await createWorld();
      const p = future(10 + run);
      const original = await createReservation(w.customer, bookingInput(w, p, new Date(p.getTime() + 24 * HOUR)));
      await payReservation(w.customer, { reservationId: original.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
      const np = new Date(p.getTime() + 5 * 24 * HOUR);
      const nr = new Date(np.getTime() + 24 * HOUR);
      const outcome = await raceCalls<unknown>([
        () => modifyReservationDates(w.customer, { reservationId: original.id, pickupAt: np, returnAt: nr, paymentMethod: "fake_success", idempotencyKey: key("mod") }),
        () => createReservation(w.other, bookingInput(w, np, nr)),
      ]);
      expect(outcome.fulfilled, `run ${run}`).toHaveLength(1);
      expect(outcome.rejected[0]).toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
      const moved = await isModified(original.id, np);
      // Modification won: one active reservation at the new dates. Booking won: original untouched + new one.
      expect(await activeCount(w.vehicle.id)).toBe(moved ? 1 : 2);
      if (!moved) expect((await db.select().from(reservations).where(eq(reservations.id, original.id)))[0].pickupAt.getTime()).toBe(p.getTime());
    }
  });

  it(`CON-07 admin maintenance block vs customer booking for the same period: exactly one wins (x${RUNS})`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const w = await createWorld();
      const p = future(10 + run);
      const r = new Date(p.getTime() + 24 * HOUR);
      const outcome = await raceCalls<unknown>([
        () => createMaintenanceBlock(w.admin, { vehicleId: w.vehicle.id, startsAt: p, endsAt: r, reason: "QA service" }),
        () => createReservation(w.customer, bookingInput(w, p, r)),
      ]);
      expect(outcome.fulfilled, `run ${run}`).toHaveLength(1);
      expect(outcome.rejected[0]).toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    }
  });
});

async function isModified(id: string, newPickup: Date) {
  const [r] = await db.select().from(reservations).where(eq(reservations.id, id));
  return r.pickupAt.getTime() === newPickup.getTime();
}
