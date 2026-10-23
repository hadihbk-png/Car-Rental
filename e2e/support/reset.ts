// Reset/seed hook for browser tests.
//
// The full reset (drop schema, migrate, seed) happens once per run before the
// web server starts: e2e/support/prepare-db.mts, wired in playwright.config.ts.
// Specs isolate themselves by creating their own users and reservations, so a
// per-worker reset is not normally needed.
//
// Phase B: fill in targeted cleanup here (e.g. cancel leftover QA holds,
// restore seeded vehicles to AVAILABLE) once the schema exists. Do NOT
// truncate tables here while other workers are running.
export async function resetData(): Promise<void> {
  // Intentionally empty in phase A.
}
