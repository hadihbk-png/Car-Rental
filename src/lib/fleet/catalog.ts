import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  branches,
  extras,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
  type Branch,
  type VehicleStatus,
} from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { publicFileUrl } from "@/lib/storage/types";

// Public read-only catalog: branches, categories, extras, vehicle details. No auth required.

export type BranchSummary = {
  id: string;
  code: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  latitude: string | null;
  longitude: string | null;
  openingHours: string | null;
  isActive: boolean;
};

export type VehicleCard = {
  id: string;
  name: string; // "Toyota Camry 2024"
  make: string;
  model: string;
  year: number;
  color: string | null;
  transmission: "AUTOMATIC" | "MANUAL";
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  seats: number;
  doors: number;
  luggage: number;
  status: VehicleStatus;
  description: string | null;
  depositFils: number;
  category: { id: string; slug: string; name: string };
  branch: { id: string; code: string; slug: string; name: string; city: string; timezone: string };
  features: { slug: string; name: string; icon: string | null }[];
  /** Public URLs (served by /api/files/public/...). First one is the main photo. */
  photoUrls: string[];
};

export function toBranchSummary(b: Branch): BranchSummary {
  return {
    id: b.id,
    code: b.code,
    slug: b.slug,
    name: b.name,
    city: b.city,
    address: b.address,
    phone: b.phone,
    email: b.email,
    timezone: b.timezone,
    latitude: b.latitude,
    longitude: b.longitude,
    openingHours: b.openingHours,
    isActive: b.isActive,
  };
}

/** Active branches (admins can pass includeInactive). */
export async function listBranches(options: { includeInactive?: boolean } = {}): Promise<BranchSummary[]> {
  const rows = await db
    .select()
    .from(branches)
    .where(options.includeInactive ? undefined : eq(branches.isActive, true))
    .orderBy(asc(branches.city), asc(branches.name));
  return rows.map(toBranchSummary);
}

/** By id, slug or code. Throws NOT_FOUND. */
export async function getBranch(idOrSlugOrCode: string): Promise<BranchSummary> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlugOrCode);
  const [row] = await db
    .select()
    .from(branches)
    .where(
      isUuid
        ? eq(branches.id, idOrSlugOrCode)
        : idOrSlugOrCode === idOrSlugOrCode.toUpperCase()
          ? eq(branches.code, idOrSlugOrCode)
          : eq(branches.slug, idOrSlugOrCode),
    );
  if (!row) throw new DomainError("NOT_FOUND", "Branch not found.");
  return toBranchSummary(row);
}

export async function listCategories() {
  return db
    .select({
      id: vehicleCategories.id,
      slug: vehicleCategories.slug,
      name: vehicleCategories.name,
      description: vehicleCategories.description,
      depositFils: vehicleCategories.depositFils,
      sortOrder: vehicleCategories.sortOrder,
    })
    .from(vehicleCategories)
    .orderBy(asc(vehicleCategories.sortOrder), asc(vehicleCategories.name));
}

export async function listFeatures() {
  return db
    .select({ id: vehicleFeatures.id, slug: vehicleFeatures.slug, name: vehicleFeatures.name, icon: vehicleFeatures.icon })
    .from(vehicleFeatures)
    .orderBy(asc(vehicleFeatures.name));
}

export type ExtraSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricingType: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxPriceFils: number | null;
  maxQuantity: number;
  isActive: boolean;
};

/** Extras offered at checkout (active only unless includeInactive). */
export async function listExtras(options: { includeInactive?: boolean } = {}): Promise<ExtraSummary[]> {
  return db
    .select({
      id: extras.id,
      code: extras.code,
      name: extras.name,
      description: extras.description,
      pricingType: extras.pricingType,
      priceFils: extras.priceFils,
      maxPriceFils: extras.maxPriceFils,
      maxQuantity: extras.maxQuantity,
      isActive: extras.isActive,
    })
    .from(extras)
    .where(options.includeInactive ? undefined : eq(extras.isActive, true))
    .orderBy(asc(extras.sortOrder), asc(extras.name));
}

/** Vehicle cards for the given ids, in the given order. */
export async function loadVehicleCards(ids: string[], tx: DbOrTx = db): Promise<VehicleCard[]> {
  if (!ids.length) return [];
  const rows = await tx
    .select({ v: vehicles, c: vehicleCategories, b: branches })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(inArray(vehicles.id, ids));
  const feats = await tx
    .select({ vehicleId: vehicleFeatureMap.vehicleId, slug: vehicleFeatures.slug, name: vehicleFeatures.name, icon: vehicleFeatures.icon })
    .from(vehicleFeatureMap)
    .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
    .where(inArray(vehicleFeatureMap.vehicleId, ids))
    .orderBy(asc(vehicleFeatures.name));
  const byId = new Map(
    rows.map(({ v, c, b }) => [
      v.id,
      {
        id: v.id,
        name: `${v.make} ${v.model} ${v.year}`,
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color,
        transmission: v.transmission,
        fuelType: v.fuelType,
        seats: v.seats,
        doors: v.doors,
        luggage: v.luggage,
        status: v.status,
        description: v.description,
        depositFils: c.depositFils,
        category: { id: c.id, slug: c.slug, name: c.name },
        branch: { id: b.id, code: b.code, slug: b.slug, name: b.name, city: b.city, timezone: b.timezone },
        features: feats.filter((f) => f.vehicleId === v.id).map(({ slug, name, icon }) => ({ slug, name, icon })),
        photoUrls: v.photoKeys.filter((k) => k.startsWith("public/")).map(publicFileUrl),
      } satisfies VehicleCard,
    ]),
  );
  return ids.map((id) => byId.get(id)).filter((v): v is VehicleCard => !!v);
}

/** Vehicle details for the public vehicle page. Retired vehicles are hidden. Throws NOT_FOUND. */
export async function getVehicle(vehicleId: string): Promise<VehicleCard> {
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) throw new DomainError("NOT_FOUND", "Vehicle not found.");
  const [card] = await loadVehicleCards([vehicleId]);
  if (!card || card.status === "RETIRED") throw new DomainError("NOT_FOUND", "Vehicle not found.");
  return card;
}

/** Ids of rentable vehicles at a branch (not retired / in maintenance). */
export async function rentableVehicleIdsAtBranch(branchId: string): Promise<string[]> {
  const rows = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.branchId, branchId), inArray(vehicles.status, ["AVAILABLE", "RESERVED", "ON_RENT"])));
  return rows.map((r) => r.id);
}
