// CXL-*: cancellation policy. MOD-*: date changes. All boundaries use the services' `now`.
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { deposits, payments } from "@/db/schema";
import { insertMaintenanceRaw } from "../support/fixtures";
import { cancelReservation, checkOutReservation, createReservation, getReservation, modifyReservationDates, payReservation } from "@/lib/reservations";
import { raceCalls } from "../support/db";
import { bookingInput, createWorld, future, HOUR, installFakePayments, key, MIN, reservationRow, type World } from "../support/fixtures";

let pay: ReturnType<typeof installFakePayments>;
beforeAll(() => {
  pay = installFakePayments();
});

/** Confirmed 2-day booking (total 42000, deposit 150000). */
async function confirmed2Days(w: World, pickupAt: Date) {
  const v = await createReservation(w.customer, bookingInput(w, pickupAt, new Date(pickupAt.getTime() + 48 * HOUR)));
  return payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
}

async function providerRefunds(reservationId: string) {
  const state = await pay.store.load();
  const pids = new Set(Object.values(state.payments).filter((p) => p.metadata.reservationId === reservationId).map((p) => p.id));
  return Object.values(state.refunds).filter((r) => pids.has(r.paymentId));
}

describe("CXL: cancellation policy", () => {
  it("CXL-01 more than 48h before pick-up: full refund, deposit released, car freed", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const c = await cancelReservation(w.customer, { reservationId: v.id, reason: "QA" }, new Date(p.getTime() - 48 * HOUR - MIN));
    expect(c).toMatchObject({ status: "REFUNDED", refundedFils: 42_000, cancellationFeeFils: 0, paidFils: 0, depositStatus: "released" });
    expect((await providerRefunds(v.id)).reduce((s, r) => s + r.amount, 0)).toBe(42_000);
    const again = await createReservation(w.other, bookingInput(w, p, new Date(p.getTime() + 48 * HOUR)));
    expect(again.status).toBe("PENDING");
  });

  it("CXL-02 exactly 48h before pick-up is still free", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const c = await cancelReservation(w.customer, { reservationId: v.id }, new Date(p.getTime() - 48 * HOUR));
    expect(c).toMatchObject({ status: "REFUNDED", refundedFils: 42_000, cancellationFeeFils: 0 });
  });

  it("CXL-03 47h59m before pick-up: one day + VAT (21000) kept, 21000 refunded, deposit released", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const now = new Date(p.getTime() - 48 * HOUR + MIN);
    const preview = (await getReservation(w.customer, v.id, now)).cancellationPreview;
    expect(preview).toMatchObject({ allowed: true, free: false, feeFils: 21_000, refundFils: 21_000 });
    const c = await cancelReservation(w.customer, { reservationId: v.id }, now);
    expect(c).toMatchObject({ status: "REFUNDED", cancellationFeeFils: 21_000, refundedFils: 21_000, paidFils: 21_000, paymentStatus: "partially_refunded", depositStatus: "released" });
  });

  it("CXL-04 cannot cancel at/after pick-up, once picked up, or when expired", async () => {
    const w = await createWorld();
    const p = new Date(Date.now() + 2 * HOUR);
    const v = await confirmed2Days(w, p);
    await expect(cancelReservation(w.customer, { reservationId: v.id }, p)).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
    await checkOutReservation(w.admin, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 8 });
    await expect(cancelReservation(w.customer, { reservationId: v.id })).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
    await expect(cancelReservation(w.admin, { reservationId: v.id })).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
    const x = await createWorld();
    const stale = await createReservation(x.customer, bookingInput(x, future(5), future(6)), new Date(Date.now() - 20 * MIN));
    await createReservation(x.other, bookingInput(x, future(5), future(6))); // expires the stale hold
    await expect(cancelReservation(x.customer, { reservationId: stale.id })).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  });

  it("CXL-05 cancelling an unpaid hold is free and charges nothing", async () => {
    const w = await createWorld();
    const v = await createReservation(w.customer, bookingInput(w, future(5), future(6)));
    const c = await cancelReservation(w.customer, { reservationId: v.id });
    expect(c).toMatchObject({ status: "CANCELLED", cancellationFeeFils: 0, refundedFils: 0, paidFils: 0 });
  });

  it("CXL-05b cancelling a hold with a pending payment cancels the payment and releases the deposit", async () => {
    const w = await createWorld();
    const v = await createReservation(w.customer, bookingInput(w, future(5), future(6)));
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") });
    const c = await cancelReservation(w.customer, { reservationId: v.id });
    expect(c.status).toBe("CANCELLED");
    const [pm] = await db.select().from(payments).where(eq(payments.reservationId, v.id));
    expect(pm.status).toBe("canceled");
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, v.id));
    expect(dep.status).toBe("released");
  });

  it("CXL-06 concurrent double cancellation refunds once", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const outcome = await raceCalls([0, 1, 2].map(() => () => cancelReservation(w.customer, { reservationId: v.id }, new Date(p.getTime() - 72 * HOUR))));
    expect(outcome.rejected).toEqual([]);
    const refunds = await providerRefunds(v.id);
    expect(refunds.reduce((s, r) => s + r.amount, 0)).toBe(42_000);
    expect((await reservationRow(v.id)).refundedFils).toBe(42_000);
    // And a later retry is a no-op.
    await cancelReservation(w.customer, { reservationId: v.id });
    expect((await providerRefunds(v.id)).length).toBe(refunds.length);
  });

  it("AZ-08 another customer cannot cancel (NOT_FOUND); an admin can", async () => {
    const w = await createWorld();
    const v = await confirmed2Days(w, future(10));
    await expect(cancelReservation(w.other, { reservationId: v.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await reservationRow(v.id)).status).toBe("CONFIRMED");
    expect((await cancelReservation(w.admin, { reservationId: v.id })).status).toBe("REFUNDED");
  });
});

describe("MOD: date changes", () => {
  it("MOD-01 extending charges the difference; shortening refunds it; prices re-computed on the server", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const longer = await modifyReservationDates(w.customer, {
      reservationId: v.id, pickupAt: p, returnAt: new Date(p.getTime() + 72 * HOUR), paymentMethod: "fake_success", idempotencyKey: key("mod"),
    });
    expect(longer.price).toMatchObject({ rentalDays: 3, rentalFils: 60_000, taxFils: 3_000, totalFils: 63_000 });
    expect(longer.paidFils).toBe(63_000);
    const mods = await db.select().from(payments).where(and(eq(payments.reservationId, v.id), eq(payments.purpose, "MODIFICATION")));
    expect(mods.map((m) => [m.amountFils, m.status])).toEqual([[21_000, "succeeded"]]);
    const shorter = await modifyReservationDates(w.customer, { reservationId: v.id, pickupAt: p, returnAt: new Date(p.getTime() + 24 * HOUR), idempotencyKey: key("mod") });
    expect(shorter.price.totalFils).toBe(21_000);
    expect(shorter.paidFils).toBe(21_000);
    expect(shorter.status).toBe("CONFIRMED");
  });

  it("MOD-01b a higher price without a payment method is VALIDATION; a declined card leaves dates unchanged", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const newReturn = new Date(p.getTime() + 96 * HOUR);
    await expect(modifyReservationDates(w.customer, { reservationId: v.id, pickupAt: p, returnAt: newReturn, idempotencyKey: key("mod") })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      modifyReservationDates(w.customer, { reservationId: v.id, pickupAt: p, returnAt: newReturn, paymentMethod: "fake_decline", idempotencyKey: key("mod") }),
    ).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    const row = await reservationRow(v.id);
    expect(row.returnAt.getTime()).toBe(p.getTime() + 48 * HOUR);
    expect(row.totalFils).toBe(42_000);
  });

  it("MOD-01c retrying the same modification (same key) charges once", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const input = { reservationId: v.id, pickupAt: p, returnAt: new Date(p.getTime() + 72 * HOUR), paymentMethod: "fake_success", idempotencyKey: key("mod") };
    await modifyReservationDates(w.customer, input);
    await modifyReservationDates(w.customer, input);
    const mods = await db.select().from(payments).where(and(eq(payments.reservationId, v.id), eq(payments.purpose, "MODIFICATION")));
    expect(mods).toHaveLength(1);
    expect((await getReservation(w.customer, v.id)).paidFils).toBe(63_000);
  });

  it("MOD-02 within 48h of pick-up the dates cannot change", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    await expect(
      modifyReservationDates(
        w.customer,
        { reservationId: v.id, pickupAt: new Date(p.getTime() + 24 * HOUR), returnAt: new Date(p.getTime() + 72 * HOUR), paymentMethod: "fake_success", idempotencyKey: key("mod") },
        new Date(p.getTime() - 47 * HOUR),
      ),
    ).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  });

  it("MOD-03 new dates that overlap another booking or a maintenance block are refused; nothing changes or is charged", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const blockerStart = new Date(p.getTime() + 5 * 24 * HOUR);
    await createReservation(w.other, bookingInput(w, blockerStart, new Date(blockerStart.getTime() + 24 * HOUR)));
    await expect(
      modifyReservationDates(w.customer, {
        reservationId: v.id, pickupAt: new Date(blockerStart.getTime() - 24 * HOUR), returnAt: new Date(blockerStart.getTime() + HOUR), paymentMethod: "fake_success", idempotencyKey: key("mod"),
      }),
    ).rejects.toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    const mStart = new Date(p.getTime() + 8 * 24 * HOUR);
    await insertMaintenanceRaw(w.vehicle.id, mStart, new Date(mStart.getTime() + 24 * HOUR));
    await expect(
      modifyReservationDates(w.customer, { reservationId: v.id, pickupAt: mStart, returnAt: new Date(mStart.getTime() + 48 * HOUR), idempotencyKey: key("mod") }),
    ).rejects.toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    const row = await reservationRow(v.id);
    expect(row.pickupAt.getTime()).toBe(p.getTime());
    expect(await db.select().from(payments).where(and(eq(payments.reservationId, v.id), eq(payments.purpose, "MODIFICATION")))).toHaveLength(0);
  });

  it("MOD-04 extending into its own current period is allowed (no self-conflict); others get NOT_FOUND", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    const later = await modifyReservationDates(w.customer, {
      reservationId: v.id, pickupAt: new Date(p.getTime() + 24 * HOUR), returnAt: new Date(p.getTime() + 72 * HOUR), idempotencyKey: key("mod"),
    });
    expect(later.pickupAt.getTime()).toBe(p.getTime() + 24 * HOUR);
    await expect(
      modifyReservationDates(w.other, { reservationId: v.id, pickupAt: p, returnAt: new Date(p.getTime() + 48 * HOUR), idempotencyKey: key("mod") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("MOD-05 `can` flags follow the policy", async () => {
    const w = await createWorld();
    const p = future(10);
    const v = await confirmed2Days(w, p);
    expect((await getReservation(w.customer, v.id, new Date(p.getTime() - 49 * HOUR))).can).toMatchObject({ cancel: true, modifyDates: true, viewVoucher: true, pay: false });
    expect((await getReservation(w.customer, v.id, new Date(p.getTime() - 47 * HOUR))).can).toMatchObject({ cancel: true, modifyDates: false });
    expect((await getReservation(w.customer, v.id, new Date(p.getTime() + HOUR))).can).toMatchObject({ cancel: false, modifyDates: false });
  });
});
