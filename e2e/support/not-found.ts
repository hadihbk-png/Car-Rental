// Not-found checks for production builds. Team decision on BUG-009 (won't fix): with Cache
// Components + Partial Prefetching the static shell streams before notFound() runs, so unknown or
// foreign records answer HTTP 200 with the not-found page. What must hold instead:
//   - the not-found UI is shown,
//   - the page tells crawlers not to index it (<meta name="robots" content="noindex...">),
//   - none of the record's data is anywhere in the HTML (including the streamed RSC payload).
import { expect, type Page, type Response } from "@playwright/test";

export async function expectNotFoundPage(page: Page, response: Response | null, mustNotContain: string[] = []) {
  const path = new URL(page.url()).pathname;
  expect(response, path).not.toBeNull();
  expect([200, 404], `${path} status`).toContain(response!.status());
  await expect(page.getByRole("heading", { name: "We couldn't find that page" }), path).toBeVisible();
  const robots = await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((e) => e.getAttribute("content") ?? ""));
  expect(robots.some((c) => /noindex/i.test(c)), `${path} robots meta: ${JSON.stringify(robots)}`).toBe(true);
  const html = await response!.text();
  for (const secret of mustNotContain.filter(Boolean)) {
    expect(html.includes(secret), `${path} leaks "${secret}"`).toBe(false);
  }
}
