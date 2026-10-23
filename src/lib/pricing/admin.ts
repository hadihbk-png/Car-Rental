import "server-only";
import { aliasedTable, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branches, oneWayFees, pricingRules, vehicleCategories, vehicles } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/types";
import { DomainError } from "@/lib/errors";
import { assertAdmin, mapDbError, pickProvided } from "@/lib/fleet/admin";
import { parseInput, zId, zLocalDate } from "@/lib/validation";

// Admin management of pricing rules and one-way fees.

export const pricingRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    categoryId: zId.nullish(),
    vehicleId: zId.nullish(),
    branchId: zId.nullish(),
    dailyRateFils: z.number().int().min(1).max(100_000_000),
    minDays: z.number().int().min(1).max(365).default(1),
    maxDays: z.number().int().min(1).max(365).nullish(),
    validFrom: zLocalDate.nullish(),
    validTo: zLocalDate.nullish(),
    priority: z.number().int().min(-1000).max(1000).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((r) => !!r.categoryId || !!r.vehicleId, { message: "Choose a category or a vehicle", path: ["categoryId"] })
  .refine((r) => r.maxDays == null || r.maxDays >= r.minDays, { message: "Max days below min days", path: ["maxDays"] })
  .refine((r) => !r.validFrom || !r.validTo || r.validTo >= r.validFrom, { message: "End before start", path: ["validTo"] });

export async function listPricingRules(actor: Actor) {
  assertAdmin(actor);
  return db
    .select({
      rule: pricingRules,
      categoryName: vehicleCategories.name,
      vehiclePlate: vehicles.plateNumber,
      branchCode: branches.code,
    })
    .from(pricingRules)
    .leftJoin(vehicleCategories, eq(vehicleCategories.id, pricingRules.categoryId))
    .leftJoin(vehicles, eq(vehicles.id, pricingRules.vehicleId))
    .leftJoin(branches, eq(branches.id, pricingRules.branchId))
    .orderBy(desc(pricingRules.isActive), asc(vehicleCategories.sortOrder), desc(pricingRules.priority), asc(pricingRules.minDays))
    .then((rows) => rows.map((r) => ({ ...r.rule, categoryName: r.categoryName, vehiclePlate: r.vehiclePlate, branchCode: r.branchCode })));
}

export async function createPricingRule(actor: Actor, input: z.input<typeof pricingRuleSchema>) {
  assertAdmin(actor);
  const d = parseInput(pricingRuleSchema, input);
  const [row] = await db.insert(pricingRules).values(d).returning().catch((e) => mapDbError(e));
  await audit({ actor, action: "pricing_rule.created", entityType: "pricing_rule", entityId: row.id, data: d });
  return row;
}

export async function updatePricingRule(actor: Actor, ruleId: string, input: Partial<z.input<typeof pricingRuleSchema>>) {
  assertAdmin(actor);
  parseInput(zId, ruleId);
  const [current] = await db.select().from(pricingRules).where(eq(pricingRules.id, ruleId));
  if (!current) throw new DomainError("NOT_FOUND", "Pricing rule not found.");
  // Validate the merged rule so cross-field rules still hold.
  const merged = parseInput(pricingRuleSchema, { ...stripMeta(current), ...input });
  const changes = pickProvided(merged, input);
  const [row] = await db.update(pricingRules).set(changes).where(eq(pricingRules.id, ruleId)).returning().catch((e) => mapDbError(e));
  await audit({ actor, action: "pricing_rule.updated", entityType: "pricing_rule", entityId: ruleId, data: changes });
  return row;
}

function stripMeta(r: typeof pricingRules.$inferSelect) {
  const { id, createdAt, updatedAt, ...rest } = r;
  void id;
  void createdAt;
  void updatedAt;
  return rest;
}

export async function deletePricingRule(actor: Actor, ruleId: string): Promise<void> {
  assertAdmin(actor);
  parseInput(zId, ruleId);
  const [row] = await db.delete(pricingRules).where(eq(pricingRules.id, ruleId)).returning();
  if (!row) throw new DomainError("NOT_FOUND", "Pricing rule not found.");
  await audit({ actor, action: "pricing_rule.deleted", entityType: "pricing_rule", entityId: ruleId, data: { name: row.name } });
}

const fromBranch = aliasedTable(branches, "from_branch");
const toBranch = aliasedTable(branches, "to_branch");

export async function listOneWayFees(actor: Actor) {
  assertAdmin(actor);
  return db
    .select({
      id: oneWayFees.id,
      fromBranchId: oneWayFees.fromBranchId,
      toBranchId: oneWayFees.toBranchId,
      feeFils: oneWayFees.feeFils,
      fromCode: fromBranch.code,
      fromName: fromBranch.name,
      toCode: toBranch.code,
      toName: toBranch.name,
    })
    .from(oneWayFees)
    .innerJoin(fromBranch, eq(fromBranch.id, oneWayFees.fromBranchId))
    .innerJoin(toBranch, eq(toBranch.id, oneWayFees.toBranchId))
    .orderBy(asc(fromBranch.code), asc(toBranch.code));
}

export const oneWayFeeSchema = z
  .object({ fromBranchId: zId, toBranchId: zId, feeFils: z.number().int().min(0).max(100_000_000) })
  .refine((f) => f.fromBranchId !== f.toBranchId, { message: "Choose two different branches", path: ["toBranchId"] });

/** Create or change the fee for a route (from -> to). */
export async function upsertOneWayFee(actor: Actor, input: z.input<typeof oneWayFeeSchema>) {
  assertAdmin(actor);
  const d = parseInput(oneWayFeeSchema, input);
  const [row] = await db
    .insert(oneWayFees)
    .values(d)
    .onConflictDoUpdate({ target: [oneWayFees.fromBranchId, oneWayFees.toBranchId], set: { feeFils: d.feeFils, updatedAt: new Date() } })
    .returning()
    .catch((e) => mapDbError(e));
  await audit({ actor, action: "one_way_fee.saved", entityType: "one_way_fee", entityId: row.id, data: d });
  return row;
}

export async function deleteOneWayFee(actor: Actor, feeId: string): Promise<void> {
  assertAdmin(actor);
  parseInput(zId, feeId);
  const [row] = await db.delete(oneWayFees).where(eq(oneWayFees.id, feeId)).returning();
  if (!row) throw new DomainError("NOT_FOUND", "One-way fee not found.");
  await audit({ actor, action: "one_way_fee.deleted", entityType: "one_way_fee", entityId: feeId });
}
