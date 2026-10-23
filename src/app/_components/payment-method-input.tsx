"use client";

import dynamic from "next/dynamic";
import { useId, useImperativeHandle, useState, type Ref } from "react";
import { ChoiceGroup, Radio } from "@/components/ui/form-controls";
import { Badge } from "@/components/ui/badge";

export type PaymentProviderName = "fake" | "stripe";

export type CollectResult = { ok: true; paymentMethod: string } | { ok: false; message: string };

export interface PaymentMethodHandle {
  /** Returns the payment method token to send to the server. */
  collect(): Promise<CollectResult>;
}

// Stripe Elements is only loaded when the Stripe provider is active.
const StripeCardInput = dynamic(() => import("./stripe-card-input"), {
  ssr: false,
  loading: () => <div className="h-24 animate-shimmer rounded-lg bg-surface-muted" aria-hidden="true" />,
});

/** Values understood by the local fake provider (FAKE_PAYMENT_METHODS). */
const TEST_CARDS = [
  { value: "fake_success", label: "Test card: payment succeeds", description: "Charges the total and holds the deposit." },
  { value: "fake_decline", label: "Test card: payment is declined", description: "Shows the decline message so you can retry." },
  { value: "fake_pending", label: "Test card: confirmation pending", description: "The bank confirms a moment later (webhook)." },
] as const;

function FakeCardInput({ handleRef, disabled }: { handleRef: Ref<PaymentMethodHandle>; disabled?: boolean }) {
  const id = useId();
  const [value, setValue] = useState<string>(TEST_CARDS[0].value);
  useImperativeHandle(handleRef, () => ({ collect: async () => ({ ok: true, paymentMethod: value }) }), [value]);
  return (
    <div className="flex flex-col gap-2">
      <Badge tone="warning" className="self-start">
        Test mode: no real card is charged
      </Badge>
      <ChoiceGroup legend="Payment method">
        {TEST_CARDS.map((c) => (
          <Radio
            key={c.value}
            id={`${id}-${c.value}`}
            name="paymentMethod"
            value={c.value}
            label={c.label}
            description={c.description}
            checked={value === c.value}
            disabled={disabled}
            onChange={() => setValue(c.value)}
          />
        ))}
      </ChoiceGroup>
    </div>
  );
}

export function PaymentMethodInput({
  provider,
  ref,
  disabled,
}: {
  provider: PaymentProviderName;
  ref: Ref<PaymentMethodHandle>;
  disabled?: boolean;
}) {
  return provider === "stripe" ? <StripeCardInput handleRef={ref} disabled={disabled} /> : <FakeCardInput handleRef={ref} disabled={disabled} />;
}
