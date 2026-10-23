"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isDomainError } from "@/lib/errors";
import { payReservation } from "@/lib/reservations";
import { cleanMessage } from "@/app/_lib/action-errors";

export type PayResult =
  | { status: "pending" }
  | { status: "error"; message: string; code?: string; /** Fresh key for the next attempt. */ nextKey: string };

/**
 * Pays a held reservation. Success redirects to the voucher; "pending" (bank confirmation
 * outstanding) refreshes the page; a decline returns a new idempotency key for the retry.
 */
export async function payAction(input: { reservationId: string; paymentMethod: string; idempotencyKey: string }): Promise<PayResult> {
  let reference: string;
  let status: string;
  try {
    const actor = await requireUser();
    const view = await payReservation(actor, {
      reservationId: String(input.reservationId),
      paymentMethod: String(input.paymentMethod),
      idempotencyKey: String(input.idempotencyKey),
    });
    reference = view.reference;
    status = view.status;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { status: "error", message: cleanMessage(error.message), code: error.code, nextKey: `pay_${randomUUID()}` };
  }
  if (status === "CONFIRMED") redirect(`/rentals/${reference}/voucher?new=1`);
  refresh();
  return { status: "pending" };
}
