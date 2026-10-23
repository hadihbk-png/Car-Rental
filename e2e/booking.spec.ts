// FLOW-01/02/06/09, PAY-01..04, PRC-22, CON-08/09 in the browser: search -> vehicle -> extras ->
// driver details + licence -> review -> pay with the fake test card -> voucher with QR.
import type { Page } from "@playwright/test";
import { withClient } from "../tests/support/qa-db";
import { airportBranch, dubaiDate, dubaiInstant, expectedAvailable } from "./support/data";
import { expect, test } from "./support/fixtures";
import { scenario } from "./support/scenario";

test.describe.configure({ mode: "serial" }); // shares a handful of seeded cars; avoids picking the same one twice
test.setTimeout(120_000);

let dayOffset = 60;
/** A free car at the airport branch for a fresh 2-day window (each call uses new dates). */
async function freeTrip() {
  const b = await airportBranch();
  dayOffset += 3 + Math.floor(Math.random() * 40);
  const from = dubaiDate(dayOffset);
  const to = dubaiDate(dayOffset + 2);
  const cars = await expectedAvailable(b.id, dubaiInstant(from, "10:00"), dubaiInstant(to, "10:00"));
  expect(cars.length, "no free car in the seed for this window").toBeGreaterThan(0);
  return { branch: b, from, to, car: cars[Math.floor(Math.random() * cars.length)] };
}

function vehicleUrl(t: Awaited<ReturnType<typeof freeTrip>>) {
  const q = new URLSearchParams({ pickupBranch: t.branch.slug, pickupDate: t.from, pickupTime: "10:00", returnDate: t.to, returnTime: "10:00" });
  return `/vehicles/${t.car.id}?${q}`;
}

async function fillDriverDetails(page: Page, name: string) {
  await page.getByLabel("Full name (as on licence)").fill(name);
  await page.getByLabel("Mobile phone").fill("+971 50 123 4567");
  await page.getByLabel("Date of birth").fill("1990-05-05");
  await page.getByLabel("Nationality").fill("UAE");
  await page.getByLabel("Licence number").fill("E2E-12345");
  await page.getByLabel("Licence issued in (country)").fill("UAE");
  await page.getByLabel("Licence expiry date").fill("2035-12-31");
  await page.getByRole("button", { name: /Save driver details|Save changes/ }).click();
}

async function uploadLicence(page: Page) {
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "licence.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3]),
  });
  await page.getByRole("button", { name: /Upload licence|Upload new licence/ }).click();
}

/** From the vehicle page to the payment page. Returns the reservation reference. */
async function reserve(page: Page, t: Awaited<ReturnType<typeof freeTrip>>, opts: { extras?: boolean; driverDone?: boolean } = {}) {
  await page.goto(vehicleUrl(t));
  await expect(page.getByRole("heading", { name: "Your trip" })).toBeVisible();
  if (opts.extras) {
    // Seed extras: Child seat (qty select), GPS navigation (checkbox), Full insurance cover (checkbox).
    await page.getByLabel(/Child seat/).selectOption("1");
    await page.getByLabel(/GPS navigation/).check();
    await page.getByLabel(/Full insurance cover/).check();
  }
  const cont = page.getByRole("link", { name: /Continue to driver details/ });
  await expect(cont).toBeVisible({ timeout: 20_000 });
  await cont.click();
  await expect(page).toHaveURL(/\/book\/driver/);
  if (!opts.driverDone) {
    await fillDriverDetails(page, "E2E Driver");
    await uploadLicence(page);
  }
  await page.getByRole("link", { name: /Continue to payment/ }).click();
  await expect(page).toHaveURL(/\/book\/checkout/);
  await expect(page.getByRole("heading", { name: "Reserve your car" })).toBeVisible();
  await page.getByLabel("I accept the rental terms").check();
  await page.getByRole("button", { name: "Reserve and continue to payment" }).click();
  await expect(page).toHaveURL(/\/book\/pay\/DE-[A-Z0-9]{6}/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

const CARD_LABELS = {
  succeeds: "Test card: payment succeeds",
  "is declined": "Test card: payment is declined",
  "confirmation pending": "Test card: confirmation pending",
} as const;

async function pay(page: Page, card: keyof typeof CARD_LABELS) {
  await page.getByLabel(CARD_LABELS[card]).check();
  await page.getByRole("button", { name: /^Pay AED/ }).click();
}

const reservationRow = (reference: string) =>
  withClient(async (c) => (await c.query("SELECT * FROM reservations WHERE reference = $1", [reference])).rows[0]);

test("FLOW-01 / PRC-22 full rental with extras: price shown equals the stored price; voucher with QR", async ({ customerPage: page }) => {
  const t = await freeTrip();
  const ref = await reserve(page, t, { extras: true });
  const row = await reservationRow(ref);
  expect(row.status).toBe("PENDING");
  expect(row.extras_fils).toBeGreaterThan(0);
  // The pay button shows the exact stored total.
  const total = (row.total_fils / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  await expect(page.getByRole("button", { name: new RegExp(`Pay AED\\s?${total.replace(/[.,]/g, "[.,]")}`) })).toBeVisible();
  await pay(page, "succeeds");
  await expect(page).toHaveURL(new RegExp(`/rentals/${ref}/voucher`));
  await expect(page.getByText("You're booked!")).toBeVisible();
  await expect(page.getByRole("img", { name: `Pick-up QR code for reservation ${ref}` })).toBeVisible();
  await expect(page.getByText(ref).first()).toBeVisible();
  const after = await reservationRow(ref);
  expect(after.status).toBe("CONFIRMED");
  // FLOW-02 my rentals lists it
  await page.goto("/rentals");
  await expect(page.getByRole("link", { name: new RegExp(ref) }).or(page.getByText(ref)).first()).toBeVisible();
});

test("PAY-02/04 a declined card shows a message, keeps the hold, and a retry succeeds once", async ({ customerPage: page }) => {
  const t = await freeTrip();
  const ref = await reserve(page, t);
  await pay(page, "is declined");
  await expect(page.getByText("Payment declined")).toBeVisible();
  expect((await reservationRow(ref)).status).toBe("PENDING");
  await pay(page, "succeeds");
  await expect(page).toHaveURL(new RegExp(`/rentals/${ref}/voucher`));
  const paid = await withClient(async (c) =>
    (await c.query("SELECT count(*)::int AS n FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE r.reference = $1 AND p.status = 'succeeded'", [ref])).rows[0].n,
  );
  expect(paid).toBe(1);
});

test("PAY-03 a pending payment shows 'Awaiting payment confirmation' and confirms when the webhook arrives", async ({ customerPage: page, baseURL }) => {
  const t = await freeTrip();
  const ref = await reserve(page, t);
  await pay(page, "confirmation pending");
  await expect(page.getByRole("heading", { name: "Awaiting payment confirmation" })).toBeVisible();
  const { payment } = scenario<{ payment: Record<string, unknown> }>({ op: "completePending", reference: ref });
  const { makeFakeEvent, sendFakeWebhook } = await import("../tests/support/webhooks");
  const deliveries = await sendFakeWebhook(makeFakeEvent("payment.succeeded", payment), { baseUrl: baseURL, times: 3, concurrent: true });
  expect(deliveries.map((d) => d.status)).toEqual([200, 200, 200]);
  await expect(page).toHaveURL(new RegExp(`/rentals/${ref}/voucher`), { timeout: 30_000 });
  const audits = await withClient(async (c) =>
    (await c.query("SELECT count(*)::int AS n FROM audit_logs a JOIN reservations r ON r.id::text = a.entity_id::text WHERE r.reference = $1 AND a.action = 'reservation.confirmed'", [ref])).rows[0].n,
  );
  expect(audits).toBe(1);
});

test("FLOW-06 checkout is blocked until driver details and licence are complete", async ({ customerPage: page }) => {
  const t = await freeTrip();
  await page.goto(vehicleUrl(t));
  await page.getByRole("link", { name: /Continue to driver details/ }).click();
  await expect(page).toHaveURL(/\/book\/driver/);
  await expect(page.getByRole("link", { name: /Continue to payment/ })).toHaveCount(0);
  // Jumping straight to checkout sends the user back to driver details.
  await page.goto(page.url().replace("/book/driver", "/book/checkout"));
  await expect(page).toHaveURL(/\/book\/driver/);
  await page.getByRole("button", { name: /Save driver details/ }).click();
  await expect(page.getByText(/required|Enter|must/i).first()).toBeVisible();
});

test("FLOW-07 licence upload rejects the wrong file type", async ({ customerPage: page }) => {
  await page.goto("/profile");
  await fillDriverDetails(page, "E2E Upload");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "licence.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await page.getByRole("button", { name: /Upload licence/ }).click();
  await expect(page.getByText(/JPEG|JPG|PNG|type|format/i).first()).toBeVisible();
  const hasFile = await withClient(async (c) =>
    (await c.query("SELECT licence_file_key FROM driver_profiles d JOIN users u ON u.id = d.user_id WHERE u.email = $1", [
      (await page.context().request.get("/api/auth/get-session").then((r) => r.json())).user.email,
    ])).rows[0]?.licence_file_key,
  );
  expect(hasFile ?? null).toBeNull();
});

test("CON-08 two customers pay for the same car and dates at the same time: exactly one gets the voucher", async ({ customer, otherCustomer }) => {
  const t = await freeTrip();
  scenario({ op: "driver", email: customer.user.email });
  scenario({ op: "driver", email: otherCustomer.user.email });
  // Both open checkout; both click Reserve together.
  const toCheckout = async (page: Page) => {
    await page.goto(vehicleUrl(t));
    await page.getByRole("link", { name: /Continue to driver details/ }).click();
    await page.getByRole("link", { name: /Continue to payment/ }).click();
    await page.getByLabel("I accept the rental terms").check();
  };
  await Promise.all([toCheckout(customer.page), toCheckout(otherCustomer.page)]);
  await Promise.all([
    customer.page.getByRole("button", { name: "Reserve and continue to payment" }).click(),
    otherCustomer.page.getByRole("button", { name: "Reserve and continue to payment" }).click(),
  ]);
  await Promise.all([customer.page.waitForLoadState("networkidle"), otherCustomer.page.waitForLoadState("networkidle")]);
  const onPay = [customer.page, otherCustomer.page].filter((p) => /\/book\/pay\//.test(p.url()));
  expect(onPay).toHaveLength(1);
  const loser = [customer.page, otherCustomer.page].find((p) => !/\/book\/pay\//.test(p.url()))!;
  await expect(loser.getByText(/no longer available/i).first()).toBeVisible();
  const active = await withClient(async (c) =>
    (await c.query(
      "SELECT count(*)::int AS n FROM reservations WHERE vehicle_id = $1 AND status IN ('PENDING','CONFIRMED','PICKED_UP') AND period && tstzrange($2, $3, '[)')",
      [t.car.id, dubaiInstant(t.from, "10:00"), dubaiInstant(t.to, "10:00")],
    )).rows[0].n,
  );
  expect(active).toBe(1);
});

test("CON-09 / FLOW-08 back-to-back bookings (one ends when the next begins) both succeed", async ({ customer, otherCustomer }) => {
  const t = await freeTrip();
  const first = scenario<{ reference: string; returnAt: string }>({ op: "book", email: customer.user.email, vehicleId: t.car.id, pickupInHours: 24 * 200, hours: 48, pay: "fake_success" });
  const second = scenario<{ reference: string; pickupAt: string }>({
    op: "book", email: otherCustomer.user.email, vehicleId: t.car.id, pickupInHours: 24 * 200 + 48, hours: 24, pay: "fake_success",
  });
  expect(new Date(second.pickupAt).getTime()).toBe(new Date(first.returnAt).getTime());
  await otherCustomer.page.goto(`/rentals/${second.reference}`);
  await expect(otherCustomer.page.getByText(/Confirmed/i).first()).toBeVisible();
});
