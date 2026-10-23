import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { deposits, payments, type DepositRow, type PaymentRow } from "@/db/schema";
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
