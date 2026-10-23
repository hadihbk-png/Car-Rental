"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { cancelReservation, settleReturnedDeposit } from "@/lib/reservations";
import { formatMoney } from "@/lib/ui/money";
import type { ActionState } from "@/app/_lib/action-state";
import { toErrorState } from "@/app/_lib/action-errors";
import { FormReader } from "../_lib/form";

export async function adminCancelAction(reservationId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const reason = new FormReader(fd).str("reason");
  let message: string;
  try {
    const view = await cancelReservation(await requireAdmin(), { reservationId, reason: reason || undefined });
    message = `Reservation cancelled${view.refundedFils > 0 ? `; ${formatMoney(view.refundedFils, "AED")} refunded` : ""}.`;
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message };
}

export async function settleDepositAction(reservationId: string): Promise<ActionState> {
  try {
    await settleReturnedDeposit(await requireAdmin(), reservationId);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Deposit settled." };
}
