"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/ui/money";
import { priceBreakdownProps } from "@/lib/ui/price-view";
import { IDLE } from "@/app/_lib/action-state";
import { PaymentMethodInput, type PaymentMethodHandle, type PaymentProviderName } from "@/app/_components/payment-method-input";
import { DateTimeRangePicker, type DateTimeRangeValue } from "@/components/booking/date-time-range-picker";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextareaField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cancelAction, modifyDatesAction, previewDatesAction, type ModifyResult, type PreviewResult } from "./actions";

type CancellationPreview = { allowed: false; reason: string } | { allowed: true; free: boolean; feeFils: number; refundFils: number };

export function CancelReservation({ reservationId, preview }: { reservationId: string; preview: CancellationPreview }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelAction, IDLE);
  if (state.status === "ok") {
    return (
      <Notice tone="success" live>
        {state.message}
      </Notice>
    );
  }
  return (
    <>
      <Button variant="outline" className="border-red-300 text-red-800 hover:border-red-600 hover:text-red-900" onClick={() => setOpen(true)}>
        Cancel reservation
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        title="Cancel this reservation?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Keep reservation
            </Button>
            <Button variant="danger" type="submit" form="cancel-form" loading={pending} loadingText="Cancelling…">
              Yes, cancel
            </Button>
          </>
        }
      >
        <form id="cancel-form" action={action} className="flex flex-col gap-4">
          <input type="hidden" name="reservationId" value={reservationId} />
          {state.status === "error" && (
            <Notice tone="error" live>
              {state.message}
            </Notice>
          )}
          {preview.allowed ? (
            preview.free ? (
              <Notice tone="success" title="Free cancellation">
                You&apos;ll get a full refund of {formatMoney(preview.refundFils, "AED")}. The deposit hold is released.
              </Notice>
            ) : (
              <Notice tone="warning" title="Cancellation fee applies">
                Pick-up is less than 48 hours away, so one day&apos;s rental plus VAT ({formatMoney(preview.feeFils, "AED")}) is kept. You&apos;ll be
                refunded {formatMoney(preview.refundFils, "AED")}.
              </Notice>
            )
          ) : (
            <Notice tone="error">{preview.reason}</Notice>
          )}
          <TextareaField id="cancel-reason" name="reason" label="Reason" optionalLabel rows={3} maxLength={500} />
        </form>
      </Dialog>
    </>
  );
}

export interface ModifyDatesProps {
  reservationId: string;
  timeZone: string;
  current: DateTimeRangeValue;
  minDate: string;
  openTime?: string;
  closeTime?: string;
  paidFils: number;
  provider: PaymentProviderName;
  initialKey: string;
}

export function ModifyDates({ reservationId, timeZone, current, minDate, openTime, closeTime, paidFils, provider, initialKey }: ModifyDatesProps) {
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<DateTimeRangeValue>(current);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ModifyResult | null>(null);
  const [key, setKey] = useState(initialKey);
  const [pending, startTransition] = useTransition();
  const methodRef = useRef<PaymentMethodHandle>(null);

  const changed =
    dates.pickupDate !== current.pickupDate ||
    dates.pickupTime !== current.pickupTime ||
    dates.returnDate !== current.returnDate ||
    dates.returnTime !== current.returnTime;

  const check = () =>
    startTransition(async () => {
      setResult(null);
      setPreview(await previewDatesAction({ reservationId, ...dates }));
    });

  const confirm = () =>
    startTransition(async () => {
      if (preview?.status !== "ok") return;
      let paymentMethod: string | undefined;
      if (preview.needsPayment) {
        const collected = await methodRef.current?.collect();
        if (!collected?.ok) {
          setResult({ status: "error", message: collected?.message ?? "Choose a payment method.", nextKey: key });
          return;
        }
        paymentMethod = collected.paymentMethod;
      }
      const res = await modifyDatesAction({ reservationId, pickupAt: preview.pickupAt, returnAt: preview.returnAt, paymentMethod, idempotencyKey: key });
      setResult(res);
      if (res.status === "error") setKey(res.nextKey);
      else {
        setPreview(null);
        setOpen(false);
      }
    });

  if (!open) {
    return (
      <div className="flex flex-col gap-3">
        {result?.status === "ok" && (
          <Notice tone="success" live>
            {result.message}
          </Notice>
        )}
        <Button variant="outline" onClick={() => setOpen(true)}>
          Change dates
        </Button>
      </div>
    );
  }

  return (
    <section aria-labelledby="modify-heading" className="flex flex-col gap-4 rounded-xl border border-line bg-canvas/60 p-4">
      <h3 id="modify-heading" className="text-base font-bold text-ink">
        Change dates
      </h3>
      <DateTimeRangePicker
        timeZone={timeZone}
        value={dates}
        onChange={(v) => {
          setDates(v);
          setPreview(null);
        }}
        minDate={minDate}
        openTime={openTime}
        closeTime={closeTime}
        compact
      />
      {preview?.status === "error" && (
        <Notice tone="error" live>
          {preview.message}
        </Notice>
      )}
      {preview?.status === "ok" && (
        <div className="flex flex-col gap-4 rounded-lg bg-surface p-4">
          <PriceBreakdown {...priceBreakdownProps(preview.quote)} title="New price" />
          <p className="text-sm text-ink-muted">
            You have paid {formatMoney(paidFils, "AED")}.{" "}
            {preview.needsPayment ? "The difference will be charged to your card." : "Any difference will be refunded to your card."}
          </p>
          {preview.needsPayment && <PaymentMethodInput provider={provider} ref={methodRef} disabled={pending} />}
        </div>
      )}
      {result?.status === "error" && (
        <Notice tone="error" live>
          {result.message}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        {preview?.status === "ok" ? (
          <Button onClick={confirm} loading={pending} loadingText="Changing dates…">
            Confirm new dates
          </Button>
        ) : (
          <Button onClick={check} disabled={!changed} loading={pending} loadingText="Checking…">
            Check new price
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setDates(current);
            setPreview(null);
          }}
          disabled={pending}
        >
          Keep current dates
        </Button>
      </div>
    </section>
  );
}
