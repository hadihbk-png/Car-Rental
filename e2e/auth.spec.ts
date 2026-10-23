// AUTH-01..07 in the browser: register, log in, log out, protected pages, safe redirects.
import { expect, randomClientIp, test } from "./support/fixtures";
import { loginViaUi, logoutViaUi, newUser, openMenuIfCollapsed, registerViaApi, registerViaUi, registerViaUiAndWait, seedLogin } from "./support/auth";

test.describe("authentication", () => {
  test("AUTH-01/04/06 register through the UI, log out, log back in", async ({ page, baseURL }) => {
    const user = newUser();
    await registerViaUi(page, user);
    await expect(page).not.toHaveURL(/\/register/);
    await openMenuIfCollapsed(page);
    await expect(page.getByRole("button", { name: "Log out" }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await logoutViaUi(page);
    await openMenuIfCollapsed(page);
    await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
    // The old session cookie is dead.
    const s = await page.request.get(`${baseURL}/api/auth/get-session`);
    expect(await s.text()).toMatch(/^null$|^$/);
    await loginViaUi(page, user);
    await expect(page).not.toHaveURL(/\/login/);
    await openMenuIfCollapsed(page);
    await expect(page.getByRole("button", { name: "Log out" }).first()).toBeVisible();
  });

  test("AUTH-02 registering an existing email shows an error and does not sign in", async ({ page, baseURL }) => {
    const user = newUser();
    await registerViaApi(page.context().request, baseURL!, user);
    await page.context().clearCookies();
    await registerViaUi(page, user);
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByText("An account with this email already exists. Log in instead.")).toBeVisible();
  });

  test("AUTH-03 client-side validation: empty fields, bad email, short password", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    await page.getByRole("textbox", { name: "Full name", exact: true }).fill("QA");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("not-an-email");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("short");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText(/valid email address/)).toBeVisible();
    await expect(page.getByText(/at least 8 characters/)).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test("AUTH-05 wrong password shows a generic error and stays on the login page", async ({ page }) => {
    const { email } = seedLogin("customer");
    await loginViaUi(page, { email, password: "Wrong-password-123" });
    await expect(page.locator("#login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    const generic = await page.locator("#login-error").innerText();
    await loginViaUi(page, { email: `nobody-${Date.now()}@qa.test`, password: "Wrong-password-123" });
    await expect(page.locator("#login-error")).toHaveText(generic);
  });

  test("AUTH-07 signed-out visitors are sent to login and returned afterwards", async ({ page }) => {
    for (const path of ["/rentals", "/profile"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    }
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await loginViaUi(page, seedLogin("customer"), `/login?next=${encodeURIComponent("/rentals")}`);
    await expect(page).toHaveURL(/\/rentals$/);
  });

  test("AUTH-07b a customer cannot open the admin area", async ({ page }) => {
    await loginViaUi(page, seedLogin("customer"));
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("AUTH-07c the login ?next= parameter never redirects off-site", async ({ page }) => {
    const user = newUser();
    await registerViaUiAndWait(page, user);
    await logoutViaUi(page);
    for (const next of ["//evil.example", "https://evil.example/x", "/\\evil.example"]) {
      await page.setExtraHTTPHeaders({ "x-forwarded-for": randomClientIp() });
      await loginViaUi(page, user, `/login?next=${encodeURIComponent(next)}`);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page).toHaveURL(/^http:\/\/localhost:3100\//);
      await logoutViaUi(page);
    }
  });
});
