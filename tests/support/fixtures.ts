// Integration fixtures for driveeasy_qa. Every call creates its own branches, category,
// vehicles, rules, extras and users with random codes, so test files never collide and
// expected prices are known in advance (they are NOT read back from the code under test).
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  branches,
  extras,
  maintenanceBlocks,
  oneWayFees,
  pricingRules,
  reservations,
  users,
  vehicleCategories,
  vehicles,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/types";
import { uploadLicence, upsertDriverProfile } from "@/lib/drivers";
import { setPaymentProviderForTesting } from "@/lib/payments";
import { FakePaymentProvider } from "@/lib/payments/fake-provider";
import { MemoryFakePaymentStore } from "@/lib/payments/fake-store";
import type { WebhookEvent } from "@/lib/payments/types";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Known prices (fils). */
export const PRICES = {
  dailyRate: 20_000, // AED 200/day
  weeklyRate: 17_000, // 7+ days
  deposit: 150_000, // AED 1,500
  childSeatPerDay: 2_500, // PER_DAY, unit cap 25_000, max qty 3
  childSeatCap: 25_000,
  gpsPerRental: 5_000, // PER_RENTAL
  insurancePerDay: 4_000, // PER_DAY
  oneWayAtoB: 15_000,
  oneWayBtoA: 20_000,
};

export const WEBHOOK_SECRET = "qa-webhook-secret-0123456789";

const rand = () => randomUUID().replace(/-/g, "").toUpperCase();

/** Tiny valid files (magic bytes checked by the services). */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3]);
export const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%qa\n");

/** Fake payment provider with in-memory state; webhooks are captured, not delivered. */
export function installFakePayments(opts: { duplicateWebhooks?: number } = {}) {
  const sent: { body: string; signature: string | null }[] = [];
  const store = new MemoryFakePaymentStore();
  const provider = new FakePaymentProvider({
    store,
    webhookSecret: WEBHOOK_SECRET,
    webhookUrl: "http://qa.invalid/api/webhooks/payments",
    duplicateWebhooks: opts.duplicateWebhooks,
    fetch: async (_url, init) => {
      sent.push({ body: String(init?.body), signature: new Headers(init?.headers).get("fake-signature") });
      return new Response(null, { status: 200 });
    },
  });
  setPaymentProviderForTesting(provider);
  process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  return {
    provider,
    store,
    /** Webhooks the provider tried to send, oldest first. */
    sent,
    events: () => sent.map((s) => JSON.parse(s.body) as WebhookEvent),
    state: () => store.load(),
  };
}

export async function createUser(role: "customer" | "admin" = "customer"): Promise<Actor> {
  const email = `qa-${rand().slice(0, 10).toLowerCase()}@qa.test`;
  const [u] = await db.insert(users).values({ name: `QA ${role}`, email, role }).returning();
  return { id: u.id, email: u.email, name: u.name, role };
}

/** A customer with complete driver details and an uploaded licence (through the real services). */
export async function createDriver(): Promise<Actor & { profileId: string }> {
  const actor = await createUser("customer");
  await upsertDriverProfile(actor, {
    fullName: "QA Driver",
    phone: "+971 50 123 4567",
    dateOfBirth: "1990-05-05",
    nationality: "UAE",
    licenceNumber: "QA-LIC-001",
    licenceCountry: "UAE",
    licenceExpiresOn: "2036-01-01",
  });
  const profile = await uploadLicence(actor, { data: PNG_BYTES, contentType: "image/png" });
  return { ...actor, profileId: profile.id };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

/**
 * Two Dubai branches (A, B) with one-way fees both ways, a category (deposit 1,500 AED),
 * base + weekly pricing rules, `vehicleCount` vehicles at branch A, three extras,
 * two customers with complete driver profiles, and an admin.
 */
export async function createWorld(options: { vehicleCount?: number; deposit?: number } = {}) {
  const code = rand().slice(0, 7);
  const [branchA] = await db
    .insert(branches)
    .values({ code: `A${code}`, slug: `qa-a-${code.toLowerCase()}`, name: `QA A ${code}`, city: "Dubai", address: "1 QA Street", timezone: "Asia/Dubai" })
    .returning();
  const [branchB] = await db
    .insert(branches)
    .values({ code: `B${code}`, slug: `qa-b-${code.toLowerCase()}`, name: `QA B ${code}`, city: "Abu Dhabi", address: "2 QA Street", timezone: "Asia/Dubai" })
    .returning();
  await db.insert(oneWayFees).values([
    { fromBranchId: branchA.id, toBranchId: branchB.id, feeFils: PRICES.oneWayAtoB },
    { fromBranchId: branchB.id, toBranchId: branchA.id, feeFils: PRICES.oneWayBtoA },
  ]);
  const [category] = await db
    .insert(vehicleCategories)
    .values({ slug: `qa-${code.toLowerCase()}`, name: `QA Cat ${code}`, depositFils: options.deposit ?? PRICES.deposit })
    .returning();
  await db.insert(pricingRules).values([
    { name: `qa base ${code}`, categoryId: category.id, dailyRateFils: PRICES.dailyRate },
    { name: `qa weekly ${code}`, categoryId: category.id, dailyRateFils: PRICES.weeklyRate, minDays: 7 },
  ]);
  const vehicleRows = [];
  for (let i = 0; i < (options.vehicleCount ?? 1); i++) {
    const [v] = await db
      .insert(vehicles)
      .values({
        branchId: branchA.id,
        categoryId: category.id,
        make: "QA",
        model: `Car ${i}`,
        year: 2025,
        plateNumber: `QA ${code}${i}`,
        vin: vinFor(`${code}${i}`),
        transmission: i % 2 ? "MANUAL" : "AUTOMATIC",
        fuelType: i % 2 ? "DIESEL" : "PETROL",
        seats: i % 2 ? 7 : 5,
        mileageKm: 1_000,
      })
      .returning();
    vehicleRows.push(v);
  }
  const [childSeat] = await db
    .insert(extras)
    .values({ code: `QA_CS_${code}`, name: "Child seat", pricingType: "PER_DAY", priceFils: PRICES.childSeatPerDay, maxPriceFils: PRICES.childSeatCap, maxQuantity: 3 })
    .returning();
  const [gps] = await db
    .insert(extras)
    .values({ code: `QA_GPS_${code}`, name: "GPS", pricingType: "PER_RENTAL", priceFils: PRICES.gpsPerRental })
    .returning();
  const [insurance] = await db
    .insert(extras)
    .values({ code: `QA_FI_${code}`, name: "Full insurance", pricingType: "PER_DAY", priceFils: PRICES.insurancePerDay })
    .returning();
  const customer = await createDriver();
  const other = await createDriver();
  const admin = await createUser("admin");
  return { code, branchA, branchB, category, vehicles: vehicleRows, vehicle: vehicleRows[0], childSeat, gps, insurance, customer, other, admin };
}

/** A valid 17-char VIN (no I/O/Q) derived from a seed. */
export function vinFor(seed: string): string {
  const clean = seed.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "Z");
  return `QAV${clean}${"1234567890ABCDEFGH"}`.slice(0, 17);
}

/** Whole-hour UTC instant `days` (+hours) from now. */
export function future(days: number, hours = 0): Date {
  const d = new Date(Date.now() + days * DAY + hours * HOUR);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export const key = (label = "k") => `qa-${label}-${randomUUID()}`;

export function bookingInput(w: World, pickupAt: Date, returnAt: Date, more: Record<string, unknown> = {}) {
  return {
    vehicleId: w.vehicle.id,
    pickupBranchId: w.branchA.id,
    pickupAt,
    returnAt,
    extras: [] as { extraId: string; quantity: number }[],
    idempotencyKey: key("book"),
    ...more,
  };
}

/** Raw insert (bypasses services) for constraint tests. */
export async function insertReservationRaw(
  w: World,
  pickupAt: Date,
  returnAt: Date,
  status: "PENDING" | "CONFIRMED" | "PICKED_UP" | "RETURNED" | "CANCELLED" | "EXPIRED" | "REFUNDED" = "CONFIRMED",
  opts: { vehicleId?: string; holdExpiresAt?: Date } = {},
) {
  const [row] = await db
    .insert(reservations)
    .values({
      reference: `DE-${rand().replace(/[01IO]/g, "Z").slice(0, 6)}`,
      userId: w.customer.id,
      vehicleId: opts.vehicleId ?? w.vehicle.id,
      pickupBranchId: w.branchA.id,
      returnBranchId: w.branchA.id,
      pickupAt,
      returnAt,
      status,
      holdExpiresAt: status === "PENDING" ? (opts.holdExpiresAt ?? new Date(Date.now() + 15 * MIN)) : null,
      idempotencyKey: key("raw"),
      dailyRateFils: PRICES.dailyRate,
      rentalDays: 1,
      rentalFils: PRICES.dailyRate,
      extrasFils: 0,
      oneWayFeeFils: 0,
      vatRateBps: 500,
      taxFils: 1_000,
      totalFils: PRICES.dailyRate + 1_000,
      depositFils: PRICES.deposit,
    })
    .returning();
  return row;
}

export async function insertMaintenanceRaw(vehicleId: string, startsAt: Date, endsAt: Date) {
  const [row] = await db.insert(maintenanceBlocks).values({ vehicleId, startsAt, endsAt, reason: "QA block" }).returning();
  return row;
}

export async function reservationRow(id: string) {
  const [row] = await db.select().from(reservations).where(eq(reservations.id, id));
  return row;
}
