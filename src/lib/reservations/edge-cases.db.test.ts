// Regression tests for BUG-004 .. BUG-008 (see docs/bugs.md).
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, payments, reservations, vehicles } from "@/db/schema";
import { completeAtProvider, createFixture, DAY, future, HOUR, key, useMemoryPayments } from "@/db/test-helpers";
import { FAKE_PAYMENT_METHODS, type Payment } from "@/lib/payments";
import {
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  createReservation,
  getReservation,
  listReservations,
  modifyReservationDates,
  payReservation,
  payReturnBalance,
  processPaymentWebhook,
} from "@/lib/reservations";
import type { Fixture } from "@/db/test-helpers";

let pay: ReturnType<typeof useMemoryPayments>;
beforeEach(() => {
  pay = useMemoryPayments();
});

const succeededEvent = (p: Payment, id = `evt_${p.id}`) => ({
  id,
  type: "payment.succeeded" as const,
  createdAt: new Date().toISOString(),
  data: { ...p, status: "succeeded" as const },
});

async function hold(f: Fixture, vehicleId: string, pickupAt: Date, days: number) {
  return createReservation(f.customer, {
    vehicleId,
    pickupBranchId: f.branch.id,
    pickupAt,
    returnAt: new Date(pickupAt.getTime() + days * DAY),
    extras: [],
    idempotencyKey: key(),
  });
}

async function bookAndPay(f: Fixture, vehicleId: string, pickupAt: Date, days: number) {
  const r = await hold(f, vehicleId, pickupAt, days);
  return payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() });
}

async function rentalPayments(reservationId: string) {
  return db.select().from(payments).where(and(eq(payments.reservationId, reservationId), eq(payments.purpose, "RENTAL")));
}

describe("BUG-004: no double charge when an earlier pending attempt completes", () => {
  it("cancels the pending attempt on retry and refunds it if it still succeeds; duplicates are harmless", async () => {
    const f = await createFixture();
    const r = await hold(f, f.vehicle.id, future(10), 2);
    const first = await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.pending, idempotencyKey: key() });
    expect(first.status).toBe("PENDING");
    const [attempt1] = await rentalPayments(r.id);

    const second = await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() });
    expect(second).toMatchObject({ status: "CONFIRMED", paidFils: r.price.totalFils });
    const [a1] = await db.select().from(payments).where(eq(payments.id, attempt1.id));
    expect(a1.status).toBe("canceled");

    // The provider completes attempt 1 anyway (lost race) and sends payment.succeeded twice.
    const completed = await completeAtProvider(pay.store, attempt1.providerPaymentId!);
    const event = succeededEvent(completed);
    await processPaymentWebhook("fake", event);
    await processPaymentWebhook("fake", event);
    const view = await getReservation(f.customer, r.id);
    expect(view).toMatchObject({ status: "CONFIRMED", paidFils: r.price.totalFils });
    const [after] = await db.select().from(payments).where(eq(payments.id, attempt1.id));
    expect(after).toMatchObject({ status: "refunded", amountRefundedFils: attempt1.amountFils });
    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, r.id), eq(auditLogs.action, "payment.surplus_refunded")));
    expect(audits).toHaveLength(1);
  });

  it("refunds in full a success that arrives after the reservation was cancelled", async () => {
    const f = await createFixture();
    const r = await hold(f, f.vehicle.id, future(20), 1);
    await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.pending, idempotencyKey: key() });
    const [p] = await rentalPayments(r.id);
    await cancelReservation(f.customer, { reservationId: r.id });
    const completed = await completeAtProvider(pay.store, p.providerPaymentId!);
    await processPaymentWebhook("fake", succeededEvent(completed));
    const view = await getReservation(f.customer, r.id);
    expect(view.status).toBe("CANCELLED");
    expect(view.paidFils).toBe(0);
  });
});

describe("BUG-005 / BUG-006: back-to-back rentals with a late return", () => {
  it("refuses the next check-out until the previous rental is checked in, and keeps the car ON_RENT", async () => {
    const f = await createFixture();
    const t = future(0, 2);
    const r1 = await bookAndPay(f, f.vehicle.id, t, 1);
    const r2 = await bookAndPay(f, f.vehicle.id, new Date(t.getTime() + DAY), 1);
    await checkOutReservation(f.admin, { reservationId: r1.id, mileageKm: 1000, fuelLevel: 8 });
    const late = new Date(t.getTime() + DAY + 30 * 60_000);
    await expect(checkOutReservation(f.admin, { reservationId: r2.id, mileageKm: 1000, fuelLevel: 8 }, late)).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: expect.stringContaining("not been returned"),
    });
    expect((await getReservation(f.admin, r2.id)).status).toBe("CONFIRMED");

    // BUG-006 (defensive): if another rental has the car, check-in keeps it ON_RENT.
    await db.update(reservations).set({ status: "PICKED_UP" }).where(eq(reservations.id, r2.id));
    await checkInReservation(f.admin, { reservationId: r1.id, mileageKm: 1100, fuelLevel: 8, returnedAt: late }, new Date(late.getTime() + 1000));
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, f.vehicle.id));
    expect(v.status).toBe("ON_RENT");
  });
});

describe("BUG-007: return charges above the deposit", () => {
  it("records an outstanding RETURN_CHARGES payment, shows the balance, and collects it once", async () => {
    const f = await createFixture({ depositFils: 0 });
    const r = await bookAndPay(f, f.vehicle.id, future(0, 2), 1);
    await checkOutReservation(f.admin, { reservationId: r.id, mileageKm: 1000, fuelLevel: 8 });
    const returnedAt = new Date(r.returnAt.getTime() + 3 * HOUR);
    const back = await checkInReservation(f.admin, { reservationId: r.id, mileageKm: 1100, fuelLevel: 8, returnedAt }, new Date(returnedAt.getTime() + 1000));
    expect(back.charges).toMatchObject({ totalFils: 10_500, depositCaptureFils: 0, amountDueFils: 10_500 });
    expect(back).toMatchObject({ balanceDueFils: 10_500, can: expect.objectContaining({ payBalance: true }) });
    const pending = await db
      .select()
      .from(payments)
      .where(and(eq(payments.reservationId, r.id), eq(payments.purpose, "RETURN_CHARGES")));
    expect(pending).toMatchObject([{ status: "pending", amountFils: 10_500 }]);

    const owed = await listReservations(f.admin, { balanceDue: true, q: r.reference });
    expect(owed.items.map((x) => x.id)).toEqual([r.id]);

    await expect(
      payReturnBalance(f.other, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const k = key();
    const paid = await payReturnBalance(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: k });
    expect(paid).toMatchObject({ balanceDueFils: 0, can: expect.objectContaining({ payBalance: false }) });
    await payReturnBalance(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: k });
    const charged = await db
      .select()
      .from(payments)
      .where(and(eq(payments.reservationId, r.id), eq(payments.purpose, "RETURN_CHARGES"), eq(payments.status, "succeeded")));
    expect(charged).toHaveLength(1);
    await expect(
      payReturnBalance(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await listReservations(f.admin, { balanceDue: true, q: r.reference })).items).toEqual([]);
  });
});

describe("BUG-008: date changes and outstanding amounts", () => {
  it("refuses to change dates while PENDING", async () => {
    const f = await createFixture();
    const r = await hold(f, f.vehicle.id, future(30), 1);
    const pending = await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.pending, idempotencyKey: key() });
    expect(pending.can.modifyDates).toBe(false);
    await expect(
      modifyReservationDates(f.customer, {
        reservationId: r.id,
        pickupAt: r.pickupAt,
        returnAt: new Date(r.returnAt.getTime() + DAY),
        paymentMethod: FAKE_PAYMENT_METHODS.success,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("charges only the outstanding amount after the amount due changed, then confirms", async () => {
    const f = await createFixture();
    const r = await hold(f, f.vehicle.id, future(40), 1); // 10500
    await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.pending, idempotencyKey: key() });
    const [p1] = await rentalPayments(r.id);
    // Amount due grows to 2 days (21000) while attempt 1 is in flight.
    await db
      .update(reservations)
      .set({ rentalDays: 2, rentalFils: 20_000, taxFils: 1_000, totalFils: 21_000, returnAt: new Date(r.returnAt.getTime() + DAY) })
      .where(eq(reservations.id, r.id));
    const completed = await completeAtProvider(pay.store, p1.providerPaymentId!);
    await processPaymentWebhook("fake", succeededEvent(completed));
    const half = await getReservation(f.customer, r.id);
    expect(half).toMatchObject({ status: "PENDING", paidFils: 10_500 });

    const done = await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() });
    expect(done).toMatchObject({ status: "CONFIRMED", paidFils: 21_000 });
    const rows = await rentalPayments(r.id);
    expect(rows.map((x) => x.amountFils).sort()).toEqual([10_500, 10_500]);
  });
});
