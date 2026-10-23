import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { listBranches } from "@/lib/fleet/catalog";
import { parseOpeningHours } from "@/lib/ui/branch-hours";
import { formatDateTime, toDateString, toTimeString, todayInTimeZone } from "@/lib/ui/datetime";
import { fuelLabel, transmissionLabel } from "@/lib/ui/labels";
import { formatMoney } from "@/lib/ui/money";
import { priceBreakdownProps } from "@/lib/ui/price-view";
import { activePaymentProvider } from "@/app/_lib/payment-provider";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CarIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { loadMyReservation } from "../_lib/load";
import { PayBalance } from "./pay-balance";
import { CancelReservation, ModifyDates } from "./rental-actions";

export const metadata: Metadata = { title: "Reservation" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export default async function RentalPage({ params }: PageProps<"/rentals/[reference]">) {
  const { reference } = await params;
  const { r } = await loadMyReservation(reference, `/rentals/${encodeURIComponent(reference)}`);
  const now = new Date();
  const branches = r.can.modifyDates ? await listBranches() : [];
  const hours = parseOpeningHours(branches.find((b) => b.id === r.pickupBranch.id)?.openingHours);
  const photo = r.vehicle.photoUrls[0];
  const a = r.agreement;

  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        breadcrumbs={[{ label: "My rentals", href: "/rentals" }, { label: r.reference }]}
        eyebrow={<span className="font-mono">{r.reference}</span>}
        title={r.vehicle.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="reservation" status={r.status} size="md" />
            {r.paymentStatus && (
              <span className="flex items-center gap-1 text-sm">
                Payment: <StatusBadge kind="payment" status={r.paymentStatus} />
              </span>
            )}
            {r.depositStatus && (
              <span className="flex items-center gap-1 text-sm">
                Deposit: <StatusBadge kind="deposit" status={r.depositStatus} />
              </span>
            )}
          </span>
        }
        actions={
          <>
            {r.can.pay && (
              <Link href={`/book/pay/${r.reference}`} className={buttonClasses("primary")}>
                Complete payment
              </Link>
            )}
            {r.can.viewVoucher && (
              <Link href={`/rentals/${r.reference}/voucher`} className={buttonClasses("primary")}>
                Pick-up voucher
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Card as="section" aria-labelledby="trip-heading">
            <CardHeader title={<span id="trip-heading">Trip</span>} />
            <CardBody className="flex flex-col gap-5 sm:flex-row">
              <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-lg bg-surface-muted sm:w-48">
                {photo ? <Image src={photo} alt={r.vehicle.name} fill sizes="(min-width: 640px) 192px, 100vw" className="object-cover" /> : <CarIcon className="m-auto h-full text-brand-300" size={48} />}
              </div>
              <dl className="grid flex-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Pick-up</dt>
                  <dd className="font-semibold text-ink">{formatDateTime(r.pickupAt, r.timezone)}</dd>
                  <dd>{r.pickupBranch.name}</dd>
                  <dd className="text-ink-muted">{r.pickupBranch.address}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Return</dt>
                  <dd className="font-semibold text-ink">{formatDateTime(r.returnAt, r.returnBranch.timezone)}</dd>
                  <dd>{r.returnBranch.name}</dd>
                  <dd className="text-ink-muted">{r.returnBranch.address}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">Car</dt>
                  <dd className="text-ink">
                    {r.vehicle.category.name} · {r.vehicle.seats} seats · {transmissionLabel(r.vehicle.transmission)} · {fuelLabel(r.vehicle.fuelType)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {r.can.payBalance && (
            <Card as="section" aria-labelledby="balance-heading" className="border-amber-300">
              <CardHeader
                title={<span id="balance-heading">Balance due: {formatMoney(r.balanceDueFils, "AED")}</span>}
                description="Return charges (late return, fuel or damage, with VAT) were more than the security deposit covered."
              />
              <CardBody>
                <PayBalance reservationId={r.id} balanceFils={r.balanceDueFils} provider={activePaymentProvider()} initialKey={`bal_${randomUUID()}`} />
              </CardBody>
            </Card>
          )}

          {(r.can.modifyDates || r.can.cancel) && (
            <Card as="section" aria-labelledby="manage-heading">
              <CardHeader
                title={<span id="manage-heading">Manage reservation</span>}
                description="Free cancellation and date changes until 48 hours before pick-up."
              />
              <CardBody className="flex flex-col gap-4">
                {r.can.modifyDates && (
                  <ModifyDates
                    reservationId={r.id}
                    timeZone={r.timezone}
                    current={{
                      pickupDate: toDateString(r.pickupAt, r.timezone),
                      pickupTime: toTimeString(r.pickupAt, r.timezone),
                      returnDate: toDateString(r.returnAt, r.timezone),
                      returnTime: toTimeString(r.returnAt, r.timezone),
                    }}
                    minDate={todayInTimeZone(now, r.timezone)}
                    openTime={hours?.open}
                    closeTime={hours?.close}
                    paidFils={r.paidFils}
                    provider={activePaymentProvider()}
                    initialKey={`mod_${randomUUID()}`}
                  />
                )}
                {r.can.cancel && r.cancellationPreview && <CancelReservation reservationId={r.id} preview={r.cancellationPreview} />}
              </CardBody>
            </Card>
          )}

          {(r.status === "CANCELLED" || r.status === "REFUNDED") && (
            <Notice tone="info" title="This reservation was cancelled" live>
              {r.cancelledAt && <>Cancelled {formatDateTime(r.cancelledAt, r.timezone)}. </>}
              {r.refundedFils > 0 ? `${formatMoney(r.refundedFils, "AED")} has been refunded to your card.` : "No payment was taken."}
              {r.cancellationFeeFils ? ` A cancellation fee of ${formatMoney(r.cancellationFeeFils, "AED")} was kept.` : ""}
            </Notice>
          )}

          {r.status === "RETURNED" && a && (a.amountDueFils ?? 0) > 0 && r.balanceDueFils === 0 && (
            <Notice tone="success" title="Return charges settled" live>
              Thank you. The charges above your security deposit have been paid.
            </Notice>
          )}

          {r.status === "EXPIRED" && (
            <Notice tone="info" title="This hold expired">
              Payment wasn&apos;t completed in time, so the car was released and nothing was charged.
            </Notice>
          )}

          {a && (
            <Card as="section" aria-labelledby="agreement-heading" padded>
              <h2 id="agreement-heading" className="text-base font-bold text-ink">
                Rental agreement
              </h2>
              <dl className="mt-3 text-sm">
                {a.checkedOutAt && <Row label="Picked up">{formatDateTime(a.checkedOutAt, r.timezone)}</Row>}
                {a.pickupMileageKm !== null && <Row label="Mileage at pick-up">{a.pickupMileageKm.toLocaleString("en-GB")} km</Row>}
                {a.pickupFuelLevel !== null && <Row label="Fuel at pick-up">{a.pickupFuelLevel}/8</Row>}
                {a.checkedInAt && <Row label="Returned">{formatDateTime(a.checkedInAt, r.returnBranch.timezone)}</Row>}
                {a.returnMileageKm !== null && <Row label="Mileage at return">{a.returnMileageKm.toLocaleString("en-GB")} km</Row>}
                {a.returnFuelLevel !== null && <Row label="Fuel at return">{a.returnFuelLevel}/8</Row>}
                {(a.lateFeeFils ?? 0) > 0 && <Row label={`Late return (${a.lateDays} days)`}>{formatMoney(a.lateFeeFils ?? 0, "AED")}</Row>}
                {(a.fuelChargeFils ?? 0) > 0 && <Row label="Fuel charge">{formatMoney(a.fuelChargeFils ?? 0, "AED")}</Row>}
                {(a.damageChargeFils ?? 0) > 0 && <Row label="Damage charge">{formatMoney(a.damageChargeFils ?? 0, "AED")}</Row>}
                {(a.depositCapturedFils ?? 0) > 0 && <Row label="Taken from deposit">{formatMoney(a.depositCapturedFils ?? 0, "AED")}</Row>}
              </dl>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Card padded>
            <PriceBreakdown {...priceBreakdownProps(r.price)} />
            <dl className="mt-4 border-t border-line pt-3 text-sm">
              <Row label="Paid">{formatMoney(r.paidFils, "AED")}</Row>
              {r.balanceDueFils > 0 && <Row label="Balance due">{formatMoney(r.balanceDueFils, "AED")}</Row>}
              {r.refundedFils > 0 && <Row label="Refunded">{formatMoney(r.refundedFils, "AED")}</Row>}
              {r.cancellationFeeFils !== null && r.cancellationFeeFils > 0 && <Row label="Cancellation fee">{formatMoney(r.cancellationFeeFils, "AED")}</Row>}
              <Row label="Booked">{formatDateTime(r.createdAt, r.timezone)}</Row>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
