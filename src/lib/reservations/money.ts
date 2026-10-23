import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { deposits, payments, rentalAgreements, reservations, type DepositRow, type PaymentRow, type Reservation } from "@/db/schema";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { getPaymentProvider, PaymentError, type DepositHold, type Payment } from "@/lib/payments";

// Keeps payments/deposits rows in step with the provider. Status only moves forward, so a late
// or duplicate webhook can never undo a newer state.

const PAYMENT_RANK: Record<PaymentRow["status"], number> = {
  pending: 0,
  failed: 1,
  canceled: 1,
  succeeded: 2,
  partially_refunded: 3,
  refunded: 4,
};
const DEPOSIT_RANK: Record<DepositRow["status"], number> = { pending: 0, held: 1, failed: 2, released: 2, captured: 2 };

/** Apply a provider Payment to our row (found by our id or the provider id). Returns the row. */
export async function applyProviderPayment(
  tx: DbOrTx,
  p: Payment,
  ourId?: string,
): Promise<PaymentRow | undefined> {
  const id = ourId ?? p.metadata?.paymentId;
  const [row] = await tx
    .select()
    .from(payments)
    .where(id ? or(eq(payments.id, id), eq(payments.providerPaymentId, p.id)) : eq(payments.providerPaymentId, p.id))
    .for("update");
  if (!row) return undefined;
  if (row.providerPaymentId && row.providerPaymentId !== p.id) return row; // not ours
  const forward = PAYMENT_RANK[p.status] >= PAYMENT_RANK[row.status];
  const [updated] = await tx
    .update(payments)
    .set({
      providerPaymentId: p.id,
      status: forward ? p.status : row.status,
      amountRefundedFils: Math.max(row.amountRefundedFils, Math.min(p.amountRefunded, row.amountFils)),
      failureReason: forward ? (p.failureReason ?? row.failureReason) : row.failureReason,
    })
    .where(eq(payments.id, row.id))
    .returning();
  return updated;
}

export async function applyProviderDeposit(
  tx: DbOrTx,
  h: DepositHold,
  ourId?: string,
): Promise<DepositRow | undefined> {
  const id = ourId ?? h.metadata?.depositId;
  const [row] = await tx
    .select()
    .from(deposits)
    .where(id ? or(eq(deposits.id, id), eq(deposits.providerHoldId, h.id)) : eq(deposits.providerHoldId, h.id))
    .for("update");
  if (!row) return undefined;
  if (row.providerHoldId && row.providerHoldId !== h.id) return row;
  // Terminal states (released / captured / failed) never change into each other.
  const forward = h.status === row.status || DEPOSIT_RANK[h.status] > DEPOSIT_RANK[row.status];
  const [updated] = await tx
    .update(deposits)
    .set({
      providerHoldId: h.id,
      status: forward ? h.status : row.status,
      amountCapturedFils: forward ? Math.min(h.amountCaptured, row.amountFils) : row.amountCapturedFils,
      releaseReason: forward ? (h.releaseReason ?? row.releaseReason) : row.releaseReason,
      failureReason: forward ? (h.failureReason ?? row.failureReason) : row.failureReason,
    })
    .where(eq(deposits.id, row.id))
    .returning();
  return updated;
}

export type MoneySummary = {
  /** Sum of succeeded payments minus refunds. */
  paidFils: number;
  rentalPaymentStatus: PaymentRow["status"] | null;
  depositStatus: DepositRow["status"] | null;
  depositHeld: boolean;
  liveDeposit: DepositRow | null;
  payments: PaymentRow[];
  deposits: DepositRow[];
};

export async function moneySummary(tx: DbOrTx, reservationId: string): Promise<MoneySummary> {
  const pays = await tx.select().from(payments).where(eq(payments.reservationId, reservationId)).orderBy(desc(payments.createdAt));
  const deps = await tx.select().from(deposits).where(eq(deposits.reservationId, reservationId)).orderBy(desc(deposits.createdAt));
  const paidFils = pays
    .filter((p) => p.status === "succeeded" || p.status === "partially_refunded" || p.status === "refunded")
    .reduce((s, p) => s + p.amountFils - p.amountRefundedFils, 0);
  const rental = pays.find((p) => p.purpose === "RENTAL" && p.status !== "failed" && p.status !== "canceled") ?? pays.find((p) => p.purpose === "RENTAL");
  const live = deps.find((d) => d.status === "held" || d.status === "pending") ?? null;
  return {
    paidFils,
    rentalPaymentStatus: rental?.status ?? null,
    depositStatus: live?.status ?? deps[0]?.status ?? null,
    depositHeld: live?.status === "held",
    liveDeposit: live,
    payments: pays,
    deposits: deps,
  };
}

/** Releases a held deposit at the provider and records it. Safe to call twice. */
export async function releaseDepositRow(dep: DepositRow, reason: "manual" | "expired" = "manual"): Promise<void> {
  if (dep.status !== "held" || !dep.providerHoldId) return;
  try {
    const h = await getPaymentProvider().releaseDeposit(dep.providerHoldId, reason);
    await applyProviderDeposit(db, h, dep.id);
  } catch (err) {
    if (err instanceof PaymentError && err.code === "invalid_state") {
      log.warn("deposit already settled at provider", { depositId: dep.id, error: err.message });
      return;
    }
    throw err;
  }
}

/**
 * Refunds up to `amountFils` across the reservation's succeeded payments (newest first).
 * Returns the amount actually refunded.
 */
export async function refundAcrossPayments(reservationId: string, amountFils: number): Promise<number> {
  if (amountFils <= 0) return 0;
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), inArray(payments.status, ["succeeded", "partially_refunded"])))
    .orderBy(desc(payments.createdAt));
  let remaining = amountFils;
  const provider = getPaymentProvider();
  for (const p of rows) {
    if (remaining <= 0) break;
    const refundable = p.amountFils - p.amountRefundedFils;
    if (refundable <= 0 || !p.providerPaymentId) continue;
    const amount = Math.min(refundable, remaining);
    await provider.refundPayment(p.providerPaymentId, amount);
    const newRefunded = p.amountRefundedFils + amount;
    await db
      .update(payments)
      .set({
        amountRefundedFils: sql`GREATEST(${payments.amountRefundedFils}, ${newRefunded})`,
        status: newRefunded >= p.amountFils ? "refunded" : "partially_refunded",
      })
      .where(eq(payments.id, p.id));
    remaining -= amount;
  }
  return amountFils - remaining;
}

/** Cancels pending payments at the provider (used when a hold expires or is cancelled). */
export async function cancelPendingPayments(reservationId: string): Promise<void> {
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), eq(payments.status, "pending")));
  for (const p of rows) {
    if (!p.providerPaymentId) {
      await db.update(payments).set({ status: "canceled", failureReason: "never sent" }).where(eq(payments.id, p.id));
      continue;
    }
    try {
      const updated = await getPaymentProvider().cancelPayment(p.providerPaymentId);
      await applyProviderPayment(db, updated, p.id);
    } catch (err) {
      if (err instanceof PaymentError && err.code === "invalid_state") continue;
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Amount due and reconciliation (BUG-004 / BUG-007 / BUG-008)
// ---------------------------------------------------------------------------

const RENTAL_PURPOSES = ["RENTAL", "MODIFICATION"] as const;
const SETTLED = ["succeeded", "partially_refunded", "refunded"] as const;

/** What the customer owes for the rental itself, given the reservation's current state. */
export function rentalDueFils(r: Pick<Reservation, "status" | "totalFils" | "cancellationFeeFils">): number {
  switch (r.status) {
    case "EXPIRED":
      return 0;
    case "CANCELLED":
    case "REFUNDED":
      return r.cancellationFeeFils ?? 0;
    default:
      return r.totalFils;
  }
}

/** Net succeeded money (amount - refunded) for the given purposes. */
export async function netPaidFils(tx: DbOrTx, reservationId: string, purposes: readonly PaymentRow["purpose"][]): Promise<number> {
  const [{ net }] = await tx
    .select({ net: sql<number>`coalesce(sum(${payments.amountFils} - ${payments.amountRefundedFils}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), inArray(payments.purpose, [...purposes]), inArray(payments.status, [...SETTLED])));
  return net;
}

/** Outstanding rental amount (never negative). */
export async function rentalOutstandingFils(tx: DbOrTx, r: Reservation): Promise<number> {
  return Math.max(0, rentalDueFils(r) - (await netPaidFils(tx, r.id, RENTAL_PURPOSES)));
}

/** Outstanding return charges (agreement amount due minus RETURN_CHARGES paid). */
export async function returnBalanceFils(tx: DbOrTx, reservationId: string): Promise<number> {
  const [ag] = await tx
    .select({ due: rentalAgreements.amountDueFils })
    .from(rentalAgreements)
    .where(eq(rentalAgreements.reservationId, reservationId));
  if (!ag) return 0;
  return Math.max(0, ag.due - (await netPaidFils(tx, reservationId, ["RETURN_CHARGES"])));
}

/** Serialises money operations on one reservation (transaction-scoped advisory lock). */
export async function lockReservationMoney(tx: DbOrTx, reservationId: string, wait = true): Promise<boolean> {
  if (wait) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"reservation-money:" + reservationId}, 0))`);
    return true;
  }
  const res = await tx.execute<{ ok: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${"reservation-money:" + reservationId}, 0)) AS ok`,
  );
  return res.rows[0].ok;
}

export type ReconcileResult = { refundedFils: number; skipped: boolean };

/**
 * Never let a reservation keep more money than it owes. Refunds any surplus (latest-settled payments
 * first) for the rental (due = total, the cancellation fee, or 0 when expired) and for return
 * charges (due = agreement.amount_due_fils). Serialised per reservation by an advisory lock;
 * idempotent (a second run finds no surplus). With wait=false (webhooks) it skips when another
 * money operation holds the lock - that operation reconciles when it finishes.
 */
export async function reconcileReservationMoney(reservationId: string, options: { wait?: boolean } = {}): Promise<ReconcileResult> {
  return db.transaction(async (tx) => {
    if (!(await lockReservationMoney(tx, reservationId, options.wait ?? true))) return { refundedFils: 0, skipped: true };
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId));
    if (!r) return { refundedFils: 0, skipped: false };
    let refundedFils = 0;
    const groups: { purposes: readonly PaymentRow["purpose"][]; due: number }[] = [
      { purposes: RENTAL_PURPOSES, due: rentalDueFils(r) },
    ];
    const [ag] = await tx
      .select({ due: rentalAgreements.amountDueFils })
      .from(rentalAgreements)
      .where(eq(rentalAgreements.reservationId, reservationId));
    groups.push({ purposes: ["RETURN_CHARGES"], due: ag?.due ?? 0 });

    for (const g of groups) {
      let surplus = (await netPaidFils(tx, reservationId, g.purposes)) - g.due;
      if (surplus <= 0) continue;
      const rows = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.reservationId, reservationId),
            inArray(payments.purpose, [...g.purposes]),
            inArray(payments.status, ["succeeded", "partially_refunded"]),
          ),
        )
        // The most recently settled payment (e.g. a late success) is refunded first.
        .orderBy(desc(payments.updatedAt), desc(payments.createdAt));
      for (const p of rows) {
        if (surplus <= 0) break;
        const refundable = p.amountFils - p.amountRefundedFils;
        if (refundable <= 0 || !p.providerPaymentId) continue;
        const amount = Math.min(refundable, surplus);
        await getPaymentProvider().refundPayment(p.providerPaymentId, amount);
        const newRefunded = p.amountRefundedFils + amount;
        // Written on its own connection so a synchronous provider webhook never waits on us.
        await db
          .update(payments)
          .set({
            amountRefundedFils: sql`GREATEST(${payments.amountRefundedFils}, ${newRefunded})`,
            status: newRefunded >= p.amountFils ? "refunded" : "partially_refunded",
          })
          .where(eq(payments.id, p.id));
        surplus -= amount;
        refundedFils += amount;
        log.warn("surplus payment refunded automatically", { reservationId, paymentId: p.id, amountFils: amount, purpose: p.purpose });
        await audit(
          {
            actor: "system",
            action: "payment.surplus_refunded",
            entityType: "reservation",
            entityId: reservationId,
            data: { paymentId: p.id, purpose: p.purpose, amountFils: amount, reservationStatus: r.status },
          },
          db,
        );
      }
    }
    return { refundedFils, skipped: false };
  });
}
