import { afterEach, describe, expect, it } from "vitest";
import {
  cancellationOutcome,
  canModifyDates,
  computeQuote,
  DAY_MS,
  HOUR_MS,
  lateDays,
  priceExtra,
  rentalDays,
  returnCharges,
  vatOn,
  vatRateBps,
  type ExtraPricing,
} from "./calc";
import { selectRateRule, type RateRule } from "./rules";

const t0 = new Date("2026-11-01T06:00:00Z"); // 10:00 Asia/Dubai
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("rental days", () => {
  it("is ceil(duration / 24h) with a minimum of 1", () => {
    expect(rentalDays(t0, at(1))).toBe(1);
    expect(rentalDays(t0, at(DAY_MS))).toBe(1);
    expect(rentalDays(t0, at(DAY_MS + 1))).toBe(2);
    expect(rentalDays(t0, at(3 * DAY_MS))).toBe(3);
    expect(() => rentalDays(t0, t0)).toThrow();
  });
});

describe("late returns (59-minute grace)", () => {
  const due = t0;
  it.each([
    [0, 0],
    [59 * 60_000, 0],
    [59 * 60_000 + 1, 1],
    [HOUR_MS, 1],
    [DAY_MS + 59 * 60_000, 1],
    [DAY_MS + HOUR_MS, 2],
    [-HOUR_MS, 0],
  ])("%d ms late -> %d day(s)", (late, days) => {
    expect(lateDays(due, at(late))).toBe(days);
  });
});

describe("VAT", () => {
  it("rounds half-up to whole fils, once, on the total", () => {
    expect(vatOn(10_000, 500)).toBe(500);
    expect(vatOn(10, 500)).toBe(1); // 0.5 -> 1
    expect(vatOn(9, 500)).toBe(0); // 0.45 -> 0
    expect(vatOn(30, 500)).toBe(2); // 1.5 -> 2
    expect(vatOn(0, 500)).toBe(0);
  });
  it("defaults to 5% and validates VAT_RATE_BPS", () => {
    delete process.env.VAT_RATE_BPS;
    expect(vatRateBps()).toBe(500);
    process.env.VAT_RATE_BPS = "1.5";
    expect(() => vatRateBps()).toThrow();
  });
  afterEach(() => {
    delete process.env.VAT_RATE_BPS;
  });
});

describe("extras", () => {
  const seat: ExtraPricing = { extraId: "x", code: "CHILD_SEAT", name: "Seat", pricingType: "PER_DAY", priceFils: 2_500, maxPriceFils: 25_000 };
  it("charges per day, capped per unit, times quantity", () => {
    expect(priceExtra(seat, 3, 2).totalFils).toBe(15_000);
    expect(priceExtra(seat, 14, 1).totalFils).toBe(25_000);
    expect(priceExtra(seat, 14, 2).totalFils).toBe(50_000);
    expect(priceExtra({ ...seat, pricingType: "PER_RENTAL", priceFils: 15_000, maxPriceFils: null }, 9, 1).totalFils).toBe(15_000);
  });
});

describe("quote", () => {
  it("adds rental, extras and one-way fee, VAT on those only, deposit separate", () => {
    const q = computeQuote({
      dailyRateFils: 13_900,
      rentalDays: 3,
      extras: [{ extra: { extraId: "g", code: "GPS", name: "GPS", pricingType: "PER_DAY", priceFils: 2_000, maxPriceFils: 20_000 }, quantity: 1 }],
      oneWayFeeFils: 12_000,
      depositFils: 150_000,
      vatRateBps: 500,
    });
    expect(q).toMatchObject({ rentalFils: 41_700, extrasFils: 6_000, subtotalFils: 59_700, taxFils: 2_985, totalFils: 62_685, depositFils: 150_000 });
    for (const v of Object.values(q)) if (typeof v === "number") expect(Number.isInteger(v)).toBe(true);
  });
});

describe("cancellation policy", () => {
  const pickupAt = at(10 * DAY_MS);
  it("is free at exactly 48h before pick-up", () => {
    expect(cancellationOutcome({ pickupAt, now: new Date(pickupAt.getTime() - 48 * HOUR_MS), paidFils: 31_500, dailyRateFils: 10_000, vatRateBps: 500 })).toEqual({
      allowed: true,
      free: true,
      feeFils: 0,
      refundFils: 31_500,
    });
  });
  it("keeps one day incl. VAT inside 48h (capped at what was paid)", () => {
    const now = new Date(pickupAt.getTime() - 47 * HOUR_MS);
    expect(cancellationOutcome({ pickupAt, now, paidFils: 31_500, dailyRateFils: 10_000, vatRateBps: 500 })).toMatchObject({ feeFils: 10_500, refundFils: 21_000 });
    expect(cancellationOutcome({ pickupAt, now, paidFils: 5_000, dailyRateFils: 10_000, vatRateBps: 500 })).toMatchObject({ feeFils: 5_000, refundFils: 0 });
  });
  it("refuses once the pick-up time has passed", () => {
    expect(cancellationOutcome({ pickupAt, now: pickupAt, paidFils: 1, dailyRateFils: 1, vatRateBps: 500 }).allowed).toBe(false);
  });
  it("allows date changes until 48h before pick-up", () => {
    expect(canModifyDates(pickupAt, new Date(pickupAt.getTime() - 48 * HOUR_MS))).toBe(true);
    expect(canModifyDates(pickupAt, new Date(pickupAt.getTime() - 48 * HOUR_MS + 1))).toBe(false);
  });
});

describe("return charges", () => {
  it("charges late days at the daily rate, fuel per eighth, damage, plus VAT; capped by deposit", () => {
    const c = returnCharges({
      scheduledReturnAt: t0,
      actualReturnAt: at(26 * HOUR_MS),
      dailyRateFils: 20_000,
      pickupFuelLevel: 8,
      returnFuelLevel: 5,
      damageChargeFils: 100_000,
      depositFils: 150_000,
      vatRateBps: 500,
    });
    // 2 late days 400.00 + fuel 3 x 40.00 = 120.00 + damage 1000.00 = 1520.00; VAT 76.00 = 1596.00
    expect(c).toMatchObject({ lateDays: 2, lateFeeFils: 40_000, fuelChargeFils: 12_000, taxFils: 7_600, totalFils: 159_600, depositCaptureFils: 150_000, amountDueFils: 9_600 });
  });
});

describe("rate rule selection", () => {
  const base: RateRule = { id: "a", categoryId: "cat", vehicleId: null, branchId: null, dailyRateFils: 10_000, minDays: 1, maxDays: null, validFrom: null, validTo: null, priority: 0, isActive: true };
  const target = { vehicleId: "v1", categoryId: "cat", branchId: "b1", pickupLocalDate: "2026-12-24", rentalDays: 7 };
  it("prefers vehicle > branch > seasonal > priority > longer minimum", () => {
    const weekly = { ...base, id: "w", dailyRateFils: 8_500, minDays: 7 };
    const season = { ...base, id: "s", dailyRateFils: 13_000, validFrom: "2026-12-20", validTo: "2027-01-05" };
    const branch = { ...base, id: "br", branchId: "b1", dailyRateFils: 9_900 };
    const vehicle = { ...base, id: "v", vehicleId: "v1", dailyRateFils: 30_000 };
    expect(selectRateRule([base, weekly], target)?.id).toBe("w");
    expect(selectRateRule([base, weekly, season], target)?.id).toBe("s");
    expect(selectRateRule([base, weekly, season, branch], target)?.id).toBe("br");
    expect(selectRateRule([base, weekly, season, branch, vehicle], target)?.id).toBe("v");
    expect(selectRateRule([base, weekly], { ...target, rentalDays: 3 })?.id).toBe("a");
    expect(selectRateRule([{ ...base, isActive: false }], target)).toBeNull();
    expect(selectRateRule([base], { ...target, categoryId: "other" })).toBeNull();
  });
});
