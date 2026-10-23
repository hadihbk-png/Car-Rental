/** Pure helpers behind the availability calendar. */
import {
  addDays,
  daysInMonth,
  toDate,
  weekdayOf,
  zonedTimeToUtc,
  type DateString,
  type Instant,
} from "./datetime";

/** "YYYY-MM" */
export type MonthKey = string;

export interface UnavailableRange {
  /** Inclusive start instant (UTC ISO string or Date). */
  start: Instant;
  /** Exclusive end instant — ranges are half-open [start, end). */
  end: Instant;
  kind?: "reserved" | "maintenance";
}

export type DayAvailability = "available" | "partial" | "unavailable";

export interface CalendarCell {
  date: DateString;
  inMonth: boolean;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_RE.test(value);
}

export function monthOf(date: DateString): MonthKey {
  return date.slice(0, 7);
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  if (!isMonthKey(month)) throw new RangeError(`Invalid month: ${month}`);
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/**
 * A fixed 6x7 grid for the month (so the calendar never changes height).
 * weekStartsOn: 0 = Sunday, 1 = Monday (default; common in the UAE is Monday or Sunday).
 */
export function monthGrid(month: MonthKey, weekStartsOn: 0 | 1 = 1): CalendarCell[][] {
  if (!isMonthKey(month)) throw new RangeError(`Invalid month: ${month}`);
  const first = `${month}-01`;
  const lead = (weekdayOf(first) - weekStartsOn + 7) % 7;
  let cursor = addDays(first, -lead);
  const weeks: CalendarCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ date: cursor, inMonth: cursor.startsWith(month) });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Short weekday labels in grid order. */
export function weekdayLabels(weekStartsOn: 0 | 1 = 1): { short: string; long: string }[] {
  const names = [
    ["Sun", "Sunday"],
    ["Mon", "Monday"],
    ["Tue", "Tuesday"],
    ["Wed", "Wednesday"],
    ["Thu", "Thursday"],
    ["Fri", "Friday"],
    ["Sat", "Saturday"],
  ];
  return Array.from({ length: 7 }, (_, i) => {
    const [short, long] = names[(i + weekStartsOn) % 7];
    return { short, long };
  });
}

/** UTC bounds [start, end) of a local calendar day in the zone. */
export function dayBoundsUtc(date: DateString, timeZone: string): [number, number] {
  return [
    zonedTimeToUtc(date, "00:00", timeZone).getTime(),
    zonedTimeToUtc(addDays(date, 1), "00:00", timeZone).getTime(),
  ];
}

/**
 * Whether a local day is fully free, partly booked or fully blocked,
 * given half-open unavailable ranges.
 */
export function dayAvailability(
  date: DateString,
  ranges: readonly UnavailableRange[],
  timeZone: string,
): DayAvailability {
  const [dayStart, dayEnd] = dayBoundsUtc(date, timeZone);
  const clipped: [number, number][] = [];
  for (const r of ranges) {
    const s = Math.max(toDate(r.start).getTime(), dayStart);
    const e = Math.min(toDate(r.end).getTime(), dayEnd);
    if (s < e) clipped.push([s, e]);
  }
  if (clipped.length === 0) return "available";
  clipped.sort((a, b) => a[0] - b[0]);
  let covered = dayStart;
  for (const [s, e] of clipped) {
    if (s > covered) return "partial";
    covered = Math.max(covered, e);
    if (covered >= dayEnd) return "unavailable";
  }
  return "partial";
}

/** Availability for every day of a month, keyed by date. */
export function monthAvailability(
  month: MonthKey,
  ranges: readonly UnavailableRange[],
  timeZone: string,
): Record<DateString, DayAvailability> {
  const out: Record<DateString, DayAvailability> = {};
  const [y, m] = month.split("-").map(Number);
  const total = daysInMonth(y, m);
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    out[date] = dayAvailability(date, ranges, timeZone);
  }
  return out;
}
