# DriveEasy architecture and team contract

Read with [requirements.md](requirements.md). This file records the decisions every agent builds against. If a decision here turns out wrong, tell the team lead before changing it; do not silently diverge.

## Ground rules for all agents
- Next.js 16 has breaking changes versus older versions. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (see AGENTS.md).
- Add packages with `pnpm add` / `pnpm add -D`; never hand-edit dependency versions. If pnpm reports ignored build scripts, tell the team lead instead of approving them yourself.
- Do not commit. The team lead commits at phase boundaries.
- Stay inside your owned paths (below). Need a change elsewhere? Message the owner via the team lead.
- No cloud accounts, no deploys, no secrets in browser code. Server-only modules start with `import "server-only";`.
- Local settings live in `.env.local` (never print its values). Add every new variable to `.env.example` with no real value.

## Ports and databases (avoid collisions)
| Who | Dev server port | Database (`.env.local` key) |
|---|---|---|
| App Agent | 3000 | `DATABASE_URL` (driveeasy_dev) |
| Database Engine Agent | 3200 | `TEST_DATABASE_URL` (driveeasy_test) for its tests; seeds driveeasy_dev |
| QA Agent | 3100 (Playwright) | `QA_DATABASE_URL` (driveeasy_qa); may drop and recreate its schema freely |

## Ownership
| Area | Owner |
|---|---|
| `src/db/**`, `drizzle/**` (migrations), `scripts/seed*`, `scripts/db-*` | Database Engine |
| Domain services: `src/lib/{reservations,pricing,availability,payments,storage,jobs,auth,log,audit}/**` | Database Engine |
| Route handlers `src/app/api/**` (auth handler, payment webhooks, cron, private file serving) | Database Engine |
| `vercel.json`, deploy/migration scripts, db-related `package.json` scripts | Database Engine |
| Pages and layouts `src/app/**` (except `api/`), `src/components/**`, server actions in `src/app/**/actions.ts`, UI hooks/utilities in `src/lib/ui/**` | App |
| `tests/**` (Vitest integration), `e2e/**` (Playwright), `docs/test-plan.md`, `docs/bugs.md` | QA |
| `README.md`, `docs/architecture.md`, commits | Team lead |

The App Agent calls domain services; it never writes SQL or talks to payment/storage SDKs directly. Pages must never compute prices: the server-side pricing service is the single source of truth.

## Domain decisions
- **Currency**: AED. Money is `integer` fils (1 AED = 100 fils). Format with a shared helper `formatMoney(fils, "AED")`.
- **VAT**: 5% (UAE), configurable, applied to rental, extras and one-way fee; not to the security deposit. Round half-up to whole fils once, on the tax total.
- **Time**: `timestamptz` everywhere, stored UTC. Each branch has an IANA `timezone` (seed branches use `Asia/Dubai`). Render in the branch time zone.
- **Rental days**: ceil((return − pickup) / 24h), minimum 1. A 59-minute grace period applies to late returns before an extra day is charged; QA verifies this rule.
- **Rental period**: `period tstzrange` with half-open `[)` bounds, so a rental ending at 10:00 and the next starting at 10:00 do not overlap.
- **Overlap guarantee**: the database must make it impossible for one vehicle to have two overlapping active reservations, two overlapping maintenance blocks, or a reservation overlapping a maintenance block. Use `btree_gist` exclusion constraints, and handle the cross-table case (reservation vs maintenance block) in the database, not only in app code. "Active" reservation statuses: PENDING (hold not yet expired), CONFIRMED, PICKED_UP.
- **Holds**: a PENDING reservation is the temporary hold, with `hold_expires_at` (15 minutes). Expired holds stop blocking immediately (the booking transaction expires overlapping stale holds before checking) and are marked EXPIRED, with any payment/deposit voided, by the idempotent release job.
- **Reservation reference**: short unique human code, e.g. `DE-7K3M9Q`; the voucher QR encodes a signed payload (`QR_SIGNING_SECRET`), not raw ids.
- **Statuses**: vehicle, reservation, payment and deposit statuses are separate Postgres enums with the exact values in requirements.md (payment/deposit values are the engine's choice, mirroring `src/lib/payments/types.ts`).
- **Cancellation policy**: free cancellation until 48h before pick-up (full refund); within 48h a one-day charge is kept; no cancellation after pick-up. Date changes allowed until 48h before pick-up, re-priced and re-checked for availability in the same locked transaction.

## Platform decisions
- **Database driver**: node-postgres (`pg`) via Drizzle for both local and Neon. In production, `DATABASE_URL` is Neon's pooled URL; migrations use `DATABASE_URL_UNPOOLED`. Interactive transactions with `SELECT ... FOR UPDATE` are required, so do not use the Neon HTTP driver.
- **Migrations**: drizzle-kit generated SQL plus hand-written SQL for enums/exclusion constraints/triggers, committed in `drizzle/`. Deploy runs migrations before `next build` using the unpooled URL.
- **Auth**: Better Auth with email and password, Drizzle adapter, UUID ids. Tables `users` (with `role`: `customer` | `admin`), `sessions`, `accounts`, `verifications`. Server helpers `getSession()`, `requireUser()`, `requireAdmin()` in `src/lib/auth`. Every server action and route checks authorization itself; hiding a button is never the protection.
- **Payments**: `PaymentProvider` interface in `src/lib/payments` (extend as needed). `fake` is the default locally; also write a `stripe` adapter (test mode, PaymentIntents, deposit = manual-capture PaymentIntent), selected by `PAYMENT_PROVIDER=stripe`. Webhooks are verified, stored by event id and processed idempotently.
- **Files**: `FileStorage` interface in `src/lib/storage`. `local` is the default; also write a `vercel-blob` adapter selected by `STORAGE_DRIVER=vercel-blob`. Vehicle photos are public; licence and damage images are private and served only through an authorized route (owner or admin for licences, admin for damage reports). Never return a raw private blob URL to the browser.
- **Cron**: `/api/cron/release-expired-holds` accepts Vercel Cron's `GET` with `Authorization: Bearer $CRON_SECRET`; scheduled in `vercel.json`. Locally `pnpm jobs:release-holds`.
- **Logs**: structured JSON server logs through one `log` helper (`level`, `msg`, `requestId`, context); never log secrets or full card/licence data.
- **Audit**: admin actions and reservation state changes write `audit_logs` rows.
