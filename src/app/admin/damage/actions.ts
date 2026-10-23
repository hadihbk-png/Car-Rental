"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { addDamageImage, createDamageReport, updateDamageReport } from "@/lib/reservations";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/types";
import { formatBytes } from "@/lib/ui/files";
import type { ActionState } from "@/app/_lib/action-state";
import { formFile, toErrorState } from "@/app/_lib/action-errors";
import { FormReader } from "../_lib/form";

type Severity = "MINOR" | "MODERATE" | "MAJOR";
type Stage = "PICKUP" | "RETURN" | "OTHER";

export async function createDamageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const f = new FormReader(fd);
  const input = {
    vehicleId: f.str("vehicleId"),
    reservationId: f.str("reservationId") || undefined,
    stage: f.str("stage") as Stage,
    severity: f.str("severity") as Severity,
    location: f.str("location"),
    description: f.str("description"),
    estimatedCostFils: f.optMoney("estimatedCostFils") ?? 0,
  };
  const invalid = f.invalid();
  if (invalid) return invalid;
  let id: string;
  try {
    id = (await createDamageReport(await requireAdmin(), input)).id;
  } catch (error) {
    return toErrorState(error);
  }
  redirect(`/admin/damage/${id}?created=1`);
}

export async function updateDamageAction(reportId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const f = new FormReader(fd);
  const input = {
    reportId,
    severity: f.str("severity") as Severity,
    location: f.str("location"),
    description: f.str("description"),
    estimatedCostFils: f.optMoney("estimatedCostFils") ?? 0,
    resolved: f.bool("resolved"),
  };
  const invalid = f.invalid();
  if (invalid) return invalid;
  try {
    await updateDamageReport(await requireAdmin(), input);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Damage report saved." };
}

export async function addDamageImageAction(reportId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const file = formFile(fd, "image");
  if (!file) return { status: "error", message: "Choose a photo to upload.", fieldErrors: { image: ["Required"] } };
  if (file.size > MAX_UPLOAD_BYTES) return { status: "error", message: `The photo is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.` };
  try {
    await addDamageImage(await requireAdmin(), reportId, { data: new Uint8Array(await file.arrayBuffer()), contentType: file.type });
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Photo added." };
}
