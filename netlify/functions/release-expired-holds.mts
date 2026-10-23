// Netlify scheduled function: every 5 minutes, trigger the app's protected cleanup route.
// Thin HTTP trigger only (no app code imported): the job itself runs in the Next.js route
// /api/cron/release-expired-holds, which checks `Authorization: Bearer $CRON_SECRET`.
// Netlify runs scheduled functions on published (production) deploys; URL is the site URL.
import type { Config } from "@netlify/functions";

export const config: Config = {
  schedule: "*/5 * * * *",
};

export default async function releaseExpiredHolds(req: Request): Promise<Response> {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    throw new Error("release-expired-holds: URL and CRON_SECRET must be set in the Netlify environment");
  }
  // Netlify sends {"next_run": "..."} as the body of a scheduled invocation.
  const nextRun = await req
    .json()
    .then((b: { next_run?: string }) => b.next_run)
    .catch(() => undefined);

  const target = `${base.replace(/\/+$/, "")}/api/cron/release-expired-holds`;
  const res = await fetch(target, {
    method: "GET",
    headers: { authorization: `Bearer ${secret}`, "user-agent": "netlify-scheduled-function/release-expired-holds" },
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let result: unknown = text.slice(0, 2000);
  try {
    result = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    console.error(JSON.stringify({ level: "error", msg: "release-expired-holds failed", status: res.status, result, nextRun }));
    // Throwing makes Netlify record the invocation as failed.
    throw new Error(`release-expired-holds: ${target} responded ${res.status}`);
  }
  console.log(JSON.stringify({ level: "info", msg: "release-expired-holds", status: res.status, result, nextRun }));
  return new Response(null, { status: 204 });
}
