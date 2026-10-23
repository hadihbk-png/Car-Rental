# DriveEasy bug log

Owner: QA Agent. Every bug is reported to the team lead, who routes it to the owner agent. The owner fixes it; QA retests it with a regression test named after the bug ID (see [test-plan.md](test-plan.md)) before setting the status to Verified.

Severity: **P1** = data loss, double booking, money wrong, security/privacy hole, or build broken. **P2** = feature broken, no workaround. **P3** = feature degraded, workaround exists. **P4** = cosmetic/minor.

Status: Open, In progress, Fixed (awaiting retest), Verified, Won't fix.

| ID | Severity | Area | Owner agent | Steps | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| BUG-001 | P2 | Cron / holds (HLD-07) | Database Engine | Open `src/app/api/cron/release-expired-holds/route.ts`; send `GET /api/cron/release-expired-holds` with `Authorization: Bearer $CRON_SECRET` | architecture.md: the route accepts Vercel Cron's `GET` | The route exports only `POST`, so Vercel Cron's GET would get 405 and holds would never be released in the cloud. Found by code reading in phase A; the engine may already be rewriting this file | Open |
| BUG-002 | P4 | Build (BLD-02) | Database Engine | `pnpm build` (seen during the e2e web-server build) | Clean build output | Turbopack warns that `path.resolve(process.env.FAKE_PAYMENTS_STATE_FILE ?? ...)` in `src/lib/payments/index.ts` makes the whole project traceable into the server bundle (slower deploys, possible size-limit failures on Vercel). Fix: scope the path or add `/*turbopackIgnore: true*/` | Open |
