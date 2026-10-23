// AUTH-* (route level) and AZ-*: owner-or-admin reads, admin-only services, private files.
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, reservations, users } from "@/db/schema";
import { GET as licenceGet } from "@/app/api/files/licences/[profileId]/route";
import { GET as damageGet } from "@/app/api/files/damage/[reportId]/[index]/route";
import { GET as publicGet } from "@/app/api/files/public/[...key]/route";
import type { Actor } from "@/lib/auth/types";
import { getDriverProfileForUser, uploadLicence, upsertDriverProfile } from "@/lib/drivers";
import * as fleet from "@/lib/fleet/admin";
import * as pricingAdmin from "@/lib/pricing/admin";
import * as res from "@/lib/reservations";
import { query } from "../support/db";
import { getSessionJson, getWithCookie, signIn, signOut, signUp } from "../support/http";
import { bookingInput, createWorld, future, HOUR, installFakePayments, key, PNG_BYTES, reservationRow, vinFor, type World } from "../support/fixtures";

beforeAll(() => {
  installFakePayments();
});

async function sessionActor(role: "customer" | "admin" = "customer") {
  const s = await signUp();
  expect(s.status).toBe(200);
  if (role === "admin") {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, s.userId));
  }
  const actor: Actor = { id: s.userId, email: s.email, name: "QA Http", role };
  return { ...s, actor };
}

async function withLicence(actor: Actor) {
  await upsertDriverProfile(actor, {
    fullName: "QA Owner", phone: "+971501112233", dateOfBirth: "1988-01-01", nationality: "UAE",
    licenceNumber: "QA-9999", licenceCountry: "UAE", licenceExpiresOn: "2035-12-31",
  });
  return uploadLicence(actor, { data: PNG_BYTES, contentType: "image/png" });
}

const licenceCall = (profileId: string, cookie?: string) =>
  licenceGet(getWithCookie(`/api/files/licences/${profileId}`, cookie), { params: Promise.resolve({ profileId }) });
const damageCall = (reportId: string, index: string, cookie?: string) =>
  damageGet(getWithCookie(`/api/files/damage/${reportId}/${index}`, cookie), { params: Promise.resolve({ reportId, index }) });

describe("AUTH (Better Auth route handler)", () => {
  it("AUTH-01/04/06 sign-up gives a session; sign-in works; sign-out kills the session cookie", async () => {
    const s = await signUp();
    expect(s.status).toBe(200);
    expect(s.cookie).toMatch(/driveeasy/);
    expect((await getSessionJson(s.cookie))?.user?.email).toBe(s.email);
    const again = await signIn(s.email, s.password);
    expect(again.status).toBe(200);
    expect((await signOut(again.cookie)).status).toBe(200);
    expect(await getSessionJson(again.cookie)).toBeNull();
    // The first session is still valid until it is signed out separately.
    expect((await getSessionJson(s.cookie))?.user?.id).toBe(s.userId);
  });

  it("AUTH-02 duplicate email is refused; AUTH-03 short password and bad email are refused", async () => {
    const s = await signUp();
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const { authRequest } = await import("../support/http");
    const dup = await POST(authRequest("/sign-up/email", { body: { name: "Dup", email: s.email, password: "Another-Pass1" } }));
    expect(dup.status).toBeGreaterThanOrEqual(400);
    const short = await POST(authRequest("/sign-up/email", { body: { name: "Short", email: `qa-short-${key()}@qa.test`, password: "short" } }));
    expect(short.status).toBe(400);
    const bad = await POST(authRequest("/sign-up/email", { body: { name: "Bad", email: "not-an-email", password: "Long-enough-1" } }));
    expect(bad.status).toBe(400);
    const rows = await db.select().from(users).where(eq(users.email, s.email));
    expect(rows).toHaveLength(1);
  });

  it("AUTH-05 wrong password and unknown email fail with the same generic answer", async () => {
    const s = await signUp();
    const wrong = await signIn(s.email, "Wrong-password-1");
    const unknown = await signIn(`qa-nobody-${key()}@qa.test`, "Wrong-password-1");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(JSON.stringify(wrong.json)).toBe(JSON.stringify(unknown.json));
    expect(wrong.cookie).not.toMatch(/session_token=[^;]+/);
  });

  it("AUTH-08 the role cannot be set at sign-up (mass assignment)", async () => {
    const s = await signUp({ role: "admin" });
    if (s.status === 200) {
      const [u] = await db.select().from(users).where(eq(users.email, s.email));
      expect(u.role).toBe("customer");
    } else {
      expect(s.status).toBe(400);
    }
  });

  it("AUTH-09 the session cookie is HttpOnly and SameSite=Lax", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const { authRequest } = await import("../support/http");
    const r = await POST(authRequest("/sign-up/email", { body: { name: "Ck", email: `qa-ck-${key()}@qa.test`, password: "Long-enough-1" } }));
    const cookie = r.headers.getSetCookie().find((c) => /session_token/.test(c))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("AUTH-10 emails are stored lower-case (sign-up with mixed case, sign in with lower case)", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const { authRequest } = await import("../support/http");
    const email = `QA-Mixed-${key().slice(-6)}@QA.test`;
    const r = await POST(authRequest("/sign-up/email", { body: { name: "Mixed", email, password: "Long-enough-1" } }));
    expect(r.status).toBe(200);
    expect((await signIn(email.toLowerCase(), "Long-enough-1")).status).toBe(200);
  });
});

describe("AZ: private files", () => {
  it("AZ-02/03 licence file: owner and admin get it (private, no-store); another user and anonymous get 401/404", async () => {
    const owner = await sessionActor();
    const other = await sessionActor();
    const admin = await sessionActor("admin");
    const profile = await withLicence(owner.actor);
    expect(profile.licenceFileUrl).toBe(`/api/files/licences/${profile.id}`);
    const mine = await licenceCall(profile.id, owner.cookie);
    expect(mine.status).toBe(200);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG_BYTES);
    expect(mine.headers.get("cache-control")).toBe("private, no-store");
    expect(mine.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await licenceCall(profile.id, admin.cookie)).status).toBe(200);
    expect((await licenceCall(profile.id, other.cookie)).status).toBe(404);
    expect((await licenceCall(profile.id)).status).toBe(401);
    expect((await licenceCall("not-a-uuid", owner.cookie)).status).toBe(404);
    // Admin viewing is audited.
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, profile.id));
    expect(audits.some((a) => a.action === "driver_profile.licence_viewed" && a.actorId === admin.userId)).toBe(true);
  });

  it("AZ-04 private keys are never served by the public route; the storage key is not exposed", async () => {
    const owner = await sessionActor();
    const profile = await withLicence(owner.actor);
    const [row] = await query<{ licence_file_key: string }>("SELECT licence_file_key FROM driver_profiles WHERE id = $1", [profile.id]);
    expect(row.licence_file_key).toMatch(/^private\//);
    expect(JSON.stringify(profile)).not.toContain(row.licence_file_key);
    const parts = row.licence_file_key.split("/");
    for (const keyParts of [parts, ["..", ...parts], parts.slice(1)]) {
      const r = await publicGet(getWithCookie(`/api/files/public/${keyParts.join("/")}`, owner.cookie), { params: Promise.resolve({ key: keyParts }) });
      expect(r.status).toBe(404);
    }
  });

  it("AZ-05 damage images: admin only (the renter and anonymous users cannot read them)", async () => {
    const w = await createWorld();
    const renter = await sessionActor();
    const admin = await sessionActor("admin");
    const report = await res.createDamageReport(admin.actor, {
      vehicleId: w.vehicle.id, stage: "RETURN", severity: "MINOR", location: "Front bumper", description: "Scratch on bumper",
    });
    const withImage = await res.addDamageImage(admin.actor, report.id, { data: PNG_BYTES, contentType: "image/png" });
    expect(withImage.imageUrls).toEqual([`/api/files/damage/${report.id}/0`]);
    expect((await damageCall(report.id, "0", admin.cookie)).status).toBe(200);
    expect((await damageCall(report.id, "0", renter.cookie)).status).toBe(404);
    expect((await damageCall(report.id, "0")).status).toBe(401);
    expect((await damageCall(report.id, "1", admin.cookie)).status).toBe(404);
    expect((await damageCall(report.id, "../0", admin.cookie)).status).toBe(404);
  });

  it("FLOW-07 uploads: wrong type, mislabeled content, empty and oversize files are rejected", async () => {
    const owner = await sessionActor();
    await withLicence(owner.actor);
    const bad = [
      { data: PNG_BYTES, contentType: "image/gif" },
      { data: new TextEncoder().encode("<svg/>"), contentType: "image/png" },
      { data: new Uint8Array(), contentType: "image/png" },
    ];
    for (const f of bad) await expect(uploadLicence(owner.actor, f)).rejects.toMatchObject({ code: "VALIDATION" });
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(PNG_BYTES);
    await expect(uploadLicence(owner.actor, { data: big, contentType: "image/png" })).rejects.toMatchObject({ code: "VALIDATION" });
    const fresh = await sessionActor();
    await expect(uploadLicence(fresh.actor, { data: PNG_BYTES, contentType: "image/png" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("driver profiles: under-21 and expired licences are refused; another user's profile is FORBIDDEN", async () => {
    const a = await sessionActor();
    const b = await sessionActor();
    const base = { fullName: "QA", phone: "+971501112233", nationality: "UAE", licenceNumber: "QA-1", licenceCountry: "UAE" };
    const young = new Date();
    young.setUTCFullYear(young.getUTCFullYear() - 20);
    await expect(upsertDriverProfile(a.actor, { ...base, dateOfBirth: young.toISOString().slice(0, 10), licenceExpiresOn: "2035-01-01" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(upsertDriverProfile(a.actor, { ...base, dateOfBirth: "1990-01-01", licenceExpiresOn: "2020-01-01" })).rejects.toMatchObject({ code: "VALIDATION" });
    await withLicence(a.actor);
    await expect(getDriverProfileForUser(b.actor, a.userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const admin = await sessionActor("admin");
    expect((await getDriverProfileForUser(admin.actor, a.userId))?.userId).toBe(a.userId);
  });
});

describe("AZ: reservations belong to their owner", () => {
  let w: World;
  let mine: Awaited<ReturnType<typeof res.createReservation>>;
  beforeAll(async () => {
    w = await createWorld();
    const p = future(10);
    mine = await res.createReservation(w.customer, bookingInput(w, p, new Date(p.getTime() + 24 * HOUR)));
    await res.payReservation(w.customer, { reservationId: mine.id, paymentMethod: "fake_success", idempotencyKey: key("pay") });
  });

  it("AZ-01 another customer gets NOT_FOUND by id and by reference; lists only show own reservations", async () => {
    await expect(res.getReservation(w.other, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(res.getReservation(w.other, mine.reference)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(res.getVoucher(w.other, mine.reference)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await res.listMyReservations(w.other)).map((r) => r.id)).not.toContain(mine.id);
    expect((await res.listMyReservations(w.customer)).map((r) => r.id)).toContain(mine.id);
    expect((await res.getReservation(w.admin, mine.reference)).id).toBe(mine.id);
    // A nonexistent reference looks exactly the same as someone else's.
    await expect(res.getReservation(w.other, "DE-ZZZZZZ")).rejects.toMatchObject({ code: "NOT_FOUND", message: "Reservation not found." });
  });

  it("AZ-07 every admin-only service refuses a customer with FORBIDDEN and changes nothing", async () => {
    const c = w.customer;
    const auditsBefore = (await db.select().from(auditLogs)).length;
    const id = "00000000-0000-4000-8000-0000000000aa";
    const calls: [string, () => Promise<unknown>][] = [
      ["createBranch", () => fleet.createBranch(c, { code: "QAX1", slug: "qa-x1", name: "X branch", city: "Dubai", address: "Somewhere 1" })],
      ["updateBranch", () => fleet.updateBranch(c, w.branchA.id, { name: "Hacked" })],
      ["deleteBranch", () => fleet.deleteBranch(c, w.branchB.id)],
      ["createCategory", () => fleet.createCategory(c, { slug: "qa-hack", name: "Hack" } as never)],
      ["updateCategory", () => fleet.updateCategory(c, w.category.id, { name: "Hacked" })],
      ["createFeature", () => fleet.createFeature(c, { slug: "qa-hack", name: "Hack" })],
      ["listFleet", () => fleet.listFleet(c)],
      ["getFleetVehicle", () => fleet.getFleetVehicle(c, w.vehicle.id)],
      ["createVehicle", () => fleet.createVehicle(c, { branchId: w.branchA.id, categoryId: w.category.id, make: "X", model: "Y", year: 2024, plateNumber: "QA HACK", vin: vinFor("HACK1"), transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5 } as never)],
      ["updateVehicle", () => fleet.updateVehicle(c, w.vehicle.id, { status: "RETIRED" })],
      ["addVehiclePhoto", () => fleet.addVehiclePhoto(c, w.vehicle.id, { data: PNG_BYTES, contentType: "image/png" })],
      ["removeVehiclePhoto", () => fleet.removeVehiclePhoto(c, w.vehicle.id, 0)],
      ["createExtra", () => fleet.createExtra(c, { code: "QA_HACK", name: "Hack", pricingType: "PER_RENTAL", priceFils: 1 } as never)],
      ["updateExtra", () => fleet.updateExtra(c, w.gps.id, { priceFils: 1 })],
      ["listMaintenanceBlocks", () => fleet.listMaintenanceBlocks(c)],
      ["createMaintenanceBlock", () => fleet.createMaintenanceBlock(c, { vehicleId: w.vehicle.id, startsAt: future(100), endsAt: future(101), reason: "hack" })],
      ["deleteMaintenanceBlock", () => fleet.deleteMaintenanceBlock(c, id)],
      ["listPricingRules", () => pricingAdmin.listPricingRules(c)],
      ["createPricingRule", () => pricingAdmin.createPricingRule(c, { name: "hack", categoryId: w.category.id, dailyRateFils: 1 } as never)],
      ["updatePricingRule", () => pricingAdmin.updatePricingRule(c, id, { dailyRateFils: 1 })],
      ["deletePricingRule", () => pricingAdmin.deletePricingRule(c, id)],
      ["listOneWayFees", () => pricingAdmin.listOneWayFees(c)],
      ["upsertOneWayFee", () => pricingAdmin.upsertOneWayFee(c, { fromBranchId: w.branchA.id, toBranchId: w.branchB.id, feeFils: 0 })],
      ["deleteOneWayFee", () => pricingAdmin.deleteOneWayFee(c, id)],
      ["listReservations", () => res.listReservations(c)],
      ["verifyVoucherPayload", () => res.verifyVoucherPayload(c, "DE1.DE-AAAAAA.AAAAAAAAAAAAAAAAAAAAAA")],
      ["checkOutReservation", () => res.checkOutReservation(c, { reservationId: mine.id, mileageKm: 1_000, fuelLevel: 8 })],
      ["checkInReservation", () => res.checkInReservation(c, { reservationId: mine.id, mileageKm: 1_000, fuelLevel: 8 })],
      ["settleReturnedDeposit", () => res.settleReturnedDeposit(c, mine.id)],
      ["createDamageReport", () => res.createDamageReport(c, { vehicleId: w.vehicle.id, stage: "OTHER", severity: "MINOR", location: "Roof", description: "hack attempt" })],
      ["addDamageImage", () => res.addDamageImage(c, id, { data: PNG_BYTES, contentType: "image/png" })],
      ["updateDamageReport", () => res.updateDamageReport(c, { reportId: id, resolved: true })],
      ["listDamageReports", () => res.listDamageReports(c)],
      ["getDamageReport", () => res.getDamageReport(c, id)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await db.select().from(auditLogs)).length).toBe(auditsBefore);
    expect((await reservationRow(mine.id)).status).toBe("CONFIRMED");
    const [branch] = await query<{ name: string }>("SELECT name FROM branches WHERE id = $1", [w.branchA.id]);
    expect(branch.name).not.toBe("Hacked");
  });

  it("AZ-09/11/14 admin fleet CRUD works, duplicates get friendly errors, and every change is audited", async () => {
    const a = w.admin;
    const code = key().slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, "X");
    const branch = await fleet.createBranch(a, { code: `Q${code}`, slug: `qa-new-${code.toLowerCase()}`, name: "QA New", city: "Dubai", address: "New street 1", timezone: "Asia/Dubai" });
    await expect(fleet.createBranch(a, { code: `Q${code}`, slug: `qa-new2-${code.toLowerCase()}`, name: "QA New2", city: "Dubai", address: "New street 2" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(fleet.createBranch(a, { code: "QAZ9", slug: "qa-bad-tz", name: "Bad tz", city: "Dubai", address: "Street 3", timezone: "Mars/Olympus" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const v = await fleet.createVehicle(a, {
      branchId: branch.id, categoryId: w.category.id, make: "QA", model: "New", year: 2025, plateNumber: `QN ${code}`, vin: vinFor(`N${code}`),
      transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5,
    });
    await expect(
      fleet.createVehicle(a, { branchId: branch.id, categoryId: w.category.id, make: "QA", model: "Dup", year: 2025, plateNumber: `QN ${code}`, vin: vinFor(`M${code}`), transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      fleet.createVehicle(a, { branchId: branch.id, categoryId: w.category.id, make: "QA", model: "Dup", year: 2025, plateNumber: `QM ${code}`, vin: vinFor(`N${code}`), transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await fleet.updateVehicle(a, v.id, { status: "RETIRED" });
    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.actorId, a.id))).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["branch.created", "vehicle.created", "vehicle.updated"]));
  });

  it("AZ-10 a price change affects new quotes but never an existing reservation", async () => {
    const x = await createWorld();
    const p = future(10);
    const before = await res.createReservation(x.customer, bookingInput(x, p, new Date(p.getTime() + 24 * HOUR)));
    const rule = await pricingAdmin.createPricingRule(x.admin, { name: "QA promo", categoryId: x.category.id, dailyRateFils: 30_000, priority: 10 } as never);
    expect(rule).toBeTruthy();
    const { getQuote } = await import("@/lib/pricing/quote");
    const q = await getQuote({ vehicleId: x.vehicle.id, pickupBranchId: x.branchA.id, pickupAt: future(20), returnAt: future(21), extras: [] });
    expect(q.dailyRateFils).toBe(30_000);
    expect((await reservationRow(before.id)).dailyRateFils).toBe(20_000);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.actorId, x.admin.id))).some((a) => a.action.startsWith("pricing_rule."))).toBe(true);
  });

  it("AZ-12 admin maintenance over a booking is refused with VEHICLE_UNAVAILABLE", async () => {
    const r = await reservationRow(mine.id);
    await expect(
      fleet.createMaintenanceBlock(w.admin, { vehicleId: w.vehicle.id, startsAt: new Date(r.pickupAt.getTime() + HOUR), endsAt: new Date(r.returnAt.getTime() + HOUR), reason: "Service" }),
    ).rejects.toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    const ok = await fleet.createMaintenanceBlock(w.admin, { vehicleId: w.vehicle.id, startsAt: r.returnAt, endsAt: new Date(r.returnAt.getTime() + 4 * HOUR), reason: "Service" });
    expect(ok.id).toBeTruthy();
  });

  it("AZ-13 admin reservation list filters by status and free text", async () => {
    const list = await res.listReservations(w.admin, { q: mine.reference });
    expect(list.items.map((i) => i.id)).toEqual([mine.id]);
    const byStatus = await res.listReservations(w.admin, { status: "CONFIRMED", vehicleId: w.vehicle.id });
    expect(byStatus.items.every((i) => i.status === "CONFIRMED")).toBe(true);
    expect(byStatus.total).toBeGreaterThanOrEqual(1);
    const nothing = await res.listReservations(w.admin, { q: "%" });
    expect(nothing.items.every((i) => [i.reference, i.customer.email, i.customer.name].some((s) => String(s).includes("%")))).toBe(true);
  });

  it("AZ-14 reservation state changes write audit rows", async () => {
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, mine.id));
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["reservation.created", "reservation.confirmed"]));
    const [r] = await db.select().from(reservations).where(eq(reservations.id, mine.id));
    expect(r.status).toBe("CONFIRMED");
  });
});
