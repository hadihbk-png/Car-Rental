import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "aside" | "li";
  /** "flat" drops the shadow (for nested cards or dense lists). */
  variant?: "raised" | "flat" | "highlight";
  padded?: boolean;
}

export function Card({ as: Tag = "div", variant = "raised", padded = false, className, ...props }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-xl border bg-surface",
        variant === "raised" && "border-line shadow-card",
        variant === "flat" && "border-line",
        variant === "highlight" && "border-brand-200 bg-brand-50/60",
        padded && "p-4 sm:p-6",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  headingLevel = 2,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6", className)}>
      <div className="min-w-0">
        <H className="text-base font-bold text-ink">{title}</H>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4 sm:px-6 sm:py-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-line bg-canvas/60 px-4 py-3 sm:px-6", className)}
      {...props}
    />
  );
}
