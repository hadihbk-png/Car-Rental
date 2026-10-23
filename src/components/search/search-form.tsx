"use client";

import Form from "next/form";
import { useId, useState } from "react";
import type { DateString } from "@/lib/ui/datetime";
import { ROUTES } from "@/lib/ui/routes";
import type { SearchFilters } from "@/lib/ui/search-params";
import { DateTimeRangePicker } from "@/components/booking/date-time-range-picker";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form-controls";
import { MapPinIcon, SearchIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import type { BranchOption } from "./filter-panel";

export interface SearchFormProps {
  /** Active branches from the branch service. */
  branches: readonly BranchOption[];
  /** Today in the default branch zone (computed by the page at request time). */
  minDate?: DateString;
  /** Prefill (e.g. from the current search). */
  defaultValues?: SearchFilters;
  /** Target results page. */
  action?: string;
  /** "hero" is the large home layout; "inline" is a compact bar. */
  variant?: "hero" | "inline";
}

/** Trip search: branch, optional different return branch, pick-up and return date/time. GET to /search. */
export function SearchForm({ branches, minDate, defaultValues = {}, action = ROUTES.search, variant = "hero" }: SearchFormProps) {
  const uid = useId();
  const [pickupBranch, setPickupBranch] = useState(defaultValues.pickupBranch ?? branches[0]?.id ?? "");
  const [differentReturn, setDifferentReturn] = useState(
    Boolean(defaultValues.returnBranch && defaultValues.returnBranch !== defaultValues.pickupBranch),
  );
  const branch = branches.find((b) => b.id === pickupBranch) ?? branches[0];
  const options = branches.map((b) => ({ value: b.id, label: b.name }));

  if (branches.length === 0) {
    return (
      <Notice tone="warning" title="Booking is temporarily unavailable">
        No branches are open for online booking right now. Please check back soon.
      </Notice>
    );
  }

  return (
    <Form action={action} className="flex flex-col gap-4" aria-label="Find a car">
      <div className={variant === "hero" ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-pickup`} className="text-sm font-semibold text-ink">
            Pick-up branch
          </label>
          <Select
            id={`${uid}-pickup`}
            name="pickupBranch"
            required
            value={pickupBranch}
            onChange={(e) => setPickupBranch(e.target.value)}
            options={options}
            leading={<MapPinIcon size={18} />}
          />
        </div>
        {differentReturn ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-return`} className="text-sm font-semibold text-ink">
              Return branch
            </label>
            <Select
              id={`${uid}-return`}
              name="returnBranch"
              required
              defaultValue={defaultValues.returnBranch ?? ""}
              placeholder="Choose a branch"
              options={options}
              leading={<MapPinIcon size={18} />}
            />
          </div>
        ) : (
          <div className="hidden md:block" aria-hidden="true" />
        )}
      </div>
      <Checkbox
        id={`${uid}-diff`}
        label="Return to a different branch"
        checked={differentReturn}
        onChange={(e) => setDifferentReturn(e.target.checked)}
        className="-mt-2"
      />
      {branch && (
        <DateTimeRangePicker
          timeZone={branch.timeZone}
          openTime={branch.openTime}
          closeTime={branch.closeTime}
          minDate={minDate}
          defaultValue={{
            pickupDate: defaultValues.pickupDate,
            pickupTime: defaultValues.pickupTime,
            returnDate: defaultValues.returnDate,
            returnTime: defaultValues.returnTime,
          }}
        />
      )}
      <Button type="submit" size="lg" leadingIcon={<SearchIcon size={20} />} className="md:self-end md:px-10">
        Search cars
      </Button>
    </Form>
  );
}
