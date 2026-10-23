"use client";

import Link from "next/link";
import { useActionState } from "react";
import { IDLE, fieldError } from "@/app/_lib/action-state";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form-controls";
import { Notice } from "@/components/ui/notice";
import { createReservationAction } from "./actions";

export interface ReserveFormProps {
  fields: Record<string, string>;
  changeHref: string;
}

export function ReserveForm({ fields, changeHref }: ReserveFormProps) {
  const [state, action, pending] = useActionState(createReservationAction, IDLE);
  const unavailable = state.status === "error" && (state.code === "VEHICLE_UNAVAILABLE" || state.code === "NO_PRICE");
  return (
    <form action={action} className="flex flex-col gap-4">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.status === "error" && (
        <Notice
          tone="error"
          live
          actions={
            unavailable ? (
              <Link href={changeHref} className={buttonClasses("outline", "sm")}>
                Choose new dates
              </Link>
            ) : undefined
          }
        >
          {state.message}
        </Notice>
      )}
      <Checkbox
        id="acceptPolicy"
        name="acceptPolicy"
        required
        invalid={Boolean(fieldError(state, "acceptPolicy"))}
        label="I accept the rental terms"
        description="Free cancellation until 48 hours before pick-up; within 48 hours one day's rental plus VAT is kept. The security deposit is held on your card and released after return."
      />
      <Button type="submit" size="lg" fullWidth loading={pending} loadingText="Reserving your car…">
        Reserve and continue to payment
      </Button>
      <p className="text-center text-xs text-ink-muted">We hold the car for 15 minutes while you pay.</p>
    </form>
  );
}
