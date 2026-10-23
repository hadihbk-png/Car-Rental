// BUG-011 regression: concurrent fake-provider calls must never lose writes or fail on rename.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_PAYMENT_METHODS, FakePaymentProvider } from "./fake-provider";
import { JsonFileFakePaymentStore, NetlifyBlobsFakePaymentStore, withStoreLock } from "./fake-store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "driveeasy-fake-pay-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const provider = (store: JsonFileFakePaymentStore | NetlifyBlobsFakePaymentStore) =>
  new FakePaymentProvider({ store, webhookSecret: "s" });

async function burst(p: FakePaymentProvider, prefix: string, n: number) {
  const expiresAt = new Date(Date.now() + 3_600_000);
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      i % 2
        ? p.holdDeposit({ amount: 100 + i, currency: "AED", paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: `${prefix}-h${i}`, expiresAt })
        : p.createPayment({ amount: 100 + i, currency: "AED", paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: `${prefix}-p${i}` }),
    ),
  );
}

describe("JsonFileFakePaymentStore under concurrency", () => {
  it("persists every one of 60 concurrent payments and holds, with no temp files left", async () => {
    const file = path.join(dir, "state", "fake-payments.json");
    const results = await burst(provider(new JsonFileFakePaymentStore(file)), "a", 60);
    const state = await new JsonFileFakePaymentStore(file).load();
    expect(Object.keys(state.payments)).toHaveLength(30);
    expect(Object.keys(state.holds)).toHaveLength(30);
    expect(Object.keys(state.idempotency)).toHaveLength(60);
    expect(state.events).toHaveLength(60);
    for (const r of results) expect(state.payments[r.id] ?? state.holds[r.id]).toBeTruthy();
    expect((await readdir(path.dirname(file))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("serialises two providers that share one file (same lock key)", async () => {
    const file = path.join(dir, "shared.json");
    await Promise.all([
      burst(provider(new JsonFileFakePaymentStore(file)), "x", 20),
      burst(provider(new JsonFileFakePaymentStore(path.join(dir, ".", "shared.json"))), "y", 20),
    ]);
    const state = await new JsonFileFakePaymentStore(file).load();
    expect(Object.keys(state.idempotency)).toHaveLength(40);
  });

  it("keeps working after a failed mutation (the lock is released on error)", async () => {
    const p = provider(new JsonFileFakePaymentStore(path.join(dir, "err.json")));
    const outcomes = await Promise.allSettled([
      p.createPayment({ amount: 100, currency: "AED", paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "ok1" }),
      p.refundPayment("pay_missing"),
      p.createPayment({ amount: 100, currency: "AED", paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "ok2" }),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("runs locked sections one at a time, in order", async () => {
    const store = new JsonFileFakePaymentStore(path.join(dir, "order.json"));
    const log: string[] = [];
    await Promise.all(
      [3, 1, 2].map((ms, i) =>
        withStoreLock(store, async () => {
          log.push(`start${i}`);
          await new Promise((r) => setTimeout(r, ms));
          log.push(`end${i}`);
        }),
      ),
    );
    expect(log).toEqual(["start0", "end0", "start1", "end1", "start2", "end2"]);
  });
});

describe("NetlifyBlobsFakePaymentStore under concurrency (mocked slow store)", () => {
  it("persists every concurrent mutation within one instance", async () => {
    let saved: unknown = null;
    const slow = () => new Promise((r) => setTimeout(r, 1));
    const store = new NetlifyBlobsFakePaymentStore(() => ({
      get: async () => {
        await slow();
        return saved === null ? null : JSON.parse(JSON.stringify(saved));
      },
      setJSON: async (_k: string, v: unknown) => {
        await slow();
        saved = JSON.parse(JSON.stringify(v));
      },
    }));
    await burst(provider(store), "n", 30);
    const state = await store.load();
    expect(Object.keys(state.idempotency)).toHaveLength(30);
  });
});
