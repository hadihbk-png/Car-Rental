// Pure pricing arithmetic. Integer fils only; no floating-point money anywhere.
// This module has no server dependencies so it can be unit-tested directly, but pages must
// never compute prices: they display what the server-side quote returns.

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Late returns within this grace period are not charged an extra day. */
export const LATE_GRACE_MS = 59 * 60 * 1000;
export const DEFAULT_VAT_RATE_BPS = 500; // 5% UAE VAT
export const HOLD_MINUTES = 15;
export const FREE_CANCELLATION_HOURS = 48;
export const MAX_RENTAL_DAYS = 90;
/** Fuel shortfall charge per eighth of a tank (net of VAT): AED 40. */
export const FUEL_CHARGE_PER_EIGHTH_FILS = 4_000;

export function vatRateBps(): number {
  const raw = process.env.VAT_RATE_BPS;
  const n = raw === undefined || raw === "" ? DEFAULT_VAT_RATE_BPS : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new Error(`Invalid VAT_RATE_BPS: ${raw}`);
  return n;
}

function assertFils(n: number, label: string) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${label} must be a non-negative integer, got ${n}`);
}

/** Rental days: ceil((return - pickup) / 24h), minimum 1. */
export function rentalDays(pickupAt: Date, returnAt: Date): number {
  const ms = returnAt.getTime() - pickupAt.getTime();
  if (!(ms > 0)) throw new RangeError("returnAt must be after pickupAt");
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/**
 * Extra days charged for a late return. The first 59 minutes after each 24h boundary are free:
 * lateDays = max(0, ceil((actualReturn - scheduledReturn - 59 min) / 24h)).
 * 59 min late -> 0; 60 min late -> 1; 24h 59m late -> 1; 25h late -> 2.
 */
export function lateDays(scheduledReturnAt: Date, actualReturnAt: Date): number {
  const late = actualReturnAt.getTime() - scheduledReturnAt.getTime() - LATE_GRACE_MS;
  return late <= 0 ? 0 : Math.ceil(late / DAY_MS);
}

/** VAT on a net amount, rounded half-up to whole fils. */
export function vatOn(netFils: number, bps: number): number {
  assertFils(netFils, "netFils");
  return Math.floor((netFils * bps + 5_000) / 10_000);
}

export type ExtraPricing = {
  extraId: string;
  code: string;
  name: string;
  pricingType: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxPriceFils: number | null;
};

export type ExtraLine = ExtraPricing & { quantity: number; unitTotalFils: number; totalFils: number };

/** One extra for the whole rental. PER_DAY prices are capped per unit by maxPriceFils. */
export function priceExtra(extra: ExtraPricing, days: number, quantity: number): ExtraLine {
  assertFils(extra.priceFils, "priceFils");
  if (!Number.isInteger(quantity) || quantity < 1) throw new RangeError("quantity must be >= 1");
  let unit = extra.pricingType === "PER_DAY" ? extra.priceFils * days : extra.priceFils;
  if (extra.maxPriceFils !== null && unit > extra.maxPriceFils) unit = extra.maxPriceFils;
  return { ...extra, quantity, unitTotalFils: unit, totalFils: unit * quantity };
}

export type QuoteBreakdown = {
  currency: "AED";
  dailyRateFils: number;
  rentalDays: number;
  rentalFils: number;
  extras: ExtraLine[];
  extrasFils: number;
  oneWayFeeFils: number;
  /** rental + extras + one-way fee (VAT applies to these). */
  subtotalFils: number;
  vatRateBps: number;
  taxFils: number;
  /** Charged now: subtotal + tax. */
  totalFils: number;
  /** Refundable hold, not taxed and not part of the total. */
  depositFils: number;
};

export function computeQuote(input: {
  dailyRateFils: number;
  rentalDays: number;
  extras: { extra: ExtraPricing; quantity: number }[];
  oneWayFeeFils: number;
  depositFils: number;
  vatRateBps: number;
}): QuoteBreakdown {
  assertFils(input.dailyRateFils, "dailyRateFils");
  assertFils(input.oneWayFeeFils, "oneWayFeeFils");
  assertFils(input.depositFils, "depositFils");
  const rentalFils = input.dailyRateFils * input.rentalDays;
  const extras = input.extras.map((e) => priceExtra(e.extra, input.rentalDays, e.quantity));
  const extrasFils = extras.reduce((sum, e) => sum + e.totalFils, 0);
  const subtotalFils = rentalFils + extrasFils + input.oneWayFeeFils;
  const taxFils = vatOn(subtotalFils, input.vatRateBps);
  return {
    currency: "AED",
    dailyRateFils: input.dailyRateFils,
    rentalDays: input.rentalDays,
    rentalFils,
    extras,
    extrasFils,
    oneWayFeeFils: input.oneWayFeeFils,
    subtotalFils,
    vatRateBps: input.vatRateBps,
    taxFils,
    totalFils: subtotalFils + taxFils,
    depositFils: input.depositFils,
  };
}

export type CancellationOutcome =
  | { allowed: false; reason: string }
  | { allowed: true; free: boolean; feeFils: number; refundFils: number };

/**
 * Cancellation policy: free (full refund) until 48h before pick-up; within 48h one day of
 * rental (daily rate + VAT) is kept; not allowed once the pick-up time has passed.
 */
export function cancellationOutcome(input: {
  pickupAt: Date;
  now: Date;
  paidFils: number;
  dailyRateFils: number;
  vatRateBps: number;
}): CancellationOutcome {
  if (input.now.getTime() >= input.pickupAt.getTime()) {
    return { allowed: false, reason: "The pick-up time has passed; this reservation can no longer be cancelled." };
  }
  if (input.pickupAt.getTime() - input.now.getTime() >= FREE_CANCELLATION_HOURS * HOUR_MS) {
    return { allowed: true, free: true, feeFils: 0, refundFils: input.paidFils };
  }
  const oneDay = input.dailyRateFils + vatOn(input.dailyRateFils, input.vatRateBps);
  const feeFils = Math.min(oneDay, input.paidFils);
  return { allowed: true, free: false, feeFils, refundFils: input.paidFils - feeFils };
}

/** Date changes are allowed until 48h before the (current) pick-up time. */
export function canModifyDates(pickupAt: Date, now: Date): boolean {
  return pickupAt.getTime() - now.getTime() >= FREE_CANCELLATION_HOURS * HOUR_MS;
}

export type ReturnCharges = {
  lateDays: number;
  lateFeeFils: number;
  fuelEighthsShort: number;
  fuelChargeFils: number;
  damageChargeFils: number;
  /** VAT on late fee + fuel + damage. */
  taxFils: number;
  totalFils: number;
  /** min(total, deposit): captured from the deposit. */
  depositCaptureFils: number;
  /** Charges that exceed the deposit. */
  amountDueFils: number;
};

/** Charges at check-in. Late days are charged at the reservation's daily rate (plus VAT). */
export function returnCharges(input: {
  scheduledReturnAt: Date;
  actualReturnAt: Date;
  dailyRateFils: number;
  pickupFuelLevel: number;
  returnFuelLevel: number;
  damageChargeFils: number;
  depositFils: number;
  vatRateBps: number;
}): ReturnCharges {
  assertFils(input.damageChargeFils, "damageChargeFils");
  const days = lateDays(input.scheduledReturnAt, input.actualReturnAt);
  const lateFeeFils = days * input.dailyRateFils;
  const fuelEighthsShort = Math.max(0, input.pickupFuelLevel - input.returnFuelLevel);
  const fuelChargeFils = fuelEighthsShort * FUEL_CHARGE_PER_EIGHTH_FILS;
  const net = lateFeeFils + fuelChargeFils + input.damageChargeFils;
  const taxFils = vatOn(net, input.vatRateBps);
  const totalFils = net + taxFils;
  const depositCaptureFils = Math.min(totalFils, input.depositFils);
  return {
    lateDays: days,
    lateFeeFils,
    fuelEighthsShort,
    fuelChargeFils,
    damageChargeFils: input.damageChargeFils,
    taxFils,
    totalFils,
    depositCaptureFils,
    amountDueFils: totalFils - depositCaptureFils,
  };
}
