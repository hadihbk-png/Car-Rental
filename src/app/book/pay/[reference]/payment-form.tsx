"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { PaymentMethodInput, type PaymentMethodHandle, type PaymentProviderName } from "@/app/_components/payment-method-input";
import { Button, buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { formatMoney } from "@/lib/ui/money";
import { payAction, type PayResult } from "./actions";

export interface PaymentFormProps {
  reservationId: string;
  provider: PaymentProviderName;
  /** First attempt's idempotency key (generated on the server for this page view). */
  initialKey: string;
  totalFils: number;
  depositFils: number;
  /** Where to fix the driver profile if the server says it is incomplete. */
  driverHref: string;
}

export function PaymentForm({ reservationId, provider, initialKey, totalFils, depositFils, driverHref }: PaymentFormProps) {
  const methodRef = useRef<PaymentMethodHandle>(null);
  const [key, setKey] = useState(initialKey);
  const [result, setResult] = useState<PayResult | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      setCollectError(null);
      const collected = await methodRef.current?.collect();
      if (!collected?.ok) {
        setCollectError(collected?.message ?? "Choose a payment method.");
        return;
      }
      const res = await payAction({ reservationId, paymentMethod: collected.paymentMethod, idempotencyKey: key });
      setResult(res);
      // A failed attempt is finished: the retry is a new attempt with a new key.
      if (res.status === "error") setKey(res.nextKey);
    });
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {result?.status === "error" && (
        <Notice
          tone="error"
          live
          title={result.code === "PAYMENT_FAILED" ? "Payment declined" : "Payment not completed"}
          actions={
            result.code === "POLICY_VIOLATION" ? (
              <Link href={driverHref} className={buttonClasses("outline", "sm")}>
                Complete driver details
              </Link>
            ) : undefined
          }
        >
          {result.message} {result.code === "PAYMENT_FAILED" && "Your car is still held. You can try again or use another card."}
        </Notice>
      )}
      {collectError && (
        <Notice tone="error" live>
          {collectError}
        </Notice>
      )}
      <PaymentMethodInput provider={provider} ref={methodRef} disabled={pending} />
      <Button type="submit" size="lg" fullWidth loading={pending} loadingText="Processing payment…">
        Pay {formatMoney(totalFils, "AED")}
      </Button>
      <p className="text-center text-xs text-ink-muted">
        We also place a refundable hold of {formatMoney(depositFils, "AED")} on your card for the security deposit.
      </p>
    </form>
  );
}
