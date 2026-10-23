import { describe, expect, it } from "vitest";
import { formatMoney, majorToMinor, minorToMajorFloor, parseMoneyInput } from "./money";

describe("formatMoney", () => {
  it("formats fils as AED with two decimals and grouping", () => {
    expect(formatMoney(0, "AED")).toBe("AED 0.00");
    expect(formatMoney(5, "AED")).toBe("AED 0.05");
    expect(formatMoney(12345, "AED")).toBe("AED 123.45");
    expect(formatMoney(125050, "AED")).toBe("AED 1,250.50");
    expect(formatMoney(123456789012, "AED")).toBe("AED 1,234,567,890.12");
  });

  it("handles negatives and explicit plus sign", () => {
    expect(formatMoney(-2550, "AED")).toBe("-AED 25.50");
    expect(formatMoney(2550, "AED", { signDisplay: "always" })).toBe("+AED 25.50");
    expect(formatMoney(0, "AED", { signDisplay: "always" })).toBe("AED 0.00");
  });

  it("supports hiding the currency and zero fils", () => {
    expect(formatMoney(100000, "AED", { showCurrency: false })).toBe("1,000.00");
    expect(formatMoney(100000, "AED", { omitZeroMinor: true })).toBe("AED 1,000");
    expect(formatMoney(100050, "AED", { omitZeroMinor: true })).toBe("AED 1,000.50");
  });

  it("is exact for large integer amounts (no float drift)", () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "AED")).toBe("AED 90,071,992,547,409.91");
    expect(formatMoney(10 + 20, "AED")).toBe("AED 0.30");
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatMoney(10.5, "AED")).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, "AED")).toThrow(RangeError);
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 2, "AED")).toThrow(RangeError);
  });
});

describe("parseMoneyInput", () => {
  it("parses common inputs into fils", () => {
    expect(parseMoneyInput("0")).toBe(0);
    expect(parseMoneyInput("99")).toBe(9900);
    expect(parseMoneyInput("1,250.5")).toBe(125050);
    expect(parseMoneyInput(" 0.05 ")).toBe(5);
    expect(parseMoneyInput("AED 12.30")).toBe(1230);
    expect(parseMoneyInput("10.")).toBe(1000);
  });

  it("avoids float errors", () => {
    expect(parseMoneyInput("0.29")).toBe(29);
    expect(parseMoneyInput("1.15")).toBe(115);
  });

  it("rejects invalid input", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", ".5", "1.2.3"]) {
      expect(parseMoneyInput(bad)).toBeNull();
    }
  });
});

describe("major/minor conversion", () => {
  it("converts whole AED to fils and back", () => {
    expect(majorToMinor(150)).toBe(15000);
    expect(minorToMajorFloor(15099)).toBe(150);
    expect(minorToMajorFloor(-1)).toBe(-1);
    expect(() => majorToMinor(1.5)).toThrow(RangeError);
  });
});
