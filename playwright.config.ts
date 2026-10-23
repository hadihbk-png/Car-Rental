import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile(".env.local");
} catch {}

const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // Browser tests run against the test database, never dev data.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
  },
});
