import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { listBranches } from "@/lib/fleet/catalog";
import { timeZoneLabel } from "@/lib/ui/datetime";
import { ROUTES } from "@/lib/ui/routes";
import { toQueryString } from "@/lib/ui/search-params";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ClockIcon, MapPinIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Branches",
  description: "DriveEasy rental branches across the UAE: addresses, opening hours and cars available at each.",
};

export default async function BranchesPage() {
  await io();
  const branches = await listBranches();
  const cities = [...new Set(branches.map((b) => b.city))];

  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: ROUTES.home }, { label: "Branches" }]}
        title="Our branches"
        description="Pick up and return your car at any DriveEasy branch. One-way rentals between branches may carry a fee."
      />
      {branches.length === 0 ? (
        <EmptyState icon={<MapPinIcon />} title="No branches open" description="Online booking is temporarily unavailable." />
      ) : (
        <div className="flex flex-col gap-10">
          {cities.map((city) => (
            <section key={city} aria-labelledby={`city-${city}`}>
              <h2 id={`city-${city}`} className="mb-4 text-xl font-bold text-ink">
                {city}
              </h2>
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {branches
                  .filter((b) => b.city === city)
                  .map((b) => (
                    <li key={b.id} className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card">
                      <h3 className="text-lg font-bold text-ink">
                        <Link href={`/branches/${b.slug}`} className="hover:text-brand-800 hover:underline">
                          {b.name}
                        </Link>
                      </h3>
                      <p className="mt-2 flex gap-2 text-sm text-ink-muted">
                        <MapPinIcon size={16} className="mt-0.5 shrink-0 text-ink-subtle" />
                        {b.address}
                      </p>
                      {b.openingHours && (
                        <p className="mt-1 flex gap-2 text-sm text-ink-muted">
                          <ClockIcon size={16} className="mt-0.5 shrink-0 text-ink-subtle" />
                          {b.openingHours} · {timeZoneLabel(b.timezone)}
                        </p>
                      )}
                      <div className="mt-5 flex flex-wrap gap-2 pt-1 sm:mt-auto">
                        <Link href={`${ROUTES.search}${toQueryString({ pickupBranch: b.slug })}`} className={buttonClasses("primary", "sm")}>
                          See cars here
                        </Link>
                        <Link href={`/branches/${b.slug}`} className={buttonClasses("outline", "sm")}>
                          Branch details
                        </Link>
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
