import type { Metadata } from "next";
import Link from "next/link";
import { LICENCE_CONTENT_TYPES, getMyDriverProfile } from "@/lib/drivers";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/types";
import { DriverProfileForm, LicenceUploadForm } from "@/app/_components/driver-forms";
import { Stepper } from "@/components/booking/stepper";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { loadBookingContext } from "../_lib/booking-context";
import { TripSummary } from "../_components/trip-summary";

export const metadata: Metadata = { title: "Driver details" };

export default async function BookDriverPage({ searchParams }: PageProps<"/book/driver">) {
  const ctx = await loadBookingContext(await searchParams, "/book/driver");
  const profile = await getMyDriverProfile(ctx.actor);
  const tz = ctx.pickupBranch.timezone;
  const ready = Boolean(profile?.complete) && Boolean(ctx.quote?.available);

  return (
    <div className="container-page py-8 sm:py-10">
      <Stepper
        current="driver"
        hrefs={{ dates: ctx.vehiclePageHref, vehicle: `/search?pickupBranch=${ctx.pickupBranch.slug}`, extras: ctx.vehiclePageHref }}
        className="mb-8"
      />
      <PageHeader title="Driver details" description="We need the main driver's details and licence before payment." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {ctx.quote && !ctx.quote.available && (
            <Notice tone="warning" title="This car is no longer available for your dates" actions={<Link href={ctx.vehiclePageHref} className={buttonClasses("outline", "sm")}>Choose new dates</Link>} live>
              Someone booked it in the meantime. Pick other dates or another car.
            </Notice>
          )}
          <Card as="section" aria-labelledby="driver-heading">
            <CardHeader title={<span id="driver-heading">1. Main driver</span>} description="Must match the driving licence." />
            <CardBody>
              <DriverProfileForm profile={profile} submitLabel={profile ? "Save changes" : "Save driver details"} />
            </CardBody>
          </Card>
          <Card as="section" aria-labelledby="licence-heading">
            <CardHeader title={<span id="licence-heading">2. Driving licence</span>} description="Only you and DriveEasy staff can see this file." />
            <CardBody>
              {profile ? (
                <LicenceUploadForm
                  hasFile={profile.hasLicenceFile}
                  uploadedAt={profile.licenceUploadedAt?.toISOString() ?? null}
                  fileUrl={profile.licenceFileUrl}
                  timeZone={tz}
                  accept={LICENCE_CONTENT_TYPES}
                  maxBytes={MAX_UPLOAD_BYTES}
                />
              ) : (
                <p className="text-sm text-ink-muted">Save the driver details above first.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-20">
          <TripSummary
            vehicle={ctx.vehicle}
            pickupBranchName={ctx.pickupBranch.name}
            returnBranchName={ctx.returnBranch.name}
            pickupAt={ctx.pickupAt}
            returnAt={ctx.returnAt}
            timeZone={tz}
            returnTimeZone={ctx.returnBranch.timezone}
            price={ctx.quote}
            priceError={ctx.quoteError}
            changeHref={ctx.vehiclePageHref}
            footer={
              ready ? (
                <Link href={`/book/checkout${ctx.query}`} className={buttonClasses("primary", "lg", true)}>
                  Continue to payment
                  <ArrowRightIcon size={18} />
                </Link>
              ) : (
                <p className="rounded-lg bg-surface-muted px-4 py-3 text-center text-sm text-ink-muted">
                  {profile?.complete ? "Choose available dates to continue." : "Save your details and upload your licence to continue."}
                </p>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
