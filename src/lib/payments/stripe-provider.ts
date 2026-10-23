import Stripe from "stripe";
import {
  PaymentError,
  type CreatePaymentInput,
  type DepositHold,
  type HoldDepositInput,
  type IgnoredWebhookEvent,
  type Payment,
  type PaymentProvider,
  type PaymentStatus,
  type Refund,
  type WebhookEvent,
  type WebhookEventType,
} from "./types";

// Stripe adapter (PAYMENT_PROVIDER=stripe, test mode keys).
// - Rental charge: a PaymentIntent confirmed server-side with the client's PaymentMethod id
//   (collected in the browser with Stripe Elements using NEXT_PUBLIC_PAYMENT_PUBLISHABLE_KEY).
// - Security deposit: a PaymentIntent with capture_method "manual" (authorisation only);
//   release = cancel, capture = capture with amount_to_capture (the remainder is released).
// - Webhooks: verified with stripe.webhooks.constructEvent and the endpoint's signing secret.
// Card authorisations lapse after about 7 days at Stripe; longer rentals would need extended
// authorisation or a re-authorisation, which is out of scope here.

/** Just the fields of a Stripe PaymentIntent this adapter reads. */
export type StripePaymentIntentLike = {
  id: string;
  amount: number;
  amount_capturable?: number;
  amount_received?: number;
  currency: string;
  status: string;
  capture_method?: string;
  created: number;
  metadata?: Record<string, string> | null;
  last_payment_error?: { code?: string | null; message?: string | null } | null;
  cancellation_reason?: string | null;
  latest_charge?: string | { id: string; amount_refunded?: number } | null;
};

/** The subset of the Stripe SDK this adapter calls (injectable for unit tests). */
export type StripeLike = {
  paymentIntents: {
    create(params: Record<string, unknown>, options?: { idempotencyKey?: string }): Promise<StripePaymentIntentLike>;
    retrieve(id: string, params?: Record<string, unknown>): Promise<StripePaymentIntentLike>;
    cancel(id: string, params?: Record<string, unknown>): Promise<StripePaymentIntentLike>;
    capture(id: string, params?: Record<string, unknown>): Promise<StripePaymentIntentLike>;
  };
  refunds: {
    create(
      params: Record<string, unknown>,
      options?: { idempotencyKey?: string },
    ): Promise<{ id: string; amount: number; currency: string; created: number; payment_intent?: unknown }>;
  };
  webhooks: {
    constructEvent(payload: string, header: string, secret: string): {
      id: string;
      type: string;
      created: number;
      data: { object: unknown };
    };
  };
};

export type StripePaymentProviderOptions = {
  secretKey?: string;
  webhookSecret: string;
  /** Inject a fake SDK in tests. */
  client?: StripeLike;
};

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly webhookSignatureHeader = "stripe-signature";
  private readonly stripe: StripeLike;

  constructor(private readonly options: StripePaymentProviderOptions) {
    if (options.client) {
      this.stripe = options.client;
    } else {
      if (!options.secretKey) throw new Error("PAYMENT_SECRET_KEY is not set");
      if (!options.secretKey.startsWith("sk_test_") && process.env.ALLOW_LIVE_PAYMENTS !== "true") {
        throw new Error("Refusing a non-test Stripe key (set ALLOW_LIVE_PAYMENTS=true to override)");
      }
      this.stripe = new Stripe(options.secretKey) as unknown as StripeLike;
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    const pi = await this.call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          payment_method: input.paymentMethod,
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: input.metadata ?? {},
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    return toPayment(pi);
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    const pi = await this.call(() => this.stripe.paymentIntents.cancel(paymentId));
    return toPayment(pi);
  }

  async refundPayment(paymentId: string, amount?: number): Promise<Refund> {
    const refund = await this.call(() =>
      this.stripe.refunds.create(
        { payment_intent: paymentId, ...(amount !== undefined ? { amount } : {}) },
        amount !== undefined ? { idempotencyKey: `refund:${paymentId}:${amount}:${Date.now()}` } : undefined,
      ),
    );
    return {
      id: refund.id,
      paymentId,
      amount: refund.amount,
      currency: refund.currency.toUpperCase(),
      createdAt: new Date(refund.created * 1000).toISOString(),
    };
  }

  async holdDeposit(input: HoldDepositInput): Promise<DepositHold> {
    const pi = await this.call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          payment_method: input.paymentMethod,
          capture_method: "manual",
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: { ...(input.metadata ?? {}), kind: "deposit" },
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    return toDeposit(pi, input.expiresAt.toISOString());
  }

  async releaseDeposit(holdId: string, reason: "manual" | "expired" = "manual"): Promise<DepositHold> {
    const pi = await this.call(() => this.stripe.paymentIntents.cancel(holdId));
    return { ...toDeposit(pi), releaseReason: reason };
  }

  async captureDeposit(holdId: string, amount?: number): Promise<DepositHold> {
    const pi = await this.call(() =>
      this.stripe.paymentIntents.capture(holdId, amount !== undefined ? { amount_to_capture: amount } : {}),
    );
    return toDeposit(pi);
  }

  async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookEvent | IgnoredWebhookEvent> {
    if (!signatureHeader) throw new PaymentError("bad_signature", "Missing stripe-signature header");
    let event: ReturnType<StripeLike["webhooks"]["constructEvent"]>;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.options.webhookSecret);
    } catch (err) {
      throw new PaymentError("bad_signature", (err as Error).message);
    }
    const createdAt = new Date(event.created * 1000).toISOString();
    const ignored: IgnoredWebhookEvent = { id: event.id, type: "ignored", providerType: event.type, createdAt };
    if (!event.type.startsWith("payment_intent.")) {
      if (event.type === "charge.refunded") {
        const charge = event.data.object as { payment_intent?: string | null };
        if (!charge.payment_intent) return ignored;
        const pi = await this.call(() => this.stripe.paymentIntents.retrieve(charge.payment_intent!));
        return { id: event.id, type: "payment.refunded", createdAt, data: toPayment(pi) };
      }
      return ignored;
    }
    const pi = event.data.object as StripePaymentIntentLike;
    const isDeposit = pi.capture_method === "manual" || pi.metadata?.kind === "deposit";
    const type = mapEventType(event.type, pi, isDeposit);
    if (!type) return ignored;
    return { id: event.id, type, createdAt, data: isDeposit ? toDeposit(pi) : toPayment(pi) };
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { type?: string; code?: string; message?: string; statusCode?: number };
      if (e.statusCode === 404 || e.code === "resource_missing") throw new PaymentError("not_found", e.message ?? "Not found");
      if (e.code === "payment_intent_unexpected_state") throw new PaymentError("invalid_state", e.message ?? "Invalid state");
      if (e.code === "amount_too_large" || e.code === "amount_too_small") {
        throw new PaymentError("invalid_amount", e.message ?? "Invalid amount");
      }
      // Card errors (declines) come back as a failed intent, not an exception, when possible.
      if (e.type === "StripeCardError") throw new PaymentError("invalid_state", e.message ?? "Card error");
      throw new PaymentError("provider_error", e.message ?? "Payment provider error");
    }
  }
}

function mapEventType(type: string, pi: StripePaymentIntentLike, isDeposit: boolean): WebhookEventType | null {
  switch (type) {
    case "payment_intent.succeeded":
      return isDeposit ? "deposit.captured" : "payment.succeeded";
    case "payment_intent.payment_failed":
      return isDeposit ? "deposit.failed" : "payment.failed";
    case "payment_intent.canceled":
      return isDeposit ? "deposit.released" : "payment.canceled";
    case "payment_intent.amount_capturable_updated":
      return isDeposit && pi.status === "requires_capture" ? "deposit.held" : null;
    default:
      return null;
  }
}

function paymentStatusOf(pi: StripePaymentIntentLike): PaymentStatus {
  switch (pi.status) {
    case "succeeded": {
      const refunded = typeof pi.latest_charge === "object" && pi.latest_charge ? (pi.latest_charge.amount_refunded ?? 0) : 0;
      if (refunded > 0) return refunded >= pi.amount ? "refunded" : "partially_refunded";
      return "succeeded";
    }
    case "canceled":
      return "canceled";
    case "requires_payment_method":
      // Confirmed but declined: Stripe returns the intent to requires_payment_method.
      return pi.last_payment_error ? "failed" : "pending";
    default:
      return "pending"; // processing, requires_action, requires_confirmation
  }
}

export function toPayment(pi: StripePaymentIntentLike): Payment {
  const refunded = typeof pi.latest_charge === "object" && pi.latest_charge ? (pi.latest_charge.amount_refunded ?? 0) : 0;
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency.toUpperCase(),
    status: paymentStatusOf(pi),
    amountRefunded: refunded,
    failureReason: pi.last_payment_error?.code ?? pi.last_payment_error?.message ?? undefined,
    metadata: pi.metadata ?? {},
    createdAt: new Date(pi.created * 1000).toISOString(),
  };
}

export function toDeposit(pi: StripePaymentIntentLike, expiresAt?: string): DepositHold {
  let status: DepositHold["status"];
  switch (pi.status) {
    case "requires_capture":
      status = "held";
      break;
    case "succeeded":
      status = "captured";
      break;
    case "canceled":
      status = "released";
      break;
    default:
      // Declined, or needs customer action (3DS) that a server-side deposit hold cannot complete.
      status = "failed";
  }
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency.toUpperCase(),
    status,
    amountCaptured: status === "captured" ? (pi.amount_received ?? pi.amount) : 0,
    expiresAt: expiresAt ?? new Date((pi.created + 7 * 24 * 3600) * 1000).toISOString(),
    failureReason: pi.last_payment_error?.code ?? pi.last_payment_error?.message ?? undefined,
    metadata: pi.metadata ?? {},
    createdAt: new Date(pi.created * 1000).toISOString(),
  };
}
