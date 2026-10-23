import pg from "pg";

// Confirms both local databases are reachable and have btree_gist.
let failed = false;
for (const key of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
  const client = new pg.Client({ connectionString: process.env[key] });
  try {
    await client.connect();
    const { rows } = await client.query(
      "SELECT current_database() AS db, current_user AS usr, " +
        "(SELECT extversion FROM pg_extension WHERE extname = 'btree_gist') AS btree_gist",
    );
    const { db, usr, btree_gist } = rows[0];
    console.log(`${btree_gist ? "OK  " : "FAIL"} ${key}: ${db} as ${usr}, btree_gist ${btree_gist ?? "missing"}`);
    if (!btree_gist) failed = true;
  } catch (err) {
    console.error(`FAIL ${key}: ${(err as Error).message}`);
    failed = true;
  } finally {
    await client.end().catch(() => {});
  }
}
process.exitCode = failed ? 1 : 0;
