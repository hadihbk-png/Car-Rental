import path from "node:path";
import { defineConfig } from "vitest/config";

// Three projects (engine = Database Engine Agent's src/**/*.db.test.ts against
// TEST_DATABASE_URL, run via `pnpm test:db`). QA's two:
//   unit        - `pnpm test`. Pure logic, never touches a database: every DB URL
//                 is replaced with an unreachable address so an accidental
//                 connection fails loudly instead of hitting dev data.
//   integration - `pnpm test:integration`. Runs serially against QA_DATABASE_URL
//                 (driveeasy_qa), which globalSetup drops, recreates and migrates.
const root = import.meta.dirname;
try {
  process.loadEnvFile(path.join(root, ".env.local"));
} catch {}

const NO_DATABASE = "postgres://unit-tests-must-not-use-a-database@127.0.0.1:1/none";

const shared = {
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/support/server-only.ts"),
    },
  },
};

export default defineConfig({
  ...shared,
  test: {
    environment: "node",
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.mts", "tests/unit/**/*.test.ts"],
          exclude: ["src/**/*.db.test.ts"],
          env: {
            DATABASE_URL: NO_DATABASE,
            DATABASE_URL_UNPOOLED: NO_DATABASE,
            TEST_DATABASE_URL: NO_DATABASE,
            QA_DATABASE_URL: NO_DATABASE,
          },
        },
      },
      {
        // Database Engine Agent's own DB-backed tests (driveeasy_test). Run with
        // `pnpm test:db`; owned by the Database Engine Agent.
        ...shared,
        test: {
          name: "engine",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["src/db/test-global-setup.ts"],
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            DATABASE_URL_UNPOOLED: process.env.TEST_DATABASE_URL ?? "",
            PAYMENT_PROVIDER: "fake",
            FAKE_PAYMENTS_WEBHOOK_URL: "",
            UPLOADS_DIR: path.resolve(root, "storage/test-uploads"),
            STORAGE_DRIVER: "local",
          },
        },
      },
      {
        ...shared,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/unit/**"],
          globalSetup: ["tests/setup/integration-global-setup.ts"],
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            DATABASE_URL: process.env.QA_DATABASE_URL ?? "",
            DATABASE_URL_UNPOOLED: process.env.QA_DATABASE_URL ?? "",
            // Keep test side effects out of the dev folders.
            UPLOADS_DIR: path.resolve(root, "storage/qa-uploads"),
            FAKE_PAYMENTS_STATE_FILE: path.resolve(root, ".local/qa-fake-payments.json"),
            FAKE_PAYMENTS_WEBHOOK_URL: "",
            PAYMENT_PROVIDER: "fake",
            STORAGE_DRIVER: "local",
          },
        },
      },
    ],
  },
});
