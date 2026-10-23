// RES-*: the reservation transaction. HLD-*: holds, expiry and the idempotent release job.
import { spawnSync } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, deposits, payments, vehicles } from "@/db/schema";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/release-expired-holds/route";
import { releaseExpiredHolds } from "@/lib/jobs/release-expired-holds";
import { createReservation, generateReference, getReservation, payReservation } from "@/lib/reservations";
import { query, raceCalls } from "../support/db";
import { PROJECT_ROOT, qaDatabaseUrl } from "../support/qa-db";
import {
  bookingInput,
  createWorld,
  future,
  HOUR,
  installFakePayments,
  key,
  MIN,
  PRICES,
  reservationRow,
  type World,
} from "../support/fixtures";

let pay: ReturnType<typeof installFakePayments>;
beforeAll(() => {
  pay = installFakePayments();
});

const auditFor = (entityId: string) => db.select().from(auditLogs).where(eq(auditLogs.entityId, entityId));

describe("RES: reservation transaction", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld({ vehicleCount: 3 });
  });

  it("RES-01 creates a PENDING hold (15 min) with a server-side price, reference and audit row", async () => {
    const now = new Date();
    const p = future(10);
    const view = await createReservation(w.customer, bookingInput(w, p, new Date(p.getTime() + 48 * HOUR)), now);
    expect(view.status).toBe("PENDING");
    expect(view.reference).toMatch(/^DE-[A-HJ-NP-Z2-9]{6}$/);
    expect(view.holdExpiresAt!.getTime() - now.getTime()).toBe(15 * MIN);
    expect(view.price).toMatchObject({
      dailyRateFils: PRICES.dailyRate,
      rentalDays: 2,
      rentalFils: 40_000,
      extrasFils: 0,
      oneWayFeeFils: 0,
      taxFils: 2_000,
      totalFils: 42_000,
      depositFils: PRICES.deposit,
    });
    const audits = await auditFor(view.id);
    expect(audits.map((a) => a.action)).toContain("reservation.created");
  });

  it("RES-02 ignores any client-supplied price fields", async () => {
    const p = future(20);
    const view = await createReservation(
      w.customer,
      bookingInput(w, p, new Date(p.getTime() + 24 * HOUR), { totalFils: 1, dailyRateFils: 1, depositFils: 0, vehicleId: w.vehicles[1].id }),
    );
    const row = await reservationRow(view.id);
    expect(row.totalFils).toBe(21_000);
    expect(row.dailyRateFils).toBe(PRICES.dailyRate);
    expect(row.depositFils).toBe(PRICES.deposit);
  });

  it("RES-03 RETIRED and MAINTENANCE vehicles cannot be reserved", async () => {
    const x = await createWorld();
    for (const status of ["RETIRED", "MAINTENANCE"] as const) {
      await db.update(vehicles).set({ status }).where(eq(vehicles.id, x.vehicle.id));
      const p = future(5);
      await expect(createReservation(x.customer, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)))).rejects.toMatchObject({
        code: "VEHICLE_UNAVAILABLE",
      });
    }
  });

  it("RES-04 / BUG-003 invalid windows are rejected with VALIDATION and nothing is written", async () => {
    const x = await createWorld();
    const p = future(5);
    const cases = [
      bookingInput(x, p, new Date(p.getTime() - HOUR)), // return before pickup
      bookingInput(x, p, p), // zero length
      bookingInput(x, new Date(Date.now() - 2 * HOUR), new Date(Date.now() + 24 * HOUR)), // past pickup
      bookingInput(x, p, new Date(p.getTime() + 91 * 24 * HOUR)), // > 90 days
      { ...bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)), idempotencyKey: "short" },
    ];
    for (const input of cases) await expect(createReservation(x.customer, input)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await query("SELECT 1 FROM reservations WHERE vehicle_id = $1", [x.vehicle.id])).toHaveLength(0);
  });

  it("RES-05 unknown/inactive branches, wrong branch and unknown vehicles are rejected", async () => {
    const x = await createWorld();
    const p = future(5);
    const r = new Date(p.getTime() + 24 * HOUR);
    await expect(createReservation(x.customer, bookingInput(x, p, r, { pickupBranchId: x.branchB.id }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createReservation(x.customer, bookingInput(x, p, r, { vehicleId: "00000000-0000-4000-8000-000000000001" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await query("UPDATE branches SET is_active = false WHERE id = $1", [x.branchB.id]);
    await expect(createReservation(x.customer, bookingInput(x, p, r, { returnBranchId: x.branchB.id }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createReservation(x.customer, bookingInput(x, p, r, { extras: [{ extraId: "00000000-0000-4000-8000-000000000002", quantity: 1 }] })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createReservation(x.customer, bookingInput(x, p, r, { extras: [{ extraId: x.childSeat.id, quantity: 4 }] }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("RES-06 a failure inside the transaction rolls everything back (incl. stale-hold expiry)", async () => {
    const x = await createWorld();
    const p = future(5);
    const r = new Date(p.getTime() + 24 * HOUR);
    const stale = await createReservation(x.customer, bookingInput(x, p, r), new Date(Date.now() - 30 * MIN));
    // Unknown extra fails during pricing, after the vehicle lock and the stale-hold expiry.
    await expect(
      createReservation(x.other, bookingInput(x, p, r, { extras: [{ extraId: "00000000-0000-4000-8000-000000000003", quantity: 1 }] })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const rows = await query<{ status: string }>("SELECT status FROM reservations WHERE vehicle_id = $1", [x.vehicle.id]);
    expect(rows).toEqual([{ status: "PENDING" }]); // stale hold untouched; no new row
    expect((await auditFor(stale.id)).map((a) => a.action)).toEqual(["reservation.created"]);
  });

  it("RES-07 confirmed only after payment succeeded and deposit held; statuses stored separately", async () => {
    const p = future(30);
    const v = await createReservation(w.customer, bookingInput(w, p, new Date(p.getTime() + 24 * HOUR), { vehicleId: w.vehicles[2].id }));
    expect(v.paymentStatus).toBeNull();
    const paid = await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    expect(paid).toMatchObject({ status: "CONFIRMED", paymentStatus: "succeeded", depositStatus: "held", paidFils: 21_000 });
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, v.id));
    expect(dep).toMatchObject({ status: "held", amountFils: PRICES.deposit });
    const [pm] = await db.select().from(payments).where(eq(payments.reservationId, v.id));
    expect(pm).toMatchObject({ status: "succeeded", amountFils: 21_000, purpose: "RENTAL" });
    expect((await auditFor(v.id)).map((a) => a.action)).toContain("reservation.confirmed");
  });

  it("RES-08 a declined deposit leaves the hold PENDING with no charge; the user can retry", async () => {
    const x = await createWorld();
    const p = future(30);
    const v = await createReservation(x.customer, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)));
    await expect(
      payReservation(x.customer, { reservationId: v.id, paymentMethod: "fake_decline", idempotencyKey: key("pay") }),
    ).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    const after = await getReservation(x.customer, v.id);
    expect(after.status).toBe("PENDING");
    expect(after.paidFils).toBe(0);
    expect(await db.select().from(payments).where(and(eq(payments.reservationId, v.id), eq(payments.status, "succeeded")))).toHaveLength(0);
    const retry = await payReservation(x.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    expect(retry.status).toBe("CONFIRMED");
  });

  it("RES-09 payment succeeding after the hold expired and the car was re-booked: no double booking, money returned", async () => {
    const x = await createWorld();
    const p = future(30);
    const r = new Date(p.getTime() + 24 * HOUR);
    const t0 = new Date();
    const v = await createReservation(x.customer, bookingInput(x, p, r), t0);
    const pending = await payReservation(x.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") }, t0);
    expect(pending.status).toBe("PENDING");
    // 16 minutes later another customer books the same car (stale hold expired in-transaction).
    const later = new Date(t0.getTime() + 16 * MIN);
    const winner = await createReservation(x.other, bookingInput(x, p, r), later);
    expect(winner.status).toBe("PENDING");
    expect((await reservationRow(v.id)).status).toBe("EXPIRED");
    // The provider then completes the pending charge and sends payment.succeeded.
    const state = await pay.store.load();
    const [providerPayment] = Object.values(state.payments).filter((pp) => pp.metadata.reservationId === v.id);
    providerPayment.status = "succeeded";
    await pay.store.save(state);
    const { processPaymentWebhook } = await import("@/lib/reservations");
    await processPaymentWebhook("fake", { id: `evt_${key()}`, type: "payment.succeeded", createdAt: later.toISOString(), data: providerPayment }, later);
    expect((await reservationRow(v.id)).status).toBe("EXPIRED");
    const after = await pay.store.load();
    expect(after.payments[providerPayment.id].status).toBe("refunded");
    const held = Object.values(after.holds).filter((h) => h.metadata.reservationId === v.id);
    expect(held.every((h) => h.status !== "held")).toBe(true);
    const active = await query("SELECT 1 FROM reservations WHERE vehicle_id = $1 AND status IN ('PENDING','CONFIRMED','PICKED_UP')", [x.vehicle.id]);
    expect(active).toHaveLength(1);
  });

  it("RES-10 references are unique and use the documented alphabet", async () => {
    const refs = new Set(Array.from({ length: 2_000 }, () => generateReference()));
    expect(refs.size).toBe(2_000);
    for (const r of refs) expect(r).toMatch(/^DE-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("RES-11 retrying createReservation with the same idempotency key returns the same reservation (sequential and concurrent)", async () => {
    const x = await createWorld();
    const p = future(12);
    const input = bookingInput(x, p, new Date(p.getTime() + 24 * HOUR));
    const a = await createReservation(x.customer, input);
    const b = await createReservation(x.customer, input);
    expect(b.id).toBe(a.id);
    const y = await createWorld();
    const input2 = bookingInput(y, p, new Date(p.getTime() + 24 * HOUR));
    const outcome = await raceCalls([0, 1, 2].map(() => () => createReservation(y.customer, input2)));
    expect(outcome.rejected).toEqual([]);
    expect(new Set(outcome.fulfilled.map((v) => v.id)).size).toBe(1);
    expect(await query("SELECT 1 FROM reservations WHERE vehicle_id = $1", [y.vehicle.id])).toHaveLength(1);
    // Same key for a different vehicle is a conflict, not a silent replay.
    await expect(createReservation(y.customer, { ...input2, vehicleId: x.vehicle.id, pickupBranchId: x.branchA.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("HLD: holds and the release job", () => {
  it("HLD-01 expired holds become EXPIRED; pending payment cancelled and deposit released; audited", async () => {
    const x = await createWorld();
    const p = future(30);
    const t0 = new Date();
    const v = await createReservation(x.customer, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)), t0);
    await payReservation(x.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") }, t0);
    const result = await releaseExpiredHolds(new Date(t0.getTime() + 16 * MIN));
    expect(result.expiredReservations).toContain(v.id);
    expect(result.voided.find((r) => r.reservationId === v.id)).toMatchObject({ releasedDeposits: 1 });
    expect((await reservationRow(v.id)).status).toBe("EXPIRED");
    const [pm] = await db.select().from(payments).where(eq(payments.reservationId, v.id));
    expect(pm.status).toBe("canceled");
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, v.id));
    expect(dep.status).toBe("released");
    const state = await pay.store.load();
    expect(state.holds[dep.providerHoldId!].status).toBe("released");
    expect((await auditFor(v.id)).map((a) => a.action)).toEqual(expect.arrayContaining(["reservation.expired", "reservation.money_voided"]));
  });

  it("HLD-02 the release job is idempotent (second run and two concurrent runs change nothing)", async () => {
    const x = await createWorld();
    const p = future(30);
    const t0 = new Date();
    const v = await createReservation(x.customer, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)), t0);
    await payReservation(x.customer, { reservationId: v.id, paymentMethod: "fake_pending", idempotencyKey: key("pay") }, t0);
    const at = new Date(t0.getTime() + 16 * MIN);
    const both = await Promise.all([releaseExpiredHolds(at), releaseExpiredHolds(at)]);
    const expiredCount = both.filter((r) => r.expiredReservations.includes(v.id)).length;
    expect(expiredCount).toBe(1);
    const auditsAfterFirst = (await auditFor(v.id)).length;
    const eventsAfterFirst = (await pay.store.load()).events.length;
    const again = await releaseExpiredHolds(at);
    expect(again.expiredReservations).not.toContain(v.id);
    expect(again.voided.map((r) => r.reservationId)).not.toContain(v.id);
    expect((await auditFor(v.id)).length).toBe(auditsAfterFirst);
    expect((await pay.store.load()).events.length).toBe(eventsAfterFirst);
    expect((await auditFor(v.id)).filter((a) => a.action === "reservation.expired")).toHaveLength(1);
  });

  it("HLD-03/06 live holds and CONFIRMED reservations are untouched", async () => {
    const x = await createWorld({ vehicleCount: 2 });
    const p = future(30);
    const live = await createReservation(x.customer, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)));
    const conf = await createReservation(x.other, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR), { vehicleId: x.vehicles[1].id }));
    await payReservation(x.other, { reservationId: conf.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    const result = await releaseExpiredHolds(new Date(Date.now() + 5 * MIN));
    expect(result.expiredReservations).not.toContain(live.id);
    expect(result.expiredReservations).not.toContain(conf.id);
    expect((await reservationRow(live.id)).status).toBe("PENDING");
    expect((await reservationRow(conf.id)).status).toBe("CONFIRMED");
    // Even far in the future, CONFIRMED never expires.
    await releaseExpiredHolds(new Date(Date.now() + 365 * 24 * HOUR));
    expect((await reservationRow(conf.id)).status).toBe("CONFIRMED");
  });

  it("HLD-04 an expired-but-unreleased hold stops blocking immediately: search and booking ignore it", async () => {
    const x = await createWorld();
    const p = future(30);
    const r = new Date(p.getTime() + 24 * HOUR);
    const t0 = new Date(Date.now() - 20 * MIN);
    const stale = await createReservation(x.customer, bookingInput(x, p, r), t0);
    const { searchVehicles, getAvailabilityCalendar } = await import("@/lib/availability");
    const found = await searchVehicles({ pickupBranchId: x.branchA.id, pickupAt: p, returnAt: r });
    expect(found.vehicles.map((v) => v.id)).toContain(x.vehicle.id);
    const cal = await getAvailabilityCalendar({ vehicleId: x.vehicle.id, days: 60 });
    expect(cal.busy).toEqual([]);
    const fresh = await createReservation(x.other, bookingInput(x, p, r));
    expect(fresh.status).toBe("PENDING");
    expect((await reservationRow(stale.id)).status).toBe("EXPIRED");
  });

  it("HLD-05 at exactly hold_expires_at the hold is expired for both the job and the booking check", async () => {
    const x = await createWorld();
    const p = future(30);
    const r = new Date(p.getTime() + 24 * HOUR);
    const t0 = new Date();
    const v = await createReservation(x.customer, bookingInput(x, p, r), t0);
    const at = v.holdExpiresAt!;
    const other = await createReservation(x.other, bookingInput(x, p, r), at);
    expect(other.status).toBe("PENDING");
    expect((await reservationRow(v.id)).status).toBe("EXPIRED");
    // And one millisecond earlier it still blocks.
    const y = await createWorld();
    const v2 = await createReservation(y.customer, bookingInput(y, p, r), t0);
    await expect(createReservation(y.other, bookingInput(y, p, r), new Date(v2.holdExpiresAt!.getTime() - 1))).rejects.toMatchObject({
      code: "VEHICLE_UNAVAILABLE",
    });
    const job = await releaseExpiredHolds(v2.holdExpiresAt!);
    expect(job.expiredReservations).toContain(v2.id);
  });

  it("HLD-07 cron route: GET and POST require Authorization: Bearer CRON_SECRET", async () => {
    const secret = process.env.CRON_SECRET;
    expect(secret, "CRON_SECRET must be set in .env.local").toBeTruthy();
    const url = "http://localhost:3100/api/cron/release-expired-holds";
    for (const handler of [cronGet, cronPost]) {
      expect((await handler(new Request(url))).status).toBe(401);
      expect((await handler(new Request(url, { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
      expect((await handler(new Request(url, { headers: { authorization: `${secret}` } }))).status).toBe(401);
      const ok = await handler(new Request(url, { headers: { authorization: `Bearer ${secret}` } }));
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body).toHaveProperty("expiredReservations");
      expect(ok.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("HLD-07b cron route really expires holds", async () => {
    const x = await createWorld();
    const p = future(30);
    const v = await createReservation(x.customer, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)), new Date(Date.now() - 20 * MIN));
    const res = await cronGet(new Request("http://localhost/api/cron/release-expired-holds", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect((await res.json()).expiredReservations).toContain(v.id);
    expect((await reservationRow(v.id)).status).toBe("EXPIRED");
  });

  it("HLD-08 `pnpm jobs:release-holds` against driveeasy_qa expires holds", async () => {
    const x = await createWorld();
    const p = future(30);
    const v = await createReservation(x.customer, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)), new Date(Date.now() - 20 * MIN));
    const url = qaDatabaseUrl();
    const out = spawnSync("pnpm", ["run", "jobs:release-holds"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url, FAKE_PAYMENTS_STATE_FILE: ".local/qa-job-payments.json", FAKE_PAYMENTS_WEBHOOK_URL: "" },
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 120_000,
    });
    expect(out.stdout + out.stderr).toMatch(/Expired \d+ hold/);
    expect((await reservationRow(v.id)).status).toBe("EXPIRED");
  }, 150_000);
});
