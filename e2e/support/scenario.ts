// Runs e2e/support/scenario.mts in a child process (the app's services are server-only ESM,
// so specs never import them directly).
import { spawnSync } from "node:child_process";

export function scenario<T = Record<string, unknown>>(op: Record<string, unknown>): T {
  const out = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "e2e/support/scenario.mts", JSON.stringify(op)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: 120_000,
  });
  const line = (out.stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (!line) throw new Error(`scenario ${String(op.op)} produced no output: ${out.stderr}`);
  const parsed = JSON.parse(line) as { ok: boolean; result?: T; error?: string };
  if (!parsed.ok) throw new Error(`scenario ${String(op.op)} failed: ${parsed.error}`);
  return parsed.result as T;
}

export type Booked = { id: string; reference: string; vehicleId: string; status: string; pickupAt: string; returnAt: string; totalFils: number };
