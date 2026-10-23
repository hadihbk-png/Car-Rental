import { describe, expect, it } from "vitest";

// Guard for the unit project: `pnpm test` must never reach a real database.
describe("unit project isolation", () => {
  it("points every database URL at an unreachable address", () => {
    for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "TEST_DATABASE_URL", "QA_DATABASE_URL"]) {
      expect(process.env[key], key).toMatch(/^postgres:\/\/unit-tests-must-not-use-a-database@127\.0\.0\.1:1\//);
    }
  });
});
