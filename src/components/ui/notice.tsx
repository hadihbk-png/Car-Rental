import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon } from "./icons";

export type NoticeTone = "info" | "success" | "warning" | "error";

const styles: Record<NoticeTone, { box: string; icon: string; Icon: typeof InfoIcon }> = {
  info: { box: "border-sky-200 bg-sky-50 text-sky-950", icon: "text-sky-700", Icon: InfoIcon },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-950", icon: "text-emerald-700", Icon: CheckCircleIcon },
  warning: { box: "border-amber-300 bg-amber-50 text-amber-950", icon: "text-amber-700", Icon: AlertTriangleIcon },
  error: { box: "border-red-200 bg-red-50 text-red-950", icon: "text-red-700", Icon: AlertCircleIcon },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons/links shown under the message. */
  actions?: ReactNode;
  /** Announce to screen readers when it appears (use for results of a user action). */
  live?: boolean;
  className?: string;
}

/** Inline message box (server-safe). For transient messages use the Toast API. */
export function Notice({ tone = "info", title, children, actions, live = false, className }: NoticeProps) {
  const { box, icon, Icon } = styles[tone];
  return (
    <div
      role={live ? (tone === "error" ? "alert" : "status") : undefined}
      className={cn("flex gap-3 rounded-xl border p-4 text-sm", box, className)}
    >
      <Icon className={cn("mt-0.5 shrink-0", icon)} size={20} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-1", "leading-relaxed")}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
