import { timingSafeEqual } from "node:crypto";
import { releaseExpiredHolds } from "@/lib/jobs/release-expired-holds";

// Cloud trigger for the cleanup job. Locally, use `pnpm jobs:release-holds` instead.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await releaseExpiredHolds());
}
