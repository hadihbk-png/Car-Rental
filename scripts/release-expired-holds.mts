import { releaseExpiredHolds } from "../src/lib/jobs/release-expired-holds";
import { pool } from "../src/db";

const result = await releaseExpiredHolds();
console.log(`Expired ${result.expiredReservations.length} hold(s); voided money on ${result.voided.length} reservation(s).`);
for (const id of result.expiredReservations) console.log(`  expired ${id}`);
for (const v of result.voided) console.log(`  voided ${v.reservationId}: refunded ${v.refundedFils} fils, released ${v.releasedDeposits} deposit(s)`);
for (const f of result.failed) console.error(`  FAILED ${f.reservationId}: ${f.error}`);
await pool.end();
process.exitCode = result.failed.length ? 1 : 0;
