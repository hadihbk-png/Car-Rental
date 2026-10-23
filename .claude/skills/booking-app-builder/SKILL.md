---
name: booking-app-builder
description: Use this skill when building any booking or reservation web app with a three-agent team (App, Database Engine, QA), local first and ready to move to Vercel later.
---

# Booking App Builder

A proven recipe for building a production-grade booking app with three agents. It was distilled from building DriveEasy, a car-rental app: Next.js App Router, TypeScript, Tailwind, PostgreSQL with Drizzle, Better Auth, a payment provider with deposit holds, and private file uploads.

Reference files in this folder:
- [reference/tables.md](reference/tables.md): the full table list, with what each table is for
- [reference/overlap-migration.sql](reference/overlap-migration.sql): a sample migration that blocks double-booking in the database
- [reference/team-contract-template.md](reference/team-contract-template.md): the shared contract every agent reads first
- [reference/env-template.md](reference/env-template.md): every setting, local and cloud, with no values

---

## 1. When to use this skill

Use it when people reserve a **limited resource for a time period**, and money or trust depends on the app never double-booking. It fits:
- vehicle, bike, scooter or equipment rental
- hotel rooms, holiday homes, campsites
- meeting rooms, coworking desks, sports courts
- clinic, salon or tutoring appointments (the resource is a person's calendar)
- event spaces, studios, boat charters, parking bays

Signs it fits: a resource has a calendar; bookings have a start and an end; you take a payment or a refundable deposit; staff check things out and back in.

Not a fit: ticketing with unlimited seats, or simple contact or enquiry forms.

---

## 2. Step 0: local setup

Everything runs on the developer's machine first. No cloud accounts until the owner hands them over.

**Tools** (check what's installed; only install what is missing or out of date):
- Node.js **LTS** (check `https://nodejs.org/dist/index.json` for the newest entry with `lts` set; an odd-numbered "Current" release is not LTS), npm, pnpm, Git
- PostgreSQL (latest stable) running as a local service
- Installer per OS: winget on Windows, Homebrew on macOS, apt on Linux

**Local database:**
- One app user; three databases: `<app>_dev` (the app), `<app>_test` (engine tests), `<app>_qa` (the QA agent's playground, reset freely)
- Install `btree_gist` in each database (the migration should also `CREATE EXTENSION IF NOT EXISTS btree_gist`)
- Add a `db:check` script that connects to each database and confirms the extension is installed

**Project:** Next.js (TypeScript, App Router, Tailwind, ESLint), Drizzle ORM + drizzle-kit + `pg`, Zod, an email/password auth library, a QR library, Vitest, Playwright plus its browsers.

**Local stand-ins, each behind an interface and chosen by a setting:**

| Concern | Interface | Local stand-in | Setting |
|---|---|---|---|
| Payments | `PaymentProvider`: create, cancel, refund, hold deposit, release, capture, verify webhook | Fake provider whose test payment methods make a payment succeed, decline or stay pending; signs webhooks with HMAC; can send duplicate webhooks; keeps its state in a JSON file | `PAYMENT_PROVIDER=fake` |
| Files | `FileStorage`: put, get, exists, delete | Private folder outside `public/` (refuse to start if it is inside), key validation against `..` | `STORAGE_DRIVER=local` |
| Scheduled cleanup | One job function | `pnpm jobs:release-holds` locally; a cron route in the cloud | `CRON_SECRET` |

**Safety:** `.env.local` holds the local links and generated secrets; `.env.example` lists every variable with no values. The `.gitignore` must ignore `.env*` but un-ignore `!.env.example`, and must ignore the uploads and local-state folders. Make the first commit only after checking that no secrets are staged.

---

## 3. The three-agent team

A team lead (the main session) coordinates. Each agent owns paths and never edits another agent's paths.

| Agent | Owns | Delivers |
|---|---|---|
| **Database Engine** | `src/db`, migrations, seed, domain services in `src/lib/*`, `src/app/api/*`, `vercel.json` | Schema, constraints, auth, booking transaction, pricing, payments, webhooks, cron, private file routes, cloud adapters, its own database tests |
| **App** | Pages and layouts (not `api/`), components, server actions, UI helpers | Design system, every screen wired to real services, loading/empty/error states, desktop and mobile |
| **QA** | `tests/`, `e2e/`, test configs, `docs/test-plan.md`, `docs/bugs.md` | Test plan mapped to every requirement, unit/integration/browser suites, bug reports, retests |

**Shared task list and contract:**
- `docs/requirements.md`: the owner's prompt, word for word
- `docs/architecture.md`: decisions everyone builds against (see [the template](reference/team-contract-template.md))
- `docs/service-api.md`: the engine's published API, which the App and QA build from
- `docs/bugs.md`: the bug log (ID, severity, area, owner, steps, expected, actual, status)

**Flow:**
1. All three start together. The engine builds the foundation; the App builds the design system and components that don't need data; QA writes the test plan and harness.
2. The engine sends **milestones** to the lead: (a) schema + seed + auth ready, (b) all services ready. The lead forwards the API so the App starts on data pages early.
3. QA reports each bug **as soon as it is found**: it logs the bug in `docs/bugs.md` and messages the lead with ID, severity, owner and a one-line summary.
4. The lead routes the bug to its owner. The owner fixes it, adds a regression test and marks it **Fixed**. QA retests and marks it **Verified** or **Reopened**.
5. Agents never commit; the lead commits at phase boundaries after re-running the checks.
6. Business-rule gaps (who pays a balance, what a late return costs) go to the lead; the lead decides or asks the owner.

**Avoid collisions:** each agent gets its own port and database. Run one shared `next dev` (the lead's). QA's browser runs use `next build` + `next start` on another port, and only when nobody else is building.

---

## 4. Database rules

- **UUID primary keys** everywhere (`gen_random_uuid()`).
- **UTC times:** every timestamp is `timestamptz`. Each location (branch, hotel, clinic) stores an IANA time zone, and the UI shows times in that zone.
- **Money in minor units:** integer cents/fils/pence. Never floats. Round VAT once, on the tax total.
- **Statuses** are Postgres enums, kept separate:
  - resource: `AVAILABLE, RESERVED, ON_RENT, MAINTENANCE, RETIRED`
  - booking: `PENDING, CONFIRMED, PICKED_UP, RETURNED, CANCELLED, EXPIRED, REFUNDED`
  - payment and deposit: their own enums, mirroring the payment interface
- **Constraints:** foreign keys with deliberate rules (restrict on money and history, cascade on child rows, set null on "who did it" links). Check constraints (for example, total equals the sum of its parts). Unique codes, plates and serial numbers.
- **Blocking double-booking in the database itself:**
  - Store each booking period as `tstzrange` with half-open `[)` bounds, so 10:00 to 12:00 and 12:00 to 14:00 don't overlap.
  - Add a `btree_gist` **exclusion constraint** on `(resource_id WITH =, period WITH &&)` for active statuses (`PENDING`, `CONFIRMED`, `PICKED_UP`).
  - Add the same constraint on maintenance or closure blocks.
  - An exclusion constraint cannot span two tables. For booking vs maintenance, use **BEFORE triggers that lock the resource row** and raise `exclusion_violation`. See [overlap-migration.sql](reference/overlap-migration.sql).
  - App code checks first for nice error messages; the database is the final guarantee.

Full table list: [reference/tables.md](reference/tables.md).

---

## 5. The booking transaction

1. Begin a transaction.
2. `SELECT ... FOR UPDATE` the resource row, so concurrent bookings for it wait their turn.
3. Mark any overlapping `PENDING` holds whose `hold_expires_at` has passed as `EXPIRED`, so stale holds stop blocking immediately instead of waiting for cron.
4. Check that no active booking or maintenance block overlaps the requested period. If one does, reject with a clear "no longer available" error.
5. Calculate on the server: rate rule, number of days, extras, one-way or location fee, tax, deposit.
6. Insert the `PENDING` booking with `hold_expires_at` (for example, 15 minutes) and its **idempotency key** (unique per user). If the key already exists, return the existing booking.
7. Commit. A unique or exclusion violation here means a race was lost; map it to "no longer available".
8. Payment step: hold the deposit, then charge **only the outstanding amount**. Confirm only when the payment has succeeded **and** the deposit is held.
9. Webhooks are verified, stored by event id and processed once. A success for an already-paid, cancelled or expired booking is **refunded automatically**.
10. Cleanup job (cron or CLI): expire overdue holds and void their payments and deposits. Running it twice must be harmless.

Changing dates and cancelling go through the same locked path. Allow date changes only on `CONFIRMED` bookings, re-price them, charge the difference, and refund any decrease.

---

## 6. QA checklist (all must pass before "finished")

**Database and engine**
- [ ] Migrations run cleanly on an **empty** database (drop every schema, including the extension, then migrate)
- [ ] Two sessions racing for the same resource and dates: **exactly one succeeds** (repeat 10 times; 2 to 5 parallel connections)
- [ ] Back-to-back bookings (one ends exactly when the next starts) are both allowed
- [ ] Booking vs maintenance overlap is rejected by the database, in both directions
- [ ] Expired holds stop blocking and are released; running the release job again changes nothing
- [ ] Pricing: rate rules, days rounding and grace period, extras, location fees, tax rounding, late and fuel charges, deposit

**Payments (fake provider)**
- [ ] Success, decline, cancel, retry with a new key, same key returns the same result
- [ ] Refund (partial and full), deposit hold, release and capture
- [ ] Duplicate and concurrent webhooks processed once; tampered or stale signatures rejected
- [ ] Pending payment then retry: never charged twice
- [ ] Date change while a payment is in flight: no stuck or double-charged booking
- [ ] Return charges above the deposit become a collectable balance

**Security**
- [ ] Register, log in, log out; role cannot be set at sign-up
- [ ] Other users get "not found" for someone else's bookings, vouchers and private files
- [ ] Every admin action is refused for non-admins, in the service and not just in the UI
- [ ] Cron and webhook routes reject a missing or wrong secret

**Browser**
- [ ] The full flow: search, details, extras, driver/guest details plus upload, checkout, voucher with QR
- [ ] My bookings: view, change dates, cancel by policy; admin check-out and check-in, damage reports
- [ ] Desktop (Chromium, Firefox, WebKit) and mobile (about 390×844 and 412×915); no sideways scroll
- [ ] Production build passes (`next build` with production settings); lint and typecheck are clean

---

## 7. Moving to the cloud later

Only settings change; the adapters already exist behind the interfaces.

| Area | Local | Cloud |
|---|---|---|
| Database | local PostgreSQL | Neon via Vercel Marketplace: `DATABASE_URL` = **pooled** URL for the app, `DATABASE_URL_UNPOOLED` = direct URL for migrations. Keep `pg` (interactive transactions with row locks need it; the HTTP driver can't). |
| Migrations | `pnpm db:migrate` | `vercel-build` runs migrations with the unpooled URL, then `next build`. Preview deployments use a Neon branch. |
| Files | `STORAGE_DRIVER=local` | `STORAGE_DRIVER=vercel-blob` + `BLOB_READ_WRITE_TOKEN`. Private files use private blobs, served only through authorized routes. |
| Payments | `PAYMENT_PROVIDER=fake` | `PAYMENT_PROVIDER=stripe` + secret key (server only), publishable key (browser), webhook signing secret. Deposit = manual-capture PaymentIntent. |
| Cleanup | `pnpm jobs:release-holds` | `vercel.json` cron calls `GET /api/cron/...` with `Authorization: Bearer $CRON_SECRET` |
| Auth | local URL | `BETTER_AUTH_URL` per environment; add preview URLs to trusted origins |

Set separate values for Preview and Production in Vercel. Secrets never get a `NEXT_PUBLIC_` prefix. All variables: [reference/env-template.md](reference/env-template.md).

---

## 8. Lessons learned (real problems from DriveEasy)

**Setup**
- **An installed Node wasn't LTS** (an odd-numbered Current release), and an old second copy sat lower on PATH. Fix: check the LTS index, replace the active install, and leave the shadowed copy alone.
- **The Windows installer hung** waiting on an unseen admin prompt, then failed with error 1618 (another install in progress). Fix: put all admin steps in one elevated script so there's one prompt; clear the stuck Windows Installer before retrying.
- **The folder name had a space and capitals**, so it was invalid as an npm package name. Fix: generate the app in a temp folder under a valid name, then copy it in.
- **The scaffold's `.gitignore` ignored `.env.example` too.** Fix: add `!.env.example`.
- **pnpm blocks dependency build scripts** (esbuild). Fix: approve known packages by name in `allowBuilds`, never "allow all".
- **Scripts with top-level `await` failed** under CommonJS. Fix: name them `.mts`. Also rename the Vitest config to `.mts`.
- **Typecheck failed on route types** Next generates. Fix: `next typegen && tsc --noEmit`.
- **Agent teams didn't turn on** until Claude Code restarted. Fallback: lead plus three named background agents gave the same workflow.

**Framework and platform**
- **This Next.js version differs from older knowledge.** Read the bundled docs in `node_modules/next/dist/docs/` before writing framework code.
- **Only one `next dev` runs per folder.** Fix: one shared dev server; QA runs build + start on its own port.
- **Server actions cap request bodies at 1MB, and Vercel Functions cap them at 4.5MB.** Fix: one shared 4MB per-file limit, with `serverActions.bodySizeLimit` set to `"4.5mb"`.
- **The cron route only accepted POST**, but Vercel Cron sends GET. Fix: accept both, with the same Bearer check.
- **`path.resolve` at module scope** made the bundler trace the whole project. Fix: resolve paths lazily inside the factory.
- **Stripe card holds lapse after about 7 days**, so long rentals need another deposit method. Five-minute cron needs a paid Vercel plan.

**Business logic bugs QA caught**
- **A failed validation check still ran the next one**, which crashed with a raw `RangeError` instead of a field error. Fix: guard dependent checks.
- **Double charge:** a pending payment was followed by a successful retry, and then the first payment also succeeded. Fix: cancel earlier pending attempts, and refund any payment that arrives once the booking is already paid.
- **A date change while a payment was pending** left the booking stuck, and paying again charged the full total. Fix: allow date changes only when confirmed, and always charge only the outstanding amount.
- **Back-to-back hand-over while the previous renter was still out** (a late return). Fix: refuse check-out while the resource is out, and set its status from its real state at check-in.
- **Return charges above the deposit were recorded but never collected.** Fix: record them as a balance due that the customer can pay, with an admin filter.
- **Separate databases per agent** prevented flaky collisions. A guard test keeps the plain `pnpm test` from ever touching a database.
