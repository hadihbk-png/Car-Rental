import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface EmptyStateProps {
  /** Decorative icon element. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary/secondary actions (ButtonLink, Button). */
  actions?: ReactNode;
  headingLevel?: 2 | 3;
  /** "card" adds a dashed frame; "plain" for inside existing cards. */
  variant?: "card" | "plain";
  className?: string;
}

export function EmptyState({ icon, title, description, actions, headingLevel = 2, variant = "card", className }: EmptyStateProps) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-12 text-center",
        variant === "card" && "rounded-xl border border-dashed border-line-strong bg-surface",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-brand-50 text-brand-700" aria-hidden="true">
          {icon}
        </div>
      )}
      <H className="text-lg font-bold text-ink">{title}</H>
      {description && <div className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{description}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}
