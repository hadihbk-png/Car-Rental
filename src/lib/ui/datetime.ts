/**
 * Date/time display helpers. Instants are stored in UTC; every display is in an
 * explicit IANA time zone (normally the branch's). Nothing here reads the clock:
 * callers pass `now` where it matters, which keeps rendering deterministic.
 */

export const UI_LOCALE = "en-GB";

/** "YYYY-MM-DD" */
export type DateString = string;
/** "HH:mm" (24-hour) */
export type TimeString = string;

export type Instant = Date | string | number;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function toDate(value: Instant): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  return date;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isTimeString(value: string): boolean {
  return TIME_RE.test(value);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock parts of an instant in the given time zone. */
export function getZonedParts(instant: Instant, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(toDate(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** Offset (ms) of the zone from UTC at the given instant. Dubai -> +14_400_000. */
export function timeZoneOffsetMs(instant: Instant, timeZone: string): number {
  const date = toDate(instant);
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = date.getTime() - date.getUTCMilliseconds();
  return asUtc - truncated;
}

/**
 * Converts a wall-clock date + time in `timeZone` to the UTC instant.
 * zonedTimeToUtc("2026-11-01", "10:00", "Asia/Dubai") -> 2026-11-01T06:00:00Z.
 * For times skipped by a DST jump the result is shifted forward by the gap.
 */
export function zonedTimeToUtc(date: DateString, time: TimeString, timeZone: string): Date {
  if (!isDateString(date)) throw new RangeError(`Invalid date string: ${date}`);
  if (!isTimeString(time)) throw new RangeError(`Invalid time string: ${time}`);
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const firstOffset = timeZoneOffsetMs(guess, timeZone);
  let result = guess - firstOffset;
  const secondOffset = timeZoneOffsetMs(result, timeZone);
  if (secondOffset !== firstOffset) result = guess - secondOffset;
  return new Date(result);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the instant in the zone (for <input type="date"> values). */
export function toDateString(instant: Instant, timeZone: string): DateString {
  const p = getZonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:mm" of the instant in the zone. */
export function toTimeString(instant: Instant, timeZone: string): TimeString {
  const p = getZonedParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Today's calendar date in the zone, given the current instant. */
export function todayInTimeZone(now: Instant, timeZone: string): DateString {
  return toDateString(now, timeZone);
}

/** Calendar arithmetic on "YYYY-MM-DD" strings (zone-independent). */
export function addDays(date: DateString, days: number): DateString {
  if (!isDateString(date)) throw new RangeError(`Invalid date string: ${date}`);
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Weekday (0 = Sunday) of a calendar date. */
export function weekdayOf(date: DateString): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Combined "YYYY-MM-DDTHH:mm" comparison key; works with plain string comparison. */
export function compareDateTime(
  aDate: DateString,
  aTime: TimeString,
  bDate: DateString,
  bTime: TimeString,
): number {
  const a = `${aDate}T${aTime}`;
  const b = `${bDate}T${bTime}`;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Half-hour (or other step) time slots between open and close, inclusive. */
export function timeSlots(open: TimeString = "00:00", close: TimeString = "23:30", stepMinutes = 30): TimeString[] {
  if (!isTimeString(open) || !isTimeString(close)) throw new RangeError("Invalid opening hours");
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0) throw new RangeError("Invalid step");
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: TimeString[] = [];
  for (let m = toMin(open); m <= toMin(close); m += stepMinutes) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

type DateStyle = "short" | "medium" | "long";

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "numeric", month: "short" },
  medium: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  long: { weekday: "long", day: "numeric", month: "long", year: "numeric" },
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(UI_LOCALE, { ...options, timeZone });
    fmtCache.set(key, f);
  }
  return f;
}

/** "Sun 1 Nov 2026" in the zone. */
export function formatDate(instant: Instant, timeZone: string, style: DateStyle = "medium"): string {
  return fmt(timeZone, DATE_OPTIONS[style]).format(toDate(instant));
}

/** "14:30" in the zone. */
export function formatTime(instant: Instant, timeZone: string): string {
  return fmt(timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(toDate(instant));
}

/** "Sun 1 Nov 2026, 14:30" in the zone. */
export function formatDateTime(instant: Instant, timeZone: string, style: DateStyle = "medium"): string {
  return `${formatDate(instant, timeZone, style)}, ${formatTime(instant, timeZone)}`;
}

/** Formats a calendar date string without any zone shift: "Sun 1 Nov 2026". */
export function formatDateString(date: DateString, style: DateStyle = "medium"): string {
  if (!isDateString(date)) throw new RangeError(`Invalid date string: ${date}`);
  return formatDate(`${date}T12:00:00Z`, "UTC", style);
}

/** "Sun 1 Nov, 10:00 – Wed 4 Nov 2026, 10:00" style range in the zone. */
export function formatDateTimeRange(start: Instant, end: Instant, timeZone: string): string {
  return `${formatDateTime(start, timeZone)} – ${formatDateTime(end, timeZone)}`;
}

/** "GMT+4" for Asia/Dubai at the given instant. */
export function timeZoneOffsetLabel(timeZone: string, at: Instant = 0): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(toDate(at));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/** "Dubai time (GMT+4)" — a human label for the branch time zone. */
export function timeZoneLabel(timeZone: string, at: Instant = 0): string {
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  return `${city} time (${timeZoneOffsetLabel(timeZone, at)})`;
}

/** Month name + year for a "YYYY-MM" key: "November 2026". */
export function formatMonth(month: string): string {
  return fmt("UTC", { month: "long", year: "numeric" }).format(new Date(`${month}-15T12:00:00Z`));
}
