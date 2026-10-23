"use client";

import { useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/ui/money";
import { PaymentMethodInput, type PaymentMethodHandle, type PaymentProviderName } from "@/app/_components/payment-method-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { payBalanceAction, type BalanceResult } from "./actions";

export function PayBalance({
  reservationId,
  balanceFils,
  provider,
  initialKey,
}: {
  reservationId: string;
  balanceFils: number;
  provider: PaymentProviderName;
  initialKey: string;
}) {
  const ref = useRef<PaymentMethodHandle>(null);
  const [key, setKey] = useState(initialKey);
  const [result, setResult] = useState<BalanceResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.status === "ok") {
    return (
      <Notice tone="success" live>
        {result.message}
      </Notice>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const collected = await ref.current?.collect();
          if (!collected?.ok) {
            setResult({ status: "error", message: collected?.message ?? "Choose a payment method.", nextKey: key });
            return;
          }
          const res = await payBalanceAction({ reservationId, paymentMethod: collected.paymentMethod, idempotencyKey: key });
          setResult(res);
          if (res.status === "error") setKey(res.nextKey);
        });
      }}
    >
      {result?.status === "error" && (
        <Notice tone="error" live>
          {result.message}
        </Notice>
      )}
      <PaymentMethodInput provider={provider} ref={ref} disabled={pending} />
      <Button type="submit" loading={pending} loadingText="Processing payment…" className="self-start">
        Pay {formatMoney(balanceFils, "AED")}
      </Button>
    </form>
  );
}
