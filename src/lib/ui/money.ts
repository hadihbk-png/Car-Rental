/**
 * Money display helpers. Amounts are always integer minor units (fils for AED).
 * All maths here is integer-only; no floating-point division touches an amount.
 */

export type CurrencyCode = "AED";

const MINOR_DIGITS: Record<CurrencyCode, number> = { AED: 2 };

export interface FormatMoneyOptions {
  /** Prefix with the currency code (default true): "AED 1,250.00" vs "1,250.00". */
  showCurrency?: boolean;
  /** Drop ".00" when the minor part is zero (default false). */
  omitZeroMinor?: boolean;
  /** "always" prefixes positive amounts with "+" (useful for adjustments). */
  signDisplay?: "auto" | "always";
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats an integer amount of minor units, e.g. formatMoney(125050, "AED") -> "AED 1,250.50".
 * Throws RangeError for non-integers so float amounts are caught early.
 */
export function formatMoney(
  minor: number,
  currency: CurrencyCode = "AED",
  options: FormatMoneyOptions = {},
): string {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`formatMoney expects an integer amount of minor units, got ${minor}`);
  }
  const { showCurrency = true, omitZeroMinor = false, signDisplay = "auto" } = options;
  const digits = MINOR_DIGITS[currency];
  const factor = 10 ** digits;
  const negative = minor < 0;
  const abs = negative ? -minor : minor;
  const minorPart = abs % factor;
  const wholePart = (abs - minorPart) / factor;

  let body = groupThousands(String(wholePart));
  if (!(omitZeroMinor && minorPart === 0)) {
    body += "." + String(minorPart).padStart(digits, "0");
  }
  if (showCurrency) body = `${currency} ${body}`;

  if (negative) return `-${body}`;
  if (signDisplay === "always" && minor > 0) return `+${body}`;
  return body;
}

/**
 * Parses a user-typed amount ("1,250.5", "99", "0.05") into integer minor units.
 * Returns null for anything that is not a non-negative amount with at most two decimals.
 */
export function parseMoneyInput(input: string, currency: CurrencyCode = "AED"): number | null {
  const digits = MINOR_DIGITS[currency];
  const cleaned = input.trim().replace(/^AED\s*/i, "").replace(/,/g, "");
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{0,${digits}}))?$`).exec(cleaned);
  if (!match) return null;
  const whole = match[1];
  const fraction = (match[2] ?? "").padEnd(digits, "0");
  const value = Number(whole) * 10 ** digits + Number(fraction || "0");
  return Number.isSafeInteger(value) ? value : null;
}

/** Whole currency units (e.g. AED from a price filter) to minor units. */
export function majorToMinor(major: number, currency: CurrencyCode = "AED"): number {
  if (!Number.isSafeInteger(major)) throw new RangeError("majorToMinor expects an integer");
  return major * 10 ** MINOR_DIGITS[currency];
}

/** Minor units to whole currency units, rounding down (for filter slider bounds). */
export function minorToMajorFloor(minor: number, currency: CurrencyCode = "AED"): number {
  if (!Number.isSafeInteger(minor)) throw new RangeError("minorToMajorFloor expects an integer");
  const factor = 10 ** MINOR_DIGITS[currency];
  const rem = ((minor % factor) + factor) % factor;
  return (minor - rem) / factor;
}
