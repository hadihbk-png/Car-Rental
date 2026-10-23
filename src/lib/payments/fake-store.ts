import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DepositHold, Payment, Refund, WebhookEvent } from "./types";

export type WebhookDelivery = {
  eventId: string;
  attempt: number;
  ok: boolean;
  status?: number;
  error?: string;
  at: string;
};

export type FakePaymentState = {
  payments: Record<string, Payment>;
  holds: Record<string, DepositHold>;
  refunds: Record<string, Refund>;
  events: WebhookEvent[];
  deliveries: WebhookDelivery[];
  idempotency: Record<string, string>;
};

export interface FakePaymentStore {
  load(): Promise<FakePaymentState>;
  save(state: FakePaymentState): Promise<void>;
  /**
   * Stores with the same lockKey share one in-process lock (e.g. two providers on one file).
   * Without a lockKey the store object itself is the lock.
   */
  readonly lockKey?: string;
}

export const emptyFakePaymentState = (): FakePaymentState => ({
  payments: {},
  holds: {},
  refunds: {},
  events: [],
  deliveries: [],
  idempotency: {},
});

/** For unit tests: state lives only as long as the object. */
export class MemoryFakePaymentStore implements FakePaymentStore {
  private state = emptyFakePaymentState();
  async load() {
    return structuredClone(this.state);
  }
  async save(state: FakePaymentState) {
    this.state = structuredClone(state);
  }
}

// ---------------------------------------------------------------------------
// In-process serialisation (BUG-011)
// ---------------------------------------------------------------------------

const locks = new Map<unknown, Promise<unknown>>();

/**
 * Runs fn exclusively for this store (FIFO), so a whole load -> change -> save never interleaves
 * with another one in the same process. The lock is released when fn settles, even on error.
 */
export async function withStoreLock<T>(store: FakePaymentStore, fn: () => Promise<T>): Promise<T> {
  const key = store.lockKey ?? store;
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** Windows can briefly refuse a rename/read while another handle (or an AV scanner) has the file. */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

async function retryTransient<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !TRANSIENT.has(code) || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 10 * 2 ** i)); // 10 ms ... ~1.3 s
    }
  }
}

/**
 * For local dev: state survives restarts, so the cleanup command can see app-created holds.
 * Writes go to a unique temp file and are renamed into place (atomic replace), with brief retries
 * on transient Windows errors. Mutations are serialised in-process via lockKey (the absolute path).
 */
export class JsonFileFakePaymentStore implements FakePaymentStore {
  readonly lockKey: string;

  constructor(private readonly filePath: string) {
    this.lockKey = `file:${path.resolve(filePath)}`;
  }

  async load() {
    try {
      return JSON.parse(await retryTransient(() => readFile(this.filePath, "utf8"))) as FakePaymentState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyFakePaymentState();
      throw err;
    }
  }

  async save(state: FakePaymentState) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    try {
      await retryTransient(() => rename(tmp, this.filePath));
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
}

/** The subset of a @netlify/blobs Store used by the fake-payment state (injectable for tests). */
export type JsonBlobsStoreLike = {
  get(key: string, options: { type: "json" }): Promise<unknown>;
  setJSON(key: string, data: unknown): Promise<unknown>;
};

/**
 * Demo deployments only (FAKE_PAYMENTS_STORE=netlify-blobs): keeps the fake provider's state in
 * Netlify Blobs because function disks do not persist. Mutations are serialised within one
 * function instance (lockKey); across concurrent instances the last write still wins, which is
 * accepted for a demo with fake money. Never use the fake provider for real payments.
 */
export class NetlifyBlobsFakePaymentStore implements FakePaymentStore {
  readonly lockKey: string;

  constructor(
    private readonly store: () => JsonBlobsStoreLike,
    private readonly key = "fake-payments/state.json",
  ) {
    this.lockKey = `netlify-blobs:${key}`;
  }

  async load() {
    const data = (await this.store().get(this.key, { type: "json" })) as FakePaymentState | null;
    return data ?? emptyFakePaymentState();
  }

  async save(state: FakePaymentState) {
    await this.store().setJSON(this.key, state);
  }
}
