// PRC-21 (stored price = quote), one-way fees, weekly rates, check-out / check-in with late,
// fuel and damage charges, deposit capture/release (PAY-08/09), vouchers (AZ-15).
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { deposits, oneWayFees, rentalAgreements, reservations, vehicles } from "@/db/schema";
import { getQuote } from "@/lib/pricing/quote";
import {
  checkInReservation,
  checkOutReservation,
  createReservation,
  getVoucher,
  payReservation,
  settleReturnedDeposit,
  verifyVoucherPayload,
} from "@/lib/reservations";
import { bookingInput, createWorld, future, HOUR, installFakePayments, key, MIN, PRICES, reservationRow, type World } from "../support/fixtures";

let pay: ReturnType<typeof installFakePayments>;
beforeAll(() => {
  pay = installFakePayments();
});

async function confirmed(w: World, pickupAt: Date, returnAt: Date, more: Record<string, unknown> = {}, who = w.customer) {
  const v = await createReservation(who, bookingInput(w, pickupAt, returnAt, more));
  return payReservation(who, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
}

describe("PRC: server prices end to end", () => {
  it("PRC-21 one-way rental with all extras: stored breakdown equals the quote and the hand calculation", async () => {
    const w = await createWorld();
    const p = future(10);
    const r = new Date(p.getTime() + 72 * HOUR);
    const extras = [
      { extraId: w.childSeat.id, quantity: 2 },
      { extraId: w.gps.id, quantity: 1 },
      { extraId: w.insurance.id, quantity: 1 },
    ];
    const quote = await getQuote({ vehicleId: w.vehicle.id, pickupBranchId: w.branchA.id, returnBranchId: w.branchB.id, pickupAt: p, returnAt: r, extras });
    // rental 3 x 20000 = 60000; extras 2x(3x2500) + 5000 + 3x4000 = 15000 + 5000 + 12000 = 32000; one-way 15000
    // subtotal 107000; VAT 5% = 5350; total 112350; deposit 150000 (untaxed, separate)
    expect(quote).toMatchObject({
      dailyRateFils: 20_000, rentalDays: 3, rentalFils: 60_000, extrasFils: 32_000, oneWayFeeFils: 15_000,
      subtotalFils: 107_000, vatRateBps: 500, taxFils: 5_350, totalFils: 112_350, depositFils: 150_000, available: true, timezone: "Asia/Dubai",
    });
    const v = await createReservation(w.customer, bookingInput(w, p, r, { returnBranchId: w.branchB.id, extras }));
    const row = await reservationRow(v.id);
    expect(row).toMatchObject({ rentalFils: 60_000, extrasFils: 32_000, oneWayFeeFils: 15_000, taxFils: 5_350, totalFils: 112_350, depositFils: 150_000 });
    expect(row.rentalFils + row.extrasFils + row.oneWayFeeFils + row.taxFils).toBe(row.totalFils);
    expect(v.price.extras.map((e) => e.totalFils).sort((a, b) => a - b)).toEqual([5_000, 12_000, 15_000]);
    // The payment charged is exactly the total; the deposit hold exactly the deposit.
    const paid = await payReservation(w.customer, { reservationId: v.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    expect(paid.paidFils).toBe(112_350);
    const state = await pay.store.load();
    const holds = Object.values(state.holds).filter((h) => h.metadata.reservationId === v.id);
    expect(holds.map((h) => h.amount)).toEqual([150_000]);
  });

  it("PRC-13 one-way fee per direction; same branch = 0; unknown route refused", async () => {
    const w = await createWorld();
    const p = future(10);
    const r = new Date(p.getTime() + 24 * HOUR);
    const base = { vehicleId: w.vehicle.id, pickupBranchId: w.branchA.id, pickupAt: p, returnAt: r, extras: [] };
    expect((await getQuote(base)).oneWayFeeFils).toBe(0);
    expect((await getQuote({ ...base, returnBranchId: w.branchB.id })).oneWayFeeFils).toBe(PRICES.oneWayAtoB);
    await db.delete(oneWayFees).where(eq(oneWayFees.fromBranchId, w.branchA.id));
    await expect(getQuote({ ...base, returnBranchId: w.branchB.id })).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  });

  it("PRC-10 the weekly rule applies from 7 days; 6 days uses the base rate", async () => {
    const w = await createWorld();
    const p = future(10);
    const q6 = await getQuote({ vehicleId: w.vehicle.id, pickupBranchId: w.branchA.id, pickupAt: p, returnAt: new Date(p.getTime() + 6 * 24 * HOUR), extras: [] });
    const q7 = await getQuote({ vehicleId: w.vehicle.id, pickupBranchId: w.branchA.id, pickupAt: p, returnAt: new Date(p.getTime() + 7 * 24 * HOUR), extras: [] });
    expect(q6).toMatchObject({ dailyRateFils: 20_000, rentalFils: 120_000, taxFils: 6_000, totalFils: 126_000 });
    expect(q7).toMatchObject({ dailyRateFils: 17_000, rentalFils: 119_000, taxFils: 5_950, totalFils: 124_950 });
  });

  it("PRC-04 a booking 1 minute longer than 3 days costs 4 days", async () => {
    const w = await createWorld();
    const p = future(10);
    const q = await getQuote({ vehicleId: w.vehicle.id, pickupBranchId: w.branchA.id, pickupAt: p, returnAt: new Date(p.getTime() + 72 * HOUR + MIN), extras: [] });
    expect(q.rentalDays).toBe(4);
  });

  it("PRC-03 a 30-minute rental is charged the 1-day minimum", async () => {
    const w = await createWorld();
    const p = future(10);
    const q = await getQuote({ vehicleId: w.vehicle.id, pickupBranchId: w.branchA.id, pickupAt: p, returnAt: new Date(p.getTime() + 30 * MIN), extras: [] });
    expect(q).toMatchObject({ rentalDays: 1, rentalFils: 20_000, totalFils: 21_000 });
  });

  it("BUG-003 getQuote with return before pick-up gives VALIDATION, not a RangeError", async () => {
    const w = await createWorld();
    const p = future(10);
    await expect(getQuote({ vehicleId: w.vehicle.id, pickupBranchId: w.branchA.id, pickupAt: p, returnAt: new Date(p.getTime() - HOUR), extras: [] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("FLOW (service level): check-out, check-in, charges and deposits", () => {
  it("FLOW-03/04 on-time return: agreement records mileage and fuel, no charges, deposit released, car AVAILABLE", async () => {
    const w = await createWorld();
    const p = new Date(Date.now() + 2 * HOUR);
    const r = new Date(p.getTime() + 24 * HOUR);
    const v = await confirmed(w, p, r);
    const out = await checkOutReservation(w.admin, { reservationId: v.reference, mileageKm: 1_200, fuelLevel: 8 });
    expect(out.status).toBe("PICKED_UP");
    expect((await db.select().from(vehicles).where(eq(vehicles.id, w.vehicle.id)))[0].status).toBe("ON_RENT");
    const back = await checkInReservation(w.admin, { reservationId: v.id, mileageKm: 1_450, fuelLevel: 8, returnedAt: new Date(r.getTime() - HOUR) }, new Date(r.getTime()));
    expect(back.status).toBe("RETURNED");
    expect(back.charges).toMatchObject({ lateDays: 0, totalFils: 0, depositCaptureFils: 0 });
    const [ag] = await db.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, v.id));
    expect(ag).toMatchObject({ pickupMileageKm: 1_200, pickupFuelLevel: 8, returnMileageKm: 1_450, returnFuelLevel: 8 });
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, v.id));
    expect(dep.status).toBe("released");
    expect((await pay.store.load()).holds[dep.providerHoldId!].status).toBe("released");
    expect((await db.select().from(vehicles).where(eq(vehicles.id, w.vehicle.id)))[0]).toMatchObject({ status: "AVAILABLE", mileageKm: 1_450 });
  });

  it("FLOW-05 / PAY-09 2h late, 2/8 fuel short, damage 100 AED: 39900 captured from the deposit, rest released", async () => {
    const w = await createWorld();
    const p = new Date(Date.now() + 2 * HOUR);
    const r = new Date(p.getTime() + 24 * HOUR);
    const v = await confirmed(w, p, r);
    await checkOutReservation(w.admin, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 8 });
    const returnedAt = new Date(r.getTime() + 2 * HOUR);
    const back = await checkInReservation(w.admin, { reservationId: v.id, mileageKm: 1_300, fuelLevel: 6, damageChargeFils: 10_000, vehicleStatus: "MAINTENANCE" }, returnedAt);
    expect(back.charges).toEqual({
      lateDays: 1, lateFeeFils: 20_000, fuelEighthsShort: 2, fuelChargeFils: 8_000, damageChargeFils: 10_000,
      taxFils: 1_900, totalFils: 39_900, depositCaptureFils: 39_900, amountDueFils: 0,
    });
    const [dep] = await db.select().from(deposits).where(eq(deposits.reservationId, v.id));
    expect(dep).toMatchObject({ status: "captured", amountCapturedFils: 39_900 });
    const hold = (await pay.store.load()).holds[dep.providerHoldId!];
    expect(hold).toMatchObject({ status: "captured", amountCaptured: 39_900 });
    expect((await db.select().from(vehicles).where(eq(vehicles.id, w.vehicle.id)))[0].status).toBe("MAINTENANCE");
    // Retrying settlement does nothing more.
    await settleReturnedDeposit(w.admin, v.id);
    expect((await db.select().from(deposits).where(eq(deposits.reservationId, v.id)))[0].amountCapturedFils).toBe(39_900);
  });

  it("FLOW-04b 59 minutes late is within the grace period: no late fee", async () => {
    const w = await createWorld();
    const p = new Date(Date.now() + 2 * HOUR);
    const r = new Date(p.getTime() + 24 * HOUR);
    const v = await confirmed(w, p, r);
    await checkOutReservation(w.admin, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 8 });
    const back = await checkInReservation(w.admin, { reservationId: v.id, mileageKm: 1_100, fuelLevel: 8 }, new Date(r.getTime() + 59 * MIN));
    expect(back.charges.lateDays).toBe(0);
    expect(back.charges.totalFils).toBe(0);
  });

  it("check-out/check-in guards: state, mileage, timing, admin-only", async () => {
    const w = await createWorld();
    const p = new Date(Date.now() + 2 * HOUR);
    const r = new Date(p.getTime() + 24 * HOUR);
    const pending = await createReservation(w.customer, bookingInput(w, p, r));
    await expect(checkOutReservation(w.admin, { reservationId: pending.id, mileageKm: 1_000, fuelLevel: 8 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const v = await payReservation(w.customer, { reservationId: pending.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
    await expect(checkOutReservation(w.customer, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(checkOutReservation(w.admin, { reservationId: v.id, mileageKm: 999, fuelLevel: 8 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(checkOutReservation(w.admin, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 9 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(checkInReservation(w.admin, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 8 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await checkOutReservation(w.admin, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 8 });
    await expect(checkInReservation(w.customer, { reservationId: v.id, mileageKm: 1_000, fuelLevel: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(checkInReservation(w.admin, { reservationId: v.id, mileageKm: 900, fuelLevel: 8 })).rejects.toMatchObject({ code: "VALIDATION" });
    // Too early: check-out opens 24h before pick-up.
    const later = await confirmed(w, future(5), future(6));
    await expect(checkOutReservation(w.admin, { reservationId: later.id, mileageKm: 2_000, fuelLevel: 8 })).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  });

  it("AZ-15 vouchers: signed payload without raw ids; tampering rejected; owner/admin only; confirmed only", async () => {
    const w = await createWorld({ vehicleCount: 2 });
    const p = future(10);
    const v = await confirmed(w, p, new Date(p.getTime() + 24 * HOUR));
    const voucher = await getVoucher(w.customer, v.reference);
    expect(voucher.qrPayload).toMatch(/^DE1\.DE-[A-Z0-9]{6}\.[A-Za-z0-9_-]{22}$/);
    expect(voucher.qrPayload).not.toContain(v.id);
    expect(voucher.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await verifyVoucherPayload(w.admin, voucher.qrPayload)).id).toBe(v.id);
    const sig = voucher.qrPayload.split(".")[2];
    const tampered = voucher.qrPayload.replace(sig, (sig[0] === "A" ? "B" : "A") + sig.slice(1));
    await expect(verifyVoucherPayload(w.admin, tampered)).rejects.toMatchObject({ code: "VALIDATION" });
    // Another reservation's signature does not transfer.
    const v2 = await confirmed(w, p, new Date(p.getTime() + 24 * HOUR), { vehicleId: w.vehicles[1].id }, w.other);
    const other = await getVoucher(w.other, v2.id);
    await expect(verifyVoucherPayload(w.admin, `DE1.${v.reference}.${other.qrPayload.split(".")[2]}`)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(verifyVoucherPayload(w.customer, voucher.qrPayload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getVoucher(w.other, v.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const pending = await createReservation(w.customer, bookingInput(w, future(20), future(21)));
    await expect(getVoucher(w.customer, pending.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await getVoucher(w.admin, v.id)).reference).toBe(v.reference);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, v.id));
    expect(row.status).toBe("CONFIRMED");
  });
});
