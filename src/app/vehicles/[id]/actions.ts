"use server";

import { isDomainError } from "@/lib/errors";
import { getBranch, getVehicle } from "@/lib/fleet/catalog";
import { getQuote } from "@/lib/pricing/quote";
import { isDateString, isTimeString, zonedTimeToUtc } from "@/lib/ui/datetime";
import type { QuoteRequest, QuoteState } from "./quote-types";

/**
 * Live price quote for the vehicle page. Public (no booking is created); the pricing service is
 * the single source of truth, this only converts branch-local date/times to UTC.
 */
export async function quoteAction(request: QuoteRequest): Promise<QuoteState> {
  const { vehicleId, pickupDate, pickupTime, returnDate, returnTime } = request;
  if (![pickupDate, returnDate].every(isDateString) || ![pickupTime, returnTime].every(isTimeString)) {
    return { status: "error", message: "Choose a valid pick-up and return date and time." };
  }
  if (!Array.isArray(request.extras) || request.extras.length > 20) {
    return { status: "error", message: "Invalid extras selection." };
  }
  try {
    const vehicle = await getVehicle(vehicleId);
    const tz = vehicle.branch.timezone;
    const returnBranchId = request.returnBranch ? (await getBranch(request.returnBranch)).id : vehicle.branch.id;
    const quote = await getQuote({
      vehicleId,
      pickupBranchId: vehicle.branch.id,
      returnBranchId,
      pickupAt: zonedTimeToUtc(pickupDate, pickupTime, tz),
      returnAt: zonedTimeToUtc(returnDate, returnTime, tz),
      extras: request.extras.map((e) => ({ extraId: String(e.extraId), quantity: Number(e.quantity) })),
    });
    return {
      status: "ok",
      quote: {
        dailyRateFils: quote.dailyRateFils,
        rentalDays: quote.rentalDays,
        rentalFils: quote.rentalFils,
        extras: quote.extras.map((e) => ({
          extraId: e.extraId,
          name: e.name,
          quantity: e.quantity,
          pricingType: e.pricingType,
          priceFils: e.priceFils,
          totalFils: e.totalFils,
        })),
        oneWayFeeFils: quote.oneWayFeeFils,
        vatRateBps: quote.vatRateBps,
        taxFils: quote.taxFils,
        totalFils: quote.totalFils,
        depositFils: quote.depositFils,
        available: quote.available,
        pickupAt: quote.pickupAt.toISOString(),
        returnAt: quote.returnAt.toISOString(),
        timezone: quote.timezone,
      },
    };
  } catch (error) {
    if (isDomainError(error)) {
      return {
        status: "error",
        message: error.message.replace(/^[A-Za-z.]+:\s*/, ""),
        fieldErrors: error.fieldErrors,
      };
    }
    throw error;
  }
}
