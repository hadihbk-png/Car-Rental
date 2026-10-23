import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { reservationExtras, reservations, vehicles, type Reservation } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/types";
import { expireStaleHolds, findConflicts } from "@/lib/availability";
import { DomainError, isExclusionViolation, isUniqueViolation } from "@/lib/errors";
import { log } from "@/lib/log";
import { HOLD_MINUTES } from "@/lib/pricing/calc";
import { assertFuturePickup, extrasSelectionSchema, priceRental, rentalWindowSchema } from "@/lib/pricing/quote";
import { parseInput, zId } from "@/lib/validation";
import { assertCanAccess, buildReservationView, buildReservationViews, loadReservationRow, type ReservationView } from "./view";

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export function generateReference(): string {
  let s = "DE-";
  for (let i = 0; i < 6; i++) s += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return s;
}

export const idempotencyKeySchema = z
  .string()
  .min(8, "Idempotency key too short")
  .max(100)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Invalid idempotency key");

export const createReservationSchema = z.intersection(
  rentalWindowSchema,
  z.object({
    vehicleId: zId,
    extras: extrasSelectionSchema,
    /** Generate once per checkout (e.g. crypto.randomUUID()) and resend it on retries. */
    idempotencyKey: idempotencyKeySchema,
  }),
);
export type CreateReservationInput = z.input<typeof createReservationSchema>;

/**
 * Places a temporary hold (PENDING reservation) - the reservation transaction:
 *  1. begin a transaction; 2. lock the vehicle row (SELECT ... FOR UPDATE);
 *  3. expire stale overlapping holds, then confirm no overlapping reservation or maintenance block;
 *  4. hold with hold_expires_at = now + 15 min; 5. price everything on the server;
 *  6. insert the PENDING reservation (+ extras); 7. commit.
 *  8. confirmation happens only in payReservation / the payment webhook after verified payment
 *     and deposit authorisation; 9. the idempotency key makes retries return the same
 *     reservation; 10. if the vehicle is taken, VEHICLE_UNAVAILABLE is thrown (the database
 *     exclusion constraint and triggers back this up under any race).
 */
export async function createReservation(
  actor: Actor,
  input: CreateReservationInput,
  now: Date = new Date(),
): Promise<ReservationView> {
  const data = parseInput(createReservationSchema, input);
  const returnBranchId = data.returnBranchId ?? data.pickupBranchId;

  const existing = await findByIdempotencyKey(actor.id, data.idempotencyKey);
  if (existing) return replay(existing, data.vehicleId, now);
  assertFuturePickup(data.pickupAt, now);

  let created: Reservation;
  let replayed = false;
  try {
    created = await db.transaction(async (tx) => {
      const [vehicle] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, data.vehicleId)).for("update");
      if (!vehicle) throw new DomainError("NOT_FOUND", "Vehicle not found.");
      // A concurrent retry with the same key may have committed while we waited for the lock.
      const [same] = await tx
        .select()
        .from(reservations)
        .where(and(eq(reservations.userId, actor.id), eq(reservations.idempotencyKey, data.idempotencyKey)));
      if (same) {
        replayed = true;
        return same;
      }

      await expireStaleHolds(tx, data.vehicleId, data.pickupAt, data.returnAt, now);
      const conflicts = await findConflicts(tx, data.vehicleId, data.pickupAt, data.returnAt, { now });
      if (conflicts.reservations || conflicts.maintenance) {
        throw new DomainError("VEHICLE_UNAVAILABLE", "Sorry, this vehicle is no longer available for the selected dates.");
      }

      const { quote } = await priceRental(tx, { ...data, returnBranchId, extras: data.extras });

      const [row] = await tx
        .insert(reservations)
        .values({
          reference: generateReference(),
          userId: actor.id,
          vehicleId: data.vehicleId,
          pickupBranchId: data.pickupBranchId,
          returnBranchId,
          pickupAt: data.pickupAt,
          returnAt: data.returnAt,
          status: "PENDING",
          holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
          idempotencyKey: data.idempotencyKey,
          dailyRateFils: quote.dailyRateFils,
          rentalDays: quote.rentalDays,
          rentalFils: quote.rentalFils,
          extrasFils: quote.extrasFils,
          oneWayFeeFils: quote.oneWayFeeFils,
          vatRateBps: quote.vatRateBps,
          taxFils: quote.taxFils,
          totalFils: quote.totalFils,
          depositFils: quote.depositFils,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (quote.extras.length) {
        await tx.insert(reservationExtras).values(
          quote.extras.map((e) => ({
            reservationId: row.id,
            extraId: e.extraId,
            quantity: e.quantity,
            pricingType: e.pricingType,
            unitPriceFils: e.unitTotalFils,
            totalFils: e.totalFils,
          })),
        );
      }
      await audit(
        {
          actor,
          action: "reservation.created",
          entityType: "reservation",
          entityId: row.id,
          data: { reference: row.reference, status: "PENDING", totalFils: row.totalFils, holdExpiresAt: row.holdExpiresAt },
        },
        tx,
      );
      return row;
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw new DomainError("VEHICLE_UNAVAILABLE", "Sorry, this vehicle is no longer available for the selected dates.");
    }
    if (isUniqueViolation(err, "reservations_user_idempotency_uq")) {
      const again = await findByIdempotencyKey(actor.id, data.idempotencyKey);
      if (again) return replay(again, data.vehicleId, now);
    }
    throw err;
  }
  if (replayed) return replay(created, data.vehicleId, now);
  log.info("reservation hold created", { reservationId: created.id, reference: created.reference, userId: actor.id });
  return buildReservationView(created, now);
}

async function findByIdempotencyKey(userId: string, key: string) {
  const [row] = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.userId, userId), eq(reservations.idempotencyKey, key)));
  return row;
}

async function replay(row: Reservation, vehicleId: string, now: Date) {
  if (row.vehicleId !== vehicleId) {
    throw new DomainError("CONFLICT", "This idempotency key was already used for a different reservation.");
  }
  return buildReservationView(row, now);
}

/** A reservation by id or reference. Owner or admin; others get NOT_FOUND. */
export async function getReservation(actor: Actor, idOrReference: string, now: Date = new Date()): Promise<ReservationView> {
  const row = await loadReservationRow(db, idOrReference);
  assertCanAccess(actor, row);
  return buildReservationView(row, now);
}

/** The signed-in user's reservations, newest pick-up first. */
export async function listMyReservations(actor: Actor, now: Date = new Date()): Promise<ReservationView[]> {
  const rows = await db.select().from(reservations).where(eq(reservations.userId, actor.id)).orderBy(desc(reservations.pickupAt));
  return buildReservationViews(rows, now);
}
