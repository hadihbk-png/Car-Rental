import { log, requestIdFrom } from "@/lib/log";
import { getPaymentProvider, PaymentError } from "@/lib/payments";
import { processPaymentWebhook } from "@/lib/reservations/payment-flow";

// Payment provider webhooks (fake provider locally, Stripe when PAYMENT_PROVIDER=stripe).
// 1) verify the signature on the raw body, 2) store the event id (unique), 3) apply it once.
// Duplicate deliveries return 200 without re-processing. Errors return 500 so the provider retries.

export async function POST(request: Request) {
  const requestId = requestIdFrom(request.headers);
  const provider = getPaymentProvider();
  const rawBody = await request.text();
  let event;
  try {
    event = await provider.verifyWebhook(rawBody, request.headers.get(provider.webhookSignatureHeader));
  } catch (err) {
    if (err instanceof PaymentError && err.code === "bad_signature") {
      log.warn("webhook signature rejected", { requestId, provider: provider.name, reason: err.message });
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    }
    log.error("webhook verification failed", { requestId, error: err });
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const result = await processPaymentWebhook(provider.name, event);
    log.info("webhook processed", { requestId, provider: provider.name, ...result });
    return Response.json({ received: true, duplicate: result.duplicate });
  } catch (err) {
    log.error("webhook processing failed", { requestId, provider: provider.name, eventId: event.id, error: err });
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
