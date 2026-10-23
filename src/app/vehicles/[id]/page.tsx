import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getAvailabilityCalendar } from "@/lib/availability";
import { isDomainError } from "@/lib/errors";
import { getVehicle, listBranches, listExtras, type VehicleCard } from "@/lib/fleet/catalog";
import { parseBookingParams } from "@/lib/ui/booking-params";
import { parseOpeningHours } from "@/lib/ui/branch-hours";
import { isDateString, isTimeString, todayInTimeZone } from "@/lib/ui/datetime";
import { fuelLabel, transmissionLabel } from "@/lib/ui/labels";
import { toQueryString } from "@/lib/ui/search-params";
import { ROUTES } from "@/lib/ui/routes";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CheckIcon, FuelIcon, GearIcon, LuggageIcon, MapPinIcon, SeatIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { quoteAction } from "./actions";
import { PhotoGallery } from "./photo-gallery";
import type { QuoteState } from "./quote-types";
import { BookingCalendar, BookingPanel, VehicleBookingProvider } from "./vehicle-booking";

async function loadVehicle(id: string): Promise<VehicleCard> {
  try {
    return await getVehicle(id);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/vehicles/[id]">): Promise<Metadata> {
  const { id } = await params;
  try {
    const v = await getVehicle(id);
    return {
      title: `${v.name} rental in ${v.branch.city}`,
      description: `Rent a ${v.name} (${v.category.name}) from DriveEasy ${v.branch.name}. ${v.seats} seats, ${transmissionLabel(v.transmission).toLowerCase()}.`,
    };
  } catch {
    return { title: "Vehicle" };
  }
}

function Spec({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
      <span className="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700" aria-hidden="true">
        {icon}
      </span>
      <div>
        <dt className="text-xs text-ink-muted">{label}</dt>
        <dd className="text-sm font-semibold text-ink">{value}</dd>
      </div>
    </div>
  );
}

export default async function VehiclePage({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const vehicle = await loadVehicle(id);
  const booking = parseBookingParams(sp);
  const tz = vehicle.branch.timezone;
  const now = new Date();

  const [branches, extras, calendar] = await Promise.all([
    listBranches(),
    listExtras(),
    getAvailabilityCalendar({ vehicleId: vehicle.id, days: 120 }, now),
  ]);
  const pickupBranch = branches.find((b) => b.id === vehicle.branch.id);
  const hours = parseOpeningHours(pickupBranch?.openingHours);
  const differentBranchRequested = Boolean(booking.trip.pickupBranch && booking.trip.pickupBranch !== vehicle.branch.slug);
  const returnBranch =
    booking.trip.returnBranch && branches.some((b) => b.slug === booking.trip.returnBranch) ? booking.trip.returnBranch : vehicle.branch.slug;
  const t = booking.trip;
  const hasDates = [t.pickupDate, t.returnDate].every((d) => d && isDateString(d)) && [t.pickupTime, t.returnTime].every((x) => x && isTimeString(x));

  let initialQuote: QuoteState | null = null;
  if (hasDates) {
    initialQuote = await quoteAction({
      vehicleId: vehicle.id,
      returnBranch: returnBranch === vehicle.branch.slug ? undefined : returnBranch,
      pickupDate: t.pickupDate!,
      pickupTime: t.pickupTime!,
      returnDate: t.returnDate!,
      returnTime: t.returnTime!,
      extras: booking.extras,
    });
  }

  const backToSearch = `${ROUTES.search}${toQueryString({ ...booking.trip, pickupBranch: vehicle.branch.slug })}`;
  const unavailable = calendar.busy.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString(), kind: b.kind }));
  const notRentable = vehicle.status === "MAINTENANCE";

  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        breadcrumbs={[
          { label: "Home", href: ROUTES.home },
          { label: "Search", href: backToSearch },
          { label: `${vehicle.make} ${vehicle.model}` },
        ]}
        eyebrow={vehicle.category.name}
        title={`${vehicle.make} ${vehicle.model} ${vehicle.year}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <MapPinIcon size={16} className="text-ink-subtle" />
            {vehicle.branch.name}, {vehicle.branch.city}
            {vehicle.color && <Badge>{vehicle.color}</Badge>}
            {vehicle.status !== "AVAILABLE" && <StatusBadge kind="vehicle" status={vehicle.status} />}
          </span>
        }
      />

      {differentBranchRequested && (
        <Notice tone="info" className="mb-6">
          This car is picked up at {vehicle.branch.name}. Dates and prices below are for that branch.
        </Notice>
      )}

      <VehicleBookingProvider
        initial={{
          dates: {
            pickupDate: t.pickupDate ?? "",
            pickupTime: t.pickupTime ?? "",
            returnDate: t.returnDate ?? "",
            returnTime: t.returnTime ?? "",
          },
          returnBranch,
          extras: booking.extras,
        }}
      >
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-8 lg:col-start-1">
            <PhotoGallery photos={vehicle.photoUrls} name={vehicle.name} />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Spec icon={<SeatIcon />} label="Seats" value={`${vehicle.seats} seats`} />
              <Spec icon={<GearIcon />} label="Transmission" value={transmissionLabel(vehicle.transmission)} />
              <Spec icon={<FuelIcon />} label="Fuel" value={fuelLabel(vehicle.fuelType)} />
              <Spec icon={<LuggageIcon />} label="Luggage" value={`${vehicle.luggage} bags · ${vehicle.doors} doors`} />
            </dl>
          </div>

          <aside className="lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Book this car">
            <Card padded>
              {notRentable ? (
                <Notice tone="warning" title="Temporarily unavailable">
                  This car is in maintenance and can&apos;t be booked right now. Please choose another car.
                </Notice>
              ) : (
                <BookingPanel
                  vehicleId={vehicle.id}
                  timeZone={tz}
                  pickupBranch={{ slug: vehicle.branch.slug, name: vehicle.branch.name }}
                  returnBranches={branches.map((b) => ({ value: b.slug, label: b.slug === vehicle.branch.slug ? `${b.name} (same branch)` : b.name }))}
                  extras={extras}
                  minDate={todayInTimeZone(now, tz)}
                  openTime={hours?.open}
                  closeTime={hours?.close}
                  initialQuote={initialQuote}
                  nextPath="/book/driver"
                />
              )}
            </Card>
          </aside>

          <div className="flex min-w-0 flex-col gap-8 lg:col-start-1">
            {(vehicle.description || vehicle.features.length > 0) && (
              <section aria-labelledby="about-heading">
                <h2 id="about-heading" className="text-xl font-bold text-ink">
                  About this car
                </h2>
                {vehicle.description && <p className="mt-2 max-w-prose text-ink-muted">{vehicle.description}</p>}
                {vehicle.features.length > 0 && (
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {vehicle.features.map((f) => (
                      <li key={f.slug} className="flex items-center gap-2 text-sm text-ink">
                        <CheckIcon size={18} className="text-brand-700" />
                        {f.name}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <Card as="section" aria-labelledby="calendar-heading">
              <CardHeader
                title={<span id="calendar-heading">Availability</span>}
                description="Booked days are striped. Select a free day to start your rental on it."
              />
              <CardBody>
                <BookingCalendar timeZone={calendar.timezone} unavailable={unavailable} from={calendar.from} to={calendar.to} />
              </CardBody>
            </Card>

            <Card as="section" aria-labelledby="branch-heading" padded>
              <h2 id="branch-heading" className="text-base font-bold text-ink">
                Pick-up location
              </h2>
              <p className="mt-2 font-semibold text-ink">{vehicle.branch.name}</p>
              {pickupBranch && (
                <>
                  <p className="text-sm text-ink-muted">{pickupBranch.address}</p>
                  {pickupBranch.openingHours && <p className="mt-1 text-sm text-ink-muted">Hours: {pickupBranch.openingHours}</p>}
                </>
              )}
              <Link href={`/branches/${vehicle.branch.slug}`} className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">
                Branch details
              </Link>
            </Card>
          </div>
        </div>
      </VehicleBookingProvider>
    </div>
  );
}
