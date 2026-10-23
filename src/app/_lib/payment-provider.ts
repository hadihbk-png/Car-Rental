import "server-only";
import type { PaymentProviderName } from "@/app/_components/payment-method-input";

/** Name of the active payment provider for the UI (never any key). */
export function activePaymentProvider(): PaymentProviderName {
  return process.env.PAYMENT_PROVIDER === "stripe" ? "stripe" : "fake";
}
