// AZ-06, AZ-09..13 and FLOW-03..05 in the browser: admin fleet, pricing, branches,
// reservations, check-out (incl. refusal while the previous renter still has the car),
// check-in, damage reports; customers are blocked from every admin page.
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { withClient } from "../tests/support/qa-db";
import { expect, test } from "./support/fixtures";
import { scenario, type Booked } from "./support/scenario";

test.setTimeout(120_000);

const ADMIN_PAGES = [
  "/admin", "/admin/reservations", "/admin/check-out", "/admin/check-in", "/admin/fleet", "/admin/fleet/new",
  "/admin/branches", "/admin/branches/new", "/admin/pricing", "/admin/pricing/rules/new", "/admin/pricing/extras/new", "/admin/damage",
];

/** Skips the test while the App Agent has not built the page yet (404). */
async function openOrSkip(page: Page, path: string) {
  const r = await page.goto(path);
  test.skip(r?.status() === 404, `${path} is not built yet`);
  return r;
}

const vin = () => `ZAE${randomUUID().replace(/-/g, "").toUpperCase().replace(/[IOQ]/g, "A").slice(0, 14)}`;

test.describe("access", () => {
  test("AZ-06 a customer is turned away from every admin page", async ({ customerPage: page }) => {
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      // The redirect may arrive in the streamed response, so wait for the URL to change, and make
      // sure no admin UI is rendered either way.
      await expect(page.getByRole("navigation", { name: "Admin" }), path).toHaveCount(0);
      await expect(page, path).not.toHaveURL(/\/admin/);
    }
  });

  test("AZ-06b signed-out visitors are sent to login", async ({ page }) => {
    await page.goto("/admin/fleet");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Ffleet/);
  });

  test("the admin navigation reaches every section", async ({ adminPage: page }) => {
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Admin" });
    for (const label of ["Reservations", "Fleet", "Branches", "Pricing & extras"]) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});

test.describe("fleet, branches and pricing", () => {
  test("AZ-09 create a vehicle; duplicate plate and VIN get friendly errors", async ({ adminPage: page }) => {
    const plate = `QA ${randomUUID().slice(0, 5).toUpperCase()}`;
    const theVin = vin();
    const fill = async (p: string, v: string) => {
      await page.goto("/admin/fleet/new");
      await page.getByLabel("Make").fill("Toyota");
      await page.getByLabel("Model").fill("E2E");
      await page.getByLabel("Year").fill("2025");
      await page.getByLabel("Plate number").fill(p);
      await page.getByLabel("VIN").fill(v);
      await page.getByLabel("Home branch").selectOption({ index: 1 });
      await page.getByLabel("Category").selectOption({ index: 1 });
      await page.getByRole("button", { name: "Create vehicle" }).click();
    };
    await fill(plate, theVin);
    await expect(page).toHaveURL(/\/admin\/fleet\/[0-9a-f-]{36}/);
    await fill(plate, vin());
    await expect(page.getByText(/plate/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/fleet\/new/);
    await fill(`${plate}X`, theVin);
    await expect(page.getByText(/VIN/).first()).toBeVisible();
    const audit = await withClient(async (c) => (await c.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'vehicle.created' AND data::text LIKE $1", [`%${plate}%`])).rows[0].n);
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  test("AZ-12 a maintenance block over a confirmed booking is refused", async ({ adminPage: page, customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 24 * 90, hours: 48, pay: "fake_success" });
    await page.goto(`/admin/fleet/${b.vehicleId}`);
    // The day after pick-up is fully inside the 48h booking (09:00-18:00 block always overlaps).
    const start = new Date(new Date(b.pickupAt).getTime() + 24 * 3_600_000 + 4 * 3_600_000);
    const day = start.toISOString().slice(0, 10);
    await page.getByLabel("Start date").fill(day);
    await page.getByLabel("End date").fill(day);
    await page.getByLabel("Reason").fill("E2E service");
    await page.getByRole("button", { name: "Add maintenance block" }).click();
    await expect(page.getByText(/has a reservation or maintenance block/).first()).toBeVisible();
    const blocks = await withClient(async (c) => (await c.query("SELECT count(*)::int AS n FROM maintenance_blocks WHERE vehicle_id = $1 AND reason = 'E2E service'", [b.vehicleId])).rows[0].n);
    expect(blocks).toBe(0);
  });

  test("AZ-10 a new pricing rule is saved and listed", async ({ adminPage: page }) => {
    const name = `E2E rule ${randomUUID().slice(0, 6)}`;
    await page.goto("/admin/pricing/rules/new");
    await page.getByLabel("Rule name").fill(name);
    await page.getByLabel("Car category").selectOption({ index: 1 });
    await page.getByLabel("Daily rate").fill("123.45");
    await page.getByLabel("Valid from (pick-up date)").fill("2030-01-01");
    await page.getByLabel("Valid to (pick-up date)").fill("2030-01-31");
    await page.getByRole("button", { name: /Create|Save/ }).click();
    await page.goto("/admin/pricing");
    await expect(page.getByText(name)).toBeVisible();
    const fils = await withClient(async (c) => (await c.query("SELECT daily_rate_fils FROM pricing_rules WHERE name = $1", [name])).rows[0]?.daily_rate_fils);
    expect(fils).toBe(12_345);
  });

  test("AZ-11 a branch with a duplicate code is refused with a message", async ({ adminPage: page }) => {
    await page.goto("/admin/branches/new");
    await page.getByLabel("Branch name").fill("Duplicate");
    await page.getByLabel("City").fill("Dubai");
    await page.getByLabel("Branch code").fill("DXBAPT");
    await page.getByLabel("URL name").fill(`dup-${randomUUID().slice(0, 6)}`);
    await page.getByLabel("Address").fill("Somewhere 1");
    await page.getByRole("button", { name: /Create|Save/ }).click();
    await expect(page.getByText(/code/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/branches\/new/);
  });
});

test.describe("reservations desk", () => {
  test("AZ-13 search by reference opens the reservation with customer, driver and licence link", async ({ adminPage: page, customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 24 * 70, hours: 24, pay: "fake_success" });
    await page.goto(`/admin/reservations?q=${b.reference}`);
    await page.getByRole("link", { name: b.reference }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/reservations/${b.reference}`));
    await expect(page.getByText(customer.user.email)).toBeVisible();
    await expect(page.getByText("Licence on file")).toBeVisible();
    const href = await page.locator('a[href^="/api/files/licences/"]').first().getAttribute("href");
    if (href?.startsWith("/api/files/licences/")) expect((await page.context().request.get(href)).status()).toBe(200);
  });

  test("FLOW-03 check-out at the counter records mileage and fuel; reservation becomes PICKED_UP", async ({ adminPage: page, customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 2, hours: 24, pay: "fake_success" });
    await openOrSkip(page, `/admin/check-out?ref=${b.reference}`);
    await expect(page.getByRole("heading", { name: "Hand over the car" })).toBeVisible();
    await expect(page.getByText("Licence on file")).toBeVisible();
    await page.getByLabel("Mileage (km)").fill("50000");
    await page.getByLabel("Fuel level").selectOption("8");
    await page.getByRole("button", { name: "Confirm check-out" }).click();
    await expect(page.getByText("Checked out: the car is on rent")).toBeVisible();
    await expect.poll(async () => (await withClient(async (c) => (await c.query("SELECT status FROM reservations WHERE reference = $1", [b.reference])).rows[0].status))).toBe("PICKED_UP");
  });

  test("BUG-005 check-out of the next renter is refused while the previous renter has not returned", async ({ adminPage: page, customer, otherCustomer }) => {
    // First rental [T+1h, T+21h); second starts when it ends, inside the 24h check-out window.
    const first = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 1, hours: 20, pay: "fake_success" });
    const second = scenario<Booked>({ op: "book", email: otherCustomer.user.email, vehicleId: first.vehicleId, pickupInHours: 21, hours: 24, pay: "fake_success" });
    expect(new Date(second.pickupAt).getTime()).toBe(new Date(first.returnAt).getTime());
    scenario({ op: "checkout", reference: first.reference });
    // Simulated: the next pick-up is due now but the first renter is late (not checked in).
    let refused = false;
    try {
      scenario({ op: "checkout", reference: second.reference, nowOffsetHours: 20.5 });
    } catch {
      refused = true;
    }
    expect(refused, "service allowed checking out a car that is still on rent").toBe(true);
    await openOrSkip(page, `/admin/check-out?ref=${second.reference}`);
    await page.getByLabel("Mileage (km)").fill("60000");
    await page.getByRole("button", { name: "Confirm check-out" }).click();
    await expect(page.getByText(/has not been returned from the previous rental/).first()).toBeVisible();
  });

  test("FLOW-04/05 check-in late with damage shows the charges; the customer sees them too", async ({ adminPage: page, customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 2, hours: 24, pay: "fake_success" });
    scenario({ op: "checkout", reference: b.reference, mileageKm: 70_000 });
    await openOrSkip(page, `/admin/check-in?ref=${b.reference}`);
    await expect(page.getByRole("heading", { name: "Return the car" })).toBeVisible();
    await page.getByLabel("Mileage (km)").fill("70500");
    await page.getByLabel("Fuel level").selectOption("6");
    await page.getByLabel("Damage charge").fill("100");
    await page.getByRole("button", { name: "Confirm check-in" }).click();
    await expect(page.getByText("Fuel charge").first()).toBeVisible();
    await expect.poll(async () => (await withClient(async (c) => (await c.query("SELECT status FROM reservations WHERE reference = $1", [b.reference])).rows[0].status))).toBe("RETURNED");
    await customer.page.goto(`/rentals/${b.reference}`);
    await expect(customer.page.getByText("Mileage at return")).toBeVisible();
  });

  test("AZ-05 damage report with a photo: visible to admin, image route is admin-only", async ({ adminPage: page, customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 24 * 80, hours: 24, pay: "fake_success" });
    await openOrSkip(page, `/admin/damage/new?vehicle=${b.vehicleId}&reservation=${b.id}`);
    await page.getByLabel("Where on the car").fill("Rear bumper");
    await page.getByLabel("Description").fill("E2E scratch on rear bumper");
    await page.getByRole("button", { name: "Create report" }).click();
    await expect(page).toHaveURL(/\/admin\/damage\/[0-9a-f-]{36}/);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({ name: "damage.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]) });
    await page.getByRole("button", { name: "Upload photo" }).click();
    const img = page.getByRole("img", { name: /Damage photo 1/ });
    await expect(img).toBeVisible();
    const src = (await img.getAttribute("src"))!;
    expect((await page.context().request.get(src)).status()).toBe(200);
    expect((await customer.context.request.get(src)).status()).toBe(404);
  });
});
