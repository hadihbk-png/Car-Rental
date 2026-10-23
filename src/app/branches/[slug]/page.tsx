import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { searchVehicles } from "@/lib/availability";
import { isDomainError } from "@/lib/errors";
import { getBranch, listBranches, type BranchSummary } from "@/lib/fleet/catalog";
import { todayInTimeZone, timeZoneLabel } from "@/lib/ui/datetime";
import { fuelLabel, pluralize, transmissionLabel } from "@/lib/ui/labels";
import { ROUTES } from "@/lib/ui/routes";
import { toQueryString } from "@/lib/ui/search-params";
import { toBranchOption, vehicleHref } from "@/app/_lib/trip";
import { SearchForm } from "@/components/search/search-form";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CarIcon, ClockIcon, MapPinIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { VehicleCard } from "@/components/vehicle/vehicle-card";

async function loadBranch(slug: string): Promise<BranchSummary> {
  try {
    const branch = await getBranch(slug);
    if (!branch.isActive) notFound();
    return branch;
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/branches/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  try {
    const b = await getBranch(slug);
    return { title: `${b.name} car rental`, description: `Rent a car at DriveEasy ${b.name}, ${b.address}.` };
  } catch {
    return { title: "Branch" };
  }
}

export default async function BranchPage({ params }: PageProps<"/branches/[slug]">) {
  const { slug } = await params;
  const branch = await loadBranch(slug);
  const [branches, result] = await Promise.all([listBranches(), searchVehicles({ pickupBranchId: branch.id, sort: "price_asc" })]);
  const now = new Date();
  const mapsHref =
    branch.latitude && branch.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${branch.latitude},${branch.longitude}`)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`;

  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        breadcrumbs={[
          { label: "Home", href: ROUTES.home },
          { label: "Branches", href: "/branches" },
          { label: branch.name },
        ]}
        eyebrow={branch.city}
        title={branch.name}
        description={branch.address}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <Card padded className="lg:order-2">
          <h2 className="text-base font-bold text-ink">Branch information</h2>
          <dl className="mt-3 flex flex-col gap-3 text-sm">
            <div className="flex gap-2">
              <MapPinIcon size={18} className="mt-0.5 shrink-0 text-ink-subtle" />
              <div>
                <dt className="sr-only">Address</dt>
                <dd className="text-ink">{branch.address}</dd>
                <dd>
                  <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">
                    Open in Google Maps<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </dd>
              </div>
            </div>
            <div className="flex gap-2">
              <ClockIcon size={18} className="mt-0.5 shrink-0 text-ink-subtle" />
              <div>
                <dt className="sr-only">Opening hours</dt>
                <dd className="text-ink">{branch.openingHours ?? "Contact the branch for opening hours"}</dd>
                <dd className="text-ink-muted">All times at this branch are in {timeZoneLabel(branch.timezone)}.</dd>
              </div>
            </div>
            {branch.phone && (
              <div>
                <dt className="text-ink-muted">Phone</dt>
                <dd>
                  <a href={`tel:${branch.phone.replace(/\s/g, "")}`} className="font-semibold text-brand-700 hover:underline">
                    {branch.phone}
                  </a>
                </dd>
              </div>
            )}
            {branch.email && (
              <div>
                <dt className="text-ink-muted">Email</dt>
                <dd>
                  <a href={`mailto:${branch.email}`} className="font-semibold break-all text-brand-700 hover:underline">
                    {branch.email}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <div className="flex min-w-0 flex-col gap-8 lg:order-1">
          <Card padded>
            <h2 className="mb-4 text-lg font-bold text-ink">Book at this branch</h2>
            <SearchForm
              branches={branches.map(toBranchOption)}
              defaultValues={{ pickupBranch: branch.slug }}
              minDate={todayInTimeZone(now, branch.timezone)}
            />
          </Card>

          <section aria-labelledby="fleet-heading">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <h2 id="fleet-heading" className="text-xl font-bold text-ink">
                Cars at this branch
              </h2>
              <p className="text-sm text-ink-muted">{pluralize(result.vehicles.length, "car")} · add dates to check availability</p>
            </div>
            {result.vehicles.length === 0 ? (
              <EmptyState
                icon={<CarIcon />}
                title="No cars at this branch right now"
                actions={
                  <Link href="/branches" className={buttonClasses("outline")}>
                    View other branches
                  </Link>
                }
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {result.vehicles.map((v, i) => (
                  <li key={v.id} className="flex">
                    <VehicleCard
                      name={`${v.make} ${v.model}`}
                      subtitle={String(v.year)}
                      category={v.category.name}
                      imageUrl={v.photoUrls[0] ?? null}
                      transmission={transmissionLabel(v.transmission)}
                      seats={v.seats}
                      fuelType={fuelLabel(v.fuelType)}
                      luggage={v.luggage}
                      dailyRateFils={v.dailyRateFils}
                      href={vehicleHref(v.id, { pickupBranch: branch.slug })}
                      ctaLabel="Check dates"
                      preloadImage={i === 0}
                      headingLevel={3}
                    />
                  </li>
                ))}
              </ul>
            )}
            {result.vehicles.length > 0 && (
              <Link href={`${ROUTES.search}${toQueryString({ pickupBranch: branch.slug })}`} className={`${buttonClasses("outline")} mt-4`}>
                Filter cars at this branch
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
