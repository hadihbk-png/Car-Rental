"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { checkOutReservation } from "@/lib/reservations";
import type { ActionState } from "@/app/_lib/action-state";
import { toErrorState } from "@/app/_lib/action-errors";
import { FormReader } from "../_lib/form";

export async function checkOutAction(reservationId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const f = new FormReader(fd);
  const input = { reservationId, mileageKm: f.int("mileageKm", "Mileage"), fuelLevel: f.int("fuelLevel", "Fuel level"), notes: f.str("notes") || undefined };
  const invalid = f.invalid();
  if (invalid) return invalid;
  try {
    await checkOutReservation(await requireAdmin(), input);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Car handed over. The reservation is now on rent." };
}
