import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { isDomainError } from "@/lib/errors";
import { getVoucher } from "@/lib/reservations";
import { formatDateTime, timeZoneLabel } from "@/lib/ui/datetime";
import { pluralize } from "@/lib/ui/labels";
import { formatMoney } from "@/lib/ui/money";
import { PrintButton } from "@/app/_components/print-button";
import { QrCode } from "@/components/booking/qr-code";
import { Stepper } from "@/components/booking/stepper";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Pick-up voucher" };

export default async function VoucherPage({ params, searchParams }: PageProps<"/rentals/[reference]/voucher">) {
  const [{ reference }, sp] = await Promise.all([params, searchParams]);
  const actor = await requireUserOrRedirect(`/rentals/${encodeURIComponent(reference)}/voucher`);
  let voucher;
  try {
    voucher = await getVoucher(actor, reference);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    if (isDomainError(error) && error.code === "INVALID_STATE") {
      return (
        <div className="container-page py-10">
          <Notice
            tone="warning"
            title="No voucher yet"
            actions={
              <Link href={`/rentals/${encodeURIComponent(reference)}`} className={buttonClasses("outline", "sm")}>
                View reservation
              </Link>
            }
          >
            {error.message}
          </Notice>
        </div>
      );
    }
    throw error;
  }
  const r = voucher.reservation;
  const justBooked = sp.new === "1";

  return (
    <div className="container-page py-8 sm:py-10 print:py-0">
      {justBooked && <Stepper current="voucher" className="mb-8 print:hidden" />}
      {justBooked && (
        <Notice tone="success" title="You're booked!" className="mb-6 print:hidden" live>
          Your payment went through and the car is reserved. Show this voucher at the counter when you pick up the car.
        </Notice>
      )}

      <Card className="mx-auto max-w-3xl overflow-hidden print:border-0 print:shadow-none">
        <div className="flex flex-col gap-1 bg-brand-900 px-6 py-5 text-white print:bg-white print:text-ink">
          <p className="text-sm font-semibold tracking-widest text-accent-300 uppercase print:text-ink">DriveEasy pick-up voucher</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-3xl font-extrabold tracking-wider">{voucher.reference}</h1>
            <StatusBadge kind="reservation" status={r.status} />
          </div>
        </div>

        <div className="grid gap-8 p-6 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex justify-center">
            <QrCode value={voucher.qrPayload} label={`Pick-up QR code for reservation ${voucher.reference}`} size={208} caption={voucher.reference} />
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-ink-muted">Driver</dt>
              <dd className="text-base font-semibold text-ink">{r.customer.name}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-ink-muted">Vehicle</dt>
              <dd className="text-base font-semibold text-ink">
                {r.vehicle.name} <span className="font-normal text-ink-muted">({r.vehicle.category.name})</span>
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Pick-up</dt>
              <dd className="font-semibold text-ink">{formatDateTime(r.pickupAt, r.timezone, "long")}</dd>
              <dd className="text-ink">{r.pickupBranch.name}</dd>
              <dd className="text-ink-muted">{r.pickupBranch.address}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Return</dt>
              <dd className="font-semibold text-ink">{formatDateTime(r.returnAt, r.returnBranch.timezone, "long")}</dd>
              <dd className="text-ink">{r.returnBranch.name}</dd>
              <dd className="text-ink-muted">{r.returnBranch.address}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Rental</dt>
              <dd className="font-semibold text-ink">
                {pluralize(r.price.rentalDays, "day")} · paid {formatMoney(r.paidFils, "AED")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Security deposit (held)</dt>
              <dd className="font-semibold text-ink">{formatMoney(r.price.depositFils, "AED")}</dd>
            </div>
            {r.price.extras.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-ink-muted">Extras</dt>
                <dd className="text-ink">{r.price.extras.map((e) => (e.quantity > 1 ? `${e.name} × ${e.quantity}` : e.name)).join(", ")}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="border-t border-line bg-canvas/60 px-6 py-4 text-sm text-ink-muted">
          <p>
            Bring your driving licence, passport or Emirates ID, and the card used for payment. Times are in{" "}
            {timeZoneLabel(r.timezone, r.pickupAt)}.
          </p>
          {r.pickupBranch.phone && <p className="mt-1">Branch phone: {r.pickupBranch.phone}</p>}
        </div>
      </Card>

      <div className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-3 print:hidden">
        <PrintButton />
        <Link href={`/rentals/${voucher.reference}`} className={buttonClasses("outline")}>
          Manage reservation
        </Link>
        <Link href="/rentals" className={buttonClasses("ghost")}>
          All my rentals
        </Link>
      </div>
    </div>
  );
}
