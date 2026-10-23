// Playwright fixtures. Import { test, expect } from here instead of
// @playwright/test in specs that need signed-in users.
//
//   customer / customerPage   - a fresh customer, signed in (own browser context)
//   otherCustomer / otherPage - a second, unrelated customer (IDOR + concurrency)
//   admin / adminPage         - a fresh user promoted to admin, signed in
//
// Each signed-in page lives in its own BrowserContext (separate cookies =
// separate sessions), so two pages can race for the same vehicle.
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { newUser, promoteToAdmin, registerViaApi, signInViaApi, type TestUser } from "./auth";
import { resetData } from "./reset";

export type SignedIn = { user: TestUser; page: Page; context: BrowserContext };

type Fixtures = {
  customer: SignedIn;
  otherCustomer: SignedIn;
  admin: SignedIn;
  customerPage: Page;
  otherPage: Page;
  adminPage: Page;
};

type WorkerFixtures = { resetHook: void };

/**
 * Better Auth rate-limits sign-up/sign-in per client IP (3 per 10 s in production builds). Every
 * test context presents its own client address, as real users would, so parallel tests do not
 * share one bucket. (Locally nothing rewrites x-forwarded-for; on Vercel the platform sets it.)
 */
export function randomClientIp() {
  const b = () => 1 + Math.floor(Math.random() * 250);
  return `10.${b()}.${b()}.${b()}`;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": randomClientIp() });
  },
  // Reset/seed hook, once per worker. Placeholder until phase B (see ./reset.ts).
  resetHook: [
    async ({}, provide) => {
      await resetData();
      await provide();
    },
    { scope: "worker", auto: true },
  ],

  customer: async ({ browser }, provide, testInfo) => {
    await withSignedIn(browser, testInfo, newUser("customer"), false, provide);
  },
  otherCustomer: async ({ browser }, provide, testInfo) => {
    await withSignedIn(browser, testInfo, newUser("customer", "other"), false, provide);
  },
  admin: async ({ browser }, provide, testInfo) => {
    await withSignedIn(browser, testInfo, newUser("admin"), true, provide);
  },
  customerPage: async ({ customer }, provide) => provide(customer.page),
  otherPage: async ({ otherCustomer }, provide) => provide(otherCustomer.page),
  adminPage: async ({ admin }, provide) => provide(admin.page),
});

/** Context options matching the running project's device (viewport, UA, touch, ...). */
export function projectContextOptions(testInfo: TestInfo): BrowserContextOptions {
  const u = testInfo.project.use;
  return {
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    locale: u.locale,
    timezoneId: u.timezoneId ?? "Asia/Dubai",
    extraHTTPHeaders: { "x-forwarded-for": randomClientIp() },
  };
}

async function withSignedIn(
  browser: Browser,
  testInfo: TestInfo,
  user: TestUser,
  asAdmin: boolean,
  provide: (s: SignedIn) => Promise<void>,
) {
  const options = projectContextOptions(testInfo);
  const context = await browser.newContext(options);
  try {
    await registerViaApi(context.request, options.baseURL!, user);
    if (asAdmin) {
      await promoteToAdmin(user.email);
      // Fresh session so the new role is picked up.
      await signInViaApi(context.request, options.baseURL!, user);
    }
    await provide({ user, page: await context.newPage(), context });
  } finally {
    await context.close();
  }
}

export { expect };
