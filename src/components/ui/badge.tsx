import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "accent";

const tones: Record<BadgeTone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-slate-100 text-slate-800 ring-slate-300/70", dot: "bg-slate-500" },
  brand: { pill: "bg-brand-50 text-brand-800 ring-brand-200", dot: "bg-brand-600" },
  success: { pill: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-600" },
  warning: { pill: "bg-amber-50 text-amber-900 ring-amber-300/70", dot: "bg-amber-500" },
  danger: { pill: "bg-red-50 text-red-800 ring-red-200", dot: "bg-red-600" },
  info: { pill: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-600" },
  accent: { pill: "bg-accent-50 text-accent-800 ring-accent-200", dot: "bg-accent-600" },
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Shows a coloured dot so status is not conveyed by colour of text alone. */
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot = false, size = "sm", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ring-1 ring-inset",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        tones[tone].pill,
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", tones[tone].dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Status values from requirements.md. Payment/deposit values are owned by the engine and fall back to humanised labels. */
export type ReservationStatus = "PENDING" | "CONFIRMED" | "PICKED_UP" | "RETURNED" | "CANCELLED" | "EXPIRED" | "REFUNDED";
export type VehicleStatus = "AVAILABLE" | "RESERVED" | "ON_RENT" | "MAINTENANCE" | "RETIRED";
export type StatusKind = "reservation" | "vehicle" | "payment" | "deposit";

const RESERVATION: Record<ReservationStatus, [string, BadgeTone]> = {
  PENDING: ["Awaiting payment", "warning"],
  CONFIRMED: ["Confirmed", "success"],
  PICKED_UP: ["On rent", "brand"],
  RETURNED: ["Returned", "neutral"],
  CANCELLED: ["Cancelled", "danger"],
  EXPIRED: ["Expired", "neutral"],
  REFUNDED: ["Refunded", "info"],
};

const VEHICLE: Record<VehicleStatus, [string, BadgeTone]> = {
  AVAILABLE: ["Available", "success"],
  RESERVED: ["Reserved", "info"],
  ON_RENT: ["On rent", "brand"],
  MAINTENANCE: ["Maintenance", "warning"],
  RETIRED: ["Retired", "neutral"],
};

/** Keyword heuristics for engine-defined payment/deposit statuses. */
function toneForMoneyStatus(status: string): BadgeTone {
  const s = status.toUpperCase();
  if (/(FAIL|DECLIN|ERROR)/.test(s)) return "danger";
  if (/(REFUND|RELEASE|VOID|CANCEL)/.test(s)) return "info";
  if (/(SUCCEED|SUCCESS|PAID|CAPTURED|AUTHORI[SZ]ED|HELD)/.test(s)) return "success";
  if (/(PENDING|REQUIRES|PROCESSING|CREATED)/.test(s)) return "warning";
  return "neutral";
}

export function humanizeStatus(status: string): string {
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function statusPresentation(kind: StatusKind, status: string): { label: string; tone: BadgeTone } {
  if (kind === "reservation" && status in RESERVATION) {
    const [label, tone] = RESERVATION[status as ReservationStatus];
    return { label, tone };
  }
  if (kind === "vehicle" && status in VEHICLE) {
    const [label, tone] = VEHICLE[status as VehicleStatus];
    return { label, tone };
  }
  return { label: humanizeStatus(status), tone: toneForMoneyStatus(status) };
}

export interface StatusBadgeProps {
  kind: StatusKind;
  status: string;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({ kind, status, size, className }: StatusBadgeProps) {
  const { label, tone } = statusPresentation(kind, status);
  return (
    <Badge tone={tone} dot size={size} className={className}>
      {label}
    </Badge>
  );
}
