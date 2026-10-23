import { describe, expect, it, vi } from "vitest";
import { StripePaymentProvider, type StripeLike, type StripePaymentIntentLike } from "./stripe-provider";

// Unit tests with a mocked Stripe SDK: no network, no real keys.

function pi(overrides: Partial<StripePaymentIntentLike> = {}): StripePaymentIntentLike {
  return { id: "pi_1", amount: 31_500, currency: "aed", status: "succeeded", created: 1_800_000_000, metadata: {}, ...overrides };
}

function setup() {
  const client = {
    paymentIntents: {
      create: vi.fn(async (params: Record<string, unknown>) =>
        pi({ status: params.capture_method === "manual" ? "requires_capture" : "succeeded", capture_method: params.capture_method as string }),
      ),
      retrieve: vi.fn(async () => pi({ latest_charge: { id: "ch_1", amount_refunded: 31_500 } })),
      cancel: vi.fn(async () => pi({ status: "canceled", capture_method: "manual" })),
      capture: vi.fn(async (_id: string, params?: Record<string, unknown>) =>
        pi({ status: "succeeded", capture_method: "manual", amount_received: (params?.amount_to_capture as number) ?? 31_500 }),
      ),
    },
    refunds: { create: vi.fn(async (p: Record<string, unknown>) => ({ id: "re_1", amount: (p.amount as number) ?? 31_500, currency: "aed", created: 1_800_000_000 })) },
    webhooks: { constructEvent: vi.fn() },
  } satisfies StripeLike;
  const provider = new StripePaymentProvider({ webhookSecret: "whsec_test", client });
  return { client, provider };
}

describe("StripePaymentProvider", () => {
  it("charges with a confirmed PaymentIntent and passes the idempotency key", async () => {
    const { client, provider } = setup();
    const p = await provider.createPayment({ amount: 31_500, currency: "AED", paymentMethod: "pm_card_visa", idempotencyKey: "k1", metadata: { paymentId: "x" } });
    expect(p).toMatchObject({ id: "pi_1", status: "succeeded", amount: 31_500, currency: "AED" });
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 31_500, currency: "aed", payment_method: "pm_card_visa", confirm: true, metadata: { paymentId: "x" } }),
      { idempotencyKey: "k1" },
    );
  });

  it("maps a declined intent to failed", async () => {
    const { client, provider } = setup();
    client.paymentIntents.create.mockResolvedValueOnce(pi({ status: "requires_payment_method", last_payment_error: { code: "card_declined" } }));
    expect(await provider.createPayment({ amount: 1, currency: "AED", paymentMethod: "pm_x", idempotencyKey: "k" })).toMatchObject({
      status: "failed",
      failureReason: "card_declined",
    });
  });

  it("holds the deposit as a manual-capture intent, releases by cancel, captures partially", async () => {
    const { client, provider } = setup();
    const hold = await provider.holdDeposit({ amount: 150_000, currency: "AED", paymentMethod: "pm_card_visa", idempotencyKey: "h", expiresAt: new Date() });
    expect(hold.status).toBe("held");
    expect(client.paymentIntents.create.mock.calls[0][0]).toMatchObject({ capture_method: "manual", confirm: true });
    expect((await provider.releaseDeposit("pi_1", "expired")).status).toBe("released");
    expect(client.paymentIntents.cancel).toHaveBeenCalledWith("pi_1");
    const cap = await provider.captureDeposit("pi_1", 18_900);
    expect(cap).toMatchObject({ status: "captured", amountCaptured: 18_900 });
    expect(client.paymentIntents.capture).toHaveBeenCalledWith("pi_1", { amount_to_capture: 18_900 });
  });

  it("refunds through the Refunds API", async () => {
    const { client, provider } = setup();
    const r = await provider.refundPayment("pi_1", 2_000);
    expect(r).toMatchObject({ id: "re_1", paymentId: "pi_1", amount: 2_000, currency: "AED" });
    expect(client.refunds.create.mock.calls[0][0]).toEqual({ payment_intent: "pi_1", amount: 2_000 });
  });

  it("verifies webhooks with constructEvent and maps event types", async () => {
    const { client, provider } = setup();
    client.webhooks.constructEvent.mockReturnValueOnce({ id: "evt_1", type: "payment_intent.succeeded", created: 1_800_000_000, data: { object: pi() } });
    expect(await provider.verifyWebhook("{}", "t=1,v1=x")).toMatchObject({ id: "evt_1", type: "payment.succeeded", data: { id: "pi_1" } });

    client.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_2",
      type: "payment_intent.amount_capturable_updated",
      created: 1,
      data: { object: pi({ status: "requires_capture", capture_method: "manual" }) },
    });
    expect((await provider.verifyWebhook("{}", "sig")).type).toBe("deposit.held");

    client.webhooks.constructEvent.mockReturnValueOnce({ id: "evt_3", type: "charge.refunded", created: 1, data: { object: { payment_intent: "pi_1" } } });
    expect(await provider.verifyWebhook("{}", "sig")).toMatchObject({ type: "payment.refunded", data: { status: "refunded" } });

    client.webhooks.constructEvent.mockReturnValueOnce({ id: "evt_4", type: "customer.created", created: 1, data: { object: {} } });
    expect(await provider.verifyWebhook("{}", "sig")).toMatchObject({ type: "ignored", providerType: "customer.created" });
  });

  it("rejects bad or missing signatures", async () => {
    const { client, provider } = setup();
    client.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    await expect(provider.verifyWebhook("{}", "bad")).rejects.toMatchObject({ code: "bad_signature" });
    await expect(provider.verifyWebhook("{}", null)).rejects.toMatchObject({ code: "bad_signature" });
  });

  it("refuses live keys unless explicitly allowed", () => {
    expect(() => new StripePaymentProvider({ secretKey: "sk_live_123", webhookSecret: "w" })).toThrow(/non-test/);
  });
});
