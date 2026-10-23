import { describe, expect, it } from "vitest";
import { parseOpeningHours } from "./branch-hours";

describe("parseOpeningHours", () => {
  it("reads 24-hour branches", () => {
    expect(parseOpeningHours("Open 24 hours")).toEqual({ open: "00:00", close: "23:30", allDay: true });
    expect(parseOpeningHours("24/7")).toEqual({ open: "00:00", close: "23:30", allDay: true });
  });

  it("reads daily ranges", () => {
    expect(parseOpeningHours("Daily 08:00-22:00")).toEqual({ open: "08:00", close: "22:00", allDay: false });
    expect(parseOpeningHours("Daily 9:00 – 21:30")).toEqual({ open: "09:00", close: "21:30", allDay: false });
  });

  it("returns null for unknown or overnight formats", () => {
    expect(parseOpeningHours(null)).toBeNull();
    expect(parseOpeningHours("Call us")).toBeNull();
    expect(parseOpeningHours("Daily 22:00-02:00")).toBeNull();
  });
});
