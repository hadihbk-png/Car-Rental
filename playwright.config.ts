import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile(".env.local");
} catch {}

// QA runs on its own port and database (docs/architecture.md): port 3100,
// QA_DATABASE_URL (driveeasy_qa), separate uploads folder and fake-payment state.
const port = 3100;
const baseURL = `http://localhost:${port}`;
const qaDb = process.env.QA_DATABASE_URL ?? "";

// Server modes:
//   default          next build + next start (production settings; also works while
//                    another agent's `next dev` holds the .next/dev lock)
//   E2E_SKIP_BUILD=1 next start on the existing production build
//   E2E_SERVER=dev   next dev (only when no other `next dev` runs in this folder)
const prepare = "node --import tsx e2e/support/prepare-db.mts";
const serverCommand =
  process.env.E2E_SERVER === "dev"
    ? `${prepare} && pnpm exec next dev --port ${port}`
    : process.env.E2E_SKIP_BUILD === "1"
      ? `${prepare} && pnpm exec next start --port ${port}`
      : `${prepare} && pnpm exec next build && pnpm exec next start --port ${port}`;

const CROSS_BROWSER = ["smoke.spec.ts", "layout.spec.ts", "auth.spec.ts", "public/**/*.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // Specs share one database; keep parallelism modest and isolate by unique users/data.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  // Data-heavy flows (booking, rentals, admin) run on one desktop and one phone project; public pages,
  // auth and layout run on all five.
  projects: [
    // Desktop
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "desktop-firefox", testMatch: CROSS_BROWSER, use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
    { name: "desktop-webkit", testMatch: CROSS_BROWSER, use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    // Mobile: iPhone 13 is 390x844; Pixel 7 is 412x915.
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
    { name: "mobile-chromium", testMatch: CROSS_BROWSER, use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: serverCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE_SERVER !== "0",
    timeout: 300_000,
    stdout: process.env.E2E_SERVER_LOGS === "1" ? "pipe" : "ignore",
    stderr: "pipe",
    // Browser tests run against the QA database, never dev data.
    env: {
      DATABASE_URL: qaDb,
      DATABASE_URL_UNPOOLED: qaDb,
      APP_URL: baseURL,
      BETTER_AUTH_URL: baseURL,
      // Rate limits are per client IP; each test context sends its own x-forwarded-for.
      AUTH_IP_HEADER: "x-forwarded-for",
      PAYMENT_PROVIDER: "fake",
      FAKE_PAYMENTS_WEBHOOK_URL: `${baseURL}/api/webhooks/payments`,
      FAKE_PAYMENTS_WEBHOOK_DUPLICATES: process.env.E2E_WEBHOOK_DUPLICATES ?? "0",
      FAKE_PAYMENTS_STATE_FILE: path.resolve(".local/qa-fake-payments.json"),
      STORAGE_DRIVER: "local",
      UPLOADS_DIR: path.resolve("storage/qa-uploads"),
    },
  },
});
