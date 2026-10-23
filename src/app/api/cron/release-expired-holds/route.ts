import { timingSafeEqual } from "node:crypto";
import { releaseExpiredHolds } from "@/lib/jobs/release-expired-holds";
import { log, requestIdFrom } from "@/lib/log";

// Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET` (schedule in vercel.json).
// POST is accepted too for manual triggers. Locally, `pnpm jobs:release-holds` runs the same job.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request) {
  const requestId = requestIdFrom(request.headers);
  if (!authorized(request)) {
    log.warn("cron unauthorized", { requestId, route: "release-expired-holds" });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await releaseExpiredHolds();
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    log.error("cron release-expired-holds failed", { requestId, error: err });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
