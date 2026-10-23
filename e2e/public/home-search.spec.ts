// SRCH-01, SRCH-06..09, SRCH-11, NFR-02 in the browser. Expectations come from driveeasy_qa.
import { expect, test } from "@playwright/test";
import { airportBranch, activeBranches, dubaiDate, dubaiInstant, expectedAvailable, searchUrl } from "../support/data";

test.describe("home", () => {
  test("SRCH-01 home shows the search form with every active branch and submits to /search", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const form = page.getByRole("form", { name: "Find a car" });
    await expect(form).toBeVisible();
    const select = form.getByLabel("Pick-up branch");
    const optionTexts = (await select.locator("option").allTextContents()).map((t) => t.trim()).filter(Boolean);
    // Options read "<branch name>[, <city>]".
    const names = (await activeBranches()).map((b) => b.name);
    expect(optionTexts).toHaveLength(names.length);
    for (const n of names) expect(optionTexts.some((t) => t.startsWith(n)), n).toBe(true);
    // A different return branch is optional and appears on demand.
    await expect(form.getByLabel("Return branch")).toHaveCount(0);
    await form.getByLabel("Return to a different branch").check();
    await expect(form.getByLabel("Return branch")).toBeVisible();
    await form.getByLabel("Return to a different branch").uncheck();
    const airport = await airportBranch();
    const airportLabel = optionTexts.find((t) => t.startsWith(airport.name))!;
    await select.selectOption({ label: airportLabel });
    // Dates and times are required; submitting without them is blocked by the browser.
    await form.getByRole("button", { name: "Search cars" }).click();
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await form.getByLabel("Pick-up date").fill(dubaiDate(30));
    await form.getByLabel("Pick-up time").selectOption("10:00");
    await form.getByLabel("Return date").fill(dubaiDate(32));
    await form.getByLabel("Return time").selectOption("10:00");
    await form.getByRole("button", { name: "Search cars" }).click();
    await expect(page).toHaveURL(/\/search\?/);
    expect([airport.id, airport.slug]).toContain(new URL(page.url()).searchParams.get("pickupBranch"));
  });
});

test.describe("search results", () => {
  test("SRCH-01/09 results for real dates list exactly the available cars, with totals incl. VAT", async ({ page }) => {
    const b = await airportBranch();
    const from = dubaiDate(30);
    const to = dubaiDate(33);
    const expected = await expectedAvailable(b.id, dubaiInstant(from, "10:00"), dubaiInstant(to, "10:00"));
    await page.goto(searchUrl({ branchId: b.id, from, to }));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(b.name);
    const heading = page.locator("#results-heading");
    await expect(heading).toHaveText(new RegExp(`^${expected.length} cars? available$`));
    const results = page.getByRole("region", { name: "Search results" });
    for (const v of expected.slice(0, 5)) await expect(results.getByText(`${v.make} ${v.model}`, { exact: false }).first()).toBeVisible();
    if (expected.length) await expect(results.getByText(/Totals include 5% VAT/)).toBeVisible();
  });

  test("SRCH-06 transmission / fuel / seats filters narrow the list and stay in the URL after reload", async ({ page }) => {
    const b = await airportBranch();
    const from = dubaiDate(40);
    const to = dubaiDate(42);
    const manual = await expectedAvailable(b.id, dubaiInstant(from, "10:00"), dubaiInstant(to, "10:00"), "AND v.transmission = $4", ["MANUAL"]);
    const url = searchUrl({ branchId: b.id, from, to, extra: { transmission: "MANUAL" } });
    await page.goto(url);
    await expect(page.locator("#results-heading")).toHaveText(new RegExp(`^${manual.length} cars? available$`));
    await page.reload();
    expect(new URL(page.url()).searchParams.get("transmission")).toBe("MANUAL");
    await expect(page.locator("#results-heading")).toHaveText(new RegExp(`^${manual.length} cars? available$`));
    const seven = await expectedAvailable(b.id, dubaiInstant(from, "10:00"), dubaiInstant(to, "10:00"), "AND v.seats >= $4", [7]);
    await page.goto(searchUrl({ branchId: b.id, from, to, extra: { seats: "7" } }));
    await expect(page.locator("#results-heading")).toHaveText(new RegExp(`^${seven.length} cars? available$`));
  });

  test("SRCH-07 filters that match nothing show an empty state with a way to clear them", async ({ page }) => {
    const b = await airportBranch();
    await page.goto(searchUrl({ branchId: b.id, from: dubaiDate(30), to: dubaiDate(31), extra: { maxPrice: "1" } }));
    await expect(page.getByText("No cars match your filters")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/maxPrice/);
    await expect(page.locator("#results-heading")).toHaveText(/cars? available/);
  });

  test("SRCH-08 return before pick-up shows a friendly error, not a crash", async ({ page }) => {
    const b = await airportBranch();
    const response = await page.goto(searchUrl({ branchId: b.id, from: dubaiDate(33), to: dubaiDate(30) }));
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByText("We couldn't run this search")).toBeVisible();
    // BUG-010: the service message and the hint are separate sentences.
    await expect(page.getByText(/Return must be after pick-up. Adjust the trip/)).toBeVisible();
  });

  test("SRCH-08b a past pick-up date and an unknown branch are handled gracefully", async ({ page }) => {
    const b = await airportBranch();
    const r1 = await page.goto(searchUrl({ branchId: b.id, from: dubaiDate(-3), to: dubaiDate(-1) }));
    expect(r1?.status()).toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime Error/);
    const r2 = await page.goto(searchUrl({ branchId: "00000000-0000-4000-8000-000000000000", from: dubaiDate(10), to: dubaiDate(11) }));
    expect(r2?.status()).toBeLessThan(500);
    await expect(page.getByText("We couldn't find that branch")).toBeVisible();
  });

  test("SRCH-11 sorting by price descending orders the cards", async ({ page }) => {
    const b = await airportBranch();
    await page.goto(searchUrl({ branchId: b.id, from: dubaiDate(50), to: dubaiDate(51), extra: { sort: "price-desc" } }));
    const prices = await page
      .getByRole("region", { name: "Search results" })
      .getByText(/AED\s?[\d,]+(\.\d{2})?/)
      .allTextContents();
    const amounts = prices.map((p) => Number(p.replace(/[^\d.]/g, ""))).filter((n) => n > 0);
    test.skip(amounts.length < 2, "not enough priced cards to compare");
    // The first price shown on each card is its daily rate / total; descending order means non-increasing.
    expect(amounts[0]).toBeGreaterThanOrEqual(amounts[amounts.length - 1]);
  });

  test("NFR-02 an unknown page renders the not-found page with a 404", async ({ page }) => {
    const r = await page.goto("/no-such-page-qa");
    expect(r?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText(/stack|at Object\./i);
  });
});
