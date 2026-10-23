import path from "node:path";
import { FakePaymentProvider } from "./fake-provider";
import { JsonFileFakePaymentStore } from "./fake-store";
import type { PaymentProvider } from "./types";

export * from "./types";

let provider: PaymentProvider | undefined;

/** Returns the provider named by PAYMENT_PROVIDER. Add the real adapter as a new case. */
export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  const name = process.env.PAYMENT_PROVIDER ?? "fake";
  switch (name) {
    case "fake":
      provider = new FakePaymentProvider({
        store: new JsonFileFakePaymentStore(
          path.resolve(process.env.FAKE_PAYMENTS_STATE_FILE ?? ".local/fake-payments.json"),
        ),
        webhookSecret: required("PAYMENT_WEBHOOK_SECRET"),
        webhookUrl: process.env.FAKE_PAYMENTS_WEBHOOK_URL || undefined,
        duplicateWebhooks: Number(process.env.FAKE_PAYMENTS_WEBHOOK_DUPLICATES ?? 0),
      });
      return provider;
    default:
      throw new Error(`PAYMENT_PROVIDER "${name}" has no adapter yet. Add one in src/lib/payments/.`);
  }
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}
