"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isDomainError } from "@/lib/errors";
import { getQuote } from "@/lib/pricing/quote";
import { cancelReservation, getReservation, modifyReservationDates, payReturnBalance } from "@/lib/reservations";
import { isDateString, isTimeString, zonedTimeToUtc } from "@/lib/ui/datetime";
import { formatMoney } from "@/lib/ui/money";
import type { ActionState } from "@/app/_lib/action-state";
import { cleanMessage, formString, toErrorState } from "@/app/_lib/action-errors";
import type { QuoteView } from "@/app/vehicles/[id]/quote-types";

export async function cancelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let message: string;
  try {
    const actor = await requireUser();
    const view = await cancelReservation(actor, {
      reservationId: formString(formData, "reservationId"),
      reason: formString(formData, "reason") || undefined,
    });
    message =
      view.refundedFils > 0
        ? `Reservation cancelled. ${formatMoney(view.refundedFils, "AED")} will be refunded to your card.`
        : "Reservation cancelled.";
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message };
}

export interface DateChangeInput {
  reservationId: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
}

export type PreviewResult =
  | { status: "ok"; quote: QuoteView; pickupAt: string; returnAt: string; needsPayment: boolean }
  | { status: "error"; message: string };

/** Prices new dates for an existing reservation (same car, branches and extras). Nothing changes yet. */
export async function previewDatesAction(input: DateChangeInput): Promise<PreviewResult> {
  if (![input.pickupDate, input.returnDate].every(isDateString) || ![input.pickupTime, input.returnTime].every(isTimeString)) {
    return { status: "error", message: "Choose a valid pick-up and return date and time." };
  }
  try {
    const actor = await requireUser();
    const r = await getReservation(actor, String(input.reservationId));
    if (!r.can.modifyDates) return { status: "error", message: "The dates of this reservation can no longer be changed." };
    const pickupAt = zonedTimeToUtc(input.pickupDate, input.pickupTime, r.timezone);
    const returnAt = zonedTimeToUtc(input.returnDate, input.returnTime, r.timezone);
    const q = await getQuote({
      vehicleId: r.vehicle.id,
      pickupBranchId: r.pickupBranch.id,
      returnBranchId: r.returnBranch.id,
      pickupAt,
      returnAt,
      extras: r.price.extras.map((e) => ({ extraId: e.extraId, quantity: e.quantity })),
    });
    // The current booking blocks its own dates, so availability is re-checked by the change itself.
    return {
      status: "ok",
      pickupAt: pickupAt.toISOString(),
      returnAt: returnAt.toISOString(),
      needsPayment: q.totalFils > r.paidFils,
      quote: {
        dailyRateFils: q.dailyRateFils,
        rentalDays: q.rentalDays,
        rentalFils: q.rentalFils,
        extras: q.extras.map((e) => ({ extraId: e.extraId, name: e.name, quantity: e.quantity, pricingType: e.pricingType, priceFils: e.priceFils, totalFils: e.totalFils })),
        oneWayFeeFils: q.oneWayFeeFils,
        vatRateBps: q.vatRateBps,
        taxFils: q.taxFils,
        totalFils: q.totalFils,
        depositFils: q.depositFils,
        available: q.available,
        pickupAt: pickupAt.toISOString(),
        returnAt: returnAt.toISOString(),
        timezone: q.timezone,
      },
    };
  } catch (error) {
    if (isDomainError(error)) return { status: "error", message: cleanMessage(error.message) };
    throw error;
  }
}

export type ModifyResult = { status: "ok"; message: string } | { status: "error"; message: string; code?: string; nextKey: string };

export async function modifyDatesAction(input: {
  reservationId: string;
  pickupAt: string;
  returnAt: string;
  paymentMethod?: string;
  idempotencyKey: string;
}): Promise<ModifyResult> {
  try {
    const actor = await requireUser();
    await modifyReservationDates(actor, {
      reservationId: String(input.reservationId),
      pickupAt: String(input.pickupAt),
      returnAt: String(input.returnAt),
      paymentMethod: input.paymentMethod ? String(input.paymentMethod) : undefined,
      idempotencyKey: String(input.idempotencyKey),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { status: "error", message: cleanMessage(error.message), code: error.code, nextKey: `mod_${randomUUID()}` };
  }
  refresh();
  return { status: "ok", message: "Your dates have been changed." };
}

export type BalanceResult = { status: "ok"; message: string } | { status: "error"; message: string; nextKey: string };

/** Pays return charges that exceeded the deposit (owner or admin). New key after each failed attempt. */
export async function payBalanceAction(input: { reservationId: string; paymentMethod: string; idempotencyKey: string }): Promise<BalanceResult> {
  try {
    const actor = await requireUser();
    await payReturnBalance(actor, {
      reservationId: String(input.reservationId),
      paymentMethod: String(input.paymentMethod),
      idempotencyKey: String(input.idempotencyKey),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { status: "error", message: cleanMessage(error.message), nextKey: `bal_${randomUUID()}` };
  }
  refresh();
  return { status: "ok", message: "Thank you, the balance has been paid." };
}
