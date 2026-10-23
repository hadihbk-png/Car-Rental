import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyDriverProfile } from "@/lib/drivers";
import { serializeExtras } from "@/lib/ui/booking-params";
import { Stepper } from "@/components/booking/stepper";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { loadBookingContext } from "../_lib/booking-context";
import { TripSummary } from "../_components/trip-summary";
import { ReserveForm } from "./reserve-form";

export const metadata: Metadata = { title: "Review and reserve" };

export default async function CheckoutPage({ searchParams }: PageProps<"/book/checkout">) {
  const ctx = await loadBookingContext(await searchParams, "/book/checkout");
  const profile = await getMyDriverProfile(ctx.actor);
  if (!profile?.complete) redirect(`/book/driver${ctx.query}`);

  // One key per checkout page view; the form resends it on retry so a double submit can't create two holds.
  const idempotencyKey = `chk_${randomUUID()}`;
  const canReserve = Boolean(ctx.quote?.available);

  return (
    <div className="container-page py-8 sm:py-10">
      <Stepper
        current="payment"
        hrefs={{
          dates: ctx.vehiclePageHref,
          vehicle: `/search?pickupBranch=${ctx.pickupBranch.slug}`,
          extras: ctx.vehiclePageHref,
          driver: `/book/driver${ctx.query}`,
        }}
        className="mb-8"
      />
      <PageHeader title="Review and reserve" description="Check your trip and price. You'll pay on the next screen." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Card as="section" aria-labelledby="driver-summary" padded>
            <div className="flex items-start justify-between gap-4">
              <h2 id="driver-summary" className="text-base font-bold text-ink">
                Main driver
              </h2>
              <Link href={`/book/driver${ctx.query}`} className="text-sm font-semibold text-brand-700 hover:underline">
                Edit
              </Link>
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-muted">Name</dt>
                <dd className="font-semibold text-ink">{profile.fullName}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Phone</dt>
                <dd className="font-semibold text-ink">{profile.phone}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Licence</dt>
                <dd className="font-semibold text-ink">
                  {profile.licenceNumber} ({profile.licenceCountry})
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Licence expires</dt>
                <dd className="font-semibold text-ink">{profile.licenceExpiresOn}</dd>
              </div>
            </dl>
          </Card>

          <Card as="section" aria-labelledby="reserve-heading" padded>
            <h2 id="reserve-heading" className="mb-4 text-base font-bold text-ink">
              Reserve your car
            </h2>
            {canReserve && ctx.quote ? (
              <ReserveForm
                changeHref={ctx.vehiclePageHref}
                fields={{
                  vehicleId: ctx.vehicle.id,
                  pickupBranchId: ctx.pickupBranch.id,
                  returnBranchId: ctx.returnBranch.id,
                  pickupAt: ctx.pickupAt.toISOString(),
                  returnAt: ctx.returnAt.toISOString(),
                  extras: serializeExtras(ctx.booking.extras),
                  idempotencyKey,
                }}
              />
            ) : (
              <Notice
                tone="warning"
                title={ctx.quote ? "This car is no longer available for your dates" : "This trip can't be booked"}
                actions={
                  <Link href={ctx.vehiclePageHref} className={buttonClasses("outline", "sm")}>
                    Choose new dates
                  </Link>
                }
              >
                {ctx.quoteError ?? "Pick other dates or another car."}
              </Notice>
            )}
          </Card>
        </div>

        <div className="lg:sticky lg:top-20">
          <TripSummary
            vehicle={ctx.vehicle}
            pickupBranchName={ctx.pickupBranch.name}
            returnBranchName={ctx.returnBranch.name}
            pickupAt={ctx.pickupAt}
            returnAt={ctx.returnAt}
            timeZone={ctx.pickupBranch.timezone}
            returnTimeZone={ctx.returnBranch.timezone}
            price={ctx.quote}
            priceError={ctx.quoteError}
            changeHref={ctx.vehiclePageHref}
          />
        </div>
      </div>
    </div>
  );
}
