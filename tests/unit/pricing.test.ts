// PRC-* (unit): pure pricing arithmetic. Expected values are worked out by hand from
// docs/architecture.md, never by calling the code under test.
import { afterEach, describe, expect, it } from "vitest";
import {
  cancellationOutcome,
  canModifyDates,
  computeQuote,
  lateDays,
  priceExtra,
  rentalDays,
  returnCharges,
  vatOn,
  vatRateBps,
  type ExtraPricing,
} from "@/lib/pricing/calc";
import { selectRateRule, type RateRule } from "@/lib/pricing/rules";

const H = 3_600_000;
const M = 60_000;
const t0 = new Date("2026-11-10T06:00:00Z"); // 10:00 in Dubai

const at = (ms: number) => new Date(t0.getTime() + ms);

describe("PRC rental days: ceil(duration / 24h), minimum 1", () => {
  it("PRC-01 exactly 24h is 1 day", () => expect(rentalDays(t0, at(24 * H))).toBe(1));
  it("PRC-02 exactly 72h is 3 days", () => expect(rentalDays(t0, at(72 * H))).toBe(3));
  it("PRC-03 30 minutes is the 1-day minimum", () => expect(rentalDays(t0, at(30 * M))).toBe(1));
  it("PRC-04 72h + 1 min is 4 days (the 59-minute grace applies to late returns, not to the booked period)", () => {
    expect(rentalDays(t0, at(72 * H + M))).toBe(4);
    expect(rentalDays(t0, at(72 * H + 59 * M))).toBe(4);
  });
  it("PRC-05/06 73h and 73h + 1s are 4 days", () => {
    expect(rentalDays(t0, at(73 * H))).toBe(4);
    expect(rentalDays(t0, at(73 * H + 1000))).toBe(4);
  });
  it("rejects a non-positive duration", () => {
    expect(() => rentalDays(t0, t0)).toThrow();
  });
  it("PRC-20 counts elapsed 24h periods, not calendar dates (crossing Dubai midnight)", () => {
    const late = new Date("2026-11-10T19:30:00Z"); // 23:30 Dubai
    expect(rentalDays(late, new Date(late.getTime() + H))).toBe(1); // spans two local dates, still 1 day
    expect(rentalDays(late, new Date(late.getTime() + 25 * H))).toBe(2);
  });
});

describe("PRC late returns: 59-minute grace, then whole extra days", () => {
  const due = at(72 * H);
  it("PRC-08 up to 59 minutes late is free", () => {
    expect(lateDays(due, due)).toBe(0);
    expect(lateDays(due, new Date(due.getTime() - H))).toBe(0); // early
    expect(lateDays(due, new Date(due.getTime() + 59 * M))).toBe(0);
  });
  it("PRC-07 59 min + 1 s late is one extra day; 60 minutes too", () => {
    expect(lateDays(due, new Date(due.getTime() + 59 * M + 1000))).toBe(1);
    expect(lateDays(due, new Date(due.getTime() + 60 * M))).toBe(1);
  });
  it("PRC-09 24h59m late is 1 day; 25h late is 2; 2 days late is 2", () => {
    expect(lateDays(due, new Date(due.getTime() + 24 * H + 59 * M))).toBe(1);
    expect(lateDays(due, new Date(due.getTime() + 25 * H))).toBe(2);
    expect(lateDays(due, new Date(due.getTime() + 48 * H))).toBe(2);
  });
  it("PRC-07 late fee = days x daily rate, VAT 5% on (late + fuel + damage), capture capped by the deposit", () => {
    const c = returnCharges({
      scheduledReturnAt: due,
      actualReturnAt: new Date(due.getTime() + 2 * H),
      dailyRateFils: 20_000,
      pickupFuelLevel: 8,
      returnFuelLevel: 6,
      damageChargeFils: 10_000,
      depositFils: 150_000,
      vatRateBps: 500,
    });
    // 1 late day 20000 + 2 eighths x 4000 = 8000 + damage 10000 = 38000; VAT 1900; total 39900
    expect(c).toEqual({
      lateDays: 1,
      lateFeeFils: 20_000,
      fuelEighthsShort: 2,
      fuelChargeFils: 8_000,
      damageChargeFils: 10_000,
      taxFils: 1_900,
      totalFils: 39_900,
      depositCaptureFils: 39_900,
      amountDueFils: 0,
    });
    const big = returnCharges({
      scheduledReturnAt: due,
      actualReturnAt: due,
      dailyRateFils: 20_000,
      pickupFuelLevel: 4,
      returnFuelLevel: 8, // more fuel than at pick-up: no credit, no charge
      damageChargeFils: 200_000,
      depositFils: 150_000,
      vatRateBps: 500,
    });
    expect(big).toMatchObject({ fuelEighthsShort: 0, fuelChargeFils: 0, taxFils: 10_000, totalFils: 210_000, depositCaptureFils: 150_000, amountDueFils: 60_000 });
  });
});

describe("PRC VAT: 5%, half-up, once on the taxable total", () => {
  afterEach(() => {
    delete process.env.VAT_RATE_BPS;
  });
  it("PRC-14 5% of 95000 is 4750", () => expect(vatOn(95_000, 500)).toBe(4_750));
  it("PRC-15 5% of 33330 = 1666.5 rounds half-up to 1667", () => expect(vatOn(33_330, 500)).toBe(1_667));
  it("PRC-15b 5% of 33329 = 1666.45 rounds down to 1666; 5% of 10 = 0.5 rounds up to 1", () => {
    expect(vatOn(33_329, 500)).toBe(1_666);
    expect(vatOn(10, 500)).toBe(1);
    expect(vatOn(9, 500)).toBe(0);
  });
  it("PRC-16 VAT is rounded once on the total, not per line (10010 + 10010 -> 1001, not 1002)", () => {
    const q = computeQuote({
      dailyRateFils: 10_010,
      rentalDays: 1,
      extras: [{ extra: { extraId: "x", code: "X", name: "X", pricingType: "PER_RENTAL", priceFils: 10_010, maxPriceFils: null }, quantity: 1 }],
      oneWayFeeFils: 0,
      depositFils: 0,
      vatRateBps: 500,
    });
    expect(q.taxFils).toBe(1_001);
    expect(vatOn(10_010, 500) + vatOn(10_010, 500)).toBe(1_002); // what per-line rounding would give
  });
  it("PRC-19 VAT rate is configurable via VAT_RATE_BPS; default 500", () => {
    expect(vatRateBps()).toBe(500);
    process.env.VAT_RATE_BPS = "750";
    expect(vatRateBps()).toBe(750);
    expect(vatOn(10_000, 750)).toBe(750);
    expect(vatOn(10_000, 0)).toBe(0);
    process.env.VAT_RATE_BPS = "abc";
    expect(() => vatRateBps()).toThrow();
  });
  it("rejects negative or fractional amounts", () => {
    expect(() => vatOn(-1, 500)).toThrow();
    expect(() => vatOn(1.5, 500)).toThrow();
  });
});

const childSeat: ExtraPricing = { extraId: "cs", code: "CS", name: "Child seat", pricingType: "PER_DAY", priceFils: 2_500, maxPriceFils: 25_000 };
const gps: ExtraPricing = { extraId: "gps", code: "GPS", name: "GPS", pricingType: "PER_RENTAL", priceFils: 5_000, maxPriceFils: null };

describe("PRC extras and the full quote", () => {
  it("PRC-11 PER_DAY x days x qty plus PER_RENTAL once", () => {
    expect(priceExtra(childSeat, 3, 2)).toMatchObject({ unitTotalFils: 7_500, totalFils: 15_000 });
    expect(priceExtra(gps, 3, 1)).toMatchObject({ unitTotalFils: 5_000, totalFils: 5_000 });
  });
  it("PRC-12 PER_DAY extras are capped per unit by maxPriceFils", () => {
    expect(priceExtra(childSeat, 14, 1).unitTotalFils).toBe(25_000); // 14 x 2500 = 35000 capped
    expect(priceExtra(childSeat, 14, 2).totalFils).toBe(50_000);
  });
  it("PRC-13/14/17/18 full breakdown: rental + extras + one-way, VAT on those, deposit untaxed and separate", () => {
    const q = computeQuote({
      dailyRateFils: 20_000,
      rentalDays: 3,
      extras: [
        { extra: childSeat, quantity: 2 },
        { extra: gps, quantity: 1 },
      ],
      oneWayFeeFils: 15_000,
      depositFils: 150_000,
      vatRateBps: 500,
    });
    // rental 60000; extras 15000 + 5000 = 20000; one-way 15000 -> subtotal 95000; VAT 4750; total 99750
    expect(q).toMatchObject({
      rentalFils: 60_000,
      extrasFils: 20_000,
      oneWayFeeFils: 15_000,
      subtotalFils: 95_000,
      taxFils: 4_750,
      totalFils: 99_750,
      depositFils: 150_000,
    });
    for (const v of [q.rentalFils, q.extrasFils, q.subtotalFils, q.taxFils, q.totalFils]) expect(Number.isInteger(v)).toBe(true);
  });
});

describe("PRC cancellation and date-change policy (48h)", () => {
  const pickupAt = at(100 * H);
  const base = { pickupAt, paidFils: 42_000, dailyRateFils: 20_000, vatRateBps: 500 };
  it("CXL-01 more than 48h before pick-up: free, full refund", () => {
    expect(cancellationOutcome({ ...base, now: new Date(pickupAt.getTime() - 48 * H - M) })).toEqual({ allowed: true, free: true, feeFils: 0, refundFils: 42_000 });
  });
  it("CXL-02 exactly 48h before pick-up is still free", () => {
    expect(cancellationOutcome({ ...base, now: new Date(pickupAt.getTime() - 48 * H) })).toMatchObject({ free: true, feeFils: 0 });
  });
  it("CXL-03 within 48h: one day + VAT (21000) is kept", () => {
    expect(cancellationOutcome({ ...base, now: new Date(pickupAt.getTime() - 48 * H + 1000) })).toEqual({
      allowed: true,
      free: false,
      feeFils: 21_000,
      refundFils: 21_000,
    });
  });
  it("CXL-03b the fee never exceeds what was paid", () => {
    expect(cancellationOutcome({ ...base, paidFils: 10_000, now: new Date(pickupAt.getTime() - H) })).toMatchObject({ feeFils: 10_000, refundFils: 0 });
  });
  it("CXL-04 at or after pick-up: not allowed", () => {
    expect(cancellationOutcome({ ...base, now: pickupAt }).allowed).toBe(false);
    expect(cancellationOutcome({ ...base, now: new Date(pickupAt.getTime() + H) }).allowed).toBe(false);
  });
  it("MOD-02 date changes allowed until exactly 48h before pick-up", () => {
    expect(canModifyDates(pickupAt, new Date(pickupAt.getTime() - 48 * H))).toBe(true);
    expect(canModifyDates(pickupAt, new Date(pickupAt.getTime() - 48 * H + 1))).toBe(false);
  });
});

describe("PRC-10 rate rule selection (most specific wins)", () => {
  const rule = (over: Partial<RateRule>): RateRule => ({
    id: Math.random().toString(36).slice(2),
    categoryId: "cat",
    vehicleId: null,
    branchId: null,
    dailyRateFils: 20_000,
    minDays: 1,
    maxDays: null,
    validFrom: null,
    validTo: null,
    priority: 0,
    isActive: true,
    ...over,
  });
  const target = { vehicleId: "veh", categoryId: "cat", branchId: "br", pickupLocalDate: "2026-12-20", rentalDays: 3 };
  it("vehicle rule beats category rule; branch rule beats any-branch; season beats open-ended", () => {
    const base = rule({ dailyRateFils: 20_000 });
    const season = rule({ dailyRateFils: 30_000, validFrom: "2026-12-15", validTo: "2027-01-05" });
    const branch = rule({ dailyRateFils: 25_000, branchId: "br" });
    const vehicle = rule({ dailyRateFils: 40_000, vehicleId: "veh", categoryId: null });
    expect(selectRateRule([base, season], target)?.dailyRateFils).toBe(30_000);
    expect(selectRateRule([base, season, branch], target)?.dailyRateFils).toBe(25_000);
    expect(selectRateRule([base, season, branch, vehicle], target)?.dailyRateFils).toBe(40_000);
  });
  it("long-rental rule applies only from minDays; inactive and out-of-season rules are ignored", () => {
    const base = rule({ dailyRateFils: 20_000 });
    const weekly = rule({ dailyRateFils: 17_000, minDays: 7 });
    expect(selectRateRule([base, weekly], target)?.dailyRateFils).toBe(20_000);
    expect(selectRateRule([base, weekly], { ...target, rentalDays: 7 })?.dailyRateFils).toBe(17_000);
    expect(selectRateRule([rule({ isActive: false })], target)).toBeNull();
    expect(selectRateRule([rule({ validTo: "2026-12-01" })], target)).toBeNull();
    expect(selectRateRule([rule({ categoryId: "other" })], target)).toBeNull();
  });
});
