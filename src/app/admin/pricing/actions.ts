"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createExtra, updateExtra } from "@/lib/fleet/admin";
import { createPricingRule, deleteOneWayFee, deletePricingRule, updatePricingRule, upsertOneWayFee } from "@/lib/pricing/admin";
import type { ActionState } from "@/app/_lib/action-state";
import { toErrorState } from "@/app/_lib/action-errors";
import { FormReader } from "../_lib/form";

function readRule(fd: FormData) {
  const f = new FormReader(fd);
  const input = {
    name: f.str("name"),
    categoryId: f.optStr("categoryId"),
    vehicleId: f.optStr("vehicleId"),
    branchId: f.optStr("branchId"),
    dailyRateFils: f.money("dailyRateFils"),
    minDays: f.int("minDays", "Minimum days"),
    maxDays: f.optInt("maxDays", "Maximum days"),
    validFrom: f.optStr("validFrom"),
    validTo: f.optStr("validTo"),
    priority: f.int("priority", "Priority"),
    isActive: f.bool("isActive"),
  };
  return { input, invalid: f.invalid() };
}

export async function createRuleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { input, invalid } = readRule(fd);
  if (invalid) return invalid;
  try {
    await createPricingRule(await requireAdmin(), input);
  } catch (error) {
    return toErrorState(error);
  }
  redirect("/admin/pricing?saved=rule");
}

export async function updateRuleAction(ruleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { input, invalid } = readRule(fd);
  if (invalid) return invalid;
  try {
    await updatePricingRule(await requireAdmin(), ruleId, input);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Pricing rule saved." };
}

export async function deleteRuleAction(ruleId: string): Promise<ActionState> {
  try {
    await deletePricingRule(await requireAdmin(), ruleId);
  } catch (error) {
    return toErrorState(error);
  }
  redirect("/admin/pricing?saved=deleted");
}

export async function saveFeeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const f = new FormReader(fd);
  const input = { fromBranchId: f.str("fromBranchId"), toBranchId: f.str("toBranchId"), feeFils: f.money("feeFils") };
  const invalid = f.invalid();
  if (invalid) return invalid;
  try {
    await upsertOneWayFee(await requireAdmin(), input);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "One-way fee saved." };
}

export async function deleteFeeAction(feeId: string): Promise<ActionState> {
  try {
    await deleteOneWayFee(await requireAdmin(), feeId);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "One-way fee removed." };
}

function readExtra(fd: FormData) {
  const f = new FormReader(fd);
  const input = {
    code: f.str("code"),
    name: f.str("name"),
    description: f.optStr("description"),
    pricingType: f.str("pricingType") as "PER_DAY" | "PER_RENTAL",
    priceFils: f.money("priceFils"),
    maxPriceFils: f.optMoney("maxPriceFils"),
    maxQuantity: f.int("maxQuantity", "Maximum quantity"),
    isActive: f.bool("isActive"),
  };
  const sortOrder = f.optInt("sortOrder", "Sort order");
  // Only send sortOrder when the form had it, so an update keeps the stored value.
  const withOrder = sortOrder === null ? input : { ...input, sortOrder };
  return { input: withOrder, invalid: f.invalid() };
}

export async function createExtraAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { input, invalid } = readExtra(fd);
  if (invalid) return invalid;
  try {
    await createExtra(await requireAdmin(), input);
  } catch (error) {
    return toErrorState(error);
  }
  redirect("/admin/pricing?tab=extras&saved=extra");
}

export async function updateExtraAction(extraId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { input, invalid } = readExtra(fd);
  if (invalid) return invalid;
  try {
    await updateExtra(await requireAdmin(), extraId, input);
  } catch (error) {
    return toErrorState(error);
  }
  refresh();
  return { status: "ok", message: "Extra saved." };
}
