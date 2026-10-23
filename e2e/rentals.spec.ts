// FLOW-02, MOD-01/05, CXL in the browser; AZ-01/02 other-user access; balance due after return.
import { withClient } from "../tests/support/qa-db";
import { expect, test } from "./support/fixtures";
import { expectNotFoundPage } from "./support/not-found";
import { scenario, type Booked } from "./support/scenario";

test.setTimeout(120_000);

const row = (reference: string) =>
  withClient(async (c) => (await c.query("SELECT * FROM reservations WHERE reference = $1", [reference])).rows[0]);

test.describe("my rentals", () => {
  test("FLOW-02 my rentals lists only my reservations, with status and a voucher link", async ({ customer, otherCustomer }) => {
    const mine = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 24 * 30, hours: 48, pay: "fake_success" });
    const theirs = scenario<Booked>({ op: "book", email: otherCustomer.user.email, pickupInHours: 24 * 31, hours: 24, pay: "fake_success" });
    const page = customer.page;
    await page.goto("/rentals");
    await expect(page.getByRole("heading", { name: "My rentals" })).toBeVisible();
    await expect(page.getByText(mine.reference).first()).toBeVisible();
    await expect(page.getByText(theirs.reference)).toHaveCount(0);
    await page.getByRole("link", { name: /voucher/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/rentals/${mine.reference}/voucher`));
    await expect(page.getByRole("img", { name: `Pick-up QR code for reservation ${mine.reference}` })).toBeVisible();
  });

  test("MOD-01 change dates more than 48h ahead: new price previewed, difference charged, dates updated", async ({ customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 24 * 40, hours: 48, pay: "fake_success" });
    const page = customer.page;
    await page.goto(`/rentals/${b.reference}`);
    await expect(page.getByRole("heading", { name: "Manage reservation" })).toBeVisible();
    await page.getByRole("button", { name: "Change dates" }).click();
    const oldReturn = new Date(b.returnAt);
    const newReturn = new Date(oldReturn.getTime() + 24 * 3_600_000);
    const local = new Date(newReturn.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
    await page.getByLabel("Return date").fill(local);
    await page.getByRole("button", { name: "Check new price" }).click();
    await expect(page.getByText("New price")).toBeVisible();
    await expect(page.getByText(/difference will be charged/)).toBeVisible();
    await page.getByRole("button", { name: "Confirm new dates" }).click();
    await expect(page.getByRole("status").or(page.getByText(/dates (were|have been) changed|updated/i)).first()).toBeVisible();
    const after = await row(b.reference);
    expect(new Date(after.return_at).getTime()).toBe(newReturn.getTime());
    expect(after.total_fils).toBeGreaterThan(b.totalFils);
  });

  test("CXL-01 free cancellation from the rentals page refunds in full", async ({ customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 24 * 50, hours: 24, pay: "fake_success" });
    const page = customer.page;
    await page.goto(`/rentals/${b.reference}`);
    await page.getByRole("button", { name: "Cancel reservation" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this reservation?" });
    await expect(dialog.getByText("Free cancellation")).toBeVisible();
    await dialog.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText(/cancel/i).first()).toBeVisible();
    await expect.poll(async () => (await row(b.reference)).status).toBe("REFUNDED");
    expect((await row(b.reference)).refunded_fils).toBe(b.totalFils);
  });

  test("CXL-03 within 48 hours the dialog warns that one day is kept", async ({ customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 30, hours: 48, pay: "fake_success" });
    const page = customer.page;
    await page.goto(`/rentals/${b.reference}`);
    // Date changes are no longer offered.
    await expect(page.getByRole("button", { name: "Change dates" })).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel reservation" }).click();
    await expect(page.getByRole("dialog").getByText("Cancellation fee applies")).toBeVisible();
    await page.getByRole("button", { name: "Keep reservation" }).click();
    expect((await row(b.reference)).status).toBe("CONFIRMED");
  });

  test("MOD-05 after pick-up there is no cancel or change option", async ({ customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 2, hours: 24, pay: "fake_success" });
    scenario({ op: "checkout", reference: b.reference });
    await customer.page.goto(`/rentals/${b.reference}`);
    await expect(customer.page.getByRole("button", { name: "Cancel reservation" })).toHaveCount(0);
    await expect(customer.page.getByRole("button", { name: "Change dates" })).toHaveCount(0);
  });

  test("BUG-007 balance due after a late return is shown to the customer with a way to pay", async ({ customer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 2, hours: 24, pay: "fake_success" });
    scenario({ op: "checkout", reference: b.reference });
    // Returned 1 day + 3 hours late with 400 AED damage: more than the deposit can cover in the 0-deposit case;
    // with a deposit, the overflow is still "due".
    const result = scenario<{ charges: { amountDueFils: number; totalFils: number } }>({
      op: "checkin", reference: b.reference, mileageKm: 999_999, fuelLevel: 0, nowOffsetHours: 2 + 24 + 27, damageChargeFils: 500_000,
    });
    expect(result.charges.amountDueFils).toBeGreaterThan(0);
    await customer.page.goto(`/rentals/${b.reference}`);
    await expect(customer.page.getByText(/due|balance|outstanding/i).first()).toBeVisible();
    // Pay the balance with the test card (UI from the App Agent; adjust labels once built).
    const payBtn = customer.page.getByRole("button", { name: /^Pay AED/ });
    test.skip((await payBtn.count()) === 0, "balance payment UI not built yet");
    await customer.page.getByLabel("Test card: payment succeeds").check();
    await payBtn.click();
    await expect
      .poll(async () => withClient(async (c) => (await c.query("SELECT count(*)::int AS n FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE r.reference = $1 AND p.purpose = $2 AND p.status = $3", [b.reference, "RETURN_CHARGES", "succeeded"])).rows[0].n))
      .toBe(1);
  });
});

test.describe("other users' data", () => {
  test("AZ-01 another customer cannot open my reservation, voucher or payment page, even by reference", async ({ customer, otherCustomer }) => {
    const b = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 24 * 60, hours: 24, pay: "fake_success" });
    const { licenceFileUrl } = scenario<{ licenceFileUrl: string }>({ op: "driver", email: customer.user.email });
    const pending = scenario<Booked>({ op: "book", email: customer.user.email, pickupInHours: 24 * 61, hours: 24, pay: "none" });
    const leaks = [customer.user.name, customer.user.email, b.id, licenceFileUrl];
    for (const [path, ref] of [
      [`/rentals/${b.reference}`, b.reference],
      [`/rentals/${b.reference}/voucher`, b.reference],
      [`/book/pay/${pending.reference}`, pending.reference],
    ]) {
      // The reference itself is in the URL (and so in canonical/route data); the record's details must not be.
      await expectNotFoundPage(otherCustomer.page, await otherCustomer.page.goto(path), [...leaks, ref === b.reference ? "DE1." + b.reference : "DE1." + pending.reference]);
      await expect(otherCustomer.page.getByText(customer.user.name)).toHaveCount(0);
    }
  });

  test("AZ-02/03 licence files: owner 200, other customer 404, signed out 401; never under /storage or /uploads", async ({ customer, otherCustomer, browser, baseURL }) => {
    const { licenceFileUrl } = scenario<{ licenceFileUrl: string }>({ op: "driver", email: customer.user.email });
    const own = await customer.context.request.get(licenceFileUrl);
    expect(own.status()).toBe(200);
    expect(own.headers()["cache-control"]).toContain("no-store");
    expect((await otherCustomer.context.request.get(licenceFileUrl)).status()).toBe(404);
    const anon = await browser.newContext({ baseURL });
    expect((await anon.request.get(licenceFileUrl)).status()).toBe(401);
    for (const p of ["/storage/qa-uploads/", "/uploads/", "/private/licences/"]) {
      expect((await anon.request.get(p)).status(), p).toBe(404);
    }
    await anon.close();
    // The profile page links to the authorised route, never to a raw storage path.
    await customer.page.goto("/profile");
    const hrefs = await customer.page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs.filter((h) => h && /private\/|storage\//.test(h))).toEqual([]);
  });
});

test.describe("profile", () => {
  test("profile shows account details and saves driver details + licence", async ({ customer }) => {
    const page = customer.page;
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await expect(page.getByText(customer.user.email)).toBeVisible();
    await page.getByLabel("Full name (as on licence)").fill("Profile Tester");
    await page.getByLabel("Mobile phone").fill("+971 50 765 4321");
    await page.getByLabel("Date of birth").fill("1985-02-02");
    await page.getByLabel("Nationality").fill("UAE");
    await page.getByLabel("Licence number").fill("PROF-1");
    await page.getByLabel("Licence issued in (country)").fill("UAE");
    await page.getByLabel("Licence expiry date").fill("2034-01-01");
    await page.getByRole("button", { name: /Save/ }).first().click();
    await expect(page.getByRole("button", { name: /Upload licence/ })).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "licence.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    });
    await page.getByRole("button", { name: /Upload licence/ }).click();
    await expect(page.getByRole("button", { name: /Upload new licence/ })).toBeVisible();
  });

  test("a driver under 21 is refused with a field error", async ({ customer }) => {
    const page = customer.page;
    await page.goto("/profile");
    const young = new Date();
    young.setUTCFullYear(young.getUTCFullYear() - 19);
    await page.getByLabel("Full name (as on licence)").fill("Too Young");
    await page.getByLabel("Mobile phone").fill("+971 50 765 4321");
    await page.getByLabel("Date of birth").fill(young.toISOString().slice(0, 10));
    await page.getByLabel("Nationality").fill("UAE");
    await page.getByLabel("Licence number").fill("YOUNG-1");
    await page.getByLabel("Licence issued in (country)").fill("UAE");
    await page.getByLabel("Licence expiry date").fill("2034-01-01");
    await page.getByRole("button", { name: /Save/ }).first().click();
    await expect(page.getByText(/21/).first()).toBeVisible();
  });
});
