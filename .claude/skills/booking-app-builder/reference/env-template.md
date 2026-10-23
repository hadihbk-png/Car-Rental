# Settings template (no values)

`.env.local` holds local values and is never committed. `.env.example` lists every variable with no value. In Vercel, set separate Preview and Production values.

| Variable | Local | Cloud | Notes |
|---|---|---|---|
| `DATABASE_URL` | local `<app>_dev` link | Neon **pooled** URL | App requests |
| `DATABASE_URL_UNPOOLED` | (same as above) | Neon direct URL | Migrations during the build |
| `TEST_DATABASE_URL` | `<app>_test` | n/a | Engine tests |
| `QA_DATABASE_URL` | `<app>_qa` | n/a | QA suites and browser runs |
| `DATABASE_POOL_MAX` | optional | optional | Connections per instance |
| `POSTGRES_ADMIN_URL` | superuser link | n/a | Local admin tasks only |
| `APP_URL` | `http://localhost:3000` | deployment URL | |
| `LOG_LEVEL` | optional | optional | debug, info, warn, error |
| `VAT_RATE_BPS` | optional | optional | Tax in basis points |
| `BETTER_AUTH_SECRET` | generated | generated, per environment | Long random string |
| `BETTER_AUTH_URL` | local URL | deployment URL | |
| `BETTER_AUTH_TRUSTED_ORIGINS` | optional | preview URLs | |
| `QR_SIGNING_SECRET` | generated | generated | Signs voucher QR payloads |
| `PAYMENT_PROVIDER` | `fake` | `stripe` | Switches the adapter |
| `PAYMENT_WEBHOOK_SECRET` | generated | provider's webhook signing secret | |
| `PAYMENT_SECRET_KEY` | n/a | provider secret key (test mode first) | Server only |
| `NEXT_PUBLIC_PAYMENT_PUBLISHABLE_KEY` | n/a | provider publishable key | Browser safe |
| `FAKE_PAYMENTS_WEBHOOK_URL` | local webhook route | n/a | Fake provider only |
| `FAKE_PAYMENTS_WEBHOOK_DUPLICATES` | `0` | n/a | Above 0 sends duplicate webhooks |
| `FAKE_PAYMENTS_STATE_FILE` | `.local/...json` | n/a | Git-ignored |
| `STORAGE_DRIVER` | `local` | `vercel-blob` | Switches the adapter |
| `UPLOADS_DIR` | `storage/uploads` | n/a | Outside `public/`, git-ignored |
| `BLOB_READ_WRITE_TOKEN` | n/a | from the Blob integration | |
| `CRON_SECRET` | generated | generated | Bearer token for the cron route |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | dev only | never in production | |
| `SEED_CUSTOMER_EMAIL` / `SEED_CUSTOMER_PASSWORD` | dev only | never in production | |

Generate secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
