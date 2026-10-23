import { getPaymentProvider, type PaymentProvider } from "@/lib/payments";

// Scheduled cleanup. The job logic lives here; only the trigger differs:
//   local - `pnpm jobs:release-holds` (scripts/release-expired-holds.mts)
//   cloud - a platform cron calls /api/cron/release-expired-holds with CRON_SECRET
// When booking/vehicle holds exist in the database, release them here too.

export type ReleaseExpiredHoldsResult = { released: string[]; failed: { id: string; error: string }[] };

export async function releaseExpiredHolds(
  payments: PaymentProvider = getPaymentProvider(),
  now: Date = new Date(),
): Promise<ReleaseExpiredHoldsResult> {
  const result: ReleaseExpiredHoldsResult = { released: [], failed: [] };
  for (const hold of await payments.listExpiredHolds(now)) {
    try {
      await payments.releaseDeposit(hold.id, "expired");
      result.released.push(hold.id);
    } catch (err) {
      result.failed.push({ id: hold.id, error: String(err) });
    }
  }
  return result;
}
