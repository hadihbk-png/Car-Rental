import { describe, expect, it } from "vitest";
import { formatBps, priceBreakdownProps } from "./price-view";

describe("formatBps", () => {
  it("formats basis points as a percentage", () => {
    expect(formatBps(500)).toBe("5%");
    expect(formatBps(250)).toBe("2.5%");
    expect(formatBps(505)).toBe("5.05%");
    expect(formatBps(0)).toBe("0%");
  });
});

describe("priceBreakdownProps", () => {
  it("passes server amounts through unchanged", () => {
    const props = priceBreakdownProps({
      dailyRateFils: 18900,
      rentalDays: 3,
      rentalFils: 56700,
      extras: [{ name: "Child seat", quantity: 2, pricingType: "PER_DAY", priceFils: 2500, totalFils: 15000 }],
      oneWayFeeFils: 0,
      vatRateBps: 500,
      taxFils: 3585,
      totalFils: 75285,
      depositFils: 150000,
    });
    expect(props).toMatchObject({
      days: 3,
      rentalFils: 56700,
      taxLabel: "VAT (5%)",
      totalFils: 75285,
      extras: [{ label: "Child seat × 2", detail: "AED 25.00 per day", amountFils: 15000 }],
    });
  });
});
