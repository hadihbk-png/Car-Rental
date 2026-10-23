// SRCH-09 / PRC-20 support: branch-local wall-clock <-> UTC conversion (pure helpers).
import { describe, expect, it } from "vitest";
import { addDaysToDate, localDate, zonedTimeToUtc } from "@/lib/availability/time";

describe("time-zone helpers", () => {
  it("Asia/Dubai is UTC+4 all year", () => {
    expect(zonedTimeToUtc("2026-01-15", "10:00", "Asia/Dubai").toISOString()).toBe("2026-01-15T06:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-15", "00:00", "Asia/Dubai").toISOString()).toBe("2026-07-14T20:00:00.000Z");
    expect(localDate(new Date("2026-07-14T20:00:00Z"), "Asia/Dubai")).toBe("2026-07-15");
    expect(localDate(new Date("2026-07-14T19:59:59Z"), "Asia/Dubai")).toBe("2026-07-14");
  });

  it("handles DST zones on ordinary days and around transitions", () => {
    expect(zonedTimeToUtc("2026-07-01", "10:00", "Europe/London").toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-01", "10:00", "Europe/London").toISOString()).toBe("2026-12-01T10:00:00.000Z");
    // Day after spring-forward (29 Mar 2026) and the day of fall-back (25 Oct 2026, 10:00 is BST->GMT already)
    expect(zonedTimeToUtc("2026-03-30", "10:00", "Europe/London").toISOString()).toBe("2026-03-30T09:00:00.000Z");
    expect(zonedTimeToUtc("2026-10-25", "10:00", "Europe/London").toISOString()).toBe("2026-10-25T10:00:00.000Z");
    expect(zonedTimeToUtc("2026-03-08", "12:00", "America/New_York").toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });

  it("round-trips local dates and adds days across month/year ends", () => {
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
    for (const tz of ["Asia/Dubai", "Europe/London", "America/New_York", "Asia/Kolkata"]) {
      const u = zonedTimeToUtc("2026-11-02", "00:00", tz);
      expect(localDate(u, tz)).toBe("2026-11-02");
    }
  });
});
