import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/ui/datetime";
import { pluralize, transmissionLabel } from "@/lib/ui/labels";
import { priceBreakdownProps, type ServerPriceLike } from "@/lib/ui/price-view";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { Card } from "@/components/ui/card";
import { CarIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";

export interface TripSummaryProps {
  vehicle: { name: string; category: { name: string }; photoUrls: string[]; seats: number; transmission: string };
  pickupBranchName: string;
  returnBranchName: string;
  pickupAt: Date;
  returnAt: Date;
  timeZone: string;
  returnTimeZone?: string;
  price: ServerPriceLike | null;
  priceError?: string | null;
  /** Link to change dates/extras. */
  changeHref?: string;
  footer?: ReactNode;
}

/** Booking sidebar: vehicle, trip in branch time and the server price. */
export function TripSummary({
  vehicle,
  pickupBranchName,
  returnBranchName,
  pickupAt,
  returnAt,
  timeZone,
  returnTimeZone,
  price,
  priceError,
  changeHref,
  footer,
}: TripSummaryProps) {
  const photo = vehicle.photoUrls[0];
  return (
    <Card as="aside" aria-label="Your booking" className="overflow-hidden">
      <div className="flex items-center gap-4 border-b border-line p-4">
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
          {photo ? (
            <Image src={photo} alt="" fill sizes="96px" className="object-cover" />
          ) : (
            <CarIcon className="m-auto h-full text-brand-300" size={36} />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-ink">{vehicle.name}</p>
          <p className="text-sm text-ink-muted">
            {vehicle.category.name} · {vehicle.seats} seats · {transmissionLabel(vehicle.transmission)}
          </p>
        </div>
      </div>
      <dl className="grid gap-3 border-b border-line p-4 text-sm">
        <div>
          <dt className="font-semibold text-ink">Pick-up</dt>
          <dd className="text-ink-muted">
            {formatDateTime(pickupAt, timeZone)}
            <br />
            {pickupBranchName}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Return</dt>
          <dd className="text-ink-muted">
            {formatDateTime(returnAt, returnTimeZone ?? timeZone)}
            <br />
            {returnBranchName}
          </dd>
        </div>
        {price && <dd className="text-ink-muted">{pluralize(price.rentalDays, "rental day")}</dd>}
        {changeHref && (
          <dd>
            <Link href={changeHref} className="text-sm font-semibold text-brand-700 hover:underline">
              Change dates or extras
            </Link>
          </dd>
        )}
      </dl>
      <div className="p-4">
        {price ? (
          <PriceBreakdown {...priceBreakdownProps(price)} />
        ) : (
          <Notice tone="error" title="This trip can't be priced">
            {priceError ?? "Please change your dates or extras."}
          </Notice>
        )}
        {footer && <div className="mt-4">{footer}</div>}
      </div>
    </Card>
  );
}
