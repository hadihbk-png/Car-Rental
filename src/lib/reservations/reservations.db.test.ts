import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { deposits, payments, paymentWebhookEvents, reservations } from "@/db/schema";
import { createFixture, createUser, DAY, future, HOUR, key, useMemoryPayments, type Fixture } from "@/db/test-helpers";
import { getAvailabilityCalendar, searchVehicles } from "@/lib/availability";
import { createMaintenanceBlock } from "@/lib/fleet/admin";
import { releaseExpiredHolds } from "@/lib/jobs/release-expired-holds";
import { FAKE_PAYMENT_METHODS } from "@/lib/payments";
import { getQuote } from "@/lib/pricing/quote";
import {
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  createReservation,
  getReservation,
  getVoucher,
  listReservations,
  modifyReservationDates,
  payReservation,
  processPaymentWebhook,
  verifyVoucherPayload,
} from "@/lib/reservations";

let f: Fixture;

beforeAll(async () => {
  f = await createFixture({ vehicles: 6 });
});
beforeEach(() => {
  useMemoryPayments();
});

const booking = (vehicleId: string, pickupAt: Date, days: number, extra: Record<string, unknown> = {}) => ({
  vehicleId,
  pickupBranchId: f.branch.id,
  pickupAt,
  returnAt: new Date(pickupAt.getTime() + days * DAY),
  extras: [],
  idempotencyKey: key(),
  ...extra,
});

async function bookAndPay(vehicleId: string, pickupAt: Date, days: number) {
  const r = await createReservation(f.customer, booking(vehicleId, pickupAt, days));
  return payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() });
}

describe("reservation transaction", () => {
  it("two sessions racing for overlapping periods: exactly one wins", async () => {
    const t0 = future(5);
    const other = await createUser("customer");
    const results = await Promise.allSettled([
      createReservation(f.customer, booking(f.vehicles[0].id, t0, 3)),
      createReservation(other, booking(f.vehicles[0].id, new Date(t0.getTime() + DAY), 3)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    const rows = await db.select().from(reservations).where(eq(reservations.vehicleId, f.vehicles[0].id));
    expect(rows.filter((r) => r.status === "PENDING")).toHaveLength(1);
  });

  it("ten concurrent attempts on the same dates create exactly one hold", async () => {
    const t0 = future(40);
    const users = await Promise.all(Array.from({ length: 10 }, () => createUser("customer")));
    const results = await Promise.allSettled(users.map((u) => createReservation(u, booking(f.vehicles[5].id, t0, 2))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("allows back-to-back bookings and holds with a 15-minute expiry, priced on the server", async () => {
    const t0 = future(12);
    const now = new Date();
    const a = await createReservation(f.customer, booking(f.vehicles[1].id, t0, 2, { extras: [{ extraId: f.childSeat.id, quantity: 2 }] }), now);
    const b = await createReservation(f.customer, booking(f.vehicles[1].id, new Date(t0.getTime() + 2 * DAY), 1));
    expect(a.status).toBe("PENDING");
    expect(a.holdExpiresAt!.getTime() - now.getTime()).toBe(15 * 60_000);
    // 2 days x AED 100 + child seat 2 x 2 days x AED 25 = 300.00; VAT 15.00
    expect(a.price).toMatchObject({ rentalDays: 2, rentalFils: 20_000, extrasFils: 10_000, taxFils: 1_500, totalFils: 31_500, depositFils: 150_000 });
    expect(b.status).toBe("PENDING");
  });

  it("is idempotent: retrying with the same key returns the same reservation", async () => {
    const input = booking(f.vehicles[2].id, future(20), 2);
    const a = await createReservation(f.customer, input);
    const b = await createReservation(f.customer, input);
    expect(b.id).toBe(a.id);
    const [again] = await Promise.all([createReservation(f.customer, input)]);
    expect(again.id).toBe(a.id);
  });

  it("rejects a booking that overlaps maintenance, and a past pick-up", async () => {
    const t0 = future(25);
    await createMaintenanceBlock(f.admin, { vehicleId: f.vehicles[2].id, startsAt: t0, endsAt: new Date(t0.getTime() + DAY), reason: "service" });
    await expect(createReservation(f.customer, booking(f.vehicles[2].id, t0, 2))).rejects.toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    await expect(createReservation(f.customer, booking(f.vehicles[2].id, new Date(Date.now() - DAY), 2))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("an expired hold stops blocking immediately", async () => {
    const t0 = future(30);
    const past = new Date(Date.now() - 20 * 60_000);
    const stale = await createReservation(f.other, booking(f.vehicles[3].id, t0, 2), past);
    const fresh = await createReservation(f.customer, booking(f.vehicles[3].id, t0, 2));
    expect(fresh.status).toBe("PENDING");
    const [row] = await db.select().from(reservations).where(eq(reservations.id, stale.id));
    expect(row.status).toBe("EXPIRED");
  });
});

describe("payment and deposit", () => {
  it("confirms only after the payment succeeded and the deposit is held", async () => {
    const r = await createReservation(f.customer, booking(f.vehicles[4].id, future(8), 3));
    expect(r.status).toBe("PENDING");
    const paid = await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() });
    expect(paid).toMatchObject({ status: "CONFIRMED", paymentStatus: "succeeded", depositStatus: "held", paidFils: r.price.totalFils });
  });

  it("a declined card leaves the hold PENDING, releases the deposit, and a retry can succeed", async () => {
    const r = await createReservation(f.customer, booking(f.vehicles[4].id, future(15), 2));
    await expect(
      payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.decline, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    const after = await getReservation(f.customer, r.id);
    expect(after.status).toBe("PENDING");
    const deps = await db.select().from(deposits).where(eq(deposits.reservationId, r.id));
    expect(deps.every((d) => d.status !== "held")).toBe(true);
    const k = key();
    const ok = await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: k });
    expect(ok.status).toBe("CONFIRMED");
    // Retrying the same attempt does not charge twice.
    await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: k });
    const pays = await db.select().from(payments).where(eq(payments.reservationId, r.id));
    expect(pays.filter((p) => p.status === "succeeded")).toHaveLength(1);
  });

  it("pending payment confirms via webhook; duplicate webhook deliveries are processed once", async () => {
    const r = await createReservation(f.customer, booking(f.vehicles[4].id, future(18), 1));
    const pending = await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.pending, idempotencyKey: key() });
    expect(pending.status).toBe("PENDING");
    expect(pending.paymentStatus).toBe("pending");
    const [p] = await db.select().from(payments).where(eq(payments.reservationId, r.id));
    const event = {
      id: `evt_test_${p.id}`,
      type: "payment.succeeded" as const,
      createdAt: new Date().toISOString(),
      data: { id: p.providerPaymentId!, amount: p.amountFils, currency: "AED", status: "succeeded" as const, amountRefunded: 0, metadata: { paymentId: p.id }, createdAt: new Date().toISOString() },
    };
    const results = await Promise.all([processPaymentWebhook("fake", event), processPaymentWebhook("fake", event), processPaymentWebhook("fake", event)]);
    expect(results.filter((x) => !x.duplicate)).toHaveLength(1);
    const [stored] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, event.id));
    expect(stored.deliveries).toBe(3);
    expect((await getReservation(f.customer, r.id)).status).toBe("CONFIRMED");
  });

  it("requires a complete driver profile before payment", async () => {
    const noProfile = await createUser("customer");
    const r = await createReservation(noProfile, booking(f.vehicles[4].id, future(50), 1));
    await expect(
      payReservation(noProfile, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  });
});

describe("expired-hold release job", () => {
  it("expires holds, voids their deposits/payments, and is idempotent", async () => {
    const now = new Date();
    const r = await createReservation(f.customer, booking(f.vehicles[5].id, future(60), 2), new Date(now.getTime() - 14 * 60_000));
    // Deposit held, payment left pending (e.g. 3DS never completed).
    await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.pending, idempotencyKey: key() }, now);

    const first = await releaseExpiredHolds(new Date(now.getTime() + 2 * 60_000));
    expect(first.expiredReservations).toContain(r.id);
    expect(first.failed).toEqual([]);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, r.id));
    expect(row.status).toBe("EXPIRED");
    const deps = await db.select().from(deposits).where(eq(deposits.reservationId, r.id));
    expect(deps.map((d) => d.status)).toEqual(["released"]);
    const pays = await db.select().from(payments).where(eq(payments.reservationId, r.id));
    expect(pays.map((p) => p.status)).toEqual(["canceled"]);

    const second = await releaseExpiredHolds(new Date(now.getTime() + 3 * 60_000));
    expect(second.expiredReservations).not.toContain(r.id);
    expect(second.voided.map((v) => v.reservationId)).not.toContain(r.id);
    const third = await releaseExpiredHolds(new Date(now.getTime() + 3 * 60_000));
    expect(third).toEqual({ expiredReservations: [], voided: [], failed: [] });
  });
});

describe("cancellation, date changes, voucher, check-out and check-in", () => {
  it("cancels free of charge more than 48h before pick-up (full refund, deposit released)", async () => {
    const r = await bookAndPay(f.vehicles[0].id, future(9), 2);
    const c = await cancelReservation(f.customer, { reservationId: r.id });
    expect(c).toMatchObject({ status: "REFUNDED", refundedFils: r.price.totalFils, cancellationFeeFils: 0, depositStatus: "released" });
  });

  it("keeps one day (rate + VAT) when cancelling within 48h, and refuses after pick-up", async () => {
    const r = await bookAndPay(f.vehicles[0].id, future(1), 3);
    const c = await cancelReservation(f.customer, { reservationId: r.id });
    expect(c.cancellationFeeFils).toBe(10_500);
    expect(c.refundedFils).toBe(r.price.totalFils - 10_500);
    const late = await bookAndPay(f.vehicles[0].id, future(3), 1);
    await expect(
      cancelReservation(f.customer, { reservationId: late.id }, new Date(late.pickupAt.getTime() + HOUR)),
    ).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  });

  it("other customers cannot see or cancel a reservation; admins can", async () => {
    const r = await bookAndPay(f.vehicles[0].id, future(70), 1);
    await expect(getReservation(f.other, r.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getVoucher(f.other, r.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelReservation(f.other, { reservationId: r.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listReservations(f.customer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getReservation(f.admin, r.reference)).id).toBe(r.id);
  });

  it("modifies dates with re-pricing and availability re-check", async () => {
    const r = await bookAndPay(f.vehicles[1].id, future(80), 2);
    const blocker = await bookAndPay(f.vehicles[1].id, future(84), 2);
    // Overlaps the blocker -> rejected, nothing changes.
    await expect(
      modifyReservationDates(f.customer, {
        reservationId: r.id,
        pickupAt: r.pickupAt,
        returnAt: new Date(blocker.pickupAt.getTime() + HOUR),
        paymentMethod: FAKE_PAYMENT_METHODS.success,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    // One more day -> charges the difference (AED 105).
    const longer = await modifyReservationDates(f.customer, {
      reservationId: r.id,
      pickupAt: r.pickupAt,
      returnAt: new Date(r.returnAt.getTime() + DAY),
      paymentMethod: FAKE_PAYMENT_METHODS.success,
      idempotencyKey: key(),
    });
    expect(longer.price.totalFils).toBe(31_500);
    expect(longer.paidFils).toBe(31_500);
    // Back to 1 day -> refund the difference.
    const shorter = await modifyReservationDates(f.customer, {
      reservationId: r.id,
      pickupAt: r.pickupAt,
      returnAt: new Date(r.pickupAt.getTime() + DAY),
      idempotencyKey: key(),
    });
    expect(shorter.price.totalFils).toBe(10_500);
    expect(shorter.paidFils).toBe(10_500);
  });

  it("issues a signed voucher QR that verifies, and rejects a forged one", async () => {
    const r = await bookAndPay(f.vehicles[2].id, future(90), 1);
    const v = await getVoucher(f.customer, r.id);
    expect(v.qrPayload).toMatch(/^DE1\.DE-[A-Z0-9]{6}\.[A-Za-z0-9_-]{22}$/);
    expect(v.qrPayload).not.toContain(r.id);
    expect(v.qrSvg).toContain("<svg");
    expect((await verifyVoucherPayload(f.admin, v.qrPayload)).id).toBe(r.id);
    const forged = v.qrPayload.slice(0, -2) + (v.qrPayload.endsWith("AA") ? "BB" : "AA");
    await expect(verifyVoucherPayload(f.admin, forged)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(verifyVoucherPayload(f.customer, v.qrPayload)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("check-out then late check-in: mileage/fuel recorded, late day + fuel charged from the deposit", async () => {
    const pickupAt = future(0, 2);
    const r = await bookAndPay(f.vehicles[3].id, pickupAt, 2);
    await expect(checkOutReservation(f.customer, { reservationId: r.id, mileageKm: 1000, fuelLevel: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const out = await checkOutReservation(f.admin, { reservationId: r.reference, mileageKm: 1200, fuelLevel: 8 });
    expect(out.status).toBe("PICKED_UP");
    // Returned 2h late (1 extra day) with 2/8 less fuel. Use a clock after the return time.
    const returnedAt = new Date(r.returnAt.getTime() + 2 * HOUR);
    const back = await checkInReservation(
      f.admin,
      { reservationId: r.id, mileageKm: 1650, fuelLevel: 6, returnedAt },
      new Date(returnedAt.getTime() + 60_000),
    );
    // late 100.00 + fuel 2 x 40.00 = 180.00 net, VAT 9.00 -> 189.00 captured from the 1500.00 deposit
    expect(back.charges).toMatchObject({ lateDays: 1, lateFeeFils: 10_000, fuelChargeFils: 8_000, taxFils: 900, totalFils: 18_900, depositCaptureFils: 18_900, amountDueFils: 0 });
    expect(back).toMatchObject({ status: "RETURNED", depositStatus: "captured" });
    expect(back.agreement).toMatchObject({ pickupMileageKm: 1200, pickupFuelLevel: 8, returnMileageKm: 1650, returnFuelLevel: 6 });
  });

  it("on-time return within the 59-minute grace releases the whole deposit", async () => {
    const pickupAt = future(0, 3);
    const r = await bookAndPay(f.vehicles[4].id, pickupAt, 1);
    await checkOutReservation(f.admin, { reservationId: r.id, mileageKm: 1000, fuelLevel: 8 });
    const returnedAt = new Date(r.returnAt.getTime() + 59 * 60_000);
    const back = await checkInReservation(f.admin, { reservationId: r.id, mileageKm: 1100, fuelLevel: 8, returnedAt }, new Date(returnedAt.getTime() + 1000));
    expect(back.charges.totalFils).toBe(0);
    expect(back.depositStatus).toBe("released");
  });
});

describe("search, quote and calendar", () => {
  it("search hides vehicles booked or blocked for the dates and honours filters", async () => {
    const g = await createFixture({ vehicles: 3 });
    const t0 = future(100);
    const r = await createReservation(g.customer, { ...booking(g.vehicles[0].id, t0, 2), pickupBranchId: g.branch.id });
    await createMaintenanceBlock(g.admin, { vehicleId: g.vehicles[1].id, startsAt: t0, endsAt: new Date(t0.getTime() + DAY), reason: "brakes" });
    const res = await searchVehicles({ pickupBranchId: g.branch.id, pickupAt: t0, returnAt: new Date(t0.getTime() + 2 * DAY) });
    expect(res.vehicles.map((v) => v.id)).toEqual([g.vehicles[2].id]);
    expect(res.vehicles[0]).toMatchObject({ dailyRateFils: 10_000, rentalDays: 2, rentalFils: 20_000, estimatedTotalFils: 21_000 });
    // Back-to-back: the period right after the hold is free.
    const after = await searchVehicles({ pickupBranchId: g.branch.id, pickupAt: r.returnAt, returnAt: new Date(r.returnAt.getTime() + DAY) });
    expect(after.vehicles.map((v) => v.id)).toContain(g.vehicles[0].id);
    const manual = await searchVehicles({ pickupBranchId: g.branch.id, transmission: "MANUAL" });
    expect(manual.vehicles.every((v) => v.transmission === "MANUAL")).toBe(true);
    const cheap = await searchVehicles({ pickupBranchId: g.branch.id, maxDailyRateFils: 5_000 });
    expect(cheap.vehicles).toEqual([]);
  });

  it("quotes one-way fee, VAT, weekly rate and deposit on the server", async () => {
    const g = await createFixture();
    const { oneWayFees } = await import("@/db/schema");
    await db.insert(oneWayFees).values({ fromBranchId: g.branch.id, toBranchId: g.branch2.id, feeFils: 30_000 });
    const t0 = future(110);
    const q = await getQuote({
      vehicleId: g.vehicle.id,
      pickupBranchId: g.branch.id,
      returnBranchId: g.branch2.id,
      pickupAt: t0,
      returnAt: new Date(t0.getTime() + 7 * DAY),
      extras: [{ extraId: g.insurance.id, quantity: 1 }],
    });
    // 7 x 85.00 = 595.00 + insurance 150.00 + one-way 300.00 = 1045.00; VAT 52.25
    expect(q).toMatchObject({ dailyRateFils: 8_500, rentalDays: 7, rentalFils: 59_500, extrasFils: 15_000, oneWayFeeFils: 30_000, taxFils: 5_225, totalFils: 109_725, depositFils: 150_000, available: true });
  });

  it("calendar marks reserved and partial days in the branch time zone", async () => {
    const g = await createFixture();
    const { zonedTimeToUtc, addDaysToDate, localDate } = await import("@/lib/availability/time");
    const day = addDaysToDate(localDate(new Date(), "Asia/Dubai"), 120);
    const start = zonedTimeToUtc(day, "00:00", "Asia/Dubai");
    await createReservation(g.customer, { ...booking(g.vehicle.id, start, 1), pickupBranchId: g.branch.id, returnAt: zonedTimeToUtc(addDaysToDate(day, 1), "12:00", "Asia/Dubai") });
    const cal = await getAvailabilityCalendar({ vehicleId: g.vehicle.id, from: day, days: 3 });
    expect(cal.days.map((d) => d.status)).toEqual(["unavailable", "partial", "available"]);
    expect(cal.busy).toHaveLength(1);
  });
});
