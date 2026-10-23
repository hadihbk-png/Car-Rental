import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDriverProfileForUser } from "@/lib/drivers";
import { isDomainError } from "@/lib/errors";
import { getReservation, listDamageReports } from "@/lib/reservations";
import { formatDateTime } from "@/lib/ui/datetime";
import { formatMoney } from "@/lib/ui/money";
import { priceBreakdownProps } from "@/lib/ui/price-view";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../_lib/auth";
import { ActionForm, FTextarea } from "../../_components/action-form";
import { adminCancelAction, settleDepositAction } from "../actions";

export const metadata: Metadata = { title: "Reservation" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export default async function AdminReservationPage({ params }: PageProps<"/admin/reservations/[reference]">) {
  const { reference } = await params;
  const actor = await requireAdminPage(`/admin/reservations/${encodeURIComponent(reference)}`);
  let r;
  try {
    r = await getReservation(actor, reference);
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) notFound();
    throw error;
  }
  const [driver, damage] = await Promise.all([getDriverProfileForUser(actor, r.customer.id), listDamageReports(actor, { reservationId: r.id })]);
  const a = r.agreement;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Reservations", href: "/admin/reservations" }, { label: r.reference }]}
        eyebrow={<span className="font-mono">{r.reference}</span>}
        title={`${r.customer.name} · ${r.vehicle.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge kind="reservation" status={r.status} size="md" />
            {r.paymentStatus && (
              <span className="flex items-center gap-1">
                Payment <StatusBadge kind="payment" status={r.paymentStatus} />
              </span>
            )}
            {r.depositStatus && (
              <span className="flex items-center gap-1">
                Deposit <StatusBadge kind="deposit" status={r.depositStatus} />
              </span>
            )}
          </span>
        }
        actions={
          <>
            {r.status === "CONFIRMED" && (
              <Link href={`/admin/check-out?ref=${r.reference}`} className={buttonClasses("primary")}>
                Check out
              </Link>
            )}
            {r.status === "PICKED_UP" && (
              <Link href={`/admin/check-in?ref=${r.reference}`} className={buttonClasses("primary")}>
                Check in
              </Link>
            )}
            <Link href={`/admin/damage/new?vehicle=${r.vehicle.id}&reservation=${r.id}`} className={buttonClasses("outline")}>
              Report damage
            </Link>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Trip" />
            <CardBody>
              <dl>
                <Row label="Vehicle">
                  <Link href={`/admin/fleet/${r.vehicle.id}`} className="text-brand-800 hover:underline">
                    {r.vehicle.name}
                  </Link>
                </Row>
                <Row label="Pick-up">
                  {formatDateTime(r.pickupAt, r.timezone)} · {r.pickupBranch.name}
                </Row>
                <Row label="Return">
                  {formatDateTime(r.returnAt, r.returnBranch.timezone)} · {r.returnBranch.name}
                </Row>
                {r.holdExpiresAt && r.status === "PENDING" && <Row label="Hold expires">{formatDateTime(r.holdExpiresAt, r.timezone)}</Row>}
                <Row label="Booked">{formatDateTime(r.createdAt, r.timezone)}</Row>
                {r.confirmedAt && <Row label="Confirmed">{formatDateTime(r.confirmedAt, r.timezone)}</Row>}
                {r.cancelledAt && <Row label="Cancelled">{formatDateTime(r.cancelledAt, r.timezone)}</Row>}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Customer and driver"
              actions={driver?.complete ? <Badge tone="success" dot>Licence on file</Badge> : <Badge tone="warning" dot>Driver details incomplete</Badge>}
            />
            <CardBody>
              <dl>
                <Row label="Account">
                  {r.customer.name} · <span className="break-all">{r.customer.email}</span>
                </Row>
                {driver && (
                  <>
                    <Row label="Driver">{driver.fullName}</Row>
                    <Row label="Phone">{driver.phone}</Row>
                    <Row label="Date of birth">{driver.dateOfBirth}</Row>
                    <Row label="Licence">
                      {driver.licenceNumber} ({driver.licenceCountry}), expires {driver.licenceExpiresOn}
                    </Row>
                    {driver.licenceFileUrl && (
                      <Row label="Licence file">
                        <a href={driver.licenceFileUrl} target="_blank" rel="noopener noreferrer" className="text-brand-800 underline">
                          Open licence<span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </Row>
                    )}
                  </>
                )}
              </dl>
            </CardBody>
          </Card>

          {a && (
            <Card>
              <CardHeader title="Rental agreement" />
              <CardBody>
                <dl>
                  {a.checkedOutAt && <Row label="Checked out">{formatDateTime(a.checkedOutAt, r.timezone)}</Row>}
                  {a.pickupMileageKm !== null && <Row label="Mileage out">{a.pickupMileageKm.toLocaleString("en-GB")} km</Row>}
                  {a.pickupFuelLevel !== null && <Row label="Fuel out">{a.pickupFuelLevel}/8</Row>}
                  {a.pickupNotes && <Row label="Notes out">{a.pickupNotes}</Row>}
                  {a.checkedInAt && <Row label="Checked in">{formatDateTime(a.checkedInAt, r.returnBranch.timezone)}</Row>}
                  {a.returnMileageKm !== null && <Row label="Mileage in">{a.returnMileageKm.toLocaleString("en-GB")} km</Row>}
                  {a.returnFuelLevel !== null && <Row label="Fuel in">{a.returnFuelLevel}/8</Row>}
                  {a.returnNotes && <Row label="Notes in">{a.returnNotes}</Row>}
                  {a.lateFeeFils !== null && <Row label={`Late fee (${a.lateDays ?? 0} days)`}>{formatMoney(a.lateFeeFils, "AED")}</Row>}
                  {a.fuelChargeFils !== null && <Row label="Fuel charge">{formatMoney(a.fuelChargeFils, "AED")}</Row>}
                  {a.damageChargeFils !== null && <Row label="Damage charge">{formatMoney(a.damageChargeFils, "AED")}</Row>}
                  {a.chargesTaxFils !== null && <Row label="VAT on charges">{formatMoney(a.chargesTaxFils, "AED")}</Row>}
                  {a.depositCapturedFils !== null && <Row label="Taken from deposit">{formatMoney(a.depositCapturedFils, "AED")}</Row>}
                  {a.amountDueFils !== null && a.amountDueFils > 0 && <Row label="Still due from customer">{formatMoney(a.amountDueFils, "AED")}</Row>}
                </dl>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Damage reports" />
            <CardBody>
              {damage.length === 0 ? (
                <p className="text-sm text-ink-muted">No damage reported for this rental.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {damage.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <Link href={`/admin/damage/${d.id}`} className="font-semibold text-brand-800 hover:underline">
                        {d.location} ({d.severity.toLowerCase()})
                      </Link>
                      {d.resolvedAt ? <Badge tone="success">Resolved</Badge> : <Badge tone="warning">Open</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {(r.can.cancel || (r.status === "RETURNED" && r.depositStatus === "held")) && (
            <Card>
              <CardHeader title="Staff actions" />
              <CardBody className="flex flex-col gap-6">
                {r.status === "RETURNED" && r.depositStatus === "held" && (
                  <ActionForm action={settleDepositAction.bind(null, r.id)} submitLabel="Settle deposit" submitVariant="outline" pendingLabel="Settling…">
                    <p className="text-sm text-ink-muted">Captures any return charges from the deposit and releases the rest.</p>
                  </ActionForm>
                )}
                {r.can.cancel && r.cancellationPreview?.allowed && (
                  <ActionForm
                    action={adminCancelAction.bind(null, r.id)}
                    submitLabel="Cancel reservation"
                    submitVariant="danger"
                    pendingLabel="Cancelling…"
                    confirmMessage={`Cancel ${r.reference}? ${r.cancellationPreview.free ? "Full refund." : `Fee ${formatMoney(r.cancellationPreview.feeFils, "AED")}.`}`}
                    idPrefix="cancel-"
                  >
                    <p className="text-sm text-ink-muted">
                      {r.cancellationPreview.free
                        ? `Free cancellation: ${formatMoney(r.cancellationPreview.refundFils, "AED")} refunded.`
                        : `Within 48 hours: fee ${formatMoney(r.cancellationPreview.feeFils, "AED")}, refund ${formatMoney(r.cancellationPreview.refundFils, "AED")}.`}
                    </p>
                    <FTextarea name="reason" label="Reason" optionalLabel rows={2} />
                  </ActionForm>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <Card padded className="xl:sticky xl:top-20">
          <PriceBreakdown {...priceBreakdownProps(r.price)} title="Price" />
          <dl className="mt-4 border-t border-line pt-3">
            <Row label="Paid">{formatMoney(r.paidFils, "AED")}</Row>
            {r.balanceDueFils > 0 && <Row label="Balance due from customer">{formatMoney(r.balanceDueFils, "AED")}</Row>}
            {r.refundedFils > 0 && <Row label="Refunded">{formatMoney(r.refundedFils, "AED")}</Row>}
            {r.cancellationFeeFils !== null && <Row label="Cancellation fee">{formatMoney(r.cancellationFeeFils, "AED")}</Row>}
          </dl>
        </Card>
      </div>
    </>
  );
}
