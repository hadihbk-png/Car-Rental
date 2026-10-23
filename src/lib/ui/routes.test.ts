import { describe, expect, it } from "vitest";
import { loginHref, safeNextPath } from "./routes";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/rentals")).toBe("/rentals");
    expect(safeNextPath("/search?pickupBranch=dxb&page=2")).toBe("/search?pickupBranch=dxb&page=2");
    expect(safeNextPath(["/profile", "/admin"])).toBe("/profile");
  });

  it("rejects open redirects and junk", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "javascript:alert(1)",
      "evil.com/path",
      "/foo\nbar",
      "",
      undefined,
      null,
    ]) {
      expect(safeNextPath(bad as string | undefined)).toBe("/");
    }
    expect(safeNextPath("//evil.com", "/rentals")).toBe("/rentals");
  });

  it("builds login links", () => {
    expect(loginHref()).toBe("/login");
    expect(loginHref("/rentals")).toBe("/login?next=%2Frentals");
    expect(loginHref("https://evil.com")).toBe("/login");
  });
});
