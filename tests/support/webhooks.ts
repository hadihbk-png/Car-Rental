// Signed fake-provider webhook helper. Produces exactly the headers
// FakePaymentProvider sends (see src/lib/payments/fake-provider.ts) so tests
// can deliver events to the app's webhook route directly: duplicates,
// out-of-order, tampered, stale. Pure Node (no app imports) so Playwright and
// Vitest can both use it; tests/unit/webhooks-helper.test.ts proves the
// signatures verify with the real provider.
import { createHmac, randomUUID } from "node:crypto";

export const FAKE_SIGNATURE_HEADER = "fake-signature";

/** Default route path. Adjust here if the Database Engine Agent mounts it elsewhere. */
export const PAYMENT_WEBHOOK_PATH = "/api/webhooks/payments";

export type FakeWebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "payment.refunded"
  | "deposit.held"
  | "deposit.failed"
  | "deposit.released"
  | "deposit.captured";

export type FakeWebhookEvent = {
  id: string;
  type: FakeWebhookEventType;
  createdAt: string;
  data: Record<string, unknown>;
};

export function webhookSecret(): string {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) throw new Error("PAYMENT_WEBHOOK_SECRET is not set");
  return secret;
}

/** Same format as FakePaymentProvider.signatureHeader: `t=<unix seconds>,v1=<hex hmac of "t.body">`. */
export function signFakeWebhook(rawBody: string, secret = webhookSecret(), at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Builds an event shaped like the provider's (data = Payment or DepositHold). */
export function makeFakeEvent(
  type: FakeWebhookEventType,
  data: Record<string, unknown>,
  overrides: Partial<Pick<FakeWebhookEvent, "id" | "createdAt">> = {},
): FakeWebhookEvent {
  return { id: overrides.id ?? `evt_${randomUUID()}`, type, createdAt: overrides.createdAt ?? new Date().toISOString(), data };
}

export type SendOptions = {
  /** Total deliveries of the identical body+event id (1 = no duplicates). */
  times?: number;
  /** Deliver copies concurrently (true) or one after another (false, default). */
  concurrent?: boolean;
  /** Corrupt the signature, omit it, or sign with a timestamp outside the 5-minute tolerance. */
  signature?: "valid" | "tampered" | "missing" | "stale";
  secret?: string;
  /**
   * How to deliver: defaults to fetch(`${baseUrl}${PAYMENT_WEBHOOK_PATH}`).
   * Integration tests can pass the route handler itself, e.g. `send: POST`.
   */
  send?: (request: Request) => Promise<Response>;
  baseUrl?: string;
};

export type Delivery = { status: number; body: string };

export function buildWebhookRequest(event: FakeWebhookEvent, opts: SendOptions = {}): Request {
  const body = JSON.stringify(event);
  const secret = opts.secret ?? webhookSecret();
  const headers = new Headers({ "content-type": "application/json" });
  const mode = opts.signature ?? "valid";
  if (mode !== "missing") {
    const at = mode === "stale" ? new Date(Date.now() - 10 * 60 * 1000) : new Date();
    let sig = signFakeWebhook(body, secret, at);
    if (mode === "tampered") sig = sig.replace(/v1=(.)/, (_, c: string) => `v1=${c === "0" ? "1" : "0"}`);
    headers.set(FAKE_SIGNATURE_HEADER, sig);
  }
  const base = opts.baseUrl ?? process.env.E2E_BASE_URL ?? "http://localhost:3100";
  return new Request(new URL(PAYMENT_WEBHOOK_PATH, base), { method: "POST", headers, body });
}

/** Delivers one event `times` times (same event id each time) and returns every response. */
export async function sendFakeWebhook(event: FakeWebhookEvent, opts: SendOptions = {}): Promise<Delivery[]> {
  const send = opts.send ?? ((req: Request) => fetch(req));
  const times = opts.times ?? 1;
  const deliverOnce = async (): Promise<Delivery> => {
    const res = await send(buildWebhookRequest(event, opts));
    return { status: res.status, body: await res.text() };
  };
  if (opts.concurrent) return Promise.all(Array.from({ length: times }, deliverOnce));
  const out: Delivery[] = [];
  for (let i = 0; i < times; i++) out.push(await deliverOnce());
  return out;
}
