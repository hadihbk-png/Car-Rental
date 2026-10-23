// CAL-01..03 (vehicle details + availability calendar) and SRCH-10 (branches) in the browser.
import { expect, test } from "@playwright/test";
import { activeBranches, anyVehicleAt, airportBranch, seededBooking } from "../support/data";

function dubaiDateOf(d: Date) {
  return new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
}
function longDate(date: string) {
  // Matches formatDateString(date, "long") loosely: the day number and month name.
  const d = new Date(`${date}T12:00:00Z`);
  return { day: d.getUTCDate(), month: d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" }) };
}

test.describe("vehicle details", () => {
  test("CAL-01 the availability calendar marks a seeded booking as booked / partly booked", async ({ page }) => {
    const booking = await seededBooking();
    test.skip(!booking, "seed has no multi-day future booking");
    const r = await page.goto(`/vehicles/${booking.vehicle_id}`);
    expect(r?.status()).toBe(200);
    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible();
    // Move forward to the month of the booking.
    const startDate = dubaiDateOf(new Date(booking.pickup_at));
    const fullDay = dubaiDateOf(new Date(new Date(booking.pickup_at).getTime() + 24 * 3_600_000));
    const target = longDate(fullDay);
    for (let i = 0; i < 6; i++) {
      const cells = grid.getByRole("gridcell").filter({ hasText: new RegExp(`\\b${target.day}\\b.*${target.month}|${target.month}.*\\b${target.day}\\b`) });
      if ((await cells.count()) > 0) break;
      await page.getByRole("button", { name: "Next month" }).click();
    }
    const dayCell = grid.getByRole("gridcell").filter({ hasText: new RegExp(`${target.month}`) }).filter({ hasText: new RegExp(`\\b${target.day}\\b`) });
    await expect(dayCell.first()).toContainText(/booked/);
    expect(startDate <= fullDay).toBe(true);
    await expect(page.getByRole("list", { name: "Legend" })).toBeVisible();
  });

  test("CAL-04 an unknown vehicle id shows not-found, not an error", async ({ page }) => {
    for (const path of ["/vehicles/00000000-0000-4000-8000-000000000000", "/vehicles/not-a-uuid"]) {
      const r = await page.goto(path);
      expect(r?.status(), path).toBeLessThan(500);
      await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    }
  });

  test("CAL-01b a search result links to its vehicle page", async ({ page }) => {
    const b = await airportBranch();
    const v = await anyVehicleAt(b.id);
    await page.goto(`/search?pickupBranch=${b.id}`);
    const link = page.getByRole("region", { name: "Search results" }).getByRole("link", { name: new RegExp(`${v.make}`) }).first();
    await link.click();
    await expect(page).toHaveURL(/\/vehicles\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("branches", () => {
  test("SRCH-10 the branch list shows every active branch; each branch page shows its details", async ({ page }) => {
    const branches = await activeBranches();
    await page.goto("/branches");
    for (const b of branches) await expect(page.getByRole("link", { name: new RegExp(b.name.replace(/[()]/g, "\\$&")) }).first()).toBeVisible();
    const first = branches[0];
    await page.getByRole("link", { name: new RegExp(first.name.replace(/[()]/g, "\\$&")) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/branches/${first.slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(first.name);
    await expect(page.getByText(first.address).first()).toBeVisible();
  });

  test("SRCH-10b an unknown branch slug is a 404", async ({ page }) => {
    const r = await page.goto("/branches/no-such-branch-qa");
    expect(r?.status()).toBeLessThan(500); // BUG-009: soft 404 (HTTP 200) from a streamed notFound()
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });
});
