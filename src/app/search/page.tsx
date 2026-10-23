import type { Metadata } from "next";
import { searchVehicles, type SearchInput, type SearchResult } from "@/lib/availability";
import { isDomainError } from "@/lib/errors";
import { listBranches, listCategories } from "@/lib/fleet/catalog";
import { formatDateTimeRange, todayInTimeZone, timeZoneLabel } from "@/lib/ui/datetime";
import { FUEL_OPTIONS, TRANSMISSION_OPTIONS, fuelLabel, pluralize, transmissionLabel } from "@/lib/ui/labels";
import { formatMoney, majorToMinor } from "@/lib/ui/money";
import {
  clearRefinements,
  countRefinements,
  filtersToRecord,
  parseSearchFilters,
  toQueryString,
  type SearchFilters,
} from "@/lib/ui/search-params";
import { ROUTES } from "@/lib/ui/routes";
import { resolveTrip, toBranchOption, tripFilters, vehicleHref } from "@/app/_lib/trip";
import { FilterPanel } from "@/components/search/filter-panel";
import { SearchForm } from "@/components/search/search-form";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CarIcon, MapPinIcon, SearchIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { VehicleCard } from "@/components/vehicle/vehicle-card";
import { SortSelect } from "./sort-select";

export const metadata: Metadata = {
  title: "Search cars",
  description: "Find an available rental car by branch, dates, car type, transmission, seats, fuel and price.",
};

const PAGE_SIZE = 12;

const SERVICE_SORT = { "price-asc": "price_asc", "price-desc": "price_desc", name: "name" } as const;

function cleanMessage(message: string): string {
  // Service validation messages may be prefixed with the field path ("returnAt: ...").
  return message.replace(/^[A-Za-z.]+:\s*/, "");
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const filters = parseSearchFilters(await searchParams);
  const [branches, categories] = await Promise.all([listBranches(), listCategories()]);
  const now = new Date();

  if (branches.length === 0) {
    return (
      <div className="container-page py-10">
        <PageHeader title="Search cars" />
        <EmptyState
          icon={<MapPinIcon />}
          title="No branches are open for booking"
          description="Online booking is temporarily unavailable. Please check back soon."
        />
      </div>
    );
  }

  const trip = resolveTrip(filters, branches);
  const branchOptions = branches.map(toBranchOption);
  const timeZone = trip.pickupBranch?.timezone ?? branches[0].timezone;
  const minDate = todayInTimeZone(now, timeZone);

  // No (valid) branch chosen yet: show the trip form.
  if (!trip.pickupBranch) {
    return (
      <div className="container-page py-8 sm:py-10">
        <PageHeader title="Search cars" description="Choose where and when you want to pick up your car." />
        {filters.pickupBranch && (
          <Notice tone="warning" className="mb-6" title="We couldn't find that branch">
            Please choose a pick-up branch from the list.
          </Notice>
        )}
        <Card padded className="max-w-3xl">
          <SearchForm branches={branchOptions} minDate={minDate} defaultValues={tripFilters(filters)} />
        </Card>
      </div>
    );
  }

  const transmission = TRANSMISSION_OPTIONS.find((o) => o.value === filters.transmission)?.value as
    | SearchInput["transmission"]
    | undefined;
  const fuelType = FUEL_OPTIONS.find((o) => o.value === filters.fuel)?.value as SearchInput["fuelType"] | undefined;

  let result: SearchResult | null = null;
  let problem: string | null = null;
  try {
    result = await searchVehicles(
      {
        pickupBranchId: trip.pickupBranch.id,
        returnBranchId: trip.returnBranch?.id,
        pickupAt: trip.pickupAt ?? undefined,
        returnAt: trip.returnAt ?? undefined,
        categorySlug: filters.category,
        transmission,
        fuelType,
        minSeats: filters.seats,
        minDailyRateFils: filters.minPrice !== undefined ? majorToMinor(filters.minPrice) : undefined,
        maxDailyRateFils: filters.maxPrice !== undefined ? majorToMinor(filters.maxPrice) : undefined,
        sort: SERVICE_SORT[filters.sort ?? "price-asc"],
      },
      now,
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    problem = cleanMessage(error.message);
  }

  const refinements = countRefinements(filters);
  const vehicles = result?.vehicles ?? [];
  const pageCount = Math.max(1, Math.ceil(vehicles.length / PAGE_SIZE));
  const page = Math.min(filters.page ?? 1, pageCount);
  const pageItems = vehicles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const oneWay = trip.returnBranch && trip.returnBranch.id !== trip.pickupBranch.id;

  const filterPanel = (
    <FilterPanel
      filters={filters}
      branches={branchOptions}
      categories={categories.map((c) => ({ value: c.slug, label: c.name }))}
      transmissions={TRANSMISSION_OPTIONS}
      fuelTypes={FUEL_OPTIONS}
      priceBounds={result?.priceRange ?? undefined}
      minDate={minDate}
      resultCount={result ? vehicles.length : undefined}
      pathname={ROUTES.search}
    />
  );

  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: ROUTES.home }, { label: "Search" }]}
        title={`Cars at ${trip.pickupBranch.name}`}
        description={
          result?.datesApplied && result.pickupAt && result.returnAt ? (
            <>
              {formatDateTimeRange(result.pickupAt, result.returnAt, result.timezone)} ·{" "}
              {pluralize(result.rentalDays, "day")}
              {oneWay && <> · Return to {trip.returnBranch!.name}</>}
              <span className="block text-sm">Times in {timeZoneLabel(result.timezone, result.pickupAt)}.</span>
            </>
          ) : (
            "Add pick-up and return dates to see only cars that are free and the total price."
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-20">{filterPanel}</div>

        <section aria-label="Search results" className="flex min-w-0 flex-col gap-4">
          {problem && (
            <Notice tone="error" title="We couldn't run this search" live>
              {problem} Adjust the trip details in the filters and try again.
            </Notice>
          )}
          {trip.partialDates && !problem && (
            <Notice tone="info">Enter both pick-up and return date and time to check availability for your trip.</Notice>
          )}

          {result && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 id="results-heading" className="text-lg font-bold text-ink" aria-live="polite">
                  {result.datesApplied
                    ? `${pluralize(vehicles.length, "car")} available`
                    : `${pluralize(vehicles.length, "car")} at this branch`}
                </h2>
                {vehicles.length > 1 && <SortSelect filters={filters} />}
              </div>
              {result.datesApplied && vehicles.length > 0 && (
                <p className="-mt-2 text-sm text-ink-muted">
                  Totals include 5% VAT
                  {result.oneWayFeeFils > 0 && <> and the one-way fee of {formatMoney(result.oneWayFeeFils, "AED")}</>}.
                  Extras are added on the next step.
                </p>
              )}

              {vehicles.length === 0 ? (
                <EmptyState
                  icon={<CarIcon />}
                  title={refinements > 0 ? "No cars match your filters" : "No cars available for these dates"}
                  description={
                    refinements > 0
                      ? "Try removing a filter or widening the price range."
                      : result.datesApplied
                        ? "Every car at this branch is booked for your dates. Try different dates or another branch."
                        : "There are no cars at this branch right now. Try another branch."
                  }
                  actions={
                    <>
                      {refinements > 0 && <ButtonLink href={`${ROUTES.search}${toQueryString(clearRefinements(filters))}`}>Clear filters</ButtonLink>}
                      {refinements === 0 && result.datesApplied && (
                        <ButtonLink href={`${ROUTES.search}${toQueryString({ pickupBranch: filters.pickupBranch })}`}>
                          See all cars at this branch
                        </ButtonLink>
                      )}
                      <ButtonLink href="/branches" variant="outline">
                        View other branches
                      </ButtonLink>
                    </>
                  }
                />
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {pageItems.map((v, i) => (
                    <li key={v.id} className="flex">
                      <VehicleCard
                        name={`${v.make} ${v.model}`}
                        subtitle={String(v.year)}
                        category={v.category.name}
                        imageUrl={v.photoUrls[0] ?? null}
                        imageAlt={`${v.name}${v.color ? `, ${v.color}` : ""}`}
                        transmission={transmissionLabel(v.transmission)}
                        seats={v.seats}
                        fuelType={fuelLabel(v.fuelType)}
                        luggage={v.luggage}
                        dailyRateFils={v.dailyRateFils}
                        totalFils={result.datesApplied ? v.estimatedTotalFils : undefined}
                        days={result.datesApplied ? v.rentalDays : undefined}
                        href={vehicleHref(v.id, filters)}
                        ctaLabel={result.datesApplied ? "Select" : "Check dates"}
                        preloadImage={i === 0}
                      />
                    </li>
                  ))}
                </ul>
              )}

              <Pagination
                page={page}
                pageCount={pageCount}
                pathname={ROUTES.search}
                searchParams={filtersToRecord({ ...filters, page: undefined } satisfies SearchFilters)}
                label="Search results pages"
              />
            </>
          )}

          {!result && !problem && (
            <EmptyState icon={<SearchIcon />} title="Start a search" description="Choose your trip details to see cars." />
          )}
        </section>
      </div>
    </div>
  );
}
