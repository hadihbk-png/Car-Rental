import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { formatMoney, type CurrencyCode } from "@/lib/ui/money";
import { InfoIcon } from "@/components/ui/icons";

export interface PriceLine {
  label: string;
  /** e.g. "2 × AED 25.00" or "per rental" */
  detail?: string;
  amountFils: number;
}

/**
 * Display-only price summary. Every number comes from the server-side pricing service;
 * this component does no arithmetic (pages must never compute prices).
 */
export interface PriceBreakdownProps {
  currency?: CurrencyCode;
  dailyRateFils: number;
  days: number;
  /** Rental subtotal for the vehicle (daily rate × days, after any pricing rules). */
  rentalFils: number;
  extras?: readonly PriceLine[];
  oneWayFeeFils?: number;
  /** Other server-calculated lines such as discounts (negative) or late fees. */
  adjustments?: readonly PriceLine[];
  /** Label such as "VAT (5%)". */
  taxLabel: string;
  taxFils: number;
  /** Amount charged now: rental + extras + fees + tax. */
  totalFils: number;
  /** Refundable security deposit held on the card (not part of the total, no VAT). */
  depositFils: number;
  title?: ReactNode;
  /** Extra note under the totals, e.g. cancellation policy. */
  footnote?: ReactNode;
  className?: string;
}

function Row({ label, detail, amount, currency, strong }: { label: ReactNode; detail?: ReactNode; amount: number; currency: CurrencyCode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className={cn("min-w-0", strong ? "font-semibold text-ink" : "text-ink-muted")}>
        {label}
        {detail && <span className="block text-xs text-ink-subtle">{detail}</span>}
      </dt>
      <dd className={cn("shrink-0 text-right tabular", strong ? "font-semibold text-ink" : "text-ink")}>
        {formatMoney(amount, currency)}
      </dd>
    </div>
  );
}

export function PriceBreakdown({
  currency = "AED",
  dailyRateFils,
  days,
  rentalFils,
  extras = [],
  oneWayFeeFils,
  adjustments = [],
  taxLabel,
  taxFils,
  totalFils,
  depositFils,
  title = "Price details",
  footnote,
  className,
}: PriceBreakdownProps) {
  const dayLabel = `${days} ${days === 1 ? "day" : "days"}`;
  return (
    <section aria-label={typeof title === "string" ? title : "Price details"} className={cn("text-sm", className)}>
      {title && <h2 className="mb-2 text-base font-bold text-ink">{title}</h2>}
      <dl>
        <Row
          label={`Rental · ${dayLabel}`}
          detail={`${formatMoney(dailyRateFils, currency)} per day × ${dayLabel}`}
          amount={rentalFils}
          currency={currency}
        />
        {extras.length > 0 && (
          <div className="mt-1 border-t border-dashed border-line pt-1">
            {extras.map((line) => (
              <Row key={line.label} label={line.label} detail={line.detail} amount={line.amountFils} currency={currency} />
            ))}
          </div>
        )}
        {oneWayFeeFils !== undefined && oneWayFeeFils > 0 && (
          <Row label="One-way fee" detail="Return to a different branch" amount={oneWayFeeFils} currency={currency} />
        )}
        {adjustments.map((line) => (
          <Row key={line.label} label={line.label} detail={line.detail} amount={line.amountFils} currency={currency} />
        ))}
        <Row label={taxLabel} amount={taxFils} currency={currency} />
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="text-base font-bold text-ink">Total to pay</dt>
          <dd className="text-xl font-extrabold text-ink tabular">{formatMoney(totalFils, currency)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-brand-900">
        <InfoIcon size={18} className="mt-0.5 shrink-0 text-brand-700" />
        <p>
          <span className="font-semibold">Refundable security deposit: {formatMoney(depositFils, currency)}</span>
          <span className="block text-brand-800">
            Held on your card at booking and released after the car is returned. Not included in the total; no VAT.
          </span>
        </p>
      </div>
      {footnote && <div className="mt-3 text-xs text-ink-muted">{footnote}</div>}
    </section>
  );
}
