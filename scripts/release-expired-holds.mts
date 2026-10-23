import { releaseExpiredHolds } from "../src/lib/jobs/release-expired-holds";

const result = await releaseExpiredHolds();
console.log(`Released ${result.released.length} expired hold(s).`);
for (const id of result.released) console.log(`  released ${id}`);
for (const f of result.failed) console.error(`  FAILED ${f.id}: ${f.error}`);
process.exitCode = result.failed.length ? 1 : 0;
