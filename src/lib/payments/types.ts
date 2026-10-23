// Provider-neutral payment contract. The app only talks to this interface;
// PAYMENT_PROVIDER picks the implementation (see ./index.ts).

/** Amounts are integers in the currency's minor unit (e.g. cents). */
export type Money = { amount: number; currency: string };

export type PaymentStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "canceled"
  | "refunded"
  | "partially_refunded";

export type Payment = Money & {
  id: string;
  status: PaymentStatus;
  amountRefunded: number;
  failureReason?: string;
  metadata: Record<string, string>;
  createdAt: string;
};

export type Refund = Money & {
  id: string;
  paymentId: string;
  createdAt: string;
};

export type DepositHoldStatus = "held" | "released" | "captured" | "failed";

export type DepositHold = Money & {
  id: string;
  status: DepositHoldStatus;
  amountCaptured: number;
  expiresAt: string;
  releaseReason?: "manual" | "expired";
  failureReason?: string;
  metadata: Record<string, string>;
  createdAt: string;
};

export type WebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "payment.refunded"
  | "deposit.held"
  | "deposit.failed"
  | "deposit.released"
  | "deposit.captured";

export type WebhookEvent = {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: Payment | DepositHold;
};

/** A verified provider event the app does not act on (still stored and acknowledged). */
export type IgnoredWebhookEvent = {
  id: string;
  type: "ignored";
  providerType: string;
  createdAt: string;
};

export type CreatePaymentInput = Money & {
  /** Card/token reference from the client. The fake provider uses FAKE_PAYMENT_METHODS. */
  paymentMethod: string;
  /** Same key returns the same payment instead of charging twice. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
};

export type HoldDepositInput = CreatePaymentInput & { expiresAt: Date };

export interface PaymentProvider {
  readonly name: string;
  /** Request header that carries the webhook signature (e.g. "stripe-signature"). */
  readonly webhookSignatureHeader: string;
  createPayment(input: CreatePaymentInput): Promise<Payment>;
  cancelPayment(paymentId: string): Promise<Payment>;
  /** Omit amount for a full refund of what remains. */
  refundPayment(paymentId: string, amount?: number): Promise<Refund>;
  holdDeposit(input: HoldDepositInput): Promise<DepositHold>;
  releaseDeposit(holdId: string, reason?: "manual" | "expired"): Promise<DepositHold>;
  /** Take some or all of a held deposit (e.g. damage). Any remainder is released. */
  captureDeposit(holdId: string, amount?: number): Promise<DepositHold>;
  /** Optional: holds whose authorisation lapsed at the provider (fake provider only). */
  listExpiredHolds?(now: Date): Promise<DepositHold[]>;
  /** Verify a webhook's signature and parse it. Throws on a bad signature. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookEvent | IgnoredWebhookEvent>;
}

export class PaymentError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_state" | "invalid_amount" | "bad_signature" | "provider_error",
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
