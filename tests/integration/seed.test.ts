// MIG-03: the deploy migration script works against driveeasy_qa; SEED-01: the seed is
// idempotent and contains what requirements.md asks for.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { query } from "../support/db";
import { PROJECT_ROOT, qaDatabaseUrl } from "../support/qa-db";

function run(script: string) {
  const url = qaDatabaseUrl();
  const out = spawnSync("pnpm", ["run", script], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 180_000,
  });
  return { code: out.status, output: `${out.stdout}\n${out.stderr}` };
}

const COUNTED = ["branches", "vehicle_categories", "vehicles", "extras", "pricing_rules", "reservations", "users", "vehicle_features"];

async function counts() {
  const out: Record<string, number> = {};
  for (const t of COUNTED) out[t] = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
  return out;
}

describe("MIG-03 / SEED", () => {
  it("MIG-03 `pnpm db:migrate` against the already-migrated QA database succeeds (no-op)", () => {
    const r = run("db:migrate");
    expect(r.code, r.output).toBe(0);
  }, 200_000);

  it("SEED-01 `pnpm db:seed` adds branches, categories, vehicles, extras, pricing rules and future reservations; a second run adds nothing", async () => {
    const before = await counts();
    const first = run("db:seed");
    expect(first.code, first.output).toBe(0);
    const afterFirst = await counts();
    for (const t of ["branches", "vehicle_categories", "vehicles", "extras", "pricing_rules", "reservations"]) {
      expect(afterFirst[t] - before[t], t).toBeGreaterThan(0);
    }
    const future = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM reservations r JOIN users u ON u.id = r.user_id WHERE u.email LIKE '%@driveeasy.test' AND r.pickup_at > now()",
    );
    expect(future[0].n).toBeGreaterThan(0);
    const admins = await query("SELECT 1 FROM users WHERE email = 'admin@driveeasy.test' AND role = 'admin'");
    expect(admins).toHaveLength(1);
    const second = run("db:seed");
    expect(second.code, second.output).toBe(0);
    expect(await counts()).toEqual(afterFirst);
  }, 400_000);
});
