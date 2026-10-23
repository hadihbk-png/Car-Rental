// Test-data driver for browser specs: performs domain operations against driveeasy_qa through
// the real services (same fake-payment state file and uploads folder as the QA web server).
// Usage: node --conditions=react-server --import tsx e2e/support/scenario.mts '<json>'
// Prints one JSON line with the result. Never point this at anything but the QA database.
import { eq, sql } from "drizzle-orm";

const qaUrl = process.env.QA_DATABASE_URL ?? "";
if (!/_qa$/.test(new URL(qaUrl).pathname)) throw new Error("scenario.mts only runs against the QA database");
process.env.DATABASE_URL = qaUrl;
process.env.DATABASE_URL_UNPOOLED = qaUrl;
process.env.PAYMENT_PROVIDER = "fake";
process.env.FAKE_PAYMENTS_STATE_FILE = ".local/qa-fake-payments.json";
process.env.FAKE_PAYMENTS_WEBHOOK_URL = process.env.SCENARIO_WEBHOOK_URL ?? "";
process.env.UPLOADS_DIR = "storage/qa-uploads";
process.env.STORAGE_DRIVER = "local";
process.env.LOG_LEVEL ??= "error";

const { db, pool } = await import("../../src/db");
const { users, vehicles, branches, reservations } = await import("../../src/db/schema");
const res = await import("../../src/lib/reservations");
const drivers = await import("../../src/lib/drivers");
const { getPaymentProvider } = await import("../../src/lib/payments");

type Op =
  | { op: "promote"; email: string }
  | { op: "driver"; email: string }
  | { op: "book"; email: string; vehicleId?: string; branchCode?: string; pickupInHours: number; hours: number; pay?: "fake_success" | "fake_pending" | "none" }
  | { op: "checkout"; reference: string; mileageKm?: number; fuelLevel?: number; nowOffsetHours?: number }
  | { op: "checkin"; reference: string; mileageKm: number; fuelLevel: number; nowOffsetHours?: number; damageChargeFils?: number }
  | { op: "completePending"; reference: string }
  | { op: "reservation"; reference: string };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3]);

async function actorByEmail(email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!u) throw new Error(`no user ${email}`);
  return { id: u.id, email: u.email, name: u.name, role: (u.role === "admin" ? "admin" : "customer") as "admin" | "customer" };
}
async function admin() {
  const [u] = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
  return { id: u.id, email: u.email, name: u.name, role: "admin" as const };
}
async function ensureDriver(email: string) {
  const actor = await actorByEmail(email);
  const existing = await drivers.getMyDriverProfile(actor);
  if (!existing?.complete) {
    await drivers.upsertDriverProfile(actor, {
      fullName: actor.name || "QA Driver", phone: "+971501234567", dateOfBirth: "1990-01-01", nationality: "UAE",
      licenceNumber: "QA-E2E-1", licenceCountry: "UAE", licenceExpiresOn: "2036-01-01",
    });
    await drivers.uploadLicence(actor, { data: PNG, contentType: "image/png" });
  }
  return { actor, profile: await drivers.getMyDriverProfile(actor) };
}

const input = JSON.parse(process.argv[2] ?? "{}") as Op;
let out: unknown;
try {
  switch (input.op) {
    case "promote": {
      await db.update(users).set({ role: "admin" }).where(eq(users.email, input.email.toLowerCase()));
      out = { ok: true };
      break;
    }
    case "driver": {
      const { profile } = await ensureDriver(input.email);
      out = { profileId: profile!.id, licenceFileUrl: profile!.licenceFileUrl };
      break;
    }
    case "book": {
      const { actor } = await ensureDriver(input.email);
      let vehicleId = input.vehicleId;
      let branchId: string;
      if (vehicleId) {
        branchId = (await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)))[0].branchId;
      } else {
        const [b] = await db.select().from(branches).where(eq(branches.code, input.branchCode ?? "DXBAPT"));
        branchId = b.id;
      }
      const pickupAt = new Date(Math.ceil((Date.now() + input.pickupInHours * 3_600_000) / 3_600_000) * 3_600_000);
      const returnAt = new Date(pickupAt.getTime() + input.hours * 3_600_000);
      if (!vehicleId) {
        // A car at the branch that is free for the period.
        const free = await db.execute<{ id: string }>(sql`
          SELECT v.id FROM vehicles v WHERE v.branch_id = ${branchId} AND v.status IN ('AVAILABLE','RESERVED','ON_RENT')
            AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.vehicle_id = v.id AND r.status IN ('PENDING','CONFIRMED','PICKED_UP')
                 AND r.period && tstzrange(${pickupAt}::timestamptz, ${returnAt}::timestamptz, '[)'))
            AND NOT EXISTS (SELECT 1 FROM maintenance_blocks m WHERE m.vehicle_id = v.id
                 AND m.period && tstzrange(${pickupAt}::timestamptz, ${returnAt}::timestamptz, '[)'))
          ORDER BY random() LIMIT 1`);
        vehicleId = free.rows[0].id;
      }
      let v = await res.createReservation(actor, {
        vehicleId, pickupBranchId: branchId, pickupAt, returnAt, extras: [], idempotencyKey: `e2e-${crypto.randomUUID()}`,
      });
      if (input.pay && input.pay !== "none") {
        v = await res.payReservation(actor, { reservationId: v.id, paymentMethod: input.pay, idempotencyKey: `e2e-pay-${crypto.randomUUID()}` });
      }
      out = { id: v.id, reference: v.reference, vehicleId, status: v.status, pickupAt, returnAt, totalFils: v.price.totalFils };
      break;
    }
    case "checkout": {
      const r = (await db.select().from(reservations).where(eq(reservations.reference, input.reference)))[0];
      const [veh] = await db.select().from(vehicles).where(eq(vehicles.id, r.vehicleId));
      const now = new Date(Date.now() + (input.nowOffsetHours ?? 0) * 3_600_000);
      const v = await res.checkOutReservation(await admin(), { reservationId: input.reference, mileageKm: input.mileageKm ?? veh.mileageKm, fuelLevel: input.fuelLevel ?? 8 }, now);
      out = { status: v.status };
      break;
    }
    case "checkin": {
      const now = new Date(Date.now() + (input.nowOffsetHours ?? 0) * 3_600_000);
      const v = await res.checkInReservation(await admin(), { reservationId: input.reference, mileageKm: input.mileageKm, fuelLevel: input.fuelLevel, damageChargeFils: input.damageChargeFils ?? 0 }, now);
      out = { status: v.status, charges: v.charges };
      break;
    }
    case "completePending": {
      // Simulates the provider finishing a pending charge; returns the event body for the spec to deliver.
      const r = (await db.select().from(reservations).where(eq(reservations.reference, input.reference)))[0];
      const { JsonFileFakePaymentStore } = await import("../../src/lib/payments/fake-store");
      const store = new JsonFileFakePaymentStore(".local/qa-fake-payments.json");
      const state = await store.load();
      const p = Object.values(state.payments).find((x) => x.metadata.reservationId === r.id && x.status === "pending");
      if (!p) throw new Error("no pending payment");
      p.status = "succeeded";
      await store.save(state);
      out = { payment: p };
      void getPaymentProvider;
      break;
    }
    case "reservation": {
      const [r] = await db.select().from(reservations).where(eq(reservations.reference, input.reference));
      out = r;
      break;
    }
  }
  console.log(JSON.stringify({ ok: true, result: out }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err instanceof Error ? `${(err as { code?: string }).code ?? ""} ${err.message}` : String(err) }));
} finally {
  await pool.end();
}
