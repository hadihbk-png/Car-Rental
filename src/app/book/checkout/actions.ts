"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createReservation } from "@/lib/reservations";
import { parseExtras } from "@/lib/ui/booking-params";
import type { ActionState } from "@/app/_lib/action-state";
import { formString, toErrorState } from "@/app/_lib/action-errors";

/** Places the 15-minute hold. The idempotency key comes from the checkout page and is resent on retry. */
export async function createReservationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (formData.get("acceptPolicy") !== "on") {
    return { status: "error", message: "Please accept the rental terms to continue.", fieldErrors: { acceptPolicy: ["Required"] } };
  }
  let reference: string;
  try {
    const actor = await requireUser();
    const view = await createReservation(actor, {
      vehicleId: formString(formData, "vehicleId"),
      pickupBranchId: formString(formData, "pickupBranchId"),
      returnBranchId: formString(formData, "returnBranchId"),
      pickupAt: formString(formData, "pickupAt"),
      returnAt: formString(formData, "returnAt"),
      extras: parseExtras(formString(formData, "extras")),
      idempotencyKey: formString(formData, "idempotencyKey"),
    });
    reference = view.reference;
  } catch (error) {
    return toErrorState(error);
  }
  redirect(`/book/pay/${reference}`);
}
