import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  branches,
  extras,
  maintenanceBlocks,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
  type Vehicle,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/types";
import { expireStaleHolds } from "@/lib/availability";
import { isValidTimeZone } from "@/lib/availability/time";
import { assertMagicBytes } from "@/lib/drivers";
import { DomainError, isExclusionViolation, pgErrorOf } from "@/lib/errors";
import { getFileStorage } from "@/lib/storage";
import { extensionFor, MAX_UPLOAD_BYTES, publicFileUrl } from "@/lib/storage/types";
import { parseInput, zFils, zId, zInstant } from "@/lib/validation";
import { toBranchSummary, type BranchSummary } from "./catalog";

// Admin CRUD for branches, categories, fleet, features, photos, extras and maintenance blocks.
// Every function requires an admin actor and writes an audit_logs row.

export function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new DomainError("FORBIDDEN", "Administrator access required.");
}

/** Maps constraint violations to friendly CONFLICT / VALIDATION errors. */
export function mapDbError(err: unknown, uniqueMessages: Record<string, string> = {}): never {
  const pg = pgErrorOf(err);
  if (pg?.code === "23505") {
    const msg = Object.entries(uniqueMessages).find(([k]) => pg.constraint?.includes(k))?.[1];
    throw new DomainError("CONFLICT", msg ?? "That value is already in use.");
  }
  if (pg?.code === "23503") throw new DomainError("CONFLICT", "This record is still in use and cannot be removed.");
  if (pg?.code === "23514") throw new DomainError("VALIDATION", `Invalid value (${pg.constraint ?? "check"}).`);
  throw err;
}

/** Keeps only keys the caller sent (schema defaults must not overwrite omitted fields). */
export function pickProvided<T extends object>(parsed: T, input: object): Partial<T> {
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => k in input)) as Partial<T>;
}

const slug = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, digits and dashes").max(60);

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------
export const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "2-10 letters/digits"),
  slug,
  name: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().min(3).max(300),
  phone: z.string().trim().max(30).nullish(),
  email: z.email().nullish(),
  timezone: z.string().refine(isValidTimeZone, "Unknown IANA time zone").default("Asia/Dubai"),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  openingHours: z.string().trim().max(200).nullish(),
  isActive: z.boolean().default(true),
});

function branchValues(d: Partial<z.output<typeof branchSchema>>) {
  const { latitude, longitude, ...rest } = d;
  return {
    ...rest,
    ...(latitude !== undefined ? { latitude: latitude === null ? null : String(latitude) } : {}),
    ...(longitude !== undefined ? { longitude: longitude === null ? null : String(longitude) } : {}),
  };
}

export async function createBranch(actor: Actor, input: z.input<typeof branchSchema>): Promise<BranchSummary> {
  assertAdmin(actor);
  const d = parseInput(branchSchema, input);
  const [row] = await db
    .insert(branches)
    .values(branchValues(d) as typeof branches.$inferInsert)
    .returning()
    .catch((e) => mapDbError(e, { code: "Branch code already exists.", slug: "Branch slug already exists." }));
  await audit({ actor, action: "branch.created", entityType: "branch", entityId: row.id, data: { code: row.code } });
  return toBranchSummary(row);
}

export async function updateBranch(actor: Actor, branchId: string, input: Partial<z.input<typeof branchSchema>>): Promise<BranchSummary> {
  assertAdmin(actor);
  parseInput(zId, branchId);
  const d = pickProvided(parseInput(branchSchema.partial(), input), input);
  const [row] = await db
    .update(branches)
    .set(branchValues(d))
    .where(eq(branches.id, branchId))
    .returning()
    .catch((e) => mapDbError(e, { code: "Branch code already exists.", slug: "Branch slug already exists." }));
  if (!row) throw new DomainError("NOT_FOUND", "Branch not found.");
  await audit({ actor, action: "branch.updated", entityType: "branch", entityId: row.id, data: d });
  return toBranchSummary(row);
}

/** Deletes a branch with no vehicles or reservations (otherwise deactivate it). */
export async function deleteBranch(actor: Actor, branchId: string): Promise<void> {
  assertAdmin(actor);
  parseInput(zId, branchId);
  const [row] = await db.delete(branches).where(eq(branches.id, branchId)).returning().catch((e) => mapDbError(e));
  if (!row) throw new DomainError("NOT_FOUND", "Branch not found.");
  await audit({ actor, action: "branch.deleted", entityType: "branch", entityId: branchId, data: { code: row.code } });
}

// ---------------------------------------------------------------------------
// Categories and features
// ---------------------------------------------------------------------------
export const categorySchema = z.object({
  slug,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).nullish(),
  depositFils: zFils,
  sortOrder: z.number().int().default(0),
});

export async function createCategory(actor: Actor, input: z.input<typeof categorySchema>) {
  assertAdmin(actor);
  const d = parseInput(categorySchema, input);
  const [row] = await db.insert(vehicleCategories).values(d).returning().catch((e) => mapDbError(e, { slug: "Category slug exists." }));
  await audit({ actor, action: "category.created", entityType: "vehicle_category", entityId: row.id, data: d });
  return row;
}

export async function updateCategory(actor: Actor, categoryId: string, input: Partial<z.input<typeof categorySchema>>) {
  assertAdmin(actor);
  parseInput(zId, categoryId);
  const d = pickProvided(parseInput(categorySchema.partial(), input), input);
  const [row] = await db
    .update(vehicleCategories)
    .set(d)
    .where(eq(vehicleCategories.id, categoryId))
    .returning()
    .catch((e) => mapDbError(e, { slug: "Category slug exists." }));
  if (!row) throw new DomainError("NOT_FOUND", "Category not found.");
  await audit({ actor, action: "category.updated", entityType: "vehicle_category", entityId: row.id, data: d });
  return row;
}

export async function createFeature(actor: Actor, input: { slug: string; name: string; icon?: string | null }) {
  assertAdmin(actor);
  const d = parseInput(z.object({ slug, name: z.string().trim().min(2).max(60), icon: z.string().max(40).nullish() }), input);
  const [row] = await db.insert(vehicleFeatures).values(d).returning().catch((e) => mapDbError(e, { slug: "Feature exists." }));
  await audit({ actor, action: "feature.created", entityType: "vehicle_feature", entityId: row.id, data: d });
  return row;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------
export const vehicleSchema = z.object({
  branchId: zId,
  categoryId: zId,
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1990).max(2100),
  plateNumber: z.string().trim().toUpperCase().min(2).max(20),
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "17 characters, no I/O/Q"),
  color: z.string().trim().max(30).nullish(),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]),
  seats: z.number().int().min(1).max(15),
  doors: z.number().int().min(2).max(6).default(4),
  luggage: z.number().int().min(0).max(10).default(2),
  mileageKm: z.number().int().min(0).default(0),
  status: z.enum(["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]).default("AVAILABLE"),
  description: z.string().trim().max(2000).nullish(),
  featureIds: z.array(zId).max(40).optional(),
});

export type FleetVehicle = Vehicle & {
  categoryName: string;
  branchName: string;
  branchCode: string;
  featureIds: string[];
  photoUrls: string[];
};

const uniqueVehicle = { plate: "Plate number already registered.", vin: "VIN already registered." };

export const listFleetSchema = z.object({
  branchId: zId.optional(),
  categoryId: zId.optional(),
  status: z.enum(["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]).optional(),
  q: z.string().trim().max(60).optional(),
});

/** Admin fleet list, including retired vehicles. */
export async function listFleet(actor: Actor, input: z.input<typeof listFleetSchema> = {}): Promise<FleetVehicle[]> {
  assertAdmin(actor);
  const f = parseInput(listFleetSchema, input);
  const where: SQL[] = [];
  if (f.branchId) where.push(eq(vehicles.branchId, f.branchId));
  if (f.categoryId) where.push(eq(vehicles.categoryId, f.categoryId));
  if (f.status) where.push(eq(vehicles.status, f.status));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(vehicles.plateNumber, like), ilike(vehicles.vin, like), ilike(vehicles.make, like), ilike(vehicles.model, like))!);
  }
  return loadFleet(where.length ? and(...where) : undefined);
}

export async function getFleetVehicle(actor: Actor, vehicleId: string): Promise<FleetVehicle> {
  assertAdmin(actor);
  parseInput(zId, vehicleId);
  const [v] = await loadFleet(eq(vehicles.id, vehicleId));
  if (!v) throw new DomainError("NOT_FOUND", "Vehicle not found.");
  return v;
}

async function loadFleet(where: SQL | undefined): Promise<FleetVehicle[]> {
  const rows = await db
    .select({ v: vehicles, categoryName: vehicleCategories.name, branchName: branches.name, branchCode: branches.code })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(where)
    .orderBy(asc(branches.code), asc(vehicles.make), asc(vehicles.model), asc(vehicles.plateNumber));
  const maps = await db.select().from(vehicleFeatureMap);
  return rows.map((r) => ({
    ...r.v,
    categoryName: r.categoryName,
    branchName: r.branchName,
    branchCode: r.branchCode,
    featureIds: maps.filter((m) => m.vehicleId === r.v.id).map((m) => m.featureId),
    photoUrls: r.v.photoKeys.filter((k) => k.startsWith("public/")).map(publicFileUrl),
  }));
}

export async function createVehicle(actor: Actor, input: z.input<typeof vehicleSchema>): Promise<FleetVehicle> {
  assertAdmin(actor);
  const { featureIds, ...d } = parseInput(vehicleSchema, input);
  const id = await db
    .transaction(async (tx) => {
      const [row] = await tx.insert(vehicles).values(d).returning();
      if (featureIds?.length) await tx.insert(vehicleFeatureMap).values(featureIds.map((featureId) => ({ vehicleId: row.id, featureId })));
      await audit({ actor, action: "vehicle.created", entityType: "vehicle", entityId: row.id, data: { plateNumber: row.plateNumber } }, tx);
      return row.id;
    })
    .catch((e) => mapDbError(e, uniqueVehicle));
  return getFleetVehicle(actor, id);
}

/** Update any vehicle fields; status RETIRED takes it out of search (existing bookings stay). */
export async function updateVehicle(actor: Actor, vehicleId: string, input: Partial<z.input<typeof vehicleSchema>>): Promise<FleetVehicle> {
  assertAdmin(actor);
  parseInput(zId, vehicleId);
  const { featureIds, ...d } = parseInput(vehicleSchema.partial(), input);
  // Defaults from the full schema must not overwrite omitted fields.
  const changes = Object.fromEntries(Object.entries(d).filter(([k]) => k in input));
  await db
    .transaction(async (tx) => {
      const [row] = await tx.update(vehicles).set(changes).where(eq(vehicles.id, vehicleId)).returning({ id: vehicles.id });
      if (!row) throw new DomainError("NOT_FOUND", "Vehicle not found.");
      if (featureIds) {
        await tx.delete(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, vehicleId));
        if (featureIds.length) await tx.insert(vehicleFeatureMap).values(featureIds.map((featureId) => ({ vehicleId, featureId })));
      }
      await audit({ actor, action: "vehicle.updated", entityType: "vehicle", entityId: vehicleId, data: { ...changes, featureIds } }, tx);
    })
    .catch((e) => mapDbError(e, uniqueVehicle));
  return getFleetVehicle(actor, vehicleId);
}

export const VEHICLE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Admin: add a public vehicle photo. */
export async function addVehiclePhoto(actor: Actor, vehicleId: string, file: { data: Uint8Array; contentType: string }): Promise<FleetVehicle> {
  assertAdmin(actor);
  parseInput(zId, vehicleId);
  const ext = extensionFor(file.contentType, VEHICLE_PHOTO_TYPES);
  if (!ext) throw new DomainError("VALIDATION", "Upload a JPEG, PNG or WebP image.");
  if (!file.data.byteLength || file.data.byteLength > MAX_UPLOAD_BYTES) throw new DomainError("VALIDATION", "Images must be 4 MB or smaller.");
  assertMagicBytes(file.data, file.contentType);
  const [v] = await db.select({ keys: vehicles.photoKeys }).from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!v) throw new DomainError("NOT_FOUND", "Vehicle not found.");
  if (v.keys.length >= 12) throw new DomainError("VALIDATION", "At most 12 photos per vehicle.");
  const key = `public/vehicles/${vehicleId}/${randomUUID()}.${ext}`;
  await getFileStorage().put(key, file.data, { contentType: file.contentType });
  await db.update(vehicles).set({ photoKeys: sql`array_append(${vehicles.photoKeys}, ${key})` }).where(eq(vehicles.id, vehicleId));
  await audit({ actor, action: "vehicle.photo_added", entityType: "vehicle", entityId: vehicleId });
  return getFleetVehicle(actor, vehicleId);
}

export async function removeVehiclePhoto(actor: Actor, vehicleId: string, index: number): Promise<FleetVehicle> {
  assertAdmin(actor);
  parseInput(zId, vehicleId);
  const [v] = await db.select({ keys: vehicles.photoKeys }).from(vehicles).where(eq(vehicles.id, vehicleId));
  const key = v?.keys[index];
  if (!key) throw new DomainError("NOT_FOUND", "Photo not found.");
  await db.update(vehicles).set({ photoKeys: v.keys.filter((_, i) => i !== index) }).where(eq(vehicles.id, vehicleId));
  await getFileStorage().delete(key).catch(() => {});
  await audit({ actor, action: "vehicle.photo_removed", entityType: "vehicle", entityId: vehicleId });
  return getFleetVehicle(actor, vehicleId);
}

// ---------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------
export const extraSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).nullish(),
  pricingType: z.enum(["PER_DAY", "PER_RENTAL"]),
  priceFils: zFils,
  maxPriceFils: zFils.nullish(),
  maxQuantity: z.number().int().min(1).max(10).default(1),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function createExtra(actor: Actor, input: z.input<typeof extraSchema>) {
  assertAdmin(actor);
  const d = parseInput(extraSchema, input);
  const [row] = await db.insert(extras).values(d).returning().catch((e) => mapDbError(e, { code: "Extra code exists." }));
  await audit({ actor, action: "extra.created", entityType: "extra", entityId: row.id, data: d });
  return row;
}

export async function updateExtra(actor: Actor, extraId: string, input: Partial<z.input<typeof extraSchema>>) {
  assertAdmin(actor);
  parseInput(zId, extraId);
  const d = parseInput(extraSchema.partial(), input);
  const changes = Object.fromEntries(Object.entries(d).filter(([k]) => k in input));
  const [row] = await db
    .update(extras)
    .set(changes)
    .where(eq(extras.id, extraId))
    .returning()
    .catch((e) => mapDbError(e, { code: "Extra code exists." }));
  if (!row) throw new DomainError("NOT_FOUND", "Extra not found.");
  await audit({ actor, action: "extra.updated", entityType: "extra", entityId: row.id, data: changes });
  return row;
}

// ---------------------------------------------------------------------------
// Maintenance blocks
// ---------------------------------------------------------------------------
export const maintenanceSchema = z
  .object({
    vehicleId: zId,
    startsAt: zInstant,
    endsAt: zInstant,
    reason: z.string().trim().min(2).max(500),
  })
  .refine((m) => m.endsAt > m.startsAt, { message: "End must be after start", path: ["endsAt"] });

export async function listMaintenanceBlocks(actor: Actor, input: { vehicleId?: string; includePast?: boolean } = {}) {
  assertAdmin(actor);
  const f = parseInput(z.object({ vehicleId: zId.optional(), includePast: z.boolean().default(false) }), input);
  const where: SQL[] = [];
  if (f.vehicleId) where.push(eq(maintenanceBlocks.vehicleId, f.vehicleId));
  if (!f.includePast) where.push(gte(maintenanceBlocks.endsAt, new Date()));
  return db
    .select({
      id: maintenanceBlocks.id,
      vehicleId: maintenanceBlocks.vehicleId,
      startsAt: maintenanceBlocks.startsAt,
      endsAt: maintenanceBlocks.endsAt,
      reason: maintenanceBlocks.reason,
      createdAt: maintenanceBlocks.createdAt,
      plateNumber: vehicles.plateNumber,
      vehicleName: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`,
      timezone: branches.timezone,
    })
    .from(maintenanceBlocks)
    .innerJoin(vehicles, eq(vehicles.id, maintenanceBlocks.vehicleId))
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(maintenanceBlocks.startsAt));
}

/**
 * Blocks a vehicle for maintenance. Rejected (VEHICLE_UNAVAILABLE) if it overlaps an active
 * reservation or another block - enforced by the database (exclusion constraint + trigger).
 */
export async function createMaintenanceBlock(actor: Actor, input: z.input<typeof maintenanceSchema>, now: Date = new Date()) {
  assertAdmin(actor);
  const d = parseInput(maintenanceSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, d.vehicleId)).for("update");
      if (!v) throw new DomainError("NOT_FOUND", "Vehicle not found.");
      await expireStaleHolds(tx, d.vehicleId, d.startsAt, d.endsAt, now);
      const [row] = await tx.insert(maintenanceBlocks).values({ ...d, createdBy: actor.id }).returning();
      await audit({ actor, action: "maintenance.created", entityType: "maintenance_block", entityId: row.id, data: d }, tx);
      return row;
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw new DomainError("VEHICLE_UNAVAILABLE", "The vehicle has a reservation or maintenance block in that period.");
    }
    throw err;
  }
}

export async function deleteMaintenanceBlock(actor: Actor, blockId: string): Promise<void> {
  assertAdmin(actor);
  parseInput(zId, blockId);
  const [row] = await db.delete(maintenanceBlocks).where(eq(maintenanceBlocks.id, blockId)).returning();
  if (!row) throw new DomainError("NOT_FOUND", "Maintenance block not found.");
  await audit({ actor, action: "maintenance.deleted", entityType: "maintenance_block", entityId: blockId, data: { vehicleId: row.vehicleId } });
}
