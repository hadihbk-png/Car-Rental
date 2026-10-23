import Link from "next/link";
import { cn } from "@/lib/ui/cn";
import { CheckIcon } from "@/components/ui/icons";

export const BOOKING_STEPS = [
  { id: "dates", label: "Dates" },
  { id: "vehicle", label: "Vehicle" },
  { id: "extras", label: "Extras" },
  { id: "driver", label: "Driver" },
  { id: "payment", label: "Payment" },
  { id: "voucher", label: "Voucher" },
] as const;

export type BookingStepId = (typeof BOOKING_STEPS)[number]["id"];

export interface StepperProps {
  current: BookingStepId;
  /** Hrefs for steps the user may go back to (only completed steps become links). */
  hrefs?: Partial<Record<BookingStepId, string>>;
  className?: string;
}

/** Booking progress. Completed steps can link back; the current step has aria-current="step". */
export function Stepper({ current, hrefs = {}, className }: StepperProps) {
  const currentIndex = BOOKING_STEPS.findIndex((s) => s.id === current);
  const total = BOOKING_STEPS.length;

  return (
    <nav aria-label="Booking progress" className={className}>
      {/* Compact summary for phones */}
      <div className="flex items-center justify-between gap-3 sm:hidden">
        <p className="text-sm font-semibold text-ink">
          Step {currentIndex + 1} of {total}: <span className="text-brand-800">{BOOKING_STEPS[currentIndex].label}</span>
        </p>
        <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <div className="bg-brand-600" style={{ width: `${((currentIndex + 1) / total) * 100}%` }} />
        </div>
      </div>

      <ol className="hidden items-center sm:flex">
        {BOOKING_STEPS.map((step, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
          const href = state === "done" ? hrefs[step.id] : undefined;
          const content = (
            <>
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-2 transition-colors",
                  state === "done" && "bg-brand-700 text-white ring-brand-700",
                  state === "current" && "bg-surface text-brand-800 ring-brand-700",
                  state === "upcoming" && "bg-surface text-ink-subtle ring-line-strong",
                )}
                aria-hidden="true"
              >
                {state === "done" ? <CheckIcon size={16} strokeWidth={2.5} /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold whitespace-nowrap",
                  state === "upcoming" ? "text-ink-muted" : "text-ink",
                )}
              >
                {step.label}
                {state === "done" && <span className="sr-only"> (completed)</span>}
              </span>
            </>
          );
          return (
            <li key={step.id} className={cn("flex items-center", i < total - 1 && "flex-1")}>
              {href ? (
                <Link href={href} className="flex items-center gap-2 rounded-lg p-1 hover:bg-brand-50">
                  {content}
                </Link>
              ) : (
                <span className="flex items-center gap-2 p-1" aria-current={state === "current" ? "step" : undefined}>
                  {content}
                </span>
              )}
              {i < total - 1 && (
                <span
                  className={cn("mx-2 h-0.5 min-w-4 flex-1 rounded-full lg:mx-3", i < currentIndex ? "bg-brand-700" : "bg-line-strong")}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
