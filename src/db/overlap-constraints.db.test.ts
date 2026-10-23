// The overlap guarantee is enforced by PostgreSQL itself (no app code involved here):
// btree_gist exclusion constraints + cross-table triggers, with '[)' periods.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, DAY, future, type Fixture } from "./test-helpers";

const url = process.env.DATABASE_URL!;
let f: Fixture;
let seq = 0;

beforeAll(async () => {
  f = await createFixture({ vehicles: 3 });
});

const clients: pg.Client[] = [];
async function client() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  clients.push(c);
  return c;
}
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
});

function insertReservation(c: pg.Client | pg.Pool, vehicleId: string, from: Date, to: Date, status = "CONFIRMED") {
  seq++;
  const ref = `DE-T${String(seq).padStart(2, "0")}${Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`.slice(0, 9);
  return c.query(
    `INSERT INTO reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id, pickup_at, return_at,
       status, hold_expires_at, idempotency_key, daily_rate_fils, rental_days, rental_fils, vat_rate_bps, tax_fils, total_fils, deposit_fils)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, 10000, 1, 10000, 500, 500, 10500, 0) RETURNING id`,
    [ref, f.customer.id, vehicleId, f.branch.id, from, to, status, status === "PENDING" ? new Date(Date.now() + 900_000) : null, `raw-${seq}-${Math.random()}`],
  );
}
function insertBlock(c: pg.Client, vehicleId: string, from: Date, to: Date) {
  return c.query(`INSERT INTO maintenance_blocks (vehicle_id, starts_at, ends_at, reason) VALUES ($1, $2, $3, 'test') RETURNING id`, [
    vehicleId,
    from,
    to,
  ]);
}

describe("database overlap guarantee", () => {
  it("allows back-to-back reservations: [) bounds, end == next start", async () => {
    const c = await client();
    const t0 = future(10);
    await insertReservation(c, f.vehicles[0].id, t0, new Date(t0.getTime() + 2 * DAY));
    await expect(insertReservation(c, f.vehicles[0].id, new Date(t0.getTime() + 2 * DAY), new Date(t0.getTime() + 3 * DAY))).resolves.toBeTruthy();
    // ...and one ending exactly when the first starts.
    await expect(insertReservation(c, f.vehicles[0].id, new Date(t0.getTime() - DAY), t0)).resolves.toBeTruthy();
  });

  it("rejects an overlapping active reservation (exclusion constraint, 23P01)", async () => {
    const c = await client();
    const t0 = future(20);
    await insertReservation(c, f.vehicles[0].id, t0, new Date(t0.getTime() + 2 * DAY));
    await expect(insertReservation(c, f.vehicles[0].id, new Date(t0.getTime() + DAY), new Date(t0.getTime() + 3 * DAY))).rejects.toMatchObject({
      code: "23P01",
      constraint: "reservations_no_overlap",
    });
    // A one-millisecond overlap is still an overlap.
    await expect(
      insertReservation(c, f.vehicles[0].id, new Date(t0.getTime() + 2 * DAY - 1), new Date(t0.getTime() + 3 * DAY)),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("does not count cancelled / expired reservations", async () => {
    const c = await client();
    const t0 = future(30);
    const { rows } = await insertReservation(c, f.vehicles[0].id, t0, new Date(t0.getTime() + DAY));
    await c.query(`UPDATE reservations SET status = 'CANCELLED' WHERE id = $1`, [rows[0].id]);
    await expect(insertReservation(c, f.vehicles[0].id, t0, new Date(t0.getTime() + DAY), "PENDING")).resolves.toBeTruthy();
  });

  it("rejects a reservation overlapping a maintenance block, and vice versa (cross-table trigger)", async () => {
    const c = await client();
    const t0 = future(40);
    await insertBlock(c, f.vehicles[1].id, t0, new Date(t0.getTime() + 2 * DAY));
    await expect(insertReservation(c, f.vehicles[1].id, new Date(t0.getTime() + DAY), new Date(t0.getTime() + 3 * DAY))).rejects.toMatchObject({
      code: "23P01",
      constraint: "reservations_no_maintenance_overlap",
    });
    // Back-to-back with the block is fine.
    await expect(insertReservation(c, f.vehicles[1].id, new Date(t0.getTime() + 2 * DAY), new Date(t0.getTime() + 3 * DAY))).resolves.toBeTruthy();
    // A block overlapping that reservation is rejected.
    await expect(insertBlock(c, f.vehicles[1].id, new Date(t0.getTime() + 2.5 * DAY), new Date(t0.getTime() + 4 * DAY))).rejects.toMatchObject({
      code: "23P01",
      constraint: "maintenance_blocks_no_reservation_overlap",
    });
    // Moving an existing reservation onto a block is rejected too (UPDATE path).
    const { rows } = await insertReservation(c, f.vehicles[1].id, new Date(t0.getTime() + 5 * DAY), new Date(t0.getTime() + 6 * DAY));
    await expect(
      c.query(`UPDATE reservations SET pickup_at = $2, return_at = $3 WHERE id = $1`, [rows[0].id, t0, new Date(t0.getTime() + DAY)]),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("rejects overlapping maintenance blocks", async () => {
    const c = await client();
    const t0 = future(50);
    await insertBlock(c, f.vehicles[1].id, t0, new Date(t0.getTime() + DAY));
    await expect(insertBlock(c, f.vehicles[1].id, new Date(t0.getTime() + 12 * 3600_000), new Date(t0.getTime() + 2 * DAY))).rejects.toMatchObject({
      code: "23P01",
      constraint: "maintenance_blocks_no_overlap",
    });
  });

  it("two concurrent transactions inserting overlapping reservations: exactly one commits", async () => {
    const [a, b] = [await client(), await client()];
    const t0 = future(60);
    await a.query("BEGIN");
    await b.query("BEGIN");
    await insertReservation(a, f.vehicles[2].id, t0, new Date(t0.getTime() + 2 * DAY));
    // b blocks on the exclusion index until a commits, then fails.
    const bInsert = insertReservation(b, f.vehicles[2].id, new Date(t0.getTime() + DAY), new Date(t0.getTime() + 3 * DAY)).then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 150));
    await a.query("COMMIT");
    expect(await bInsert).toBe("23P01");
    await b.query("ROLLBACK");
  });

  it("concurrent reservation vs maintenance block in separate transactions: the later one fails", async () => {
    const [a, b] = [await client(), await client()];
    const t0 = future(70);
    await a.query("BEGIN");
    await b.query("BEGIN");
    await insertReservation(a, f.vehicles[2].id, t0, new Date(t0.getTime() + 2 * DAY));
    // b's trigger waits for the vehicle row lock held by a, then sees a's committed reservation.
    const bInsert = insertBlock(b, f.vehicles[2].id, new Date(t0.getTime() + DAY), new Date(t0.getTime() + 3 * DAY)).then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 150));
    await a.query("COMMIT");
    expect(await bInsert).toBe("23P01");
    await b.query("ROLLBACK");
  });

  it("enforces period order, money totals and unique plate/VIN/branch code", async () => {
    const c = await client();
    const t0 = future(80);
    await expect(insertReservation(c, f.vehicles[2].id, t0, t0)).rejects.toMatchObject({ code: "23514" });
    await expect(
      c.query(`UPDATE reservations SET total_fils = total_fils + 1 WHERE vehicle_id = $1`, [f.vehicles[0].id]),
    ).rejects.toMatchObject({ code: "23514", constraint: "reservations_total_matches" });
    await expect(
      c.query(`INSERT INTO branches (code, slug, name, city, address) VALUES ($1, 'dup-slug-x', 'x', 'x', 'x')`, [f.branch.code]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      c.query(`UPDATE vehicles SET plate_number = $1 WHERE id = $2`, [f.vehicles[0].plateNumber, f.vehicles[1].id]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(c.query(`UPDATE vehicles SET vin = $1 WHERE id = $2`, [f.vehicles[0].vin, f.vehicles[1].id])).rejects.toMatchObject({
      code: "23505",
    });
  });
});
