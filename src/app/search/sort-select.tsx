"use client";

import { usePathname, useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import { SORT_LABELS } from "@/lib/ui/labels";
import { SORT_OPTIONS, toQueryString, withFilter, type SearchFilters, type SortOption } from "@/lib/ui/search-params";
import { Select } from "@/components/ui/form-controls";

/** Sort control; updates the URL (page resets to 1). */
export function SortSelect({ filters }: { filters: SearchFilters }) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-semibold whitespace-nowrap text-ink-muted">
        Sort by
      </label>
      <Select
        id={id}
        value={filters.sort ?? SORT_OPTIONS[0]}
        disabled={pending}
        aria-busy={pending || undefined}
        className="h-10 min-w-48"
        options={SORT_OPTIONS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
        onChange={(e) =>
          startTransition(() =>
            router.push(`${pathname}${toQueryString(withFilter(filters, "sort", e.target.value as SortOption))}`, { scroll: false }),
          )
        }
      />
    </div>
  );
}
