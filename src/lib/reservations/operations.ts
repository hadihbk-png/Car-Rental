import "server-only";
import { and, asc, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { damageReports, deposits, rentalAgreements, reservations, users, vehicles } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/types";
import { assertDriverReady } from "@/lib/drivers";
import { DomainError } from "@/lib/errors";
import { log } from "@/lib/log";
import { getPaymentProvider } from "@/lib/payments";
import { returnCharges, type ReturnCharges } from "@/lib/pricing/calc";
import { parseInput, zFils, zId, zInstant } from "@/lib/validation";
import { applyProviderDeposit, releaseDepositRow } from "./money";
import { buildReservationView, buildReservationViews, loadReservationRow, type ReservationView } from "./view";

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new DomainError("FORBIDDEN", "Administrator access required.");
}

export const listReservationsSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"]).optional(),
  branchId: zId.optional(),
  vehicleId: zId.optional(),
  /** Pick-up time window. */
  pickupFrom: zInstant.optional(),
  pickupTo: zInstant.optional(),
  /** Reference, customer email/name or plate. */
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["pickup_asc", "pickup_desc", "created_desc"]).default("pickup_asc"),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Admin: reservations list with filters. */
export async function listReservations(
  actor: Actor,
  input: z.input<typeof listReservationsSchema> = {},
  now: Date = new Date(),
): Promise<{ total: number; items: ReservationView[] }> {
  assertAdmin(actor);
  const f = parseInput(listReservationsSchema, input);
  const where: SQL[] = [];
  if (f.status) where.push(eq(reservations.status, f.status));
  if (f.branchId) where.push(or(eq(reservations.pickupBranchId, f.branchId), eq(reservations.returnBranchId, f.branchId))!);
  if (f.vehicleId) where.push(eq(reservations.vehicleId, f.vehicleId));
  if (f.pickupFrom) where.push(gte(reservations.pickupAt, f.pickupFrom));
  if (f.pickupTo) where.push(lt(reservations.pickupAt, f.pickupTo));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      or(
        ilike(reservations.reference, like),
        ilike(users.email, like),
        ilike(users.name, like),
        ilike(vehicles.plateNumber, like),
      )!,
    );
  }
  const cond = where.length ? and(...where) : undefined;
  const order =
    f.sort === "pickup_desc" ? desc(reservations.pickupAt) : f.sort === "created_desc" ? desc(reservations.createdAt) : asc(reservations.pickupAt);
  const base = db
    .select({ r: reservations })
    .from(reservations)
    .innerJoin(users, eq(users.id, reservations.userId))
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .where(cond);
  const rows = await base.orderBy(order).limit(f.limit).offset(f.offset);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(reservations)
    .innerJoin(users, eq(users.id, reservations.userId))
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .where(cond);
  return { total, items: await buildReservationViews(rows.map((x) => x.r), now) };
}

/** Check-out may start this long before the scheduled pick-up. */
const EARLY_CHECKOUT_MS = 24 * 3600_000;

export const checkOutSchema = z.object({
  reservationId: z.string().min(1).max(64), // id or reference
  mileageKm: z.number().int().min(0).max(2_000_000),
  /** Eighths of a tank: 0 = empty ... 8 = full. */
  fuelLevel: z.number().int().min(0).max(8),
  notes: z.string().trim().max(2000).optional(),
});

/** Admin: hand the car over. Creates the rental agreement; reservation PICKED_UP, vehicle ON_RENT. */
export async function checkOutReservation(
  actor: Actor,
  input: z.input<typeof checkOutSchema>,
  now: Date = new Date(),
): Promise<ReservationView> {
  assertAdmin(actor);
  const data = parseInput(checkOutSchema, input);
  const id = await db.transaction(async (tx) => {
    const r = await loadReservationRow(tx, data.reservationId, true);
    if (r.status !== "CONFIRMED") throw new DomainError("INVALID_STATE", `Cannot check out a ${r.status.toLowerCase()} reservation.`);
    if (now.getTime() < r.pickupAt.getTime() - EARLY_CHECKOUT_MS) {
      throw new DomainError("POLICY_VIOLATION", "Too early: check-out opens 24 hours before pick-up.");
    }
    if (now >= r.returnAt) throw new DomainError("POLICY_VIOLATION", "The rental period has already ended.");
    await assertDriverReady(tx, r.userId, r.returnAt, now);
    if (r.depositFils > 0) {
      const [held] = await tx.select({ id: deposits.id }).from(deposits).where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "held")));
      if (!held) throw new DomainError("POLICY_VIOLATION", "No security deposit is held for this reservation.");
    }
    const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, r.vehicleId)).for("update");
    if (data.mileageKm < v.mileageKm) {
      throw new DomainError("VALIDATION", `Mileage cannot be below the recorded ${v.mileageKm} km.`, { mileageKm: ["Too low"] });
    }
    await tx.insert(rentalAgreements).values({
      reservationId: r.id,
      vehicleId: r.vehicleId,
      checkedOutAt: now,
      checkedOutBy: actor.id,
      pickupMileageKm: data.mileageKm,
      pickupFuelLevel: data.fuelLevel,
      pickupNotes: data.notes ?? null,
    });
    await tx.update(reservations).set({ status: "PICKED_UP", updatedAt: now }).where(eq(reservations.id, r.id));
    await tx.update(vehicles).set({ status: "ON_RENT", mileageKm: data.mileageKm }).where(eq(vehicles.id, v.id));
    await audit(
      { actor, action: "reservation.checked_out", entityType: "reservation", entityId: r.id, data: { mileageKm: data.mileageKm, fuelLevel: data.fuelLevel } },
      tx,
    );
    return r.id;
  });
  return buildReservationView(await loadReservationRow(db, id), now);
}

export const checkInSchema = z.object({
  reservationId: z.string().min(1).max(64),
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelLevel: z.number().int().min(0).max(8),
  /** Defaults to now. */
  returnedAt: zInstant.optional(),
  /** Defaults to the booked return branch. */
  returnBranchId: zId.optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Net damage charge (VAT added) to take from the deposit. */
  damageChargeFils: zFils.default(0),
  /** Vehicle status after return: AVAILABLE (default) or MAINTENANCE (e.g. damaged). */
  vehicleStatus: z.enum(["AVAILABLE", "MAINTENANCE"]).default("AVAILABLE"),
});

export type CheckInResult = ReservationView & { charges: ReturnCharges };

/**
 * Admin: take the car back. Records mileage/fuel, computes late (59-minute grace per day), fuel
 * and damage charges (+VAT), captures them from the deposit (the remainder is released by the
 * provider) or releases the deposit in full when there is nothing to charge.
 */
export async function checkInReservation(
  actor: Actor,
  input: z.input<typeof checkInSchema>,
  now: Date = new Date(),
): Promise<CheckInResult> {
  assertAdmin(actor);
  const data = parseInput(checkInSchema, input);
  const returnedAt = data.returnedAt ?? now;
  if (returnedAt.getTime() > now.getTime() + 60_000) throw new DomainError("VALIDATION", "Return time cannot be in the future.");

  const { reservationId, charges } = await db.transaction(async (tx) => {
    const r = await loadReservationRow(tx, data.reservationId, true);
    if (r.status !== "PICKED_UP") throw new DomainError("INVALID_STATE", `Cannot check in a ${r.status.toLowerCase()} reservation.`);
    const [ag] = await tx.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id)).for("update");
    if (!ag) throw new DomainError("INVALID_STATE", "No rental agreement found.");
    if (data.mileageKm < ag.pickupMileageKm) {
      throw new DomainError("VALIDATION", `Mileage cannot be below the pick-up reading (${ag.pickupMileageKm} km).`, { mileageKm: ["Too low"] });
    }
    if (returnedAt < ag.checkedOutAt) throw new DomainError("VALIDATION", "Return time is before check-out.");
    const [dep] = await tx.select().from(deposits).where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "held")));
    const charges = returnCharges({
      scheduledReturnAt: r.returnAt,
      actualReturnAt: returnedAt,
      dailyRateFils: r.dailyRateFils,
      pickupFuelLevel: ag.pickupFuelLevel,
      returnFuelLevel: data.fuelLevel,
      damageChargeFils: data.damageChargeFils,
      depositFils: dep?.amountFils ?? 0,
      vatRateBps: r.vatRateBps,
    });
    await tx
      .update(rentalAgreements)
      .set({
        checkedInAt: returnedAt,
        checkedInBy: actor.id,
        returnBranchId: data.returnBranchId ?? r.returnBranchId,
        returnMileageKm: data.mileageKm,
        returnFuelLevel: data.fuelLevel,
        returnNotes: data.notes ?? null,
        lateDays: charges.lateDays,
        lateFeeFils: charges.lateFeeFils,
        fuelChargeFils: charges.fuelChargeFils,
        damageChargeFils: charges.damageChargeFils,
        chargesTaxFils: charges.taxFils,
        depositCapturedFils: charges.depositCaptureFils,
        amountDueFils: charges.amountDueFils,
      })
      .where(eq(rentalAgreements.id, ag.id));
    await tx.update(reservations).set({ status: "RETURNED", updatedAt: now }).where(eq(reservations.id, r.id));
    await tx.update(vehicles).set({ status: data.vehicleStatus, mileageKm: data.mileageKm }).where(eq(vehicles.id, r.vehicleId));
    // Link damage reports filed during this rental to the agreement.
    await tx.update(damageReports).set({ rentalAgreementId: ag.id }).where(eq(damageReports.reservationId, r.id));
    await audit(
      {
        actor,
        action: "reservation.checked_in",
        entityType: "reservation",
        entityId: r.id,
        data: { mileageKm: data.mileageKm, fuelLevel: data.fuelLevel, returnedAt, ...charges },
      },
      tx,
    );
    return { reservationId: r.id, charges };
  });

  // Settle the deposit after commit (provider call).
  const [dep] = await db.select().from(deposits).where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "held")));
  if (dep?.providerHoldId) {
    try {
      if (charges.depositCaptureFils > 0) {
        const h = await getPaymentProvider().captureDeposit(dep.providerHoldId, charges.depositCaptureFils);
        await applyProviderDeposit(db, h, dep.id);
      } else {
        await releaseDepositRow(dep);
      }
      await audit({
        actor,
        action: charges.depositCaptureFils > 0 ? "deposit.captured" : "deposit.released",
        entityType: "reservation",
        entityId: reservationId,
        data: { capturedFils: charges.depositCaptureFils },
      });
    } catch (err) {
      log.error("deposit settlement failed at check-in", { reservationId, error: err });
      throw new DomainError("PAYMENT_FAILED", "The car was checked in, but settling the deposit failed. Retry from the reservation page.");
    }
  }
  const view = await buildReservationView(await loadReservationRow(db, reservationId), now);
  return { ...view, charges };
}

/** Admin: retry deposit settlement for a RETURNED reservation whose deposit is still held. */
export async function settleReturnedDeposit(actor: Actor, reservationId: string): Promise<ReservationView> {
  assertAdmin(actor);
  const r = await loadReservationRow(db, reservationId);
  if (r.status !== "RETURNED") throw new DomainError("INVALID_STATE", "Reservation is not returned.");
  const [ag] = await db.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id));
  const [dep] = await db.select().from(deposits).where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "held")));
  if (dep?.providerHoldId && ag) {
    if (ag.depositCapturedFils > 0) {
      const h = await getPaymentProvider().captureDeposit(dep.providerHoldId, ag.depositCapturedFils);
      await applyProviderDeposit(db, h, dep.id);
    } else {
      await releaseDepositRow(dep);
    }
  }
  return buildReservationView(await loadReservationRow(db, r.id));
}
