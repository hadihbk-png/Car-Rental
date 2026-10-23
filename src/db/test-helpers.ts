// Fixtures for the engine's own DB tests (src/**/*.db.test.ts, driveeasy_test).
// Every fixture uses fresh random codes so test files never collide.
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import {
  branches,
  driverProfiles,
  extras,
  pricingRules,
  users,
  vehicleCategories,
  vehicles,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/types";
import { FakePaymentProvider } from "@/lib/payments/fake-provider";
import { MemoryFakePaymentStore } from "@/lib/payments/fake-store";
import { setPaymentProviderForTesting } from "@/lib/payments";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const rand = () => randomUUID().replace(/-/g, "").toUpperCase();

/** Fresh in-memory fake provider (no webhooks, no JSON file). */
export function useMemoryPayments(): FakePaymentProvider {
  const provider = new FakePaymentProvider({ store: new MemoryFakePaymentStore(), webhookSecret: "test-webhook-secret" });
  setPaymentProviderForTesting(provider);
  return provider;
}

export async function createUser(role: "customer" | "admin" = "customer"): Promise<Actor> {
  const email = `u${rand().slice(0, 12).toLowerCase()}@test.local`;
  const [u] = await db.insert(users).values({ name: `Test ${role}`, email, role }).returning();
  return { id: u.id, email: u.email, name: u.name, role };
}

export async function createDriverProfile(userId: string) {
  const [p] = await db
    .insert(driverProfiles)
    .values({
      userId,
      fullName: "Test Driver",
      phone: "+971500000000",
      dateOfBirth: "1990-01-01",
      nationality: "UAE",
      licenceNumber: "LIC-12345",
      licenceCountry: "UAE",
      licenceExpiresOn: "2035-01-01",
      licenceFileKey: `private/licences/${userId}/test.png`,
      licenceFileContentType: "image/png",
      licenceUploadedAt: new Date(),
    })
    .returning();
  return p;
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

/**
 * A branch (+ a second one for one-way), a category with a deposit, a base pricing rule
 * (AED 100/day), a weekly rule (AED 85/day), vehicles, extras, a customer with a complete
 * driver profile, another customer and an admin.
 */
export async function createFixture(options: { vehicles?: number; dailyRateFils?: number; depositFils?: number } = {}) {
  const code = rand().slice(0, 8);
  const [branch] = await db
    .insert(branches)
    .values({ code: `B${code}`, slug: `b-${code.toLowerCase()}`, name: `Branch ${code}`, city: "Dubai", address: "Test street", timezone: "Asia/Dubai" })
    .returning();
  const [branch2] = await db
    .insert(branches)
    .values({ code: `C${code}`, slug: `c-${code.toLowerCase()}`, name: `Branch2 ${code}`, city: "Abu Dhabi", address: "Test street 2", timezone: "Asia/Dubai" })
    .returning();
  const [category] = await db
    .insert(vehicleCategories)
    .values({ slug: `cat-${code.toLowerCase()}`, name: `Cat ${code}`, depositFils: options.depositFils ?? 150_000 })
    .returning();
  await db.insert(pricingRules).values([
    { name: `base ${code}`, categoryId: category.id, dailyRateFils: options.dailyRateFils ?? 10_000 },
    { name: `weekly ${code}`, categoryId: category.id, dailyRateFils: 8_500, minDays: 7 },
  ]);
  const vehicleRows = [];
  for (let i = 0; i < (options.vehicles ?? 1); i++) {
    const vin = `1TEST${rand().replace(/[IOQ]/g, "A").slice(0, 12)}`;
    const [v] = await db
      .insert(vehicles)
      .values({
        branchId: branch.id,
        categoryId: category.id,
        make: "Test",
        model: `Model ${i}`,
        year: 2025,
        plateNumber: `T ${code}${i}`,
        vin,
        transmission: i % 2 ? "MANUAL" : "AUTOMATIC",
        fuelType: "PETROL",
        seats: 5,
        mileageKm: 1000,
      })
      .returning();
    vehicleRows.push(v);
  }
  const [childSeat] = await db
    .insert(extras)
    .values({ code: `CS_${code}`, name: "Child seat", pricingType: "PER_DAY", priceFils: 2_500, maxPriceFils: 25_000, maxQuantity: 3 })
    .returning();
  const [insurance] = await db
    .insert(extras)
    .values({ code: `FI_${code}`, name: "Full insurance", pricingType: "PER_RENTAL", priceFils: 15_000 })
    .returning();
  const customer = await createUser("customer");
  await createDriverProfile(customer.id);
  const other = await createUser("customer");
  await createDriverProfile(other.id);
  const admin = await createUser("admin");
  return { branch, branch2, category, vehicles: vehicleRows, vehicle: vehicleRows[0], childSeat, insurance, customer, other, admin };
}

/** A time aligned to the hour, `days` days (+ hours) from now. */
export function future(days: number, hours = 0): Date {
  const d = new Date(Date.now() + days * DAY + hours * HOUR);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export const key = () => `test-${randomUUID()}`;
