import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { deposits, payments, reservationExtras, reservations, vehicles } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/types";
import { expireStaleHolds, findConflicts } from "@/lib/availability";
import { DomainError, isExclusionViolation, isUniqueViolation } from "@/lib/errors";
import { log } from "@/lib/log";
import { getPaymentProvider } from "@/lib/payments";
import { canModifyDates, cancellationOutcome } from "@/lib/pricing/calc";
import { assertFuturePickup, priceRental, rentalWindowSchema } from "@/lib/pricing/quote";
import { parseInput, zId, zInstant } from "@/lib/validation";
import { idempotencyKeySchema } from "./booking";
import {
  applyProviderPayment,
  cancelPendingPayments,
  lockReservationMoney,
  moneySummary,
  netPaidFils,
  reconcileReservationMoney,
  refundAcrossPayments,
  releaseDepositRow,
} from "./money";
import { assertCanAccess, buildReservationView, loadReservationRow, type ReservationView } from "./view";

export const cancelReservationSchema = z.object({
  reservationId: zId,
  reason: z.string().trim().max(500).optional(),
});

/**
 * Cancels a reservation (owner or admin) under the cancellation policy:
 * PENDING holds cancel for free; CONFIRMED ones get a full refund until 48h before pick-up,
 * then one day (rate + VAT) is kept; no cancellation once the pick-up time has passed.
 * Status ends CANCELLED (nothing refunded) or REFUNDED (money returned); the deposit is released.
 */
export async function cancelReservation(
  actor: Actor,
  input: z.input<typeof cancelReservationSchema>,
  now: Date = new Date(),
): Promise<ReservationView> {
  const data = parseInput(cancelReservationSchema, input);
  const pre = await loadReservationRow(db, data.reservationId);
  assertCanAccess(actor, pre);

  const decision = await db.transaction(async (tx) => {
    const r = await loadReservationRow(tx, data.reservationId, true);
    if (r.status === "CANCELLED" || r.status === "REFUNDED") return null; // idempotent
    if (r.status !== "PENDING" && r.status !== "CONFIRMED") {
      throw new DomainError("POLICY_VIOLATION", `A ${r.status.toLowerCase().replace("_", " ")} reservation cannot be cancelled.`);
    }
    let feeFils = 0;
    let refundFils = 0;
    if (r.status === "CONFIRMED") {
      const money = await moneySummary(tx, r.id);
      const outcome = cancellationOutcome({
        pickupAt: r.pickupAt,
        now,
        paidFils: money.paidFils,
        dailyRateFils: r.dailyRateFils,
        vatRateBps: r.vatRateBps,
      });
      if (!outcome.allowed) throw new DomainError("POLICY_VIOLATION", outcome.reason);
      feeFils = outcome.feeFils;
      refundFils = outcome.refundFils;
    }
    await tx
      .update(reservations)
      .set({ status: "CANCELLED", cancelledAt: now, cancellationFeeFils: feeFils, holdExpiresAt: null, updatedAt: now })
      .where(eq(reservations.id, r.id));
    await audit(
      {
        actor,
        action: "reservation.cancelled",
        entityType: "reservation",
        entityId: r.id,
        data: { from: r.status, feeFils, refundFils, reason: data.reason ?? null },
      },
      tx,
    );
    return { refundFils };
  });

  if (decision) {
    await cancelPendingPayments(pre.id);
    const held = await db.select().from(deposits).where(and(eq(deposits.reservationId, pre.id), eq(deposits.status, "held")));
    for (const d of held) await releaseDepositRow(d);
    if (decision.refundFils > 0) {
      const refunded = await refundAcrossPayments(pre.id, decision.refundFils);
      await db
        .update(reservations)
        .set({ status: "REFUNDED", refundedFils: refunded, updatedAt: new Date() })
        .where(eq(reservations.id, pre.id));
      await audit({ actor, action: "reservation.refunded", entityType: "reservation", entityId: pre.id, data: { refundedFils: refunded } });
      if (refunded < decision.refundFils) {
        log.error("partial refund on cancellation", { reservationId: pre.id, expected: decision.refundFils, refunded });
      }
    }
  }
  await reconcileReservationMoney(pre.id);
  return buildReservationView(await loadReservationRow(db, pre.id), now);
}

export const modifyDatesSchema = z
  .object({
    reservationId: zId,
    pickupAt: zInstant,
    returnAt: zInstant,
    /** Needed only when the new price is higher than what was paid. */
    paymentMethod: z.string().min(3).max(200).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .refine((d) => d.returnAt > d.pickupAt, { message: "Return must be after pick-up", path: ["returnAt"] });

/**
 * Changes the dates of a CONFIRMED reservation until 48h before pick-up (BUG-008: a PENDING
 * reservation must finish or cancel its payment first). Re-priced and re-checked for
 * availability inside a transaction that locks the vehicle. Runs under the reservation money
 * lock: a higher price charges only the outstanding difference (refunded if the change fails);
 * a lower price refunds the surplus via reconciliation.
 */
export async function modifyReservationDates(
  actor: Actor,
  input: z.input<typeof modifyDatesSchema>,
  now: Date = new Date(),
): Promise<ReservationView> {
  const data = parseInput(modifyDatesSchema, input);
  const r = await loadReservationRow(db, data.reservationId);
  assertCanAccess(actor, r);
  parseInput(rentalWindowSchema, { pickupBranchId: r.pickupBranchId, pickupAt: data.pickupAt, returnAt: data.returnAt });
  assertFuturePickup(data.pickupAt, now);
  if (r.status === "PENDING") {
    throw new DomainError("INVALID_STATE", "Please finish or cancel the payment first, then change the dates.");
  }
  if (r.status !== "CONFIRMED") {
    throw new DomainError("POLICY_VIOLATION", "Only upcoming reservations can be changed.");
  }
  if (!canModifyDates(r.pickupAt, now)) {
    throw new DomainError("POLICY_VIOLATION", "Dates can only be changed until 48 hours before pick-up.");
  }
  if (r.pickupAt.getTime() === data.pickupAt.getTime() && r.returnAt.getTime() === data.returnAt.getTime()) {
    return buildReservationView(r, now);
  }

  const extraSel = await db
    .select({ extraId: reservationExtras.extraId, quantity: reservationExtras.quantity })
    .from(reservationExtras)
    .where(eq(reservationExtras.reservationId, r.id));
  const priceInput = {
    vehicleId: r.vehicleId,
    pickupBranchId: r.pickupBranchId,
    returnBranchId: r.returnBranchId,
    pickupAt: data.pickupAt,
    returnAt: data.returnAt,
    extras: extraSel,
  };
  const { quote } = await priceRental(db, priceInput);
  if (!(await isFreeIgnoringSelf(r.vehicleId, data.pickupAt, data.returnAt, r.id, now))) {
    throw new DomainError("VEHICLE_UNAVAILABLE", "The vehicle is not available for the new dates.");
  }

  await db.transaction(async (lockTx) => {
    await lockReservationMoney(lockTx, r.id);
    // Charge only the outstanding difference, computed under the money lock (BUG-008).
    const diff = quote.totalFils - (await netPaidFils(db, r.id, ["RENTAL", "MODIFICATION"]));
    let extraPaymentId: string | undefined;
    if (diff > 0) {
      if (!data.paymentMethod) {
        throw new DomainError("VALIDATION", "The new dates cost more; a payment method is required.", {
          paymentMethod: ["Required for the price difference"],
        });
      }
      extraPaymentId = await chargeDifference(r.id, r.reference, diff, data.paymentMethod, data.idempotencyKey);
    }

    try {
      await db.transaction(async (tx) => {
        await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, r.vehicleId)).for("update");
        const cur = await loadReservationRow(tx, r.id, true);
        if (cur.status !== r.status) throw new DomainError("CONFLICT", "The reservation changed; please reload.");
        await expireStaleHolds(tx, r.vehicleId, data.pickupAt, data.returnAt, now);
        const c = await findConflicts(tx, r.vehicleId, data.pickupAt, data.returnAt, { now, excludeReservationId: r.id });
        if (c.reservations || c.maintenance) {
          throw new DomainError("VEHICLE_UNAVAILABLE", "The vehicle is not available for the new dates.");
        }
        const fresh = await priceRental(tx, priceInput);
        await tx
          .update(reservations)
          .set({
            pickupAt: data.pickupAt,
            returnAt: data.returnAt,
            dailyRateFils: fresh.quote.dailyRateFils,
            rentalDays: fresh.quote.rentalDays,
            rentalFils: fresh.quote.rentalFils,
            extrasFils: fresh.quote.extrasFils,
            oneWayFeeFils: fresh.quote.oneWayFeeFils,
            vatRateBps: fresh.quote.vatRateBps,
            taxFils: fresh.quote.taxFils,
            totalFils: fresh.quote.totalFils,
            updatedAt: now,
          })
          .where(eq(reservations.id, r.id));
        for (const e of fresh.quote.extras) {
          await tx
            .update(reservationExtras)
            .set({ unitPriceFils: e.unitTotalFils, totalFils: e.totalFils })
            .where(and(eq(reservationExtras.reservationId, r.id), eq(reservationExtras.extraId, e.extraId)));
        }
        await audit(
          {
            actor,
            action: "reservation.dates_changed",
            entityType: "reservation",
            entityId: r.id,
            data: {
              from: { pickupAt: r.pickupAt, returnAt: r.returnAt, totalFils: r.totalFils },
              to: { pickupAt: data.pickupAt, returnAt: data.returnAt, totalFils: fresh.quote.totalFils },
            },
          },
          tx,
        );
      });
    } catch (err) {
      if (extraPaymentId) await refundPayment(extraPaymentId);
      if (isExclusionViolation(err)) throw new DomainError("VEHICLE_UNAVAILABLE", "The vehicle is not available for the new dates.");
      throw err;
    }
  });

  // A cheaper period leaves a surplus: refund it (also covers any success that raced us).
  await reconcileReservationMoney(r.id);
  return buildReservationView(await loadReservationRow(db, r.id), now);
}

async function isFreeIgnoringSelf(vehicleId: string, from: Date, to: Date, selfId: string, now: Date) {
  const c = await findConflicts(db, vehicleId, from, to, { now, excludeReservationId: selfId });
  return !c.reservations && !c.maintenance;
}

async function chargeDifference(reservationId: string, reference: string, amount: number, paymentMethod: string, key: string) {
  const provider = getPaymentProvider();
  let [row] = await db.select().from(payments).where(eq(payments.idempotencyKey, key));
  if (!row) {
    try {
      [row] = await db
        .insert(payments)
        .values({ reservationId, purpose: "MODIFICATION", provider: provider.name, idempotencyKey: key, amountFils: amount })
        .returning();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      [row] = await db.select().from(payments).where(eq(payments.idempotencyKey, key));
    }
  }
  if (row.reservationId !== reservationId || row.amountFils !== amount) {
    throw new DomainError("CONFLICT", "Idempotency key already used for another payment.");
  }
  if (row.status === "succeeded") return row.id;
  const p = await provider.createPayment({
    amount,
    currency: "AED",
    paymentMethod,
    idempotencyKey: key,
    metadata: { reservationId, paymentId: row.id, reference },
  });
  const updated = await applyProviderPayment(db, p, row.id);
  if (updated?.status !== "succeeded") {
    throw new DomainError("PAYMENT_FAILED", "The payment for the price difference was declined.");
  }
  return row.id;
}

async function refundPayment(paymentId: string) {
  const [p] = await db.select().from(payments).where(and(eq(payments.id, paymentId), inArray(payments.status, ["succeeded"])));
  if (!p?.providerPaymentId) return;
  try {
    const refund = await getPaymentProvider().refundPayment(p.providerPaymentId);
    await db.update(payments).set({ status: "refunded", amountRefundedFils: p.amountFils }).where(eq(payments.id, p.id));
    log.info("refunded modification charge after failed change", { paymentId, refundId: refund.id });
  } catch (err) {
    log.error("could not refund modification charge", { paymentId, error: err });
  }
}
