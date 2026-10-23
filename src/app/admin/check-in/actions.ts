"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { checkInReservation } from "@/lib/reservations";
import { isDateString, isTimeString, zonedTimeToUtc } from "@/lib/ui/datetime";
import type { ActionState } from "@/app/_lib/action-state";
import { toErrorState } from "@/app/_lib/action-errors";
import { FormReader } from "../_lib/form";

/** Check-in; `timeZone` is the return branch zone for the optional return time. */
export async function checkInAction(reservationId: string, timeZone: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const f = new FormReader(fd);
  const returnedDate = f.str("returnedDate");
  const returnedTime = f.str("returnedTime");
  let returnedAt: Date | undefined;
  if (returnedDate || returnedTime) {
    if (!isDateString(returnedDate) || !isTimeString(returnedTime)) {
      f.errors.returnedAt = ["Enter both the return date and time, or leave both empty for now."];
    } else {
      returnedAt = zonedTimeToUtc(returnedDate, returnedTime, timeZone);
    }
  }
  const input = {
    reservationId,
    mileageKm: f.int("mileageKm", "Mileage"),
    fuelLevel: f.int("fuelLevel", "Fuel level"),
    returnedAt,
    returnBranchId: f.str("returnBranchId") || undefined,
    damageChargeFils: f.optMoney("damageChargeFils") ?? 0,
    vehicleStatus: (f.str("vehicleStatus") || "AVAILABLE") as "AVAILABLE" | "MAINTENANCE",
    notes: f.str("notes") || undefined,
  };
  const invalid = f.invalid();
  if (invalid) return invalid;
  try {
    await checkInReservation(await requireAdmin(), input);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Car checked in. Return charges are shown below." };
}
