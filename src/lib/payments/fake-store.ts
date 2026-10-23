import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/** For local dev: state survives restarts, so the cleanup command can see app-created holds. */
export class JsonFileFakePaymentStore implements FakePaymentStore {
  constructor(private readonly filePath: string) {}

  async load() {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as FakePaymentState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyFakePaymentState();
      throw err;
    }
  }

  async save(state: FakePaymentState) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, this.filePath);
  }
}

/** The subset of a @netlify/blobs Store used by the fake-payment state (injectable for tests). */
export type JsonBlobsStoreLike = {
  get(key: string, options: { type: "json" }): Promise<unknown>;
  setJSON(key: string, data: unknown): Promise<unknown>;
};

/**
 * Demo deployments only (FAKE_PAYMENTS_STORE=netlify-blobs): keeps the fake provider's state in
 * Netlify Blobs because function disks do not persist. Last write wins, which is fine for a demo
 * with fake money; never use the fake provider for real payments.
 */
export class NetlifyBlobsFakePaymentStore implements FakePaymentStore {
  constructor(
    private readonly store: () => JsonBlobsStoreLike,
    private readonly key = "fake-payments/state.json",
  ) {}

  async load() {
    const data = (await this.store().get(this.key, { type: "json" })) as FakePaymentState | null;
    return data ?? emptyFakePaymentState();
  }

  async save(state: FakePaymentState) {
    await this.store().setJSON(this.key, state);
  }
}
