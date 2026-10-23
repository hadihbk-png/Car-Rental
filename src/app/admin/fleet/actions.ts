"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import {
  addVehiclePhoto,
  createMaintenanceBlock,
  createVehicle,
  deleteMaintenanceBlock,
  getFleetVehicle,
  removeVehiclePhoto,
  updateVehicle,
} from "@/lib/fleet/admin";
import { listBranches } from "@/lib/fleet/catalog";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/types";
import { isDateString, isTimeString, zonedTimeToUtc } from "@/lib/ui/datetime";
import { formatBytes } from "@/lib/ui/files";
import type { ActionState } from "@/app/_lib/action-state";
import { formFile, toErrorState } from "@/app/_lib/action-errors";
import { FormReader } from "../_lib/form";

type Status = "AVAILABLE" | "RESERVED" | "ON_RENT" | "MAINTENANCE" | "RETIRED";

function readVehicle(fd: FormData) {
  const f = new FormReader(fd);
  const input = {
    branchId: f.str("branchId"),
    categoryId: f.str("categoryId"),
    make: f.str("make"),
    model: f.str("model"),
    year: f.int("year", "Year"),
    plateNumber: f.str("plateNumber"),
    vin: f.str("vin"),
    color: f.optStr("color"),
    transmission: f.str("transmission") as "AUTOMATIC" | "MANUAL",
    fuelType: f.str("fuelType") as "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC",
    seats: f.int("seats", "Seats"),
    doors: f.int("doors", "Doors"),
    luggage: f.int("luggage", "Luggage"),
    mileageKm: f.int("mileageKm", "Mileage"),
    status: f.str("status") as Status,
    description: f.optStr("description"),
    featureIds: f.all("featureIds"),
  };
  return { input, invalid: f.invalid() };
}

export async function createVehicleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { input, invalid } = readVehicle(fd);
  if (invalid) return invalid;
  let id: string;
  try {
    id = (await createVehicle(await requireAdmin(), input)).id;
  } catch (error) {
    return toErrorState(error);
  }
  redirect(`/admin/fleet/${id}?created=1`);
}

export async function updateVehicleAction(vehicleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { input, invalid } = readVehicle(fd);
  if (invalid) return invalid;
  try {
    await updateVehicle(await requireAdmin(), vehicleId, input);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Vehicle saved." };
}

export async function uploadPhotoAction(vehicleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const file = formFile(fd, "photo");
  if (!file) return { status: "error", message: "Choose a photo to upload.", fieldErrors: { photo: ["Required"] } };
  if (file.size > MAX_UPLOAD_BYTES) return { status: "error", message: `The photo is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.` };
  try {
    await addVehiclePhoto(await requireAdmin(), vehicleId, { data: new Uint8Array(await file.arrayBuffer()), contentType: file.type });
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Photo added." };
}

export async function removePhotoAction(vehicleId: string, index: number): Promise<ActionState> {
  try {
    await removeVehiclePhoto(await requireAdmin(), vehicleId, index);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Photo removed." };
}

export async function createMaintenanceAction(vehicleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const f = new FormReader(fd);
  const [sd, st, ed, et] = ["startDate", "startTime", "endDate", "endTime"].map((k) => f.str(k));
  const reason = f.str("reason");
  const errors: Record<string, string[]> = {};
  if (!isDateString(sd) || !isTimeString(st)) errors.startsAt = ["Choose a start date and time."];
  if (!isDateString(ed) || !isTimeString(et)) errors.endsAt = ["Choose an end date and time."];
  if (Object.keys(errors).length) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: errors };
  try {
    const actor = await requireAdmin();
    const vehicle = await getFleetVehicle(actor, vehicleId);
    const tz = (await listBranches({ includeInactive: true })).find((b) => b.id === vehicle.branchId)?.timezone ?? "UTC";
    await createMaintenanceBlock(actor, {
      vehicleId,
      startsAt: zonedTimeToUtc(sd, st, tz),
      endsAt: zonedTimeToUtc(ed, et, tz),
      reason,
    });
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Maintenance block added." };
}

export async function deleteMaintenanceAction(blockId: string): Promise<ActionState> {
  try {
    await deleteMaintenanceBlock(await requireAdmin(), blockId);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Maintenance block removed." };
}
