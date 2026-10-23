import { describe, expect, it } from "vitest";
import { dayAvailability, dayBoundsUtc, monthAvailability, monthGrid, shiftMonth, weekdayLabels } from "./calendar";

const DUBAI = "Asia/Dubai";

describe("monthGrid", () => {
  it("always returns 6 weeks of 7 days starting on Monday", () => {
    const grid = monthGrid("2026-11");
    expect(grid).toHaveLength(6);
    for (const week of grid) expect(week).toHaveLength(7);
    // 1 Nov 2026 is a Sunday, so the Monday-first grid starts on 26 Oct.
    expect(grid[0][0]).toEqual({ date: "2026-10-26", inMonth: false });
    expect(grid[0][6]).toEqual({ date: "2026-11-01", inMonth: true });
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });

  it("supports Sunday-first weeks", () => {
    const grid = monthGrid("2026-11", 0);
    expect(grid[0][0]).toEqual({ date: "2026-11-01", inMonth: true });
    expect(weekdayLabels(0)[0].short).toBe("Sun");
    expect(weekdayLabels(1)[0].short).toBe("Mon");
  });

  it("shifts months across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-05", -17)).toBe("2024-12");
  });
});

describe("dayAvailability", () => {
  it("uses the branch's local day bounds", () => {
    const [start, end] = dayBoundsUtc("2026-11-01", DUBAI);
    expect(new Date(start).toISOString()).toBe("2026-10-31T20:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-11-01T20:00:00.000Z");
  });

  it("classifies free, partly booked and fully blocked days", () => {
    const ranges = [
      // 2 Nov 10:00 -> 4 Nov 10:00 Dubai
      { start: "2026-11-02T06:00:00Z", end: "2026-11-04T06:00:00Z" },
    ];
    expect(dayAvailability("2026-11-01", ranges, DUBAI)).toBe("available");
    expect(dayAvailability("2026-11-02", ranges, DUBAI)).toBe("partial");
    expect(dayAvailability("2026-11-03", ranges, DUBAI)).toBe("unavailable");
    expect(dayAvailability("2026-11-04", ranges, DUBAI)).toBe("partial");
    expect(dayAvailability("2026-11-05", ranges, DUBAI)).toBe("available");
  });

  it("treats ranges as half-open (ending at midnight leaves the next day free)", () => {
    const ranges = [{ start: "2026-11-01T20:00:00Z", end: "2026-11-02T20:00:00Z" }]; // exactly 2 Nov in Dubai
    expect(dayAvailability("2026-11-01", ranges, DUBAI)).toBe("available");
    expect(dayAvailability("2026-11-02", ranges, DUBAI)).toBe("unavailable");
    expect(dayAvailability("2026-11-03", ranges, DUBAI)).toBe("available");
  });

  it("merges back-to-back and overlapping ranges", () => {
    const ranges = [
      { start: "2026-11-01T20:00:00Z", end: "2026-11-02T06:00:00Z", kind: "reserved" as const },
      { start: "2026-11-02T06:00:00Z", end: "2026-11-02T12:00:00Z", kind: "maintenance" as const },
      { start: "2026-11-02T10:00:00Z", end: "2026-11-02T20:00:00Z" },
    ];
    expect(dayAvailability("2026-11-02", ranges, DUBAI)).toBe("unavailable");
    const gap = [
      { start: "2026-11-01T20:00:00Z", end: "2026-11-02T06:00:00Z" },
      { start: "2026-11-02T07:00:00Z", end: "2026-11-02T20:00:00Z" },
    ];
    expect(dayAvailability("2026-11-02", gap, DUBAI)).toBe("partial");
  });

  it("computes a whole month", () => {
    const map = monthAvailability("2026-11", [{ start: "2026-11-02T06:00:00Z", end: "2026-11-04T06:00:00Z" }], DUBAI);
    expect(Object.keys(map)).toHaveLength(30);
    expect(map["2026-11-03"]).toBe("unavailable");
    expect(map["2026-11-30"]).toBe("available");
  });
});
