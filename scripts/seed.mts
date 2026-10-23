// pnpm db:seed - idempotent sample data for the database in DATABASE_URL (read at runtime).
// Re-running updates reference data in place and never duplicates rows; reservations are created
// through the real booking + payment services (fake provider) with fixed idempotency keys.
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { appDatabaseUrl, databaseNameOf } from "../src/db/urls";
import {
  accounts,
  branches,
  driverProfiles,
  extras,
  maintenanceBlocks,
  oneWayFees,
  pricingRules,
  users,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} from "../src/db/schema";
import type { Actor } from "../src/lib/auth/types";
import { zonedTimeToUtc, addDaysToDate, localDate } from "../src/lib/availability/time";
import { DomainError } from "../src/lib/errors";
import { getFileStorage } from "../src/lib/storage";
import { carSvg, samplePng } from "./seed-images.mjs";

// Webhooks from the fake provider must not reach a dev server that may use another database.
process.env.FAKE_PAYMENTS_WEBHOOK_URL = "";
process.env.LOG_LEVEL ??= "warn";

const TZ = "Asia/Dubai";
const AED = (n: number) => Math.round(n * 100);

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`${key} is not set (see .env.example).`);
    process.exit(1);
  }
  return v;
}

const seedUrl = appDatabaseUrl();
if (!seedUrl) {
  console.error("DATABASE_URL (or NETLIFY_DATABASE_URL) is not set (see .env.example).");
  process.exit(1);
}
const dbName = databaseNameOf(seedUrl);
const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@driveeasy.test").toLowerCase();
const customerEmail = (process.env.SEED_CUSTOMER_EMAIL || "customer@driveeasy.test").toLowerCase();
const adminPassword = required("SEED_ADMIN_PASSWORD");
const customerPassword = required("SEED_CUSTOMER_PASSWORD");
const storage = getFileStorage();

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const BRANCHES = [
  { code: "DXBAPT", slug: "dubai-airport", name: "Dubai International Airport (T3)", city: "Dubai", address: "Arrivals Hall, Terminal 3, Dubai International Airport, Dubai", phone: "+971 4 555 0101", email: "dxb-airport@driveeasy.test", latitude: "25.252778", longitude: "55.364444", openingHours: "Open 24 hours" },
  { code: "DXBMAR", slug: "dubai-marina", name: "Dubai Marina", city: "Dubai", address: "Marina Walk, Dubai Marina, Dubai", phone: "+971 4 555 0102", email: "dxb-marina@driveeasy.test", latitude: "25.080000", longitude: "55.140000", openingHours: "Daily 08:00-22:00" },
  { code: "AUHAPT", slug: "abu-dhabi-airport", name: "Zayed International Airport", city: "Abu Dhabi", address: "Terminal A Arrivals, Zayed International Airport, Abu Dhabi", phone: "+971 2 555 0103", email: "auh-airport@driveeasy.test", latitude: "24.432972", longitude: "54.651138", openingHours: "Open 24 hours" },
  { code: "SHJCTY", slug: "sharjah-city", name: "Sharjah City Centre", city: "Sharjah", address: "Al Wahda Street, Sharjah", phone: "+971 6 555 0104", email: "shj-city@driveeasy.test", latitude: "25.325000", longitude: "55.393000", openingHours: "Daily 09:00-21:00" },
] as const;

const CATEGORIES = [
  { slug: "economy", name: "Economy", description: "Small, efficient cars for the city.", depositFils: AED(1000), sortOrder: 1, rate: 99 },
  { slug: "compact", name: "Compact", description: "Comfortable sedans and hatchbacks.", depositFils: AED(1500), sortOrder: 2, rate: 139 },
  { slug: "suv", name: "SUV", description: "Room for family, luggage and desert roads.", depositFils: AED(2500), sortOrder: 3, rate: 239 },
  { slug: "luxury", name: "Luxury", description: "Premium sedans and sports cars.", depositFils: AED(5000), sortOrder: 4, rate: 599 },
  { slug: "van", name: "Van & People Carrier", description: "Seven seats and more.", depositFils: AED(2000), sortOrder: 5, rate: 219 },
] as const;

const FEATURES = [
  ["air-conditioning", "Air conditioning", "snowflake"],
  ["bluetooth", "Bluetooth", "bluetooth"],
  ["apple-carplay", "Apple CarPlay", "smartphone"],
  ["android-auto", "Android Auto", "smartphone"],
  ["built-in-navigation", "Built-in navigation", "map"],
  ["cruise-control", "Cruise control", "gauge"],
  ["reversing-camera", "Reversing camera", "camera"],
  ["leather-seats", "Leather seats", "armchair"],
  ["sunroof", "Sunroof", "sun"],
  ["keyless-entry", "Keyless entry", "key"],
  ["isofix", "ISOFIX child-seat anchors", "baby"],
  ["four-wheel-drive", "Four-wheel drive", "mountain"],
] as const;

type Body = "sedan" | "suv" | "hatch" | "van" | "coupe";
type SeedVehicle = {
  branch: (typeof BRANCHES)[number]["code"];
  category: (typeof CATEGORIES)[number]["slug"];
  make: string;
  model: string;
  year: number;
  color: string;
  hex: string;
  body: Body;
  transmission: "AUTOMATIC" | "MANUAL";
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  seats: number;
  doors: number;
  luggage: number;
  mileageKm: number;
  features: (typeof FEATURES)[number][0][];
};

const BASIC = ["air-conditioning", "bluetooth"] as const;
const V = (v: SeedVehicle) => v;
const VEHICLES: SeedVehicle[] = [
  V({ branch: "DXBAPT", category: "economy", make: "Nissan", model: "Sunny", year: 2024, color: "White", hex: "#e5e7eb", body: "sedan", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, mileageKm: 18_200, features: [...BASIC, "reversing-camera"] }),
  V({ branch: "DXBAPT", category: "economy", make: "Kia", model: "Picanto", year: 2025, color: "Red", hex: "#dc2626", body: "hatch", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 4, doors: 5, luggage: 1, mileageKm: 6_400, features: [...BASIC, "apple-carplay", "android-auto"] }),
  V({ branch: "DXBAPT", category: "compact", make: "Toyota", model: "Corolla Hybrid", year: 2025, color: "Silver", hex: "#9ca3af", body: "sedan", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 4, luggage: 3, mileageKm: 9_800, features: [...BASIC, "apple-carplay", "cruise-control", "reversing-camera", "isofix"] }),
  V({ branch: "DXBAPT", category: "suv", make: "Toyota", model: "Land Cruiser", year: 2024, color: "Pearl White", hex: "#f1f5f9", body: "suv", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 7, doors: 5, luggage: 5, mileageKm: 31_000, features: [...BASIC, "built-in-navigation", "leather-seats", "four-wheel-drive", "cruise-control", "isofix"] }),
  V({ branch: "DXBAPT", category: "luxury", make: "Mercedes-Benz", model: "S 500", year: 2025, color: "Obsidian Black", hex: "#111827", body: "sedan", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 3, mileageKm: 4_100, features: [...BASIC, "built-in-navigation", "leather-seats", "sunroof", "keyless-entry", "cruise-control"] }),
  V({ branch: "DXBAPT", category: "van", make: "Toyota", model: "HiAce", year: 2023, color: "White", hex: "#f8fafc", body: "van", transmission: "AUTOMATIC", fuelType: "DIESEL", seats: 12, doors: 4, luggage: 8, mileageKm: 58_300, features: [...BASIC, "reversing-camera"] }),
  V({ branch: "DXBMAR", category: "economy", make: "Hyundai", model: "Accent", year: 2024, color: "Blue", hex: "#2563eb", body: "sedan", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, mileageKm: 22_900, features: [...BASIC] }),
  V({ branch: "DXBMAR", category: "compact", make: "Volkswagen", model: "Golf", year: 2024, color: "Grey", hex: "#6b7280", body: "hatch", transmission: "MANUAL", fuelType: "PETROL", seats: 5, doors: 5, luggage: 2, mileageKm: 14_700, features: [...BASIC, "apple-carplay", "android-auto", "cruise-control"] }),
  V({ branch: "DXBMAR", category: "suv", make: "Nissan", model: "Patrol", year: 2025, color: "Desert Sand", hex: "#d6b98c", body: "suv", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 7, doors: 5, luggage: 5, mileageKm: 7_600, features: [...BASIC, "four-wheel-drive", "leather-seats", "built-in-navigation", "isofix"] }),
  V({ branch: "DXBMAR", category: "luxury", make: "Porsche", model: "911 Carrera", year: 2024, color: "Guards Red", hex: "#b91c1c", body: "coupe", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 4, doors: 2, luggage: 1, mileageKm: 8_900, features: [...BASIC, "leather-seats", "built-in-navigation", "keyless-entry"] }),
  V({ branch: "DXBMAR", category: "luxury", make: "Tesla", model: "Model S", year: 2025, color: "Midnight Silver", hex: "#475569", body: "sedan", transmission: "AUTOMATIC", fuelType: "ELECTRIC", seats: 5, doors: 4, luggage: 3, mileageKm: 12_300, features: [...BASIC, "built-in-navigation", "sunroof", "keyless-entry", "reversing-camera"] }),
  V({ branch: "AUHAPT", category: "economy", make: "Mitsubishi", model: "Attrage", year: 2024, color: "Silver", hex: "#cbd5e1", body: "sedan", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, mileageKm: 26_000, features: [...BASIC] }),
  V({ branch: "AUHAPT", category: "compact", make: "Honda", model: "Civic", year: 2025, color: "Blue", hex: "#1d4ed8", body: "sedan", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 3, mileageKm: 5_200, features: [...BASIC, "apple-carplay", "android-auto", "reversing-camera", "isofix"] }),
  V({ branch: "AUHAPT", category: "suv", make: "Hyundai", model: "Tucson Hybrid", year: 2025, color: "Green", hex: "#166534", body: "suv", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 5, luggage: 4, mileageKm: 11_100, features: [...BASIC, "apple-carplay", "reversing-camera", "cruise-control", "isofix"] }),
  V({ branch: "AUHAPT", category: "suv", make: "Jeep", model: "Wrangler", year: 2023, color: "Orange", hex: "#ea580c", body: "suv", transmission: "MANUAL", fuelType: "PETROL", seats: 5, doors: 5, luggage: 3, mileageKm: 40_200, features: [...BASIC, "four-wheel-drive"] }),
  V({ branch: "AUHAPT", category: "luxury", make: "BMW", model: "7 Series", year: 2024, color: "Carbon Black", hex: "#1f2937", body: "sedan", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 3, mileageKm: 15_800, features: [...BASIC, "leather-seats", "sunroof", "built-in-navigation", "keyless-entry"] }),
  V({ branch: "AUHAPT", category: "van", make: "Kia", model: "Carnival", year: 2025, color: "Grey", hex: "#64748b", body: "van", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 8, doors: 5, luggage: 5, mileageKm: 3_900, features: [...BASIC, "apple-carplay", "isofix", "reversing-camera"] }),
  V({ branch: "SHJCTY", category: "economy", make: "Suzuki", model: "Swift", year: 2024, color: "Yellow", hex: "#facc15", body: "hatch", transmission: "MANUAL", fuelType: "PETROL", seats: 5, doors: 5, luggage: 1, mileageKm: 19_500, features: [...BASIC] }),
  V({ branch: "SHJCTY", category: "compact", make: "Mazda", model: "3", year: 2024, color: "Soul Red", hex: "#991b1b", body: "hatch", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 5, luggage: 2, mileageKm: 13_300, features: [...BASIC, "apple-carplay", "android-auto", "cruise-control"] }),
  V({ branch: "SHJCTY", category: "suv", make: "Kia", model: "Sportage", year: 2025, color: "White", hex: "#f3f4f6", body: "suv", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 5, luggage: 4, mileageKm: 6_800, features: [...BASIC, "reversing-camera", "isofix"] }),
  V({ branch: "SHJCTY", category: "van", make: "Toyota", model: "Innova", year: 2023, color: "Bronze", hex: "#92400e", body: "van", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 7, doors: 5, luggage: 3, mileageKm: 47_000, features: [...BASIC, "reversing-camera"] }),
];

const EXTRAS = [
  { code: "CHILD_SEAT", name: "Child seat", description: "Group 1/2/3 child seat, fitted on request.", pricingType: "PER_DAY", priceFils: AED(25), maxPriceFils: AED(250), maxQuantity: 3, sortOrder: 1 },
  { code: "GPS", name: "GPS navigation", description: "Portable sat-nav with UAE maps.", pricingType: "PER_DAY", priceFils: AED(20), maxPriceFils: AED(200), maxQuantity: 1, sortOrder: 2 },
  { code: "ADDITIONAL_DRIVER", name: "Additional driver", description: "Add a second licensed driver (21+).", pricingType: "PER_DAY", priceFils: AED(30), maxPriceFils: AED(300), maxQuantity: 3, sortOrder: 3 },
  { code: "FULL_INSURANCE", name: "Full insurance cover", description: "Zero excess on damage and theft.", pricingType: "PER_DAY", priceFils: AED(60), maxPriceFils: null, maxQuantity: 1, sortOrder: 4 },
] as const;

const ONE_WAY: [string, string, number][] = [
  ["DXBAPT", "DXBMAR", 75],
  ["DXBAPT", "AUHAPT", 300],
  ["DXBAPT", "SHJCTY", 120],
  ["DXBMAR", "AUHAPT", 300],
  ["DXBMAR", "SHJCTY", 150],
  ["AUHAPT", "SHJCTY", 400],
];

function vinFor(i: number) {
  return `1DRVE${String(2026).slice(2)}${"ABCDEFGHJK"[i % 10]}${String(100000 + i * 7919).slice(-6)}A${String(i).padStart(2, "0")}`.slice(0, 17);
}

async function upsertBy(
  find: () => Promise<{ id: string } | undefined>,
  insert: () => Promise<{ id: string }[]>,
  update: (id: string) => Promise<unknown>,
): Promise<string> {
  const existing = await find();
  if (existing) {
    await update(existing.id);
    return existing.id;
  }
  const [row] = await insert();
  return row.id;
}

async function ensureUser(email: string, name: string, password: string, role: "admin" | "customer"): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  const hash = await hashPassword(password);
  if (existing) {
    await db.update(users).set({ role, name }).where(eq(users.id, existing.id));
    // Keep the password in step with .env.local.
    await db.update(accounts).set({ password: hash }).where(and(eq(accounts.userId, existing.id), eq(accounts.providerId, "credential")));
    return existing.id;
  }
  const id = randomUUID();
  await db.insert(users).values({ id, email, name, role, emailVerified: true });
  await db.insert(accounts).values({ accountId: id, providerId: "credential", userId: id, password: hash });
  return id;
}

async function main() {
  console.log(`Seeding ${dbName} ...`);

  const branchIds: Record<string, string> = {};
  for (const b of BRANCHES) {
    branchIds[b.code] = await upsertBy(
      async () => (await db.select({ id: branches.id }).from(branches).where(eq(branches.code, b.code)))[0],
      () => db.insert(branches).values({ ...b, timezone: TZ }).returning({ id: branches.id }),
      (id) => db.update(branches).set({ ...b, timezone: TZ }).where(eq(branches.id, id)),
    );
  }

  const categoryIds: Record<string, string> = {};
  for (const { rate, ...c } of CATEGORIES) {
    void rate;
    categoryIds[c.slug] = await upsertBy(
      async () => (await db.select({ id: vehicleCategories.id }).from(vehicleCategories).where(eq(vehicleCategories.slug, c.slug)))[0],
      () => db.insert(vehicleCategories).values(c).returning({ id: vehicleCategories.id }),
      (id) => db.update(vehicleCategories).set(c).where(eq(vehicleCategories.id, id)),
    );
  }

  const featureIds: Record<string, string> = {};
  for (const [slug, name, icon] of FEATURES) {
    featureIds[slug] = await upsertBy(
      async () => (await db.select({ id: vehicleFeatures.id }).from(vehicleFeatures).where(eq(vehicleFeatures.slug, slug)))[0],
      () => db.insert(vehicleFeatures).values({ slug, name, icon }).returning({ id: vehicleFeatures.id }),
      (id) => db.update(vehicleFeatures).set({ name, icon }).where(eq(vehicleFeatures.id, id)),
    );
  }

  const vehicleIds: string[] = [];
  for (const [i, v] of VEHICLES.entries()) {
    const plateNumber = `${v.branch.slice(0, 3)} ${"ABCDEFGHJKLMNPRSTUVWXYZ"[i % 23]} ${String(10_000 + i * 137).padStart(5, "0")}`;
    const values = {
      branchId: branchIds[v.branch],
      categoryId: categoryIds[v.category],
      make: v.make,
      model: v.model,
      year: v.year,
      plateNumber,
      vin: vinFor(i),
      color: v.color,
      transmission: v.transmission,
      fuelType: v.fuelType,
      seats: v.seats,
      doors: v.doors,
      luggage: v.luggage,
      description: `${v.year} ${v.make} ${v.model} in ${v.color.toLowerCase()}. ${v.seats} seats, ${v.transmission.toLowerCase()} transmission.`,
    };
    const id = await upsertBy(
      async () => (await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.plateNumber, plateNumber)))[0],
      () => db.insert(vehicles).values({ ...values, mileageKm: v.mileageKm }).returning({ id: vehicles.id }),
      (vid) => db.update(vehicles).set(values).where(eq(vehicles.id, vid)),
    );
    vehicleIds.push(id);
    await db.delete(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, id));
    await db.insert(vehicleFeatureMap).values(v.features.map((f) => ({ vehicleId: id, featureId: featureIds[f] })));

    // Public photos through FileStorage (generated locally, no hotlinking).
    const cat = CATEGORIES.find((c) => c.slug === v.category)!;
    const keys = [0, 1].map((n) => `public/vehicles/${id}/seed-${n + 1}.svg`);
    for (const [n, key] of keys.entries()) {
      await storage.put(
        key,
        carSvg({ title: `${v.make} ${v.model}`, subtitle: `${v.year} - ${cat.name} - ${v.color}`, color: v.hex, body: v.body, variant: n as 0 | 1 }),
        { contentType: "image/svg+xml" },
      );
    }
    await db.update(vehicles).set({ photoKeys: keys }).where(eq(vehicles.id, id));
  }

  for (const e of EXTRAS) {
    await upsertBy(
      async () => (await db.select({ id: extras.id }).from(extras).where(eq(extras.code, e.code)))[0],
      () => db.insert(extras).values(e).returning({ id: extras.id }),
      (id) => db.update(extras).set(e).where(eq(extras.id, id)),
    );
  }

  // Pricing rules: category base rate, weekly (-15%) and monthly (-25%) rates, a festive-season
  // surcharge for SUV/luxury, and one vehicle-specific rate.
  const rules: (typeof pricingRules.$inferInsert)[] = [];
  for (const c of CATEGORIES) {
    rules.push({ name: `${c.name} - standard`, categoryId: categoryIds[c.slug], dailyRateFils: AED(c.rate) });
    rules.push({ name: `${c.name} - weekly`, categoryId: categoryIds[c.slug], dailyRateFils: Math.round(AED(c.rate) * 0.85), minDays: 7 });
    rules.push({ name: `${c.name} - monthly`, categoryId: categoryIds[c.slug], dailyRateFils: Math.round(AED(c.rate) * 0.75), minDays: 28 });
  }
  for (const slug of ["suv", "luxury"] as const) {
    const c = CATEGORIES.find((x) => x.slug === slug)!;
    rules.push({
      name: `${c.name} - festive season`,
      categoryId: categoryIds[slug],
      dailyRateFils: Math.round(AED(c.rate) * 1.3),
      validFrom: "2026-12-20",
      validTo: "2027-01-05",
      priority: 10,
    });
  }
  const porsche = vehicleIds[VEHICLES.findIndex((v) => v.model === "911 Carrera")];
  rules.push({ name: "Porsche 911 Carrera - special rate", vehicleId: porsche, categoryId: categoryIds.luxury, dailyRateFils: AED(1299) });
  for (const r of rules) {
    await upsertBy(
      async () => (await db.select({ id: pricingRules.id }).from(pricingRules).where(eq(pricingRules.name, r.name)))[0],
      () => db.insert(pricingRules).values(r).returning({ id: pricingRules.id }),
      (id) => db.update(pricingRules).set(r).where(eq(pricingRules.id, id)),
    );
  }

  for (const [a, b, fee] of ONE_WAY) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      await db
        .insert(oneWayFees)
        .values({ fromBranchId: branchIds[from], toBranchId: branchIds[to], feeFils: AED(fee) })
        .onConflictDoUpdate({ target: [oneWayFees.fromBranchId, oneWayFees.toBranchId], set: { feeFils: AED(fee) } });
    }
  }

  // Accounts.
  const adminId = await ensureUser(adminEmail, "DriveEasy Admin", adminPassword, "admin");
  const customerId = await ensureUser(customerEmail, "Layla Haddad", customerPassword, "customer");
  const customer: Actor = { id: customerId, email: customerEmail, name: "Layla Haddad", role: "customer" };

  // Customer driver profile with a sample licence scan (private storage).
  const licenceKey = `private/licences/${customerId}/seed-licence.png`;
  await storage.put(licenceKey, samplePng(), { contentType: "image/png" });
  const profile = {
    fullName: "Layla Haddad",
    phone: "+971 50 555 0199",
    dateOfBirth: "1990-04-12",
    nationality: "United Arab Emirates",
    licenceNumber: "DXB-1234567",
    licenceCountry: "United Arab Emirates",
    licenceIssuedOn: "2015-06-01",
    licenceExpiresOn: "2031-06-01",
    licenceFileKey: licenceKey,
    licenceFileContentType: "image/png",
    licenceUploadedAt: new Date(),
  };
  await db.insert(driverProfiles).values({ userId: customerId, ...profile }).onConflictDoUpdate({ target: driverProfiles.userId, set: profile });

  // Maintenance block: Land Cruiser in for service in 3 days.
  const today = localDate(new Date(), TZ);
  const cruiser = vehicleIds[VEHICLES.findIndex((v) => v.model === "Land Cruiser")];
  const [hasBlock] = await db
    .select({ id: maintenanceBlocks.id })
    .from(maintenanceBlocks)
    .where(and(eq(maintenanceBlocks.vehicleId, cruiser), eq(maintenanceBlocks.reason, "Seed: scheduled 30,000 km service")));
  if (!hasBlock) {
    const { createMaintenanceBlock } = await import("../src/lib/fleet/admin");
    await createMaintenanceBlock(
      { id: adminId, email: adminEmail, name: "DriveEasy Admin", role: "admin" },
      {
        vehicleId: cruiser,
        startsAt: zonedTimeToUtc(addDaysToDate(today, 3), "08:00", TZ),
        endsAt: zonedTimeToUtc(addDaysToDate(today, 5), "18:00", TZ),
        reason: "Seed: scheduled 30,000 km service",
      },
    ).catch((err) => console.warn(`  maintenance block skipped: ${(err as Error).message}`));
  }

  // Future reservations through the real services (hold -> pay -> confirmed).
  const { createReservation, payReservation } = await import("../src/lib/reservations");
  const { FAKE_PAYMENT_METHODS } = await import("../src/lib/payments");
  const extraRows = await db.select({ id: extras.id, code: extras.code }).from(extras);
  const extra = (code: string) => extraRows.find((e) => e.code === code)!.id;
  const plans = [
    { key: "seed-reservation-1", model: "Corolla Hybrid", from: "DXBAPT", to: "DXBAPT", day: 6, days: 3, extras: [{ extraId: extra("CHILD_SEAT"), quantity: 1 }] },
    { key: "seed-reservation-2", model: "Patrol", from: "DXBMAR", to: "AUHAPT", day: 14, days: 5, extras: [{ extraId: extra("FULL_INSURANCE"), quantity: 1 }, { extraId: extra("GPS"), quantity: 1 }] },
    { key: "seed-reservation-3", model: "Civic", from: "AUHAPT", to: "AUHAPT", day: 25, days: 8, extras: [{ extraId: extra("ADDITIONAL_DRIVER"), quantity: 1 }] },
    { key: "seed-reservation-4", model: "Sunny", from: "DXBAPT", to: "SHJCTY", day: 40, days: 2, extras: [] },
  ];
  let created = 0;
  for (const p of plans) {
    const vehicleId = vehicleIds[VEHICLES.findIndex((v) => v.model === p.model)];
    const pickupDate = addDaysToDate(today, p.day);
    try {
      const r = await createReservation(customer, {
        vehicleId,
        pickupBranchId: branchIds[p.from],
        returnBranchId: branchIds[p.to],
        pickupAt: zonedTimeToUtc(pickupDate, "10:00", TZ),
        returnAt: zonedTimeToUtc(addDaysToDate(pickupDate, p.days), "10:00", TZ),
        extras: p.extras,
        idempotencyKey: p.key,
      });
      if (r.status === "PENDING") {
        await payReservation(customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: `${p.key}-pay` });
        created++;
      }
    } catch (err) {
      if (err instanceof DomainError) console.warn(`  reservation ${p.key} skipped: ${err.message}`);
      else throw err;
    }
  }

  const counts = await db.execute<{ t: string; n: number }>(
    sql.raw(`SELECT 'branches' t, count(*)::int n FROM branches UNION ALL SELECT 'vehicles', count(*)::int FROM vehicles
     UNION ALL SELECT 'extras', count(*)::int FROM extras UNION ALL SELECT 'pricing_rules', count(*)::int FROM pricing_rules
     UNION ALL SELECT 'reservations', count(*)::int FROM reservations UNION ALL SELECT 'users', count(*)::int FROM users`),
  );
  console.log(`Done. ${counts.rows.map((r) => `${r.t}=${r.n}`).join(", ")} (${created} new confirmed reservation(s)).`);
  console.log(`Admin login:    ${adminEmail}   (password: SEED_ADMIN_PASSWORD in .env.local)`);
  console.log(`Customer login: ${customerEmail}   (password: SEED_CUSTOMER_PASSWORD in .env.local)`);
}

try {
  await main();
} finally {
  await pool.end();
}
