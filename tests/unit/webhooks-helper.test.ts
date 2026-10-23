import { describe, expect, it } from "vitest";
import { FakePaymentProvider } from "@/lib/payments/fake-provider";
import { MemoryFakePaymentStore } from "@/lib/payments/fake-store";
import { buildWebhookRequest, makeFakeEvent, sendFakeWebhook, signFakeWebhook } from "../support/webhooks";

const secret = "qa-webhook-secret";
const provider = new FakePaymentProvider({ store: new MemoryFakePaymentStore(), webhookSecret: secret });
const event = makeFakeEvent("payment.succeeded", { id: "pay_1", amount: 12_000, currency: "AED", status: "succeeded" });

describe("QA webhook helper", () => {
  it("signs exactly like FakePaymentProvider", async () => {
    const body = JSON.stringify(event);
    const at = new Date();
    expect(signFakeWebhook(body, secret, at)).toBe(provider.signatureHeader(body, at));
    const req = buildWebhookRequest(event, { secret, baseUrl: "http://app.test" });
    expect(new URL(req.url).pathname).toBe("/api/webhooks/payments");
    expect((await provider.verifyWebhook(await req.text(), req.headers.get("fake-signature"))).id).toBe(event.id);
  });

  it.each(["tampered", "missing", "stale"] as const)("produces %s signatures the provider rejects", async (signature) => {
    const req = buildWebhookRequest(event, { secret, signature, baseUrl: "http://app.test" });
    await expect(provider.verifyWebhook(await req.text(), req.headers.get("fake-signature"))).rejects.toMatchObject({
      code: "bad_signature",
    });
  });

  it("delivers duplicates with the same event id, sequentially or concurrently", async () => {
    for (const concurrent of [false, true]) {
      const seen: string[] = [];
      const deliveries = await sendFakeWebhook(event, {
        secret,
        times: 3,
        concurrent,
        send: async (req) => {
          seen.push((await provider.verifyWebhook(await req.text(), req.headers.get("fake-signature"))).id);
          return new Response("ok", { status: 200 });
        },
      });
      expect(deliveries.map((d) => d.status)).toEqual([200, 200, 200]);
      expect(seen).toEqual([event.id, event.id, event.id]);
    }
  });
});
