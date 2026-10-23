/** Maps a server price (quote or reservation price) to PriceBreakdown props. No arithmetic on amounts. */
import { formatMoney } from "./money";

export interface ServerPriceLike {
  dailyRateFils: number;
  rentalDays: number;
  rentalFils: number;
  extras: readonly {
    name: string;
    quantity: number;
    pricingType: "PER_DAY" | "PER_RENTAL";
    /** Quote lines carry priceFils, reservation lines unitPriceFils. */
    priceFils?: number;
    unitPriceFils?: number;
    totalFils: number;
  }[];
  oneWayFeeFils: number;
  vatRateBps: number;
  taxFils: number;
  totalFils: number;
  depositFils: number;
}

/** 500 -> "5%", 250 -> "2.5%" */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const rest = bps % 100;
  return rest === 0 ? `${whole}%` : `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}%`;
}

export function priceBreakdownProps(price: ServerPriceLike) {
  return {
    dailyRateFils: price.dailyRateFils,
    days: price.rentalDays,
    rentalFils: price.rentalFils,
    extras: price.extras.map((e) => {
      const unit = e.priceFils ?? e.unitPriceFils;
      const per = e.pricingType === "PER_DAY" ? "per day" : "per rental";
      return {
        label: e.quantity > 1 ? `${e.name} × ${e.quantity}` : e.name,
        detail: unit !== undefined && e.priceFils !== undefined ? `${formatMoney(unit, "AED")} ${per}` : per === "per day" ? "Charged per day" : "One price per rental",
        amountFils: e.totalFils,
      };
    }),
    oneWayFeeFils: price.oneWayFeeFils,
    taxLabel: `VAT (${formatBps(price.vatRateBps)})`,
    taxFils: price.taxFils,
    totalFils: price.totalFils,
    depositFils: price.depositFils,
  };
}
