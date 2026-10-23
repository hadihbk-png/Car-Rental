// LAY-01..03: public pages fit the viewport on every project (desktop and mobile).
import { expect, test } from "@playwright/test";
import { airportBranch, dubaiDate, searchUrl } from "./support/data";

const PAGES = async () => {
  const b = await airportBranch();
  return ["/", "/branches", `/branches/${b.slug}`, searchUrl({ branchId: b.id, from: dubaiDate(30), to: dubaiDate(32) }), "/login", "/register"];
};

test("LAY-01 no horizontal page scroll and a visible main heading on every public page", async ({ page }) => {
  for (const path of await PAGES()) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBeLessThan(400);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
  }
});

test("LAY-02 on phones the navigation collapses into a menu that opens", async ({ page, isMobile }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open menu" });
  if (isMobile || (page.viewportSize()?.width ?? 1440) < 1024) {
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search cars" })).toBeVisible();
  } else {
    await expect(toggle).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search cars" })).toBeVisible();
  }
});

test("LAY-02b primary controls are large enough to tap (>= 40px high)", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Search cars" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
});
