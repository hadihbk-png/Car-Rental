// Exploratory edge cases found while reading the services. Each failing case is a logged bug
// (test names carry the bug id once logged).
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { payments, vehicles } from "@/db/schema";
import { POST as webhookPost } from "@/app/api/webhooks/payments/route";
import { checkInReservation, checkOutReservation, createReservation, getReservation, payReservation } from "@/lib/reservations";
import { makeFakeEvent, sendFakeWebhook } from "../support/webhooks";
import { bookingInput, createWorld, HOUR, installFakePayments, key, MIN, WEBHOOK_SECRET } from "../support/fixtures";

let pay: ReturnType<typeof installFakePayments>;
beforeAll(() => {
  pay = installFakePayments();
});

describe("EDGE: payments", () => {
  it("EDGE-01 / BUG-004 a second payment attempt while an earlier one is still pending must not lead to a double charge", async () => {
    const w = await createWorld();
    const p = new Date(Date.now() + 10 * 24 * HOUR);
    const v = await createReservation(w.customer, bookingInput(w, p, new Date(p.getTime() + 24 * HOUR)));
    // Attempt 1 stays pending at the provider (e.g. 3-D Secure not finished).
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay1") });
    // The customer retries with another card (new attempt key, as the API doc says).
    let second: Awaited<ReturnType<typeof payReservation>> | undefined;
    try {
      second = await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay2") });
    } catch (err) {
      // Refusing the second attempt while one is pending is also acceptable.
      expect(err).toMatchObject({ code: expect.stringMatching(/INVALID_STATE|CONFLICT|PAYMENT_FAILED/) });
    }
    // Later the provider completes attempt 1 and sends payment.succeeded.
    const state = await pay.store.load();
    const first = Object.values(state.payments).find((x) => x.metadata.reservationId === v.id && x.status === "pending");
    if (first) {
      first.status = "succeeded";
      await pay.store.save(state);
      await sendFakeWebhook(makeFakeEvent("payment.succeeded", first), { secret: WEBHOOK_SECRET, send: webhookPost });
    }
    const view = await getReservation(w.customer, v.id);
    const providerCharged = Object.values((await pay.store.load()).payments)
      .filter((x) => x.metadata.reservationId === v.id && (x.status === "succeeded" || x.status === "partially_refunded"))
      .reduce((s, x) => s + x.amount - x.amountRefunded, 0);
    expect(second?.status ?? view.status).toBe("CONFIRMED");
    // The customer must end up paying the total once, not twice.
    expect(view.paidFils).toBe(view.price.totalFils);
    expect(providerCharged).toBe(view.price.totalFils);
  });
});

describe("EDGE: back-to-back rentals at the counter", () => {
  it("EDGE-02 / BUG-005 the next renter cannot be checked out while the previous renter still has the car", async () => {
    const w = await createWorld();
    const p1 = new Date(Date.now() + 2 * HOUR);
    const mid = new Date(p1.getTime() + 24 * HOUR);
    const r1 = await createReservation(w.customer, bookingInput(w, p1, mid));
    await payReservation(w.customer, { reservationId: r1.id, paymentMethod: "fake_success", idempotencyKey: key("p") });
    const r2 = await createReservation(w.other, bookingInput(w, mid, new Date(mid.getTime() + 24 * HOUR)));
    await payReservation(w.other, { reservationId: r2.id, paymentMethod: "fake_success", idempotencyKey: key("p") });
    await checkOutReservation(w.admin, { reservationId: r1.id, mileageKm: 1_000, fuelLevel: 8 });
    // Renter 1 is late; at mid + 30 min staff try to hand the same car to renter 2.
    await expect(
      checkOutReservation(w.admin, { reservationId: r2.id, mileageKm: 1_000, fuelLevel: 8 }, new Date(mid.getTime() + 30 * MIN)),
    ).rejects.toMatchObject({ code: "INVALID_STATE", message: expect.stringMatching(/not been returned/) });
  });

  it("EDGE-03 / BUG-006 checking in the earlier rental must not mark the car AVAILABLE while the next renter has it", async () => {
    const w = await createWorld();
    const p1 = new Date(Date.now() + 2 * HOUR);
    const mid = new Date(p1.getTime() + 24 * HOUR);
    const r1 = await createReservation(w.customer, bookingInput(w, p1, mid));
    await payReservation(w.customer, { reservationId: r1.id, paymentMethod: "fake_success", idempotencyKey: key("p") });
    const r2 = await createReservation(w.other, bookingInput(w, mid, new Date(mid.getTime() + 24 * HOUR)));
    await payReservation(w.other, { reservationId: r2.id, paymentMethod: "fake_success", idempotencyKey: key("p") });
    await checkOutReservation(w.admin, { reservationId: r1.id, mileageKm: 1_000, fuelLevel: 8 });
    let r2Out = false;
    try {
      await checkOutReservation(w.admin, { reservationId: r2.id, mileageKm: 1_000, fuelLevel: 8 }, new Date(mid.getTime() + 30 * MIN));
      r2Out = true;
    } catch {
      // EDGE-02 behaviour (refused) makes this scenario impossible: fine.
    }
    if (r2Out) {
      await checkInReservation(w.admin, { reservationId: r1.id, mileageKm: 1_100, fuelLevel: 8 }, new Date(mid.getTime() + 40 * MIN));
      const [veh] = await db.select().from(vehicles).where(eq(vehicles.id, w.vehicle.id));
      expect(veh.status).toBe("ON_RENT");
    }
  });
});

describe("EDGE: return charges above the deposit", () => {
  it("EDGE-04 / BUG-007 charges exceeding the deposit are collected or at least tracked as a RETURN_CHARGES payment", async () => {
    const w = await createWorld({ deposit: 0 });
    const p = new Date(Date.now() + 2 * HOUR);
    const r = new Date(p.getTime() + 24 * HOUR);
    const v = await createReservation(w.customer, bookingInput(w, p, r));
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("p") });
    await checkOutReservation(w.admin, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 8 });
    const back = await checkInReservation(w.admin, { reservationId: v.id, mileageKm: 1_100, fuelLevel: 8 }, new Date(r.getTime() + 3 * HOUR));
    expect(back.charges.amountDueFils).toBe(21_000); // 1 late day 20000 + VAT 1000, no deposit to take it from
    expect(back.agreement?.amountDueFils).toBe(21_000);
    const due = await db.select().from(payments).where(and(eq(payments.reservationId, v.id), eq(payments.purpose, "RETURN_CHARGES")));
    expect(due.length, "no RETURN_CHARGES payment exists for the amount due").toBeGreaterThan(0);
    const { payReturnBalance, listReservations } = await import("@/lib/reservations");
    const owed = await getReservation(w.customer, v.id);
    expect(owed).toMatchObject({ balanceDueFils: 21_000, can: expect.objectContaining({ payBalance: true }) });
    expect((await listReservations(w.admin, { balanceDue: true, vehicleId: w.vehicle.id })).items.map((i) => i.id)).toContain(v.id);
    await expect(payReturnBalance(w.other, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("bal") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(payReturnBalance(w.customer, { reservationId: v.id, paymentMethod: "fake_decline", idempotencyKey: key("bal") })).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    const k = key("bal");
    const paid = await payReturnBalance(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: k });
    expect(paid.balanceDueFils).toBe(0);
    expect(paid.can.payBalance).toBe(false);
    await payReturnBalance(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: k }); // replay: no second charge
    const charged = Object.values((await pay.store.load()).payments).filter((x) => x.metadata.reservationId === v.id && x.metadata.purpose === "RETURN_CHARGES" && x.status === "succeeded");
    expect(charged.map((x) => x.amount)).toEqual([21_000]);
    await expect(payReturnBalance(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("bal") })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("EDGE: date change while a payment is in flight", () => {
  it("EDGE-05 / BUG-008 changing the dates of a hold whose payment is pending must not strand or overcharge the customer", async () => {
    const { modifyReservationDates } = await import("@/lib/reservations");
    const w = await createWorld();
    const p = new Date(Date.now() + 10 * 24 * HOUR);
    const v = await createReservation(w.customer, bookingInput(w, p, new Date(p.getTime() + 24 * HOUR)));
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") });
    let changed = true;
    try {
      await modifyReservationDates(w.customer, { reservationId: v.id, pickupAt: p, returnAt: new Date(p.getTime() + 48 * HOUR), idempotencyKey: key("mod") });
    } catch {
      changed = false; // refusing while a payment is in flight is acceptable
    }
    const state = await pay.store.load();
    const first = Object.values(state.payments).find((x) => x.metadata.reservationId === v.id && x.status === "pending")!;
    first.status = "succeeded";
    await pay.store.save(state);
    await sendFakeWebhook(makeFakeEvent("payment.succeeded", first), { secret: WEBHOOK_SECRET, send: webhookPost });
    const view = await getReservation(w.customer, v.id);
    if (changed) {
      // The 21000 pending charge was for the old 1-day price; the new total is 42000.
      // Either the reservation confirms with the full amount collected, or the customer is told to pay the difference -
      // it must not silently sit PENDING with money taken.
      if (view.status === "CONFIRMED") expect(view.paidFils).toBe(view.price.totalFils);
      // Still PENDING with money already taken: paying again would charge the full new total on top (overcharge).
      else expect({ status: view.status, paidFils: view.paidFils }).toEqual({ status: view.status, paidFils: 0 });
    } else {
      expect(view.status).toBe("CONFIRMED");
    }
  });
});
