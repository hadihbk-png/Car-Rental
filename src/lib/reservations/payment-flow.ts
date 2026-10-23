import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { deposits, payments, paymentWebhookEvents, reservations, type Reservation } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/types";
import { assertDriverReady } from "@/lib/drivers";
import { DomainError, isUniqueViolation } from "@/lib/errors";
import { log } from "@/lib/log";
import {
  getPaymentProvider,
  PaymentError,
  type DepositHold,
  type IgnoredWebhookEvent,
  type Payment,
  type WebhookEvent,
} from "@/lib/payments";
import { parseInput, zId } from "@/lib/validation";
import { idempotencyKeySchema } from "./booking";
import {
  applyProviderDeposit,
  applyProviderPayment,
  cancelPendingPayments,
  refundAcrossPayments,
  releaseDepositRow,
} from "./money";
import { assertCanAccess, buildReservationView, loadReservationRow, type ReservationView } from "./view";

/** Deposit authorisations are requested to last until a week after the scheduled return. */
const DEPOSIT_EXTRA_DAYS = 7;

export const payReservationSchema = z.object({
  reservationId: zId,
  /** Payment method token from the client (fake provider: FAKE_PAYMENT_METHODS; Stripe: pm_...). */
  paymentMethod: z.string().min(3).max(200),
  /** New key per payment attempt; resend the same key when retrying the same attempt. */
  idempotencyKey: idempotencyKeySchema,
});
export type PayReservationInput = z.input<typeof payReservationSchema>;

/**
 * Pays for a held reservation: authorises the security deposit (manual-capture hold), then
 * charges the total. The reservation becomes CONFIRMED only when the payment succeeded and the
 * deposit is held (verified provider responses or webhooks). Idempotent per idempotencyKey.
 * Throws PAYMENT_FAILED on a decline (the hold stays PENDING so the user can retry until it expires).
 */
export async function payReservation(
  actor: Actor,
  input: PayReservationInput,
  now: Date = new Date(),
): Promise<ReservationView> {
  const data = parseInput(payReservationSchema, input);
  let r = await loadReservationRow(db, data.reservationId);
  assertCanAccess(actor, r);

  // Replay of an earlier attempt with the same key.
  const [prior] = await db.select().from(payments).where(eq(payments.idempotencyKey, data.idempotencyKey));
  if (prior && prior.reservationId !== r.id) throw new DomainError("CONFLICT", "Idempotency key already used.");
  if (prior && prior.status === "succeeded") {
    await tryConfirmReservation(r.id, now);
    return buildReservationView(await loadReservationRow(db, r.id), now);
  }

  if (r.status !== "PENDING") {
    if (r.status === "CONFIRMED") return buildReservationView(r, now);
    throw new DomainError("INVALID_STATE", `This reservation is ${r.status.toLowerCase()} and cannot be paid.`);
  }
  if (!r.holdExpiresAt || r.holdExpiresAt <= now) {
    await expireHold(r.id, now);
    throw new DomainError("INVALID_STATE", "Your hold on this vehicle has expired. Please search again.");
  }
  const profile = await assertDriverReady(db, r.userId, r.returnAt, now);
  if (r.driverProfileId !== profile.id) {
    await db.update(reservations).set({ driverProfileId: profile.id }).where(eq(reservations.id, r.id));
  }

  const provider = getPaymentProvider();

  // 1) Security deposit authorisation (skipped when the category has no deposit).
  if (r.depositFils > 0) {
    const [live] = await db
      .select()
      .from(deposits)
      .where(and(eq(deposits.reservationId, r.id), inArray(deposits.status, ["pending", "held"])));
    if (!live || live.status === "pending") {
      const depositKey = `${data.idempotencyKey}:deposit`;
      let depRow = live;
      if (!depRow) {
        try {
          [depRow] = await db
            .insert(deposits)
            .values({
              reservationId: r.id,
              provider: provider.name,
              idempotencyKey: depositKey,
              amountFils: r.depositFils,
              expiresAt: new Date(r.returnAt.getTime() + DEPOSIT_EXTRA_DAYS * 86_400_000),
            })
            .returning();
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          [depRow] = await db.select().from(deposits).where(eq(deposits.idempotencyKey, depositKey));
          if (!depRow) throw err;
        }
      }
      let hold: DepositHold;
      try {
        hold = await provider.holdDeposit({
          amount: depRow.amountFils,
          currency: "AED",
          paymentMethod: data.paymentMethod,
          idempotencyKey: depRow.idempotencyKey,
          expiresAt: depRow.expiresAt,
          metadata: { reservationId: r.id, depositId: depRow.id, reference: r.reference },
        });
      } catch (err) {
        await db.update(deposits).set({ status: "failed", failureReason: errorCode(err) }).where(eq(deposits.id, depRow.id));
        throw paymentFailed(err, "The security deposit could not be authorised.");
      }
      const updated = await applyProviderDeposit(db, hold, depRow.id);
      if (updated?.status !== "held") {
        log.info("deposit authorisation declined", { reservationId: r.id, reason: hold.failureReason });
        throw new DomainError("PAYMENT_FAILED", "The security deposit authorisation was declined. Please try another card.");
      }
    }
  }

  // 2) Rental charge.
  let payRow = prior;
  if (!payRow) {
    try {
      [payRow] = await db
        .insert(payments)
        .values({
          reservationId: r.id,
          purpose: "RENTAL",
          provider: provider.name,
          idempotencyKey: data.idempotencyKey,
          amountFils: r.totalFils,
        })
        .returning();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      [payRow] = await db.select().from(payments).where(eq(payments.idempotencyKey, data.idempotencyKey));
      if (!payRow) throw err;
    }
  } else if (payRow.status === "failed" || payRow.status === "canceled") {
    throw new DomainError("PAYMENT_FAILED", "That payment attempt failed. Please try again.");
  }

  let payment: Payment;
  try {
    payment = await provider.createPayment({
      amount: payRow.amountFils,
      currency: "AED",
      paymentMethod: data.paymentMethod,
      idempotencyKey: payRow.idempotencyKey,
      metadata: { reservationId: r.id, paymentId: payRow.id, reference: r.reference },
    });
  } catch (err) {
    await db.update(payments).set({ status: "failed", failureReason: errorCode(err) }).where(eq(payments.id, payRow.id));
    await releaseLiveDeposit(r.id);
    throw paymentFailed(err, "The payment could not be processed.");
  }
  const updated = await applyProviderPayment(db, payment, payRow.id);
  if (updated?.status === "failed" || updated?.status === "canceled") {
    // Release the deposit so a retry with another card starts clean.
    await releaseLiveDeposit(r.id);
    await audit({ actor, action: "payment.failed", entityType: "reservation", entityId: r.id, data: { reason: payment.failureReason } });
    throw new DomainError("PAYMENT_FAILED", "Your payment was declined. Please try another card.");
  }
  if (updated?.status === "succeeded") await tryConfirmReservation(r.id, now);
  r = await loadReservationRow(db, r.id);
  return buildReservationView(r, now);
}

function errorCode(err: unknown) {
  return err instanceof PaymentError ? err.code : "error";
}

function paymentFailed(err: unknown, msg: string) {
  log.warn("payment provider error", { error: err instanceof Error ? err.message : String(err) });
  return new DomainError("PAYMENT_FAILED", msg);
}

async function releaseLiveDeposit(reservationId: string) {
  const [live] = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "held")));
  if (live) await releaseDepositRow(live);
}

async function expireHold(reservationId: string, now: Date) {
  const result = await db
    .update(reservations)
    .set({ status: "EXPIRED", updatedAt: now })
    .where(and(eq(reservations.id, reservationId), eq(reservations.status, "PENDING")))
    .returning({ id: reservations.id });
  if (result.length) {
    await audit({ actor: "system", action: "reservation.expired", entityType: "reservation", entityId: reservationId });
  }
}

/**
 * Confirms a PENDING reservation when its rental payment succeeded and its deposit is held.
 * Runs under a row lock, so the API response and the webhook racing each other confirm once.
 * If the reservation already expired/cancelled, the late money is voided instead.
 */
export async function tryConfirmReservation(reservationId: string, now: Date = new Date()): Promise<Reservation["status"]> {
  const outcome = await db.transaction(async (tx) => {
    const r = await loadReservationRow(tx, reservationId, true);
    if (r.status !== "PENDING") return { status: r.status, voidMoney: r.status === "EXPIRED" };
    if (!(await isFullyPaid(tx, r))) return { status: r.status, voidMoney: false };
    await tx
      .update(reservations)
      .set({ status: "CONFIRMED", confirmedAt: now, holdExpiresAt: null, updatedAt: now })
      .where(eq(reservations.id, r.id));
    await audit(
      { actor: "system", action: "reservation.confirmed", entityType: "reservation", entityId: r.id, data: { reference: r.reference } },
      tx,
    );
    return { status: "CONFIRMED" as const, voidMoney: false };
  });
  if (outcome.voidMoney) await voidMoneyForInactiveReservation(reservationId);
  if (outcome.status === "CONFIRMED") log.info("reservation confirmed", { reservationId });
  return outcome.status;
}

async function isFullyPaid(tx: DbOrTx, r: Reservation): Promise<boolean> {
  const [{ paid }] = await tx
    .select({ paid: sql<number>`coalesce(sum(${payments.amountFils}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.reservationId, r.id), eq(payments.purpose, "RENTAL"), eq(payments.status, "succeeded")));
  if (paid < r.totalFils) return false;
  if (r.depositFils === 0) return true;
  const [held] = await tx
    .select({ id: deposits.id })
    .from(deposits)
    .where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "held")));
  return !!held;
}

/** Refund/cancel money left on an EXPIRED reservation, release deposits of EXPIRED/CANCELLED ones. */
export async function voidMoneyForInactiveReservation(reservationId: string): Promise<{ refundedFils: number; releasedDeposits: number }> {
  const r = await loadReservationRow(db, reservationId);
  let refundedFils = 0;
  if (r.status === "EXPIRED") {
    await cancelPendingPayments(r.id);
    const [{ net }] = await db
      .select({ net: sql<number>`coalesce(sum(${payments.amountFils} - ${payments.amountRefundedFils}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.reservationId, r.id), inArray(payments.status, ["succeeded", "partially_refunded"])));
    if (net > 0) refundedFils = await refundAcrossPayments(r.id, net);
  }
  let releasedDeposits = 0;
  if (r.status === "EXPIRED" || r.status === "CANCELLED" || r.status === "REFUNDED") {
    const held = await db.select().from(deposits).where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "held")));
    for (const d of held) {
      await releaseDepositRow(d, r.status === "EXPIRED" ? "expired" : "manual");
      releasedDeposits++;
    }
    // A deposit row that never reached the provider can simply be closed.
    await db
      .update(deposits)
      .set({ status: "failed", failureReason: "reservation inactive" })
      .where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "pending"), isNull(deposits.providerHoldId)));
  }
  if (refundedFils || releasedDeposits) {
    await audit({
      actor: "system",
      action: "reservation.money_voided",
      entityType: "reservation",
      entityId: r.id,
      data: { refundedFils, releasedDeposits, status: r.status },
    });
  }
  return { refundedFils, releasedDeposits };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookResult = { eventId: string; duplicate: boolean; type: string };

/**
 * Processes a verified provider event exactly once: the event id is stored in
 * payment_webhook_events (unique per provider), and the row is locked while it is applied, so
 * concurrent duplicate deliveries wait and then see it as processed.
 */
export async function processPaymentWebhook(
  providerName: string,
  event: WebhookEvent | IgnoredWebhookEvent,
  now: Date = new Date(),
): Promise<WebhookResult> {
  let confirmReservationId: string | undefined;
  const result = await db.transaction(async (tx) => {
    await tx
      .insert(paymentWebhookEvents)
      .values({ provider: providerName, eventId: event.id, type: event.type, payload: event as object, receivedAt: now })
      .onConflictDoUpdate({
        target: [paymentWebhookEvents.provider, paymentWebhookEvents.eventId],
        set: { deliveries: sql`${paymentWebhookEvents.deliveries} + 1` },
      });
    const [stored] = await tx
      .select()
      .from(paymentWebhookEvents)
      .where(and(eq(paymentWebhookEvents.provider, providerName), eq(paymentWebhookEvents.eventId, event.id)))
      .for("update");
    if (stored.processedAt) return { eventId: event.id, duplicate: true, type: event.type };

    if (event.type !== "ignored") {
      if (event.type.startsWith("payment.")) {
        const row = await applyProviderPayment(tx, event.data as Payment);
        if (row && event.type === "payment.succeeded") confirmReservationId = row.reservationId;
        if (!row) log.warn("webhook for unknown payment", { eventId: event.id, providerId: event.data.id });
      } else {
        const row = await applyProviderDeposit(tx, event.data as DepositHold);
        if (row && event.type === "deposit.held") confirmReservationId = row.reservationId;
        if (!row) log.warn("webhook for unknown deposit", { eventId: event.id, providerId: event.data.id });
      }
    }
    await tx.update(paymentWebhookEvents).set({ processedAt: now }).where(eq(paymentWebhookEvents.id, stored.id));
    return { eventId: event.id, duplicate: false, type: event.type };
  });
  if (confirmReservationId) await tryConfirmReservation(confirmReservationId, now);
  return result;
}
