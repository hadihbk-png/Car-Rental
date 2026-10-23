# DriveEasy

DriveEasy is a car-rental web app for the UAE, with prices in AED. Customers search cars by branch and dates, add extras, upload their driving licence, and pay a rental charge plus a refundable security deposit. They then get a pick-up voucher with a QR code, and can change dates or cancel under the cancellation policy. Staff manage branches, the fleet, pricing, reservations, check-out and check-in, and damage reports.

Stack: Next.js 16 (App Router, TypeScript), Tailwind CSS 4, PostgreSQL with Drizzle ORM, Better Auth (email and password), Zod, Vitest and Playwright.

- Requirements: [docs/requirements.md](docs/requirements.md)
- Architecture and decisions: [docs/architecture.md](docs/architecture.md)
- Service API: [docs/service-api.md](docs/service-api.md)
- Test plan: [docs/test-plan.md](docs/test-plan.md); bug log: [docs/bugs.md](docs/bugs.md)

## Local setup

You need Node.js 24 (LTS), pnpm, Git, and PostgreSQL 16 or newer running locally.

1. **Install packages:** `pnpm install`
2. **Create the databases:** create a database user and three databases: `driveeasy_dev` (the app), `driveeasy_test` (engine tests) and `driveeasy_qa` (QA suites, reset freely). The first migration installs the `btree_gist` extension; the database user must be allowed to do that (it is a trusted extension, so a database owner can).
3. **Settings:** copy `.env.example` to `.env.local` and fill it in: the three database links, and long random secrets. Generate secrets with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
   Also set the seed account passwords (`SEED_ADMIN_PASSWORD`, `SEED_CUSTOMER_PASSWORD`).
4. **Database:**
   ```bash
   pnpm db:check     # connects to each database and checks btree_gist
   pnpm db:migrate   # applies drizzle/ migrations to DATABASE_URL
   pnpm db:seed      # branches, cars, extras, pricing, sample bookings, admin and customer logins
   ```
5. **Run:** `pnpm dev`, then open http://localhost:3000. Log in as `admin@driveeasy.test` or `customer@driveeasy.test`, using the passwords from `.env.local`.

### Local stand-ins for cloud services

Each one sits behind an interface and is chosen by a setting, so the cloud version replaces it without code changes.

| Service | Local | Setting |
|---|---|---|
| Payments | Fake provider. At checkout, pick a test card that succeeds, is declined, or stays pending (a webhook confirms it later). It sends signed webhooks, including duplicates (`FAKE_PAYMENTS_WEBHOOK_DUPLICATES`). | `PAYMENT_PROVIDER=fake` |
| File uploads | Private folder `storage/uploads` (outside `public/`, git-ignored). Files are served only through authorized routes. | `STORAGE_DRIVER=local` |
| Expired-hold cleanup | `pnpm jobs:release-holds` | `CRON_SECRET` protects the HTTP route |

## Environment variables

Every variable is listed, with comments, in [.env.example](.env.example). The main groups:

| Group | Variables |
|---|---|
| Database | `DATABASE_URL` (pooled, app requests), `DATABASE_URL_UNPOOLED` (migrations); Netlify DB's `NETLIFY_DATABASE_URL` and `NETLIFY_DATABASE_URL_UNPOOLED` also work; `TEST_DATABASE_URL`, `QA_DATABASE_URL` (local tests) |
| Auth | `BETTER_AUTH_SECRET`; `BETTER_AUTH_URL` / `APP_URL` (optional on Netlify and Vercel, which supply their own URLs); `BETTER_AUTH_TRUSTED_ORIGINS`; `AUTH_IP_HEADER` |
| QR | `QR_SIGNING_SECRET` (signs voucher payloads) |
| Payments | `PAYMENT_PROVIDER` (`fake` or `stripe`), `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_SECRET_KEY`, `NEXT_PUBLIC_PAYMENT_PUBLISHABLE_KEY`; fake only: `FAKE_PAYMENTS_STORE`, `ALLOW_FAKE_PAYMENTS`, `FAKE_PAYMENTS_WEBHOOK_URL` |
| Files | `STORAGE_DRIVER` (`local`, `netlify-blobs` or `vercel-blob`), `UPLOADS_DIR`, `NETLIFY_BLOBS_STORE`, `BLOB_READ_WRITE_TOKEN` |
| Jobs | `CRON_SECRET` |
| Other | `LOG_LEVEL`, `VAT_RATE_BPS` (default 500 = 5%), `DATABASE_POOL_MAX` |

Secrets are only ever read on the server. Only `NEXT_PUBLIC_PAYMENT_PUBLISHABLE_KEY` reaches the browser, and that key is designed to be public.

## Migrations

- Schema: [src/db/schema.ts](src/db/schema.ts). Migrations live in [drizzle/](drizzle/).
- `0001_overlap_guarantees.sql` is hand-written. It adds the `btree_gist` exclusion constraints and the triggers that make double-booking impossible: two overlapping bookings, two overlapping maintenance blocks, or a booking overlapping maintenance on the same car.
- After changing the schema: `pnpm db:generate`, review the SQL, then `pnpm db:migrate`.
- `pnpm db:reset` drops and recreates the local database. It refuses anything that isn't localhost, and refuses to run on Netlify.
- Deploys run migrations before the build, using the unpooled (direct) database link.

## Testing

| Command | What it runs | Database |
|---|---|---|
| `pnpm test` | Unit tests (pricing, time zones, payment provider, storage, UI helpers) | none (a guard test makes sure of it) |
| `pnpm test:db` | Engine tests: constraints, concurrency, booking transaction, payments | `driveeasy_test` |
| `pnpm test:integration` | QA suite: migrations on a clean database, races, holds, pricing, cancellations, payments and webhooks, authorization, search | `driveeasy_qa` (reset on each run) |
| `pnpm test:e2e` | Playwright on a production build at port 3100: desktop Chromium, Firefox and WebKit, plus iPhone and Pixel sizes | `driveeasy_qa` (reset and seeded) |
| `pnpm lint`, `pnpm typecheck` | ESLint; generated route types plus TypeScript | none |

`pnpm test:integration` and `pnpm test:e2e` both reset `driveeasy_qa`, so don't run them at the same time.

## Deploying to Netlify

The site deploys from the GitHub repository. [netlify.toml](netlify.toml) builds with Node 24, runs migrations when a database is set, builds Next.js, and deploys the scheduled cleanup function in [netlify/functions/](netlify/functions/).

1. **Database:** add **Netlify DB** (Neon) from Netlify's Extensions. It sets `NETLIFY_DATABASE_URL` and `NETLIFY_DATABASE_URL_UNPOOLED` for you. Any PostgreSQL with `btree_gist` also works through `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
2. **Environment variables** (Site configuration, Environment variables). Use different values for Production and Deploy previews:
   - `BETTER_AUTH_SECRET`, `QR_SIGNING_SECRET`, `CRON_SECRET`, `PAYMENT_WEBHOOK_SECRET`: long random strings
   - `STORAGE_DRIVER=netlify-blobs`
   - Payments, either:
     - **Stripe test mode:** `PAYMENT_PROVIDER=stripe`, `PAYMENT_SECRET_KEY` (`sk_test_…`), `NEXT_PUBLIC_PAYMENT_PUBLISHABLE_KEY` (`pk_test_…`), and `PAYMENT_WEBHOOK_SECRET` set to Stripe's `whsec_…`. Point a Stripe webhook at `https://<site>/api/webhooks/payments`.
     - **Demo with fake money:** `PAYMENT_PROVIDER=fake`, `ALLOW_FAKE_PAYMENTS=true`, `FAKE_PAYMENTS_STORE=netlify-blobs`
   - Leave `URL`, `DEPLOY_URL` and `DEPLOY_PRIME_URL` alone; Netlify supplies them. Set `BETTER_AUTH_URL` and `APP_URL` only for a custom domain.
3. **Deploy:** push to `main`, or trigger a deploy in Netlify. Migrations run during the build.
4. **Sample data (optional):** from your computer, put the Netlify database's direct link in `DATABASE_URL`, and set `STORAGE_DRIVER=netlify-blobs` with `NETLIFY_BLOBS_SITE_ID` and `NETLIFY_BLOBS_TOKEN` in `.env.local` (so the car photos go to Netlify Blobs). Then run `pnpm db:seed`, and remove those values afterwards. This path hasn't been tested yet.
5. **Check:** the home page lists branches, and Netlify's Functions page shows `release-expired-holds` running every 5 minutes.

Uploads are capped at 4 MB per file. Licence scans and damage photos are private, and are served only to the owner or to admins.

## Deploying to Vercel

The Vercel setup is kept too:
- `vercel.json` schedules the cleanup cron (calling `GET /api/cron/release-expired-holds` with `Bearer CRON_SECRET`), and the `vercel-build` script migrates and then builds.
- Use Neon from the Vercel Marketplace (`DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` direct), and set `STORAGE_DRIVER=vercel-blob` with `BLOB_READ_WRITE_TOKEN`. Payments use the same settings as on Netlify.
- A cron every 5 minutes needs a paid Vercel plan.

## Known limits

- The Stripe card form and Stripe adapter are written and unit-tested with mocks, but haven't been run against Stripe yet.
- Stripe card holds lapse after about 7 days, so rentals longer than that need a different deposit method.
- The demo fake-payment store on Netlify keeps one shared record, so the last write wins across server instances. Use it for demos only.
- Admin "today" views use one time zone (all seed branches use `Asia/Dubai`).
- QR scanning by camera needs a browser with BarcodeDetector (Chrome, Edge, Android). Typing or pasting the voucher code works everywhere.
