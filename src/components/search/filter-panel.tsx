"use client";

import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import type { DateString, TimeString } from "@/lib/ui/datetime";
import { minorToMajorFloor } from "@/lib/ui/money";
import {
  clearRefinements,
  countRefinements,
  parseSearchFilters,
  toQueryString,
  type SearchFilters,
} from "@/lib/ui/search-params";
import { DateTimeRangePicker } from "@/components/booking/date-time-range-picker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, ChoiceGroup, Input, Radio, Select, type SelectOption } from "@/components/ui/form-controls";
import { FilterIcon } from "@/components/ui/icons";

export interface BranchOption {
  id: string;
  name: string;
  /** IANA zone, e.g. "Asia/Dubai". */
  timeZone: string;
  openTime?: TimeString;
  closeTime?: TimeString;
}

export interface FilterPanelProps {
  /** Current filters, parsed from the page's searchParams with parseSearchFilters. */
  filters: SearchFilters;
  branches: readonly BranchOption[];
  categories: readonly SelectOption[];
  transmissions: readonly SelectOption[];
  fuelTypes: readonly SelectOption[];
  /** Minimum-seat choices (default 2, 4, 5, 7). */
  seatOptions?: readonly number[];
  /** Daily price range of the fleet, in fils (for placeholders). */
  priceBounds?: { minFils: number; maxFils: number };
  /** Earliest pick-up date (today in the branch zone). */
  minDate?: DateString;
  /** Results count for the mobile "Show N cars" button. */
  resultCount?: number;
  /** Defaults to the current path. */
  pathname?: string;
  className?: string;
}

const DEFAULT_SEATS = [2, 4, 5, 7] as const;

/**
 * Search filters. A plain GET form whose field names are the URL params, so it works without
 * JavaScript; with JavaScript it navigates client-side. Sidebar on desktop, bottom sheet on mobile.
 */
export function FilterPanel(props: FilterPanelProps) {
  const { filters, resultCount, className } = props;
  const currentPath = usePathname();
  const pathname = props.pathname ?? currentPath ?? "/search";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const mobileFormId = useId();
  const refinements = countRefinements(filters);

  const navigate = (next: SearchFilters) => {
    startTransition(() => {
      router.push(`${pathname}${toQueryString(next)}`, { scroll: false });
    });
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of data) if (typeof v === "string" && v !== "") params.append(k, v);
    setSheetOpen(false);
    navigate(parseSearchFilters(params));
  };

  const clear = () => {
    setSheetOpen(false);
    navigate(clearRefinements(filters));
  };

  // Re-mount forms when the URL filters change so uncontrolled fields show the applied values.
  const formKey = toQueryString(filters);

  return (
    <div className={className}>
      {/* Mobile trigger */}
      <div className="lg:hidden">
        <Button variant="outline" fullWidth onClick={() => setSheetOpen(true)} leadingIcon={<FilterIcon size={18} />} aria-haspopup="dialog">
          Filters{refinements > 0 ? ` (${refinements})` : ""}
        </Button>
        <Dialog
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Filter cars"
          variant="sheet"
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={clear} disabled={pending}>
                Clear filters
              </Button>
              <Button type="submit" form={mobileFormId} loading={pending}>
                {resultCount !== undefined ? `Show ${resultCount} ${resultCount === 1 ? "car" : "cars"}` : "Show results"}
              </Button>
            </>
          }
        >
          {sheetOpen && <FilterForm key={formKey} id={mobileFormId} {...props} pathname={pathname} onSubmit={onSubmit} />}
        </Dialog>
      </div>

      {/* Desktop sidebar */}
      <section aria-labelledby="filters-heading" className="hidden rounded-xl border border-line bg-surface p-5 shadow-card lg:block">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="filters-heading" className="text-base font-bold text-ink">
            Filters
          </h2>
          {refinements > 0 && (
            <button type="button" onClick={clear} className="rounded text-sm font-semibold text-brand-700 hover:underline">
              Clear all
            </button>
          )}
        </div>
        <FilterForm key={formKey} {...props} pathname={pathname} onSubmit={onSubmit}>
          <Button type="submit" fullWidth loading={pending} loadingText="Updating…">
            Apply filters
          </Button>
        </FilterForm>
      </section>
    </div>
  );
}

function FilterForm({
  id,
  filters,
  branches,
  categories,
  transmissions,
  fuelTypes,
  seatOptions = DEFAULT_SEATS,
  priceBounds,
  minDate,
  pathname,
  onSubmit,
  children,
}: FilterPanelProps & {
  id?: string;
  pathname: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children?: ReactNode;
}) {
  const uid = useId();
  const [pickupBranch, setPickupBranch] = useState(filters.pickupBranch ?? "");
  const [differentReturn, setDifferentReturn] = useState(
    Boolean(filters.returnBranch && filters.returnBranch !== filters.pickupBranch),
  );
  const branch = branches.find((b) => b.id === pickupBranch) ?? branches[0];
  const branchOptions = branches.map((b) => ({ value: b.id, label: b.name }));
  const minAed = priceBounds ? minorToMajorFloor(priceBounds.minFils) : undefined;
  const maxAed = priceBounds ? minorToMajorFloor(priceBounds.maxFils) + 1 : undefined;

  const radioGroup = (key: "category" | "transmission" | "fuel", legend: string, options: readonly SelectOption[]) =>
    options.length > 0 && (
      <ChoiceGroup legend={legend}>
        <Radio id={`${uid}-${key}-any`} name={key} value="" label="Any" defaultChecked={!filters[key]} />
        {options.map((o) => (
          <Radio
            key={o.value}
            id={`${uid}-${key}-${o.value}`}
            name={key}
            value={o.value}
            label={o.label}
            defaultChecked={filters[key] === o.value}
          />
        ))}
      </ChoiceGroup>
    );

  return (
    <form id={id} action={pathname} method="get" onSubmit={onSubmit} className="flex flex-col gap-6">
      {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-pickup`} className="text-sm font-semibold text-ink">
            Pick-up branch
          </label>
          <Select
            id={`${uid}-pickup`}
            name="pickupBranch"
            value={pickupBranch}
            onChange={(e) => setPickupBranch(e.target.value)}
            placeholder="Choose a branch"
            options={branchOptions}
          />
        </div>
        <Checkbox
          id={`${uid}-diff`}
          label="Return to a different branch"
          description="A one-way fee may apply."
          checked={differentReturn}
          onChange={(e) => setDifferentReturn(e.target.checked)}
        />
        {differentReturn && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-return`} className="text-sm font-semibold text-ink">
              Return branch
            </label>
            <Select
              id={`${uid}-return`}
              name="returnBranch"
              defaultValue={filters.returnBranch ?? ""}
              placeholder="Choose a branch"
              options={branchOptions}
            />
          </div>
        )}
        {branch && (
          <DateTimeRangePicker
            timeZone={branch.timeZone}
            openTime={branch.openTime}
            closeTime={branch.closeTime}
            minDate={minDate}
            required={false}
            compact
            defaultValue={{
              pickupDate: filters.pickupDate,
              pickupTime: filters.pickupTime,
              returnDate: filters.returnDate,
              returnTime: filters.returnTime,
            }}
          />
        )}
      </div>

      <hr className="border-line" />

      {radioGroup("category", "Car type", categories)}
      {radioGroup("transmission", "Transmission", transmissions)}
      {radioGroup("fuel", "Fuel type", fuelTypes)}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-seats`} className="text-sm font-semibold text-ink">
          Seats
        </label>
        <Select
          id={`${uid}-seats`}
          name="seats"
          defaultValue={filters.seats ? String(filters.seats) : ""}
          placeholder="Any number"
          options={seatOptions.map((n) => ({ value: String(n), label: `${n}+ seats` }))}
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-ink">Price per day (AED)</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${uid}-min`} className="mb-1 block text-xs text-ink-muted">
              Minimum
            </label>
            <Input
              id={`${uid}-min`}
              name="minPrice"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder={minAed !== undefined ? String(minAed) : "0"}
              defaultValue={filters.minPrice ?? ""}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-max`} className="mb-1 block text-xs text-ink-muted">
              Maximum
            </label>
            <Input
              id={`${uid}-max`}
              name="maxPrice"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder={maxAed !== undefined ? String(maxAed) : "Any"}
              defaultValue={filters.maxPrice ?? ""}
            />
          </div>
        </div>
      </fieldset>

      {children && <div className={cn("sticky bottom-0 -mx-1 bg-surface px-1 pt-2 pb-1")}>{children}</div>}
    </form>
  );
}
