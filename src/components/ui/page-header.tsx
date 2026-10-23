import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { ChevronRightIcon } from "./icons";

export interface Breadcrumb {
  label: string;
  /** Omit for the current page. */
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: readonly Breadcrumb[];
  /** Buttons aligned right on desktop, below the title on mobile. */
  actions?: ReactNode;
  /** Small label above the title, e.g. a reservation reference. */
  eyebrow?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 pb-6 sm:pb-8", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
            {breadcrumbs.map((crumb, i) => (
              <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRightIcon size={14} className="text-ink-subtle" />}
                {crumb.href ? (
                  <Link href={crumb.href} className="rounded hover:text-brand-800 hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="font-medium text-ink">
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1 text-sm font-semibold tracking-wide text-brand-700 uppercase">{eyebrow}</div>}
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
          {description && <div className="mt-2 max-w-2xl text-base text-ink-muted">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}
