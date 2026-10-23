import Link from "next/link";
import { cn } from "@/lib/ui/cn";
import { paginationRange } from "@/lib/ui/pagination";
import { buildHref } from "@/lib/ui/search-params";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

export interface PaginationProps {
  page: number;
  pageCount: number;
  /** Path of the list page, e.g. "/search". */
  pathname: string;
  /** Current query params to keep (filters). `page` is replaced. */
  searchParams?: Record<string, string>;
  /** Name of the page param (default "page"). */
  param?: string;
  /** Accessible name, e.g. "Search results pages". */
  label?: string;
  className?: string;
}

/** Link-based pagination: works without JavaScript and keeps filters in the URL. */
export function Pagination({
  page,
  pageCount,
  pathname,
  searchParams = {},
  param = "page",
  label = "Pagination",
  className,
}: PaginationProps) {
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(1, page), pageCount);
  const href = (p: number) => buildHref(pathname, { ...searchParams, [param]: p === 1 ? undefined : String(p) });
  const items = paginationRange(current, pageCount);
  const edge =
    "inline-flex h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-ink-muted hover:bg-surface-muted hover:text-ink";
  const disabledEdge = "inline-flex h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-ink-subtle/60";

  return (
    <nav aria-label={label} className={cn("flex items-center justify-between gap-2 sm:justify-center", className)}>
      {current > 1 ? (
        <Link href={href(current - 1)} className={edge} rel="prev">
          <ChevronLeftIcon size={18} />
          <span>Previous</span>
        </Link>
      ) : (
        <span className={disabledEdge} aria-hidden="true">
          <ChevronLeftIcon size={18} />
          <span>Previous</span>
        </span>
      )}

      <p className="text-sm text-ink-muted tabular sm:hidden">
        Page {current} of {pageCount}
      </p>
      <ul className="hidden items-center gap-1 sm:flex">
        {items.map((item) =>
          typeof item === "number" ? (
            <li key={item}>
              <Link
                href={href(item)}
                aria-current={item === current ? "page" : undefined}
                aria-label={`Page ${item}`}
                className={cn(
                  "inline-flex size-11 items-center justify-center rounded-lg text-sm font-semibold tabular",
                  item === current ? "bg-brand-700 text-white" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                {item}
              </Link>
            </li>
          ) : (
            <li key={item} aria-hidden="true" className="inline-flex size-11 items-center justify-center text-ink-subtle">
              …
            </li>
          ),
        )}
      </ul>

      {current < pageCount ? (
        <Link href={href(current + 1)} className={edge} rel="next">
          <span>Next</span>
          <ChevronRightIcon size={18} />
        </Link>
      ) : (
        <span className={disabledEdge} aria-hidden="true">
          <span>Next</span>
          <ChevronRightIcon size={18} />
        </span>
      )}
    </nav>
  );
}
