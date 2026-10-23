import { describe, expect, it } from "vitest";
import { FAKE_PAYMENT_METHODS, FakePaymentProvider } from "./fake-provider";
import { MemoryFakePaymentStore } from "./fake-store";
import type { WebhookEvent } from "./types";

const SECRET = "test-secret";

function setup(opts: { duplicateWebhooks?: number } = {}) {
  const received: { body: string; signature: string | null }[] = [];
  const provider = new FakePaymentProvider({
    store: new MemoryFakePaymentStore(),
    webhookSecret: SECRET,
    webhookUrl: "http://app.test/api/webhooks/payments",
    duplicateWebhooks: opts.duplicateWebhooks,
    fetch: async (_url, init) => {
      received.push({ body: String(init?.body), signature: new Headers(init?.headers).get("fake-signature") });
      return new Response(null, { status: 200 });
    },
  });
  const events = () => received.map((r) => JSON.parse(r.body) as WebhookEvent);
  return { provider, received, events };
}

const pay = { amount: 12_000, currency: "EUR" };

describe("FakePaymentProvider", () => {
  it("succeeds, and an idempotency key never charges twice", async () => {
    const { provider, events } = setup();
    const a = await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "k1" });
    const b = await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "k1" });
    expect(a.status).toBe("succeeded");
    expect(b.id).toBe(a.id);
    expect(events().map((e) => e.type)).toEqual(["payment.succeeded"]);
  });

  it("fails on a declined card", async () => {
    const { provider, events } = setup();
    const p = await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.decline, idempotencyKey: "k" });
    expect(p).toMatchObject({ status: "failed", failureReason: "card_declined" });
    expect(events()[0].type).toBe("payment.failed");
  });

  it("cancels a pending payment but not a completed one", async () => {
    const { provider } = setup();
    const pending = await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.pending, idempotencyKey: "p" });
    expect((await provider.cancelPayment(pending.id)).status).toBe("canceled");
    const done = await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "d" });
    await expect(provider.cancelPayment(done.id)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("refunds partially, then fully, and rejects over-refunds", async () => {
    const { provider } = setup();
    const p = await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "r" });
    await provider.refundPayment(p.id, 2_000);
    await expect(provider.refundPayment(p.id, 20_000)).rejects.toMatchObject({ code: "invalid_amount" });
    const full = await provider.refundPayment(p.id);
    expect(full.amount).toBe(10_000);
  });

  it("holds, releases and captures deposits", async () => {
    const { provider, events } = setup();
    const expiresAt = new Date(Date.now() + 3_600_000);
    const h1 = await provider.holdDeposit({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "h1", expiresAt });
    expect(h1.status).toBe("held");
    expect((await provider.releaseDeposit(h1.id)).status).toBe("released");

    const h2 = await provider.holdDeposit({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "h2", expiresAt });
    expect(await provider.captureDeposit(h2.id, 3_000)).toMatchObject({ status: "captured", amountCaptured: 3_000 });

    const h3 = await provider.holdDeposit({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.decline, idempotencyKey: "h3", expiresAt });
    expect(h3.status).toBe("failed");
    expect(events().map((e) => e.type)).toEqual([
      "deposit.held", "deposit.released", "deposit.held", "deposit.captured", "deposit.failed",
    ]);
  });

  it("sends signed webhooks that verify, and rejects tampered ones", async () => {
    const { provider, received } = setup();
    await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "w" });
    const { body, signature } = received[0];
    expect((await provider.verifyWebhook(body, signature)).type).toBe("payment.succeeded");
    await expect(provider.verifyWebhook(body.replace("12000", "1"), signature)).rejects.toMatchObject({ code: "bad_signature" });
    await expect(provider.verifyWebhook(body, null)).rejects.toMatchObject({ code: "bad_signature" });
  });

  it("sends duplicate webhooks with the same event id", async () => {
    const { provider, events } = setup({ duplicateWebhooks: 2 });
    await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "dup" });
    const ids = events().map((e) => e.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
  });

  it("resends a recorded event on demand", async () => {
    const { provider, events } = setup();
    await provider.createPayment({ ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "re" });
    await provider.resendEvent(events()[0].id);
    expect(events()).toHaveLength(2);
    expect(events()[1].id).toBe(events()[0].id);
  });
});

describe("FakePaymentProvider.listExpiredHolds", () => {
  it("lists only holds past their expiry", async () => {
    const { provider } = setup();
    const now = new Date();
    const expired = await provider.holdDeposit({
      ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "old", expiresAt: new Date(now.getTime() - 1_000),
    });
    await provider.holdDeposit({
      ...pay, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: "new", expiresAt: new Date(now.getTime() + 60_000),
    });
    expect((await provider.listExpiredHolds(now)).map((h) => h.id)).toEqual([expired.id]);
  });
});
