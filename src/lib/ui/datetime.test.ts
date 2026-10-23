import { describe, expect, it } from "vitest";
import {
  addDays,
  compareDateTime,
  formatDate,
  formatDateString,
  formatDateTime,
  formatMonth,
  formatTime,
  getZonedParts,
  isDateString,
  isTimeString,
  isValidTimeZone,
  timeSlots,
  timeZoneLabel,
  timeZoneOffsetMs,
  toDateString,
  toTimeString,
  todayInTimeZone,
  weekdayOf,
  zonedTimeToUtc,
} from "./datetime";

const DUBAI = "Asia/Dubai";

describe("validation", () => {
  it("validates date strings including month lengths and leap years", () => {
    expect(isDateString("2026-11-01")).toBe(true);
    expect(isDateString("2028-02-29")).toBe(true);
    expect(isDateString("2026-02-29")).toBe(false);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString("2026-1-01")).toBe(false);
  });

  it("validates 24h times", () => {
    expect(isTimeString("00:00")).toBe(true);
    expect(isTimeString("23:59")).toBe(true);
    expect(isTimeString("24:00")).toBe(false);
    expect(isTimeString("9:00")).toBe(false);
  });

  it("validates IANA zones", () => {
    expect(isValidTimeZone(DUBAI)).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});

describe("time zone conversion", () => {
  it("converts Dubai wall-clock time to UTC (+04:00, no DST)", () => {
    expect(zonedTimeToUtc("2026-11-01", "10:00", DUBAI).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(zonedTimeToUtc("2026-11-01", "02:30", DUBAI).toISOString()).toBe("2026-10-31T22:30:00.000Z");
  });

  it("handles zones with DST", () => {
    // London is UTC+1 in summer, UTC+0 in winter.
    expect(zonedTimeToUtc("2026-07-01", "12:00", "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-01", "12:00", "Europe/London").toISOString()).toBe("2026-12-01T12:00:00.000Z");
    // 2026-03-29 01:30 does not exist in London; it is pushed forward to 02:30 BST.
    expect(zonedTimeToUtc("2026-03-29", "01:30", "Europe/London").toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("round-trips UTC instants to zone parts", () => {
    const instant = "2026-10-31T22:30:00Z";
    expect(toDateString(instant, DUBAI)).toBe("2026-11-01");
    expect(toTimeString(instant, DUBAI)).toBe("02:30");
    expect(getZonedParts(instant, DUBAI)).toMatchObject({ year: 2026, month: 11, day: 1, hour: 2, minute: 30, weekday: 0 });
    expect(timeZoneOffsetMs(instant, DUBAI)).toBe(4 * 3600 * 1000);
  });

  it("computes today in the branch zone from an explicit now", () => {
    expect(todayInTimeZone("2026-10-23T21:00:00Z", DUBAI)).toBe("2026-10-24");
    expect(todayInTimeZone("2026-10-23T21:00:00Z", "UTC")).toBe("2026-10-23");
  });

  it("rejects invalid input", () => {
    expect(() => zonedTimeToUtc("2026-02-30", "10:00", DUBAI)).toThrow(RangeError);
    expect(() => zonedTimeToUtc("2026-02-10", "25:00", DUBAI)).toThrow(RangeError);
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows weekdays and compares date-times", () => {
    expect(weekdayOf("2026-11-01")).toBe(0);
    expect(compareDateTime("2026-11-01", "10:00", "2026-11-01", "10:30")).toBe(-1);
    expect(compareDateTime("2026-11-02", "09:00", "2026-11-01", "10:30")).toBe(1);
    expect(compareDateTime("2026-11-01", "10:00", "2026-11-01", "10:00")).toBe(0);
  });

  it("builds time slots", () => {
    expect(timeSlots("08:00", "10:00")).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00"]);
    expect(timeSlots("08:00", "09:00", 60)).toEqual(["08:00", "09:00"]);
    expect(timeSlots().length).toBe(48);
  });
});

describe("formatting in a zone", () => {
  const instant = "2026-10-31T22:30:00Z"; // Sun 1 Nov 2026 02:30 in Dubai

  it("formats dates and times in the branch zone, not the server zone", () => {
    expect(formatDate(instant, DUBAI)).toMatch(/Sun.*1 Nov.*2026/);
    expect(formatDate(instant, "UTC")).toMatch(/Sat.*31 Oct.*2026/);
    expect(formatTime(instant, DUBAI)).toBe("02:30");
    expect(formatDateTime(instant, DUBAI)).toMatch(/1 Nov.*2026, 02:30$/);
  });

  it("formats plain date strings without shifting the day", () => {
    expect(formatDateString("2026-11-01")).toMatch(/Sun.*1 Nov.*2026/);
    expect(formatMonth("2026-11")).toBe("November 2026");
  });

  it("labels the zone", () => {
    expect(timeZoneLabel(DUBAI)).toBe("Dubai time (GMT+4)");
  });
});
