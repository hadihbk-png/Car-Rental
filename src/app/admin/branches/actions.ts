"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createBranch, deleteBranch, updateBranch } from "@/lib/fleet/admin";
import type { ActionState } from "@/app/_lib/action-state";
import { toErrorState } from "@/app/_lib/action-errors";
import { FormReader } from "../_lib/form";

function readBranch(fd: FormData) {
  const f = new FormReader(fd);
  const input = {
    code: f.str("code"),
    slug: f.str("slug"),
    name: f.str("name"),
    city: f.str("city"),
    address: f.str("address"),
    phone: f.optStr("phone"),
    email: f.optStr("email"),
    timezone: f.str("timezone"),
    latitude: f.optNumber("latitude", "Latitude"),
    longitude: f.optNumber("longitude", "Longitude"),
    openingHours: f.optStr("openingHours"),
    isActive: f.bool("isActive"),
  };
  return { input, invalid: f.invalid() };
}

export async function createBranchAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { input, invalid } = readBranch(fd);
  if (invalid) return invalid;
  let id: string;
  try {
    const actor = await requireAdmin();
    id = (await createBranch(actor, input)).id;
  } catch (error) {
    return toErrorState(error);
  }
  redirect(`/admin/branches/${id}?saved=1`);
}

export async function updateBranchAction(branchId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { input, invalid } = readBranch(fd);
  if (invalid) return invalid;
  try {
    const actor = await requireAdmin();
    await updateBranch(actor, branchId, input);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Branch saved." };
}

export async function deleteBranchAction(branchId: string): Promise<ActionState> {
  try {
    const actor = await requireAdmin();
    await deleteBranch(actor, branchId);
  } catch (error) {
    return toErrorState(error);
  }
  redirect("/admin/branches?deleted=1");
}
