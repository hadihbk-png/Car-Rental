// MIG-*, SCH-*: migrations on a clean database and the schema rules from requirements.md.
import { describe, expect, inject, it } from "vitest";
import { pgErrorCode, query } from "../support/db";
import { readMigrationJournal, runMigrations } from "../support/qa-db";
import { createWorld, future, DAY, insertMaintenanceRaw, insertReservationRaw } from "../support/fixtures";

const REQUIRED_TABLES = [
  "users", "driver_profiles", "branches", "vehicle_categories", "vehicles", "vehicle_features",
  "vehicle_feature_map", "pricing_rules", "extras", "reservations", "reservation_extras", "payments",
  "deposits", "rental_agreements", "damage_reports", "maintenance_blocks", "audit_logs",
];

describe("MIG: migrations on a clean database", () => {
  it("MIG-01 applies every journal migration to an empty database (global setup)", async () => {
    const info = inject("qaMigrations");
    const journal = readMigrationJournal();
    expect(info.count).toBe(journal.migrations);
    expect(journal.migrations).toBeGreaterThan(0);
    const rows = await query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    expect(rows[0].n).toBe(journal.migrations);
  });

  it("MIG-02 re-running the migrator is a no-op", async () => {
    await runMigrations();
    const rows = await query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    expect(rows[0].n).toBe(readMigrationJournal().migrations);
  });

  it("MIG-04 the migrations install btree_gist themselves", async () => {
    const rows = await query("SELECT extname FROM pg_extension WHERE extname = 'btree_gist'");
    expect(rows).toHaveLength(1);
  });
});

describe("SCH: schema rules", () => {
  it("SCH-01 all required tables exist (plus Better Auth tables)", async () => {
    const rows = await query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [...REQUIRED_TABLES, "sessions", "accounts", "verifications"]) expect(names, t).toContain(t);
  });

  it("SCH-02 every primary key is a uuid", async () => {
    const rows = await query<{ table_name: string; data_type: string }>(`
      SELECT c.table_name, c.data_type FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
      JOIN information_schema.columns c ON c.table_schema = k.table_schema AND c.table_name = k.table_name AND c.column_name = k.column_name
      WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'`);
    expect(rows.length).toBeGreaterThanOrEqual(REQUIRED_TABLES.length);
    expect(rows.filter((r) => r.data_type !== "uuid")).toEqual([]);
  });

  it("SCH-03 every timestamp column is timestamptz", async () => {
    const rows = await query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`);
    expect(rows).toEqual([]);
  });

  it("SCH-04 money columns are integers (no numeric/float money)", async () => {
    const rows = await query<{ table_name: string; column_name: string; data_type: string }>(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND (column_name LIKE '%fils%' OR column_name LIKE '%amount%' OR column_name LIKE '%price%' OR column_name LIKE '%fee%' OR column_name LIKE '%rate%')`);
    const money = rows.filter((r) => /fils|amount/.test(r.column_name));
    expect(money.length).toBeGreaterThan(10);
    expect(money.filter((r) => !["integer", "bigint"].includes(r.data_type))).toEqual([]);
    const floats = await query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('real', 'double precision', 'money')`);
    expect(floats).toEqual([]);
  });

  it("SCH-05 status enums have exactly the required values", async () => {
    const rows = await query<{ typname: string; labels: string[] }>(`
      SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`);
    const byName = Object.fromEntries(rows.map((r) => [r.typname, r.labels]));
    expect(byName.vehicle_status).toEqual(["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]);
    expect(byName.reservation_status).toEqual(["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"]);
    expect(byName.payment_status).toBeDefined();
    expect(byName.deposit_status).toBeDefined();
    // Payment/deposit status live on their own tables, not on reservations.
    const cols = await query<{ column_name: string; udt_name: string }>(`
      SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations'`);
    expect(cols.find((c) => c.column_name === "status")?.udt_name).toBe("reservation_status");
    expect(cols.some((c) => c.udt_name === "payment_status" || c.udt_name === "deposit_status")).toBe(false);
  });

  it("SCH-06 plate numbers, VINs and branch codes are unique", async () => {
    const w = await createWorld();
    const v = w.vehicle;
    const dupPlate = query(
      `INSERT INTO vehicles (branch_id, category_id, make, model, year, plate_number, vin, transmission, fuel_type, seats)
       VALUES ($1, $2, 'X', 'Y', 2024, $3, 'ZAVZZZZZZZZZZZZZ9', 'AUTOMATIC', 'PETROL', 5)`,
      [v.branchId, v.categoryId, v.plateNumber],
    );
    await expect(dupPlate).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");
    const dupVin = query(
      `INSERT INTO vehicles (branch_id, category_id, make, model, year, plate_number, vin, transmission, fuel_type, seats)
       VALUES ($1, $2, 'X', 'Y', 2024, 'QA UNIQUE 1', $3, 'AUTOMATIC', 'PETROL', 5)`,
      [v.branchId, v.categoryId, v.vin],
    );
    await expect(dupVin).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");
    const dupCode = query(
      `INSERT INTO branches (code, slug, name, city, address, timezone) VALUES ($1, 'qa-dup-slug-x', 'Dup', 'Dubai', 'x st', 'Asia/Dubai')`,
      [w.branchA.code],
    );
    await expect(dupCode).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");
  });

  it("SCH-07 CHECK constraints reject invalid values", async () => {
    const w = await createWorld();
    const t = future(10);
    // return before pickup
    await expect(insertReservationRaw(w, t, new Date(t.getTime() - DAY))).rejects.toSatisfy((e) => ["23514", "22000"].includes(pgErrorCode(e)!));
    // empty period
    await expect(insertReservationRaw(w, t, t)).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
    // negative money
    await expect(
      query(`UPDATE vehicle_categories SET deposit_fils = -1 WHERE id = $1`, [w.category.id]),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
    // total must equal its parts
    const r = await insertReservationRaw(w, future(20), future(21));
    await expect(query(`UPDATE reservations SET total_fils = total_fils + 1 WHERE id = $1`, [r.id])).rejects.toSatisfy(
      (e) => pgErrorCode(e) === "23514",
    );
    // maintenance end before start
    await expect(insertMaintenanceRaw(w.vehicle.id, t, new Date(t.getTime() - 1))).rejects.toSatisfy((e) => ["23514", "22000"].includes(pgErrorCode(e)!));
    // fuel level outside 0..8 and return mileage below pickup
    await expect(
      query(
        `INSERT INTO rental_agreements (reservation_id, vehicle_id, checked_out_at, pickup_mileage_km, pickup_fuel_level) VALUES ($1, $2, now(), 100, 9)`,
        [r.id, w.vehicle.id],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
    await expect(
      query(
        `INSERT INTO rental_agreements (reservation_id, vehicle_id, checked_out_at, pickup_mileage_km, pickup_fuel_level, checked_in_at, return_mileage_km, return_fuel_level)
         VALUES ($1, $2, now(), 100, 8, now(), 50, 8)`,
        [r.id, w.vehicle.id],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
    // PENDING needs a hold expiry
    await expect(query(`UPDATE reservations SET status = 'PENDING', hold_expires_at = NULL WHERE id = $1`, [r.id])).rejects.toSatisfy(
      (e) => pgErrorCode(e) === "23514",
    );
  });

  it("SCH-08 foreign keys and cascade/restrict rules", async () => {
    const w = await createWorld();
    // dangling FK
    await expect(insertMaintenanceRaw("00000000-0000-4000-8000-000000000000", future(5), future(6))).rejects.toSatisfy(
      (e) => pgErrorCode(e) === "23503",
    );
    // a vehicle with reservations cannot be deleted
    const r = await insertReservationRaw(w, future(30), future(31));
    await expect(query(`DELETE FROM vehicles WHERE id = $1`, [w.vehicle.id])).rejects.toSatisfy((e) => ["23001", "23503"].includes(pgErrorCode(e)!));
    // deleting a reservation cascades to reservation_extras
    await query(`INSERT INTO reservation_extras (reservation_id, extra_id, quantity, pricing_type, unit_price_fils, total_fils) VALUES ($1, $2, 1, 'PER_RENTAL', 5000, 5000)`, [r.id, w.gps.id]);
    await query(`DELETE FROM reservations WHERE id = $1`, [r.id]);
    const left = await query(`SELECT 1 FROM reservation_extras WHERE reservation_id = $1`, [r.id]);
    expect(left).toHaveLength(0);
    // a user with reservations cannot be deleted (history kept)
    await insertReservationRaw(w, future(40), future(41));
    await expect(query(`DELETE FROM users WHERE id = $1`, [w.customer.id])).rejects.toSatisfy((e) => ["23001", "23503"].includes(pgErrorCode(e)!));
  });

  it("SCH-09 periods are tstzrange with [) bounds", async () => {
    const cols = await query<{ table_name: string; udt_name: string }>(`
      SELECT table_name, udt_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='period'`);
    expect(cols.map((c) => `${c.table_name}:${c.udt_name}`).sort()).toEqual(["maintenance_blocks:tstzrange", "reservations:tstzrange"]);
    const w = await createWorld();
    const r = await insertReservationRaw(w, future(50), future(52));
    const [row] = await query<{ lo: boolean; hi: boolean }>(
      `SELECT lower_inc(period) AS lo, upper_inc(period) AS hi FROM reservations WHERE id = $1`,
      [r.id],
    );
    expect(row).toEqual({ lo: true, hi: false });
  });

  it("SCH-10 GiST indexes on (vehicle_id, period) and FK lookup indexes exist", async () => {
    const rows = await query<{ indexdef: string; tablename: string }>(
      "SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'",
    );
    const gist = rows.filter((r) => /USING gist/.test(r.indexdef));
    expect(gist.map((r) => r.tablename).sort()).toEqual(["maintenance_blocks", "reservations"]);
    for (const [t, col] of [["reservations", "vehicle_id"], ["reservations", "user_id"], ["payments", "reservation_id"], ["deposits", "reservation_id"], ["vehicles", "branch_id"]]) {
      expect(rows.some((r) => r.tablename === t && r.indexdef.includes(`(${col}`)), `${t}.${col}`).toBe(true);
    }
  });

  it("SCH-11 rental_agreements record mileage and fuel at pick-up and return", async () => {
    const cols = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='rental_agreements'",
    );
    const names = cols.map((c) => c.column_name);
    for (const c of ["pickup_mileage_km", "pickup_fuel_level", "return_mileage_km", "return_fuel_level"]) expect(names).toContain(c);
  });
});
