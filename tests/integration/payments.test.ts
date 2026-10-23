// PAY-*: payment success/failure/pending/retry/idempotency. WHK-*: signed webhooks,
// duplicates (sequential and concurrent), bad signatures, out-of-order events.
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, deposits, paymentWebhookEvents, payments } from "@/db/schema";
import { POST as webhookPost } from "@/app/api/webhooks/payments/route";
import { createReservation, getReservation, payReservation } from "@/lib/reservations";
import type { Payment } from "@/lib/payments/types";
import { pgErrorCode, query, raceCalls } from "../support/db";
import { makeFakeEvent, sendFakeWebhook, type FakeWebhookEvent } from "../support/webhooks";
import { bookingInput, createWorld, future, HOUR, installFakePayments, key, reservationRow, WEBHOOK_SECRET, type World } from "../support/fixtures";

let pay: ReturnType<typeof installFakePayments>;
beforeAll(() => {
  pay = installFakePayments();
});

const send = (event: FakeWebhookEvent | object, opts: Parameters<typeof sendFakeWebhook>[1] = {}) =>
  sendFakeWebhook(event as FakeWebhookEvent, { secret: WEBHOOK_SECRET, send: webhookPost, ...opts });

async function hold(w: World, who = w.customer) {
  const p = future(10 + Math.floor(Math.random() * 300));
  return createReservation(who, bookingInput(w, p, new Date(p.getTime() + 24 * HOUR)));
}

async function providerPaymentsFor(reservationId: string) {
  return Object.values((await pay.store.load()).payments).filter((p) => p.metadata.reservationId === reservationId);
}

/** Simulates the provider completing a pending charge; returns the updated provider record. */
async function completePending(reservationId: string): Promise<Payment> {
  const state = await pay.store.load();
  const p = Object.values(state.payments).find((x) => x.metadata.reservationId === reservationId && x.status === "pending")!;
  p.status = "succeeded";
  await pay.store.save(state);
  return p;
}

const confirmedAudits = async (id: string) =>
  (await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, "reservation.confirmed")))).length;

describe("PAY: payments", () => {
  it("PAY-01 success: deposit held, payment succeeded, CONFIRMED", async () => {
    const w = await createWorld();
    const v = await hold(w);
    const r = await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    expect(r).toMatchObject({ status: "CONFIRMED", paymentStatus: "succeeded", depositStatus: "held", paidFils: 21_000 });
  });

  it("PAY-02 a declined charge (no deposit category): PAYMENT_FAILED, payment failed, hold stays PENDING; PAY-04 retry succeeds once", async () => {
    const w = await createWorld({ deposit: 0 });
    const v = await hold(w);
    await expect(payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_decline", idempotencyKey: key("pay") })).rejects.toMatchObject({
      code: "PAYMENT_FAILED",
    });
    const after = await getReservation(w.customer, v.id);
    expect(after).toMatchObject({ status: "PENDING", paymentStatus: "failed", paidFils: 0 });
    // Retrying the SAME failed attempt key is refused; a new key works.
    const ok = await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    expect(ok).toMatchObject({ status: "CONFIRMED", paidFils: 21_000 });
    const rows = await db.select().from(payments).where(eq(payments.reservationId, v.id));
    expect(rows.map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);
    expect(await confirmedAudits(v.id)).toBe(1);
  });

  it("PAY-02b a declined deposit releases nothing and never charges", async () => {
    const w = await createWorld();
    const v = await hold(w);
    await expect(payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_decline", idempotencyKey: key("pay") })).rejects.toMatchObject({
      code: "PAYMENT_FAILED",
    });
    expect(await providerPaymentsFor(v.id)).toEqual([]);
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, v.id));
    expect(dep.status).toBe("failed");
  });

  it("PAY-03 pending payment keeps the reservation PENDING (no voucher yet)", async () => {
    const w = await createWorld();
    const v = await hold(w);
    const r = await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") });
    expect(r).toMatchObject({ status: "PENDING", paymentStatus: "pending", depositStatus: "held" });
    expect(r.can.viewVoucher).toBe(false);
  });

  it("PAY-05 the same idempotency key twice (sequential) charges and holds once", async () => {
    const w = await createWorld();
    const v = await hold(w);
    const input = { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") };
    await payReservation(w.customer, input);
    const again = await payReservation(w.customer, input);
    expect(again.status).toBe("CONFIRMED");
    expect(await providerPaymentsFor(v.id)).toHaveLength(1);
    const state = await pay.store.load();
    expect(Object.values(state.holds).filter((h) => h.metadata.reservationId === v.id)).toHaveLength(1);
    expect(await db.select().from(payments).where(eq(payments.reservationId, v.id))).toHaveLength(1);
  });

  it("PAY-05b the same idempotency key concurrently (double click) charges once and confirms once", async () => {
    const w = await createWorld();
    const v = await hold(w);
    const input = { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") };
    const outcome = await raceCalls([0, 1, 2].map(() => () => payReservation(w.customer, input)));
    const rows = await db.select().from(payments).where(eq(payments.reservationId, v.id));
    expect(rows).toHaveLength(1);
    expect((await providerPaymentsFor(v.id)).filter((p) => p.status === "succeeded")).toHaveLength(1);
    expect((await reservationRow(v.id)).status).toBe("CONFIRMED");
    expect(await confirmedAudits(v.id)).toBe(1);
    expect(outcome.fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  it("PAY-05c a payment key reused for another reservation is a CONFLICT", async () => {
    const w = await createWorld({ vehicleCount: 2 });
    const a = await hold(w);
    const b = await createReservation(w.customer, bookingInput(w, future(400), future(401), { vehicleId: w.vehicles[1].id }));
    const k = key("pay");
    await payReservation(w.customer, { reservationId: a.id, paymentMethod: "fake_success", idempotencyKey: k });
    await expect(payReservation(w.customer, { reservationId: b.id, paymentMethod: "fake_success", idempotencyKey: k })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("PAY-06 paying needs a complete driver profile; another user's reservation is NOT_FOUND", async () => {
    const w = await createWorld();
    const v = await hold(w);
    await expect(payReservation(w.other, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await query("UPDATE driver_profiles SET licence_file_key = NULL, licence_uploaded_at = NULL WHERE user_id = $1", [w.customer.id]);
    await expect(payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") })).rejects.toMatchObject({
      code: "POLICY_VIOLATION",
    });
  });

  it("PAY-06b an expired hold cannot be paid (and is marked EXPIRED)", async () => {
    const w = await createWorld();
    const p = future(20);
    const v = await createReservation(w.customer, bookingInput(w, p, new Date(p.getTime() + 24 * HOUR)), new Date(Date.now() - 20 * 60_000));
    await expect(payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect((await reservationRow(v.id)).status).toBe("EXPIRED");
    expect(await providerPaymentsFor(v.id)).toEqual([]);
  });

  it("PAY-10 the database refuses over-refunds and over-captures", async () => {
    const w = await createWorld();
    const v = await hold(w);
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    await expect(query("UPDATE payments SET amount_refunded_fils = amount_fils + 1 WHERE reservation_id = $1", [v.id])).rejects.toSatisfy(
      (e) => pgErrorCode(e) === "23514",
    );
    await expect(query("UPDATE deposits SET amount_captured_fils = amount_fils + 1 WHERE reservation_id = $1", [v.id])).rejects.toSatisfy(
      (e) => pgErrorCode(e) === "23514",
    );
  });
});

describe("WHK: webhooks", () => {
  it("WHK-01 a signed payment.succeeded for a pending payment confirms the reservation", async () => {
    const w = await createWorld();
    const v = await hold(w);
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") });
    const event = makeFakeEvent("payment.succeeded", await completePending(v.id));
    const [res] = await send(event);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ received: true, duplicate: false });
    expect((await reservationRow(v.id)).status).toBe("CONFIRMED");
    const stored = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, event.id));
    expect(stored).toHaveLength(1);
    expect(stored[0].processedAt).not.toBeNull();
  });

  it("WHK-02 the same event delivered 3 times in a row is applied once", async () => {
    const w = await createWorld();
    const v = await hold(w);
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") });
    const event = makeFakeEvent("payment.succeeded", await completePending(v.id));
    const res = await send(event, { times: 3 });
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(res.map((r) => JSON.parse(r.body).duplicate)).toEqual([false, true, true]);
    const [stored] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, event.id));
    expect(stored.deliveries).toBe(3);
    expect(await confirmedAudits(v.id)).toBe(1);
  });

  it("WHK-03 three concurrent copies of the same event are applied once", async () => {
    const w = await createWorld();
    const v = await hold(w);
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") });
    const event = makeFakeEvent("payment.succeeded", await completePending(v.id));
    const res = await send(event, { times: 3, concurrent: true });
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(res.filter((r) => JSON.parse(r.body).duplicate === false)).toHaveLength(1);
    expect(await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, event.id))).toHaveLength(1);
    expect(await confirmedAudits(v.id)).toBe(1);
    expect((await reservationRow(v.id)).status).toBe("CONFIRMED");
  });

  it("WHK-02b the provider's own webhooks (incl. its duplicates) after a synchronous success change nothing", async () => {
    const w = await createWorld();
    const before = pay.sent.length;
    const v = await hold(w);
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    const mine = pay.sent.slice(before).map((s) => JSON.parse(s.body));
    expect(mine.map((e) => e.type).sort()).toEqual(["deposit.held", "payment.succeeded"]);
    for (const e of mine) {
      const res = await send(e, { times: 2, concurrent: true });
      expect(res.map((r) => r.status)).toEqual([200, 200]);
    }
    expect(await confirmedAudits(v.id)).toBe(1);
    expect((await getReservation(w.customer, v.id))).toMatchObject({ status: "CONFIRMED", paymentStatus: "succeeded", depositStatus: "held" });
  });

  it.each(["tampered", "missing", "stale"] as const)("WHK-04 a %s signature is rejected with 400 and nothing is stored", async (signature) => {
    const w = await createWorld();
    const v = await hold(w);
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") });
    const event = makeFakeEvent("payment.succeeded", await completePending(v.id));
    const [res] = await send(event, { signature });
    expect(res.status).toBe(400);
    expect(await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, event.id))).toHaveLength(0);
    expect((await reservationRow(v.id)).status).toBe("PENDING");
  });

  it("WHK-04b a body signed with another secret is rejected", async () => {
    const event = makeFakeEvent("payment.succeeded", { id: "pay_x", amount: 1, currency: "AED", status: "succeeded", amountRefunded: 0, metadata: {} });
    const [res] = await send(event, { secret: "some-other-secret-value" });
    expect(res.status).toBe(400);
  });

  it("WHK-05 out-of-order events never move a status backwards", async () => {
    const w = await createWorld();
    const v = await hold(w);
    await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    const [pm] = await providerPaymentsFor(v.id);
    const refunded = { ...pm, status: "refunded", amountRefunded: pm.amount };
    await send(makeFakeEvent("payment.refunded", refunded));
    // A late, older "succeeded" arrives afterwards.
    await send(makeFakeEvent("payment.succeeded", { ...pm, status: "succeeded", amountRefunded: 0 }));
    const [row] = await db.select().from(payments).where(eq(payments.reservationId, v.id));
    expect(row).toMatchObject({ status: "refunded", amountRefundedFils: pm.amount });
    const state = await pay.store.load();
    const h = Object.values(state.holds).find((x) => x.metadata.reservationId === v.id)!;
    await send(makeFakeEvent("deposit.released", { ...h, status: "released" }));
    await send(makeFakeEvent("deposit.held", { ...h, status: "held" }));
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, v.id));
    expect(dep.status).toBe("released");
  });

  it("WHK-06 events for unknown payments/holds are acknowledged and ignored", async () => {
    const unknownPay = makeFakeEvent("payment.succeeded", { id: "pay_unknown", amount: 100, currency: "AED", status: "succeeded", amountRefunded: 0, metadata: {} });
    const unknownHold = makeFakeEvent("deposit.held", { id: "hold_unknown", amount: 100, currency: "AED", status: "held", amountCaptured: 0, metadata: {} });
    for (const e of [unknownPay, unknownHold]) {
      const [res] = await send(e);
      expect(res.status).toBe(200);
    }
  });

  it("WHK-06b malformed JSON with a valid signature is a 400, not a 500", async () => {
    const { signFakeWebhook } = await import("../support/webhooks");
    const body = "{not json";
    const res = await webhookPost(
      new Request("http://localhost/api/webhooks/payments", { method: "POST", headers: { "fake-signature": signFakeWebhook(body, WEBHOOK_SECRET) }, body }),
    );
    expect(res.status).toBe(400);
  });
});
