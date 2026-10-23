import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { deposits, payments, reservations } from "@/db/schema";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { voidMoneyForInactiveReservation } from "@/lib/reservations/payment-flow";

// Scheduled cleanup. The job logic lives here; only the trigger differs:
//   local - `pnpm jobs:release-holds` (scripts/release-expired-holds.mts)
//   cloud - Vercel Cron calls GET /api/cron/release-expired-holds with Bearer CRON_SECRET
//
// Idempotent: (1) marks PENDING holds past hold_expires_at as EXPIRED (row-locked, SKIP LOCKED
// so overlapping runs never double-process), then (2) voids money still attached to EXPIRED
// reservations (cancels pending payments, refunds any late successful charge, releases held
// deposits) and releases held deposits of CANCELLED/REFUNDED ones. A second run finds nothing.

export type ReleaseExpiredHoldsResult = {
  expiredReservations: string[];
  /** Reservations whose payments/deposits were voided in this run. */
  voided: { reservationId: string; refundedFils: number; releasedDeposits: number }[];
  failed: { reservationId: string; error: string }[];
};

export async function releaseExpiredHolds(now: Date = new Date()): Promise<ReleaseExpiredHoldsResult> {
  const expired = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string; reference: string }>(sql`
      UPDATE reservations SET status = 'EXPIRED', updated_at = ${now}::timestamptz
      WHERE id IN (
        SELECT id FROM reservations
        WHERE status = 'PENDING' AND hold_expires_at <= ${now}::timestamptz
        ORDER BY hold_expires_at
        LIMIT 500
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, reference`);
    for (const r of rows.rows) {
      await audit(
        { actor: "system", action: "reservation.expired", entityType: "reservation", entityId: r.id, data: { reason: "hold expired", reference: r.reference } },
        tx,
      );
    }
    return rows.rows.map((r) => r.id);
  });

  // Reservations that still have money to void (includes earlier runs' failures and holds that
  // expired inside the booking transaction).
  const withPayments = await db
    .selectDistinct({ id: payments.reservationId })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(and(eq(reservations.status, "EXPIRED"), inArray(payments.status, ["pending", "succeeded", "partially_refunded"])));
  const withDeposits = await db
    .selectDistinct({ id: deposits.reservationId })
    .from(deposits)
    .innerJoin(reservations, eq(reservations.id, deposits.reservationId))
    .where(
      and(
        inArray(reservations.status, ["EXPIRED", "CANCELLED", "REFUNDED"]),
        inArray(deposits.status, ["held", "pending"]),
        lte(deposits.createdAt, now),
      ),
    );
  const todo = [...new Set([...withPayments, ...withDeposits].map((r) => r.id))];

  const result: ReleaseExpiredHoldsResult = { expiredReservations: expired, voided: [], failed: [] };
  for (const reservationId of todo) {
    try {
      const v = await voidMoneyForInactiveReservation(reservationId);
      result.voided.push({ reservationId, ...v });
    } catch (err) {
      result.failed.push({ reservationId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  log.info("release expired holds", {
    expired: expired.length,
    voided: result.voided.length,
    failed: result.failed.length,
  });
  return result;
}
