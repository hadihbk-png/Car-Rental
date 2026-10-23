"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { bookingQuery, type ExtraSelection } from "@/lib/ui/booking-params";
import { addDays, compareDateTime, isDateString, isTimeString, type DateString } from "@/lib/ui/datetime";
import { formatMoney } from "@/lib/ui/money";
import { priceBreakdownProps } from "@/lib/ui/price-view";
import { monthOf, type UnavailableRange } from "@/lib/ui/calendar";
import { DateTimeRangePicker, type DateTimeRangeValue } from "@/components/booking/date-time-range-picker";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { buttonClasses } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form-controls";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { AvailabilityCalendar } from "@/components/vehicle/availability-calendar";
import { quoteAction } from "./actions";
import type { QuoteState } from "./quote-types";

export interface ExtraOption {
  id: string;
  name: string;
  description: string | null;
  pricingType: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxPriceFils: number | null;
  maxQuantity: number;
}

interface BookingState {
  dates: DateTimeRangeValue;
  returnBranch: string;
  extras: ExtraSelection[];
}

interface BookingContextValue extends BookingState {
  setDates: (d: DateTimeRangeValue) => void;
  setReturnBranch: (slug: string) => void;
  setExtraQuantity: (extraId: string, quantity: number) => void;
  pickDate: (date: DateString) => void;
}

const BookingContext = createContext<BookingContextValue | null>(null);

function useBooking() {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error("Booking components must be inside <VehicleBookingProvider>");
  return ctx;
}

/** Shares the trip/extras selection between the calendar and the booking panel. */
export function VehicleBookingProvider({ initial, children }: { initial: BookingState; children: ReactNode }) {
  const [state, setState] = useState<BookingState>(initial);
  const value: BookingContextValue = {
    ...state,
    setDates: (dates) => setState((s) => ({ ...s, dates })),
    setReturnBranch: (returnBranch) => setState((s) => ({ ...s, returnBranch })),
    setExtraQuantity: (extraId, quantity) =>
      setState((s) => ({
        ...s,
        extras: quantity > 0
          ? [...s.extras.filter((e) => e.extraId !== extraId), { extraId, quantity }]
          : s.extras.filter((e) => e.extraId !== extraId),
      })),
    pickDate: (date) =>
      setState((s) => {
        const d = { ...s.dates, pickupDate: date };
        if (!d.returnDate || d.returnDate <= date) d.returnDate = addDays(date, 1);
        if (!d.pickupTime) d.pickupTime = "10:00";
        if (!d.returnTime) d.returnTime = d.pickupTime;
        return { ...s, dates: d };
      }),
  };
  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function BookingCalendar({
  timeZone,
  unavailable,
  from,
  to,
}: {
  timeZone: string;
  unavailable: UnavailableRange[];
  /** First and (exclusive) last local date covered by the calendar data. */
  from: DateString;
  to: DateString;
}) {
  const { dates, pickDate } = useBooking();
  const last = addDays(to, -1);
  const initialMonth = dates.pickupDate && dates.pickupDate >= from && dates.pickupDate <= last ? monthOf(dates.pickupDate) : monthOf(from);
  return (
    <AvailabilityCalendar
      timeZone={timeZone}
      unavailable={unavailable}
      initialMonth={initialMonth}
      today={from}
      minMonth={monthOf(from)}
      maxMonth={monthOf(last)}
      selected={dates.pickupDate && dates.returnDate ? { start: dates.pickupDate, end: dates.returnDate } : undefined}
      onSelectDate={pickDate}
      className="max-w-lg"
    />
  );
}

function completeDates(d: DateTimeRangeValue): boolean {
  return (
    isDateString(d.pickupDate) &&
    isDateString(d.returnDate) &&
    isTimeString(d.pickupTime) &&
    isTimeString(d.returnTime) &&
    compareDateTime(d.pickupDate, d.pickupTime, d.returnDate, d.returnTime) < 0
  );
}

export interface BookingPanelProps {
  vehicleId: string;
  timeZone: string;
  pickupBranch: { slug: string; name: string };
  returnBranches: { value: string; label: string }[];
  extras: ExtraOption[];
  minDate: DateString;
  openTime?: string;
  closeTime?: string;
  /** Quote computed on the server for the initial URL state (avoids a loading flash). */
  initialQuote: QuoteState | null;
  /** Path of the next booking step. */
  nextPath: string;
}

export function BookingPanel({
  vehicleId,
  timeZone,
  pickupBranch,
  returnBranches,
  extras,
  minDate,
  openTime,
  closeTime,
  initialQuote,
  nextPath,
}: BookingPanelProps) {
  const booking = useBooking();
  const uid = useId();
  const [quote, setQuote] = useState<QuoteState | null>(initialQuote);
  const [pending, startTransition] = useTransition();
  const requestId = useRef(0);
  const complete = completeDates(booking.dates);
  const sortedExtras = [...booking.extras].sort((a, b) => a.extraId.localeCompare(b.extraId));
  const key = complete ? JSON.stringify([booking.dates, booking.returnBranch, sortedExtras]) : "";
  const lastKey = useRef(initialQuote ? key : "");

  useEffect(() => {
    if (!key || key === lastKey.current) return;
    lastKey.current = key;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await quoteAction({
          vehicleId,
          returnBranch: booking.returnBranch === pickupBranch.slug ? undefined : booking.returnBranch,
          pickupDate: booking.dates.pickupDate,
          pickupTime: booking.dates.pickupTime,
          returnDate: booking.dates.returnDate,
          returnTime: booking.dates.returnTime,
          extras: sortedExtras,
        }).catch((): QuoteState => ({ status: "error", message: "We couldn't get a price right now. Please try again." }));
        if (id === requestId.current) setQuote(result);
      });
    }, 250);
    return () => clearTimeout(timer);
    // key captures every input of the request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shownQuote = complete ? quote : null;
  const ok = shownQuote?.status === "ok" ? shownQuote.quote : null;
  const canContinue = Boolean(ok && ok.available && !pending);
  const href = `${nextPath}${bookingQuery({
    vehicleId,
    trip: {
      pickupBranch: pickupBranch.slug,
      returnBranch: booking.returnBranch !== pickupBranch.slug ? booking.returnBranch : undefined,
      pickupDate: booking.dates.pickupDate,
      pickupTime: booking.dates.pickupTime,
      returnDate: booking.dates.returnDate,
      returnTime: booking.dates.returnTime,
    },
    extras: sortedExtras,
  })}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold text-ink">Your trip</h2>
        <p className="text-sm text-ink-muted">Pick-up at {pickupBranch.name}</p>
      </div>

      <DateTimeRangePicker
        timeZone={timeZone}
        value={booking.dates}
        onChange={booking.setDates}
        minDate={minDate}
        openTime={openTime}
        closeTime={closeTime}
        compact
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-return`} className="text-sm font-semibold text-ink">
          Return branch
        </label>
        <Select
          id={`${uid}-return`}
          value={booking.returnBranch}
          onChange={(e) => booking.setReturnBranch(e.target.value)}
          options={returnBranches}
        />
      </div>

      {extras.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">Extras</legend>
          <div className="flex flex-col divide-y divide-line">
            {extras.map((x) => {
              const selected = booking.extras.find((e) => e.extraId === x.id)?.quantity ?? 0;
              const price = `${formatMoney(x.priceFils, "AED")} ${x.pricingType === "PER_DAY" ? "per day" : "per rental"}${
                x.maxPriceFils !== null && x.pricingType === "PER_DAY" ? ` (max ${formatMoney(x.maxPriceFils, "AED")})` : ""
              }`;
              return x.maxQuantity <= 1 ? (
                <Checkbox
                  key={x.id}
                  id={`${uid}-x-${x.id}`}
                  label={x.name}
                  description={
                    <>
                      {price}
                      {x.description && <span className="block">{x.description}</span>}
                    </>
                  }
                  checked={selected > 0}
                  onChange={(e) => booking.setExtraQuantity(x.id, e.target.checked ? 1 : 0)}
                />
              ) : (
                <div key={x.id} className="flex items-start justify-between gap-3 py-2">
                  <label htmlFor={`${uid}-x-${x.id}`} className="text-sm">
                    <span className="font-medium text-ink">{x.name}</span>
                    <span className="block text-ink-muted">{price}</span>
                    {x.description && <span className="block text-ink-muted">{x.description}</span>}
                  </label>
                  <Select
                    id={`${uid}-x-${x.id}`}
                    className="h-10 w-24"
                    value={String(selected)}
                    onChange={(e) => booking.setExtraQuantity(x.id, Number(e.target.value))}
                    options={Array.from({ length: x.maxQuantity + 1 }, (_, i) => ({ value: String(i), label: String(i) }))}
                  />
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      <div aria-live="polite" aria-busy={pending || undefined} className="border-t border-line pt-4">
        {!complete ? (
          <p className="text-sm text-ink-muted">Choose pick-up and return dates to see the price.</p>
        ) : pending && !ok ? (
          <div className="flex flex-col gap-2" aria-label="Updating price">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : shownQuote?.status === "error" ? (
          <Notice tone="error" title="We can't price this trip">
            {shownQuote.message}
          </Notice>
        ) : ok ? (
          <div className={pending ? "opacity-60 transition-opacity" : undefined}>
            {!ok.available && (
              <Notice tone="warning" className="mb-4" title="Not available for these dates">
                This car is booked for part of this period. Choose other dates using the calendar.
              </Notice>
            )}
            <PriceBreakdown {...priceBreakdownProps(ok)} footnote="Free cancellation up to 48 hours before pick-up." />
          </div>
        ) : null}
      </div>

      {canContinue ? (
        <Link href={href} className={buttonClasses("primary", "lg", true)}>
          Continue to driver details
          <ArrowRightIcon size={18} />
        </Link>
      ) : (
        <p className="rounded-lg bg-surface-muted px-4 py-3 text-center text-sm text-ink-muted">
          {pending ? "Updating price…" : "Choose available dates to continue."}
        </p>
      )}
    </div>
  );
}
