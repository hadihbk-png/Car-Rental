"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/ui/cn";
import {
  dayAvailability,
  monthGrid,
  monthOf,
  shiftMonth,
  weekdayLabels,
  type DayAvailability,
  type MonthKey,
  type UnavailableRange,
} from "@/lib/ui/calendar";
import { addDays, formatDateString, formatMonth, timeZoneLabel, weekdayOf, type DateString } from "@/lib/ui/datetime";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";

export interface AvailabilityCalendarProps {
  /** Branch IANA zone; days are local days in this zone. */
  timeZone: string;
  /** Half-open [start, end) blocked periods (reservations and maintenance), ISO strings from the server. */
  unavailable: readonly UnavailableRange[];
  /** Month shown first, "YYYY-MM". */
  initialMonth: MonthKey;
  /** Today in the branch zone; earlier days are shown as past. */
  today?: DateString;
  /** Navigation bounds. */
  minMonth?: MonthKey;
  maxMonth?: MonthKey;
  /** Highlight the user's chosen rental days. */
  selected?: { start: DateString; end: DateString };
  /** When set, days are clickable (e.g. to prefill the pick-up date). */
  onSelectDate?: (date: DateString) => void;
  weekStartsOn?: 0 | 1;
  /** Heading level for the month title. */
  headingLevel?: 2 | 3;
  className?: string;
}

const STATUS_TEXT: Record<DayAvailability, string> = {
  available: "available",
  partial: "partly booked",
  unavailable: "booked",
};

/**
 * Month grid of a vehicle's availability. Arrow keys move by day/week, PageUp/PageDown by month,
 * Home/End to the start/end of the week. Colour is backed by a pattern and text labels.
 */
export function AvailabilityCalendar({
  timeZone,
  unavailable,
  initialMonth,
  today,
  minMonth,
  maxMonth,
  selected,
  onSelectDate,
  weekStartsOn = 1,
  headingLevel = 3,
  className,
}: AvailabilityCalendarProps) {
  const [month, setMonth] = useState<MonthKey>(initialMonth);
  const [focused, setFocused] = useState<DateString>(`${initialMonth}-01`);
  const shouldFocus = useRef(false);
  const cellRefs = useRef(new Map<string, HTMLElement>());

  const weeks = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn]);
  const status = useMemo(() => {
    const map = new Map<string, DayAvailability>();
    for (const week of weeks) for (const cell of week) map.set(cell.date, dayAvailability(cell.date, unavailable, timeZone));
    return map;
  }, [weeks, unavailable, timeZone]);

  const canPrev = !minMonth || month > minMonth;
  const canNext = !maxMonth || month < maxMonth;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const titleId = useId();

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    cellRefs.current.get(focused)?.focus();
  }, [focused, month]);

  const clampMonth = (m: MonthKey) => {
    if (minMonth && m < minMonth) return minMonth;
    if (maxMonth && m > maxMonth) return maxMonth;
    return m;
  };

  const moveFocus = (date: DateString) => {
    const target = monthOf(date);
    if (clampMonth(target) !== target) return;
    shouldFocus.current = true;
    setFocused(date);
    if (target !== month) setMonth(target);
  };

  const changeMonth = (delta: number) => {
    const next = clampMonth(shiftMonth(month, delta));
    setMonth(next);
    setFocused(`${next}-01`);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const wd = (weekdayOf(focused) - weekStartsOn + 7) % 7;
    const map: Record<string, () => DateString> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -wd),
      End: () => addDays(focused, 6 - wd),
      PageUp: () => addDays(focused, -28),
      PageDown: () => addDays(focused, 28),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      moveFocus(fn());
    } else if ((e.key === "Enter" || e.key === " ") && onSelectDate) {
      e.preventDefault();
      if (!(today && focused < today) && status.get(focused) !== "unavailable") onSelectDate(focused);
    }
  };

  // Keep the roving tab stop inside the visible month.
  const tabStop = focused.startsWith(month) ? focused : `${month}-01`;

  return (
    <div className={cn("w-full max-w-md", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => changeMonth(-1)}
          disabled={!canPrev}
          className="inline-flex size-11 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-40"
          aria-label="Previous month"
        >
          <ChevronLeftIcon />
        </button>
        <Heading id={titleId} className="text-base font-bold text-ink" aria-live="polite">
          {formatMonth(month)}
        </Heading>
        <button
          type="button"
          onClick={() => changeMonth(1)}
          disabled={!canNext}
          className="inline-flex size-11 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-40"
          aria-label="Next month"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <table role="grid" aria-labelledby={titleId} className="w-full table-fixed border-separate border-spacing-1" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {weekdayLabels(weekStartsOn).map((d) => (
              <th key={d.short} scope="col" abbr={d.long} className="pb-1 text-xs font-semibold text-ink-muted">
                {d.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].date}>
              {week.map((cell) => {
                const st = status.get(cell.date) ?? "available";
                const past = Boolean(today && cell.date < today);
                const isSelected = Boolean(selected && cell.date >= selected.start && cell.date <= selected.end);
                const isToday = cell.date === today;
                const label = `${formatDateString(cell.date, "long")}, ${past ? "past" : STATUS_TEXT[st]}${isSelected ? ", in your rental" : ""}`;
                const interactive = Boolean(onSelectDate) && !past && st !== "unavailable";
                const content = (
                  <>
                    <span aria-hidden="true">{Number(cell.date.slice(8))}</span>
                    <span className="sr-only">{label}</span>
                  </>
                );
                const common = {
                  ref: (el: HTMLElement | null) => {
                    if (el) cellRefs.current.set(cell.date, el);
                    else cellRefs.current.delete(cell.date);
                  },
                  tabIndex: cell.date === tabStop ? 0 : -1,
                  onFocus: () => setFocused(cell.date),
                  className: cn(
                    "relative flex aspect-square w-full items-center justify-center rounded-lg text-sm font-medium tabular transition-colors",
                    !cell.inMonth && "opacity-40",
                    past && "text-ink-subtle line-through decoration-ink-subtle/60",
                    !past && st === "available" && "bg-emerald-50 text-emerald-900",
                    !past && st === "partial" && "bg-[linear-gradient(135deg,var(--color-emerald-50)_50%,var(--color-amber-100)_50%)] text-ink",
                    !past && st === "unavailable" && "bg-[repeating-linear-gradient(135deg,var(--color-red-50)_0_4px,var(--color-red-100)_4px_8px)] text-red-900",
                    isSelected && "ring-2 ring-brand-700 ring-inset",
                    isToday && "font-extrabold underline decoration-2 underline-offset-4",
                    interactive && "cursor-pointer hover:ring-2 hover:ring-brand-400",
                  ),
                };
                return (
                  <td key={cell.date} role="gridcell" aria-selected={isSelected || undefined} className="p-0">
                    {interactive ? (
                      <button type="button" {...common} onClick={() => onSelectDate?.(cell.date)}>
                        {content}
                      </button>
                    ) : (
                      <span {...common}>{content}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="size-4 rounded bg-emerald-50 ring-1 ring-emerald-200" aria-hidden="true" /> Available
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="size-4 rounded bg-[linear-gradient(135deg,var(--color-emerald-50)_50%,var(--color-amber-100)_50%)] ring-1 ring-amber-200"
            aria-hidden="true"
          />
          Partly booked
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="size-4 rounded bg-[repeating-linear-gradient(135deg,var(--color-red-50)_0_4px,var(--color-red-100)_4px_8px)] ring-1 ring-red-200"
            aria-hidden="true"
          />
          Booked
        </li>
        {selected && (
          <li className="flex items-center gap-1.5">
            <span className="size-4 rounded ring-2 ring-brand-700 ring-inset" aria-hidden="true" /> Your dates
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">Days are shown in {timeZoneLabel(timeZone, `${month}-15T12:00:00Z`)}.</p>
    </div>
  );
}
