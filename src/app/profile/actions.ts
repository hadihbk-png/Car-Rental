"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { uploadLicence, upsertDriverProfile } from "@/lib/drivers";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/types";
import { formatBytes } from "@/lib/ui/files";
import type { ActionState } from "@/app/_lib/action-state";
import { formFile, formString, toErrorState } from "@/app/_lib/action-errors";

export async function saveDriverProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await upsertDriverProfile(actor, {
      fullName: formString(formData, "fullName"),
      phone: formString(formData, "phone"),
      dateOfBirth: formString(formData, "dateOfBirth"),
      nationality: formString(formData, "nationality"),
      licenceNumber: formString(formData, "licenceNumber"),
      licenceCountry: formString(formData, "licenceCountry"),
      licenceIssuedOn: formString(formData, "licenceIssuedOn") || null,
      licenceExpiresOn: formString(formData, "licenceExpiresOn"),
    });
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Driver details saved." };
}

export async function uploadLicenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const file = formFile(formData, "licence");
  if (!file) return { status: "error", message: "Choose a photo or PDF of your driving licence.", fieldErrors: { licence: ["Required"] } };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { status: "error", message: `The file is too large. The maximum size is ${formatBytes(MAX_UPLOAD_BYTES)}.` };
  }
  try {
    const actor = await requireUser();
    await uploadLicence(actor, { data: new Uint8Array(await file.arrayBuffer()), contentType: file.type });
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Driving licence uploaded." };
}
