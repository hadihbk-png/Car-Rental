"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/ui/cn";
import {
  addDays,
  compareDateTime,
  isDateString,
  isTimeString,
  timeSlots,
  timeZoneLabel,
  zonedTimeToUtc,
  type DateString,
  type TimeString,
} from "@/lib/ui/datetime";
import { CalendarIcon, ClockIcon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/form-controls";

export interface DateTimeRangeValue {
  pickupDate: DateString | "";
  pickupTime: TimeString | "";
  returnDate: DateString | "";
  returnTime: TimeString | "";
}

export interface DateTimeRangePickerProps {
  /** IANA zone of the pick-up branch; all times shown and entered are in this zone. */
  timeZone: string;
  /** Controlled value. */
  value?: Partial<DateTimeRangeValue>;
  /** Uncontrolled initial value. */
  defaultValue?: Partial<DateTimeRangeValue>;
  onChange?: (value: DateTimeRangeValue) => void;
  /** Earliest selectable date (today in the branch zone, computed by the page). */
  minDate?: DateString;
  maxDate?: DateString;
  /** Branch opening hours for the time lists. */
  openTime?: TimeString;
  closeTime?: TimeString;
  stepMinutes?: number;
  /** Form field names (defaults match the search URL params). */
  names?: Partial<Record<keyof DateTimeRangeValue, string>>;
  /** Also submit UTC instants as hidden inputs with these names (e.g. for server actions). */
  utcNames?: { pickup: string; return: string };
  /** Server-side errors. */
  errors?: { pickup?: string; return?: string };
  required?: boolean;
  disabled?: boolean;
  /** Stack vertically even on wide screens (e.g. in a sidebar). */
  compact?: boolean;
  className?: string;
}

const EMPTY: DateTimeRangeValue = { pickupDate: "", pickupTime: "", returnDate: "", returnTime: "" };

function toUtcIso(date: string, time: string, timeZone: string): string {
  if (!isDateString(date) || !isTimeString(time)) return "";
  try {
    return zonedTimeToUtc(date, time, timeZone).toISOString();
  } catch {
    return "";
  }
}

/**
 * Pick-up and return date + time. Native date inputs and selects keep it fully keyboard and
 * screen-reader accessible and give mobile users the system pickers.
 */
export function DateTimeRangePicker({
  timeZone,
  value,
  defaultValue,
  onChange,
  minDate,
  maxDate,
  openTime = "00:00",
  closeTime = "23:30",
  stepMinutes = 30,
  names = {},
  utcNames,
  errors = {},
  required = true,
  disabled,
  compact = false,
  className,
}: DateTimeRangePickerProps) {
  const id = useId();
  const [internal, setInternal] = useState<DateTimeRangeValue>({ ...EMPTY, ...defaultValue });
  const current: DateTimeRangeValue = value ? { ...EMPTY, ...value } : internal;
  const slots = timeSlots(openTime, closeTime, stepMinutes);

  const update = (patch: Partial<DateTimeRangeValue>) => {
    const next = { ...current, ...patch };
    // Keep the return after the pick-up when the pick-up moves forward.
    if (patch.pickupDate && isDateString(patch.pickupDate)) {
      if (!next.returnDate || next.returnDate < patch.pickupDate) next.returnDate = addDays(patch.pickupDate, 1);
      if (!next.returnTime && next.pickupTime) next.returnTime = next.pickupTime;
    }
    if (patch.pickupTime && !next.returnTime) next.returnTime = patch.pickupTime;
    if (!value) setInternal(next);
    onChange?.(next);
  };

  const complete = current.pickupDate && current.pickupTime && current.returnDate && current.returnTime;
  const orderError =
    complete && compareDateTime(current.pickupDate, current.pickupTime, current.returnDate, current.returnTime) >= 0
      ? "Return must be after pick-up."
      : undefined;
  const returnError = errors.return ?? orderError;
  // Label the offset at the chosen pick-up (matters for zones with DST).
  const tzLabel = timeZoneLabel(timeZone, toUtcIso(current.pickupDate, current.pickupTime, timeZone) || 0);

  const group = (kind: "pickup" | "return") => {
    const dateKey = kind === "pickup" ? "pickupDate" : "returnDate";
    const timeKey = kind === "pickup" ? "pickupTime" : "returnTime";
    const error = kind === "pickup" ? errors.pickup : returnError;
    const legend = kind === "pickup" ? "Pick-up" : "Return";
    const errorId = `${id}-${kind}-error`;
    const tzId = `${id}-tz`;
    const describedBy = [tzId, error ? errorId : null].filter(Boolean).join(" ");
    const minForReturn = current.pickupDate || minDate;
    return (
      <fieldset className="min-w-0" disabled={disabled}>
        <legend className="mb-1.5 text-sm font-semibold text-ink">{legend}</legend>
        <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
          <div>
            <label htmlFor={`${id}-${dateKey}`} className="sr-only">
              {legend} date
            </label>
            <Input
              id={`${id}-${dateKey}`}
              type="date"
              name={names[dateKey] ?? dateKey}
              value={current[dateKey]}
              min={kind === "pickup" ? minDate : minForReturn}
              max={maxDate}
              required={required}
              invalid={Boolean(error)}
              aria-describedby={describedBy}
              onChange={(e) => update({ [dateKey]: e.target.value })}
              leading={<CalendarIcon size={18} />}
            />
          </div>
          <div>
            <label htmlFor={`${id}-${timeKey}`} className="sr-only">
              {legend} time
            </label>
            <Select
              id={`${id}-${timeKey}`}
              name={names[timeKey] ?? timeKey}
              value={current[timeKey]}
              required={required}
              invalid={Boolean(error)}
              aria-describedby={describedBy}
              onChange={(e) => update({ [timeKey]: e.target.value })}
              placeholder="Time"
              options={slots.map((t) => ({ value: t, label: t }))}
              leading={<ClockIcon size={18} />}
            />
          </div>
        </div>
        <p id={errorId} className={cn("mt-1 text-sm font-medium text-red-700", !error && "sr-only")} aria-live="polite">
          {error ?? ""}
        </p>
      </fieldset>
    );
  };

  return (
    <div className={className}>
      <div className={cn("grid gap-3", !compact && "md:grid-cols-2 md:gap-4")}>
        {group("pickup")}
        {group("return")}
      </div>
      <p id={`${id}-tz`} className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
        <ClockIcon size={14} />
        Times are in {tzLabel}.
      </p>
      {utcNames && (
        <>
          <input type="hidden" name={utcNames.pickup} value={toUtcIso(current.pickupDate, current.pickupTime, timeZone)} />
          <input type="hidden" name={utcNames.return} value={toUtcIso(current.returnDate, current.returnTime, timeZone)} />
        </>
      )}
    </div>
  );
}
