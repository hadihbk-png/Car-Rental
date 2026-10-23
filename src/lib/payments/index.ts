import { getStore } from "@netlify/blobs";
import { assertPersistentDiskAvailable, ConfigurationError, isDeployedProduction } from "@/lib/platform";
import { FakePaymentProvider } from "./fake-provider";
import { JsonFileFakePaymentStore, NetlifyBlobsFakePaymentStore, type FakePaymentStore, type JsonBlobsStoreLike } from "./fake-store";
import { StripePaymentProvider } from "./stripe-provider";
import type { PaymentProvider } from "./types";

export * from "./types";
export { FAKE_PAYMENT_METHODS } from "./fake-provider";

let provider: PaymentProvider | undefined;

type Env = Record<string, string | undefined>;

/** Returns the provider named by PAYMENT_PROVIDER: "fake" (default, local) or "stripe" (test mode). */
export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  const name = process.env.PAYMENT_PROVIDER || "fake";
  switch (name) {
    case "fake":
      assertFakePaymentsAllowed();
      provider = new FakePaymentProvider({
        store: fakePaymentStore(),
        webhookSecret: required("PAYMENT_WEBHOOK_SECRET"),
        webhookUrl: fakeWebhookUrl(),
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

/**
 * The fake provider takes no real money. On a deployed production build (Netlify / Vercel) it is
 * refused unless ALLOW_FAKE_PAYMENTS=true is set on purpose (demo sites).
 */
export function assertFakePaymentsAllowed(env: Env = process.env) {
  if (isDeployedProduction(env) && env.ALLOW_FAKE_PAYMENTS !== "true") {
    throw new ConfigurationError(
      "PAYMENT_PROVIDER=fake is not allowed in a deployed production build. Set PAYMENT_PROVIDER=stripe with test keys, " +
        "or set ALLOW_FAKE_PAYMENTS=true for a demo site that takes no real payments.",
    );
  }
}

/** FAKE_PAYMENTS_WEBHOOK_URL (an explicit empty value disables delivery), else ${URL}/api/webhooks/payments. */
export function fakeWebhookUrl(env: Env = process.env): string | undefined {
  if (env.FAKE_PAYMENTS_WEBHOOK_URL !== undefined) return env.FAKE_PAYMENTS_WEBHOOK_URL || undefined;
  return env.URL ? `${env.URL.replace(/\/+$/, "")}/api/webhooks/payments` : undefined;
}

/** FAKE_PAYMENTS_STORE: "file" (default, local JSON file) or "netlify-blobs" (demo deployments). */
export function fakePaymentStore(env: Env = process.env): FakePaymentStore {
  const kind = env.FAKE_PAYMENTS_STORE || "file";
  switch (kind) {
    case "file":
      assertPersistentDiskAvailable("FAKE_PAYMENTS_STORE=file", "FAKE_PAYMENTS_STORE=netlify-blobs", env);
      // Relative paths resolve against the working directory inside the fs calls; no
      // path.resolve at module scope, so the bundler's file tracer is not widened (BUG-002).
      return new JsonFileFakePaymentStore(env.FAKE_PAYMENTS_STATE_FILE || ".local/fake-payments.json");
    case "netlify-blobs": {
      let store: JsonBlobsStoreLike | undefined;
      return new NetlifyBlobsFakePaymentStore(
        () => (store ??= getStore({ name: env.NETLIFY_BLOBS_STORE || "driveeasy-files", consistency: "strong" }) as unknown as JsonBlobsStoreLike),
      );
    }
    default:
      throw new Error(`FAKE_PAYMENTS_STORE "${kind}" is not supported. Use "file" or "netlify-blobs".`);
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
