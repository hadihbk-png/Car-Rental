import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { branches, extras, oneWayFees, pricingRules, vehicleCategories, vehicles, type Branch } from "@/db/schema";
import { isVehicleAvailable } from "@/lib/availability";
import { localDate } from "@/lib/availability/time";
import { DomainError } from "@/lib/errors";
import { parseInput, zId, zInstant } from "@/lib/validation";
import { computeQuote, MAX_RENTAL_DAYS, rentalDays, vatRateBps, type QuoteBreakdown } from "./calc";
import { selectRateRule, type RateRule } from "./rules";

export const extrasSelectionSchema = z
  .array(z.object({ extraId: zId, quantity: z.number().int().min(1).max(10).default(1) }))
  .max(20)
  .default([])
  .refine((list) => new Set(list.map((e) => e.extraId)).size === list.length, { message: "Duplicate extra" });

export const rentalWindowSchema = z
  .object({
    pickupBranchId: zId,
    /** Defaults to the pick-up branch. */
    returnBranchId: zId.optional(),
    pickupAt: zInstant,
    returnAt: zInstant,
  })
  .refine((w) => w.returnAt.getTime() > w.pickupAt.getTime(), {
    message: "Return must be after pick-up",
    path: ["returnAt"],
  })
  // Zod runs every refine even after one fails; rentalDays() throws on a non-positive period,
  // so only measure the length once the order is valid (BUG-003).
  .refine((w) => w.returnAt.getTime() <= w.pickupAt.getTime() || rentalDays(w.pickupAt, w.returnAt) <= MAX_RENTAL_DAYS, {
    message: `Rentals are limited to ${MAX_RENTAL_DAYS} days`,
    path: ["returnAt"],
  });

/** Pick-up must be in the future (small clock-skew allowance). */
export function assertFuturePickup(pickupAt: Date, now: Date) {
  if (pickupAt.getTime() < now.getTime() - 60_000) {
    throw new DomainError("VALIDATION", "Pick-up time must be in the future.", { pickupAt: ["Must be in the future"] });
  }
}

export async function loadRateRules(tx: DbOrTx, target?: { vehicleIds: string[]; categoryIds: string[] }): Promise<RateRule[]> {
  const where = target
    ? and(
        eq(pricingRules.isActive, true),
        or(
          target.vehicleIds.length ? inArray(pricingRules.vehicleId, target.vehicleIds) : undefined,
          target.categoryIds.length ? inArray(pricingRules.categoryId, target.categoryIds) : undefined,
        ),
      )
    : eq(pricingRules.isActive, true);
  return tx.select().from(pricingRules).where(where);
}

export async function oneWayFeeFils(tx: DbOrTx, fromBranchId: string, toBranchId: string): Promise<number> {
  if (fromBranchId === toBranchId) return 0;
  const [row] = await tx
    .select({ fee: oneWayFees.feeFils })
    .from(oneWayFees)
    .where(and(eq(oneWayFees.fromBranchId, fromBranchId), eq(oneWayFees.toBranchId, toBranchId)));
  if (!row) throw new DomainError("POLICY_VIOLATION", "One-way rentals between these branches are not offered.");
  return row.fee;
}

/** Daily rate for one vehicle, or null when no pricing rule applies. */
export function dailyRateFor(
  rules: RateRule[],
  v: { id: string; categoryId: string },
  pickupBranch: Pick<Branch, "id" | "timezone">,
  pickupAt: Date,
  days: number,
): number | null {
  const rule = selectRateRule(rules, {
    vehicleId: v.id,
    categoryId: v.categoryId,
    branchId: pickupBranch.id,
    pickupLocalDate: localDate(pickupAt, pickupBranch.timezone),
    rentalDays: days,
  });
  return rule?.dailyRateFils ?? null;
}

export type PricedRental = {
  quote: QuoteBreakdown;
  vehicle: { id: string; categoryId: string; branchId: string; status: string };
  pickupBranch: Branch;
  returnBranch: Branch;
};

/**
 * Server-side price of a rental: daily rate from pricing_rules x days, extras, one-way fee,
 * VAT and the category deposit. Validates branches, vehicle and extras. Single source of truth.
 */
export async function priceRental(
  tx: DbOrTx,
  input: {
    vehicleId: string;
    pickupBranchId: string;
    returnBranchId: string;
    pickupAt: Date;
    returnAt: Date;
    extras: { extraId: string; quantity: number }[];
  },
): Promise<PricedRental> {
  const [row] = await tx
    .select({ v: vehicles, depositFils: vehicleCategories.depositFils })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, input.vehicleId));
  if (!row) throw new DomainError("NOT_FOUND", "Vehicle not found.");
  const vehicle = row.v;
  if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") {
    throw new DomainError("VEHICLE_UNAVAILABLE", "This vehicle is not available for rental.");
  }
  if (vehicle.branchId !== input.pickupBranchId) {
    throw new DomainError("VALIDATION", "This vehicle is not offered at the selected pick-up branch.", {
      pickupBranchId: ["Vehicle is based at another branch"],
    });
  }
  const branchRows = await tx
    .select()
    .from(branches)
    .where(inArray(branches.id, [input.pickupBranchId, input.returnBranchId]));
  const pickupBranch = branchRows.find((b) => b.id === input.pickupBranchId);
  const returnBranch = branchRows.find((b) => b.id === input.returnBranchId);
  if (!pickupBranch || !pickupBranch.isActive) throw new DomainError("NOT_FOUND", "Pick-up branch not found.");
  if (!returnBranch || !returnBranch.isActive) throw new DomainError("NOT_FOUND", "Return branch not found.");

  const days = rentalDays(input.pickupAt, input.returnAt);
  const rules = await loadRateRules(tx, { vehicleIds: [vehicle.id], categoryIds: [vehicle.categoryId] });
  const dailyRate = dailyRateFor(rules, vehicle, pickupBranch, input.pickupAt, days);
  if (dailyRate === null) throw new DomainError("NO_PRICE", "No price is available for this vehicle and dates.");

  const extraIds = input.extras.map((e) => e.extraId);
  const extraRows = extraIds.length ? await tx.select().from(extras).where(inArray(extras.id, extraIds)) : [];
  const selected = input.extras.map((sel) => {
    const extra = extraRows.find((x) => x.id === sel.extraId);
    if (!extra || !extra.isActive) throw new DomainError("VALIDATION", "An extra is no longer available.", { extras: ["Unknown extra"] });
    if (sel.quantity > extra.maxQuantity) {
      throw new DomainError("VALIDATION", `${extra.name}: at most ${extra.maxQuantity}.`, { extras: ["Quantity too high"] });
    }
    return {
      quantity: sel.quantity,
      extra: {
        extraId: extra.id,
        code: extra.code,
        name: extra.name,
        pricingType: extra.pricingType,
        priceFils: extra.priceFils,
        maxPriceFils: extra.maxPriceFils,
      },
    };
  });

  const quote = computeQuote({
    dailyRateFils: dailyRate,
    rentalDays: days,
    extras: selected,
    oneWayFeeFils: await oneWayFeeFils(tx, pickupBranch.id, returnBranch.id),
    depositFils: row.depositFils,
    vatRateBps: vatRateBps(),
  });
  return { quote, vehicle, pickupBranch, returnBranch };
}

export const quoteInputSchema = z.intersection(
  rentalWindowSchema,
  z.object({ vehicleId: zId, extras: extrasSelectionSchema }),
);
export type QuoteInput = z.input<typeof quoteInputSchema>;

export type QuoteResult = QuoteBreakdown & {
  vehicleId: string;
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  /** Branch time zone for displaying pickupAt/returnAt. */
  timezone: string;
  /** Whether the vehicle is free for the period right now (not a reservation). */
  available: boolean;
};

/** Public price quote for the checkout summary. Pages display this; they never compute prices. */
export async function getQuote(input: QuoteInput, now: Date = new Date()): Promise<QuoteResult> {
  const data = parseInput(quoteInputSchema, input);
  assertFuturePickup(data.pickupAt, now);
  const returnBranchId = data.returnBranchId ?? data.pickupBranchId;
  const priced = await priceRental(db, { ...data, returnBranchId, extras: data.extras });
  return {
    ...priced.quote,
    vehicleId: data.vehicleId,
    pickupBranchId: data.pickupBranchId,
    returnBranchId,
    pickupAt: data.pickupAt,
    returnAt: data.returnAt,
    timezone: priced.pickupBranch.timezone,
    available: await isVehicleAvailable(db, data.vehicleId, data.pickupAt, data.returnAt, { now }),
  };
}
