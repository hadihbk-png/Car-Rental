import { FakePaymentProvider } from "./fake-provider";
import { JsonFileFakePaymentStore } from "./fake-store";
import { StripePaymentProvider } from "./stripe-provider";
import type { PaymentProvider } from "./types";

export * from "./types";
export { FAKE_PAYMENT_METHODS } from "./fake-provider";

let provider: PaymentProvider | undefined;

/** Returns the provider named by PAYMENT_PROVIDER: "fake" (default, local) or "stripe" (test mode). */
export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  const name = process.env.PAYMENT_PROVIDER ?? "fake";
  switch (name) {
    case "fake":
      provider = new FakePaymentProvider({
        // Relative paths resolve against the working directory inside the fs calls; no
        // path.resolve at module scope, so the bundler's file tracer is not widened (BUG-002).
        store: new JsonFileFakePaymentStore(process.env.FAKE_PAYMENTS_STATE_FILE || ".local/fake-payments.json"),
        webhookSecret: required("PAYMENT_WEBHOOK_SECRET"),
        webhookUrl: process.env.FAKE_PAYMENTS_WEBHOOK_URL || undefined,
        duplicateWebhooks: Number(process.env.FAKE_PAYMENTS_WEBHOOK_DUPLICATES ?? 0),
      });
      return provider;
    case "stripe":
      provider = new StripePaymentProvider({
        secretKey: required("PAYMENT_SECRET_KEY"),
        webhookSecret: required("PAYMENT_WEBHOOK_SECRET"),
      });
      return provider;
    default:
      throw new Error(`PAYMENT_PROVIDER "${name}" has no adapter. Use "fake" or "stripe".`);
  }
}

/** Tests only: replace (or reset with undefined) the provider singleton. */
export function setPaymentProviderForTesting(next: PaymentProvider | undefined) {
  provider = next;
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}
