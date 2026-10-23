import type { Metadata } from "next";
import { requireUserOrRedirect } from "@/lib/auth";
import { LICENCE_CONTENT_TYPES, getMyDriverProfile } from "@/lib/drivers";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/types";
import { ROUTES } from "@/lib/ui/routes";
import { defaultTimeZone } from "@/app/_lib/trip";
import { DriverProfileForm, LicenceUploadForm } from "@/app/_components/driver-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const actor = await requireUserOrRedirect(ROUTES.profile);
  const [profile, timeZone] = await Promise.all([getMyDriverProfile(actor), defaultTimeZone()]);

  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader title="Your profile" description="Your account and the driver details we need before you pick up a car." />
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <Card as="section" aria-labelledby="account-heading" padded>
          <h2 id="account-heading" className="text-base font-bold text-ink">
            Account
          </h2>
          <dl className="mt-3 flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-ink-muted">Name</dt>
              <dd className="font-semibold text-ink">{actor.name}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Email</dt>
              <dd className="font-semibold break-all text-ink">{actor.email}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Account type</dt>
              <dd>
                <Badge tone={actor.role === "admin" ? "accent" : "neutral"}>{actor.role === "admin" ? "Administrator" : "Customer"}</Badge>
              </dd>
            </div>
          </dl>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card as="section" aria-labelledby="driver-heading">
            <CardHeader
              title={<span id="driver-heading">Driver details</span>}
              description="Must match your driving licence."
              actions={
                profile?.complete ? (
                  <Badge tone="success" dot>
                    Ready to drive
                  </Badge>
                ) : (
                  <Badge tone="warning" dot>
                    Incomplete
                  </Badge>
                )
              }
            />
            <CardBody>
              {!profile && (
                <Notice tone="info" className="mb-5">
                  Add your driver details and licence once; we&apos;ll use them for every booking.
                </Notice>
              )}
              <DriverProfileForm profile={profile} />
            </CardBody>
          </Card>

          <Card as="section" aria-labelledby="licence-heading">
            <CardHeader title={<span id="licence-heading">Driving licence</span>} description="Only you and DriveEasy staff can see this file." />
            <CardBody>
              {profile ? (
                <LicenceUploadForm
                  hasFile={profile.hasLicenceFile}
                  uploadedAt={profile.licenceUploadedAt?.toISOString() ?? null}
                  fileUrl={profile.licenceFileUrl}
                  timeZone={timeZone}
                  accept={LICENCE_CONTENT_TYPES}
                  maxBytes={MAX_UPLOAD_BYTES}
                />
              ) : (
                <p className="text-sm text-ink-muted">Save your driver details first, then upload your licence.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
