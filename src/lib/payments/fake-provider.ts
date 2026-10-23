import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FakePaymentState, FakePaymentStore } from "./fake-store";
import {
  PaymentError,
  type CreatePaymentInput,
  type DepositHold,
  type HoldDepositInput,
  type Payment,
  type PaymentProvider,
  type Refund,
  type WebhookEvent,
  type WebhookEventType,
} from "./types";

/** Pass one of these as `paymentMethod` to choose the outcome. */
export const FAKE_PAYMENT_METHODS = {
  success: "fake_success",
  decline: "fake_decline",
  /** Payment stays pending so it can be canceled. */
  pending: "fake_pending",
} as const;

export const FAKE_SIGNATURE_HEADER = "fake-signature";
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export type FakePaymentProviderOptions = {
  store: FakePaymentStore;
  webhookSecret: string;
  /** Where webhooks are POSTed. Unset = events are only recorded in the store. */
  webhookUrl?: string;
  /** Extra copies of every webhook (same event id), to test duplicate handling. */
  duplicateWebhooks?: number;
  now?: () => Date;
  fetch?: typeof fetch;
};

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly webhookSignatureHeader = FAKE_SIGNATURE_HEADER;
  private readonly now: () => Date;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: FakePaymentProviderOptions) {
    this.now = options.now ?? (() => new Date());
    this.fetchFn = options.fetch ?? fetch;
  }

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    assertAmount(input.amount);
    return this.mutate((state, emit) => {
      const existing = state.idempotency[`payment:${input.idempotencyKey}`];
      if (existing) return state.payments[existing];

      const outcome = outcomeFor(input.paymentMethod);
      const payment: Payment = {
        id: `pay_${randomUUID()}`,
        amount: input.amount,
        currency: input.currency,
        status: outcome === "decline" ? "failed" : outcome === "pending" ? "pending" : "succeeded",
        amountRefunded: 0,
        failureReason: outcome === "decline" ? "card_declined" : undefined,
        metadata: input.metadata ?? {},
        createdAt: this.now().toISOString(),
      };
      state.payments[payment.id] = payment;
      state.idempotency[`payment:${input.idempotencyKey}`] = payment.id;
      if (payment.status === "succeeded") emit("payment.succeeded", payment);
      if (payment.status === "failed") emit("payment.failed", payment);
      return payment;
    });
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    return this.mutate((state, emit) => {
      const payment = find(state.payments, paymentId);
      if (payment.status !== "pending") {
        throw new PaymentError("invalid_state", `Cannot cancel a ${payment.status} payment`);
      }
      payment.status = "canceled";
      emit("payment.canceled", payment);
      return payment;
    });
  }

  async refundPayment(paymentId: string, amount?: number): Promise<Refund> {
    return this.mutate((state, emit) => {
      const payment = find(state.payments, paymentId);
      if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
        throw new PaymentError("invalid_state", `Cannot refund a ${payment.status} payment`);
      }
      const remaining = payment.amount - payment.amountRefunded;
      const refundAmount = amount ?? remaining;
      assertAmount(refundAmount);
      if (refundAmount > remaining) {
        throw new PaymentError("invalid_amount", `Refund ${refundAmount} exceeds remaining ${remaining}`);
      }
      const refund: Refund = {
        id: `re_${randomUUID()}`,
        paymentId,
        amount: refundAmount,
        currency: payment.currency,
        createdAt: this.now().toISOString(),
      };
      state.refunds[refund.id] = refund;
      payment.amountRefunded += refundAmount;
      payment.status = payment.amountRefunded === payment.amount ? "refunded" : "partially_refunded";
      emit("payment.refunded", payment);
      return refund;
    });
  }

  async holdDeposit(input: HoldDepositInput): Promise<DepositHold> {
    assertAmount(input.amount);
    return this.mutate((state, emit) => {
      const existing = state.idempotency[`hold:${input.idempotencyKey}`];
      if (existing) return state.holds[existing];

      const declined = outcomeFor(input.paymentMethod) === "decline";
      const hold: DepositHold = {
        id: `hold_${randomUUID()}`,
        amount: input.amount,
        currency: input.currency,
        status: declined ? "failed" : "held",
        amountCaptured: 0,
        expiresAt: input.expiresAt.toISOString(),
        failureReason: declined ? "card_declined" : undefined,
        metadata: input.metadata ?? {},
        createdAt: this.now().toISOString(),
      };
      state.holds[hold.id] = hold;
      state.idempotency[`hold:${input.idempotencyKey}`] = hold.id;
      emit(declined ? "deposit.failed" : "deposit.held", hold);
      return hold;
    });
  }

  async releaseDeposit(holdId: string, reason: "manual" | "expired" = "manual"): Promise<DepositHold> {
    return this.mutate((state, emit) => {
      const hold = find(state.holds, holdId);
      if (hold.status !== "held") {
        throw new PaymentError("invalid_state", `Cannot release a ${hold.status} deposit`);
      }
      hold.status = "released";
      hold.releaseReason = reason;
      emit("deposit.released", hold);
      return hold;
    });
  }

  async captureDeposit(holdId: string, amount?: number): Promise<DepositHold> {
    return this.mutate((state, emit) => {
      const hold = find(state.holds, holdId);
      if (hold.status !== "held") {
        throw new PaymentError("invalid_state", `Cannot capture a ${hold.status} deposit`);
      }
      const captureAmount = amount ?? hold.amount;
      assertAmount(captureAmount);
      if (captureAmount > hold.amount) {
        throw new PaymentError("invalid_amount", `Capture ${captureAmount} exceeds hold ${hold.amount}`);
      }
      hold.status = "captured";
      hold.amountCaptured = captureAmount;
      emit("deposit.captured", hold);
      return hold;
    });
  }

  async listExpiredHolds(now: Date): Promise<DepositHold[]> {
    const state = await this.options.store.load();
    return Object.values(state.holds).filter(
      (h) => h.status === "held" && new Date(h.expiresAt) <= now,
    );
  }

  async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookEvent> {
    const parts = Object.fromEntries(
      (signatureHeader ?? "").split(",").map((p) => p.split("=", 2) as [string, string]),
    );
    const timestamp = Number(parts.t);
    if (!parts.v1 || !Number.isFinite(timestamp)) {
      throw new PaymentError("bad_signature", "Missing or malformed signature header");
    }
    if (Math.abs(this.now().getTime() - timestamp * 1000) > SIGNATURE_TOLERANCE_MS) {
      throw new PaymentError("bad_signature", "Signature timestamp outside tolerance");
    }
    const expected = Buffer.from(this.sign(timestamp, rawBody), "hex");
    const given = Buffer.from(parts.v1, "hex");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new PaymentError("bad_signature", "Signature mismatch");
    }
    return JSON.parse(rawBody) as WebhookEvent;
  }

  /** Dev/test helper: deliver an already-recorded event again (simulates provider retries). */
  async resendEvent(eventId: string): Promise<void> {
    const state = await this.options.store.load();
    const event = state.events.find((e) => e.id === eventId);
    if (!event) throw new PaymentError("not_found", `No event ${eventId}`);
    await this.deliver([event], 0, state);
    await this.options.store.save(state);
  }

  /** Builds the header value the real webhook route will receive. Exposed for tests. */
  signatureHeader(rawBody: string, at: Date = this.now()): string {
    const timestamp = Math.floor(at.getTime() / 1000);
    return `t=${timestamp},v1=${this.sign(timestamp, rawBody)}`;
  }

  private sign(timestamp: number, rawBody: string) {
    return createHmac("sha256", this.options.webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");
  }

  private async mutate<T>(
    fn: (state: FakePaymentState, emit: (type: WebhookEventType, data: Payment | DepositHold) => void) => T,
  ): Promise<T> {
    const state = await this.options.store.load();
    const events: WebhookEvent[] = [];
    const result = fn(state, (type, data) =>
      events.push({ id: `evt_${randomUUID()}`, type, createdAt: this.now().toISOString(), data: structuredClone(data) }),
    );
    state.events.push(...events);
    await this.deliver(events, this.options.duplicateWebhooks ?? 0, state);
    await this.options.store.save(state);
    return structuredClone(result);
  }

  private async deliver(events: WebhookEvent[], duplicates: number, state: FakePaymentState) {
    const url = this.options.webhookUrl;
    if (!url) return;
    for (const event of events) {
      const body = JSON.stringify(event);
      for (let attempt = 1; attempt <= 1 + duplicates; attempt++) {
        const at = this.now().toISOString();
        try {
          const res = await this.fetchFn(url, {
            method: "POST",
            headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: this.signatureHeader(body) },
            body,
          });
          state.deliveries.push({ eventId: event.id, attempt, ok: res.ok, status: res.status, at });
        } catch (err) {
          // The app may not be running (e.g. CLI use). Record it; resendEvent can retry later.
          state.deliveries.push({ eventId: event.id, attempt, ok: false, error: String(err), at });
        }
      }
    }
  }
}

function outcomeFor(paymentMethod: string): "success" | "decline" | "pending" {
  if (paymentMethod === FAKE_PAYMENT_METHODS.decline) return "decline";
  if (paymentMethod === FAKE_PAYMENT_METHODS.pending) return "pending";
  return "success";
}

function find<T>(records: Record<string, T>, id: string): T {
  const record = records[id];
  if (!record) throw new PaymentError("not_found", `No record ${id}`);
  return record;
}

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new PaymentError("invalid_amount", `Amount must be a positive integer, got ${amount}`);
  }
}
