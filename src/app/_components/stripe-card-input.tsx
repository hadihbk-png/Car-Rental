"use client";

/**
 * Stripe Elements card field (PAYMENT_PROVIDER=stripe). Produces a PaymentMethod id (pm_...)
 * that the server passes to the Stripe adapter. Only the publishable key reaches the browser.
 * NOTE: untested locally (no Stripe keys in this environment).
 */
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useImperativeHandle, useState, type Ref } from "react";
import type { PaymentMethodHandle } from "./payment-method-input";

const publishableKey = process.env.NEXT_PUBLIC_PAYMENT_PUBLISHABLE_KEY ?? "";
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise) stripePromise = publishableKey ? loadStripe(publishableKey) : Promise.resolve(null);
  return stripePromise;
}

function CardField({ handleRef, disabled }: { handleRef: Ref<PaymentMethodHandle>; disabled?: boolean }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(
    handleRef,
    () => ({
      collect: async () => {
        if (!stripe || !elements) return { ok: false, message: "The card form is still loading. Please wait a moment." };
        const card = elements.getElement(CardElement);
        if (!card) return { ok: false, message: "Enter your card details." };
        const result = await stripe.createPaymentMethod({ type: "card", card });
        if (result.error || !result.paymentMethod) {
          const message = result.error?.message ?? "Your card details could not be used.";
          setError(message);
          return { ok: false, message };
        }
        setError(null);
        return { ok: true, paymentMethod: result.paymentMethod.id };
      },
    }),
    [stripe, elements],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink">Card details</span>
      <div className="rounded-lg border border-line-strong bg-surface px-3 py-3.5 shadow-xs focus-within:border-brand-600 focus-within:ring-3 focus-within:ring-brand-600/25">
        <CardElement
          options={{
            disabled,
            hidePostalCode: true,
            style: { base: { fontSize: "16px", color: "#0f1c24", "::placeholder": { color: "#62717d" } }, invalid: { color: "#b91c1c" } },
          }}
          onChange={(e) => setError(e.error?.message ?? null)}
        />
      </div>
      <p className="min-h-5 text-sm font-medium text-red-700" aria-live="polite">
        {error ?? ""}
      </p>
    </div>
  );
}

export default function StripeCardInput({ handleRef, disabled }: { handleRef: Ref<PaymentMethodHandle>; disabled?: boolean }) {
  if (!publishableKey) {
    return (
      <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        Card payments are not configured (missing publishable key).
      </p>
    );
  }
  return (
    <Elements stripe={getStripe()}>
      <CardField handleRef={handleRef} disabled={disabled} />
    </Elements>
  );
}
