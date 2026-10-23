import type { Metadata } from "next";
import Link from "next/link";
import { getDriverProfileForUser } from "@/lib/drivers";
import { getFleetVehicle } from "@/lib/fleet/admin";
import { listBranches } from "@/lib/fleet/catalog";
import { listReservations } from "@/lib/reservations";
import { addDays, formatTime, todayInTimeZone, zonedTimeToUtc } from "@/lib/ui/datetime";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../_lib/auth";
import { lookupReservation } from "../_lib/lookup";
import { ActionForm, FSelect, FText, FTextarea } from "../_components/action-form";
import { FUEL_OPTIONS_EIGHTHS, ReservationCard } from "../_components/reservation-card";
import { VoucherLookup } from "../_components/voucher-lookup";
import { checkOutAction } from "./actions";

export const metadata: Metadata = { title: "Check-out" };


export default async function CheckOutPage({ searchParams }: PageProps<"/admin/check-out">) {
  const sp = await searchParams;
  const actor = await requireAdminPage("/admin/check-out");
  const ref = typeof sp.ref === "string" ? sp.ref : "";
  const { r, error } = await lookupReservation(actor, ref);
  const branches = await listBranches();
  const tz = branches[0]?.timezone ?? "UTC";
  const today = todayInTimeZone(new Date(), tz);
  const { items: todays } = await listReservations(actor, {
    status: "CONFIRMED",
    pickupFrom: zonedTimeToUtc(today, "00:00", tz),
    pickupTo: zonedTimeToUtc(addDays(today, 1), "00:00", tz),
    sort: "pickup_asc",
    limit: 50,
  });
  const [vehicle, driver] = r ? await Promise.all([getFleetVehicle(actor, r.vehicle.id), getDriverProfileForUser(actor, r.customer.id)]) : [null, null];

  return (
    <>
      <PageHeader title="Check-out" description="Hand a car to a customer: find the booking, check the licence, record mileage and fuel." />
      <Card padded className="mb-6">
        <VoucherLookup defaultValue={ref} />
      </Card>

      {error && (
        <Notice tone="error" className="mb-6" live>
          {error}
        </Notice>
      )}

      {r && (
        <div className="mb-8 flex flex-col gap-4">
          <ReservationCard r={r} />
          {r.status === "CONFIRMED" ? (
            <Card>
              <CardHeader
                title="Hand over the car"
                actions={driver?.complete ? <Badge tone="success" dot>Licence on file</Badge> : <Badge tone="warning" dot>No licence on file</Badge>}
              />
              <CardBody className="flex flex-col gap-4">
                {driver && (
                  <p className="text-sm text-ink-muted">
                    Check the driver&apos;s licence: <span className="font-semibold text-ink">{driver.fullName}</span>, {driver.licenceNumber} ({driver.licenceCountry}), expires{" "}
                    {driver.licenceExpiresOn}.{" "}
                    {driver.licenceFileUrl && (
                      <a href={driver.licenceFileUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-800 underline">
                        View uploaded licence
                      </a>
                    )}
                  </p>
                )}
                <ActionForm action={checkOutAction.bind(null, r.id)} submitLabel="Confirm check-out" pendingLabel="Checking out…" fieldsClassName="sm:grid-cols-2">
                  <FText name="mileageKm" label="Mileage (km)" type="number" inputMode="numeric" min={0} required defaultValue={vehicle?.mileageKm} />
                  <FSelect name="fuelLevel" label="Fuel level" required options={FUEL_OPTIONS_EIGHTHS} defaultValue="8" />
                  <FTextarea name="notes" label="Condition notes" optionalLabel rows={3} fieldClassName="sm:col-span-2" placeholder="Existing scratches, accessories handed over…" />
                </ActionForm>
              </CardBody>
            </Card>
          ) : (
            <Notice tone={r.status === "PICKED_UP" ? "success" : "warning"} title={r.status === "PICKED_UP" ? "Checked out: the car is on rent" : "Can't check out this reservation"} live>
              {r.status === "PICKED_UP" ? (
                <>
                  This car is on rent.{" "}
                  <Link href={`/admin/check-in?ref=${r.reference}`} className="font-semibold underline">
                    Go to check-in
                  </Link>
                </>
              ) : (
                `Only confirmed reservations can be checked out. Current status: ${r.status.toLowerCase().replace(/_/g, " ")}.`
              )}
            </Notice>
          )}
        </div>
      )}

      <section aria-labelledby="today-heading">
        <h2 id="today-heading" className="mb-3 text-lg font-bold text-ink">
          Pick-ups today
        </h2>
        {todays.length === 0 ? (
          <p className="text-sm text-ink-muted">No confirmed pick-ups left for today.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {todays.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/check-out?ref=${t.reference}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-canvas">
                  <span>
                    <span className="font-mono font-semibold text-brand-800">{t.reference}</span> · {t.customer.name} · {t.vehicle.name}
                  </span>
                  <span className="text-ink-muted">
                    {formatTime(t.pickupAt, t.timezone)} · {t.pickupBranch.code}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
