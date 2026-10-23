// Proves the integration harness itself: the right database, a clean
// migrated schema, real parallel sessions for race tests. Domain tests
// (reservations, pricing against DB, holds, payments, authorization) are added
// in phase B, once the schema and services exist.
import { describe, expect, inject, it } from "vitest";
import { connect, pgErrorCode, query, race } from "../support/db";

describe("integration harness", () => {
  it("runs against driveeasy_qa, and the app's DATABASE_URL points there too", async () => {
    const [row] = await query<{ db: string }>("SELECT current_database() AS db");
    expect(row.db).toMatch(/_qa$/);
    expect(process.env.DATABASE_URL).toBe(process.env.QA_DATABASE_URL);
  });

  it("starts from a schema built only by the migrations in drizzle/", async () => {
    const info = inject("qaMigrations");
    const [row] = await query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
    expect(row.n).toBe(info.tables);
    if (info.count === 0) expect(row.n).toBe(0);
  });

  it("race() runs attempts in separate sessions that genuinely contend", async () => {
    const setup = await connect();
    try {
      await setup.query("DROP TABLE IF EXISTS qa_race_probe");
      await setup.query("CREATE TABLE qa_race_probe (k int PRIMARY KEY)");
      const outcome = await race(
        [0, 1].map(() => async (client) => {
          const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
          await client.query("BEGIN");
          await client.query("INSERT INTO qa_race_probe VALUES (1)");
          await client.query("SELECT pg_sleep(0.2)");
          await client.query("COMMIT");
          return pid;
        }),
      );
      expect(outcome.fulfilled).toHaveLength(1);
      expect(outcome.rejected).toHaveLength(1);
      expect(pgErrorCode(outcome.rejected[0])).toBe("23505");
    } finally {
      await setup.query("DROP TABLE IF EXISTS qa_race_probe");
      await setup.end();
    }
  });
});
