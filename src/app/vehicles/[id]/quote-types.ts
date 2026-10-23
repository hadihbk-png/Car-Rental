/** Client-safe shapes passed from the quote server action to the booking panel. */

export interface QuoteExtraLine {
  extraId: string;
  name: string;
  quantity: number;
  pricingType: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  totalFils: number;
}

export interface QuoteView {
  dailyRateFils: number;
  rentalDays: number;
  rentalFils: number;
  extras: QuoteExtraLine[];
  oneWayFeeFils: number;
  vatRateBps: number;
  taxFils: number;
  totalFils: number;
  depositFils: number;
  /** Whether the car is free for the whole period right now. */
  available: boolean;
  pickupAt: string;
  returnAt: string;
  timezone: string;
}

export type QuoteState =
  | { status: "ok"; quote: QuoteView }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export interface QuoteRequest {
  vehicleId: string;
  /** Return branch slug or id; empty = same as pick-up. */
  returnBranch?: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  extras: { extraId: string; quantity: number }[];
}
